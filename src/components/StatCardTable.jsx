import { teamLogoUrl } from "../api.js";
import styles from "./StatCardTable.module.css";

export default function StatCardTable({ title, awayTeam, homeTeam, rows }) {
  const awayLogo = awayTeam?.teamId ? teamLogoUrl(awayTeam.teamId) : null;
  const homeLogo = homeTeam?.teamId ? teamLogoUrl(homeTeam.teamId) : null;
  const awayAlt = awayTeam?.teamName || awayTeam?.teamTricode || "Away team";
  const homeAlt = homeTeam?.teamName || homeTeam?.teamTricode || "Home team";

  return (
    <section className={styles.card}>
      <h3 className={styles.title}>{title}</h3>
      <div className={styles.table}>
        <div className={styles.corner} />
        <div className={styles.teamHeader}>
          {awayLogo ? (
            <img className={styles.teamLogo} src={awayLogo} alt={`${awayAlt} logo`} />
          ) : (
            awayTeam?.teamTricode || ""
          )}
        </div>
        <div className={styles.teamHeader}>
          {homeLogo ? (
            <img className={styles.teamLogo} src={homeLogo} alt={`${homeAlt} logo`} />
          ) : (
            homeTeam?.teamTricode || ""
          )}
        </div>
        {rows.map((row) => (
          <div key={row.key} className={styles.row}>
            <div className={styles.statLabel}>{row.label}</div>
            <div className={styles.statValue}>{row.away}</div>
            <div className={styles.statValue}>{row.home}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
