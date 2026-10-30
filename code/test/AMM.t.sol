// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AMM} from "../src/AMM.sol";
import {SunWoo42} from "../src/SunWoo42.sol";
import {TokenB} from "../src/tokenB.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract AMMTest is Test {
    AMM amm;
    SunWoo42 tokenA;
    TokenB tokenB;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    /// @dev Runs before each test: deploys two tokens + AMM and funds alice/bob
    function setUp() public {
        tokenA = new SunWoo42(1_000_000 ether); // this test contract is the deployer, so it receives the full supply
        tokenB = new TokenB(1_000_000 ether);
        amm = new AMM(address(tokenA), address(tokenB));

        tokenA.transfer(alice, 10_000 ether);
        tokenB.transfer(alice, 10_000 ether);
        tokenA.transfer(bob, 10_000 ether);
        tokenB.transfer(bob, 10_000 ether);
    }

    /// @dev `who` does 2 approves + 1 addLiquidity (same flow as 3 MetaMask signatures)
    function _addLiquidity(address who, uint256 amountA, uint256 amountB) internal returns (uint256) {
        vm.startPrank(who);
        tokenA.approve(address(amm), amountA);
        tokenB.approve(address(amm), amountB);
        uint256 lp = amm.addLiquidity(amountA, amountB);
        vm.stopPrank();
        return lp;
    }

    // ───────────── T1: first deposit ─────────────
    function test_FirstDeposit_MintsSqrt() public {
        uint256 lp = _addLiquidity(alice, 100 ether, 400 ether);

        assertEq(lp, 200 ether); // √(100 × 400)
        assertEq(amm.balanceOf(alice), 200 ether);
        assertEq(amm.reserveA(), 100 ether);
        assertEq(amm.reserveB(), 400 ether);
    }

    // ───────────── T2: additional deposit ─────────────
    function test_SecondDeposit_Proportional() public {
        _addLiquidity(alice, 100 ether, 400 ether);
        uint256 lp = _addLiquidity(bob, 100 ether, 400 ether);

        assertEq(lp, 200 ether);
        assertEq(amm.totalSupply(), 400 ether);
    }

    // ───────────── T4: partial withdrawal ─────────────
    function test_RemoveLiquidity_Partial() public {
        _addLiquidity(alice, 100 ether, 400 ether);
        _addLiquidity(bob, 100 ether, 400 ether);
        // Pool: 200 / 800 / LP 400. Bob withdraws only 100 LP (25%)

        uint256 bobABefore = tokenA.balanceOf(bob);
        vm.prank(bob); // only the next call is made as bob
        (uint256 outA, uint256 outB) = amm.removeLiquidity(100 ether);

        assertEq(outA, 50 ether); // 100 × 200 / 400
        assertEq(outB, 200 ether); // 100 × 800 / 400
        assertEq(tokenA.balanceOf(bob), bobABefore + outA); // tokens actually reached the wallet
        assertEq(amm.balanceOf(bob), 100 ether); // 200 − 100
    }

    // ───────────── Expected failures ─────────────
    function test_RevertWhen_AddZero() public {
        vm.prank(alice);
        vm.expectRevert(bytes("AMM: zero amount")); // addLiquidity's require message
        amm.addLiquidity(0, 100 ether);
    }

    // ───────────── Swap Test ─────────────
    function _swap(address who, address tokenIn, uint256 amountIn, uint256 minOut) internal returns (uint256) {
        vm.startPrank(who);
        IERC20(tokenIn).approve(address(amm), amountIn);
        uint256 out = amm.swap(tokenIn, amountIn, minOut);
        vm.stopPrank();
        return out;
    }

    function test_Swap_AToB_Invariants() public {
        _addLiquidity(alice, 100 ether, 400 ether);
        _addLiquidity(bob, 100 ether, 400 ether);
        // Pool: 200 / 800 (T3 starting state)

        uint256 kBefore = amm.reserveA() * amm.reserveB();
        uint256 expected = amm.getAmountOut(50 ether, amm.reserveA(), amm.reserveB()); // uses pre-swap reserveA, reserveB

        address carol = makeAddr("carol");
        tokenA.transfer(carol, 50 ether);
        uint256 amountOut = _swap(carol, address(tokenA), 50 ether, 0);

        uint256 kAfter = amm.reserveA() * amm.reserveB();
        uint256 noFeeOut = 800 ether * 50 ether / (200 ether + 50 ether); // 160 ether

        assertGe(kAfter, kBefore, "k must not decrease"); // rule 1
        assertLt(amountOut, noFeeOut, "fee must reduce output"); // rule 2
        assertEq(amm.reserveA(), 250 ether, "reserveA grows by full amountIn"); // rule 3
        assertEq(amm.reserveB(), 800 ether - amountOut, "reserveB shrinks by amountOut"); // rule 3
        assertEq(amountOut, expected, "output matches getAmountOut preview"); // rule 4
        assertEq(tokenB.balanceOf(carol), amountOut, "carol received amountOut"); // tokens actually reached carol's wallet
    }

    function test_RevertWhen_SlippageExceeded() public {
        _addLiquidity(alice, 100 ether, 400 ether);

        tokenA.transfer(bob, 50 ether);
        vm.startPrank(bob);
        tokenA.approve(address(amm), 50 ether);
        vm.expectRevert(bytes("AMM: slippage")); // swap's slippage require message
        amm.swap(address(tokenA), 50 ether, 1_000 ether); // demands at least 1000 out → impossible
        vm.stopPrank();
    }
}
