import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { importLegacyLocalNotes } from "../accountData.js";
import { useAuth } from "../auth/useAuth.js";
import {
  countLegacyLocalNotes,
  hasLegacyLocalNotes,
  readLegacyNoteImportState,
  writeLegacyNoteImportState,
} from "../notesStorage.js";
import styles from "./LegacyNotesImportPrompt.module.css";

export default function LegacyNotesImportPrompt() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const noteCount = useMemo(() => countLegacyLocalNotes(), [open]);

  useEffect(() => {
    if (!user?.id) {
      setOpen(false);
      return;
    }
    if (!hasLegacyLocalNotes()) {
      setOpen(false);
      return;
    }
    const importState = readLegacyNoteImportState(user.id);
    if (importState?.status === "imported") {
      setOpen(false);
      return;
    }
    setOpen(true);
  }, [user?.id]);

  if (!open || !user?.id) return null;

  const handleImport = async () => {
    setSubmitting(true);
    setMessage("");
    try {
      const result = await importLegacyLocalNotes(user.id);
      writeLegacyNoteImportState(user.id, {
        status: "imported",
        importedCount: result.importedCount,
      });
      await queryClient.invalidateQueries({ queryKey: ["notes"] });
      setMessage(`Imported ${result.importedCount} local note${result.importedCount === 1 ? "" : "s"} into your account.`);
      setTimeout(() => {
        setOpen(false);
      }, 1200);
    } catch (error) {
      setMessage(error?.message || "Unable to import local notes.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLater = () => {
    setOpen(false);
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog} role="dialog" aria-modal="true">
        <div className={styles.kicker}>Local Notes Found</div>
        <h3 className={styles.title}>Import notes from this device?</h3>
        <p className={styles.body}>
          We found {noteCount} previously saved local note{noteCount === 1 ? "" : "s"} in this browser.
          Importing will attach them to your account without deleting the original local copies.
        </p>
        {message ? <div className={styles.message}>{message}</div> : null}
        <div className={styles.actions}>
          <button type="button" className={styles.secondaryButton} onClick={handleLater} disabled={submitting}>
            Later
          </button>
          <button type="button" className={styles.primaryButton} onClick={handleImport} disabled={submitting}>
            {submitting ? "Importing..." : "Import Notes"}
          </button>
        </div>
      </div>
    </div>
  );
}
