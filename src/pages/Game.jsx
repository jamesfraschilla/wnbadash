import { Link, useSearchParams, useParams } from "react-router-dom";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createNote } from "../accountData.js";
import {
  fetchCurrentGLeagueRosters,
  fetchCurrentNbaRosters,
  fetchGame,
  fetchMinutes,
  inferLeagueFromTeamId,
  teamLogoUrl,
} from "../api.js";
import { useAuth } from "../auth/useAuth.js";
import {
  buildDefaultNoteForm,
  buildNoteFormFromAction,
  buildPlayByPlaySourceMeta,
  buildVideoEventIdByActionNumber,
  describePlayByPlayAction,
  NOTE_PERIOD_OPTIONS,
  NOTE_SECOND_OPTIONS,
  NOTE_TAG_OPTIONS,
} from "../noteHelpers.js";
import { gameStatusLabel, normalizeClock } from "../utils.js";
import BoxScoreTable from "../components/BoxScoreTable.jsx";
import StatBars from "../components/StatBars.jsx";
import Officials from "../components/Officials.jsx";
import OfficialsExportPanel from "../components/OfficialsExportPanel.jsx";
import MatchUps from "../components/MatchUps.jsx";
import PlayerHeadshot from "../components/PlayerHeadshot.jsx";
import TransitionStats from "../components/TransitionStats.jsx";
import MiscStats from "../components/MiscStats.jsx";
import CreatingDisruption from "../components/CreatingDisruption.jsx";
import SegmentSelector from "../components/SegmentSelector.jsx";
import { fetchPublishedOrderForOfficials } from "../officialAssignments.js";
import {
  fetchRemotePregamePlayers,
  getPregameTeamScopeForTeam,
  linkPregamePlayersToApiPlayers,
  loadPregamePlayersPayload,
  resolveSharedPregamePlayersPayload,
} from "../pregamePlayers.js";
import {
  aggregateSegmentStats,
  computeKills,
  countPossessionsByTeam,
  segmentPeriods,
} from "../segmentStats.js";
import { supabase } from "../supabaseClient.js";
import { isTrackedGame } from "../teamConfig.js";
import { readLocalStorage, writeLocalStorage } from "../storage.js";
import styles from "./Game.module.css";

const SNAPSHOT_STORAGE_PREFIX = "nba-dashboard:snapshots:";
const CORE_STAT_FIELDS = [
  "points",
  "reboundsTotal",
  "reboundsOffensive",
  "assists",
  "blocks",
  "steals",
  "turnovers",
  "foulsPersonal",
  "fieldGoalsMade",
  "fieldGoalsAttempted",
  "threePointersMade",
  "threePointersAttempted",
  "freeThrowsMade",
  "freeThrowsAttempted",
  "rimFieldGoalsMade",
  "rimFieldGoalsAttempted",
  "midFieldGoalsMade",
  "midFieldGoalsAttempted",
];

const HOLD_MOVE_TOLERANCE_PX = 10;
const SEGMENT_STAT_DEFAULTS = {
  minutes: 0,
  plusMinusPoints: 0,
  points: 0,
  reboundsTotal: 0,
  reboundsOffensive: 0,
  assists: 0,
  blocks: 0,
  steals: 0,
  turnovers: 0,
  foulsPersonal: 0,
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
  pointsFor: 0,
  pointsAgainst: 0,
  possessionsFor: 0,
  possessionsAgainst: 0,
};

