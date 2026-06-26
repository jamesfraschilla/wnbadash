import { Button, Dialog, StateMessage } from "./ui/index.js";
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
    <Dialog
      open={open}
      kicker="History"
      title={title}
      onClose={onClose}
      width="760px"
    >
        <div className={styles.list}>
          {versions.length === 0 ? (
            <StateMessage>No previous versions are available yet.</StateMessage>
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
                  <Button variant="primary" className={styles.restoreButton} onClick={() => onRestore(version)}>
                    Restore This Version
                  </Button>
                ) : null}
              </div>
            ))
          )}
        </div>
    </Dialog>
  );
}
