import { initDb } from './db.ts'
import { syncOnce } from './sync.ts'
import { startServer } from './server.ts'

const PORT = Number(process.env.PORT ?? 3001)
const INTERVAL_MS = 15_000                     // 15초 (밀리초 단위, _는 읽기 쉽게 끊은 것)

/** syncOnce를 한 번 돌리고, 끝나면 15초 뒤에 자기 자신을 다시 부르기 */
async function loop(): Promise<void> {
  try {
    const r = await syncOnce()                                     // [1] 동기화 한 바퀴
    if (r.changed > 0) console.log(`sync ${r.from} → ${r.head}: ${r.changed} rows`)
  } catch (err) {
    console.error('sync failed:', err)
  }
  setTimeout(loop, INTERVAL_MS)                                // [2] 15초 뒤에 부를 함수
}

await initDb()                                                   // [3] ① 테이블 준비
startServer(PORT)                                              // [4] ② 몇 번 포트?
loop()                                                         // ③
