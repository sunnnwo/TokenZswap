# Subgraph

**English** · [한국어](subgraph.ko.md) · Study guide (Korean): [subgraph-guide.pdf](subgraph-guide.pdf)

The subgraph indexes the AMM and the NFT collection on **BSC testnet (`chapel`)** and serves the result over GraphQL. Source: [`code/subgraph/`](../code/subgraph).

## Endpoint

Query URL (Subgraph Studio, development endpoint, rate-limited): <https://api.studio.thegraph.com/query/1753818/tokenzswap/version/latest>

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"query":"{ pools { reserveA reserveB swapCount } }"}' \
  https://api.studio.thegraph.com/query/1753818/tokenzswap/version/latest
```

## Why

Contract `view` functions only return the current state. They cannot answer list or history questions:

| Question | Without the subgraph | With the subgraph |
|---|---|---|
| Which NFTs does this address own? | call `ownerOf(0…19)` and filter | `nfts(where: { owner })` |
| Which listings are active? | read every `listings(i)` and filter | `listings(where: { status: ACTIVE })` |
| What swaps did I make? | not possible from state | `swaps(where: { trader })` |

## Files

| File | Role |
|---|---|
| `schema.graphql` | Entities (tables) |
| `subgraph.yaml` | Network, contract addresses, start block, event → handler mapping |
| `src/amm.ts`, `src/nft.ts` | Handlers (AssemblyScript) that turn events into entity updates |
| `abis/AMM.json`, `abis/TokenizeArt.json` | ABIs extracted from `code/out/` |

## Entities

| Entity | Mutable | id | Fields |
|---|---|---|---|
| `Pool` | yes | AMM address | tokenA, tokenB, reserveA, reserveB, totalLiquidity, swapCount |
| `Swap` | no | tx hash + log index | trader, tokenIn, amountIn, amountOut, timestamp, txHash |
| `LiquidityEvent` | no | tx hash + log index | type (`ADD` / `REMOVE`), provider, amountA, amountB, liquidity, timestamp |
| `Listing` | yes | listingId | seller, nft, tokenId, paymentToken, price, status (`ACTIVE` / `SOLD` / `CANCELLED`), buyer, createdAt |
| `Nft` | yes | tokenId | owner |

## Event handlers

| Data source | Event | Handler | Update |
|---|---|---|---|
| AMM | `LiquidityAdded` | `handleLiquidityAdded` | Pool reserves and totalLiquidity +; new LiquidityEvent ADD |
| AMM | `LiquidityRemoved` | `handleLiquidityRemoved` | Pool −; new LiquidityEvent REMOVE |
| AMM | `Swap` | `handleSwap` | if tokenIn = tokenA: reserveA += in, reserveB −= out (else the reverse); swapCount++; new Swap |
| AMM | `NFTListed` | `handleNFTListed` | new Listing, status ACTIVE |
| AMM | `NFTListingCancelled` | `handleNFTListingCancelled` | status CANCELLED |
| AMM | `NFTSold` | `handleNFTSold` | status SOLD, buyer set |
| TokenizeArt | `Transfer(indexed address,indexed address,indexed uint256)` | `handleTransfer` | Nft.owner = to (created on mint) |

Notes:

- The pool state is **rebuilt from events only**. The single contract call is `AMM.bind(address).tokenA()/tokenB()` the first time the Pool is created, so `handleSwap` can tell the direction.
- LP total supply is tracked from `LiquidityAdded` / `LiquidityRemoved`, the only places LP is minted or burned, so the AMM's own ERC-20 `Transfer` is not needed.
- `startBlock` (138043275) is earlier than the deployment block (138043296). Starting later would miss the initial `LiquidityAdded` and the three NFT mints, and every later value would be wrong.
- Event signatures in `subgraph.yaml` must match the ABI exactly, including `indexed`. ERC-20 and ERC-721 `Transfer` share topic0. The ERC-721 one has `tokenId` indexed.

## Verified against the chain

| Moment | Subgraph | Contract `view` |
|---|---|---|
| After deployment | reserves 10000e18 / 40000e18, LP 20000e18, NFTs #0–#2 owned by the deployer | identical |
| After listing #0 for 20 SW42 | Listing "0" ACTIVE, Nft "0" owner = AMM | `listings(0)` active, `ownerOf(0)` = AMM |
| After swapping 100 SW42 | reserveA `10100000000000000000000`, reserveB `39615727443795186689116`, swapCount 1 | identical to the wei |

## Build and deploy

```bash
cd code/subgraph
npm install
npx graph codegen          # generated/ types from ABIs and schema
npx graph build            # compile mappings to WebAssembly
npx graph auth <DEPLOY_KEY>
npx graph deploy <slug>    # asks for a version label, e.g. v0.0.1
```

Log in to Subgraph Studio with the wallet on an Ethereum network (we used Sepolia). Signing in while MetaMask was on BSC testnet failed with an authentication error. The indexed network is set in `subgraph.yaml` (`chapel`), independently of the login network.

## Example queries

```graphql
{
  pools { reserveA reserveB totalLiquidity swapCount }
  swaps(first: 10, orderBy: timestamp, orderDirection: desc) { trader tokenIn amountIn amountOut }
  listings(where: { status: ACTIVE }) { id tokenId price paymentToken seller }
  nfts(where: { owner: "0x8124b5bee7b8fac709eadd329c9e7c7666289619" }) { id }
}
```

Addresses are stored lowercase, so filters must use lowercase addresses.
