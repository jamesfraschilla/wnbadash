import { teamLogoUrl } from "../api.js";
import styles from "./CreatingDisruption.module.css";

function formatPair(made, attempted) {
  return `${made || 0}/${attempted || 0}`;
}

const creatingColumns = [
  {
    key: "driving",
    label: "Driving",
    format: (stats) => formatPair(stats.drivingFGMade, stats.drivingFGAttempted),
  },
  {
    key: "cutting",
    label: "Cutting",
    format: (stats) => formatPair(stats.cuttingFGMade, stats.cuttingFGAttempted),
  },
  {
    key: "catchShoot",
    label: "C&S 3s",
    format: (stats) => formatPair(stats.catchAndShoot3FGMade, stats.catchAndShoot3FGAttempted),
  },
  {
    key: "dynamite",
    label: "Dynamite 3s",
    format: (stats) => formatPair(stats.secondChance3FGMade, stats.secondChance3FGAttempted),
  },
];

const disruptionColumns = [
  {
    key: "offFouls",
    label: "Offensive FD",
    format: (stats) => stats.offensiveFoulsDrawn ?? 0,
  },
  {
    key: "disruptions",
    label: "Disruptions",
    format: (_, value) => value ?? 0,
    isDerived: true,
  },
  {
    key: "kills",
    label: "Kills",
    format: (_, value) => value ?? 0,
    isDerived: true,
  },
];

export default function CreatingDisruption({
  awayTeam,
  homeTeam,
  awayStats,
  homeStats,
  awayDisruptions,
  homeDisruptions,
  awayKills,
  homeKills,
}) {
  if (!awayStats || !homeStats) return null;

  const awayLogo = awayTeam?.teamId ? teamLogoUrl(awayTeam.teamId) : null;
  const homeLogo = homeTeam?.teamId ? teamLogoUrl(homeTeam.teamId) : null;
  const awayAlt = awayTeam?.teamName || awayTeam?.teamTricode || "Away team";
  const homeAlt = homeTeam?.teamName || homeTeam?.teamTricode || "Home team";

  const derivedValues = {
    disruptions: { away: awayDisruptions, home: homeDisruptions },
    kills: { away: awayKills, home: homeKills },
  };

  const renderSection = (title, columns) => (
    <section className={styles.section}>
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
        {columns.map((col) => {
          const format = col.format || ((stats) => stats?.[col.key] ?? 0);
          const derived = col.isDerived ? derivedValues[col.key] : null;
          return (
            <div key={col.key} className={styles.row}>
              <div className={styles.statLabel}>{col.label}</div>
              <div className={styles.statValue}>
                {col.isDerived ? format(null, derived?.away) : format(awayStats)}
              </div>
              <div className={styles.statValue}>
                {col.isDerived ? format(null, derived?.home) : format(homeStats)}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );

  return (
    <>
      {renderSection("Creating", creatingColumns)}
      {renderSection("Disruption", disruptionColumns)}
    </>
  );
}
