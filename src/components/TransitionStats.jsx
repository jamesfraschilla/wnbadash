import { teamLogoUrl } from "../api.js";
import styles from "./TransitionStats.module.css";

const columns = [
  {
    key: "transitionRate",
    label: "%",
    format: (v, stats) => `${(v || 0).toFixed(1)}% (${stats.transitionPossessions || 0})`,
  },
  { key: "transitionPoints", label: "PTS" },
  { key: "transitionPPP", label: "PPP", format: (v) => (v || 0).toFixed(1) },
  { key: "transitionTurnovers", label: "TOV" },
];

export default function TransitionStats({ awayTeam, homeTeam, awayStats, homeStats }) {
  if (!awayStats || !homeStats) return null;

  const awayLogo = awayTeam?.teamId ? teamLogoUrl(awayTeam.teamId) : null;
  const homeLogo = homeTeam?.teamId ? teamLogoUrl(homeTeam.teamId) : null;
  const awayAlt = awayTeam?.teamName || awayTeam?.teamTricode || "Away team";
  const homeAlt = homeTeam?.teamName || homeTeam?.teamTricode || "Home team";

  const buildPPP = (stats) => {
    const points = stats.transitionPoints || 0;
    const possessions = stats.transitionPossessions || 0;
    return possessions ? points / possessions : 0;
  };
  const derivedAway = { ...awayStats, transitionPPP: buildPPP(awayStats) };
  const derivedHome = { ...homeStats, transitionPPP: buildPPP(homeStats) };

  return (
    <section className={styles.container}>
      <h3 className={styles.title}>Transition</h3>
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
        {columns.map((col) => {
          const format = col.format || ((v) => v ?? 0);
          return (
            <div key={col.key} className={styles.row}>
              <div className={styles.statLabel}>{col.label}</div>
              <div className={styles.statValue}>{format(derivedAway[col.key], derivedAway)}</div>
              <div className={styles.statValue}>{format(derivedHome[col.key], derivedHome)}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
