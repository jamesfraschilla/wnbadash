const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const WNBA_SCHEDULE_URL = "https://cdn.wnba.com/static/json/staticData/scheduleLeagueV2.json";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return responseWithHeaders(200, "ok");
  }

  if (req.method !== "GET") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  try {
    const response = await fetch(WNBA_SCHEDULE_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Mystics Dashboard WNBA Schedule Resolver)",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`WNBA schedule fetch failed (${response.status})`);
    }

    const payload = await response.text();
    return responseWithHeaders(200, payload, {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
    });
  } catch (error) {
    return jsonResponse(502, {
      error: "Unable to resolve WNBA schedule",
      detail: error instanceof Error ? error.message : "unknown",
      source: WNBA_SCHEDULE_URL,
    });
  }
});
