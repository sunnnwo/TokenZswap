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
import Explorer from './explorer.tsx'



const SLIPPAGE_BPS = 100n // 1%
const MAX_NFT_ID = 20 // NFT IDs are 0–19; 20 and above do not exist



/** Shows wallet connection status with connect / switch chain / disconnect buttons. */
function WalletBar() {
  const connection = useConnection()   // current connection (address, chain, status)
  const connectors = useConnectors()   // connectors registered in config ([injected])
  const connect = useConnect()         // connect action
  const disconnect = useDisconnect()   // disconnect action
  const chains = useChains()           // chains registered in config
  const switchChain = useSwitchChain() // switch chain action

  // Not connected
  if (connection.status !== 'connected') {
    return (
      <div>
        {connectors.map((connector) => (
          <button
            key={connector.uid}
            disabled={connect.isPending}
            onClick={() => connect.mutate({ connector })}
          >
            Connect {connector.name}
          </button>
        ))}
        {connect.error && <p>Connection failed: {connect.error.message}</p>}
      </div>
    )
  }

  // Connected
  return (
    <div>
      <p>Address: {connection.address}</p>
      <p>Chain: {connection.chain?.name ?? `Unsupported chain (ID ${connection.chainId})`}</p>

      {chains.map((chain) => (
        <button
          key={chain.id}
          disabled={chain.id === connection.chainId || switchChain.isPending}
          onClick={() => switchChain.mutate({ chainId: chain.id })}
        >
          Switch to {chain.name}
        </button>
      ))}

      <button onClick={() => disconnect.mutate()}>Disconnect</button>
    </div>
  )
}
/** Shows the pool reserveA / reserveB / LP total supply and current price. */
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
      enabled: !!addresses, // skip reads on unsupported chains
    }
  })
  if (!addresses) return <p>No contracts deployed on this chain.</p>
  if (pool.isPending) return <p>Loading pool info…</p>
  if (pool.isError) return <p>Read failed: {pool.error.message}</p>

  const [reserveA, reserveB, lpSupply] = pool.data
  return (
    <div>
      <h2>Pool</h2>
      <p>SW42 (A): {formatUnits(reserveA, 18)}</p>
      <p>R2B (B): {formatUnits(reserveB, 18)}</p>
      <p>LP Total Supply: {formatUnits(lpSupply, 18)}</p>
      <p>Price: 1 A = {Number(formatUnits(reserveB, 18)) / Number(formatUnits(reserveA, 18))} B</p>
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
      { address: addresses?.amm, abi: tokenAbi, functionName: 'balanceOf', args: [me!] }, // LP balance lives in the AMM contract
    ],
    allowFailure: false,
    query: { enabled: !!addresses && !!me }, // only when the chain is supported and a wallet is connected
  })

  const faucet = useWriteContract()                                  // sign → tx hash
  const receipt = useWaitForTransactionReceipt({ hash: faucet.data }) // wait for the tx hash to be mined

  // Once mined, invalidate all queries so pool and balances refetch
  useEffect(() => {
    if (receipt.isSuccess) queryClient.invalidateQueries()
  }, [receipt.isSuccess, queryClient])

  if (!addresses || !me) return null
  if (balances.isPending) return <p>Loading balances…</p>
  if (balances.isError) return <p>Failed to read balances: {balances.error.message}</p>

  const [balA, balB, balLP] = balances.data
  const busy = faucet.isPending || receipt.isLoading // disable buttons while waiting for signature or mining

  return (
    <section>
      <h2>My Balance</h2>
      <p>SW42 (A): {formatUnits(balA, 18)}</p>
      <p>R2B (B): {formatUnits(balB, 18)}</p>
      <p>LP: {formatUnits(balLP, 18)}</p>

      <button
        disabled={busy}
        onClick={() => faucet.mutate({ address: addresses.tokenA, abi: tokenAbi, functionName: 'faucet' })}
      >
        Get 1000 A
      </button>
      <button
        disabled={busy}
        onClick={() => faucet.mutate({ address: addresses.tokenB, abi: tokenAbi, functionName: 'faucet' })}
      >
        Get 1000 B
      </button>

      {receipt.isLoading && <p>Waiting for confirmation…</p>}
      {faucet.error && <p>Failed: {faucet.error.message}</p>}
    </section>
  )
}

/**
 * 
 * Input string -> wei. Returns 0n if not a number
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
 * A <-> B swap: quote, approve, swap
 * 
 */

