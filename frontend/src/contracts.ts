import { parseAbi, type Address } from 'viem'

type Deployment = { amm: Address; tokenA: Address; tokenB: Address; nft: Address }

/** 체인 ID → 배포 주소. deployment/<chainId>.json에서 옮겨 온다. */
export const ADDRESSES: Record<number, Deployment> = {
  31337: {
    amm: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    tokenA: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    tokenB: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    nft: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
  },
    97: {
    amm: '0x0a1134046cECA785a218A92376fdb542cB9ACA52',
    tokenA: '0x3b9D1ecef6f5c137343A6C49D4a8f2447FAbaB10',
    tokenB: '0x6CF255a2E7c5ec40D5CD36db887359d290E20A4d',
    nft: '0x7DA2B6BC5330ad801427E6879201b079A774aB15',
  },
}

/** AMM에서 지금 읽을 함수들만 (나중에 swap 등을 추가한다) */
export const ammAbi = parseAbi([
  'function reserveA() view returns (uint256)',
  'function reserveB() view returns (uint256)',
  'function totalSupply() view returns (uint256)', // [1] LP 토큰 총발행량. AMM은 ERC20을 상속했으니 ERC20 표준 함수 이름
  'function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) pure returns (uint256)',
  'function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut) returns (uint256 )',
  'function addLiquidity(uint256 amountA, uint256 amountB) returns (uint256 liquidity)',
  'function removeLiquidity(uint256 lpAmount) returns (uint256 amountA, uint256 amountB)',
  'function listNFT(address nft, uint256 tokenId, uint256 price, address paymentToken) returns (uint256 listingId)',
  'function nextListingId() view returns (uint256)',
  'function listings(uint256 listingId) view returns (address seller, address nft, uint256 tokenId, uint256 price, address paymentToken, bool active)',
  'function cancelListing(uint256 listingId)',
  'function buyNFT(uint256 listingId)',
])

/** TokenizerArt (ERC-721) */
export const nftAbi = parseAbi([
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function balanceOf(address owner) view returns (uint256)',
    'function tokenURI(uint256 tokenId) view returns (string)',
    'function getApproved(uint256 tokenId) view returns (address)', // N2
    'function approve(address to, uint256 tokenId)', // N2
])

export function ipfsToHttp(ipfsUri: string): string {
    if (ipfsUri.startsWith('ipfs://')) {
return ipfsUri.replace('ipfs://', 'https://gateway.pinata.cloud/ipfs/')    }
    return ipfsUri
}   

/** SW42 / R2B 공통 (둘 다 ERC20 + faucet). AMM의 LP 토큰도 ERC20이라 balanceOf는 이걸로 읽을 수 있다. */
export const tokenAbi = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function faucet()', // [1] faucet 함수 시그니처 (인자도, 반환값도 없음. view일까요?)
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
])