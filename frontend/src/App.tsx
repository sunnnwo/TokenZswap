import {
  useConnection,
  useConnectors,
  useConnect,
  useDisconnect,
  useChains,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
  useReadContracts,
  useReadContract,
} from 'wagmi'

import { formatUnits, parseUnits, isAddressEqual, type Address } from 'viem'
import { ADDRESSES, ammAbi } from './contracts.ts'

import { useEffect, useState} from 'react'
import { tokenAbi, nftAbi, ipfsToHttp } from './contracts.ts'
import { useQueryClient, useQuery } from '@tanstack/react-query'


const SLIPPAGE_BPS = 100n // 1%
const MAX_NFT_ID = 20 // NFT ID는 0~19까지 존재. 20 이상은 없는 토큰 ID



/** 지갑 연결 상태를 보여주고, 연결 / 체인 전환 / 연결 해제 버튼을 제공한다. */
function WalletBar() {
  const connection = useConnection()   // 지금 연결 상태 (주소, 체인, status)
  const connectors = useConnectors()   // config에 등록한 연결 방식 목록 ([injected])
  const connect = useConnect()         // "연결해 줘" 동작
  const disconnect = useDisconnect()   // "연결 끊어 줘" 동작
  const chains = useChains()           // config에 등록한 체인 목록
  const switchChain = useSwitchChain() // "체인 바꿔 줘" 동작

  // 연결 안 된 상태
  if (connection.status !== 'connected') {                                     // [1]
    return (
      <div>
        {connectors.map((connector) => (
          <button
            key={connector.uid}
            disabled={connect.isPending}
            onClick={() => connect.mutate({ connector })}                       // [2]
          >
            {connector.name} 연결
          </button>
        ))}
        {connect.error && <p>연결 실패: {connect.error.message}</p>}
      </div>
    )
  }

  // 연결된 상태
  return (
    <div>
      <p>주소: {connection.address}</p>
      <p>체인: {connection.chain?.name ?? `지원하지 않는 체인 (ID ${connection.chainId})`}</p>

      {chains.map((chain) => (
        <button
          key={chain.id}
          disabled={chain.id === connection.chainId || switchChain.isPending}
          onClick={() => switchChain.mutate({ chainId: chain.id })}            // [3]
        >
          {chain.name}로 전환
        </button>
      ))}

      <button onClick={() => disconnect.mutate()}>연결 해제</button>         {/* [4] */}
    </div>
  )
}
/** 풀의 reserveA / reserveB / LP 총량과 현재 가격을 보여준다. */
function PoolInfo() {
  const connection = useConnection()
  const addresses = ADDRESSES[connection.chainId ?? 0]

  const amm = {address : addresses?.amm, abi: ammAbi} as const

  const pool = useReadContracts({
    contracts:[
      {...amm, functionName: 'reserveA'},
      {...amm, functionName: 'reserveB'},
      {...amm, functionName: 'totalSupply'},
    ],
    allowFailure: false,
    query : {
      enabled: !!addresses, // 체인 지원 안 하면 읽기 요청을 보내지 않음
    }
  })
  if (!addresses) return <p>이 체인에는 배포된 컨트렉트가 없습니다.</p>
  if (pool.isPending) return <p>풀 정보 로딩 중...</p>
  if (pool.isError) return <p>읽기 실패: {pool.error.message}</p>

  const [reserveA, reserveB, lpSupply] = pool.data
  return (
    <div>
      <h2>Pool</h2>
      <p>SW42 (A): {formatUnits(reserveA, 18)}</p>      {/* [4] 토큰 소수점 자릿수 */}
      <p>R2B (B): {formatUnits(reserveB, 18)}</p>
      <p>LP 총량: {formatUnits(lpSupply, 18)}</p>
      <p>가격: 1 A = {Number(formatUnits(reserveB, 18)) / Number(formatUnits(reserveA, 18))} B</p>
    </div>
  )}

