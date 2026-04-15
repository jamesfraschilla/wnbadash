import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Route, Routes } from "react-router-dom";
import Header from "./components/Header.jsx";
import AuthGate from "./components/AuthGate.jsx";
import LegacyNotesImportPrompt from "./components/LegacyNotesImportPrompt.jsx";
import PasswordResetGate from "./components/PasswordResetGate.jsx";
import { useAuth } from "./auth/useAuth.js";
import { readLocalStorage, writeLocalStorage } from "./storage.js";

const UPDATE_CHECK_INTERVAL_MS = 2 * 60 * 1000;
const Home = lazy(() => import("./pages/Home.jsx"));
const Game = lazy(() => import("./pages/Game.jsx"));
const PlayByPlay = lazy(() => import("./pages/PlayByPlay.jsx"));
const Minutes = lazy(() => import("./pages/Minutes.jsx"));
const Notes = lazy(() => import("./pages/Notes.jsx"));
const Drawing = lazy(() => import("./pages/Drawing.jsx"));
const PreGame = lazy(() => import("./pages/PreGame.jsx"));
const Rotations = lazy(() => import("./pages/Rotations.jsx"));
const Admin = lazy(() => import("./pages/Admin.jsx"));
const UserContent = lazy(() => import("./pages/UserContent.jsx"));
const Tools = lazy(() => import("./pages/Tools.jsx"));

function getCurrentBundleFingerprint() {
  if (typeof document === "undefined" || typeof window === "undefined") return "";
  const script = document.querySelector('script[type="module"][src]');
  const src = script?.getAttribute("src");
  if (!src) return "";
  return new URL(src, window.location.origin).href;
}

function getBundleFingerprintFromHtml(html) {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") return "";
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const script = parsed.querySelector('script[type="module"][src]');
  const src = script?.getAttribute("src");
  if (!src) return "";
  return new URL(src, window.location.origin).href;
}

function RouteLoadingFallback() {
  return <div style={{ padding: "40px 16px", textAlign: "center" }}>Loading page...</div>;
}

export default function App() {
  const [theme, setTheme] = useState(() => readLocalStorage("theme") || "light");
  const [updateFingerprint, setUpdateFingerprint] = useState("");
  const currentFingerprintRef = useRef("");
  const dismissedFingerprintRef = useRef("");
  const {
    accountsEnabled,
    loading,
    user,
    profile,
    error: authError,
    clearError,
    requiresPasswordReset,
    signOut,
    isAdmin,
    hasFeature,
  } = useAuth();
  const canUseTools = hasFeature("tools");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writeLocalStorage("theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!import.meta.env.PROD || typeof window === "undefined") return undefined;

    currentFingerprintRef.current = getCurrentBundleFingerprint();

    const checkForUpdate = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const url = new URL(`${import.meta.env.BASE_URL}index.html`, window.location.origin);
        url.searchParams.set("t", String(Date.now()));
        const response = await fetch(url.toString(), { cache: "no-store" });
        if (!response.ok) return;
        const html = await response.text();
        const nextFingerprint = getBundleFingerprintFromHtml(html);
        if (
          nextFingerprint
          && currentFingerprintRef.current
          && nextFingerprint !== currentFingerprintRef.current
          && nextFingerprint !== dismissedFingerprintRef.current
        ) {
          setUpdateFingerprint(nextFingerprint);
        }
      } catch {
        // Ignore transient fetch failures.
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkForUpdate();
      }
    };

    const intervalId = window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
    window.addEventListener("focus", checkForUpdate);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    checkForUpdate();

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", checkForUpdate);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  if (accountsEnabled) {
    if (loading) {
      return <div style={{ padding: "40px 16px", textAlign: "center" }}>Loading account...</div>;
    }

    if (!user) {
      return <AuthGate />;
    }

    if (requiresPasswordReset) {
      return <PasswordResetGate />;
    }

    if (authError) {
      return (
        <div style={{ padding: "40px 16px", textAlign: "center" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Account Load Failed</div>
          <div style={{ marginBottom: 12 }}>{authError}</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                clearError();
                window.location.reload();
              }}
            >
              Retry
            </button>
            {user ? (
              <button type="button" onClick={signOut}>
                Sign Out
              </button>
            ) : null}
          </div>
        </div>
      );
    }

    if (!profile) {
      return (
        <div style={{ padding: "40px 16px", textAlign: "center" }}>
          Your account is signed in, but no profile was found yet.
        </div>
      );
    }

    if (profile.status !== "active") {
      return (
        <div style={{ padding: "40px 16px", textAlign: "center" }}>
          <div>Your account is currently {profile.status}.</div>
          <button type="button" onClick={signOut} style={{ marginTop: 12 }}>
            Sign Out
          </button>
        </div>
      );
    }
  }

  return (
    <div>
      {accountsEnabled ? <LegacyNotesImportPrompt /> : null}
      {updateFingerprint ? (
        <div style={{
          position: "fixed",
          inset: "16px 16px auto 16px",
          zIndex: 1600,
          display: "flex",
          justifyContent: "center",
          pointerEvents: "none",
        }}
        >
          <div style={{
            width: "min(520px, 100%)",
            padding: "14px 16px",
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--panel)",
            color: "var(--text)",
            boxShadow: "0 18px 38px rgba(0, 0, 0, 0.18)",
            pointerEvents: "auto",
          }}
          >
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Newer Version Available</div>
            <div style={{ color: "var(--muted)", marginBottom: 12 }}>
              Refresh your browser to load the latest updates and fixes.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => {
                  dismissedFingerprintRef.current = updateFingerprint;
                  setUpdateFingerprint("");
                }}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  background: "var(--bg)",
                  color: "var(--text)",
                  cursor: "pointer",
                }}
              >
                Later
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  border: "1px solid var(--highlight-text)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  background: "var(--highlight-text)",
                  color: "var(--bg)",
                  cursor: "pointer",
                }}
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <Header
        theme={theme}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        onSignOut={signOut}
        profile={profile}
        isAdmin={isAdmin}
        canUseTools={canUseTools}
      />
      <main>
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/me" element={<UserContent />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/tools" element={<Tools />} />
            <Route path="/g/:gameId" element={<Game />} />
            <Route path="/g/:gameId/atc" element={<Game variant="atc" />} />
            <Route path="/g/:gameId/events" element={<PlayByPlay />} />
            <Route path="/g/:gameId/notes" element={<Notes />} />
            <Route path="/g/:gameId/pregame" element={<PreGame />} />
            <Route path="/g/:gameId/rotations" element={<Rotations />} />
            <Route path="/m/:gameId" element={<Minutes />} />
            <Route path="/draw" element={<Drawing />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
