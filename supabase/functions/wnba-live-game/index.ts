const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const WNBA_LIVE_BOXSCORE_BASE = "https://cdn.wnba.com/static/json/liveData/boxscore";
const WNBA_LIVE_PLAYBYPLAY_BASE = "https://cdn.wnba.com/static/json/liveData/playbyplay";
const WNBA_STATS_BASE = "https://stats.wnba.com/stats";

function responseWithHeaders(status: number, body: BodyInit | null, extraHeaders: HeadersInit = {}) {
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders,
      ...extraHeaders,
    },
  });
}

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return responseWithHeaders(status, JSON.stringify(payload), {
    "Content-Type": "application/json",
  });
}

function normalizeGameId(value: string) {
  return String(value || "").trim().padStart(10, "0");
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Mystics Dashboard WNBA Live Game Resolver)",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch failed (${response.status})`);
  }

  return response.json();
}

async function fetchStatsJson(url: string, gameId: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(5000),
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Mystics Dashboard WNBA Stats Resolver)",
      Accept: "application/json, text/plain, */*",
      Origin: "https://stats.wnba.com",
      Referer: `https://stats.wnba.com/game/${gameId}/advanced/`,
      "x-nba-stats-origin": "stats",
      "x-nba-stats-token": "true",
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch failed (${response.status})`);
  }

  return response.json();
}

function normalizeDatasetName(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function datasetFromPayload(payload: Record<string, unknown>, targetName: string) {
  const normalizedTarget = normalizeDatasetName(targetName);
  const resultSets = Array.isArray(payload?.resultSets)
    ? payload.resultSets
    : Array.isArray(payload?.resultSet)
      ? payload.resultSet
      : [];

  for (const entry of resultSets) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const name = normalizeDatasetName(record.name ?? record.Name);
    if (name !== normalizedTarget) continue;
    const headers = Array.isArray(record.headers)
      ? record.headers
      : Array.isArray(record.Headers)
        ? record.Headers
        : [];
    const rows = Array.isArray(record.rowSet)
      ? record.rowSet
      : Array.isArray(record.rows)
        ? record.rows
        : Array.isArray(record.RowSet)
          ? record.RowSet
          : [];
    return {
      headers: headers.map((value) => String(value || "").trim()),
      rows: rows.filter(Array.isArray),
    };
  }

  return { headers: [], rows: [] };
}

function datasetRows(payload: Record<string, unknown>, targetName: string) {
  const { headers, rows } = datasetFromPayload(payload, targetName);
  if (!headers.length || !rows.length) return [];
  return rows.map((row) => {
    const values = Array.isArray(row) ? row : [];
    return headers.reduce<Record<string, unknown>>((acc, header, index) => {
      acc[header] = values[index] ?? null;
      return acc;
    }, {});
  });
}

function parseAdvancedBoxScorePayload(payload: Record<string, unknown>) {
  return {
    players: datasetRows(payload, "PlayerStats"),
    teams: datasetRows(payload, "TeamStats"),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return responseWithHeaders(200, "ok");
  }

  if (req.method !== "GET") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const url = new URL(req.url);
  const gameId = normalizeGameId(url.searchParams.get("gameId") || "");

  if (!gameId) {
    return jsonResponse(400, { error: "Missing gameId" });
  }

  const boxscoreUrl = `${WNBA_LIVE_BOXSCORE_BASE}/boxscore_${gameId}.json`;
  const playByPlayUrl = `${WNBA_LIVE_PLAYBYPLAY_BASE}/playbyplay_${gameId}.json`;
  const advancedUrl = `${WNBA_STATS_BASE}/boxscoreadvancedv3?GameID=${encodeURIComponent(gameId)}&StartPeriod=0&EndPeriod=0&StartRange=0&EndRange=0&RangeType=0`;

  const [boxscoreResult, playByPlayResult, advancedResult] = await Promise.allSettled([
    fetchJson(boxscoreUrl),
    fetchJson(playByPlayUrl),
    fetchStatsJson(advancedUrl, gameId),
  ]);

  if (boxscoreResult.status !== "fulfilled") {
    return jsonResponse(404, {
      error: "WNBA boxscore unavailable",
      detail: boxscoreResult.reason instanceof Error ? boxscoreResult.reason.message : "unknown",
      gameId,
      source: boxscoreUrl,
    });
  }

  return responseWithHeaders(200, JSON.stringify({
    boxscore: boxscoreResult.value,
    playByPlay: playByPlayResult.status === "fulfilled" ? playByPlayResult.value : {},
    advancedBoxScore: advancedResult.status === "fulfilled"
      ? parseAdvancedBoxScorePayload(advancedResult.value as Record<string, unknown>)
      : { players: [], teams: [] },
  }), {
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=300",
  });
});
