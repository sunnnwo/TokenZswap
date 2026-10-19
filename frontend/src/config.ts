import { createConfig, http } from 'wagmi'
import { anvil, bscTestnet, sepolia } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

/**
 * wagmi 설정: 앱이 사용할 체인, 체인별 RPC, 지갑 연결 방식.
 */
export const config = createConfig({
  // 1) 이 앱이 지원하는 체인 목록
  chains: [anvil, bscTestnet, sepolia],

  // 2) 지갑 연결 방식: 브라우저에 설치된 지갑(MetaMask 등)
  connectors: [injected()],

  // 3) 체인마다 "읽기" 요청을 보낼 RPC 주소
  transports: {
    [anvil.id]: http('http://127.0.0.1:8545'),
    [bscTestnet.id]: http(),
    [sepolia.id]: http(),
  },
})

// TypeScript에게 "이 앱의 wagmi 설정은 위의 config다"라고 알려줌
// → 훅에서 chainId를 쓸 때 31337 / 97 / 11155111만 허용하도록 자동 검사
declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
