import { getState, setState } from './db.ts'
import { syncOnce, RateLimitError } from './sync.ts'

/** Studio allows 3000 requests a day, one every 28.8 s. One sync is one request, so 30 s keeps us under it */
export const MIN_INTERVAL_S = 30
const MAX_INTERVAL_S = 3600

let intervalS = 60                       // Seconds between automatic syncs (loaded from sync_state on start)
let timer: NodeJS.Timeout | undefined    // The pending setTimeout, so it can be moved
let running: Promise<void> | null = null // The sync in progress, so two never overlap
let lastRunAt = 0                        // When the last sync started (ms)
let nextRunAt = 0                        // When the next automatic sync is due (ms)
let pausedUntil = 0                      // After a 429, no request before this time (ms)
let lastResult: { from: number; head: number; changed: number } | null = null
let lastError: string | null = null

/** Run syncOnce once and record the outcome. A call during a running sync waits for that one */
function runOnce(): Promise<void> {
  running ??= (async () => {
    lastRunAt = Date.now()
    try {
      lastResult = await syncOnce()
      lastError = null
      if (lastResult.changed > 0) console.log(`sync ${lastResult.from} → ${lastResult.head}: ${lastResult.changed} rows`)
    } catch (err) {
      if (err instanceof RateLimitError) pausedUntil = Date.now() + err.retryAfterS * 1000
      lastError = err instanceof Error ? err.message : String(err)
      console.error('sync failed:', err)
    } finally {
      running = null
    }
  })()
  return running
}

/** (Re)arm the timer: interval after the last start, but never before a 429 pause ends */
function schedule(): void {
  clearTimeout(timer)
  nextRunAt = Math.max(lastRunAt + intervalS * 1000, pausedUntil)
  timer = setTimeout(async () => {
    await runOnce()
    schedule()
  }, Math.max(0, nextRunAt - Date.now()))
}

/** Load the saved interval and start the automatic loop (first sync right away) */
export async function startScheduler(): Promise<void> {
  intervalS = Number((await getState('syncInterval')) ?? intervalS)
  schedule()
}

/** Change the automatic interval (clamped), save it, and re-arm the timer */
export async function setSyncInterval(seconds: number): Promise<void> {
  if (!Number.isFinite(seconds)) throw new Error('seconds must be a number')
  intervalS = Math.min(MAX_INTERVAL_S, Math.max(MIN_INTERVAL_S, Math.round(seconds)))
  await setState('syncInterval', String(intervalS))
  schedule()
}

/** Manual sync. Refused if the last one started under MIN_INTERVAL_S ago or Studio told us to wait */
export async function syncNow(): Promise<{ ok: boolean; message: string }> {
  const wait = Math.max(lastRunAt + MIN_INTERVAL_S * 1000, pausedUntil) - Date.now()
  if (wait > 0) return { ok: false, message: `try again in ${Math.ceil(wait / 1000)} s` }
  await runOnce()
  schedule()
  return { ok: lastError === null, message: lastError ?? 'synced' }
}

/** Current settings and last outcome, for the Explorer tab */
export function getSyncStatus() {
  const s = (ms: number) => (ms > 0 ? Math.floor(ms / 1000) : null)   // ms → unix seconds, 0 → null
  return {
    intervalS,
    minIntervalS: MIN_INTERVAL_S,
    running: running !== null,
    lastRunAt: s(lastRunAt),
    nextRunAt: s(nextRunAt),
    pausedUntil: pausedUntil > Date.now() ? s(pausedUntil) : null,
    lastResult,
    lastError,
  }
}
