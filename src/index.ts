import { Socket } from "net"
import assert from "assert"
import EventEmitter from "events"
import yaml from "yaml"
import camelCase from "./camelcase"

const DELIMITER = "\r\n"

type JackdPayload = Uint8Array | string | object

/**
 * Handler for processing command responses
 */
export type CommandHandler<T> = (chunk: Uint8Array) => T | Promise<T>

/**
 * Command execution state
 */
export class CommandExecution<T> {
  /** Handlers for processing command response */
  handlers: CommandHandler<T | void>[] = []
  /** Event emitter for command completion */
  emitter: EventEmitter = new EventEmitter()
}

/**
 * Options for putting a job into a tube
 */
export interface JackdPutOpts {
  /** Priority value between 0 and 2**32. Jobs with smaller priority values will be scheduled before jobs with larger priorities. 0 is most urgent. */
  priority?: number
  /** Number of seconds to wait before putting the job in the ready queue. Job will be in "delayed" state during this time. Maximum is 2**32-1. */
  delay?: number
  /** Time to run - number of seconds to allow a worker to run this job. Minimum is 1. If 0 is provided, server will use 1. Maximum is 2**32-1. */
  ttr?: number
}

/**
 * Raw job data returned from reserveRaw
 */
export interface JackdJobRaw {
  /** Unique job ID for this instance of beanstalkd */
  id: number
  /** Raw job payload as bytes */
  payload: Uint8Array
}

/**
 * Job data with decoded string payload
 */
export interface JackdJob {
  /** Unique job ID for this instance of beanstalkd */
  id: number
  /** Job payload decoded as UTF-8 string */
  payload: string
}

/**
 * Stats for a specific job
 */
export interface JobStats {
  /** Job ID */
  id: number
  /** Name of tube containing this job */
  tube: string
  /** Current state of the job */
  state: "ready" | "delayed" | "reserved" | "buried"
  /** Priority value set by put/release/bury */
  pri: number
  /** Time in seconds since job creation */
  age: number
  /** Seconds remaining until job is put in ready queue */
  delay: number
  /** Time to run in seconds */
  ttr: number
  /** Seconds until server puts job into ready queue (only meaningful if reserved/delayed) */
  timeLeft: number
  /** Binlog file number containing this job (0 if binlog disabled) */
  file: number
  /** Number of times job has been reserved */
  reserves: number
  /** Number of times job has timed out during reservation */
  timeouts: number
  /** Number of times job has been released */
  releases: number
  /** Number of times job has been buried */
  buries: number
  /** Number of times job has been kicked */
  kicks: number
}

/**
 * Stats for a specific tube
 */
export interface TubeStats {
  /** Tube name */
  name: string
  /** Number of ready jobs with priority < 1024 */
  currentJobsUrgent: number
  /** Number of jobs in ready queue */
  currentJobsReady: number
  /** Number of jobs reserved by all clients */
  currentJobsReserved: number
  /** Number of delayed jobs */
  currentJobsDelayed: number
  /** Number of buried jobs */
  currentJobsBuried: number
  /** Total jobs created in this tube */
  totalJobs: number
  /** Number of open connections using this tube */
  currentUsing: number
  /** Number of connections waiting on reserve */
  currentWaiting: number
  /** Number of connections watching this tube */
  currentWatching: number
  /** Seconds tube is paused for */
  pause: number
  /** Total delete commands for this tube */
  cmdDelete: number
  /** Total pause-tube commands for this tube */
  cmdPauseTube: number
  /** Seconds until tube is unpaused */
  pauseTimeLeft: number
}

/**
 * System-wide statistics
 */
