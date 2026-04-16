const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const WNBA_LIVE_BOXSCORE_BASE = "https://cdn.wnba.com/static/json/liveData/boxscore";
const WNBA_LIVE_PLAYBYPLAY_BASE = "https://cdn.wnba.com/static/json/liveData/playbyplay";

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

  const [boxscoreResult, playByPlayResult] = await Promise.allSettled([
    fetchJson(boxscoreUrl),
    fetchJson(playByPlayUrl),
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
  }), {
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=300",
  });
});
