import { gLeagueHeadshotOverrides } from "./gLeagueHeadshotOverrides.js";

const API_BASE = "https://d1rjt2wyntx8o7.cloudfront.net/api";
const WNBA_SCHEDULE_URL = "https://cdn.wnba.com/static/json/staticData/scheduleLeagueV2.json";
const SUPABASE_FUNCTIONS_BASE = import.meta.env.VITE_SUPABASE_URL
  ? `${String(import.meta.env.VITE_SUPABASE_URL).replace(/\/$/, "")}/functions/v1`
  : "";

async function requestJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return res.json();
}

function normalizeDateOnly(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString().slice(0, 10);
  }

  const dateMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dateMatch) {
    const [, month, day, year] = dateMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return text.slice(0, 10);
}

function normalizeStatus(game) {
  const explicit = Number(game?.gameStatus ?? game?.gameStatusId ?? game?.gameStatusCode);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const statusText = String(game?.gameStatusText || "").toLowerCase();
  if (!statusText) return 1;
  if (statusText.includes("final")) return 3;
  if (statusText.includes("q") || statusText.includes("ot") || statusText.includes("halftime")) return 2;
  return 1;
}

function normalizeTeam(team) {
  return {
    teamId: String(team?.teamId || team?.id || "").trim(),
    teamName: String(team?.teamName || team?.name || "").trim(),
    teamCity: String(team?.teamCity || team?.city || "").trim(),
    teamTricode: String(team?.teamTricode || team?.tricode || team?.teamCode || "").trim().toUpperCase(),
    wins: Number(team?.wins ?? team?.win ?? 0) || 0,
    losses: Number(team?.losses ?? team?.loss ?? 0) || 0,
    score: Number(team?.score ?? team?.points ?? 0) || 0,
    timeoutsRemaining: Number(team?.timeoutsRemaining ?? 0) || 0,
  };
}

function normalizeWnbaScheduleGame(game, seasonYear = "") {
  const statusText = String(game?.gameStatusText || game?.gameLabel || "").trim();
  const gameTimeUTC = String(
    game?.gameTimeUTC ||
    game?.gameDateTimeUTC ||
    game?.gameDateTime ||
    ""
  ).trim();
  const gameEt = String(
    game?.gameEt ||
    game?.gameDateEst ||
    game?.gameDateTimeEst ||
    ""
  ).trim();

  return {
    gameId: String(game?.gameId || "").trim(),
    gameCode: String(game?.gameCode || game?.branchLink || "").trim(),
    gameStatus: normalizeStatus(game),
    gameStatusText: statusText || (gameTimeUTC || gameEt ? "Scheduled" : ""),
    period: Number(game?.period ?? game?.gameStatusPeriod ?? 0) || 0,
    gameClock: String(game?.gameClock || "").trim(),
    gameTimeUTC,
    gameEt,
    seasonYear: String(game?.seasonYear || seasonYear || "").trim(),
    seasonType: String(game?.seasonType || "").trim(),
    arena: {
      arenaName: String(game?.arena?.arenaName || game?.arenaName || "").trim(),
      arenaState: String(game?.arena?.arenaState || game?.arenaState || "").trim(),
      arenaCity: String(game?.arena?.arenaCity || game?.arenaCity || "").trim(),
    },
    homeTeam: normalizeTeam(game?.homeTeam),
    awayTeam: normalizeTeam(game?.awayTeam),
  };
}

export async function fetchGamesByDate(dateStr) {
  const normalizedTargetDate = normalizeDateOnly(dateStr);
  const payload = await requestJson(WNBA_SCHEDULE_URL);
  const seasonYear = String(payload?.leagueSchedule?.seasonYear || "").trim();
  const gameDates = Array.isArray(payload?.leagueSchedule?.gameDates)
    ? payload.leagueSchedule.gameDates
    : [];

  const matchingDate = gameDates.find((entry) => (
    normalizeDateOnly(entry?.gameDate || entry?.gameDateEst || entry?.gameDateTimeUTC) === normalizedTargetDate
  ));

  const games = Array.isArray(matchingDate?.games) ? matchingDate.games : [];

  return games
    .map((game) => normalizeWnbaScheduleGame(game, seasonYear))
    .filter((game) => game.gameId && game.homeTeam.teamId && game.awayTeam.teamId);
}

