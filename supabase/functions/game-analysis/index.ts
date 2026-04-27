import { createClient } from "npm:@supabase/supabase-js@2";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_OPENAI_MODEL = Deno.env.get("OPENAI_ANALYSIS_MODEL") || "gpt-4.1-mini";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function safeNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function periodLengthSeconds(period: number) {
  return period > 4 ? 5 * 60 : 10 * 60;
}

function normalizeClock(clock: unknown) {
  const value = String(clock || "").trim();
  if (!value) return "";
  if (!value.startsWith("PT")) return value;
  const match = /PT(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(value);
  if (!match) return "";
  const minutes = safeNumber(match[1], 0);
  const seconds = Math.floor(safeNumber(match[2], 0));
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function parseClockToSeconds(clock: unknown) {
  const normalized = normalizeClock(clock);
  const match = /^(\d{1,2}):(\d{2})$/.exec(normalized);
  if (!match) return 0;
  return (safeNumber(match[1], 0) * 60) + safeNumber(match[2], 0);
}

function pointToElapsedSeconds(period: number, clock: unknown) {
  let elapsed = 0;
  for (let current = 1; current < period; current += 1) {
    elapsed += periodLengthSeconds(current);
  }
  const remaining = parseClockToSeconds(clock);
  return elapsed + Math.max(0, periodLengthSeconds(period) - remaining);
}

function periodLabel(period: number) {
  if (period <= 4) return `Q${period}`;
  const overtimeNumber = period - 4;
  return overtimeNumber === 1 ? "OT" : `${overtimeNumber}OT`;
}

function formatPointLabel(period: number, clock: unknown) {
  return `${periodLabel(period)} ${normalizeClock(clock) || "0:00"}`;
}

function formatSecondsClock(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function elapsedSecondsToPoint(elapsed: number) {
  let remainingElapsed = Math.max(0, elapsed);
  let period = 1;
  while (remainingElapsed > periodLengthSeconds(period)) {
    remainingElapsed -= periodLengthSeconds(period);
    period += 1;
  }
  const remainingClock = Math.max(0, periodLengthSeconds(period) - remainingElapsed);
  return {
    period,
    clock: formatSecondsClock(remainingClock),
  };
}

function formatSignedValue(value: number) {
  return `${value > 0 ? "+" : ""}${value}`;
}

function teamLabel(team: Record<string, unknown> | null | undefined) {
  return String(team?.teamTricode || team?.teamName || "Team");
}

function describeLineup(players: Array<Record<string, unknown>>) {
  return (Array.isArray(players) ? players : [])
    .map((player) => String(player?.nameI || player?.fullName || player?.playerName || "").trim())
    .filter(Boolean)
    .join(", ");
}

function getUserClient(authHeader: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase function secrets are missing.");
  }
  return createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
  });
}

async function requireActiveUser(userClient: ReturnType<typeof createClient>, req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  let token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    const cloned = req.clone();
    const body = await cloned.json().catch(() => ({}));
    token = typeof body?.accessToken === "string" ? body.accessToken : "";
  }
  if (!token) {
    return { error: "Missing authorization token.", status: 401 } as const;
  }

  const { data: userData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !userData?.user?.id) {
    return { error: "Unable to verify session.", status: 401 } as const;
  }

  const { data: profile, error: profileError } = await userClient
    .from("profiles")
    .select("id,role,status")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError || !profile || profile.status !== "active") {
    return { error: "Active account required.", status: 403 } as const;
  }

  return { userId: profile.id } as const;
}

function actionChronologyValue(action: Record<string, unknown>) {
  const period = safeNumber(action.period, 0);
  const elapsed = pointToElapsedSeconds(period, action.clock);
  const order = safeNumber(action.orderNumber ?? action.actionNumber, 0);
  return { period, elapsed, order };
}

function sortActions(actions: Array<Record<string, unknown>>) {
  return [...actions].sort((a, b) => {
    const aValue = actionChronologyValue(a);
    const bValue = actionChronologyValue(b);
    if (aValue.elapsed !== bValue.elapsed) return aValue.elapsed - bValue.elapsed;
    return aValue.order - bValue.order;
  });
}

function numericScore(action: Record<string, unknown>, side: "home" | "away") {
  return safeNumber(side === "home" ? action.scoreHome : action.scoreAway, 0);
}

function buildScoringEvents(actions: Array<Record<string, unknown>>, homeTeamId: string, awayTeamId: string) {
  let previousHome = 0;
  let previousAway = 0;

  return actions.flatMap((action) => {
    const nextHome = numericScore(action, "home");
    const nextAway = numericScore(action, "away");
    const homeDiff = nextHome - previousHome;
    const awayDiff = nextAway - previousAway;
    previousHome = nextHome;
    previousAway = nextAway;

    if (homeDiff <= 0 && awayDiff <= 0) return [];

    const scoringTeamId = homeDiff > awayDiff ? homeTeamId : awayDiff > homeDiff ? awayTeamId : String(action.teamId || "");
    const points = Math.max(homeDiff, awayDiff);
    return [{
      actionNumber: safeNumber(action.actionNumber, 0),
      period: safeNumber(action.period, 0),
      clock: normalizeClock(action.clock),
      elapsed: pointToElapsedSeconds(safeNumber(action.period, 0), action.clock),
      teamId: scoringTeamId,
      points,
      description: String(action.description || action.actionType || "").trim(),
      scoreHome: nextHome,
      scoreAway: nextAway,
    }];
  });
}

function findScoreAtOrBefore(actions: Array<Record<string, unknown>>, elapsed: number) {
  let home = 0;
  let away = 0;
  for (const action of actions) {
    const actionElapsed = pointToElapsedSeconds(safeNumber(action.period, 0), action.clock);
    if (actionElapsed > elapsed) break;
    home = numericScore(action, "home");
    away = numericScore(action, "away");
  }
  return { home, away };
}

function classifyShot(action: Record<string, unknown>) {
  const actionType = String(action.actionType || "").toLowerCase();
  if (actionType === "3pt") return "three";
  const distance = safeNumber(action.shotDistance, 0);
  return distance <= 4.9 ? "rim" : "mid";
}

function isPersonalFoul(action: Record<string, unknown>) {
  const subType = String(action.subType || "").toLowerCase();
  return !subType.includes("technical");
}

