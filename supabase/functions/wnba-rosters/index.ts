const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const WNBA_SCHEDULE_URL = "https://cdn.wnba.com/static/json/staticData/scheduleLeagueV2.json";
const TEAM_ROSTER_URLS: Record<string, string> = {
  "Atlanta Dream": "https://dream.wnba.com/roster",
  "Chicago Sky": "https://sky.wnba.com/roster",
  "Connecticut Sun": "https://sun.wnba.com/roster",
  "Dallas Wings": "https://wings.wnba.com/roster",
  "Golden State Valkyries": "https://valkyries.wnba.com/roster",
  "Indiana Fever": "https://fever.wnba.com/roster",
  "Las Vegas Aces": "https://aces.wnba.com/roster",
  "Los Angeles Sparks": "https://sparks.wnba.com/roster",
  "Minnesota Lynx": "https://lynx.wnba.com/roster",
  "New York Liberty": "https://liberty.wnba.com/roster",
  "Phoenix Mercury": "https://mercury.wnba.com/roster",
  "Seattle Storm": "https://storm.wnba.com/roster",
  "Washington Mystics": "https://mystics.wnba.com/roster",
};

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

function toSortableJersey(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return Number.POSITIVE_INFINITY;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function normalizeWhitespace(value: string) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(html: string) {
  return normalizeWhitespace(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function splitName(fullName: string) {
  const parts = normalizeWhitespace(fullName).split(" ").filter(Boolean);
  if (parts.length <= 1) {
    return {
      firstName: parts[0] || "",
      familyName: "",
    };
  }
  return {
    firstName: parts.slice(0, -1).join(" "),
    familyName: parts.slice(-1).join(" "),
  };
}

function normalizeNameKey(value: string) {
  return normalizeWhitespace(value)
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeJsonText(value: string) {
  return normalizeWhitespace(
    String(value || "")
      .replace(/\\"/g, "\"")
      .replace(/\\u0026/gi, "&")
      .replace(/\\u0027/gi, "'")
      .replace(/\\u2019/gi, "'")
      .replace(/\\u2013/gi, "-")
      .replace(/\\u2014/gi, "-")
      .replace(/\\\\/g, "\\")
  );
}

function extractRosterEntries(html: string) {
  const objectMatches = html
    .split('playerId\\":')
    .slice(1)
    .map((chunk) => `playerId\\":${chunk}`);

  const seen = new Set<string>();
  const structuredPlayers = objectMatches
    .map((chunk) => {
      const personId = String(chunk.match(/playerId\\":(\d+)/)?.[1] || "").trim();
      const fullName = decodeJsonText(chunk.match(/playerName\\":\\"([^"]*)\\"/)?.[1] || "");
      const jerseyNum = decodeJsonText(chunk.match(/playerNumber\\":\\"([^"]*)\\"/)?.[1] || "");
      const position = decodeJsonText(chunk.match(/position\\":\\"([^"]*)\\"/)?.[1] || "");
      const teamId = String(chunk.match(/teamId\\":\\"?(\d+)\\"?/)?.[1] || "").trim();
      const playerLink = decodeJsonText(chunk.match(/playerLink\\":\\"([^"]*)\\"/)?.[1] || "");
      if (!personId || !fullName || seen.has(personId)) return null;
      seen.add(personId);
      const { firstName, familyName } = splitName(fullName);
      return {
        personId,
        firstName,
        familyName,
        fullName,
        jerseyNum,
        position,
        teamId,
        playerLink,
      };
    })
    .filter(Boolean);

  const text = stripHtml(html);
  const rosterHeadingIndex = text.indexOf("Team Roster");
  if (rosterHeadingIndex < 0) return structuredPlayers;
  const coachingIndex = text.indexOf("Coaching Staff", rosterHeadingIndex);
  const rosterText = coachingIndex > rosterHeadingIndex
    ? text.slice(rosterHeadingIndex, coachingIndex)
    : text.slice(rosterHeadingIndex);
  const matches = [...rosterText.matchAll(/(?:#\s*(\d+)\s+)?([A-Za-z.'\- ]+?)\s+(Guard(?:-Forward)?|Forward(?:-Center)?|Center|Forward|Guard)\s+PPG[\s\S]*?Height\s+([0-9-]+|--)\s+Exp/gi)];
  const textPlayers = matches.map((match) => {
    const jerseyNum = String(match[1] || "").trim();
    const fullName = normalizeWhitespace(match[2] || "");
    const position = normalizeWhitespace(match[3] || "");
    const height = normalizeWhitespace(match[4] || "");
    const { firstName, familyName } = splitName(fullName);
    return {
      personId: "",
      firstName,
      familyName,
      fullName,
      jerseyNum,
      position,
      height,
      teamId: "",
      playerLink: "",
    };
  }).filter((player) => player.fullName);

  if (!structuredPlayers.length) {
    return textPlayers;
  }

  const textPlayersByKey = new Map(
    textPlayers.map((player) => [
      `${normalizeNameKey(player.fullName)}::${player.jerseyNum}`,
      player,
    ])
  );

  return structuredPlayers.map((player) => {
    const textPlayer = textPlayersByKey.get(`${normalizeNameKey(player.fullName)}::${player.jerseyNum}`)
      || textPlayersByKey.get(`${normalizeNameKey(player.fullName)}::`);
    if (!textPlayer) {
      return {
        ...player,
        height: "",
      };
    }
    return {
      ...player,
      height: textPlayer.height || "",
    };
  });
}

type TeamDirectory = {
  teamId: string;
  teamCity: string;
  teamName: string;
  teamAbbreviation: string;
};

async function fetchTeamDirectory() {
  const response = await fetch(WNBA_SCHEDULE_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Mystics Dashboard WNBA Roster Resolver)",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`WNBA schedule fetch failed (${response.status})`);
  }

  const payload = await response.json();
  const gameDates = Array.isArray(payload?.leagueSchedule?.gameDates)
    ? payload.leagueSchedule.gameDates
    : [];

  const teams = new Map<string, TeamDirectory>();
  gameDates.forEach((entry: Record<string, unknown>) => {
    const games = Array.isArray(entry?.games) ? entry.games : [];
    games.forEach((game: Record<string, unknown>) => {
      [game?.homeTeam, game?.awayTeam].forEach((rawTeam: unknown) => {
        const team = rawTeam && typeof rawTeam === "object" ? rawTeam as Record<string, unknown> : null;
        if (!team) return;
        const teamId = String(team?.teamId || team?.id || "").trim();
        const teamName = String(team?.teamName || team?.name || "").trim();
        const teamCity = String(team?.teamCity || team?.city || "").trim();
        const teamAbbreviation = String(team?.teamTricode || team?.tricode || "").trim().toUpperCase();
        if (!teamId || !teamName) return;
        teams.set(teamId, {
          teamId,
          teamCity,
          teamName,
          teamAbbreviation,
        });
      });
    });
  });

  return [...teams.values()];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return responseWithHeaders(200, "ok");
  }

  if (req.method !== "GET") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  try {
    const directory = await fetchTeamDirectory();
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

    for (const team of directory) {
      const fullName = `${team.teamCity} ${team.teamName}`.trim();
      const rosterUrl = TEAM_ROSTER_URLS[fullName];
      if (!rosterUrl) continue;

      const response = await fetch(rosterUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Mystics Dashboard WNBA Roster Resolver)",
          Accept: "text/html,application/xhtml+xml",
        },
      });

      if (!response.ok) continue;

      const html = await response.text();
      const players = extractRosterEntries(html)
        .map((player) => ({
          personId: player.personId,
          firstName: player.firstName,
          familyName: player.familyName,
          fullName: player.fullName,
          jerseyNum: player.jerseyNum,
          position: player.position,
          height: String((player as Record<string, unknown>)?.height || "").trim(),
          teamId: player.teamId || team.teamId,
        }))
        .filter((player) => player.fullName);

      players.sort((a, b) => {
        const jerseyCompare = toSortableJersey(a.jerseyNum) - toSortableJersey(b.jerseyNum);
        if (jerseyCompare !== 0) return jerseyCompare;
        return a.fullName.localeCompare(b.fullName);
      });

      teams[team.teamId] = {
        teamId: team.teamId,
        teamCity: team.teamCity,
        teamName: team.teamName,
        teamAbbreviation: team.teamAbbreviation,
        players,
      };
    }

    return responseWithHeaders(200, JSON.stringify({
      fetchedAt: new Date().toISOString(),
      teams,
    }), {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=21600, s-maxage=21600, stale-while-revalidate=86400",
    });
  } catch (error) {
    return jsonResponse(502, {
      error: "Unable to resolve WNBA rosters",
      detail: error instanceof Error ? error.message : "unknown",
      source: WNBA_SCHEDULE_URL,
    });
  }
});
