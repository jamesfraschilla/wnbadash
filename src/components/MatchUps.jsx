import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { teamLogoUrl } from "../api.js";
import { MATCHUP_PLAYER_PROFILES } from "../data/matchupProfiles.js";
import { buildResolvedMatchupProfileMap, listMatchupProfiles } from "../matchupProfileData.js";
import rostersByTeamId from "../data/rosters.json";
import PlayerHeadshot from "./PlayerHeadshot.jsx";
import { readLocalStorage, writeLocalStorage } from "../storage.js";
import styles from "./MatchUps.module.css";

const MATCH_UP_STORAGE_PREFIX = "nba-dashboard:match-ups:";
const DRAG_ARM_MS_MOUSE = 20;
const DRAG_ARM_MS_TOUCH = 90;
const DOUBLE_ACTIVATE_MS_MOUSE = 360;
const PRESS_MOVE_TOLERANCE_PX_MOUSE = 8;
const PRESS_MOVE_TOLERANCE_PX_TOUCH = 16;
const SWAP_FLASH_MS = 180;
const ROW_SLOT_COUNT = 5;
const DRAG_TARGET_PADDING_PX = 22;
const PICKER_OPEN_GUARD_MS = 260;
const PICKER_HOLD_MS_TOUCH = 420;
const WIZARDS_TEAM_ID = "1610612764";
const CAPITAL_CITY_TEAM_ID = "1612709928";
const DRAW_STROKE_COLOR = "#f8fafc";
const DRAW_STROKE_WIDTH = 3;
const DRAW_COLORS = ["#f8fafc", "#facc15", "#ef4444", "#38bdf8", "#22c55e"];
const DRAW_SIZES = [3, 5, 8, 12];
const DEFAULT_POSITION_RANK = 3;

function isGLeagueTeamId(teamId) {
  const numericTeamId = Number(teamId);
  return numericTeamId >= 1612700000 && numericTeamId < 1612710000;
}

function isPriorityMatchupTeam(teamId) {
  const normalizedTeamId = String(teamId || "");
  return normalizedTeamId === WIZARDS_TEAM_ID || normalizedTeamId === CAPITAL_CITY_TEAM_ID;
}

function buildEmptyState() {
  return {
    collapsed: true,
    slots: {
      away: [],
      home: [],
    },
  };
}

function loadMatchUpState(gameId) {
  if (!gameId) return buildEmptyState();

  const raw = readLocalStorage(`${MATCH_UP_STORAGE_PREFIX}${gameId}`);
  if (!raw) return buildEmptyState();

  try {
    const parsed = JSON.parse(raw);
    const savedSlots = parsed?.slots || parsed?.orders || {};
    return {
      collapsed: true,
      slots: {
        away: Array.isArray(savedSlots?.away) ? savedSlots.away.map(String) : [],
        home: Array.isArray(savedSlots?.home) ? savedSlots.home.map(String) : [],
      },
    };
  } catch {
    return buildEmptyState();
  }
}

function saveMatchUpState(gameId, value) {
  if (!gameId) return;
  writeLocalStorage(`${MATCH_UP_STORAGE_PREFIX}${gameId}`, JSON.stringify(value));
}

