import { useEffect, useMemo, useState } from "react";
import { DEFAULT_NETWORK, NETWORKS, getNetwork } from "../../config/networks";
import { buildLocalNetworkFromJson } from "./config";
import ConnectWallet from "./ConnectWallet";
import LivePriceFeed from "./LivePriceFeed";
import OrderDashboard from "./OrderDashboard";
import PriceTable from "./PriceTable";
import TradingTerminal from "./TradingTerminal";
import { ensureNetwork, hasWallet } from "./providers";

const LOCAL_CHAIN_ID = 31337;

export default function App() {
  const [account, setAccount] = useState(null);
  const [activeChainId, setActiveChainId] = useState(DEFAULT_NETWORK.chainId);
  // Live localhost addresses from frontend/public/local-addresses.json (written
  // by scripts/deploy.cjs); supersedes the 31337 skeleton in config/networks.ts.
  const [localNetwork, setLocalNetwork] = useState(null);
  // "idle" | "loading" | "ready" | "missing" — drives the render gate below so
  // read-heavy children never fire against the zero-address skeleton.
  const [localStatus, setLocalStatus] = useState("idle");

  useEffect(() => {
    if (activeChainId !== LOCAL_CHAIN_ID) {
      setLocalNetwork(null);
      setLocalStatus("idle");
      return undefined;
    }
    let cancelled = false;
    setLocalStatus("loading");
    fetch("/local-addresses.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data && data.poolAddress) {
          setLocalNetwork(buildLocalNetworkFromJson(data, getNetwork(LOCAL_CHAIN_ID)));
          setLocalStatus("ready");
        } else {
          setLocalNetwork(null);
          setLocalStatus("missing");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setLocalNetwork(null);
        setLocalStatus("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [activeChainId]);

  // The dropdown selection (activeChainId) is the source of truth for ALL
  // chain reads. The network object is memoized so its identity only changes
  // when the selection (or the local JSON) actually changes — children create
  // providers/intervals keyed on it, so an unstable identity would restart
  // their polling loops on every re-render.
  const network = useMemo(() => {
    if (activeChainId === LOCAL_CHAIN_ID) {
      // Prefer live deployed addresses; fall back to the 31337 skeleton in
      // config/networks.ts (localhost RPC). NEVER silently fall back to Sepolia
      // for a locally-selected network.
      return localNetwork ?? getNetwork(LOCAL_CHAIN_ID) ?? DEFAULT_NETWORK;
    }
    // Other chains: resolve from config. The final Sepolia fallback only
    // applies when the chain is genuinely unknown AND is not a configured one.
    return getNetwork(activeChainId) ?? NETWORKS[11155111] ?? DEFAULT_NETWORK;
  }, [activeChainId, localNetwork]);

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

        {activeChainId === LOCAL_CHAIN_ID && localStatus !== "ready" ? (
          <div style={styles.localGate}>
            {localStatus === "missing" ? (
              <p>
                frontend/public/local-addresses.json not found — run{" "}
                <code>npx hardhat run scripts/deploy.cjs --network localhost</code> so the
                deployed pool / mock feeds / mock LINK are known to the UI.
              </p>
            ) : (
              <p>Loading local contract addresses from local-addresses.json…</p>
            )}
          </div>
        ) : (
          <>
            <LivePriceFeed network={network} />

            <TradingTerminal account={account} network={network} />

            <OrderDashboard account={account} network={network} />

            <PriceTable network={network} />
          </>
        )}
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
  localGate: {
    background: "#1a2136",
    color: "#8b90a7",
    fontSize: "0.85rem",
    padding: "1rem 1.5rem",
    border: "1px dashed #2a3a55",
    borderRadius: 8,
  },
};
