import { inferLeagueFromTeamId } from "../api.js";
import { formatMinutes } from "../utils.js";
import styles from "./BoxScoreTable.module.css";

const defaultColumns = [
  "MIN",
  "PTS",
  "REB",
  "OREB",
  "AST",
  "STL",
  "BLK",
  "TO",
  "PF",
  "FG",
  "RIM",
  "MID",
  "3PT",
  "FT",
  "+/-",
  "ORTG",
  "DRTG",
];

function formatRating(value) {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(1);
}

function formatShootingPercent(made, attempted) {
  const safeMade = Number(made) || 0;
  const safeAttempted = Number(attempted) || 0;
  if (safeAttempted <= 0) return "0.0%";
  return `${((safeMade / safeAttempted) * 100).toFixed(1)}%`;
}

function formatShootingLine(made, attempted) {
  const safeMade = Number(made) || 0;
  const safeAttempted = Number(attempted) || 0;
  return `${safeMade}-${safeAttempted}`;
}

function playerLine(player) {
  return {
    MIN: formatMinutes(player.minutes),
    PTS: player.points,
    REB: player.reboundsTotal,
    OREB: player.reboundsOffensive,
    AST: player.assists,
    STL: player.steals,
    BLK: player.blocks,
    TO: player.turnovers,
    PF: player.foulsPersonal,
    FG: formatShootingLine(player.fieldGoalsMade, player.fieldGoalsAttempted),
    RIM: formatShootingLine(player.rimFieldGoalsMade, player.rimFieldGoalsAttempted),
    MID: formatShootingLine(player.midFieldGoalsMade, player.midFieldGoalsAttempted),
    "3PT": formatShootingLine(player.threePointersMade, player.threePointersAttempted),
    FT: formatShootingLine(player.freeThrowsMade, player.freeThrowsAttempted),
    "+/-": player.plusMinusPoints,
    ORTG: formatRating(player.ortg),
    DRTG: formatRating(player.drtg),
  };
}

function playerPageUrl(player, teamId) {
  if (!player?.personId) return null;
  const league = inferLeagueFromTeamId(teamId);
  if (league === "gleague") {
    return `https://gleague.nba.com/player/${player.personId}/`;
  }
  if (league === "wnba") {
    return `https://stats.wnba.com/player/${player.personId}/`;
  }
  return `https://www.nba.com/stats/player/${player.personId}`;
}

function pfClass(fouls, period) {
  const safeFouls = fouls || 0;
  const quarter = Math.min(Math.max(period || 1, 1), 4);

  if (quarter === 1) {
    if (safeFouls <= 1) return styles.pfBlack;
    if (safeFouls === 2) return styles.pfYellow;
    return styles.pfRed;
  }

  if (quarter === 2) {
    if (safeFouls <= 2) return styles.pfBlack;
    if (safeFouls === 3) return styles.pfYellow;
    return styles.pfRed;
  }

  if (safeFouls <= 3) return styles.pfBlack;
  if (safeFouls === 4) return styles.pfYellow;
  return styles.pfRed;
}

function parseMinutesToSeconds(value) {
  const normalized = String(value || "").trim();
  const match = /^(\d+):(\d{2})$/.exec(normalized);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return minutes * 60 + seconds;
}

function minuteCapClass(player, minuteCapsByPersonId) {
  const personId = String(player?.personId || "").trim();
  if (!personId || !(minuteCapsByPersonId instanceof Map)) return "";
  const capMinutes = minuteCapsByPersonId.get(personId);
  if (capMinutes === "" || capMinutes == null) return "";
  const safeCap = Number(capMinutes);
  if (!Number.isFinite(safeCap) || safeCap <= 0) return "";
  const liveSeconds = parseMinutesToSeconds(formatMinutes(player?.minutes));
  if (!Number.isFinite(liveSeconds)) return "";
  const capSeconds = safeCap * 60;
  if (liveSeconds >= capSeconds) return styles.minutesRed;
  if (liveSeconds >= capSeconds * 0.85) return styles.minutesYellow;
  return "";
}

