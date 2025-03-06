import { Socket } from "net";
import { type JackdProps } from "./types";
import type { CommandHandler, JackdArgs, JackdJob, JackdJobRaw, JackdPutOpts, JobStats, SystemStats, TubeStats } from "./types";
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
    private chunkLength;
    private host;
    private port;
    private autoReconnect;
    private initialReconnectDelay;
    private maxReconnectDelay;
    private maxReconnectAttempts;
    private reconnectAttempts;
    private currentReconnectDelay;
    private reconnectTimeout?;
    private isReconnecting;
    private watchedTubes;
    private currentTube;
    private executions;
    private buffer;
    private commandBuffer;
    private isProcessing;
    constructor({ autoconnect, host, port, autoReconnect, initialReconnectDelay, maxReconnectDelay, maxReconnectAttempts }?: JackdProps);
    private createSocket;
    private handleDisconnect;
    private attemptReconnect;
    /**
     * For environments where network partitioning is common.
     * @returns {Boolean}
     */
    isConnected(): boolean;
    connect(): Promise<this>;
    /**
     * Rewatches all previously watched tubes after a reconnection
     * If default is not in the watched tubes list, ignores it
     */
    private rewatchTubes;
    /**
     * Reuses the previously used tube after a reconnection
     */
    private reuseTube;
    quit: () => Promise<void>;
    close: () => Promise<void>;
    disconnect: () => Promise<void>;
    createCommandHandler<TArgs extends JackdArgs, TReturn>(commandStringFunction: (...args: TArgs) => Uint8Array, handlers: CommandHandler<TReturn | void>[]): (...args: TArgs) => Promise<TReturn>;
    private processNextCommand;
    private write;
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
    release: (jobId: number, options?: import("./types").JackdReleaseOpts | undefined) => Promise<void>;
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
    pauseTube: (tubeId: string, options?: import("./types").JackdPauseTubeOpts | undefined) => Promise<void>;
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
}
export default JackdClient;
