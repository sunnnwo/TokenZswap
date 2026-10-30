# Test Walkthrough: `test_RemoveLiquidity_Partial`

**English** · [한국어](test-walkthrough.ko.md)

Notes that step through the partial-withdrawal test in `code/test/amm.t.sol` line by line, showing how **bob's wallet** and **the pool** change at each line.

## Test code (reference solution)

```solidity
function test_RemoveLiquidity_Partial() public {
    _addLiquidity(alice, 100 ether, 400 ether);
    _addLiquidity(bob, 100 ether, 400 ether);
    // Pool: 200 / 800 / LP 400.  Bob withdraws only 100 LP (25%)

    uint256 bobABefore = tokenA.balanceOf(bob);
    vm.prank(bob);                                          // only the next call is made as bob
    (uint256 outA, uint256 outB) = amm.removeLiquidity(100 ether);

    assertEq(outA, 50 ether);                               // 100 × 200 / 400
    assertEq(outB, 200 ether);                              // 100 × 800 / 400
    assertEq(tokenA.balanceOf(bob), bobABefore + outA);     // did it actually reach the wallet?
    assertEq(amm.balanceOf(bob), 100 ether);                // 200 − 100
}
```

## Starting state (right after setUp)

| bob SW42 | bob R2B | bob LP | Pool SW42 | Pool R2B | Total LP |
|---|---|---|---|---|---|
| 10,000 | 10,000 | 0 | 0 | 0 | 0 |

In setUp, bob received 10,000 each of SW42 and R2B. The pool is empty.

## Line by line

### 1. alice deposits

```solidity
_addLiquidity(alice, 100 ether, 400 ether);
```

alice puts SW42 100 + R2B 400 into the pool and receives 200 LP. It is the first deposit, so √(100 × 400) = 200.

| bob SW42 | bob R2B | bob LP | Pool SW42 | Pool R2B | Total LP |
|---|---|---|---|---|---|
| 10,000 | 10,000 | 0 | **100** | **400** | **200** |

### 2. bob deposits

```solidity
_addLiquidity(bob, 100 ether, 400 ether);
```

bob deposits the same amounts. It is a later deposit, so he receives `min(100 × 200 / 100, 400 × 200 / 400)` = 200 LP.

| bob SW42 | bob R2B | bob LP | Pool SW42 | Pool R2B | Total LP |
|---|---|---|---|---|---|
| **9,900** | **9,600** | **200** | **200** | **800** | **400** |

This is the state described by the comment `Pool: 200 / 800 / LP 400`.

### 3. Remember the balance before withdrawing

```solidity
uint256 bobABefore = tokenA.balanceOf(bob);   // = 9,900
```

To compare how much the balance grows **after** the withdrawal, we store the SW42 balance **before** it in a variable. No state changes.

### 4. bob burns 100 LP

```solidity
vm.prank(bob);
(uint256 outA, uint256 outB) = amm.removeLiquidity(100 ether);
```

- `vm.prank(bob)`: sets `msg.sender` to bob for the next call only.
- `removeLiquidity(100 ether)`: bob burns 100 LP (**25%** of the 400 total). The two values the function returns go into `outA` and `outB`.

Values computed inside the contract (`removeLiquidity` in `AMM.sol`):

```
outA = 100 × 200 / 400 = 50     ← 25% of pool SW42 (200)
outB = 100 × 800 / 400 = 200    ← 25% of pool R2B (800)
```

| bob SW42 | bob R2B | bob LP | Pool SW42 | Pool R2B | Total LP |
|---|---|---|---|---|---|
| **9,950** (+50) | **9,800** (+200) | **100** (−100) | **150** (−50) | **600** (−200) | **300** (−100) |

### 5. Check the amounts returned

```solidity
assertEq(outA, 50 ether);    // 25% of pool SW42 200
assertEq(outB, 200 ether);   // 25% of pool R2B 800
```

