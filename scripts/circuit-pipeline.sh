#!/usr/bin/env bash
#
# Reproducible circom → trusted-setup pipeline for the DarkPool spend circuit.
#
# MUST be run inside WSL Ubuntu (native-Windows circom is unreliable: the
# circomlib include path resolution is broken on drive/backslash separators.
# WSL provides a POSIX filesystem where `-l node_modules/circomlib/circuits`
# and `include "poseidon.circom"` resolve cleanly).
#
# Usage (from the repo root, on Windows):
#   wsl -d Ubuntu -- bash scripts/circuit-pipeline.sh
# or via npm: npm run compile:circuits   (wraps the same WSL call)
#
# Artifacts are written to ~/zk-circuits/build inside the Linux filesystem
# (fast I/O) and then copied back to the Windows-side build/circuits/ and
# contracts/.
set -euo pipefail

# ---- toolchain (installed in ~/.local/bin + nvm) ----
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/bin:$PATH"

REPO="${DARKPOOL_REPO:-/mnt/d/Web3/DarkPool}"
WS="$HOME/zk-circuits"
mkdir -p "$WS/build" "$WS/build/ptau"

cd "$WS"
# Fresh circomlib so include resolution is self-contained.
npm init -y >/dev/null 2>&1 || true
npm install circomlib@2.0.5 >/dev/null
npm install circomlibjs@0.1.7 >/dev/null

# Sync the circuit source from the repo (source of truth lives on the Windows
# side of the git repo; we copy in, never edit inside WSL).
cp "$REPO/circuits/darkpool_spend.circom" "$WS/circuits/darkpool_spend.circom"

PTAU="$WS/build/ptau/powersOfTau28_hez_final_12.ptau"
if [ ! -s "$PTAU" ]; then
  echo "### downloading public powers-of-tau (phase-1 ceremony) ###"
  curl -L -o "$PTAU" https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_12.ptau
fi

echo "### 1/6 compiling ###"
circom circuits/darkpool_spend.circom --r1cs --wasm --sym -l node_modules/circomlib/circuits -o build

echo "### 2/6 groth16 setup (phase 2) ###"
snarkjs groth16 setup build/darkpool_spend.r1cs "$PTAU" build/darkpool_spend_0000.zkey

echo "### 3/6 fresh phase-2 contribution ###"
echo "zk-darkpool-phase2-$(cat /proc/sys/kernel/random/uuid)" | \
  snarkjs zkey contribute build/darkpool_spend_0000.zkey build/darkpool_spend_final.zkey --name="ZK-DarkPool phase2"

echo "### 4/6 zkey check + export verification key ###"
snarkjs zkey verify build/darkpool_spend.r1cs "$PTAU" build/darkpool_spend_final.zkey | tail -1
snarkjs zkey export verificationkey build/darkpool_spend_final.zkey build/verification_key.json

echo "### 5/6 export Solidity verifier ###"
snarkjs zkey export solidityverifier build/darkpool_spend_final.zkey build/Verifier.sol

echo "### 6/6 copy artifacts back to the Windows repo ###"
mkdir -p "$REPO/build/circuits/darkpool_spend_js" "$REPO/frontend/public/circuits/darkpool_spend_js"
cp build/darkpool_spend.r1cs                        "$REPO/build/circuits/darkpool_spend.r1cs"
cp build/darkpool_spend.sym                        "$REPO/build/circuits/darkpool_spend.sym"
cp build/darkpool_spend_js/darkpool_spend.wasm     "$REPO/build/circuits/darkpool_spend_js/darkpool_spend.wasm"
cp build/darkpool_spend_js/generate_witness.js      "$REPO/build/circuits/darkpool_spend_js/generate_witness.js"
cp build/darkpool_spend_js/witness_calculator.js    "$REPO/build/circuits/darkpool_spend_js/witness_calculator.js"
cp build/darkpool_spend_final.zkey                  "$REPO/build/circuits/darkpool_spend_final.zkey"
cp build/verification_key.json                      "$REPO/build/circuits/verification_key.json"
cp build/Verifier.sol                               "$REPO/contracts/Verifier.sol"
# frontend copies (served at /circuits/* by Vite)
cp build/darkpool_spend_js/darkpool_spend.wasm     "$REPO/frontend/public/circuits/darkpool_spend_js/darkpool_spend.wasm"
cp build/darkpool_spend_final.zkey                  "$REPO/frontend/public/circuits/darkpool_spend_final.zkey"

echo "### pipeline complete ###"
ls -la "$REPO/build/circuits/"