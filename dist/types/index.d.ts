import { Socket } from "net";
import EventEmitter from "events";
/**
 * Handler for processing command responses
 */
export type CommandHandler<T> = (chunk: Uint8Array) => T | Promise<T>;
/**
 * Command execution state
 */
export declare class CommandExecution<T> {
    /** Handlers for processing command response */
    handlers: CommandHandler<T | void>[];
    /** Event emitter for command completion */
    emitter: EventEmitter;
}
/**
 * Options for putting a job into a tube
 */
export interface JackdPutOpts {
    /** Priority value between 0 and 2**32. Jobs with smaller priority values will be scheduled before jobs with larger priorities. 0 is most urgent. */
    priority?: number;
    /** Number of seconds to wait before putting the job in the ready queue. Job will be in "delayed" state during this time. Maximum is 2**32-1. */
    delay?: number;
    /** Time to run - number of seconds to allow a worker to run this job. Minimum is 1. If 0 is provided, server will use 1. Maximum is 2**32-1. */
    ttr?: number;
}
/**
 * Raw job data returned from reserveRaw
 */
export interface JackdJobRaw {
    /** Unique job ID for this instance of beanstalkd */
    id: number;
    /** Raw job payload as bytes */
    payload: Uint8Array;
}
/**
 * Job data with decoded string payload
 */
export interface JackdJob {
    /** Unique job ID for this instance of beanstalkd */
    id: number;
    /** Job payload decoded as UTF-8 string */
    payload: string;
}
/**
 * Stats for a specific job
 */
export interface JobStats {
    /** Job ID */
    id: number;
    /** Name of tube containing this job */
    tube: string;
    /** Current state of the job */
    state: "ready" | "delayed" | "reserved" | "buried";
    /** Priority value set by put/release/bury */
    pri: number;
    /** Time in seconds since job creation */
    age: number;
    /** Seconds remaining until job is put in ready queue */
    delay: number;
    /** Time to run in seconds */
    ttr: number;
    /** Seconds until server puts job into ready queue (only meaningful if reserved/delayed) */
    timeLeft: number;
    /** Binlog file number containing this job (0 if binlog disabled) */
    file: number;
    /** Number of times job has been reserved */
    reserves: number;
    /** Number of times job has timed out during reservation */
    timeouts: number;
    /** Number of times job has been released */
    releases: number;
    /** Number of times job has been buried */
    buries: number;
    /** Number of times job has been kicked */
    kicks: number;
}
/**
 * Stats for a specific tube
 */
export interface TubeStats {
    /** Tube name */
    name: string;
    /** Number of ready jobs with priority < 1024 */
    currentJobsUrgent: number;
    /** Number of jobs in ready queue */
    currentJobsReady: number;
    /** Number of jobs reserved by all clients */
    currentJobsReserved: number;
    /** Number of delayed jobs */
    currentJobsDelayed: number;
    /** Number of buried jobs */
    currentJobsBuried: number;
    /** Total jobs created in this tube */
    totalJobs: number;
    /** Number of open connections using this tube */
    currentUsing: number;
    /** Number of connections waiting on reserve */
    currentWaiting: number;
    /** Number of connections watching this tube */
    currentWatching: number;
    /** Seconds tube is paused for */
    pause: number;
    /** Total delete commands for this tube */
    cmdDelete: number;
    /** Total pause-tube commands for this tube */
    cmdPauseTube: number;
    /** Seconds until tube is unpaused */
    pauseTimeLeft: number;
}
/**
 * System-wide statistics
 */
