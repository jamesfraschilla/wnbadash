import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { fetchGame } from "../api.js";
import {
  fetchRemotePregamePlayers,
  getTeamBoxScorePlayers,
  getPregameTeamScope,
  isCapitalCityTeam,
  isWashingtonTeam,
  linkPregamePlayersToApiPlayers,
  loadPregamePlayersPayload,
  normalizePregamePlayerName,
  persistPregamePlayers,
  resolveSharedPregamePlayersPayload,
  saveRemotePregamePlayers,
} from "../pregamePlayers.js";
import { supabase } from "../supabaseClient.js";
import { readLocalStorage, writeLocalStorage } from "../storage.js";
import wizardsLogoUrl from "../assets/WWizards_Primary_Icon.png";
import dinFontUrl from "../assets/fonts/DIN.ttf";
import styles from "./PreGame.module.css";

const SLOT_STORAGE_PREFIX = "pregame:slots:v1:";
const SLOT_TEMPLATE_KEY = "pregame:slot-template:v1";
const PREGAME_GLOBAL_TEMPLATE_GAME_ID = "9999999902";
const PREGAME_ACTION_PAYLOAD = 900000001;
const TEAM_TIME_ZONES = {
  ATL: "America/New_York",
  BKN: "America/New_York",
  BOS: "America/New_York",
  CHA: "America/New_York",
  CHI: "America/Chicago",
  CLE: "America/New_York",
  DAL: "America/Chicago",
  DEN: "America/Denver",
  DET: "America/New_York",
  GSW: "America/Los_Angeles",
  HOU: "America/Chicago",
  IND: "America/New_York",
  LAC: "America/Los_Angeles",
  LAL: "America/Los_Angeles",
  MEM: "America/Chicago",
  MIA: "America/New_York",
  MIL: "America/Chicago",
  MIN: "America/Chicago",
  NOP: "America/Chicago",
  NYK: "America/New_York",
  OKC: "America/Chicago",
  ORL: "America/New_York",
  PHI: "America/New_York",
  PHX: "America/Phoenix",
  POR: "America/Los_Angeles",
  SAC: "America/Los_Angeles",
  SAS: "America/Chicago",
  TOR: "America/Toronto",
  UTA: "America/Denver",
  WAS: "America/New_York",
};

const EXPORT_SPECS = {
  portrait: { logicalWidth: 384, logicalHeight: 648, outputWidth: 1536, outputHeight: 2592 },
  landscape: { logicalWidth: 660, logicalHeight: 510, outputWidth: 3300, outputHeight: 2550 },
  was: { outputWidth: 3840, outputHeight: 2160, boxX: 0, boxY: 0, boxWidth: 802, boxHeight: 1300 },
};

let exportFontsPromise = null;

