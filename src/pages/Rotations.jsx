import { Link, useParams, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchGame } from "../api.js";
import {
  fetchRemotePregamePlayers,
  getTeamBoxScorePlayers,
  linkPregamePlayersToApiPlayers,
  loadPregamePlayersPayload,
  normalizePregamePlayers,
  persistPregamePlayers,
  resolveSharedPregamePlayersPayload,
  saveRemotePregamePlayers,
} from "../pregamePlayers.js";
import { readLocalStorage, writeLocalStorage } from "../storage.js";
import { supabase } from "../supabaseClient.js";
import styles from "./Rotations.module.css";

const GAME_STORAGE_PREFIX = "rotations:game:v1:";
const SECTION_STATE_STORAGE_PREFIX = "rotations:sections:v1:";
const ROTATIONS_TABLE = "rotations_shared_state";
const ROTATIONS_SCOPE_PLAYERS = "players";
const ROTATIONS_SCOPE_DEPTH_TEMPLATE = "depth_template";
const ROTATIONS_SCOPE_GAME = "game";
const ROTATIONS_SCOPE_SAVED_LINEUPS = "saved_lineups";
const FINAL_VERSION_ID = "final";
const QUARTERS = [1, 2, 3, 4];
const MINUTES = Array.from({ length: 10 }, (_, index) => 10 - index);
const POSITION_COLUMNS = [1, 2, 3, 4, 5];
const TOTAL_PER_QUARTER = MINUTES.length * POSITION_COLUMNS.length;
const MAX_LINEUP_HISTORY = 100;
const LONG_PRESS_DURATION_MS = 700;
const TOUCH_FILL_MOVE_TOLERANCE_PX = 16;
const DEPTH_OUT_PRESS_DURATION_MS = 1000;
const DEPTH_PRESS_RELEASE_LOCK_MS = 120;
const DEFAULT_VERSION_OPTIONS = {
  hideNamesOnDuplicateRows: false,
};
const DEPTH_OUT_PREFIX = "__OUT__:";

const TEAM_ROTATIONS_CONFIG = {
  mystics: {
    key: "mystics",
    label: "MYSTICS",
    matches(team) {
      const tricode = String(team?.teamTricode || "").toUpperCase();
      const name = `${team?.teamCity || ""} ${team?.teamName || ""}`.toLowerCase();
      return (tricode === "WAS" && name.includes("mystics")) || (name.includes("washington") && name.includes("mystics"));
    },
    defaultPlayers: Array.from({ length: 17 }, (_, index) => ({
      id: `p${index + 1}`,
      name: "",
      cap: 48,
    })),
    defaultDepthRows: Array.from({ length: 4 }, () => POSITION_COLUMNS.map(() => "")),
  },
};

const DEPTH_ROW_INDICES = TEAM_ROTATIONS_CONFIG.mystics.defaultDepthRows.map((_, index) => index);

function getRotationsTeamConfig(team) {
  return Object.values(TEAM_ROTATIONS_CONFIG).find((config) => config.matches(team)) || null;
}

function getRotationsScopeForGame(game) {
  return getRotationsTeamConfig(game?.homeTeam) || getRotationsTeamConfig(game?.awayTeam);
}

function playersStorageKey(teamScope) {
  return `rotations:${teamScope}:players:v1`;
}

function depthTemplateStorageKey(teamScope) {
  return `rotations:${teamScope}:depth-template:v1`;
}

function savedLineupsStorageKey(teamScope) {
  return `rotations:${teamScope}:saved-lineups:v1`;
}

function globalScopeKey(teamScope) {
  return `${teamScope}:global`;
}

const createDefaultQuarterLineups = () => ({
  1: MINUTES.map(() => Array.from({ length: POSITION_COLUMNS.length }, () => "")),
  2: MINUTES.map(() => Array.from({ length: POSITION_COLUMNS.length }, () => "")),
  3: MINUTES.map(() => Array.from({ length: POSITION_COLUMNS.length }, () => "")),
  4: MINUTES.map(() => Array.from({ length: POSITION_COLUMNS.length }, () => "")),
});

const createDefaultPlayers = (teamScope = "mystics") => (
  (TEAM_ROTATIONS_CONFIG[teamScope]?.defaultPlayers || TEAM_ROTATIONS_CONFIG.mystics.defaultPlayers)
    .map((player) => ({ ...player }))
);

const createDefaultDepthChart = (teamScope = "mystics") => (
  (TEAM_ROTATIONS_CONFIG[teamScope]?.defaultDepthRows || TEAM_ROTATIONS_CONFIG.mystics.defaultDepthRows)
    .map((row) => row.slice())
);

function createVersionState({
  id,
  name,
  depthChart = createDefaultDepthChart(),
  lineups = createDefaultQuarterLineups(),
  inheritDepthTemplate = false,
  options = DEFAULT_VERSION_OPTIONS,
  teamScope = "mystics",
}) {
  return {
    id: String(id || (typeof crypto !== "undefined" ? crypto.randomUUID() : `version-${Date.now()}`)),
    name: String(name || "Version").trim() || "Version",
    depthChart: normalizeDepthChart(depthChart, teamScope),
    lineups: normalizeLineups(lineups),
    inheritDepthTemplate: Boolean(inheritDepthTemplate),
    options: normalizeVersionOptions(options),
  };
}

const createDefaultGameState = (teamScope = "mystics") => ({
  activeVersionId: FINAL_VERSION_ID,
  versions: [
    createVersionState({
      id: FINAL_VERSION_ID,
      name: "Final",
      depthChart: createDefaultDepthChart(teamScope),
      lineups: createDefaultQuarterLineups(),
      inheritDepthTemplate: true,
      teamScope,
    }),
  ],
});

function safeParseJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function parseDepthChartCell(value) {
  const raw = String(value || "").trim();
  if (!raw) return { raw: "", name: "", isOut: false };
  if (raw.startsWith(DEPTH_OUT_PREFIX)) {
    const name = normalizeName(raw.slice(DEPTH_OUT_PREFIX.length));
    return {
      raw: name ? `${DEPTH_OUT_PREFIX}${name}` : "",
      name,
      isOut: Boolean(name),
    };
  }
  const name = normalizeName(raw);
  return { raw: name, name, isOut: false };
}

function normalizeDepthChartCell(value) {
  const parsed = parseDepthChartCell(value);
  return parsed.raw;
}

function markDepthChartCellOut(value) {
  const parsed = parseDepthChartCell(value);
  if (!parsed.name) return "";
  return `${DEPTH_OUT_PREFIX}${parsed.name}`;
}

function markDepthChartCellActive(value) {
  return parseDepthChartCell(value).name;
}

function getDepthChartCellDisplay(value) {
  return parseDepthChartCell(value).name;
}

function isDepthChartCellOut(value) {
  return parseDepthChartCell(value).isOut;
}

function getDepthChartLineupValue(value) {
  const parsed = parseDepthChartCell(value);
  return parsed.isOut ? "" : parsed.name;
}

function normalizePlayerNameInput(value) {
  return String(value || "").toUpperCase();
}

function normalizePlayers(rawPlayers, teamScope = "mystics") {
  const normalized = (Array.isArray(rawPlayers) ? rawPlayers : []).slice(0, 17).map((player, index) => ({
    id: String(player?.id || `p${index + 1}`),
    name: normalizePlayerNameInput(player?.name),
    display: normalizePlayerNameInput(player?.display || player?.name),
    personId: String(player?.personId || "").trim(),
    cap: player?.cap === "" ? "" : (Number.isFinite(Number(player?.cap)) ? Number(player.cap) : 48),
  }));
  while (normalized.length < 17) {
    normalized.push({ id: `p${normalized.length + 1}`, name: "", display: "", personId: "", cap: 48 });
  }
  const defaults = createDefaultPlayers(teamScope);
  return normalized.map((player, index) => ({
    ...defaults[index],
    ...player,
  }));
}

function buildPlayerNameDrafts(players) {
  return Object.fromEntries((players || []).map((player) => [player.id, String(player?.name || "")]));
}

function normalizeDepthChart(rawDepth, teamScope = "mystics") {
  const fallback = createDefaultDepthChart(teamScope);
  if (!Array.isArray(rawDepth)) return fallback;
  return DEPTH_ROW_INDICES.map((rowIndex) => {
    const row = Array.isArray(rawDepth[rowIndex]) ? rawDepth[rowIndex] : [];
    return POSITION_COLUMNS.map((_, columnIndex) => normalizeDepthChartCell(row[columnIndex] || ""));
  });
}

function normalizeLineups(rawLineups) {
  const fallback = createDefaultQuarterLineups();
  const result = {};
  QUARTERS.forEach((quarter) => {
    const rows = Array.isArray(rawLineups?.[quarter]) ? rawLineups[quarter] : fallback[quarter];
    result[quarter] = MINUTES.map((_, minuteIndex) => {
      const row = Array.isArray(rows?.[minuteIndex]) ? rows[minuteIndex] : [];
      return POSITION_COLUMNS.map((_, columnIndex) => normalizeName(row[columnIndex] || ""));
    });
  });
  return result;
}

function normalizeSavedLineups(rawLineups) {
  return (Array.isArray(rawLineups) ? rawLineups : []).map((lineup, index) => ({
    id: String(lineup?.id || `saved-lineup-${index + 1}`),
    name: String(lineup?.name || "").trim(),
    players: POSITION_COLUMNS.map((_, playerIndex) => normalizeName(lineup?.players?.[playerIndex] || "")),
  })).filter((lineup) => lineup.name);
}

function normalizeVersionOptions(rawOptions) {
  return {
    hideNamesOnDuplicateRows: Boolean(rawOptions?.hideNamesOnDuplicateRows),
  };
}

function hasAnyFilledLineups(lineups) {
  return QUARTERS.some((quarter) => (
    (lineups?.[quarter] || []).some((row) => row.some((value) => normalizeName(value)))
  ));
}

function normalizeGameState(rawState, teamScope = "mystics") {
  if (!rawState || typeof rawState !== "object") return createDefaultGameState(teamScope);

  if (Array.isArray(rawState.versions)) {
    const normalizedVersions = rawState.versions.map((version, index) => createVersionState({
      id: version?.id || `version-${index + 1}`,
      name: version?.name || `Version ${index + 1}`,
      depthChart: version?.depthChart,
      lineups: version?.lineups,
      inheritDepthTemplate:
        typeof version?.inheritDepthTemplate === "boolean"
          ? version.inheritDepthTemplate
          : version?.id === FINAL_VERSION_ID,
      options: version?.options,
      teamScope,
    }));

    const finalVersion = normalizedVersions.find((version) => version.id === FINAL_VERSION_ID)
      || createVersionState({
        id: FINAL_VERSION_ID,
        name: "Final",
        depthChart: rawState.depthChart,
        lineups: rawState.lineups,
        inheritDepthTemplate: rawState.inheritDepthTemplate ?? true,
        options: rawState.options,
        teamScope,
      });

    const otherVersions = normalizedVersions.filter((version) => version.id !== FINAL_VERSION_ID);
    const versions = [finalVersion, ...otherVersions];
    const activeVersionId = versions.some((version) => version.id === rawState.activeVersionId)
      ? rawState.activeVersionId
      : FINAL_VERSION_ID;

    return { activeVersionId, versions };
  }

  // Backward compatibility with older payload that included players.
  const depthSource = Array.isArray(rawState.depthChart)
    ? rawState.depthChart
    : (rawState.depthChart?.[1] || rawState.depthChart);

  return {
    activeVersionId: FINAL_VERSION_ID,
    versions: [
      createVersionState({
        id: FINAL_VERSION_ID,
        name: "Final",
        depthChart: normalizeDepthChart(depthSource, teamScope),
        lineups: normalizeLineups(rawState.lineups),
        inheritDepthTemplate:
          typeof rawState.inheritDepthTemplate === "boolean"
            ? rawState.inheritDepthTemplate
            : !hasAnyFilledLineups(rawState.lineups),
        options: rawState.options,
        teamScope,
      }),
    ],
  };
}

function getVersionById(gameState, versionId, teamScope = "mystics") {
  return gameState?.versions?.find((version) => version.id === versionId)
    || gameState?.versions?.[0]
    || createDefaultGameState(teamScope).versions[0];
}

function loadLegacyPlayersPayload(teamScope) {
  if (typeof window === "undefined" || !teamScope) return null;
  const raw = readLocalStorage(playersStorageKey(teamScope));
  if (!raw) return null;
  const parsed = safeParseJson(raw, null);
  if (Array.isArray(parsed)) {
    return { updatedAt: 0, players: normalizePlayers(parsed, teamScope) };
  }
  if (!parsed || typeof parsed !== "object") return null;
  return {
    updatedAt: Number(parsed.updatedAt || 0),
    players: normalizePlayers(parsed.players, teamScope),
  };
}

function loadDepthTemplatePayload(teamScope) {
  if (typeof window === "undefined" || !teamScope) return null;
  const raw = readLocalStorage(depthTemplateStorageKey(teamScope));
  if (!raw) return null;
  const parsed = safeParseJson(raw, null);
  if (!parsed || typeof parsed !== "object") return null;
  if (Array.isArray(parsed)) {
    return { updatedAt: 0, depthChart: normalizeDepthChart(parsed, teamScope), sourceGameId: "" };
  }
  return {
    updatedAt: Number(parsed.updatedAt || 0),
    depthChart: normalizeDepthChart(parsed.depthChart, teamScope),
    sourceGameId: String(parsed.sourceGameId || ""),
  };
}

function persistDepthTemplate(teamScope, depthChart, updatedAt = Date.now(), sourceGameId = "") {
  if (typeof window === "undefined" || !teamScope) return;
  writeLocalStorage(depthTemplateStorageKey(teamScope), JSON.stringify({
    updatedAt,
    depthChart: normalizeDepthChart(depthChart, teamScope),
    sourceGameId: String(sourceGameId || ""),
  }));
}

function loadSavedLineupsPayload(teamScope) {
  if (typeof window === "undefined" || !teamScope) return null;
  const raw = readLocalStorage(savedLineupsStorageKey(teamScope));
  if (!raw) return null;
  const parsed = safeParseJson(raw, null);
  if (Array.isArray(parsed)) {
    return { updatedAt: 0, lineups: normalizeSavedLineups(parsed) };
  }
  if (!parsed || typeof parsed !== "object") return null;
  return {
    updatedAt: Number(parsed.updatedAt || 0),
    lineups: normalizeSavedLineups(parsed.lineups),
  };
}

function persistSavedLineups(teamScope, lineups, updatedAt = Date.now()) {
  if (typeof window === "undefined" || !teamScope) return;
  writeLocalStorage(savedLineupsStorageKey(teamScope), JSON.stringify({
    updatedAt,
    lineups: normalizeSavedLineups(lineups),
  }));
}

function gameStorageKey(gameId) {
  return `${GAME_STORAGE_PREFIX}${gameId}`;
}

function sectionStateStorageKey(gameId) {
  return `${SECTION_STATE_STORAGE_PREFIX}${gameId}`;
}

function loadGamePayload(gameId) {
  if (typeof window === "undefined" || !gameId) return null;
  const raw = readLocalStorage(gameStorageKey(gameId));
  if (!raw) return null;
  const parsed = safeParseJson(raw, null);
  if (!parsed || typeof parsed !== "object") return null;
  return {
    updatedAt: Number(parsed.updatedAt || 0),
    state: parsed.state || parsed,
  };
}

function persistGameState(gameId, state, updatedAt = Date.now()) {
  if (typeof window === "undefined" || !gameId) return;
  writeLocalStorage(gameStorageKey(gameId), JSON.stringify({
    updatedAt,
    state,
  }));
}

function parseSharedStateRow(row) {
  const updatedAt = row?.updated_at ? new Date(row.updated_at).getTime() : 0;
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : null;
  return { updatedAt, payload };
}

function playersStateKey(players) {
  return JSON.stringify(
    (players || []).map((player) => ({
      id: String(player?.id || ""),
      name: String(player?.name || ""),
      display: String(player?.display || ""),
      personId: String(player?.personId || ""),
      cap: player?.cap === "" ? "" : Number(player?.cap || 0),
    }))
  );
}

