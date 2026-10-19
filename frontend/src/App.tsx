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

import { formatUnits, parseUnits } from 'viem'
import { ADDRESSES, ammAbi } from './contracts.ts'

import { useEffect, useState} from 'react'
import { tokenAbi } from './contracts.ts'
import { useQueryClient } from '@tanstack/react-query'

const SLIPPAGE_BPS = 100n // 1%

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

export default function App() {
  return (
    <main>
      <h1>TokenZswap</h1>
      <WalletBar />
      <PoolInfo /> 
      <MyBalance />
      <Swap />
    </main>
  )
}
