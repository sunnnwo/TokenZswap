import { pool, getLastBlock, setLastBlock } from './db.ts'

const SUBGRAPH_URL =
  process.env.SUBGRAPH_URL ?? 'https://api.studio.thegraph.com/query/1753818/tokenzswap/version/latest'

/** GraphQL 요청 한 번 (프론트의 subgraph.ts와 같은 모양) */
async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] }
  if (json.errors) throw new Error(json.errors[0].message)
  return json.data as T
}

type Row = Record<string, string | null>

/** 서브그래프 필드 → DB 테이블, [서브그래프 필드, DB 칼럼] 짝 */
const ENTITIES: { field: string; table: string; columns: [string, string][] }[] = [
  { field: 'pools', table: 'pools', columns: [['id', 'id'], ['tokenA', 'token_a'], ['tokenB', 'token_b'], ['reserveA', 'reserve_a'], ['reserveB', 'reserve_b'], ['totalLiquidity', 'total_liquidity'], ['swapCount', 'swap_count']] },
  { field: 'swaps', table: 'swaps', columns: [['id', 'id'], ['trader', 'trader'], ['tokenIn', 'token_in'], ['amountIn', 'amount_in'], ['amountOut', 'amount_out'], ['timestamp', 'timestamp'], ['txHash', 'tx_hash']] },
  { field: 'liquidityEvents', table: 'liquidity_events', columns: [['id', 'id'], ['type', 'type'], ['provider', 'provider'], ['amountA', 'amount_a'], ['amountB', 'amount_b'], ['liquidity', 'liquidity'], ['timestamp', 'timestamp']] },
  { field: 'listings', table: 'listings', columns: [['id', 'id'], ['seller', 'seller'], ['nft', 'nft'], ['tokenId', 'token_id'], ['paymentToken', 'payment_token'], ['price', 'price'], ['status', 'status'], ['buyer', 'buyer'], ['createdAt', 'created_at']] },
  { field: 'nfts', table: 'nfts', columns: [['id', 'id'], ['owner', 'owner']] },
]

/** 한 행 넣기: 없으면 INSERT, id가 이미 있으면 나머지 칼럼 UPDATE */
async function upsert(table: string, columns: [string, string][], row: Row): Promise<void> {
  const cols = columns.map(([, c]) => c).join(', ')
  const vals = columns.map(([f]) => row[f] ?? null)
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')                      // [1] $1, $2, … 를 만들기
  const updates = columns
    .filter(([, c]) => c !== 'id')
    .map(([, c]) => `${c} = EXCLUDED.${c}`)                                            // [2] "넣으려던 새 값"을 가리키는 키워드
    .join(', ')
  await pool.query(
    `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updates}`,
    vals,
  )
}

/** 한 번 동기화: 책갈피 이후 바뀐 것만 가져와 저장 */
export async function syncOnce(): Promise<{ from: number; head: number; changed: number }> {
  const from = await getLastBlock()                                                // ①
  const meta = await gql<{ _meta: { block: { number: number } } }>('{ _meta { block { number } } }')
  const head = meta._meta.block.number                                             // ②
  let changed = 0

  for (const e of ENTITIES) {                                                      // ③
    let cursor = ''
    for (;;) {
      const q = `query($from: Int!, $head: Int!, $cursor: String!) {
        ${e.field}(first: 1000, orderBy: id, block: { number: $head },
          where: { _change_block: { number_gte: $from }, id_gt: $cursor }) {
          ${e.columns.map(([f]) => f).join(' ')}
        }
      }`
      const rows = (await gql<Record<string, Row[]>>(q, { from, head, cursor }))[e.field]
      for (const r of rows) await upsert(e.table, e.columns, r)
      changed += rows.length
      if (rows.length < 1000) break                                                // [5] 이보다 적게 왔으면 마지막 페이지
      cursor = String(rows[rows.length - 1].id)
    }
  }

  await setLastBlock(head)                                                         // [6] ④ 다음번 시작점
  return { from, head, changed }
}