function normalizeQualifiers(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").toLowerCase());
  }
  if (typeof value === "string" && value) {
    return value.split(/[\s,|]+/).map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

function percentage(made: number, attempted: number) {
  if (!attempted) return 0;
  return Number(((made / attempted) * 100).toFixed(1));
}

function buildTeamActionTotals(teamId: string) {
  return {
    teamId,
    points: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    rimFieldGoalsMade: 0,
    rimFieldGoalsAttempted: 0,
    midFieldGoalsMade: 0,
    midFieldGoalsAttempted: 0,
    reboundsTotal: 0,
    reboundsOffensive: 0,
    turnovers: 0,
    steals: 0,
    blocks: 0,
    assists: 0,
    foulsPersonal: 0,
    transitionPoints: 0,
    transitionPossessions: 0,
    transitionTurnovers: 0,
    secondChancePoints: 0,
    pointsOffTurnovers: 0,
    paintPoints: 0,
  };
}

function buildPlayerTotals(teamId: string, personId: string, name: string) {
  return {
    teamId,
    personId,
    name,
    points: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    reboundsTotal: 0,
    reboundsOffensive: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    foulsPersonal: 0,
  };
}

function getActionPlayerIdentity(action: Record<string, unknown>) {
  const personId = String(
    action.personId ||
    action.playerId ||
    action.person_id ||
    action.player_id ||
    "",
  ).trim();
  const name = String(
    action.playerNameI ||
    action.playerName ||
    action.nameI ||
    action.fullName ||
    action.player ||
    "",
  ).trim();
  if (!personId && !name) return null;
  return {
    personId: personId || name.toLowerCase().replace(/\s+/g, "-"),
    name: name || "Unknown",
  };
}

function buildPlayerRangeStats(
  rangeActions: Array<Record<string, unknown>>,
  scoringEvents: Array<Record<string, unknown>>,
) {
  const playerTotals = new Map<string, ReturnType<typeof buildPlayerTotals>>();
  const scoringByActionNumber = new Map<number, number>();

  scoringEvents.forEach((event) => {
    scoringByActionNumber.set(safeNumber(event.actionNumber, 0), safeNumber(event.points, 0));
  });

  const upsertPlayer = (action: Record<string, unknown>) => {
    const teamId = String(action.teamId || "").trim();
    const identity = getActionPlayerIdentity(action);
    if (!teamId || !identity) return null;
    const key = `${teamId}:${identity.personId}`;
    if (!playerTotals.has(key)) {
      playerTotals.set(key, buildPlayerTotals(teamId, identity.personId, identity.name));
    }
    return playerTotals.get(key)!;
  };

  for (const action of rangeActions) {
    const actionType = String(action.actionType || "").toLowerCase();
    const player = upsertPlayer(action);
    if (!player) continue;
    const points = scoringByActionNumber.get(safeNumber(action.actionNumber, 0)) || 0;
    const made = points > 0 || String(action.shotResult || "").toLowerCase() === "made";

    if (actionType === "2pt" || actionType === "3pt") {
      player.fieldGoalsAttempted += 1;
      if (actionType === "3pt") player.threePointersAttempted += 1;
      if (made) {
        player.points += points;
        player.fieldGoalsMade += 1;
        if (actionType === "3pt") player.threePointersMade += 1;
      }
    }

    if (actionType === "freethrow") {
      player.freeThrowsAttempted += 1;
      if (made) {
        player.freeThrowsMade += 1;
        player.points += points || 1;
      }
    }

    if (actionType === "rebound") {
      player.reboundsTotal += 1;
      const subType = String(action.subType || "").toLowerCase();
      if (subType.includes("offensive")) player.reboundsOffensive += 1;
    }

    if (actionType === "assist") player.assists += 1;
    if (actionType === "steal") player.steals += 1;
    if (actionType === "block") player.blocks += 1;
    if (actionType === "turnover") player.turnovers += 1;
    if (actionType === "foul" && isPersonalFoul(action)) player.foulsPersonal += 1;
  }

  return [...playerTotals.values()];
}

function buildPlayerInsights(
  playerTotals: Array<ReturnType<typeof buildPlayerTotals>>,
  homeTeam: Record<string, unknown>,
  awayTeam: Record<string, unknown>,
  homePoints: number,
  awayPoints: number,
) {
  const teamPointsById: Record<string, number> = {
    [String(homeTeam.teamId || "")]: homePoints,
    [String(awayTeam.teamId || "")]: awayPoints,
  };
  const teamLookup: Record<string, Record<string, unknown>> = {
    [String(homeTeam.teamId || "")]: homeTeam,
    [String(awayTeam.teamId || "")]: awayTeam,
  };

  const featured = Object.keys(teamPointsById)
    .map((teamId) => {
      const teamPlayers = playerTotals
        .filter((entry) => entry.teamId === teamId)
        .sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points;
          if (b.assists !== a.assists) return b.assists - a.assists;
          return b.reboundsTotal - a.reboundsTotal;
        });
      const leader = teamPlayers[0] || null;
      if (!leader) return null;
      const teamPoints = Math.max(0, teamPointsById[teamId] || 0);
      const pointShare = teamPoints > 0 ? leader.points / teamPoints : 0;
      const statBits = [];
      if (leader.assists >= 3) statBits.push(`${leader.assists} AST`);
      if (leader.reboundsTotal >= 4) statBits.push(`${leader.reboundsTotal} REB`);
      if (leader.steals >= 2) statBits.push(`${leader.steals} STL`);
      if (leader.blocks >= 2) statBits.push(`${leader.blocks} BLK`);

      const noteStrength = (leader.points * 3) + (pointShare * 10) + leader.assists + leader.reboundsTotal;
      if (leader.points < 6 && !statBits.length) return null;

      const detail = statBits.length ? ` with ${statBits.join(", ")}` : "";
      const shareText = teamPoints > 0 && (pointShare >= 0.4 || leader.points >= 10)
        ? `, accounting for ${leader.points} of ${teamLabel(teamLookup[teamId])}'s ${teamPoints} points`
        : "";

      return {
        strength: noteStrength,
        note: `${teamLabel(teamLookup[teamId])} player note: ${leader.name} had ${leader.points} PTS${detail}${shareText}.`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b!.strength - a!.strength)
    .map((entry) => entry!.note);

  const negativeNotes = playerTotals
    .filter((entry) => entry.turnovers >= 3 || entry.foulsPersonal >= 4)
    .sort((a, b) => ((b.turnovers + b.foulsPersonal) - (a.turnovers + a.foulsPersonal)))
    .slice(0, 1)
    .map((entry) => {
      const team = teamLookup[entry.teamId];
      const parts = [];
      if (entry.turnovers >= 3) parts.push(`${entry.turnovers} TO`);
      if (entry.foulsPersonal >= 4) parts.push(`${entry.foulsPersonal} PF`);
      return `${teamLabel(team)} caution: ${entry.name} finished this span with ${parts.join(" and ")}.`;
    });

  return [...featured, ...negativeNotes].slice(0, 3);
}

function aggregateRangeStats(
  rangeActions: Array<Record<string, unknown>>,
  scoringEvents: Array<Record<string, unknown>>,
  homeTeamId: string,
  awayTeamId: string,
) {
  const totals: Record<string, ReturnType<typeof buildTeamActionTotals>> = {
    [homeTeamId]: buildTeamActionTotals(homeTeamId),
    [awayTeamId]: buildTeamActionTotals(awayTeamId),
  };

  const scoringByActionNumber = new Map<number, number>();
  scoringEvents.forEach((event) => {
    scoringByActionNumber.set(safeNumber(event.actionNumber, 0), safeNumber(event.points, 0));
    const teamTotals = totals[String(event.teamId || "")];
    if (teamTotals) {
      teamTotals.points += safeNumber(event.points, 0);
    }
  });

  for (const action of rangeActions) {
    const teamId = String(action.teamId || "");
    const actionType = String(action.actionType || "").toLowerCase();
    const teamTotals = totals[teamId];
    const opponentId = teamId === homeTeamId ? awayTeamId : homeTeamId;
    const opponentTotals = totals[opponentId];
    const qualifiers = normalizeQualifiers(action.qualifiers);
    const points = scoringByActionNumber.get(safeNumber(action.actionNumber, 0)) || 0;
    const made = points > 0 || String(action.shotResult || "").toLowerCase() === "made";

    if (actionType === "2pt" || actionType === "3pt") {
      if (teamTotals) {
        teamTotals.fieldGoalsAttempted += 1;
        if (actionType === "3pt") teamTotals.threePointersAttempted += 1;
        const shotType = classifyShot(action);
        if (shotType === "rim") teamTotals.rimFieldGoalsAttempted += 1;
        if (shotType === "mid") teamTotals.midFieldGoalsAttempted += 1;
        if (qualifiers.includes("fastbreak")) teamTotals.transitionPossessions += 1;
      }
      if (made && teamTotals) {
        teamTotals.fieldGoalsMade += 1;
        if (actionType === "3pt") teamTotals.threePointersMade += 1;
        const shotType = classifyShot(action);
        if (shotType === "rim") teamTotals.rimFieldGoalsMade += 1;
        if (shotType === "mid") teamTotals.midFieldGoalsMade += 1;
        if (qualifiers.includes("fastbreak")) teamTotals.transitionPoints += points;
        if (qualifiers.includes("secondchance")) teamTotals.secondChancePoints += points;
        if (qualifiers.includes("fromturnover")) teamTotals.pointsOffTurnovers += points;
        if (qualifiers.includes("pointsinthepaint")) teamTotals.paintPoints += points;
      }
    }

    if (actionType === "freethrow" && teamTotals) {
      teamTotals.freeThrowsAttempted += 1;
      if (made) teamTotals.freeThrowsMade += 1;
    }

    if (actionType === "rebound" && teamTotals) {
      const subType = String(action.subType || "").toLowerCase();
      teamTotals.reboundsTotal += 1;
      if (subType.includes("offensive")) {
        teamTotals.reboundsOffensive += 1;
      }
    }

    if (actionType === "turnover" && teamTotals) {
      teamTotals.turnovers += 1;
      if (opponentTotals) opponentTotals.transitionTurnovers += 1;
    }

    if (actionType === "steal" && teamTotals) {
      teamTotals.steals += 1;
    }

    if (actionType === "block" && teamTotals) {
      teamTotals.blocks += 1;
    }

    if (actionType === "assist" && teamTotals) {
      teamTotals.assists += 1;
    }

    if (actionType === "foul" && teamTotals && isPersonalFoul(action)) {
      teamTotals.foulsPersonal += 1;
    }
  }

  return totals;
}

function buildRunSummary(scoringEvents: Array<Record<string, unknown>>, homeTeamId: string, awayTeamId: string) {
  const bestByTeam: Record<string, { points: number; startLabel: string; endLabel: string } | null> = {
    [homeTeamId]: null,
    [awayTeamId]: null,
  };

  let currentTeamId = "";
  let currentPoints = 0;
  let currentStartLabel = "";

  for (const event of scoringEvents) {
    const teamId = String(event.teamId || "");
    const label = formatPointLabel(safeNumber(event.period, 0), event.clock);
    if (teamId !== currentTeamId) {
      currentTeamId = teamId;
      currentPoints = safeNumber(event.points, 0);
      currentStartLabel = label;
    } else {
      currentPoints += safeNumber(event.points, 0);
    }

    const previousBest = bestByTeam[teamId];
    if (!previousBest || currentPoints > previousBest.points) {
      bestByTeam[teamId] = {
        points: currentPoints,
        startLabel: currentStartLabel,
        endLabel: label,
      };
    }
  }

  return bestByTeam;
}

function buildScoreTimeline(
  scoringEvents: Array<Record<string, unknown>>,
  rangeStartElapsed: number,
  startScore: { home: number; away: number },
  homeTeamId: string,
  awayTeamId: string,
) {
  const startPoint = elapsedSecondsToPoint(rangeStartElapsed);
  const timeline = [{
    elapsed: rangeStartElapsed,
    period: startPoint.period,
    clock: startPoint.clock,
    scoreHome: startScore.home,
    scoreAway: startScore.away,
  }];

  scoringEvents.forEach((event) => {
    timeline.push({
      elapsed: safeNumber(event.elapsed, 0),
      period: safeNumber(event.period, 0),
      clock: String(event.clock || "0:00"),
      scoreHome: safeNumber(event.scoreHome, 0),
      scoreAway: safeNumber(event.scoreAway, 0),
    });
  });

  return timeline.map((entry) => {
    const margin = entry.scoreHome - entry.scoreAway;
    return {
      ...entry,
      leaderId: margin > 0 ? homeTeamId : margin < 0 ? awayTeamId : "",
      margin,
      label: formatPointLabel(entry.period, entry.clock),
    };
  });
}

function buildGameFlowContext(
  timeline: Array<{
    elapsed: number;
    period: number;
    clock: string;
    scoreHome: number;
    scoreAway: number;
    leaderId: string;
    margin: number;
    label: string;
  }>,
  homeTeam: Record<string, unknown>,
  awayTeam: Record<string, unknown>,
) {
  const homeTeamId = String(homeTeam.teamId || "");
  const awayTeamId = String(awayTeam.teamId || "");
  const largestLead = {
    [homeTeamId]: { points: 0, label: "" },
    [awayTeamId]: { points: 0, label: "" },
  };

  let leadChanges = 0;
  let tieMoments = 0;
  let lastNonTieLeader = timeline[0]?.leaderId || "";
  let previousMargin = timeline[0]?.margin || 0;

  timeline.forEach((entry, index) => {
    const homeLead = entry.scoreHome - entry.scoreAway;
    const awayLead = -homeLead;
    if (homeLead > largestLead[homeTeamId].points) {
      largestLead[homeTeamId] = { points: homeLead, label: entry.label };
    }
    if (awayLead > largestLead[awayTeamId].points) {
      largestLead[awayTeamId] = { points: awayLead, label: entry.label };
    }

    if (index === 0) return;

    if (entry.margin === 0 && previousMargin !== 0) {
      tieMoments += 1;
    }
    if (entry.leaderId && lastNonTieLeader && entry.leaderId !== lastNonTieLeader) {
      leadChanges += 1;
    }
    if (entry.leaderId) {
      lastNonTieLeader = entry.leaderId;
    }
    previousMargin = entry.margin;
  });

  const homeLargest = largestLead[homeTeamId];
  const awayLargest = largestLead[awayTeamId];
  let shape = "steady";
  let items = [
    `${teamLabel(homeTeam)}'s largest lead was ${homeLargest.points} at ${homeLargest.label || "the start of the span"}; ${teamLabel(awayTeam)}'s largest lead was ${awayLargest.points} at ${awayLargest.label || "the start of the span"}.`,
  ];

  if (leadChanges >= 3 || (tieMoments >= 2 && homeLargest.points >= 4 && awayLargest.points >= 4)) {
    shape = "volatile";
    items = [
      `The stretch swung repeatedly with ${leadChanges} lead change${leadChanges === 1 ? "" : "s"} and ${tieMoments} tie${tieMoments === 1 ? "" : "s"}.`,
      `${teamLabel(homeTeam)} led by as many as ${homeLargest.points}; ${teamLabel(awayTeam)} led by as many as ${awayLargest.points}.`,
    ];
  } else if (homeLargest.points >= 8 || awayLargest.points >= 8) {
    shape = "control";
    const controllingTeam = homeLargest.points >= awayLargest.points ? homeTeam : awayTeam;
    const controllingLead = Math.max(homeLargest.points, awayLargest.points);
    items = [
      `${teamLabel(controllingTeam)} created the clearest separation, building a ${controllingLead}-point cushion in this span.`,
      `${teamLabel(homeTeam)}'s largest lead was ${homeLargest.points}; ${teamLabel(awayTeam)}'s was ${awayLargest.points}.`,
    ];
  }

  return {
    shape,
    leadChanges,
    ties: tieMoments,
    largestLead,
    items,
    strength: leadChanges >= 3 ? leadChanges + tieMoments : Math.max(homeLargest.points, awayLargest.points) * 0.6,
  };
}

function buildMomentumBursts(
  scoringEvents: Array<Record<string, unknown>>,
  homeTeam: Record<string, unknown>,
  awayTeam: Record<string, unknown>,
) {
  const homeTeamId = String(homeTeam.teamId || "");
  const awayTeamId = String(awayTeam.teamId || "");
  const teamIds = [homeTeamId, awayTeamId];
  const bestByTeam: Record<string, null | {
    teamId: string;
    points: number;
    opponentPoints: number;
    net: number;
    startLabel: string;
    endLabel: string;
  }> = {
    [homeTeamId]: null,
    [awayTeamId]: null,
  };

  for (const teamId of teamIds) {
    for (let index = 0; index < scoringEvents.length; index += 1) {
      const startEvent = scoringEvents[index];
      const startElapsed = safeNumber(startEvent.elapsed, 0);
      let teamPoints = 0;
      let opponentPoints = 0;

      for (let nextIndex = index; nextIndex < scoringEvents.length; nextIndex += 1) {
        const nextEvent = scoringEvents[nextIndex];
        const elapsedDelta = safeNumber(nextEvent.elapsed, 0) - startElapsed;
        if (elapsedDelta > 150) break;

        if (String(nextEvent.teamId || "") === teamId) {
          teamPoints += safeNumber(nextEvent.points, 0);
        } else {
          opponentPoints += safeNumber(nextEvent.points, 0);
        }

        const net = teamPoints - opponentPoints;
        if (teamPoints < 6 || net < 5) continue;

        const previousBest = bestByTeam[teamId];
        if (!previousBest || net > previousBest.net || (net === previousBest.net && teamPoints > previousBest.points)) {
          bestByTeam[teamId] = {
            teamId,
            points: teamPoints,
            opponentPoints,
            net,
            startLabel: formatPointLabel(safeNumber(startEvent.period, 0), startEvent.clock),
            endLabel: formatPointLabel(safeNumber(nextEvent.period, 0), nextEvent.clock),
          };
        }
      }
    }
  }

  return teamIds
    .map((teamId) => bestByTeam[teamId])
    .filter(Boolean)
    .sort((a, b) => b!.net - a!.net)
    .map((burst) => ({
      ...burst!,
      team: burst!.teamId === homeTeamId ? teamLabel(homeTeam) : teamLabel(awayTeam),
      items: [
        `${burst!.teamId === homeTeamId ? teamLabel(homeTeam) : teamLabel(awayTeam)}'s best push was ${burst!.points}-${burst!.opponentPoints} from ${burst!.startLabel} to ${burst!.endLabel}.`,
      ],
      strength: burst!.net,
    }));
}

function scoreForTeam(score: { home: number; away: number }, teamId: string, homeTeamId: string, awayTeamId: string) {
  if (teamId === homeTeamId) return score.home;
  if (teamId === awayTeamId) return score.away;
  return 0;
}

function opponentTeamId(teamId: string, homeTeamId: string, awayTeamId: string) {
  return teamId === homeTeamId ? awayTeamId : homeTeamId;
}

function buildLateSwingInsight(
  actions: Array<Record<string, unknown>>,
  scoringEvents: Array<Record<string, unknown>>,
  rangeStartElapsed: number,
  rangeEndElapsed: number,
  maxPeriod: number,
  maxClock: string,
  homeTeam: Record<string, unknown>,
  awayTeam: Record<string, unknown>,
) {
  const maxClockSeconds = parseClockToSeconds(maxClock);
  const nearPeriodEnd = maxClockSeconds <= 2;
  if (!nearPeriodEnd) return null;

  const homeTeamId = String(homeTeam.teamId || "");
  const awayTeamId = String(awayTeam.teamId || "");
  if (!homeTeamId || !awayTeamId) return null;

  const lateWindowSeconds = 120;
  const lateWindowStart = Math.max(rangeStartElapsed, rangeEndElapsed - lateWindowSeconds);
  if ((rangeEndElapsed - lateWindowStart) < 20) return null;

  const startScore = findScoreAtOrBefore(actions, lateWindowStart);
  const endScore = findScoreAtOrBefore(actions, rangeEndElapsed);
  const endEvents = scoringEvents.filter((event) => event.elapsed >= lateWindowStart && event.elapsed <= rangeEndElapsed);
  if (!endEvents.length) return null;

  const scoreMoments = [
    (() => {
      const point = elapsedSecondsToPoint(lateWindowStart);
      return {
        elapsed: lateWindowStart,
        period: point.period,
        clock: point.clock,
        scoreHome: startScore.home,
        scoreAway: startScore.away,
      };
    })(),
    ...endEvents.map((event) => ({
      elapsed: safeNumber(event.elapsed, 0),
      period: safeNumber(event.period, maxPeriod),
      clock: String(event.clock || "0:00"),
      scoreHome: safeNumber(event.scoreHome, 0),
      scoreAway: safeNumber(event.scoreAway, 0),
    })),
  ];

  const finalMargins = {
    [homeTeamId]: endScore.home - endScore.away,
    [awayTeamId]: endScore.away - endScore.home,
  };
  const teamLookup: Record<string, Record<string, unknown>> = {
    [homeTeamId]: homeTeam,
    [awayTeamId]: awayTeam,
  };

  let bestCandidate: null | {
    type: "collapse" | "comeback";
    teamId: string;
    opponentId: string;
    peakLead: number;
    peakLabel: string;
    peakElapsed: number;
    finalMargin: number;
    strength: number;
  } = null;

  const teamIds = [homeTeamId, awayTeamId];

  for (const moment of scoreMoments) {
    for (const teamId of teamIds) {
      const opponentId = opponentTeamId(teamId, homeTeamId, awayTeamId);
      const teamScore = scoreForTeam(
        { home: moment.scoreHome, away: moment.scoreAway },
        teamId,
        homeTeamId,
        awayTeamId,
      );
      const opponentScore = scoreForTeam(
        { home: moment.scoreHome, away: moment.scoreAway },
        opponentId,
        homeTeamId,
        awayTeamId,
      );
      const lead = teamScore - opponentScore;
      const deficit = opponentScore - teamScore;
      const finalMargin = finalMargins[teamId];
      const timeLeft = Math.max(0, rangeEndElapsed - moment.elapsed);
      const collapse = lead >= 4 && finalMargin <= 0;
      const comeback = deficit >= 4 && finalMargin >= 0;
      if (!collapse && !comeback) continue;

      const type = collapse ? "collapse" : "comeback";
      const peakLead = collapse ? lead : deficit;
      const urgencyBoost = Math.max(0, 90 - timeLeft) / 15;
      const reversalBoost = Math.abs(finalMargin) + (finalMargin === 0 ? 1.5 : 0);
      const strength = (peakLead * 2.5) + urgencyBoost + reversalBoost;
      if (!bestCandidate || strength > bestCandidate.strength) {
        bestCandidate = {
          type,
          teamId,
          opponentId,
          peakLead,
          peakLabel: formatPointLabel(moment.period, moment.clock),
          peakElapsed: moment.elapsed,
          finalMargin,
          strength,
        };
      }
    }
  }

  if (!bestCandidate) return null;

  const closingScores = endEvents.filter((event) => event.elapsed >= bestCandidate.peakElapsed);
  const scoringTeamId = bestCandidate.type === "collapse" ? bestCandidate.opponentId : bestCandidate.teamId;
  const scoringTeamPoints = closingScores
    .filter((event) => String(event.teamId || "") === scoringTeamId)
    .reduce((sum, event) => sum + safeNumber(event.points, 0), 0);
  const otherTeamPoints = closingScores
    .filter((event) => String(event.teamId || "") !== scoringTeamId)
    .reduce((sum, event) => sum + safeNumber(event.points, 0), 0);

  const team = teamLookup[bestCandidate.teamId];
  const opponent = teamLookup[bestCandidate.opponentId];
  const finishText = bestCandidate.finalMargin < 0
    ? `ended the span trailing by ${Math.abs(bestCandidate.finalMargin)}`
    : bestCandidate.finalMargin === 0
      ? "only got to the horn tied"
      : `still finished ahead by ${bestCandidate.finalMargin}`;
  const title = bestCandidate.type === "collapse" ? "Late Collapse" : "Late Comeback";

  return {
    title,
    strength: bestCandidate.strength,
    type: bestCandidate.type,
    team: teamLabel(team),
    opponent: teamLabel(opponent),
    peakLead: bestCandidate.peakLead,
    peakLabel: bestCandidate.peakLabel,
    finalMargin: bestCandidate.finalMargin,
    closingRun: {
      team: teamLabel(scoringTeamId === homeTeamId ? homeTeam : awayTeam),
      points: scoringTeamPoints,
      opponentPoints: otherTeamPoints,
    },
    items: bestCandidate.type === "collapse"
      ? [
        `${teamLabel(team)} led by ${bestCandidate.peakLead} at ${bestCandidate.peakLabel} but ${finishText}.`,
        `${teamLabel(opponent)} closed regulation on a ${scoringTeamPoints}-${otherTeamPoints} run from that point.`,
      ]
      : [
        `${teamLabel(opponent)} erased a ${bestCandidate.peakLead}-point deficit after ${bestCandidate.peakLabel} and ${finishText}.`,
        `${teamLabel(opponent)} closed regulation on a ${scoringTeamPoints}-${otherTeamPoints} run from that point.`,
      ],
  };
}

function buildLineupInsights(
  minutesData: Record<string, unknown> | null,
  rangeStartElapsed: number,
  rangeEndElapsed: number,
  homeTeam: Record<string, unknown>,
  awayTeam: Record<string, unknown>,
  homeMargin: number,
  awayMargin: number,
) {
  const rangeSeconds = Math.max(1, rangeEndElapsed - rangeStartElapsed);
  const stintNotes: Array<{
    teamId: string;
    seconds: number;
    margin: number;
    players: string;
  }> = [];
  const playerSplits = new Map<string, {
    teamId: string;
    name: string;
    onSeconds: number;
    onMargin: number;
  }>();

  const upsertPlayer = (teamId: string, player: Record<string, unknown>, margin: number, seconds: number) => {
    const personId = String(player?.personId || "");
    const name = String(player?.nameI || player?.fullName || player?.playerName || "").trim();
    if (!personId || !name || seconds <= 0) return;
    const key = `${teamId}:${personId}`;
    if (!playerSplits.has(key)) {
      playerSplits.set(key, {
        teamId,
        name,
        onSeconds: 0,
        onMargin: 0,
      });
    }
    const entry = playerSplits.get(key)!;
    entry.onSeconds += seconds;
    entry.onMargin += margin;
  };

  const periods = Array.isArray(minutesData?.periods) ? minutesData.periods : [];
  for (const periodRow of periods) {
    const period = safeNumber(periodRow?.period, 0);
    const stints = Array.isArray(periodRow?.stints) ? periodRow.stints : [];
    for (const stint of stints) {
      const stintStart = pointToElapsedSeconds(period, stint.startClock);
      const stintEnd = pointToElapsedSeconds(period, stint.endClock);
      const overlapStart = Math.max(rangeStartElapsed, stintStart);
      const overlapEnd = Math.min(rangeEndElapsed, stintEnd);
      const overlapSeconds = overlapEnd - overlapStart;
      if (overlapSeconds <= 0) continue;

      const fullSeconds = Math.max(1, stintEnd - stintStart);
      const weight = overlapSeconds / fullSeconds;
      const weightedHomeMargin = safeNumber(stint.plusMinus, 0) * weight;
      const weightedAwayMargin = -weightedHomeMargin;

      const homePlayers = Array.isArray(stint.playersHome) ? stint.playersHome : [];
      const awayPlayers = Array.isArray(stint.playersAway) ? stint.playersAway : [];

      stintNotes.push({
        teamId: String(homeTeam.teamId),
        seconds: overlapSeconds,
        margin: weightedHomeMargin,
        players: describeLineup(homePlayers),
      });
      stintNotes.push({
        teamId: String(awayTeam.teamId),
        seconds: overlapSeconds,
        margin: weightedAwayMargin,
        players: describeLineup(awayPlayers),
      });

      homePlayers.forEach((player) => upsertPlayer(String(homeTeam.teamId), player, weightedHomeMargin, overlapSeconds));
      awayPlayers.forEach((player) => upsertPlayer(String(awayTeam.teamId), player, weightedAwayMargin, overlapSeconds));
    }
  }

  const topStints = [String(homeTeam.teamId), String(awayTeam.teamId)]
    .map((teamId) => {
      const ranked = stintNotes
        .filter((entry) => entry.teamId === teamId && entry.seconds >= 60)
        .sort((a, b) => b.margin - a.margin);
      return ranked[0] || null;
    })
    .filter(Boolean)
    .map((entry) => {
      const team = String(entry!.teamId) === String(homeTeam.teamId) ? homeTeam : awayTeam;
      return `${teamLabel(team)} best stint: ${describeLineupString(entry!.players)} was ${formatSignedValue(Math.round(entry!.margin))} in ${formatSecondsClock(entry!.seconds)}.`;
    });

  const playerNotes = [String(homeTeam.teamId), String(awayTeam.teamId)]
    .map((teamId) => {
      const teamMargin = teamId === String(homeTeam.teamId) ? homeMargin : awayMargin;
      const candidates = [...playerSplits.values()]
        .filter((entry) => entry.teamId === teamId && entry.onSeconds >= 120 && entry.onSeconds < rangeSeconds)
        .map((entry) => {
          const offSeconds = rangeSeconds - entry.onSeconds;
          if (offSeconds < 60) return null;
          const offMargin = teamMargin - entry.onMargin;
          const onPer40 = (entry.onMargin / entry.onSeconds) * (40 * 60);
          const offPer40 = (offMargin / offSeconds) * (40 * 60);
          return {
            ...entry,
            offSeconds,
            onPer40,
            offPer40,
            differential: onPer40 - offPer40,
          };
        })
        .filter(Boolean)
        .sort((a, b) => Math.abs(b!.differential) - Math.abs(a!.differential));
      return candidates[0] || null;
    })
    .filter(Boolean)
    .map((entry) => {
      const team = entry!.teamId === String(homeTeam.teamId) ? homeTeam : awayTeam;
      return `${teamLabel(team)} on/off: ${entry!.name} was ${formatSignedValue(Math.round(entry!.onPer40))} per 40 on court versus ${formatSignedValue(Math.round(entry!.offPer40))} per 40 off court in this span.`;
    });

  return {
    lineupNotes: [...topStints, ...playerNotes].slice(0, 4),
  };
}

function describeLineupString(players: string) {
  if (!players) return "That group";
  return players;
}

function leaderInfo(features: ReturnType<typeof buildFeaturePayload>) {
  const { home, away } = features.teams;
  const homeMargin = safeNumber(features.score.margin.home, 0);
  const leader = homeMargin >= 0 ? home : away;
  const trailer = homeMargin >= 0 ? away : home;
  const leaderPoints = homeMargin >= 0
    ? safeNumber(features.score.rangePoints.home, 0)
    : safeNumber(features.score.rangePoints.away, 0);
  const trailerPoints = homeMargin >= 0
    ? safeNumber(features.score.rangePoints.away, 0)
    : safeNumber(features.score.rangePoints.home, 0);
  return {
    homeMargin,
    margin: Math.abs(homeMargin),
    leader,
    trailer,
    leaderPoints,
    trailerPoints,
  };
}

function buildFeaturePayload(
  game: Record<string, unknown>,
  minutesData: Record<string, unknown> | null,
  range: Record<string, unknown>,
) {
  const homeTeam = (game.homeTeam || {}) as Record<string, unknown>;
  const awayTeam = (game.awayTeam || {}) as Record<string, unknown>;
  const homeTeamId = String(homeTeam.teamId || "");
  const awayTeamId = String(awayTeam.teamId || "");
  const actions = sortActions(Array.isArray(game.playByPlayActions) ? game.playByPlayActions : []);

  const minPeriod = safeNumber(range.minPeriod, 1);
  const maxPeriod = safeNumber(range.maxPeriod, 1);
  const minClock = String(range.minClock || "12:00");
  const maxClock = String(range.maxClock || "0:00");
  const rangeStartElapsed = pointToElapsedSeconds(minPeriod, minClock);
  const rangeEndElapsed = pointToElapsedSeconds(maxPeriod, maxClock);
  const allowedMaxElapsed = game.gameStatus === 2
    ? pointToElapsedSeconds(safeNumber(game.period, maxPeriod), game.gameClock)
    : pointToElapsedSeconds(Math.max(1, safeNumber(game.period, maxPeriod)), "0:00");

  if (rangeEndElapsed > allowedMaxElapsed) {
    throw new Error(`Max time cannot be later than ${formatPointLabel(safeNumber(game.period, maxPeriod), game.gameClock || "0:00")}.`);
  }

  if (rangeStartElapsed >= rangeEndElapsed) {
    throw new Error("Min time must be earlier than max time.");
  }

  const rangeActions = actions.filter((action) => {
    const elapsed = pointToElapsedSeconds(safeNumber(action.period, 0), action.clock);
    return elapsed >= rangeStartElapsed && elapsed <= rangeEndElapsed;
  });

  const allScoringEvents = buildScoringEvents(actions, homeTeamId, awayTeamId);
  const scoringEvents = allScoringEvents.filter((event) => event.elapsed >= rangeStartElapsed && event.elapsed <= rangeEndElapsed);
  const startScore = findScoreAtOrBefore(actions, rangeStartElapsed);
  const endScore = findScoreAtOrBefore(actions, rangeEndElapsed);
  const homePoints = endScore.home - startScore.home;
  const awayPoints = endScore.away - startScore.away;
  const homeMargin = homePoints - awayPoints;
  const awayMargin = -homeMargin;
  const scoreTimeline = buildScoreTimeline(scoringEvents, rangeStartElapsed, startScore, homeTeamId, awayTeamId);

  const totals = aggregateRangeStats(rangeActions, scoringEvents, homeTeamId, awayTeamId);
  const playerTotals = buildPlayerRangeStats(rangeActions, scoringEvents);
  const runs = buildRunSummary(scoringEvents, homeTeamId, awayTeamId);
  const gameFlow = buildGameFlowContext(scoreTimeline, homeTeam, awayTeam);
  const momentumBursts = buildMomentumBursts(scoringEvents, homeTeam, awayTeam);
  const lateSwing = buildLateSwingInsight(
    actions,
    scoringEvents,
    rangeStartElapsed,
    rangeEndElapsed,
    maxPeriod,
    maxClock,
    homeTeam,
    awayTeam,
  );
  const lineupInsights = buildLineupInsights(
    minutesData,
    rangeStartElapsed,
    rangeEndElapsed,
    homeTeam,
    awayTeam,
    homeMargin,
    awayMargin,
  );

  const homeTotals = totals[homeTeamId];
  const awayTotals = totals[awayTeamId];
  const playerNotes = buildPlayerInsights(
    playerTotals,
    homeTeam,
    awayTeam,
    homePoints,
    awayPoints,
  );

  return {
    range: {
      startLabel: formatPointLabel(minPeriod, minClock),
      endLabel: formatPointLabel(maxPeriod, maxClock),
      duration: formatSecondsClock(rangeEndElapsed - rangeStartElapsed),
      isLive: safeNumber(game.gameStatus, 0) === 2,
    },
    score: {
      start: {
        home: startScore.home,
        away: startScore.away,
      },
      end: {
        home: endScore.home,
        away: endScore.away,
      },
      rangePoints: {
        home: homePoints,
        away: awayPoints,
      },
      margin: {
        home: homeMargin,
        away: awayMargin,
      },
    },
    teams: {
      home: {
        tricode: teamLabel(homeTeam),
        name: String(homeTeam.teamName || teamLabel(homeTeam)),
        totals: homeTotals,
        shooting: {
          fgPct: percentage(homeTotals.fieldGoalsMade, homeTotals.fieldGoalsAttempted),
          rimPct: percentage(homeTotals.rimFieldGoalsMade, homeTotals.rimFieldGoalsAttempted),
          midPct: percentage(homeTotals.midFieldGoalsMade, homeTotals.midFieldGoalsAttempted),
          threePct: percentage(homeTotals.threePointersMade, homeTotals.threePointersAttempted),
          ftPct: percentage(homeTotals.freeThrowsMade, homeTotals.freeThrowsAttempted),
        },
        largestRun: runs[homeTeamId],
      },
      away: {
        tricode: teamLabel(awayTeam),
        name: String(awayTeam.teamName || teamLabel(awayTeam)),
        totals: awayTotals,
        shooting: {
          fgPct: percentage(awayTotals.fieldGoalsMade, awayTotals.fieldGoalsAttempted),
          rimPct: percentage(awayTotals.rimFieldGoalsMade, awayTotals.rimFieldGoalsAttempted),
          midPct: percentage(awayTotals.midFieldGoalsMade, awayTotals.midFieldGoalsAttempted),
          threePct: percentage(awayTotals.threePointersMade, awayTotals.threePointersAttempted),
          ftPct: percentage(awayTotals.freeThrowsMade, awayTotals.freeThrowsAttempted),
        },
        largestRun: runs[awayTeamId],
      },
    },
    playerNotes,
    gameFlow,
    momentumBursts,
    lateSwing,
    lineupNotes: lineupInsights.lineupNotes,
  };
}

function buildInsightSignals(features: ReturnType<typeof buildFeaturePayload>) {
  const { home, away } = features.teams;
  const { leader, trailer, margin } = leaderInfo(features);
  const signals = [
    {
      key: "shape",
      title: "Game Flow",
      strength: safeNumber(features.gameFlow?.strength, 0),
      items: Array.isArray(features.gameFlow?.items) ? features.gameFlow.items : [],
    },
    {
      key: "burst",
      title: "Momentum Swing",
      strength: safeNumber(features.momentumBursts?.[0]?.strength, 0),
      items: Array.isArray(features.momentumBursts?.[0]?.items) ? features.momentumBursts[0].items : [],
    },
    {
      key: "lateSwing",
      title: features.lateSwing?.title || "Late Swing",
      strength: safeNumber(features.lateSwing?.strength, 0),
      items: Array.isArray(features.lateSwing?.items) ? features.lateSwing.items : [],
    },
    {
      key: "run",
      title: "Run",
      strength: Math.max(
        safeNumber(home.largestRun?.points, 0),
        safeNumber(away.largestRun?.points, 0),
      ),
      items: [home, away]
        .filter((team) => team.largestRun?.points)
        .sort((a, b) => safeNumber(b.largestRun?.points, 0) - safeNumber(a.largestRun?.points, 0))
        .slice(0, 1)
        .map((team) => `${team.tricode} had the biggest unanswered run at ${team.largestRun?.points}-0 from ${team.largestRun?.startLabel} to ${team.largestRun?.endLabel}.`),
    },
    {
      key: "turnovers",
      title: "Possession Battle",
      strength: Math.abs(home.totals.turnovers - away.totals.turnovers) * 1.2,
      items: [
        `${home.tricode} turnovers: ${home.totals.turnovers}. ${away.tricode} turnovers: ${away.totals.turnovers}.`,
        `${home.tricode} points off turnovers: ${home.totals.pointsOffTurnovers}. ${away.tricode} points off turnovers: ${away.totals.pointsOffTurnovers}.`,
      ],
    },
    {
      key: "paint",
      title: "Shot Profile",
      strength: Math.abs(home.totals.paintPoints - away.totals.paintPoints),
      items: [
        `${home.tricode} paint points: ${home.totals.paintPoints}. ${away.tricode} paint points: ${away.totals.paintPoints}.`,
        `${home.tricode} rim scoring was ${home.totals.rimFieldGoalsMade}-${home.totals.rimFieldGoalsAttempted}; ${away.tricode} was ${away.totals.rimFieldGoalsMade}-${away.totals.rimFieldGoalsAttempted}.`,
      ],
    },
    {
      key: "transition",
      title: "Transition",
      strength: Math.abs(home.totals.transitionPoints - away.totals.transitionPoints),
      items: [
        `${home.tricode} transition points: ${home.totals.transitionPoints}. ${away.tricode} transition points: ${away.totals.transitionPoints}.`,
        `${home.tricode} second-chance points: ${home.totals.secondChancePoints}. ${away.tricode} second-chance points: ${away.totals.secondChancePoints}.`,
      ],
    },
    {
      key: "shooting",
      title: "Shooting",
      strength: Math.abs(home.shooting.fgPct - away.shooting.fgPct) + (margin * 0.5),
      items: [
        `${home.tricode} shot ${home.totals.fieldGoalsMade}-${home.totals.fieldGoalsAttempted} (${home.shooting.fgPct}%) versus ${away.tricode} at ${away.totals.fieldGoalsMade}-${away.totals.fieldGoalsAttempted} (${away.shooting.fgPct}%).`,
        `${home.tricode} from three: ${home.totals.threePointersMade}-${home.totals.threePointersAttempted}; ${away.tricode}: ${away.totals.threePointersMade}-${away.totals.threePointersAttempted}.`,
      ],
    },
    {
      key: "players",
      title: "Players",
      strength: features.playerNotes.length ? 4.5 : 0,
      items: features.playerNotes.slice(0, 2),
    },
    {
      key: "lineups",
      title: "Lineups",
      strength: features.lineupNotes.length ? 3 : 0,
      items: features.lineupNotes.slice(0, 2),
    },
    {
      key: "freeThrows",
      title: "Free Throws",
      strength: Math.abs(home.totals.freeThrowsAttempted - away.totals.freeThrowsAttempted),
      items: [
        `${home.tricode} free throws: ${home.totals.freeThrowsMade}-${home.totals.freeThrowsAttempted}. ${away.tricode}: ${away.totals.freeThrowsMade}-${away.totals.freeThrowsAttempted}.`,
      ],
    },
    {
      key: "gameFlow",
      title: "Game Flow",
      strength: margin * 0.7,
      items: [
        `${leader.tricode} won the stretch ${leaderPointsLabel(features)} and pushed the score from ${features.score.start.away}-${features.score.start.home} to ${features.score.end.away}-${features.score.end.home}.`,
        `${leader.tricode} controlled this window by ${margin} point${margin === 1 ? "" : "s"} over ${features.range.duration}.`,
      ],
    },
  ];

  return signals
    .map((signal) => ({
      ...signal,
      items: signal.items.filter(Boolean),
    }))
    .filter((signal) => signal.strength > 0 && signal.items.length);
}

function leaderPointsLabel(features: ReturnType<typeof buildFeaturePayload>) {
  const info = leaderInfo(features);
  return `${info.leaderPoints}-${info.trailerPoints}`;
}

function buildTemplateSections(features: ReturnType<typeof buildFeaturePayload>) {
  return buildInsightSignals(features)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 3)
    .map((signal) => ({
      title: signal.title,
      items: signal.items.slice(0, signal.key === "gameFlow" ? 1 : 2),
    }));
}

