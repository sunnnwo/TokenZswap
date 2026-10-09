// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";


/**
 * @title AMM
 * @notice Constant-product (x * y = k) AMM for one token pair, plus a fixed-price NFT marketplace.
 *         This contract is itself the ERC-20 LP token of the pool.
 */
contract AMM is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;
    // ─────────────────────────── Pool configuration ───────────────────────────

    /// @notice First token of the pair.
    IERC20 public immutable tokenA;                                   // [A]

    /// @notice Second token of the pair.
    IERC20 public immutable tokenB;                                   // [A]

    /// @notice Swap fee in basis points (1 bp = 0.01%). Must be between 1% and 10%.
    uint256 public constant FEE_BPS = 300;                          // [B]

    /// @notice Denominator for basis-point math: 10_000 bps = 100%.
    uint256 public constant BPS_DENOMINATOR = 10_000;                  // [B]

    // ─────────────────────────────── Pool state ───────────────────────────────

    /// @notice Amount of tokenA the pool accounts for. Only changed by pool functions,
    ///         so direct transfers to this contract cannot move the price.
    uint256 public reserveA;                                         // [C]

    /// @notice Amount of tokenB the pool accounts for.
    uint256 public reserveB;                                         // [C]

    /// @notice Total supply of LP tokens.
    uint256 public totalLiquidity;

    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 liquidity);
    event LiquidityRemoved(address indexed provider, uint256 liquidity, uint256 amountA, uint256 amountB);
    event Swap (address indexed trader, address indexed tokenIn, uint256 amountIn, uint256 amountOut);


    // ─────────────────────────────── Constructor ──────────────────────────────

    /**
     * @param tokenA_ Address of the first ERC-20 token of the pair.
     * @param tokenB_ Address of the second ERC-20 token of the pair.
     */
    constructor(address tokenA_, address tokenB_) ERC20("42TokenZwapToken", "42TZT") {   // [D]
        require(tokenA_ != address(0) && tokenB_ != address(0), "AMM: zero address");   // [E]
        require(tokenA_ != tokenB_, "AMM: identical tokens");                           // [E]

        tokenA = IERC20(tokenA_);                                   // [F]
        tokenB = IERC20(tokenB_);                                   // [F]
    

    }
     /**
     * @notice Deposits tokenA and tokenB into the pool and mints LP tokens to the caller.
     * @dev Caller must approve this contract for both tokens first.
     *      If the ratio does not match the pool, LP is minted on the smaller side (min);
     *      the excess stays in the pool and benefits all LPs.
     * @param amountA Amount of tokenA to deposit.
     * @param amountB Amount of tokenB to deposit.
     * @return liquidity Amount of LP tokens minted.
     */
    
    function addLiquidity(uint256 amountA, uint256 amountB)
        external
        nonReentrant
        returns (uint256 liquidity)
    {
        require(amountA > 0 && amountB > 0, "AMM: zero amount");

        // 1) LP 발행량 계산
        uint256 lpSupply = totalSupply();
        if (lpSupply == 0) {
            liquidity = Math.sqrt(amountA * amountB);                         // [1]
        } else {
            liquidity = Math.min(
                amountA * lpSupply / reserveA,                                  // [2]
                amountB * lpSupply / reserveB                                   // [2]
            );
        }
        require(liquidity > 0, "AMM: insufficient liquidity minted");   // [3]

        // 2) 토큰 가져오기 (caller → AMM)
        tokenA.safeTransferFrom(msg.sender, address(this), amountA);                    // [4]
        tokenB.safeTransferFrom(msg.sender, address(this), amountB);                    // [4]

        // 3) 장부 갱신
        reserveA = reserveA + amountA;                                           // [5]
        reserveB = reserveB + amountB;                                           // [5]

        // 4) LP 발행 + 이벤트
        _mint(msg.sender, liquidity);                                          // [6]
        emit LiquidityAdded(msg.sender, amountA, amountB, liquidity);
    }
     /**
     * @notice Burns LP tokens and returns the caller's share of both reserves.
     * @dev Burn all LP for a full withdrawal, or part of it for a partial withdrawal.
     * @param lpAmount Amount of LP tokens to burn.
     * @return amountA Amount of tokenA returned.
     * @return amountB Amount of tokenB returned.
     */
    function removeLiquidity(uint256 lpAmount)
        external
        nonReentrant
        returns (uint256 amountA, uint256 amountB)
    {
        require(lpAmount > 0, "AMM: zero amount");
        
        // Calculate the amounts (before burning LP)
        uint256 lpSupply = totalSupply();
        amountA = lpAmount * reserveA / lpSupply;                                 // [7]
        amountB = lpAmount * reserveB / lpSupply;                                 // [7]
        require (amountA > 0 && amountB > 0, "AMM: insufficient liquidity burned");
       
       _burn(msg.sender, lpAmount);

       // 장부 차감
       reserveA = reserveA - amountA;                                          
       reserveB = reserveB - amountB;                                           
       
       // 토큰 보내기
       tokenA.safeTransfer(msg.sender, amountA);
       tokenB.safeTransfer(msg.sender, amountB);

       emit LiquidityRemoved(msg.sender, lpAmount, amountA, amountB);
       }
        /**
     * @notice Returns how much of the other token a swap would give, after the fee.
     * @dev Constant product with fee: out = in*(1-f)*rOut / (rIn + in*(1-f)), rounded down.
     * @param amountIn Amount of the input token.
     * @param reserveIn Pool reserve of the input token.
     * @param reserveOut Pool reserve of the output token.
     * @return amountOut Amount of the output token.
     */
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        public
        pure
        returns (uint256 amountOut)
    {
        require(amountIn > 0, "AMM: zero input");
        require(reserveIn > 0 && reserveOut > 0, "AMM: empty reserves");

        // 1bps = 0.01% = 0.0001

        uint256 amountInWithFee = amountIn * (BPS_DENOMINATOR - FEE_BPS); // 넣은 양 중 수수료를 뺀 부분만 계산에 사용
        amountOut = amountInWithFee * reserveOut / (reserveIn * BPS_DENOMINATOR + amountInWithFee);
    }
    /**
 * @notice Swaps an exact amount of one pool token for the other.
 * @dev Caller must approve this contract for tokenIn first.
 * @param tokenIn Address of the token being sold (tokenA or tokenB).
 * @param amountIn Amount of tokenIn to sell.
 * @param minAmountOut Minimum acceptable output; reverts if less (slippage protection).
 * @return amountOut Amount of the other token sent to the caller.
 */
