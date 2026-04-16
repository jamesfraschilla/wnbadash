import { gLeagueHeadshotOverrides } from "./gLeagueHeadshotOverrides.js";
import mysticsLogoAltUrl from "./assets/Mystics_logo_alt.webp";

const API_BASE = "https://d1rjt2wyntx8o7.cloudfront.net/api";
const WNBA_SCHEDULE_URL = "https://cdn.wnba.com/static/json/staticData/scheduleLeagueV2.json";
const WNBA_LIVE_BOXSCORE_BASE = "https://cdn.wnba.com/static/json/liveData/boxscore";
const WNBA_LIVE_PLAYBYPLAY_BASE = "https://cdn.wnba.com/static/json/liveData/playbyplay";
const WNBA_SCHEDULE_CACHE_VERSION = "20260415c";
const WNBA_ROSTERS_CACHE_VERSION = "20260415f";
const SUPABASE_FUNCTIONS_BASE = import.meta.env.VITE_SUPABASE_URL
  ? `${String(import.meta.env.VITE_SUPABASE_URL).replace(/\/$/, "")}/functions/v1`
  : "";

async function requestJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return res.json();
}

async function requestWnbaSchedule() {
  if (SUPABASE_FUNCTIONS_BASE) {
    return requestJson(`${SUPABASE_FUNCTIONS_BASE}/wnba-schedule?v=${encodeURIComponent(WNBA_SCHEDULE_CACHE_VERSION)}`);
  }
  return requestJson(WNBA_SCHEDULE_URL);
}

async function requestWnbaLiveGame(gameId) {
  const normalizedGameId = padGameId(gameId);
  if (SUPABASE_FUNCTIONS_BASE) {
    return requestJson(`${SUPABASE_FUNCTIONS_BASE}/wnba-live-game?gameId=${encodeURIComponent(normalizedGameId)}`);
  }

  const [boxscore, playByPlay] = await Promise.all([
    requestJson(`${WNBA_LIVE_BOXSCORE_BASE}/boxscore_${normalizedGameId}.json`),
    requestJson(`${WNBA_LIVE_PLAYBYPLAY_BASE}/playbyplay_${normalizedGameId}.json`),
  ]);

  return { boxscore, playByPlay, advancedBoxScore: { players: [], teams: [] } };
}

function padGameId(gameId) {
  return String(gameId || "").trim().padStart(10, "0");
}

