import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchVisibleProfiles } from "../accountData.js";
import { useAuth } from "../auth/useAuth.js";
import { Button, Dialog, StateMessage } from "./ui/index.js";
import styles from "./ShareDialog.module.css";

export default function ShareDialog({
  open,
  title,
  initialSelectedIds = [],
  onClose,
  onSave,
}) {
  const { user } = useAuth();
  const [selectedIds, setSelectedIds] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const { data: profiles = [] } = useQuery({
    queryKey: ["visible-profiles"],
    queryFn: fetchVisibleProfiles,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setSelectedIds(initialSelectedIds);
    setError("");
    setSubmitting(false);
  }, [initialSelectedIds, open]);

  const visibleProfiles = useMemo(() => {
    return profiles.filter((profile) => profile.id !== user?.id && profile.status === "active");
  }, [profiles, user?.id]);

  if (!open) return null;

  const toggleUser = (profileId) => {
    setSelectedIds((prev) => (
      prev.includes(profileId)
        ? prev.filter((value) => value !== profileId)
        : [...prev, profileId]
    ));
  };

  const handleSave = async () => {
    setSubmitting(true);
    setError("");
    try {
      await onSave(selectedIds);
    } catch (saveError) {
      setError(saveError?.message || "Unable to update sharing.");
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  };

  return (
    <Dialog
      open={open}
      kicker="Sharing"
      title={title}
      onClose={onClose}
      width="620px"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={submitting}>
            {submitting ? "Saving..." : "Save Access"}
          </Button>
        </>
      )}
    >
        <div className={styles.helpText}>
          Select the specific staff members who should have access. Leave all unchecked to keep this private.
        </div>

        <div className={styles.list}>
          {visibleProfiles.length === 0 ? (
            <StateMessage>No other active users are available to share with.</StateMessage>
          ) : (
            visibleProfiles.map((profile) => {
              const checked = selectedIds.includes(profile.id);
              return (
                <label key={profile.id} className={styles.row}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleUser(profile.id)}
                  />
                  <div className={styles.rowBody}>
                    <div className={styles.rowName}>{profile.display_name || profile.email}</div>
                    <div className={styles.rowMeta}>
                      {profile.email} · {profile.role}
                    </div>
                  </div>
                </label>
              );
            })
          )}
        </div>

        {error ? <StateMessage tone="error" className={styles.error}>{error}</StateMessage> : null}
    </Dialog>
  );
}
