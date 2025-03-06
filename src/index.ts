import { Socket } from "net"
import assert from "assert"
import yaml from "yaml"
import camelCase from "./camelcase"
import {
  BAD_FORMAT,
  BURIED,
  DEADLINE_SOON,
  DELETED,
  DELIMITER,
  DRAINING,
  EXPECTED_CRLF,
  FOUND,
  INSERTED,
  INTERNAL_ERROR,
  JackdError,
  JackdErrorCode,
  JOB_TOO_BIG,
  KICKED,
  NOT_FOUND,
  NOT_IGNORED,
  OK,
  OUT_OF_MEMORY,
  PAUSED,
  RELEASED,
  RESERVED,
  TIMED_OUT,
  TOUCHED,
  UNKNOWN_COMMAND,
  USING,
  WATCHING,
  type JackdProps
} from "./types"
import type {
  CommandExecution,
  CommandHandler,
  JackdArgs,
  JackdBuryArgs,
  JackdJob,
  JackdJobArgs,
  JackdJobRaw,
  JackdPauseTubeArgs,
  JackdPayload,
  JackdPutArgs,
  JackdPutOpts,
  JackdReleaseArgs,
  JackdTubeArgs,
  JobStats,
  SystemStats,
  TubeStats
} from "./types"
import EventEmitter from "events"

/**
 * Beanstalkd client
 *
 * ```ts
 * import Jackd from "jackd"
 *
 * const client = new Jackd()
 *
 * await client.put("Hello!")
 *
 * // At a later time
 * const { id, payload } = await client.reserve()
 * console.log({ id, payload }) // => { id: '1', payload: 'Hello!' }
 *
 * // Process the job, then delete it
 * await client.delete(id)
 * ```
 */
export class JackdClient {
  public socket: Socket = this.createSocket()
  public connected: boolean = false
  private chunkLength: number = 0
  private host: string
  private port: number
  private autoReconnect: boolean
  private initialReconnectDelay: number
  private maxReconnectDelay: number
  private maxReconnectAttempts: number
  private reconnectAttempts: number = 0
  private currentReconnectDelay: number
  private reconnectTimeout?: ReturnType<typeof setTimeout>
  private isReconnecting: boolean = false
  private watchedTubes: Set<string> = new Set(["default"])
  private currentTube: string = "default"

  private executions: CommandExecution<unknown>[] = []
  private buffer: Uint8Array = new Uint8Array()
  private commandBuffer: Uint8Array = new Uint8Array()
  private isProcessing: boolean = false

  constructor({
    autoconnect = true,
    host = "localhost",
    port = 11300,
    autoReconnect = true,
    initialReconnectDelay = 1000,
    maxReconnectDelay = 30000,
    maxReconnectAttempts = 0
  }: JackdProps = {}) {
    this.host = host
    this.port = port
    this.autoReconnect = autoReconnect
    this.initialReconnectDelay = initialReconnectDelay
    this.maxReconnectDelay = maxReconnectDelay
    this.maxReconnectAttempts = maxReconnectAttempts
    this.currentReconnectDelay = initialReconnectDelay

    if (autoconnect) {
      void this.connect()
    }
  }

  private createSocket() {
    this.socket = new Socket()
    this.socket.setKeepAlive(true, 30_000)

    this.socket.on("ready", () => {
      this.connected = true
      void this.processNextCommand()
    })

    this.socket.on("close", () => {
      if (this.connected) this.handleDisconnect()
    })

    this.socket.on("end", () => {
      if (this.connected) this.handleDisconnect()
    })

    this.socket.on("error", (error: Error) => {
      console.error("Socket error:", error.message)
      if (this.connected) this.handleDisconnect()
    })

    // When we receive data from the socket, add it to the buffer.
    this.socket.on("data", incoming => {
      const newBuffer = new Uint8Array(this.buffer.length + incoming.length)
      newBuffer.set(this.buffer)
      newBuffer.set(new Uint8Array(incoming), this.buffer.length)
      this.buffer = newBuffer

      void this.processNextCommand()
    })

    return this.socket
  }

