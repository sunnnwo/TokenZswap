import pg from 'pg'

/** DB 서버 연결 풀. 주소와 비밀번호는 환경변수 DATABASE_URL로 받음 (코드에 적지 않음) */
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/tokenzswap',
})

/** 테이블 만들기 (이미 있으면 그대로) */
export async function initDb(): Promise<void> {
  await pool.query(`
CREATE TABLE IF NOT EXISTS pools (
  id TEXT PRIMARY KEY,
  token_a TEXT NOT NULL,
  token_b TEXT NOT NULL,
  reserve_a NUMERIC(78,0) NOT NULL,                 -- [1] uint256를 손실 없이 담는 숫자 타입
  reserve_b NUMERIC(78,0) NOT NULL,
  total_liquidity NUMERIC(78,0) NOT NULL,
  swap_count BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS swaps (
  id TEXT PRIMARY KEY,
  trader TEXT NOT NULL,
  token_in TEXT NOT NULL,
  amount_in NUMERIC(78,0) NOT NULL,
  amount_out NUMERIC(78,0) NOT NULL,
  timestamp BIGINT NOT NULL,
  tx_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS liquidity_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  amount_a NUMERIC(78,0) NOT NULL,
  amount_b NUMERIC(78,0) NOT NULL,
  liquidity NUMERIC(78,0) NOT NULL,
  timestamp BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  seller TEXT NOT NULL,
  nft TEXT NOT NULL,
  token_id NUMERIC(78,0) NOT NULL,
  payment_token TEXT NOT NULL,
  price NUMERIC(78,0) NOT NULL,
  status TEXT NOT NULL,
  buyer TEXT,                              -- 팔리기 전에는 NULL (그래서 NOT NULL 없음)
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS nfts (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`)
}

/** 책갈피 읽기: 마지막으로 동기화한 블록. 없으면 0 */
export async function getLastBlock(): Promise<number> {
  const r = await pool.query<{ value: string }>('SELECT value FROM sync_state WHERE key = $1', ['lastBlock']) // [2]
  return r.rows.length > 0 ? Number(r.rows[0].value) : 0
}

/** 책갈피 쓰기: 없으면 넣고, 있으면 고치기 */
export async function setLastBlock(n: number): Promise<void> {
  await pool.query( // [3] 결과를 기다려야 함
    `INSERT INTO sync_state (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    ['lastBlock', String(n)],
  )
}
