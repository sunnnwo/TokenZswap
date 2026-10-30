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
    uint256 constant SEED_A = 10_000 ether; // initial liquidity: SW42
    uint256 constant SEED_B = 40_000 ether; // initial liquidity: R2B  → initial price 1 SW42 = 4 R2B
    uint256 constant DEMO_NFTS = 3;

    function run() external {
        uint256 startBlock = block.number; // the subgraph starts indexing from this block

        vm.startBroadcast();

        // Tokens
        SunWoo42 tokenA = new SunWoo42(INITIAL_SUPPLY);
        TokenB tokenB = new TokenB(INITIAL_SUPPLY);

        // AMM
        AMM amm = new AMM(address(tokenA), address(tokenB));

        // NFT
        TokenizeArt nft = new TokenizeArt(
            vm.envOr("NFT_METADATA_URI", string("ipfs://bafkreibpuvb4ehyxxwtachnid5whw4nw3q3vhupewzj2mcflxo4oo4vd6i"))
        );

        // Deployer address: the token owner is the deployer (Ownable(msg.sender))
        address deployer = tokenA.owner();

        // Initial liquidity (2 approves + addLiquidity)
        tokenA.approve(address(amm), SEED_A);
        tokenB.approve(address(amm), SEED_B);
        amm.addLiquidity(SEED_A, SEED_B);

        // Demo NFTs
        for (uint256 i = 0; i < DEMO_NFTS; i++) {
            nft.mint(deployer);
        }

        vm.stopBroadcast();

        // Save addresses
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
