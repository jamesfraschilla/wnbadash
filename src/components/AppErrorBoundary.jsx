import React from "react";
import { recordClientError } from "../errorDiagnostics.js";

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
    this.handleWindowError = this.handleWindowError.bind(this);
    this.handleUnhandledRejection = this.handleUnhandledRejection.bind(this);
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidMount() {
    window.addEventListener("error", this.handleWindowError);
    window.addEventListener("unhandledrejection", this.handleUnhandledRejection);
  }

  componentWillUnmount() {
    window.removeEventListener("error", this.handleWindowError);
    window.removeEventListener("unhandledrejection", this.handleUnhandledRejection);
  }

  componentDidCatch(error) {
    recordClientError({
      source: "error-boundary",
      message: error?.stack || error?.message || "Unknown render error",
      route: window.location.hash || window.location.pathname || "",
      userAgent: window.navigator?.userAgent || "",
    });
    console.error("App render failed", error);
  }

  handleWindowError(event) {
    recordClientError({
      source: "window-error",
      message: event?.error?.stack || event?.message || "Unknown window error",
      route: window.location.hash || window.location.pathname || "",
      userAgent: window.navigator?.userAgent || "",
    });
  }

  handleUnhandledRejection(event) {
    const reason = event?.reason;
    recordClientError({
      source: "unhandled-rejection",
      message: reason?.stack || reason?.message || String(reason || "Unknown rejection"),
      route: window.location.hash || window.location.pathname || "",
      userAgent: window.navigator?.userAgent || "",
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          textAlign: "center",
        }}
        >
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
              Something went wrong loading the app.
            </div>
            <div style={{ marginBottom: 16, color: "var(--muted, #666)" }}>
              Refresh the page to try again.
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                border: "1px solid currentColor",
                borderRadius: 8,
                padding: "10px 14px",
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              Refresh
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