function buildSwingFactors(features: ReturnType<typeof buildFeaturePayload>) {
  const { home, away } = features.teams;
  const factors = [
    ...(Array.isArray(features.lateSwing?.items) ? [features.lateSwing.items[0]].filter(Boolean).map((text) => ({
      label: "lateSwing",
      value: safeNumber(features.lateSwing?.strength, 0),
      text,
    })) : []),
    ...(Array.isArray(features.momentumBursts) ? features.momentumBursts.slice(0, 1).map((burst) => ({
      label: "momentumBurst",
      value: safeNumber(burst.strength, 0),
      text: burst.items[0],
    })) : []),
    {
      label: "turnovers",
      value: away.totals.turnovers - home.totals.turnovers,
      text: `${home.tricode} won turnovers ${formatSignedValue(away.totals.turnovers - home.totals.turnovers)} (${home.totals.turnovers} to ${away.totals.turnovers}).`,
    },
    {
      label: "paint",
      value: home.totals.paintPoints - away.totals.paintPoints,
      text: `${home.tricode} paint points edge: ${home.totals.paintPoints}-${away.totals.paintPoints}.`,
    },
    {
      label: "transition",
      value: home.totals.transitionPoints - away.totals.transitionPoints,
      text: `${home.tricode} transition points edge: ${home.totals.transitionPoints}-${away.totals.transitionPoints}.`,
    },
    {
      label: "secondChance",
      value: home.totals.secondChancePoints - away.totals.secondChancePoints,
      text: `${home.tricode} second-chance points edge: ${home.totals.secondChancePoints}-${away.totals.secondChancePoints}.`,
    },
    {
      label: "pointsOffTurnovers",
      value: home.totals.pointsOffTurnovers - away.totals.pointsOffTurnovers,
      text: `${home.tricode} points off turnovers edge: ${home.totals.pointsOffTurnovers}-${away.totals.pointsOffTurnovers}.`,
    },
  ]
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .filter((item) => item.value !== 0)
    .slice(0, 3)
    .map((item) => item.text);

  const runNotes = [features.teams.home, features.teams.away]
    .filter((team) => team.largestRun?.points)
    .sort((a, b) => safeNumber(b.largestRun?.points, 0) - safeNumber(a.largestRun?.points, 0))
    .slice(0, 1)
    .map((team) => `${team.tricode} had the largest unanswered run at ${team.largestRun?.points}-0 from ${team.largestRun?.startLabel} to ${team.largestRun?.endLabel}.`);

  return [...runNotes, ...factors].slice(0, 4);
}