export function fetchGame(gameId, segment = null) {
  const segmentParam = segment ? `?segment=${segment}` : "";
  const url = `${API_BASE}/games/${gameId}${segmentParam}`;
  return requestJson(url);
}

export function fetchMinutes(gameId) {
  const url = `${API_BASE}/games/${gameId}/minutes`;
  return requestJson(url);
}

export function teamLogoUrl(teamId, league = null) {
  const inferredLeague =
    league ||
    inferLeagueFromTeamId(teamId);

  if (inferredLeague === "gleague") {
    return `https://ak-static.cms.nba.com/wp-content/uploads/logos/nbagleague/${teamId}/primary/L/logo.svg`;
  }
  if (inferredLeague === "wnba") {
    return `https://cdn.wnba.com/logos/wnba/${teamId}/D/logo.svg`;
  }
  return `https://cdn.nba.com/logos/nba/${teamId}/primary/L/logo.svg`;
}

export function inferLeagueFromTeamId(teamId) {
  const numericTeamId = Number(teamId);
  if (numericTeamId >= 1612700000 && numericTeamId < 1612710000) return "gleague";
  if (numericTeamId >= 1611661300 && numericTeamId < 1611661400) return "wnba";
  return "nba";
}

export function filterGamesByLeague(games, league) {
  return (Array.isArray(games) ? games : []).filter((game) => (
    inferLeagueFromTeamId(game?.homeTeam?.teamId || game?.awayTeam?.teamId) === league
  ));
}

export function playerHeadshotUrls(personId, teamId = null) {
  const safePersonId = String(personId || "").trim();
  if (!safePersonId) return [];

  const league = inferLeagueFromTeamId(teamId);
  const overrideValue = league === "gleague" ? gLeagueHeadshotOverrides[safePersonId] : null;
  const overrideUrls = Array.isArray(overrideValue)
    ? overrideValue
    : overrideValue
      ? [overrideValue]
      : [];

  const candidates = league === "gleague"
    ? [
      ...overrideUrls,
      SUPABASE_FUNCTIONS_BASE
        ? `${SUPABASE_FUNCTIONS_BASE}/player-headshot?personId=${encodeURIComponent(safePersonId)}`
        : null,
      `https://cdn.nba.com/headshots/nba/latest/1040x760/${safePersonId}.png`,
      `https://cdn.nba.com/headshots/nba/latest/260x190/${safePersonId}.png`,
    ]
    : [
      `https://cdn.nba.com/headshots/nba/latest/260x190/${safePersonId}.png`,
      `https://cdn.nba.com/headshots/nba/latest/1040x760/${safePersonId}.png`,
    ];

  return [...new Set(candidates.filter(Boolean))];
}

export function playerHeadshotUrl(personId, teamId = null) {
  return playerHeadshotUrls(personId, teamId)[0] || null;
}

export async function fetchCurrentNbaRosters() {
  if (!SUPABASE_FUNCTIONS_BASE) {
    throw new Error("Supabase functions are not configured.");
  }
  return requestJson(`${SUPABASE_FUNCTIONS_BASE}/nba-rosters`);
}

export async function fetchCurrentGLeagueRosters() {
  if (!SUPABASE_FUNCTIONS_BASE) {
    throw new Error("Supabase functions are not configured.");
  }
  return requestJson(`${SUPABASE_FUNCTIONS_BASE}/gleague-rosters`);
}

export function nbaEventVideoUrl({ gameId, actionNumber, seasonYear, title }) {
  if (!gameId || actionNumber == null) return null;

  const seasonText = String(seasonYear ?? "").trim();
  let season;
  if (/^\d{4}$/.test(seasonText)) {
    const startYear = Number(seasonText);
    season = `${startYear}-${String(startYear + 1).slice(-2)}`;
  } else if (/^\d{4}-\d{2}$/.test(seasonText)) {
    season = seasonText;
  } else if (/^\d{4}-\d{4}$/.test(seasonText)) {
    const startYear = Number(seasonText.slice(0, 4));
    season = `${startYear}-${String(startYear + 1).slice(-2)}`;
  }

  const params = new URLSearchParams({
    flag: "1",
    GameID: String(gameId),
    GameEventID: String(actionNumber),
  });

  if (season) params.set("Season", season);
  if (title) params.set("title", String(title));

  return `https://www.nba.com/stats/events?${params.toString()}`;
}
