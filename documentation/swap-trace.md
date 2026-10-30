# Swap Debug Trace: b swaps 100 B → A

**English** · [한국어](swap-trace.ko.md)

A line-by-line walk through how the **function arguments, local variables and storage** change during a single `swap`.

> Every number is a real execution result. The scenario below was turned into a Foundry test, the call trace was printed with `forge test -vvvv`, and the values were copied as-is.
> Notation: `1e18 wei = 1 token`. Human-readable values are in parentheses.

---

## 0. Scenario and starting state

1. Deployer calls `addLiquidity(10000 A, 40000 B)` → 20000 LP
2. a calls `addLiquidity(1000 A, 500 B)` (deposit with a mismatched ratio) → 250 LP
3. b holds only 1000 B and no LP. First time using the AMM

| Storage | Location | Value (wei) | Human units |
|---|---|---|---|
| `reserveA` | AMM | 11000000000000000000000 | 11000 |
| `reserveB` | AMM | 40500000000000000000000 | 40500 |
| `totalSupply` (LP) | AMM | 20250000000000000000000 | 20250 |
| `balanceOf[b]` | tokenA | 0 | 0 |
| `balanceOf[b]` | tokenB | 1000000000000000000000 | 1000 |
| `balanceOf[AMM]` | tokenA | 11000000000000000000000 | 11000 |
| `balanceOf[AMM]` | tokenB | 40500000000000000000000 | 40500 |
| `allowance[b][AMM]` | tokenB | 0 | 0 (never approved) |

- Price: `reserveB / reserveA = 40500 / 11000 = 3.6818` → 1 A ≈ 3.68 B
- `k = reserveA × reserveB = 445,500,000` (human units)

---

## 1. [read] `tokenB.allowance(owner, spender)`

| Item | Value |
|---|---|
| Target | **tokenB** contract |
| Selector | `0xdd62ed3e` = `allowance(address,address)` |
| Kind | `view` → eth_call, no gas, no wallet popup |
| `owner` | b |
| `spender` | AMM |
| **Returns** | `0` |

Decision: `0 < 100e18` → an approve is needed first.

---

## 2. [read] `amm.getAmountOut(amountIn, reserveIn, reserveOut)`

The direction is B → A, so **the input side (In) is B**.

| Parameter | Value (wei) | Human units |
|---|---|---|
| `amountIn` | 100000000000000000000 | 100 |
| `reserveIn` (= reserveB) | 40500000000000000000000 | 40500 |
| `reserveOut` (= reserveA) | 11000000000000000000000 | 11000 |

Inside the function:

| Line | Expression | Value |
|---|---|---|
| `require(amountIn > 0)` | 100e18 > 0 | ✅ |
| `require(reserveIn > 0 && reserveOut > 0)` | | ✅ |
| `amountInWithFee` | `amountIn × (10000 − 300)` = 100e18 × 9700 | 970000000000000000000000 |
| Numerator | `amountInWithFee × reserveOut` | 10670000000000000000000000000000000000000000000 |
| Denominator | `reserveIn × 10000 + amountInWithFee` | 405970000000000000000000000 |
| **`amountOut`** | numerator / denominator (rounded down) | **26282730251003768751** (26.2827 A) |

---

## 3. [frontend math] `minOut`

```
minOut = amountOut × (10000 − SLIPPAGE_BPS) / 10000
       = 26282730251003768751 × 9900 / 10000
       = 26019902948493731063   (26.0199 A)
```

---

## 4. [tx 1] `tokenB.approve(spender, value)`

| Item | Value |
|---|---|
| tx `from` (`msg.sender`) | **b** ← the owner is set here, not by an argument |
| tx `to` | **tokenB** |
| Selector | `0x095ea7b3` = `approve(address,uint256)` |
| `spender` | AMM |
| `value` | 100000000000000000000 (100) |

Storage changes:

| Storage | Before | After |
|---|---|---|
| tokenB `allowance[b][AMM]` | 0 | **100e18** |
| tokenB `balanceOf[b]` | 1000e18 | 1000e18 (approve does not move tokens) |

Event:

```
Approval(owner: b, spender: AMM, value: 100e18)
  topic0 = 0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925
```

---

## 5. [tx 2] `amm.swap(tokenIn, amountIn, minAmountOut)`

| Item | Value |
|---|---|
| tx `from` (`msg.sender`) | b |
| tx `to` | **AMM** |
| Selector | `0x9f1d0f59` = `swap(address,uint256,uint256)` |
| `tokenIn` | tokenB address |
| `amountIn` | 100000000000000000000 (100) |
| `minAmountOut` | 26019902948493731063 (26.0199) |

### 5-1. Entering `nonReentrant`

The lock goes from `NOT_ENTERED → ENTERED`. Re-entering before this function finishes reverts.

### 5-2. Token check and direction

```solidity
require(tokenIn == address(tokenA) || tokenIn == address(tokenB), "AMM: invalid token");
bool isAToB = tokenIn == address(tokenA);
```

