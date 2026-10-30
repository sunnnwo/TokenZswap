import { initDb } from './db.ts'
import { syncOnce } from './sync.ts'
import { startServer } from './server.ts'

const PORT = Number(process.env.PORT ?? 3001)
const INTERVAL_MS = 15_000                     // 15 s in milliseconds (_ is just a digit separator)

/** Run syncOnce, then schedule itself again 15 s after it finishes */
async function loop(): Promise<void> {
  try {
    const r = await syncOnce()                                     // One sync pass
    if (r.changed > 0) console.log(`sync ${r.from} → ${r.head}: ${r.changed} rows`)
  } catch (err) {
    console.error('sync failed:', err)
  }
  setTimeout(loop, INTERVAL_MS)                                // Run loop again in 15 s
}

await initDb()                                                   // Prepare tables
startServer(PORT)                                              // Start the API on PORT
loop()
