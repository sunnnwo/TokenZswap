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

    /// @dev 각 테스트 전에 실행: 토큰 2개 + AMM 배포, alice/bob에게 토큰 나눠주기
    function setUp() public {
        tokenA = new SunWoo42(1_000_000 ether); // 이 테스트 컨트랙트가 배포자 → 전량 받음
        tokenB = new TokenB(1_000_000 ether);
        amm = new AMM(address(tokenA), address(tokenB)); // [1]

        tokenA.transfer(alice, 10_000 ether);
        tokenB.transfer(alice, 10_000 ether);
        tokenA.transfer(bob, 10_000 ether);
        tokenB.transfer(bob, 10_000 ether);
    }

    /// @dev who가 approve 2번 + addLiquidity 1번 (MetaMask 서명 3번과 같은 흐름)
    function _addLiquidity(address who, uint256 amountA, uint256 amountB) internal returns (uint256) {
        vm.startPrank(who);
        tokenA.approve(address(amm), amountA); // [2]
        tokenB.approve(address(amm), amountB); // [2]
        uint256 lp = amm.addLiquidity(amountA, amountB);
        vm.stopPrank();
        return lp;
    }

    // ───────────── 노트 T1: 첫 공급 ─────────────
    function test_FirstDeposit_MintsSqrt() public {
        uint256 lp = _addLiquidity(alice, 100 ether, 400 ether);

        assertEq(lp, 200 ether); // [3] √(100 × 400)
        assertEq(amm.balanceOf(alice), 200 ether); // [3]
        assertEq(amm.reserveA(), 100 ether);
        assertEq(amm.reserveB(), 400 ether); // [3]
    }

    // ───────────── 노트 T2: 추가 공급 ─────────────
    function test_SecondDeposit_Proportional() public {
        _addLiquidity(alice, 100 ether, 400 ether);
        uint256 lp = _addLiquidity(bob, 100 ether, 400 ether);

        assertEq(lp, 200 ether); // [4]
        assertEq(amm.totalSupply(), 400 ether); // [4]
    }

    // ───────────── 노트 T4: 부분 출금 ─────────────
    function test_RemoveLiquidity_Partial() public {
        _addLiquidity(alice, 100 ether, 400 ether);
        _addLiquidity(bob, 100 ether, 400 ether);
        // 풀: 200 / 800 / LP 400.  Bob이 LP 100개(25%)만 뺌

        uint256 bobABefore = tokenA.balanceOf(bob);
        vm.prank(bob); // 다음 호출 1번만 bob으로
        (uint256 outA, uint256 outB) = amm.removeLiquidity(100 ether);

        assertEq(outA, 50 ether); // [5] 100 × 200 / 400
        assertEq(outB, 200 ether); // [5] 100 × 800 / 400
        assertEq(tokenA.balanceOf(bob), bobABefore + outA); // 실제로 지갑에 들어왔나
        assertEq(amm.balanceOf(bob), 100 ether); // [5] 200 − 100
    }

    // ───────────── 실패해야 하는 경우 ─────────────
    function test_RevertWhen_AddZero() public {
        vm.prank(alice);
        vm.expectRevert(bytes("AMM: zero amount")); // [6] addLiquidity의 require 메시지
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
        // 풀: 200 / 800 (노트 T3 시작 상태)

        uint256 kBefore = amm.reserveA() * amm.reserveB();
        uint256 expected = amm.getAmountOut(50 ether, amm.reserveA(), amm.reserveB()); // [1] 스왑 전 reserveA, reserveB

        address carol = makeAddr("carol");
        tokenA.transfer(carol, 50 ether);
        uint256 amountOut = _swap(carol, address(tokenA), 50 ether, 0);

        uint256 kAfter = amm.reserveA() * amm.reserveB();
        uint256 noFeeOut = 800 ether * 50 ether / (200 ether + 50 ether); // 160 ether

        assertGe(noFeeOut, amountOut, "[2] k must not decrease"); // [2] 규칙 ①
        assertLt(kBefore, kAfter); // [3] 규칙 ②
        assertEq(amm.reserveA(), 250 ether); // [4] 규칙 ③
        assertEq(amm.reserveB(), 800 ether - amountOut); // [4] 규칙 ③
        assertEq(amountOut, expected); // [5] 규칙 ④
        assertEq(tokenB.balanceOf(carol), amountOut); // carol 지갑에 실제로 들어왔나
    }

    function test_RevertWhen_SlippageExceeded() public {
        _addLiquidity(alice, 100 ether, 400 ether);

        tokenA.transfer(bob, 50 ether);
        vm.startPrank(bob);
        tokenA.approve(address(amm), 50 ether);
        vm.expectRevert(bytes("AMM: slippage")); // [6] swap의 슬리피지 require 메시지
        amm.swap(address(tokenA), 50 ether, 1_000 ether); // 1000개 이상 달라고 요구 → 불가능
        vm.stopPrank();
    }
}