**Why are the two values different?** The same formula is fed different pool balances. bob receives **the same share (25%)** of both piles, but the piles differ in size: SW42 200 and R2B 800. It is like four people splitting 2 pizzas and 8 colas: each person gets half a pizza and 2 colas.

Comparing with what he deposited is even more intuitive. bob put in SW42 100 + R2B 400 and received 200 LP. He withdraws **half** of it (100), so he gets back **half of each** deposit (50, 200). There was no swap in between, so the ratio is unchanged.

### 6. Did it actually reach the wallet?

```solidity
assertEq(tokenA.balanceOf(bob), bobABefore + outA);   // 9,950 == 9,900 + 50
```

Step 5 checks the value the function **says** it will give ("50 tokens"). Step 6 checks that 50 tokens **actually** arrived in bob's wallet. If the contract forgot the `safeTransfer`, step 5 would pass and step 6 would fail. That is why both are needed.

### 7. Remaining LP

```solidity
assertEq(amm.balanceOf(bob), 100 ether);   // 200 − 100
```

He burned 100 of his 200 LP, so 100 should remain.

## One-line summary

> With SW42 200 and R2B 800 in the pool, withdrawing 25% of the LP returns **25% of each pile**, SW42 50 and R2B 200, and the wallet and LP balances change by exactly that much.

---

## Where to confirm that the withdrawn amounts differ

| Question | Where |
|---|---|
| **Why** do they differ? | `removeLiquidity` in `AMM.sol`: `lpAmount * reserveA / lpSupply`, `lpAmount * reserveB / lpSupply`. The same formula takes `reserveA` (200) and `reserveB` (800) |
| Do they **really** differ? | The test's `assertEq(outA, 50 ether)`, `assertEq(outB, 200 ether)`. Passing proves it (assertEq prints nothing when it matches) |
| How to **see** it? | `← [Return] 5e19, 2e20` in the trace of `forge test --match-test test_RemoveLiquidity_Partial -vvvv` |

The relevant part of the `-vvvv` trace:

```
├─ AMM::removeLiquidity(100000000000000000000 [1e20])
│   ├─ emit Transfer(from: bob, to: 0x0000..., value: 1e20)        ← LP burn
│   ├─ SunWoo42::transfer(bob, 50000000000000000000 [5e19])        ← 50 SW42
│   ├─ TokenB::transfer(bob, 200000000000000000000 [2e20])         ← 200 R2B
│   ├─ emit LiquidityRemoved(provider: bob, liquidity: 1e20, amountA: 5e19, amountB: 2e20)
│   └─ ← [Return] 5e19, 2e20                                      ← return values
```

`5e19` = 50 ether, `2e20` = 200 ether.

---

## Foundry syntax used in this test

| Syntax | Meaning |
|---|---|
| `100 ether` | Not ETH, but the number `100 × 10¹⁸`. 100 tokens with 18 decimals |
| `makeAddr("bob")` | A fake address for testing |
| `tokenA.transfer(bob, 10_000 ether)` | In setUp: gives bob tokens from the test contract (the deployer) |
| `_addLiquidity(who, a, b)` | A helper we wrote. As who: 2 approves + 1 addLiquidity (same as 3 MetaMask signatures). The action of who **depositing into the pool** |
| `vm.prank(bob)` | `msg.sender` is bob for **the next call only** |
| `vm.startPrank(bob)` ~ `vm.stopPrank()` | **Every call in between** is made as bob |
| `assertEq(actual, expected)` | Fails the test if they differ. Put the **hand-calculated number** on the right |
| `vm.expectRevert(bytes("message"))` | Passes only if the very next call reverts with **exactly this message** |
| `console.log("name", value)` | Prints a value to the screen (visible at `-vv` and above) |
| `--match-test name` | Runs a single test |
| `-vvvv` | Prints every call and return value as a trace |

> A failing test does not always mean the contract is wrong. You may have **written the expected value wrong**. When a test fails, first ask: "Is the contract wrong, or is my math wrong?"
