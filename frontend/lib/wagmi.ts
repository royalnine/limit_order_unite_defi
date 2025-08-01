import { http, createConfig } from 'wagmi'
import { base } from 'wagmi/chains'
import { injected, metaMask } from 'wagmi/connectors'

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
  chains: [base, localhost], // Add localhost to chains
  connectors: [
    injected(), // Uncomment this for general wallet support
    metaMask(),
  ],
  transports: {
    [localhost.id]: http(), // Uncomment this for localhost support
    [base.id]: http(),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}