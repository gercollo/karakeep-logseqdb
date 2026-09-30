import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AutoSyncScheduler } from '../src/scheduler'

function fakeTimers() {
  let id = 0
  const timers = new Map<number, { run: () => void; delay: number }>()
  return {
    timers,
    schedule: ((run: () => void, delay: number) => {
      timers.set(++id, { run, delay })
      return id
    }) as unknown as typeof setTimeout,
    cancel: ((timer: number) => {
      timers.delete(timer)
    }) as unknown as typeof clearTimeout,
    fire: () => {
      const [id, timer] = [...timers][0]
      timers.delete(id)
      timer.run()
    },
  }
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

test('replacing an interval during a running sync leaves only the new schedule', async () => {
  const clock = fakeTimers()
  let finish!: () => void
  const scheduler = new AutoSyncScheduler(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
    clock.schedule,
    clock.cancel
  )
  scheduler.start(1)
  clock.fire()
  scheduler.start(5)
  finish()
  await flush()
  assert.equal(clock.timers.size, 1)
  assert.equal([...clock.timers.values()][0].delay, 300000)
  scheduler.stop()
  assert.equal(clock.timers.size, 0)
})

test('disabling auto-sync while it runs prevents a later reschedule', async () => {
  const clock = fakeTimers()
  let finish!: () => void
  const scheduler = new AutoSyncScheduler(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
    clock.schedule,
    clock.cancel
  )
  scheduler.start(1)
  clock.fire()
  scheduler.stop()
  finish()
  await flush()
  assert.equal(clock.timers.size, 0)
})

test('schedules the next run only after completion, and clamps invalid intervals', async () => {
  const clock = fakeTimers()
  const scheduler = new AutoSyncScheduler(async () => {}, clock.schedule, clock.cancel)
  scheduler.start(0)
  assert.equal([...clock.timers.values()][0].delay, 60000)
  clock.fire()
  assert.equal(clock.timers.size, 0)
  await flush()
  assert.equal(clock.timers.size, 1)
  scheduler.start(NaN)
  assert.equal([...clock.timers.values()][0].delay, 3600000)
  scheduler.start(Number.MAX_VALUE)
  assert.equal([...clock.timers.values()][0].delay, 2147483647)
  scheduler.stop()
})
