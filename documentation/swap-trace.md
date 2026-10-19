# Swap 디버깅 트레이스: b가 100 B → A

`swap` 한 번이 실행될 때 **함수 인자, 내부 변수, 장부(storage)**가 어떻게 바뀌는지 한 줄씩 따라가는 문서입니다.

> 모든 숫자는 실제 실행 결과입니다. 아래 시나리오를 Foundry 테스트로 만들어 `forge test -vvvv`로 콜 트레이스를 찍고, 그 값을 그대로 옮겼습니다.
> 표기: `1e18 wei = 1 토큰`. 사람이 읽기 쉬운 값은 괄호 안에 적었습니다.

---

## 0. 시나리오와 시작 상태

1. 배포자가 `addLiquidity(10000 A, 40000 B)` → LP 20000
2. a가 `addLiquidity(1000 A, 500 B)` (비율이 맞지 않는 입금) → LP 250
3. b는 B 1000개만 가지고 있고, LP는 없음. AMM을 처음 사용함

| 장부 | 위치 | 값 (wei) | 사람 단위 |
|---|---|---|---|
| `reserveA` | AMM | 11000000000000000000000 | 11000 |
| `reserveB` | AMM | 40500000000000000000000 | 40500 |
| `totalSupply` (LP) | AMM | 20250000000000000000000 | 20250 |
| `balanceOf[b]` | tokenA | 0 | 0 |
| `balanceOf[b]` | tokenB | 1000000000000000000000 | 1000 |
| `balanceOf[AMM]` | tokenA | 11000000000000000000000 | 11000 |
| `balanceOf[AMM]` | tokenB | 40500000000000000000000 | 40500 |
| `allowance[b][AMM]` | tokenB | 0 | 0 (approve한 적 없음) |

- 가격: `reserveB / reserveA = 40500 / 11000 = 3.6818` → 1 A ≈ 3.68 B
- `k = reserveA × reserveB = 445,500,000` (사람 단위)

---

## 1. [읽기] `tokenB.allowance(owner, spender)`

| 항목 | 값 |
|---|---|
| 호출 대상 | **tokenB** 컨트랙트 |
| 선택자 | `0xdd62ed3e` = `allowance(address,address)` |
| 종류 | `view` → eth_call, 가스·팝업 없음 |
| `owner` | b |
| `spender` | AMM |
| **반환** | `0` |

판단: `0 < 100e18` → approve가 먼저 필요합니다.

---

## 2. [읽기] `amm.getAmountOut(amountIn, reserveIn, reserveOut)`

방향이 B → A이므로 **넣는 쪽(In)이 B**입니다.

| 파라미터 | 값 (wei) | 사람 단위 |
|---|---|---|
| `amountIn` | 100000000000000000000 | 100 |
| `reserveIn` (= reserveB) | 40500000000000000000000 | 40500 |
| `reserveOut` (= reserveA) | 11000000000000000000000 | 11000 |

함수 내부:

| 줄 | 식 | 값 |
|---|---|---|
| `require(amountIn > 0)` | 100e18 > 0 | ✅ |
| `require(reserveIn > 0 && reserveOut > 0)` | | ✅ |
| `amountInWithFee` | `amountIn × (10000 − 300)` = 100e18 × 9700 | 970000000000000000000000 |
| 분자 | `amountInWithFee × reserveOut` | 10670000000000000000000000000000000000000000000 |
| 분모 | `reserveIn × 10000 + amountInWithFee` | 405970000000000000000000000 |
| **`amountOut`** | 분자 / 분모 (소수점 버림) | **26282730251003768751** (26.2827 A) |

---

## 3. [프론트 계산] `minOut`

```
minOut = amountOut × (10000 − SLIPPAGE_BPS) / 10000
       = 26282730251003768751 × 9900 / 10000
       = 26019902948493731063   (26.0199 A)
```

---

## 4. [tx 1] `tokenB.approve(spender, value)`

| 항목 | 값 |
|---|---|
| tx `from` (`msg.sender`) | **b** ← owner는 인자가 아니라 여기서 정해짐 |
| tx `to` | **tokenB** |
| 선택자 | `0x095ea7b3` = `approve(address,uint256)` |
| `spender` | AMM |
| `value` | 100000000000000000000 (100) |

storage 변화:

| 장부 | 전 | 후 |
|---|---|---|
| tokenB `allowance[b][AMM]` | 0 | **100e18** |
| tokenB `balanceOf[b]` | 1000e18 | 1000e18 (approve는 토큰을 옮기지 않음) |

이벤트:

```
Approval(owner: b, spender: AMM, value: 100e18)
  topic0 = 0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925
```

---

## 5. [tx 2] `amm.swap(tokenIn, amountIn, minAmountOut)`

| 항목 | 값 |
|---|---|
| tx `from` (`msg.sender`) | b |
| tx `to` | **AMM** |
| 선택자 | `0x9f1d0f59` = `swap(address,uint256,uint256)` |
| `tokenIn` | tokenB 주소 |
| `amountIn` | 100000000000000000000 (100) |
| `minAmountOut` | 26019902948493731063 (26.0199) |

### 5-1. `nonReentrant` 진입

잠금 상태가 `NOT_ENTERED → ENTERED`로 바뀝니다. 이 함수가 끝나기 전에 다시 들어오면 revert됩니다.

### 5-2. 토큰 검증과 방향 결정

```solidity
require(tokenIn == address(tokenA) || tokenIn == address(tokenB), "AMM: invalid token");
bool isAToB = tokenIn == address(tokenA);
```

| 식 | 값 |
|---|---|
| `tokenIn == tokenA` | false |
| `tokenIn == tokenB` | true → require 통과 |
| **`isAToB`** | **false** (넣는 토큰이 A가 아님 → B→A 방향) |