function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut)
    external
    nonReentrant
    returns (uint256 amountOut)
{
    // 1) tokenIn이 풀의 토큰인지 확인
    require(tokenIn == address(tokenA) || tokenIn == address(tokenB), "AMM: invalid token");      // [1]

    // 2) 방향 정하기: A→B 인가?
    bool isAToB = tokenIn == address(tokenA);

    (IERC20 inToken, IERC20 outToken, uint256 reserveIn, uint256 reserveOut) = isAToB
        ? (tokenA, tokenB, reserveA, reserveB)
        : (tokenB, tokenA, reserveB, reserveA);                                          // [2]

    // 3) 받을 양 계산 + 슬리피지 검사
    amountOut = getAmountOut(amountIn, reserveIn, reserveOut);              // [3]
    require(amountOut >= minAmountOut, "AMM: slippage");                                  // [4]
    // 4) 토큰 가져오기 (caller → AMM)
    inToken.safeTransferFrom(msg.sender, address(this), amountIn);

    // 5) 장부 갱신
    if (isAToB) {
        reserveA += amountIn;
        reserveB -= amountOut;
    } else {
        reserveB += amountIn;
        reserveA -= amountOut;
    }

    // 6) 토큰 보내기 (AMM → caller) + 이벤트
    outToken.safeTransfer(msg.sender, amountOut);
    emit Swap(msg.sender, tokenIn, amountIn, amountOut);
}

}