function MyBalance() {
  const connection = useConnection()
  const addresses = ADDRESSES[connection.chainId ?? 0]
  const me = connection.address
  const queryClient = useQueryClient()

const balances = useReadContracts({
    contracts: [
      { address: addresses?.tokenA, abi: tokenAbi, functionName: 'balanceOf', args: [me!] },
      { address: addresses?.tokenB, abi: tokenAbi, functionName: 'balanceOf', args: [me!] },
      { address: addresses?.amm, abi: tokenAbi, functionName: 'balanceOf', args: [me!] }, // [2] LP 잔액은 어느 컨트랙트에 물어볼까요?
    ],
    allowFailure: false,
    query: { enabled: !!addresses && !!me }, // [3] 주소록도 있고 "내 주소"도 있을 때만
  })

  const faucet = useWriteContract()                                  // ① 서명 → ② hash
  const receipt = useWaitForTransactionReceipt({ hash: faucet.data }) // [4] ②에서 받은 hash는 어디에?

  // ③ 채굴되면 캐시를 전부 무효화 → Pool, 잔액이 다시 읽힘
  useEffect(() => {
    if (receipt.isSuccess) queryClient.invalidateQueries()
  }, [receipt.isSuccess, queryClient])

  if (!addresses || !me) return null
  if (balances.isPending) return <p>잔액 불러오는 중…</p>
  if (balances.isError) return <p>잔액 읽기 실패: {balances.error.message}</p>

  const [balA, balB, balLP] = balances.data
  const busy = faucet.isPending || receipt.isLoading // [5] "서명 대기 중이거나 채굴 대기 중"이면 버튼 잠금

  return (
    <section>
      <h2>내 잔액</h2>
      <p>SW42 (A): {formatUnits(balA, 18)}</p>
      <p>R2B (B): {formatUnits(balB, 18)}</p>
      <p>LP: {formatUnits(balLP, 18)}</p>

      <button
        disabled={busy}
        onClick={() => faucet.mutate({ address: addresses.tokenA, abi: tokenAbi, functionName: 'faucet' })}
      >
        A 1000개 받기
      </button>
      <button
        disabled={busy}
        onClick={() => faucet.mutate({ address: addresses.tokenB, abi: tokenAbi, functionName: 'faucet' })}
      >
        B 1000개 받기
      </button>

      {receipt.isLoading && <p>채굴 기다리는 중…</p>}
      {faucet.error && <p>실패: {faucet.error.message}</p>}
    </section>
  )
}

/**
 * 
 * 입력 문자열 -> wei. 숫자 아니면 0n
 */

function toWei(text: string):bigint {
  try {
    return parseUnits(text, 18)
  }
  catch {
    return 0n
  }
}

/**
 * a <-> b 스왑 (1단계 : 견적)
 * 
 */

function Swap()
{
  const connection = useConnection()
  const addresses = ADDRESSES[connection.chainId ?? 0]

  const [aToB, setAToB] = useState(true) // true면 A->B, false면 B->A
  const [amountText, setAmountText] = useState('') // 입력 문자열
  const amountIn = toWei(amountText) // 입력 문자열 -> wei

  const pool = useReadContracts({
    contracts:[
      {address: addresses?.amm, abi: ammAbi, functionName: 'reserveA'},
      {address: addresses?.amm, abi: ammAbi, functionName: 'reserveB'},
    ],
    allowFailure: false,
    query : {
      enabled: !!addresses, // 체인 지원 안 하면 읽기 요청을 보내지 않음
    }
  })

  const [reserveA, reserveB] = pool.data ?? [0n, 0n]
  const [reserveIn, reserveOut] = aToB ? [reserveA, reserveB] : [reserveB, reserveA]

  const quote = useReadContract({
    address: addresses?.amm,
    abi: ammAbi,
    functionName: 'getAmountOut',
    args: [amountIn, reserveIn, reserveOut],
    query: {
      enabled: !!addresses && amountIn > 0n && reserveIn > 0n && reserveOut > 0n, // 견적을 낼 수 있는 조건
    }
  })
  const amountOut = quote.data ?? 0n
  const minOut = (amountOut *(10_000n - SLIPPAGE_BPS)) / 10_000n // 최소 수령량 = 견적 * (1 - 슬리피지)

  const me = connection.address
  const queryClient = useQueryClient()
  const tokenIn = aToB ? addresses?.tokenA : addresses?.tokenB

  const allowance = useReadContract({
    address: tokenIn,
    abi: tokenAbi,
    functionName: 'allowance',
    args: me && addresses ? [me, addresses.amm] : undefined,
    query: {
      enabled: !!addresses && !!me && amountIn > 0n, // "내 주소"도 있고, 입력량도 있을 때만
    }
  })
  const needApprove = (allowance.data ?? 0n) < amountIn

  const write = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash: write.data })

  useEffect(() => {
    if (receipt.isSuccess) queryClient.invalidateQueries()
  }, [receipt.isSuccess, queryClient])

  const busy = write.isPending || receipt.isLoading 

  if (!addresses) return <p>이 체인에는 배포된 컨트렉트가 없습니다.</p>
  
  const inName = aToB ? 'SW42 (A)' : 'R2B (B)'
  const outName = aToB ? 'R2B (B)' : 'SW42 (A)'
  
  return (
    <section>
      <h2>Swap</h2>
      <button onClick={() => setAToB(!aToB)}>방향 전환</button>
      <p>
        {inName} Input: {' '}
        <input value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0.0" />
      </p>
      <p>{outName} 예상수령 : {formatUnits(amountOut, 18)}</p>
      <p>최소 수령량 (SLIPPAGE 1%): {formatUnits(minOut, 18)} {outName}</p>
      {needApprove ? (
        <button
          disabled={busy || amountIn === 0n}
          onClick={() => 
            write.mutate({ address: tokenIn!, abi: tokenAbi, functionName: 'approve', args: [addresses.amm, amountIn] })}
        >
          {inName} Approve
        </button>
      ) : (
        <button
          disabled={busy || amountOut === 0n}
          onClick={() =>
            write.mutate({ address: addresses.amm, abi: ammAbi, functionName: 'swap', args: [tokenIn!, amountIn, minOut] })}
        >
          Swap
        </button>
      )}
      {receipt.isLoading && <p>채굴 기다리는 중…</p>}
      {write.error && <p>서명 실패: {write.error.message}</p>}
      {receipt.isError && <p>채굴 실패: {receipt.error.message}</p>}
    </section>
  )
}

