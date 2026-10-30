import { useQuery } from '@tanstack/react-query'
import { formatUnits } from 'viem'
import { ADDRESSES } from './contracts.ts'
import { api } from './api.ts'
import { useState } from 'react'

/** /api/pool response shape (DB column names, big numbers as strings) */
type Pool = { reserve_a: string; reserve_b: string; total_liquidity: string; swap_count: string }


/** Addresses from the API are lowercase, so compare against a lowercase tokenA */
const TOKEN_A = ADDRESSES[97].tokenA.toLowerCase()

/** 0x8124b5be…9619 → 0x8124…9619 */
function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

/** Unix seconds (string) → readable date */
function formatTime(ts: string): string {
  return new Date(Number(ts) * 1000).toLocaleString() // seconds → milliseconds
}
/** One /api/swaps row */
type Swap = {
  id: string; trader: string; token_in: string; amount_in: string; amount_out: string; timestamp: string; tx_hash: string
}
/** One /api/liquidity row */
type LiquidityEvent = {
  id: string; type: 'ADD' | 'REMOVE'; provider: string; amount_a: string; amount_b: string; liquidity: string; timestamp: string
}

/** One /api/listings row */
type Listing = {
  id: string; seller: string; nft: string; token_id: string; payment_token: string
  price: string; status: 'ACTIVE' | 'SOLD' | 'CANCELLED'; buyer: string | null; created_at: string   // null until sold
}

/** The four filter buttons */
const STATUSES = ['ALL', 'ACTIVE', 'SOLD', 'CANCELLED'] as const
type StatusFilter = (typeof STATUSES)[number]   // 'ALL' | 'ACTIVE' | 'SOLD' | 'CANCELLED'

/** One /api/nfts row */

type Nft = {id: string; owner: string}

/** If the owner is the AMM, the NFT is held by the market */

const AMM = ADDRESSES[97].amm.toLowerCase()



