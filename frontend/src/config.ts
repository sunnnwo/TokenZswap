import { createConfig, http } from 'wagmi'
import { anvil, bscTestnet, sepolia } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

/**
 * wagmi config: supported chains, per-chain RPC, and wallet connectors.
 */
export const config = createConfig({
  // Chains this app supports
  chains: [anvil, bscTestnet, sepolia],

  // Wallet connector: browser-injected wallet (MetaMask, etc.)
  connectors: [injected()],

  // RPC URL used for read requests on each chain
  transports: {
    [anvil.id]: http('http://127.0.0.1:8545'),
    [bscTestnet.id]: http(),
    [sepolia.id]: http(),
  },
})

// Tell TypeScript that this app's wagmi config is the one above
// → hooks then only accept chainId 31337 / 97 / 11155111
declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