/** Add Liquidity Component : Input A -> B are calculated about the ratio of the reserves -> approve A,B -> addLiquidity */
function AddLiquidity() {
  const connection = useConnection()
  const addresses = ADDRESSES[connection.chainId ?? 0]
  const me = connection.address
  const queryClient = useQueryClient()

  const [textA, setTextA] = useState('')
  const [textB, setTextB] = useState('') //첫 공급시에만 사용
  const amountA = toWei(textA)

  // Pool state : PoolInfo === "same list" -> same query key -> shared cache
  const pool = useReadContracts({
    contracts:[
      {address: addresses?.amm, abi: ammAbi, functionName: 'reserveA'},
      {address: addresses?.amm, abi: ammAbi, functionName: 'reserveB'},
      {address: addresses?.amm, abi: ammAbi, functionName: 'totalSupply'},
    ],
    allowFailure: false,
    query : {
      enabled: !!addresses, // 체인 지원 안 하면 읽기 요청을 보내지 않음
    }
  })
  const [reserveA, reserveB, lpSupply] = pool.data ?? [0n, 0n, 0n]
  const isFirst = lpSupply === 0n

  const amountB = isFirst ? toWei(textB) : (amountA * reserveB) / reserveA //첫 공급시에만 textB를 사용
  const expectedLP = isFirst ? 0n: (amountA * lpSupply) / reserveA
  
  const allowanceA = useReadContracts({
    contracts: [
      { address: addresses?.tokenA, abi: tokenAbi, functionName: 'allowance', args: me && addresses ? [me, addresses.amm] : undefined },
      { address: addresses?.tokenB, abi: tokenAbi, functionName: 'allowance', args: me && addresses ? [me, addresses.amm] : undefined },
    ],
    allowFailure: false,
    query: { enabled: !!addresses && !!me  }, // "내 주소"도 있고, 입력량도 있을 때만
  })
  const [allowA, allowB] = allowanceA.data ?? [0n, 0n]
  const needApproveA = allowA < amountA
  const needApproveB = allowB < amountB

  const write = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash: write.data })
  
  useEffect(() => {
    if (receipt.isSuccess) queryClient.invalidateQueries()
  }, [receipt.isSuccess, queryClient])
const busy = write.isPending || receipt.isLoading
if (!addresses || !me) return null


