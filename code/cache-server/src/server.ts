import http from 'node:http'
import { pool } from './db.js'

/** Send a JSON response to the browser */
function sendJson(res: http.ServerResponse, status: number, body:unknown ): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** address → execute */
const routes: Record<string, (q: URLSearchParams) => Promise<unknown>> = {
  '/api/pool': async () => {
    const r = await pool.query('SELECT * FROM pools')
    return r.rows[0] ?? null                          // Only one pool, so return the first row instead of an array
  },
  '/api/swaps': async () => {
    const r = await pool.query('SELECT * FROM swaps ORDER BY timestamp DESC LIMIT 20')   // Newest first by timestamp
    return r.rows                                        // rows holds the result data
  },
  '/api/liquidity': async () => {
    const r = await pool.query('SELECT * FROM liquidity_events ORDER BY timestamp DESC LIMIT 20')
    return r.rows
  },
    '/api/listings': async (q) => {
    const status = q.get('status')                  // 'ACTIVE' or null
    const r = status
      ? await pool.query('SELECT * FROM listings WHERE status = $1 ORDER BY created_at DESC', [status])
      : await pool.query('SELECT * FROM listings ORDER BY created_at DESC')
    return r.rows
  },
  '/api/nfts': async (q) => {
    const owner = q.get('owner')?.toLowerCase()            // Addresses in the DB are all lowercase
    const r = owner
      ? await pool.query('SELECT * FROM nfts WHERE owner = $1 ORDER BY id::numeric', [owner])
      : await pool.query('SELECT * FROM nfts ORDER BY id::numeric')
    return r.rows
  },
}

/** Start a server that looks up each request in routes, runs it, and responds */
export function startServer(port: number): void {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const route = routes[url.pathname]                          // Path only (query string excluded)
    if (!route) return sendJson(res, 404, { error: 'not found' })   // Unknown path
    try {
      sendJson(res, 200, await route(url.searchParams))                      // Await the DB result, then respond
    } catch (err) {
      console.error(err)
      sendJson(res, 500, { error: 'internal error' })      // Server-side error
    }
  })
  server.listen(port, '127.0.0.1', () => console.log(`API on http://127.0.0.1:${port}`))   // Local only (loopback)
}