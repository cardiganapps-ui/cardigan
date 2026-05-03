import { Component } from "react";
import { captureException } from "../lib/sentry";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Buffered until the Sentry SDK loads (deferred to idle in
    // main.jsx). If a crash happens during the first ~100ms before
    // init, the event sits in the in-memory queue and flushes the
    // moment the SDK chunk lands.
    captureException(error, { extra: { componentStack: info?.componentStack } });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div role="alert" style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100dvh",
        padding: 24,
        textAlign: "center",
        gap: 16,
        background: "var(--bg, #fff)",
        color: "var(--text, #222)",
      }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Algo salió mal</h1>
        <p style={{ maxWidth: 360, lineHeight: 1.5, margin: 0 }}>
          Ocurrió un error inesperado. Recarga la página para intentar de nuevo.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: "10px 20px",
            borderRadius: 999,
            border: "none",
            background: "var(--teal, #5B9BAF)",
            color: "#fff",
            fontSize: 16,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Recargar
        </button>
      </div>
    );
  }
}