function mergePlayersWithPregameRoster(currentPlayers, rosterPlayers, teamScope = "mystics") {
  const normalizedCurrent = normalizePlayers(currentPlayers, teamScope);
  const normalizedRoster = normalizePregamePlayers(rosterPlayers).map((player) => ({
    id: String(player.id || ""),
    name: normalizePlayerNameInput(player.name),
    display: normalizePlayerNameInput(player.display || player.name),
    personId: String(player.personId || "").trim(),
    cap: player?.cap === "" ? "" : (Number.isFinite(Number(player?.cap)) ? Number(player.cap) : 48),
  }));

  if (!normalizedRoster.length) return normalizedCurrent;

  const currentById = new Map(normalizedCurrent.map((player) => [String(player.id || ""), player]));
  const currentByDisplay = new Map(
    normalizedCurrent
      .map((player) => [normalizePlayerNameInput(player.display || player.name), player])
      .filter(([display]) => display)
  );

  const merged = normalizedRoster.slice(0, 17).map((player, index) => {
    const existing = currentById.get(player.id) || currentByDisplay.get(player.display) || normalizedCurrent[index];
    return {
      id: player.id || existing?.id || `p${index + 1}`,
      name: player.name,
      display: player.display,
      personId: String(player.personId || existing?.personId || "").trim(),
      cap: player.cap === "" ? "" : (Number.isFinite(Number(player.cap)) ? Number(player.cap) : (
        existing?.cap === "" ? "" : (Number.isFinite(Number(existing?.cap)) ? Number(existing.cap) : 48)
      )),
    };
  });

  return normalizePlayers(merged, teamScope);
}

function depthChartStateKey(depthChart) {
  return JSON.stringify(depthChart || []);
}

function savedLineupsStateKey(lineups) {
  return JSON.stringify(normalizeSavedLineups(lineups || []));
}

function gameStateKey(state) {
  return JSON.stringify(state || {});
}

async function fetchLegacyRemotePlayers(teamScope) {
  if (!supabase || !teamScope) return null;
  const { data, error } = await supabase
    .from(ROTATIONS_TABLE)
    .select("payload,updated_at")
    .eq("scope_type", ROTATIONS_SCOPE_PLAYERS)
    .eq("scope_key", globalScopeKey(teamScope))
    .maybeSingle();
  if (error) return null;
  if (!data?.payload) return null;
  const parsed = parseSharedStateRow(data);
  return {
    updatedAt: parsed.updatedAt,
    players: normalizePlayers(parsed.payload?.players, teamScope),
  };
}

async function fetchRemoteSavedLineups(teamScope) {
  if (!supabase || !teamScope) return null;
  const { data, error } = await supabase
    .from(ROTATIONS_TABLE)
    .select("payload,updated_at")
    .eq("scope_type", ROTATIONS_SCOPE_SAVED_LINEUPS)
    .eq("scope_key", globalScopeKey(teamScope))
    .maybeSingle();
  if (error) return null;
  if (!data?.payload) return null;
  const parsed = parseSharedStateRow(data);
  return {
    updatedAt: parsed.updatedAt,
    lineups: normalizeSavedLineups(parsed.payload?.lineups),
  };
}

async function saveRemoteSavedLineups(teamScope, lineups, updatedAt = Date.now()) {
  if (!supabase || !teamScope) return;
  const { error } = await supabase.from(ROTATIONS_TABLE).upsert(
    {
      scope_type: ROTATIONS_SCOPE_SAVED_LINEUPS,
      scope_key: globalScopeKey(teamScope),
      payload: {
        lineups: normalizeSavedLineups(lineups),
      },
    },
    { onConflict: "scope_type,scope_key" }
  );
  if (error) throw error;
}

async function fetchRemoteGameState(gameId, teamScope) {
  if (!supabase || !gameId || !teamScope) return null;
  const { data, error } = await supabase
    .from(ROTATIONS_TABLE)
    .select("payload,updated_at")
    .eq("scope_type", ROTATIONS_SCOPE_GAME)
    .eq("scope_key", String(gameId))
    .maybeSingle();
  if (error) return null;
  if (!data?.payload) return null;
  const parsed = parseSharedStateRow(data);
  return {
    updatedAt: Number(parsed.payload?.updatedAt || parsed.updatedAt || 0),
    state: normalizeGameState(parsed.payload, teamScope),
  };
}

async function saveRemoteGameState(gameId, state, updatedAt = Date.now()) {
  if (!supabase || !gameId) return;
  const { error } = await supabase.from(ROTATIONS_TABLE).upsert(
    {
      scope_type: ROTATIONS_SCOPE_GAME,
      scope_key: String(gameId),
      payload: {
        ...state,
        updatedAt,
      },
    },
    { onConflict: "scope_type,scope_key" }
  );
  if (error) throw error;
}

async function fetchRemoteDepthTemplate(teamScope) {
  if (!supabase || !teamScope) return null;
  const { data, error } = await supabase
    .from(ROTATIONS_TABLE)
    .select("payload,updated_at")
    .eq("scope_type", ROTATIONS_SCOPE_DEPTH_TEMPLATE)
    .eq("scope_key", globalScopeKey(teamScope))
    .maybeSingle();
  if (error) return null;
  if (!data?.payload) return null;
  const parsed = parseSharedStateRow(data);
  return {
    updatedAt: parsed.updatedAt,
    depthChart: normalizeDepthChart(parsed.payload?.depthChart, teamScope),
    sourceGameId: String(parsed.payload?.sourceGameId || ""),
  };
}

async function saveRemoteDepthTemplate(teamScope, depthChart, updatedAt = Date.now(), sourceGameId = "") {
  if (!supabase || !teamScope) return;
  const { error } = await supabase.from(ROTATIONS_TABLE).upsert(
    {
      scope_type: ROTATIONS_SCOPE_DEPTH_TEMPLATE,
      scope_key: globalScopeKey(teamScope),
      payload: {
        depthChart: normalizeDepthChart(depthChart, teamScope),
        sourceGameId: String(sourceGameId || ""),
      },
    },
    { onConflict: "scope_type,scope_key" }
  );
  if (error) throw error;
}

function buildOpponentLine(game, monitoredTeam) {
  const away = game?.awayTeam;
  const home = game?.homeTeam;
  const monitoredAway = monitoredTeam?.matches(away);
  const opponent = monitoredAway ? home : away;
  const city = String(opponent?.teamCity || "Opponent").trim().toUpperCase();
  return monitoredAway ? `@ ${city}` : `VS ${city}`;
}

