import styles from "./ui.module.css";

export default function Tabs({ tabs = [], value, onChange, className = "" }) {
  return (
    <div className={[styles.tabs, className].filter(Boolean).join(" ")} role="tablist">
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            className={[styles.tab, active ? styles.tabActive : ""].filter(Boolean).join(" ")}
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(tab.value)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
