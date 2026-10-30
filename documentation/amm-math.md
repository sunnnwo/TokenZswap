# AMM Math

**English** · [한국어](amm-math.ko.md)

The four formulas the TokenZswap AMM uses, worked through with round numbers that divide evenly.

## Symbols

| Symbol | In code | Meaning |
|---|---|---|
| `x` | `reserveA` | Amount of tokenA (SW42) recorded in the pool's books |
| `y` | `reserveB` | Amount of tokenB (R2B) recorded in the pool's books |
| `L` | `totalSupply()` | Total LP tokens minted |
| `f` | `FEE_BPS / BPS_DENOMINATOR` | Swap fee rate (300 / 10,000 = 3%) |
| `k` | `x * y` | The pool's product. Swaps never decrease it |

## Formula summary

| Situation | Formula |
|---|---|
| First deposit (`L = 0`) | `LP = √(a × b)` |
| Later deposit (`L > 0`) | `LP = min(a × L / x,  b × L / y)` |
| Swap (put in A, get B) | `out = y × a(1−f) / (x + a(1−f))` |
| Withdraw (burn LP) | `outA = lp × x / L`,  `outB = lp × y / L` |

---

## Example: the life of one pool

Starting from an empty pool, three people act in turn.

### T1. Alice's first deposit: SW42 100 + R2B 400

The pool is empty (`L = 0`), so we use the first-deposit formula.

```
LP = √(100 × 400) = √40,000 = 200
```

| x | y | L | Alice LP | Price (y/x) |
|---|---|---|---|---|
| 100 | 400 | 200 | 200 | 1 SW42 = 4 R2B |

- The ratio the first provider deposits (100 : 400) becomes the **initial price**.

### T2. Bob's deposit: SW42 100 + R2B 400

`L > 0`, so we use the later-deposit formula.

```
SW42 side:  100 × 200 / 100 = 200
R2B  side:  400 × 200 / 400 = 200
LP = min(200, 200) = 200
```

| x | y | L | Alice LP | Bob LP |
|---|---|---|---|---|
| 200 | 800 | 400 | 200 | 200 |

**What if the ratio is wrong?** If Bob had deposited SW42 100 + R2B **500**:

```
SW42 side: 200,   R2B side: 500 × 200 / 400 = 250
LP = min(200, 250) = 200
```

- He still gets 200 LP. The extra 100 R2B stays in the pool and becomes **every LP's share**.
- Giving him `max` (250) would let Bob take other people's share. That is why it is always `min`.

### T3. Carol swaps: SW42 50 → R2B

**First without the fee**, to see the principle.

```
out = 800 × 50 / (200 + 50) = 40,000 / 250 = 160 R2B
```

| | x | y | k = x × y | Price (y/x) |
|---|---|---|---|---|
| Before swap | 200 | 800 | 160,000 | 4.00 |
| After swap | 250 | 640 | 160,000 | 2.56 |

- `k` is unchanged. The formula is built to preserve `k`.
- At 1 SW42 = 4 R2B you might expect 200 for 50, but you actually get only **160**. The more you put in, the more plentiful SW42 becomes and the lower its value. This is **price impact**.
- Total LP supply (`L`) does not change. A swap is not a deposit.

**Now with the 3% fee:**

```
Input after fee:  50 × 0.97 = 48.5
out = 800 × 48.5 / (200 + 48.5) = 38,800 / 248.5 = 156.14 R2B
```

| x | y | k |
|---|---|---|
| 250 (**all** 50 go in) | 643.86 | 160,965 ⬆ |

- Only 48.5 is used in the calculation, but all 50 go into the pool.
- So `k` **grew** from 160,000 to 160,965. That increase is the LPs' fee income.

**Solidity integer math** (multiply first, divide once at the end):

```
amountInWithFee = 50 × (10,000 − 300)          = 485,000
numerator       = 485,000 × 800                = 388,000,000
denominator     = 200 × 10,000 + 485,000       = 2,485,000
amountOut       = 388,000,000 / 2,485,000      = 156.14 → round down → 156
```

- Rounding down always **favors the pool**. Rounding up would let the pool leak a little at a time.

### T4. Bob withdraws

To keep the math simple, we continue from the **fee-free** result of T3 (`x = 250, y = 640, L = 400`).

**Full withdrawal: burn 200 LP**

```
outA = 200 × 250 / 400 = 125 SW42
outB = 200 × 640 / 400 = 320 R2B
```

**Partial withdrawal: burn only 100 LP**

```
outA = 100 × 250 / 400 = 62.5 SW42
outB = 100 × 640 / 400 = 160  R2B
```

- Choosing how much LP to burn is all it takes to do either a full or a partial withdrawal.
- Bob deposited SW42 100 + R2B 400, but a full withdrawal returns **SW42 125 + R2B 320**. Carol sold SW42 and bought R2B, which changed the pool's ratio.
- The withdrawal formula does not include "how much you originally put in". LP is a claim on **a percentage of the pool as it is now**.

---

## Price impact at a glance

Pool SW42 1,000 / R2B 1,000 (1:1), no fee.

| SW42 in | R2B out | vs. expected (1:1) |
|---|---|---|
| 10 | 9.90 | 99% |
| 100 | 90.91 | 91% |
| 1,000 | 500 | 50% |

The larger the input relative to the pool, the bigger the loss. That is why deeper liquidity is better.

---

## Why compute with `reserve` instead of `balanceOf`

```
SW42 held by AMM = tokenA.balanceOf(AMM) = 1,500
    ├─ pool share     reserveA = 1,000   ← recorded in the books. Used for price and share math
    └─ not pool share           500   ← direct transfers, NFT proceeds, etc.
```

- **Anyone** can change `balanceOf` with a single `transfer`.
- Only **our functions** (add / remove / swap) can change `reserve`.
- Price and shares must be computed only from numbers we control, or they can be manipulated.

**Attack example when computing with `balanceOf` (first-depositor attack):**

| Step | Action | Pool balance | L |
|---|---|---|---|
| 1 | Attacker deposits 1 wei + 1 wei → 1 LP | 1 wei | 1 |
| 2 | Attacker simply `transfer`s 10,000 | 10,000 | 1 |
| 3 | Victim deposits 5,000 → LP = 5,000 × 1 / 10,000 = 0.5 → **0** | 15,000 | 1 |
| 4 | Attacker burns 1 LP (100%) → takes 15,000 | 0 | 0 |

With `reserve`, the transfer in step 2 is not in the books, so the victim receives LP normally in step 3.

---

## Exercises

Start from the state right after T2 (`x = 200, y = 800, L = 400`).

1. If Dave deposits SW42 50 + R2B 200, how many LP does he receive?
2. (After 1) If Alice burns all 200 of her LP, how much of each token does she receive?
3. From the state right after T2, with no fee, how much R2B do you get for 200 SW42? What percentage of the expected amount (1:4) is that?

<details>
<summary>Answers</summary>

1. `min(50 × 400 / 200, 200 × 400 / 800) = min(100, 100) =` **100 LP**
2. State: `x = 250, y = 1,000, L = 500`. `outA = 200 × 250 / 500 =` **100 SW42**, `outB = 200 × 1,000 / 500 =` **400 R2B**
3. `800 × 200 / (200 + 200) =` **400 R2B**. **50%** of the expected 800

</details>
