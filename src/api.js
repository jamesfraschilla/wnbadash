import { gLeagueHeadshotOverrides } from "./gLeagueHeadshotOverrides.js";

const API_BASE = "https://d1rjt2wyntx8o7.cloudfront.net/api";
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

export function fetchGamesByDate(dateStr) {
  const url = `${API_BASE}/games/byDate?date=${dateStr}`;
  return requestJson(url);
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
  return Number(teamId) >= 1612700000 && Number(teamId) < 1612710000 ? "gleague" : "nba";
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