export interface SystemStats {
  /** Number of ready jobs with priority < 1024 */
  currentJobsUrgent: number
  /** Number of jobs in ready queue */
  currentJobsReady: number
  /** Number of jobs reserved by all clients */
  currentJobsReserved: number
  /** Number of delayed jobs */
  currentJobsDelayed: number
  /** Number of buried jobs */
  currentJobsBuried: number
  /** Total put commands */
  cmdPut: number
  /** Total peek commands */
  cmdPeek: number
  /** Total peek-ready commands */
  cmdPeekReady: number
  /** Total peek-delayed commands */
  cmdPeekDelayed: number
  /** Total peek-buried commands */
  cmdPeekBuried: number
  /** Total reserve commands */
  cmdReserve: number
  /** Total reserve-with-timeout commands */
  cmdReserveWithTimeout: number
  /** Total touch commands */
  cmdTouch: number
  /** Total use commands */
  cmdUse: number
  /** Total watch commands */
  cmdWatch: number
  /** Total ignore commands */
  cmdIgnore: number
  /** Total delete commands */
  cmdDelete: number
  /** Total release commands */
  cmdRelease: number
  /** Total bury commands */
  cmdBury: number
  /** Total kick commands */
  cmdKick: number
  /** Total stats commands */
  cmdStats: number
  /** Total stats-job commands */
  cmdStatsJob: number
  /** Total stats-tube commands */
  cmdStatsTube: number
  /** Total list-tubes commands */
  cmdListTubes: number
  /** Total list-tube-used commands */
  cmdListTubeUsed: number
  /** Total list-tubes-watched commands */
  cmdListTubesWatched: number
  /** Total pause-tube commands */
  cmdPauseTube: number
  /** Total job timeouts */
  jobTimeouts: number
  /** Total jobs created */
  totalJobs: number
  /** Maximum job size in bytes */
  maxJobSize: number
  /** Number of currently existing tubes */
  currentTubes: number
  /** Number of currently open connections */
  currentConnections: number
  /** Number of open connections that have issued at least one put */
  currentProducers: number
  /** Number of open connections that have issued at least one reserve */
  currentWorkers: number
  /** Number of connections waiting on reserve */
  currentWaiting: number
  /** Total connections */
  totalConnections: number
  /** Process ID of server */
  pid: number
  /** Version string of server */
  version: string
  /** User CPU time of process */
  rusageUtime: number
  /** System CPU time of process */
  rusageStime: number
  /** Seconds since server started */
  uptime: number
  /** Index of oldest binlog file needed */
  binlogOldestIndex: number
  /** Index of current binlog file */
  binlogCurrentIndex: number
  /** Maximum binlog file size */
  binlogMaxSize: number
  /** Total records written to binlog */
  binlogRecordsWritten: number
  /** Total records migrated in binlog */
  binlogRecordsMigrated: number
  /** Whether server is in drain mode */
  draining: boolean
  /** Random ID of server process */
  id: string
  /** Server hostname */
  hostname: string
  /** Server OS version */
  os: string
  /** Server machine architecture */
  platform: string
}

/**
 * Options for releasing a job back to ready queue
 */
interface JackdReleaseOpts {
  /** New priority to assign to job */
  priority?: number
  /** Seconds to wait before putting job in ready queue */
  delay?: number
}

/**
 * Options for pausing a tube
 */
interface JackdPauseTubeOpts {
  /** Seconds to pause the tube for */
  delay?: number
}

type JackdPutArgs = [
  payload: Uint8Array | string | object,
  options?: JackdPutOpts
]
type JackdReleaseArgs = [jobId: number, options?: JackdReleaseOpts]
type JackdPauseTubeArgs = [tubeId: string, options?: JackdPauseTubeOpts]
type JackdJobArgs = [jobId: number]
type JackdTubeArgs = [tubeId: string]
type JackdBuryArgs = [jobId: number, priority?: number]

type JackdArgs =
  | JackdPutArgs
  | JackdReleaseArgs
  | JackdPauseTubeArgs
  | JackdJobArgs
  | JackdTubeArgs
  | never[]
  | number[]
  | string[]
  | [jobId: number, priority?: number]

/**
 * Client options
 */
export type JackdProps = {
  /** Whether to automatically connect to the server */
  autoconnect?: boolean
  /** Hostname of beanstalkd server */
  host?: string
  /** Port number, defaults to 11300 */
  port?: number
  /** Whether to automatically reconnect on connection loss */
  autoReconnect?: boolean
  /** Initial delay in ms between reconnection attempts */
  initialReconnectDelay?: number
  /** Maximum delay in ms between reconnection attempts */
  maxReconnectDelay?: number
  /** Maximum number of reconnection attempts (0 for infinite) */
  maxReconnectAttempts?: number
}

