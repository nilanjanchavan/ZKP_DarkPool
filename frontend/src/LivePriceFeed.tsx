import { useEffect, useMemo, useRef, useState } from "react";
import { Contract, JsonRpcProvider, formatUnits } from "ethers";
import { ZK_POOL_ABI, isNativeToken } from "./config";
import type { NetworkConfig } from "../../config/networks";

const REFRESH_INTERVAL_MS = 15000;

interface LivePriceFeedProps {
  network: NetworkConfig;
}

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type Trend = "up" | "down" | "flat";

export default function LivePriceFeed({ network }: LivePriceFeedProps) {
  const [price, setPrice] = useState<string | null>(null);
  const [raw, setRaw] = useState<bigint | null>(null);
  const [trend, setTrend] = useState<Trend>("flat");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const provider = useMemo(() => new JsonRpcProvider(network.RPC_URL), [network]);
  const pool = useMemo(() => new Contract(network.POOL_ADDRESS, ZK_POOL_ABI, provider), [network, provider]);
  const nativeSymbol = useMemo(
    () => network.SUPPORTED_TOKENS.find((t) => isNativeToken(t))?.symbol ?? "ETH",
    [network]
  );
  const prevRawRef = useRef<bigint | null>(null);

  useEffect(() => {
    prevRawRef.current = null;
    setLoading(true);
    setError(null);
    setPrice(null);
    setRaw(null);
    setUpdatedAt(null);
  }, [network]);

  const loadPrice = async () => {
    try {
      const next = (await pool.getLatestPrice()) as bigint;
      if (prevRawRef.current != null) {
        if (next > prevRawRef.current) setTrend("up");
        else if (next < prevRawRef.current) setTrend("down");
        else setTrend("flat");
      } else {
        setTrend("flat");
      }
      prevRawRef.current = next;
      setRaw(next);
      setPrice(usdFormatter.format(Number(formatUnits(next, 18))));
      setUpdatedAt(new Date());
      setError(null);
    } catch (err) {
      console.error("LivePriceFeed: failed to read pool price:", err);
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPrice();
    const interval = setInterval(loadPrice, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [pool]);

  useEffect(() => {
    if (!updatedAt) return;
    const timer = setInterval(() => {
      setStale(Date.now() - updatedAt.getTime() > REFRESH_INTERVAL_MS * 2);
    }, 5000);
    return () => clearInterval(timer);
  }, [updatedAt]);

  return (
    <div style={styles.card}>
      <div style={styles.topRow}>
        <span style={styles.pair}>{nativeSymbol} / USD</span>
        {loading ? (
          <span style={styles.badge}>…</span>
        ) : error ? (
          <span style={styles.badgeError}>OFFLINE</span>
        ) : stale ? (
          <span style={styles.badgeStale}>STALE</span>
        ) : (
          <span style={styles.badgeLive}>LIVE</span>
        )}
      </div>

      {price !== null ? (
        <div style={styles.priceRow}>
          <span style={styles.price}>{price}</span>
          <span style={{ ...styles.trend, color: trend === "up" ? "#7dd3a8" : trend === "down" ? "#ff8f8f" : "#8b90a7" }}>
            {trend === "up" ? "▲" : trend === "down" ? "▼" : "•"}
          </span>
        </div>
      ) : (
        <div style={styles.pricePlaceholder}>{loading ? "Loading price…" : "—"}</div>
      )}

      <p style={styles.subtitle}>
        {error
          ? `Feed unavailable (${error}). Auto-retrying every ${REFRESH_INTERVAL_MS / 1000}s.`
          : `Fair market price from ZKDarkPool · refreshes every ${REFRESH_INTERVAL_MS / 1000}s${
              updatedAt ? ` · last update ${updatedAt.toLocaleTimeString()}` : ""
            }`}
      </p>

      {raw != null && (
        <p style={styles.footnote}>
          Raw: {formatUnits(raw, 18)} (18 decimals — pool scales the 8-decimal oracle to 18) · pool{" "}
          {network.POOL_ADDRESS}
        </p>
      )}
    </div>
  );
}

const styles = {
  card: {
    background: "#0f1220",
    border: "1px solid #2a2f45",
    borderRadius: 8,
    padding: "1.25rem 1.5rem",
    width: "100%",
    maxWidth: "100%",
    margin: 0,
    fontFamily: "system-ui, sans-serif",
    color: "#e6e8f0",
  },
  topRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  pair: { color: "#8b90a7", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.05em" },
  badge: { color: "#8b90a7", fontSize: "0.7rem" },
  badgeLive: {
    color: "#7dd3a8",
    border: "1px solid #2e7d5b",
    borderRadius: 999,
    padding: "2px 10px",
    fontSize: "0.7rem",
    letterSpacing: "0.05em",
  },
  badgeStale: {
    color: "#f5c66f",
    border: "1px solid #8a6d2f",
    borderRadius: 999,
    padding: "2px 10px",
    fontSize: "0.7rem",
    letterSpacing: "0.05em",
  },
  badgeError: {
    color: "#ff6b6b",
    border: "1px solid #a14545",
    borderRadius: 999,
    padding: "2px 10px",
    fontSize: "0.7rem",
    letterSpacing: "0.05em",
  },
  priceRow: { display: "flex", alignItems: "center", gap: 10, margin: "0.5rem 0" },
  price: { fontSize: "2rem", fontWeight: 700, color: "#ffffff" },
  trend: { fontSize: "1.25rem" },
  pricePlaceholder: { fontSize: "2rem", fontWeight: 700, color: "#5c6175", margin: "0.5rem 0" },
  subtitle: { color: "#8b90a7", fontSize: "0.8rem", margin: 0 },
  footnote: { color: "#5c6175", fontSize: "0.72rem", marginTop: 6 },
};