function numberValue(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function stringValue(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function objectValue(...values) {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  }
  return {};
}

function arrayValue(...values) {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normalizeIsoDuration(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = (safeSeconds - minutes * 60).toFixed(2).padStart(5, "0");
  return `PT${minutes}M${remainder}S`;
}

function formatClockFromSeconds(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds - minutes * 60;
  const wholeSeconds = Math.floor(remainder);
  const decimals = remainder - wholeSeconds;
  if (decimals > 0) {
    const hundredths = Math.round(decimals * 100);
    return `${minutes}:${String(wholeSeconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
  }
  return `${minutes}:${String(wholeSeconds).padStart(2, "0")}`;
}

function parseClockToSeconds(clock) {
  const text = String(clock || "").trim();
  if (!text) return 0;
  if (text.startsWith("PT")) {
    const match = /PT(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(text);
    if (!match) return 0;
    return (Number(match[1] || 0) * 60) + Number(match[2] || 0);
  }
  const match = /^(\d+):(\d{2})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return 0;
  return (Number(match[1] || 0) * 60) + Number(match[2] || 0) + (Number(match[3] || 0) / 100);
}

function wnbaPeriodLengthSeconds(period) {
  return Number(period) <= 4 ? 10 * 60 : 5 * 60;
}

function normalizeDateOnly(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const slashDateTimeMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (slashDateTimeMatch) {
    const [, month, day, year] = slashDateTimeMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString().slice(0, 10);
  }

  const dateMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dateMatch) {
    const [, month, day, year] = dateMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return text.slice(0, 10);
}

function normalizeStatus(game) {
  const explicit = Number(game?.gameStatus ?? game?.gameStatusId ?? game?.gameStatusCode);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const statusText = String(game?.gameStatusText || "").toLowerCase();
  if (!statusText) return 1;
  if (statusText.includes("final")) return 3;
  if (statusText.includes("q") || statusText.includes("ot") || statusText.includes("halftime")) return 2;
  return 1;
}

function deriveLocation(teamId, homeTeamId, awayTeamId) {
  if (String(teamId || "") === String(homeTeamId || "")) return "h";
  if (String(teamId || "") === String(awayTeamId || "")) return "v";
  return "";
}

function normalizeTeam(team) {
  return {
    teamId: String(team?.teamId || team?.id || "").trim(),
    teamName: String(team?.teamName || team?.name || "").trim(),
    teamCity: String(team?.teamCity || team?.city || "").trim(),
    teamTricode: String(team?.teamTricode || team?.tricode || team?.teamCode || "").trim().toUpperCase(),
    wins: Number(team?.wins ?? team?.win ?? 0) || 0,
    losses: Number(team?.losses ?? team?.loss ?? 0) || 0,
    score: Number(team?.score ?? team?.points ?? 0) || 0,
    timeoutsRemaining: Number(team?.timeoutsRemaining ?? 0) || 0,
  };
}

function normalizeWnbaAction(action, homeTeamId, awayTeamId) {
  const teamId = stringValue(action?.teamId, action?.team_id);
  const personId = stringValue(action?.personId, action?.person_id);
  return {
    actionNumber: numberValue(action?.actionNumber, action?.action_number),
    clock: stringValue(action?.clock),
    timeActual: stringValue(action?.timeActual, action?.time_actual),
    period: numberValue(action?.period),
    teamId,
    teamTricode: stringValue(action?.teamTricode, action?.team_tricode),
    actionType: stringValue(action?.actionType, action?.action_type).toLowerCase(),
    subType: stringValue(action?.subType, action?.sub_type).toLowerCase(),
    descriptor: stringValue(action?.descriptor),
    qualifiers: arrayValue(action?.qualifiers),
    personId,
    playerName: stringValue(action?.playerName, action?.player_name),
    playerNameI: stringValue(action?.playerNameI, action?.player_name_i),
    x: action?.x ?? action?.locX ?? action?.xLegacy ?? null,
    y: action?.y ?? action?.locY ?? action?.yLegacy ?? null,
    side: stringValue(action?.side),
    shotDistance: numberValue(action?.shotDistance, action?.shot_distance) || null,
    shotResult: stringValue(action?.shotResult, action?.shot_result),
    possession: stringValue(action?.possession, action?.offenseTeamId, action?.offense_team_id),
    isFieldGoal: numberValue(action?.isFieldGoal, action?.is_field_goal),
    scoreHome: stringValue(action?.scoreHome, action?.homeScore, action?.score_home, "0"),
    scoreAway: stringValue(action?.scoreAway, action?.awayScore, action?.score_away, "0"),
    edited: stringValue(action?.edited),
    orderNumber: numberValue(action?.orderNumber, action?.order, action?.order_number),
    location: deriveLocation(teamId, homeTeamId, awayTeamId),
    description: stringValue(action?.description),
    jumpBallRecoveredNameInitial: stringValue(action?.jumpBallRecoveredNameInitial, action?.jump_ball_recovered_name),
    jumpBallRecoveredPersonId: stringValue(action?.jumpBallRecoveredPersonId, action?.jump_ball_recoverd_person_id),
    jumpBallWonPlayerNameI: stringValue(action?.jumpBallWonPlayerNameI, action?.jump_ball_won_player_name),
    jumpBallWonPersonId: stringValue(action?.jumpBallWonPersonId, action?.jump_ball_won_person_id),
    jumpBallLostPlayerNameI: stringValue(action?.jumpBallLostPlayerNameI, action?.jump_ball_lost_player_name),
    jumpBallLostPersonId: stringValue(action?.jumpBallLostPersonId, action?.jump_ball_lost_person_id),
    pointsTotal: numberValue(action?.pointsTotal, action?.points, action?.value),
    reboundTotal: numberValue(action?.reboundTotal),
    reboundDefensiveTotal: numberValue(action?.reboundDefensiveTotal),
    reboundOffensiveTotal: numberValue(action?.reboundOffensiveTotal),
    assistPlayerNameI: stringValue(action?.assistPlayerNameI),
    assistPersonId: stringValue(action?.assistPersonId, action?.assist_person_id),
    assistTotal: numberValue(action?.assistTotal),
    foulPersonalTotal: numberValue(action?.foulPersonalTotal),
    foulTechnicalTotal: numberValue(action?.foulTechnicalTotal),
    foulDrawnPlayerName: stringValue(action?.foulDrawnPlayerName),
    foulDrawnPersonId: stringValue(action?.foulDrawnPersonId),
    blockPlayerName: stringValue(action?.blockPlayerName),
    blockPersonId: stringValue(action?.blockPersonId),
    stealPlayerNameI: stringValue(action?.stealPlayerNameI),
    stealPersonId: stringValue(action?.stealPersonId),
    turnoverTotal: numberValue(action?.turnoverTotal),
    officialId: stringValue(action?.officialId),
    isTargetScoreLastPeriod: Boolean(action?.isTargetScoreLastPeriod),
  };
}

function classifyShot(action) {
  if (action.actionType === "3pt") return "three";
  const distance = Number(action.shotDistance || 0);
  if (distance <= 4.9) return "rim";
  return "mid";
}

function buildShotMaps(actions) {
  const players = new Map();
  const teams = new Map();

  const ensure = (map, key) => {
    if (!map.has(key)) {
      map.set(key, {
        rimFieldGoalsMade: 0,
        rimFieldGoalsAttempted: 0,
        midFieldGoalsMade: 0,
        midFieldGoalsAttempted: 0,
      });
    }
    return map.get(key);
  };

  (actions || []).forEach((action) => {
    if (action.actionType !== "2pt" && action.actionType !== "3pt") return;
    const shotType = classifyShot(action);
    if (shotType === "three") return;

    const personId = String(action.personId || "").trim();
    const teamId = String(action.teamId || "").trim();
    const targetMaps = [
      personId ? ensure(players, personId) : null,
      teamId ? ensure(teams, teamId) : null,
    ].filter(Boolean);

    targetMaps.forEach((entry) => {
      if (shotType === "rim") entry.rimFieldGoalsAttempted += 1;
      if (shotType === "mid") entry.midFieldGoalsAttempted += 1;
      if (action.shotResult === "Made" && shotType === "rim") entry.rimFieldGoalsMade += 1;
      if (action.shotResult === "Made" && shotType === "mid") entry.midFieldGoalsMade += 1;
    });
  });

  return { players, teams };
}

function buildWnbaAdvancedMaps(advancedBoxScorePayload) {
  const players = new Map();
  const teams = new Map();
  const playerRows = arrayValue(advancedBoxScorePayload?.players);
  const teamRows = arrayValue(advancedBoxScorePayload?.teams);

  playerRows.forEach((row) => {
    const entry = objectValue(row);
    const personId = stringValue(
      entry?.personId,
      entry?.PLAYER_ID,
      entry?.playerId,
    );
    if (!personId) return;
    players.set(personId, {
      offensiveRating: numberValue(entry?.offensiveRating, entry?.OFF_RATING),
      defensiveRating: numberValue(entry?.defensiveRating, entry?.DEF_RATING),
      netRating: numberValue(entry?.netRating, entry?.NET_RATING),
      assistPercentage: numberValue(entry?.assistPercentage, entry?.AST_PCT),
      assistToTurnover: numberValue(entry?.assistToTurnover, entry?.AST_TO),
      assistRatio: numberValue(entry?.assistRatio, entry?.AST_RATIO),
      offensiveReboundPercentage: numberValue(entry?.offensiveReboundPercentage, entry?.OREB_PCT),
      defensiveReboundPercentage: numberValue(entry?.defensiveReboundPercentage, entry?.DREB_PCT),
      reboundPercentage: numberValue(entry?.reboundPercentage, entry?.REB_PCT),
      turnoverRatio: numberValue(entry?.turnoverRatio, entry?.TM_TOV_PCT),
      effectiveFieldGoalPercentage: numberValue(entry?.effectiveFieldGoalPercentage, entry?.EFG_PCT),
      trueShootingPercentage: numberValue(entry?.trueShootingPercentage, entry?.TS_PCT),
      usagePercentage: numberValue(entry?.usagePercentage, entry?.USG_PCT),
      pace: numberValue(entry?.pace, entry?.PACE),
      possessions: numberValue(entry?.possessions, entry?.POSS),
      pie: numberValue(entry?.PIE, entry?.pie),
    });
  });

  teamRows.forEach((row) => {
    const entry = objectValue(row);
    const teamId = stringValue(
      entry?.teamId,
      entry?.TEAM_ID,
      entry?.team_id,
    );
    if (!teamId) return;
    teams.set(teamId, {
      offensiveRating: numberValue(entry?.offensiveRating, entry?.OFF_RATING),
      defensiveRating: numberValue(entry?.defensiveRating, entry?.DEF_RATING),
      netRating: numberValue(entry?.netRating, entry?.NET_RATING),
      assistPercentage: numberValue(entry?.assistPercentage, entry?.AST_PCT),
      assistToTurnover: numberValue(entry?.assistToTurnover, entry?.AST_TO),
      assistRatio: numberValue(entry?.assistRatio, entry?.AST_RATIO),
      offensiveReboundPercentage: numberValue(entry?.offensiveReboundPercentage, entry?.OREB_PCT),
      defensiveReboundPercentage: numberValue(entry?.defensiveReboundPercentage, entry?.DREB_PCT),
      reboundPercentage: numberValue(entry?.reboundPercentage, entry?.REB_PCT),
      estimatedTeamTurnoverPercentage: numberValue(entry?.estimatedTeamTurnoverPercentage, entry?.TM_TOV_PCT),
      turnoverRatio: numberValue(entry?.turnoverRatio, entry?.TOV_PCT),
      effectiveFieldGoalPercentage: numberValue(entry?.effectiveFieldGoalPercentage, entry?.EFG_PCT),
      trueShootingPercentage: numberValue(entry?.trueShootingPercentage, entry?.TS_PCT),
      usagePercentage: numberValue(entry?.usagePercentage, entry?.USG_PCT),
      pace: numberValue(entry?.pace, entry?.PACE),
      possessions: numberValue(entry?.possessions, entry?.POSS),
      pie: numberValue(entry?.PIE, entry?.pie),
    });
  });

  return { players, teams };
}

function computeTeamAdvancedStats(totals, opponentTotals, officialAdvanced = {}) {
  const computedPossessions = (
    numberValue(totals?.fieldGoalsAttempted) +
    (0.44 * numberValue(totals?.freeThrowsAttempted)) -
    numberValue(totals?.reboundsOffensive) +
    numberValue(totals?.turnovers)
  );
  const computedOpponentPossessions = (
    numberValue(opponentTotals?.fieldGoalsAttempted) +
    (0.44 * numberValue(opponentTotals?.freeThrowsAttempted)) -
    numberValue(opponentTotals?.reboundsOffensive) +
    numberValue(opponentTotals?.turnovers)
  );
  const possessions = numberValue(officialAdvanced?.possessions, computedPossessions);
  const opponentPossessions = numberValue(computedOpponentPossessions);
  const offensiveRating = numberValue(
    officialAdvanced?.offensiveRating,
    possessions ? (100 * numberValue(totals?.points) / possessions) : 0
  );
  const defensiveRating = numberValue(
    officialAdvanced?.defensiveRating,
    opponentPossessions ? (100 * numberValue(opponentTotals?.points) / opponentPossessions) : 0
  );
  return {
    possessions,
    offensiveRating,
    defensiveRating,
    netRating: numberValue(officialAdvanced?.netRating, offensiveRating - defensiveRating),
    pace: numberValue(officialAdvanced?.pace),
    assistPercentage: numberValue(officialAdvanced?.assistPercentage),
    assistToTurnover: numberValue(officialAdvanced?.assistToTurnover),
    assistRatio: numberValue(officialAdvanced?.assistRatio),
    offensiveReboundPercentage: numberValue(officialAdvanced?.offensiveReboundPercentage),
    defensiveReboundPercentage: numberValue(officialAdvanced?.defensiveReboundPercentage),
    reboundPercentage: numberValue(officialAdvanced?.reboundPercentage),
    turnoverRatio: numberValue(
      officialAdvanced?.turnoverRatio,
      officialAdvanced?.estimatedTeamTurnoverPercentage
    ),
    effectiveFieldGoalPercentage: numberValue(officialAdvanced?.effectiveFieldGoalPercentage),
    trueShootingPercentage: numberValue(officialAdvanced?.trueShootingPercentage),
    usagePercentage: numberValue(officialAdvanced?.usagePercentage),
    pie: numberValue(officialAdvanced?.pie),
    advancedStats: {
      deflections: numberValue(totals?.deflections),
    },
  };
}

function normalizeWnbaLiveTeam(team, shotSplits, advancedMaps = { players: new Map(), teams: new Map() }) {
  const totalsSource = objectValue(team?.statistics);
  const teamId = stringValue(team?.teamId, team?.team_id);
  const teamName = stringValue(team?.teamName, team?.team_name, team?.teamTricode);
  const players = arrayValue(team?.players).map((player, index) => {
    const name = objectValue(player?.name);
    const stats = objectValue(player?.statistics);
    const personId = stringValue(player?.personId, player?.person_id);
    const split = shotSplits.players.get(personId) || {};
    const advanced = advancedMaps.players.get(personId) || {};
    const firstName = stringValue(name?.firstName, player?.firstName, player?.first_name);
    const familyName = stringValue(name?.familyName, player?.familyName, player?.family_name);
    const offensiveRating = numberValue(stats?.offensiveRating, stats?.offensive_rating, advanced.offensiveRating);
    const defensiveRating = numberValue(stats?.defensiveRating, stats?.defensive_rating, advanced.defensiveRating);
    return {
      personId,
      firstName,
      familyName,
      fullName: stringValue(player?.fullName, `${firstName} ${familyName}`),
      name: stringValue(player?.fullName, `${firstName} ${familyName}`),
      nameI: stringValue(player?.nameI, player?.name_i, `${firstName.slice(0, 1)}. ${familyName}`.trim()),
      jerseyNum: stringValue(player?.jerseyNum, player?.jersey_num),
      position: stringValue(player?.position),
      starter: Boolean(player?.starter),
      order: numberValue(player?.order, index),
      minutes: stringValue(stats?.minutes, player?.minutes, normalizeIsoDuration(0)),
      plusMinusPoints: numberValue(stats?.plusMinusPoints, stats?.plus_minus_points, player?.plusMinusPoints),
      points: numberValue(stats?.points),
      transitionPoints: numberValue(stats?.pointsFastBreak, stats?.points_fast_break),
      secondChancePoints: numberValue(stats?.pointsSecondChance, stats?.points_second_chance),
      paintPoints: numberValue(stats?.pointsInThePaint, stats?.points_in_the_paint),
      reboundsTotal: numberValue(stats?.reboundsTotal, stats?.rebounds_total),
      reboundsOffensive: numberValue(stats?.reboundsOffensive, stats?.rebounds_offensive),
      assists: numberValue(stats?.assists),
      blocks: numberValue(stats?.blocks),
      steals: numberValue(stats?.steals),
      turnovers: numberValue(stats?.turnovers),
      foulsPersonal: numberValue(stats?.foulsPersonal, stats?.fouls_personal),
      fieldGoalsMade: numberValue(stats?.fieldGoalsMade, stats?.field_goals_made),
      fieldGoalsAttempted: numberValue(stats?.fieldGoalsAttempted, stats?.field_goals_attempted),
      threePointersMade: numberValue(stats?.threePointersMade, stats?.three_pointers_made),
      threePointersAttempted: numberValue(stats?.threePointersAttempted, stats?.three_pointers_attempted),
      freeThrowsMade: numberValue(stats?.freeThrowsMade, stats?.free_throws_made),
      freeThrowsAttempted: numberValue(stats?.freeThrowsAttempted, stats?.free_throws_attempted),
      offensiveRating,
      defensiveRating,
      netRating: numberValue(advanced.netRating),
      assistPercentage: numberValue(advanced.assistPercentage),
      assistToTurnover: numberValue(advanced.assistToTurnover),
      assistRatio: numberValue(advanced.assistRatio),
      offensiveReboundPercentage: numberValue(advanced.offensiveReboundPercentage),
      defensiveReboundPercentage: numberValue(advanced.defensiveReboundPercentage),
      reboundPercentage: numberValue(advanced.reboundPercentage),
      turnoverRatio: numberValue(advanced.turnoverRatio),
      effectiveFieldGoalPercentage: numberValue(advanced.effectiveFieldGoalPercentage),
      trueShootingPercentage: numberValue(advanced.trueShootingPercentage),
      usagePercentage: numberValue(advanced.usagePercentage),
      pace: numberValue(advanced.pace),
      possessions: numberValue(advanced.possessions),
      pie: numberValue(advanced.pie),
      ortg: offensiveRating,
      drtg: defensiveRating,
      rimFieldGoalsMade: numberValue(stats?.rimFieldGoalsMade, split.rimFieldGoalsMade),
      rimFieldGoalsAttempted: numberValue(stats?.rimFieldGoalsAttempted, split.rimFieldGoalsAttempted),
      midFieldGoalsMade: numberValue(stats?.midFieldGoalsMade, split.midFieldGoalsMade),
      midFieldGoalsAttempted: numberValue(stats?.midFieldGoalsAttempted, split.midFieldGoalsAttempted),
      chargesDrawn: numberValue(stats?.chargesDrawn),
      deflections: numberValue(stats?.deflections),
    };
  });

  players.sort((a, b) => a.order - b.order || a.familyName.localeCompare(b.familyName));

  const splitTotals = shotSplits.teams.get(teamId) || {};
  const teamAdvanced = advancedMaps.teams.get(teamId) || {};
  return {
    teamId,
    teamName,
    teamTricode: stringValue(team?.teamTricode, team?.team_tricode),
    players,
    totals: {
      points: numberValue(totalsSource?.points, team?.score),
      transitionPoints: numberValue(totalsSource?.pointsFastBreak, totalsSource?.points_fast_break),
      pointsOffTurnovers: numberValue(totalsSource?.pointsFromTurnovers, totalsSource?.points_from_turnovers),
      paintPoints: numberValue(totalsSource?.pointsInThePaint, totalsSource?.points_in_the_paint),
      secondChancePoints: numberValue(totalsSource?.pointsSecondChance, totalsSource?.points_second_chance),
      reboundsTotal: numberValue(totalsSource?.reboundsTotal, totalsSource?.rebounds_total),
      reboundsOffensive: numberValue(totalsSource?.reboundsOffensive, totalsSource?.rebounds_offensive),
      assists: numberValue(totalsSource?.assists),
      blocks: numberValue(totalsSource?.blocks),
      steals: numberValue(totalsSource?.steals),
      turnovers: numberValue(totalsSource?.turnoversTotal, totalsSource?.turnovers),
      foulsPersonal: numberValue(totalsSource?.foulsPersonal, totalsSource?.fouls_personal),
      fieldGoalsMade: numberValue(totalsSource?.fieldGoalsMade, totalsSource?.field_goals_made),
      fieldGoalsAttempted: numberValue(totalsSource?.fieldGoalsAttempted, totalsSource?.field_goals_attempted),
      threePointersMade: numberValue(totalsSource?.threePointersMade, totalsSource?.three_pointers_made),
      threePointersAttempted: numberValue(totalsSource?.threePointersAttempted, totalsSource?.three_pointers_attempted),
      freeThrowsMade: numberValue(totalsSource?.freeThrowsMade, totalsSource?.free_throws_made),
      freeThrowsAttempted: numberValue(totalsSource?.freeThrowsAttempted, totalsSource?.free_throws_attempted),
      rimFieldGoalsMade: numberValue(totalsSource?.rimFieldGoalsMade, splitTotals.rimFieldGoalsMade),
      rimFieldGoalsAttempted: numberValue(totalsSource?.rimFieldGoalsAttempted, splitTotals.rimFieldGoalsAttempted),
      midFieldGoalsMade: numberValue(totalsSource?.midFieldGoalsMade, splitTotals.midFieldGoalsMade),
      midFieldGoalsAttempted: numberValue(totalsSource?.midFieldGoalsAttempted, splitTotals.midFieldGoalsAttempted),
      effectiveFieldGoalPercentage: numberValue(
        teamAdvanced.effectiveFieldGoalPercentage,
        totalsSource?.fieldGoalsEffectiveAdjusted
      ),
      trueShootingPercentage: numberValue(
        teamAdvanced.trueShootingPercentage,
        totalsSource?.trueShootingPercentage
      ),
      assistToTurnover: numberValue(teamAdvanced.assistToTurnover, totalsSource?.assistsTurnoverRatio),
      deflections: numberValue(totalsSource?.deflections),
    },
  };
}

function extractStarters(players) {
  const starters = players.filter((player) => player.starter).map((player) => player.personId);
  if (starters.length === 5) return starters;
  return players.slice(0, 5).map((player) => player.personId);
}

function buildMinutesPlayers(lineup, playerMap) {
  return Array.from(lineup).map((personId, rowPosition) => {
    const player = playerMap.get(personId) || {};
    return {
      personId,
      nameI: stringValue(player.nameI, player.name, `${stringValue(player.firstName).slice(0, 1)}. ${stringValue(player.familyName)}`.trim()),
      jerseyNum: stringValue(player.jerseyNum),
      rowPosition,
    };
  });
}

function buildWnbaMinutesData(game) {
  const homePlayers = arrayValue(game?.boxScore?.home?.players);
  const awayPlayers = arrayValue(game?.boxScore?.away?.players);
  const actions = arrayValue(game?.playByPlayActions).slice().sort((a, b) => (
    numberValue(a.orderNumber, a.actionNumber) - numberValue(b.orderNumber, b.actionNumber)
  ));
  if (!homePlayers.length || !awayPlayers.length) {
    return {
      gameId: game?.gameId,
      gameStatus: game?.gameStatus,
      homeTeam: game?.homeTeam,
      awayTeam: game?.awayTeam,
      periods: [],
    };
  }

  const homePlayerMap = new Map(homePlayers.map((player) => [String(player.personId), player]));
  const awayPlayerMap = new Map(awayPlayers.map((player) => [String(player.personId), player]));
  let currentHomeLineup = extractStarters(homePlayers);
  let currentAwayLineup = extractStarters(awayPlayers);
  let currentHomeScore = 0;
  let currentAwayScore = 0;

  const periods = [];
  const grouped = new Map();
  actions.forEach((action) => {
    const period = numberValue(action.period);
    if (!period) return;
    if (!grouped.has(period)) grouped.set(period, []);
    grouped.get(period).push(action);
  });

  const periodNumbers = Array.from(grouped.keys()).sort((a, b) => a - b);
  periodNumbers.forEach((period) => {
    const periodActions = grouped.get(period) || [];
    const periodLength = wnbaPeriodLengthSeconds(period);
    let stintStart = periodLength;
    let blockStartHome = currentHomeScore;
    let blockStartAway = currentAwayScore;
    let inSubBlock = false;
    const stints = [];

    const finalizeStint = (endSeconds) => {
      const playersAway = buildMinutesPlayers(currentAwayLineup, awayPlayerMap);
      const playersHome = buildMinutesPlayers(currentHomeLineup, homePlayerMap);
      const prev = stints[stints.length - 1] || null;
      stints.push({
        startClock: formatClockFromSeconds(stintStart),
        endClock: formatClockFromSeconds(endSeconds),
        plusMinus: (currentHomeScore - blockStartHome) - (currentAwayScore - blockStartAway),
        awayScore: currentAwayScore - blockStartAway,
        homeScore: currentHomeScore - blockStartHome,
        playersAway,
        playersHome,
        prevPlayersAway: prev?.playersAway || [],
        prevPlayersHome: prev?.playersHome || [],
        nextPlayersAway: [],
        nextPlayersHome: [],
      });
      stintStart = endSeconds;
      blockStartHome = currentHomeScore;
      blockStartAway = currentAwayScore;
    };

    periodActions.forEach((action) => {
      currentHomeScore = numberValue(action.scoreHome, currentHomeScore);
      currentAwayScore = numberValue(action.scoreAway, currentAwayScore);
      if (action.actionType !== "substitution") {
        inSubBlock = false;
        return;
      }
      const actionSeconds = parseClockToSeconds(action.clock);
      if (!inSubBlock) {
        finalizeStint(actionSeconds);
        inSubBlock = true;
      }
      const personId = String(action.personId || "");
      if (!personId) return;
      const target = String(action.teamId || "") === String(game?.homeTeam?.teamId || "")
        ? currentHomeLineup
        : currentAwayLineup;
      if (action.subType === "out") {
        const index = target.indexOf(personId);
        if (index >= 0) target.splice(index, 1);
      } else if (action.subType === "in" && !target.includes(personId)) {
        target.push(personId);
      }
    });

    finalizeStint(game?.gameStatus === 2 && game?.period === period ? parseClockToSeconds(game?.gameClock) : 0);

    stints.forEach((stint, index) => {
      stint.nextPlayersAway = stints[index + 1]?.playersAway || stint.playersAway;
      stint.nextPlayersHome = stints[index + 1]?.playersHome || stint.playersHome;
    });

    periods.push({
      period,
      periodLabel: period <= 4 ? `Q${period}` : `OT${period - 4 || 1}`,
      stints,
    });
  });

  return {
    gameId: game?.gameId,
    gameStatus: game?.gameStatus,
    homeTeam: {
      teamId: game?.homeTeam?.teamId,
      teamName: game?.homeTeam?.teamName,
      teamTricode: game?.homeTeam?.teamTricode,
      score: game?.homeTeam?.score,
    },
    awayTeam: {
      teamId: game?.awayTeam?.teamId,
      teamName: game?.awayTeam?.teamName,
      teamTricode: game?.awayTeam?.teamTricode,
      score: game?.awayTeam?.score,
    },
    periods,
  };
}

function normalizeWnbaLiveGame(boxscorePayload, playByPlayPayload, advancedBoxScorePayload = {}) {
  const gameSource = objectValue(boxscorePayload?.game, playByPlayPayload?.game);
  const homeTeamSource = objectValue(gameSource?.homeTeam);
  const awayTeamSource = objectValue(gameSource?.awayTeam);
  const homeTeam = normalizeTeam(homeTeamSource);
  const awayTeam = normalizeTeam(awayTeamSource);
  const actions = arrayValue(playByPlayPayload?.game?.actions).map((action) => (
    normalizeWnbaAction(action, homeTeam.teamId, awayTeam.teamId)
  ));
  const shotSplits = buildShotMaps(actions);
  const advancedMaps = buildWnbaAdvancedMaps(advancedBoxScorePayload);
  const homeBoxScore = normalizeWnbaLiveTeam(homeTeamSource, shotSplits, advancedMaps);
  const awayBoxScore = normalizeWnbaLiveTeam(awayTeamSource, shotSplits, advancedMaps);
  const homeAdvanced = computeTeamAdvancedStats(
    homeBoxScore.totals,
    awayBoxScore.totals,
    advancedMaps.teams.get(homeBoxScore.teamId)
  );
  const awayAdvanced = computeTeamAdvancedStats(
    awayBoxScore.totals,
    homeBoxScore.totals,
    advancedMaps.teams.get(awayBoxScore.teamId)
  );

  const officials = arrayValue(gameSource?.officials).map((official) => ({
    personId: stringValue(official?.personId, official?.person_id, official?.officialId),
    firstName: stringValue(official?.firstName, official?.first_name),
    familyName: stringValue(official?.familyName, official?.family_name, official?.lastName, official?.last_name),
    jerseyNum: stringValue(official?.jerseyNum, official?.jersey_num),
  })).filter((official) => official.personId || official.firstName || official.familyName);

  return {
    gameId: stringValue(gameSource?.gameId, boxscorePayload?.game?.gameId),
    gameCode: stringValue(gameSource?.gameCode, gameSource?.gamecode),
    gameStatus: normalizeStatus(gameSource),
    gameStatusText: stringValue(gameSource?.gameStatusText, gameSource?.gameStatus),
    period: numberValue(gameSource?.period, gameSource?.gameStatusPeriod),
    gameClock: stringValue(gameSource?.gameClock, gameSource?.clock),
    gameTimeUTC: stringValue(gameSource?.gameTimeUTC, gameSource?.gameEt, gameSource?.gameDateTimeUTC),
    gameEt: stringValue(gameSource?.gameEt, gameSource?.gameDateEst, gameSource?.gameDateTimeEst),
    seasonYear: stringValue(gameSource?.seasonYear, gameSource?.season),
    seasonType: stringValue(gameSource?.seasonType),
    arena: {
      arenaName: stringValue(gameSource?.arena?.arenaName, gameSource?.arenaName),
      arenaState: stringValue(gameSource?.arena?.arenaState, gameSource?.arenaState),
      arenaCity: stringValue(gameSource?.arena?.arenaCity, gameSource?.arenaCity),
    },
    homeTeam,
    awayTeam,
    officials,
    callsAgainst: {},
    timeouts: {
      home: numberValue(homeTeamSource?.timeoutsRemaining, homeTeam.timeoutsRemaining),
      away: numberValue(awayTeamSource?.timeoutsRemaining, awayTeam.timeoutsRemaining),
    },
    challenges: {
      home: { challengesTotal: 0, challengesWon: 0 },
      away: { challengesTotal: 0, challengesWon: 0 },
    },
    playByPlayActions: actions,
    teamStats: {
      home: homeAdvanced,
      away: awayAdvanced,
    },
    boxScore: {
      home: homeBoxScore,
      away: awayBoxScore,
    },
  };
}

function normalizeWnbaScheduleGame(game, seasonYear = "") {
  const statusText = String(game?.gameStatusText || game?.gameLabel || "").trim();
  const gameTimeUTC = String(
    game?.gameTimeUTC ||
    game?.gameDateTimeUTC ||
    game?.gameDateTime ||
    ""
  ).trim();
  const gameEt = String(
    game?.gameEt ||
    game?.gameDateEst ||
    game?.gameDateTimeEst ||
    ""
  ).trim();

  return {
    gameId: String(game?.gameId || "").trim(),
    gameCode: String(game?.gameCode || game?.branchLink || "").trim(),
    gameStatus: normalizeStatus(game),
    gameStatusText: statusText || (gameTimeUTC || gameEt ? "Scheduled" : ""),
    period: Number(game?.period ?? game?.gameStatusPeriod ?? 0) || 0,
    gameClock: String(game?.gameClock || "").trim(),
    gameTimeUTC,
    gameEt,
    seasonYear: String(game?.seasonYear || seasonYear || "").trim(),
    seasonType: String(game?.seasonType || "").trim(),
    arena: {
      arenaName: String(game?.arena?.arenaName || game?.arenaName || "").trim(),
      arenaState: String(game?.arena?.arenaState || game?.arenaState || "").trim(),
      arenaCity: String(game?.arena?.arenaCity || game?.arenaCity || "").trim(),
    },
    homeTeam: normalizeTeam(game?.homeTeam),
    awayTeam: normalizeTeam(game?.awayTeam),
  };
}

function buildPregameBoxScoreTeam(team) {
  return {
    teamId: String(team?.teamId || "").trim(),
    teamTricode: String(team?.teamTricode || "").trim(),
    teamName: String(team?.teamName || "").trim(),
    players: [],
    totals: {},
  };
}

function buildPregameWnbaGame(game, seasonYear = "") {
  const normalized = normalizeWnbaScheduleGame(game, seasonYear);
  return {
    ...normalized,
    officials: [],
    callsAgainst: {},
    timeouts: { home: 7, away: 7 },
    challenges: {
      home: { challengesTotal: 0, challengesWon: 0 },
      away: { challengesTotal: 0, challengesWon: 0 },
    },
    playByPlayActions: [],
    teamStats: {
      home: {},
      away: {},
    },
    boxScore: {
      home: buildPregameBoxScoreTeam(normalized.homeTeam),
      away: buildPregameBoxScoreTeam(normalized.awayTeam),
    },
  };
}

async function fetchWnbaScheduleGameById(gameId) {
  const normalizedGameId = padGameId(gameId);
  const payload = await requestWnbaSchedule();
  const seasonYear = String(payload?.leagueSchedule?.seasonYear || "").trim();
  const gameDates = Array.isArray(payload?.leagueSchedule?.gameDates)
    ? payload.leagueSchedule.gameDates
    : [];

  for (const entry of gameDates) {
    const games = Array.isArray(entry?.games) ? entry.games : [];
    const match = games.find((game) => padGameId(game?.gameId) === normalizedGameId);
    if (match) {
      return buildPregameWnbaGame(match, seasonYear);
    }
  }

  return null;
}

export async function fetchGamesByDate(dateStr) {
  const normalizedTargetDate = normalizeDateOnly(dateStr);
  const payload = await requestWnbaSchedule();
  const seasonYear = String(payload?.leagueSchedule?.seasonYear || "").trim();
  const gameDates = Array.isArray(payload?.leagueSchedule?.gameDates)
    ? payload.leagueSchedule.gameDates
    : [];

  const matchingDate = gameDates.find((entry) => (
    normalizeDateOnly(entry?.gameDate || entry?.gameDateEst || entry?.gameDateTimeUTC) === normalizedTargetDate
  ));

  const games = Array.isArray(matchingDate?.games) ? matchingDate.games : [];

  return games
    .map((game) => normalizeWnbaScheduleGame(game, seasonYear))
    .filter((game) => game.gameId && game.homeTeam.teamId && game.awayTeam.teamId);
}

export async function fetchWnbaTeams() {
  const payload = await requestWnbaSchedule();
  const gameDates = Array.isArray(payload?.leagueSchedule?.gameDates)
    ? payload.leagueSchedule.gameDates
    : [];
  const teams = new Map();

  gameDates.forEach((entry) => {
    arrayValue(entry?.games).forEach((game) => {
      [game?.awayTeam, game?.homeTeam].forEach((team) => {
        const normalized = normalizeTeam(team);
        if (!normalized.teamId || !normalized.teamName) return;
        teams.set(normalized.teamId, {
          teamId: normalized.teamId,
          tricode: normalized.teamTricode,
          fullName: `${normalized.teamCity} ${normalized.teamName}`.trim(),
        });
      });
    });
  });

  return [...teams.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function fetchGame(gameId, segment = null) {
  const normalizedGameId = padGameId(gameId);
  const isWnbaGame = normalizedGameId.startsWith("10");
  if (!isWnbaGame) {
    const segmentParam = segment ? `?segment=${segment}` : "";
    const url = `${API_BASE}/games/${gameId}${segmentParam}`;
    return requestJson(url);
  }

  const liveGameResult = await requestWnbaLiveGame(normalizedGameId).catch((error) => ({ error }));
  if (liveGameResult?.error) {
    const scheduledGame = await fetchWnbaScheduleGameById(normalizedGameId);
    if (scheduledGame?.gameStatus === 1) {
      return scheduledGame;
    }
    throw liveGameResult.error;
  }

  return normalizeWnbaLiveGame(
    liveGameResult.boxscore,
    liveGameResult.playByPlay || {},
    liveGameResult.advancedBoxScore || {}
  );
}

export async function fetchMinutes(gameId) {
  const normalizedGameId = padGameId(gameId);
  if (!normalizedGameId.startsWith("10")) {
    const url = `${API_BASE}/games/${gameId}/minutes`;
    return requestJson(url);
  }
  const game = await fetchGame(normalizedGameId);
  return buildWnbaMinutesData(game);
}

export function teamLogoUrl(teamId, league = null) {
  const normalizedTeamId = String(teamId || "").trim();
  if (normalizedTeamId === "1611661322") {
    return mysticsLogoAltUrl;
  }

  const inferredLeague =
    league ||
    inferLeagueFromTeamId(teamId);

  if (inferredLeague === "gleague") {
    return `https://ak-static.cms.nba.com/wp-content/uploads/logos/nbagleague/${teamId}/primary/L/logo.svg`;
  }
  if (inferredLeague === "wnba") {
    return `https://cdn.wnba.com/logos/wnba/${teamId}/primary/D/logo.svg`;
  }
  return `https://cdn.nba.com/logos/nba/${teamId}/primary/L/logo.svg`;
}

export function inferLeagueFromTeamId(teamId) {
  const numericTeamId = Number(teamId);
  if (numericTeamId >= 1612700000 && numericTeamId < 1612710000) return "gleague";
  if (numericTeamId >= 1611661300 && numericTeamId < 1611661400) return "wnba";
  return "nba";
}

export function filterGamesByLeague(games, league) {
  return (Array.isArray(games) ? games : []).filter((game) => (
    inferLeagueFromTeamId(game?.homeTeam?.teamId || game?.awayTeam?.teamId) === league
  ));
}

export function playerHeadshotUrls(personId, teamId = null) {
  const safePersonId = String(personId || "").trim();
  if (!safePersonId) return [];

  const league = inferLeagueFromTeamId(teamId);
  const overrideValue = league === "gleague" ? gLeagueHeadshotOverrides[safePersonId] : null;
  const overrideUrls = Array.isArray(overrideValue)
    ? overrideValue
    : overrideValue
      ? [overrideValue]
      : [];

  const candidates = league === "gleague"
    ? [
      ...overrideUrls,
      SUPABASE_FUNCTIONS_BASE
        ? `${SUPABASE_FUNCTIONS_BASE}/player-headshot?personId=${encodeURIComponent(safePersonId)}`
        : null,
      `https://cdn.nba.com/headshots/nba/latest/1040x760/${safePersonId}.png`,
      `https://cdn.nba.com/headshots/nba/latest/260x190/${safePersonId}.png`,
    ]
    : league === "wnba"
      ? [
        SUPABASE_FUNCTIONS_BASE
          ? `${SUPABASE_FUNCTIONS_BASE}/player-headshot?league=wnba&personId=${encodeURIComponent(safePersonId)}`
          : null,
        `https://cdn.wnba.com/headshots/wnba/latest/260x190/${safePersonId}.png`,
        `https://cdn.wnba.com/headshots/wnba/latest/1040x760/${safePersonId}.png`,
      ]
    : [
      `https://cdn.nba.com/headshots/nba/latest/260x190/${safePersonId}.png`,
      `https://cdn.nba.com/headshots/nba/latest/1040x760/${safePersonId}.png`,
    ];

  return [...new Set(candidates.filter(Boolean))];
}

export function playerHeadshotUrl(personId, teamId = null) {
  return playerHeadshotUrls(personId, teamId)[0] || null;
}

export async function fetchCurrentNbaRosters() {
  if (!SUPABASE_FUNCTIONS_BASE) {
    throw new Error("Supabase functions are not configured.");
  }
  return requestJson(`${SUPABASE_FUNCTIONS_BASE}/nba-rosters`);
}

export async function fetchCurrentGLeagueRosters() {
  if (!SUPABASE_FUNCTIONS_BASE) {
    throw new Error("Supabase functions are not configured.");
  }
  return requestJson(`${SUPABASE_FUNCTIONS_BASE}/gleague-rosters`);
}

function slugifyRosterName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function withStableWnbaRosterIds(payload) {
  const teams = Object.fromEntries(
    Object.entries(payload?.teams || {}).map(([teamId, team]) => {
      const players = Array.isArray(team?.players)
        ? team.players.map((player, index) => {
            const fullName = String(player?.fullName || `${player?.firstName || ""} ${player?.familyName || ""}`).trim();
            const jerseyNum = String(player?.jerseyNum || "").trim();
            const stableId = player?.personId
              || `wnba-${teamId}-${slugifyRosterName(fullName) || "player"}-${jerseyNum || index + 1}`;
            return {
              ...player,
              personId: String(stableId),
            };
          })
        : [];

      return [teamId, {
        ...team,
        teamId: String(team?.teamId || teamId),
        players,
      }];
    })
  );

  return {
    ...payload,
    teams,
  };
}

export async function fetchCurrentWnbaRosters() {
  if (!SUPABASE_FUNCTIONS_BASE) {
    throw new Error("Supabase functions are not configured.");
  }
  const payload = await requestJson(`${SUPABASE_FUNCTIONS_BASE}/wnba-rosters?v=${encodeURIComponent(WNBA_ROSTERS_CACHE_VERSION)}`);
  return withStableWnbaRosterIds(payload);
}

export function nbaEventVideoUrl({ gameId, actionNumber, seasonYear, title }) {
  if (!gameId || actionNumber == null) return null;

  const seasonText = String(seasonYear ?? "").trim();
  let season;
  if (/^\d{4}$/.test(seasonText)) {
    const startYear = Number(seasonText);
    season = `${startYear}-${String(startYear + 1).slice(-2)}`;
  } else if (/^\d{4}-\d{2}$/.test(seasonText)) {
    season = seasonText;
  } else if (/^\d{4}-\d{4}$/.test(seasonText)) {
    const startYear = Number(seasonText.slice(0, 4));
    season = `${startYear}-${String(startYear + 1).slice(-2)}`;
  }

  const params = new URLSearchParams({
    flag: "1",
    GameID: String(gameId),
    GameEventID: String(actionNumber),
  });

  if (season) params.set("Season", season);
  if (title) params.set("title", String(title));

  const domain = String(gameId).startsWith("10")
    ? "https://stats.wnba.com/events"
    : "https://www.nba.com/stats/events";
  return `${domain}?${params.toString()}`;
}
