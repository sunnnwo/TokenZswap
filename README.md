# TokenZswap

**English** · [한국어](README.ko.md)

A minimal decentralized exchange on **BNB Smart Chain testnet**: a constant-product AMM for two test tokens, a fixed-price NFT marketplace living in the same contract, a MetaMask frontend and a subgraph that indexes everything.

| Part | What it does |
|---|---|
| AMM pool | Swap SW42 ⇄ R2B with `x · y = k`, add liquidity for LP tokens, withdraw fully or partially. 3% swap fee. |
| NFT marketplace | List an ERC-721 at a fixed price in SW42 or R2B, cancel, or buy. The NFT is escrowed in the AMM contract. Independent of the pool. |
| Test tokens | Two ERC-20s with a public `faucet()` (1000 tokens per address per day). |
| Frontend | Vite + React + wagmi. Connect MetaMask, see balances, swap, provide/withdraw liquidity, list and buy NFTs. |
| Subgraph | Indexes pool state, swaps, liquidity events, listings and NFT ownership on The Graph (network `chapel`). |

---

## Deployed contracts (BSC testnet, chain id 97)

| Contract | Address |
|---|---|
| SW42 (Token A, `SunWoo42`) | [`0x3b9D1ecef6f5c137343A6C49D4a8f2447FAbaB10`](https://testnet.bscscan.com/address/0x3b9D1ecef6f5c137343A6C49D4a8f2447FAbaB10) |
| R2B (Token B, `TokenB` / "Ra2techB") | [`0x6CF255a2E7c5ec40D5CD36db887359d290E20A4d`](https://testnet.bscscan.com/address/0x6CF255a2E7c5ec40D5CD36db887359d290E20A4d) |
| AMM + marketplace (LP token `42TZT`) | [`0x0a1134046cECA785a218A92376fdb542cB9ACA52`](https://testnet.bscscan.com/address/0x0a1134046cECA785a218A92376fdb542cB9ACA52) |
| NFT (`TokenizeArt`, "42 Korean Hacker" / 42KH) | [`0x7DA2B6BC5330ad801427E6879201b079A774aB15`](https://testnet.bscscan.com/address/0x7DA2B6BC5330ad801427E6879201b079A774aB15) |

- Start block: `138043275` (see [`deployment/97.json`](deployment/97.json)).
- The deploy script seeded the pool with 10,000 SW42 + 40,000 R2B (initial price 1 SW42 = 4 R2B) and minted NFTs #0–#2.
- Subgraph (Subgraph Studio, network `chapel`): <https://api.studio.thegraph.com/query/1753818/tokenzswap/version/latest>

---

## Repository layout

```
.
├── README.md / README.ko.md
├── code/                    Foundry project
│   ├── src/                 SunWoo42.sol, tokenB.sol, AMM.sol, TokenizeArt.sol
│   ├── test/                AMM.t.sol (6 tests), NFTMarket.t.sol (8 tests)
│   ├── script/Deploy.s.sol  deploys everything, seeds the pool, writes deployment/<chainId>.json
│   └── subgraph/            The Graph subgraph (schema, manifest, mappings)
├── frontend/                Vite + React + wagmi app
├── deployment/              deployed addresses and start block per chain (31337 = local anvil, 97 = BSC testnet)
└── documentation/           architecture, limitations, subgraph notes, study guides
```

---

## Quick start (local)

Requirements: [Foundry](https://getfoundry.sh), Node.js 22+, MetaMask.

```bash
git clone --recurse-submodules <repo-url>
cd <repo>

# 1. Contracts: build and test
cd code
forge build
forge test                       # 14 tests

# 2. Local chain + deploy (new terminal for anvil)
anvil
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# 3. Frontend
cd ../frontend
npm install
npm run dev                      # http://localhost:5173
```

> The private key above is anvil's **public** default account #0. Use it only on a local anvil chain, never on a real network.

In MetaMask, add the network `http://127.0.0.1:8545` (chain id 31337) and import the anvil account, or switch to **BNB Smart Chain Testnet** to use the deployed contracts. The app has a button to switch chains.

Restarting anvil wipes its state: run the deploy script again (addresses stay the same) and clear MetaMask's activity data (Settings → Advanced) so the nonce matches.

---

## Deploying to BSC testnet

The deployer key is kept in an encrypted Foundry keystore, never in `.env`.

```bash
cast wallet import <name> --interactive        # once
cd code
# .env: BSC_TESTNET_RPC_URL=https://bsc-testnet-rpc.publicnode.com
forge script script/Deploy.s.sol --rpc-url bsc_testnet --account <name>                       # dry run
forge script script/Deploy.s.sol --rpc-url bsc_testnet --account <name> \
  --broadcast --legacy --with-gas-price 100000000                                            # 0.1 gwei
```

The full deployment used 9.23 M gas (≈ 0.00092 tBNB). The script writes `deployment/97.json`; copy those addresses into `frontend/src/contracts.ts`.

## Subgraph

```bash
cd code/subgraph
npm install
npx graph codegen && npx graph build
npx graph auth <DEPLOY_KEY>
npx graph deploy <subgraph-slug>
```

Example query:

```graphql
{
  pools { reserveA reserveB totalLiquidity swapCount }
  listings(where: { status: ACTIVE }) { id tokenId price paymentToken seller }
  nfts(where: { owner: "0x…" }) { id }        # addresses are lowercase in the subgraph
}
```

---

## How it works (short)

- **Swap**: `amountOut = amountIn·(1−fee)·reserveOut / (reserveIn + amountIn·(1−fee))`, fee = 300 bps. The caller passes `minAmountOut` (the frontend uses 1% slippage).
- **Liquidity**: first deposit mints `√(a·b)` LP; later deposits mint `min(a·L/x, b·L/y)`; withdrawing `lp` returns `lp·reserve/L` of each token.
- **Reserves** are an internal ledger, not `balanceOf`, so tokens sent directly to the contract cannot move the price.
- **Marketplace**: `listNFT` escrows the NFT in the AMM; `buyNFT` sends the payment straight from buyer to seller and the NFT to the buyer; `cancelListing` returns it. Pool reserves are never touched.
- Pool and marketplace functions are `nonReentrant` and follow checks-effects-interactions.

Details: [documentation/architecture.md](documentation/architecture.md) · Limitations: [documentation/known-limitations.md](documentation/known-limitations.md) · Subgraph: [documentation/subgraph.md](documentation/subgraph.md)

## Tests

```
forge test
AMM.t.sol        first deposit √(a·b), proportional deposit, partial withdrawal, zero-amount revert,
                 swap invariants (k does not decrease), slippage revert
NFTMarket.t.sol  listing escrow + storage, NFTListed event, cancel, buy (seller paid, pool untouched),
                 non-seller cancel revert, double buy revert, invalid payment token revert,
                 marketplace does not touch reserves
```

## Documentation

See [documentation/README.md](documentation/README.md) for the full index (English and Korean).
