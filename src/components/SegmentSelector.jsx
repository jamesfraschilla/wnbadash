import styles from "./SegmentSelector.module.css";

const defaultOptions = [
  { value: "all", label: "All Segments" },
  { value: "q1", label: "Q1" },
  { value: "q2", label: "Q2" },
  { value: "q3", label: "Q3" },
  { value: "q1-q3", label: "Q1-Q3" },
  { value: "q4", label: "Q4" },
  { value: "first-half", label: "1st Half" },
  { value: "second-half", label: "2nd Half" },
];

export default function SegmentSelector({ value, onChange, options = defaultOptions }) {
  return (
    <select className={styles.dropdown} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
