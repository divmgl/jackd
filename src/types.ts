import type EventEmitter from "events"

export const DELIMITER = "\r\n"

export type JackdPayload = Uint8Array | string | object

/**
 * Handler for processing command responses
 */
export type CommandHandler<T> = (
  chunk: Uint8Array,
  command: Uint8Array
) => T | Promise<T>

/**
 * Command execution state
 */
export type CommandExecution<T> = {
  command: Uint8Array
  /** Handlers for processing command response */
  handlers: CommandHandler<T | void>[]
  emitter: EventEmitter
  written: boolean
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
export interface JackdReleaseOpts {
  /** New priority to assign to job */
  priority?: number
  /** Seconds to wait before putting job in ready queue */
  delay?: number
}

/**
 * Options for pausing a tube
 */
export interface JackdPauseTubeOpts {
  /** Seconds to pause the tube for */
  delay?: number
}

export type JackdPutArgs = [
  payload: Uint8Array | string | object,
  options?: JackdPutOpts
]
export type JackdReleaseArgs = [jobId: number, options?: JackdReleaseOpts]
export type JackdPauseTubeArgs = [tubeId: string, options?: JackdPauseTubeOpts]
export type JackdJobArgs = [jobId: number]
export type JackdTubeArgs = [tubeId: string]
export type JackdBuryArgs = [jobId: number, priority?: number]

export type JackdArgs =
  | JackdPutArgs
  | JackdReleaseArgs
  | JackdPauseTubeArgs
  | JackdJobArgs
  | JackdTubeArgs
  | JackdBuryArgs
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

export const RESERVED = "RESERVED"
export const INSERTED = "INSERTED"
export const USING = "USING"
export const TOUCHED = "TOUCHED"
export const DELETED = "DELETED"
export const BURIED = "BURIED"
export const RELEASED = "RELEASED"
export const NOT_FOUND = "NOT_FOUND"
export const OUT_OF_MEMORY = "OUT_OF_MEMORY"
export const INTERNAL_ERROR = "INTERNAL_ERROR"
export const BAD_FORMAT = "BAD_FORMAT"
export const UNKNOWN_COMMAND = "UNKNOWN_COMMAND"
export const EXPECTED_CRLF = "EXPECTED_CRLF"
export const JOB_TOO_BIG = "JOB_TOO_BIG"
export const DRAINING = "DRAINING"
export const TIMED_OUT = "TIMED_OUT"
export const DEADLINE_SOON = "DEADLINE_SOON"
export const FOUND = "FOUND"
export const WATCHING = "WATCHING"
export const NOT_IGNORED = "NOT_IGNORED"
export const KICKED = "KICKED"
export const PAUSED = "PAUSED"
export const OK = "OK"
