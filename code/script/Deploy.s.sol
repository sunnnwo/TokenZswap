// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {SunWoo42} from "../src/SunWoo42.sol";
import {TokenB} from "../src/tokenB.sol";
import {AMM} from "../src/AMM.sol";
import {TokenizeArt} from "../src/TokenizeArt.sol";

/**
 * @notice Deploys SW42, R2B, the AMM and the NFT, seeds the first pool and
 *         writes all addresses to deployment/<chainId>.json.
 * @dev The signer comes from the CLI (--private-key or --account), not from this file.
 */
contract Deploy is Script {
    uint256 constant INITIAL_SUPPLY = 1_000_000 ether;
    uint256 constant SEED_A = 10_000 ether; // 첫 유동성: SW42
    uint256 constant SEED_B = 40_000 ether; // 첫 유동성: R2B  → 초기 가격 1 SW42 = 4 R2B
    uint256 constant DEMO_NFTS = 3;

    function run() external {
        uint256 startBlock = block.number; // 서브그래프가 이 블록부터 읽기 시작

        vm.startBroadcast();

        // ① ② 토큰
        SunWoo42 tokenA = new SunWoo42(INITIAL_SUPPLY);
        TokenB tokenB = new TokenB(INITIAL_SUPPLY);

        // ③ AMM
        AMM amm = new AMM(address(tokenA), address(tokenB)); // [1]

        // ④ NFT
        TokenizeArt nft = new TokenizeArt(
            vm.envOr("NFT_METADATA_URI", string("ipfs://bafkreibpuvb4ehyxxwtachnid5whw4nw3q3vhupewzj2mcflxo4oo4vd6i"))
        );

        // 배포자 주소: 토큰의 owner가 곧 배포자 (Ownable(msg.sender))
        address deployer = tokenA.owner();

        // ⑤ 첫 유동성 (approve 2번 + addLiquidity)
        tokenA.approve(address(amm), SEED_A); // [2]
        tokenB.approve(address(amm), SEED_B); // [2]
        amm.addLiquidity(SEED_A, SEED_B); // [3]

        // ⑥ 데모 NFT
        for (uint256 i = 0; i < DEMO_NFTS; i++) {
            nft.mint(deployer); // [4]
        }

        vm.stopBroadcast();

        // ⑦ 주소 저장
        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeUint(obj, "startBlock", startBlock);
        vm.serializeAddress(obj, "tokenA", address(tokenA));
        vm.serializeAddress(obj, "tokenB", address(tokenB));
        vm.serializeAddress(obj, "amm", address(amm));
        string memory json = vm.serializeAddress(obj, "nft", address(nft));
        vm.writeJson(json, string.concat("../deployment/", vm.toString(block.chainid), ".json"));

        console.log("SW42 :", address(tokenA));
        console.log("R2B  :", address(tokenB));
        console.log("AMM  :", address(amm));
        console.log("NFT  :", address(nft));
    }
}
