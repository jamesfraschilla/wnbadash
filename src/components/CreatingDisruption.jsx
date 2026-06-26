import StatCardTable from "./StatCardTable.jsx";

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
  {
    key: "forcedTurnovers",
    label: "Forced TOs",
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
  awayForcedTurnovers,
  homeForcedTurnovers,
}) {
  if (!awayStats || !homeStats) return null;

  const derivedValues = {
    disruptions: { away: awayDisruptions, home: homeDisruptions },
    kills: { away: awayKills, home: homeKills },
    forcedTurnovers: { away: awayForcedTurnovers, home: homeForcedTurnovers },
  };

  const buildRows = (columns) => columns.map((col) => {
    const format = col.format || ((stats) => stats?.[col.key] ?? 0);
    const derived = col.isDerived ? derivedValues[col.key] : null;
    return {
      key: col.key,
      label: col.label,
      away: col.isDerived ? format(null, derived?.away) : format(awayStats),
      home: col.isDerived ? format(null, derived?.home) : format(homeStats),
    };
  });

  return (
    <>
      <StatCardTable title="Creating" awayTeam={awayTeam} homeTeam={homeTeam} rows={buildRows(creatingColumns)} />
      <StatCardTable title="Disruption" awayTeam={awayTeam} homeTeam={homeTeam} rows={buildRows(disruptionColumns)} />
    </>
  );
}
