import { useCallback, useEffect, useMemo, useState } from "react";
import { Contract, JsonRpcProvider, formatUnits } from "ethers";
import { ZK_POOL_ABI } from "./config";
import { fetchTokenPrice } from "./prices";
import type { NetworkConfig, NetworkToken } from "../../config/networks";

const REFRESH_INTERVAL_MS = 15000;

interface OrderRow {
  id: bigint;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  livePrice: bigint | null;
  fillPrice: bigint | null;
  priceOut: bigint | null;
  active: boolean;
}

interface OrderDashboardProps {
  account: string | null;
  network: NetworkConfig;
}

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type TokenInfo = Map<string, { symbol: string; decimals: number }>;

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// formatUnits() without trailing zeros: "10.0" → "10", "0.0010" → "0.001".
function fmtUnits(amount: bigint, decimals: number): string {
  let s = formatUnits(amount, decimals);
  if (s.includes(".")) {
    s = s.replace(/0+$/, "").replace(/\.$/, "");
  }
  return s === "-0" ? "0" : s;
}

// Human-readable order string, e.g. "10 LINK to 0.001 ETH". The receive side is
// derived from the Chainlink USD prices of both tokens at the order's price.
function fmtOrder(row: OrderRow, info: TokenInfo): string {
  const inInfo = info.get(row.tokenIn.toLowerCase());
  const outInfo = info.get(row.tokenOut.toLowerCase());
  const symIn = inInfo?.symbol ?? shortAddress(row.tokenIn);
  const symOut = outInfo?.symbol ?? shortAddress(row.tokenOut);
  const decIn = inInfo?.decimals ?? 18;
  const decOut = outInfo?.decimals ?? 18;
  const amtIn = fmtUnits(row.amountIn, decIn);

  const priceIn = row.active ? row.livePrice : row.fillPrice;
  let amtOut: string | null = null;
  if (priceIn !== null && priceIn > 0n && row.priceOut !== null && row.priceOut > 0n) {
    const outWei = (row.amountIn * priceIn * 10n ** BigInt(decOut)) / (row.priceOut * 10n ** BigInt(decIn));
    if (outWei > 0n) amtOut = fmtUnits(outWei, decOut);
  }
  return amtOut !== null ? `${amtIn} ${symIn} to ${amtOut} ${symOut}` : `${amtIn} ${symIn}`;
}

function fmtUsd(value18: bigint | null): string {
  if (value18 === null) return "—";
  return usdFormatter.format(Number(formatUnits(value18, 18)));
}

