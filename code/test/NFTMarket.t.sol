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

    address alice = makeAddr("alice"); // seller
    address bob = makeAddr("bob"); // buyer
    address carol = makeAddr("carol"); // second buyer (for failure cases)

    uint256 constant TOKEN_ID = 0; // first NFT ID alice receives (TokenizeArt mints from 0)
    uint256 constant PRICE = 500 ether;

    // To compare events with expectEmit, the test must declare them with the same signature.
    event NFTListed(
        uint256 indexed listingId,
        address indexed seller,
        address indexed nft,
        uint256 tokenId,
        address paymentToken,
        uint256 price
    );

    /// @dev Deploys two tokens + AMM + NFT, gives alice NFT #0 and bob/carol payment tokens
    function setUp() public {
        tokenA = new SunWoo42(1_000_000 ether);
        tokenB = new TokenB(1_000_000 ether);
        amm = new AMM(address(tokenA), address(tokenB));
        nft = new TokenizeArt("ipfs://test-metadata"); // this test contract is the owner, so it can mint

        nft.mint(alice); // alice now owns NFT #0

        tokenA.transfer(bob, 10_000 ether);
        tokenB.transfer(bob, 10_000 ether);
        tokenA.transfer(carol, 10_000 ether);
        tokenB.transfer(carol, 10_000 ether);
    }

    // ───────────────────────────── Helpers ─────────────────────────────

    /// @dev alice does 1 approve + 1 listNFT (same flow as 2 MetaMask signatures)
    function _listAsAlice(address paymentToken) internal returns (uint256 listingId) {
        vm.startPrank(alice);
        nft.approve(address(amm), TOKEN_ID);
        listingId = amm.listNFT(address(nft), TOKEN_ID, PRICE, paymentToken);
        vm.stopPrank();
    }

    /// @dev `who` does 1 payment-token approve + 1 buyNFT
    function _buy(address who, address paymentToken, uint256 listingId) internal {
        vm.startPrank(who);
        IERC20(paymentToken).approve(address(amm), PRICE);
        amm.buyNFT(listingId);
        vm.stopPrank();
    }

    /// @dev listings(id) returns the 6 fields as a tuple; this extracts only the last one (active).
    function _isActive(uint256 listingId) internal view returns (bool active) {
        (,,,,, active) = amm.listings(listingId);
    }

    // ───────────────────────────── A. Listing ─────────────────────────────

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
        nft.approve(address(amm), TOKEN_ID); // approve first, since it also emits an Approval event

        // The very next call (listNFT) must emit this event; compare topic1, topic2, topic3 and data
        vm.expectEmit(true, true, true, true, address(amm));
        emit NFTListed(0, alice, address(nft), TOKEN_ID, address(tokenA), PRICE);

        amm.listNFT(address(nft), TOKEN_ID, PRICE, address(tokenA));
        vm.stopPrank();
    }

    // ───────────────────────────── B. Cancel ─────────────────────────────

    function test_Cancel_ReturnsNFTAndDeactivates() public {
        uint256 listingId = _listAsAlice(address(tokenA));

        vm.prank(alice);
        amm.cancelListing(listingId);

        assertEq(nft.ownerOf(TOKEN_ID), alice, "NFT is back with the seller");
        assertFalse(_isActive(listingId), "listing must be inactive (storage, not memory)");
    }

    // ───────────────────────────── C. Buy ─────────────────────────────

    function test_Buy_PaysSellerAndTransfersNFT() public {
        uint256 listingId = _listAsAlice(address(tokenB)); // this time the listing is paid in R2B

        uint256 aliceBefore = tokenB.balanceOf(alice);
        uint256 bobBefore = tokenB.balanceOf(bob);

        _buy(bob, address(tokenB), listingId);

        assertEq(nft.ownerOf(TOKEN_ID), bob, "buyer owns the NFT");
        assertEq(tokenB.balanceOf(alice), aliceBefore + PRICE, "seller got paid");
        assertEq(tokenB.balanceOf(bob), bobBefore - PRICE, "buyer paid");
        assertEq(tokenB.balanceOf(address(amm)), 0, "payment never sits in AMM");
        assertFalse(_isActive(listingId), "sold listing is inactive");
    }

    // ───────────────────────────── D. Cancel by non-seller ─────────────────────────────

    function test_RevertWhen_NonSellerCancels() public {
        uint256 listingId = _listAsAlice(address(tokenA));

        vm.prank(bob);
        vm.expectRevert(bytes("AMM: not the seller"));
        amm.cancelListing(listingId);
    }

    // ───────────────────────────── E. Double purchase ─────────────────────────────

    function test_RevertWhen_BuyingSoldListing() public {
        uint256 listingId = _listAsAlice(address(tokenA));
        _buy(bob, address(tokenA), listingId);

        vm.startPrank(carol);
        tokenA.approve(address(amm), PRICE);
        vm.expectRevert(bytes("AMM: listing not active"));
        amm.buyNFT(listingId);
        vm.stopPrank();
    }

    // ───────────────────────────── F. Invalid payment token ─────────────────────────────

    function test_RevertWhen_InvalidPaymentToken() public {
        SunWoo42 otherToken = new SunWoo42(1 ether); // token unrelated to the pool

        vm.startPrank(alice);
        nft.approve(address(amm), TOKEN_ID);
        vm.expectRevert(bytes("AMM: invalid payment token"));
        amm.listNFT(address(nft), TOKEN_ID, PRICE, address(otherToken));
        vm.stopPrank();
    }

    // ───────────────────────────── G. Independent of the pool ─────────────────────────────

    function test_Marketplace_DoesNotTouchPoolReserves() public {
        // Seed the pool with liquidity first (bob is the provider)
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
