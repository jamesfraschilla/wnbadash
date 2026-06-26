import StatCardTable from "./StatCardTable.jsx";

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

  const buildPPP = (stats) => {
    const points = stats.transitionPoints || 0;
    const possessions = stats.transitionPossessions || 0;
    return possessions ? points / possessions : 0;
  };
  const derivedAway = { ...awayStats, transitionPPP: buildPPP(awayStats) };
  const derivedHome = { ...homeStats, transitionPPP: buildPPP(homeStats) };
  const rows = columns.map((col) => {
    const format = col.format || ((v) => v ?? 0);
    return {
      key: col.key,
      label: col.label,
      away: format(derivedAway[col.key], derivedAway),
      home: format(derivedHome[col.key], derivedHome),
    };
  });

  return <StatCardTable title="Transition" awayTeam={awayTeam} homeTeam={homeTeam} rows={rows} />;
}
