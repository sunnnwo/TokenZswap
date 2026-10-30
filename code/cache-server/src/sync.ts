import { pool, getLastBlock, setLastBlock } from './db.ts'

const SUBGRAPH_URL =
  process.env.SUBGRAPH_URL ?? 'https://api.studio.thegraph.com/query/1753818/tokenzswap/version/latest'

/** Studio answered 429: its daily quota is used up until retryAfterS seconds from now */
export class RateLimitError extends Error {
  retryAfterS: number
  constructor(retryAfterS: number) {
    super(`subgraph rate limited, retry in ${retryAfterS} s`)
    this.retryAfterS = retryAfterS
  }
}

/** Send one GraphQL request (same shape as the frontend's subgraph.ts) */
async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (res.status === 429) throw new RateLimitError(Number(res.headers.get('retry-after') ?? 60))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] }
  if (json.errors) throw new Error(json.errors[0].message)
  return json.data as T
}

type Row = Record<string, string | null>

/** Subgraph field → DB table, with [subgraph field, DB column] pairs */
type Entity = { field: string; table: string; columns: [string, string][] }
const ENTITIES: Entity[] = [
  { field: 'pools', table: 'pools', columns: [['id', 'id'], ['tokenA', 'token_a'], ['tokenB', 'token_b'], ['reserveA', 'reserve_a'], ['reserveB', 'reserve_b'], ['totalLiquidity', 'total_liquidity'], ['swapCount', 'swap_count']] },
  { field: 'swaps', table: 'swaps', columns: [['id', 'id'], ['trader', 'trader'], ['tokenIn', 'token_in'], ['amountIn', 'amount_in'], ['amountOut', 'amount_out'], ['timestamp', 'timestamp'], ['txHash', 'tx_hash']] },
  { field: 'liquidityEvents', table: 'liquidity_events', columns: [['id', 'id'], ['type', 'type'], ['provider', 'provider'], ['amountA', 'amount_a'], ['amountB', 'amount_b'], ['liquidity', 'liquidity'], ['timestamp', 'timestamp']] },
  { field: 'listings', table: 'listings', columns: [['id', 'id'], ['seller', 'seller'], ['nft', 'nft'], ['tokenId', 'token_id'], ['paymentToken', 'payment_token'], ['price', 'price'], ['status', 'status'], ['buyer', 'buyer'], ['createdAt', 'created_at']] },
  { field: 'nfts', table: 'nfts', columns: [['id', 'id'], ['owner', 'owner']] },
]

/** Upsert one row: INSERT if new, otherwise UPDATE the remaining columns for that id */
async function upsert(table: string, columns: [string, string][], row: Row): Promise<void> {
  const cols = columns.map(([, c]) => c).join(', ')
  const vals = columns.map(([f]) => row[f] ?? null)
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')                      // Build $1, $2, …
  const updates = columns
    .filter(([, c]) => c !== 'id')
    .map(([, c]) => `${c} = EXCLUDED.${c}`)                                            // EXCLUDED refers to the new values we tried to insert
    .join(', ')
  await pool.query(
    `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updates}`,
    vals,
  )
}

/** GraphQL for one page of one entity: rows changed since $from with id after the cursor */
function pageQuery(e: Entity, cursor: string, pinned: boolean): string {
  const block = pinned ? 'block: { number: $head }, ' : ''
  return `${e.field}(first: 1000, orderBy: id, ${block}where: { _change_block: { number_gte: $from }, id_gt: ${cursor} }) {
    ${e.columns.map(([f]) => f).join(' ')}
  }`
}

/** One sync pass: fetch and store only what changed since the bookmark */
export async function syncOnce(): Promise<{ from: number; head: number; changed: number }> {
  const from = await getLastBlock()
  // One request for _meta and the first page of every entity. The subgraph answers a whole query
  // at a single block, so _meta.block.number is the block the rows come from.
  const data = await gql<{ _meta: { block: { number: number } } } & Record<string, unknown>>(
    `query($from: Int!) {
      _meta { block { number } }
      ${ENTITIES.map((e) => pageQuery(e, '""', false)).join('\n')}
    }`,
    { from },
  )
  const head = data._meta.block.number
  let changed = 0

  for (const e of ENTITIES) {
    let rows = data[e.field] as Row[]
    for (;;) {
      for (const r of rows) await upsert(e.table, e.columns, r)
      changed += rows.length
      if (rows.length < 1000) break                                                // Fewer than a full page means this was the last page
      // Rare: over 1000 changed rows. Fetch the next page pinned to the same block
      const q = `query($from: Int!, $head: Int!, $cursor: String!) { ${pageQuery(e, '$cursor', true)} }`
      rows = (await gql<Record<string, Row[]>>(q, { from, head, cursor: String(rows[rows.length - 1].id) }))[e.field]
    }
  }

  await setLastBlock(head)                                                         // Starting point for the next run
  return { from, head, changed }
}
