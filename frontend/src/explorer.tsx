import { useQuery } from '@tanstack/react-query'
import { formatUnits } from 'viem'
import { ADDRESSES } from './contracts.ts'
import { api } from './api.ts'
import { useState } from 'react'

/** /api/pool 응답 모양 (DB 칼럼 이름, 큰 숫자는 문자열) */
type Pool = { reserve_a: string; reserve_b: string; total_liquidity: string; swap_count: string }


/** subgraph address is not Majority, -> for compare tokenA also not Majority */
const TOKEN_A = ADDRESSES[97].tokenA.toLowerCase()

/** 0x8124b5be…9619 → 0x8124…9619 */
function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

/** 유닉스 초(문자열) → 읽기 쉬운 날짜 */
function formatTime(ts: string): string {
  return new Date(Number(ts) * 1000).toLocaleString() // [1] 초 → 밀리초
}
/** /api/swaps 한 행 */
type Swap = {
  id: string; trader: string; token_in: string; amount_in: string; amount_out: string; timestamp: string; tx_hash: string
}
/** /api/liquidity 한 행 */
type LiquidityEvent = {
  id: string; type: 'ADD' | 'REMOVE'; provider: string; amount_a: string; amount_b: string; liquidity: string; timestamp: string
}

/** /api/listings 한 행 */
type Listing = {
  id: string; seller: string; nft: string; token_id: string; payment_token: string
  price: string; status: 'ACTIVE' | 'SOLD' | 'CANCELLED'; buyer: string | null; created_at: string   // [1] 팔리기 전엔 null
}

/** 필터 버튼 4개 */
const STATUSES = ['ALL', 'ACTIVE', 'SOLD', 'CANCELLED'] as const
type StatusFilter = (typeof STATUSES)[number]   // 'ALL' | 'ACTIVE' | 'SOLD' | 'CANCELLED'

/** /api/nfts 한 행 */

type Nft = {id: string; owner: string}

/** 주인이 AMM이면 마켓에 맡겨진 NFT */

const AMM = ADDRESSES[97].amm.toLowerCase()



/** 최근 swap과 유동성 기록 */
function History() {
    const h = useQuery({
    queryKey: ['api', 'history'],
    queryFn: async () => {
      const [swaps, liquidity] = await Promise.all([       // [1] 동시에 보내고 다 기다리기
        api<Swap[]>('/swaps'),
        api<LiquidityEvent[]>('/liquidity'),                      // [2] 유동성 주소
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
            const aToB = s.token_in === TOKEN_A // [3] 넣은 토큰이 A인가
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

/** 풀 통계: 지갑 없이도 보이는 정보 */
function PoolStats() {
  const pool = useQuery({
    queryKey: ['api', 'pool'],
    queryFn: () => api<Pool | null>('/pool'),          // [1] 풀 주소 (/api 뒤 부분만)
    refetchInterval: 10_000,
  })

  if (pool.isPending) return <p>풀 통계 불러오는 중…</p>
  if (pool.isError) return <p>캐시 서버 읽기 실패: {pool.error.message}</p>

  const p = pool.data                                  // [2] 배열 아님, 그대로
  if (!p) return <p>아직 풀이 없습니다.</p>

  const reserveA = BigInt(p.reserve_a)                      // [3]
  const reserveB = BigInt(p.reserve_b)
  const price = reserveA > 0n ? Number(formatUnits(reserveB, 18)) / Number(formatUnits(reserveA, 18)) : 0

  return (
    <section>
      <h2>풀 통계 (캐시 서버)</h2>
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

/** NFT 판매 기록: 상태별로 골라 보기 */
function MarketHistory() {
  const [filter, setFilter] = useState<StatusFilter>('ALL')

  const listings = useQuery({
    queryKey: ['api', 'listings', filter],                                          // [2] 버튼마다 다른 질문
    queryFn: () => api<Listing[]>(filter === 'ALL' ? '/listings' : `/listings?status=${filter}`),   // [3]
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

      {listings.isPending && <p>불러오는 중…</p>}
      {listings.isError && <p>캐시 서버 읽기 실패: {listings.error.message}</p>}
      {listings.data?.length === 0 && <p>해당하는 판매 건이 없습니다.</p>}

      {listings.data && listings.data.length > 0 && (
        <table>
          <tbody>
            {listings.data.map((l) => (
              <tr key={l.id}>
                <td>#{l.id}</td>
                <td>NFT #{l.token_id}</td>
                <td>{formatUnits(BigInt(l.price), 18)} {l.payment_token === TOKEN_A ? 'SW42' : 'R2B'}</td>
                <td>{l.status}</td>
                <td>판매자 {shortAddr(l.seller)}</td>
                <td>{l.buyer ? `구매자 ${shortAddr(l.buyer)}` : '-'}</td>
                <td>{formatTime(l.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}


/** NFT 주인 찾기: 주소로 검색, 비우면 전체 */
function NftOwners() {
  const [input, setInput] = useState('')   // 입력칸에 치는 중인 글자
  const [owner, setOwner] = useState('')   // 검색 버튼을 누른 주소 ('' = 전체)

  const nfts = useQuery({
    queryKey: ['api', 'nfts', owner],                                                    // [1]
    queryFn: () => api<Nft[]>(owner ? `/nfts?owner=${ encodeURIComponent(owner)}` : '/nfts'),          // [2]
    refetchInterval: 10_000,
  })

  return (
    <section>
      <h2>NFT Owners</h2>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}                                          // [3]
        placeholder="0x… (비우면 전체)"
      />
      <button onClick={() => setOwner(input.trim())}>검색</button>                          {/* [4] */}

      {nfts.isPending && <p>불러오는 중…</p>}
      {nfts.isError && <p>캐시 서버 읽기 실패: {nfts.error.message}</p>}
      {nfts.data?.length === 0 && <p>이 주소가 가진 NFT가 없습니다.</p>}

      {nfts.data && nfts.data.length > 0 && (
        <table>
          <tbody>
            {nfts.data.map((n) => (
              <tr key={n.id}>
                <td>NFT #{n.id}</td>
                <td>{n.owner === AMM ? '마켓 보관 중 (AMM)' : shortAddr(n.owner)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}



/** 탐색기 탭 전체: 풀 통계, 기록, 마켓, NFT 주인 (데이터는 캐시 서버 /api) */
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