return (
    <section>
      <h2>유동성 공급 One day onetime</h2>
      <p>
        SW42 (A): <input value={textA} onChange={(e) => setTextA(e.target.value)} placeholder="0.0" />
      </p>
      {isFirst ? (
        <p>
          R2B (B): <input value={textB} onChange={(e) => setTextB(e.target.value)} placeholder="0.0" /> (첫 공급: 가격을 직접 정함)
        </p>
      ) : (
        <p>R2B (B): {formatUnits(amountB, 18)} (풀 비율로 자동 계산)</p>
      )}
      {!isFirst && <p>예상 LP: ≈ {formatUnits(expectedLP, 18)}</p>}

      {needApproveA ? (
        <button
          disabled={busy || amountA === 0n}
          onClick={() => write.mutate({ address: addresses.tokenA, abi: tokenAbi, functionName: 'approve', args: [addresses.amm, amountA] })}
        >
          Approve A
        </button>
      ) : needApproveB ? (
        <button
          disabled={busy || amountB === 0n}
          onClick={() => write.mutate({ address: addresses.tokenB, abi: tokenAbi, functionName: 'approve', args: [addresses.amm, amountB] })} // [5]
        >
          Approve B
        </button>
      ) : (
        <button
          disabled={busy || amountA === 0n || amountB === 0n}
          onClick={() => write.mutate({ address: addresses.amm, abi: ammAbi, functionName: 'addLiquidity', args: [amountA, amountB] })} // [6]
        >
          공급
        </button>
      )}

      {receipt.isLoading && <p>채굴 기다리는 중…</p>}
      {write.error && <p>실패: {write.error.message}</p>}
    </section>
  )
}


/** 유동성 회수: LP 입력(또는 전액) → 받을 A, B 미리보기 → removeLiquidity */
function RemoveLiquidity() {
  const connection = useConnection()
  const addresses = ADDRESSES[connection.chainId ?? 0]
  const me = connection.address
  const queryClient = useQueryClient()

  const [lpText, setLpText] = useState('')
  const lpAmount = toWei(lpText)

  // 풀 상태 (PoolInfo, AddLiquidity와 같은 목록 → 캐시 공유)
  const pool = useReadContracts({
    contracts: [
      { address: addresses?.amm, abi: ammAbi, functionName: 'reserveA' },
      { address: addresses?.amm, abi: ammAbi, functionName: 'reserveB' },
      { address: addresses?.amm, abi: ammAbi, functionName: 'totalSupply' },
    ],
    allowFailure: false,
    query: { enabled: !!addresses },
  })
  const [reserveA, reserveB, lpSupply] = pool.data ?? [0n, 0n, 0n]

  // 내 LP 잔액: LP 장부는 AMM 안에 있음
  const myLP = useReadContract({
    address: addresses?.amm,
    abi: tokenAbi, // balanceOf만 쓰니 ERC20 ABI로 충분
    functionName: 'balanceOf',
    args: me ? [me] : undefined,
    query: { enabled: !!addresses && !!me },
  })
  const myLPAmount = myLP.data ?? 0n

  // 받을 양 = 내 지분 비율 × 풀 잔액 (LP 총량이 0이면 나눗셈 불가)
  const outA = lpSupply === 0n ? 0n : (lpAmount * reserveA) / lpSupply // [2]
  const outB = lpSupply === 0n ? 0n : (lpAmount * reserveB) / lpSupply

  const write = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash: write.data })
  useEffect(() => {
    if (receipt.isSuccess) queryClient.invalidateQueries()
  }, [receipt.isSuccess, queryClient])
  const busy = write.isPending || receipt.isLoading

  if (!addresses || !me) return null

  return (
    <section>
      <h2>유동성 회수</h2>
      <p>내 LP: {formatUnits(myLPAmount, 18)}</p>
      <p>
        회수할 LP: <input value={lpText} onChange={(e) => setLpText(e.target.value)} placeholder="0.0" />
        <button onClick={() => setLpText(formatUnits(myLPAmount, 18))}>전액</button> {/* [3] */}
      </p>
      <p>받을 SW42 (A): {formatUnits(outA, 18)}</p>
      <p>받을 R2B (B): {formatUnits(outB, 18)}</p>

      <button
        disabled={busy || lpAmount === 0n || lpAmount > myLPAmount} // [4] 가진 것보다 많이 빼려 하면 막기
        onClick={() => write.mutate({ address: addresses.amm, abi: ammAbi, functionName: 'removeLiquidity', args: [lpAmount] })} // [5]
      >
        회수
      </button>

      {receipt.isLoading && <p>채굴 기다리는 중…</p>}
      {write.error && <p>실패: {write.error.message}</p>}
    </section>
  )
}
/** It is show with my NFTs */
function MyNFTs() {
  const connection = useConnection()
  const addresses = ADDRESSES[connection.chainId ?? 0]
  const me = connection.address
  
  const tokenIds = Array.from({ length: MAX_NFT_ID }, (_, i) => BigInt(i)) // 0~19까지 NFT ID 배열

  // NFT 소유 여부를 한 번에 읽기
  const owners = useReadContracts({
    contracts: tokenIds.map((id) => ({
      address: addresses?.nft,
      abi: nftAbi,
      functionName: 'ownerOf',
      args: [id],
    }) as const),
    allowFailure: true, // 소유하지 않은 NFT는 ownerOf가 실패하므로 allowFailure 필요
    query: { enabled: !!addresses },
  })

  // 소유한 NFT ID만 필터링
 const myIds = tokenIds.filter((_, i) => {
    const r = owners.data?.[i]
    return !!me && r?.status === 'success' && isAddressEqual(r.result, me) // [3]
  })
  // ① tokenURI (모든 NFT가 같은 URI라 첫 번째 것만 읽음)
  const uri = useReadContract({
    address: addresses?.nft,
    abi: nftAbi,
    functionName: 'tokenURI',
    args: myIds.length > 0 ? [myIds[0]] : undefined,
    query: { enabled: !!addresses && myIds.length > 0 },
  })


  // ②③ 메타데이터 JSON 가져오기 (블록체인이 아닌 일반 HTTP → useQuery 직접 사용)
  const metadata = useQuery({
    queryKey: ['nft-metadata', uri.data], // 캐시 이름표: URI가 같으면 다시 요청 안 함
    queryFn: async () => {
      const res = await fetch(ipfsToHttp(uri.data!))
      return (await res.json()) as { name: string; image: string }
    },
    enabled: !!uri.data, // [4] URI를 읽었을 때만
  })
  if (!addresses || !me) return null

  return (
    <section>
      <h2>내 NFT ({myIds.length}개)</h2>
      {myIds.map((id) => (
        <div key={id.toString()}> {/* [5] React key는 문자열/숫자만 됨 (bigint 불가) */}
          {metadata.data && <img src={ipfsToHttp(metadata.data.image)} width={120} alt={metadata.data.name} />}
          <p>
            {metadata.data?.name ?? 'NFT'} #{id.toString()}
          </p>
          <p>
            {metadata.data?.name ?? 'NFT'} #{id.toString()}
          </p>
          <ListNFTForm tokenId={id} /> {/* [6] */}
        </div>
      ))}
    </section>
  )
}

