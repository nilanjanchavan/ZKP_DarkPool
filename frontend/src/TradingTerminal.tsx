import { useCallback, useEffect, useMemo, useState } from "react";
import { Contract, JsonRpcProvider, formatUnits, keccak256, MaxUint256, parseUnits, solidityPacked } from "ethers";
import { ERC20_ABI, ZK_POOL_ABI, ZERO_ADDRESS, isNativeToken } from "./config";
import { fetchTokenPrice, oracleFor } from "./prices";
import type { NetworkConfig, NetworkToken } from "../../config/networks";
import { createBrowserProvider } from "./providers";

type Status = "idle" | "awaitingWallet" | "pending" | "success" | "error";

interface TradingTerminalProps {
  account: string | null;
  network: NetworkConfig;
}

type Token = NetworkToken;

const STATUS_LABEL: Record<Status, string> = {
  idle: "Submit Dark Pool Order",
  awaitingWallet: "Awaiting Wallet Confirmation…",
  pending: "Transaction Pending…",
  success: "Order Submitted!",
  error: "Submit Dark Pool Order",
};

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

// Format an 18-decimal scaled value as a clean up-to-6-decimal string. Guards
// against exponent output and rounds-to-zero so tiny rates stay visible.
function formatRate(value18: bigint): string {
  const num = Number(value18) / 1e18;
  if (!Number.isFinite(num) || num <= 0) return "0";
  const fixed = num.toFixed(6).replace(/\.?0+$/, "");
  return fixed === "0" ? num.toPrecision(3) : fixed;
}

