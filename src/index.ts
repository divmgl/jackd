import { Socket } from 'net'
import assert = require('assert')
import EventEmitter = require('events')
import {
  CommandExecution,
  CommandHandler,
  ConnectOpts,
  Job,
  PauseTubeArgs,
  PutArgs,
  ReleaseArgs,
  JobArgs,
  TubeArgs,
  CtorOpts,
  PutOpts
} from './types'

const DELIMITER = '\r\n'

export class JackdClient {
  socket: Socket = new Socket()
  connected: Boolean = false
  buffer: Buffer = Buffer.from([])
  incomingBytes: number = 0
  useLegacyStringPayloads: boolean = false

  // beanstalkd executes all commands serially. Because Node.js is single-threaded,
  // this allows us to queue up all of the messages and commands as they're invokved
  // without needing to explicitly wait for promises.
  messages: Buffer[] = []
  executions: CommandExecution[] = []

  async processChunk(head: Buffer) {
    let index = -1

    // If we're waiting on some bytes from a command...
    if (this.incomingBytes > 0) {
      // ...subtract it from the remaining bytes.
      const remainingBytes = this.incomingBytes - head.length

      // If we still have remaining bytes, leave. We need to wait for the
      // data to come in. Payloads, regardless of their content, must end
      // with the delimiter. This is why we check if it's over the negative
      // delimiter length. If the incoming bytes is -2, we can be absolutely
      // sure the entire message was processed because the delimiter was
      // processed too.
      if (remainingBytes > -DELIMITER.length) {
        return
      }

      index = head.length - DELIMITER.length
      this.incomingBytes = 0
    } else {
      index = head.indexOf(DELIMITER)
    }

    if (index > -1) {
      this.messages.push(head.subarray(0, index))

      // We have to start flushing executions as soon as we push messages. This is to avoid
      // instances where job payloads might contain line breaks. We let the downstream handlers
      // set the incoming bytes almost immediately.
      await this.flushExecutions()

      const tail = head.subarray(index + DELIMITER.length, head.length)
      this.buffer = tail
      await this.processChunk(tail)
    }
  }

  constructor(opts?: CtorOpts) {
    if (opts && opts.useLegacyStringPayloads) {
      this.useLegacyStringPayloads = true
    }

    this.socket.on('ready', () => {
      this.connected = true
    })

    this.socket.on('close', () => {
      this.connected = false
    })

    // When we receive data from the socket, let's process it and put it in our
    // messages.
    this.socket.on('data', async incoming => {
      // Write the incoming data onto the buffer
      this.buffer = Buffer.concat([this.buffer, incoming])
      await this.processChunk(this.buffer)
    })
  }

  async flushExecutions() {
    for (let i = 0; i < this.executions.length; i++) {
      if (this.messages.length === 0) {
        // If there are no remaining messages, we can't continue executing. Leave.
        return
      }

      const execution = this.executions[0]
      const { handlers, emitter } = execution

      try {
        // Executions can have multiple handlers. This happens with multipart messages that wait
        // for more information after the initial response.
        while (handlers.length && this.messages.length) {
          const handler = handlers.shift()
          const result = await handler(this.messages.shift())

          if (handlers.length === 0) {
            emitter.emit('resolve', result)

            // We modified the executions array by removing an element. Decrement the loop.
            this.executions.shift()
            i--

            break
          }
        }
      } catch (err) {
        emitter.emit('reject', err)
      }
    }
  }

  /**
   * For environments where network partitioning is common.
   * @returns {Boolean}
   */
  isConnected(): Boolean {
    return this.connected
  }

  async connect(opts?: ConnectOpts): Promise<this> {
    let host: string = undefined
    let port = 11300

    if (opts && opts.host) {
      host = opts.host
    }

    if (opts && opts.port) {
      port = opts.port
    }

    await new Promise<void>((resolve, reject) => {
      this.socket.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EISCONN') {
          return resolve()
        }

        reject(error)
      })

