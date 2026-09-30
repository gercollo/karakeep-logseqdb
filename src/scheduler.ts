type Timer = ReturnType<typeof setTimeout>

/** Only the currently enabled schedule may reschedule an in-flight sync. */
export class AutoSyncScheduler {
  private timer: Timer | null = null
  private generation = 0

  constructor(
    private readonly sync: () => Promise<void>,
    private readonly schedule: typeof setTimeout = setTimeout,
    private readonly cancel: typeof clearTimeout = clearTimeout
  ) {}

  start(intervalMinutes: number): void {
    this.stop()
    const generation = this.generation
    const minutes = Number.isFinite(intervalMinutes) ? Math.max(intervalMinutes, 1) : 60
    // Timers above the signed 32-bit maximum otherwise fire almost immediately.
    const intervalMs = Math.min(minutes * 60_000, 2_147_483_647)
    const next = () => {
      this.timer = this.schedule(() => {
        this.timer = null
        void this.sync()
          .catch((error: unknown) => console.error('[Karakeep] Scheduled sync failed:', error))
          .finally(() => {
            if (generation === this.generation) next()
          })
      }, intervalMs)
    }
    next()
  }

  stop(): void {
    this.generation++
    if (this.timer !== null) this.cancel(this.timer)
    this.timer = null
  }
}