function Swap()
{
  const connection = useConnection()
  const addresses = ADDRESSES[connection.chainId ?? 0]

  const [aToB, setAToB] = useState(true) // true: A->B, false: B->A
  const [amountText, setAmountText] = useState('') // input text
  const amountIn = toWei(amountText) // input text -> wei

  const pool = useReadContracts({
    contracts:[
      {address: addresses?.amm, abi: ammAbi, functionName: 'reserveA'},
      {address: addresses?.amm, abi: ammAbi, functionName: 'reserveB'},
    ],
    allowFailure: false,
    query : {
      enabled: !!addresses, // skip reads on unsupported chains
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
      enabled: !!addresses && amountIn > 0n && reserveIn > 0n && reserveOut > 0n, // only when a quote is possible
    }
  })
  const amountOut = quote.data ?? 0n
  const minOut = (amountOut *(10_000n - SLIPPAGE_BPS)) / 10_000n // minimum received = quote * (1 - slippage)

  const me = connection.address
  const queryClient = useQueryClient()
  const tokenIn = aToB ? addresses?.tokenA : addresses?.tokenB

  const allowance = useReadContract({
    address: tokenIn,
    abi: tokenAbi,
    functionName: 'allowance',
    args: me && addresses ? [me, addresses.amm] : undefined,
    query: {
      enabled: !!addresses && !!me && amountIn > 0n, // only with a connected wallet
    }
  })
  const needApprove = (allowance.data ?? 0n) < amountIn

  const write = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash: write.data })

  useEffect(() => {
    if (receipt.isSuccess) queryClient.invalidateQueries()
  }, [receipt.isSuccess, queryClient])

  const busy = write.isPending || receipt.isLoading 

  if (!addresses) return <p>No contracts deployed on this chain.</p>
  
  const inName = aToB ? 'SW42 (A)' : 'R2B (B)'
  const outName = aToB ? 'R2B (B)' : 'SW42 (A)'
  
  return (
    <section>
      <h2>Swap</h2>
      <button onClick={() => setAToB(!aToB)}>Switch Direction</button>
      <p>
        {inName} Input: {' '}
        <input value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0.0" />
      </p>
      <p>{outName} Expected Output: {formatUnits(amountOut, 18)}</p>
      <p>Minimum Received (1% slippage): {formatUnits(minOut, 18)} {outName}</p>
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
      {receipt.isLoading && <p>Waiting for confirmation…</p>}
      {write.error && <p>Transaction failed: {write.error.message}</p>}
      {receipt.isError && <p>Mining failed: {receipt.error.message}</p>}
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
  const [textB, setTextB] = useState('') // only used for the first deposit
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
      enabled: !!addresses, // skip reads on unsupported chains
    }
  })
  const [reserveA, reserveB, lpSupply] = pool.data ?? [0n, 0n, 0n]
  const isFirst = lpSupply === 0n

  const amountB = isFirst ? toWei(textB) : (amountA * reserveB) / reserveA // textB is only used for the first deposit
  const expectedLP = isFirst ? 0n: (amountA * lpSupply) / reserveA
  
  const allowanceA = useReadContracts({
    contracts: [
      { address: addresses?.tokenA, abi: tokenAbi, functionName: 'allowance', args: me && addresses ? [me, addresses.amm] : undefined },
      { address: addresses?.tokenB, abi: tokenAbi, functionName: 'allowance', args: me && addresses ? [me, addresses.amm] : undefined },
    ],
    allowFailure: false,
    query: { enabled: !!addresses && !!me  }, // only with a connected wallet
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
      <h2>Add Liquidity</h2>
      <p>
        SW42 (A): <input value={textA} onChange={(e) => setTextA(e.target.value)} placeholder="0.0" />
      </p>
      {isFirst ? (
        <p>
          R2B (B): <input value={textB} onChange={(e) => setTextB(e.target.value)} placeholder="0.0" /> (first deposit sets the price)
        </p>
      ) : (
        <p>R2B (B): {formatUnits(amountB, 18)} (auto-calculated from pool ratio)</p>
      )}
      {!isFirst && <p>Expected LP: ≈ {formatUnits(expectedLP, 18)}</p>}

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
          onClick={() => write.mutate({ address: addresses.tokenB, abi: tokenAbi, functionName: 'approve', args: [addresses.amm, amountB] })}
        >
          Approve B
        </button>
      ) : (
        <button
          disabled={busy || amountA === 0n || amountB === 0n}
          onClick={() => write.mutate({ address: addresses.amm, abi: ammAbi, functionName: 'addLiquidity', args: [amountA, amountB] })}
        >
          Add Liquidity
        </button>
      )}

      {receipt.isLoading && <p>Waiting for confirmation…</p>}
      {write.error && <p>Failed: {write.error.message}</p>}
    </section>
  )
}