function readThemeMode() {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function getExportColors(themeMode) {
  const dark = themeMode === "dark";
  return {
    background: dark ? "#000000" : "#ffffff",
    chromeText: dark ? "#ffffff" : "#000000",
    timeBg: "#000000",
    timeText: "#ffffff",
    cellBg: "#d3d3d3",
    cellText: "#000000",
    border: "#e5e7eb",
  };
}

function getLastName(name) {
  const parts = normalizePregamePlayerName(name).split(" ").filter(Boolean);
  return parts.length ? parts[parts.length - 1].toLowerCase() : "";
}

function sortPlayersByLastName(players) {
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

function normalizeSlots(rawSlots) {
  return (Array.isArray(rawSlots) ? rawSlots : [])
    .map((slot) => ({
      id: String(slot?.id || crypto.randomUUID()),
      time: String(slot?.time || ""),
      playerIds: Array.isArray(slot?.playerIds)
        ? slot.playerIds.slice(0, 3).map((value) => String(value || ""))
        : ["", ""],
    }))
    .filter((slot) => slot.time);
}

function normalizeTemplate(rawTemplate) {
  const count = Math.max(1, Number(rawTemplate?.count || 8));
  const playerGroups = Array.isArray(rawTemplate?.playerGroups)
    ? rawTemplate.playerGroups.map((group) => (Array.isArray(group) ? group.slice(0, 3).map((value) => String(value || "")) : ["", ""]))
    : [];
  return { count, playerGroups };
}

function slotsHaveAssignments(slots) {
  return (Array.isArray(slots) ? slots : []).some((slot) =>
    (Array.isArray(slot?.playerIds) ? slot.playerIds : []).some((id) => String(id || "").trim())
  );
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

function slotStorageKey(gameId) {
  return `${SLOT_STORAGE_PREFIX}${gameId}`;
}

function loadSlots(gameId) {
  if (typeof window === "undefined" || !gameId) return null;
  const raw = readLocalStorage(slotStorageKey(gameId));
  if (!raw) return null;
  const parsed = safeParseJson(raw, null);
  const slots = normalizeSlots(Array.isArray(parsed) ? parsed : parsed?.slots);
  return slots.length ? slots : null;
}

function persistSlots(gameId, slots, updatedAt = Date.now()) {
  if (typeof window === "undefined" || !gameId) return;
  writeLocalStorage(slotStorageKey(gameId), JSON.stringify({
    updatedAt,
    slots,
  }));
}

function loadSlotsPayload(gameId) {
  if (typeof window === "undefined" || !gameId) return null;
  const raw = readLocalStorage(slotStorageKey(gameId));
  if (!raw) return null;
  const parsed = safeParseJson(raw, null);
  if (Array.isArray(parsed)) {
    return { updatedAt: 0, slots: normalizeSlots(parsed) };
  }
  if (!parsed || typeof parsed !== "object") return null;
  return {
    updatedAt: Number(parsed.updatedAt || 0),
    slots: normalizeSlots(parsed.slots),
  };
}

function loadSlotTemplate() {
  if (typeof window === "undefined") return null;
  const raw = readLocalStorage(SLOT_TEMPLATE_KEY);
  if (!raw) return null;
  const parsed = safeParseJson(raw, null);
  if (Array.isArray(parsed?.playerGroups) || Number.isFinite(parsed?.count)) {
    return normalizeTemplate(parsed);
  }
  if (parsed && typeof parsed === "object" && parsed.template) {
    return normalizeTemplate(parsed.template);
  }
  return null;
}

function persistSlotTemplate(slots, updatedAt = Date.now()) {
  if (typeof window === "undefined") return;
  writeLocalStorage(SLOT_TEMPLATE_KEY, JSON.stringify({
    updatedAt,
    template: {
      count: Math.max(1, slots.length),
      playerGroups: slots.map((slot) => slot.playerIds.slice(0, 3)),
    },
  }));
}

function loadTemplatePayload() {
  if (typeof window === "undefined") return null;
  const raw = readLocalStorage(SLOT_TEMPLATE_KEY);
  if (!raw) return null;
  const parsed = safeParseJson(raw, null);
  if (parsed && typeof parsed === "object" && parsed.template) {
    return {
      updatedAt: Number(parsed.updatedAt || 0),
      template: normalizeTemplate(parsed.template),
    };
  }
  if (parsed && typeof parsed === "object") {
    return {
      updatedAt: 0,
      template: normalizeTemplate(parsed),
    };
  }
  return null;
}

async function fetchRemoteSchedule(gameId) {
  if (!supabase || !gameId) return null;
  const { data, error } = await supabase
    .from("pbp_highlights")
    .select("note")
    .eq("game_id", String(gameId))
    .eq("action_number", PREGAME_ACTION_PAYLOAD)
    .maybeSingle();
  if (error) return null;
  const payload = parseRemotePayload(data?.note, "slots");
  return {
    updatedAt: payload.updatedAt,
    slots: normalizeSlots(payload.value),
  };
}

async function fetchRemoteTemplate() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("pbp_highlights")
    .select("note")
    .eq("game_id", PREGAME_GLOBAL_TEMPLATE_GAME_ID)
    .eq("action_number", PREGAME_ACTION_PAYLOAD)
    .maybeSingle();
  if (error) return null;
  const payload = parseRemotePayload(data?.note, "template");
  return {
    updatedAt: payload.updatedAt,
    template: normalizeTemplate(payload.value),
  };
}

async function saveRemoteSchedule(gameId, slots, updatedAt = Date.now()) {
  if (!supabase || !gameId) return;
  const { error } = await supabase.from("pbp_highlights").upsert(
    {
      game_id: String(gameId),
      action_number: PREGAME_ACTION_PAYLOAD,
      note: JSON.stringify({
        updatedAt,
        slots,
      }),
    },
    { onConflict: "game_id,action_number" }
  );
  if (error) throw error;
}

async function saveRemoteTemplate(slots, updatedAt = Date.now()) {
  if (!supabase) return;
  const { error } = await supabase.from("pbp_highlights").upsert(
    {
      game_id: PREGAME_GLOBAL_TEMPLATE_GAME_ID,
      action_number: PREGAME_ACTION_PAYLOAD,
      note: JSON.stringify({
        updatedAt,
        template: {
          count: Math.max(1, slots.length),
          playerGroups: slots.map((slot) => slot.playerIds.slice(0, 3)),
        },
      }),
    },
    { onConflict: "game_id,action_number" }
  );
  if (error) throw error;
}

function getGameTimeZone(game) {
  const homeTricode = String(game?.homeTeam?.teamTricode || "").toUpperCase();
  return TEAM_TIME_ZONES[homeTricode] || "America/New_York";
}

function formatTime(dateValue, timeZone = "America/New_York") {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const parts = formatter.formatToParts(dateValue);
    const hour = parts.find((part) => part.type === "hour")?.value;
    const minute = parts.find((part) => part.type === "minute")?.value;
    if (hour && minute) return `${hour}:${minute}`;
  } catch {
    // Fall through to local formatting below.
  }
  return format(dateValue, "h:mm");
}

function parseGameStart(game) {
  const utcValue = game?.gameTimeUTC;
  const etValue = game?.gameEt;
  const candidates = [utcValue, etValue].filter(Boolean);
  for (const candidate of candidates) {
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function buildDefaultSlots(game, count = 8) {
  const start = parseGameStart(game);
  const timeZone = getGameTimeZone(game);
  const finalSlot = new Date(start.getTime() - (45 * 60 * 1000));
  const firstSlot = new Date(finalSlot.getTime() - ((count - 1) * 15 * 60 * 1000));
  return Array.from({ length: count }, (_, index) => {
    const slotTime = new Date(firstSlot.getTime() + (index * 15 * 60 * 1000));
    return {
      id: crypto.randomUUID(),
      time: formatTime(slotTime, timeZone),
      playerIds: ["", ""],
    };
  });
}

function buildSlotsFromTemplate(game, template) {
  const count = Math.max(1, Number(template?.count || 8));
  const seeded = buildDefaultSlots(game, count);
  return seeded.map((slot, index) => ({
    ...slot,
    playerIds: Array.isArray(template?.playerGroups?.[index])
      ? template.playerGroups[index].slice(0, 3).map((value) => String(value || ""))
      : ["", ""],
  }));
}

function buildSlotsWithLocalTimes(game, slots) {
  const normalizedSlots = normalizeSlots(slots);
  const seeded = buildDefaultSlots(game, Math.max(1, normalizedSlots.length || 8));
  return seeded.map((slot, index) => ({
    ...slot,
    playerIds: Array.isArray(normalizedSlots[index]?.playerIds)
      ? normalizedSlots[index].playerIds.slice(0, 3).map((value) => String(value || ""))
      : ["", ""],
  }));
}

function ensureExportFonts() {
  if (typeof document === "undefined" || typeof FontFace === "undefined") {
    return Promise.resolve();
  }
  if (exportFontsPromise) return exportFontsPromise;

  const loadFont = async (family, url) => {
    const loaded = Array.from(document.fonts || []).some((face) => face.family === family);
    if (loaded) return;
    const fontFace = new FontFace(family, `url(${url})`);
    await fontFace.load();
    document.fonts.add(fontFace);
  };

  exportFontsPromise = loadFont("DIN", dinFontUrl).then(() => undefined).catch(() => undefined);
  return exportFontsPromise;
}

function makeCanvas(width, height, background) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return { canvas, context };
}

function drawCenteredText(context, text, x, y, width, size, color, weight = 700) {
  context.fillStyle = color;
  context.textAlign = "center";
  context.textBaseline = "top";
  context.font = `${weight} ${size}px "DIN", sans-serif`;
  context.fillText(text, x + (width / 2), y);
}

function drawCenteredTextMiddle(context, text, x, y, width, height, size, color, weight = 700) {
  context.fillStyle = color;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `${weight} ${size}px "DIN", sans-serif`;
  context.fillText(text, x + (width / 2), y + (height / 2));
}

function drawStackedNames(context, names, x, y, width, height, size, color, weight = 700, lineHeight = size) {
  const visibleNames = (names || []).filter(Boolean);
  if (!visibleNames.length) return;
  const spacing = visibleNames.length > 1
    ? Math.max(lineHeight, Math.floor(height / (visibleNames.length + 0.45)))
    : lineHeight;
  const totalHeight = spacing * (visibleNames.length - 1) + lineHeight;
  const startY = y + ((height - totalHeight) / 2);
  visibleNames.forEach((name, index) => {
    drawCenteredTextMiddle(
      context,
      name.toUpperCase(),
      x,
      startY + (index * spacing),
      width,
      lineHeight,
      size,
      color,
      weight
    );
  });
}

function drawLandscapeExport(slots, playerById, headerLineTwo, logoImage, themeMode, scale = 1) {
  const spec = EXPORT_SPECS.landscape;
  const colors = getExportColors(themeMode);
  const { canvas, context } = makeCanvas(spec.logicalWidth * scale, spec.logicalHeight * scale, colors.background);
  context.scale(scale, scale);

  drawCenteredText(context, "PRE-GAME COURT TIME", 0, 42, spec.logicalWidth, 54, colors.chromeText, 700);
  drawCenteredText(context, headerLineTwo, 0, 108, spec.logicalWidth, 30, colors.chromeText, 700);

  const tableX = 12;
  const tableY = 172;
  const tableWidth = spec.logicalWidth - 24;
  const colCount = Math.max(1, slots.length);
  const colWidth = tableWidth / colCount;
  const timeHeight = 60;
  const rowHeight = 76;

  slots.forEach((slot, index) => {
    const x = tableX + (index * colWidth);
    context.fillStyle = colors.timeBg;
    context.fillRect(x, tableY, colWidth, timeHeight);
    context.strokeStyle = colors.border;
    context.strokeRect(x, tableY, colWidth, timeHeight);
    drawCenteredTextMiddle(context, slot.time, x, tableY, colWidth, timeHeight, 26, colors.timeText, 700);

    const row1Y = tableY + timeHeight;
    const row2Y = row1Y + rowHeight;
    const displays = slot.playerIds.slice(0, 3).map((id) => playerById.get(id)?.display || "");
    const visibleDisplays = displays.filter(Boolean);

    context.fillStyle = colors.cellBg;
    if (visibleDisplays.length >= 3) {
      context.fillRect(x, row1Y, colWidth, rowHeight * 2);
      context.strokeRect(x, row1Y, colWidth, rowHeight * 2);
      drawStackedNames(context, visibleDisplays.slice(0, 3), x, row1Y, colWidth, rowHeight * 2, 24, colors.cellText, 700, 26);
      return;
    }

    context.fillRect(x, row1Y, colWidth, rowHeight);
    context.fillRect(x, row2Y, colWidth, rowHeight);
    context.strokeRect(x, row1Y, colWidth, rowHeight);
    context.strokeRect(x, row2Y, colWidth, rowHeight);

    if (visibleDisplays[0]) {
      drawCenteredTextMiddle(context, visibleDisplays[0].toUpperCase(), x, row1Y, colWidth, rowHeight, 24, colors.cellText, 700);
    }
    if (visibleDisplays[1]) {
      drawCenteredTextMiddle(context, visibleDisplays[1].toUpperCase(), x, row2Y, colWidth, rowHeight, 24, colors.cellText, 700);
    }
  });

  if (logoImage) {
    const size = 40;
    const y = tableY + timeHeight + (rowHeight * 2) + 26;
    const x = (spec.logicalWidth - size) / 2;
    context.drawImage(logoImage, x, y, size, size);
  }

  return canvas;
}

function drawPortraitExport(slots, playerById, headerLineTwo, logoImage, themeMode, scale = 1) {
  const spec = EXPORT_SPECS.portrait;
  const colors = getExportColors(themeMode);
  const { canvas, context } = makeCanvas(spec.logicalWidth * scale, spec.logicalHeight * scale, colors.background);
  context.scale(scale, scale);

  drawCenteredText(context, "PRE-GAME COURT TIME", 0, 36, spec.logicalWidth, 44, colors.chromeText, 700);
  drawCenteredText(context, headerLineTwo.replace("@", "vs"), 0, 86, spec.logicalWidth, 27, colors.chromeText, 700);

  const tableX = 30;
  const tableY = 132;
  const tableWidth = spec.logicalWidth - 60;
  const timeColWidth = 72;
  const playerColWidth = (tableWidth - timeColWidth) / 2;
  const rowCount = Math.max(1, slots.length);
  const rowHeight = Math.floor((spec.logicalHeight - tableY - 104) / rowCount);

  slots.forEach((slot, index) => {
    const y = tableY + (index * rowHeight);

    context.fillStyle = colors.timeBg;
    context.fillRect(tableX, y, timeColWidth, rowHeight);
    context.strokeStyle = colors.border;
    context.strokeRect(tableX, y, timeColWidth, rowHeight);
    drawCenteredTextMiddle(context, slot.time, tableX, y, timeColWidth, rowHeight, 24, colors.timeText, 700);

    const x1 = tableX + timeColWidth;
    const x2 = x1 + playerColWidth;
    const displays = slot.playerIds.slice(0, 3).map((id) => playerById.get(id)?.display || "");
    const visibleDisplays = displays.filter(Boolean);

    if (visibleDisplays.length >= 3) {
      context.fillStyle = colors.cellBg;
      context.fillRect(x1, y, playerColWidth * 2, rowHeight);
      context.strokeRect(x1, y, playerColWidth * 2, rowHeight);
      drawStackedNames(context, visibleDisplays.slice(0, 3), x1, y, playerColWidth * 2, rowHeight, 24, colors.cellText, 700, 24);
      return;
    }

    context.fillStyle = colors.cellBg;
    context.fillRect(x1, y, playerColWidth, rowHeight);
    context.fillRect(x2, y, playerColWidth, rowHeight);
    context.strokeRect(x1, y, playerColWidth, rowHeight);
    context.strokeRect(x2, y, playerColWidth, rowHeight);

    if (visibleDisplays[0]) {
      drawCenteredTextMiddle(context, visibleDisplays[0].toUpperCase(), x1, y, playerColWidth, rowHeight, 24, colors.cellText, 700);
    }
    if (visibleDisplays[1]) {
      drawCenteredTextMiddle(context, visibleDisplays[1].toUpperCase(), x2, y, playerColWidth, rowHeight, 24, colors.cellText, 700);
    }
  });

  if (logoImage) {
    const size = 36;
    const x = (spec.logicalWidth - size) / 2;
    const y = spec.logicalHeight - 82;
    context.drawImage(logoImage, x, y, size, size);
  }

  return canvas;
}

function fitInside(source, targetWidth, targetHeight) {
  const scale = Math.min(targetWidth / source.width, targetHeight / source.height);
  return {
    width: source.width * scale,
    height: source.height * scale,
  };
}

async function loadImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function downloadCanvas(canvas, filename) {
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = filename;
  link.click();
}

function buildHeaderLine(game) {
  const home = game?.homeTeam;
  const away = game?.awayTeam;
  const trackedIsAway = isWashingtonTeam(away) || isCapitalCityTeam(away);
  const opponent = trackedIsAway ? home : away;
  const rawCity = String(opponent?.teamCity || "").trim();
  const rawName = String(opponent?.teamName || "").trim();
  const lowerName = rawName.toLowerCase();
  let opponentLabel = rawCity ? rawCity.toUpperCase() : "OPPONENT";
  if (rawCity.toLowerCase() === "la" || rawCity.toLowerCase() === "los angeles") {
    if (lowerName.includes("clipper")) opponentLabel = "LA CLIPPERS";
    if (lowerName.includes("laker")) opponentLabel = "LA LAKERS";
  }
  return trackedIsAway ? `@ ${opponentLabel}` : `vs ${opponentLabel}`;
}

export default function PreGame() {
  const { gameId } = useParams();
  const [params] = useSearchParams();
  const dateParam = params.get("d");
  const backUrl = dateParam ? `/g/${gameId}?d=${dateParam}` : `/g/${gameId}`;

  const { data: game, isLoading, error } = useQuery({
    queryKey: ["game-pregame", gameId],
    queryFn: () => fetchGame(gameId),
    enabled: Boolean(gameId),
  });

  const [players, setPlayers] = useState([]);
  const [slots, setSlots] = useState([]);
  const [playersOpen, setPlayersOpen] = useState(false);
  const [slotsOpen, setSlotsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [playerDrafts, setPlayerDrafts] = useState({});
  const [newPlayerDraft, setNewPlayerDraft] = useState({ name: "", display: "", personId: "" });
  const [slotDrafts, setSlotDrafts] = useState([]);
  const [inlineTimeSlotId, setInlineTimeSlotId] = useState(null);
  const [inlineTimeDraft, setInlineTimeDraft] = useState("");
  const [activePlayerCell, setActivePlayerCell] = useState(null);
  const [playersHydrated, setPlayersHydrated] = useState(false);
  const [slotsHydrated, setSlotsHydrated] = useState(false);
  const [syncError, setSyncError] = useState("");
  const playersUpdatedAtRef = useRef(0);
  const slotsUpdatedAtRef = useRef(0);
  const templateUpdatedAtRef = useRef(0);

  const trackedTeamScope = useMemo(() => getPregameTeamScope(game), [game]);

  const { data: remotePlayers, isFetched: remotePlayersFetched } = useQuery({
    queryKey: ["pregame-players-remote", trackedTeamScope],
    queryFn: () => fetchRemotePregamePlayers(trackedTeamScope),
    enabled: Boolean(supabase && trackedTeamScope),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });

  const { data: remoteSchedule, isFetched: remoteScheduleFetched } = useQuery({
    queryKey: ["pregame-schedule-remote", gameId],
    queryFn: () => fetchRemoteSchedule(gameId),
    enabled: Boolean(supabase && gameId),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });

  const { data: remoteTemplate, isFetched: remoteTemplateFetched } = useQuery({
    queryKey: ["pregame-template-remote"],
    queryFn: fetchRemoteTemplate,
    enabled: Boolean(supabase),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });

  const washingtonGame = useMemo(() => (
    isWashingtonTeam(game?.homeTeam) || isWashingtonTeam(game?.awayTeam)
  ), [game]);
  const supportedTeamGame = Boolean(trackedTeamScope);
  const trackedApiPlayers = useMemo(
    () => getTeamBoxScorePlayers(game, trackedTeamScope),
    [game, trackedTeamScope]
  );

  useEffect(() => {
    setPlayersHydrated(false);
    setSlotsHydrated(false);
  }, [gameId, trackedTeamScope]);

  useEffect(() => {
    if (playersHydrated) return;
    if (!trackedTeamScope) return;
    if (supabase && !remotePlayersFetched) return;
    const localPayload = loadPregamePlayersPayload(trackedTeamScope);
    const sharedPayload = resolveSharedPregamePlayersPayload(localPayload, remotePlayers);

    if (sharedPayload.players.length) {
      setPlayers(sharedPayload.players);
      playersUpdatedAtRef.current = sharedPayload.updatedAt;
    } else {
      setPlayers([]);
      playersUpdatedAtRef.current = Date.now();
    }
    setPlayersHydrated(true);
  }, [playersHydrated, remotePlayers, remotePlayersFetched, trackedTeamScope]);

  useEffect(() => {
    if (slotsHydrated) return;
    if (!gameId || !game) return;
    if (supabase && (!remoteScheduleFetched || !remoteTemplateFetched)) return;

    const localSchedulePayload = loadSlotsPayload(gameId);
    const localScheduleUpdatedAt = Number(localSchedulePayload?.updatedAt || 0);
    const remoteScheduleUpdatedAt = Number(remoteSchedule?.updatedAt || 0);
    const localTemplatePayload = loadTemplatePayload();
    const localTemplateUpdatedAt = Number(localTemplatePayload?.updatedAt || 0);
    const remoteTemplateUpdatedAt = Number(remoteTemplate?.updatedAt || 0);
    const selectedTemplate = remoteTemplateUpdatedAt >= localTemplateUpdatedAt
      ? remoteTemplate?.template
      : localTemplatePayload?.template;
    const templateHasAssignments = slotsHaveAssignments(
      selectedTemplate?.playerGroups?.map((playerIds) => ({ playerIds })) || []
    );

    const remoteHasAssignments = slotsHaveAssignments(remoteSchedule?.slots);
    const localHasAssignments = slotsHaveAssignments(localSchedulePayload?.slots);

    if (
      remoteSchedule?.slots?.length &&
      remoteScheduleUpdatedAt >= localScheduleUpdatedAt &&
      remoteHasAssignments
    ) {
      setSlots(remoteSchedule.slots);
      slotsUpdatedAtRef.current = remoteScheduleUpdatedAt;
      setSlotsHydrated(true);
      return;
    }

    if (localSchedulePayload?.slots?.length && localHasAssignments) {
      setSlots(localSchedulePayload.slots);
      slotsUpdatedAtRef.current = localScheduleUpdatedAt;
      setSlotsHydrated(true);
      return;
    }

    if (remoteSchedule?.slots?.length && remoteScheduleUpdatedAt >= localScheduleUpdatedAt && !remoteHasAssignments) {
      const migratedRemoteSlots = buildSlotsWithLocalTimes(game, remoteSchedule.slots);
      setSlots(migratedRemoteSlots);
      slotsUpdatedAtRef.current = remoteScheduleUpdatedAt;
      setSlotsHydrated(true);
      return;
    }

    if (localSchedulePayload?.slots?.length && !localHasAssignments) {
      const migratedLocalSlots = buildSlotsWithLocalTimes(game, localSchedulePayload.slots);
      setSlots(migratedLocalSlots);
      slotsUpdatedAtRef.current = localScheduleUpdatedAt;
      setSlotsHydrated(true);
      return;
    }

    if (selectedTemplate) {
      setSlots(buildSlotsFromTemplate(game, selectedTemplate));
      templateUpdatedAtRef.current = Math.max(localTemplateUpdatedAt, remoteTemplateUpdatedAt);
      slotsUpdatedAtRef.current = templateUpdatedAtRef.current;
    } else {
      setSlots(buildDefaultSlots(game));
      slotsUpdatedAtRef.current = Date.now();
    }
    setSlotsHydrated(true);
  }, [
    gameId,
    game,
    remoteSchedule,
    remoteTemplate,
    slotsHydrated,
    remoteScheduleFetched,
    remoteTemplateFetched,
  ]);

  useEffect(() => {
    if (!playersHydrated || !trackedTeamScope) return;
    const updatedAt = Date.now();
    playersUpdatedAtRef.current = updatedAt;
    persistPregamePlayers(trackedTeamScope, players, updatedAt);
    saveRemotePregamePlayers(trackedTeamScope, players, updatedAt)
      .then(() => setSyncError(""))
      .catch((saveError) => {
        console.error("Failed to save pregame players", saveError);
        setSyncError(saveError?.message || "Unable to sync player changes.");
      });
  }, [players, playersHydrated, trackedTeamScope]);

  useEffect(() => {
    if (!slotsHydrated || !gameId || !slots.length) return;
    const updatedAt = Date.now();
    slotsUpdatedAtRef.current = updatedAt;
    templateUpdatedAtRef.current = updatedAt;
    persistSlots(gameId, slots, updatedAt);
    persistSlotTemplate(slots, updatedAt);
    Promise.all([
      saveRemoteSchedule(gameId, slots, updatedAt),
      saveRemoteTemplate(slots, updatedAt),
    ])
      .then(() => setSyncError(""))
      .catch((saveError) => {
        console.error("Failed to save pregame schedule/template", saveError);
        setSyncError(saveError?.message || "Unable to sync pre-game schedule changes.");
      });
  }, [gameId, slots, slotsHydrated]);

  useEffect(() => {
    if (!playersHydrated || !trackedTeamScope) return;
    const remoteUpdatedAt = Number(remotePlayers?.updatedAt || 0);
    if (!remoteUpdatedAt || remoteUpdatedAt <= playersUpdatedAtRef.current) return;
    setPlayers(remotePlayers.players || []);
    playersUpdatedAtRef.current = remoteUpdatedAt;
    persistPregamePlayers(trackedTeamScope, remotePlayers.players || [], remoteUpdatedAt);
  }, [playersHydrated, remotePlayers, trackedTeamScope]);

  useEffect(() => {
    if (!playersHydrated || !trackedTeamScope || !trackedApiPlayers.length) return;
    setPlayers((current) => linkPregamePlayersToApiPlayers(current, trackedApiPlayers));
  }, [playersHydrated, trackedTeamScope, trackedApiPlayers]);

  useEffect(() => {
    if (!slotsHydrated || !gameId || !remoteSchedule?.slots?.length) return;
    const remoteUpdatedAt = Number(remoteSchedule?.updatedAt || 0);
    if (!remoteUpdatedAt || remoteUpdatedAt <= slotsUpdatedAtRef.current) return;
    setSlots(remoteSchedule.slots);
    slotsUpdatedAtRef.current = remoteUpdatedAt;
    persistSlots(gameId, remoteSchedule.slots, remoteUpdatedAt);
  }, [slotsHydrated, gameId, remoteSchedule]);

  const sortedPlayers = useMemo(() => sortPlayersByLastName(players), [players]);
  const playerById = useMemo(() => new Map(sortedPlayers.map((player) => [player.id, player])), [sortedPlayers]);
  const headerLineTwo = useMemo(() => buildHeaderLine(game), [game]);
  const tableTypeScale = useMemo(() => {
    const slotCount = Math.max(1, slots.length || 1);
    if (slotCount >= 12) return { time: "26px", player: "21px", lineGap: "3px" };
    if (slotCount >= 10) return { time: "32px", player: "26px", lineGap: "4px" };
    if (slotCount >= 8) return { time: "38px", player: "32px", lineGap: "6px" };
    if (slotCount >= 6) return { time: "44px", player: "37px", lineGap: "7px" };
    return { time: "50px", player: "42px", lineGap: "9px" };
  }, [slots.length]);

  const openSlotsEditor = () => {
    setSlotDrafts(slots.map((slot) => ({ ...slot, playerIds: [...slot.playerIds] })));
    setSlotsOpen(true);
  };

  const openPlayersEditor = () => {
    const hasDrafts = Object.keys(playerDrafts).length > 0 || newPlayerDraft.name || newPlayerDraft.display || newPlayerDraft.personId;
    if (!hasDrafts) {
      setPlayerDrafts(Object.fromEntries(sortedPlayers.map((player) => [
        player.id,
        { name: player.name, display: player.display, personId: player.personId || "" },
      ])));
    }
    setPlayersOpen(true);
  };

  const cancelPlayersEditor = () => {
    setPlayersOpen(false);
    setPlayerDrafts({});
    setNewPlayerDraft({ name: "", display: "", personId: "" });
  };

  const updateSlotById = (slotId, updater) => {
    setSlots((current) => current.map((slot) => (slot.id === slotId ? updater(slot) : slot)));
  };

  const saveAllPlayerEdits = () => {
    setPlayers((current) => sortPlayersByLastName(current.map((player) => {
      const draft = playerDrafts[player.id];
      if (!draft) return player;
      const name = normalizePregamePlayerName(draft.name);
      const display = normalizePregamePlayerName(draft.display);
      const personId = String(draft.personId || "").trim();
      if (!name || !display) return player;
      return { ...player, name, display, personId };
    })));
    cancelPlayersEditor();
  };

  const handleDeletePlayer = (playerId) => {
    setPlayers((current) => current.filter((player) => player.id !== playerId));
    setSlots((current) => current.map((slot) => ({
      ...slot,
      playerIds: slot.playerIds.map((id) => (id === playerId ? "" : id)),
    })));
    setPlayerDrafts((current) => {
      const next = { ...current };
      delete next[playerId];
      return next;
    });
  };

  const handleAddPlayer = () => {
    const name = normalizePregamePlayerName(newPlayerDraft.name);
    const display = normalizePregamePlayerName(newPlayerDraft.display);
    const personId = String(newPlayerDraft.personId || "").trim();
    if (!name || !display) return;
    setPlayers((current) => sortPlayersByLastName([
      ...current,
      { id: crypto.randomUUID(), name, display, personId },
    ]));
    setNewPlayerDraft({ name: "", display: "", personId: "" });
  };

  const handleExport = async (formatKey) => {
    await ensureExportFonts();
    const themeMode = readThemeMode();
    const logoImage = await loadImage(wizardsLogoUrl);

    const portraitScale = EXPORT_SPECS.portrait.outputWidth / EXPORT_SPECS.portrait.logicalWidth;
    const landscapeScale = EXPORT_SPECS.landscape.outputWidth / EXPORT_SPECS.landscape.logicalWidth;

    const portraitCanvas = drawPortraitExport(slots, playerById, headerLineTwo, logoImage, themeMode, portraitScale);

    if (formatKey === "portrait") {
      downloadCanvas(portraitCanvas, `pregame-${gameId}-portrait.png`);
      setExportOpen(false);
      return;
    }

    if (formatKey === "landscape") {
      const landscapeCanvas = drawLandscapeExport(
        slots,
        playerById,
        headerLineTwo,
        logoImage,
        themeMode,
        landscapeScale
      );
      downloadCanvas(landscapeCanvas, `pregame-${gameId}-landscape.png`);
      setExportOpen(false);
      return;
    }

    const wasSpec = EXPORT_SPECS.was;
    const colors = getExportColors(themeMode);
    const { canvas, context } = makeCanvas(wasSpec.outputWidth, wasSpec.outputHeight, "#ffffff");
    context.fillStyle = colors.background;
    context.fillRect(wasSpec.boxX, wasSpec.boxY, wasSpec.boxWidth, wasSpec.boxHeight);
    const fitted = fitInside(portraitCanvas, wasSpec.boxWidth, wasSpec.boxHeight);
    const drawX = wasSpec.boxX + ((wasSpec.boxWidth - fitted.width) / 2);
    const drawY = wasSpec.boxY + ((wasSpec.boxHeight - fitted.height) / 2);
    context.drawImage(portraitCanvas, drawX, drawY, fitted.width, fitted.height);
    downloadCanvas(canvas, `pregame-${gameId}-was.png`);
    setExportOpen(false);
  };

  if (isLoading) {
    return <div className={styles.stateMessage}>Loading pre-game schedule...</div>;
  }

  if (error || !game) {
    return <div className={styles.stateMessage}>Unable to load pre-game schedule.</div>;
  }

  if (!supportedTeamGame) {
    return (
      <div className={styles.page}>
        <div className={styles.topRow}>
          <Link className={styles.backButton} to={backUrl}>Back</Link>
        </div>
        <div className={styles.stateMessage}>Pre-Game is available only for Washington and Capital City games.</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.topRow}>
        <Link className={styles.backButton} to={backUrl}>Back</Link>
      </div>

      {syncError ? (
        <div className={styles.stateMessage} style={{ marginBottom: 12 }}>
          Sync issue: {syncError}
        </div>
      ) : null}

      <header className={styles.header}>
        <h1 className={styles.title}>PRE-GAME COURT TIME</h1>
        <div className={styles.subtitle}>{headerLineTwo}</div>
      </header>

      <section
        className={styles.tableWrap}
        style={{
          "--pregame-time-font-size": tableTypeScale.time,
          "--pregame-player-font-size": tableTypeScale.player,
          "--pregame-cell-line-gap": tableTypeScale.lineGap,
        }}
      >
        <table className={styles.scheduleTable}>
          <thead>
            <tr>
              {slots.map((slot) => (
                <th key={`time-${slot.id}`} className={styles.timeCell}>
                  {inlineTimeSlotId === slot.id ? (
                    <input
                      autoFocus
                      className={styles.inlineTimeInput}
                      value={inlineTimeDraft}
                      onChange={(event) => setInlineTimeDraft(event.target.value)}
                      onBlur={() => {
                        updateSlotById(slot.id, (current) => ({ ...current, time: inlineTimeDraft.trim() || current.time }));
                        setInlineTimeSlotId(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          updateSlotById(slot.id, (current) => ({ ...current, time: inlineTimeDraft.trim() || current.time }));
                          setInlineTimeSlotId(null);
                        }
                        if (event.key === "Escape") {
                          setInlineTimeSlotId(null);
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className={styles.cellButton}
                      onClick={() => {
                        setInlineTimeSlotId(slot.id);
                        setInlineTimeDraft(slot.time);
                      }}
                    >
                      {slot.time}
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {slots.map((slot) => {
                const displays = slot.playerIds.slice(0, 3).map((id) => playerById.get(id)?.display || "");
                const visibleDisplays = displays.filter(Boolean);
                const hasThree = visibleDisplays.length >= 3;
                if (hasThree) {
                  return (
                    <td key={`merged-${slot.id}`} className={styles.playerCellMerged} rowSpan={2}>
                      {activePlayerCell?.slotId === slot.id && activePlayerCell?.index === "merged" ? (
                        <div className={styles.inlinePlayerEditor}>
                          {[0, 1, 2].map((playerIndex) => (
                            <select
                              key={`${slot.id}-merged-${playerIndex}`}
                              className={styles.inlineSelect}
                              value={slot.playerIds[playerIndex] || ""}
                              onChange={(event) => {
                                const nextId = event.target.value;
                                updateSlotById(slot.id, (current) => {
                                  const next = [...current.playerIds];
                                  next[playerIndex] = nextId;
                                  return { ...current, playerIds: next };
                                });
                                setActivePlayerCell(null);
                              }}
                              onBlur={() => setActivePlayerCell(null)}
                            >
                              <option value="">--</option>
                              {sortedPlayers.map((player) => (
                                <option key={player.id} value={player.id}>{player.name}</option>
                              ))}
                            </select>
                          ))}
                        </div>
                      ) : (
                        <button type="button" className={styles.cellButton} onClick={() => setActivePlayerCell({ slotId: slot.id, index: "merged" })}>
                          {visibleDisplays.map((name, idx) => (
                            <div key={`${slot.id}-${idx}`} className={styles.nameLine}>{name.toUpperCase()}</div>
                          ))}
                        </button>
                      )}
                    </td>
                  );
                }

                return (
                  <td key={`slot-top-${slot.id}`} className={styles.playerCell}>
                    {activePlayerCell?.slotId === slot.id && activePlayerCell?.index === 0 ? (
                      <select
                        autoFocus
                        className={styles.inlineSelect}
                        value={slot.playerIds[0] || ""}
                        onChange={(event) => {
                          const nextId = event.target.value;
                          updateSlotById(slot.id, (current) => {
                            const next = [...current.playerIds];
                            next[0] = nextId;
                            return { ...current, playerIds: next };
                          });
                          setActivePlayerCell(null);
                        }}
                        onBlur={() => setActivePlayerCell(null)}
                      >
                        <option value="">--</option>
                        {sortedPlayers.map((player) => (
                          <option key={player.id} value={player.id}>{player.name}</option>
                        ))}
                      </select>
                    ) : (
                      <button type="button" className={styles.cellButton} onClick={() => setActivePlayerCell({ slotId: slot.id, index: 0 })}>
                        {(displays[0] || "").toUpperCase()}
                      </button>
                    )}
                  </td>
                );
              })}
            </tr>
            <tr>
              {slots.map((slot) => {
                const displays = slot.playerIds.slice(0, 3).map((id) => playerById.get(id)?.display || "");
                if (displays.filter(Boolean).length >= 3) return null;
                return (
                  <td key={`slot-bottom-${slot.id}`} className={styles.playerCell}>
                    {activePlayerCell?.slotId === slot.id && activePlayerCell?.index === 1 ? (
                      <select
                        autoFocus
                        className={styles.inlineSelect}
                        value={slot.playerIds[1] || ""}
                        onChange={(event) => {
                          const nextId = event.target.value;
                          updateSlotById(slot.id, (current) => {
                            const next = [...current.playerIds];
                            next[1] = nextId;
                            return { ...current, playerIds: next };
                          });
                          setActivePlayerCell(null);
                        }}
                        onBlur={() => setActivePlayerCell(null)}
                      >
                        <option value="">--</option>
                        {sortedPlayers.map((player) => (
                          <option key={player.id} value={player.id}>{player.name}</option>
                        ))}
                      </select>
                    ) : (
                      <button type="button" className={styles.cellButton} onClick={() => setActivePlayerCell({ slotId: slot.id, index: 1 })}>
                        {(displays[1] || "").toUpperCase()}
                      </button>
                    )}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </section>

      <div className={styles.bottomRow}>
        <div className={styles.actions}>
          <button type="button" className={styles.actionButton} onClick={openSlotsEditor}>Edit Slots</button>
          <button type="button" className={styles.actionButton} onClick={openPlayersEditor}>Edit Players</button>
          <button type="button" className={styles.actionButton} onClick={() => setExportOpen(true)}>Export</button>
        </div>
      </div>

      {playersOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Edit Players</h2>
              <div className={styles.modalHeaderActions}>
                <button type="button" className={styles.modalCancel} onClick={cancelPlayersEditor}>Cancel</button>
                <button type="button" className={styles.modalDone} onClick={saveAllPlayerEdits}>Done</button>
              </div>
            </div>
            <div className={styles.gridHeader}>
              <span>Name</span>
              <span>Display</span>
              <span>Player ID</span>
              <span>Actions</span>
            </div>
            <div className={styles.playerRows}>
              {sortedPlayers.map((player) => {
                const draft = playerDrafts[player.id] || { name: player.name, display: player.display, personId: player.personId || "" };
                return (
                  <div key={player.id} className={styles.playerRow}>
                    <input
                      className={styles.textInput}
                      value={draft.name}
                      onChange={(event) => setPlayerDrafts((current) => ({
                        ...current,
                        [player.id]: { ...draft, name: event.target.value },
                      }))}
                    />
                    <input
                      className={styles.textInput}
                      value={draft.display}
                      onChange={(event) => setPlayerDrafts((current) => ({
                        ...current,
                        [player.id]: { ...draft, display: event.target.value },
                      }))}
                    />
                    <input
                      className={styles.textInput}
                      value={draft.personId || ""}
                      onChange={(event) => setPlayerDrafts((current) => ({
                        ...current,
                        [player.id]: { ...draft, personId: event.target.value },
                      }))}
                      placeholder="e.g. 203078"
                    />
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={`${styles.iconButton} ${styles.iconDelete}`}
                        onClick={() => handleDeletePlayer(player.id)}
                        aria-label="Delete player"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}

              <div className={styles.playerRow}>
                <input
                  className={styles.textInput}
                  value={newPlayerDraft.name}
                  onChange={(event) => setNewPlayerDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Player name"
                />
                <input
                  className={styles.textInput}
                  value={newPlayerDraft.display}
                  onChange={(event) => setNewPlayerDraft((current) => ({ ...current, display: event.target.value }))}
                  placeholder="Nickname / initials"
                />
                <input
                  className={styles.textInput}
                  value={newPlayerDraft.personId || ""}
                  onChange={(event) => setNewPlayerDraft((current) => ({ ...current, personId: event.target.value }))}
                  placeholder="Player ID"
                />
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={`${styles.iconButton} ${styles.iconSave}`}
                    onClick={handleAddPlayer}
                    aria-label="Add player"
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                      className={`${styles.iconButton} ${styles.iconDelete}`}
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

      {slotsOpen && (
        <div className={styles.modalOverlay} onClick={() => setSlotsOpen(false)}>
          <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Edit Slots</h2>
              <button type="button" className={styles.modalClose} onClick={() => setSlotsOpen(false)}>Close</button>
            </div>
            <div className={styles.addSlotTop}>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => {
                  const first = slotDrafts[0];
                  const fallback = "4:30";
                  const firstTime = first?.time || fallback;
                  const [hours, minutes] = firstTime.split(":").map((value) => Number(value));
                  const timeDate = new Date();
                  timeDate.setHours(Number.isFinite(hours) ? hours : 4, Number.isFinite(minutes) ? minutes : 30, 0, 0);
                  const added = new Date(timeDate.getTime() - (15 * 60 * 1000));
                  setSlotDrafts((current) => [
                    { id: crypto.randomUUID(), time: formatTime(added), playerIds: ["", ""] },
                    ...current,
                  ]);
                }}
                aria-label="Add slot above first"
              >
                +
              </button>
            </div>

            <div className={styles.slotHeaderRow}>
              <span />
              <span className={styles.slotHeaderTime}>Time</span>
              <button
                type="button"
                className={styles.resetButton}
                onClick={() => setSlotDrafts((current) => current.map((slot) => ({
                  ...slot,
                  playerIds: ["", ""],
                })))}
              >
                RESET
              </button>
              <span />
            </div>

            <div className={styles.slotRows}>
              {slotDrafts.map((slot, index) => (
                <div key={slot.id} className={styles.slotRow}>
                  <button
                    type="button"
                    className={styles.slotDeleteButton}
                    onClick={() => setSlotDrafts((current) => current.filter((candidate) => candidate.id !== slot.id))}
                    aria-label="Delete slot"
                  >
                    ✕
                  </button>
                  <div className={styles.slotTimeColumn}>
                    <input
                      className={styles.timeInput}
                      value={slot.time}
                      onChange={(event) => setSlotDrafts((current) => current.map((candidate, candidateIndex) => (
                        candidateIndex === index ? { ...candidate, time: event.target.value } : candidate
                      )))}
                    />
                  </div>
                  <div className={styles.slotPlayerColumn}>
                    {slot.playerIds.map((playerId, playerIndex) => (
                      <div key={`${slot.id}-${playerIndex}`} className={styles.slotPlayerRow}>
                        <select
                          className={styles.selectInput}
                          value={playerId}
                          onChange={(event) => {
                            const nextId = event.target.value;
                            setSlotDrafts((current) => current.map((candidate, candidateIndex) => {
                              if (candidateIndex !== index) return candidate;
                              const nextPlayerIds = [...candidate.playerIds];
                              nextPlayerIds[playerIndex] = nextId;
                              return { ...candidate, playerIds: nextPlayerIds };
                            }));
                          }}
                        >
                          <option value="">--</option>
                          {sortedPlayers.map((player) => (
                            <option key={player.id} value={player.id}>{player.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className={styles.slotClearPlayerButton}
                          onClick={() => setSlotDrafts((current) => current.map((candidate, candidateIndex) => {
                            if (candidateIndex !== index) return candidate;
                            const nextPlayerIds = [...candidate.playerIds];
                            nextPlayerIds.splice(playerIndex, 1);
                            while (nextPlayerIds.length < 2) nextPlayerIds.push("");
                            return { ...candidate, playerIds: nextPlayerIds };
                          }))}
                          aria-label="Delete player slot"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => setSlotDrafts((current) => current.map((candidate, candidateIndex) => {
                      if (candidateIndex !== index) return candidate;
                      if (candidate.playerIds.length >= 3) return candidate;
                      return { ...candidate, playerIds: [...candidate.playerIds, ""] };
                    }))}
                    aria-label="Add player dropdown"
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.doneButton}
                onClick={() => {
                  setSlots(slotDrafts.map((slot) => ({
                    ...slot,
                    playerIds: slot.playerIds.slice(0, 3),
                  })));
                  setSlotsOpen(false);
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {exportOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.exportModal}>
            <h2 className={styles.modalTitle}>Export</h2>
            <button type="button" className={styles.doneButton} onClick={() => handleExport("portrait")}>Portrait</button>
            <button type="button" className={styles.doneButton} onClick={() => handleExport("landscape")}>Landscape</button>
            <button type="button" className={styles.doneButton} onClick={() => handleExport("was")}>WAS</button>
            <button type="button" className={styles.modalCancel} onClick={() => setExportOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