export interface SystemStats {
    /** Number of ready jobs with priority < 1024 */
    currentJobsUrgent: number;
    /** Number of jobs in ready queue */
    currentJobsReady: number;
    /** Number of jobs reserved by all clients */
    currentJobsReserved: number;
    /** Number of delayed jobs */
    currentJobsDelayed: number;
    /** Number of buried jobs */
    currentJobsBuried: number;
    /** Total put commands */
    cmdPut: number;
    /** Total peek commands */
    cmdPeek: number;
    /** Total peek-ready commands */
    cmdPeekReady: number;
    /** Total peek-delayed commands */
    cmdPeekDelayed: number;
    /** Total peek-buried commands */
    cmdPeekBuried: number;
    /** Total reserve commands */
    cmdReserve: number;
    /** Total reserve-with-timeout commands */
    cmdReserveWithTimeout: number;
    /** Total touch commands */
    cmdTouch: number;
    /** Total use commands */
    cmdUse: number;
    /** Total watch commands */
    cmdWatch: number;
    /** Total ignore commands */
    cmdIgnore: number;
    /** Total delete commands */
    cmdDelete: number;
    /** Total release commands */
    cmdRelease: number;
    /** Total bury commands */
    cmdBury: number;
    /** Total kick commands */
    cmdKick: number;
    /** Total stats commands */
    cmdStats: number;
    /** Total stats-job commands */
    cmdStatsJob: number;
    /** Total stats-tube commands */
    cmdStatsTube: number;
    /** Total list-tubes commands */
    cmdListTubes: number;
    /** Total list-tube-used commands */
    cmdListTubeUsed: number;
    /** Total list-tubes-watched commands */
    cmdListTubesWatched: number;
    /** Total pause-tube commands */
    cmdPauseTube: number;
    /** Total job timeouts */
    jobTimeouts: number;
    /** Total jobs created */
    totalJobs: number;
    /** Maximum job size in bytes */
    maxJobSize: number;
    /** Number of currently existing tubes */
    currentTubes: number;
    /** Number of currently open connections */
    currentConnections: number;
    /** Number of open connections that have issued at least one put */
    currentProducers: number;
    /** Number of open connections that have issued at least one reserve */
    currentWorkers: number;
    /** Number of connections waiting on reserve */
    currentWaiting: number;
    /** Total connections */
    totalConnections: number;
    /** Process ID of server */
    pid: number;
    /** Version string of server */
    version: string;
    /** User CPU time of process */
    rusageUtime: number;
    /** System CPU time of process */
    rusageStime: number;
    /** Seconds since server started */
    uptime: number;
    /** Index of oldest binlog file needed */
    binlogOldestIndex: number;
    /** Index of current binlog file */
    binlogCurrentIndex: number;
    /** Maximum binlog file size */
    binlogMaxSize: number;
    /** Total records written to binlog */
    binlogRecordsWritten: number;
    /** Total records migrated in binlog */
    binlogRecordsMigrated: number;
    /** Whether server is in drain mode */
    draining: boolean;
    /** Random ID of server process */
    id: string;
    /** Server hostname */
    hostname: string;
    /** Server OS version */
    os: string;
    /** Server machine architecture */
    platform: string;
}
/**
 * Options for releasing a job back to ready queue
 */
interface JackdReleaseOpts {
    /** New priority to assign to job */
    priority?: number;
    /** Seconds to wait before putting job in ready queue */
    delay?: number;
}
/**
 * Options for pausing a tube
 */
interface JackdPauseTubeOpts {
    /** Seconds to pause the tube for */
    delay?: number;
}
type JackdPutArgs = [
    payload: Uint8Array | string | object,
    options?: JackdPutOpts
];
type JackdReleaseArgs = [jobId: number, options?: JackdReleaseOpts];
type JackdPauseTubeArgs = [tubeId: string, options?: JackdPauseTubeOpts];
type JackdJobArgs = [jobId: number];
type JackdTubeArgs = [tubeId: string];
type JackdArgs = JackdPutArgs | JackdReleaseArgs | JackdPauseTubeArgs | JackdJobArgs | JackdTubeArgs | never[] | number[] | string[] | [jobId: number, priority?: number];
/**
 * Client options
 */
