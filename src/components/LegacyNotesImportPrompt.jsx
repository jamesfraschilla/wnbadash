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
import { Button, Dialog, StateMessage } from "./ui/index.js";
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
    <Dialog
      open={open}
      kicker="Local Notes Found"
      title="Import notes from this device?"
      onClose={handleLater}
      width="480px"
      footer={(
        <>
          <Button variant="secondary" onClick={handleLater} disabled={submitting}>
            Later
          </Button>
          <Button variant="primary" onClick={handleImport} disabled={submitting}>
            {submitting ? "Importing..." : "Import Notes"}
          </Button>
        </>
      )}
    >
        <p className={styles.body}>
          We found {noteCount} previously saved local note{noteCount === 1 ? "" : "s"} in this browser.
          Importing will attach them to your account without deleting the original local copies.
        </p>
        {message ? <StateMessage tone="info" className={styles.message}>{message}</StateMessage> : null}
    </Dialog>
  );
}
