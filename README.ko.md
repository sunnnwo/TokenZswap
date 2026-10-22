# TokenZswap

[English](README.md) · **한국어**

**BNB Smart Chain 테스트넷** 위의 작은 탈중앙 거래소입니다. 테스트 토큰 두 개를 위한 상수곱 AMM, 같은 컨트랙트 안의 고정가 NFT 마켓, MetaMask 프론트엔드, 그리고 이 모든 것을 인덱싱하는 서브그래프로 구성됩니다.

| 구성 | 하는 일 |
|---|---|
| AMM 풀 | `x · y = k`로 SW42 ⇄ R2B 교환, 유동성 공급(LP 토큰 발행), 전액 또는 일부 회수. 수수료 3% |
| NFT 마켓 | ERC-721을 SW42 또는 R2B 고정가로 등록, 취소, 구매. 판매 중인 NFT는 AMM 컨트랙트가 보관(escrow). 풀과 독립 |
| 테스트 토큰 | 누구나 쓸 수 있는 `faucet()`이 있는 ERC-20 두 개 (주소당 하루 1000개) |
| 프론트엔드 | Vite + React + wagmi. MetaMask 연결, 잔액, swap, 유동성 공급/회수, NFT 등록과 구매 |
| 서브그래프 | 풀 상태, swap, 유동성 기록, 판매 건, NFT 소유자를 The Graph에서 인덱싱 (네트워크 `chapel`) |

---

## 배포된 컨트랙트 (BSC 테스트넷, chain id 97)

