import pg from 'pg'

/** DB connection pool. Host and password come from the DATABASE_URL env var (never hardcoded) */
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/tokenzswap',
})

/** Create tables (left as-is if they already exist) */
export async function initDb(): Promise<void> {
  await pool.query(`
CREATE TABLE IF NOT EXISTS pools (
  id TEXT PRIMARY KEY,
  token_a TEXT NOT NULL,
  token_b TEXT NOT NULL,
  reserve_a NUMERIC(78,0) NOT NULL,                 -- numeric type that holds a uint256 without loss
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
  buyer TEXT,                              -- NULL until sold (hence no NOT NULL)
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

/** Read one sync_state value, or null if the key is missing */
export async function getState(key: string): Promise<string | null> {
  const r = await pool.query<{ value: string }>('SELECT value FROM sync_state WHERE key = $1', [key])
  return r.rows.length > 0 ? r.rows[0].value : null
}

/** Write one sync_state value: insert if missing, otherwise update */
export async function setState(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO sync_state (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value],
  )
}

/** Read the bookmark: the last synced block, or 0 if none */
export async function getLastBlock(): Promise<number> {
  return Number((await getState('lastBlock')) ?? 0)
}

/** Write the bookmark */
export async function setLastBlock(n: number): Promise<void> {
  await setState('lastBlock', String(n))
}
