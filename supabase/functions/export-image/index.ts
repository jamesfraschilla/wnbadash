const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const ALLOWED_HOSTS = [
  "cdn.nba.com",
  "cdn.wnba.com",
  "ak-static.cms.nba.com",
  "gleague.nba.com",
  "official.nba.com",
];

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

function isAllowedTarget(target: URL) {
  const host = target.hostname.toLowerCase();
  if (ALLOWED_HOSTS.includes(host)) return true;
  if (host.endsWith(".supabase.co")) return true;
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return responseWithHeaders(200, "ok");
  }

  if (req.method !== "GET") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const requestUrl = new URL(req.url);
  const rawTarget = String(requestUrl.searchParams.get("url") || "").trim();

  if (!rawTarget) {
    return jsonResponse(400, { error: "Missing url" });
  }

  let target: URL;
  try {
    target = new URL(rawTarget);
  } catch {
    return jsonResponse(400, { error: "Invalid url" });
  }

  if (!/^https:$/.test(target.protocol)) {
    return jsonResponse(400, { error: "Only https URLs are allowed" });
  }

  if (!isAllowedTarget(target)) {
    return jsonResponse(403, { error: "Target host not allowed" });
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NBA Dashboard Export Proxy)",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
      redirect: "follow",
    });

    if (!upstream.ok) {
      return jsonResponse(upstream.status, {
        error: `Upstream request failed (${upstream.status})`,
        source: target.toString(),
      });
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const cacheControl = upstream.headers.get("cache-control") || "public, max-age=21600, s-maxage=21600, stale-while-revalidate=86400";
    const body = await upstream.arrayBuffer();

    return responseWithHeaders(200, body, {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
    });
  } catch (error) {
    return jsonResponse(502, {
      error: "Unable to fetch image",
      detail: error instanceof Error ? error.message : "unknown",
      source: target.toString(),
    });
  }
});
