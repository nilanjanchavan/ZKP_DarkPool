import { useEffect, useMemo, useState, useCallback } from "react";
import { ethers } from "ethers";
import { safeAddress } from "./config";

const AGGREGATOR_ABI = [
  "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() external view returns (uint8)",
];

const REFRESH_INTERVAL_MS = 15000;

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function feedsFor(network) {
  return network.SUPPORTED_TOKENS.map((token) => ({
    symbol: token.symbol,
    label: `${token.symbol} / USD`,
    address: token.chainlinkOracleAddress,
  }));
}

function emptyStateFor(network) {
  return feedsFor(network).map((feed) => ({
    symbol: feed.symbol,
    label: feed.label,
    price: null,
    decimals: null,
    updatedAt: null,
    loading: true,
    error: null,
  }));
}

async function fetchPrice(provider, feed) {
  const address = safeAddress(feed.address);
  if (!address) throw new Error(`Invalid oracle address: ${feed.address}`);
  const contract = new ethers.Contract(address, AGGREGATOR_ABI, provider);
  const [roundData, decimals] = await Promise.all([contract.latestRoundData(), contract.decimals()]);
  const answer = roundData.answer;
  if (answer <= 0n) throw new Error("non-positive answer");
  return {
    price: Number(answer) / 10 ** Number(decimals),
    decimals: Number(decimals),
    updatedAt: Number(roundData.updatedAt) * 1000,
  };
}

export default function PriceTable({ network }) {
  const provider = useMemo(() => new ethers.JsonRpcProvider(network.RPC_URL), [network]);
  const feeds = useMemo(() => feedsFor(network), [network]);
  const [prices, setPrices] = useState(() => emptyStateFor(network));
  const [lastRefresh, setLastRefresh] = useState(null);
  const [providerError, setProviderError] = useState(null);

  // Reset rows whenever the active network changes.
  useEffect(() => {
    setPrices(emptyStateFor(network));
    setLastRefresh(null);
    setProviderError(null);
  }, [network]);

  // Stable across renders. loadPrices must NOT depend on `prices` (it sets it):
  // a self-referential dep makes the interval effect re-arm on every update and
  // immediately refetch — the source of the previous ~200-400ms request loop.
  const loadPrices = useCallback(async () => {
    try {
      const next = await Promise.all(
        feeds.map(async (feed) => {
          const base = {
            symbol: feed.symbol,
            label: feed.label,
            price: null,
            decimals: null,
            updatedAt: null,
            loading: true,
            error: null,
          };
          try {
            const { price, decimals, updatedAt } = await fetchPrice(provider, feed);
            return { ...base, price, decimals, updatedAt, loading: false };
          } catch (err) {
            console.error(`Failed to fetch ${feed.symbol}:`, err);
            return { ...base, loading: false, error: err.message };
          }
        })
      );
      setPrices(next);
      setLastRefresh(Date.now());
    } catch (err) {
      setProviderError(err?.message ?? String(err));
    }
  }, [provider, feeds]);

  useEffect(() => {
    loadPrices();
    const interval = setInterval(loadPrices, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [provider, feeds, loadPrices]);

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Decentralized Price Feeds</h2>
      <p style={styles.subtitle}>
        Chainlink {network.name} · auto-refresh every {REFRESH_INTERVAL_MS / 1000}s
        {lastRefresh ? ` · last refresh ${new Date(lastRefresh).toLocaleTimeString()}` : ""}
      </p>

      {providerError && <p style={styles.error}>{providerError}</p>}

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.header}>Pair</th>
            <th style={styles.header}>Price (USD)</th>
            <th style={styles.header}>Decimals</th>
            <th style={styles.header}>Updated At</th>
          </tr>
        </thead>
        <tbody>
          {prices.map((p) => (
            <tr key={p.symbol}>
              <td style={styles.cell}>
                <span style={styles.symbol}>{p.symbol}</span>
                <span style={styles.label}>{p.label}</span>
              </td>
              <td style={styles.cell}>
                {p.loading ? (
                  <span style={styles.loading}>…</span>
                ) : p.error ? (
                  <span style={styles.error}>—</span>
                ) : (
                  usdFormatter.format(p.price)
                )}
              </td>
              <td style={styles.cell}>{p.decimals ?? "—"}</td>
              <td style={styles.cell}>
                {p.updatedAt
                  ? `${new Date(p.updatedAt).toLocaleString()} (${p.updatedAt})`
                  : p.loading
                    ? "…"
                    : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const styles = {
  container: {
    fontFamily: "system-ui, sans-serif",
    width: "100%",
    maxWidth: "100%",
    margin: 0,
    padding: "1.5rem",
    background: "#0f1220",
    color: "#e6e8f0",
    border: "1px solid #2a2f45",
    borderRadius: 8,
  },
  title: { margin: 0, fontSize: "1.25rem", color: "#ffffff" },
  subtitle: { color: "#8b90a7", fontSize: "0.85rem", marginTop: 4 },
  table: { width: "100%", borderCollapse: "collapse", marginTop: 12 },
  header: {
    textAlign: "left",
    padding: "0.5rem 0.75rem",
    borderBottom: "1px solid #2a2f45",
    color: "#8b90a7",
    fontSize: "0.75rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  cell: { padding: "0.65rem 0.75rem", borderBottom: "1px solid #1d2235", textAlign: "left" },
  symbol: { fontWeight: 600, color: "#ffffff", marginRight: "0.5rem" },
  label: { color: "#8b90a7", fontSize: "0.85rem" },
  loading: { color: "#5c6175", fontStyle: "italic" },
  error: { color: "#ff6b6b" },
};
