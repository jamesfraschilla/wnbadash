import styles from "./ui.module.css";

export default function Card({ as: Component = "div", className = "", ...props }) {
  return (
    <Component
      className={[styles.card, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}
