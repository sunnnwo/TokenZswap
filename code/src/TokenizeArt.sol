// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TokenizeArt is ERC721, Ownable {
    // ID that the next minted NFT will receive
    uint256 private _nextTokenId;

    // Metadata URI shared by every NFT
    string private _tokenURI;

    constructor(string memory metadataURI) ERC721("42 Korean Hacker", "42KH") Ownable(msg.sender) {
        _tokenURI = metadataURI;
    }

    // Mints a new NFT; only the contract owner can call it
    function mint(address to) public onlyOwner {
        uint256 tokenId = _nextTokenId;
        _nextTokenId++;
        _safeMint(to, tokenId);
    }

    // Returns the metadata URI for a given NFT
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        // Make sure the tokenId actually exists
        _requireOwned(tokenId);
        return _tokenURI;
    }
}
