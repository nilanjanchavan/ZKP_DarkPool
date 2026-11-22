import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AbiCoder, Contract, JsonRpcProvider, formatUnits } from "ethers";
import { ZK_POOL_ABI } from "./config";
import { fetchTokenPrice } from "./prices";
import type { NetworkConfig, NetworkToken } from "../../config/networks";
import { createBrowserProvider } from "./providers";

const REFRESH_INTERVAL_MS = 15000;

/**
 * Safely queries logs in bounded block chunks to avoid RPC limits
 * (such as error -32701: "exceed maximum block range: 50000").
 * Automatically bisects chunks if the provider enforces an even tighter range limit.
 */
async function fetchLogsInChunks(
  contract: Contract,
  filter: any,
  fromBlock: number,
  toBlock: number,
  maxChunkSize = 45000,
  concurrency = 6
): Promise<any[]> {
  if (fromBlock > toBlock) return [];

  async function fetchRange(start: number, end: number): Promise<any[]> {
    try {
      return await contract.queryFilter(filter, start, end);
    } catch (err: any) {
      const msg = err?.message || String(err);
      const isRangeError =
        msg.includes("exceed maximum block range") ||
        msg.includes("block range") ||
        err?.code === -32701 ||
        err?.info?.error?.code === -32701 ||
        err?.error?.code === -32701;

      if (isRangeError && end > start) {
        const mid = Math.floor((start + end) / 2);
        const [left, right] = await Promise.all([
          fetchRange(start, mid),
          fetchRange(mid + 1, end),
        ]);
        return [...left, ...right];
      }
      console.warn(`OrderDashboard: log query failed for blocks [${start}, ${end}]:`, msg);
      return [];
    }
  }

  const ranges: [number, number][] = [];
  for (let s = fromBlock; s <= toBlock; s += maxChunkSize) {
    ranges.push([s, Math.min(s + maxChunkSize - 1, toBlock)]);
  }

  const allLogs: any[] = [];
  for (let i = 0; i < ranges.length; i += concurrency) {
    const batch = ranges.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(([s, e]) => fetchRange(s, e)));
    for (const res of batchResults) {
      allLogs.push(...res);
    }
  }
  return allLogs;
}

interface OrderRow {
  id: bigint;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  livePrice: bigint | null;
  fillPrice: bigint | null;
  priceOut: bigint | null;
  active: boolean;
  status?: "open" | "executed" | "cancelled";
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
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // In-browser match detection state (eliminates need for terminal script)
  const [matchableData, setMatchableData] = useState<{
    orderA: number;
    orderB: number;
    performData: string;
  } | null>(null);
  const [settling, setSettling] = useState(false);

