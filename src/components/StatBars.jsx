import { teamLogoUrl } from "../api.js";
import styles from "./StatBars.module.css";

function BarCell({ value, max, format, detail, variant }) {
  const width = Math.round(((value || 0) / max) * 100);
  return (
    <div className={styles.statRow}>
      <div className={styles.barContainer}>
        <div className={`${styles.bar} ${variant}`} style={{ width: `${width}%` }} />
      </div>
      <div className={styles.value}>{format(value)}</div>
      {detail && <div className={styles.detail}>{detail}</div>}
    </div>
  );
}

export default function StatBars({ title, awayTeam, homeTeam, rows }) {
  const awayLogo = awayTeam?.teamId ? teamLogoUrl(awayTeam.teamId) : null;
  const homeLogo = homeTeam?.teamId ? teamLogoUrl(homeTeam.teamId) : null;
  const awayAlt = awayTeam?.teamName || awayTeam?.teamTricode || "Away team";
  const homeAlt = homeTeam?.teamName || homeTeam?.teamTricode || "Home team";

  return (
    <section className={styles.container}>
      <h3 className={styles.title}>{title}</h3>
      <div className={styles.wrapper}>
        <div className={styles.teamLabels}>
          <div className={styles.spacer} />
          <div className={styles.teamLabel}>
            {awayLogo ? (
              <img className={styles.teamLogo} src={awayLogo} alt={`${awayAlt} logo`} />
            ) : (
              <div className={styles.teamAbbr}>{awayTeam?.teamTricode || ""}</div>
            )}
          </div>
          <div className={styles.teamLabel}>
            {homeLogo ? (
              <img className={styles.teamLogo} src={homeLogo} alt={`${homeAlt} logo`} />
            ) : (
              <div className={styles.teamAbbr}>{homeTeam?.teamTricode || ""}</div>
            )}
          </div>
        </div>
        <div
          className={styles.grid}
          style={{ gridTemplateColumns: `repeat(${rows.length}, 1fr)` }}
        >
          {rows.map((row) => {
            const format = row.format || ((v) => v ?? 0);
            const max = Math.max(row.awayValue || 0, row.homeValue || 0, 1);
            return (
              <div key={row.label} className={styles.factor}>
                <div className={styles.factorLabel}>{row.label}</div>
                <BarCell
                  value={row.awayValue}
                  max={max}
                  format={format}
                  detail={row.awayDetail}
                  variant={styles.awayBar}
                />
                <BarCell
                  value={row.homeValue}
                  max={max}
                  format={format}
                  detail={row.homeDetail}
                  variant={styles.homeBar}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
