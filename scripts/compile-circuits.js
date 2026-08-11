const { execFileSync } = require("child_process");
const { mkdirSync, existsSync } = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CIRCUIT = path.join(ROOT, "circuits", "kyc_verifier.circom");
const OUT = path.join(ROOT, "build", "circuits");
const PT_DIR = path.join(ROOT, "build", "ptau");

const R1CS = path.join(OUT, "kyc_verifier.r1cs");
const WASM = path.join(OUT, "kyc_verifier_js", "kyc_verifier.wasm");
const VKEY_JSON = path.join(OUT, "verification_key.json");
const SOLIDITY_VERIFIER = path.join(ROOT, "contracts", "Verifier.sol");

// Powers-of-tau. The Poseidon(2) kyc_verifier only needs 2^8; hardcode the
// standard file so the ptau download is deterministic and reproducible.
const PTAU = path.join(PT_DIR, "powersOfTau28_hez_final_08.ptau");
const ZKEY_INIT = path.join(OUT, "kyc_verifier_0.zkey");
const ZKEY_FINAL = path.join(OUT, "kyc_verifier_final.zkey");

const run = (cmd, args) => {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", cwd: ROOT });
};

const has = (p) => existsSync(p);

mkdirSync(OUT, { recursive: true });
mkdirSync(PT_DIR, { recursive: true });

console.log("=== 1/6 Compiling Circom circuit ===");
run("circom", [CIRCUIT, "--r1cs", "--wasm", "--sym", "-o", OUT]);

console.log("\n=== 2/6 Ensuring Powers of Tau is available ===");
if (!has(PTAU)) {
  console.error("Missing powers of tau file. Download it once:");
  console.error("  curl -o build/ptau/powersOfTau28_hez_final_08.ptau https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_08.ptau");
  process.exit(1);
}

console.log("\n=== 3/6 Groth16 setup ===");
run("npx", ["snarkjs", "groth16", "setup", R1CS, PTAU, ZKEY_INIT]);

console.log("\n=== 4/6 Contributing randomness (ceremony emulation) ===");
run("npx", ["snarkjs", "zkey", "contribute", ZKEY_INIT, ZKEY_FINAL, "--name=ZK-DarkPool", "-e", "zkdarkpool-sepolia-entropy"]);
run("npx", ["snarkjs", "zkey", "verify", R1CS, PTAU, ZKEY_FINAL]);

if (!has(VKEY_JSON)) {
  console.log("\n=== 5/6 Exporting verification key ===");
  run("npx", ["snarkjs", "zkey", "export", "verificationkey", ZKEY_FINAL, VKEY_JSON]);
}

console.log("\n=== 6/6 Exporting Solidity Groth16 verifier ===");
run("npx", ["snarkjs", "zkey", "export", "solidityverifier", ZKEY_FINAL, SOLIDITY_VERIFIER]);

console.log("\n✅ Done.");
console.log(`R1CS:            ${R1CS}`);
console.log(`WASM:            ${WASM}`);
console.log(`VerificationKey: ${VKEY_JSON}`);
console.log(`Solidity:        ${SOLIDITY_VERIFIER}`);