| Expression | Value |
|---|---|
| `tokenIn == tokenA` | false |
| `tokenIn == tokenB` | true → require passes |
| **`isAToB`** | **false** (input token is not A → B→A direction) |

### 5-3. Choosing input and output (false branch of the ternary)

```solidity
(inToken, outToken, reserveIn, reserveOut) =
    isAToB ? (tokenA, tokenB, reserveA, reserveB) : (tokenB, tokenA, reserveB, reserveA);
```

| Local variable | Value |
|---|---|
| `inToken` | tokenB |
| `outToken` | tokenA |
| `reserveIn` | 40500e18 |
| `reserveOut` | 11000e18 |

### 5-4. Output amount and checks

| Line | Value | Result |
|---|---|---|
| `amountOut = getAmountOut(100e18, 40500e18, 11000e18)` | 26282730251003768751 | Same as the step 2 quote |
| `require(amountOut >= minAmountOut)` | 26.2827 ≥ 26.0199 | ✅ |
| `require(amountOut > 0)` | | ✅ |

> If another swap had landed between the quote and mining and pushed `amountOut` below 26.0199, the whole tx would revert here with `"AMM: slippage"`.

### 5-5. Pulling tokens in: `inToken.safeTransferFrom(b, AMM, 100e18)`

An internal call from AMM → tokenB. From tokenB's point of view, `msg.sender` is **AMM** (= the spender).

| Parameter | Value |
|---|---|
| `from` | b (owner) |
| `to` | AMM |
| `value` | 100e18 |

| Storage (tokenB) | Before | After |
|---|---|---|
| `allowance[b][AMM]` | 100e18 | **0** (reduced by the amount used) |
| `balanceOf[b]` | 1000e18 | **900e18** |
| `balanceOf[AMM]` | 40500e18 | **40600e18** |

Event: `Transfer(from: b, to: AMM, value: 100e18)`

### 5-6. Updating the books (`isAToB == false` branch)

```solidity
reserveB += amountIn;
reserveA -= amountOut;
```

| Storage (AMM) | Before | After |
|---|---|---|
| `reserveB` | 40500000000000000000000 | **40600000000000000000000** |
| `reserveA` | 11000000000000000000000 | **10973717269748996231249** |

### 5-7. Sending tokens out: `outToken.safeTransfer(b, amountOut)`

| Parameter | Value |
|---|---|
| `to` | b |
| `value` | 26282730251003768751 |

| Storage (tokenA) | Before | After |
|---|---|---|
| `balanceOf[AMM]` | 11000e18 | **10973717269748996231249** |
| `balanceOf[b]` | 0 | **26282730251003768751** |

Event: `Transfer(from: AMM, to: b, value: 26.2827e18)`

### 5-8. Event and return

```
Swap(trader: b, tokenIn: tokenB, amountIn: 100e18, amountOut: 26282730251003768751)
  topic0 = 0xfa2dda1cc1b86e41239702756b13effbc1a092b5c57e3ad320fbe4f3b13fe235
  topic1 = b (indexed)
  topic2 = tokenB (indexed)
  data   = amountIn, amountOut
```

`return amountOut` → 26282730251003768751. Then the `nonReentrant` lock is released, `ENTERED → NOT_ENTERED`.

### 5-9. Event log order for this tx

| # | Contract | Event |
|---|---|---|
| 0 | tokenB | `Transfer(b → AMM, 100)` |
| 1 | tokenA | `Transfer(AMM → b, 26.2827)` |
| 2 | AMM | `Swap(b, tokenB, 100, 26.2827)` ← the event the subgraph reads |

---

## 6. Final state comparison

| Storage | Start | End | Change |
|---|---|---|---|
| AMM `reserveA` | 11000 | 10973.7173 | −26.2827 |
| AMM `reserveB` | 40500 | 40600 | +100 |
| AMM `totalSupply` (LP) | 20250 | 20250 | 0 (swap does not mint LP) |
| tokenA `balanceOf[b]` | 0 | 26.2827 | +26.2827 |
| tokenB `balanceOf[b]` | 1000 | 900 | −100 |
| tokenB `allowance[b][AMM]` | 0 | 0 | Became 100 via approve, used up by swap |
| tokenA `balanceOf[AMM]` | 11000 | 10973.7173 | Matches `reserveA` |
| tokenB `balanceOf[AMM]` | 40500 | 40600 | Matches `reserveB` |

### Invariant check

| Item | Before | After |
|---|---|---|
| `k = reserveA × reserveB` | 445,500,000 | 445,532,921.15 ⬆ |
| Price (B per A) | 3.6818 | 3.6997 |

- **k increased.** The increase is the fee; it stays in the pool and belongs to a and the deployer in proportion to their LP share.
- **The books match the actual balances** (`reserveX == balanceOf[AMM]`). They only diverge when someone sends tokens to the AMM directly (a donation), and the AMM is unaffected because it uses only the books for its math.

### Breaking down the 26.2827 A that b received

| Basis | A |
|---|---|
| At the current price (100 ÷ 3.6818) | 27.1605 |
| Formula only, no fee (price impact only) | 27.0936 |
| **With the 3% fee (actual)** | **26.2827** |