export default function OrderDashboard({ account, network }: OrderDashboardProps) {
  const [listed, setListed] = useState<OrderRow[]>([]);
  const [settled, setSettled] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokens = useMemo<NetworkToken[]>(() => network.SUPPORTED_TOKENS, [network]);
  const provider = useMemo(() => new JsonRpcProvider(network.RPC_URL), [network]);
  const pool = useMemo(() => new Contract(network.POOL_ADDRESS, ZK_POOL_ABI, provider), [network, provider]);
  const tokenInfo = useMemo<TokenInfo>(
    () => new Map(network.SUPPORTED_TOKENS.map((t) => [t.tokenAddress.toLowerCase(), { symbol: t.symbol, decimals: t.decimals }])),
    [network]
  );

  const refresh = useCallback(async () => {
    if (!account) {
      setListed([]);
      setSettled([]);
      setError(null);
      return;
    }
    try {
      setLoading(true);
      const count = Number(await pool.ordersCount());
      const orders: OrderRow[] = [];
      for (let i = 0; i < count; i++) {
        const o = await pool.orders(i);
        if (o.trader.toLowerCase() !== account.toLowerCase()) continue;
        orders.push({
          id: o.id,
          tokenIn: o.tokenIn,
          tokenOut: o.tokenOut,
          amountIn: o.amountIn,
          livePrice: null,
          fillPrice: null,
          priceOut: null,
          active: o.active,
        });
      }

      // USD prices straight from each token's Chainlink feed (the pool's
      // getTokenPrice only knows tokens registered inside the contract).
      const tokenAddrs = new Set(orders.flatMap((o) => [o.tokenIn, o.tokenOut].map((a) => a.toLowerCase())));
      const priceMap = new Map<string, bigint>();
      for (const addr of tokenAddrs) {
        const token = tokens.find((t) => t.tokenAddress.toLowerCase() === addr);
        if (!token) continue;
        try {
          priceMap.set(addr, await fetchTokenPrice(provider, token, network));
        } catch (err) {
          console.error(`OrderDashboard: price fetch failed for ${token.symbol}:`, err);
        }
      }

      // Fill prices come from OrderExecuted (the Chainlink price at execution time).
      const fillMap = new Map<string, bigint>();
      const execEvents = await pool.queryFilter(
        pool.filters.OrderExecuted(null, account),
        network.POOL_FROM_BLOCK,
        "latest"
      );
      for (const ev of execEvents) {
        fillMap.set(ev.args.orderId.toString(), ev.args.fillPriceUSD);
      }

      const sortDesc = (a: OrderRow, b: OrderRow) => (a.id > b.id ? -1 : 1);
      setListed(
        orders
          .filter((o) => o.active)
          .map((o) => ({
            ...o,
            livePrice: priceMap.get(o.tokenIn.toLowerCase()) ?? null,
            priceOut: priceMap.get(o.tokenOut.toLowerCase()) ?? null,
          }))
          .sort(sortDesc)
      );
      setSettled(
        orders
          .filter((o) => !o.active)
          .map((o) => ({
            ...o,
            fillPrice: fillMap.get(o.id.toString()) ?? null,
            priceOut: priceMap.get(o.tokenOut.toLowerCase()) ?? null,
          }))
          .sort(sortDesc)
      );
      setError(null);
    } catch (err) {
      console.error("OrderDashboard: refresh failed:", err);
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [account, pool, network, provider, tokens]);

  // Live updates: react to OrderSubmitted/OrderExecuted (fired by run-matcher.ts
  // calling performUpkeep) plus a polling fallback so nothing goes stale. Only
  // chain-confirmed orders can surface — this dashboard reads on-chain state and
  // never optimistically adds an order.
  useEffect(() => {
    if (!account) return;
    refresh();
    const onSubmitted = () => refresh();
    const onExecuted = () => refresh();
    pool.on(pool.filters.OrderSubmitted(null, account), onSubmitted);
    pool.on(pool.filters.OrderExecuted(null, account), onExecuted);
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      pool.off(pool.filters.OrderSubmitted(null, account), onSubmitted);
      pool.off(pool.filters.OrderExecuted(null, account), onExecuted);
      clearInterval(interval);
    };
  }, [account, pool, refresh]);

  if (!account) {
    return (
      <section style={styles.card}>
        <h3 style={styles.cardTitle}>Order Dashboard</h3>
        <p style={styles.muted}>Connect your wallet to view your trades.</p>
      </section>
    );
  }

  return (
    <section style={styles.card}>
      <h3 style={styles.cardTitle}>Order Dashboard</h3>
      {error && <p style={styles.error}>{error}</p>}

      <div style={styles.grid}>
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <span style={styles.panelTitle}>Listed Trades</span>
            <span style={styles.count}>{listed.length}</span>
          </div>
          <OrderTable rows={listed} loading={loading} emptyText="No open orders" info={tokenInfo} />
        </div>

        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <span style={styles.panelTitle}>Settled Trades</span>
            <span style={styles.count}>{settled.length}</span>
          </div>
          <OrderTable rows={settled} loading={loading} emptyText="No settled trades" info={tokenInfo} />
        </div>
      </div>
    </section>
  );
}

function OrderTable({
  rows,
  loading,
  emptyText,
  info,
}: {
  rows: OrderRow[];
  loading: boolean;
  emptyText: string;
  info: TokenInfo;
}) {
  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>ID</th>
          <th style={styles.th}>Trade</th>
          <th style={styles.th} align="right">Price (USD)</th>
          <th style={styles.th} align="right">Status</th>
        </tr>
      </thead>
      <tbody>
        {loading && rows.length === 0 ? (
          <tr>
            <td colSpan={4} style={styles.tdEmpty}>Loading…</td>
          </tr>
        ) : rows.length === 0 ? (
          <tr>
            <td colSpan={4} style={styles.tdEmpty}>{emptyText}</td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={row.id.toString()} style={styles.tr}>
              <td style={styles.tdMuted}>{row.id.toString()}</td>
              <td style={styles.td}>
                <span style={styles.pairText}>{fmtOrder(row, info)}</span>
              </td>
              <td style={styles.td} align="right">
                {row.active ? (
                  <span style={styles.limitPrice}>
                    Live {fmtUsd(row.livePrice)}
                  </span>
                ) : (
                  <span>Fill {fmtUsd(row.fillPrice)}</span>
                )}
              </td>
              <td style={styles.td} align="right">
                <span style={{ ...styles.status, ...(row.active ? styles.statusOpen : styles.statusExecuted) }}>
                  {row.active ? "Open" : "Executed"}
                </span>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

const styles = {
  card: {
    background: "#0f1220",
    border: "1px solid #2a2f45",
    borderRadius: 0,
    padding: "1.25rem 1.5rem",
    width: "100%",
    maxWidth: "100%",
    margin: 0,
    fontFamily: "system-ui, sans-serif",
    color: "#e6e8f0",
  },
  cardTitle: { margin: 0, fontSize: "1.1rem", color: "#ffffff" },
  muted: { color: "#8b90a7", fontSize: "0.85rem", marginTop: 8 },
  error: { color: "#ff6b6b", fontSize: "0.85rem", marginTop: 8 },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 16,
    marginTop: 16,
  },
  panel: {
    background: "#161a2e",
    border: "1px solid #2a2f45",
    borderRadius: 0,
    padding: "0.9rem 1rem",
  },
  panelHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  panelTitle: { color: "#e6e8f0", fontSize: "0.9rem", fontWeight: 600 },
  count: {
    background: "#1f2540",
    color: "#8b90a7",
    borderRadius: 0,
    padding: "1px 8px",
    fontSize: "0.75rem",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" },
  th: {
    textAlign: "left",
    padding: "0.4rem 0.5rem",
    borderBottom: "1px solid #2a2f45",
    color: "#8b90a7",
    fontSize: "0.72rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  tr: { borderBottom: "1px solid #1d2235" },
  td: { padding: "0.55rem 0.5rem", borderBottom: "1px solid #1d2235" },
  tdMuted: { padding: "0.55rem 0.5rem", borderBottom: "1px solid #1d2235", color: "#5c6175" },
  tdEmpty: { padding: "1.25rem 0.5rem", textAlign: "center", color: "#5c6175" },
  pairText: { color: "#e6e8f0", fontSize: "0.82rem" },
  limitPrice: { color: "#8b90a7", fontSize: "0.8rem" },
  status: {
    borderRadius: 0,
    padding: "2px 10px",
    fontSize: "0.72rem",
    fontWeight: 600,
  },
  statusOpen: { background: "#f59e0b", color: "#1a1206" },
  statusExecuted: { background: "#1f2937", color: "#9ca3af" },
};
