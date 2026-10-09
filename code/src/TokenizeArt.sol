// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TokenizeArt is ERC721, Ownable {
    // 다음에 민팅될 NFT의 ID를 추적하는 변수
    uint256 private _nextTokenId;

    // 모든 NFT가 참조하는 메타데이터 URI를 저장하는 변수
    string private _tokenURI;

    constructor(string memory metadataURI) ERC721("42 Korean Hacker", "42KH") Ownable(msg.sender) {
        _tokenURI = metadataURI;
    }

    // NFT를 발행(mint)하는 함수 — 컨트랙트 소유자만 호출 가능
    function mint(address to) public onlyOwner {
        uint256 tokenId = _nextTokenId;
        _nextTokenId++;
        _safeMint(to, tokenId);
    }

    // 특정 NFT의 메타데이터 URI를 반환하는 함수
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        // 해당 tokenId가 실제로 존재하는지 확인
        _requireOwned(tokenId);
        return _tokenURI;
    }
}
