import { useState } from "react";
import styles from "./AccessGate.module.css";

export default function AccessGate({ onUnlock }) {
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (event) => {
    event.preventDefault();
    const success = onUnlock(accessCode);
    if (success) {
      setAccessCode("");
      setError("");
      return;
    }
    setError("Incorrect access code.");
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Access Required</h1>
        <p className={styles.subtitle}>Enter the site access code to continue.</p>
        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.label} htmlFor="site-access-code">Access Code</label>
          <input
            id="site-access-code"
            className={styles.input}
            type="password"
            value={accessCode}
            onChange={(event) => {
              setAccessCode(event.target.value);
              if (error) setError("");
            }}
            autoComplete="current-password"
          />
          {error ? <div className={styles.error}>{error}</div> : null}
          <button type="submit" className={styles.button}>Unlock</button>
        </form>
      </div>
    </div>
  );
}