export type JackdProps = {
    /** Whether to automatically connect to the server */
    autoconnect?: boolean;
    /** Hostname of beanstalkd server */
    host?: string;
    /** Port number, defaults to 11300 */
    port?: number;
};
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
export declare class JackdClient {
    socket: Socket;
    connected: boolean;
    private buffer;
    private chunkLength;
    private host;
    private port;
    messages: Uint8Array[];
    executions: CommandExecution<unknown>[];
    constructor({ autoconnect, host, port }?: JackdProps);
    private setupSocketListeners;
    processChunk(head: Uint8Array): Promise<void>;
    flushExecutions(): Promise<void>;
    /**
     * For environments where network partitioning is common.
     * @returns {Boolean}
     */
    isConnected(): boolean;
    connect(): Promise<this>;
    write(buffer: Uint8Array): Promise<void>;
    quit: () => Promise<void>;
    close: () => Promise<void>;
    disconnect: () => Promise<void>;
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
    put: (payload: string | object | Uint8Array<ArrayBufferLike>, options?: JackdPutOpts | undefined) => Promise<number>;
    /**
     * Changes the tube used for subsequent put commands
     * @param tube Tube name (max 200 bytes). Created if doesn't exist.
     * @returns Name of tube now being used
     */
    use: (tubeId: string) => Promise<string>;
    createReserveHandlers<T extends JackdJob | JackdJobRaw>(additionalResponses?: Array<string>, decodePayload?: boolean): [CommandHandler<void>, CommandHandler<T>];
    /**
     * Reserves a job from any watched tube
     * @returns Reserved job with string payload
     * @throws {Error} DEADLINE_SOON if reserved job TTR expiring
     * @throws {Error} TIMED_OUT if timeout exceeded with no job
     */
    reserve: () => Promise<JackdJob>;
    /**
     * Reserves a job with raw byte payload
     * @returns Reserved job with raw payload
     * @throws {Error} DEADLINE_SOON if reserved job TTR expiring
     * @throws {Error} TIMED_OUT if timeout exceeded with no job
     */
    reserveRaw: () => Promise<JackdJobRaw>;
    /**
     * Reserves a job with timeout
     * @param seconds Max seconds to wait. 0 returns immediately.
     * @returns Reserved job
     * @throws {Error} DEADLINE_SOON if reserved job TTR expiring
     * @throws {Error} TIMED_OUT if timeout exceeded with no job
     */
    reserveWithTimeout: (args_0: number) => Promise<JackdJob>;
    /**
     * Reserves a specific job by ID
     * @param id Job ID to reserve
     * @returns Reserved job
     * @throws {Error} NOT_FOUND if job doesn't exist or not reservable
     */
    reserveJob: (args_0: number) => Promise<JackdJob>;
    /**
     * Deletes a job
     * @param id Job ID to delete
     * @throws {Error} NOT_FOUND if job doesn't exist or not deletable
     */
    delete: (jobId: number) => Promise<void>;
    /**
     * Releases a reserved job back to ready queue
     * @param id Job ID to release
     * @param options New priority and delay
     * @throws {Error} BURIED if server out of memory
     * @throws {Error} NOT_FOUND if job doesn't exist or not reserved by this client
     */
    release: (jobId: number, options?: JackdReleaseOpts | undefined) => Promise<void>;
    /**
     * Buries a job
     * @param id Job ID to bury
     * @param priority New priority
     * @throws {Error} NOT_FOUND if job doesn't exist or not reserved by this client
     */
    bury: (jobId: number, priority?: number | undefined) => Promise<void>;
    /**
     * Touches a reserved job, requesting more time to work on it
     * @param id Job ID to touch
     * @throws {Error} NOT_FOUND if job doesn't exist or not reserved by this client
     */
    touch: (jobId: number) => Promise<void>;
    /**
     * Adds tube to watch list for reserve commands
     * @param tube Tube name to watch (max 200 bytes)
     * @returns Number of tubes now being watched
     */
    watch: (tubeId: string) => Promise<number>;
    /**
     * Removes tube from watch list
     * @param tube Tube name to ignore
     * @returns Number of tubes now being watched
     * @throws {Error} NOT_IGNORED if trying to ignore only watched tube
     */
    ignore: (tubeId: string) => Promise<number>;
    /**
     * Pauses new job reservations in a tube
     * @param tube Tube name to pause
     * @param delay Seconds to pause for
     * @throws {Error} NOT_FOUND if tube doesn't exist
     */
    pauseTube: (tubeId: string, options?: JackdPauseTubeOpts | undefined) => Promise<void>;
    /**
     * Peeks at a specific job
     * @param id Job ID to peek at
     * @returns Job data if found
     * @throws {Error} NOT_FOUND if job doesn't exist
     */
    peek: (jobId: number) => Promise<JackdJob>;
    createPeekHandlers(): [CommandHandler<void>, CommandHandler<JackdJob>];
    /**
     * Peeks at the next ready job in the currently used tube
     * @returns Job data if found
     * @throws {Error} NOT_FOUND if no ready jobs
     */
    peekReady: () => Promise<JackdJob>;
    /**
     * Peeks at the delayed job with shortest delay in currently used tube
     * @returns Job data if found
     * @throws {Error} NOT_FOUND if no delayed jobs
     */
    peekDelayed: () => Promise<JackdJob>;
    /**
     * Peeks at the next buried job in currently used tube
     * @returns Job data if found
     * @throws {Error} NOT_FOUND if no buried jobs
     */
    peekBuried: () => Promise<JackdJob>;
    /**
     * Kicks at most bound jobs from buried to ready queue in currently used tube
     * @param bound Maximum number of jobs to kick
     * @returns Number of jobs actually kicked
     */
    kick: (jobsCount: number) => Promise<number>;
    /**
     * Kicks a specific buried or delayed job into ready queue
     * @param id Job ID to kick
     * @throws {Error} NOT_FOUND if job doesn't exist or not in kickable state
     */
    kickJob: (jobId: number) => Promise<void>;
    /**
     * Gets statistical information about a job
     * @param id Job ID
     * @returns Job statistics
     * @throws {Error} NOT_FOUND if job doesn't exist
     */
    statsJob: (jobId: number) => Promise<JobStats>;
    /**
     * Gets statistical information about a tube
     * @param tube Tube name
     * @returns Tube statistics
     * @throws {Error} NOT_FOUND if tube doesn't exist
     */
    statsTube: (tubeId: string) => Promise<TubeStats>;
    /**
     * Gets statistical information about the system
     * @returns System statistics
     */
    stats: () => Promise<SystemStats>;
    /**
     * Lists all existing tubes
     * @returns Array of tube names
     */
    listTubes: () => Promise<string[]>;
    /**
     * Lists tubes being watched by current connection
     * @returns Array of watched tube names
     */
    listTubesWatched: () => Promise<string[]>;
    /**
     * Returns the tube currently being used by client
     * @returns Name of tube being used
     */
    listTubeUsed: () => Promise<string>;
    createCommandHandler<TArgs extends JackdArgs, TReturn>(commandStringFunction: (...args: TArgs) => Uint8Array, handlers: CommandHandler<TReturn | void>[]): (...args: TArgs) => Promise<TReturn>;
}
export default JackdClient;
export declare class InvalidResponseError extends Error {
    response: string;
}
