# 서브그래프

[English](subgraph.md) · **한국어** · 학습 가이드: [subgraph-guide.pdf](subgraph-guide.pdf)

서브그래프는 **BSC 테스트넷(`chapel`)**의 AMM과 NFT 컬렉션을 인덱싱하고, 그 결과를 GraphQL로 제공합니다. 소스: [`code/subgraph/`](../code/subgraph)

## 쿼리 주소

Query URL (Subgraph Studio 개발용 주소, 사용량 제한 있음): <https://api.studio.thegraph.com/query/1753818/tokenzswap/version/latest>

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"query":"{ pools { reserveA reserveB swapCount } }"}' \
  https://api.studio.thegraph.com/query/1753818/tokenzswap/version/latest
```

## 왜 필요한가

컨트랙트의 `view` 함수는 현재 상태만 돌려줍니다. 목록이나 기록을 묻는 질문에는 답하지 못합니다.

| 질문 | 서브그래프 없이 | 서브그래프로 |
|---|---|---|
| 이 주소가 가진 NFT는? | `ownerOf(0…19)`를 다 부르고 거름 | `nfts(where: { owner })` |
| 판매 중인 건은? | `listings(i)`를 전부 읽고 거름 | `listings(where: { status: ACTIVE })` |
| 내가 한 swap은? | 상태로는 불가능 | `swaps(where: { trader })` |

## 파일

| 파일 | 역할 |
|---|---|
| `schema.graphql` | 엔티티(테이블) |
| `subgraph.yaml` | 네트워크, 컨트랙트 주소, 시작 블록, 이벤트 → 핸들러 연결 |
| `src/amm.ts`, `src/nft.ts` | 이벤트를 엔티티 변경으로 바꾸는 핸들러 (AssemblyScript) |
| `abis/AMM.json`, `abis/TokenizeArt.json` | `code/out/`에서 추출한 ABI |

## 엔티티

| 엔티티 | 수정 가능 | id | 칸 |
|---|---|---|---|
| `Pool` | 예 | AMM 주소 | tokenA, tokenB, reserveA, reserveB, totalLiquidity, swapCount |
| `Swap` | 아니오 | tx 해시 + 로그 번호 | trader, tokenIn, amountIn, amountOut, timestamp, txHash |
| `LiquidityEvent` | 아니오 | tx 해시 + 로그 번호 | type (`ADD` / `REMOVE`), provider, amountA, amountB, liquidity, timestamp |
| `Listing` | 예 | listingId | seller, nft, tokenId, paymentToken, price, status (`ACTIVE` / `SOLD` / `CANCELLED`), buyer, createdAt |
| `Nft` | 예 | tokenId | owner |

## 이벤트 핸들러

| 데이터 소스 | 이벤트 | 핸들러 | 변경 |
|---|---|---|---|
| AMM | `LiquidityAdded` | `handleLiquidityAdded` | Pool의 reserve와 totalLiquidity +; LiquidityEvent ADD 생성 |
| AMM | `LiquidityRemoved` | `handleLiquidityRemoved` | Pool −; LiquidityEvent REMOVE 생성 |
| AMM | `Swap` | `handleSwap` | tokenIn = tokenA면 reserveA += in, reserveB −= out (아니면 반대); swapCount++; Swap 생성 |
| AMM | `NFTListed` | `handleNFTListed` | Listing 생성, status ACTIVE |
| AMM | `NFTListingCancelled` | `handleNFTListingCancelled` | status CANCELLED |
| AMM | `NFTSold` | `handleNFTSold` | status SOLD, buyer 기록 |
| TokenizeArt | `Transfer(indexed address,indexed address,indexed uint256)` | `handleTransfer` | Nft.owner = to (발행이면 새로 생성) |

메모:

- 풀 상태는 **이벤트만으로 재구성**합니다. 컨트랙트 호출은 Pool을 처음 만들 때의 `AMM.bind(address).tokenA()/tokenB()` 한 번뿐이고, `handleSwap`이 방향을 구분하는 데 씁니다.
- LP 총량은 LP가 생기고 사라지는 유일한 곳인 `LiquidityAdded` / `LiquidityRemoved`로 추적합니다. 그래서 AMM의 ERC-20 `Transfer`는 듣지 않습니다.
- `startBlock`(138043275)은 배포 블록(138043296)보다 앞입니다. 뒤로 잡으면 초기 `LiquidityAdded`와 NFT 발행 3건을 놓치고, 이후 모든 값이 틀어집니다.
- `subgraph.yaml`의 이벤트 시그니처는 `indexed`까지 ABI와 정확히 같아야 합니다. ERC-20과 ERC-721의 `Transfer`는 topic0이 같고, ERC-721은 `tokenId`가 indexed입니다.

## 체인과 대조한 결과

| 시점 | 서브그래프 | 컨트랙트 `view` |
|---|---|---|
| 배포 직후 | reserve 10000e18 / 40000e18, LP 20000e18, NFT #0~#2 주인 = 배포자 | 동일 |
| #0을 20 SW42에 등록한 뒤 | Listing "0" ACTIVE, Nft "0" 주인 = AMM | `listings(0)` active, `ownerOf(0)` = AMM |
| SW42 100 swap 뒤 | reserveA `10100000000000000000000`, reserveB `39615727443795186689116`, swapCount 1 | wei까지 동일 |

## 빌드와 배포

```bash
cd code/subgraph
npm install
npx graph codegen          # ABI와 스키마로 generated/ 타입 생성
npx graph build            # 매핑을 WebAssembly로 컴파일
npx graph auth <DEPLOY_KEY>
npx graph deploy <slug>    # 버전 이름을 물어봄 (예: v0.0.1)
```

Subgraph Studio에는 MetaMask를 이더리움 계열 네트워크(우리는 Sepolia)에 둔 채로 로그인합니다. BSC 테스트넷에 둔 채로 로그인하면 인증 에러가 났습니다. 인덱싱할 네트워크는 로그인 네트워크와 상관없이 `subgraph.yaml`(`chapel`)에서 정합니다.

## 쿼리 예시

```graphql
{
  pools { reserveA reserveB totalLiquidity swapCount }
  swaps(first: 10, orderBy: timestamp, orderDirection: desc) { trader tokenIn amountIn amountOut }
  listings(where: { status: ACTIVE }) { id tokenId price paymentToken seller }
  nfts(where: { owner: "0x8124b5bee7b8fac709eadd329c9e7c7666289619" }) { id }
}
```

주소는 소문자로 저장되므로, 필터에도 소문자 주소를 써야 합니다.