/**
 * Standardized error codes for Jackd operations
 */
export enum JackdErrorCode {
  /** Server out of memory */
  OUT_OF_MEMORY = "OUT_OF_MEMORY",
  /** Internal server error */
  INTERNAL_ERROR = "INTERNAL_ERROR",
  /** Bad command format */
  BAD_FORMAT = "BAD_FORMAT",
  /** Unknown command */
  UNKNOWN_COMMAND = "UNKNOWN_COMMAND",
  /** Job body not properly terminated */
  EXPECTED_CRLF = "EXPECTED_CRLF",
  /** Job larger than max-job-size */
  JOB_TOO_BIG = "JOB_TOO_BIG",
  /** Server in drain mode */
  DRAINING = "DRAINING",
  /** Timeout exceeded with no job */
  TIMED_OUT = "TIMED_OUT",
  /** Reserved job TTR expiring */
  DEADLINE_SOON = "DEADLINE_SOON",
  /** Resource not found */
  NOT_FOUND = "NOT_FOUND",
  /** Cannot ignore only watched tube */
  NOT_IGNORED = "NOT_IGNORED",
  /** Unexpected server response */
  INVALID_RESPONSE = "INVALID_RESPONSE",
  /** Socket is not connected */
  NOT_CONNECTED = "NOT_CONNECTED",
  /** Fatal connection error */
  FATAL_CONNECTION_ERROR = "FATAL_CONNECTION_ERROR"
}

/**
 * Custom error class for Jackd operations
 */
export class JackdError extends Error {
  /** Error code indicating the type of error */
  code: JackdErrorCode
  /** Raw response from server if available */
  response?: string

