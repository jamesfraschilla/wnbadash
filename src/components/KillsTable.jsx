import { teamLogoUrl } from "../api.js";
import styles from "./KillsTable.module.css";

const killKeys = ["three", "four", "five", "six", "seven", "eight", "delta", "pi"];

export default function KillsTable({ homeTeam, awayTeam, homeData, awayData }) {
  if (!homeData || !awayData) return null;

  const awayLogo = awayTeam?.teamId ? teamLogoUrl(awayTeam.teamId) : null;
  const homeLogo = homeTeam?.teamId ? teamLogoUrl(homeTeam.teamId) : null;
  const awayAlt = awayTeam?.teamName || awayTeam?.teamTricode || "Away team";
  const homeAlt = homeTeam?.teamName || homeTeam?.teamTricode || "Home team";

  return (
    <section className={styles.container}>
      <h3 className={styles.title}>Kills</h3>
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
          {killKeys.map((key) => (
            <tr key={key}>
              <td className={styles.key}>{key.toUpperCase()}</td>
              <td>{awayData[key] ?? 0}</td>
              <td>{homeData[key] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
