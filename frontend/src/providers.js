import { BrowserProvider } from "ethers";
import { DEFAULT_NETWORK, getNetwork } from "../../config/networks";

export function hasWallet() {
  return typeof window !== "undefined" && !!window.ethereum;
}

export function createBrowserProvider() {
  if (!hasWallet()) throw new Error("No Ethereum wallet detected. Install MetaMask.");
  return new BrowserProvider(window.ethereum);
}

function chainIdHex(chainId) {
  return `0x${Number(chainId).toString(16)}`;
}

/** Switches MetaMask to `chainId`, adding the network if it is not present. */
export async function ensureNetwork(chainId) {
  if (!hasWallet()) throw new Error("No Ethereum wallet detected. Install MetaMask.");
  const network = getNetwork(chainId);
  if (!network) throw new Error(`Unsupported network: ${chainId}`);

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex(network.chainId) }],
    });
  } catch (err) {
    if (err?.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainIdHex(network.chainId),
            chainName: network.name,
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: [network.RPC_URL],
            blockExplorerUrls: [network.EXPLORER_URL],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

/** Switches to the default network (used on first connect). */
export function ensureDefaultNetwork() {
  return ensureNetwork(DEFAULT_NETWORK.chainId);
}

export function isSupportedNetwork(chainId) {
  return !!getNetwork(chainId);
}

export function networkName(chainId) {
  return getNetwork(chainId)?.name ?? `Chain ${chainId ?? "?"}`;
}

export function shortenAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
