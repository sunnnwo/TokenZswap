import { initDb } from './db.ts'
import { startServer } from './server.ts'
import { startScheduler } from './scheduler.ts'

const PORT = Number(process.env.PORT ?? 3001)

await initDb()                                                   // Prepare tables
startServer(PORT)                                              // Start the API on PORT
await startScheduler()                                         // Sync now, then every intervalS (changeable from the Explorer tab)