function buildStatOutliers(features: ReturnType<typeof buildFeaturePayload>) {
  const { home, away } = features.teams;
  const notes = [];

  if (features.playerNotes.length) {
    notes.push(...features.playerNotes.slice(0, 2));
  }

  notes.push(`${home.tricode} shot ${home.totals.fieldGoalsMade}-${home.totals.fieldGoalsAttempted} (${home.shooting.fgPct}%) versus ${away.tricode} at ${away.totals.fieldGoalsMade}-${away.totals.fieldGoalsAttempted} (${away.shooting.fgPct}%).`);
  notes.push(`${home.tricode} rim scoring was ${home.totals.rimFieldGoalsMade}-${home.totals.rimFieldGoalsAttempted}; ${away.tricode} was ${away.totals.rimFieldGoalsMade}-${away.totals.rimFieldGoalsAttempted}.`);
  notes.push(`${home.tricode} from three: ${home.totals.threePointersMade}-${home.totals.threePointersAttempted}; ${away.tricode}: ${away.totals.threePointersMade}-${away.totals.threePointersAttempted}.`);

  if (home.totals.freeThrowsAttempted !== away.totals.freeThrowsAttempted) {
    notes.push(`${home.tricode} free throws: ${home.totals.freeThrowsMade}-${home.totals.freeThrowsAttempted}; ${away.tricode}: ${away.totals.freeThrowsMade}-${away.totals.freeThrowsAttempted}.`);
  }

  return notes.slice(0, 4);
}