/** One NFT register form, each NFt draw in the web */
function ListNFTForm( { tokenId } : {tokenId: bigint}) {
  const connection = useConnection()
  const addresses = ADDRESSES[connection.chainId ?? 0]
  const queryClient = useQueryClient()

  const [priceText, setPriceText] = useState('')
  const [payWithA, setPayWithA] = useState(true) // true : SW42, false면 B
  const price = toWei(priceText)

  // approve

  const approved = useReadContract({
    address: addresses?.nft,
    abi: nftAbi,
    functionName: 'getApproved',
    args: [tokenId],
    query: { enabled: !!addresses },
  })
  const isApproved = !!addresses && !!approved.data && isAddressEqual(approved.data, addresses?.amm)

  const write = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash: write.data })
  useEffect(() => {
    if (receipt.isSuccess) queryClient.invalidateQueries()
  }, [receipt.isSuccess, queryClient])
const busy = write.isPending || receipt.isLoading

if (!addresses) return null
const paymentToken = payWithA ? addresses.tokenA : addresses.tokenB
return (
    <div>
      <input value={priceText} onChange={(e) => setPriceText(e.target.value)} placeholder="가격" />
      <select value={payWithA ? 'A' : 'B'} onChange={(e) => setPayWithA(e.target.value === 'A')}>
        <option value="A">SW42 (A)</option>
        <option value="B">R2B (B)</option>
      </select>

      {!isApproved ? (
        <button
          disabled={busy}
          onClick={() =>
            write.mutate({ address: addresses.nft, abi: nftAbi, functionName: 'approve', args: [addresses.amm, tokenId] }) // [4]
          }
        >
          NFT Approve
        </button>
      ) : (
        <button
          disabled={busy || price === 0n}
          onClick={() =>
            write.mutate({
              address: addresses.amm,
              abi: ammAbi,
              functionName: 'listNFT',
              args: [addresses.nft, tokenId, price, paymentToken], // [5]
            })
          }
        >
          판매 등록
        </button>
      )}

      {receipt.isLoading && <p>채굴 기다리는 중…</p>}
      {write.error && <p>실패: {write.error.message}</p>}
    </div>
  )
}


