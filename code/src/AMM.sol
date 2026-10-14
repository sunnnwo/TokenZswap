// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/**
 * @title AMM
 * @notice Constant-product (x * y = k) AMM for one token pair, plus a fixed-price NFT marketplace.
 *         This contract is itself the ERC-20 LP token of the pool.
 */
contract AMM is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;
    // ─────────────────────────── Pool configuration ───────────────────────────

    /// @notice First token of the pair.
    IERC20 public immutable tokenA;

    /// @notice Second token of the pair.
    IERC20 public immutable tokenB;

    /// @notice Swap fee in basis points (1 bp = 0.01%). Must be between 1% and 10%.
    uint256 public constant FEE_BPS = 300;

    /// @notice Denominator for basis-point math: 10_000 bps = 100%.
    uint256 public constant BPS_DENOMINATOR = 10_000;

    // ─────────────────────────────── Pool state ───────────────────────────────

    /// @notice Amount of tokenA the pool accounts for. Only changed by pool functions,
    ///         so direct transfers to this contract cannot move the price.
    uint256 public reserveA;

    /// @notice Amount of tokenB the pool accounts for.
    uint256 public reserveB;

    // ───────────────────────────── NFT marketplace ────────────────────────────

    /// @notice One fixed-price NFT sale. The NFT is held by this contract while active.
    struct Listing {
        address seller; // Who listed the NFT; receives the payment and may cancel.
        IERC721 nft; // ERC-721 contract of the listed NFT.
        uint256 tokenId; // Token ID inside that contract.
        uint256 price; // Price in paymentToken units (18 decimals).
        IERC20 paymentToken; // tokenA or tokenB.
        bool active; // False once sold or cancelled.
    }

    /// @notice ID the next listing will get. Starts at 0 and only increases.
    uint256 public nextListingId;

    /// @notice All listings ever created, by ID. Sold or cancelled listings stay with active = false.
    mapping(uint256 => Listing) public listings;

    // ───────────────────────────────── Events ─────────────────────────────────

    /**
     * @notice Emitted when liquidity is added to the pool.
     * @param provider Address that deposited the tokens and received the LP tokens.
     * @param amountA Amount of tokenA deposited.
     * @param amountB Amount of tokenB deposited.
     * @param liquidity Amount of LP tokens minted to the provider.
     */
    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 liquidity);

    /**
     * @notice Emitted when liquidity is removed from the pool.
     * @param provider Address that burned the LP tokens and received the tokens.
     * @param liquidity Amount of LP tokens burned.
     * @param amountA Amount of tokenA returned to the provider.
     * @param amountB Amount of tokenB returned to the provider.
     */
    event LiquidityRemoved(address indexed provider, uint256 liquidity, uint256 amountA, uint256 amountB);

    /**
     * @notice Emitted on every swap.
     * @param trader Address that sold tokenIn and received the other token.
     * @param tokenIn Address of the token sold (tokenA or tokenB). The token bought is the other one.
     * @param amountIn Amount of tokenIn paid, fee included.
     * @param amountOut Amount of the other token sent to the trader.
     */
    event Swap(address indexed trader, address indexed tokenIn, uint256 amountIn, uint256 amountOut);

    // ─────────────────────────────── Constructor ──────────────────────────────

    /**
     * @notice Creates the pool for one token pair. The pool starts empty; the first addLiquidity sets the price.
     * @param tokenA_ Address of the first ERC-20 token of the pair.
     * @param tokenB_ Address of the second ERC-20 token of the pair.
     */
    constructor(address tokenA_, address tokenB_) ERC20("42TokenZwapToken", "42TZT") {
        require(tokenA_ != address(0) && tokenB_ != address(0), "AMM: zero address");
        require(tokenA_ != tokenB_, "AMM: identical tokens");

        tokenA = IERC20(tokenA_);
        tokenB = IERC20(tokenB_);
    }

    // ──────────────────────────────── Liquidity ───────────────────────────────

    /**
     * @notice Deposits tokenA and tokenB into the pool and mints LP tokens to the caller.
     * @dev Caller must approve this contract for both tokens first.
     *      If the ratio does not match the pool, LP is minted on the smaller side (min);
     *      the excess stays in the pool and benefits all LPs.
     * @param amountA Amount of tokenA to deposit.
     * @param amountB Amount of tokenB to deposit.
     * @return liquidity Amount of LP tokens minted.
     */
    function addLiquidity(uint256 amountA, uint256 amountB) external nonReentrant returns (uint256 liquidity) {
        require(amountA > 0 && amountB > 0, "AMM: zero amount");

        // 1) LP 발행량 계산
        uint256 lpSupply = totalSupply();
        if (lpSupply == 0) {
            liquidity = Math.sqrt(amountA * amountB);
        } else {
            liquidity = Math.min(amountA * lpSupply / reserveA, amountB * lpSupply / reserveB);
        }
        require(liquidity > 0, "AMM: insufficient liquidity minted");

        // 2) 토큰 가져오기 (caller → AMM)
        tokenA.safeTransferFrom(msg.sender, address(this), amountA);
        tokenB.safeTransferFrom(msg.sender, address(this), amountB);

        // 3) 장부 갱신
        reserveA = reserveA + amountA;
        reserveB = reserveB + amountB;

        // 4) LP 발행 + 이벤트
        _mint(msg.sender, liquidity);
        emit LiquidityAdded(msg.sender, amountA, amountB, liquidity);
    }

    /**
     * @notice Burns LP tokens and returns the caller's share of both reserves.
     * @dev Burn all LP for a full withdrawal, or part of it for a partial withdrawal.
     * @param lpAmount Amount of LP tokens to burn.
     * @return amountA Amount of tokenA returned.
     * @return amountB Amount of tokenB returned.
     */
    function removeLiquidity(uint256 lpAmount) external nonReentrant returns (uint256 amountA, uint256 amountB) {
        require(lpAmount > 0, "AMM: zero amount");

        // Calculate the amounts (before burning LP)
        uint256 lpSupply = totalSupply();
        amountA = lpAmount * reserveA / lpSupply;
        amountB = lpAmount * reserveB / lpSupply;
        require(amountA > 0 && amountB > 0, "AMM: insufficient liquidity burned");

        _burn(msg.sender, lpAmount);

        // 장부 차감
        reserveA = reserveA - amountA;
        reserveB = reserveB - amountB;

        // 토큰 보내기
        tokenA.safeTransfer(msg.sender, amountA);
        tokenB.safeTransfer(msg.sender, amountB);

        emit LiquidityRemoved(msg.sender, lpAmount, amountA, amountB);
    }

    // ────────────────────────────────── Swap ──────────────────────────────────

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

        // 1 bp = 0.01% = 0.0001
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
        require(tokenIn == address(tokenA) || tokenIn == address(tokenB), "AMM: invalid token");
        // 2) 방향 정하기: A→B 인가?
        bool isAToB = tokenIn == address(tokenA);

        (IERC20 inToken, IERC20 outToken, uint256 reserveIn, uint256 reserveOut) =
            isAToB ? (tokenA, tokenB, reserveA, reserveB) : (tokenB, tokenA, reserveB, reserveA);

        // 3) 받을 양 계산 + 슬리피지 검사
        amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
        require(amountOut >= minAmountOut, "AMM: slippage");
        require(amountOut > 0, "AMM: insufficient output");

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
    /**
     * @notice Emitted when an NFT is listed for sale and escrowed in this contract.
     * @param listingId ID of the new listing.
     * @param seller Address that listed the NFT.
     * @param nft ERC-721 contract of the listed NFT.
     * @param tokenId Token ID of the listed NFT.
     * @param paymentToken Token the buyer must pay with (tokenA or tokenB).
     * @param price Price in paymentToken units.
     */
    event NFTListed(
        uint256 indexed listingId,
        address indexed seller,
        address indexed nft,
        uint256 tokenId,
        address paymentToken,
        uint256 price
    );
    /**
     * @notice Emitted when a seller cancels a listing and gets the NFT back.
     * @param listingId ID of the cancelled listing.
     * @param seller Address that cancelled and received the NFT.
     */
    event NFTListingCancelled(uint256 indexed listingId, address indexed seller);

    // ──────────────────────────── NFT marketplace ─────────────────────────────

    /**
     * @notice Lists an NFT for sale at a fixed price and escrows it in this contract.
     * @dev Caller must first approve this contract for the NFT (approve or setApprovalForAll).
     *      Uses transferFrom: this contract is the receiver and is known to handle ERC-721,
     *      so the onERC721Received check of safeTransferFrom is not needed.
     * @param nft ERC-721 contract of the NFT to sell.
     * @param tokenId Token ID to sell. Caller must own it.
     * @param price Price in paymentToken units. Must be greater than 0.
     * @param paymentToken Token the buyer will pay with. Must be tokenA or tokenB.
     * @return listingId ID of the new listing.
     */
    function listNFT(address nft, uint256 tokenId, uint256 price, address paymentToken)
        external
        nonReentrant
        returns (uint256 listingId)
    {
        // (라) (다) Checks
        require(paymentToken == address(tokenA) || paymentToken == address(tokenB), "AMM: invalid payment token"); // [1]
        require(price > 0, "AMM: zero price");

        // (가) (마) Effects: 지금 번호에 저장하고, 다음 번호로
        listingId = nextListingId; // [2]
        listings[listingId] = Listing({
            seller: msg.sender, // [3]
            nft: IERC721(nft),
            tokenId: tokenId,
            price: price,
            paymentToken: IERC20(paymentToken),
            active: true // [4]
        });
        nextListingId = nextListingId + 1;

        // (나) Interactions: NFT를 판매자 → AMM으로 (escrow)
        IERC721(nft).transferFrom(msg.sender, address(this), tokenId); // [5]

        // (바)
        emit NFTListed(listingId, msg.sender, nft, tokenId, paymentToken, price);
    }

    /**
     * @notice Cancels an active listing and returns the escrowed NFT to the seller.
     * @dev Only the seller of the listing can cancel it.
     * @param listingId ID of the listing to cancel.
     */
    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId]; // [1] 원본 or 복사본?

        // Checks
        require(listing.active, "AMM: listing not active"); // [2]
        require(listing.seller == msg.sender, "AMM: not the seller"); // [3]

        // Effects
        listing.active = false; // [4]

        // Interactions: AMM → 판매자로 NFT 반환
        listing.nft.transferFrom(address(this), msg.sender, listing.tokenId); // [5]

        emit NFTListingCancelled(listingId, msg.sender);
    }

    /**
     * @notice Emitted when an NFT is bought.
     * @param listingId ID of the listing that was bought.
     * @param buyer Address that paid and received the NFT.
     * @param seller Address that received the payment.
     * @param price Amount of paymentToken paid.
     */
    event NFTSold(uint256 indexed listingId, address indexed buyer, address indexed seller, uint256 price);

    /**
     * @notice Buys an active listing: pays the seller and receives the escrowed NFT.
     * @dev Caller must first approve this contract for `price` of the listing's paymentToken.
     *      Payment goes straight to the seller and never touches the pool reserves.
     * @param listingId ID of the listing to buy.
     */
    function buyNFT(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId]; // [1]

        // Checks
        require(listing.active, "AMM: listing not active");

        // Effects
        listing.active = false; // [2]

        // Interactions
        listing.paymentToken.safeTransferFrom(msg.sender, listing.seller, listing.price); // [3] 대금: 구매자 → 판매자
        listing.nft.transferFrom(address(this), msg.sender, listing.tokenId); // [4] NFT: AMM → 구매자

        emit NFTSold(listingId, msg.sender, listing.seller, listing.price);
    }
}