### 5-3. 입출력 정하기 (삼항 연산자의 false 쪽)

```solidity
(inToken, outToken, reserveIn, reserveOut) =
    isAToB ? (tokenA, tokenB, reserveA, reserveB) : (tokenB, tokenA, reserveB, reserveA);
```

| 지역 변수 | 값 |
|---|---|
| `inToken` | tokenB |
| `outToken` | tokenA |
| `reserveIn` | 40500e18 |
| `reserveOut` | 11000e18 |

### 5-4. 받을 양 계산과 검사

| 줄 | 값 | 결과 |
|---|---|---|
| `amountOut = getAmountOut(100e18, 40500e18, 11000e18)` | 26282730251003768751 | 2단계 견적과 같음 |
| `require(amountOut >= minAmountOut)` | 26.2827 ≥ 26.0199 | ✅ |
| `require(amountOut > 0)` | | ✅ |

> 견적과 채굴 사이에 다른 swap이 끼어들어 `amountOut`이 26.0199보다 작아졌다면, 여기서 `"AMM: slippage"`로 tx 전체가 되돌아갑니다.

### 5-5. 토큰 가져오기: `inToken.safeTransferFrom(b, AMM, 100e18)`

AMM → tokenB 내부 호출입니다. 이때 tokenB 입장에서 `msg.sender`는 **AMM**(= spender)입니다.

| 파라미터 | 값 |
|---|---|
| `from` | b (owner) |
| `to` | AMM |
| `value` | 100e18 |

| 장부 (tokenB) | 전 | 후 |
|---|---|---|
| `allowance[b][AMM]` | 100e18 | **0** (사용한 만큼 차감) |
| `balanceOf[b]` | 1000e18 | **900e18** |
| `balanceOf[AMM]` | 40500e18 | **40600e18** |

이벤트: `Transfer(from: b, to: AMM, value: 100e18)`

### 5-6. 장부 갱신 (`isAToB == false` 분기)

```solidity
reserveB += amountIn;
reserveA -= amountOut;
```

| 장부 (AMM) | 전 | 후 |
|---|---|---|
| `reserveB` | 40500000000000000000000 | **40600000000000000000000** |
| `reserveA` | 11000000000000000000000 | **10973717269748996231249** |

### 5-7. 토큰 보내기: `outToken.safeTransfer(b, amountOut)`

| 파라미터 | 값 |
|---|---|
| `to` | b |
| `value` | 26282730251003768751 |

| 장부 (tokenA) | 전 | 후 |
|---|---|---|
| `balanceOf[AMM]` | 11000e18 | **10973717269748996231249** |
| `balanceOf[b]` | 0 | **26282730251003768751** |

이벤트: `Transfer(from: AMM, to: b, value: 26.2827e18)`

### 5-8. 이벤트와 반환

```
Swap(trader: b, tokenIn: tokenB, amountIn: 100e18, amountOut: 26282730251003768751)
  topic0 = 0xfa2dda1cc1b86e41239702756b13effbc1a092b5c57e3ad320fbe4f3b13fe235
  topic1 = b (indexed)
  topic2 = tokenB (indexed)
  data   = amountIn, amountOut
```

`return amountOut` → 26282730251003768751. 이어서 `nonReentrant` 잠금이 `ENTERED → NOT_ENTERED`로 풀립니다.

### 5-9. 이 tx의 이벤트 로그 순서

| # | 컨트랙트 | 이벤트 |
|---|---|---|
| 0 | tokenB | `Transfer(b → AMM, 100)` |
| 1 | tokenA | `Transfer(AMM → b, 26.2827)` |
| 2 | AMM | `Swap(b, tokenB, 100, 26.2827)` ← 서브그래프가 읽을 이벤트 |

---

## 6. 최종 상태 비교

| 장부 | 시작 | 끝 | 변화 |
|---|---|---|---|
| AMM `reserveA` | 11000 | 10973.7173 | −26.2827 |
| AMM `reserveB` | 40500 | 40600 | +100 |
| AMM `totalSupply` (LP) | 20250 | 20250 | 0 (swap은 LP를 발행하지 않음) |
| tokenA `balanceOf[b]` | 0 | 26.2827 | +26.2827 |
| tokenB `balanceOf[b]` | 1000 | 900 | −100 |
| tokenB `allowance[b][AMM]` | 0 | 0 | approve로 100이 됐다가 swap에서 소진 |
| tokenA `balanceOf[AMM]` | 11000 | 10973.7173 | `reserveA`와 일치 |
| tokenB `balanceOf[AMM]` | 40500 | 40600 | `reserveB`와 일치 |

### 불변식 확인

| 항목 | 전 | 후 |
|---|---|---|
| `k = reserveA × reserveB` | 445,500,000 | 445,532,921.15 ⬆ |
| 가격 (B per A) | 3.6818 | 3.6997 |

- **k가 늘었습니다.** 늘어난 만큼이 수수료이고, 풀 안에 남아 LP 지분 비율대로 a와 배포자의 몫이 됩니다.
- **장부와 실제 잔액이 일치합니다** (`reserveX == balanceOf[AMM]`). 둘이 어긋나는 경우는 누군가 AMM에 토큰을 직접 보냈을 때(donation)뿐이고, AMM은 계산에 장부만 쓰므로 영향을 받지 않습니다.

### b가 받은 26.2827 A의 분해

| 기준 | A |
|---|---|
| 현재 가격 그대로 (100 ÷ 3.6818) | 27.1605 |
| 수수료 없이 공식만 적용 (가격 충격만) | 27.0936 |
| **수수료 3% 포함 (실제)** | **26.2827** |
