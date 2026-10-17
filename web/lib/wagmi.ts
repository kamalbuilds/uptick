import { createConfig, http } from "wagmi";
import { robinhoodChain } from "./chain";

// No connectors listed: wagmi discovers installed wallets through EIP-6963.
// The picker (components/wallet-button.tsx) curates which of them are offered.
export const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  transports: { [robinhoodChain.id]: http(robinhoodChain.rpcUrls.default.http[0], { retryCount: 4, retryDelay: 400 }) },
  multiInjectedProviderDiscovery: true,
  ssr: true,
});