function buildTemplateAnalysis(features: ReturnType<typeof buildFeaturePayload>) {
  const { leader, trailer, margin, leaderPoints, trailerPoints } = leaderInfo(features);
  const swingFactors = buildSwingFactors(features);
  const statOutliers = buildStatOutliers(features);
  const sections = buildTemplateSections(features);
  const dominantTitle = sections[0]?.title || "Game Flow";
  let headlineLead = `${leader.tricode} won the stretch`;
  if (dominantTitle === "Run") headlineLead = `${leader.tricode} seized the stretch`;
  if (dominantTitle === "Late Collapse") headlineLead = `${trailer.tricode} stormed back late`;
  if (dominantTitle === "Late Comeback") headlineLead = `${leader.tricode} rallied late`;
  if (dominantTitle === "Momentum Swing") headlineLead = `${leader.tricode} changed the quarter with one push`;
  if (dominantTitle === "Lineups") headlineLead = `${leader.tricode} got the better stint`;
  if (dominantTitle === "Shooting") headlineLead = `${leader.tricode} won the shotmaking window`;

  return {
    source: "template",
    headline: `${headlineLead}${margin === 0 ? "" : ` by ${margin}`} from ${features.range.startLabel} to ${features.range.endLabel}.`,
    summary: `${leader.tricode} outscored ${trailer.tricode} ${leaderPoints}-${trailerPoints} over ${features.range.duration}. The score moved from ${features.score.start.away}-${features.score.start.home} to ${features.score.end.away}-${features.score.end.home}.`,
    sections,
    uniformDetails: {
      swingFactors,
      lineupNotes: features.lineupNotes,
      statOutliers,
    },
    swingFactors,
    lineupNotes: features.lineupNotes,
    statOutliers,
  };
}

