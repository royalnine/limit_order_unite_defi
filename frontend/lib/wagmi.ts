import { http, createConfig } from 'wagmi'
import { mainnet, arbitrum } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

// Define the local hardhat network
const localhost = {
  id: 31337,
  name: 'Localhost',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: ['http://127.0.0.1:8547'] },
  },
} as const

export const config = createConfig({
  chains: [localhost],
  connectors: [
    injected({ target: 'metaMask' }),
  ],
  transports: {
    [localhost.id]: http(),
    // [mainnet.id]: http(),
    // [arbitrum.id]: http(),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}