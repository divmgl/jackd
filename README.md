# jackd

![Tests](https://github.com/divmgl/jackd/actions/workflows/test.yml/badge.svg)

Modern beanstalkd client for Node/Bun

## Quick start

```ts
import Jackd from "jackd"

const client = new Jackd()

// Publishing a job
await client.put({ greeting: "Hello!" })

// Consuming a job
const job = await client.reserve() // => { id: '1', payload: '{"greeting":"Hello!"}' }

// Process the job, then delete it
await client.delete(job.id)
```

## Installation

```bash
npm install jackd
yarn add jackd
pnpm add jackd
bun add jackd
```

## Why

Beanstalkd is a simple and blazing fast work queue. It's a great tool for building background job runners, pub/sub systems, and more.

Jackd is a modern Node/Bun client for Beanstalkd written in TypeScript. It has:

- A concise and easy to use API
- Full type safety
- Native `Promise` support
- A single dependency: `yaml`
- Protocol accuracy/completeness

If you don't have experience using Beanstalkd, it's a good idea to read [the Beanstalkd protocol](https://github.com/beanstalkd/beanstalkd/blob/master/doc/protocol.txt) before using this library.

## Documentation

### Putting Jobs

You can add jobs to Beanstalkd by using the `put` command, which accepts a payload and returns a job ID.

```ts
const jobId: number = await client.put({ foo: "bar" })
console.log(jobId) // => 1
```

Job payloads are byte arrays. Passing in a `Uint8Array` will send the payload as-is.

```ts
const jobId = await client.put([123, 123, 123])
```

You can also pass in a `String` or an `Object` and `jackd` will automatically convert these values into byte arrays.

```ts
const jobId = await client.put("my long running job") // TextEncoder.encode(string)
const jobId = await client.put({ foo: "bar" }) // TextEncoder.encode(JSON.stringify(object))
```

All jobs sent to beanstalkd have a priority, a delay, and TTR (time-to-run) specification. By default, all jobs are published with `0` priority, `0` delay, and `60` TTR, which means consumers will have 60 seconds to finish the job after reservation. You can override these defaults:

```ts
await client.put(
  { foo: "bar" },
  {
    delay: 2, // Two second delay
    priority: 10,
    ttr: 600 // Ten minute delay
  }
)
```

Jobs with lower priorities are handled first. Refer to [the protocol specs](https://github.com/beanstalkd/beanstalkd/blob/master/doc/protocol.txt#L126) for more information on job options.

### Reserving Jobs

You can receive jobs by using the `reserve` command:

```ts
// Get a job with string payload
const { id, payload } = await client.reserve()
console.log({ id, payload }) // => { id: '1', payload: 'Hello!' }

// Get a job with raw Uint8Array payload
const { id, payload } = await client.reserveRaw()
console.log({ id, payload }) // => { id: '1', payload: Uint8Array }
```

Job reservation is how beanstalkd implements work distribution. Once you've reserved a job, you can process it and then delete it:

```ts
const { id, payload } = await client.reserve()
// Do some long-running operation
await client.delete(id)
```

If you don't handle the job within 60s (which is the default TTR), the job will be released back into the queue.

If you passed in an object when putting the job, you'll need to parse the JSON string:

```js
const { id, payload } = await client.reserve()
const object = JSON.parse(payload)
```

Please keep in mind that reservation is a _blocking_ operation. This means that your script will stop executing until a job has been reserved.

### Tubes

Beanstalkd queues are called tubes. Clients send to and reserve jobs from tubes.

Clients keep a watchlist, which determines which tubes they'll reserve jobs from. By default, all clients "watch" the `default` tube. You can watch a new tube by using the `watch` command.

```ts
// Watch both the "default" and "awesome-tube" tubes
const numberOfTubesWatched = await client.watch("awesome-tube")
console.log(numberOfTubesWatched) // => 2
```

You can also ignore a tube by using the `ignore` command.

```ts
// Ignore the "default" tube so we'll only watch "awesome-tube"
const numberOfTubesWatched = await client.ignore("default")
console.log(numberOfTubesWatched) // => 1
```

> Note: attempting to ignore the only tube being watched will throw an exception.

While clients can watch more than one tube at once, they can only publish jobs to the tube they're currently "using". Clients by default use the `default` tube.

You can change the tube you're using with the `use` command.

```ts
const tubeName = await client.use("awesome-tube")
console.log(tubeName) // => 'awesome-tube'

await client.put({ foo: "bar" }) // This job will be published to "awesome-tube" rather than "default"
```

### Job management

The most common operation after processing a job is deleting it:

```ts
await client.delete(id)
```

However, there are other things you can do with a job. For instance, you can release it back into the queue if you can't process it right now:

```ts
// Release immediately with high priority (0) and no delay (0)
await client.release(id)

// You can also specify the priority and the delay
await client.release(id, { priority: 10, delay: 10 })
```

Sometimes a job can't be processed, for whatever reason. A common example of this is when a job continues to fail over and over.

You can bury the job so it can be processed again later:

```ts
await client.bury(id)
// ... some time later ...
await client.kickJob(id)
```

The `kickJob` command is a convenience method for kicking a specific job on the currently used tube into the ready queue.

You can kick multiple buried jobs at once:

```ts
await client.kick(10) // 10 buried jobs will be moved to a ready state
```

Sometimes a job is taking too long to process, but you're making progress. You can extend the time you have to process a job by touching it:

```ts
await client.touch(id)
```

This lets Beanstalkd know that you're still working on the job.

### Statistics

Beanstalkd has a number of commands that returns statistics.

For instance, the `stats` command returns details regarding the current Beanstalkd instance:

```js
const stats = await client.stats()
console.log(stats)
/* =>
{
  currentJobsUrgent: 0,
  currentJobsReady: 0,
  currentJobsReserved: 0,
  currentJobsDelayed: 0,
  currentJobsBuried: 0,
  ...
}
*/
```

You can also get statistics for a specific tube:

```ts
const stats = await client.statsTube("awesome-tube")
console.log(stats)
/* =>
{
  name: "awesome-tube",
  currentJobsUrgent: 0,
  currentJobsReady: 0,
  currentJobsReserved: 0,
  currentJobsDelayed: 0,
  currentJobsBuried: 0,
  ...
}
*/
```

Or statistics for a specific job:

```ts
const stats = await client.statsJob(id)
console.log(stats)
/* =>
{
  id: "1",
  tube: "awesome-tube",
  state: "ready",
  ...
}
*/
```

### Workers

You may be looking to design a process that does nothing else but consume jobs. Here's an example implementation.

```ts
/* consumer.ts */
import Jackd from "jackd"

const client = new Jackd()

void start()

async function start() {
  while (true) {
    try {
      const { id, payload } = await client.reserve()
      /* ... process job here ... */
      await client.delete(id)
    } catch (err) {
      // Capture error somehow
      console.error(err)
    }
  }

  process.exit(0)
}
```

This process will run indefinitely, consuming jobs and processing them.

## License

MIT