| 컨트랙트 | 주소 |
|---|---|
| SW42 (Token A, `SunWoo42`) | [`0x3b9D1ecef6f5c137343A6C49D4a8f2447FAbaB10`](https://testnet.bscscan.com/address/0x3b9D1ecef6f5c137343A6C49D4a8f2447FAbaB10) |
| R2B (Token B, `TokenB` / "Ra2techB") | [`0x6CF255a2E7c5ec40D5CD36db887359d290E20A4d`](https://testnet.bscscan.com/address/0x6CF255a2E7c5ec40D5CD36db887359d290E20A4d) |
| AMM + 마켓 (LP 토큰 `42TZT`) | [`0x0a1134046cECA785a218A92376fdb542cB9ACA52`](https://testnet.bscscan.com/address/0x0a1134046cECA785a218A92376fdb542cB9ACA52) |
| NFT (`TokenizeArt`, "42 Korean Hacker" / 42KH) | [`0x7DA2B6BC5330ad801427E6879201b079A774aB15`](https://testnet.bscscan.com/address/0x7DA2B6BC5330ad801427E6879201b079A774aB15) |

- 시작 블록: `138043275` ([`deployment/97.json`](deployment/97.json) 참고)
- 배포 스크립트가 풀에 SW42 10,000 + R2B 40,000을 넣었고(초기 가격 1 SW42 = 4 R2B), NFT #0~#2를 발행했습니다.
- 서브그래프 (Subgraph Studio, 네트워크 `chapel`): <https://api.studio.thegraph.com/query/1753818/tokenzswap/version/latest>

---

## 저장소 구조

```
.
├── README.md / README.ko.md
├── code/                    Foundry 프로젝트
│   ├── src/                 SunWoo42.sol, tokenB.sol, AMM.sol, TokenizeArt.sol
│   ├── test/                AMM.t.sol (6개), NFTMarket.t.sol (8개)
│   ├── script/Deploy.s.sol  전체 배포, 풀 초기 유동성, deployment/<chainId>.json 기록
│   └── subgraph/            The Graph 서브그래프 (스키마, 매니페스트, 매핑)
├── frontend/                Vite + React + wagmi 앱
├── deployment/              체인별 배포 주소와 시작 블록 (31337 = 로컬 anvil, 97 = BSC 테스트넷)
└── documentation/           구조 설명, 한계, 서브그래프 노트, 학습 가이드
```

---

## 빠른 시작 (로컬)

필요한 것: [Foundry](https://getfoundry.sh), Node.js 22 이상, MetaMask

```bash
git clone --recurse-submodules <repo-url>
cd <repo>

# 1. 컨트랙트 빌드와 테스트
cd code
forge build
forge test                       # 테스트 14개

# 2. 로컬 체인 + 배포 (anvil은 새 터미널에서)
anvil
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# 3. 프론트엔드
cd ../frontend
npm install
npm run dev                      # http://localhost:5173
```

> 위 개인키는 anvil 기본 계정 #0의 **공개된** 키입니다. 로컬 anvil에서만 쓰고, 실제 네트워크에서는 절대 쓰지 마세요.

MetaMask에 `http://127.0.0.1:8545`(chain id 31337) 네트워크를 추가하고 anvil 계정을 가져오거나, **BNB Smart Chain Testnet**으로 바꿔 배포된 컨트랙트를 쓰면 됩니다. 앱에 체인 전환 버튼이 있습니다.

anvil을 다시 켜면 상태가 모두 사라집니다. 배포 스크립트를 다시 실행하고(주소는 같게 나옴), MetaMask의 활동 데이터를 지워야(설정 → 고급) nonce가 맞습니다.

---

## BSC 테스트넷 배포

배포자 키는 `.env`가 아니라 암호화된 Foundry keystore에 보관합니다.

```bash
cast wallet import <이름> --interactive        # 한 번만
cd code
# .env: BSC_TESTNET_RPC_URL=https://bsc-testnet-rpc.publicnode.com
forge script script/Deploy.s.sol --rpc-url bsc_testnet --account <이름>                       # 리허설
forge script script/Deploy.s.sol --rpc-url bsc_testnet --account <이름> \
  --broadcast --legacy --with-gas-price 100000000                                            # 0.1 gwei
```

전체 배포에 가스 923만(약 0.00092 tBNB)이 들었습니다. 스크립트가 `deployment/97.json`을 기록하면, 그 주소를 `frontend/src/contracts.ts`에 옮겨 적습니다.

## 서브그래프

```bash
cd code/subgraph
npm install
npx graph codegen && npx graph build
npx graph auth <DEPLOY_KEY>
npx graph deploy <서브그래프-slug>
```

쿼리 예시:

```graphql
{
  pools { reserveA reserveB totalLiquidity swapCount }
  listings(where: { status: ACTIVE }) { id tokenId price paymentToken seller }
  nfts(where: { owner: "0x…" }) { id }        # 서브그래프의 주소는 소문자
}
```

---

## 동작 원리 (요약)

- **Swap**: `받는 양 = 넣는 양·(1−수수료)·reserveOut / (reserveIn + 넣는 양·(1−수수료))`, 수수료 300 bps. 호출자가 `minAmountOut`을 넘깁니다(프론트는 슬리피지 1%).
- **유동성**: 첫 공급은 LP `√(a·b)`, 이후 공급은 `min(a·L/x, b·L/y)`, `lp`만큼 회수하면 각 토큰을 `lp·reserve/L`만큼 돌려받습니다.
- **reserve**는 `balanceOf`가 아닌 내부 장부라서, 컨트랙트에 토큰을 직접 보내도 가격이 움직이지 않습니다.
- **마켓**: `listNFT`가 NFT를 AMM에 맡기고, `buyNFT`는 대금을 구매자에게서 판매자에게 바로 보내고 NFT를 구매자에게 넘기며, `cancelListing`은 NFT를 돌려줍니다. 풀 reserve는 건드리지 않습니다.
- 풀과 마켓 함수는 모두 `nonReentrant`이고 checks-effects-interactions 순서를 따릅니다.

자세히: [documentation/architecture.ko.md](documentation/architecture.ko.md) · 한계: [documentation/known-limitations.ko.md](documentation/known-limitations.ko.md) · 서브그래프: [documentation/subgraph.ko.md](documentation/subgraph.ko.md)

## 테스트

```
forge test
AMM.t.sol        첫 공급 √(a·b), 비율 공급, 일부 회수, 0 입력 revert,
                 swap 불변식 (k가 줄지 않음), 슬리피지 revert
NFTMarket.t.sol  등록 시 escrow와 저장, NFTListed 이벤트, 취소, 구매 (판매자 수령, 풀 불변),
                 판매자 아닌 사람의 취소 revert, 중복 구매 revert, 잘못된 결제 토큰 revert,
                 마켓이 reserve를 건드리지 않음
```

## 문서

전체 목록은 [documentation/README.md](documentation/README.md)에 있습니다 (영어, 한국어).
