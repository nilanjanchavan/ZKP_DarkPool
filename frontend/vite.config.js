import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline' https:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss: http: https:",
].join("; ");

export default defineConfig({
  plugins: [react()],
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