function quarterLabel(quarter) {
  if (quarter === 1) return "1st";
  if (quarter === 2) return "2nd";
  if (quarter === 3) return "3rd";
  return "4th";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderExportDepthChart(depthChart) {
  return `
    <section class="export-section">
      <div class="export-section-title">Depth Chart</div>
      <table class="export-table">
        <colgroup>
          ${POSITION_COLUMNS.map(() => "<col />").join("")}
        </colgroup>
        <thead>
          <tr>${POSITION_COLUMNS.map((position) => `<th>${position}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${DEPTH_ROW_INDICES.map((rowIndex) => `
            <tr>
              ${POSITION_COLUMNS.map((_, columnIndex) => {
                const cell = parseDepthChartCell(depthChart?.[rowIndex]?.[columnIndex] || "");
                return `<td class="export-player-cell ${cell.isOut ? "export-player-out" : ""}">${escapeHtml(cell.name)}</td>`;
              }).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function getExportRowValues(lineups, quarter, minuteIndex) {
  return lineups?.[quarter]?.[minuteIndex] || [];
}

function getExportPreviousRowValues(lineups, quarter, minuteIndex) {
  if (minuteIndex > 0) return getExportRowValues(lineups, quarter, minuteIndex - 1);
  if (quarter > 1) return getExportRowValues(lineups, quarter - 1, MINUTES.length - 1);
  return null;
}

function getExportNextRowValues(lineups, quarter, minuteIndex) {
  if (minuteIndex < MINUTES.length - 1) return getExportRowValues(lineups, quarter, minuteIndex + 1);
  if (quarter < 4) return getExportRowValues(lineups, quarter + 1, 0);
  return null;
}

function rowHasSubIn(rowValues, previousRowValues) {
  return rowValues.some((value) => {
    const normalizedValue = normalizeName(value);
    return Boolean(
      normalizedValue
      && previousRowValues
      && !previousRowValues.some((entry) => normalizeName(entry) === normalizedValue)
    );
  });
}

function shouldHideRowNames(hideNamesOnDuplicateRows, minuteIndex, previousRowValues, rowValues) {
  return Boolean(
    hideNamesOnDuplicateRows
    && minuteIndex > 0
    && !rowHasSubIn(rowValues, previousRowValues)
  );
}

function getQuarterCellState({ rowValues, previousRowValues, nextRowValues, positionIndex, hideNamesOnDuplicateRows, minuteIndex }) {
  const value = rowValues[positionIndex] || "";
  const normalizedValue = normalizeName(value);
  const nonBlank = rowValues.filter((entry) => normalizeName(entry));
  const hasDuplicate = new Set(nonBlank).size !== nonBlank.length;
  const isSubIn = Boolean(
    normalizedValue
      && previousRowValues
      && !previousRowValues.some((entry) => normalizeName(entry) === normalizedValue)
  );
  const isSubOut = Boolean(
    normalizedValue
      && nextRowValues
      && !nextRowValues.some((entry) => normalizeName(entry) === normalizedValue)
  );
  const hideRowNames = shouldHideRowNames(hideNamesOnDuplicateRows, minuteIndex, previousRowValues, rowValues);

  return {
    value,
    normalizedValue,
    hasDuplicate,
    isSubIn,
    isSubOut,
    hideRowNames,
  };
}

function getExportQuarterCellClass(lineups, quarter, minuteIndex, positionIndex, hideNamesOnDuplicateRows) {
  const rowValues = getExportRowValues(lineups, quarter, minuteIndex);
  const previousRowValues = getExportPreviousRowValues(lineups, quarter, minuteIndex);
  const nextRowValues = getExportNextRowValues(lineups, quarter, minuteIndex);
  const cellState = getQuarterCellState({
    rowValues,
    previousRowValues,
    nextRowValues,
    positionIndex,
    hideNamesOnDuplicateRows,
    minuteIndex,
  });

  if (!cellState.normalizedValue) return "";
  if (cellState.hideRowNames) return cellState.isSubIn ? "export-sub-in" : "";
  if (cellState.isSubOut) return "export-sub-out";
  if (cellState.isSubIn) return "export-sub-in";
  if (cellState.hasDuplicate) return "export-duplicate";
  return "";
}

function renderExportQuarterTable(quarter, lineups, hideNamesOnDuplicateRows = false) {
  return `
    <section class="export-section">
      <div class="export-section-title">${quarterLabel(quarter)} Quarter</div>
      <table class="export-table">
        <colgroup>
          <col class="export-quarter-time-col" />
          ${POSITION_COLUMNS.map(() => '<col class="export-quarter-player-col" />').join("")}
        </colgroup>
        <thead>
          <tr>
            <th></th>
            ${POSITION_COLUMNS.map((position) => `<th>${position}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${MINUTES.map((minute, minuteIndex) => `
            <tr>
              <td>${minute}</td>
              ${POSITION_COLUMNS.map((_, columnIndex) => `
                <td class="export-player-cell ${getExportQuarterCellClass(lineups, quarter, minuteIndex, columnIndex, hideNamesOnDuplicateRows)}">
                  ${escapeHtml(
    shouldHideRowNames(
      hideNamesOnDuplicateRows,
      minuteIndex,
      getExportPreviousRowValues(lineups, quarter, minuteIndex),
      getExportRowValues(lineups, quarter, minuteIndex)
    )
      ? ""
      : (lineups?.[quarter]?.[minuteIndex]?.[columnIndex] || "")
  )}
                </td>
              `).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function hexToRgbColor(rgbBuilder, hex) {
  const normalized = String(hex || "").replace("#", "");
  const expanded = normalized.length === 3
    ? normalized.split("").map((char) => `${char}${char}`).join("")
    : normalized;
  const safeHex = expanded.padEnd(6, "0").slice(0, 6);
  const value = Number.parseInt(safeHex, 16);
  const red = ((value >> 16) & 255) / 255;
  const green = ((value >> 8) & 255) / 255;
  const blue = (value & 255) / 255;
  return rgbBuilder(red, green, blue);
}

function buildPdfColors(rgbBuilder) {
  return {
    black: hexToRgbColor(rgbBuilder, "#000000"),
    red: hexToRgbColor(rgbBuilder, "#c8102e"),
    white: hexToRgbColor(rgbBuilder, "#ffffff"),
    border: hexToRgbColor(rgbBuilder, "#8c8c8c"),
    headerFill: hexToRgbColor(rgbBuilder, "#efefef"),
    bodyText: hexToRgbColor(rgbBuilder, "#111111"),
    duplicateFill: hexToRgbColor(rgbBuilder, "#fff2cc"),
    subInFill: hexToRgbColor(rgbBuilder, "#d9ead3"),
    subOutFill: hexToRgbColor(rgbBuilder, "#f4cccc"),
  };
}

const PDF_QUARTER_TIME_COL_WIDTH = 24;
const PDF_BASE_DEPTH_NAME_FONT_SIZE = 8.5;
const PDF_BASE_QUARTER_NAME_FONT_SIZE = 8.2;
const PDF_MIN_PLAYER_NAME_FONT_SIZE = 5.6;
const PDF_PLAYER_TEXT_HORIZONTAL_PADDING = 4;

function getExportPlayerNames(depthChart, lineups) {
  const depthNames = Array.isArray(depthChart)
    ? depthChart.flat().map((value) => getDepthChartCellDisplay(value)).filter((value) => normalizeName(value))
    : [];
  const lineupNames = Object.values(lineups || {}).flatMap((quarterRows) => (
    Array.isArray(quarterRows)
      ? quarterRows.flat().filter((value) => normalizeName(value))
      : []
  ));
  return [...depthNames, ...lineupNames];
}

function getFittedPdfPlayerNameFontSize(font, playerNames, cellWidth) {
  const names = playerNames.filter(Boolean);
  if (!names.length) {
    return Math.min(PDF_BASE_DEPTH_NAME_FONT_SIZE, PDF_BASE_QUARTER_NAME_FONT_SIZE);
  }

  const availableWidth = Math.max(1, cellWidth - PDF_PLAYER_TEXT_HORIZONTAL_PADDING);
  const longestNameWidthAtUnitSize = names.reduce((maxWidth, name) => (
    Math.max(maxWidth, font.widthOfTextAtSize(String(name), 1))
  ), 0);

  if (!longestNameWidthAtUnitSize) {
    return Math.min(PDF_BASE_DEPTH_NAME_FONT_SIZE, PDF_BASE_QUARTER_NAME_FONT_SIZE);
  }

  const maxAllowedFontSize = availableWidth / longestNameWidthAtUnitSize;
  const baseFontSize = Math.min(PDF_BASE_DEPTH_NAME_FONT_SIZE, PDF_BASE_QUARTER_NAME_FONT_SIZE);
  return Math.max(PDF_MIN_PLAYER_NAME_FONT_SIZE, Math.min(baseFontSize, maxAllowedFontSize));
}

function drawCenteredPdfText(page, text, font, size, x, y, width, color) {
  const safeText = String(text || "");
  const textWidth = font.widthOfTextAtSize(safeText, size);
  page.drawText(safeText, {
    x: x + Math.max(0, (width - textWidth) / 2),
    y,
    size,
    font,
    color,
  });
}

function drawPdfCell(page, {
  x,
  y,
  width,
  height,
  text = "",
  font,
  fontSize = 10,
  fillColor,
  textColor,
  borderColor,
  strikeThrough = false,
}) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: fillColor,
    borderColor,
    borderWidth: 1,
  });

  if (text) {
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const textX = x + Math.max(0, (width - textWidth) / 2);
    const textY = y + (height - fontSize) / 2 + 1;
    page.drawText(text, {
      x: textX,
      y: textY,
      size: fontSize,
      font,
      color: textColor,
    });

    if (strikeThrough) {
      page.drawLine({
        start: { x: textX, y: textY + (fontSize * 0.45) },
        end: { x: textX + textWidth, y: textY + (fontSize * 0.45) },
        thickness: 1,
        color: textColor,
      });
    }
  }
}

function getExportCellDisplay(lineups, quarter, minuteIndex, positionIndex, hideNamesOnDuplicateRows, pdfColors) {
  const rowValues = getExportRowValues(lineups, quarter, minuteIndex);
  const previousRowValues = getExportPreviousRowValues(lineups, quarter, minuteIndex);
  const nextRowValues = getExportNextRowValues(lineups, quarter, minuteIndex);
  const cellState = getQuarterCellState({
    rowValues,
    previousRowValues,
    nextRowValues,
    positionIndex,
    hideNamesOnDuplicateRows,
    minuteIndex,
  });

  if (!cellState.normalizedValue) {
    return { text: "", fillColor: pdfColors.white };
  }

  if (cellState.hideRowNames) {
    return {
      text: "",
      fillColor: cellState.isSubIn ? pdfColors.subInFill : pdfColors.white,
    };
  }

  if (cellState.isSubOut) {
    return { text: cellState.value, fillColor: pdfColors.subOutFill };
  }
  if (cellState.isSubIn) {
    return { text: cellState.value, fillColor: pdfColors.subInFill };
  }
  if (cellState.hasDuplicate) {
    return { text: cellState.value, fillColor: pdfColors.duplicateFill };
  }
  return { text: cellState.value, fillColor: pdfColors.white };
}

function drawPdfDepthChart(page, font, x, topY, width, depthChart, playerFontSize, pdfColors) {
  const titleHeight = 20;
  const headerHeight = 18;
  const rowHeight = 18;
  const tableWidth = width;
  const colWidth = tableWidth / POSITION_COLUMNS.length;

  page.drawRectangle({
    x,
    y: topY - titleHeight,
    width: tableWidth,
    height: titleHeight,
    color: pdfColors.red,
    borderColor: pdfColors.border,
    borderWidth: 1,
  });
  page.drawText("Depth Chart", {
    x: x + 6,
    y: topY - titleHeight + 5,
    size: 10,
    font,
    color: pdfColors.white,
  });

  const headerY = topY - titleHeight - headerHeight;
  POSITION_COLUMNS.forEach((position, index) => {
    drawPdfCell(page, {
      x: x + (index * colWidth),
      y: headerY,
      width: colWidth,
      height: headerHeight,
      text: String(position),
      font,
      fontSize: 9,
      fillColor: pdfColors.headerFill,
      textColor: pdfColors.bodyText,
      borderColor: pdfColors.border,
    });
  });

  DEPTH_ROW_INDICES.forEach((rowIndex) => {
    const rowY = headerY - ((rowIndex + 1) * rowHeight);
    POSITION_COLUMNS.forEach((_, index) => {
      const cell = parseDepthChartCell(depthChart?.[rowIndex]?.[index] || "");
      drawPdfCell(page, {
        x: x + (index * colWidth),
        y: rowY,
        width: colWidth,
        height: rowHeight,
        text: cell.name,
        font,
        fontSize: playerFontSize,
        fillColor: pdfColors.white,
        textColor: cell.isOut ? pdfColors.red : pdfColors.bodyText,
        borderColor: pdfColors.border,
        strikeThrough: cell.isOut,
      });
    });
  });

  return titleHeight + headerHeight + (rowHeight * DEPTH_ROW_INDICES.length);
}

function drawPdfQuarterTable(page, font, x, topY, width, quarter, lineups, hideNamesOnDuplicateRows, playerFontSize, pdfColors) {
  const titleHeight = 20;
  const headerHeight = 18;
  const rowHeight = 18;
  const timeColWidth = PDF_QUARTER_TIME_COL_WIDTH;
  const playerColWidth = (width - timeColWidth) / POSITION_COLUMNS.length;

  page.drawRectangle({
    x,
    y: topY - titleHeight,
    width,
    height: titleHeight,
    color: pdfColors.red,
    borderColor: pdfColors.border,
    borderWidth: 1,
  });
  page.drawText(`${quarterLabel(quarter)} Quarter`, {
    x: x + 6,
    y: topY - titleHeight + 5,
    size: 10,
    font,
    color: pdfColors.white,
  });

  const headerY = topY - titleHeight - headerHeight;
  drawPdfCell(page, {
    x,
    y: headerY,
    width: timeColWidth,
    height: headerHeight,
    text: "",
    font,
    fontSize: 9,
    fillColor: pdfColors.headerFill,
    textColor: pdfColors.bodyText,
    borderColor: pdfColors.border,
  });
  POSITION_COLUMNS.forEach((position, index) => {
    drawPdfCell(page, {
      x: x + timeColWidth + (index * playerColWidth),
      y: headerY,
      width: playerColWidth,
      height: headerHeight,
      text: String(position),
      font,
      fontSize: 9,
      fillColor: pdfColors.headerFill,
      textColor: pdfColors.bodyText,
      borderColor: pdfColors.border,
    });
  });

  MINUTES.forEach((minute, minuteIndex) => {
    const rowY = headerY - ((minuteIndex + 1) * rowHeight);
    drawPdfCell(page, {
      x,
      y: rowY,
      width: timeColWidth,
      height: rowHeight,
      text: String(minute),
      font,
      fontSize: 8.5,
      fillColor: pdfColors.white,
      textColor: pdfColors.bodyText,
      borderColor: pdfColors.border,
    });

    POSITION_COLUMNS.forEach((_, index) => {
      const display = getExportCellDisplay(lineups, quarter, minuteIndex, index, hideNamesOnDuplicateRows, pdfColors);
      drawPdfCell(page, {
        x: x + timeColWidth + (index * playerColWidth),
        y: rowY,
        width: playerColWidth,
        height: rowHeight,
        text: display.text,
        font,
        fontSize: playerFontSize,
        fillColor: display.fillColor,
        textColor: pdfColors.bodyText,
        borderColor: pdfColors.border,
      });
    });
  });

  return titleHeight + headerHeight + (rowHeight * MINUTES.length);
}

function drawRotationsPdfPage(page, { headerLine, depthChart, lineups, logoImage, font, side, hideNamesOnDuplicateRows, pdfColors }) {
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const columnWidth = 4.05 * 72;
  const columnX = side === "left" ? (0.1 * 72) : (pageWidth - (0.1 * 72) - columnWidth);
  const headerTop = pageHeight - (0.54 * 72);
  const contentTop = pageHeight - (0.92 * 72);
  const logoSize = 0.62 * 72;
  const logoBottom = 0.52 * 72;
  const quarterPlayerColWidth = (columnWidth - PDF_QUARTER_TIME_COL_WIDTH) / POSITION_COLUMNS.length;
  const playerFontSize = getFittedPdfPlayerNameFontSize(
    font,
    getExportPlayerNames(depthChart, lineups),
    quarterPlayerColWidth
  );

  drawCenteredPdfText(page, headerLine, font, 18, columnX, headerTop, columnWidth, pdfColors.bodyText);

  let currentTop = contentTop;
  currentTop -= drawPdfDepthChart(page, font, columnX, currentTop, columnWidth, depthChart, playerFontSize, pdfColors);
  currentTop -= 8;
  currentTop -= drawPdfQuarterTable(
    page,
    font,
    columnX,
    currentTop,
    columnWidth,
    side === "left" ? 1 : 3,
    lineups,
    hideNamesOnDuplicateRows,
    playerFontSize,
    pdfColors
  );
  currentTop -= 8;
  currentTop -= drawPdfQuarterTable(
    page,
    font,
    columnX,
    currentTop,
    columnWidth,
    side === "left" ? 2 : 4,
    lineups,
    hideNamesOnDuplicateRows,
    playerFontSize,
    pdfColors
  );

  if (logoImage) {
    page.drawImage(logoImage, {
      x: columnX + ((columnWidth - logoSize) / 2),
      y: logoBottom,
      width: logoSize,
      height: logoSize,
    });
  }
}

function buildRotationsPdfHtml({
  headerLine,
  depthChart,
  lineups,
  logoUrl,
  fontUrl,
  hideNamesOnDuplicateRows = false,
  playerFontSize = PDF_BASE_QUARTER_NAME_FONT_SIZE,
}) {
  const quarterPlayerColWidthPercent = ((100 - ((PDF_QUARTER_TIME_COL_WIDTH / (4.05 * 72)) * 100)) / POSITION_COLUMNS.length);
  const pageMarkup = (quarters, side) => `
    <section class="pdf-page ${side}">
      <div class="pdf-header">${escapeHtml(headerLine)}</div>
      <div class="pdf-column">
        <div class="pdf-sections">
        ${renderExportDepthChart(depthChart)}
        ${quarters.map((quarter) => renderExportQuarterTable(quarter, lineups, hideNamesOnDuplicateRows)).join("")}
        </div>
        <div class="pdf-logo-wrap">
          <img class="pdf-logo" src="${escapeHtml(logoUrl)}" alt="Washington Mystics" />
        </div>
      </div>
    </section>
  `;

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Rotations PDF Export</title>
        <style>
          @page {
            size: 8.5in 11in;
            margin: 0;
          }

          @font-face {
            font-family: "DIN Export";
            src: url("${escapeHtml(fontUrl)}") format("truetype");
          }

          * {
            box-sizing: border-box;
          }

          html, body {
            margin: 0;
            padding: 0;
            background: #ffffff;
            color: #111111;
            font-family: "DIN Export", "DIN", sans-serif;
          }

          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .pdf-page {
            position: relative;
            width: 8.5in;
            height: 11in;
            page-break-after: always;
            overflow: hidden;
          }

          .pdf-page:last-child {
            page-break-after: auto;
          }

          .pdf-column {
            position: absolute;
            top: 0.72in;
            bottom: 0.3in;
            width: 4.12in;
          }

          .pdf-page.left .pdf-column {
            left: 0.1in;
          }

          .pdf-page.right .pdf-column {
            right: 0.1in;
          }

          .pdf-header {
            position: absolute;
            top: 0.28in;
            width: 4.12in;
            font-size: 24px;
            font-weight: 700;
            text-align: center;
          }

          .pdf-page.left .pdf-header {
            left: 0.1in;
          }

          .pdf-page.right .pdf-header {
            right: 0.1in;
          }

          .pdf-sections {
            padding-bottom: 0.95in;
          }

          .export-section {
            margin-bottom: 0.12in;
          }

          .export-section-title {
            background: #000000;
            color: #ffffff;
            font-size: 16px;
            font-weight: 700;
            text-align: left;
            padding: 6px 8px;
          }

          .export-table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }

          .export-quarter-time-col {
            width: ${(PDF_QUARTER_TIME_COL_WIDTH / (4.05 * 72)) * 100}%;
          }

          .export-quarter-player-col {
            width: ${quarterPlayerColWidthPercent}%;
          }

          .export-table th,
          .export-table td {
            border: 1px solid #8c8c8c;
            text-align: center;
            vertical-align: middle;
            padding: 4px 3px;
            height: 24px;
            font-size: 12px;
          }

          .export-table thead th {
            background: #efefef;
            color: #111111;
            font-weight: 700;
          }

          .export-player-cell {
            font-size: ${playerFontSize}px;
          }

          .export-duplicate {
            background: #fff2cc;
            color: #111111;
          }

          .export-sub-in {
            background: #d9ead3;
            color: #111111;
          }

          .export-sub-out {
            background: #f4cccc;
            color: #111111;
          }

          .export-player-out {
            color: #c8102e;
            font-weight: 700;
            text-decoration: line-through;
          }

          .pdf-logo-wrap {
            position: absolute;
            left: 0;
            right: 0;
            bottom: 0.22in;
            display: flex;
            justify-content: center;
          }

          .pdf-logo {
            width: 0.62in;
            height: 0.62in;
            object-fit: contain;
          }
        </style>
      </head>
      <body>
        ${pageMarkup([1, 2], "left")}
        ${pageMarkup([3, 4], "right")}
      </body>
    </html>
  `;
}

async function embedPdfLogoFromAsset(pdfDoc, assetUrl) {
  if (typeof window === "undefined" || !assetUrl) return null;

  const response = await fetch(assetUrl);
  if (!response.ok) {
    throw new Error(`Logo request failed: ${response.status}`);
  }

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const bytes = await response.arrayBuffer();

  if (contentType.includes("png")) {
    return pdfDoc.embedPng(bytes);
  }
  if (contentType.includes("jpeg") || contentType.includes("jpg")) {
    return pdfDoc.embedJpg(bytes);
  }
  if (!contentType.includes("svg")) {
    throw new Error(`Unsupported logo content type: ${contentType || "unknown"}`);
  }

  const blob = new Blob([bytes], { type: "image/svg+xml" });
  const blobUrl = window.URL.createObjectURL(blob);

  try {
    const image = await new Promise((resolve, reject) => {
      const nextImage = new window.Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("Unable to decode SVG logo."));
      nextImage.src = blobUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width || 200;
    canvas.height = image.naturalHeight || image.height || 200;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to create canvas for logo export.");
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const pngBlob = await new Promise((resolve, reject) => {
      canvas.toBlob((nextBlob) => {
        if (nextBlob) {
          resolve(nextBlob);
          return;
        }
        reject(new Error("Unable to rasterize SVG logo."));
      }, "image/png");
    });

    const pngBytes = await pngBlob.arrayBuffer();
    return pdfDoc.embedPng(pngBytes);
  } finally {
    window.URL.revokeObjectURL(blobUrl);
  }
}

export default function Rotations() {
  const { gameId } = useParams();
  const [params] = useSearchParams();
  const dateParam = params.get("d");
  const backUrl = dateParam ? `/g/${gameId}?d=${dateParam}` : `/g/${gameId}`;

  const [players, setPlayers] = useState(createDefaultPlayers());
  const [playerNameDrafts, setPlayerNameDrafts] = useState(() => buildPlayerNameDrafts(createDefaultPlayers()));
  const [savedLineups, setSavedLineups] = useState([]);
  const [depthTemplate, setDepthTemplate] = useState(createDefaultDepthChart());
  const [gameState, setGameState] = useState(createDefaultGameState());
  const [playersOpen, setPlayersOpen] = useState(false);
  const [editingPlayerId, setEditingPlayerId] = useState(null);
  const [playerDrafts, setPlayerDrafts] = useState({});
  const [newPlayerDraft, setNewPlayerDraft] = useState({ name: "", display: "", personId: "" });
  const [playersHydrated, setPlayersHydrated] = useState(false);
  const [savedLineupsHydrated, setSavedLineupsHydrated] = useState(false);
  const [depthTemplateHydrated, setDepthTemplateHydrated] = useState(false);
  const [gameHydrated, setGameHydrated] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [confirmResetTarget, setConfirmResetTarget] = useState(null);
  const [versionMenuOpen, setVersionMenuOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [createVersionOpen, setCreateVersionOpen] = useState(false);
  const [createVersionName, setCreateVersionName] = useState("");
  const [deleteVersionTarget, setDeleteVersionTarget] = useState(null);
  const [savedLineupMenu, setSavedLineupMenu] = useState(null);
  const [createSavedLineupTarget, setCreateSavedLineupTarget] = useState(null);
  const [savedLineupName, setSavedLineupName] = useState("");
  const [deleteSavedLineupTarget, setDeleteSavedLineupTarget] = useState(null);
  const [depthCellConfirmTarget, setDepthCellConfirmTarget] = useState(null);
  const [isDepthCellPressActive, setIsDepthCellPressActive] = useState(false);
  const [isTouchFillActive, setIsTouchFillActive] = useState(false);
  const [undoDepth, setUndoDepth] = useState(0);
  const [syncError, setSyncError] = useState("");
  const [collapsed, setCollapsed] = useState({
    restrictions: false,
    depth: false,
    q1: false,
    q2: false,
    q3: false,
    q4: false,
  });

  const playersUpdatedAtRef = useRef(0);
  const savedLineupsUpdatedAtRef = useRef(0);
  const editingPlayerNameIdRef = useRef(null);
  const depthTemplateUpdatedAtRef = useRef(0);
  const depthTemplateSourceGameIdRef = useRef("");
  const gameUpdatedAtRef = useRef(0);
  const playersStateKeyRef = useRef(playersStateKey(createDefaultPlayers()));
  const savedLineupsStateKeyRef = useRef(savedLineupsStateKey([]));
  const depthTemplateStateKeyRef = useRef(depthChartStateKey(createDefaultDepthChart()));
  const gameStateKeyRef = useRef(gameStateKey(createDefaultGameState()));
  const skipPlayersSaveRef = useRef(false);
  const skipSavedLineupsSaveRef = useRef(false);
  const skipDepthTemplateSaveRef = useRef(false);
  const skipGameSaveRef = useRef(false);
  const lineupHistoryRef = useRef([]);
  const versionMenuRef = useRef(null);
  const savedLineupMenuRef = useRef(null);
  const savedLineupPressRef = useRef({
    timerId: null,
    pointerId: null,
    pointerType: "",
    startX: 0,
    startY: 0,
    target: null,
  });
  const depthCellPressRef = useRef({
    timerId: null,
    releaseTimerId: null,
    startX: 0,
    startY: 0,
    rowIndex: -1,
    columnIndex: -1,
    value: "",
  });
  const dragFillRef = useRef({
    active: false,
    quarter: null,
    value: "",
    originMinuteIndex: -1,
    originPositionIndex: -1,
    lastMinuteIndex: -1,
    lastPositionIndex: -1,
  });
  const touchFillRef = useRef({
    timerId: null,
    startTouchX: 0,
    startTouchY: 0,
    active: false,
    quarter: null,
    value: "",
    originMinuteIndex: -1,
    originPositionIndex: -1,
    endMinuteIndex: -1,
    endPositionIndex: -1,
  });
  const [touchPreview, setTouchPreview] = useState(null);

  const { data: game, isLoading, error } = useQuery({
    queryKey: ["game-rotations", gameId],
    queryFn: () => fetchGame(gameId),
    enabled: Boolean(gameId),
  });

  const monitoredTeam = useMemo(() => getRotationsScopeForGame(game), [game]);
  const monitoredTeamScope = monitoredTeam?.key || null;
  const rotationsAvailable = Boolean(monitoredTeamScope);
  const trackedApiPlayers = useMemo(
    () => getTeamBoxScorePlayers(game, monitoredTeamScope),
    [game, monitoredTeamScope]
  );

  const { data: legacyRemotePlayers, isFetched: legacyRemotePlayersFetched } = useQuery({
    queryKey: ["rotations-players-legacy-remote", monitoredTeamScope],
    queryFn: () => fetchLegacyRemotePlayers(monitoredTeamScope),
    enabled: Boolean(supabase && monitoredTeamScope),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });

  const { data: remotePregamePlayers, isFetched: remotePregamePlayersFetched } = useQuery({
    queryKey: ["pregame-players-remote", monitoredTeamScope],
    queryFn: () => fetchRemotePregamePlayers(monitoredTeamScope),
    enabled: Boolean(supabase && monitoredTeamScope),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });

  const { data: remoteSavedLineups, isFetched: remoteSavedLineupsFetched } = useQuery({
    queryKey: ["rotations-saved-lineups-remote", monitoredTeamScope],
    queryFn: () => fetchRemoteSavedLineups(monitoredTeamScope),
    enabled: Boolean(supabase && monitoredTeamScope),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });

  const { data: remoteGameState, isFetched: remoteGameFetched } = useQuery({
    queryKey: ["rotations-game-remote", gameId, monitoredTeamScope],
    queryFn: () => fetchRemoteGameState(gameId, monitoredTeamScope),
    enabled: Boolean(supabase && gameId && monitoredTeamScope),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });

  const { data: remoteDepthTemplate, isFetched: remoteDepthFetched } = useQuery({
    queryKey: ["rotations-depth-template-remote", monitoredTeamScope],
    queryFn: () => fetchRemoteDepthTemplate(monitoredTeamScope),
    enabled: Boolean(supabase && monitoredTeamScope),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });

  const activeVersion = useMemo(
    () => getVersionById(gameState, gameState.activeVersionId, monitoredTeamScope || "mystics"),
    [gameState, monitoredTeamScope]
  );
  const activeVersionId = activeVersion.id;
  const depthChart = activeVersion.depthChart;
  const lineups = activeVersion.lineups;
  const inheritDepthTemplate = activeVersion.inheritDepthTemplate;
  const versionDisplayOptions = normalizeVersionOptions(activeVersion.options);

  const shouldInheritFutureTemplate = (state) => {
    const sourceGameId = Number(depthTemplateSourceGameIdRef.current || 0);
    const currentGameNumeric = Number(gameId || 0);
    if (!sourceGameId || !currentGameNumeric || currentGameNumeric <= sourceGameId) return false;
    return Boolean(getVersionById(state, FINAL_VERSION_ID, monitoredTeamScope || "mystics")?.inheritDepthTemplate);
  };

  const applyInheritedTemplate = (state) => {
    if (!shouldInheritFutureTemplate(state)) return state;
    const nextDepthChart = normalizeDepthChart(depthTemplate, monitoredTeamScope || "mystics");
    const currentFinalVersion = getVersionById(state, FINAL_VERSION_ID, monitoredTeamScope || "mystics");
    if (depthChartStateKey(currentFinalVersion.depthChart) === depthChartStateKey(nextDepthChart)) return state;
    return {
      ...state,
      versions: state.versions.map((version) => (
        version.id !== FINAL_VERSION_ID
          ? version
          : { ...version, depthChart: nextDepthChart }
      )),
    };
  };

  useEffect(() => {
    setPlayersHydrated(false);
    setSavedLineupsHydrated(false);
    setDepthTemplateHydrated(false);
    setGameHydrated(false);
    playersUpdatedAtRef.current = 0;
    savedLineupsUpdatedAtRef.current = 0;
    depthTemplateUpdatedAtRef.current = 0;
    depthTemplateSourceGameIdRef.current = "";
    gameUpdatedAtRef.current = 0;
    skipPlayersSaveRef.current = false;
    skipSavedLineupsSaveRef.current = false;
    skipDepthTemplateSaveRef.current = false;
    skipGameSaveRef.current = false;
    lineupHistoryRef.current = [];
    setUndoDepth(0);
    setVersionMenuOpen(false);
    setSavedLineupMenu(null);
    setCreateSavedLineupTarget(null);
    setSavedLineupName("");
    setDeleteSavedLineupTarget(null);
    setDepthCellConfirmTarget(null);
    setPlayersOpen(false);
    setEditingPlayerId(null);
    setPlayerDrafts({});
    setNewPlayerDraft({ name: "", display: "", personId: "" });
    setCreateVersionOpen(false);
    setDeleteVersionTarget(null);
  }, [gameId, monitoredTeamScope]);

  useEffect(() => {
    if (!versionMenuOpen) return undefined;
    const handlePointerDown = (event) => {
      if (versionMenuRef.current?.contains(event.target)) return;
      setVersionMenuOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [versionMenuOpen]);

  useEffect(() => {
    if (!savedLineupMenu) return undefined;
    const handlePointerDown = (event) => {
      if (savedLineupMenuRef.current?.contains(event.target)) return;
      setSavedLineupMenu(null);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [savedLineupMenu]);

  useEffect(() => {
    if (!gameId || typeof window === "undefined") return;
    const raw = readLocalStorage(sectionStateStorageKey(gameId));
    const parsed = safeParseJson(raw, null);
    if (!parsed || typeof parsed !== "object") return;
    setCollapsed((current) => ({
      ...current,
      restrictions: Boolean(parsed.restrictions),
      depth: Boolean(parsed.depth),
      q1: Boolean(parsed.q1),
      q2: Boolean(parsed.q2),
      q3: Boolean(parsed.q3),
      q4: Boolean(parsed.q4),
    }));
  }, [gameId]);

  useEffect(() => {
    if (!gameId || typeof window === "undefined") return;
    writeLocalStorage(sectionStateStorageKey(gameId), JSON.stringify(collapsed));
  }, [collapsed, gameId]);

  useEffect(() => {
    if (playersHydrated) return;
    if (!monitoredTeamScope) return;
    if (supabase && (!remotePregamePlayersFetched || !legacyRemotePlayersFetched)) return;

    const localSharedPayload = loadPregamePlayersPayload(monitoredTeamScope);
    const sharedPayload = resolveSharedPregamePlayersPayload(localSharedPayload, remotePregamePlayers);
    const remoteSharedUpdatedAt = Number(remotePregamePlayers?.updatedAt || 0);
    const localSharedUpdatedAt = Number(localSharedPayload?.updatedAt || 0);
    const sharedRoster = sharedPayload.players;

    const localLegacyPayload = loadLegacyPlayersPayload(monitoredTeamScope);
    const localLegacyUpdatedAt = Number(localLegacyPayload?.updatedAt || 0);
    const remoteLegacyUpdatedAt = Number(legacyRemotePlayers?.updatedAt || 0);
    const legacyPlayers = remoteLegacyUpdatedAt >= localLegacyUpdatedAt
      ? (legacyRemotePlayers?.players || [])
      : (localLegacyPayload?.players || []);

    const fallbackPlayers = legacyPlayers.length ? legacyPlayers : createDefaultPlayers(monitoredTeamScope);
    const nextPlayers = sharedRoster.length
      ? mergePlayersWithPregameRoster(fallbackPlayers, sharedRoster, monitoredTeamScope)
      : normalizePlayers(fallbackPlayers, monitoredTeamScope);
    const nextUpdatedAt = Math.max(
      remoteSharedUpdatedAt,
      localSharedUpdatedAt,
      remoteLegacyUpdatedAt,
      localLegacyUpdatedAt,
      Date.now()
    );
    setPlayers(nextPlayers);
    playersUpdatedAtRef.current = nextUpdatedAt;
    playersStateKeyRef.current = playersStateKey(nextPlayers);
    skipPlayersSaveRef.current = true;

    setPlayersHydrated(true);
  }, [
    playersHydrated,
    monitoredTeamScope,
    remotePregamePlayers,
    remotePregamePlayersFetched,
    legacyRemotePlayers,
    legacyRemotePlayersFetched,
  ]);

  useEffect(() => {
    if (!playersHydrated || !monitoredTeamScope) return;
    if (supabase && !remotePregamePlayersFetched) return;

    const localPregamePayload = loadPregamePlayersPayload(monitoredTeamScope);
    const rosterSource = resolveSharedPregamePlayersPayload(localPregamePayload, remotePregamePlayers).players;
    if (!rosterSource.length) return;

    setPlayers((current) => {
      const next = mergePlayersWithPregameRoster(current, rosterSource, monitoredTeamScope);
      const nextKey = playersStateKey(next);
      if (nextKey === playersStateKeyRef.current) return current;
      playersStateKeyRef.current = nextKey;
      return next;
    });
  }, [playersHydrated, monitoredTeamScope, remotePregamePlayers, remotePregamePlayersFetched]);

  useEffect(() => {
    if (!playersHydrated || !monitoredTeamScope || !trackedApiPlayers.length) return;
    setPlayers((current) => {
      const next = linkPregamePlayersToApiPlayers(current, trackedApiPlayers);
      const nextKey = playersStateKey(next);
      if (nextKey === playersStateKeyRef.current) return current;
      playersStateKeyRef.current = nextKey;
      return next;
    });
  }, [playersHydrated, monitoredTeamScope, trackedApiPlayers]);

  useEffect(() => {
    if (savedLineupsHydrated) return;
    if (supabase && !remoteSavedLineupsFetched) return;

    if (!monitoredTeamScope) return;
    const localPayload = loadSavedLineupsPayload(monitoredTeamScope);
    const localUpdatedAt = Number(localPayload?.updatedAt || 0);
    const remoteUpdatedAt = Number(remoteSavedLineups?.updatedAt || 0);
    if (remoteSavedLineups?.lineups && remoteUpdatedAt >= localUpdatedAt) {
      setSavedLineups(remoteSavedLineups.lineups);
      savedLineupsUpdatedAtRef.current = remoteUpdatedAt;
      savedLineupsStateKeyRef.current = savedLineupsStateKey(remoteSavedLineups.lineups);
      skipSavedLineupsSaveRef.current = true;
    } else if (localPayload?.lineups) {
      setSavedLineups(localPayload.lineups);
      savedLineupsUpdatedAtRef.current = localUpdatedAt;
      savedLineupsStateKeyRef.current = savedLineupsStateKey(localPayload.lineups);
      skipSavedLineupsSaveRef.current = true;
    } else {
      setSavedLineups([]);
      savedLineupsUpdatedAtRef.current = Date.now();
      savedLineupsStateKeyRef.current = savedLineupsStateKey([]);
      skipSavedLineupsSaveRef.current = true;
    }

    setSavedLineupsHydrated(true);
  }, [savedLineupsHydrated, remoteSavedLineups, remoteSavedLineupsFetched, monitoredTeamScope]);

  useEffect(() => {
    if (depthTemplateHydrated) return;
    if (supabase && !remoteDepthFetched) return;

    if (!monitoredTeamScope) return;
    const localPayload = loadDepthTemplatePayload(monitoredTeamScope);
    const localUpdatedAt = Number(localPayload?.updatedAt || 0);
    const remoteUpdatedAt = Number(remoteDepthTemplate?.updatedAt || 0);
    if (remoteDepthTemplate?.depthChart && remoteUpdatedAt >= localUpdatedAt) {
      setDepthTemplate(remoteDepthTemplate.depthChart);
      depthTemplateUpdatedAtRef.current = remoteUpdatedAt;
      depthTemplateSourceGameIdRef.current = String(remoteDepthTemplate.sourceGameId || "");
      depthTemplateStateKeyRef.current = depthChartStateKey(remoteDepthTemplate.depthChart);
      skipDepthTemplateSaveRef.current = true;
    } else if (localPayload?.depthChart) {
      setDepthTemplate(localPayload.depthChart);
      depthTemplateUpdatedAtRef.current = localUpdatedAt;
      depthTemplateSourceGameIdRef.current = String(localPayload.sourceGameId || "");
      depthTemplateStateKeyRef.current = depthChartStateKey(localPayload.depthChart);
      skipDepthTemplateSaveRef.current = true;
    } else {
      const defaultDepth = createDefaultDepthChart(monitoredTeamScope);
      setDepthTemplate(defaultDepth);
      depthTemplateUpdatedAtRef.current = Date.now();
      depthTemplateStateKeyRef.current = depthChartStateKey(defaultDepth);
      skipDepthTemplateSaveRef.current = true;
    }

    setDepthTemplateHydrated(true);
  }, [depthTemplateHydrated, remoteDepthTemplate, remoteDepthFetched, monitoredTeamScope]);

  useEffect(() => {
    if (gameHydrated || !gameId) return;
    if (supabase && !remoteGameFetched) return;
    if (!depthTemplateHydrated) return;

    if (!monitoredTeamScope) return;
    const defaults = createDefaultGameState(monitoredTeamScope);
    defaults.versions[0].depthChart = normalizeDepthChart(depthTemplate, monitoredTeamScope);
    const localPayload = loadGamePayload(gameId);
    const localUpdatedAt = Number(localPayload?.updatedAt || 0);
    const remoteUpdatedAt = Number(remoteGameState?.updatedAt || 0);
    if (remoteGameState?.state && remoteUpdatedAt >= localUpdatedAt) {
      const incomingState = applyInheritedTemplate(normalizeGameState(remoteGameState.state, monitoredTeamScope));
      setGameState(incomingState);
      gameUpdatedAtRef.current = remoteUpdatedAt;
      gameStateKeyRef.current = gameStateKey(incomingState);
      skipGameSaveRef.current = true;
    } else if (localPayload?.state) {
      const incomingState = applyInheritedTemplate(normalizeGameState(localPayload.state, monitoredTeamScope));
      setGameState(incomingState);
      gameUpdatedAtRef.current = localUpdatedAt;
      gameStateKeyRef.current = gameStateKey(incomingState);
      skipGameSaveRef.current = true;
    } else {
      setGameState(defaults);
      gameUpdatedAtRef.current = Date.now();
      gameStateKeyRef.current = gameStateKey(defaults);
      skipGameSaveRef.current = true;
    }

    setGameHydrated(true);
  }, [gameHydrated, gameId, remoteGameState, remoteGameFetched, depthTemplateHydrated, depthTemplate, monitoredTeamScope]);

  useEffect(() => {
    if (!gameHydrated || !gameId || !depthTemplateHydrated || !monitoredTeamScope) return;
    setGameState((current) => {
      const next = applyInheritedTemplate(current);
      return next === current ? current : next;
    });
  }, [gameHydrated, gameId, depthTemplateHydrated, depthTemplate, monitoredTeamScope]);

  useEffect(() => {
    if (!monitoredTeamScope) return;
    if (!playersHydrated) return;

    if (skipPlayersSaveRef.current) {
      skipPlayersSaveRef.current = false;
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const updatedAt = Date.now();
      playersUpdatedAtRef.current = updatedAt;
      persistPregamePlayers(monitoredTeamScope, players, updatedAt);
      saveRemotePregamePlayers(monitoredTeamScope, players, updatedAt)
        .then(() => setSyncError(""))
        .catch((saveError) => {
          console.error("Failed to save rotations players", saveError);
          setSyncError(saveError?.message || "Unable to sync roster changes.");
        });
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [players, playersHydrated, monitoredTeamScope]);

  useEffect(() => {
    playersStateKeyRef.current = playersStateKey(players);
  }, [players]);

  useEffect(() => {
    if (!monitoredTeamScope) return;
    if (!savedLineupsHydrated) return;

    if (skipSavedLineupsSaveRef.current) {
      skipSavedLineupsSaveRef.current = false;
      persistSavedLineups(monitoredTeamScope, savedLineups, savedLineupsUpdatedAtRef.current || Date.now());
      return;
    }

    const updatedAt = Date.now();
    savedLineupsUpdatedAtRef.current = updatedAt;
    persistSavedLineups(monitoredTeamScope, savedLineups, updatedAt);
    saveRemoteSavedLineups(monitoredTeamScope, savedLineups, updatedAt)
      .then(() => setSyncError(""))
      .catch((saveError) => {
        console.error("Failed to save rotations lineups", saveError);
        setSyncError(saveError?.message || "Unable to sync saved lineups.");
      });
  }, [savedLineups, savedLineupsHydrated, monitoredTeamScope]);

  useEffect(() => {
    savedLineupsStateKeyRef.current = savedLineupsStateKey(savedLineups);
  }, [savedLineups]);

  useEffect(() => {
    setPlayerNameDrafts((current) => {
      const next = buildPlayerNameDrafts(players);
      const editingId = editingPlayerNameIdRef.current;
      if (editingId && Object.hasOwn(current, editingId)) {
        next[editingId] = current[editingId];
      }
      return next;
    });
  }, [players]);

  useEffect(() => {
    if (!playersHydrated) return undefined;
    const timeoutId = window.setTimeout(() => {
      setPlayers((current) => {
        let changed = false;
        const next = current.map((player) => {
          const draftValue = playerNameDrafts[player.id];
          const normalizedDraft = draftValue == null ? player.name : normalizePlayerNameInput(draftValue);
          if (normalizedDraft === player.name) return player;
          changed = true;
          return { ...player, name: normalizedDraft };
        });
        return changed ? next : current;
      });
    }, 150);

    return () => window.clearTimeout(timeoutId);
  }, [playerNameDrafts, playersHydrated]);

  useEffect(() => {
    if (!monitoredTeamScope) return;
    if (!depthTemplateHydrated) return;

    if (skipDepthTemplateSaveRef.current) {
      skipDepthTemplateSaveRef.current = false;
      persistDepthTemplate(
        monitoredTeamScope,
        depthTemplate,
        depthTemplateUpdatedAtRef.current || Date.now(),
        depthTemplateSourceGameIdRef.current
      );
      return;
    }

    const updatedAt = Date.now();
    depthTemplateUpdatedAtRef.current = updatedAt;
    persistDepthTemplate(monitoredTeamScope, depthTemplate, updatedAt, depthTemplateSourceGameIdRef.current);
    saveRemoteDepthTemplate(monitoredTeamScope, depthTemplate, updatedAt, depthTemplateSourceGameIdRef.current)
      .then(() => setSyncError(""))
      .catch((saveError) => {
        console.error("Failed to save rotations depth template", saveError);
        setSyncError(saveError?.message || "Unable to sync depth chart template.");
      });
  }, [depthTemplate, depthTemplateHydrated, monitoredTeamScope]);

  useEffect(() => {
    depthTemplateStateKeyRef.current = depthChartStateKey(depthTemplate);
  }, [depthTemplate]);

  useEffect(() => {
    if (!monitoredTeamScope) return;
    if (!gameHydrated || !gameId) return;

    const state = gameState;
    if (skipGameSaveRef.current) {
      skipGameSaveRef.current = false;
      persistGameState(gameId, state, gameUpdatedAtRef.current || Date.now());
      return;
    }

    const updatedAt = Date.now();
    gameUpdatedAtRef.current = updatedAt;
    persistGameState(gameId, state, updatedAt);
    saveRemoteGameState(gameId, state, updatedAt)
      .then(() => setSyncError(""))
      .catch((saveError) => {
        console.error("Failed to save rotations game state", saveError);
        setSyncError(saveError?.message || "Unable to sync rotations state.");
      });
  }, [gameState, gameHydrated, gameId, monitoredTeamScope]);

  useEffect(() => {
    gameStateKeyRef.current = gameStateKey(gameState);
  }, [gameState]);

  useEffect(() => {
    if (!savedLineupsHydrated) return;
    applyRemoteSavedLineups(remoteSavedLineups);
  }, [savedLineupsHydrated, remoteSavedLineups]);

  useEffect(() => {
    if (!depthTemplateHydrated) return;
    applyRemoteDepthTemplate(remoteDepthTemplate);
  }, [depthTemplateHydrated, remoteDepthTemplate]);

  useEffect(() => {
    if (!gameHydrated || !gameId || !remoteGameState?.state) return;
    applyRemoteGameState(remoteGameState);
  }, [gameHydrated, gameId, remoteGameState]);

  const playerOptions = useMemo(() => {
    const unique = new Set();
    players.forEach((player) => {
      const name = normalizeName(player.display || player.name);
      if (!name) return;
      unique.add(name);
    });
    return Array.from(unique);
  }, [players]);

  const quarterCounts = useMemo(() => {
    const result = { 1: {}, 2: {}, 3: {}, 4: {} };
    QUARTERS.forEach((quarter) => {
      const counts = {};
      (lineups[quarter] || []).forEach((row) => {
        row.forEach((value) => {
          const name = normalizeName(value);
          if (!name) return;
          counts[name] = (counts[name] || 0) + 1;
        });
      });
      result[quarter] = counts;
    });
    return result;
  }, [lineups]);

  const totalCounts = useMemo(() => {
    const totals = {};
    QUARTERS.forEach((quarter) => {
      Object.entries(quarterCounts[quarter] || {}).forEach(([name, count]) => {
        totals[name] = (totals[name] || 0) + (count || 0);
      });
    });
    return totals;
  }, [quarterCounts]);

  const quarterTotals = useMemo(() => {
    const values = { 1: 0, 2: 0, 3: 0, 4: 0 };
    QUARTERS.forEach((quarter) => {
      let filled = 0;
      (lineups[quarter] || []).forEach((row) => {
        row.forEach((value) => {
          if (normalizeName(value)) filled += 1;
        });
      });
      values[quarter] = filled;
    });
    return values;
  }, [lineups]);

  const allQuarterTotal = quarterTotals[1] + quarterTotals[2] + quarterTotals[3] + quarterTotals[4];
  const opponentLine = useMemo(() => buildOpponentLine(game, monitoredTeam), [game, monitoredTeam]);
  const exportHeaderLine = useMemo(
    () => `${monitoredTeam?.label || "WASHINGTON"} ${opponentLine}`,
    [monitoredTeam, opponentLine]
  );
  const versionOptions = useMemo(() => gameState.versions, [gameState.versions]);
  const sortedPlayers = useMemo(() => players.filter((player) => player.name || player.display), [players]);

  const updateActiveVersion = (updater) => {
    setGameState((current) => ({
      ...current,
      versions: current.versions.map((version) => (
        version.id !== current.activeVersionId ? version : updater(version)
      )),
    }));
  };

  const setActiveVersionId = (versionId) => {
    lineupHistoryRef.current = [];
    setUndoDepth(0);
    setGameState((current) => (
      current.activeVersionId === versionId ? current : { ...current, activeVersionId: versionId }
    ));
    setVersionMenuOpen(false);
  };

  const updateActiveVersionOptions = (key, checked) => {
    updateActiveVersion((currentVersion) => ({
      ...currentVersion,
      options: {
        ...normalizeVersionOptions(currentVersion.options),
        [key]: Boolean(checked),
      },
    }));
  };

  const updatePlayerField = (playerId, field, value) => {
    setPlayers((current) => current.map((player) => {
      if (player.id !== playerId) return player;
      if (field === "cap") {
        if (value === "") return { ...player, cap: "" };
        const parsed = Number.parseInt(value, 10);
        return { ...player, cap: Number.isFinite(parsed) ? parsed : player.cap };
      }
      return { ...player, [field]: normalizePlayerNameInput(value) };
    }));
  };

  const openPlayersEditor = () => {
    const hasDrafts = Object.keys(playerDrafts).length > 0 || newPlayerDraft.name || newPlayerDraft.display || newPlayerDraft.personId;
    if (!hasDrafts) {
      setPlayerDrafts(Object.fromEntries(sortedPlayers.map((player) => [
        player.id,
        { name: player.name, display: player.display || player.name, personId: player.personId || "" },
      ])));
    }
    setPlayersOpen(true);
  };

  const cancelPlayersEditor = () => {
    setPlayersOpen(false);
    setEditingPlayerId(null);
    setPlayerDrafts({});
    setNewPlayerDraft({ name: "", display: "", personId: "" });
  };

  const saveAllPlayerEdits = () => {
    setPlayers((current) => {
      const next = current.map((player) => {
        const draft = playerDrafts[player.id];
        if (!draft) return player;
        const name = normalizePlayerNameInput(draft.name);
        const display = normalizePlayerNameInput(draft.display || draft.name);
        const personId = String(draft.personId || "").trim();
        if (!name || !display) return player;
        return { ...player, name, display, personId };
      });
      return next;
    });
    cancelPlayersEditor();
  };

  const handleDeletePlayer = (playerId) => {
    setPlayers((current) => {
      return current.filter((player) => player.id !== playerId);
    });
    setNewPlayerDraft({ name: "", display: "", personId: "" });
    setEditingPlayerId(null);
    setPlayerDrafts((current) => {
      const next = { ...current };
      delete next[playerId];
      return next;
    });
  };

  const handleAddPlayer = () => {
    const name = normalizePlayerNameInput(newPlayerDraft.name);
    const display = normalizePlayerNameInput(newPlayerDraft.display || newPlayerDraft.name);
    const personId = String(newPlayerDraft.personId || "").trim();
    if (!name || !display) return;
    setPlayers((current) => {
      const next = normalizePlayers([
        ...current,
        { id: crypto.randomUUID(), name, display, personId, cap: 48 },
      ], monitoredTeamScope || "mystics");
      return next;
    });
    setNewPlayerDraft({ name: "", display: "", personId: "" });
  };

  const updatePlayerNameDraft = (playerId, value) => {
    setPlayerNameDrafts((current) => (
      current[playerId] === value ? current : { ...current, [playerId]: normalizePlayerNameInput(value) }
    ));
  };

  const commitPlayerNameDraft = (playerId) => {
    const draftValue = normalizePlayerNameInput(playerNameDrafts[playerId] || "");
    setPlayers((current) => current.map((player) => (
      player.id !== playerId || player.name === draftValue ? player : { ...player, name: draftValue }
    )));
  };

  const applySavedLineupToRow = (quarter, minuteIndex, lineupPlayers) => {
    updateActiveVersion((currentVersion) => {
      lineupHistoryRef.current = [...lineupHistoryRef.current, currentVersion.lineups].slice(-MAX_LINEUP_HISTORY);
      setUndoDepth(lineupHistoryRef.current.length);
      return {
        ...currentVersion,
        lineups: {
          ...currentVersion.lineups,
          [quarter]: currentVersion.lineups[quarter].map((row, rowIndex) => (
            rowIndex !== minuteIndex
              ? row
              : POSITION_COLUMNS.map((_, playerIndex) => normalizeName(lineupPlayers?.[playerIndex] || ""))
          )),
        },
        inheritDepthTemplate: currentVersion.inheritDepthTemplate,
      };
    });
  };

  const clearLineupRow = (quarter, minuteIndex) => {
    applySavedLineupToRow(quarter, minuteIndex, POSITION_COLUMNS.map(() => ""));
  };

  const openCreateSavedLineupModal = (target) => {
    setSavedLineupMenu(null);
    setSavedLineupName("");
    setCreateSavedLineupTarget(target);
  };

  const confirmCreateSavedLineup = () => {
    if (!createSavedLineupTarget) return;
    const name = String(savedLineupName || "").trim();
    if (!name) return;
    const rowPlayers = lineups?.[createSavedLineupTarget.quarter]?.[createSavedLineupTarget.minuteIndex] || [];
    const nextLineup = {
      id: typeof crypto !== "undefined" ? crypto.randomUUID() : `saved-lineup-${Date.now()}`,
      name,
      players: POSITION_COLUMNS.map((_, playerIndex) => normalizeName(rowPlayers[playerIndex] || "")),
    };
    setSavedLineups((current) => [...current, nextLineup]);
    setCreateSavedLineupTarget(null);
    setSavedLineupName("");
  };

  const confirmDeleteSavedLineup = () => {
    if (!deleteSavedLineupTarget) return;
    setSavedLineups((current) => current.filter((lineup) => lineup.id !== deleteSavedLineupTarget.id));
    setDeleteSavedLineupTarget(null);
    setSavedLineupMenu(null);
  };

  const clearDepthCellPress = () => {
    if (depthCellPressRef.current.timerId) {
      window.clearTimeout(depthCellPressRef.current.timerId);
      depthCellPressRef.current.timerId = null;
    }
    if (depthCellPressRef.current.releaseTimerId) {
      window.clearTimeout(depthCellPressRef.current.releaseTimerId);
      depthCellPressRef.current.releaseTimerId = null;
    }
    setIsDepthCellPressActive(false);
    depthCellPressRef.current.startX = 0;
    depthCellPressRef.current.startY = 0;
    depthCellPressRef.current.rowIndex = -1;
    depthCellPressRef.current.columnIndex = -1;
    depthCellPressRef.current.value = "";
  };

  const startDepthCellPress = (event, rowIndex, columnIndex, value) => {
    const cell = parseDepthChartCell(value);
    if (!cell.name) return;
    clearDepthCellPress();
    setIsDepthCellPressActive(true);
    depthCellPressRef.current.startX = event.clientX;
    depthCellPressRef.current.startY = event.clientY;
    depthCellPressRef.current.rowIndex = rowIndex;
    depthCellPressRef.current.columnIndex = columnIndex;
    depthCellPressRef.current.value = value;
    depthCellPressRef.current.timerId = window.setTimeout(() => {
      setDepthCellConfirmTarget({
        rowIndex,
        columnIndex,
        value: cell.raw,
        name: cell.name,
        mode: cell.isOut ? "active" : "out",
      });
      clearDepthCellPress();
    }, DEPTH_OUT_PRESS_DURATION_MS);
  };

  const openDepthCellConfirm = (rowIndex, columnIndex, value) => {
    const cell = parseDepthChartCell(value);
    if (!cell.name) return;
    clearDepthCellPress();
    setDepthCellConfirmTarget({
      rowIndex,
      columnIndex,
      value: cell.raw,
      name: cell.name,
      mode: cell.isOut ? "active" : "out",
    });
  };

  const releaseDepthCellPress = (event) => {
    event.preventDefault();
    if (depthCellPressRef.current.releaseTimerId) {
      window.clearTimeout(depthCellPressRef.current.releaseTimerId);
    }
    depthCellPressRef.current.releaseTimerId = window.setTimeout(() => {
      clearDepthCellPress();
    }, DEPTH_PRESS_RELEASE_LOCK_MS);
  };

  const moveDepthCellPress = (event) => {
    if (!depthCellPressRef.current.timerId) return;
    if (event.pointerType === "touch") {
      event.preventDefault();
    }
    const dx = Math.abs(event.clientX - depthCellPressRef.current.startX);
    const dy = Math.abs(event.clientY - depthCellPressRef.current.startY);
    if (dx > 8 || dy > 8) {
      clearDepthCellPress();
    }
  };

  const confirmDepthCellStateChange = () => {
    if (!depthCellConfirmTarget) return;
    const nextValue = depthCellConfirmTarget.mode === "active"
      ? markDepthChartCellActive(depthCellConfirmTarget.value)
      : markDepthChartCellOut(depthCellConfirmTarget.value);
    updateDepthCell(depthCellConfirmTarget.rowIndex, depthCellConfirmTarget.columnIndex, nextValue);
    setDepthCellConfirmTarget(null);
  };

  const updateDepthCell = (rowIndex, columnIndex, value) => {
    updateActiveVersion((currentVersion) => {
      const next = currentVersion.depthChart.map((row, rIndex) => (
        rIndex !== rowIndex ? row : row.map((cell, cIndex) => (cIndex === columnIndex ? normalizeDepthChartCell(value) : cell))
      ));
      if (activeVersionId === FINAL_VERSION_ID) {
        depthTemplateSourceGameIdRef.current = String(gameId || "");
        setDepthTemplate(next);
      }
      return {
        ...currentVersion,
        depthChart: next,
        inheritDepthTemplate: currentVersion.inheritDepthTemplate,
      };
    });
  };

  const resetDepthChart = () => {
    const emptyDepthChart = [0, 1, 2].map(() => POSITION_COLUMNS.map(() => ""));
    updateActiveVersion((currentVersion) => {
      if (activeVersionId === FINAL_VERSION_ID) {
        depthTemplateSourceGameIdRef.current = String(gameId || "");
        setDepthTemplate(emptyDepthChart);
      }
      return {
        ...currentVersion,
        depthChart: emptyDepthChart,
        inheritDepthTemplate: currentVersion.inheritDepthTemplate,
      };
    });
  };

  const backUpDepthChartNow = () => {
    if (!monitoredTeamScope) return;
    const nextDepthChart = normalizeDepthChart(depthChart, monitoredTeamScope);
    const sourceGameId = String(gameId || "");
    const updatedAt = Date.now();
    depthTemplateSourceGameIdRef.current = sourceGameId;
    depthTemplateUpdatedAtRef.current = updatedAt;
    depthTemplateStateKeyRef.current = depthChartStateKey(nextDepthChart);
    skipDepthTemplateSaveRef.current = true;
    persistDepthTemplate(monitoredTeamScope, nextDepthChart, updatedAt, sourceGameId);
    saveRemoteDepthTemplate(monitoredTeamScope, nextDepthChart, updatedAt, sourceGameId)
      .then(() => setSyncError(""))
      .catch((saveError) => {
        console.error("Failed to back up depth chart", saveError);
        setSyncError(saveError?.message || "Unable to sync depth chart backup.");
      });
    setDepthTemplate(nextDepthChart);
  };

  const updateLineupCell = (quarter, minuteIndex, positionIndex, value) => {
    updateActiveVersion((currentVersion) => {
      lineupHistoryRef.current = [...lineupHistoryRef.current, currentVersion.lineups].slice(-MAX_LINEUP_HISTORY);
      setUndoDepth(lineupHistoryRef.current.length);
      return {
        ...currentVersion,
        lineups: {
          ...currentVersion.lineups,
          [quarter]: currentVersion.lineups[quarter].map((row, rIndex) => (
          rIndex !== minuteIndex
            ? row
            : row.map((cell, cIndex) => (cIndex === positionIndex ? normalizeName(value) : cell))
          )),
        },
        inheritDepthTemplate: currentVersion.inheritDepthTemplate,
      };
    });
  };

  const fillLineupRange = (quarter, startMinuteIndex, startPositionIndex, endMinuteIndex, endPositionIndex, value) => {
    const normalizedValue = normalizeName(value);
    if (!normalizedValue) return;
    const minMinute = Math.min(startMinuteIndex, endMinuteIndex);
    const maxMinute = Math.max(startMinuteIndex, endMinuteIndex);
    const minPosition = Math.min(startPositionIndex, endPositionIndex);
    const maxPosition = Math.max(startPositionIndex, endPositionIndex);
    updateActiveVersion((currentVersion) => {
      lineupHistoryRef.current = [...lineupHistoryRef.current, currentVersion.lineups].slice(-MAX_LINEUP_HISTORY);
      setUndoDepth(lineupHistoryRef.current.length);
      return {
        ...currentVersion,
        lineups: {
          ...currentVersion.lineups,
          [quarter]: currentVersion.lineups[quarter].map((row, minuteIndex) => {
          if (minuteIndex < minMinute || minuteIndex > maxMinute) return row;
          return row.map((cell, positionIndex) => (
            positionIndex < minPosition || positionIndex > maxPosition ? cell : normalizedValue
          ));
          }),
        },
        inheritDepthTemplate: currentVersion.inheritDepthTemplate,
      };
    });
  };

  const updateTouchFillTarget = (clientX, clientY) => {
    if (!touchFillRef.current.active) return;
    const target = document.elementFromPoint(clientX, clientY);
    const meta = getCellMetaFromElement(target);
    if (!meta || meta.quarter !== touchFillRef.current.quarter) return;
    if (
      touchFillRef.current.endMinuteIndex === meta.minuteIndex &&
      touchFillRef.current.endPositionIndex === meta.positionIndex
    ) {
      return;
    }
    touchFillRef.current.endMinuteIndex = meta.minuteIndex;
    touchFillRef.current.endPositionIndex = meta.positionIndex;
    setTouchPreview({
      quarter: meta.quarter,
      startMinuteIndex: touchFillRef.current.originMinuteIndex,
      startPositionIndex: touchFillRef.current.originPositionIndex,
      endMinuteIndex: meta.minuteIndex,
      endPositionIndex: meta.positionIndex,
    });
  };

  const commitTouchFill = () => {
    if (!touchFillRef.current.active) return;
    fillLineupRange(
      touchFillRef.current.quarter,
      touchFillRef.current.originMinuteIndex,
      touchFillRef.current.originPositionIndex,
      touchFillRef.current.endMinuteIndex,
      touchFillRef.current.endPositionIndex,
      touchFillRef.current.value
    );
  };

  const resetAll = () => {
    updateActiveVersion((currentVersion) => {
      lineupHistoryRef.current = [...lineupHistoryRef.current, currentVersion.lineups].slice(-MAX_LINEUP_HISTORY);
      setUndoDepth(lineupHistoryRef.current.length);
      return {
        ...currentVersion,
        lineups: createDefaultQuarterLineups(),
        inheritDepthTemplate: currentVersion.inheritDepthTemplate,
      };
    });
    setResetModalOpen(false);
  };

  const resetToStarters = () => {
    updateActiveVersion((currentVersion) => {
      lineupHistoryRef.current = [...lineupHistoryRef.current, currentVersion.lineups].slice(-MAX_LINEUP_HISTORY);
      setUndoDepth(lineupHistoryRef.current.length);
      const next = createDefaultQuarterLineups();
      next[1][0] = POSITION_COLUMNS.map((_, columnIndex) => getDepthChartLineupValue(depthChart?.[0]?.[columnIndex] || ""));
      return {
        ...currentVersion,
        lineups: next,
        inheritDepthTemplate: currentVersion.inheritDepthTemplate,
      };
    });
    setResetModalOpen(false);
  };

  const resetQuarterMinutes = (quarter) => {
    updateActiveVersion((currentVersion) => {
      lineupHistoryRef.current = [...lineupHistoryRef.current, currentVersion.lineups].slice(-MAX_LINEUP_HISTORY);
      setUndoDepth(lineupHistoryRef.current.length);
      return {
        ...currentVersion,
        lineups: {
          ...currentVersion.lineups,
          [quarter]: createDefaultQuarterLineups()[quarter],
        },
        inheritDepthTemplate: currentVersion.inheritDepthTemplate,
      };
    });
  };

  const openResetConfirmation = (target) => {
    setConfirmResetTarget(target);
  };

  const closeResetConfirmation = () => {
    setConfirmResetTarget(null);
  };

  const confirmResetAction = () => {
    if (!confirmResetTarget) return;
    if (confirmResetTarget.type === "depth") {
      resetDepthChart();
    } else if (confirmResetTarget.type === "quarter" && Number.isFinite(confirmResetTarget.quarter)) {
      resetQuarterMinutes(confirmResetTarget.quarter);
    }
    setConfirmResetTarget(null);
  };

  const undoLastLineupChange = () => {
    if (!lineupHistoryRef.current.length) return;
    const previous = lineupHistoryRef.current[lineupHistoryRef.current.length - 1];
    lineupHistoryRef.current = lineupHistoryRef.current.slice(0, -1);
    setUndoDepth(lineupHistoryRef.current.length);
    updateActiveVersion((currentVersion) => ({
      ...currentVersion,
      lineups: previous,
    }));
  };

  const openCreateVersionModal = () => {
    setVersionMenuOpen(false);
    setCreateVersionName("");
    setCreateVersionOpen(true);
  };

  const createVersion = (mode) => {
    const name = String(createVersionName || "").trim();
    if (!name) return;
    const nextVersion = createVersionState({
      name,
      depthChart: mode === "copy" ? depthChart : DEPTH_ROW_INDICES.map(() => POSITION_COLUMNS.map(() => "")),
      lineups: mode === "copy" ? lineups : createDefaultQuarterLineups(),
      inheritDepthTemplate: false,
      options: mode === "copy" ? versionDisplayOptions : DEFAULT_VERSION_OPTIONS,
      teamScope: monitoredTeamScope || "mystics",
    });
    lineupHistoryRef.current = [];
    setUndoDepth(0);
    setGameState((current) => ({
      ...current,
      activeVersionId: nextVersion.id,
      versions: [...current.versions, nextVersion],
    }));
    setCreateVersionOpen(false);
  };

  const confirmDeleteVersion = () => {
    if (!deleteVersionTarget || deleteVersionTarget.id === FINAL_VERSION_ID) return;
    lineupHistoryRef.current = [];
    setUndoDepth(0);
    setGameState((current) => {
      const versions = current.versions.filter((version) => version.id !== deleteVersionTarget.id);
      const activeId = current.activeVersionId === deleteVersionTarget.id ? FINAL_VERSION_ID : current.activeVersionId;
      return { ...current, versions, activeVersionId: activeId };
    });
    setDeleteVersionTarget(null);
    setVersionMenuOpen(false);
  };

  const handleExportPdf = async () => {
    if (typeof window === "undefined") return;
    const pdfWindow = window.open("", "_blank");
    if (pdfWindow?.document) {
      pdfWindow.document.title = "Generating Rotations PDF...";
      pdfWindow.document.body.innerHTML = "<p style=\"font-family: sans-serif; padding: 16px;\">Generating PDF...</p>";
    }
    try {
      const [{ default: fontkit }, { PDFDocument, rgb }] = await Promise.all([
        import("@pdf-lib/fontkit"),
        import("pdf-lib"),
      ]);
      const pdfColors = buildPdfColors(rgb);
      const fontUrl = new URL("../assets/fonts/DINalt.ttf", import.meta.url).href;
      const fontResponse = await fetch(fontUrl);
      const fontBytes = await fontResponse.arrayBuffer();

      const pdfDoc = await PDFDocument.create();
      pdfDoc.registerFontkit(fontkit);
      const pdfFont = await pdfDoc.embedFont(fontBytes, { subset: true });

      let logoImage = null;
      try {
        const logoUrl = new URL("../assets/Mystics_Primary_Icon.svg", import.meta.url).href;
        logoImage = await embedPdfLogoFromAsset(pdfDoc, logoUrl);
      } catch {
        logoImage = null;
      }

      const pageOne = pdfDoc.addPage([612, 792]);
      const pageTwo = pdfDoc.addPage([612, 792]);

      drawRotationsPdfPage(pageOne, {
        headerLine: exportHeaderLine,
        depthChart,
        lineups,
        logoImage,
        font: pdfFont,
        side: "left",
        hideNamesOnDuplicateRows: versionDisplayOptions.hideNamesOnDuplicateRows,
        pdfColors,
      });
      drawRotationsPdfPage(pageTwo, {
        headerLine: exportHeaderLine,
        depthChart,
        lineups,
        logoImage,
        font: pdfFont,
        side: "right",
        hideNamesOnDuplicateRows: versionDisplayOptions.hideNamesOnDuplicateRows,
        pdfColors,
      });

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const blobUrl = window.URL.createObjectURL(blob);
      if (pdfWindow) {
        pdfWindow.location.href = blobUrl;
        try {
          pdfWindow.opener = null;
        } catch {
          // Ignore browsers that do not allow resetting opener.
        }
      } else {
        window.open(blobUrl, "_blank", "noopener,noreferrer");
      }
      window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000);
    } catch (error) {
      if (pdfWindow?.document) {
        pdfWindow.document.title = "Rotations PDF Export Failed";
        pdfWindow.document.body.innerHTML = `<p style="font-family: sans-serif; padding: 16px;">Unable to generate PDF: ${String(error?.message || error || "Unknown error")}</p>`;
      }
      throw error;
    }
  };

  const toggleSection = (key) => {
    setCollapsed((current) => ({ ...current, [key]: !current[key] }));
  };

  const clearTouchFillTimer = () => {
    const timerId = touchFillRef.current.timerId;
    if (timerId) {
      window.clearTimeout(timerId);
      touchFillRef.current.timerId = null;
    }
  };

  const clearSavedLineupPressTimer = () => {
    const timerId = savedLineupPressRef.current.timerId;
    if (timerId) {
      window.clearTimeout(timerId);
      savedLineupPressRef.current.timerId = null;
    }
  };

  const openSavedLineupMenu = (quarter, minuteIndex, anchorRect) => {
    setSavedLineupMenu({
      quarter,
      minuteIndex,
      top: anchorRect.bottom + 6,
      left: anchorRect.left,
    });
  };

  const startSavedLineupPress = (event, quarter, minuteIndex) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    clearSavedLineupPressTimer();
    savedLineupPressRef.current.pointerId = event.pointerId;
    savedLineupPressRef.current.pointerType = event.pointerType || "mouse";
    savedLineupPressRef.current.startX = event.clientX;
    savedLineupPressRef.current.startY = event.clientY;
    savedLineupPressRef.current.target = { quarter, minuteIndex, element: event.currentTarget };
    savedLineupPressRef.current.timerId = window.setTimeout(() => {
      const target = savedLineupPressRef.current.target;
      if (!target?.element) return;
      openSavedLineupMenu(target.quarter, target.minuteIndex, target.element.getBoundingClientRect());
      savedLineupPressRef.current.timerId = null;
    }, LONG_PRESS_DURATION_MS);
  };

  const cancelSavedLineupPress = () => {
    clearSavedLineupPressTimer();
    savedLineupPressRef.current.pointerId = null;
    savedLineupPressRef.current.pointerType = "";
    savedLineupPressRef.current.target = null;
  };

  const stopTouchFill = () => {
    clearTouchFillTimer();
    touchFillRef.current.active = false;
    setIsTouchFillActive(false);
    touchFillRef.current.quarter = null;
    touchFillRef.current.value = "";
    touchFillRef.current.originMinuteIndex = -1;
    touchFillRef.current.originPositionIndex = -1;
    touchFillRef.current.endMinuteIndex = -1;
    touchFillRef.current.endPositionIndex = -1;
    setTouchPreview(null);
  };

  const getCellMetaFromElement = (element) => {
    const cell = element?.closest?.("[data-quarter][data-minute-index][data-position-index]");
    if (!cell) return null;
    const quarter = Number.parseInt(cell.getAttribute("data-quarter") || "", 10);
    const minuteIndex = Number.parseInt(cell.getAttribute("data-minute-index") || "", 10);
    const positionIndex = Number.parseInt(cell.getAttribute("data-position-index") || "", 10);
    if (!Number.isFinite(quarter) || !Number.isFinite(minuteIndex) || !Number.isFinite(positionIndex)) return null;
    return { quarter, minuteIndex, positionIndex };
  };

  const isInTouchPreviewRange = (quarter, minuteIndex, positionIndex) => {
    if (!touchPreview || touchPreview.quarter !== quarter) return false;
    const minMinute = Math.min(touchPreview.startMinuteIndex, touchPreview.endMinuteIndex);
    const maxMinute = Math.max(touchPreview.startMinuteIndex, touchPreview.endMinuteIndex);
    const minPosition = Math.min(touchPreview.startPositionIndex, touchPreview.endPositionIndex);
    const maxPosition = Math.max(touchPreview.startPositionIndex, touchPreview.endPositionIndex);
    return (
      minuteIndex >= minMinute
      && minuteIndex <= maxMinute
      && positionIndex >= minPosition
      && positionIndex <= maxPosition
    );
  };

  const applyRemoteSavedLineups = (payload) => {
    const remoteUpdatedAt = Number(payload?.updatedAt || 0);
    if (!remoteUpdatedAt || remoteUpdatedAt <= savedLineupsUpdatedAtRef.current) return;
    const incomingLineups = normalizeSavedLineups(payload?.lineups || []);
    const incomingKey = savedLineupsStateKey(incomingLineups);
    if (incomingKey === savedLineupsStateKeyRef.current) {
      savedLineupsUpdatedAtRef.current = remoteUpdatedAt;
      return;
    }
    setSavedLineups(incomingLineups);
    savedLineupsUpdatedAtRef.current = remoteUpdatedAt;
    savedLineupsStateKeyRef.current = incomingKey;
    skipSavedLineupsSaveRef.current = true;
    persistSavedLineups(monitoredTeamScope, incomingLineups, remoteUpdatedAt);
  };

  const applyRemoteDepthTemplate = (payload) => {
    const remoteUpdatedAt = Number(payload?.updatedAt || 0);
    if (!remoteUpdatedAt || remoteUpdatedAt <= depthTemplateUpdatedAtRef.current) return;
    const incomingDepth = normalizeDepthChart(payload?.depthChart, monitoredTeamScope || "mystics");
    const incomingKey = depthChartStateKey(incomingDepth);
    if (incomingKey === depthTemplateStateKeyRef.current) {
      depthTemplateUpdatedAtRef.current = remoteUpdatedAt;
      depthTemplateSourceGameIdRef.current = String(payload?.sourceGameId || "");
      return;
    }
    setDepthTemplate(incomingDepth);
    depthTemplateUpdatedAtRef.current = remoteUpdatedAt;
    depthTemplateSourceGameIdRef.current = String(payload?.sourceGameId || "");
    depthTemplateStateKeyRef.current = incomingKey;
    skipDepthTemplateSaveRef.current = true;
    persistDepthTemplate(monitoredTeamScope, incomingDepth, remoteUpdatedAt, payload?.sourceGameId);
  };

  const applyRemoteGameState = (payload) => {
    const remoteUpdatedAt = Number(payload?.updatedAt || 0);
    if (!remoteUpdatedAt || remoteUpdatedAt <= gameUpdatedAtRef.current) return;
    const incomingState = normalizeGameState(payload?.state, monitoredTeamScope || "mystics");
    const incomingKey = gameStateKey(incomingState);
    if (incomingKey === gameStateKeyRef.current) {
      gameUpdatedAtRef.current = remoteUpdatedAt;
      return;
    }
    lineupHistoryRef.current = [];
    setUndoDepth(0);
    setGameState(incomingState);
    gameUpdatedAtRef.current = remoteUpdatedAt;
    gameStateKeyRef.current = incomingKey;
    skipGameSaveRef.current = true;
    persistGameState(gameId, incomingState, remoteUpdatedAt);
  };

  useEffect(() => {
    const endDragFill = () => {
      dragFillRef.current.active = false;
      cancelSavedLineupPress();
      if (touchFillRef.current.active) {
        commitTouchFill();
        stopTouchFill();
      }
    };
    window.addEventListener("pointerup", endDragFill);
    window.addEventListener("pointercancel", endDragFill);
    window.addEventListener("mouseup", endDragFill);
    window.addEventListener("touchend", endDragFill, { passive: true });
    window.addEventListener("touchcancel", endDragFill, { passive: true });
    return () => {
      window.removeEventListener("pointerup", endDragFill);
      window.removeEventListener("pointercancel", endDragFill);
      window.removeEventListener("mouseup", endDragFill);
      window.removeEventListener("touchend", endDragFill);
      window.removeEventListener("touchcancel", endDragFill);
      clearSavedLineupPressTimer();
      clearTouchFillTimer();
    };
  }, []);

  useEffect(() => {
    const handleTouchMove = (event) => {
      const touch = event.touches?.[0];
      if (!touch) return;

      if (!touchFillRef.current.active) {
        if (!touchFillRef.current.timerId) return;
        const dx = Math.abs(touch.clientX - touchFillRef.current.startTouchX);
        const dy = Math.abs(touch.clientY - touchFillRef.current.startTouchY);
        if (dx > TOUCH_FILL_MOVE_TOLERANCE_PX || dy > TOUCH_FILL_MOVE_TOLERANCE_PX) {
          clearTouchFillTimer();
        }
        return;
      }

      event.preventDefault();
      updateTouchFillTarget(touch.clientX, touch.clientY);
    };
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    return () => window.removeEventListener("touchmove", handleTouchMove);
  }, []);

  useEffect(() => {
    if (!supabase || !gameId || !monitoredTeamScope) return undefined;
    const channel = supabase
      .channel(`rotations-${monitoredTeamScope}-${gameId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: ROTATIONS_TABLE,
          filter: `scope_type=eq.${ROTATIONS_SCOPE_SAVED_LINEUPS}`,
        },
        (payload) => {
          const row = payload.new || payload.old;
          if (!row || row.scope_key !== globalScopeKey(monitoredTeamScope)) return;
          const parsed = parseSharedStateRow(row);
          applyRemoteSavedLineups({
            updatedAt: parsed.updatedAt,
            lineups: normalizeSavedLineups(parsed.payload?.lineups),
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: ROTATIONS_TABLE,
          filter: `scope_type=eq.${ROTATIONS_SCOPE_DEPTH_TEMPLATE}`,
        },
        (payload) => {
          const row = payload.new || payload.old;
          if (!row || row.scope_key !== globalScopeKey(monitoredTeamScope)) return;
          const parsed = parseSharedStateRow(row);
          applyRemoteDepthTemplate({
            updatedAt: parsed.updatedAt,
            depthChart: parsed.payload?.depthChart,
            sourceGameId: parsed.payload?.sourceGameId,
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: ROTATIONS_TABLE,
          filter: `scope_type=eq.${ROTATIONS_SCOPE_GAME}`,
        },
        (payload) => {
          const row = payload.new || payload.old;
          if (!row || row.scope_key !== String(gameId)) return;
          const parsed = parseSharedStateRow(row);
          applyRemoteGameState({
            updatedAt: Number(parsed.payload?.updatedAt || parsed.updatedAt || 0),
            state: normalizeGameState(parsed.payload, monitoredTeamScope),
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId, monitoredTeamScope]);

  const getRowValues = (quarter, minuteIndex) => (lineups[quarter]?.[minuteIndex] || []);

  const getPreviousRowValues = (quarter, minuteIndex) => {
    if (minuteIndex > 0) return getRowValues(quarter, minuteIndex - 1);
    if (quarter > 1) return getRowValues(quarter - 1, MINUTES.length - 1);
    return null;
  };

  const getNextRowValues = (quarter, minuteIndex) => {
    if (minuteIndex < MINUTES.length - 1) return getRowValues(quarter, minuteIndex + 1);
    if (quarter < 4) return getRowValues(quarter + 1, 0);
    return null;
  };

  if (isLoading) {
    return <div className={styles.stateMessage}>Loading rotations...</div>;
  }

  if (error || !game) {
    return <div className={styles.stateMessage}>Unable to load rotations.</div>;
  }

  if (!rotationsAvailable) {
    return (
      <div className={`${styles.page} ${isDepthCellPressActive ? styles.pageSelectionLock : ""}`}>
        <div className={styles.topRow}>
          <Link className={styles.backButton} to={backUrl}>Back</Link>
        </div>
        <div className={styles.stateMessage}>Rotations is available only for Mystics games.</div>
      </div>
    );
  }

  return (
    <div className={`${styles.page} ${isTouchFillActive ? styles.touchFillLock : ""}`}>
      <div className={styles.topRow}>
        <Link className={styles.backButton} to={backUrl}>Back</Link>
        <div className={styles.controlsColumn}>
          <div className={styles.topRowActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleExportPdf}
            >
              Export PDF
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={undoLastLineupChange}
              disabled={!undoDepth}
            >
              Undo
            </button>
            <button type="button" className={styles.secondaryButton} onClick={() => setResetModalOpen(true)}>
              Reset Minutes
            </button>
          </div>
          <div className={styles.versionSelectWrap} ref={versionMenuRef}>
            <div className={styles.versionLabel}>Version</div>
            <button
              type="button"
              className={styles.versionTrigger}
              onClick={() => setVersionMenuOpen((current) => !current)}
            >
              <span>{activeVersion.name}</span>
              <span className={styles.versionChevron}>{versionMenuOpen ? "▴" : "▾"}</span>
            </button>
            {versionMenuOpen && (
              <div className={styles.versionMenu}>
                {versionOptions.map((version) => (
                  <div key={version.id} className={styles.versionMenuRow}>
                    <button
                      type="button"
                      className={`${styles.versionMenuItem} ${version.id === activeVersionId ? styles.versionMenuItemActive : ""}`}
                      onClick={() => setActiveVersionId(version.id)}
                    >
                      {version.name}
                    </button>
                    {version.id !== FINAL_VERSION_ID && (
                      <button
                        type="button"
                        className={styles.versionDeleteButton}
                        onClick={() => setDeleteVersionTarget(version)}
                      >
                        X
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className={styles.versionCreateButton}
                  onClick={openCreateVersionModal}
                >
                  Create New Version
                </button>
              </div>
            )}
          </div>
          <div className={styles.optionsWrap}>
            <button
              type="button"
              className={styles.optionsToggle}
              onClick={() => setOptionsOpen((current) => !current)}
            >
              <span className={styles.optionsBullet}>{optionsOpen ? "▾" : "▸"}</span>
              <span>Options</span>
            </button>
            {optionsOpen && (
              <div className={styles.optionsPanel}>
                <label className={styles.optionRow}>
                  <input
                    type="checkbox"
                    checked={versionDisplayOptions.hideNamesOnDuplicateRows}
                    onChange={(event) => updateActiveVersionOptions("hideNamesOnDuplicateRows", event.target.checked)}
                  />
                  <span>Hide Names on Duplicate Rows</span>
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      {syncError ? (
        <div className={styles.stateMessage} style={{ marginBottom: 12 }}>
          Sync issue: {syncError}
        </div>
      ) : null}

      {resetModalOpen && (
        <div className={styles.modalOverlay} onClick={() => setResetModalOpen(false)}>
          <div className={styles.modalCard} onClick={(event) => event.stopPropagation()}>
            <h3 className={styles.modalTitle}>Reset Minutes</h3>
            <button type="button" className={styles.modalPrimary} onClick={resetAll}>
              Reset All
            </button>
            <button type="button" className={styles.modalPrimary} onClick={resetToStarters}>
              Reset to Starters
            </button>
            <button type="button" className={styles.modalSecondary} onClick={() => setResetModalOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {confirmResetTarget && (
        <div className={styles.modalOverlay} onClick={closeResetConfirmation}>
          <div className={styles.modalCard} onClick={(event) => event.stopPropagation()}>
            <h3 className={styles.modalTitle}>
              {confirmResetTarget.type === "depth"
                ? "Reset Depth Chart?"
                : `Reset Q${confirmResetTarget.quarter} Minutes?`}
            </h3>
            <button type="button" className={styles.modalPrimary} onClick={confirmResetAction}>
              Yes, Reset
            </button>
            <button type="button" className={styles.modalSecondary} onClick={closeResetConfirmation}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {createVersionOpen && (
        <div className={styles.modalOverlay} onClick={() => setCreateVersionOpen(false)}>
          <div className={styles.modalCard} onClick={(event) => event.stopPropagation()}>
            <h3 className={styles.modalTitle}>Create New Version</h3>
            <input
              className={styles.versionNameInput}
              value={createVersionName}
              onChange={(event) => setCreateVersionName(event.target.value)}
              placeholder="Version name"
            />
            <div className={styles.modalOptionRow}>
              <button
                type="button"
                className={styles.modalPrimary}
                onClick={() => createVersion("blank")}
                disabled={!createVersionName.trim()}
              >
                Start From Blank
              </button>
              <button
                type="button"
                className={styles.modalPrimary}
                onClick={() => createVersion("copy")}
                disabled={!createVersionName.trim()}
              >
                Copy Current Version
              </button>
            </div>
            <button type="button" className={styles.modalSecondary} onClick={() => setCreateVersionOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {deleteVersionTarget && (
        <div className={styles.modalOverlay} onClick={() => setDeleteVersionTarget(null)}>
          <div className={styles.modalCard} onClick={(event) => event.stopPropagation()}>
            <h3 className={styles.modalTitle}>{`Delete "${deleteVersionTarget.name}"?`}</h3>
            <button type="button" className={styles.modalPrimary} onClick={confirmDeleteVersion}>
              Yes, Delete
            </button>
            <button type="button" className={styles.modalSecondary} onClick={() => setDeleteVersionTarget(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {createSavedLineupTarget && (
        <div className={styles.modalOverlay} onClick={() => setCreateSavedLineupTarget(null)}>
          <div className={styles.modalCard} onClick={(event) => event.stopPropagation()}>
            <h3 className={styles.modalTitle}>Save Lineup</h3>
            <input
              className={styles.versionNameInput}
              value={savedLineupName}
              onChange={(event) => setSavedLineupName(event.target.value)}
              placeholder="Lineup name"
            />
            <button
              type="button"
              className={styles.modalPrimary}
              onClick={confirmCreateSavedLineup}
              disabled={!savedLineupName.trim()}
            >
              Save
            </button>
            <button type="button" className={styles.modalSecondary} onClick={() => setCreateSavedLineupTarget(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {deleteSavedLineupTarget && (
        <div className={styles.modalOverlay} onClick={() => setDeleteSavedLineupTarget(null)}>
          <div className={styles.modalCard} onClick={(event) => event.stopPropagation()}>
            <h3 className={styles.modalTitle}>{`Delete "${deleteSavedLineupTarget.name}"?`}</h3>
            <button type="button" className={styles.modalPrimary} onClick={confirmDeleteSavedLineup}>
              Yes, Delete
            </button>
            <button type="button" className={styles.modalSecondary} onClick={() => setDeleteSavedLineupTarget(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {depthCellConfirmTarget && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            clearDepthCellPress();
            setDepthCellConfirmTarget(null);
          }}
        >
          <div className={styles.modalCard} onClick={(event) => event.stopPropagation()}>
            <h3 className={styles.modalTitle}>
              Mark{" "}
              <span
                className={
                  depthCellConfirmTarget.mode === "active"
                    ? styles.activeConfirmWord
                    : styles.outConfirmWord
                }
              >
                {depthCellConfirmTarget.mode === "active" ? "ACTIVE" : "OUT"}
              </span>
              ?
            </h3>
            <button
              type="button"
              className={styles.modalPrimary}
              onClick={confirmDepthCellStateChange}
            >
              {depthCellConfirmTarget.mode === "active" ? "Mark ACTIVE?" : "OK"}
            </button>
            <button
              type="button"
              className={styles.modalSecondary}
              onClick={() => {
                clearDepthCellPress();
                setDepthCellConfirmTarget(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {savedLineupMenu && (
        <div
          ref={savedLineupMenuRef}
          className={styles.savedLineupMenu}
          style={{ top: savedLineupMenu.top, left: savedLineupMenu.left }}
        >
          {savedLineups.map((savedLineup) => (
            <div key={savedLineup.id} className={styles.savedLineupMenuRow}>
              <button
                type="button"
                className={styles.savedLineupMenuItem}
                onClick={() => {
                  applySavedLineupToRow(savedLineupMenu.quarter, savedLineupMenu.minuteIndex, savedLineup.players);
                  setSavedLineupMenu(null);
                }}
              >
                {savedLineup.name}
              </button>
              <button
                type="button"
                className={styles.savedLineupDeleteButton}
                onClick={() => setDeleteSavedLineupTarget(savedLineup)}
                aria-label={`Delete saved lineup ${savedLineup.name}`}
              >
                X
              </button>
            </div>
          ))}
          <button
            type="button"
            className={`${styles.savedLineupCreateButton} ${styles.savedLineupCreateButtonPrimary}`}
            onClick={() => openCreateSavedLineupModal({
              quarter: savedLineupMenu.quarter,
              minuteIndex: savedLineupMenu.minuteIndex,
            })}
          >
            Save Lineup
          </button>
          <button
            type="button"
            className={`${styles.savedLineupCreateButton} ${styles.savedLineupCreateButtonDanger}`}
            onClick={() => {
              clearLineupRow(savedLineupMenu.quarter, savedLineupMenu.minuteIndex);
              setSavedLineupMenu(null);
            }}
          >
            Clear Row
          </button>
        </div>
      )}

      <header className={styles.header}>
        <h1 className={styles.title}>{opponentLine}</h1>
      </header>

      <section className={styles.sheetSection}>
        <div className={styles.sectionHeaderRow}>
          <button type="button" className={styles.sectionHeaderButton} onClick={() => toggleSection("restrictions")}>
            Restrictions / Totals
          </button>
          <button
            type="button"
            className={styles.sectionHeaderAction}
            onClick={openPlayersEditor}
          >
            Edit Players
          </button>
        </div>
        {!collapsed.restrictions && (
          <table className={styles.totalsTable}>
            <thead>
              <tr>
                <th>Player</th>
                <th>Cap</th>
                <th>1st</th>
                <th>2nd</th>
                <th>3rd</th>
                <th>4th</th>
                <th>Tot</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => {
                const name = normalizeName(player.display || player.name);
                const cap = Number(player.cap) || 0;
                const q1 = name ? (quarterCounts[1]?.[name] || 0) : 0;
                const q2 = name ? (quarterCounts[2]?.[name] || 0) : 0;
                const q3 = name ? (quarterCounts[3]?.[name] || 0) : 0;
                const q4 = name ? (quarterCounts[4]?.[name] || 0) : 0;
                const totalCount = name ? (totalCounts[name] || 0) : 0;
                let totalClassName = "";
                if (name && totalCount > cap) totalClassName = styles.overCapCell;
                else if (name && totalCount >= Math.max(0, cap - 5)) totalClassName = styles.nearCapCell;

                return (
                  <tr key={`totals-row-${player.id}`}>
                    <td className={styles.playerNameCell}>{player.display || player.name}</td>
                    <td>
                      <input
                        className={styles.capInput}
                        type="number"
                        min="0"
                        value={player.cap}
                        onChange={(event) => updatePlayerField(player.id, "cap", event.target.value)}
                        aria-label={`Cap for ${name || player.id}`}
                      />
                    </td>
                    <td>{q1}</td>
                    <td>{q2}</td>
                    <td>{q3}</td>
                    <td>{q4}</td>
                    <td className={totalClassName}>{totalCount}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td />
                <td className={quarterTotals[1] !== TOTAL_PER_QUARTER ? styles.badTotalCell : ""}>{quarterTotals[1]}</td>
                <td className={quarterTotals[2] !== TOTAL_PER_QUARTER ? styles.badTotalCell : ""}>{quarterTotals[2]}</td>
                <td className={quarterTotals[3] !== TOTAL_PER_QUARTER ? styles.badTotalCell : ""}>{quarterTotals[3]}</td>
                <td className={quarterTotals[4] !== TOTAL_PER_QUARTER ? styles.badTotalCell : ""}>{quarterTotals[4]}</td>
                <td className={allQuarterTotal !== TOTAL_PER_QUARTER * 4 ? styles.badTotalCell : ""}>{allQuarterTotal}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>

      {playersOpen && (
        <div className={styles.modalOverlay}>
          <div className={`${styles.modalCard} ${styles.playersModalCard}`} onClick={(event) => event.stopPropagation()}>
            <div className={styles.playersModalHeader}>
              <h3 className={styles.playersModalTitle}>Edit Players</h3>
              <div className={styles.playersModalHeaderActions}>
                <button type="button" className={styles.playersModalCancel} onClick={cancelPlayersEditor}>Cancel</button>
                <button type="button" className={styles.playersModalDone} onClick={saveAllPlayerEdits}>Done</button>
              </div>
            </div>
            <div className={styles.playersGridHeader}>
              <span>Name</span>
              <span>Display</span>
              <span>Player ID</span>
              <span>Actions</span>
            </div>
            <div className={styles.playersRows}>
              {sortedPlayers.map((player) => {
                const draft = playerDrafts[player.id] || { name: player.name, display: player.display || player.name, personId: player.personId || "" };
                return (
                  <div key={player.id} className={styles.playersRow}>
                    <input
                      className={styles.playersTextInput}
                      value={draft.name}
                      onChange={(event) => setPlayerDrafts((current) => ({
                        ...current,
                        [player.id]: { ...draft, name: event.target.value },
                      }))}
                    />
                    <input
                      className={styles.playersTextInput}
                      value={draft.display}
                      onChange={(event) => setPlayerDrafts((current) => ({
                        ...current,
                        [player.id]: { ...draft, display: event.target.value },
                      }))}
                    />
                    <input
                      className={styles.playersTextInput}
                      value={draft.personId || ""}
                      onChange={(event) => setPlayerDrafts((current) => ({
                        ...current,
                        [player.id]: { ...draft, personId: event.target.value },
                      }))}
                      placeholder="e.g. 203078"
                    />
                    <div className={styles.playersRowActions}>
                      <button
                        type="button"
                        className={`${styles.playersIconButton} ${styles.playersIconDelete}`}
                        onClick={() => handleDeletePlayer(player.id)}
                        aria-label="Delete player"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
              <div className={styles.playersRow}>
                <input
                  className={styles.playersTextInput}
                  value={newPlayerDraft.name}
                  onChange={(event) => setNewPlayerDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Player name"
                />
                <input
                  className={styles.playersTextInput}
                  value={newPlayerDraft.display}
                  onChange={(event) => setNewPlayerDraft((current) => ({ ...current, display: event.target.value }))}
                  placeholder="Nickname / initials"
                />
                <input
                  className={styles.playersTextInput}
                  value={newPlayerDraft.personId || ""}
                  onChange={(event) => setNewPlayerDraft((current) => ({ ...current, personId: event.target.value }))}
                  placeholder="Player ID"
                />
                <div className={styles.playersRowActions}>
                  <button
                    type="button"
                    className={`${styles.playersIconButton} ${styles.playersIconSave}`}
                    onClick={handleAddPlayer}
                    aria-label="Add player"
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    className={`${styles.playersIconButton} ${styles.playersIconDelete}`}
                    onClick={() => setNewPlayerDraft({ name: "", display: "", personId: "" })}
                    aria-label="Clear new player"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <section className={styles.sheetSection}>
        <div className={styles.sectionHeaderRow}>
          <button type="button" className={styles.sectionHeaderButton} onClick={() => toggleSection("depth")}>
            Depth Chart
          </button>
          <button
            type="button"
            className={styles.sectionHeaderAction}
            onClick={backUpDepthChartNow}
          >
            Sync
          </button>
          <button
            type="button"
            className={styles.sectionHeaderAction}
            onClick={() => openResetConfirmation({ type: "depth" })}
          >
            Reset Depth Chart
          </button>
        </div>
        {!collapsed.depth && (
          <table className={styles.depthTable}>
            <thead>
              <tr>
                {POSITION_COLUMNS.map((position) => <th key={`depth-head-${position}`}>{position}</th>)}
              </tr>
            </thead>
            <tbody>
              {DEPTH_ROW_INDICES.map((rowIndex) => (
                <tr key={`depth-row-${rowIndex}`}>
                  {POSITION_COLUMNS.map((position) => {
                    const columnIndex = position - 1;
                    const value = depthChart[rowIndex]?.[columnIndex] || "";
                    const depthCell = parseDepthChartCell(value);
                    return (
                      <td
                        key={`depth-cell-${rowIndex}-${position}`}
                        className={depthCell.isOut ? styles.outDepthCell : ""}
                        onPointerDown={(event) => startDepthCellPress(event, rowIndex, columnIndex, value)}
                        onPointerUp={releaseDepthCellPress}
                        onPointerLeave={releaseDepthCellPress}
                        onPointerCancel={releaseDepthCellPress}
                        onPointerMove={moveDepthCellPress}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          openDepthCellConfirm(rowIndex, columnIndex, value);
                        }}
                      >
                        <select
                          className={`${styles.playerSelect} ${depthCell.isOut ? styles.outPlayerSelect : ""}`}
                          value={value}
                          onChange={(event) => updateDepthCell(rowIndex, columnIndex, event.target.value)}
                          onMouseDown={(event) => {
                            if (event.button === 2) {
                              event.preventDefault();
                            }
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            openDepthCellConfirm(rowIndex, columnIndex, value);
                          }}
                        >
                          {depthCell.isOut ? (
                            <option value={depthCell.raw}>{depthCell.name}</option>
                          ) : null}
                          <option value=""> </option>
                          {playerOptions.map((option) => (
                            <option key={`depth-${rowIndex}-${position}-${option}`} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {QUARTERS.map((quarter) => {
        const sectionKey = `q${quarter}`;
        return (
          <section key={quarter} className={styles.sheetSection}>
            <div className={styles.sectionHeaderRow}>
              <button type="button" className={styles.sectionHeaderButton} onClick={() => toggleSection(sectionKey)}>
                {quarterLabel(quarter)} Quarter
              </button>
              <button
                type="button"
                className={styles.sectionHeaderAction}
                onClick={() => openResetConfirmation({ type: "quarter", quarter })}
              >
                {`Reset Q${quarter} Minutes`}
              </button>
            </div>
            {!collapsed[sectionKey] && (
              <table className={styles.rotationTable}>
                <thead>
                  <tr>
                    <th>Time</th>
                    {POSITION_COLUMNS.map((position) => <th key={`pos-${quarter}-${position}`}>{position}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {MINUTES.map((minute, minuteIndex) => {
                    const rowValues = lineups[quarter]?.[minuteIndex] || [];
                    const previousRowValues = getPreviousRowValues(quarter, minuteIndex);
                    const nextRowValues = getNextRowValues(quarter, minuteIndex);

                    return (
                      <tr key={`minute-row-${quarter}-${minute}`}>
                        <td
                          className={styles.minuteCell}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            openSavedLineupMenu(quarter, minuteIndex, event.currentTarget.getBoundingClientRect());
                          }}
                          onPointerDown={(event) => startSavedLineupPress(event, quarter, minuteIndex)}
                          onPointerUp={() => cancelSavedLineupPress()}
                          onPointerLeave={() => cancelSavedLineupPress()}
                          onPointerCancel={() => cancelSavedLineupPress()}
                          onPointerMove={(event) => {
                            if (!savedLineupPressRef.current.timerId) return;
                            const dx = Math.abs(event.clientX - savedLineupPressRef.current.startX);
                            const dy = Math.abs(event.clientY - savedLineupPressRef.current.startY);
                            if (dx > 8 || dy > 8) cancelSavedLineupPress();
                          }}
                        >
                          {minute}
                        </td>
                        {POSITION_COLUMNS.map((position) => {
                          const positionIndex = position - 1;
                          const cellState = getQuarterCellState({
                            rowValues,
                            previousRowValues,
                            nextRowValues,
                            positionIndex,
                            hideNamesOnDuplicateRows: versionDisplayOptions.hideNamesOnDuplicateRows,
                            minuteIndex,
                          });

                          const cellClassName = [
                            cellState.hasDuplicate && cellState.value ? styles.duplicateCell : "",
                            !cellState.hideRowNames && cellState.isSubOut ? styles.subOutCell : "",
                            cellState.isSubIn ? styles.subInCell : "",
                            cellState.hideRowNames && cellState.normalizedValue ? styles.hiddenNameCell : "",
                            isInTouchPreviewRange(quarter, minuteIndex, positionIndex) ? styles.touchPreviewCell : "",
                          ].filter(Boolean).join(" ");

                          return (
                            <td
                              key={`lineup-cell-${quarter}-${minute}-${position}`}
                              className={cellClassName}
                              data-quarter={quarter}
                              data-minute-index={minuteIndex}
                              data-position-index={positionIndex}
                              onTouchStart={(event) => {
                                if (touchFillRef.current.active) return;
                                if (!cellState.normalizedValue) return;
                                const touch = event.touches?.[0];
                                if (!touch) return;
                                clearTouchFillTimer();
                                touchFillRef.current.startTouchX = touch.clientX;
                                touchFillRef.current.startTouchY = touch.clientY;
                                touchFillRef.current.quarter = quarter;
                                touchFillRef.current.value = cellState.normalizedValue;
                                touchFillRef.current.originMinuteIndex = minuteIndex;
                                touchFillRef.current.originPositionIndex = positionIndex;
                                touchFillRef.current.endMinuteIndex = minuteIndex;
                                touchFillRef.current.endPositionIndex = positionIndex;
                                touchFillRef.current.timerId = window.setTimeout(() => {
                                  touchFillRef.current.active = true;
                                  setIsTouchFillActive(true);
                                  touchFillRef.current.timerId = null;
                                  setTouchPreview({
                                    quarter,
                                    startMinuteIndex: minuteIndex,
                                    startPositionIndex: positionIndex,
                                    endMinuteIndex: minuteIndex,
                                    endPositionIndex: positionIndex,
                                  });
                                }, LONG_PRESS_DURATION_MS);
                              }}
                              onTouchMove={(event) => {
                                const touch = event.touches?.[0];
                                if (!touch) return;

                                if (!touchFillRef.current.active) {
                                  const dx = Math.abs(touch.clientX - touchFillRef.current.startTouchX);
                                  const dy = Math.abs(touch.clientY - touchFillRef.current.startTouchY);
                                  if (dx > TOUCH_FILL_MOVE_TOLERANCE_PX || dy > TOUCH_FILL_MOVE_TOLERANCE_PX) clearTouchFillTimer();
                                  return;
                                }

                                event.preventDefault();
                                updateTouchFillTarget(touch.clientX, touch.clientY);
                              }}
                              onTouchEnd={(event) => {
                                if (touchFillRef.current.active) {
                                  event.preventDefault();
                                  commitTouchFill();
                                }
                                stopTouchFill();
                              }}
                              onTouchCancel={() => {
                                stopTouchFill();
                              }}
                            >
                              <select
                                className={styles.playerSelect}
                                value={cellState.value}
                                onChange={(event) => updateLineupCell(quarter, minuteIndex, positionIndex, event.target.value)}
                                onMouseDown={(event) => {
                                  if (!event.shiftKey || !cellState.normalizedValue) return;
                                  event.preventDefault();
                                  dragFillRef.current = {
                                    active: true,
                                    quarter,
                                    value: cellState.normalizedValue,
                                    originMinuteIndex: minuteIndex,
                                    originPositionIndex: positionIndex,
                                    lastMinuteIndex: minuteIndex,
                                    lastPositionIndex: positionIndex,
                                  };
                                }}
                                onMouseEnter={() => {
                                  const drag = dragFillRef.current;
                                  if (!drag.active || drag.quarter !== quarter) return;
                                  if (drag.lastMinuteIndex === minuteIndex && drag.lastPositionIndex === positionIndex) return;
                                  drag.lastMinuteIndex = minuteIndex;
                                  drag.lastPositionIndex = positionIndex;
                                  fillLineupRange(
                                    quarter,
                                    drag.originMinuteIndex,
                                    drag.originPositionIndex,
                                    minuteIndex,
                                    positionIndex,
                                    drag.value
                                  );
                                }}
                              >
                                <option value=""> </option>
                                {playerOptions.map((option) => (
                                  <option key={`${quarter}-${minute}-${position}-${option}`} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}
