import { Address, BigInt } from '@graphprotocol/graph-ts'
import {
  AMM,
  LiquidityAdded,
  LiquidityRemoved,
  Swap as SwapEvent, // 이벤트 Swap과 엔티티 Swap의 이름이 같아서 이벤트 쪽 이름을 바꿈
  NFTListed,
  NFTListingCancelled,
  NFTSold,
} from '../generated/AMM/AMM'
import { Pool, Swap, LiquidityEvent, Listing } from '../generated/schema'

/** Pool을 불러오고, 없으면 처음 한 번 만든다 */
function getPool(address: Address): Pool {
  let pool = Pool.load(address)
  if (pool == null) {
    pool = new Pool(address)
    const amm = AMM.bind(address) // 매핑 안에서 컨트랙트 view 함수 호출
    pool.tokenA = amm.tokenA()
    pool.tokenB = amm.tokenB() // [1]
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
  pool.totalLiquidity = pool.totalLiquidity.plus(event.params.liquidity) // [2]
  pool.save()

  // 기록 1줄. id = tx 해시 + 로그 번호 (한 tx에 이벤트가 여러 개일 수 있어서)
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
  e.type = 'REMOVE' // [3]
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
    // A를 넣고 B를 받음
    pool.reserveA = pool.reserveA.plus(event.params.amountIn)
    pool.reserveB = pool.reserveB.minus(event.params.amountOut)
  } else {
    // B를 넣고 A를 받음
    pool.reserveB = pool.reserveB.plus(event.params.amountIn) // [4]
    pool.reserveA = pool.reserveA.minus(event.params.amountOut) // [5]
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
  const l = new Listing(event.params.listingId.toString()) // 판매 번호를 문자열 id로
  l.seller = event.params.seller
  l.nft = event.params.nft
  l.tokenId = event.params.tokenId
  l.paymentToken = event.params.paymentToken
  l.price = event.params.price
  l.status = 'ACTIVE' // [6]
  l.createdAt = event.block.timestamp
  l.save()
}

export function handleNFTListingCancelled(event: NFTListingCancelled): void {
  const l = Listing.load(event.params.listingId.toString())
  if (l == null) return // 이론상 없지만, 없으면 아무것도 안 함
  l.status = 'CANCELLED'
  l.save()
}

export function handleNFTSold(event: NFTSold): void {
  const l = Listing.load(event.params.listingId.toString())
  if (l == null) return
  l.status = 'SOLD'
  l.buyer = event.params.buyer // [7]
  l.save()
}