export default function TradingTerminal({ account, network }: TradingTerminalProps) {
  const tokens = useMemo<Token[]>(() => network.SUPPORTED_TOKENS, [network]);

  const [tokenIn, setTokenIn] = useState<Token | null>(null);
  const [tokenOut, setTokenOut] = useState<Token | null>(null);
  const [amountIn, setAmountIn] = useState("");
  const [priceIn, setPriceIn] = useState<bigint | null>(null);
  const [priceOut, setPriceOut] = useState<bigint | null>(null);
  const [rateError, setRateError] = useState(false);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-pick sensible defaults whenever the active network changes.
  useEffect(() => {
    const native = tokens.find((t) => isNativeToken(t));
    const alt = tokens.find((t) => !isNativeToken(t));
    setTokenIn(native ?? tokens[0] ?? null);
    setTokenOut(alt ?? tokens[1] ?? tokens[0] ?? null);
    setAmountIn("");
    setPriceIn(null);
    setPriceOut(null);
    setRateError(false);
    setAllowance(null);
    setStatus("idle");
    setError(null);
    setTxHash(null);
  }, [tokens]);

  const readOnlyProvider = useMemo(() => new JsonRpcProvider(network.RPC_URL), [network]);

  // Live Chainlink prices for both selected tokens, read directly from each
  // token's data feed (independent of the on-chain pool).
  const loadPrices = useCallback(async () => {
    if (!tokenIn || !tokenOut) return;
    setRateError(false);
    try {
      const [pIn, pOut] = await Promise.all([
        fetchTokenPrice(readOnlyProvider, tokenIn, network),
        fetchTokenPrice(readOnlyProvider, tokenOut, network),
      ]);
      setPriceIn(pIn);
      setPriceOut(pOut);
    } catch (err) {
      console.error(
        `Failed to fetch price for ${tokenIn.symbol} at address ${oracleFor(tokenIn, network) ?? "unknown"}:`,
        err
      );
      setPriceIn(null);
      setPriceOut(null);
      setRateError(true);
    }
  }, [readOnlyProvider, network, tokenIn, tokenOut]);

  const loadAllowance = useCallback(async () => {
    if (!tokenIn || isNativeToken(tokenIn) || !account) {
      setAllowance(null);
      return;
    }
    try {
      const provider = createBrowserProvider();
      const token = new Contract(tokenIn.tokenAddress, ERC20_ABI, provider);
      setAllowance(await token.allowance(account, network.POOL_ADDRESS));
    } catch (err) {
      console.error("TradingTerminal: allowance read failed:", err);
      setAllowance(null);
    }
  }, [account, network.POOL_ADDRESS, tokenIn]);

  useEffect(() => {
    loadPrices();
    loadAllowance();
    const interval = setInterval(loadPrices, 15000);
    return () => clearInterval(interval);
  }, [loadPrices, loadAllowance]);

  const sameToken = tokenIn !== null && tokenOut !== null && tokenIn.tokenAddress === tokenOut.tokenAddress;
  const amountParsed = useMemo(() => {
    if (!tokenIn || !amountIn) return null;
    try {
      return parseUnits(amountIn, tokenIn.decimals);
    } catch {
      return null;
    }
  }, [amountIn, tokenIn]);

  // Live token-to-token conversion rate = priceIn / priceOut (18-decimal).
  const rateInToOut = useMemo<bigint | null>(() => {
    if (priceIn === null || priceOut === null || priceIn <= 0n || priceOut <= 0n) return null;
    return (priceIn * 10n ** 18n) / priceOut;
  }, [priceIn, priceOut]);

  // Auto-computed receive amount = amountIn * priceIn / priceOut.
  const receiveAmount = useMemo<string>(() => {
    if (!tokenIn || !tokenOut || !amountParsed || amountParsed <= 0n || priceIn === null || priceOut === null || priceOut <= 0n || sameToken) return "";
    const outUnits = (amountParsed * priceIn) / priceOut;
    const num = Number(formatUnits(outUnits, tokenOut.decimals));
    if (!Number.isFinite(num)) return "";
    return num.toFixed(6).replace(/\.?0+$/, "");
  }, [amountParsed, priceIn, priceOut, sameToken, tokenIn, tokenOut]);

  if (!tokenIn || !tokenOut) {
    return (
      <div style={styles.card}>
        <h3 style={styles.title}>Dark Pool Order</h3>
        <p style={styles.subtitle}>No tradable tokens configured for {network.name}.</p>
      </div>
    );
  }

  const needsApproval = !isNativeToken(tokenIn) && amountParsed !== null && (allowance ?? 0n) < amountParsed;

  const reset = () => {
    setStatus("idle");
    setError(null);
    setTxHash(null);
  };

  const handleApprove = async () => {
    if (!account || !tokenIn || isNativeToken(tokenIn)) return;
    setError(null);
    setStatus("awaitingWallet");
    try {
      const provider = createBrowserProvider();
      const signer = await provider.getSigner();
      const token = new Contract(tokenIn.tokenAddress, ERC20_ABI, signer);
      const tx = await token.approve(network.POOL_ADDRESS, MaxUint256);
      setTxHash(tx.hash);
      setStatus("pending");
      const receipt = await tx.wait();
      if (receipt.status !== 1) {
        throw new Error("Approval reverted on-chain.");
      }
      await loadAllowance();
      setTxHash(null);
      setStatus("idle");
    } catch (err) {
      const message = err?.info?.error?.message ?? err?.message ?? String(err);
      const isRejection = err?.code === "ACTION_REJECTED" || err?.code === 4001;
      setStatus("error");
      setError(isRejection ? "Approval rejected in wallet." : message);
    }
  };

  const handleSubmit = async () => {
    if (!account) return;
    setError(null);
    setTxHash(null);

    if (sameToken) {
      setStatus("error");
      setError("Token to sell and token to receive must be different.");
      return;
    }
    if (amountParsed === null || amountParsed <= 0n) {
      setStatus("error");
      setError("Amount must be greater than 0.");
      return;
    }
    if (needsApproval) {
      setStatus("error");
      setError(`Approve ${tokenIn.symbol} first before submitting.`);
      return;
    }

    // Unique per submission so the on-chain nullifier registry never rejects it.
    const nullifier = keccak256(solidityPacked(["address", "uint256"], [account, Date.now()]));

    try {
      setStatus("awaitingWallet");
      const provider = createBrowserProvider();
      const signer = await provider.getSigner();
      const pool = new Contract(network.POOL_ADDRESS, ZK_POOL_ABI, signer);

      // Demo mode: the pool runs the MockZKVerifier, which accepts any proof
      // as long as it carries 4 public inputs, so a zero-length proof passes
      // on-chain. Swap in a real Groth16 proof here once a real Verifier
      // (SnarkVerifierAdapter) is wired back to the pool.
      const proof = "0x";

      const tx = await pool.submitOrder(
        proof,
        nullifier,
        tokenIn.tokenAddress,
        tokenOut.tokenAddress,
        amountParsed,
        // Native ETH orders fund the pool with msg.value; ERC-20 orders must
        // send zero value or the EVM instantly reverts.
        { value: tokenIn.tokenAddress === ZERO_ADDRESS ? amountParsed : 0n }
      );
      setTxHash(tx.hash);
      setStatus("pending");

      const receipt = await tx.wait();
      if (receipt.status !== 1) {
        throw new Error("Order submission reverted on-chain.");
      }
      setStatus("success");
      setAmountIn("");
    } catch (err) {
      const message = err?.info?.error?.message ?? err?.message ?? String(err);
      const isRejection = err?.code === "ACTION_REJECTED" || err?.code === 4001;
      setStatus("error");
      setError(isRejection ? "Transaction rejected in wallet." : message);
    }
  };

  const busy = status === "awaitingWallet" || status === "pending";
  const submitDisabled = !account || busy || sameToken || needsApproval || amountParsed === null || amountParsed <= 0n;

  return (
    <div style={styles.card}>
      <h3 style={styles.title}>Dark Pool Order</h3>
      <p style={styles.subtitle}>
        {account
          ? `List a sell of one supported asset for another · pool ${network.POOL_ADDRESS}`
          : "Connect your wallet to trade."}
      </p>

      <label style={styles.label}>
        <span style={styles.sellLabel}>Token to Sell</span>
        <select
          style={styles.select}
          value={tokenIn.tokenAddress}
          onChange={(e) => {
            const next = tokens.find((t) => t.tokenAddress === e.target.value) ?? null;
            setTokenIn(next);
            reset();
          }}
        >
          {tokens.map((t) => (
            <option key={t.tokenAddress} value={t.tokenAddress}>
              {t.symbol}
            </option>
          ))}
        </select>
      </label>

      <div style={styles.rateBox}>
        <span style={styles.rateLabel}>Live Conversion Rate</span>
        <span style={styles.rateValue}>
          {rateError
            ? "Error fetching prices"
            : rateInToOut !== null
              ? `1 ${tokenIn.symbol} = ${formatRate(rateInToOut)} ${tokenOut.symbol}`
              : "Loading prices…"}
        </span>
      </div>

      <label style={styles.label}>
        <span style={styles.buyLabel}>Token to Receive</span>
        <select
          style={styles.select}
          value={tokenOut.tokenAddress}
          onChange={(e) => {
            const next = tokens.find((t) => t.tokenAddress === e.target.value) ?? null;
            setTokenOut(next);
            reset();
          }}
        >
          {tokens.map((t) => (
            <option key={t.tokenAddress} value={t.tokenAddress}>
              {t.symbol}
            </option>
          ))}
        </select>
      </label>

      {sameToken && <p style={styles.error}>Token to sell and token to receive must be different.</p>}

      <label style={styles.label}>Amount to Sell ({tokenIn.symbol})</label>
      <input
        style={styles.input}
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        placeholder="e.g. 1.5"
        value={amountIn}
        onChange={(e) => {
          setAmountIn(e.target.value);
          reset();
        }}
      />

      {priceIn !== null && priceOut !== null && (
        <div style={styles.priceRow}>
          <span style={styles.muted}>
            1 {tokenIn.symbol} = {usdFormatter.format(Number(formatUnits(priceIn, 18)))}
          </span>
          <span style={styles.muted}>
            1 {tokenOut.symbol} = {usdFormatter.format(Number(formatUnits(priceOut, 18)))}
          </span>
        </div>
      )}

      <label style={styles.label}>Amount to Receive ({tokenOut.symbol})</label>
      <input
        style={{ ...styles.input, ...styles.inputReadOnly }}
        type="text"
        readOnly
        placeholder="—"
        value={receiveAmount}
      />

      {!isNativeToken(tokenIn) && (
        <button
          style={{ ...styles.approve, ...(needsApproval ? styles.approveActive : {}) }}
          onClick={handleApprove}
          disabled={!account || busy}
        >
          {allowance !== null && allowance > 0n ? `Approved ✓ (${tokenIn.symbol})` : `Approve ${tokenIn.symbol}`}
        </button>
      )}

      <button style={styles.submit} onClick={handleSubmit} disabled={submitDisabled}>
        {STATUS_LABEL[status]}
      </button>

      {status === "pending" && txHash && (
        <p style={styles.pending}>
          Broadcasting…{" "}
          <a href={`${network.EXPLORER_URL}/tx/${txHash}`} target="_blank" rel="noreferrer" style={styles.link}>
            view
          </a>
        </p>
      )}

      {status === "success" && txHash && (
        <p style={styles.success}>
          Order submitted: selling {tokenIn.symbol} for {tokenOut.symbol}.{" "}
          <a href={`${network.EXPLORER_URL}/tx/${txHash}`} target="_blank" rel="noreferrer" style={styles.link}>
            View on Explorer
          </a>
        </p>
      )}

      {status === "error" && error && <p style={styles.error}>{error}</p>}

      {!account && <p style={styles.error}>Connect a wallet to submit orders.</p>}
    </div>
  );
}

