import styles from "./VersionHistoryDialog.module.css";

function formatVersionTimestamp(value) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString();
}

export default function VersionHistoryDialog({
  open,
  title,
  versions = [],
  onClose,
  onRestore,
  describeVersion,
}) {
  if (!open) return null;

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
            <div className={styles.kicker}>History</div>
            <h3 className={styles.title}>{title}</h3>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            Close
          </button>
        </div>

        <div className={styles.list}>
          {versions.length === 0 ? (
            <div className={styles.empty}>No previous versions are available yet.</div>
          ) : (
            versions.map((version) => (
              <div key={version.id} className={styles.item}>
                <div className={styles.metaRow}>
                  <div className={styles.versionLabel}>Version {version.version_number}</div>
                  <div className={styles.versionTime}>{formatVersionTimestamp(version.created_at)}</div>
                </div>
                <div className={styles.snapshot}>
                  {describeVersion ? describeVersion(version) : JSON.stringify(version.snapshot)}
                </div>
                {onRestore ? (
                  <button type="button" className={styles.restoreButton} onClick={() => onRestore(version)}>
                    Restore This Version
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
