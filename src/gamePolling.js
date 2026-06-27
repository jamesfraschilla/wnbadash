const TRACKED_GAME_INTERVALS = {
  final: false,
  halftime: 60_000,
  quarterBreak: 30_000,
  lateGame: 2_000,
  endOfQuarter: 5_000,
  live: 15_000,
  pregame: 120_000,
};

const OTHER_GAME_INTERVALS = {
  final: false,
  halftime: 60_000,
  quarterBreak: 30_000,
  lateGame: 30_000,
  endOfQuarter: 30_000,
  live: 30_000,
  pregame: 120_000,
};

function clockSeconds(clock) {
  const text = String(clock || "").trim();
  if (!text) return null;

  const isoMatch = /^PT(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(text);
  if (isoMatch) {
    return (Number(isoMatch[1] || 0) * 60) + Math.floor(Number(isoMatch[2] || 0));
  }

  const clockMatch = /^(\d{1,2}):(\d{2})(?:\.\d+)?$/.exec(text);
  if (clockMatch) {
    return (Number(clockMatch[1] || 0) * 60) + Number(clockMatch[2] || 0);
  }

  return null;
}

function statusText(game) {
  return String(game?.gameStatusText || "").trim().toLowerCase();
}

export function getGamePollingInterval(game, options = {}) {
  const intervals = options.isTrackedGame ? TRACKED_GAME_INTERVALS : OTHER_GAME_INTERVALS;
  if (!game) return intervals.pregame;

  const status = Number(game?.gameStatus || 0);
  const text = statusText(game);
  const period = Number(game?.period || 0);
  const seconds = clockSeconds(game?.gameClock);

  if (status === 3 || text.includes("final")) return intervals.final;
  if (text.includes("halftime") || text === "half" || text === "ht") return intervals.halftime;
  if (status !== 2) return intervals.pregame;
  if (period === 2 && seconds === 0) return intervals.halftime;
  if (seconds === 0) return intervals.quarterBreak;
  if (period >= 4 && seconds != null && seconds <= 4 * 60) return intervals.lateGame;
  if (period >= 1 && period <= 3 && seconds != null && seconds <= 60) return intervals.endOfQuarter;
  return intervals.live;
}

export function getGamesListPollingInterval(games, options = {}) {
  const list = Array.isArray(games) ? games : [];
  const intervals = list
    .map((game) => getGamePollingInterval(game, {
      isTrackedGame: Boolean(options.isTrackedGame?.(game)),
    }))
    .filter((interval) => typeof interval === "number" && interval > 0);

  return intervals.length ? Math.min(...intervals) : false;
}