  constructor(code: JackdErrorCode, message?: string, response?: string) {
    super(message || code)
    this.code = code
    this.response = response
    this.name = "JackdError"
  }
}

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
  public socket: Socket = (() => {
    const socket = new Socket()
    socket.setKeepAlive(true)
    return socket
  })()
  public connected: boolean = false
  private buffer: Uint8Array = new Uint8Array()
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
  private commandTimeout: number = 10000 // 10 second timeout for commands
  private watchedTubes: Set<string> = new Set(["default"]) // Track watched tubes, default is always watched initially
  private currentTube: string = "default" // Track currently used tube

  // beanstalkd executes all commands serially. Because Node.js is single-threaded,
  // this allows us to queue up all of the messages and commands as they're invokved
  // without needing to explicitly wait for promises.
  messages: Uint8Array[] = []
  executions: CommandExecution<unknown>[] = []

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

    this.setupSocketListeners()

    if (autoconnect) {
      void this.connect()
    }
  }

  private setupSocketListeners() {
    this.socket.on("ready", () => {
      this.connected = true
      this.reconnectAttempts = 0
      this.currentReconnectDelay = this.initialReconnectDelay
      void this.rewatchTubes() // Rewatch tubes after reconnection
      void this.reuseTube() // Reuse tube after reconnection
    })

    this.socket.on("close", () => {
      if (this.connected) {
        // Only handle disconnection if we were previously connected
        this.handleDisconnect()
      }
    })

    this.socket.on("end", () => {
      // Remote peer closed the connection
      if (this.connected) {
        this.handleDisconnect()
      }
    })

    this.socket.on("error", (error: Error) => {
      console.error("Socket error:", error.message)

      if (this.connected) {
        this.handleDisconnect()
      }
    })

    // When we receive data from the socket, let's process it and put it in our
    // messages.
    this.socket.on("data", incoming => {
      // Write the incoming data onto the buffer
      const newBuffer = new Uint8Array(this.buffer.length + incoming.length)
      newBuffer.set(this.buffer)
      newBuffer.set(new Uint8Array(incoming), this.buffer.length)
      this.buffer = newBuffer
      void this.processChunk(this.buffer)
    })
  }

  private handleDisconnect() {
    this.connected = false

    // Reject any pending executions
    while (this.executions.length > 0) {
      const execution = this.executions.shift()
      if (execution) {
        execution.emitter.emit(
          "reject",
          new JackdError(JackdErrorCode.NOT_CONNECTED, "Connection lost")
        )
      }
    }

    // Clear any buffered messages
    this.messages = []
    this.buffer = new Uint8Array()
    this.chunkLength = 0

    if (this.autoReconnect && !this.isReconnecting) {
      void this.attemptReconnect()
    }
  }

  private attemptReconnect() {
    if (
      this.maxReconnectAttempts > 0 &&
      this.reconnectAttempts >= this.maxReconnectAttempts
    ) {
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
          // Clean up existing socket
          this.socket.removeAllListeners()
          this.socket.destroy()

          // Create a new socket instance
          this.socket = new Socket()
          this.socket.setKeepAlive(true)

          // Reset connection-related state
          this.buffer = new Uint8Array()
          this.chunkLength = 0

          // Set up socket listeners before connecting
          this.setupSocketListeners()

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

  async processChunk(head: Uint8Array) {
    let index = -1

    // If we're waiting on some bytes from a command...
    if (this.chunkLength > 0) {
      // ...subtract it from the remaining bytes.
      const remainingBytes = this.chunkLength - head.length

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
      this.chunkLength = 0
    } else {
      const delimiterBytes = new TextEncoder().encode(DELIMITER)
      index = findIndex(head, delimiterBytes)
    }

    if (index > -1) {
      this.messages.push(head.slice(0, index))

      // We have to start flushing executions as soon as we push messages. This is to avoid
      // instances where job payloads might contain line breaks. We let the downstream handlers
      // set the incoming bytes almost immediately.
      await this.flushExecutions()

      const tail = head.slice(index + DELIMITER.length)
      this.buffer = tail
      await this.processChunk(tail)
    }
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
        // Executions can have multiple handlers. This happens with messages that expect
        // data chunks after the initial response.
        while (handlers.length && this.messages.length) {
          const handler = handlers.shift()
          const message = this.messages.shift()!

          const result = await handler!(message)

          if (handlers.length === 0) {
            emitter.emit("resolve", result)

            // We modified the executions array by removing an element. Decrement the loop.
            this.executions.shift()
            i--

            break
          }
        }
      } catch (err) {
        emitter.emit("reject", err)

        // This execution is botched, don't hang the entire queue
        this.executions.shift()
        i--
      }
    }
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
      // Add a timeout to prevent hanging
      const timeoutId = setTimeout(() => {
        this.socket.removeListener("error", onError)
        reject(new Error("Connection timeout"))
      }, this.commandTimeout)

      const onError = (error: NodeJS.ErrnoException) => {
        clearTimeout(timeoutId)
        if (error.code === "EISCONN") {
          return resolve()
        }
        reject(error)
      }

      this.socket.once("error", onError)

      // Use once('ready') as an alternative way to detect successful connection
      this.socket.once("ready", () => {
        clearTimeout(timeoutId)
        resolve()
      })

      this.socket.connect(this.port, this.host, () => {
        clearTimeout(timeoutId)
        resolve()
      })
    })

    return this
  }

  write(buffer: Uint8Array) {
    assert(buffer)

    return new Promise<void>((resolve, reject) => {
      const tryWrite = () => {
        if (this.connected) {
          this.socket.write(buffer, err => (err ? reject(err) : resolve()))
          return
        }

        // If not connected and not already reconnecting, trigger reconnect
        if (!this.isReconnecting && this.autoReconnect) {
          void this.attemptReconnect()
        }

        // Set a timeout for the command
        const timeoutId = setTimeout(() => {
          const error = new JackdError(
            JackdErrorCode.FATAL_CONNECTION_ERROR,
            "Connection timeout - could not establish connection within timeout period"
          )
          error.stack = new Error().stack // Preserve the call stack
          reject(error)

          // Force all other commands to fail
          this.handleFatalError(error)
        }, this.commandTimeout)

        // Wait for connection or timeout
        this.socket.once("ready", () => {
          clearTimeout(timeoutId)
          this.socket.write(buffer, err => (err ? reject(err) : resolve()))
        })
      }

      void tryWrite()
    })
  }

  private handleFatalError(error: JackdError) {
    // Reject all pending executions
    while (this.executions.length > 0) {
      const execution = this.executions.shift()
      if (execution) {
        execution.emitter.emit("reject", error)
      }
    }

    // Clear state
    this.messages = []
    this.buffer = new Uint8Array()
    this.chunkLength = 0
    this.connected = false
    this.autoReconnect = false // Disable reconnection attempts

    // Destroy the socket
    this.socket.destroy()

    // Throw the error asynchronously to crash the process
    setTimeout(() => {
      throw error
    }, 0)
  }

  quit = async () => {
    if (!this.connected) return

    const waitForClose = new Promise<void>((resolve, reject) => {
      this.socket.once("close", resolve)
      this.socket.once("error", reject)
    })

    this.socket.end(new TextEncoder().encode("quit\r\n"))
    await waitForClose
  }

  close = this.quit
  disconnect = this.quit

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
      this.currentTube = tube // Track the current tube
      return new TextEncoder().encode(`use ${tube}\r\n`)
    },
    [
      buffer => {
        const ascii = validate(buffer)

        if (ascii.startsWith(USING)) {
          const [, tube] = ascii.split(" ")
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
    (tube: string) => {
      assert(tube)
      this.watchedTubes.add(tube) // Add tube to watched set when command is created
      return new TextEncoder().encode(`watch ${tube}\r\n`)
    },
    [
      (buffer: Uint8Array) => {
        const ascii = validate(buffer)

        if (ascii.startsWith(WATCHING)) {
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
    (tube: string) => {
      assert(tube)
      this.watchedTubes.delete(tube) // Remove tube from watched set when command is created
      return new TextEncoder().encode(`ignore ${tube}\r\n`)
    },
    [
      (buffer: Uint8Array) => {
        const ascii = validate(buffer, [NOT_IGNORED])

        if (ascii.startsWith(WATCHING)) {
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

  createCommandHandler<TArgs extends JackdArgs, TReturn>(
    commandStringFunction: (...args: TArgs) => Uint8Array,
    handlers: CommandHandler<TReturn | void>[]
  ): (...args: TArgs) => Promise<TReturn> {
    return async (...args) => {
      const commandString: Uint8Array = commandStringFunction.apply(this, args)
      await this.write(commandString)

      const emitter = new EventEmitter()

      this.executions.push({
        handlers: handlers.concat(),
        emitter
      })

      return await new Promise((resolve, reject) => {
        emitter.once("resolve", resolve)
        emitter.once("reject", reject)
      })
    }
  }
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
  if (errorCode) {
    throw new JackdError(errorCode as JackdErrorCode, ascii, ascii)
  }

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

const RESERVED = "RESERVED"
const INSERTED = "INSERTED"
const USING = "USING"
const TOUCHED = "TOUCHED"
const DELETED = "DELETED"
const BURIED = "BURIED"
const RELEASED = "RELEASED"
const NOT_FOUND = "NOT_FOUND"
const OUT_OF_MEMORY = "OUT_OF_MEMORY"
const INTERNAL_ERROR = "INTERNAL_ERROR"
const BAD_FORMAT = "BAD_FORMAT"
const UNKNOWN_COMMAND = "UNKNOWN_COMMAND"
const EXPECTED_CRLF = "EXPECTED_CRLF"
const JOB_TOO_BIG = "JOB_TOO_BIG"
const DRAINING = "DRAINING"
const TIMED_OUT = "TIMED_OUT"
const DEADLINE_SOON = "DEADLINE_SOON"
const FOUND = "FOUND"
const WATCHING = "WATCHING"
const NOT_IGNORED = "NOT_IGNORED"
const KICKED = "KICKED"
const PAUSED = "PAUSED"
const OK = "OK"
