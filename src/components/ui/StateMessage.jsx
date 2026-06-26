import styles from "./ui.module.css";

const toneClass = {
  default: "",
  info: styles.stateInfo,
  error: styles.stateError,
  success: styles.stateSuccess,
};

export default function StateMessage({ tone = "default", className = "", children }) {
  return (
    <div className={[
      styles.stateMessage,
      toneClass[tone] || "",
      className,
    ].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
