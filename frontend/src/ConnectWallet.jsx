import { useCallback, useEffect, useRef, useState } from "react";
import { formatEther } from "ethers";
import { getNetwork } from "../../config/networks";
import { createBrowserProvider, ensureNetwork, networkName, shortenAddress } from "./providers";

export default function ConnectWallet({ onAccountChange, onNetworkChange, targetChainId }) {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [balance, setBalance] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const providerRef = useRef(null);
  const handlersRef = useRef([]);

  const readAccount = useCallback(async () => {
    const provider = providerRef.current;
    if (!provider) return;
    try {
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      const network = await provider.getNetwork();
      const bal = await provider.getBalance(address);
      const nextChainId = Number(network.chainId);
      setAccount(address);
      setChainId(nextChainId);
      setBalance(formatEther(bal));
      setError(null);
      onNetworkChange?.(nextChainId);
    } catch (err) {
      console.error("readAccount failed:", err);
      setError(err?.message ?? String(err));
    }
  }, [onNetworkChange]);

  const handleConnect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const provider = createBrowserProvider();
      providerRef.current = provider;

      await provider.send("eth_requestAccounts", []);
      if (targetChainId) await ensureNetwork(targetChainId);
      await readAccount();

      const onAccountsChanged = () => readAccount();
      const onChainChanged = () => readAccount();
      handlersRef.current = [onAccountsChanged, onChainChanged];
      window.ethereum.on("accountsChanged", onAccountsChanged);
      window.ethereum.on("chainChanged", onChainChanged);
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [targetChainId, readAccount]);

  const handleDisconnect = useCallback(() => {
    const [onAccountsChanged, onChainChanged] = handlersRef.current;
    if (onAccountsChanged) window.ethereum?.removeListener("accountsChanged", onAccountsChanged);
    if (onChainChanged) window.ethereum?.removeListener("chainChanged", onChainChanged);
    handlersRef.current = [];
    providerRef.current = null;
    setAccount(null);
    setChainId(null);
    setBalance(null);
  }, []);

  useEffect(() => {
    onAccountChange?.(account);
  }, [account, onAccountChange]);

  const explorerUrl = getNetwork(chainId)?.EXPLORER_URL;

  if (account) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.meta}>
          <span style={styles.badge}>{networkName(chainId)}</span>
          <a
            href={`${explorerUrl ?? ""}/address/${account}`}
            target="_blank"
            rel="noreferrer"
            style={styles.address}
          >
            {shortenAddress(account)}
          </a>
          <span style={styles.balance}>{balance !== null ? `${Number(balance).toFixed(4)} ETH` : "…"}</span>
        </div>
        <button style={styles.button} onClick={handleDisconnect}>
          Disconnect
        </button>
        {error && <p style={styles.error}>{error}</p>}
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      <button style={styles.button} onClick={handleConnect} disabled={busy}>
        {busy ? "Connecting…" : "Connect Wallet"}
      </button>
      {error && <p style={styles.error}>{error}</p>}
    </div>
  );
}

const styles = {
  wrapper: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 },
  meta: { display: "flex", alignItems: "center", gap: 10 },
  badge: {
    background: "#1a2136",
    color: "#7dd3a8",
    border: "1px solid #2a3a55",
    borderRadius: 999,
    padding: "2px 10px",
    fontSize: "0.72rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  address: { color: "#e6e8f0", fontSize: "0.85rem", textDecoration: "none" },
  balance: { color: "#8b90a7", fontSize: "0.85rem" },
  button: {
    background: "#4f7cff",
    color: "#ffffff",
    border: "none",
    borderRadius: 6,
    padding: "0.5rem 1.1rem",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  error: { color: "#ff6b6b", fontSize: "0.8rem", margin: 0, maxWidth: 260 },
};
