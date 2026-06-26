import StatCardTable from "./StatCardTable.jsx";

const columns = [
  { key: "secondChancePoints", label: "2nd Chance" },
  { key: "pointsOffTurnovers", label: "Pts Off TO" },
  { key: "paintPoints", label: "Paint Pts" },
  { key: "threePointORebPercent", label: "3P-OR%", format: (v) => `${(v || 0).toFixed(1)}%` },
];

export default function MiscStats({ awayTeam, homeTeam, awayStats, homeStats }) {
  if (!awayStats || !homeStats) return null;

  const rows = columns.map((col) => {
    const format = col.format || ((v) => v ?? 0);
    return {
      key: col.key,
      label: col.label,
      away: format(awayStats[col.key]),
      home: format(homeStats[col.key]),
    };
  });

  return <StatCardTable title="Misc" awayTeam={awayTeam} homeTeam={homeTeam} rows={rows} />;
}
