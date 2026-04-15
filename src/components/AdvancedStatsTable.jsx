import { teamLogoUrl } from "../api.js";
import styles from "./AdvancedStatsTable.module.css";

const rows = [
  { key: "drivingFGPercent", label: "Driving FG%", format: (v) => `${v || 0}%` },
  { key: "cuttingFGPercent", label: "Cutting FG%", format: (v) => `${v || 0}%` },
  { key: "catchAndShoot3FGPercent", label: "C&S 3P%", format: (v) => `${v || 0}%` },
  { key: "chargesDrawn", label: "Charges Drawn" },
  { key: "offensiveFoulsDrawn", label: "Off Fouls Drawn" },
];

export default function AdvancedStatsTable({ homeTeam, awayTeam, homeStats, awayStats }) {
  if (!homeStats || !awayStats) return null;

  const awayLogo = awayTeam?.teamId ? teamLogoUrl(awayTeam.teamId) : null;
  const homeLogo = homeTeam?.teamId ? teamLogoUrl(homeTeam.teamId) : null;
  const awayAlt = awayTeam?.teamName || awayTeam?.teamTricode || "Away team";
  const homeAlt = homeTeam?.teamName || homeTeam?.teamTricode || "Home team";

  return (
    <section className={styles.container}>
      <h3 className={styles.title}>Advanced Stats</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th></th>
            <th>
              {awayLogo ? (
                <img className={styles.teamLogo} src={awayLogo} alt={`${awayAlt} logo`} />
              ) : (
                awayTeam?.teamTricode || ""
              )}
            </th>
            <th>
              {homeLogo ? (
                <img className={styles.teamLogo} src={homeLogo} alt={`${homeAlt} logo`} />
              ) : (
                homeTeam?.teamTricode || ""
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const format = row.format || ((v) => v ?? 0);
            return (
              <tr key={row.key}>
                <td className={styles.key}>{row.label}</td>
                <td>{format(awayStats[row.key])}</td>
                <td>{format(homeStats[row.key])}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
