/**
 * Builds the DarkPool ZK circuit end-to-end inside WSL Ubuntu.
 *
 * Native-Windows circom is intentionally avoided: circom's circomlib include
 * resolution is unreliable on Windows path separators. This wrapper shells out
 * to the WSL pipeline (scripts/circuit-pipeline.sh) which runs the real
 * Rust-built circom binary, performs the trusted setup against the public
 * powers-of-tau ceremony file, and copies every artifact back into
 * build/circuits/ and contracts/.
 */
const { spawnSync } = require("child_process");
const path = require("path");
const { existsSync, mkdirSync } = require("fs");

const ROOT = path.resolve(__dirname, "..");
const DISTRO = process.env.CIRCOM_WSL_DISTRO || "Ubuntu";

// Circle back: the Windows-side circom.exe is the broken native binary from
// the previous attempt — fail loudly instead of silently picking it up.
const WINDOWS_CIRCOM = path.join(ROOT, "circom.exe");
if (existsSync(WINDOWS_CIRCOM)) {
  console.warn(
    `[!] ${WINDOWS_CIRCOM} is the native-Windows binary from the earlier (broken) ` +
      "approach. It is ignored; the pipeline uses the WSL circom binary instead."
  );
}

const pipePath = path.join(ROOT, "scripts", "circuit-pipeline.sh");
mkdirSync(path.join(ROOT, "build", "circuits"), { recursive: true });

console.log(`\n> wsl -d ${DISTRO} -- bash ${pipePath}\n`);
const result = spawnSync("wsl", ["-d", DISTRO, "--", "bash", pipePath], {
  stdio: "inherit",
  cwd: ROOT,
  encoding: "utf8",
});

if (result.status !== 0) {
  console.error(
    "\n==================================================================\n" +
      "Pipeline failed inside WSL.\n" +
      "  - Is WSL Ubuntu available? (run: wsl --status)\n" +
      "  - Is circom installed?      (run inside WSL: circom --version)\n" +
      "  - Is snarkjs installed?     (run inside WSL: snarkjs --version)\n" +
      "==================================================================\n"
  );
  process.exit(result.status ?? 1);
}

console.log("✅ ZK circuit artifacts are up to date:");
console.log("  - build/circuits/darkpool_spend.r1cs");
console.log("  - build/circuits/darkpool_spend_js/darkpool_spend.wasm");
console.log("  - build/circuits/darkpool_spend_final.zkey");
console.log("  - build/circuits/verification_key.json");
console.log("  - contracts/Verifier.sol");
console.log("  - frontend/public/circuits/ (wasm + zkey served by Vite)");