import http from 'node:http'
import { pool } from './db.js'

//** send response Json to browser  */
function sendJson(res: http.ServerResponse, status: number, body:unknown ): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** address → execute */
const routes: Record<string, (q: URLSearchParams) => Promise<unknown>> = {
  '/api/pool': async () => {
    const r = await pool.query('SELECT * FROM pools')
    return r.rows[0] ?? null                          // [1] 풀은 1개뿐이니 배열 말고 첫 행만
  },
  '/api/swaps': async () => {
    const r = await pool.query('SELECT * FROM swaps ORDER BY timestamp DESC LIMIT 20')   // [2] 무엇 기준으로 최신순?
    return r.rows                                        // [3] 결과 데이터가 들어 있는 곳
  },
  '/api/liquidity': async () => {
    const r = await pool.query('SELECT * FROM liquidity_events ORDER BY timestamp DESC LIMIT 20')   // [4] 테이블 이름
    return r.rows
  },
    '/api/listings': async (q) => {
    const status = q.get('status')                  // 'ACTIVE' 또는 null
    const r = status
      ? await pool.query('SELECT * FROM listings WHERE status = $1 ORDER BY created_at DESC', [status])   // [1] [2]
      : await pool.query('SELECT * FROM listings ORDER BY created_at DESC')
    return r.rows
  },
  '/api/nfts': async (q) => {
    const owner = q.get('owner')?.toLowerCase()            // [3] DB의 주소는 전부 소문자
    const r = owner
      ? await pool.query('SELECT * FROM nfts WHERE owner = $1 ORDER BY id::numeric', [owner])   // [4]
      : await pool.query('SELECT * FROM nfts ORDER BY id::numeric')
    return r.rows
  },
}

/** 요청을 받아 routes에서 찾아 실행하고 답하는 서버 켜기 */
export function startServer(port: number): void {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const route = routes[url.pathname]                          // [1] ① 경로만
    if (!route) return sendJson(res, 404, { error: 'not found' })   // [2] ② 없는 주소
    try {
      sendJson(res, 200, await route(url.searchParams))                      // [3] ③④ DB 결과를 기다려서
    } catch (err) {
      console.error(err)
      sendJson(res, 500, { error: 'internal error' })      // [4] ⑤ 서버 쪽 에러
    }
  })
  server.listen(port, '127.0.0.1', () => console.log(`API on http://127.0.0.1:${port}`))   // [5] 안에서만
}