async function generateAiAnalysis(features: ReturnType<typeof buildFeaturePayload>) {
  const apiKey = Deno.env.get("OPENAI_API_KEY") || "";
  if (!apiKey) return null;

  const systemPrompt = [
    "You are a basketball analyst.",
    "Use only the structured game data provided.",
    "Do not invent stats, possessions, or player impact claims.",
    "Decide what most shaped this selected stretch instead of forcing equal attention to every category.",
    "Vary sentence structure and avoid repeating the same opening pattern from one answer to the next.",
    "If one theme clearly dominates, center the answer on that theme.",
    "When the data shows a late-game collapse, comeback, or dramatic final-minute swing, make that central to the analysis even if aggregate quarter stats point elsewhere.",
    "Use game-flow context such as lead changes, largest leads, and concentrated momentum bursts to describe how the stretch unfolded, not just who won the box-score categories.",
    "Call out notable individual player stretches when the provided data clearly supports it, especially when one player drove a large share of a team's scoring in the selected window.",
    "Only mention lineup notes when they materially matter in the range.",
    "Return compact JSON with keys: headline, summary, sections.",
    "sections must be an array of 1 to 3 objects with keys: title and items.",
    "Use short, natural section titles. Each section should have 1 or 2 concise bullet strings.",
  ].join(" ");

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_OPENAI_MODEL,
      temperature: 0.2,
      response_format: {
        type: "json_object",
      },
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: JSON.stringify(features),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed (${response.status}).`);
  }

  const data = await response.json();
  const content = String(data?.choices?.[0]?.message?.content || "").trim();
  if (!content) return null;

  const parsed = JSON.parse(content);
  return {
    source: "ai",
    headline: String(parsed?.headline || "").trim(),
    summary: String(parsed?.summary || "").trim(),
    sections: Array.isArray(parsed?.sections)
      ? parsed.sections
        .map((section: unknown) => {
          if (!section || typeof section !== "object" || Array.isArray(section)) return null;
          const title = String((section as Record<string, unknown>).title || "").trim();
          const items = Array.isArray((section as Record<string, unknown>).items)
            ? ((section as Record<string, unknown>).items as unknown[])
              .map((item) => String(item || "").trim())
              .filter(Boolean)
              .slice(0, 2)
            : [];
          if (!title || !items.length) return null;
          return { title, items };
        })
        .filter(Boolean)
        .slice(0, 3)
      : [],
    uniformDetails: null,
    swingFactors: Array.isArray(parsed?.swingFactors) ? parsed.swingFactors.map((item: unknown) => String(item || "").trim()).filter(Boolean) : [],
    lineupNotes: Array.isArray(parsed?.lineupNotes) ? parsed.lineupNotes.map((item: unknown) => String(item || "").trim()).filter(Boolean) : [],
    statOutliers: Array.isArray(parsed?.statOutliers) ? parsed.statOutliers.map((item: unknown) => String(item || "").trim()).filter(Boolean) : [],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  let userClient;
  try {
    userClient = getUserClient(req.headers.get("Authorization") || "");
  } catch (error) {
    return jsonResponse(500, { error: error instanceof Error ? error.message : "Configuration error." });
  }

  const permission = await requireActiveUser(userClient, req);
  if ("error" in permission) {
    return jsonResponse(permission.status, { error: permission.error });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const gameId = String(body?.gameId || "").trim();
    const game = body?.game && typeof body.game === "object" ? body.game : null;
    const minutesData = body?.minutesData && typeof body.minutesData === "object" ? body.minutesData : null;
    const range = typeof body?.range === "object" && body.range ? body.range : {};

    if (!/^\d{10}$/.test(gameId)) {
      return jsonResponse(400, { error: "A valid game ID is required." });
    }
    if (!game) {
      return jsonResponse(400, { error: "Normalized game payload is required." });
    }

    const features = buildFeaturePayload(game, minutesData, range);
    const templateAnalysis = buildTemplateAnalysis(features);

    let analysis = templateAnalysis;
    try {
      const aiAnalysis = await generateAiAnalysis(features);
      if (aiAnalysis?.headline && aiAnalysis?.summary) {
        analysis = aiAnalysis;
      }
    } catch {
      // Keep the deterministic template response when AI is unavailable.
    }

    return jsonResponse(200, {
      ...analysis,
      uniformDetails: templateAnalysis.uniformDetails,
      rangeLabel: `${features.range.startLabel} to ${features.range.endLabel}`,
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : "Unable to generate analysis.",
    });
  }
});
