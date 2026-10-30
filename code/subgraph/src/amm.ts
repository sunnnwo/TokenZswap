import { Address, BigInt } from '@graphprotocol/graph-ts'
import {
  AMM,
  LiquidityAdded,
  LiquidityRemoved,
  Swap as SwapEvent, // Renamed because the Swap event and the Swap entity share a name
  NFTListed,
  NFTListingCancelled,
  NFTSold,
} from '../generated/AMM/AMM'
import { Pool, Swap, LiquidityEvent, Listing } from '../generated/schema'

/** Load the Pool, creating it once if it does not exist yet */
function getPool(address: Address): Pool {
  let pool = Pool.load(address)
  if (pool == null) {
    pool = new Pool(address)
    const amm = AMM.bind(address) // Call contract view functions from inside the mapping
    pool.tokenA = amm.tokenA()
    pool.tokenB = amm.tokenB()
    pool.reserveA = BigInt.zero()
    pool.reserveB = BigInt.zero()
    pool.totalLiquidity = BigInt.zero()
    pool.swapCount = BigInt.zero()
  }
  return pool
}

export function handleLiquidityAdded(event: LiquidityAdded): void {
  const pool = getPool(event.address)
  pool.reserveA = pool.reserveA.plus(event.params.amountA)
  pool.reserveB = pool.reserveB.plus(event.params.amountB)
  pool.totalLiquidity = pool.totalLiquidity.plus(event.params.liquidity)
  pool.save()

  // One record per event. id = tx hash + log index (a tx can emit several events)
  const e = new LiquidityEvent(event.transaction.hash.concatI32(event.logIndex.toI32()))
  e.type = 'ADD'
  e.provider = event.params.provider
  e.amountA = event.params.amountA
  e.amountB = event.params.amountB
  e.liquidity = event.params.liquidity
  e.timestamp = event.block.timestamp
  e.save()
}

export function handleLiquidityRemoved(event: LiquidityRemoved): void {
  const pool = getPool(event.address)
  pool.reserveA = pool.reserveA.minus(event.params.amountA)
  pool.reserveB = pool.reserveB.minus(event.params.amountB)
  pool.totalLiquidity = pool.totalLiquidity.minus(event.params.liquidity)
  pool.save()

  const e = new LiquidityEvent(event.transaction.hash.concatI32(event.logIndex.toI32()))
  e.type = 'REMOVE'
  e.provider = event.params.provider
  e.amountA = event.params.amountA
  e.amountB = event.params.amountB
  e.liquidity = event.params.liquidity
  e.timestamp = event.block.timestamp
  e.save()
}

export function handleSwap(event: SwapEvent): void {
  const pool = getPool(event.address)
  if (event.params.tokenIn.equals(pool.tokenA)) {
    // A in, B out
    pool.reserveA = pool.reserveA.plus(event.params.amountIn)
    pool.reserveB = pool.reserveB.minus(event.params.amountOut)
  } else {
    // B in, A out
    pool.reserveB = pool.reserveB.plus(event.params.amountIn)
    pool.reserveA = pool.reserveA.minus(event.params.amountOut)
  }
  pool.swapCount = pool.swapCount.plus(BigInt.fromI32(1))
  pool.save()

  const s = new Swap(event.transaction.hash.concatI32(event.logIndex.toI32()))
  s.trader = event.params.trader
  s.tokenIn = event.params.tokenIn
  s.amountIn = event.params.amountIn
  s.amountOut = event.params.amountOut
  s.timestamp = event.block.timestamp
  s.txHash = event.transaction.hash
  s.save()
}

export function handleNFTListed(event: NFTListed): void {
  const l = new Listing(event.params.listingId.toString()) // Use the listing number as a string id
  l.seller = event.params.seller
  l.nft = event.params.nft
  l.tokenId = event.params.tokenId
  l.paymentToken = event.params.paymentToken
  l.price = event.params.price
  l.status = 'ACTIVE'
  l.createdAt = event.block.timestamp
  l.save()
}

export function handleNFTListingCancelled(event: NFTListingCancelled): void {
  const l = Listing.load(event.params.listingId.toString())
  if (l == null) return // Should not happen; do nothing if it does
  l.status = 'CANCELLED'
  l.save()
}

export function handleNFTSold(event: NFTSold): void {
  const l = Listing.load(event.params.listingId.toString())
  if (l == null) return
  l.status = 'SOLD'
  l.buyer = event.params.buyer
  l.save()
}
