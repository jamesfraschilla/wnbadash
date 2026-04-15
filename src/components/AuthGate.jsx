import { useState } from "react";
import { APP_CONTACT_EMAIL, APP_NAME } from "../appConfig.js";
import { ALLOWED_EMAIL_DOMAIN } from "../authConfig.js";
import { useAuth } from "../auth/useAuth.js";
import styles from "./AuthGate.module.css";

export default function AuthGate() {
  const { error, signInWithPassword, clearError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localMessage, setLocalMessage] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setLocalMessage("");
    clearError();
    try {
      await signInWithPassword(email, password);
    } catch (submitError) {
      setLocalMessage(submitError?.message || "Unable to continue.");
    } finally {
      setSubmitting(false);
    }
  };

  const message = error || localMessage;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.kicker}>{APP_NAME}</div>
        <h1 className={styles.title}>Sign in to your account</h1>

        <form className={styles.form} onSubmit={handleSubmit}>
          <input
            id="auth-email"
            className={styles.input}
            type="email"
            value={email}
            autoComplete="email"
            placeholder={`you@${ALLOWED_EMAIL_DOMAIN}`}
            onChange={(event) => setEmail(event.target.value)}
            disabled={submitting}
          />

          <label className={styles.label} htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            className={styles.input}
            type="password"
            value={password}
            autoComplete="current-password"
            placeholder="Enter your password"
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
          />

          {message ? <div className={styles.message}>{message}</div> : null}

          <button
            type="submit"
            className={styles.submitButton}
            disabled={submitting || !email.trim() || !password}
          >
            {submitting ? "Signing In..." : "Sign In"}
          </button>
          <div className={styles.helpText}>
            Forgot password? Contact {APP_CONTACT_EMAIL}
          </div>
        </form>
      </div>
    </div>
  );
}
