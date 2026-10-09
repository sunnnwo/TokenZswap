# 테스트 해설: `test_RemoveLiquidity_Partial`

`code/test/amm.t.sol`의 부분 출금 테스트를 한 줄씩 따라가면서, 줄마다 **bob의 지갑**과 **풀**이 어떻게 변하는지 정리한 노트입니다.

## 테스트 코드 (정답 기준)

```solidity
function test_RemoveLiquidity_Partial() public {
    _addLiquidity(alice, 100 ether, 400 ether);
    _addLiquidity(bob, 100 ether, 400 ether);
    // 풀: 200 / 800 / LP 400.  Bob이 LP 100개(25%)만 뺌

    uint256 bobABefore = tokenA.balanceOf(bob);
    vm.prank(bob);                                          // 다음 호출 1번만 bob으로
    (uint256 outA, uint256 outB) = amm.removeLiquidity(100 ether);

    assertEq(outA, 50 ether);                               // 100 × 200 / 400
    assertEq(outB, 200 ether);                              // 100 × 800 / 400
    assertEq(tokenA.balanceOf(bob), bobABefore + outA);     // 실제로 지갑에 들어왔나
    assertEq(amm.balanceOf(bob), 100 ether);                // 200 − 100
}
```

## 시작 상태 (setUp 직후)

| bob SW42 | bob R2B | bob LP | 풀 SW42 | 풀 R2B | LP 전체 |
|---|---|---|---|---|---|
| 10,000 | 10,000 | 0 | 0 | 0 | 0 |

setUp에서 bob은 SW42와 R2B를 10,000개씩 받았습니다. 풀은 비어 있습니다.

## 한 줄씩

### 1. alice 공급

```solidity
_addLiquidity(alice, 100 ether, 400 ether);
```

alice가 SW42 100 + R2B 400을 풀에 넣고 LP 200을 받습니다. 첫 공급이므로 √(100 × 400) = 200입니다.

| bob SW42 | bob R2B | bob LP | 풀 SW42 | 풀 R2B | LP 전체 |
|---|---|---|---|---|---|
| 10,000 | 10,000 | 0 | **100** | **400** | **200** |

### 2. bob 공급

```solidity
_addLiquidity(bob, 100 ether, 400 ether);
```

bob도 같은 양을 넣습니다. 추가 공급이므로 `min(100 × 200 / 100, 400 × 200 / 400)` = LP 200을 받습니다.

| bob SW42 | bob R2B | bob LP | 풀 SW42 | 풀 R2B | LP 전체 |
|---|---|---|---|---|---|
| **9,900** | **9,600** | **200** | **200** | **800** | **400** |

주석 `풀: 200 / 800 / LP 400`이 이 상태입니다.

### 3. 출금 전 잔고 기억해 두기

```solidity
uint256 bobABefore = tokenA.balanceOf(bob);   // = 9,900
```

출금 **후** 잔고가 얼마나 늘었는지 비교하려고, 출금 **전** SW42 잔고를 변수에 저장해 둡니다. 상태는 변하지 않습니다.

### 4. bob이 LP 100개 소각

```solidity
vm.prank(bob);
(uint256 outA, uint256 outB) = amm.removeLiquidity(100 ether);
```

- `vm.prank(bob)`: 다음 호출 한 번만 `msg.sender`를 bob으로 바꿉니다.
- `removeLiquidity(100 ether)`: bob이 LP 100개(전체 400개 중 **25%**)를 소각합니다. 함수가 돌려준 두 값을 `outA`, `outB`에 받습니다.

컨트랙트(`AMM.sol`의 `removeLiquidity`) 안에서 계산되는 값:

```
outA = 100 × 200 / 400 = 50     ← 풀 SW42(200)의 25%
outB = 100 × 800 / 400 = 200    ← 풀 R2B(800)의 25%
```

| bob SW42 | bob R2B | bob LP | 풀 SW42 | 풀 R2B | LP 전체 |
|---|---|---|---|---|---|
| **9,950** (+50) | **9,800** (+200) | **100** (−100) | **150** (−50) | **600** (−200) | **300** (−100) |

### 5. 돌려받은 양 확인

```solidity
assertEq(outA, 50 ether);    // 풀 SW42 200의 25%
assertEq(outB, 200 ether);   // 풀 R2B 800의 25%
```

**왜 두 값이 다른가?** 같은 식에 들어가는 풀 잔고가 다르기 때문입니다. bob은 두 더미에서 **같은 비율(25%)**을 받지만, 더미 크기가 SW42 200, R2B 800으로 다릅니다. 피자 2판과 콜라 8병을 넷이 나누면 한 사람 몫이 피자 0.5판과 콜라 2병인 것과 같습니다.

