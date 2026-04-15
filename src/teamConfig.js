import { APP_SHORT_NAME, PRIMARY_TEAM_SCOPE } from "./appConfig.js";

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

export const TRACKED_TEAM = {
  scopeKey: normalizeText(PRIMARY_TEAM_SCOPE).replace(/\s+/g, "_") || "mystics",
  scopeLabel: PRIMARY_TEAM_SCOPE,
  teamId: "1611661322",
  teamTricode: "WAS",
  teamCity: "Washington",
  teamName: "Mystics",
  league: "wnba",
  titleLabel: String(APP_SHORT_NAME || "Mystics").trim().toUpperCase() || "MYSTICS",
  keywords: ["washington", "mystics"],
};

export function isTrackedTeam(team) {
  const teamId = String(team?.teamId || "").trim();
  if (teamId && teamId === TRACKED_TEAM.teamId) return true;

  const tricode = String(team?.teamTricode || "").trim().toUpperCase();
  const city = normalizeText(team?.teamCity);
  const name = normalizeText(team?.teamName);
  const fullName = `${city} ${name}`.trim();

  if (tricode === TRACKED_TEAM.teamTricode && name.includes("mystics")) {
    return true;
  }

  return TRACKED_TEAM.keywords.every((keyword) => fullName.includes(keyword));
}

export function getTrackedTeamScopeForTeam(team) {
  return isTrackedTeam(team) ? TRACKED_TEAM.scopeKey : null;
}

export function getTrackedTeamScopeForGame(game) {
  if (isTrackedTeam(game?.homeTeam)) return TRACKED_TEAM.scopeKey;
  if (isTrackedTeam(game?.awayTeam)) return TRACKED_TEAM.scopeKey;
  return null;
}

export function getTrackedTeamForGame(game) {
  if (isTrackedTeam(game?.homeTeam)) return game.homeTeam;
  if (isTrackedTeam(game?.awayTeam)) return game.awayTeam;
  return null;
}

export function getOpponentTeamForGame(game) {
  if (isTrackedTeam(game?.homeTeam)) return game?.awayTeam || null;
  if (isTrackedTeam(game?.awayTeam)) return game?.homeTeam || null;
  return null;
}

export function isTrackedGame(game) {
  return Boolean(getTrackedTeamForGame(game));
}
