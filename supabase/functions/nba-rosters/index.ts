const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const NBA_PLAYERS_PAGE_URL = "https://www.nba.com/players";

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

function extractNextDataJson(html: string) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function toSortableJersey(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return Number.POSITIVE_INFINITY;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return responseWithHeaders(200, "ok");
  }

  if (req.method !== "GET") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  try {
    const response = await fetch(NBA_PLAYERS_PAGE_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NBA Dashboard Roster Resolver)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      return jsonResponse(502, {
        error: `Roster fetch failed (${response.status})`,
        source: NBA_PLAYERS_PAGE_URL,
      });
    }

    const html = await response.text();
    const nextData = extractNextDataJson(html);
    const rawPlayers = Array.isArray(nextData?.props?.pageProps?.players)
      ? nextData.props.pageProps.players
      : [];

    const teams: Record<string, {
      teamId: string;
      teamCity: string;
      teamName: string;
      teamAbbreviation: string;
      players: Array<{
        personId: string;
        firstName: string;
        familyName: string;
        fullName: string;
        jerseyNum: string;
        position: string;
        height: string;
        teamId: string;
      }>;
    }> = {};

    rawPlayers.forEach((player: Record<string, unknown>) => {
      const teamId = String(player?.TEAM_ID || "").trim();
      const personId = String(player?.PERSON_ID || "").trim();
      const firstName = String(player?.PLAYER_FIRST_NAME || "").trim();
      const familyName = String(player?.PLAYER_LAST_NAME || "").trim();
      const fullName = [firstName, familyName].filter(Boolean).join(" ").trim();
      const rosterStatus = Number(player?.ROSTER_STATUS);
      const historic = Boolean(player?.HISTORIC);

      if (!teamId || !personId || !fullName || rosterStatus !== 1 || historic) return;

      if (!teams[teamId]) {
        teams[teamId] = {
          teamId,
          teamCity: String(player?.TEAM_CITY || "").trim(),
          teamName: String(player?.TEAM_NAME || "").trim(),
          teamAbbreviation: String(player?.TEAM_ABBREVIATION || "").trim(),
          players: [],
        };
      }

      teams[teamId].players.push({
        personId,
        firstName,
        familyName,
        fullName,
        jerseyNum: String(player?.JERSEY_NUMBER || "").trim(),
        position: String(player?.POSITION || "").trim(),
        height: String(player?.HEIGHT || "").trim(),
        teamId,
      });
    });

    Object.values(teams).forEach((team) => {
      team.players.sort((a, b) => {
        const jerseyCompare = toSortableJersey(a.jerseyNum) - toSortableJersey(b.jerseyNum);
        if (jerseyCompare !== 0) return jerseyCompare;
        return a.fullName.localeCompare(b.fullName);
      });
    });

    return responseWithHeaders(200, JSON.stringify({
      fetchedAt: new Date().toISOString(),
      teams,
    }), {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=21600, s-maxage=21600, stale-while-revalidate=86400",
    });
  } catch (error) {
    return jsonResponse(502, {
      error: "Unable to resolve NBA rosters",
      detail: error instanceof Error ? error.message : "unknown",
      source: NBA_PLAYERS_PAGE_URL,
    });
  }
});