/** Remove liquidity: enter LP (or Max) → preview A, B received → removeLiquidity */
function RemoveLiquidity() {
  const connection = useConnection()
  const addresses = ADDRESSES[connection.chainId ?? 0]
  const me = connection.address
  const queryClient = useQueryClient()

  const [lpText, setLpText] = useState('')
  const lpAmount = toWei(lpText)

  // Pool state (same contract list as PoolInfo and AddLiquidity → shared cache)
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

  // My LP balance: the LP ledger lives in the AMM
  const myLP = useReadContract({
    address: addresses?.amm,
    abi: tokenAbi, // only balanceOf is needed, so the ERC20 ABI is enough
    functionName: 'balanceOf',
    args: me ? [me] : undefined,
    query: { enabled: !!addresses && !!me },
  })
  const myLPAmount = myLP.data ?? 0n

  // Amount received = my share × pool reserve (skip division when LP supply is 0)
  const outA = lpSupply === 0n ? 0n : (lpAmount * reserveA) / lpSupply
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
      <h2>Remove Liquidity</h2>
      <p>My LP: {formatUnits(myLPAmount, 18)}</p>
      <p>
        LP to Remove: <input value={lpText} onChange={(e) => setLpText(e.target.value)} placeholder="0.0" />
        <button onClick={() => setLpText(formatUnits(myLPAmount, 18))}>Max</button>
      </p>
      <p>SW42 (A) to Receive: {formatUnits(outA, 18)}</p>
      <p>R2B (B) to Receive: {formatUnits(outB, 18)}</p>

      <button
        disabled={busy || lpAmount === 0n || lpAmount > myLPAmount} // block removing more than I own
        onClick={() => write.mutate({ address: addresses.amm, abi: ammAbi, functionName: 'removeLiquidity', args: [lpAmount] })}
      >
        Remove
      </button>

      {receipt.isLoading && <p>Waiting for confirmation…</p>}
      {write.error && <p>Failed: {write.error.message}</p>}
    </section>
  )
}
/** It is show with my NFTs */
function MyNFTs() {
  const connection = useConnection()
  const addresses = ADDRESSES[connection.chainId ?? 0]
  const me = connection.address
  
  const tokenIds = Array.from({ length: MAX_NFT_ID }, (_, i) => BigInt(i)) // NFT IDs 0–19

  // Read every owner in one batch
  const owners = useReadContracts({
    contracts: tokenIds.map((id) => ({
      address: addresses?.nft,
      abi: nftAbi,
      functionName: 'ownerOf',
      args: [id],
    }) as const),
    allowFailure: true, // ownerOf reverts for nonexistent tokens, so allow failures
    query: { enabled: !!addresses },
  })

  // Keep only the IDs I own
 const myIds = tokenIds.filter((_, i) => {
    const r = owners.data?.[i]
    return !!me && r?.status === 'success' && isAddressEqual(r.result, me)
  })
  // tokenURI (all NFTs share the same URI, so read only the first)
  const uri = useReadContract({
    address: addresses?.nft,
    abi: nftAbi,
    functionName: 'tokenURI',
    args: myIds.length > 0 ? [myIds[0]] : undefined,
    query: { enabled: !!addresses && myIds.length > 0 },
  })


  // Fetch metadata JSON (plain HTTP, not on-chain → use useQuery directly)
  const metadata = useQuery({
    queryKey: ['nft-metadata', uri.data], // cache key: same URI is not refetched
    queryFn: async () => {
      const res = await fetch(ipfsToHttp(uri.data!))
      return (await res.json()) as { name: string; image: string }
    },
    enabled: !!uri.data, // only once the URI is loaded
  })
  if (!addresses || !me) return null

  return (
    <section>
      <h2>My NFTs ({myIds.length})</h2>
      {myIds.map((id) => (
        <div key={id.toString()}> {/* React keys must be strings or numbers (no bigint) */}
          {metadata.data && <img src={ipfsToHttp(metadata.data.image)} width={120} alt={metadata.data.name} />}
          <p>
            {metadata.data?.name ?? 'NFT'} #{id.toString()}
          </p>
          <p>
            {metadata.data?.name ?? 'NFT'} #{id.toString()}
          </p>
          <ListNFTForm tokenId={id} />
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
  const [payWithA, setPayWithA] = useState(true) // true: SW42 (A), false: R2B (B)
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
      <input value={priceText} onChange={(e) => setPriceText(e.target.value)} placeholder="Price" />
      <select value={payWithA ? 'A' : 'B'} onChange={(e) => setPayWithA(e.target.value === 'A')}>
        <option value="A">SW42 (A)</option>
        <option value="B">R2B (B)</option>
      </select>

      {!isApproved ? (
        <button
          disabled={busy}
          onClick={() =>
            write.mutate({ address: addresses.nft, abi: nftAbi, functionName: 'approve', args: [addresses.amm, tokenId] })
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
              args: [addresses.nft, tokenId, price, paymentToken],
            })
          }
        >
          List for Sale
        </button>
      )}

      {receipt.isLoading && <p>Waiting for confirmation…</p>}
      {write.error && <p>Failed: {write.error.message}</p>}
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
   // [0n, 1n, …, (n-1)n] — Array.from needs a number length, so convert bigint → number
  const ids = Array.from ({ length: Number(next.data ?? 0n) }, (_, i) => BigInt(i)) 

  // each number's information 
  const raw = useReadContracts({
    contracts: ids.map((id) => ({
      address: addresses?.amm,
      abi: ammAbi,
      functionName: 'listings',
      args: [id],
    }) as const),
    allowFailure: false, // a nonexistent listingId would revert
    query: { enabled: !!addresses&& ids.length > 0 },

  })


    const active: Listing[] = (raw.data ?? []).map((l, i) => ({ id: ids[i],seller: l[0], tokenId: l[2], price: l[3], paymentToken: l[4], active: l[5] })).filter((l) => l.active)
  if (!addresses) return <p>No contracts deployed on this chain.</p>
  if (raw.isPending) return <p>Loading market…</p>
  if (raw.isError) return <p>Read failed: {raw.error.message}</p>
    return (
    <section>
      <h2>Market ({active.length})</h2>
      {active.map((l) => (
        <ListingCard key={l.id.toString()} listing={l} />
      ))}
    </section>
  )
  }

/** A single listing: Cancel for the seller, approve → Buy for everyone else */
function ListingCard({ listing }: { listing: Listing }) {
  const connection = useConnection()
  const addresses = ADDRESSES[connection.chainId ?? 0]
  const me = connection.address
  const queryClient = useQueryClient()

  const isSeller = !!me && isAddressEqual(listing.seller, me)

  // Buyers only: how much payment token the AMM is allowed to spend
  const allowance = useReadContract({
    address: listing.paymentToken, // ask the payment token contract (SW42 or R2B)
    abi: tokenAbi,
    functionName: 'allowance',
    args: me && addresses ? [me, addresses.amm] : undefined,
    query: { enabled: !!me && !!addresses && !isSeller },
  })
  const needApprove = (allowance.data ?? 0n) < listing.price

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
          Cancel Listing
        </button>
      ) : needApprove ? (
        <button
          disabled={busy}
          onClick={() =>
            write.mutate({ address: listing.paymentToken, abi: tokenAbi, functionName: 'approve', args: [addresses.amm, listing.price] })
          }
        >
          {tokenName} Approve
        </button>
      ) : (
        <button
          disabled={busy}
          onClick={() => write.mutate({ address: addresses.amm, abi: ammAbi, functionName: 'buyNFT', args: [listing.id] })}
        >
          Buy
        </button>
      )}

      {receipt.isLoading && <p>Waiting for confirmation…</p>}
      {write.error && <p>Failed: {write.error.message}</p>}
    </div>
  )
}

export default function App() {
  const [tab, setTab] = useState<'trade' | 'explorer'>('trade') // one of two values
  return (
    <main>
      <h1>TokenZswap</h1>
      <nav>
        <button disabled={tab === 'trade'} onClick={() => setTab('trade')}>Trade</button>
        <button disabled={tab === 'explorer'} onClick={() => setTab('explorer')}>Explorer</button>
      </nav>
      {tab === 'trade' ?
      ( 
        <> 
        <WalletBar />
        <PoolInfo /> 
        <MyBalance />
        <Swap />
        <AddLiquidity />
        <RemoveLiquidity />
        <MyNFTs />
        <Market />
         
      </> 
      ) : (
        <Explorer />
      )
      }
    </main>
  )
}
