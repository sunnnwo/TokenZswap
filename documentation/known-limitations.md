# Known limitations

**English** · [한국어](known-limitations.ko.md)

TokenZswap is a learning project deployed on testnets. The points below are known and accepted. Each one lists a possible fix.

## AMM pool

| Limitation | Effect | Possible fix |
|---|---|---|
| Single pair, fixed fee | One pool (SW42/R2B), fee hard-coded to 3% (`FEE_BPS = 300`) | Factory contract creating pairs; fee set per pool |
| Excess of an unbalanced deposit is not refunded | `addLiquidity` takes both amounts in full but mints LP on the smaller side (`min`). The excess stays in the pool and goes to existing LPs. Example: depositing 1000 A + 500 B into a 1:4 pool mints 250 LP and loses ≈ 864 A of value. The frontend avoids this by computing B from the pool ratio | Router that computes the optimal amounts and only pulls those |
| No slippage bound on withdrawals | `removeLiquidity(lp)` has no `amountAMin` / `amountBMin`. A large swap mined just before can change the A:B ratio received | Add minimum amounts |
| No deadline | `swap` and `removeLiquidity` have no expiry. A transaction left pending can execute much later | `deadline` parameter (`require(block.timestamp <= deadline)`) |
| No `MINIMUM_LIQUIDITY` lock | Uniswap V2 burns the first 1000 LP units. Here the first depositor gets all of `√(a·b)`. The usual first-depositor inflation attack relies on donating tokens to the pool, which the internal reserve ledger ignores, so the risk is reduced, not formally removed | Burn a small amount on the first deposit |
| Donated tokens are stuck | Tokens sent directly to the contract are not in the reserves, and there is no `skim` / `sync` | Owner-less `skim(to)` that sends `balanceOf − reserve` |
| Non-standard tokens unsupported | Fee-on-transfer or rebasing tokens would make the reserves differ from real balances | Measure received amounts by balance difference |
| Spot price only | The price is `reserveB / reserveA` right now. It can be moved within one block, so it must not be used as an oracle | Time-weighted average price (TWAP) accumulators |
| Two transactions per swap | Users approve, then swap. The tokens support EIP-2612 `permit`, but the AMM has no `…WithPermit` functions | `swapWithPermit(…, deadline, v, r, s)` |

## NFT marketplace

| Limitation | Effect | Possible fix |
|---|---|---|
| Any ERC-721 can be listed | `listNFT` accepts any `nft` address, so someone can list a token from a fake collection. The frontend only shows our collection, but the contract is open | Allowlist of NFT contracts, or show and verify the contract address in the UI |
| Price cannot be changed | Cancel and relist instead (the new listing gets a new id) | `updatePrice(id, newPrice)` |
| No expiry | A listing stays active until it is sold or cancelled | `expiresAt` field |
| No royalties or marketplace fee | Sellers receive the full price | ERC-2981 royalties, protocol fee |
| A seller can buy their own listing | Not blocked (pays themselves, no gain) | `require(msg.sender != seller)` |
| Listing discovery is on-chain scanning | The frontend reads `listings(0 … n−1)` and filters active ones | Use the subgraph (`listings(where: { status: ACTIVE })`) |

## Tokens and NFT

| Limitation | Effect | Possible fix |
|---|---|---|
| Unlimited owner mint | The owner of SW42 / R2B can mint any amount, and therefore drain the pool by selling | Supply cap (`ERC20Capped`), multisig owner, or `renounceOwnership` |
| Faucet can be farmed | The 1-day cooldown is per address; new wallets bypass it | Acceptable: the tokens have no value |
| One metadata URI for every NFT | All tokens show the same image | Per-token metadata (`baseURI + tokenId`) |
| Metadata depends on IPFS availability | The content cannot be changed (CID = hash), but it disappears if nobody pins it, and public gateways can be rate-limited (we hit HTTP 429 on `ipfs.io` and switched to `gateway.pinata.cloud`) | Pin on several services |

## Frontend

| Limitation | Effect | Possible fix |
|---|---|---|
| "My NFTs" scans ids 0–19 | `TokenizeArt` has no enumeration and `_nextTokenId` is private, so tokens ≥ 20 are not shown | Query the subgraph (`nfts(where: { owner })`) |
| Only per-token approval is checked | `ListNFTForm` reads `getApproved`, so a user who used `setApprovalForAll` still sees an Approve button | Also read `isApprovedForAll` |
| Long error messages | viem's full `error.message` is displayed | Show `shortMessage` |
| Exact-amount approvals | Every swap / deposit / purchase needs a fresh approve (safer, but one extra popup) | Optional "approve max" toggle |
| Trade tab still reads the chain | The Explorer tab uses the indexed data (via the cache server), but the Trade tab's "My NFTs" and market list still scan the contract | Read them from `/api/nfts?owner=` and `/api/listings?status=ACTIVE` |

## Deployment and operations

| Limitation | Effect |
|---|---|
| Not upgradeable | Bugs require a redeploy and new addresses (frontend, subgraph and liquidity must be updated) |
| Testnet only | BSC testnet (chain 97) is deployed. Sepolia is configured in the frontend and Foundry but not deployed |
| Contracts not verified on BscScan | Source code is not published on the explorer yet (`forge verify-contract` with an API key) |
| Web server limitations | HTTP only, Studio dependency, 20-row lists: see [cache-server.md](cache-server.md#limitations) |
