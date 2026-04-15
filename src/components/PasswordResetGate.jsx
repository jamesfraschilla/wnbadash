import { useState } from "react";
import { useAuth } from "../auth/useAuth.js";
import styles from "./AuthGate.module.css";

export default function PasswordResetGate() {
  const { completePasswordReset, signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      await completePasswordReset(password);
      setMessage("Password updated. You can continue into the dashboard.");
    } catch (error) {
      setMessage(error?.message || "Unable to update password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.kicker}>Account Recovery</div>
        <h1 className={styles.title}>Set a new password</h1>
        <p className={styles.subtitle}>
          Enter a new password for your account, then continue back into the dashboard.
        </p>
        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.label} htmlFor="new-password">New Password</label>
          <input
            id="new-password"
            className={styles.input}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
          />

          <label className={styles.label} htmlFor="confirm-password">Confirm Password</label>
          <input
            id="confirm-password"
            className={styles.input}
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
          />

          {message ? <div className={styles.message}>{message}</div> : null}

          <button type="submit" className={styles.submitButton} disabled={submitting || !password || !confirmPassword}>
            {submitting ? "Saving..." : "Update Password"}
          </button>
        </form>

        <div style={{ marginTop: 12 }}>
          <button type="button" className={styles.modeTab} onClick={signOut}>
            Cancel Recovery
          </button>
        </div>
      </div>
    </div>
  );
}
