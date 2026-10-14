// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AMM} from "../src/AMM.sol";
import {SunWoo42} from "../src/SunWoo42.sol";
import {TokenB} from "../src/tokenB.sol";
import {TokenizeArt} from "../src/TokenizeArt.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Tests for the fixed-price NFT marketplace inside AMM (listNFT / cancelListing / buyNFT).
contract NFTMarketTest is Test {
    AMM amm;
    SunWoo42 tokenA;
    TokenB tokenB;
    TokenizeArt nft;

    address alice = makeAddr("alice"); // 판매자
    address bob = makeAddr("bob"); // 구매자
    address carol = makeAddr("carol"); // 두 번째 구매자 (실패 케이스용)

    uint256 constant TOKEN_ID = 0; // alice가 받는 첫 NFT 번호 (TokenizeArt는 0번부터 발행)
    uint256 constant PRICE = 500 ether;

    // 이벤트를 expectEmit으로 비교하려면 테스트 쪽에도 같은 모양으로 선언해 둬야 합니다.
    event NFTListed(
        uint256 indexed listingId,
        address indexed seller,
        address indexed nft,
        uint256 tokenId,
        address paymentToken,
        uint256 price
    );

    /// @dev 토큰 2개 + AMM + NFT 배포, alice에게 NFT 0번, bob과 carol에게 결제용 토큰
    function setUp() public {
        tokenA = new SunWoo42(1_000_000 ether);
        tokenB = new TokenB(1_000_000 ether);
        amm = new AMM(address(tokenA), address(tokenB));
        nft = new TokenizeArt("ipfs://test-metadata"); // 이 테스트 컨트랙트가 owner → mint 가능

        nft.mint(alice); // alice가 NFT 0번을 가짐

        tokenA.transfer(bob, 10_000 ether);
        tokenB.transfer(bob, 10_000 ether);
        tokenA.transfer(carol, 10_000 ether);
        tokenB.transfer(carol, 10_000 ether);
    }

    // ───────────────────────────── 도우미 ─────────────────────────────

    /// @dev alice가 approve 1번 + listNFT 1번 (MetaMask 서명 2번과 같은 흐름)
    function _listAsAlice(address paymentToken) internal returns (uint256 listingId) {
        vm.startPrank(alice);
        nft.approve(address(amm), TOKEN_ID);
        listingId = amm.listNFT(address(nft), TOKEN_ID, PRICE, paymentToken);
        vm.stopPrank();
    }

    /// @dev who가 결제 토큰 approve 1번 + buyNFT 1번
    function _buy(address who, address paymentToken, uint256 listingId) internal {
        vm.startPrank(who);
        IERC20(paymentToken).approve(address(amm), PRICE);
        amm.buyNFT(listingId);
        vm.stopPrank();
    }

    /// @dev listings(id)는 필드 6개를 튜플로 돌려줍니다. 그중 마지막(active)만 꺼냅니다.
    function _isActive(uint256 listingId) internal view returns (bool active) {
        (,,,,, active) = amm.listings(listingId);
    }

    // ───────────────────────────── A. 등록 ─────────────────────────────

    function test_List_EscrowsNFTAndStoresListing() public {
        uint256 listingId = _listAsAlice(address(tokenA));

        assertEq(listingId, 0, "first listing gets ID 0");
        assertEq(amm.nextListingId(), 1, "next ID moves to 1");
        assertEq(nft.ownerOf(TOKEN_ID), address(amm), "NFT is escrowed in AMM");

        (address seller,, uint256 tokenId, uint256 price,, bool active) = amm.listings(listingId);
        assertEq(seller, alice);
        assertEq(tokenId, TOKEN_ID);
        assertEq(price, PRICE);
        assertTrue(active, "listing is active");
    }

    function test_List_EmitsEvent() public {
        vm.startPrank(alice);
        nft.approve(address(amm), TOKEN_ID); // approve를 먼저: 이것도 Approval 이벤트를 내기 때문

        // 바로 다음 호출(listNFT)이 이 이벤트를 내야 함. (topic1, topic2, topic3, data) 모두 비교
        vm.expectEmit(true, true, true, true, address(amm));
        emit NFTListed(0, alice, address(nft), TOKEN_ID, address(tokenA), PRICE);

        amm.listNFT(address(nft), TOKEN_ID, PRICE, address(tokenA));
        vm.stopPrank();
    }

    // ───────────────────────────── B. 취소 ─────────────────────────────

    function test_Cancel_ReturnsNFTAndDeactivates() public {
        uint256 listingId = _listAsAlice(address(tokenA));

        vm.prank(alice);
        amm.cancelListing(listingId);

        assertEq(nft.ownerOf(TOKEN_ID), alice, "NFT is back with the seller");
        assertFalse(_isActive(listingId), "listing must be inactive (storage, not memory)");
    }

    // ───────────────────────────── C. 구매 ─────────────────────────────

    function test_Buy_PaysSellerAndTransfersNFT() public {
        uint256 listingId = _listAsAlice(address(tokenB)); // 이번엔 R2B로 결제받는 등록

        uint256 aliceBefore = tokenB.balanceOf(alice);
        uint256 bobBefore = tokenB.balanceOf(bob);

        _buy(bob, address(tokenB), listingId);

        assertEq(nft.ownerOf(TOKEN_ID), bob, "buyer owns the NFT");
        assertEq(tokenB.balanceOf(alice), aliceBefore + PRICE, "seller got paid");
        assertEq(tokenB.balanceOf(bob), bobBefore - PRICE, "buyer paid");
        assertEq(tokenB.balanceOf(address(amm)), 0, "payment never sits in AMM");
        assertFalse(_isActive(listingId), "sold listing is inactive");
    }

    // ───────────────────────────── D. 남이 취소 시도 ─────────────────────────────

    function test_RevertWhen_NonSellerCancels() public {
        uint256 listingId = _listAsAlice(address(tokenA));

        vm.prank(bob);
        vm.expectRevert(bytes("AMM: not the seller"));
        amm.cancelListing(listingId);
    }

    // ───────────────────────────── E. 두 번 구매 시도 ─────────────────────────────

    function test_RevertWhen_BuyingSoldListing() public {
        uint256 listingId = _listAsAlice(address(tokenA));
        _buy(bob, address(tokenA), listingId);

        vm.startPrank(carol);
        tokenA.approve(address(amm), PRICE);
        vm.expectRevert(bytes("AMM: listing not active"));
        amm.buyNFT(listingId);
        vm.stopPrank();
    }

    // ───────────────────────────── F. 잘못된 결제 토큰 ─────────────────────────────

    function test_RevertWhen_InvalidPaymentToken() public {
        SunWoo42 otherToken = new SunWoo42(1 ether); // 풀과 무관한 토큰

        vm.startPrank(alice);
        nft.approve(address(amm), TOKEN_ID);
        vm.expectRevert(bytes("AMM: invalid payment token"));
        amm.listNFT(address(nft), TOKEN_ID, PRICE, address(otherToken));
        vm.stopPrank();
    }

    // ───────────────────────────── G. 풀과 독립 ─────────────────────────────

    function test_Marketplace_DoesNotTouchPoolReserves() public {
        // 풀에 유동성을 먼저 넣어 둠 (bob이 공급자)
        vm.startPrank(bob);
        tokenA.approve(address(amm), 100 ether);
        tokenB.approve(address(amm), 400 ether);
        amm.addLiquidity(100 ether, 400 ether);
        vm.stopPrank();

        uint256 reserveABefore = amm.reserveA();
        uint256 reserveBBefore = amm.reserveB();

        uint256 listingId = _listAsAlice(address(tokenA));
        _buy(carol, address(tokenA), listingId);

        assertEq(amm.reserveA(), reserveABefore, "NFT sale must not change reserveA");
        assertEq(amm.reserveB(), reserveBBefore, "NFT sale must not change reserveB");
    }
}
