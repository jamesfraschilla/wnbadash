import Button from "./Button.jsx";
import styles from "./ui.module.css";

export default function Dialog({
  open,
  title,
  kicker,
  onClose,
  width,
  children,
  footer,
  className = "",
  bodyClassName = "",
}) {
  if (!open) return null;

  return (
    <div className={styles.dialogOverlay} onClick={onClose}>
      <div
        className={[styles.dialog, className].filter(Boolean).join(" ")}
        style={width ? { "--dialog-width": width } : undefined}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className={styles.dialogHeader}>
          <div>
            {kicker ? <div className={styles.kicker}>{kicker}</div> : null}
            {title ? <h3 className={styles.dialogTitle}>{title}</h3> : null}
          </div>
          {onClose ? (
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
          ) : null}
        </div>
        <div className={[styles.dialogBody, bodyClassName].filter(Boolean).join(" ")}>
          {children}
        </div>
        {footer ? <div className={styles.dialogFooter}>{footer}</div> : null}
      </div>
    </div>
  );
}