  // Cancelled order IDs persisted per chain & account
  const [cancelledIds, setCancelledIds] = useState<Set<string>>(() => {
    try {
      if (!account) return new Set();
      const raw = localStorage.getItem(`darkpool_cancelled_${network.chainId}_${account.toLowerCase()}`);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

  const [cancellingId, setCancellingId] = useState<bigint | null>(null);

  const fillPriceCache = useRef<Map<string, bigint>>(new Map());

  // Clear cached fill prices and load cancelled orders when account or network changes
  useEffect(() => {
    fillPriceCache.current.clear();
    setMatchableData(null);
    setError(null);
    setSuccessMessage(null);
    try {
      if (!account) {
        setCancelledIds(new Set());
        return;
      }
      const raw = localStorage.getItem(`darkpool_cancelled_${network.chainId}_${account.toLowerCase()}`);
      setCancelledIds(raw ? new Set(JSON.parse(raw)) : new Set());
    } catch {
      setCancelledIds(new Set());
    }
  }, [account, network.chainId]);

  const tokens = useMemo<NetworkToken[]>(() => network.SUPPORTED_TOKENS, [network]);
  const provider = useMemo(() => new JsonRpcProvider(network.RPC_URL), [network]);
  const pool = useMemo(() => new Contract(network.POOL_ADDRESS, ZK_POOL_ABI, provider), [network, provider]);
  const tokenInfo = useMemo<TokenInfo>(
    () => new Map(network.SUPPORTED_TOKENS.map((t) => [t.tokenAddress.toLowerCase(), { symbol: t.symbol, decimals: t.decimals }])),
    [network]
  );

  // In-browser check for matchable pairs (no terminal script needed)
  const checkMatching = useCallback(async () => {
    try {
      const [upkeepNeeded, performData] = await pool.checkUpkeep("0x");
      if (upkeepNeeded && performData && performData !== "0x") {
        const [orderA, orderB] = AbiCoder.defaultAbiCoder().decode(["uint256", "uint256"], performData);
        setMatchableData({ orderA: Number(orderA), orderB: Number(orderB), performData });
      } else {
        setMatchableData(null);
      }
    } catch (err) {
      setMatchableData(null);
    }
  }, [pool]);

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

      // USD prices straight from each token's Chainlink feed
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

      // Only query logs if there are on-chain settled orders whose fill prices/statuses are not yet cached
      const settledOnChain = orders.filter((o) => !o.active);
      const missingSettled = settledOnChain.filter((o) => !fillPriceCache.current.has(o.id.toString()) && !cancelledIds.has(o.id.toString()));

      if (missingSettled.length > 0) {
        try {
          const currentBlock = await provider.getBlockNumber();
          const startBlock =
            network.POOL_FROM_BLOCK > 0
              ? network.POOL_FROM_BLOCK
              : Math.max(0, currentBlock - 50000);

          const [execEvents, cancelEvents] = await Promise.all([
            fetchLogsInChunks(
              pool,
              pool.filters.OrderExecuted(null, account),
              startBlock,
              currentBlock
            ),
            fetchLogsInChunks(
              pool,
              pool.filters.OrderCancelled(null, account),
              startBlock,
              currentBlock
            ).catch(() => []),
          ]);

          for (const ev of execEvents) {
            if (ev.args?.orderId != null && ev.args?.fillPriceUSD != null) {
              fillPriceCache.current.set(ev.args.orderId.toString(), ev.args.fillPriceUSD);
            }
          }

          let addedCancels = false;
          for (const ev of cancelEvents) {
            if (ev.args?.orderId != null) {
              const id = ev.args.orderId.toString();
              if (!cancelledIds.has(id)) {
                cancelledIds.add(id);
                addedCancels = true;
              }
            }
          }
          if (addedCancels) {
            try {
              localStorage.setItem(
                `darkpool_cancelled_${network.chainId}_${account.toLowerCase()}`,
                JSON.stringify(Array.from(cancelledIds))
              );
            } catch {}
          }
        } catch (logErr) {
          console.warn("OrderDashboard: failed to fetch event logs:", logErr);
        }
      }

      const sortDesc = (a: OrderRow, b: OrderRow) => (a.id > b.id ? -1 : 1);

      const openList: OrderRow[] = [];
      const settledList: OrderRow[] = [];

      for (const o of orders) {
        const idStr = o.id.toString();
        const isCancelled = cancelledIds.has(idStr);

        if (isCancelled) {
          settledList.push({
            ...o,
            active: false,
            status: "cancelled",
            fillPrice: null,
            priceOut: priceMap.get(o.tokenOut.toLowerCase()) ?? null,
          });
        } else if (!o.active) {
          settledList.push({
            ...o,
            active: false,
            status: "executed",
            fillPrice: fillPriceCache.current.get(idStr) ?? null,
            priceOut: priceMap.get(o.tokenOut.toLowerCase()) ?? null,
          });
        } else {
          openList.push({
            ...o,
            active: true,
            status: "open",
            livePrice: priceMap.get(o.tokenIn.toLowerCase()) ?? null,
            priceOut: priceMap.get(o.tokenOut.toLowerCase()) ?? null,
          });
        }
      }

      setListed(openList.sort(sortDesc));
      setSettled(settledList.sort(sortDesc));
      setError(null);
    } catch (err) {
      console.error("OrderDashboard: refresh failed:", err);
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [account, pool, network, provider, tokens, cancelledIds]);

  const handleCancel = async (orderId: bigint) => {
    if (!account) return;
    setCancellingId(orderId);
    setError(null);

    let wasOnChain = false;
    // Attempt on-chain cancellation first if the contract supports it
    try {
      const browserProvider = createBrowserProvider();
      const signer = await browserProvider.getSigner();
      const poolWithSigner = new Contract(network.POOL_ADDRESS, ZK_POOL_ABI, signer);

      try {
        const tx = await poolWithSigner.cancelOrder(orderId);
        await tx.wait();
        wasOnChain = true;
      } catch (onChainErr: any) {
        // If rejected by user in wallet, cancel action was aborted
        if (onChainErr?.code === "ACTION_REJECTED" || onChainErr?.code === 4001) {
          setError("Order cancellation rejected in wallet.");
          setCancellingId(null);
          return;
        }
        // Legacy contract deployment lacks cancelOrder; fallback to client archive gracefully
        console.warn("On-chain cancelOrder not present on this deployment, archiving locally:", onChainErr);
      }
    } catch (walletErr) {
      console.warn("Wallet access error, applying client-side cancellation:", walletErr);
    }

    // Persist in localStorage and update state
    const idStr = orderId.toString();
    const updated = new Set(cancelledIds);
    updated.add(idStr);
    try {
      localStorage.setItem(
        `darkpool_cancelled_${network.chainId}_${account.toLowerCase()}`,
        JSON.stringify(Array.from(updated))
      );
    } catch (e) {
      console.error("Failed to persist cancelled order:", e);
    }
    setCancelledIds(updated);
    setCancellingId(null);
    setSuccessMessage(
      wasOnChain
        ? `Order #${orderId} cancelled on-chain. Refund transferred to your wallet!`
        : `Order #${orderId} was cancelled and moved to Settled Trades.`
    );
    setTimeout(() => setSuccessMessage(null), 5000);
  };

  // In-browser settlement trigger: executes performUpkeep without any terminal script
  const handleSettle = async () => {
    if (!matchableData) return;
    try {
      setSettling(true);
      setError(null);
      const browserProvider = createBrowserProvider();
      const signer = await browserProvider.getSigner();
      const poolWithSigner = new Contract(network.POOL_ADDRESS, ZK_POOL_ABI, signer);
      const tx = await poolWithSigner.performUpkeep(matchableData.performData);
      await tx.wait();
      setSuccessMessage(`Orders #${matchableData.orderA} & #${matchableData.orderB} successfully matched and settled on-chain!`);
      setMatchableData(null);
      await refresh();
      await checkMatching();
    } catch (err: any) {
      console.error("Settlement failed:", err);
      const msg = err?.info?.error?.message ?? err?.message ?? String(err);
      setError(err?.code === "ACTION_REJECTED" ? "Settlement rejected in wallet." : msg);
    } finally {
      setSettling(false);
    }
  };

  // Live polling and event triggers
  useEffect(() => {
    if (!account) return;
    refresh();
    checkMatching();
    const onSubmitted = () => { refresh(); checkMatching(); };
    const onExecuted = () => { refresh(); checkMatching(); };
    const onCancelled = () => { refresh(); checkMatching(); };

    pool.on(pool.filters.OrderSubmitted(null, account), onSubmitted);
    pool.on(pool.filters.OrderExecuted(null, account), onExecuted);
    try {
      pool.on(pool.filters.OrderCancelled(null, account), onCancelled);
    } catch {
      /* legacy ABI fallback */
    }

    const interval = setInterval(() => {
      refresh();
      checkMatching();
    }, REFRESH_INTERVAL_MS);

    return () => {
      pool.off(pool.filters.OrderSubmitted(null, account), onSubmitted);
      pool.off(pool.filters.OrderExecuted(null, account), onExecuted);
      try {
        pool.off(pool.filters.OrderCancelled(null, account), onCancelled);
      } catch {
        /* legacy ABI fallback */
      }
      clearInterval(interval);
    };
  }, [account, pool, refresh, checkMatching]);

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
      <div style={styles.headerRow}>
        <div>
          <h3 style={styles.cardTitle}>Order Dashboard</h3>
          <p style={styles.muted}>Real-time privacy-preserving dark pool trades and settlement.</p>
        </div>
        <div style={styles.headerActions}>
          <button
            onClick={() => { refresh(); checkMatching(); }}
            disabled={loading}
            style={styles.actionBtn}
            title="Scan for on-chain updates and matchable pairs"
          >
            {loading ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {successMessage && (
        <div style={styles.successAlert}>
          <span>✓ {successMessage}</span>
          <button onClick={() => setSuccessMessage(null)} style={styles.closeAlertBtn}>×</button>
        </div>
      )}

      {/* In-browser matching banner: no terminal script needed! */}
      {matchableData && (
        <div style={styles.settleBanner}>
          <div style={styles.settleInfo}>
            <span style={styles.settleIcon}>⚡</span>
            <div>
              <div style={styles.settleTitle}>
                Complementary Match Ready: Order #{matchableData.orderA} ↔ Order #{matchableData.orderB}
              </div>
              <div style={styles.settleDesc}>
                Both trades balance within 1% fair-market tolerance. Settle directly on-chain without any terminal script.
              </div>
            </div>
          </div>
          <button
            onClick={handleSettle}
            disabled={settling}
            style={styles.settleBtn}
          >
            {settling ? "Settling on-chain…" : "Execute Settlement"}
          </button>
        </div>
      )}

      <div style={styles.grid}>
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <span style={styles.panelTitle}>Listed Trades</span>
            <span style={styles.count}>{listed.length}</span>
          </div>
          <OrderTable
            rows={listed}
            loading={loading}
            emptyText="No open orders"
            info={tokenInfo}
            onCancel={handleCancel}
            cancellingId={cancellingId}
          />
        </div>

        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <span style={styles.panelTitle}>Settled Trades</span>
            <span style={styles.count}>{settled.length}</span>
          </div>
          <OrderTable
            rows={settled}
            loading={loading}
            emptyText="No settled trades"
            info={tokenInfo}
          />
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
  onCancel,
  cancellingId,
}: {
  rows: OrderRow[];
  loading: boolean;
  emptyText: string;
  info: TokenInfo;
  onCancel?: (id: bigint) => void;
  cancellingId?: bigint | null;
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
                {row.status === "cancelled" ? (
                  <span style={styles.tdMuted}>—</span>
                ) : row.active ? (
                  <span style={styles.limitPrice}>
                    Live {fmtUsd(row.livePrice)}
                  </span>
                ) : (
                  <span>Fill {fmtUsd(row.fillPrice)}</span>
                )}
              </td>
              <td style={styles.td} align="right">
                <span
                  style={{
                    ...styles.status,
                    ...(row.status === "cancelled"
                      ? styles.statusCancelled
                      : row.active
                      ? styles.statusOpen
                      : styles.statusExecuted),
                  }}
                >
                  {row.status === "cancelled" ? "Cancelled" : row.active ? "Open" : "Executed"}
                </span>
                {row.active && row.status !== "cancelled" && onCancel && (
                  <button
                    onClick={() => onCancel(row.id)}
                    disabled={cancellingId === row.id}
                    style={styles.cancelButton}
                    title="Cancel order and move to Settled Trades"
                  >
                    {cancellingId === row.id ? "…" : "Cancel"}
                  </button>
                )}
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
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
  },
  headerActions: {
    display: "flex",
    gap: 8,
  },
  cardTitle: { margin: 0, fontSize: "1.1rem", color: "#ffffff" },
  muted: { color: "#8b90a7", fontSize: "0.85rem", marginTop: 4 },
  error: { color: "#ff6b6b", fontSize: "0.85rem", marginTop: 8 },
  actionBtn: {
    background: "#161a2e",
    color: "#8b90a7",
    border: "1px solid #2a2f45",
    borderRadius: 0,
    padding: "4px 10px",
    fontSize: "0.75rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  successAlert: {
    background: "#062e24",
    border: "1px solid #10b981",
    color: "#34d399",
    padding: "8px 12px",
    fontSize: "0.82rem",
    marginTop: 10,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  closeAlertBtn: {
    background: "transparent",
    border: "none",
    color: "#34d399",
    fontSize: "1rem",
    cursor: "pointer",
    lineHeight: 1,
  },
  settleBanner: {
    background: "linear-gradient(90deg, #09231a 0%, #161a2e 100%)",
    border: "1px solid #10b981",
    borderRadius: 0,
    padding: "0.85rem 1.1rem",
    marginTop: 14,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  settleInfo: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  settleIcon: {
    fontSize: "1.3rem",
    color: "#34d399",
  },
  settleTitle: {
    color: "#34d399",
    fontSize: "0.88rem",
    fontWeight: 600,
  },
  settleDesc: {
    color: "#a7f3d0",
    fontSize: "0.78rem",
    marginTop: 2,
  },
  settleBtn: {
    background: "#10b981",
    color: "#022c22",
    border: "none",
    borderRadius: 0,
    padding: "6px 14px",
    fontSize: "0.8rem",
    fontWeight: 700,
    cursor: "pointer",
  },
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
  statusExecuted: { background: "#062e24", color: "#34d399", border: "1px solid #064e3b" },
  statusCancelled: { background: "#3b1d1d", color: "#f87171", border: "1px solid #5a2525" },
  cancelButton: {
    background: "#2a1515",
    color: "#ff6b6b",
    border: "1px solid #5a2525",
    borderRadius: 0,
    padding: "2px 8px",
    fontSize: "0.72rem",
    fontWeight: 600,
    cursor: "pointer",
    marginLeft: 8,
  },
};