  private handleDisconnect() {
    this.connected = false

    if (this.autoReconnect && !this.isReconnecting) {
      void this.attemptReconnect()
    }
  }

  private attemptReconnect() {
    if (
      this.maxReconnectAttempts > 0 &&
      this.reconnectAttempts >= this.maxReconnectAttempts
    ) {
      console.error("Max reconnection attempts reached")
      return
    }

    this.isReconnecting = true
    this.reconnectAttempts++

    // Clear any existing timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
    }

    // Schedule reconnection attempt with exponential backoff
    this.reconnectTimeout = setTimeout(() => {
      void (async () => {
        try {
          await this.connect()
          this.isReconnecting = false
        } catch (error) {
          console.error("Reconnection failed:", error)

          // Exponential backoff with max delay
          this.currentReconnectDelay = Math.min(
            this.currentReconnectDelay * 2,
            this.maxReconnectDelay
          )

          // Try again
          this.isReconnecting = false
          void this.attemptReconnect()
        }
      })()
    }, this.currentReconnectDelay)
  }

  /**
   * For environments where network partitioning is common.
   * @returns {Boolean}
   */
  isConnected(): boolean {
    return this.connected
  }

  async connect(): Promise<this> {
    await new Promise<void>((resolve, reject) => {
      this.socket.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EISCONN") {
          return resolve()
        }
        reject(error)
      })

      this.socket.connect(this.port, this.host, resolve)
    })

    await this.rewatchTubes()
    await this.reuseTube()

    return this
  }

  /**
   * Rewatches all previously watched tubes after a reconnection
   * If default is not in the watched tubes list, ignores it
   */
  private async rewatchTubes() {
    // Watch all tubes in our set (except default) first
    for (const tube of this.watchedTubes) {
      if (tube !== "default") {
        await this.watch(tube)
      }
    }

    // Only after watching other tubes, ignore default if it's not in our watched set
    if (!this.watchedTubes.has("default")) {
      await this.ignore("default")
    }
  }

  /**
   * Reuses the previously used tube after a reconnection
   */
  private async reuseTube() {
    if (this.currentTube !== "default") {
      await this.use(this.currentTube)
    }
  }

  quit = async () => {
    if (!this.connected) return

    const waitForClose = new Promise<void>((resolve, reject) => {
      this.socket.once("end", resolve)
      this.socket.once("close", resolve)
      this.socket.once("error", reject)
    })

    await this.write(new TextEncoder().encode("quit\r\n"))
    this.socket.destroy()
    await waitForClose
  }

  close = this.quit
  disconnect = this.quit

  createCommandHandler<TArgs extends JackdArgs, TReturn>(
    commandStringFunction: (...args: TArgs) => Uint8Array,
    handlers: CommandHandler<TReturn | void>[]
  ): (...args: TArgs) => Promise<TReturn> {
    return async (...args) => {
      const commandString: Uint8Array = commandStringFunction.apply(this, args)

      const emitter = new EventEmitter()

      this.executions.push({
        command: commandString,
        handlers: handlers.concat(),
        emitter,
        written: false
      })

      void this.processNextCommand()

      return new Promise<TReturn>((resolve, reject) => {
        emitter.once("resolve", resolve)
        emitter.once("reject", reject)
      })
    }
  }

  private async processNextCommand() {
    if (this.isProcessing) return

    this.isProcessing = true

    try {
      if (!this.connected) return

      while (this.executions.length > 0) {
        const execution = this.executions[0]

        if (!execution.written) {
          await this.write(execution.command)
          execution.written = true
        }

        // Now that we've written the command, let's move the front of this.buffer to
        // this.commandBuffer until we have a full response.
        const delimiter = new TextEncoder().encode(DELIMITER)

        const { handlers, emitter } = execution

        try {
          while (handlers.length) {
            const handler = handlers[0]

            while (true) {
              const index = this.chunkLength
                ? this.chunkLength
                : findIndex(this.buffer, delimiter)

              if (this.chunkLength && this.buffer.length >= this.chunkLength) {
                this.commandBuffer = this.buffer.slice(0, this.chunkLength)
                this.buffer = this.buffer.slice(
                  this.chunkLength + delimiter.length
                )
                this.chunkLength = 0
                break
              } else if (this.chunkLength === 0 && index > -1) {
                // If we have a full response, move it to the command buffer and reset the buffer.
                this.commandBuffer = this.buffer.slice(0, index)
                this.buffer = this.buffer.slice(index + delimiter.length)
                break
              }

              // If we don't have a full response, wait for more data.
              return
            }

            const result = await handler(
              this.commandBuffer,
              execution.command.slice(
                0,
                execution.command.length - DELIMITER.length
              )
            )
            this.commandBuffer = new Uint8Array()
            handlers.shift()

            // If this is the last handler, emit the result.
            if (handlers.length === 0) {
              emitter.emit("resolve", result)
              this.executions.shift()
            }
          }
        } catch (err) {
          emitter.emit("reject", err)
          this.executions.shift()
        }
      }
    } catch (error) {
      console.error("Error processing command:", error)
    } finally {
      this.isProcessing = false
    }
  }

  private write(buffer: Uint8Array) {
    assert(buffer)

    return new Promise<void>((resolve, reject) => {
      this.socket.write(buffer, err => (err ? reject(err) : resolve()))
    })
  }

  /**
   * Puts a job into the currently used tube
   * @param payload Job data - will be JSON stringified if object
   * @param options Priority, delay and TTR options
   * @returns Job ID
   * @throws {Error} BURIED if server out of memory
   * @throws {Error} EXPECTED_CRLF if job body not properly terminated
   * @throws {Error} JOB_TOO_BIG if job larger than max-job-size
   * @throws {Error} DRAINING if server in drain mode
   */
  put = this.createCommandHandler<JackdPutArgs, number>(
    (payload: JackdPayload, { priority, delay, ttr }: JackdPutOpts = {}) => {
      assert(payload)
      let body: Uint8Array

      // If the caller passed in an object, convert it to a valid Uint8Array from a JSON string
      if (typeof payload === "object") {
        const string = JSON.stringify(payload)
        body = new TextEncoder().encode(string)
      } else {
        // Anything else, just capture the Uint8Array
        body = new TextEncoder().encode(payload)
      }

      const command = new TextEncoder().encode(
        `put ${priority || 0} ${delay || 0} ${ttr || 60} ${body.length}\r\n`
      )

      const delimiter = new TextEncoder().encode(DELIMITER)
      const result = new Uint8Array(
        command.length + body.length + delimiter.length
      )
      result.set(command)
      result.set(body, command.length)
      result.set(delimiter, command.length + body.length)
      return result
    },
    [
      buffer => {
        const ascii = validate(buffer, [
          BURIED,
          EXPECTED_CRLF,
          JOB_TOO_BIG,
          DRAINING
        ])

        if (ascii.startsWith(INSERTED)) {
          const [, id] = ascii.split(" ")
          return parseInt(id)
        }

        invalidResponse(ascii)
      }
    ]
  )

  /**
   * Changes the tube used for subsequent put commands
   * @param tube Tube name (max 200 bytes). Created if doesn't exist.
   * @returns Name of tube now being used
   */
  use = this.createCommandHandler<JackdTubeArgs, string>(
    tube => {
      assert(tube)
      return new TextEncoder().encode(`use ${tube}\r\n`)
    },
    [
      buffer => {
        const ascii = validate(buffer)

        if (ascii.startsWith(USING)) {
          const [, tube] = ascii.split(" ")
          this.currentTube = tube
          return tube
        }

        invalidResponse(ascii)
      }
    ]
  )

  createReserveHandlers<T extends JackdJob | JackdJobRaw>(
    additionalResponses: Array<string> = [],
    decodePayload: boolean = true
  ): [CommandHandler<void>, CommandHandler<T>] {
    let id: number

    return [
      (buffer: Uint8Array) => {
        const ascii = validate(buffer, [
          DEADLINE_SOON,
          TIMED_OUT,
          ...additionalResponses
        ])

        if (ascii.startsWith(RESERVED)) {
          const [, incomingId, bytes] = ascii.split(" ")
          id = parseInt(incomingId)
          this.chunkLength = parseInt(bytes)
          return
        }

        invalidResponse(ascii)
      },
      (payload: Uint8Array) => {
        return {
          id,
          payload: decodePayload ? new TextDecoder().decode(payload) : payload
        } as T
      }
    ]
  }

  /**
   * Reserves a job from any watched tube
   * @returns Reserved job with string payload
   * @throws {Error} DEADLINE_SOON if reserved job TTR expiring
   * @throws {Error} TIMED_OUT if timeout exceeded with no job
   */
  reserve = this.createCommandHandler<[], JackdJob>(
    () => new TextEncoder().encode("reserve\r\n"),
    this.createReserveHandlers<JackdJob>([], true)
  )

  /**
   * Reserves a job with raw byte payload
   * @returns Reserved job with raw payload
   * @throws {Error} DEADLINE_SOON if reserved job TTR expiring
   * @throws {Error} TIMED_OUT if timeout exceeded with no job
   */
  reserveRaw = this.createCommandHandler<[], JackdJobRaw>(
    () => new TextEncoder().encode("reserve\r\n"),
    this.createReserveHandlers<JackdJobRaw>([], false)
  )

  /**
   * Reserves a job with timeout
   * @param seconds Max seconds to wait. 0 returns immediately.
   * @returns Reserved job
   * @throws {Error} DEADLINE_SOON if reserved job TTR expiring
   * @throws {Error} TIMED_OUT if timeout exceeded with no job
   */
  reserveWithTimeout = this.createCommandHandler<[number], JackdJob>(
    seconds => new TextEncoder().encode(`reserve-with-timeout ${seconds}\r\n`),
    this.createReserveHandlers<JackdJob>([], true)
  )

  /**
   * Reserves a specific job by ID
   * @param id Job ID to reserve
   * @returns Reserved job
   * @throws {Error} NOT_FOUND if job doesn't exist or not reservable
   */
  reserveJob = this.createCommandHandler<[number], JackdJob>(
    id => new TextEncoder().encode(`reserve-job ${id}\r\n`),
    this.createReserveHandlers<JackdJob>([NOT_FOUND], true)
  )

  /**
   * Deletes a job
   * @param id Job ID to delete
   * @throws {Error} NOT_FOUND if job doesn't exist or not deletable
   */
  delete = this.createCommandHandler<JackdJobArgs, void>(
    id => {
      assert(id)
      return new TextEncoder().encode(`delete ${id}\r\n`)
    },
    [
      buffer => {
        const ascii = validate(buffer, [NOT_FOUND])

        if (ascii === DELETED) return
        invalidResponse(ascii)
      }
    ]
  )

  /**
   * Releases a reserved job back to ready queue
   * @param id Job ID to release
   * @param options New priority and delay
   * @throws {Error} BURIED if server out of memory
   * @throws {Error} NOT_FOUND if job doesn't exist or not reserved by this client
   */
  release = this.createCommandHandler<JackdReleaseArgs, void>(
    (id, { priority, delay } = {}) => {
      assert(id)
      return new TextEncoder().encode(
        `release ${id} ${priority || 0} ${delay || 0}\r\n`
      )
    },
    [
      buffer => {
        const ascii = validate(buffer, [BURIED, NOT_FOUND])
        if (ascii === RELEASED) return
        invalidResponse(ascii)
      }
    ]
  )

  /**
   * Buries a job
   * @param id Job ID to bury
   * @param priority New priority
   * @throws {Error} NOT_FOUND if job doesn't exist or not reserved by this client
   */
  bury = this.createCommandHandler<JackdBuryArgs, void>(
    (id, priority) => {
      assert(id)
      return new TextEncoder().encode(`bury ${id} ${priority || 0}\r\n`)
    },
    [
      buffer => {
        const ascii = validate(buffer, [NOT_FOUND])
        if (ascii === BURIED) return
        invalidResponse(ascii)
      }
    ]
  )

  /**
   * Touches a reserved job, requesting more time to work on it
   * @param id Job ID to touch
   * @throws {Error} NOT_FOUND if job doesn't exist or not reserved by this client
   */
  touch = this.createCommandHandler<JackdJobArgs, void>(
    id => {
      assert(id)
      return new TextEncoder().encode(`touch ${id}\r\n`)
    },
    [
      buffer => {
        const ascii = validate(buffer, [NOT_FOUND])
        if (ascii === TOUCHED) return
        invalidResponse(ascii)
      }
    ]
  )

  /**
   * Adds tube to watch list for reserve commands
   * @param tube Tube name to watch (max 200 bytes)
   * @returns Number of tubes now being watched
   */
  watch = this.createCommandHandler<JackdTubeArgs, number>(
    tube => {
      assert(tube)
      return new TextEncoder().encode(`watch ${tube}\r\n`)
    },
    [
      (buffer, command) => {
        const ascii = validate(buffer)

        if (ascii.startsWith(WATCHING)) {
          const tube = new TextDecoder().decode(command).split(" ")[1]
          this.watchedTubes.add(tube)

          const [, count] = ascii.split(" ")
          return parseInt(count)
        }

        invalidResponse(ascii)
      }
    ]
  )

  /**
   * Removes tube from watch list
   * @param tube Tube name to ignore
   * @returns Number of tubes now being watched
   * @throws {Error} NOT_IGNORED if trying to ignore only watched tube
   */
  ignore = this.createCommandHandler<JackdTubeArgs, number>(
    tube => {
      assert(tube)
      return new TextEncoder().encode(`ignore ${tube}\r\n`)
    },
    [
      (buffer, command) => {
        const ascii = validate(buffer, [NOT_IGNORED])

        if (ascii.startsWith(WATCHING)) {
          const tube = new TextDecoder().decode(command).split(" ")[1]
          this.watchedTubes.delete(tube)

          const [, count] = ascii.split(" ")
          return parseInt(count)
        }
        invalidResponse(ascii)
      }
    ]
  )

  /**
   * Pauses new job reservations in a tube
   * @param tube Tube name to pause
   * @param delay Seconds to pause for
   * @throws {Error} NOT_FOUND if tube doesn't exist
   */
  pauseTube = this.createCommandHandler<JackdPauseTubeArgs, void>(
    (tube, { delay } = {}) =>
      new TextEncoder().encode(`pause-tube ${tube} ${delay || 0}`),

    [
      buffer => {
        const ascii = validate(buffer, [NOT_FOUND])
        if (ascii === PAUSED) return
        invalidResponse(ascii)
      }
    ]
  )

  /* Other commands */

  /**
   * Peeks at a specific job
   * @param id Job ID to peek at
   * @returns Job data if found
   * @throws {Error} NOT_FOUND if job doesn't exist
   */
  peek = this.createCommandHandler<JackdJobArgs, JackdJob>(id => {
    assert(id)
    return new TextEncoder().encode(`peek ${id}\r\n`)
  }, this.createPeekHandlers())

  createPeekHandlers(): [CommandHandler<void>, CommandHandler<JackdJob>] {
    let id: number

    return [
      (buffer: Uint8Array) => {
        const ascii = validate(buffer, [NOT_FOUND])
        if (ascii.startsWith(FOUND)) {
          const [, peekId, bytes] = ascii.split(" ")
          id = parseInt(peekId)
          this.chunkLength = parseInt(bytes)
          return
        }
        invalidResponse(ascii)
      },
      (payload: Uint8Array) => {
        return {
          id,
          payload: new TextDecoder().decode(payload)
        }
      }
    ]
  }

  /**
   * Peeks at the next ready job in the currently used tube
   * @returns Job data if found
   * @throws {Error} NOT_FOUND if no ready jobs
   */
  peekReady = this.createCommandHandler<[], JackdJob>(
    () => new TextEncoder().encode(`peek-ready\r\n`),
    this.createPeekHandlers()
  )

  /**
   * Peeks at the delayed job with shortest delay in currently used tube
   * @returns Job data if found
   * @throws {Error} NOT_FOUND if no delayed jobs
   */
  peekDelayed = this.createCommandHandler<[], JackdJob>(
    () => new TextEncoder().encode(`peek-delayed\r\n`),
    this.createPeekHandlers()
  )

  /**
   * Peeks at the next buried job in currently used tube
   * @returns Job data if found
   * @throws {Error} NOT_FOUND if no buried jobs
   */
  peekBuried = this.createCommandHandler<[], JackdJob>(
    () => new TextEncoder().encode(`peek-buried\r\n`),
    this.createPeekHandlers()
  )

  /**
   * Kicks at most bound jobs from buried to ready queue in currently used tube
   * @param bound Maximum number of jobs to kick
   * @returns Number of jobs actually kicked
   */
  kick = this.createCommandHandler<[jobsCount: number], number>(
    bound => {
      assert(bound)
      return new TextEncoder().encode(`kick ${bound}\r\n`)
    },
    [
      buffer => {
        const ascii = validate(buffer)
        if (ascii.startsWith(KICKED)) {
          const [, kicked] = ascii.split(" ")
          return parseInt(kicked)
        }

        invalidResponse(ascii)
      }
    ]
  )

  /**
   * Kicks a specific buried or delayed job into ready queue
   * @param id Job ID to kick
   * @throws {Error} NOT_FOUND if job doesn't exist or not in kickable state
   */
  kickJob = this.createCommandHandler<JackdJobArgs, void>(
    id => {
      assert(id)
      return new TextEncoder().encode(`kick-job ${id}\r\n`)
    },
    [
      buffer => {
        const ascii = validate(buffer, [NOT_FOUND])
        if (ascii.startsWith(KICKED)) return
        invalidResponse(ascii)
      }
    ]
  )

  /**
   * Gets statistical information about a job
   * @param id Job ID
   * @returns Job statistics
   * @throws {Error} NOT_FOUND if job doesn't exist
   */
  statsJob = this.createCommandHandler<JackdJobArgs, JobStats>(
    id => {
      assert(id)
      return new TextEncoder().encode(`stats-job ${id}\r\n`)
    },
    [
      (buffer: Uint8Array) => {
        const ascii = validate(buffer, [NOT_FOUND])

        if (ascii.startsWith(OK)) {
          const [, bytes] = ascii.split(" ")
          this.chunkLength = parseInt(bytes)
          return
        }

        invalidResponse(ascii)
      },
      (payload: Uint8Array): JobStats => {
        const decodedString = new TextDecoder().decode(payload)
        const rawStats = yaml.parse(decodedString) as Record<string, unknown>
        const transformedStats = Object.fromEntries(
          Object.entries(rawStats).map(([key, value]) => [
            camelCase(key),
            value
          ])
        )
        return transformedStats as unknown as JobStats
      }
    ]
  )

  /**
   * Gets statistical information about a tube
   * @param tube Tube name
   * @returns Tube statistics
   * @throws {Error} NOT_FOUND if tube doesn't exist
   */
  statsTube = this.createCommandHandler<JackdTubeArgs, TubeStats>(
    tube => {
      assert(tube)
      return new TextEncoder().encode(`stats-tube ${tube}\r\n`)
    },
    [
      (buffer: Uint8Array) => {
        const ascii = validate(buffer, [NOT_FOUND])

        if (ascii.startsWith(OK)) {
          const [, bytes] = ascii.split(" ")
          this.chunkLength = parseInt(bytes)
          return
        }

        invalidResponse(ascii)
      },
      (payload: Uint8Array): TubeStats => {
        const decodedString = new TextDecoder().decode(payload)
        const rawStats = yaml.parse(decodedString) as Record<string, unknown>
        const transformedStats = Object.fromEntries(
          Object.entries(rawStats).map(([key, value]) => [
            camelCase(key),
            value
          ])
        )
        return transformedStats as unknown as TubeStats
      }
    ]
  )

  /**
   * Gets statistical information about the system
   * @returns System statistics
   */
  stats = this.createCommandHandler<[], SystemStats>(
    () => new TextEncoder().encode(`stats\r\n`),
    [
      (buffer: Uint8Array) => {
        const ascii = validate(buffer)

        if (ascii.startsWith(OK)) {
          const [, bytes] = ascii.split(" ")
          this.chunkLength = parseInt(bytes)
          return
        }

        invalidResponse(ascii)
      },
      (payload: Uint8Array): SystemStats => {
        const decodedString = new TextDecoder().decode(payload)
        const rawStats = yaml.parse(decodedString) as Record<string, unknown>
        const transformedStats = Object.fromEntries(
          Object.entries(rawStats).map(([key, value]) => [
            camelCase(key),
            value
          ])
        )
        return transformedStats as unknown as SystemStats
      }
    ]
  )

  /**
   * Lists all existing tubes
   * @returns Array of tube names
   */
  listTubes = this.createCommandHandler<[], string[]>(
    () => new TextEncoder().encode(`list-tubes\r\n`),
    [
      (buffer: Uint8Array) => {
        const ascii = validate(buffer, [DEADLINE_SOON, TIMED_OUT])

        if (ascii.startsWith(OK)) {
          const [, bytes] = ascii.split(" ")
          this.chunkLength = parseInt(bytes)
          return
        }

        invalidResponse(ascii)
      },
      (payload: Uint8Array): string[] => {
        const decodedString = new TextDecoder().decode(payload)
        return yaml.parse(decodedString) as string[]
      }
    ]
  )

  /**
   * Lists tubes being watched by current connection
   * @returns Array of watched tube names
   */
  listTubesWatched = this.createCommandHandler<[], string[]>(
    () => new TextEncoder().encode(`list-tubes-watched\r\n`),
    [
      (buffer: Uint8Array) => {
        const ascii = validate(buffer, [DEADLINE_SOON, TIMED_OUT])

        if (ascii.startsWith(OK)) {
          const [, bytes] = ascii.split(" ")
          this.chunkLength = parseInt(bytes)
          return
        }

        invalidResponse(ascii)
      },
      (payload: Uint8Array): string[] => {
        const decodedString = new TextDecoder().decode(payload)
        return yaml.parse(decodedString) as string[]
      }
    ]
  )

  /**
   * Returns the tube currently being used by client
   * @returns Name of tube being used
   */
  listTubeUsed = this.createCommandHandler<[], string>(
    () => new TextEncoder().encode(`list-tube-used\r\n`),
    [
      buffer => {
        const ascii = validate(buffer, [NOT_FOUND])
        if (ascii.startsWith(USING)) {
          const [, tube] = ascii.split(" ")
          return tube
        }
        invalidResponse(ascii)
      }
    ]
  )
}

export default JackdClient

function validate(
  buffer: Uint8Array,
  additionalResponses: string[] = []
): string {
  const ascii = new TextDecoder().decode(buffer)
  const errors = [OUT_OF_MEMORY, INTERNAL_ERROR, BAD_FORMAT, UNKNOWN_COMMAND]

  const errorCode = errors
    .concat(additionalResponses)
    .find(error => ascii.startsWith(error))

  if (errorCode) throw new JackdError(errorCode as JackdErrorCode, ascii, ascii)

  return ascii
}

function invalidResponse(ascii: string) {
  throw new JackdError(
    JackdErrorCode.INVALID_RESPONSE,
    `Unexpected response: ${ascii}`,
    ascii
  )
}

// Helper function to find index of subarray
function findIndex(array: Uint8Array, subarray: Uint8Array): number {
  for (let i = 0; i <= array.length - subarray.length; i++) {
    let found = true
    for (let j = 0; j < subarray.length; j++) {
      if (array[i + j] !== subarray[j]) {
        found = false
        break
      }
    }
    if (found) return i
  }
  return -1
}

export { JackdError, JackdErrorCode } from "./types"
