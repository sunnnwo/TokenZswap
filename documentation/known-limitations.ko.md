# 알려진 한계

[English](known-limitations.md) · **한국어**

TokenZswap은 테스트넷에 배포한 학습용 프로젝트입니다. 아래 항목은 알고 있고 받아들인 한계이며, 각각 개선 방법을 함께 적었습니다.

## AMM 풀

| 한계 | 영향 | 개선 방법 |
|---|---|---|
| 풀 1개, 수수료 고정 | SW42/R2B 풀 하나, 수수료는 3%로 고정 (`FEE_BPS = 300`) | 풀을 만들어 주는 Factory 컨트랙트, 풀마다 수수료 설정 |
| 비율이 안 맞는 입금의 초과분을 돌려주지 않음 | `addLiquidity`는 두 양을 모두 가져가지만 LP는 적은 쪽 기준(`min`)으로 발행. 초과분은 풀에 남아 기존 LP 몫이 됨. 예: 1:4 풀에 A 1000 + B 500을 넣으면 LP 250을 받고 A 약 864개 가치를 잃음. 프론트는 B를 풀 비율로 자동 계산해서 이를 막음 | 최적 양을 계산해 그만큼만 가져가는 Router |
| 회수에 슬리피지 하한이 없음 | `removeLiquidity(lp)`에 `amountAMin` / `amountBMin`이 없음. 직전에 큰 swap이 들어오면 받는 A:B 비율이 바뀔 수 있음 | 최소 수령량 인자 추가 |
| 기한(deadline) 없음 | `swap`, `removeLiquidity`에 유효기간이 없음. 대기 중인 tx가 한참 뒤에 실행될 수 있음 | `deadline` 인자 (`require(block.timestamp <= deadline)`) |
| `MINIMUM_LIQUIDITY` 잠금 없음 | Uniswap V2는 첫 LP 1000단위를 소각함. 여기서는 첫 공급자가 `√(a·b)`를 전부 받음. 흔한 첫 공급자 부풀리기 공격은 풀에 토큰을 기부하는 방식인데, 내부 reserve 장부가 기부를 무시하므로 위험이 줄어들 뿐 완전히 증명된 것은 아님 | 첫 공급 때 소량 소각 |
| 기부된 토큰은 갇힘 | 컨트랙트에 직접 보낸 토큰은 reserve에 없고 `skim` / `sync` 함수도 없음 | `balanceOf − reserve`를 보내 주는 `skim(to)` |
| 표준이 아닌 토큰 미지원 | 전송 수수료가 있거나 잔액이 저절로 바뀌는(rebasing) 토큰은 reserve와 실제 잔액이 어긋남 | 받은 양을 잔액 차이로 측정 |
| 현재 가격만 있음 | 가격은 지금의 `reserveB / reserveA`. 한 블록 안에서 움직일 수 있으므로 오라클로 쓰면 안 됨 | 시간 가중 평균 가격(TWAP) |
| swap마다 tx 2개 | approve 후 swap. 토큰은 EIP-2612 `permit`을 지원하지만 AMM에 `…WithPermit` 함수가 없음 | `swapWithPermit(…, deadline, v, r, s)` |

## NFT 마켓

| 한계 | 영향 | 개선 방법 |
|---|---|---|
| 아무 ERC-721이나 등록 가능 | `listNFT`가 `nft` 주소를 제한하지 않아 가짜 컬렉션의 토큰도 등록 가능. 프론트는 우리 컬렉션만 보여 주지만 컨트랙트는 열려 있음 | NFT 컨트랙트 허용 목록, 또는 UI에서 컨트랙트 주소 표시·검증 |
| 가격 변경 불가 | 취소 후 재등록 (새 번호를 받음) | `updatePrice(id, newPrice)` |
| 만료 없음 | 팔리거나 취소될 때까지 계속 판매 중 | `expiresAt` 필드 |
| 로열티·마켓 수수료 없음 | 판매자가 가격 전액을 받음 | ERC-2981 로열티, 프로토콜 수수료 |
| 판매자가 자기 판매 건을 살 수 있음 | 막지 않음 (자기에게 돈을 내는 것이라 실익 없음) | `require(msg.sender != seller)` |
| 판매 목록을 체인에서 직접 훑음 | 프론트가 `listings(0 … n−1)`을 모두 읽고 active만 거름 | 서브그래프 사용 (`listings(where: { status: ACTIVE })`) |

## 토큰과 NFT

| 한계 | 영향 | 개선 방법 |
|---|---|---|
| owner 무제한 발행 | SW42 / R2B의 owner는 원하는 만큼 발행할 수 있고, 팔아서 풀을 비울 수 있음 | 발행 상한(`ERC20Capped`), 멀티시그 owner, `renounceOwnership` |
| faucet 반복 수령 가능 | 1일 쿨다운은 주소 단위라 새 지갑으로 우회 가능 | 토큰에 가치가 없어 허용 |
| 모든 NFT가 같은 메타데이터 | 모든 번호가 같은 이미지 | 번호별 메타데이터 (`baseURI + tokenId`) |
| 메타데이터가 IPFS 상태에 의존 | 내용은 바꿀 수 없지만(CID = 해시) 아무도 pin하지 않으면 사라질 수 있고, 공개 게이트웨이는 요청이 제한될 수 있음 (`ipfs.io`에서 HTTP 429를 겪고 `gateway.pinata.cloud`로 바꿈) | 여러 서비스에 pin |

## 프론트엔드

| 한계 | 영향 | 개선 방법 |
|---|---|---|
| "내 NFT"가 0~19번만 확인 | `TokenizeArt`에 목록 기능이 없고 `_nextTokenId`가 private이라 20번 이상은 안 보임 | 서브그래프 쿼리 (`nfts(where: { owner })`) |
| 번호별 허락만 확인 | `ListNFTForm`이 `getApproved`만 읽어서, `setApprovalForAll`을 쓴 사용자에게도 Approve 버튼이 보임 | `isApprovedForAll`도 확인 |
| 에러 메시지가 김 | viem의 `error.message` 전체를 표시 | `shortMessage` 표시 |
| 정확한 양만 approve | swap, 공급, 구매마다 approve가 다시 필요 (안전하지만 팝업 1번 추가) | 선택형 "최대 승인" 옵션 |
| 서브그래프를 아직 안 씀 | 화면은 모든 값을 체인에서 직접 읽음 | 목록 화면을 GraphQL로 전환 |

## 배포와 운영

| 한계 | 영향 |
|---|---|
| 업그레이드 불가 | 버그를 고치려면 재배포가 필요하고 주소가 바뀜 (프론트, 서브그래프, 유동성을 모두 다시 맞춰야 함) |
| 테스트넷만 | BSC 테스트넷(chain 97)에만 배포. Sepolia는 프론트와 Foundry 설정에만 있고 배포는 안 함 |
| BscScan 소스 검증 안 함 | 탐색기에 소스 코드가 아직 공개되지 않음 (API 키로 `forge verify-contract`) |