      this.socket.connect(port, host, resolve)
    })

    return this
  }

  write(buffer: Buffer) {
    assert(buffer)

    return new Promise<void>((resolve, reject) => {
      this.socket.write(buffer, err => (err ? reject(err) : resolve()))
    })
  }

  async quit() {
    await this.write(Buffer.from('quit\r\n', 'ascii'))
  }

  close = this.quit
  disconnect = this.quit

  executeCommand = this.createCommandHandler<[...args: any], any>(
    command => command,
    [
      async response => {
        validate(response)
        return response
      }
    ]
  )

  use = this.createCommandHandler<TubeArgs, string>(
    tube => {
      assert(tube)
      return Buffer.from(`use ${tube}\r\n`, 'ascii')
    },
    [
      async buffer => {
        const ascii = validate(buffer)

        if (ascii.startsWith(USING)) {
          const [, tube] = ascii.split(' ')
          return tube
        }

        invalidResponse(ascii)
      }
    ]
  )

  put = this.createCommandHandler<PutArgs, Buffer>(
    (
      payload: Buffer | string | object,
      { priority, delay, ttr }: PutOpts = {}
    ) => {
      assert(payload)
      let body: any = payload

      // If the caller passed in an object, convert it to a string
      if (typeof body === 'object') {
        body = JSON.stringify(payload)
      }

      // If the body is a string, convert it to a UTF-8 Buffer
      if (typeof body === 'string') {
        body = Buffer.from(body)
      }

      let command = Buffer.from(
        `put ${priority || 0} ${delay || 0} ${ttr || 60} ${body.length}\r\n`,
        'ascii'
      )

      return Buffer.concat([command, body, Buffer.from(DELIMITER, 'ascii')])
    },
    [
      async buffer => {
        const ascii = validate(buffer, [
          BURIED,
          EXPECTED_CRLF,
          JOB_TOO_BIG,
          DRAINING
        ])

        if (ascii.startsWith(INSERTED)) {
          const [, id] = ascii.split(' ')
          return id
        }

        invalidResponse(ascii)
      }
    ]
  )

  delete = this.createCommandHandler<JobArgs, void>(
    id => {
      assert(id)
      return Buffer.from(`delete ${id}\r\n`, 'ascii')
    },
    [
      async buffer => {
        const ascii = validate(buffer, [NOT_FOUND])

        if (ascii === DELETED) return
        invalidResponse(ascii)
      }
    ]
  )

  createReserveHandlers(): CommandHandler[] {
    const self = this
    let id: string

    return [
      async buffer => {
        const ascii = validate(buffer, [DEADLINE_SOON, TIMED_OUT])

        if (ascii.startsWith(RESERVED)) {
          const [, incomingId, bytes] = ascii.split(' ')
          id = incomingId
          self.incomingBytes = parseInt(bytes)

          return
        }

        invalidResponse(ascii)
      },
      async payload => {
        if (self.useLegacyStringPayloads) {
          return { id, payload: payload.toString('ascii') }
        }

        return { id, payload }
      }
    ]
  }

  reserve = this.createCommandHandler<[], Job>(
    () => Buffer.from('reserve\r\n', 'ascii'),
    this.createReserveHandlers()
  )

  reserveWithTimeout = this.createCommandHandler<[], Job>(
    seconds => Buffer.from(`reserve-with-timeout ${seconds}\r\n`, 'ascii'),
    this.createReserveHandlers()
  )

  watch = this.createCommandHandler<TubeArgs, number>(
    tube => {
      assert(tube)
      return Buffer.from(`watch ${tube}\r\n`, 'ascii')
    },
    [
      async buffer => {
        const ascii = validate(buffer)

        if (ascii.startsWith(WATCHING)) {
          const [, count] = ascii.split(' ')
          return count
        }

        invalidResponse(ascii)
      }
    ]
  )

  ignore = this.createCommandHandler<TubeArgs, number>(
    tube => {
      assert(tube)
      return Buffer.from(`ignore ${tube}\r\n`, 'ascii')
    },
    [
      async buffer => {
        const ascii = validate(buffer, [NOT_IGNORED])

        if (ascii.startsWith(WATCHING)) {
          const [, count] = ascii.split(' ')
          return count
        }
        invalidResponse(ascii)
      }
    ]
  )

  bury = this.createCommandHandler<JobArgs, void>(
    (id, { priority } = {}) => {
      assert(id)
      return Buffer.from(`bury ${id} ${priority || 0}\r\n`, 'ascii')
    },
    [
      async buffer => {
        const ascii = validate(buffer, [NOT_FOUND])
        if (ascii === BURIED) return
        invalidResponse(ascii)
      }
    ]
  )

  peekBuried = this.createCommandHandler<[], Job>(
    () => {
      return Buffer.from(`peek-buried\r\n`, 'ascii')
    },
    (() => {
      let id: string

      return [
        async buffer => {
          const ascii = validate(buffer, [NOT_FOUND])
          if (ascii.startsWith(FOUND)) {
            const [, incomingId] = ascii.split(' ')
            id = incomingId

            return
          }
          invalidResponse(ascii)
        },
        async payload => {
          return { id, payload }
        }
      ]
    })()
  )

  executeMultiPartCommand = this.createCommandHandler<
    [command: string],
    string
  >(
    command => command,
    [
      async buffer => {
        validate(buffer)
      },
      async payload => {
        if (this.useLegacyStringPayloads) {
          return payload.toString('ascii')
        }

        return payload
      }
    ]
  )

  pauseTube = this.createCommandHandler<PauseTubeArgs, void>(
    (tube, { delay } = {}) => Buffer.from(`pause-tube ${tube} ${delay || 0}`, 'ascii'),
    [
      async buffer => {
        const ascii = validate(buffer, [NOT_FOUND])
        if (ascii === PAUSED) return
        invalidResponse(ascii)
      }
    ]
  )

  release = this.createCommandHandler<ReleaseArgs, void>(
    (id, { priority, delay } = {}) => {
      assert(id)
      return Buffer.from(`release ${id} ${priority || 0} ${delay || 0}\r\n`, 'ascii')
    },
    [
      async buffer => {
        const ascii = validate(buffer, [BURIED, NOT_FOUND])
        if (ascii === RELEASED) return
        invalidResponse(ascii)
      }
    ]
  )

  touch = this.createCommandHandler<JobArgs, void>(
    id => {
      assert(id)
      return Buffer.from(`touch ${id}\r\n`, 'ascii')
    },
    [
      async buffer => {
        const ascii = validate(buffer, [NOT_FOUND])
        if (ascii === TOUCHED) return
        invalidResponse(ascii)
      }
    ]
  )

  /* Other commands */

  peek = this.createCommandHandler<JobArgs, Job>(
    id => {
      assert(id)
      return Buffer.from(`peek ${id}\r\n`, 'ascii')
    },
    (() => {
      let id: string

      return [
        async buffer => {
          const ascii = validate(buffer, [NOT_FOUND])
          if (ascii.startsWith(FOUND)) {
            const [, incomingId] = ascii.split(' ')
            id = incomingId
          }
          invalidResponse(ascii)
        },
        async function (payload) {
          return { id, payload }
        }
      ]
    })()
  )

  kick = this.createCommandHandler<[jobsCount: number], void>(
    bound => {
      assert(bound)
      return Buffer.from(`kick ${bound}\r\n`, 'ascii')
    },
    [
      async buffer => {
        const ascii = validate(buffer)
        if (ascii.startsWith(KICKED)) return
        invalidResponse(ascii)
      }
    ]
  )

  kickJob = this.createCommandHandler<JobArgs, void>(
    id => {
      assert(id)
      return Buffer.from(`kick-job ${id}\r\n`, 'ascii')
    },
    [
      async buffer => {
        const ascii = validate(buffer, [NOT_FOUND])
        if (ascii.startsWith(KICKED)) return
        invalidResponse(ascii)
      }
    ]
  )

  getCurrentTube = this.createCommandHandler<[], string>(
    () => Buffer.from(`list-tube-used\r\n`, 'ascii'),
    [
      async buffer => {
        const ascii = validate(buffer, [NOT_FOUND])
        if (ascii.startsWith(USING)) {
          const [, tube] = ascii.split(' ')
          return tube
        }
        invalidResponse(ascii)
      }
    ]
  )

  createCommandHandler<TArgs extends any[], TReturn>(
    commandStringFunction: (...args: any[]) => Buffer,
    handlers: CommandHandler[]
  ): (...args: TArgs) => Promise<TReturn> {
    const self = this

    return async function command() {
      const commandString: Buffer = commandStringFunction.apply(this, arguments)
      await self.write(commandString)

      const emitter = new EventEmitter()

      self.executions.push({
        handlers: handlers.concat(),
        emitter
      })

      return await new Promise((resolve, reject) => {
        emitter.once('resolve', resolve)
        emitter.once('reject', reject)
      })
    }
  }
}