const normalizeRosterPersonId = (value) => String(value || "").trim();
const normalizeRosterName = (value) => String(value || "").trim().replace(/\s+/g, " ");
const buildRosterMatchKey = (value) => normalizeRosterName(value).toUpperCase().replace(/[^A-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

const normalizeLiveRosterPlayers = (players, teamId) => (
  (Array.isArray(players) ? players : [])
    .map((player) => {
      const personId = normalizeRosterPersonId(player?.personId);
      const firstName = normalizeRosterName(player?.firstName || "");
      const familyName = normalizeRosterName(player?.familyName || "");
      const fullName = normalizeRosterName(player?.fullName || [firstName, familyName].filter(Boolean).join(" "));
      if (!personId || !fullName) return null;
      return {
        personId,
        firstName,
        familyName,
        fullName,
        display: fullName,
        name: fullName,
        jerseyNum: String(player?.jerseyNum || "").trim(),
        position: String(player?.position || "").trim(),
        height: String(player?.height || "").trim(),
        teamId: String(player?.teamId || teamId || "").trim() || String(teamId || "").trim(),
      };
    })
    .filter(Boolean)
);

function mergeRosterPools(sharedPlayers, livePlayers) {
  const next = [];
  const byPersonId = new Map();
  const byName = new Map();

  const upsertPlayer = (player, preferExisting = false) => {
    if (!player) return;
    const personId = normalizeRosterPersonId(player.personId);
    const fullName = normalizeRosterName(player.fullName || player.display || player.name || "");
    const nameKey = buildRosterMatchKey(fullName);
    const existing =
      (personId && byPersonId.get(personId)) ||
      (nameKey && byName.get(nameKey)) ||
      null;

    if (existing) {
      if (!preferExisting) {
        Object.assign(existing, {
          ...player,
          cap: existing.cap ?? player.cap,
          display: existing.display || player.display || player.fullName || player.name || "",
          name: existing.name || player.name || player.fullName || player.display || "",
        });
      }
      if (personId) byPersonId.set(personId, existing);
      if (nameKey) byName.set(nameKey, existing);
      return;
    }

    const entry = {
      ...player,
      personId,
      fullName: fullName || normalizeRosterName(player.display || player.name || ""),
      display: normalizeRosterName(player.display || player.fullName || player.name || ""),
      name: normalizeRosterName(player.name || player.fullName || player.display || ""),
    };
    next.push(entry);
    if (personId) byPersonId.set(personId, entry);
    if (nameKey) byName.set(nameKey, entry);
  };

  (sharedPlayers || []).forEach((player) => upsertPlayer(player, true));
  (livePlayers || []).forEach((player) => upsertPlayer(player, false));
  return next;
}

const reviveSnapshotEntry = (entry) => {
  if (!entry?.snapshot) return entry;
  const snapshot = entry.snapshot;
  let playersMap = snapshot.players;
  if (playersMap instanceof Map) {
    return entry;
  }
  if (Array.isArray(playersMap)) {
    playersMap = new Map(playersMap);
  } else if (playersMap && typeof playersMap === "object") {
    playersMap = new Map(Object.values(playersMap).map((player) => [player.personId, player]));
  } else {
    playersMap = new Map();
  }
  return {
    ...entry,
    snapshot: {
      ...snapshot,
      players: playersMap,
    },
  };
};

const serializeSnapshotEntry = (entry) => {
  if (!entry?.snapshot) return entry;
  const snapshot = entry.snapshot;
  const players = snapshot.players instanceof Map
    ? Array.from(snapshot.players.entries())
    : snapshot.players;
  return {
    ...entry,
    snapshot: {
      ...snapshot,
      players,
    },
  };
};

const cleanWheelDescriptor = (value) => (
  String(value || "")
    .replace(/\s*\([^)]*\b\d+\s*ft\b[^)]*\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
);

const isMysticsTeam = (team) => {
  const tricode = String(team?.teamTricode || "").toUpperCase();
  const name = `${team?.teamCity || ""} ${team?.teamName || ""}`.toLowerCase();
  return (
    (tricode === "WAS" && name.includes("mystics")) ||
    (name.includes("washington") && name.includes("mystics"))
  );
};

const loadSnapshots = (gameId) => {
  if (typeof window === "undefined") return [];
  const raw = readLocalStorage(`${SNAPSHOT_STORAGE_PREFIX}${gameId}`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(reviveSnapshotEntry) : [];
  } catch {
    return [];
  }
};

const saveSnapshots = (gameId, snapshots) => {
  if (typeof window === "undefined") return;
  writeLocalStorage(
    `${SNAPSHOT_STORAGE_PREFIX}${gameId}`,
    JSON.stringify((snapshots || []).map(serializeSnapshotEntry))
  );
};

const buildSnapshot = (boxScore) => {
  if (!boxScore?.home || !boxScore?.away) return null;
  const players = new Map();
  [boxScore.home, boxScore.away].forEach((team) => {
    (team.players || []).forEach((player) => {
      players.set(player.personId, player);
    });
  });
  return {
    teams: {
      [boxScore.home.teamId]: boxScore.home.totals,
      [boxScore.away.teamId]: boxScore.away.totals,
    },
    players,
  };
};

const diffStats = (start = {}, end = {}) => {
  const diff = {};
  CORE_STAT_FIELDS.forEach((field) => {
    diff[field] = (end?.[field] || 0) - (start?.[field] || 0);
  });
  return diff;
};

const diffSnapshots = (startSnapshot, endSnapshot, basePlayers) => {
  if (!endSnapshot) return null;
  const teamTotals = {};
  let hasNegativeDiff = false;
  Object.keys(endSnapshot.teams || {}).forEach((teamId) => {
    const diff = diffStats(startSnapshot?.teams?.[teamId], endSnapshot.teams[teamId]);
    teamTotals[teamId] = diff;
    if (CORE_STAT_FIELDS.some((field) => (diff[field] || 0) < 0)) {
      hasNegativeDiff = true;
    }
  });
  if (hasNegativeDiff) return null;
  const playerMap = new Map();
  basePlayers.forEach((player) => {
    const start = startSnapshot?.players?.get(player.personId) || {};
    const end = endSnapshot.players?.get(player.personId) || {};
    const diff = diffStats(start, end);
    playerMap.set(player.personId, {
      personId: player.personId,
      firstName: player.firstName || "",
      familyName: player.familyName || "",
      jerseyNum: player.jerseyNum || "",
      position: player.position || "",
      minutes: 0,
      plusMinusPoints: 0,
      ...diff,
    });
  });
  return { teamTotals, playerMap };
};

const getPeriodEndKey = (period) => `period-end-${period}`;

const buildChallengeCircles = (challenges) => {
  const total = challenges?.challengesTotal ?? 0;
  const won = challenges?.challengesWon ?? 0;

  const circles = [];
  if (total === 0) {
    circles.push({ state: "available" });
    return circles;
  }

  circles.push({ state: won >= 1 ? "won" : "lost" });

  if (won >= 1) {
    if (total >= 2) {
      circles.push({ state: won >= 2 ? "won" : "lost" });
    } else {
      circles.push({ state: "available" });
    }
  }

  return circles;
};

function hasUsedResetTimeout(actions, teamId, currentPeriod) {
  if (!teamId) return false;

  const overtimePhase = Number(currentPeriod) > 4;
  return (actions || []).some((action) => {
    if (String(action?.actionType || "").toLowerCase() !== "timeout") return false;
    if (String(action?.subType || "").toLowerCase() !== "reset") return false;
    if (String(action?.teamId || "") !== String(teamId)) return false;

    const actionPeriod = Number(action?.period || 0);
    if (overtimePhase) return actionPeriod > 4;
    return actionPeriod > 0 && actionPeriod <= 4;
  });
}

const getSegmentSnapshotBounds = (segment, snapshots, currentSnapshot, currentPeriod) => {
  const snapshotEntries = snapshots || [];
  const snapshotByKey = new Map(snapshotEntries.map((s) => [s.key, s]));
  const periodEndEntry = (period) => snapshotByKey.get(getPeriodEndKey(period)) || null;
  const periodEndSnapshot = (period) => periodEndEntry(period)?.snapshot || null;
  const latestSnapshotEntry = snapshotEntries.reduce((latest, entry) => {
    if (!entry?.actionNumber) return latest;
    if (!latest || entry.actionNumber > latest.actionNumber) return entry;
    return latest;
  }, null);

  const zeroSnapshot = { teams: {}, players: new Map() };

  const isLivePeriod = (period) => currentPeriod === period;

  switch (segment) {
    case "all":
      return {
        start: zeroSnapshot,
        startMeta: null,
        end: currentSnapshot,
        endIsLive: false,
      };
    case "q1":
      return {
        start: zeroSnapshot,
        startMeta: null,
        end: periodEndSnapshot(1) || (isLivePeriod(1) ? currentSnapshot : null),
        endIsLive: isLivePeriod(1),
      };
    case "q2":
      return {
        start: periodEndSnapshot(1),
        startMeta: periodEndEntry(1),
        end: periodEndSnapshot(2) || (isLivePeriod(2) ? currentSnapshot : null),
        endIsLive: isLivePeriod(2),
      };
    case "q3":
      return {
        start: periodEndSnapshot(2),
        startMeta: periodEndEntry(2),
        end: periodEndSnapshot(3) || (isLivePeriod(3) ? currentSnapshot : null),
        endIsLive: isLivePeriod(3),
      };
    case "q4":
      return {
        start: periodEndSnapshot(3),
        startMeta: periodEndEntry(3),
        end: periodEndSnapshot(4) || (isLivePeriod(4) ? currentSnapshot : null),
        endIsLive: isLivePeriod(4),
      };
    case "first-half":
      return {
        start: zeroSnapshot,
        startMeta: null,
        end:
          periodEndSnapshot(2) ||
          ((currentPeriod === 1 || currentPeriod === 2) ? currentSnapshot : null),
        endIsLive: currentPeriod === 1 || currentPeriod === 2,
      };
    case "second-half":
      return {
        start: periodEndSnapshot(2),
        startMeta: periodEndEntry(2),
        end:
          periodEndSnapshot(4) ||
          ((currentPeriod === 3 || currentPeriod === 4) ? currentSnapshot : null),
        endIsLive: currentPeriod === 3 || currentPeriod === 4,
      };
    case "q1-q3":
      return {
        start: zeroSnapshot,
        startMeta: null,
        end:
          periodEndSnapshot(3) ||
          ((currentPeriod === 1 || currentPeriod === 2 || currentPeriod === 3) ? currentSnapshot : null),
        endIsLive: currentPeriod === 3,
      };
    default:
      return null;
  }
};

const foulsClass = (fouls, stylesRef) => {
  const safeFouls = fouls || 0;
  if (safeFouls <= 3) return stylesRef.pfBlack;
  if (safeFouls === 4) return stylesRef.pfYellow;
  return stylesRef.pfRed;
};

const parseTeamFoulMarker = (description) => {
  if (!description) return null;
  const text = String(description);
  const teamMatch = text.match(/\bT(\d+)\b/);
  const teamFouls = teamMatch ? Number.parseInt(teamMatch[1], 10) : null;
  const inPenalty = /\bPN\b/.test(text);
  if (teamFouls == null && !inPenalty) return null;
  return {
    teamFouls: Number.isNaN(teamFouls) ? null : teamFouls,
    inPenalty,
  };
};

const getClockSortValue = (clock) => {
  const normalized = normalizeClock(clock);
  const [minutesRaw, secondsRaw] = normalized.split(":");
  const minutes = Number(minutesRaw);
  const seconds = Number(secondsRaw);
  if (Number.isNaN(minutes) || Number.isNaN(seconds)) return -1;
  return (minutes * 60) + seconds;
};

const compareActionsByChronology = (a, b) => {
  const aPeriod = Number(a?.period) || 0;
  const bPeriod = Number(b?.period) || 0;
  if (aPeriod !== bPeriod) return aPeriod - bPeriod;

  const aClock = getClockSortValue(a?.clock);
  const bClock = getClockSortValue(b?.clock);
  if (aClock !== bClock) return bClock - aClock;

  const aOrder = Number(a?.orderNumber ?? a?.actionNumber ?? 0);
  const bOrder = Number(b?.orderNumber ?? b?.actionNumber ?? 0);
  return aOrder - bOrder;
};

export default function Game({ variant = "full" }) {
  const { gameId } = useParams();
  const { user, canUseMatchUps } = useAuth();
  const [params, setParams] = useSearchParams();
  const dateParam = params.get("d");
  const courtBackUrl = dateParam ? `/g/${gameId}?d=${dateParam}` : `/g/${gameId}`;
  const urlSegmentParam = params.get("segment");
  const segmentFromUrl = useMemo(() => {
    const map = {
      Q1: "q1",
      Q2: "q2",
      Q3: "q3",
      Q4: "q4",
      "Q1-Q3": "q1-q3",
      "1H": "first-half",
      "2H": "second-half",
    };
    return urlSegmentParam ? map[urlSegmentParam] ?? "all" : "all";
  }, [urlSegmentParam]);
  const [segment, setSegment] = useState(segmentFromUrl);
  const [snapshots, setSnapshots] = useState(() => loadSnapshots(gameId));
  const statsNavRef = useRef(null);
  const boxScoreNavRef = useRef(null);
  const pbpWheelRef = useRef(null);
  const pbpWheelInnerRef = useRef(null);
  const lockButtonRef = useRef(null);
  const lockTimeoutRef = useRef(null);
  const lockStyleRef = useRef(null);
  const holdTimerRef = useRef(null);
  const holdTargetRef = useRef(null);
  const holdPointerStartRef = useRef(null);
  const [isLocked, setIsLocked] = useState(false);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [savingNewNote, setSavingNewNote] = useState(false);
  const [noteSourceAction, setNoteSourceAction] = useState(null);
  const [noteForm, setNoteForm] = useState({
    period: "--",
    minutes: "--",
    seconds: "--",
    text: "",
    tags: [],
  });
  const isAtc = variant === "atc";
  const showExtras = !isAtc;
  const notesParams = useMemo(() => {
    const nextParams = new URLSearchParams();
    if (dateParam) nextParams.set("d", dateParam);
    nextParams.set("from", isAtc ? "atc" : "full");
    const query = nextParams.toString();
    return query ? `?${query}` : "";
  }, [dateParam, isAtc]);

  const handleScrollToAdvanced = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const handleScrollToBoxScore = () => {
    if (!boxScoreNavRef.current) return;
    const top = window.scrollY + boxScoreNavRef.current.getBoundingClientRect().top;
    const header = document.querySelector("header");
    const offset = header?.getBoundingClientRect().height || 0;
    window.scrollTo({ top: Math.max(0, top - offset), behavior: "smooth" });
  };

  const segmentParam = useMemo(() => {
    const map = {
      q1: "Q1",
      q2: "Q2",
      q3: "Q3",
      q4: "Q4",
      "q1-q3": "Q1-Q3",
      "first-half": "1H",
      "second-half": "2H",
      all: null,
    };
    return map[segment] ?? null;
  }, [segment]);

  useEffect(() => {
    setSegment(segmentFromUrl);
  }, [segmentFromUrl]);

  useEffect(() => {
    if (!isAtc) return undefined;
    const preventAction = (event) => {
      if (!isLocked) return;
      if (lockButtonRef.current && lockButtonRef.current.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const preventScroll = (event) => {
      if (!isLocked) return;
      event.preventDefault();
    };
    document.addEventListener("click", preventAction, true);
    document.addEventListener("mousedown", preventAction, true);
    document.addEventListener("touchstart", preventAction, true);
    document.addEventListener("touchmove", preventScroll, { passive: false });
    document.addEventListener("wheel", preventScroll, { passive: false });
    return () => {
      document.removeEventListener("click", preventAction, true);
      document.removeEventListener("mousedown", preventAction, true);
      document.removeEventListener("touchstart", preventAction, true);
      document.removeEventListener("touchmove", preventScroll);
      document.removeEventListener("wheel", preventScroll);
    };
  }, [isAtc, isLocked]);

  useEffect(() => {
    if (!isAtc) return undefined;
    const bodyStyle = document.body?.style;
    const htmlStyle = document.documentElement?.style;
    if (!bodyStyle || !htmlStyle) return undefined;
    if (isLocked) {
      if (!lockStyleRef.current) {
        lockStyleRef.current = {
          overflow: bodyStyle.overflow,
          userSelect: bodyStyle.userSelect,
          touchAction: htmlStyle.touchAction,
        };
      }
      bodyStyle.overflow = "hidden";
      bodyStyle.userSelect = "none";
      htmlStyle.touchAction = "none";
    } else {
      const previous = lockStyleRef.current;
      if (previous) {
        bodyStyle.overflow = previous.overflow || "";
        bodyStyle.userSelect = previous.userSelect || "";
        htmlStyle.touchAction = previous.touchAction || "";
      }
      lockStyleRef.current = null;
    }
    return () => {
      const previous = lockStyleRef.current;
      if (previous) {
        bodyStyle.overflow = previous.overflow || "";
        bodyStyle.userSelect = previous.userSelect || "";
        htmlStyle.touchAction = previous.touchAction || "";
        lockStyleRef.current = null;
      }
    };
  }, [isAtc, isLocked]);

  const clearLockTimeout = () => {
    if (lockTimeoutRef.current) {
      clearTimeout(lockTimeoutRef.current);
      lockTimeoutRef.current = null;
    }
  };

  const startLockPress = () => {
    if (!isAtc) return;
    clearLockTimeout();
    lockTimeoutRef.current = setTimeout(() => {
      setIsLocked((prev) => !prev);
      lockTimeoutRef.current = null;
    }, 2000);
  };

  const endLockPress = () => {
    clearLockTimeout();
  };

  const handleSegmentChange = (nextSegment) => {
    setSegment(nextSegment);
    const nextParams = new URLSearchParams(params);
    const nextApiSegment = {
      q1: "Q1",
      q2: "Q2",
      q3: "Q3",
      q4: "Q4",
      "q1-q3": "Q1-Q3",
      "first-half": "1H",
      "second-half": "2H",
      all: null,
    }[nextSegment] ?? null;
    if (nextApiSegment) {
      nextParams.set("segment", nextApiSegment);
    } else {
      nextParams.delete("segment");
    }
    setParams(nextParams);
  };

  const { data: game, isLoading, error } = useQuery({
    queryKey: ["game", gameId, segmentParam],
    queryFn: () => fetchGame(gameId, segmentParam),
    enabled: Boolean(gameId),
    staleTime: 30_000,
    refetchInterval: (data) => (data?.gameStatus === 3 ? false : 15_000),
    refetchIntervalInBackground: true,
  });

  const { data: minutesData } = useQuery({
    queryKey: ["minutes", gameId],
    queryFn: () => fetchMinutes(gameId),
    enabled: Boolean(gameId),
    refetchInterval: () => (game?.gameStatus === 3 ? false : 15_000),
    refetchIntervalInBackground: true,
  });

  const awayTeamScope = getPregameTeamScopeForTeam(game?.awayTeam);
  const homeTeamScope = getPregameTeamScopeForTeam(game?.homeTeam);
  const awayLeague = inferLeagueFromTeamId(game?.awayTeam?.teamId);
  const homeLeague = inferLeagueFromTeamId(game?.homeTeam?.teamId);

  const { data: currentNbaRostersPayload } = useQuery({
    queryKey: ["game-current-nba-rosters"],
    queryFn: fetchCurrentNbaRosters,
    enabled: awayLeague === "nba" || homeLeague === "nba",
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
  });

  const { data: currentGLeagueRostersPayload } = useQuery({
    queryKey: ["game-current-gleague-rosters"],
    queryFn: fetchCurrentGLeagueRosters,
    enabled: awayLeague === "gleague" || homeLeague === "gleague",
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
  });

  const { data: awayRemoteRoster } = useQuery({
    queryKey: ["game-roster-caps", awayTeamScope],
    queryFn: () => fetchRemotePregamePlayers(awayTeamScope),
    enabled: Boolean(awayTeamScope),
    staleTime: 10_000,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

  const { data: homeRemoteRoster } = useQuery({
    queryKey: ["game-roster-caps", homeTeamScope],
    queryFn: () => fetchRemotePregamePlayers(homeTeamScope),
    enabled: Boolean(homeTeamScope),
    staleTime: 10_000,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

  const { data: periodSnapshots = [] } = useQuery({
    queryKey: ["period-snapshots", gameId],
    queryFn: async () => {
      if (!supabase || !gameId) return [];
      const { data, error: fetchError } = await supabase
        .from("period_snapshots")
        .select("period,team_id,totals")
        .eq("game_id", gameId);
      if (fetchError) throw fetchError;
      return data || [];
    },
    enabled: Boolean(gameId) && Boolean(supabase),
    staleTime: 30_000,
    refetchInterval: () => (game?.gameStatus === 2 ? 60_000 : false),
    refetchIntervalInBackground: true,
  });

  const { homeTeam, awayTeam, teamStats, boxScore, officials, callsAgainst } = game || {};
  const homeTeamId = homeTeam?.teamId ?? null;
  const awayTeamId = awayTeam?.teamId ?? null;
  const isWnbaGame = awayLeague === "wnba" || homeLeague === "wnba";
  const regulationPeriodSeconds = isWnbaGame ? 10 * 60 : 12 * 60;
  const regulationGameSeconds = regulationPeriodSeconds * 4;
  const noteMinuteOptions = useMemo(
    () => ["--", ...Array.from({ length: regulationPeriodSeconds / 60 }, (_, idx) => String(idx))],
    [regulationPeriodSeconds]
  );
  const trackedGame = isTrackedGame(game);
  const isMysticsGame = isMysticsTeam(homeTeam) || isMysticsTeam(awayTeam);
  const [publishedOfficialOrder, setPublishedOfficialOrder] = useState(null);
  const timeouts = game?.timeouts;
  const isPregame = game?.gameStatus === 1;
  const challenges = game?.challenges;
  const defaultChallenges = { challengesTotal: 0, challengesWon: 0 };
  const awayChallenges = challenges?.away || defaultChallenges;
  const homeChallenges = challenges?.home || defaultChallenges;
  const status = game ? gameStatusLabel(game) : "";
  const isLive = game?.gameStatus === 2;
  const clock = isLive ? normalizeClock(game?.gameClock) : null;
  const useSnapshots = isLive;

  useEffect(() => {
    let cancelled = false;

    if (!officials?.length) {
      setPublishedOfficialOrder(null);
      return () => {
        cancelled = true;
      };
    }

    fetchPublishedOrderForOfficials(officials).then((publishedOrder) => {
      if (!cancelled) {
        setPublishedOfficialOrder(publishedOrder);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [officials]);

  const basePlayers = [
    ...(boxScore?.away?.players || []),
    ...(boxScore?.home?.players || []),
  ];

  const getRosterForTeam = (team, teamScope, remoteRoster) => {
    const teamId = String(team?.teamId || "").trim();
    const league = inferLeagueFromTeamId(teamId);
    const liveRosterTeams = league === "gleague"
      ? currentGLeagueRostersPayload?.teams
      : currentNbaRostersPayload?.teams;
    const liveRoster = normalizeLiveRosterPlayers(liveRosterTeams?.[teamId]?.players, teamId);

    if (!teamScope) {
      return liveRoster;
    }

    const localRoster = loadPregamePlayersPayload(teamScope);
    const sharedRoster = resolveSharedPregamePlayersPayload(localRoster, remoteRoster).players;
    const linkedSharedRoster = linkPregamePlayersToApiPlayers(sharedRoster, liveRoster);
    return mergeRosterPools(linkedSharedRoster, liveRoster);
  };

  const awayRosterPlayers = useMemo(
    () => getRosterForTeam(game?.awayTeam, awayTeamScope, awayRemoteRoster),
    [awayRemoteRoster, awayTeamScope, currentGLeagueRostersPayload?.teams, currentNbaRostersPayload?.teams, game?.awayTeam]
  );

  const homeRosterPlayers = useMemo(
    () => getRosterForTeam(game?.homeTeam, homeTeamScope, homeRemoteRoster),
    [currentGLeagueRostersPayload?.teams, currentNbaRostersPayload?.teams, game?.homeTeam, homeRemoteRoster, homeTeamScope]
  );

  const awayMinuteCapsByPersonId = useMemo(() => new Map(
    awayRosterPlayers
      .map((player) => [String(player?.personId || "").trim(), player?.cap])
      .filter(([personId, cap]) => personId && cap !== "" && cap != null)
  ), [awayRosterPlayers]);

  const homeMinuteCapsByPersonId = useMemo(() => new Map(
    homeRosterPlayers
      .map((player) => [String(player?.personId || "").trim(), player?.cap])
      .filter(([personId, cap]) => personId && cap !== "" && cap != null)
  ), [homeRosterPlayers]);

  const currentSnapshot = useMemo(() => buildSnapshot(boxScore), [boxScore]);

  useEffect(() => {
    if (!gameId || !boxScore || !game || !useSnapshots) return;
    const existing = loadSnapshots(gameId);
    const existingKeys = new Set(existing.map((s) => s.key));
    const additions = [];
    const snapshot = buildSnapshot(boxScore);
    if (!snapshot) return;

    (game.playByPlayActions || []).forEach((action) => {
      if (action.actionType === "period" && action.subType === "end") {
        if (action.period !== game.period) return;
        const key = getPeriodEndKey(action.period);
        if (!existingKeys.has(key)) {
          additions.push({
            key,
            type: "period-end",
            period: action.period,
            clock: action.clock,
            actionNumber: action.actionNumber,
            snapshot,
            updatedAt: Date.now(),
          });
          existingKeys.add(key);
        }
      }
      if (action.actionType === "timeout") {
        const key = `timeout-${action.actionNumber}`;
        if (!existingKeys.has(key)) {
          additions.push({
            key,
            type: "timeout",
            period: action.period,
            clock: action.clock,
            actionNumber: action.actionNumber,
            snapshot,
            updatedAt: Date.now(),
          });
          existingKeys.add(key);
        }
      }
    });

    if (additions.length) {
      const nextSnapshots = [...existing, ...additions];
      saveSnapshots(gameId, nextSnapshots);
      setSnapshots(nextSnapshots);
    }
  }, [gameId, boxScore, game, useSnapshots]);

  useEffect(() => {
    setSnapshots(loadSnapshots(gameId));
  }, [gameId]);

  const segmentStats = homeTeam?.teamId && awayTeam?.teamId
    ? aggregateSegmentStats({
      actions: game?.playByPlayActions || [],
      segment,
      minutesData,
      homeTeam,
      awayTeam,
      basePlayers,
      currentPeriod: game?.period,
      currentClock: game?.gameClock,
      isLive,
    })
    : { playerMap: new Map(), teamTotals: {} };

  const periodSnapshotMap = useMemo(() => {
    if (!periodSnapshots.length) return null;
    const map = new Map();
    periodSnapshots.forEach((row) => {
      const period = Number(row.period);
      const teamId = String(row.team_id);
      if (!map.has(period)) map.set(period, new Map());
      map.get(period).set(teamId, row.totals || {});
    });
    return map;
  }, [periodSnapshots]);

  const segmentSnapshotTotals = useMemo(() => {
    if (!periodSnapshotMap || !homeTeam?.teamId || !awayTeam?.teamId) return null;
    const segmentPeriodsMap = {
      q1: { start: 0, end: 1 },
      q2: { start: 1, end: 2 },
      q3: { start: 2, end: 3 },
      q4: { start: 3, end: 4 },
      "first-half": { start: 0, end: 2 },
      "second-half": { start: 2, end: 4 },
      "q1-q3": { start: 0, end: 3 },
    };
    const bounds = segmentPeriodsMap[segment];
    if (!bounds) return null;
    const endTotals = periodSnapshotMap.get(bounds.end);
    if (!endTotals) return null;
    const startTotals = bounds.start === 0 ? null : periodSnapshotMap.get(bounds.start);
    if (bounds.start !== 0 && !startTotals) return null;
    const buildTotals = (teamId) =>
      diffStats(startTotals?.get(teamId), endTotals.get(teamId));
    return {
      [awayTeamId]: buildTotals(String(awayTeamId)),
      [homeTeamId]: buildTotals(String(homeTeamId)),
    };
  }, [periodSnapshotMap, segment, awayTeamId, homeTeamId]);

  const pbpWheelItems = useMemo(() => {
    const actions = game?.playByPlayActions || [];
    const filtered = actions.filter((action) => (
      action.actionType === "2pt" ||
      action.actionType === "3pt" ||
      action.actionType === "turnover" ||
      action.actionType === "foul" ||
      action.actionType === "timeout"
    ));
    const sorted = filtered.slice().sort(compareActionsByChronology);
    return sorted.slice(-16);
  }, [game?.playByPlayActions]);

  const videoEventIdByActionNumber = useMemo(
    () => buildVideoEventIdByActionNumber(game?.playByPlayActions || []),
    [game?.playByPlayActions]
  );

  const openingJumpTeamId = useMemo(() => {
    const actions = game?.playByPlayActions || [];
    const ordered = actions.slice().sort(compareActionsByChronology);
    const openingJump = ordered.find((action) => {
      const type = String(action.actionType || "").toLowerCase();
      const desc = String(action.description || action.descriptor || action.subType || "").toLowerCase();
      return type.includes("jump") || desc.includes("jump ball");
    });
    if (!openingJump) return null;
    const candidate =
      openingJump.jumpBallWonTeamId ??
      openingJump.winningTeamId ??
      openingJump.possessionTeamId ??
      openingJump.teamId ??
      openingJump.teamIdPossession ??
      null;
    return candidate != null ? String(candidate) : null;
  }, [game?.playByPlayActions]);

  const possessionTeams = useMemo(() => {
    if (!openingJumpTeamId || !awayTeamId || !homeTeamId) {
      return [null, null, null, null];
    }
    const awayId = String(awayTeamId);
    const homeId = String(homeTeamId);
    if (openingJumpTeamId !== awayId && openingJumpTeamId !== homeId) {
      return [null, null, null, null];
    }
    return [
      openingJumpTeamId === awayId ? awayTeam : homeTeam,
      openingJumpTeamId === awayId ? homeTeam : awayTeam,
      openingJumpTeamId === awayId ? homeTeam : awayTeam,
      openingJumpTeamId === awayId ? awayTeam : homeTeam,
    ];
  }, [openingJumpTeamId, awayTeam, homeTeam]);

  const clearHoldTimer = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    holdTargetRef.current = null;
    holdPointerStartRef.current = null;
  };

  const openAddNote = () => {
    setNoteSourceAction(null);
    setNoteForm(buildDefaultNoteForm(game, isLive));
    setNoteModalOpen(true);
  };

  const openAddNoteForAction = (action) => {
    if (!action) return;
    setNoteSourceAction(action);
    setNoteForm(buildNoteFormFromAction(action));
    setNoteModalOpen(true);
  };

  const closeAddNote = () => {
    setNoteModalOpen(false);
    setSavingNewNote(false);
    setNoteSourceAction(null);
  };

  const requestCancelNote = () => {
    closeAddNote();
  };

  const saveNewNote = async () => {
    if (!gameId || savingNewNote) return;
    const minutesValue = noteForm.minutes === "--" ? null : Number(noteForm.minutes);
    const secondsValue = noteForm.seconds === "--" ? null : Number(noteForm.seconds);
    const payload = {
      gameId,
      periodLabel: noteForm.period === "--" ? null : noteForm.period,
      minutes: Number.isNaN(minutesValue) ? null : minutesValue,
      seconds: Number.isNaN(secondsValue) ? null : secondsValue,
      text: String(noteForm.text || "").trim(),
      tags: Array.isArray(noteForm.tags) ? noteForm.tags : [],
      sourceMeta: noteSourceAction
        ? buildPlayByPlaySourceMeta({
          gameId,
          seasonYear: game?.seasonYear,
          action: noteSourceAction,
          videoEventId: videoEventIdByActionNumber.get(noteSourceAction.actionNumber),
        })
        : null,
    };
    try {
      setSavingNewNote(true);
      await createNote(payload, user?.id);
      closeAddNote();
    } catch (error) {
      setSavingNewNote(false);
      window.alert(error?.message || "Unable to save note.");
    }
  };

  const handleHoldStart = (action) => (event) => {
    if (!action) return;
    clearHoldTimer();
    holdTargetRef.current = action;
    if (event?.touches?.length) {
      holdPointerStartRef.current = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
      };
    } else if (typeof event?.clientX === "number" && typeof event?.clientY === "number") {
      holdPointerStartRef.current = {
        x: event.clientX,
        y: event.clientY,
      };
    }
    holdTimerRef.current = setTimeout(() => {
      if (holdTargetRef.current === action) {
        openAddNoteForAction(action);
      }
      clearHoldTimer();
    }, 1000);
  };

  const handleHoldMove = (event) => {
    if (!holdTimerRef.current || !holdPointerStartRef.current) return;

    let point = null;
    if (event?.touches?.length) {
      point = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    } else if (typeof event?.clientX === "number" && typeof event?.clientY === "number") {
      point = { x: event.clientX, y: event.clientY };
    }
    if (!point) return;

    const dx = point.x - holdPointerStartRef.current.x;
    const dy = point.y - holdPointerStartRef.current.y;
    if (Math.hypot(dx, dy) >= HOLD_MOVE_TOLERANCE_PX) {
      clearHoldTimer();
    }
  };

  const handleHoldEnd = () => {
    clearHoldTimer();
  };

  useLayoutEffect(() => {
    if (!showExtras) return;
    const wheel = pbpWheelRef.current;
    const wheelInner = pbpWheelInnerRef.current;
    if (!wheel || !wheelInner) return;
    const scrollToRight = () => {
      wheel.scrollLeft = Math.max(0, wheel.scrollWidth - wheel.clientWidth);
    };
    let raf1 = 0;
    let raf2 = 0;
    const queueScroll = () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      raf1 = requestAnimationFrame(() => {
        scrollToRight();
        raf2 = requestAnimationFrame(scrollToRight);
      });
    };
    queueScroll();
    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
        queueScroll();
      })
      : null;
    resizeObserver?.observe(wheelInner);
    const timeout = setTimeout(scrollToRight, 80);
    const timeoutLate = setTimeout(scrollToRight, 220);
    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      resizeObserver?.disconnect();
      clearTimeout(timeout);
      clearTimeout(timeoutLate);
    };
  }, [pbpWheelItems, showExtras]);

  useEffect(() => {
    if (!showExtras) return;
    const wheel = pbpWheelRef.current;
    if (!wheel) return;
    const scrollToRight = () => {
      wheel.scrollLeft = Math.max(0, wheel.scrollWidth - wheel.clientWidth);
    };
    const raf1 = requestAnimationFrame(() => {
      scrollToRight();
      requestAnimationFrame(scrollToRight);
    });
    const timeout = setTimeout(scrollToRight, 80);
    return () => {
      cancelAnimationFrame(raf1);
      clearTimeout(timeout);
    };
  }, [showExtras]);

  const finalSnapshotTotals = useMemo(() => {
    if (!periodSnapshotMap || !homeTeamId || !awayTeamId) return null;
    const periods = Array.from(periodSnapshotMap.keys());
    if (!periods.length) return null;
    const maxPeriod = Math.max(...periods.map((value) => Number(value) || 0));
    const endTotals = periodSnapshotMap.get(maxPeriod);
    if (!endTotals) return null;
    return {
      [awayTeamId]: endTotals.get(String(awayTeamId)) || endTotals.get(awayTeamId) || {},
      [homeTeamId]: endTotals.get(String(homeTeamId)) || endTotals.get(homeTeamId) || {},
    };
  }, [periodSnapshotMap, awayTeamId, homeTeamId]);

  const snapshotBounds = useMemo(() => {
    if (!useSnapshots) return null;
    return getSegmentSnapshotBounds(segment, snapshots, currentSnapshot, game?.period);
  }, [useSnapshots, segment, snapshots, currentSnapshot, game?.period]);
  const snapshotLabel = useMemo(() => {
    if (!snapshotBounds?.startMeta) return null;
    const { type, period, clock } = snapshotBounds.startMeta;
    const labelType = type === "period-end" ? "Period end" : "Timeout";
    return `${labelType} (Q${period} ${clock})`;
  }, [snapshotBounds]);
  const snapshotStats = useMemo(() => {
    if (!snapshotBounds || !snapshotBounds.end || !snapshotBounds.start) return null;
    if (!homeTeam?.teamId || !awayTeam?.teamId) return null;
    return diffSnapshots(snapshotBounds.start, snapshotBounds.end, basePlayers);
  }, [snapshotBounds, basePlayers, homeTeam, awayTeam]);

  const playerMap = useMemo(() => {
    if (!snapshotStats || !snapshotBounds?.endIsLive) return segmentStats.playerMap;
    const merged = new Map(segmentStats.playerMap);
    snapshotStats.playerMap.forEach((snap, personId) => {
      const base = merged.get(personId) || snap;
      merged.set(personId, {
        ...base,
        ...snap,
        minutes: base.minutes ?? snap.minutes,
        plusMinusPoints: base.plusMinusPoints ?? snap.plusMinusPoints,
      });
    });
    return merged;
  }, [segmentStats.playerMap, snapshotStats, snapshotBounds?.endIsLive]);

  const formatMinutesFromSeconds = (seconds) => {
    const safeSeconds = Math.max(0, Math.round(seconds || 0));
    const minutes = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const parseDuration = (value) => {
    if (!value) return null;
    const match = /PT(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(String(value));
    if (!match) return null;
    const minutes = Number(match[1] || 0);
    const seconds = Number(match[2] || 0);
    return Math.round(minutes * 60 + seconds);
  };

  const buildPlayers = (players, options = {}) =>
    players
      .map((player) => {
        const stats = playerMap.get(player.personId) || {};
        const useDefaults = options.forceZeros || segment !== "all";
        const base = segment === "all"
          ? player
          : {
            personId: player.personId,
            firstName: player.firstName || "",
            familyName: player.familyName || "",
            jerseyNum: player.jerseyNum || "",
            position: player.position || "",
          };
        const safeStats = useDefaults ? { ...SEGMENT_STAT_DEFAULTS, ...stats } : stats;
        const officialSeconds = segment === "all" ? parseDuration(player.minutes) : null;
        const minutesSeconds =
          segment === "all" && Number.isFinite(officialSeconds) ? officialSeconds : safeStats.minutes;
        const plusMinusPoints =
          segment === "all" && player.plusMinusPoints != null ? player.plusMinusPoints : safeStats.plusMinusPoints;
        const offensivePoss = safeStats.possessionsFor || 0;
        const defensivePoss = safeStats.possessionsAgainst || 0;
        const computedOrt = offensivePoss ? (safeStats.pointsFor / offensivePoss) * 100 : null;
        const computedDrt = defensivePoss ? (safeStats.pointsAgainst / defensivePoss) * 100 : null;
        const ortg = segment === "all" && Number.isFinite(player.offensiveRating ?? player.ortg)
          ? (player.offensiveRating ?? player.ortg)
          : computedOrt;
        const drtg = segment === "all" && Number.isFinite(player.defensiveRating ?? player.drtg)
          ? (player.defensiveRating ?? player.drtg)
          : computedDrt;
        return {
          ...base,
          ...safeStats,
          plusMinusPoints,
          minutes: formatMinutesFromSeconds(minutesSeconds),
          ortg,
          drtg,
        };
      })
      .filter((player) => (
        isPregame || player.minutes !== "00:00" || player.points > 0 || player.reboundsTotal > 0
      ));

  const hasBoxScorePlayers =
    (boxScore?.away?.players?.length || 0) > 0 || (boxScore?.home?.players?.length || 0) > 0;
  const awaySourcePlayers = boxScore?.away?.players || [];
  const homeSourcePlayers = boxScore?.home?.players || [];
  const awayPlayers = buildPlayers(awaySourcePlayers, { forceZeros: !hasBoxScorePlayers });
  const homePlayers = buildPlayers(homeSourcePlayers, { forceZeros: !hasBoxScorePlayers });

  const mergeAllSegmentTotals = (base, computed, snapshot) => {
    if (segment !== "all") return base;
    const pickValue = (primary, fallback) =>
      Number.isFinite(primary) && primary !== 0
        ? primary
        : Number.isFinite(fallback)
          ? fallback
          : 0;
    const preferComputed = (key) => pickValue(snapshot?.[key], pickValue(computed?.[key], base?.[key]));
    const pointsOffTurnovers = pickValue(
      snapshot?.pointsOffTurnovers,
      pickValue(base?.pointsOffTurnovers, computed?.pointsOffTurnovers)
    );
    const secondChancePoints = pickValue(
      snapshot?.secondChancePoints,
      pickValue(base?.secondChancePoints, computed?.secondChancePoints)
    );
    const paintPoints = pickValue(
      snapshot?.paintPoints,
      pickValue(base?.paintPoints, computed?.paintPoints)
    );
    const transitionPoints = pickValue(
      snapshot?.transitionPoints,
      pickValue(base?.transitionPoints, computed?.transitionPoints)
    );
    const secondChance3FGMade = pickValue(
      snapshot?.secondChance3FGMade,
      pickValue(computed?.secondChance3FGMade, base?.secondChance3FGMade)
    );
    const secondChance3FGAttempted = pickValue(
      snapshot?.secondChance3FGAttempted,
      pickValue(computed?.secondChance3FGAttempted, base?.secondChance3FGAttempted)
    );
    return {
      ...base,
      pointsOffTurnovers,
      secondChancePoints,
      paintPoints,
      transitionPoints,
      drivingFGMade: preferComputed("drivingFGMade"),
      drivingFGAttempted: preferComputed("drivingFGAttempted"),
      cuttingFGMade: preferComputed("cuttingFGMade"),
      cuttingFGAttempted: preferComputed("cuttingFGAttempted"),
      catchAndShoot3FGMade: preferComputed("catchAndShoot3FGMade"),
      catchAndShoot3FGAttempted: preferComputed("catchAndShoot3FGAttempted"),
      secondChance3FGMade,
      secondChance3FGAttempted,
      offensiveFoulsDrawn: preferComputed("offensiveFoulsDrawn"),
    };
  };
  const mergeSegmentTotals = (computed, snapshot) =>
    snapshot ? { ...computed, ...snapshot } : computed;
  const computedAwayTotals = segmentStats.teamTotals[awayTeamId] || {};
  const computedHomeTotals = segmentStats.teamTotals[homeTeamId] || {};
  const baseAwayTotals = awayTeamId
    ? segment === "all"
      ? mergeAllSegmentTotals(
        boxScore?.away?.totals || segmentStats.teamTotals[awayTeamId] || {},
        computedAwayTotals,
        finalSnapshotTotals?.[awayTeamId]
      )
      : mergeSegmentTotals(computedAwayTotals, segmentSnapshotTotals?.[awayTeamId])
    : {};
  const baseHomeTotals = homeTeamId
    ? segment === "all"
      ? mergeAllSegmentTotals(
        boxScore?.home?.totals || segmentStats.teamTotals[homeTeamId] || {},
        computedHomeTotals,
        finalSnapshotTotals?.[homeTeamId]
      )
      : mergeSegmentTotals(computedHomeTotals, segmentSnapshotTotals?.[homeTeamId])
    : {};
  const useSnapshotTotals = snapshotBounds?.endIsLive;
  const awaySnapshotTotals =
    useSnapshotTotals && awayTeamId ? snapshotStats?.teamTotals?.[awayTeamId] : null;
  const homeSnapshotTotals =
    useSnapshotTotals && homeTeamId ? snapshotStats?.teamTotals?.[homeTeamId] : null;
  const isLiveSegment = segment !== "all" && snapshotBounds?.endIsLive;
  const mergeTeamTotals = (base, snapshot) => {
    if (!snapshot) return base;
    const merged = { ...base, ...snapshot };
    if (isLiveSegment) {
      const basePoints = base?.points ?? 0;
      const snapPoints = snapshot?.points;
      merged.points = Number.isFinite(snapPoints) ? Math.max(basePoints, snapPoints) : basePoints;
    }
    return merged;
  };
  const awayTotals = mergeTeamTotals(baseAwayTotals, awaySnapshotTotals);
  const homeTotals = mergeTeamTotals(baseHomeTotals, homeSnapshotTotals);
  const advancedAwayTotals = baseAwayTotals;
  const advancedHomeTotals = baseHomeTotals;
  const displayAwayScore = segment === "all" ? awayTeam?.score ?? 0 : awayTotals.points || 0;
  const displayHomeScore = segment === "all" ? homeTeam?.score ?? 0 : homeTotals.points || 0;

  const possessions = (teamTotals = {}, opponentTotals = {}) => {
    const fga = teamTotals.fieldGoalsAttempted || 0;
    const fta = teamTotals.freeThrowsAttempted || 0;
    const fg = teamTotals.fieldGoalsMade || 0;
    const to = teamTotals.turnovers || 0;
    const orb = teamTotals.reboundsOffensive || 0;
    const oppDrb = (opponentTotals.reboundsTotal || 0) - (opponentTotals.reboundsOffensive || 0);
    const orbRate = orb + oppDrb ? orb / (orb + oppDrb) : 0;
    return fga + 0.4 * fta - 1.07 * orbRate * (fga - fg) + to;
  };

  const possessionCounts = useMemo(() => {
    if (!homeTeamId || !awayTeamId) return null;
    return countPossessionsByTeam(
      game?.playByPlayActions || [],
      segment,
      homeTeamId,
      awayTeamId
    );
  }, [game?.playByPlayActions, segment, homeTeamId, awayTeamId]);

  const hasPossessionCounts =
    possessionCounts
    && possessionCounts.homePossessions > 0
    && possessionCounts.awayPossessions > 0;
  const possessionOffset =
    segment === "all" && hasPossessionCounts && isWnbaGame ? 1 : 0;

  if (isLoading) {
    return <div className={styles.stateMessage}>Loading game details...</div>;
  }

  if (error || !game) {
    return <div className={styles.stateMessage}>Failed to load game details.</div>;
  }

  if (!homeTeamId || !awayTeamId || !homeTeam || !awayTeam) {
    return <div className={styles.stateMessage}>Loading game details...</div>;
  }

  const useOfficialRatings =
    segment === "all" &&
    teamStats?.away?.hasOfficialAdvanced &&
    teamStats?.home?.hasOfficialAdvanced &&
    Number.isFinite(teamStats?.away?.offensiveRating) &&
    Number.isFinite(teamStats?.home?.offensiveRating);

  const officialAwayPossessions = teamStats?.away?.possessions;
  const officialHomePossessions = teamStats?.home?.possessions;
  const useOfficialPossessions =
    segment === "all" &&
    teamStats?.away?.hasOfficialAdvanced &&
    teamStats?.home?.hasOfficialAdvanced &&
    Number.isFinite(officialAwayPossessions) &&
    Number.isFinite(officialHomePossessions);

  const fallbackAwayPossessions = hasPossessionCounts
    ? possessionCounts.awayPossessions + possessionOffset
    : Math.max(Math.round(possessions(advancedAwayTotals, advancedHomeTotals)), 1);
  const fallbackHomePossessions = hasPossessionCounts
    ? possessionCounts.homePossessions + possessionOffset
    : Math.max(Math.round(possessions(advancedHomeTotals, advancedAwayTotals)), 1);

  const awayPossessions = Math.max(
    useOfficialPossessions ? Math.round(officialAwayPossessions) : fallbackAwayPossessions,
    1
  );
  const homePossessions = Math.max(
    useOfficialPossessions ? Math.round(officialHomePossessions) : fallbackHomePossessions,
    1
  );

  const ortgAway = useOfficialRatings
    ? Math.round(teamStats.away.offensiveRating)
    : Math.round(((advancedAwayTotals.points || 0) / awayPossessions) * 100);
  const ortgHome = useOfficialRatings
    ? Math.round(teamStats.home.offensiveRating)
    : Math.round(((advancedHomeTotals.points || 0) / homePossessions) * 100);
  const useOfficialDefensive =
    segment === "all" &&
    teamStats?.away?.hasOfficialAdvanced &&
    teamStats?.home?.hasOfficialAdvanced &&
    Number.isFinite(teamStats?.away?.defensiveRating) &&
    Number.isFinite(teamStats?.home?.defensiveRating);
  const drtgAway = useOfficialDefensive
    ? Math.round(teamStats.away.defensiveRating)
    : Math.round(((advancedHomeTotals.points || 0) / homePossessions) * 100);
  const drtgHome = useOfficialDefensive
    ? Math.round(teamStats.home.defensiveRating)
    : Math.round(((advancedAwayTotals.points || 0) / awayPossessions) * 100);

  const netAway = useOfficialRatings && Number.isFinite(teamStats?.away?.netRating)
    ? Math.round(teamStats.away.netRating)
    : ortgAway - drtgAway;
  const netHome = useOfficialRatings && Number.isFinite(teamStats?.home?.netRating)
    ? Math.round(teamStats.home.netRating)
    : ortgHome - drtgHome;
  const formatChancesValue = (value) => {
    if (!Number.isFinite(value)) return "0";
    return String(Math.round(value));
  };
  const awayChances = awayPossessions + (advancedAwayTotals.reboundsOffensive || 0);
  const homeChances = homePossessions + (advancedHomeTotals.reboundsOffensive || 0);
  const displayAwayChances = isPregame ? 0 : awayChances;
  const displayHomeChances = isPregame ? 0 : homeChances;
  const transitionStatsDerived = (teamTotals, possessionsCount) => ({
    transitionRate: (teamTotals.transitionPossessions || 0)
      ? ((teamTotals.transitionPossessions || 0) / possessionsCount) * 100
      : 0,
    transitionPossessions: teamTotals.transitionPossessions || 0,
    transitionPoints: teamTotals.transitionPoints || 0,
    transitionTurnovers: teamTotals.transitionTurnovers || 0,
    secondChancePoints: teamTotals.secondChancePoints || 0,
    pointsOffTurnovers: teamTotals.pointsOffTurnovers || 0,
    paintPoints: teamTotals.paintPoints || 0,
    threePointORebPercent: teamTotals.reboundsOffensive
      ? ((teamTotals.threePointOReb || 0) / teamTotals.reboundsOffensive) * 100
      : 0,
  });

  const mergeTransitionSource = (snapshotTotals, computedTotals, fallbackTotals = {}) => {
    const base = snapshotTotals || computedTotals || fallbackTotals || {};
    if (!computedTotals) return base;
    const preferBaseValue = (key) => (
      Number.isFinite(fallbackTotals?.[key]) ? fallbackTotals[key] : base[key]
    );
    return {
      ...base,
      transitionPossessions: computedTotals.transitionPossessions ?? base.transitionPossessions ?? 0,
      transitionPoints: preferBaseValue("transitionPoints") ?? computedTotals.transitionPoints ?? 0,
      transitionTurnovers: computedTotals.transitionTurnovers ?? base.transitionTurnovers ?? 0,
      secondChancePoints: preferBaseValue("secondChancePoints") ?? computedTotals.secondChancePoints ?? 0,
      pointsOffTurnovers: preferBaseValue("pointsOffTurnovers") ?? computedTotals.pointsOffTurnovers ?? 0,
      paintPoints: preferBaseValue("paintPoints") ?? computedTotals.paintPoints ?? 0,
      threePointOReb: computedTotals.threePointOReb ?? base.threePointOReb ?? 0,
      reboundsOffensive: computedTotals.reboundsOffensive ?? base.reboundsOffensive ?? 0,
    };
  };

  const awayTransitionSource = segment === "all"
    ? mergeTransitionSource(
      finalSnapshotTotals?.[awayTeam?.teamId],
      segmentStats.teamTotals?.[awayTeam?.teamId],
      advancedAwayTotals
    )
    : advancedAwayTotals;
  const homeTransitionSource = segment === "all"
    ? mergeTransitionSource(
      finalSnapshotTotals?.[homeTeam?.teamId],
      segmentStats.teamTotals?.[homeTeam?.teamId],
      advancedHomeTotals
    )
    : advancedHomeTotals;
  const awayTransitionDerived = transitionStatsDerived(awayTransitionSource, awayPossessions);
  const homeTransitionDerived = transitionStatsDerived(homeTransitionSource, homePossessions);
  const awayTransition = awayTransitionDerived;
  const homeTransition = homeTransitionDerived;

  const awayDefReb = (advancedAwayTotals.reboundsTotal || 0) - (advancedAwayTotals.reboundsOffensive || 0);
  const homeDefReb = (advancedHomeTotals.reboundsTotal || 0) - (advancedHomeTotals.reboundsOffensive || 0);

  const efg = (fgm, fga, tpm) => (fga ? ((fgm + 0.5 * tpm) / fga) * 100 : 0);
  const tov = (to, fga, fta) => (fga || fta || to ? (to / (fga + 0.44 * fta + to)) * 100 : 0);
  const orb = (orbValue, oppDrb) =>
    orbValue || oppDrb ? (orbValue / (orbValue + oppDrb)) * 100 : 0;
  const ftr = (fta, fga) => (fga ? (fta / fga) * 100 : 0);

  const fourFactorRows = [
    {
      label: "eFG%",
      awayValue: efg(advancedAwayTotals.fieldGoalsMade, advancedAwayTotals.fieldGoalsAttempted, advancedAwayTotals.threePointersMade),
      homeValue: efg(advancedHomeTotals.fieldGoalsMade, advancedHomeTotals.fieldGoalsAttempted, advancedHomeTotals.threePointersMade),
      format: (v) => `${v.toFixed(1)}%`,
    },
    {
      label: "TOV%",
      awayValue: tov(advancedAwayTotals.turnovers, advancedAwayTotals.fieldGoalsAttempted, advancedAwayTotals.freeThrowsAttempted),
      homeValue: tov(advancedHomeTotals.turnovers, advancedHomeTotals.fieldGoalsAttempted, advancedHomeTotals.freeThrowsAttempted),
      format: (v) => `${v.toFixed(1)}%`,
    },
    {
      label: "ORB%",
      awayValue: orb(advancedAwayTotals.reboundsOffensive, homeDefReb),
      homeValue: orb(advancedHomeTotals.reboundsOffensive, awayDefReb),
      format: (v) => `${v.toFixed(1)}%`,
    },
    {
      label: "FTr",
      awayValue: ftr(advancedAwayTotals.freeThrowsAttempted, advancedAwayTotals.fieldGoalsAttempted),
      homeValue: ftr(advancedHomeTotals.freeThrowsAttempted, advancedHomeTotals.fieldGoalsAttempted),
      format: (v) => `${v.toFixed(1)}`,
    },
  ];

  const totalFgaAway = advancedAwayTotals.fieldGoalsAttempted || 0;
  const totalFgaHome = advancedHomeTotals.fieldGoalsAttempted || 0;

  const shotProfileRows = [
    {
      label: "Rim Rate",
      awayValue: totalFgaAway ? ((advancedAwayTotals.rimFieldGoalsAttempted || 0) / totalFgaAway) * 100 : 0,
      homeValue: totalFgaHome ? ((advancedHomeTotals.rimFieldGoalsAttempted || 0) / totalFgaHome) * 100 : 0,
      format: (v) => `${v.toFixed(1)}%`,
      awayDetail: `${advancedAwayTotals.rimFieldGoalsMade || 0}/${advancedAwayTotals.rimFieldGoalsAttempted || 0}`,
      homeDetail: `${advancedHomeTotals.rimFieldGoalsMade || 0}/${advancedHomeTotals.rimFieldGoalsAttempted || 0}`,
    },
    {
      label: "Mid Rate",
      awayValue: totalFgaAway ? ((advancedAwayTotals.midFieldGoalsAttempted || 0) / totalFgaAway) * 100 : 0,
      homeValue: totalFgaHome ? ((advancedHomeTotals.midFieldGoalsAttempted || 0) / totalFgaHome) * 100 : 0,
      format: (v) => `${v.toFixed(1)}%`,
      awayDetail: `${advancedAwayTotals.midFieldGoalsMade || 0}/${advancedAwayTotals.midFieldGoalsAttempted || 0}`,
      homeDetail: `${advancedHomeTotals.midFieldGoalsMade || 0}/${advancedHomeTotals.midFieldGoalsAttempted || 0}`,
    },
    {
      label: "3P Rate",
      awayValue: totalFgaAway ? ((advancedAwayTotals.threePointersAttempted || 0) / totalFgaAway) * 100 : 0,
      homeValue: totalFgaHome ? ((advancedHomeTotals.threePointersAttempted || 0) / totalFgaHome) * 100 : 0,
      format: (v) => `${v.toFixed(1)}%`,
      awayDetail: `${advancedAwayTotals.threePointersMade || 0}/${advancedAwayTotals.threePointersAttempted || 0}`,
      homeDetail: `${advancedHomeTotals.threePointersMade || 0}/${advancedHomeTotals.threePointersAttempted || 0}`,
    },
  ];

  const shotEffRows = [
    {
      label: "Rim FG%",
      awayValue: advancedAwayTotals.rimFieldGoalsAttempted
        ? (advancedAwayTotals.rimFieldGoalsMade / advancedAwayTotals.rimFieldGoalsAttempted) * 100
        : 0,
      homeValue: advancedHomeTotals.rimFieldGoalsAttempted
        ? (advancedHomeTotals.rimFieldGoalsMade / advancedHomeTotals.rimFieldGoalsAttempted) * 100
        : 0,
      format: (v) => `${v.toFixed(1)}%`,
      awayDetail: `${advancedAwayTotals.rimFieldGoalsMade || 0}/${advancedAwayTotals.rimFieldGoalsAttempted || 0}`,
      homeDetail: `${advancedHomeTotals.rimFieldGoalsMade || 0}/${advancedHomeTotals.rimFieldGoalsAttempted || 0}`,
    },
    {
      label: "Mid FG%",
      awayValue: advancedAwayTotals.midFieldGoalsAttempted
        ? (advancedAwayTotals.midFieldGoalsMade / advancedAwayTotals.midFieldGoalsAttempted) * 100
        : 0,
      homeValue: advancedHomeTotals.midFieldGoalsAttempted
        ? (advancedHomeTotals.midFieldGoalsMade / advancedHomeTotals.midFieldGoalsAttempted) * 100
        : 0,
      format: (v) => `${v.toFixed(1)}%`,
      awayDetail: `${advancedAwayTotals.midFieldGoalsMade || 0}/${advancedAwayTotals.midFieldGoalsAttempted || 0}`,
      homeDetail: `${advancedHomeTotals.midFieldGoalsMade || 0}/${advancedHomeTotals.midFieldGoalsAttempted || 0}`,
    },
    {
      label: "3P FG%",
      awayValue: advancedAwayTotals.threePointersAttempted
        ? (advancedAwayTotals.threePointersMade / advancedAwayTotals.threePointersAttempted) * 100
        : 0,
      homeValue: advancedHomeTotals.threePointersAttempted
        ? (advancedHomeTotals.threePointersMade / advancedHomeTotals.threePointersAttempted) * 100
        : 0,
      format: (v) => `${v.toFixed(1)}%`,
      awayDetail: `${advancedAwayTotals.threePointersMade || 0}/${advancedAwayTotals.threePointersAttempted || 0}`,
      homeDetail: `${advancedHomeTotals.threePointersMade || 0}/${advancedHomeTotals.threePointersAttempted || 0}`,
    },
  ];

  const awayDeflections = teamStats?.away?.advancedStats?.deflections ?? 0;
  const homeDeflections = teamStats?.home?.advancedStats?.deflections ?? 0;
  const awayDisruptions =
    (advancedAwayTotals.steals || 0) +
    (advancedAwayTotals.blocks || 0) +
    (advancedAwayTotals.offensiveFoulsDrawn || 0) +
    awayDeflections;
  const homeDisruptions =
    (advancedHomeTotals.steals || 0) +
    (advancedHomeTotals.blocks || 0) +
    (advancedHomeTotals.offensiveFoulsDrawn || 0) +
    homeDeflections;
  const buildCreatingStats = (teamTotals, fallback) => ({
    drivingFGMade: teamTotals.drivingFGMade ?? fallback?.drivingFGMade ?? 0,
    drivingFGAttempted: teamTotals.drivingFGAttempted ?? fallback?.drivingFGAttempted ?? 0,
    cuttingFGMade: teamTotals.cuttingFGMade ?? fallback?.cuttingFGMade ?? 0,
    cuttingFGAttempted: teamTotals.cuttingFGAttempted ?? fallback?.cuttingFGAttempted ?? 0,
    catchAndShoot3FGMade: teamTotals.catchAndShoot3FGMade ?? fallback?.catchAndShoot3FGMade ?? 0,
    catchAndShoot3FGAttempted: teamTotals.catchAndShoot3FGAttempted ?? fallback?.catchAndShoot3FGAttempted ?? 0,
    secondChance3FGMade: teamTotals.secondChance3FGMade ?? fallback?.secondChance3FGMade ?? 0,
    secondChance3FGAttempted: teamTotals.secondChance3FGAttempted ?? fallback?.secondChance3FGAttempted ?? 0,
    offensiveFoulsDrawn: teamTotals.offensiveFoulsDrawn ?? fallback?.offensiveFoulsDrawn ?? 0,
  });

  const awayCreating = buildCreatingStats(advancedAwayTotals, teamStats?.away?.advancedStats);
  const homeCreating = buildCreatingStats(advancedHomeTotals, teamStats?.home?.advancedStats);

  const parseClock = (clock) => {
    if (!clock) return 0;
    const [min, sec] = clock.split(":");
    return Number(min) * 60 + Number(sec);
  };

  const parseIsoClock = (clock) => {
    if (!clock) return 0;
    const match = /PT(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(clock);
    if (!match) return 0;
    const minutes = Number(match[1] || 0);
    const seconds = Number(match[2] || 0);
    return minutes * 60 + seconds;
  };

  const estimateElapsedSegmentSeconds = () => {
    if (!isLive || !game?.period || !game?.gameClock) return null;
    const predicate = segmentPeriods(segment);
    const currentPeriod = Number(game.period) || 1;
    const periodLength = (period) => (period <= 4 ? regulationPeriodSeconds : 5 * 60);
    const remaining = parseIsoClock(game.gameClock);
    const elapsedCurrent = Math.max(0, periodLength(currentPeriod) - remaining);
    let total = 0;
    for (let period = 1; period < currentPeriod; period += 1) {
      if (predicate(period)) total += periodLength(period);
    }
    if (predicate(currentPeriod)) total += elapsedCurrent;
    return total || null;
  };

  const estimateElapsedAllSeconds = () => {
    if (!game?.period || !game?.gameClock) return null;
    const period = Number(game.period) || 1;
    const currentLength = period <= 4 ? regulationPeriodSeconds : 5 * 60;
    const remaining = parseIsoClock(game.gameClock);
    const elapsedCurrent = Math.max(0, currentLength - remaining);
    let completed = 0;
    for (let p = 1; p < period; p += 1) {
      completed += p <= 4 ? regulationPeriodSeconds : 5 * 60;
    }
    return completed + elapsedCurrent;
  };

  const segmentSeconds = (() => {
    if (isLive) {
      const elapsed = segment === "all" ? estimateElapsedAllSeconds() : estimateElapsedSegmentSeconds();
      if (elapsed) return elapsed;
    } else if (minutesData?.periods?.length) {
      const predicate = segmentPeriods(segment);
      const total = minutesData.periods
        .filter((p) => predicate(p.period))
        .flatMap((p) => p.stints || [])
        .reduce((sum, stint) => sum + (parseClock(stint.startClock) - parseClock(stint.endClock)), 0);
      if (total > 0) return total;
    }
    const defaultSeconds = {
      "q1": regulationPeriodSeconds,
      "q2": regulationPeriodSeconds,
      "q3": regulationPeriodSeconds,
      "q4": regulationPeriodSeconds,
      "q1-q3": regulationPeriodSeconds * 3,
      "first-half": regulationPeriodSeconds * 2,
      "second-half": regulationPeriodSeconds * 2,
      "all": regulationGameSeconds,
    };
    return defaultSeconds[segment] || regulationGameSeconds;
  })();

  const killStats = segmentSeconds === 0
    ? { homeKills: 0, awayKills: 0 }
    : computeKills(game.playByPlayActions || [], segment, homeTeam.teamId, awayTeam.teamId);

  const paceFrom = (possessionsCount) => {
    const officialPaceScaleSeconds = 48 * 60;
    return segmentSeconds ? (possessionsCount * officialPaceScaleSeconds) / segmentSeconds : 0;
  };
  const pace40From = (possessionsCount) =>
    segmentSeconds ? (possessionsCount * regulationGameSeconds) / segmentSeconds : 0;

  const basePace = useOfficialPossessions
    ? (officialAwayPossessions + officialHomePossessions) / 2
    : (awayPossessions + homePossessions) / 2;

  const officialPace =
    segment === "all" &&
    teamStats?.away?.hasOfficialAdvanced &&
    teamStats?.home?.hasOfficialAdvanced &&
    Number.isFinite(teamStats?.away?.pace) &&
    Number.isFinite(teamStats?.home?.pace) &&
    teamStats.away.pace > 0 &&
    teamStats.home.pace > 0
      ? (teamStats.away.pace + teamStats.home.pace) / 2
      : null;
  const paceValue = Number.isFinite(officialPace) ? officialPace : paceFrom(basePace);
  const pace40Value = pace40From(basePace);
  const displayPaceValue = isPregame ? 0 : paceValue;
  const displayPace40Value = isPregame ? 0 : pace40Value;

  const currentPeriod = game.period || 1;
  const foulLimit = 5;
  const isTeamFoulAction = (action) => {
    if (action.actionType !== "foul") return false;
    const subType = String(action.subType || "").toLowerCase();
    const descriptor = String(action.descriptor || "").toLowerCase();
    const qualifiers = (action.qualifiers || []).map((q) => String(q || "").toLowerCase());
    if (subType === "offensive") return false;
    if (subType.includes("technical") || descriptor.includes("technical")) return false;
    if (qualifiers.some((q) => q.includes("technical"))) return false;
    return true;
  };
  const teamFoulInfo = (teamId) => {
    let markerCount = 0;
    let fallbackCount = 0;
    let lastTwoCount = 0;
    let inPenalty = false;
    let sawMarker = false;
    const penaltyThreshold = 5;
    const lastTwoSeconds = 2 * 60;
    (game.playByPlayActions || []).forEach((action) => {
      if (action.period !== currentPeriod) return;
      if (!isTeamFoulAction(action)) return;
      if (action.teamId !== teamId) return;
      fallbackCount += 1;
      const remaining = parseIsoClock(action.clock);
      if (remaining <= lastTwoSeconds) lastTwoCount += 1;
      const marker = parseTeamFoulMarker(action.description);
      if (!marker) return;
      sawMarker = true;
      if (marker.teamFouls != null) markerCount = Math.max(markerCount, marker.teamFouls);
      if (marker.inPenalty) inPenalty = true;
    });
    let count = (sawMarker && markerCount > 0) ? markerCount : fallbackCount;
    if (!inPenalty && count >= penaltyThreshold) inPenalty = true;
    if (!inPenalty && lastTwoCount >= 2) inPenalty = true;
    let displayCount = count;
    if (lastTwoCount >= 1 && displayCount < 4) displayCount = 4;
    if (lastTwoCount >= 2) displayCount = foulLimit;
    if (displayCount > foulLimit) displayCount = foulLimit;
    return { count: displayCount, inPenalty };
  };
  const awayFoulInfo = teamFoulInfo(awayTeam.teamId);
  const homeFoulInfo = teamFoulInfo(homeTeam.teamId);
  const awayFoulsDisplay = Math.min(
    awayFoulInfo.inPenalty ? foulLimit : awayFoulInfo.count,
    foulLimit
  );
  const homeFoulsDisplay = Math.min(
    homeFoulInfo.inPenalty ? foulLimit : homeFoulInfo.count,
    foulLimit
  );
  const lockIcon = isLocked ? "🔒" : "🔓";
  const renderTimeouts = (remaining, showReset, resetUsed) => (
    <div className={styles.metaBlock}>
      <div className={styles.metaLabel}>Timeouts</div>
      <div className={styles.timeoutsNumbers}>
        {Array.from({ length: 5 }, (_, index) => {
          const value = index + 1;
          const inactive = remaining != null && value > remaining;
          return (
            <span
              key={value}
              className={`${styles.timeoutNumber} ${inactive ? styles.timeoutInactive : ""}`}
            >
              {value}
            </span>
          );
        })}
      </div>
      <div className={styles.resetLine}>
        {showReset ? (
          <span className={`${styles.resetLabel} ${resetUsed ? styles.resetUsed : ""}`}>RESET</span>
        ) : null}
      </div>
      <div className={styles.metaSpacer} />
    </div>
  );
  const awayTimeoutsRemaining = isPregame ? 5 : timeouts?.away;
  const homeTimeoutsRemaining = isPregame ? 5 : timeouts?.home;
  const isGLeagueGame = awayLeague === "gleague" || homeLeague === "gleague";
  const awayResetUsed = hasUsedResetTimeout(game?.playByPlayActions || [], awayTeamId, game?.period);
  const homeResetUsed = hasUsedResetTimeout(game?.playByPlayActions || [], homeTeamId, game?.period);
  const renderFouls = (count) => (
    <div className={styles.metaBlock}>
      <div className={styles.metaLabel}>Fouls</div>
      <div className={styles.metaValue}>
        <span className={foulsClass(count, styles)}>{count}</span>
      </div>
    </div>
  );
  const renderChallenges = (teamChallenges) => (
    <div className={styles.metaBlock}>
      <div className={styles.metaLabel}>Challenge</div>
      <div className={styles.metaValueRow}>
        {buildChallengeCircles(teamChallenges).map((circle, index) => (
          <span
            key={`${circle.state}-${index}`}
            className={`${styles.challengeDot} ${styles[`challenge${circle.state[0].toUpperCase()}${circle.state.slice(1)}`]}`}
          />
        ))}
      </div>
      <div className={styles.metaSpacer} />
    </div>
  );

  return (
    <div className={styles.container}>
      <div className={styles.backRow}>
        <div className={styles.backRowLeft}>
          <Link className={styles.backButton} to={dateParam ? `/?d=${dateParam}` : "/"}>
            Back
          </Link>
          {showExtras ? (
            <Link
              className={styles.backButton}
              to={dateParam ? `/g/${gameId}/atc?d=${dateParam}` : `/g/${gameId}/atc`}
            >
              ATC
            </Link>
          ) : (
            <Link
              className={styles.backButton}
              to={dateParam ? `/g/${gameId}?d=${dateParam}` : `/g/${gameId}`}
            >
              Full Dashboard
            </Link>
          )}
          {showExtras && trackedGame && (
            <Link
              className={styles.backButton}
              to={dateParam ? `/g/${gameId}/pregame?d=${dateParam}` : `/g/${gameId}/pregame`}
            >
              Pre-Game
            </Link>
          )}
          {showExtras && isMysticsGame && (
            <Link
              className={styles.backButton}
              to={dateParam ? `/g/${gameId}/rotations?d=${dateParam}` : `/g/${gameId}/rotations`}
            >
              Rotations
            </Link>
          )}
        </div>
        <div className={styles.backRowCenter}>
          {isAtc && (
            <button
              ref={lockButtonRef}
              type="button"
              className={`${styles.lockButton} ${isLocked ? styles.lockButtonLocked : ""}`}
              onMouseDown={startLockPress}
              onMouseUp={endLockPress}
              onMouseLeave={endLockPress}
              onTouchStart={startLockPress}
              onTouchEnd={endLockPress}
              onTouchCancel={endLockPress}
              aria-label={isLocked ? "Unlock page" : "Lock page"}
            >
              {lockIcon} Lock
            </button>
          )}
        </div>
        <div className={styles.backRowRight} />
      </div>
      <div className={styles.contentAlign}>
        <section className={styles.scoreboard}>
          <div className={`${styles.teamLogoColumn} ${styles.awayLogoColumn}`}>
            <img
              className={styles.teamLogo}
              src={teamLogoUrl(awayTeam.teamId)}
              alt={`${awayTeam.teamName} logo`}
            />
            {(timeouts || isPregame) && (
              <div className={styles.teamMetaRow}>
                {renderTimeouts(awayTimeoutsRemaining, isGLeagueGame, awayResetUsed)}
              </div>
          )}
          {(challenges || isPregame) && (
            <div className={styles.teamMetaRow}>
              {renderChallenges(awayChallenges)}
            </div>
          )}
          <div className={styles.teamMetaRow}>
            {renderFouls(awayFoulsDisplay)}
          </div>
        </div>

          <div className={`${styles.teamStatsColumn} ${styles.awayStatsColumn}`}>
          <div className={styles.teamTricode}>{awayTeam.teamTricode}</div>
          <div className={styles.teamScore}>{displayAwayScore}</div>
          {showExtras && (
            <>
              <div className={styles.statValue}>{ortgAway}</div>
              <div className={styles.statValue}>{netAway >= 0 ? "+" : ""}{netAway}</div>
            </>
          )}
          {showExtras && <div className={styles.statValue}>{formatChancesValue(displayAwayChances)}</div>}
          </div>

          <div className={styles.centerColumn}>
            <div className={styles.vs}>vs</div>
            <div className={styles.dash}>-</div>
          {showExtras && (
            <>
              <div className={styles.statLabel}>ORTG</div>
              <div className={styles.statLabel}>NET</div>
            </>
          )}
          {showExtras && <div className={styles.statLabel}>CHANCES</div>}
          {showExtras && (
            <div className={styles.paceGroup}>
              <div className={styles.paceRow}>PACE: {displayPaceValue.toFixed(1)}</div>
              <div className={styles.paceSubRow}>PACE/40: {displayPace40Value.toFixed(1)}</div>
            </div>
          )}
          <div className={`${styles.status} ${isLive ? styles.statusLive : ""}`}>
            {status || game.gameStatusText}
          </div>
          {clock && <div className={styles.clock}>{clock}</div>}
          {isAtc && (
            <div className={styles.possessionTable}>
              <div className={styles.possessionRow}>
                {["Q1", "Q2", "Q3", "Q4"].map((label) => (
                  <div key={label} className={styles.possessionCell}>{label}</div>
                ))}
              </div>
              <div className={`${styles.possessionRow} ${styles.possessionRowTeams}`}>
                {possessionTeams.map((team, index) => (
                  <div key={`possession-${index}`} className={styles.possessionCell}>
                    {team ? (
                      <img
                        className={styles.possessionLogo}
                        src={teamLogoUrl(team.teamId)}
                        alt={`${team.teamName} logo`}
                      />
                    ) : (
                      <div className={styles.possessionPlaceholder} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          </div>

          <div className={`${styles.teamStatsColumn} ${styles.homeStatsColumn}`}>
          <div className={styles.teamTricode}>{homeTeam.teamTricode}</div>
          <div className={styles.teamScore}>{displayHomeScore}</div>
          {showExtras && (
            <>
              <div className={styles.statValue}>{ortgHome}</div>
              <div className={styles.statValue}>{netHome >= 0 ? "+" : ""}{netHome}</div>
            </>
          )}
          {showExtras && <div className={styles.statValue}>{formatChancesValue(displayHomeChances)}</div>}
          </div>

          <div className={`${styles.teamLogoColumn} ${styles.homeLogoColumn}`}>
            <img
              className={styles.teamLogo}
              src={teamLogoUrl(homeTeam.teamId)}
              alt={`${homeTeam.teamName} logo`}
            />
            {(timeouts || isPregame) && (
              <div className={styles.teamMetaRow}>
                {renderTimeouts(homeTimeoutsRemaining, isGLeagueGame, homeResetUsed)}
              </div>
          )}
          {(challenges || isPregame) && (
            <div className={styles.teamMetaRow}>
              {renderChallenges(homeChallenges)}
            </div>
          )}
          <div className={styles.teamMetaRow}>
            {renderFouls(homeFoulsDisplay)}
          </div>
        </div>
      </section>

      {showExtras && (
        <>
          <div className={`${styles.navRow} ${styles.navRowTight}`} ref={statsNavRef}>
            <SegmentSelector value={segment} onChange={handleSegmentChange} />
            {!isLive && snapshotLabel ? <div className={styles.snapshotLabel}>{snapshotLabel}</div> : null}
            <Link to={dateParam ? `/m/${gameId}?d=${dateParam}` : `/m/${gameId}`}>Minutes</Link>
            <Link to={dateParam ? `/g/${gameId}/events?d=${dateParam}` : `/g/${gameId}/events`}>
              Play-by-Play
            </Link>
            <button type="button" className={styles.navButton} onClick={handleScrollToBoxScore}>
              Box Score
            </button>
            <Link to={`/draw?back=${encodeURIComponent(courtBackUrl)}&gameId=${encodeURIComponent(gameId || "")}`}>
              Court
            </Link>
            <button type="button" className={styles.navButton} onClick={openAddNote}>
              Add Note
            </button>
            <Link to={`/g/${gameId}/notes${notesParams}`}>
              View Notes
            </Link>
          </div>

          <div className={styles.pbpWheel} ref={pbpWheelRef} onScroll={clearHoldTimer}>
            <div className={styles.pbpWheelInner} ref={pbpWheelInnerRef}>
              {pbpWheelItems.length ? pbpWheelItems.map((action) => {
                const teamTricode = action.teamTricode || "";
                const teamLogo = action.teamId ? teamLogoUrl(action.teamId) : null;
                const teamAlt = action.teamId === awayTeam?.teamId
                  ? awayTeam.teamName
                  : action.teamId === homeTeam?.teamId
                    ? homeTeam.teamName
                    : "Team";
                const clockText = action.clock ? normalizeClock(action.clock) : "";
                const periodText = action.period ? `Q${action.period}` : "";
                const descriptor = cleanWheelDescriptor(describePlayByPlayAction(action) || action.actionType || "");
                const isHome = action.teamId && action.teamId === homeTeam?.teamId;
                const isTimeout = action.actionType === "timeout";
                const scoreText = action.scoreHome && action.scoreAway
                  ? `${action.scoreAway}-${action.scoreHome}`
                  : "";
                return (
                  <div
                    key={action.actionNumber || `${action.period}-${action.clock}-${descriptor}`}
                    className={`${styles.pbpCard} ${isHome ? styles.pbpCardHome : ""} ${isTimeout ? styles.pbpCardTimeout : ""}`}
                    onMouseDown={handleHoldStart(action)}
                    onMouseUp={handleHoldEnd}
                    onMouseLeave={handleHoldEnd}
                    onMouseMove={handleHoldMove}
                    onTouchStart={handleHoldStart(action)}
                    onTouchMove={handleHoldMove}
                    onTouchEnd={handleHoldEnd}
                    onTouchCancel={handleHoldEnd}
                  >
                    <div className={styles.pbpHeader}>
                      {teamLogo ? (
                        <img className={styles.pbpTeamLogo} src={teamLogo} alt={`${teamAlt} logo`} />
                      ) : (
                        <span className={styles.pbpTeam}>{teamTricode}</span>
                      )}
                      <span className={styles.pbpClock}>{clockText}</span>
                    </div>
                    <div className={styles.pbpBody}>
                      {action.personId ? (
                        <PlayerHeadshot
                          className={styles.pbpHeadshot}
                          personId={action.personId}
                          teamId={action.teamId}
                          alt=""
                          onLoad={() => {
                            const wheel = pbpWheelRef.current;
                            if (wheel) {
                              wheel.scrollLeft = Math.max(0, wheel.scrollWidth - wheel.clientWidth);
                            }
                          }}
                          fallback={<div className={styles.pbpHeadshotPlaceholder} />}
                        />
                      ) : (
                        <div className={styles.pbpHeadshotPlaceholder} />
                      )}
                      <span className={styles.pbpText}>{descriptor}</span>
                    </div>
                    <div className={styles.pbpFooter}>
                      <span>{periodText}</span>
                      <span className={styles.pbpScore}>{scoreText}</span>
                    </div>
                  </div>
                );
              }) : (
                <div className={styles.pbpEmpty}>No recent play-by-play yet.</div>
              )}
            </div>
          </div>

          {canUseMatchUps ? (
            <MatchUps
              gameId={gameId}
              awayTeam={awayTeam}
              homeTeam={homeTeam}
              boxScore={boxScore}
              minutesData={minutesData}
              awayRosterPlayers={awayRosterPlayers}
              homeRosterPlayers={homeRosterPlayers}
            />
          ) : null}

          <StatBars
            title="Four Factors"
            awayTeam={awayTeam}
            homeTeam={homeTeam}
            rows={fourFactorRows}
          />

          <StatBars
            title="Shot Profile"
            awayTeam={awayTeam}
            homeTeam={homeTeam}
            rows={shotProfileRows}
          />

          <StatBars
            title="Shot Efficiency"
            awayTeam={awayTeam}
            homeTeam={homeTeam}
            rows={shotEffRows}
          />

          <div className={styles.statsGrid}>
            <TransitionStats
              awayTeam={awayTeam}
              homeTeam={homeTeam}
              awayStats={awayTransition}
              homeStats={homeTransition}
            />

            <MiscStats
              awayTeam={awayTeam}
              homeTeam={homeTeam}
              awayStats={awayTransition}
              homeStats={homeTransition}
            />

            <CreatingDisruption
              awayTeam={awayTeam}
              homeTeam={homeTeam}
              awayStats={awayCreating}
              homeStats={homeCreating}
              awayDisruptions={awayDisruptions}
              homeDisruptions={homeDisruptions}
              awayKills={killStats.awayKills}
              homeKills={killStats.homeKills}
            />
          </div>

          <div className={styles.navRow} ref={boxScoreNavRef}>
            <SegmentSelector value={segment} onChange={handleSegmentChange} />
            <Link to={dateParam ? `/m/${gameId}?d=${dateParam}` : `/m/${gameId}`}>Minutes</Link>
            <Link to={dateParam ? `/g/${gameId}/events?d=${dateParam}` : `/g/${gameId}/events`}>
              Play-by-Play
            </Link>
            <button
              type="button"
              className={styles.navButton}
              onClick={handleScrollToAdvanced}
            >
              Advanced
            </button>
          </div>
        </>
      )}

      {noteModalOpen && (
        <div className={styles.noteOverlay} onClick={requestCancelNote}>
          <div
            className={`${styles.noteModal} ${styles.noteModalForm}`}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h3>{noteSourceAction ? "Add Note From Play" : "Add Note"}</h3>
            <div className={styles.noteTimeRow}>
              <div className={styles.noteTimeLabel}>Time left</div>
              <div className={styles.noteTimeControls}>
                <select
                  className={styles.noteSelect}
                  value={noteForm.period}
                  onChange={(event) =>
                    setNoteForm((prev) => ({ ...prev, period: event.target.value }))
                  }
                >
                  {NOTE_PERIOD_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <div className={styles.noteClockSelects}>
                  <select
                    className={styles.noteSelect}
                    value={noteForm.minutes}
                    onChange={(event) =>
                      setNoteForm((prev) => ({ ...prev, minutes: event.target.value }))
                    }
                  >
                    {noteMinuteOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <span className={styles.noteClockSeparator}>:</span>
                  <select
                    className={styles.noteSelect}
                    value={noteForm.seconds}
                    onChange={(event) =>
                      setNoteForm((prev) => ({ ...prev, seconds: event.target.value }))
                    }
                  >
                    {NOTE_SECOND_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <details className={styles.noteTags}>
              <summary>Tags</summary>
              <div className={styles.noteTagsGrid}>
                {NOTE_TAG_OPTIONS.map((tag) => {
                  const checked = noteForm.tags.includes(tag);
                  return (
                    <label key={tag} className={styles.noteTagOption}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const next = event.target.checked
                            ? [...noteForm.tags, tag]
                            : noteForm.tags.filter((value) => value !== tag);
                          setNoteForm((prev) => ({ ...prev, tags: next }));
                        }}
                      />
                      <span>{tag}</span>
                    </label>
                  );
                })}
              </div>
            </details>
            <textarea
              rows={4}
              placeholder={noteSourceAction ? "Add context for this play..." : "Type your note..."}
              value={noteForm.text}
              onChange={(event) =>
                setNoteForm((prev) => ({ ...prev, text: event.target.value }))
              }
            />
            <div className={styles.noteActions}>
              <button type="button" className={styles.noteCancel} onClick={requestCancelNote} disabled={savingNewNote}>
                Cancel
              </button>
              <button type="button" className={styles.noteSave} onClick={saveNewNote} disabled={savingNewNote}>
                {savingNewNote ? "Saving..." : "OK"}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className={styles.boxScoreSection}>
        <BoxScoreTable
          teamLabel={awayTeam.teamTricode}
          teamLogo={teamLogoUrl(awayTeam.teamId)}
          teamName={awayTeam.teamName}
          teamId={awayTeam.teamId}
          boxScore={{ players: awayPlayers, totals: awayTotals }}
          ratings={{ ortg: ortgAway, drtg: drtgAway }}
          currentPeriod={game.period}
          variant={variant}
          minuteCapsByPersonId={awayMinuteCapsByPersonId}
        />
        <BoxScoreTable
          teamLabel={homeTeam.teamTricode}
          teamLogo={teamLogoUrl(homeTeam.teamId)}
          teamName={homeTeam.teamName}
          teamId={homeTeam.teamId}
          boxScore={{ players: homePlayers, totals: homeTotals }}
          ratings={{ ortg: ortgHome, drtg: drtgHome }}
          currentPeriod={game.period}
          variant={variant}
          minuteCapsByPersonId={homeMinuteCapsByPersonId}
        />
      </section>
      <OfficialsExportPanel
        officials={officials}
        gameId={gameId}
        publishedOrder={publishedOfficialOrder}
        gameTimeLocal={game?.gameEt}
      />
      <Officials
        officials={officials}
        callsAgainst={callsAgainst}
        homeAbr={homeTeam.teamTricode}
        awayAbr={awayTeam.teamTricode}
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        publishedOrder={publishedOfficialOrder}
      />
      </div>
    </div>
  );
}
