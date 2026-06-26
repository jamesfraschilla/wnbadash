import styles from "./ui.module.css";

const variantClass = {
  primary: styles.buttonPrimary,
  secondary: styles.buttonSecondary,
  ghost: styles.buttonGhost,
  danger: styles.buttonDanger,
};

const sizeClass = {
  sm: styles.buttonSm,
  md: styles.buttonMd,
};

export default function Button({
  as: Component = "button",
  variant = "secondary",
  size = "md",
  className = "",
  type,
  ...props
}) {
  return (
    <Component
      className={[
        styles.button,
        variantClass[variant] || variantClass.secondary,
        sizeClass[size] || sizeClass.md,
        className,
      ].filter(Boolean).join(" ")}
      type={Component === "button" ? (type || "button") : type}
      {...props}
    />
  );
}
