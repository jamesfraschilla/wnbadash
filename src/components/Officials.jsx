import { teamLogoUrl } from "../api.js";
import { orderOfficials } from "../officialAssignments.js";
import styles from "./Officials.module.css";

export default function Officials({
  officials,
  callsAgainst,
  homeAbr,
  awayAbr,
  homeTeam,
  awayTeam,
  publishedOrder,
}) {
  const orderedOfficials = orderOfficials(officials, publishedOrder);
  if (!orderedOfficials.length || !callsAgainst) return null;

  const awayTotal = callsAgainst
    ? orderedOfficials.reduce((sum, official) => sum + (callsAgainst?.[official.personId]?.[awayAbr] ?? 0), 0)
    : 0;
  const homeTotal = callsAgainst
    ? orderedOfficials.reduce((sum, official) => sum + (callsAgainst?.[official.personId]?.[homeAbr] ?? 0), 0)
    : 0;
  const awayLogo = awayTeam?.teamId ? teamLogoUrl(awayTeam.teamId) : null;
  const homeLogo = homeTeam?.teamId ? teamLogoUrl(homeTeam.teamId) : null;
  const awayAlt = awayTeam?.teamName || awayAbr || "Away team";
  const homeAlt = homeTeam?.teamName || homeAbr || "Home team";

  return (
    <section className={styles.container}>
      <table className={styles.callsTable}>
        <colgroup>
          <col className={styles.teamCol} />
          {orderedOfficials.map((official) => (
            <col key={`col-${official.personId}`} className={styles.officialCol} />
          ))}
          <col className={styles.totalCol} />
        </colgroup>
        <thead>
          <tr className={styles.headerRow}>
            <th className={styles.headerCellLeft}>
              <div className={styles.callsAgainstLabel}>Calls Against</div>
            </th>
            {orderedOfficials.map((official) => (
              <th key={official.personId} className={styles.headerCell} aria-hidden="true">
                <span className={styles.columnSpacer} />
              </th>
            ))}
            <th className={styles.headerCell}>Total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={styles.teamCell}>
              {awayLogo ? (
                <img className={styles.teamLogo} src={awayLogo} alt={`${awayAlt} logo`} />
              ) : (
                awayAbr
              )}
            </td>
            {orderedOfficials.map((official) => (
              <td key={official.personId} className={styles.dataCell}>
                {callsAgainst?.[official.personId]?.[awayAbr] ?? 0}
              </td>
            ))}
            <td className={styles.dataCell}>{awayTotal}</td>
          </tr>
          <tr>
            <td className={styles.teamCell}>
              {homeLogo ? (
                <img className={styles.teamLogo} src={homeLogo} alt={`${homeAlt} logo`} />
              ) : (
                homeAbr
              )}
            </td>
            {orderedOfficials.map((official) => (
              <td key={official.personId} className={styles.dataCell}>
                {callsAgainst?.[official.personId]?.[homeAbr] ?? 0}
              </td>
            ))}
            <td className={styles.dataCell}>{homeTotal}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
