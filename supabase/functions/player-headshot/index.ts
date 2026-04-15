const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const GLEAGUE_PLAYER_BASE = "https://gleague.nba.com/player";

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

function decodeEntities(text: string) {
  return String(text || "")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeImageUrl(rawUrl: string) {
  const value = decodeEntities(rawUrl).trim();
  if (!value) return null;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return new URL(value, "https://gleague.nba.com").toString();
  if (/^https?:\/\//i.test(value)) return value;
  return null;
}

function extractMetaImage(html: string) {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/i,
    /<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']image["'][^>]*>/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(html);
    const imageUrl = normalizeImageUrl(match?.[1] || "");
    if (imageUrl) return imageUrl;
  }

  return null;
}

function extractJsonImage(html: string) {
  const patterns = [
    /"image"\s*:\s*"([^"]+)"/i,
    /"image"\s*:\s*\[\s*"([^"]+)"/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(html);
    const imageUrl = normalizeImageUrl(match?.[1] || "");
    if (imageUrl) return imageUrl;
  }

  return null;
}

function isLikelyPlayerImage(url: string, personId: string) {
  const value = String(url || "").toLowerCase();
  const safePersonId = String(personId || "").trim();
  if (!value) return false;
  if (!/\.(png|jpe?g|webp)(\?|$)/i.test(value)) return false;
  if (safePersonId && value.includes(safePersonId.toLowerCase())) return true;
  if (value.includes("profile")) return true;
  if (value.includes("headshot")) return true;
  return false;
}

function extractFallbackImage(html: string, personId: string) {
  const matches = html.match(/https?:\/\/[^"'\\\s>]+(?:png|jpe?g|webp)(?:\?[^"'\\\s>]*)?/gi) || [];
  return matches.find((url) => isLikelyPlayerImage(url, personId)) || null;
}

function extractHeadshotUrl(html: string, personId: string) {
  return extractMetaImage(html) || extractJsonImage(html) || extractFallbackImage(html, personId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return responseWithHeaders(200, "ok");
  }

  if (req.method !== "GET") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const url = new URL(req.url);
  const personId = String(url.searchParams.get("personId") || "").trim();

  if (!personId) {
    return jsonResponse(400, { error: "Missing personId" });
  }

  const profileUrl = `${GLEAGUE_PLAYER_BASE}/${encodeURIComponent(personId)}/`;

  try {
    const response = await fetch(profileUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NBA Dashboard Headshot Resolver)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      return jsonResponse(404, {
        error: `Profile fetch failed (${response.status})`,
        source: profileUrl,
      });
    }

    const html = await response.text();
    const imageUrl = extractHeadshotUrl(html, personId);

    if (!imageUrl) {
      return jsonResponse(404, {
        error: "No headshot found on profile page",
        source: profileUrl,
      });
    }

    return responseWithHeaders(302, null, {
      "Cache-Control": "public, max-age=21600, s-maxage=21600, stale-while-revalidate=86400",
      Location: imageUrl,
    });
  } catch (error) {
    return jsonResponse(502, {
      error: "Unable to resolve player headshot",
      detail: error instanceof Error ? error.message : "unknown",
      source: profileUrl,
    });
  }
});