function extractLastName(playerName = "") {
  const parts = String(playerName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return parts[parts.length - 1];
}

function extractFirstName(playerName = "") {
  const parts = String(playerName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || "";
  return parts.slice(0, -1).join(" ");
}

function formatPlayerNameCase(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function normalizePosition(value = "") {
  return String(value || "").trim().toUpperCase();
}

function parseHeightToInches(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value || "").trim();
  if (!text) return null;
  const match = text.match(/(\d+)\D+(\d+)/);
  if (!match) return null;
  const feet = Number.parseInt(match[1], 10);
  const inches = Number.parseInt(match[2], 10);
  if (!Number.isFinite(feet) || !Number.isFinite(inches)) return null;
  return feet * 12 + inches;
}

function buildStaticRosterPositionMap(teamId) {
  const players = Array.isArray(rostersByTeamId?.[String(teamId || "")])
    ? rostersByTeamId[String(teamId || "")]
    : [];

  return new Map(
    players
      .map((player) => [String(player?.personId || "").trim(), normalizePosition(player?.position)])
      .filter(([personId]) => personId)
  );
}

function getPositionRank(position) {
  const normalized = normalizePosition(position);
  if (normalized === "G") return 1;
  if (normalized === "G-F" || normalized === "F-G") return 2;
  if (normalized === "F") return 3;
  if (normalized === "F-C" || normalized === "C-F") return 4;
  if (normalized === "C") return 5;
  return DEFAULT_POSITION_RANK;
}

function getPositionGroup(position) {
  const rank = getPositionRank(position);
  if (rank <= 2) return "guard";
  if (rank === 3) return "wing";
  return "big";
}

function inferArchetypeFromPosition(position, heightIn = null) {
  const rank = getPositionRank(position);
  if (rank <= 1) {
    return heightIn != null && heightIn >= 75 ? "big_guard" : "small_guard";
  }
  if (rank === 2) {
    return heightIn != null && heightIn >= 79 ? "power_wing" : "wing";
  }
  if (rank === 3) {
    return heightIn != null && heightIn >= 80 ? "power_wing" : "wing";
  }
  if (rank === 4) {
    return heightIn != null && heightIn >= 82 ? "power_big" : "stretch_big";
  }
  return "center_big";
}

function inferOffensiveRoleFromArchetype(archetype) {
  if (archetype === "small_guard") return "combo_guard";
  if (archetype === "big_guard") return "combo_guard";
  if (archetype === "wing") return "wing_creator";
  if (archetype === "power_wing") return "power_wing";
  if (archetype === "stretch_big") return "stretch_big";
  if (archetype === "power_big") return "power_big";
  return "center_big";
}

function inferDefenderRoleFromArchetype(archetype) {
  if (archetype === "small_guard") return "small_guard";
  if (archetype === "big_guard") return "point_of_attack";
  if (archetype === "wing" || archetype === "power_wing") return "wing_stopper";
  return "big_anchor";
}

function resolveMatchupPlayerProfile(profileMap, personId) {
  const normalizedPersonId = String(personId || "").trim();
  return profileMap?.[normalizedPersonId] || MATCHUP_PLAYER_PROFILES[normalizedPersonId] || null;
}

function buildSmartSortKey(player, index, profileMap) {
  const profile = resolveMatchupPlayerProfile(profileMap, player?.personId);
  const heightIn = parseHeightToInches(player?.height) ?? profile?.heightIn ?? null;
  return {
    rank: getPositionRank(player?.position),
    archetype: profile?.archetype || inferArchetypeFromPosition(player?.position, heightIn),
    jersey: Number.parseInt(String(player?.jerseyNum || ""), 10),
    index,
  };
}

function sortLineupForMatchups(players, profileMap) {
  return [...players]
    .map((player, index) => ({ player, index, key: buildSmartSortKey(player, index, profileMap) }))
    .sort((a, b) => {
      if (a.key.rank !== b.key.rank) return a.key.rank - b.key.rank;
      const archetypeRank = {
        small_guard: 1,
        big_guard: 2,
        wing: 3,
        power_wing: 4,
        stretch_big: 5,
        power_big: 6,
        center_big: 7,
      };
      const aArchetypeRank = archetypeRank[a.key.archetype] ?? 99;
      const bArchetypeRank = archetypeRank[b.key.archetype] ?? 99;
      if (aArchetypeRank !== bArchetypeRank) return aArchetypeRank - bArchetypeRank;
      const aJersey = Number.isFinite(a.key.jersey) ? a.key.jersey : Number.POSITIVE_INFINITY;
      const bJersey = Number.isFinite(b.key.jersey) ? b.key.jersey : Number.POSITIVE_INFINITY;
      if (aJersey !== bJersey) return aJersey - bJersey;
      return a.index - b.index;
    })
    .map(({ player }) => player);
}

function scoreMatchup(defender, offensivePlayer, profileMap) {
  const defenderProfile = resolveMatchupPlayerProfile(profileMap, defender?.personId);
  const offensiveProfile = resolveMatchupPlayerProfile(profileMap, offensivePlayer?.personId);
  const defenderRank = getPositionRank(defender?.position);
  const offensiveRank = getPositionRank(offensivePlayer?.position);
  const rankGap = Math.abs(defenderRank - offensiveRank);
  const defenderHeight = parseHeightToInches(defender?.height) ?? defenderProfile?.heightIn ?? null;
  const offensiveHeight = parseHeightToInches(offensivePlayer?.height) ?? offensiveProfile?.heightIn ?? null;
  const defenderArchetype = defenderProfile?.archetype || inferArchetypeFromPosition(defender?.position, defenderHeight);
  const offensiveArchetype = offensiveProfile?.archetype || inferArchetypeFromPosition(offensivePlayer?.position, offensiveHeight);
  const defenderRole = defenderProfile?.defenderRole || inferDefenderRoleFromArchetype(defenderArchetype);
  const offensiveRole = offensiveProfile?.offensiveRole || inferOffensiveRoleFromArchetype(offensiveArchetype);

  let score = rankGap * 20;

  if (rankGap >= 3) score += 110;
  if (rankGap >= 4) score += 380;

  const defenderGroup = getPositionGroup(defender?.position);
  const offensiveGroup = getPositionGroup(offensivePlayer?.position);
  if (defenderGroup !== offensiveGroup) {
    score += 18;
  }

  if (defenderGroup === "guard" && offensiveGroup === "big") score += 200;
  if (defenderGroup === "big" && offensiveGroup === "guard") score += 110;

  if (defenderHeight != null && offensiveHeight != null) {
    const heightGap = Math.abs(defenderHeight - offensiveHeight);
    score += Math.max(0, heightGap - 1) * 12;
    if (defenderHeight + 5 <= offensiveHeight) score += 90;
    if (defenderHeight + 7 <= offensiveHeight) score += 180;
  }

  if (defenderArchetype === "small_guard" && (offensiveArchetype === "power_wing" || offensiveArchetype === "stretch_big" || offensiveArchetype === "power_big" || offensiveArchetype === "center_big")) {
    score += 220;
  }

  if (defenderArchetype === "big_guard" && offensiveArchetype === "power_wing") {
    score += 40;
  }

  if (defenderRole === "point_of_attack" && offensiveRole === "primary_ball_guard") {
    score -= 85;
  }
  if (defenderRole === "small_guard" && offensiveRole === "primary_ball_guard") {
    score -= 35;
  }
  if (defenderRole === "wing_stopper" && (offensiveRole === "wing_creator" || offensiveRole === "power_wing")) {
    score -= 55;
  }
  if (defenderRole === "big_anchor" && (offensiveRole === "stretch_big" || offensiveRole === "power_big" || offensiveRole === "center_big")) {
    score -= 60;
  }

  if (defenderProfile?.preferOffensiveRoles?.includes(offensiveRole)) {
    score -= 90;
  }
  if (defenderProfile?.avoidOffensiveRoles?.includes(offensiveRole)) {
    score += 180;
  }
  if (defenderProfile?.preferOpponentIds?.includes(String(offensivePlayer?.personId || ""))) {
    score -= 120;
  }
  if (defenderProfile?.avoidOpponentIds?.includes(String(offensivePlayer?.personId || ""))) {
    score += 260;
  }

  return score;
}

function buildLineupPermutations(players) {
  const permutations = [];
  const next = [...players];

  const walk = (startIndex) => {
    if (startIndex === next.length - 1) {
      permutations.push([...next]);
      return;
    }
    for (let index = startIndex; index < next.length; index += 1) {
      [next[startIndex], next[index]] = [next[index], next[startIndex]];
      walk(startIndex + 1);
      [next[startIndex], next[index]] = [next[index], next[startIndex]];
    }
  };

  if (!players.length) return permutations;
  walk(0);
  return permutations;
}

function chooseBestOpponentOrdering(anchorPlayers, opponentPlayers, profileMap) {
  const permutations = buildLineupPermutations(opponentPlayers);
  let bestPermutation = opponentPlayers;
  let bestScore = Number.POSITIVE_INFINITY;

  permutations.forEach((candidate) => {
    const score = anchorPlayers.reduce((total, defender, index) => {
      return total + scoreMatchup(defender, candidate[index], profileMap);
    }, 0);

    if (score < bestScore) {
      bestScore = score;
      bestPermutation = candidate;
    }
  });

  return bestPermutation;
}

function reorderRowToSlotIds(row, slotIds) {
  const used = new Set();
  const nextSlotIds = [];

  (slotIds || []).forEach((personId) => {
    const normalizedId = String(personId || "");
    if (!normalizedId || used.has(normalizedId) || !row.rosterMap.has(normalizedId)) return;
    used.add(normalizedId);
    nextSlotIds.push(normalizedId);
  });

  row.slotIds.forEach((personId) => {
    if (nextSlotIds.length >= ROW_SLOT_COUNT || used.has(personId) || !row.rosterMap.has(personId)) return;
    used.add(personId);
    nextSlotIds.push(personId);
  });

  return {
    ...row,
    slotIds: nextSlotIds,
    players: nextSlotIds.map((personId) => row.rosterMap.get(personId) || null),
  };
}

function buildSmartMatchupSlotIds(awayRow, homeRow, profileMap) {
  const awayPlayers = awayRow.players.filter(Boolean);
  const homePlayers = homeRow.players.filter(Boolean);
  if (awayPlayers.length !== ROW_SLOT_COUNT || homePlayers.length !== ROW_SLOT_COUNT) {
    return {
      away: awayRow.slotIds,
      home: homeRow.slotIds,
    };
  }

  const anchorSide = isPriorityMatchupTeam(awayRow.teamId)
    ? "away"
    : isPriorityMatchupTeam(homeRow.teamId)
      ? "home"
      : "away";
  const anchorRow = anchorSide === "away" ? awayRow : homeRow;
  const opponentRow = anchorSide === "away" ? homeRow : awayRow;

  const sortedAnchorPlayers = sortLineupForMatchups(anchorRow.players.filter(Boolean), profileMap);
  const sortedOpponentPlayers = chooseBestOpponentOrdering(sortedAnchorPlayers, opponentRow.players.filter(Boolean), profileMap);

  return anchorSide === "away"
    ? {
      away: sortedAnchorPlayers.map((player) => player.personId),
      home: sortedOpponentPlayers.map((player) => player.personId),
    }
    : {
      away: sortedOpponentPlayers.map((player) => player.personId),
      home: sortedAnchorPlayers.map((player) => player.personId),
    };
}

function buildCurrentStint(minutesData) {
  const periods = Array.isArray(minutesData?.periods) ? minutesData.periods : [];
  for (let periodIndex = periods.length - 1; periodIndex >= 0; periodIndex -= 1) {
    const stints = Array.isArray(periods[periodIndex]?.stints) ? periods[periodIndex].stints : [];
    if (stints.length) {
      return stints[stints.length - 1];
    }
  }
  return null;
}

function normalizeStintPlayers(players) {
  return [...(players || [])]
    .sort((a, b) => {
      const aPosition = Number(a?.rowPosition);
      const bPosition = Number(b?.rowPosition);
      if (Number.isFinite(aPosition) && Number.isFinite(bPosition) && aPosition !== bPosition) {
        return aPosition - bPosition;
      }
      return 0;
    })
    .slice(0, ROW_SLOT_COUNT);
}

function normalizeRosterPlayer(player, fallback = null, teamId = null, staticPositionMap = null, profileMap = null) {
  if (!player && !fallback) return null;
  const personId = String(player?.personId || fallback?.personId || "");
  if (!personId) return null;
  const profile = resolveMatchupPlayerProfile(profileMap, personId);

  const fullNameSource = String(
    player?.fullName ||
    player?.display ||
    player?.name ||
    fallback?.nameI ||
    fallback?.fullName ||
    fallback?.display ||
    fallback?.name ||
    ""
  ).trim();
  const firstName = String(player?.firstName || player?.givenName || "").trim() || extractFirstName(fullNameSource);
  const familyName = String(player?.familyName || player?.lastName || "").trim() || extractLastName(fullNameSource);
  return {
    personId,
    jerseyNum: String(player?.jerseyNum || fallback?.jerseyNum || "").trim(),
    firstName,
    lastName: familyName,
    fullName: [firstName, familyName].filter(Boolean).join(" ").trim(),
    displayName: formatPlayerNameCase(
      String(player?.display || player?.fullName || player?.name || fallback?.display || fallback?.fullName || fallback?.nameI || fallback?.name || "").trim()
    ),
    position: normalizePosition(
      player?.position ||
      player?.pos ||
      fallback?.position ||
      fallback?.pos ||
      staticPositionMap?.get(personId) ||
      ""
    ),
    height: String(
      player?.height ||
      player?.heightFeet ||
      fallback?.height ||
      fallback?.heightFeet ||
      profile?.heightIn ||
      ""
    ).trim(),
    teamId,
  };
}

function buildRosterPlayers(teamBoxPlayers, stintPlayers, extraRosterPlayers, teamId, profileMap) {
  const roster = [];
  const byId = new Map();
  const staticPositionMap = buildStaticRosterPositionMap(teamId);

  (teamBoxPlayers || []).forEach((player) => {
    const normalized = normalizeRosterPlayer(player, null, teamId, staticPositionMap, profileMap);
    if (!normalized || byId.has(normalized.personId)) return;
    byId.set(normalized.personId, normalized);
    roster.push(normalized);
  });

  normalizeStintPlayers(stintPlayers).forEach((player) => {
    const normalized = normalizeRosterPlayer(null, player, teamId, staticPositionMap, profileMap);
    if (!normalized || byId.has(normalized.personId)) return;
    byId.set(normalized.personId, normalized);
    roster.push(normalized);
  });

  (extraRosterPlayers || []).forEach((player) => {
    const normalized = normalizeRosterPlayer(player, null, teamId, staticPositionMap, profileMap);
    if (!normalized || byId.has(normalized.personId)) return;
    byId.set(normalized.personId, normalized);
    roster.push(normalized);
  });

  return roster;
}

function isStarterPlayer(player) {
  const rawStarter =
    player?.starter ??
    player?.isStarter ??
    player?.starterStatus ??
    player?.starterFlag ??
    null;

  if (rawStarter === true) return true;
  const normalized = String(rawStarter || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "y" || normalized === "yes";
}

function buildStarterSlotIds(teamBoxPlayers) {
  const starters = (teamBoxPlayers || [])
    .map((player, index) => ({ player, index }))
    .filter(({ player }) => isStarterPlayer(player))
    .sort((a, b) => {
      const aOrder = Number(a.player?.starterOrder ?? a.player?.starterPosition ?? a.index);
      const bOrder = Number(b.player?.starterOrder ?? b.player?.starterPosition ?? b.index);
      if (Number.isFinite(aOrder) && Number.isFinite(bOrder) && aOrder !== bOrder) {
        return aOrder - bOrder;
      }
      return a.index - b.index;
    })
    .map(({ player }) => String(player?.personId || ""))
    .filter(Boolean);

  return starters.slice(0, ROW_SLOT_COUNT);
}

function buildCurrentStintSlotIds(stintPlayers) {
  const slotIds = [];
  const used = new Set();

  normalizeStintPlayers(stintPlayers).forEach((player) => {
    const personId = String(player?.personId || "");
    if (!personId || used.has(personId)) return;
    used.add(personId);
    slotIds.push(personId);
  });

  return slotIds.slice(0, ROW_SLOT_COUNT);
}

function buildPreferredSlotIds(teamBoxPlayers, stintPlayers, roster) {
  const slotIds = [];
  const used = new Set();

  normalizeStintPlayers(stintPlayers).forEach((player) => {
    const personId = String(player?.personId || "");
    if (!personId || used.has(personId)) return;
    used.add(personId);
    slotIds.push(personId);
  });

  if (!slotIds.length) {
    buildStarterSlotIds(teamBoxPlayers).forEach((personId) => {
      if (used.has(personId)) return;
      used.add(personId);
      slotIds.push(personId);
    });
  }

  roster.forEach((player) => {
    if (slotIds.length >= ROW_SLOT_COUNT || used.has(player.personId)) return;
    used.add(player.personId);
    slotIds.push(player.personId);
  });

  return slotIds.slice(0, ROW_SLOT_COUNT);
}

function resolveSlotIds(savedSlotIds, defaultSlotIds, roster) {
  const rosterIds = roster.map((player) => player.personId);
  const rosterIdSet = new Set(rosterIds);
  const resolved = Array(ROW_SLOT_COUNT).fill(null);
  const used = new Set();

  for (let index = 0; index < ROW_SLOT_COUNT; index += 1) {
    const savedId = String(savedSlotIds?.[index] || "");
    if (!savedId || used.has(savedId) || !rosterIdSet.has(savedId)) continue;
    resolved[index] = savedId;
    used.add(savedId);
  }

  const fillPool = [...defaultSlotIds, ...rosterIds];
  let fillIndex = 0;

  for (let index = 0; index < ROW_SLOT_COUNT; index += 1) {
    if (resolved[index]) continue;
    while (fillIndex < fillPool.length) {
      const candidate = String(fillPool[fillIndex] || "");
      fillIndex += 1;
      if (!candidate || used.has(candidate) || !rosterIdSet.has(candidate)) continue;
      resolved[index] = candidate;
      used.add(candidate);
      break;
    }
  }

  return resolved.filter(Boolean).slice(0, ROW_SLOT_COUNT);
}

function buildTeamRow(teamBoxPlayers, stintPlayers, extraRosterPlayers, savedSlotIds, teamId, profileMap) {
  const roster = buildRosterPlayers(teamBoxPlayers, stintPlayers, extraRosterPlayers, teamId, profileMap);
  const rosterMap = new Map(roster.map((player) => [player.personId, player]));
  const currentStintSlotIds = buildCurrentStintSlotIds(stintPlayers).filter((personId) => rosterMap.has(personId));
  const preferredSlotIds = buildPreferredSlotIds(teamBoxPlayers, stintPlayers, roster);
  const slotIds = resolveSlotIds(savedSlotIds, preferredSlotIds, roster);
  return {
    roster,
    rosterMap,
    currentStintSlotIds,
    preferredSlotIds,
    slotIds,
    players: slotIds.map((personId) => rosterMap.get(personId) || null),
  };
}

function moveItem(items, fromIndex, toIndex) {
  if (fromIndex === toIndex) return items;
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return items;
  next.splice(toIndex, 0, moved);
  return next;
}

function swapItemPositions(items, fromIndex, toIndex) {
  if (fromIndex === toIndex) return items;
  const next = [...items];
  if (!next[fromIndex]) return items;
  if (!next[toIndex]) {
    return moveItem(items, fromIndex, toIndex);
  }
  [next[fromIndex], next[toIndex]] = [next[toIndex], next[fromIndex]];
  return next;
}

function swapOrReplace(items, index, personId) {
  const next = [...items];
  const existingIndex = next.findIndex((value) => value === personId);
  if (existingIndex >= 0) {
    [next[index], next[existingIndex]] = [next[existingIndex], next[index]];
    return next;
  }
  next[index] = personId;
  return next;
}

function sortRosterOptions(players) {
  return [...players].sort((a, b) => {
    const nameCompare = String(a?.lastName || "").localeCompare(String(b?.lastName || ""));
    if (nameCompare !== 0) return nameCompare;
    return String(a?.firstName || "").localeCompare(String(b?.firstName || ""));
  });
}

function refreshRowToCurrentLineup(currentSlotIds, currentStintSlotIds) {
  const currentLineupSet = new Set(currentStintSlotIds);
  const next = Array(ROW_SLOT_COUNT).fill(null);
  const used = new Set();

  (currentSlotIds || []).forEach((personId, index) => {
    if (!currentLineupSet.has(personId) || used.has(personId)) return;
    next[index] = personId;
    used.add(personId);
  });

  let currentLineupIndex = 0;
  for (let index = 0; index < ROW_SLOT_COUNT; index += 1) {
    if (next[index]) continue;
    while (currentLineupIndex < currentStintSlotIds.length) {
      const candidate = currentStintSlotIds[currentLineupIndex];
      currentLineupIndex += 1;
      if (!candidate || used.has(candidate)) continue;
      next[index] = candidate;
      used.add(candidate);
      break;
    }
  }

  return next.filter(Boolean);
}

function findSlotIndex(slots, clientX, clientY) {
  let matchedIndex = -1;
  let matchedDistance = Number.POSITIVE_INFINITY;

  slots.forEach((slot, index) => {
    if (!slot) return;
    const rect = slot.getBoundingClientRect();
    const withinBounds =
      clientX >= rect.left - DRAG_TARGET_PADDING_PX &&
      clientX <= rect.right + DRAG_TARGET_PADDING_PX &&
      clientY >= rect.top - DRAG_TARGET_PADDING_PX &&
      clientY <= rect.bottom + DRAG_TARGET_PADDING_PX;

    if (!withinBounds) return;

    const centerX = (rect.left + rect.right) / 2;
    const centerY = (rect.top + rect.bottom) / 2;
    const distance = Math.hypot(clientX - centerX, clientY - centerY);
    if (distance < matchedDistance) {
      matchedIndex = index;
      matchedDistance = distance;
    }
  });

  return matchedIndex;
}

function isTouchPointer(pointerType) {
  return pointerType === "touch" || pointerType === "pen";
}

function dragArmMsForPointer(pointerType) {
  return isTouchPointer(pointerType) ? DRAG_ARM_MS_TOUCH : DRAG_ARM_MS_MOUSE;
}

function moveToleranceForPointer(pointerType) {
  return isTouchPointer(pointerType) ? PRESS_MOVE_TOLERANCE_PX_TOUCH : PRESS_MOVE_TOLERANCE_PX_MOUSE;
}

function doubleActivateMsForPointer(pointerType) {
  return DOUBLE_ACTIVATE_MS_MOUSE;
}

function drawStrokeOnCanvas(context, stroke, width, height) {
  if (!context || !stroke?.points?.length) return;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.size;
  context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    const x = point.x * width;
    const y = point.y * height;
    context.beginPath();
    context.arc(x, y, Math.max(1, stroke.size / 2), 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.beginPath();
  stroke.points.forEach((point, index) => {
    const x = point.x * width;
    const y = point.y * height;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.stroke();
}

function MatchUpTile({ player, isDraggingSource, isTarget, isSwapAnimating, onPointerDown }) {
  const tileClassName = `${styles.tile} ${isTarget ? styles.tileTarget : ""} ${isSwapAnimating ? styles.tileSwap : ""}`.trim();
  const headshotStyle = player && isGLeagueTeamId(player.teamId)
    ? { mixBlendMode: "multiply" }
    : undefined;

  if (!player) {
    return (
      <div className={`${tileClassName} ${styles.tileEmpty}`.trim()}>
        <div className={styles.avatarFrame} />
        <div className={styles.playerMeta}>
          <div className={styles.playerName}>Open</div>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`${styles.tileButton} ${isDraggingSource ? styles.tileButtonDragging : ""}`}
      onPointerDown={onPointerDown}
      onContextMenu={(event) => event.preventDefault()}
      aria-label={`Adjust ${player.fullName || player.lastName || "player"}`}
    >
      <div className={tileClassName}>
        <div className={styles.avatarFrame}>
          <PlayerHeadshot
            className={styles.avatarImage}
            personId={player.personId}
            teamId={player.teamId}
            style={headshotStyle}
            alt=""
            draggable={false}
          />
        </div>
        <div className={styles.playerMeta}>
          <div className={styles.playerName}>{`${player.jerseyNum} ${player.lastName}`.trim()}</div>
        </div>
      </div>
    </button>
  );
}

function ExpandedTile({ player, teamLabel, isDraggingSource, isTarget, isSwapAnimating, onPointerDown }) {
  const tileClassName = `${styles.expandedTile} ${isTarget ? styles.expandedTileTarget : ""} ${isSwapAnimating ? styles.expandedTileSwap : ""}`.trim();

  if (!player) {
    return (
      <div className={`${tileClassName} ${styles.expandedTileEmpty}`.trim()}>
        <div className={styles.expandedAvatarFrame} />
        <div className={styles.expandedPlayerName}>Open</div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`${styles.expandedTileButton} ${isDraggingSource ? styles.tileButtonDragging : ""}`}
      onPointerDown={onPointerDown}
      onContextMenu={(event) => event.preventDefault()}
      aria-label={`Adjust ${teamLabel} ${player.fullName || player.lastName || "player"}`}
    >
      <div className={tileClassName}>
        <div className={styles.expandedAvatarFrame}>
          <PlayerHeadshot
            className={styles.expandedAvatarImage}
            personId={player.personId}
            teamId={player.teamId}
            alt=""
            draggable={false}
          />
        </div>
        <div className={styles.expandedPlayerName}>{`${player.jerseyNum} ${player.lastName}`.trim()}</div>
      </div>
    </button>
  );
}

function HeadshotPickerTile({ player, isActive, onClick }) {
  const displayLabel = String(
    player?.displayName ||
    player?.fullName ||
    [player?.firstName, player?.lastName].filter(Boolean).join(" ") ||
    player?.lastName ||
    ""
  ).trim();

  return (
    <button
      type="button"
      className={`${styles.pickerItem} ${isActive ? styles.pickerItemActive : ""}`.trim()}
      onClick={onClick}
    >
      <div className={styles.pickerAvatarFrame}>
        <PlayerHeadshot
          className={styles.pickerAvatarImage}
          personId={player.personId}
          teamId={player.teamId}
          style={isGLeagueTeamId(player.teamId) ? { mixBlendMode: "multiply" } : undefined}
          alt=""
          draggable={false}
        />
      </div>
      <div className={styles.pickerPlayerLabel}>{`${player.jerseyNum ? `#${player.jerseyNum} ` : ""}${formatPlayerNameCase(displayLabel)}`.trim()}</div>
    </button>
  );
}

function MagicWandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M4.2 19.8 11.5 12.5m0 0 1.7-1.7m-1.7 1.7-3.3-3.3m3.3 3.3 3.3 3.3m2.3-11.1 0 2.8m-1.4-1.4 2.8 0m1.6 4.3 0 2m-1-1 2 0M8 3.7l.5 1.5L10 5.7l-1.5.5L8 7.7l-.5-1.5L6 5.7l1.5-.5L8 3.7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function MatchUps({
  gameId,
  awayTeam,
  homeTeam,
  boxScore,
  minutesData,
  awayRosterPlayers = [],
  homeRosterPlayers = [],
}) {
  const [persistedState, setPersistedState] = useState(() => loadMatchUpState(gameId));
  const [dragState, setDragState] = useState(null);
  const [pickerState, setPickerState] = useState(null);
  const [refreshMenuOpen, setRefreshMenuOpen] = useState(false);
  const [expandedOpen, setExpandedOpen] = useState(false);
  const [expandedDrawMode, setExpandedDrawMode] = useState(false);
  const [expandedDrawTool, setExpandedDrawTool] = useState("pen");
  const [expandedDrawColor, setExpandedDrawColor] = useState(DRAW_STROKE_COLOR);
  const [expandedDrawSize, setExpandedDrawSize] = useState(DRAW_STROKE_WIDTH);
  const [expandedStrokeCount, setExpandedStrokeCount] = useState(0);
  const [swapFlash, setSwapFlash] = useState(null);
  const [isPortraitExpandedLayout, setIsPortraitExpandedLayout] = useState(() => (
    typeof window !== "undefined" ? window.matchMedia("(orientation: portrait)").matches : false
  ));
  const pressSessionRef = useRef(null);
  const lastActivateRef = useRef({
    side: null,
    index: -1,
    at: 0,
    pointerType: null,
    x: 0,
    y: 0,
  });
  const swapFlashTimeoutRef = useRef(null);
  const pickerHoldTimeoutRef = useRef(null);
  const dragStateRef = useRef(null);
  const pickerOpenedAtRef = useRef(0);
  const expandedOpenRef = useRef(false);
  const expandedDrawModeRef = useRef(false);
  const expandedCanvasRef = useRef(null);
  const expandedCanvasStageRef = useRef(null);
  const expandedDrawingRef = useRef(false);
  const expandedDrawingCurrentStrokeRef = useRef(null);
  const expandedDrawingStrokesRef = useRef([]);
  const expandedDrawingPointerIdRef = useRef(null);
  const expandedCanvasSizeRef = useRef({ width: 1, height: 1 });
  const isPortraitExpandedLayoutRef = useRef(isPortraitExpandedLayout);
  const rowSlotIdsRef = useRef({
    away: [],
    home: [],
  });
  const compactSlotRefs = useRef({
    away: [],
    home: [],
  });
  const expandedLandscapeSlotRefs = useRef({
    away: [],
    home: [],
  });
  const expandedPortraitSlotRefs = useRef({
    away: [],
    home: [],
  });
  const refreshMenuRef = useRef(null);
  const refreshButtonRef = useRef(null);

  useEffect(() => {
    setPersistedState(loadMatchUpState(gameId));
    setPickerState(null);
    setRefreshMenuOpen(false);
    setExpandedOpen(false);
    setExpandedDrawMode(false);
    setExpandedDrawTool("pen");
    setExpandedDrawColor(DRAW_STROKE_COLOR);
    setExpandedDrawSize(DRAW_STROKE_WIDTH);
    setExpandedStrokeCount(0);
    setDragState(null);
    expandedDrawingRef.current = false;
    expandedDrawingCurrentStrokeRef.current = null;
    expandedDrawingStrokesRef.current = [];
    expandedDrawingPointerIdRef.current = null;
  }, [gameId]);

  useEffect(() => {
    saveMatchUpState(gameId, persistedState);
  }, [gameId, persistedState]);

  const { data: remoteMatchupProfiles = [] } = useQuery({
    queryKey: ["matchup-player-profiles"],
    queryFn: () => listMatchupProfiles("wnba"),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const matchupProfileMap = useMemo(
    () => buildResolvedMatchupProfileMap(remoteMatchupProfiles),
    [remoteMatchupProfiles]
  );

  const currentStint = useMemo(() => buildCurrentStint(minutesData), [minutesData]);

  const awayRow = useMemo(
    () => buildTeamRow(
      boxScore?.away?.players,
      currentStint?.playersAway,
      awayRosterPlayers,
      persistedState.slots.away,
      awayTeam?.teamId,
      matchupProfileMap
    ),
    [awayRosterPlayers, awayTeam?.teamId, boxScore?.away?.players, currentStint?.playersAway, matchupProfileMap, persistedState.slots.away]
  );

  const homeRow = useMemo(
    () => buildTeamRow(
      boxScore?.home?.players,
      currentStint?.playersHome,
      homeRosterPlayers,
      persistedState.slots.home,
      homeTeam?.teamId,
      matchupProfileMap
    ),
    [boxScore?.home?.players, currentStint?.playersHome, homeRosterPlayers, homeTeam?.teamId, matchupProfileMap, persistedState.slots.home]
  );

  const clearPressSession = () => {
    if (pickerHoldTimeoutRef.current) {
      clearTimeout(pickerHoldTimeoutRef.current);
      pickerHoldTimeoutRef.current = null;
    }
    const activeSession = pressSessionRef.current;
    if (activeSession?.target?.hasPointerCapture?.(activeSession.pointerId)) {
      activeSession.target.releasePointerCapture(activeSession.pointerId);
    }
    pressSessionRef.current = null;
  };

  const updateRowSlots = (side, nextSlotIds) => {
    setPersistedState((current) => ({
      ...current,
      slots: {
        ...current.slots,
        [side]: nextSlotIds,
      },
    }));
  };

  const triggerSwapFlash = (side, fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;

    if (swapFlashTimeoutRef.current) {
      clearTimeout(swapFlashTimeoutRef.current);
    }

    setSwapFlash({
      side,
      indexes: [fromIndex, toIndex],
    });

    swapFlashTimeoutRef.current = setTimeout(() => {
      setSwapFlash(null);
      swapFlashTimeoutRef.current = null;
    }, SWAP_FLASH_MS);
  };

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  useEffect(() => {
    expandedOpenRef.current = expandedOpen;
  }, [expandedOpen]);

  useEffect(() => {
    expandedDrawModeRef.current = expandedDrawMode;
  }, [expandedDrawMode]);

  useEffect(() => {
    if (!expandedOpen) {
      setExpandedDrawMode(false);
    }
  }, [expandedOpen]);

  useEffect(() => {
    if (!expandedOpen || typeof window === "undefined") return undefined;

    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyWidth = document.body.style.width;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;
    const scrollY = window.scrollY;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    document.body.style.overscrollBehavior = "none";

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.width = previousBodyWidth;
      document.body.style.overscrollBehavior = previousBodyOverscroll;
      window.scrollTo(0, scrollY);
    };
  }, [expandedOpen]);

  useEffect(() => {
    isPortraitExpandedLayoutRef.current = isPortraitExpandedLayout;
  }, [isPortraitExpandedLayout]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;

    const mediaQuery = window.matchMedia("(orientation: portrait)");
    const updateLayout = () => setIsPortraitExpandedLayout(mediaQuery.matches);
    updateLayout();

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", updateLayout);
      return () => mediaQuery.removeEventListener("change", updateLayout);
    }

    mediaQuery.addListener(updateLayout);
    return () => mediaQuery.removeListener(updateLayout);
  }, []);

  const redrawExpandedCanvas = () => {
    const canvas = expandedCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const { width, height } = expandedCanvasSizeRef.current;
    context.clearRect(0, 0, width, height);
    expandedDrawingStrokesRef.current.forEach((stroke) => {
      drawStrokeOnCanvas(context, stroke, width, height);
    });
  };

  const resizeExpandedCanvas = () => {
    const canvas = expandedCanvasRef.current;
    const stage = expandedCanvasStageRef.current;
    if (!canvas || !stage || typeof window === "undefined") return;
    const rect = stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const ratio = window.devicePixelRatio || 1;
    expandedCanvasSizeRef.current = { width, height };
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    redrawExpandedCanvas();
  };

  useEffect(() => {
    if (!expandedOpen) return undefined;
    resizeExpandedCanvas();
    const stage = expandedCanvasStageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      resizeExpandedCanvas();
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [expandedOpen, isPortraitExpandedLayout]);

  const clearExpandedDrawing = () => {
    expandedDrawingRef.current = false;
    expandedDrawingCurrentStrokeRef.current = null;
    expandedDrawingStrokesRef.current = [];
    expandedDrawingPointerIdRef.current = null;
    setExpandedStrokeCount(0);
    redrawExpandedCanvas();
  };

  const undoExpandedDrawing = () => {
    if (!expandedDrawingStrokesRef.current.length) return;
    expandedDrawingRef.current = false;
    expandedDrawingCurrentStrokeRef.current = null;
    expandedDrawingStrokesRef.current = expandedDrawingStrokesRef.current.slice(0, -1);
    expandedDrawingPointerIdRef.current = null;
    setExpandedStrokeCount(expandedDrawingStrokesRef.current.length);
    redrawExpandedCanvas();
  };

  const finishExpandedStroke = () => {
    if (!expandedDrawingRef.current) return;
    expandedDrawingRef.current = false;
    expandedDrawingCurrentStrokeRef.current = null;
    expandedDrawingPointerIdRef.current = null;
  };

  const getExpandedCanvasPoint = (event) => {
    const canvas = expandedCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const getExpandedCanvasPointFromClient = (clientX, clientY) => {
    const canvas = expandedCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const normalizeExpandedCanvasPoint = (point) => {
    const { width, height } = expandedCanvasSizeRef.current;
    if (!width || !height) return { x: 0, y: 0 };
    return {
      x: point.x / width,
      y: point.y / height,
    };
  };

  const startExpandedStrokeAt = (point, pointerId = null) => {
    if (!point) return;
    finishExpandedStroke();
    const stroke = {
      color: expandedDrawTool === "eraser" ? "#000000" : expandedDrawColor,
      size: expandedDrawSize,
      tool: expandedDrawTool,
      points: [normalizeExpandedCanvasPoint(point)],
    };
    expandedDrawingRef.current = true;
    expandedDrawingCurrentStrokeRef.current = stroke;
    expandedDrawingStrokesRef.current = [...expandedDrawingStrokesRef.current, stroke];
    expandedDrawingPointerIdRef.current = pointerId;
    setExpandedStrokeCount(expandedDrawingStrokesRef.current.length);
    redrawExpandedCanvas();
  };

  const extendExpandedStrokeAt = (point) => {
    const stroke = expandedDrawingCurrentStrokeRef.current;
    if (!point || !stroke) return;
    stroke.points.push(normalizeExpandedCanvasPoint(point));
    redrawExpandedCanvas();
  };

  const endExpandedStrokeAt = (point) => {
    const stroke = expandedDrawingCurrentStrokeRef.current;
    if (point && stroke) {
      const normalizedPoint = normalizeExpandedCanvasPoint(point);
      const lastPoint = stroke.points[stroke.points.length - 1];
      if (!lastPoint || lastPoint.x !== normalizedPoint.x || lastPoint.y !== normalizedPoint.y) {
        stroke.points.push(normalizedPoint);
        redrawExpandedCanvas();
      }
    }
    finishExpandedStroke();
  };

  const handleExpandedCanvasPointerDown = (event) => {
    if (!expandedDrawModeRef.current) return;
    if (event.pointerType === "touch") return;
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    event.stopPropagation();
    startExpandedStrokeAt(getExpandedCanvasPoint(event), event.pointerId);
  };

  const handleExpandedCanvasPointerMove = (event) => {
    if (!expandedDrawModeRef.current || !expandedDrawingRef.current) return;
    if (event.pointerType === "touch") return;
    if (expandedDrawingPointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    extendExpandedStrokeAt(getExpandedCanvasPoint(event));
  };

  const handleExpandedCanvasPointerUp = (event) => {
    if (!expandedDrawModeRef.current || !expandedDrawingRef.current) return;
    if (event.pointerType === "touch") return;
    if (expandedDrawingPointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    endExpandedStrokeAt(getExpandedCanvasPoint(event));
  };

  const handleExpandedCanvasTouchStart = (event) => {
    if (!expandedDrawModeRef.current) return;
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    event.preventDefault();
    event.stopPropagation();
    startExpandedStrokeAt(getExpandedCanvasPointFromClient(touch.clientX, touch.clientY), "touch");
  };

  const handleExpandedCanvasTouchMove = (event) => {
    if (!expandedDrawModeRef.current || !expandedDrawingRef.current) return;
    if (expandedDrawingPointerIdRef.current !== "touch") return;
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    event.preventDefault();
    event.stopPropagation();
    extendExpandedStrokeAt(getExpandedCanvasPointFromClient(touch.clientX, touch.clientY));
  };

  const handleExpandedCanvasTouchEnd = (event) => {
    if (!expandedDrawModeRef.current || !expandedDrawingRef.current) return;
    if (expandedDrawingPointerIdRef.current !== "touch") return;
    const touch = event.changedTouches?.[0];
    event.preventDefault();
    event.stopPropagation();
    endExpandedStrokeAt(touch ? getExpandedCanvasPointFromClient(touch.clientX, touch.clientY) : null);
  };

  useEffect(() => {
    const handlePointerMove = (event) => {
      const pressSession = pressSessionRef.current;
      const activeDrag = dragStateRef.current;

      if (pressSession && !activeDrag && event.pointerId === pressSession.pointerId) {
        const deltaX = event.clientX - pressSession.startX;
        const deltaY = event.clientY - pressSession.startY;
        if (Math.hypot(deltaX, deltaY) <= moveToleranceForPointer(pressSession.pointerType)) return;

        if ((Date.now() - pressSession.startedAt) < dragArmMsForPointer(pressSession.pointerType)) {
          return;
        }

        clearPressSession();
        lastActivateRef.current = { side: null, index: -1, at: 0, pointerType: null, x: 0, y: 0 };
        const nextDragState = {
          side: pressSession.side,
          fromIndex: pressSession.index,
          overIndex: pressSession.index,
          pointerId: pressSession.pointerId,
          pointerX: event.clientX,
          pointerY: event.clientY,
          offsetX: pressSession.offsetX,
          offsetY: pressSession.offsetY,
          width: pressSession.width,
          player: pressSession.player,
        };
        dragStateRef.current = nextDragState;
        setDragState(nextDragState);
        return;
      }

      if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;

      event.preventDefault();
      const slots = expandedOpenRef.current
        ? (
          isPortraitExpandedLayoutRef.current
            ? expandedPortraitSlotRefs.current[activeDrag.side]
            : expandedLandscapeSlotRefs.current[activeDrag.side]
        )
        : compactSlotRefs.current[activeDrag.side];
      const nextOverIndex = findSlotIndex(slots, event.clientX, event.clientY);
      const nextDragState = {
        ...activeDrag,
        pointerX: event.clientX,
        pointerY: event.clientY,
        overIndex: nextOverIndex >= 0 ? nextOverIndex : activeDrag.overIndex,
      };
      dragStateRef.current = nextDragState;
      setDragState(nextDragState);
    };

    const handlePointerUp = (event) => {
      const activeDrag = dragStateRef.current;
      const pressSession = pressSessionRef.current;

      if (activeDrag && event.pointerId === activeDrag.pointerId) {
        const slotIds = rowSlotIdsRef.current[activeDrag.side] || [];
        updateRowSlots(activeDrag.side, swapItemPositions(slotIds, activeDrag.fromIndex, activeDrag.overIndex));
        triggerSwapFlash(activeDrag.side, activeDrag.fromIndex, activeDrag.overIndex);
        lastActivateRef.current = { side: null, index: -1, at: 0, pointerType: null, x: 0, y: 0 };
        dragStateRef.current = null;
        setDragState(null);
      }

      if (pressSession && event.pointerId === pressSession.pointerId) {
        if (!activeDrag && !isTouchPointer(pressSession.pointerType)) {
          handlePointerActivate(pressSession);
        }
        clearPressSession();
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, []);

  useEffect(() => {
    const handlePointerDownOutside = (event) => {
      if (pickerState && (Date.now() - pickerOpenedAtRef.current) < PICKER_OPEN_GUARD_MS) {
        return;
      }
      if (pickerState && !event.target?.closest?.(`.${styles.pickerDialog}`)) {
        setPickerState(null);
      }
      if (!refreshMenuRef.current?.contains(event.target) && !refreshButtonRef.current?.contains(event.target)) {
        setRefreshMenuOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setPickerState(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDownOutside);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDownOutside);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [pickerState]);

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setExpandedOpen(false);
        setPickerState(null);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    if (!dragState) return undefined;

    const previousBodyUserSelect = document.body.style.userSelect;
    const previousBodyCursor = document.body.style.cursor;
    const previousTouchAction = document.documentElement.style.touchAction;

    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    document.documentElement.style.touchAction = "none";

    return () => {
      document.body.style.userSelect = previousBodyUserSelect;
      document.body.style.cursor = previousBodyCursor;
      document.documentElement.style.touchAction = previousTouchAction;
    };
  }, [dragState]);

  useEffect(() => () => {
    clearPressSession();
    if (swapFlashTimeoutRef.current) {
      clearTimeout(swapFlashTimeoutRef.current);
    }
  }, []);

  const openHeadshotPicker = (session) => {
    pickerOpenedAtRef.current = Date.now();
    setPickerState({
      side: session.side,
      index: session.index,
    });
  };

  const handlePointerActivate = (session) => {
    const now = Date.now();
    const previous = lastActivateRef.current;
    const doubleActivateMs = doubleActivateMsForPointer(session.pointerType);
    if (
      previous.side === session.side &&
      previous.index === session.index &&
      previous.pointerType === session.pointerType &&
      now - previous.at <= doubleActivateMs
    ) {
      lastActivateRef.current = { side: null, index: -1, at: 0, pointerType: null, x: 0, y: 0 };
      setRefreshMenuOpen(false);
      openHeadshotPicker(session);
      return;
    }

    lastActivateRef.current = {
      side: session.side,
      index: session.index,
      at: now,
      pointerType: session.pointerType,
      x: session.startX || 0,
      y: session.startY || 0,
    };
  };

  const handlePointerDown = (side, index, event) => {
    if (expandedOpenRef.current && expandedDrawModeRef.current) return;
    if (event.button != null && event.button !== 0) return;
    const row = rowsByKey.get(side) || (side === "away" ? awayRow : homeRow);
    const player = row.players[index];
    if (!player) return;

    event.preventDefault();
    setPickerState(null);
    setRefreshMenuOpen(false);
    clearPressSession();

    const rect = event.currentTarget.getBoundingClientRect();
    const pointerId = event.pointerId;
    const pointerType = event.pointerType || "mouse";
    const session = {
      side,
      index,
      player,
      pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: Date.now(),
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      rect,
      target: event.currentTarget,
      pointerType,
    };

    if (event.currentTarget?.setPointerCapture) {
      event.currentTarget.setPointerCapture(pointerId);
    }

    pressSessionRef.current = session;

    if (isTouchPointer(pointerType)) {
      pickerHoldTimeoutRef.current = setTimeout(() => {
        const activeSession = pressSessionRef.current;
        if (!activeSession || activeSession.pointerId !== pointerId || dragStateRef.current) return;
        clearPressSession();
        setRefreshMenuOpen(false);
        openHeadshotPicker(session);
      }, PICKER_HOLD_MS_TOUCH);
    }
  };

  const handlePickerSelect = (side, index, personId) => {
    const row = rowsByKey.get(side) || (side === "away" ? awayRow : homeRow);
    if (!row.rosterMap.has(personId)) return;
    updateRowSlots(side, swapOrReplace(row.slotIds, index, personId));
    setPickerState(null);
  };

  const toggleRefreshMenu = () => {
    setPickerState(null);
    setRefreshMenuOpen((current) => !current);
  };

  const openExpandedView = () => {
    setPickerState(null);
    setRefreshMenuOpen(false);
    setExpandedOpen(true);
  };

  const handleRefreshRow = (side) => {
    const row = rowsByKey.get(side) || (side === "away" ? awayRow : homeRow);
    if (!row.currentStintSlotIds.length) {
      setRefreshMenuOpen(false);
      return;
    }
    updateRowSlots(
      side,
      refreshRowToCurrentLineup(row.slotIds, row.currentStintSlotIds)
    );
    setRefreshMenuOpen(false);
  };

  const handleRefreshAll = () => {
    const nextAwayRow = awayRow.currentStintSlotIds.length
      ? reorderRowToSlotIds(awayRow, awayRow.currentStintSlotIds)
      : awayRow;
    const nextHomeRow = homeRow.currentStintSlotIds.length
      ? reorderRowToSlotIds(homeRow, homeRow.currentStintSlotIds)
      : homeRow;
    const smartSlotIds = buildSmartMatchupSlotIds(nextAwayRow, nextHomeRow, matchupProfileMap);

    setPersistedState((current) => ({
      ...current,
      slots: {
        ...current.slots,
        away: awayRow.currentStintSlotIds.length ? smartSlotIds.away : current.slots.away,
        home: homeRow.currentStintSlotIds.length ? smartSlotIds.home : current.slots.home,
      },
    }));
    setRefreshMenuOpen(false);
  };

  const handleSmartReorder = () => {
    setPickerState(null);
    setRefreshMenuOpen(false);
    const smartSlotIds = buildSmartMatchupSlotIds(renderedAwayRow, renderedHomeRow, matchupProfileMap);
    setPersistedState((current) => ({
      ...current,
      slots: {
        ...current.slots,
        away: smartSlotIds.away,
        home: smartSlotIds.home,
      },
    }));
  };

  const updateCollapsed = () => {
    setPickerState(null);
    setRefreshMenuOpen(false);
    setExpandedOpen(false);
    setPersistedState((current) => ({
      ...current,
      collapsed: !current.collapsed,
    }));
  };

  const smartDefaultSlotIds = useMemo(() => {
    if (persistedState.slots.away.length || persistedState.slots.home.length) return null;
    return buildSmartMatchupSlotIds(awayRow, homeRow, matchupProfileMap);
  }, [awayRow, homeRow, matchupProfileMap, persistedState.slots.away.length, persistedState.slots.home.length]);

  const renderedAwayRow = useMemo(
    () => smartDefaultSlotIds?.away ? reorderRowToSlotIds(awayRow, smartDefaultSlotIds.away) : awayRow,
    [awayRow, smartDefaultSlotIds]
  );

  const renderedHomeRow = useMemo(
    () => smartDefaultSlotIds?.home ? reorderRowToSlotIds(homeRow, smartDefaultSlotIds.home) : homeRow,
    [homeRow, smartDefaultSlotIds]
  );

  const rows = [
    {
      key: "away",
      label: awayTeam?.teamTricode || "Away",
      teamName: awayTeam?.teamName || "Visiting Team",
      teamId: awayTeam?.teamId,
      roster: renderedAwayRow.roster,
      rosterMap: renderedAwayRow.rosterMap,
      currentStintSlotIds: renderedAwayRow.currentStintSlotIds,
      slotIds: renderedAwayRow.slotIds,
      preferredSlotIds: renderedAwayRow.preferredSlotIds,
      players: renderedAwayRow.players,
    },
    {
      key: "home",
      label: homeTeam?.teamTricode || "Home",
      teamName: homeTeam?.teamName || "Home Team",
      teamId: homeTeam?.teamId,
      roster: renderedHomeRow.roster,
      rosterMap: renderedHomeRow.rosterMap,
      currentStintSlotIds: renderedHomeRow.currentStintSlotIds,
      slotIds: renderedHomeRow.slotIds,
      preferredSlotIds: renderedHomeRow.preferredSlotIds,
      players: renderedHomeRow.players,
    },
  ].sort((a, b) => {
    const aPriority = isPriorityMatchupTeam(a.teamId);
    const bPriority = isPriorityMatchupTeam(b.teamId);
    if (aPriority === bPriority) return 0;
    return aPriority ? -1 : 1;
  });

  const rowsByKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows]);

  useEffect(() => {
    rowSlotIdsRef.current = {
      away: rowsByKey.get("away")?.slotIds || [],
      home: rowsByKey.get("home")?.slotIds || [],
    };
  }, [rowsByKey]);

  const hasLineups = awayRow.players.length || homeRow.players.length;
  const pickerRow = pickerState?.side ? rows.find((row) => row.key === pickerState.side) || null : null;
  const pickerOptions = pickerRow ? sortRosterOptions(pickerRow.roster) : [];
  const pickerSelectedPersonId = pickerRow && Number.isInteger(pickerState?.index)
    ? pickerRow.slotIds[pickerState.index] || ""
    : "";

  return (
    <section className={styles.container} aria-label="Match-Ups">
      <button
        type="button"
        className={styles.toggleButton}
        onClick={updateCollapsed}
        aria-expanded={!persistedState.collapsed}
      >
        <span className={styles.toggleLabel}>Match-Ups</span>
        <span className={styles.toggleIcon} aria-hidden="true">{persistedState.collapsed ? "+" : "−"}</span>
      </button>

      {persistedState.collapsed ? null : (
        <div className={styles.body}>
          {hasLineups ? rows.map((row, rowIndex) => {
            const logoUrl = row.teamId ? teamLogoUrl(row.teamId) : "";
            return (
              <div key={row.key} className={styles.row}>
                <div className={styles.rowLabel}>
                  {logoUrl ? <img className={styles.teamLogo} src={logoUrl} alt="" /> : null}
                  <div>
                    <div className={styles.teamCode}>{row.label}</div>
                    <div className={styles.teamName}>{row.teamName}</div>
                  </div>
                  {rowIndex === 0 ? (
                    <div className={styles.headerActions}>
                      <button
                        type="button"
                        className={styles.expandButton}
                        onClick={openExpandedView}
                      >
                        Expand
                      </button>
                      <button
                        ref={refreshButtonRef}
                        type="button"
                        className={styles.refreshButton}
                        onClick={toggleRefreshMenu}
                      >
                        Refresh
                      </button>
                      <button
                        type="button"
                        className={styles.magicButton}
                        onClick={handleSmartReorder}
                        aria-label="Smart reorder matchups"
                        title="Smart reorder matchups"
                      >
                        <MagicWandIcon />
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className={styles.rowScroller}>
                  <div className={styles.slotGrid}>
                    {Array.from({ length: ROW_SLOT_COUNT }, (_, index) => {
                      const player = row.players[index] || null;
                      const isSource = dragState?.side === row.key && dragState?.fromIndex === index;
                      const isTarget = dragState?.side === row.key && dragState?.overIndex === index;
                      const isSwapAnimating = swapFlash?.side === row.key && swapFlash.indexes.includes(index);
                      return (
                        <div
                          key={`${row.key}-${player?.personId || `slot-${index}`}`}
                          ref={(node) => {
                            compactSlotRefs.current[row.key][index] = node;
                          }}
                          className={`${styles.slot} ${isTarget ? styles.slotTarget : ""}`}
                        >
                          <MatchUpTile
                            player={player}
                            isDraggingSource={isSource}
                            isTarget={isTarget}
                            isSwapAnimating={isSwapAnimating}
                            onPointerDown={(event) => handlePointerDown(row.key, index, event)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          }) : (
            <div className={styles.emptyState}>Current lineups are not available yet.</div>
          )}
        </div>
      )}

      {expandedOpen ? (
        <div className={styles.expandedOverlay}>
          <div className={styles.expandedView}>
            <div className={styles.expandedTopBar}>
              <button
                type="button"
                className={styles.closeButton}
                onClick={() => setExpandedOpen(false)}
              >
                Close
              </button>
              <div className={styles.expandedTopActions}>
                <button
                  type="button"
                  className={`${styles.drawToggleButton} ${expandedDrawMode ? styles.drawToggleButtonActive : ""}`.trim()}
                  onClick={() => {
                    setPickerState(null);
                    setExpandedDrawMode((current) => !current);
                  }}
                >
                  {expandedDrawMode ? "Done" : "Pen"}
                </button>
                <button
                  type="button"
                  className={styles.drawToggleButton}
                  onClick={clearExpandedDrawing}
                  disabled={!expandedStrokeCount}
                >
                  Clear
                </button>
              </div>
            </div>

            {expandedDrawMode ? (
              <div className={styles.drawToolbar}>
                <div className={styles.drawToolbarGroup}>
                  <button
                    type="button"
                    className={`${styles.drawToolbarButton} ${expandedDrawTool === "pen" ? styles.drawToolbarButtonActive : ""}`.trim()}
                    onClick={() => setExpandedDrawTool("pen")}
                  >
                    Pen
                  </button>
                  <button
                    type="button"
                    className={`${styles.drawToolbarButton} ${expandedDrawTool === "eraser" ? styles.drawToolbarButtonActive : ""}`.trim()}
                    onClick={() => setExpandedDrawTool("eraser")}
                  >
                    Eraser
                  </button>
                  <button
                    type="button"
                    className={styles.drawToolbarButton}
                    onClick={undoExpandedDrawing}
                    disabled={!expandedStrokeCount}
                  >
                    Undo
                  </button>
                </div>

                <div className={styles.drawToolbarGroup}>
                  <span className={styles.drawToolbarLabel}>Color</span>
                  {DRAW_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`${styles.drawColorButton} ${expandedDrawColor === color ? styles.drawColorButtonActive : ""}`.trim()}
                      style={{ backgroundColor: color }}
                      onClick={() => {
                        setExpandedDrawTool("pen");
                        setExpandedDrawColor(color);
                      }}
                      aria-label={`Use ${color} pen`}
                    />
                  ))}
                </div>

                <div className={styles.drawToolbarGroup}>
                  <span className={styles.drawToolbarLabel}>Size</span>
                  {DRAW_SIZES.map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={`${styles.drawSizeButton} ${expandedDrawSize === size ? styles.drawSizeButtonActive : ""}`.trim()}
                      onClick={() => setExpandedDrawSize(size)}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div ref={expandedCanvasStageRef} className={styles.expandedContent}>
              <div className={styles.expandedLandscape}>
                {rows.map((row) => {
                  const logoUrl = row.teamId ? teamLogoUrl(row.teamId) : "";
                  return (
                    <div key={`expanded-${row.key}`} className={styles.expandedRow}>
                      <div className={styles.expandedRowHeader}>
                        {logoUrl ? <img className={styles.expandedTeamLogo} src={logoUrl} alt="" /> : null}
                        <div>
                          <div className={styles.expandedTeamCode}>{row.label}</div>
                          <div className={styles.expandedTeamName}>{row.teamName}</div>
                        </div>
                      </div>
                      <div className={styles.expandedSlotGrid}>
                        {Array.from({ length: ROW_SLOT_COUNT }, (_, index) => {
                          const player = row.players[index] || null;
                          const isSource = dragState?.side === row.key && dragState?.fromIndex === index;
                          const isTarget = dragState?.side === row.key && dragState?.overIndex === index;
                          const isSwapAnimating = swapFlash?.side === row.key && swapFlash.indexes.includes(index);
                          return (
                            <div
                              key={`expanded-${row.key}-${player?.personId || `slot-${index}`}`}
                              ref={(node) => {
                                expandedLandscapeSlotRefs.current[row.key][index] = node;
                              }}
                            >
                              <ExpandedTile
                                player={player}
                                teamLabel={row.label}
                                isDraggingSource={isSource}
                                isTarget={isTarget}
                                isSwapAnimating={isSwapAnimating}
                                onPointerDown={(event) => handlePointerDown(row.key, index, event)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className={styles.expandedPortrait}>
                <div className={styles.expandedPortraitHeader}>
                  <div className={styles.expandedPortraitTeam}>
                    {rows[0]?.teamId ? <img className={styles.expandedTeamLogo} src={teamLogoUrl(rows[0].teamId)} alt="" /> : null}
                    <span>{rows[0]?.label}</span>
                  </div>
                  <div className={styles.expandedPortraitTeam}>
                    {rows[1]?.teamId ? <img className={styles.expandedTeamLogo} src={teamLogoUrl(rows[1].teamId)} alt="" /> : null}
                    <span>{rows[1]?.label}</span>
                  </div>
                </div>
                <div className={styles.expandedPortraitRows}>
                  {Array.from({ length: ROW_SLOT_COUNT }, (_, index) => (
                    <div key={`portrait-pair-${index}`} className={styles.expandedPortraitPair}>
                      {rows.slice(0, 2).map((row) => {
                        const player = row?.players[index] || null;
                        const isSource = dragState?.side === row?.key && dragState?.fromIndex === index;
                        const isTarget = dragState?.side === row?.key && dragState?.overIndex === index;
                        const isSwapAnimating = swapFlash?.side === row?.key && swapFlash.indexes.includes(index);
                        return (
                          <div
                            key={`portrait-${row?.key || "row"}-${index}-${player?.personId || "open"}`}
                            ref={(node) => {
                              if (row?.key) {
                                expandedPortraitSlotRefs.current[row.key][index] = node;
                              }
                            }}
                          >
                            <ExpandedTile
                              player={player}
                              teamLabel={row?.label || "Team"}
                              isDraggingSource={isSource}
                              isTarget={isTarget}
                              isSwapAnimating={isSwapAnimating}
                              onPointerDown={(event) => row?.key && handlePointerDown(row.key, index, event)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>

              <canvas
                ref={expandedCanvasRef}
                className={`${styles.expandedDrawCanvas} ${expandedDrawMode ? styles.expandedDrawCanvasActive : ""}`.trim()}
                onPointerDown={handleExpandedCanvasPointerDown}
                onPointerMove={handleExpandedCanvasPointerMove}
                onPointerUp={handleExpandedCanvasPointerUp}
                onPointerCancel={handleExpandedCanvasPointerUp}
                onTouchStart={handleExpandedCanvasTouchStart}
                onTouchMove={handleExpandedCanvasTouchMove}
                onTouchEnd={handleExpandedCanvasTouchEnd}
                onTouchCancel={handleExpandedCanvasTouchEnd}
              />
            </div>
          </div>
        </div>
      ) : null}

      {refreshMenuOpen ? (
        <div ref={refreshMenuRef} className={styles.refreshMenu}>
          <div className={styles.refreshMenuTitle}>Reset Match-Ups</div>
          <button type="button" className={styles.refreshMenuButton} onClick={() => handleRefreshRow("away")}>
            {`Refresh ${awayTeam?.teamTricode || "Away"}`}
          </button>
          <button type="button" className={styles.refreshMenuButton} onClick={() => handleRefreshRow("home")}>
            {`Refresh ${homeTeam?.teamTricode || "Home"}`}
          </button>
          <button type="button" className={styles.refreshMenuButton} onClick={handleRefreshAll}>
            Refresh All
          </button>
        </div>
      ) : null}

      {pickerState ? (
        <div className={styles.pickerOverlay}>
          <div className={styles.pickerDialog} onClick={(event) => event.stopPropagation()}>
            <div className={styles.pickerHeader}>
              <div className={styles.pickerTitle}>Select player</div>
              <button type="button" className={styles.pickerCloseButton} onClick={() => setPickerState(null)}>
                Close
              </button>
            </div>
            <div className={styles.pickerGrid}>
              {pickerOptions.map((player) => (
                <HeadshotPickerTile
                  key={player.personId}
                  player={player}
                  isActive={player.personId === pickerSelectedPersonId}
                  onClick={() => handlePickerSelect(pickerState.side, pickerState.index, player.personId)}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {dragState?.player ? (
        <div
          className={`${styles.dragGhost} ${expandedOpen ? styles.dragGhostExpanded : ""}`.trim()}
          style={{
            width: `${dragState.width}px`,
            left: `${dragState.pointerX - dragState.offsetX}px`,
            top: `${dragState.pointerY - dragState.offsetY}px`,
          }}
          aria-hidden="true"
        >
          {expandedOpen ? (
            <div className={styles.expandedTile}>
              <div className={styles.expandedAvatarFrame}>
                <PlayerHeadshot
                  className={styles.expandedAvatarImage}
                  personId={dragState.player.personId}
                  teamId={dragState.player.teamId}
                  alt=""
                  draggable={false}
                />
              </div>
              <div className={styles.expandedPlayerName}>{`${dragState.player.jerseyNum} ${dragState.player.lastName}`.trim()}</div>
            </div>
          ) : (
            <div className={styles.tile}>
              <div className={styles.avatarFrame}>
                <PlayerHeadshot
                  className={styles.avatarImage}
                  personId={dragState.player.personId}
                  teamId={dragState.player.teamId}
                  style={isGLeagueTeamId(dragState.player.teamId) ? { mixBlendMode: "multiply" } : undefined}
                  alt=""
                  draggable={false}
                />
              </div>
              <div className={styles.playerMeta}>
                <div className={styles.playerName}>{`${dragState.player.jerseyNum} ${dragState.player.lastName}`.trim()}</div>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
