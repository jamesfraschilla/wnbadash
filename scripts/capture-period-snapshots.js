import { createClient } from "@supabase/supabase-js";

const API_BASE = "https://d1rjt2wyntx8o7.cloudfront.net/api";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WINDOW_MINUTES = Number(process.env.SNAPSHOT_WINDOW_MINUTES || 3);
const GAME_WINDOW_BUFFER_HOURS = Number(process.env.GAME_WINDOW_BUFFER_HOURS || 5);
const MORNING_RUN_HOURS = new Set([6, 8, 10]);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const toEtDate = (date) =>
  date.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

const etFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const getEtParts = (date) => {
  const parts = etFormatter.formatToParts(date);
  const values = {};
  parts.forEach((part) => {
    if (part.type !== "literal") values[part.type] = part.value;
  });
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
};

const fetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed ${res.status} for ${url}`);
  }
  return res.json();
};

const shouldCapture = (action) => {
  if (!action?.timeActual) return false;
  const actionTime = Date.parse(action.timeActual);
  if (Number.isNaN(actionTime)) return false;
  const diffMs = Date.now() - actionTime;
  return diffMs >= 0 && diffMs <= WINDOW_MINUTES * 60_000;
};

const upsertSnapshot = async ({ gameId, period, teamId, totals }) => {
  const { error } = await supabase
    .from("period_snapshots")
    .upsert(
      { game_id: gameId, period, team_id: String(teamId), totals },
      { onConflict: "game_id,period,team_id" }
    );
  if (error) throw error;
};

const isMorningRunTime = (now) => {
  const { hour, minute } = getEtParts(now);
  return MORNING_RUN_HOURS.has(hour) && minute < 5;
};

const getGameWindowMs = (games) => {
  const times = (games || [])
    .map((game) => Date.parse(game.gameTimeUTC))
    .filter((time) => Number.isFinite(time));
  if (!times.length) return null;

  const start = Math.min(...times);
  const end = Math.max(...times) + GAME_WINDOW_BUFFER_HOURS * 60 * 60 * 1000;
  return { start, end };
};

const isWithinGameWindow = (nowMs, windows) =>
  windows.some((window) => window && nowMs >= window.start && nowMs <= window.end);

const captureGame = async (gameId) => {
  const game = await fetchJson(`${API_BASE}/games/${gameId}`);
  const actions = game.playByPlayActions || [];
  const periodEnds = actions.filter(
    (action) => action.actionType === "period" && action.subType === "end"
  );
  const recentEnds = periodEnds.filter(shouldCapture);
  if (!recentEnds.length) return;

  const { away, home } = game.boxScore || {};
  if (!away?.totals || !home?.totals) return;

  await Promise.all(
    recentEnds.map((action) => {
      const period = action.period;
      return Promise.all([
        upsertSnapshot({ gameId, period, teamId: away.teamId, totals: away.totals }),
        upsertSnapshot({ gameId, period, teamId: home.teamId, totals: home.totals }),
      ]);
    })
  );
};

const run = async () => {
  const today = new Date();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dates = [toEtDate(today), toEtDate(yesterday)];
  const gamesByDate = new Map();

  for (const date of dates) {
    gamesByDate.set(date, await fetchJson(`${API_BASE}/games/byDate?date=${date}`));
  }

  const now = new Date();
  const nowMs = now.getTime();
  const windows = Array.from(gamesByDate.values()).map(getGameWindowMs);
  const shouldRun = isMorningRunTime(now) || isWithinGameWindow(nowMs, windows);

  if (!shouldRun) {
    console.log("Outside capture window. Skipping snapshot run.");
    return;
  }

  for (const date of dates) {
    const games = gamesByDate.get(date) || [];
    for (const game of games || []) {
      if (game.gameStatus !== 2) continue;
      await captureGame(game.gameId);
    }
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