export default function BoxScoreTable({
  teamLabel,
  teamLogo,
  teamName,
  teamId,
  boxScore,
  currentPeriod,
  ratings = {},
  variant = "full",
  minuteCapsByPersonId = new Map(),
}) {
  if (!boxScore) return null;

  const columns = variant === "atc"
    ? [
      "MIN",
      "PF",
      "PTS",
      "REB",
      "OREB",
      "AST",
      "STL",
      "BLK",
      "TO",
      "FG",
      "3PT",
      "FT",
      "+/-",
    ]
    : defaultColumns;
  const shadedColumns = new Set(["FG", "RIM", "MID", "3PT", "FT"]);
  const formatPlayerName = (player) => {
    const parts = [player.firstName, player.familyName].filter(Boolean);
    if (parts.length) return parts.join(" ");
    return player.fullName || player.name || "";
  };

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr className={styles.headerRow}>
            <th className={styles.playerNumberCol}></th>
            <th className={styles.playerNameCol}>
              <div className={styles.teamHeaderContent}>
                {teamLogo && (
                  <img
                    className={styles.teamLogoHeader}
                    src={teamLogo}
                    alt={teamName || teamLabel || "Team logo"}
                  />
                )}
                <span className={styles.teamHeaderText}>{teamLabel}</span>
              </div>
            </th>
            {columns.map((col) => (
              <th
                key={col}
                className={`${styles.statHeader} ${shadedColumns.has(col) ? styles.shadedColumn : ""} ${variant === "atc" && col === "PF" ? styles.atcSeparator : ""}`}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
      <tbody>
        {boxScore.players.map((player) => {
          const stats = playerLine(player);
          const pageUrl = playerPageUrl(player, teamId);
          const minutesClassName = minuteCapClass(player, minuteCapsByPersonId);
          return (
              <tr key={player.personId}>
                <td className={styles.playerNumberCol}>
                  {player.jerseyNum ? `#${player.jerseyNum}` : ""}
                </td>
                <td className={styles.playerNameCol}>
                  {pageUrl ? (
                    <a
                      href={pageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.playerLink}
                    >
                      <span className={styles.playerName}>
                        {formatPlayerName(player)}
                      </span>
                    </a>
                  ) : (
                    <span className={styles.playerName}>
                      {formatPlayerName(player)}
                    </span>
                  )}
                  <span className={styles.position}>{player.position || ""}</span>
                </td>
                {columns.map((col) => (
                  <td
                    key={col}
                    className={`${shadedColumns.has(col) ? styles.shadedColumn : ""} ${variant === "atc" && col === "PF" ? styles.atcSeparator : ""}`}
                  >
                    {col === "PF"
                      ? <span className={pfClass(stats[col], currentPeriod)}>{stats[col]}</span>
                      : col === "MIN" && minutesClassName
                        ? <span className={minutesClassName}>{stats[col]}</span>
                        : stats[col]}
                  </td>
                ))}
              </tr>
            );
          })}
          {boxScore.totals && (
            <>
              <tr className={`${styles.totalsRow} ${variant === "atc" ? styles.totalsRowAtc : ""}`}>
                <td className={styles.playerNumberCol}></td>
                <td className={styles.playerNameCol}></td>
                {columns.map((col) => {
                  let value = "";
                  if (col === "PTS") value = boxScore.totals.points;
                  if (col === "REB") value = boxScore.totals.reboundsTotal;
                  if (col === "OREB") value = boxScore.totals.reboundsOffensive;
                  if (col === "AST") value = boxScore.totals.assists;
                  if (col === "STL") value = boxScore.totals.steals;
                  if (col === "BLK") value = boxScore.totals.blocks;
                  if (col === "TO") value = boxScore.totals.turnovers;
                  if (col === "PF") value = boxScore.totals.foulsPersonal;
                  if (col === "FG") value = formatShootingLine(boxScore.totals.fieldGoalsMade, boxScore.totals.fieldGoalsAttempted);
                  if (col === "RIM") value = formatShootingLine(boxScore.totals.rimFieldGoalsMade, boxScore.totals.rimFieldGoalsAttempted);
                  if (col === "MID") value = formatShootingLine(boxScore.totals.midFieldGoalsMade, boxScore.totals.midFieldGoalsAttempted);
                  if (col === "3PT") value = formatShootingLine(boxScore.totals.threePointersMade, boxScore.totals.threePointersAttempted);
                  if (col === "FT") value = formatShootingLine(boxScore.totals.freeThrowsMade, boxScore.totals.freeThrowsAttempted);
                  if (col === "ORTG") value = formatRating(ratings.ortg);
                  if (col === "DRTG") value = formatRating(ratings.drtg);
                  const atcSeparator = variant === "atc" && col === "PF";
                  return (
                    <td
                      key={col}
                      className={`${shadedColumns.has(col) ? styles.shadedColumn : ""} ${atcSeparator ? styles.atcSeparator : ""}`}
                    >
                      {value}
                    </td>
                  );
                })}
              </tr>
              <tr className={styles.totalsPercentRow}>
                <td className={styles.playerNumberCol}></td>
                <td className={styles.playerNameCol}></td>
                {columns.map((col) => {
                  let value = "";
                  if (col === "FG") {
                    value = formatShootingPercent(
                      boxScore.totals.fieldGoalsMade,
                      boxScore.totals.fieldGoalsAttempted
                    );
                  }
                  if (col === "RIM") {
                    value = formatShootingPercent(
                      boxScore.totals.rimFieldGoalsMade,
                      boxScore.totals.rimFieldGoalsAttempted
                    );
                  }
                  if (col === "MID") {
                    value = formatShootingPercent(
                      boxScore.totals.midFieldGoalsMade,
                      boxScore.totals.midFieldGoalsAttempted
                    );
                  }
                  if (col === "3PT") {
                    value = formatShootingPercent(
                      boxScore.totals.threePointersMade,
                      boxScore.totals.threePointersAttempted
                    );
                  }
                  if (col === "FT") {
                    value = formatShootingPercent(
                      boxScore.totals.freeThrowsMade,
                      boxScore.totals.freeThrowsAttempted
                    );
                  }
                  const atcSeparator = variant === "atc" && col === "PF";
                  return (
                    <td
                      key={col}
                      className={`${shadedColumns.has(col) ? styles.shadedColumn : ""} ${atcSeparator ? styles.atcSeparator : ""}`}
                    >
                      {value}
                    </td>
                  );
                })}
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
