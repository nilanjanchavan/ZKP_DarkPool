/**
 * Real (non-mock) proof generation for tests. Mirrors exactly what
 * TradingTerminal.tsx does in the browser: circomlibjs Poseidon(5) for the
 * public nullifier, then snarkjs.groth16.fullProve against the compiled
 * circuit artifacts, then ABI-encode the proof for SnarkVerifierAdapter.
 */
const path = require("path");
const snarkjs = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");
const { ethers } = require("hardhat");

const ARTIFACTS = path.join(__dirname, "..", "..", "build", "circuits");
const WASM = path.join(ARTIFACTS, "darkpool_spend_js", "darkpool_spend.wasm");
const ZKEY = path.join(ARTIFACTS, "darkpool_spend_final.zkey");

/**
 * @param {object} opts
 * @param {bigint} opts.amountIn   - order amount in wei
 * @param {string} opts.tokenIn    - 0x address of the sold asset
 * @param {string} opts.tokenOut   - 0x address of the requested asset
 * @param {string} opts.sender     - 0x address bound as msg.sender
 * @param {string} [opts.secret]   - optional fixed secret (defaults to random)
 * @returns {Promise<{ proofBytes: string, publicSignals: string[], nullifier: string, secret: string }>}
 */
async function makeProof({ amountIn, tokenIn, tokenOut, sender, secret }) {
  const poseidon = await buildPoseidon();

  const amountField = amountIn.toString();
  const tokenInField = BigInt(tokenIn).toString();
  const tokenOutField = BigInt(tokenOut).toString();
  const senderField = BigInt(sender).toString();
  const secretField = secret ?? BigInt(ethers.hexlify(ethers.randomBytes(32))).toString();

  const nullifier = poseidon.F.toObject(
    poseidon([secretField, amountField, tokenInField, tokenOutField, senderField])
  ).toString();

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    {
      nullifierSecret: secretField,
      nullifier,
      amountIn: amountField,
      tokenIn: tokenInField,
      tokenOut: tokenOutField,
      sender: senderField,
    },
    WASM,
    ZKEY
  );

  // Canonical snarkjs Solidity ordering (mirrors `zkey export soliditycalldata`):
// A and C as (x, y); B as [[b0[1], b0[0]],[b1[1], b1[0]]] (index-swapped —
// the pairing precompile's G2 convention), and slice(0,2) drops the phantom
// trailing "1" this snarkjs version appends to pi_a/pi_c/pi_b.
const proofBytes = ethers.AbiCoder.defaultAbiCoder().encode(
  ["uint256[2]", "uint256[2][2]", "uint256[2]"],
  [
    proof.pi_a.slice(0, 2).map(String),
    [
      [proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]],
    ].map((row) => row.map(String)),
    proof.pi_c.slice(0, 2).map(String),
  ]
);

  return { proofBytes, publicSignals, nullifier: publicSignals[0], secret: secretField };
}

module.exports = { makeProof, WASM, ZKEY };