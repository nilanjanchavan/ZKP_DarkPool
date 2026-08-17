import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline' https:",
  // snarkjs spawns its proving worker from a Blob URL; without worker-src the
  // worker is blocked by script-src's fallback and proof generation hangs.
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss: http: https:",
].join("; ");

export default defineConfig({
  plugins: [
    react(),
    // The ZK stack (snarkjs + circomlibjs) still assumes Node globals:
    //  - Buffer   -> blake-hash/circomlibjs call Buffer.from/alloc/isBuffer at
    //                import time (this was the ReferenceError on startup)
    //  - process  -> snarkjs branches on `process.browser`/`process.stdin`;
    //                circomlibjs CLI helpers use process.argv/exit
    //  - global   -> standard alias used by these libs' shims (plus
    //                setImmediate/clearImmediate, used by their timers)
    nodePolyfills({
      protocolImports: true,
      globals: {
        Buffer: true,
        global: true,
        process: true,
        setImmediate: true,
        clearImmediate: true,
      },
    }),
  ],
  css: {
    devSourcemap: false,
  },
  build: {
    sourcemap: true,
  },
  server: {
    headers: {
      "Content-Security-Policy": DEV_CSP,
      "X-Content-Type-Options": "nosniff",
    },
  },
  preview: {
    headers: {
      "Content-Security-Policy": DEV_CSP,
      "X-Content-Type-Options": "nosniff",
    },
  },
});
