import { useState } from "react";
import { DEFAULT_NETWORK, NETWORKS, getNetwork } from "../../config/networks";
import ConnectWallet from "./ConnectWallet";
import LivePriceFeed from "./LivePriceFeed";
import OrderDashboard from "./OrderDashboard";
import PriceTable from "./PriceTable";
import TradingTerminal from "./TradingTerminal";
import { ensureNetwork, hasWallet } from "./providers";

export default function App() {
  const [account, setAccount] = useState(null);
  const [activeChainId, setActiveChainId] = useState(DEFAULT_NETWORK.chainId);

  const network = getNetwork(activeChainId) ?? NETWORKS[11155111] ?? DEFAULT_NETWORK;

  const handleNetworkChange = async (chainId) => {
    setActiveChainId(chainId);
    if (hasWallet()) {
      try {
        await ensureNetwork(chainId);
      } catch (err) {
        console.error("Network switch failed:", err);
      }
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.main}>
        <header style={styles.header}>
          <div>
            <h1 style={styles.title}>ZK Dark Pool</h1>
            <p style={styles.subtitle}>
              Pool{" "}
              <a
                href={`${network.EXPLORER_URL}/address/${network.POOL_ADDRESS}`}
                target="_blank"
                rel="noreferrer"
                style={styles.link}
              >
                {network.POOL_ADDRESS}
              </a>
            </p>
          </div>

          <div style={styles.controls}>
            <select
              style={styles.networkSelect}
              value={String(network.chainId)}
              onChange={(e) => handleNetworkChange(Number(e.target.value))}
              aria-label="Network"
            >
              {Object.values(NETWORKS).map((n) => (
                <option key={n.chainId} value={String(n.chainId)}>
                  {n.name}
                </option>
              ))}
            </select>
            <ConnectWallet
              onAccountChange={setAccount}
              onNetworkChange={setActiveChainId}
              targetChainId={activeChainId}
            />
          </div>
        </header>

        {account && (
          <p style={styles.connected}>
            Connected: {account} · {network.name}
          </p>
        )}

        <LivePriceFeed network={network} />

        <TradingTerminal account={account} network={network} />

        <OrderDashboard account={account} network={network} />

        <PriceTable network={network} />
      </div>
    </div>
  );
}

const styles = {
  page: {
    width: "100%",
    minHeight: "100vh",
    background: "#0a0c16",
    color: "#e6e8f0",
    fontFamily: "system-ui, sans-serif",
  },
  main: {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "24px",
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    width: "100%",
    flexWrap: "wrap",
    gap: "0.5rem",
  },
  title: { margin: 0, fontSize: "1.5rem", color: "#ffffff" },
  subtitle: { color: "#8b90a7", fontSize: "0.8rem", marginTop: 4 },
  link: { color: "#7db0ff", textDecoration: "none" },
  controls: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 },
  networkSelect: {
    padding: "0.5rem 0.75rem",
    borderRadius: 6,
    border: "1px solid #2a2f45",
    background: "#161a2e",
    color: "#e6e8f0",
    fontSize: "0.85rem",
    cursor: "pointer",
  },
  connected: {
    fontSize: "0.8rem",
    color: "#7dd3a8",
  },
};
