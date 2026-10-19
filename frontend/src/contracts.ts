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
}

/** AMM에서 지금 읽을 함수들만 (나중에 swap 등을 추가한다) */
export const ammAbi = parseAbi([
  'function reserveA() view returns (uint256)',
  'function reserveB() view returns (uint256)',
  'function totalSupply() view returns (uint256)', // [1] LP 토큰 총발행량. AMM은 ERC20을 상속했으니 ERC20 표준 함수 이름
  'function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) pure returns (uint256)',
  'function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut) returns (uint256 )',
])


/** SW42 / R2B 공통 (둘 다 ERC20 + faucet). AMM의 LP 토큰도 ERC20이라 balanceOf는 이걸로 읽을 수 있다. */
export const tokenAbi = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function faucet()', // [1] faucet 함수 시그니처 (인자도, 반환값도 없음. view일까요?)
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
])