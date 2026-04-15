import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchVisibleProfiles } from "../accountData.js";
import { useAuth } from "../auth/useAuth.js";
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
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.dialog}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className={styles.header}>
          <div>
            <div className={styles.kicker}>Sharing</div>
            <h3 className={styles.title}>{title}</h3>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            Close
          </button>
        </div>

        <div className={styles.helpText}>
          Select the specific staff members who should have access. Leave all unchecked to keep this private.
        </div>

        <div className={styles.list}>
          {visibleProfiles.length === 0 ? (
            <div className={styles.empty}>No other active users are available to share with.</div>
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

        {error ? <div className={styles.error}>{error}</div> : null}

        <div className={styles.actions}>
          <button type="button" className={styles.secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={styles.primaryButton} onClick={handleSave} disabled={submitting}>
            {submitting ? "Saving..." : "Save Access"}
          </button>
        </div>
      </div>
    </div>
  );
}
