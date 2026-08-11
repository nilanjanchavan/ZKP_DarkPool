// Web3 browser polyfills — must be set before any library (ethers, etc.) that
// sniffs for Node globals evaluates. Static imports are hoisted above this
// code, so App is loaded lazily below (dynamic import) to guarantee these run
// first.
if (typeof window !== "undefined") {
  window.global = window.global ?? window;
  window.process = window.process ?? { env: {} };
}

import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

const rootElement = document.getElementById("root");

function renderFatal(err) {
  if (!rootElement) return;
  const detail = (err?.stack || err?.message || String(err)).replace(/</g, "&lt;");
  rootElement.innerHTML = `<div style="color:red; padding:20px; font-family:monospace; background:#111; height:100vh;">
    <h2>Fatal Startup Error</h2>
    <pre style="white-space:pre-wrap;">${detail}</pre>
  </div>`;
  console.error("Fatal mount error:", err);
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("App startup crashed:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={styles.page}>
          <h1 style={styles.title}>Something went wrong</h1>
          <p style={styles.message}>
            The application failed to start. Check the browser console for
            details, or reload the page.
          </p>
          <pre style={styles.detail}>
            {String(this.state.error?.message ?? this.state.error)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#0a0c16",
    color: "#e6e8f0",
    fontFamily: "system-ui, sans-serif",
    padding: "2rem",
  },
  title: { color: "#ff6b6b" },
  message: { color: "#8b90a7" },
  detail: {
    background: "#161a2e",
    border: "1px solid #2a2f45",
    borderRadius: 6,
    padding: "0.75rem",
    overflow: "auto",
    color: "#ffb4a2",
  },
};

async function bootstrap() {
  if (!rootElement) {
    console.error('Fatal mount error: <div id="root"> not found in index.html');
    return;
  }

  let App;
  try {
    App = (await import("./App")).default;
  } catch (err) {
    renderFatal(err);
    return;
  }

  try {
    const root = createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>
    );
  } catch (err) {
    renderFatal(err);
  }
}

bootstrap();