넣은 양과 비교하면 더 직관적입니다. bob은 SW42 100 + R2B 400을 넣고 LP 200을 받았습니다. 그중 **절반**(100개)을 빼니 넣은 양의 **절반씩**(50, 200)을 돌려받습니다. 중간에 스왑이 없어서 비율이 그대로이기 때문입니다.

### 6. 실제로 지갑에 들어왔나

```solidity
assertEq(tokenA.balanceOf(bob), bobABefore + outA);   // 9,950 == 9,900 + 50
```

5번은 함수가 "50개를 주겠다"고 **말한 값**을 확인합니다. 6번은 bob 지갑에 **실제로** 50개가 들어왔는지 확인합니다. 컨트랙트에서 `safeTransfer`를 빼먹었다면 5번은 통과하고 6번에서 실패합니다. 그래서 둘 다 필요합니다.

### 7. 남은 LP

```solidity
assertEq(amm.balanceOf(bob), 100 ether);   // 200 − 100
```

LP 200개 중 100개를 태웠으니 100개가 남아야 합니다.

## 한 줄 요약

> 풀에 SW42 200, R2B 800이 있을 때 LP의 25%를 빼면 **각 더미의 25%**인 SW42 50, R2B 200을 받고, 지갑과 LP 잔고도 그만큼 바뀐다.

---

## 출금 양이 다른 것을 어디서 확인하나

| 질문 | 어디서 |
|---|---|
| **왜** 다른가? | `AMM.sol`의 `removeLiquidity`: `lpAmount * reserveA / lpSupply`, `lpAmount * reserveB / lpSupply`. 같은 식에 `reserveA`(200)와 `reserveB`(800)가 들어감 |
| **정말** 다른가? | 테스트의 `assertEq(outA, 50 ether)`, `assertEq(outB, 200 ether)`. 통과하면 증명됨 (assertEq는 맞으면 아무것도 출력하지 않음) |
| 눈으로 **보려면**? | `forge test --match-test test_RemoveLiquidity_Partial -vvvv` 트레이스의 `← [Return] 5e19, 2e20` |

`-vvvv` 트레이스에서 보이는 부분:

```
├─ AMM::removeLiquidity(100000000000000000000 [1e20])
│   ├─ emit Transfer(from: bob, to: 0x0000..., value: 1e20)        ← LP 소각
│   ├─ SunWoo42::transfer(bob, 50000000000000000000 [5e19])        ← SW42 50개
│   ├─ TokenB::transfer(bob, 200000000000000000000 [2e20])         ← R2B 200개
│   ├─ emit LiquidityRemoved(provider: bob, liquidity: 1e20, amountA: 5e19, amountB: 2e20)
│   └─ ← [Return] 5e19, 2e20                                      ← 반환값
```

`5e19` = 50 ether, `2e20` = 200 ether입니다.

---

## 이 테스트에 나온 Foundry 문법

| 문법 | 뜻 |
|---|---|
| `100 ether` | ETH가 아니라 `100 × 10¹⁸`이라는 숫자. 소수점 18자리 토큰 100개 |
| `makeAddr("bob")` | 테스트용 가짜 주소 |
| `tokenA.transfer(bob, 10_000 ether)` | setUp에서: 테스트 컨트랙트(배포자)의 토큰을 bob에게 줌 |
| `_addLiquidity(who, a, b)` | 직접 만든 도우미. who로 approve 2번 + addLiquidity 1번 (MetaMask 서명 3번과 같음). who가 **풀에 넣는** 동작 |
| `vm.prank(bob)` | **다음 호출 1번만** `msg.sender`를 bob으로 |
| `vm.startPrank(bob)` ~ `vm.stopPrank()` | 그 **사이의 모든 호출**을 bob으로 |
| `assertEq(실제, 기대)` | 다르면 테스트 실패. 오른쪽에는 **손으로 계산한 숫자**를 넣음 |
| `vm.expectRevert(bytes("메시지"))` | 바로 다음 호출이 **이 메시지 그대로** revert해야 통과 |
| `console.log("이름", 값)` | 값을 화면에 출력 (`-vv` 이상에서 보임) |
| `--match-test 이름` | 테스트 하나만 실행 |
| `-vvvv` | 모든 호출과 반환값을 트레이스로 출력 |

> 테스트가 실패했다고 항상 컨트랙트가 틀린 건 아닙니다. **기대값을 잘못 적은 것**일 수도 있습니다. 실패하면 "컨트랙트가 틀렸나, 내 계산이 틀렸나?"를 먼저 따져 보세요.