/** Recent swaps and liquidity events */
function History() {
    const h = useQuery({
    queryKey: ['api', 'history'],
    queryFn: async () => {
      const [swaps, liquidity] = await Promise.all([       // send both at once and wait for both
        api<Swap[]>('/swaps'),
        api<LiquidityEvent[]>('/liquidity'),
      ])
      return { swaps, liquidity }
    },
    refetchInterval: 10_000,
  })

  if (h.isPending) return <p>Is Pending...</p>
  if (h.isError) return <p>Is Error: {h.error.message}</p>

  return (
    <section>
      <h2>Recent Swaps</h2>
      {h.data.swaps.length === 0 && <p>Don't have any swaps yet.</p>}
      <table>
        <tbody>
          {h.data.swaps.map((s) => {
            const aToB = s.token_in === TOKEN_A // was the input token A?
            return (
              <tr key={s.id}>
                <td>{formatTime(s.timestamp)}</td>
                <td>{shortAddr(s.trader)}</td>
                <td>
                  {formatUnits(BigInt(s.amount_in), 18)} {aToB ? 'SW42' : 'R2B'} →{' '}
                  {formatUnits(BigInt(s.amount_out), 18)} {aToB ? 'R2B' : 'SW42'}
                </td>
                <td>
                  <a href={`https://testnet.bscscan.com/tx/${s.tx_hash}`} target="_blank" rel="noreferrer">
                    BscScan
                  </a>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <h2>Liquidity Events</h2>
      <table>
        <tbody>
          {h.data.liquidity.map((e) => (
            <tr key={e.id}>
              <td>{formatTime(e.timestamp)}</td>
              <td>{e.type === 'ADD' ? 'Supply' : 'Remove'}</td>
              <td>{shortAddr(e.provider)}</td>
              <td>
                {formatUnits(BigInt(e.amount_a), 18)} SW42 + {formatUnits(BigInt(e.amount_b), 18)} R2B
              </td>
              <td>LP {formatUnits(BigInt(e.liquidity), 18)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** Pool stats: visible without a wallet */
function PoolStats() {
  const pool = useQuery({
    queryKey: ['api', 'pool'],
    queryFn: () => api<Pool | null>('/pool'),          // path after /api
    refetchInterval: 10_000,
  })

  if (pool.isPending) return <p>Loading pool stats…</p>
  if (pool.isError) return <p>Failed to read cache server: {pool.error.message}</p>

  const p = pool.data                                  // a single object, not an array
  if (!p) return <p>No pool yet.</p>

  const reserveA = BigInt(p.reserve_a)
  const reserveB = BigInt(p.reserve_b)
  const price = reserveA > 0n ? Number(formatUnits(reserveB, 18)) / Number(formatUnits(reserveA, 18)) : 0

  return (
    <section>
      <h2>Pool Stats (cache server)</h2>
      <table>
        <tbody>
          <tr><td>SW42 (A)</td><td>{formatUnits(reserveA, 18)}</td></tr>
          <tr><td>R2B (B)</td><td>{formatUnits(reserveB, 18)}</td></tr>
          <tr><td>Price</td><td>1 A = {price.toFixed(4)} B</td></tr>
          <tr><td>LP Balance</td><td>{formatUnits(BigInt(p.total_liquidity), 18)}</td></tr>
          <tr><td>swap Count</td><td>{p.swap_count}</td></tr>
        </tbody>
      </table>
    </section>
  )
}

/** NFT listing history, filterable by status */
function MarketHistory() {
  const [filter, setFilter] = useState<StatusFilter>('ALL')

  const listings = useQuery({
    queryKey: ['api', 'listings', filter],                                          // separate cache entry per filter
    queryFn: () => api<Listing[]>(filter === 'ALL' ? '/listings' : `/listings?status=${filter}`),
    refetchInterval: 10_000,
  })

  return (
    <section>
      <h2>NFT Market</h2>
      <div>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setFilter(s)} disabled={filter === s}>
            {s}
          </button>
        ))}
      </div>

      {listings.isPending && <p>Loading…</p>}
      {listings.isError && <p>Failed to read cache server: {listings.error.message}</p>}
      {listings.data?.length === 0 && <p>No matching listings.</p>}

      {listings.data && listings.data.length > 0 && (
        <table>
          <tbody>
            {listings.data.map((l) => (
              <tr key={l.id}>
                <td>#{l.id}</td>
                <td>NFT #{l.token_id}</td>
                <td>{formatUnits(BigInt(l.price), 18)} {l.payment_token === TOKEN_A ? 'SW42' : 'R2B'}</td>
                <td>{l.status}</td>
                <td>Seller {shortAddr(l.seller)}</td>
                <td>{l.buyer ? `Buyer ${shortAddr(l.buyer)}` : '-'}</td>
                <td>{formatTime(l.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}


/** NFT owner lookup: search by address, empty = all */
function NftOwners() {
  const [input, setInput] = useState('')   // text currently typed in the input
  const [owner, setOwner] = useState('')   // address submitted with Search ('' = all)

  const nfts = useQuery({
    queryKey: ['api', 'nfts', owner],
    queryFn: () => api<Nft[]>(owner ? `/nfts?owner=${ encodeURIComponent(owner)}` : '/nfts'),
    refetchInterval: 10_000,
  })

  return (
    <section>
      <h2>NFT Owners</h2>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="0x… (empty = all)"
      />
      <button onClick={() => setOwner(input.trim())}>Search</button>

      {nfts.isPending && <p>Loading…</p>}
      {nfts.isError && <p>Failed to read cache server: {nfts.error.message}</p>}
      {nfts.data?.length === 0 && <p>This address owns no NFTs.</p>}

      {nfts.data && nfts.data.length > 0 && (
        <table>
          <tbody>
            {nfts.data.map((n) => (
              <tr key={n.id}>
                <td>NFT #{n.id}</td>
                <td>{n.owner === AMM ? 'Held by market (AMM)' : shortAddr(n.owner)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}



/** Explorer tab: pool stats, history, market, NFT owners (data from the cache server /api) */
export default function Explorer() {
  return (
    <div>
      
        <PoolStats />
        <History />
        <MarketHistory />
        <NftOwners />
    </div>
  )
}