module.exports = JackdClient

function validate(buffer: Buffer, additionalErrors: string[] = []): string {
  const ascii = buffer.toString('ascii')
  const errors = [OUT_OF_MEMORY, INTERNAL_ERROR, BAD_FORMAT, UNKNOWN_COMMAND]

  if (errors.concat(additionalErrors).some(error => ascii.startsWith(error))) {
    throw new Error(ascii)
  }

  return ascii
}

export class InvalidResponseError extends Error {
  response: string
}

function invalidResponse(ascii: string) {
  const error = new InvalidResponseError(`Unexpected response: ${ascii}`)
  error.response = ascii
  throw error
}

const RESERVED = 'RESERVED'
const INSERTED = 'INSERTED'
const USING = 'USING'
const TOUCHED = 'TOUCHED'
const DELETED = 'DELETED'
const BURIED = 'BURIED'
const RELEASED = 'RELEASED'
const NOT_FOUND = 'NOT_FOUND'
const OUT_OF_MEMORY = 'OUT_OF_MEMORY'
const INTERNAL_ERROR = 'INTERNAL_ERROR'
const BAD_FORMAT = 'BAD_FORMAT'
const UNKNOWN_COMMAND = 'UNKNOWN_COMMAND'
const EXPECTED_CRLF = 'EXPECTED_CRLF'
const JOB_TOO_BIG = 'JOB_TOO_BIG'
const DRAINING = 'DRAINING'
const TIMED_OUT = 'TIMED_OUT'
const DEADLINE_SOON = 'DEADLINE_SOON'
const FOUND = 'FOUND'
const WATCHING = 'WATCHING'
const NOT_IGNORED = 'NOT_IGNORED'
const KICKED = 'KICKED'
const PAUSED = 'PAUSED'