const styles = {
  card: {
    background: "#0f1220",
    border: "1px solid #2a2f45",
    borderRadius: 8,
    padding: "1.25rem",
    width: "100%",
    maxWidth: "100%",
    margin: 0,
    fontFamily: "system-ui, sans-serif",
    color: "#e6e8f0",
  },
  title: { margin: 0, fontSize: "1.1rem", color: "#ffffff" },
  subtitle: { color: "#8b90a7", fontSize: "0.8rem", margin: "0.35rem 0 1rem" },
  label: { display: "block", color: "#8b90a7", fontSize: "0.78rem", margin: "0.75rem 0 0.3rem" },
  sellLabel: { color: "#ff8f8f", fontWeight: 700 },
  buyLabel: { color: "#7dd3a8", fontWeight: 700 },
  select: {
    width: "100%",
    boxSizing: "border-box",
    marginTop: "0.3rem",
    padding: "0.6rem 0.75rem",
    borderRadius: 6,
    border: "1px solid #2a2f45",
    background: "#161a2e",
    color: "#e6e8f0",
    fontSize: "0.95rem",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "0.6rem 0.75rem",
    borderRadius: 6,
    border: "1px solid #2a2f45",
    background: "#161a2e",
    color: "#e6e8f0",
    fontSize: "0.95rem",
  },
  priceRow: { display: "flex", justifyContent: "space-between", gap: 8, marginTop: 8, flexWrap: "wrap" },
  rateBox: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    margin: "0.9rem 0 0.4rem",
    padding: "0.65rem 0.85rem",
    background: "#161a2e",
    border: "1px solid #2a2f45",
    borderLeft: "3px solid #4f7cff",
    borderRadius: 0,
  },
  rateLabel: { color: "#8b90a7", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em" },
  rateValue: {
    color: "#ffffff",
    fontSize: "1.05rem",
    fontWeight: 700,
    fontFamily: "ui-monospace, SFMono-Regular, monospace",
  },
  inputReadOnly: { color: "#7dd3a8", cursor: "default" },
  muted: { color: "#8b90a7", fontSize: "0.8rem" },
  approve: {
    width: "100%",
    marginTop: 12,
    padding: "0.6rem 0",
    borderRadius: 6,
    border: "1px solid #2a2f45",
    background: "#161a2e",
    color: "#8b90a7",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  approveActive: {
    background: "#143a2a",
    borderColor: "#2e7d5b",
    color: "#7dd3a8",
  },
  submit: {
    width: "100%",
    marginTop: 12,
    padding: "0.7rem 0",
    borderRadius: 6,
    border: "none",
    background: "#4f7cff",
    color: "#ffffff",
    fontSize: "0.95rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  link: { color: "#7db0ff", textDecoration: "none" },
  pending: { color: "#f5c66f", fontSize: "0.85rem", marginTop: 10 },
  success: { color: "#7dd3a8", fontSize: "0.85rem", marginTop: 10 },
  error: { color: "#ff6b6b", fontSize: "0.85rem", marginTop: 10 },
};
