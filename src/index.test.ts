import Jackd, { JackdError, JackdErrorCode } from "./index"
import crypto from "crypto"
import { describe, it, expect, beforeEach, afterEach } from "bun:test"

describe("jackd", () => {
  let client: Jackd

  it("can connect to and disconnect from beanstalkd", async () => {
    const c = new Jackd()
    await c.connect()
    await c.close()
  })

  describe("connectivity", () => {
    setupTestSuiteLifecycleWithClient()

    it("connected", () => {
      expect(client.connected).toBeTruthy()
    })

    it("disconnected", async () => {
      await client.disconnect()
      expect(client.connected).toBeFalsy()
    })

    it("queues commands when not connected and executes them on connect", async () => {
      const client = new Jackd({ autoconnect: false })
      expect(client.connected).toBeFalsy()

      // Queue up a command
      const putPromise = client.put("test message")

      // Connect after queueing
      await client.connect()

      // Command should complete and return job id
      const id = await putPromise
      expect(id).toBeDefined()

      // Cleanup
      await client.delete(id)
      await client.close()
    })

    it("maintains tube watching state across reconnections", async () => {
      // Create a new client with autoReconnect enabled and shorter timeout
      const client = new Jackd({
        autoReconnect: true,
        initialReconnectDelay: 100 // Faster reconnect for test
      })
      await client.connect()

      // Watch new tubes before ignoring default
      await client.watch("tube1")
      await client.watch("tube2")
      // Now we can safely ignore default since we're watching other tubes
      await client.ignore("default")

      // Get initial list of watched tubes
      const initialWatched = await client.listTubesWatched()
      expect(initialWatched).toContain("tube1")
      expect(initialWatched).toContain("tube2")
      expect(initialWatched).not.toContain("default")
      expect(initialWatched.length).toBe(2) // Should be exactly these two tubes

      // Verify the internal state
      // @ts-expect-error: testing private property
      const internalWatchedTubes = Array.from(client.watchedTubes)
      expect(internalWatchedTubes).toContain("tube1")
      expect(internalWatchedTubes).toContain("tube2")
      expect(internalWatchedTubes).not.toContain("default")
      expect(internalWatchedTubes.length).toBe(2) // Should be exactly these two tubes

      // Force a disconnect by destroying the socket
      client.socket.destroy()

      // Wait a bit for reconnection
      await new Promise(resolve => setTimeout(resolve, 500)) // Shorter wait

      // Verify connection status
      if (!client.connected) {
        try {
          await client.connect()
        } catch (error) {
          console.error("Manual connect failed:", error)
          // Ignore connection errors as we're testing reconnect behavior
        }
      }

      // Verify the internal state after reconnection
      // @ts-expect-error: testing private property
      const reconnectedInternalWatchedTubes = Array.from(client.watchedTubes)
      expect(reconnectedInternalWatchedTubes).toEqual(internalWatchedTubes)

      // Cleanup
      await client.close()
    })
  })

  describe("producers", () => {
    setupTestSuiteLifecycleWithClient()

    it("can insert jobs", async () => {
      let id

      try {
        id = await client.put("some random job")
        expect(id).toBeDefined()
      } finally {
        if (id) await client.delete(id)
      }
    })

    it("can insert jobs with objects", async () => {
      let id: number | undefined

      try {
        id = await client.put({ foo: "bar" })
        expect(id).toBeDefined()

        const job = await client.reserve()
        expect(job.payload).toEqual('{"foo":"bar"}')
      } finally {
        if (id !== undefined) await client.delete(id)
      }
    })

    it("can insert jobs with priority", async () => {
      let id

      try {
        id = await client.put({ foo: "bar" }, { priority: 12342342 })
        expect(id).toBeDefined()

        const job = await client.reserve()
        expect(job.payload).toEqual('{"foo":"bar"}')
      } finally {
        if (id) await client.delete(id)
      }
    })
  })

  describe("consumers", () => {
    setupTestSuiteLifecycleWithClient()

    it("can reserve jobs", async () => {
      let id: number | undefined

      try {
        id = await client.put("some random job")
        const job = await client.reserve()

        expect(job.id).toEqual(id)
        expect(job.payload).toEqual("some random job")
      } finally {
        if (id !== undefined) await client.delete(id)
      }
    })

    it("can reserve jobs with raw payload", async () => {
      let id: number | undefined

      try {
        const testString = "some random job"
        id = await client.put(testString)
        const job = await client.reserveRaw()

        expect(job.id).toEqual(id)
        expect(new TextDecoder().decode(job.payload)).toEqual(testString)
      } finally {
        if (id !== undefined) await client.delete(id)
      }
    })

    it("can reserve delayed jobs", async () => {
      let id

      try {
        id = await client.put("some random job", {
          delay: 1
        })

        const job = await client.reserve()

        expect(job.id).toEqual(id)
        expect(job.payload).toEqual("some random job")
      } finally {
        if (id) await client.delete(id)
      }
    })

    it("can reserve jobs by id", async () => {
      let id: number | undefined

      try {
        id = await client.put("some random job", {
          delay: 1
        })

        const job = await client.reserveJob(id)
        expect(job.payload).toEqual("some random job")
      } finally {
        if (id !== undefined) await client.delete(id)
      }
    })

    it("handles not found", async () => {
      let error: unknown
      try {
        await client.reserveJob(4)
      } catch (err) {
        error = err
      }
      expect(error).toBeInstanceOf(JackdError)
      const jackdError = error as JackdError
      expect(jackdError.code).toBe(JackdErrorCode.NOT_FOUND)
    })

    it("can insert and process jobs on a different tube", async () => {
      let id
      try {
        await client.use("some-other-tube")
        id = await client.put("some random job on another tube")

        await client.watch("some-other-tube")
        const job = await client.reserve()

        expect(job.id).toEqual(id)
        expect(job.payload).toEqual("some random job on another tube")
      } finally {
        if (id) await client.delete(id)
      }
    })

    it("will ignore jobs from default", async () => {
      let id, defaultId
      try {
        defaultId = await client.put("job on default")
        await client.use("some-other-tube")
        id = await client.put("some random job on another tube")

        await client.watch("some-other-tube")
        await client.ignore("default")

        const job = await client.reserve()

        expect(job.id).toEqual(id)
        expect(job.payload).toEqual("some random job on another tube")
      } finally {
        if (id) await client.delete(id)
        if (defaultId) await client.delete(defaultId)
      }
    })

    it("handles multiple promises fired at once", async () => {
      let id1, id2

      try {
        await client.use("some-tube")
        const firstJobPromise = client.put("some-job")
        await client.watch("some-random-tube")
        await client.use("some-another-tube")
        const secondJobPromise = client.put("some-job")

        id1 = await firstJobPromise
        id2 = await secondJobPromise
      } finally {
        if (id1) await client.delete(id1)
        if (id2) await client.delete(id2)
      }
    })

    it("can receive huge jobs", async () => {
      let id

      try {
        // job larger than a socket data frame
        const hugeText =
          crypto.randomBytes(15000).toString("hex") +
          "\r\n" +
          crypto.randomBytes(15000).toString("hex")

        id = await client.put(hugeText)
        const job = await client.reserve()

        expect(job.id).toEqual(id)
        expect(job.payload).toEqual(hugeText)
      } finally {
        if (id) await client.delete(id)
      }
    })

    it("can peek buried jobs", async () => {
      let id: number | undefined

      try {
        await client.use("some-tube")

        id = await client.put("some-job")

        await client.watch("some-tube")
        await client.reserve()
        await client.bury(id)

        const job = await client.peekBuried()

        expect(job.id).toEqual(id)
      } finally {
        if (id) await client.delete(id)
      }
    })
  })

  describe("stats", () => {
    setupTestSuiteLifecycleWithClient()

    it("brings back stats", async () => {
      const stats = await client.stats()
      // Verify numeric fields
      expect(typeof stats.currentJobsReady).toBe("number")
      expect(typeof stats.totalJobs).toBe("number")
      expect(typeof stats.currentConnections).toBe("number")
      expect(typeof stats.pid).toBe("number")
      expect(typeof stats.uptime).toBe("number")
      // Verify string fields
      expect(typeof stats.version).toBe("string")
      expect(typeof stats.hostname).toBe("string")
      expect(typeof stats.os).toBe("string")
      // Verify boolean field
      expect(typeof stats.draining).toBe("boolean")
    })

    it("brings back job stats", async () => {
      let id: number | undefined
      try {
        id = await client.put("test job")
        const stats = await client.statsJob(id)
        // Verify numeric fields
        expect(typeof stats.id).toBe("number")
        expect(stats.id).toBe(id)
        // Verify string fields
        expect(typeof stats.tube).toBe("string")
        expect(stats.tube).toBe("default")
        expect(typeof stats.state).toBe("string")
        expect(["ready", "delayed", "reserved", "buried"]).toContain(
          stats.state
        )
        // Verify numeric fields
        expect(typeof stats.pri).toBe("number")
        expect(typeof stats.age).toBe("number")
        expect(typeof stats.delay).toBe("number")
        expect(typeof stats.ttr).toBe("number")
        expect(typeof stats.timeLeft).toBe("number")
        expect(typeof stats.reserves).toBe("number")
        expect(typeof stats.timeouts).toBe("number")
        expect(typeof stats.releases).toBe("number")
        expect(typeof stats.buries).toBe("number")
        expect(typeof stats.kicks).toBe("number")
      } finally {
        if (id !== undefined) await client.delete(id)
      }
    })

    it("brings back tube stats", async () => {
      const stats = await client.statsTube("default")
      // Verify string field
      expect(typeof stats.name).toBe("string")
      expect(stats.name).toBe("default")
      // Verify numeric fields
      expect(typeof stats.currentJobsUrgent).toBe("number")
      expect(typeof stats.currentJobsReady).toBe("number")
      expect(typeof stats.currentJobsReserved).toBe("number")
      expect(typeof stats.currentJobsDelayed).toBe("number")
      expect(typeof stats.currentJobsBuried).toBe("number")
      expect(typeof stats.totalJobs).toBe("number")
      expect(typeof stats.currentUsing).toBe("number")
      expect(typeof stats.currentWaiting).toBe("number")
      expect(typeof stats.currentWatching).toBe("number")
      expect(typeof stats.pause).toBe("number")
      expect(typeof stats.cmdDelete).toBe("number")
      expect(typeof stats.cmdPauseTube).toBe("number")
      expect(typeof stats.pauseTimeLeft).toBe("number")
    })

    it("brings back list of tubes", async () => {
      const tubes = await client.listTubes()
      expect(tubes).toContain("default")
      expect(Array.isArray(tubes)).toBe(true)
    })

    it("brings back list of watched tubes", async () => {
      // First verify we start with just default
      const initialTubes = await client.listTubesWatched()
      expect(initialTubes).toContain("default")
      expect(initialTubes.length).toBe(1)

      // Watch should return the number of tubes being watched
      const watchCount = await client.watch("test-tube")
      expect(watchCount).toBe(2) // Should be watching 2 tubes now

      // Now check the list
      const tubes = await client.listTubesWatched()
      expect(tubes).toContain("default")
      expect(tubes).toContain("test-tube")
      expect(tubes.length).toBe(2)
      expect(Array.isArray(tubes)).toBe(true)
    })

    it("brings back current tube", async () => {
      expect(await client.listTubeUsed()).toBe("default")
      await client.use("test-tube")
      expect(await client.listTubeUsed()).toBe("test-tube")
    })
  })

  describe("bugfixes", () => {
    setupTestSuiteLifecycleWithClient()

    it("can receive jobs with new lines jobs", async () => {
      let id

      try {
        // job larger than a socket data frame
        const payload = "this job should not fail!\r\n"

        id = await client.put(payload)
        const job = await client.reserve()

        expect(job.id).toEqual(id)
        expect(job.payload).toEqual(payload)
      } finally {
        if (id) await client.delete(id)
      }
    })

    it("can continue execution after bad command", async () => {
      let id
      let error: unknown

      try {
        // Bad command
        // @ts-expect-error We're testing the error handling
        await client.delete("nonexistent job")
      } catch (err) {
        error = err
      }
      expect(error).toBeInstanceOf(JackdError)
      const jackdError = error as JackdError
      expect(jackdError.code).toBe(JackdErrorCode.BAD_FORMAT)

      try {
        id = await client.put("my awesome job")
      } finally {
        if (id) await client.delete(id)
      }
    })
  })

  function setupTestSuiteLifecycleWithClient() {
    beforeEach(async () => {
      client = new Jackd()
      await client.connect()
    })

    afterEach(async () => {
      await client.close()
    })
  }
})