type Listing = { id: bigint; seller: Address; tokenId: bigint; price: bigint; paymentToken: Address }

/** Selling listings */
function Market(){
  const connection = useConnection()
  const addresses = ADDRESSES[connection.chainId ?? 0]

  const next = useReadContract({
    address: addresses?.amm,
    abi: ammAbi,
    functionName: 'nextListingId',
    query: { enabled: !!addresses },
  })
   // [0n, 1n, …, (n-1)n]  — Array.from의 length는 number여야 해서 bigint → number 변환
  const ids = Array.from ({ length: Number(next.data ?? 0n) }, (_, i) => BigInt(i)) 

  // each number's information 
  const raw = useReadContracts({
    contracts: ids.map((id) => ({
      address: addresses?.amm,
      abi: ammAbi,
      functionName: 'listings',
      args: [id],
    }) as const),
    allowFailure: false, // 존재하지 않는 listingId는 실패하므로 allowFailure 필요
    query: { enabled: !!addresses&& ids.length > 0 },

  })


    const active: Listing[] = (raw.data ?? []).map((l, i) => ({ id: ids[i],seller: l[0], tokenId: l[2], price: l[3], paymentToken: l[4], active: l[5] })).filter((l) => l.active)
  if (!addresses) return <p>이 체인에는 배포된 컨트렉트가 없습니다.</p>
  if (raw.isPending) return <p>마켓 정보 로딩 중...</p>
  if (raw.isError) return <p>읽기 실패: {raw.error.message}</p>
    return (
    <section>
      <h2>마켓 ({active.length}건)</h2>
      {active.map((l) => (
        <ListingCard key={l.id.toString()} listing={l} />
      ))}
    </section>
  )
  }

/** 판매 건 하나: 판매자에게는 취소, 다른 사람에게는 approve → 구매 */
function ListingCard({ listing }: { listing: Listing }) {
  const connection = useConnection()
  const addresses = ADDRESSES[connection.chainId ?? 0]
  const me = connection.address
  const queryClient = useQueryClient()

  const isSeller = !!me && isAddressEqual(listing.seller, me) // [5]

  // 구매자일 때만: 결제 토큰을 AMM에게 얼마나 허락했나
  const allowance = useReadContract({
    address: listing.paymentToken, // 결제 토큰 컨트랙트에 묻기 (SW42 또는 R2B)
    abi: tokenAbi,
    functionName: 'allowance',
    args: me && addresses ? [me, addresses.amm] : undefined,
    query: { enabled: !!me && !!addresses && !isSeller },
  })
  const needApprove = (allowance.data ?? 0n) < listing.price // [6]

  const write = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash: write.data })
  useEffect(() => {
    if (receipt.isSuccess) queryClient.invalidateQueries()
  }, [receipt.isSuccess, queryClient])
  const busy = write.isPending || receipt.isLoading

  if (!addresses || !me) return null
  const tokenName = isAddressEqual(listing.paymentToken, addresses.tokenA) ? 'SW42' : 'R2B'

  return (
    <div>
      <p>
        NFT #{listing.tokenId.toString()} · {formatUnits(listing.price, 18)} {tokenName}
      </p>

      {isSeller ? (
        <button
          disabled={busy}
          onClick={() => write.mutate({ address: addresses.amm, abi: ammAbi, functionName: 'cancelListing', args: [listing.id] })}
        >
          판매 취소
        </button>
      ) : needApprove ? (
        <button
          disabled={busy}
          onClick={() =>
            write.mutate({ address: listing.paymentToken, abi: tokenAbi, functionName: 'approve', args: [addresses.amm, listing.price] }) // [7]
          }
        >
          {tokenName} Approve
        </button>
      ) : (
        <button
          disabled={busy}
          onClick={() => write.mutate({ address: addresses.amm, abi: ammAbi, functionName: 'buyNFT', args: [listing.id] })} // [8]
        >
          구매
        </button>
      )}

      {receipt.isLoading && <p>채굴 기다리는 중…</p>}
      {write.error && <p>실패: {write.error.message}</p>}
    </div>
  )
}

export default function App() {
  return (
    <main>
      <h1>TokenZswap</h1>
      <WalletBar />
      <PoolInfo /> 
      <MyBalance />
      <Swap />
      <AddLiquidity />
      <RemoveLiquidity />
      <MyNFTs />
      <Market />
    </main>
  )
}
