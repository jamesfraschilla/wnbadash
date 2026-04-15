import { supabase } from "./supabaseClient.js";
import { TRACKED_TEAM, getTrackedTeamScopeForGame, getTrackedTeamScopeForTeam, isTrackedTeam } from "./teamConfig.js";
import { readLocalStorage, writeLocalStorage } from "./storage.js";

const LEGACY_PLAYERS_STORAGE_KEY = "pregame:players:v1";
const PLAYERS_STORAGE_KEY_PREFIX = "pregame:players:v2:";
const SHARED_ROSTER_TABLE = "rotations_shared_state";
const SHARED_ROSTER_SCOPE_TYPE = "shared_roster";

export function isWashingtonTeam(team) {
  return isTrackedTeam(team);
}

export function isCapitalCityTeam() {
  return false;
}

export function getPregameTeamScope(game) {
  return getTrackedTeamScopeForGame(game);
}

export function getPregameTeamScopeForTeam(team) {
  return getTrackedTeamScopeForTeam(team);
}

export function normalizePregamePlayerName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizePersonId(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function normalizeMatchName(value) {
  const normalized = normalizePregamePlayerName(value)
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\b(JR|SR|II|III|IV|V)\b$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized;
}

function getLastName(name) {
  const parts = normalizePregamePlayerName(name).split(" ").filter(Boolean);
  return parts.length ? parts[parts.length - 1].toLowerCase() : "";
}

export function sortPregamePlayersByLastName(players) {
  return [...players].sort((a, b) => {
    const aLast = getLastName(a.name);
    const bLast = getLastName(b.name);
    if (aLast !== bLast) return aLast.localeCompare(bLast);
    return normalizePregamePlayerName(a.name).localeCompare(normalizePregamePlayerName(b.name));
  });
}

function safeParseJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function normalizePregamePlayers(rawPlayers) {
  return sortPregamePlayersByLastName(
    (Array.isArray(rawPlayers) ? rawPlayers : [])
      .map((player) => ({
        id: String(player?.id || crypto.randomUUID()),
        name: normalizePregamePlayerName(player?.name || ""),
        display: normalizePregamePlayerName(player?.display || ""),
        personId: normalizePersonId(player?.personId),
        cap: player?.cap === "" ? "" : (Number.isFinite(Number(player?.cap)) ? Number(player.cap) : 48),
      }))
      .filter((player) => player.name && player.display)
  );
}

export function getTeamBoxScorePlayers(game, teamScope) {
  if (!game || !teamScope) return [];
  const homeMatches = teamScope === TRACKED_TEAM.scopeKey && isTrackedTeam(game.homeTeam);
  const awayMatches = teamScope === TRACKED_TEAM.scopeKey && isTrackedTeam(game.awayTeam);
  if (homeMatches) return Array.isArray(game?.boxScore?.home?.players) ? game.boxScore.home.players : [];
  if (awayMatches) return Array.isArray(game?.boxScore?.away?.players) ? game.boxScore.away.players : [];
  return [];
}

function buildApiPlayerNameCandidates(player) {
  const candidates = [
    player?.fullName,
    player?.name,
    [player?.firstName, player?.familyName].filter(Boolean).join(" "),
  ];
  return candidates
    .map(normalizeMatchName)
    .filter(Boolean);
}

export function linkPregamePlayersToApiPlayers(players, apiPlayers) {
  if (!Array.isArray(players) || !players.length || !Array.isArray(apiPlayers) || !apiPlayers.length) {
    return players;
  }

  const apiByName = new Map();
  apiPlayers.forEach((player) => {
    const personId = normalizePersonId(player?.personId);
    if (!personId) return;
    buildApiPlayerNameCandidates(player).forEach((candidate) => {
      if (!candidate) return;
      const existing = apiByName.get(candidate);
      if (!existing) {
        apiByName.set(candidate, { personId, ambiguous: false });
        return;
      }
      if (existing.personId !== personId) {
        apiByName.set(candidate, { personId: "", ambiguous: true });
      }
    });
  });

  let changed = false;
  const nextPlayers = players.map((player) => {
    const currentPersonId = normalizePersonId(player?.personId);
    if (currentPersonId) return player;

    const playerCandidates = [
      normalizeMatchName(player?.name),
      normalizeMatchName(player?.display),
    ].filter(Boolean);

    for (const candidate of playerCandidates) {
      const match = apiByName.get(candidate);
      if (!match || match.ambiguous || !match.personId) continue;
      changed = true;
      return { ...player, personId: match.personId };
    }

    return player;
  });

  return changed ? nextPlayers : players;
}

function parseRemotePayload(note, key) {
  const parsed = safeParseJson(note || "{}", null);
  if (!parsed) return { updatedAt: 0, value: null };
  if (Array.isArray(parsed)) return { updatedAt: 0, value: parsed };
  if (typeof parsed !== "object") return { updatedAt: 0, value: null };
  const updatedAt = Number(parsed.updatedAt || 0);
  if (parsed[key] != null) return { updatedAt, value: parsed[key] };
  if (parsed.value != null) return { updatedAt, value: parsed.value };
  return { updatedAt, value: parsed };
}

function playersStorageKey(teamScope) {
  return `${PLAYERS_STORAGE_KEY_PREFIX}${teamScope}`;
}

export function loadPregamePlayersPayload(teamScope) {
  if (typeof window === "undefined" || !teamScope) return null;
  const scopedRaw = readLocalStorage(playersStorageKey(teamScope));
  const raw = scopedRaw || (teamScope === TRACKED_TEAM.scopeKey ? readLocalStorage(LEGACY_PLAYERS_STORAGE_KEY) : null);
  if (!raw) return null;
  const parsed = safeParseJson(raw, null);
  if (Array.isArray(parsed)) {
    return { updatedAt: 0, players: normalizePregamePlayers(parsed) };
  }
  if (!parsed || typeof parsed !== "object") return null;
  return {
    updatedAt: Number(parsed.updatedAt || 0),
    players: normalizePregamePlayers(parsed.players),
  };
}

export function resolveSharedPregamePlayersPayload(localPayload, remotePayload) {
  const localUpdatedAt = Number(localPayload?.updatedAt || 0);
  const localPlayers = normalizePregamePlayers(localPayload?.players || []);
  const remoteUpdatedAt = Number(remotePayload?.updatedAt || 0);
  const remotePlayers = normalizePregamePlayers(remotePayload?.players || []);
  if (remoteUpdatedAt > 0 || remotePlayers.length) {
    return {
      updatedAt: remoteUpdatedAt,
      players: remotePlayers,
      source: "remote",
    };
  }

  return {
    updatedAt: localUpdatedAt,
    players: localPlayers,
    source: "local",
  };
}

export function persistPregamePlayers(teamScope, players, updatedAt = Date.now()) {
  if (typeof window === "undefined" || !teamScope) return;
  writeLocalStorage(playersStorageKey(teamScope), JSON.stringify({
    updatedAt,
    players: sortPregamePlayersByLastName(players),
  }));
}

export async function fetchRemotePregamePlayers(teamScope) {
  if (!supabase || !teamScope) return null;
  const { data, error } = await supabase
    .from(SHARED_ROSTER_TABLE)
    .select("payload,updated_at")
    .eq("scope_type", SHARED_ROSTER_SCOPE_TYPE)
    .eq("scope_key", teamScope)
    .maybeSingle();
  if (error) return null;
  const payload = {
    updatedAt: data?.updated_at ? new Date(data.updated_at).getTime() : 0,
    players: normalizePregamePlayers(data?.payload?.players || []),
  };
  return {
    updatedAt: payload.updatedAt,
    players: payload.players,
  };
}

export async function saveRemotePregamePlayers(teamScope, players, updatedAt = Date.now()) {
  if (!supabase || !teamScope) return;
  const { error } = await supabase.from(SHARED_ROSTER_TABLE).upsert(
    {
      scope_type: SHARED_ROSTER_SCOPE_TYPE,
      scope_key: teamScope,
      payload: {
        updatedAt,
        players: sortPregamePlayersByLastName(players),
      },
    },
    { onConflict: "scope_type,scope_key" }
  );
  if (error) throw error;
}
