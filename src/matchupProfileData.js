import { supabase } from "./supabaseClient.js";
import { MATCHUP_PLAYER_PROFILES } from "./data/matchupProfiles.js";

export const MATCHUP_ARCHETYPE_OPTIONS = [
  "small_guard",
  "big_guard",
  "wing",
  "power_wing",
  "stretch_big",
  "power_big",
  "center_big",
];

export const MATCHUP_DEFENDER_ROLE_OPTIONS = [
  "small_guard",
  "point_of_attack",
  "wing_stopper",
  "big_anchor",
];

export const MATCHUP_OFFENSIVE_ROLE_OPTIONS = [
  "primary_ball_guard",
  "combo_guard",
  "wing_creator",
  "power_wing",
  "stretch_big",
  "power_big",
  "center_big",
];

function normalizeTextArray(values) {
  if (Array.isArray(values)) {
    return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
  }
  return Array.from(
    new Set(
      String(values || "")
        .split(/[,\n]/)
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function normalizeNumber(value) {
  if (value === "" || value == null) return null;
  const parsed = Number.parseInt(String(value).trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeMatchupProfileRecord(row) {
  if (!row || typeof row !== "object") return null;
  const personId = String(row.person_id || row.personId || "").trim();
  if (!personId) return null;
  return {
    personId,
    league: String(row.league || "nba").trim() === "gleague" ? "gleague" : "nba",
    teamId: String(row.team_id || row.teamId || "").trim(),
    fullName: String(row.full_name || row.fullName || "").trim(),
    heightIn: normalizeNumber(row.height_in ?? row.heightIn),
    archetype: String(row.archetype || "").trim(),
    defenderRole: String(row.defender_role || row.defenderRole || "").trim(),
    offensiveRole: String(row.offensive_role || row.offensiveRole || "").trim(),
    preferOffensiveRoles: normalizeTextArray(row.prefer_offensive_roles ?? row.preferOffensiveRoles),
    avoidOffensiveRoles: normalizeTextArray(row.avoid_offensive_roles ?? row.avoidOffensiveRoles),
    preferOpponentIds: normalizeTextArray(row.prefer_opponent_ids ?? row.preferOpponentIds),
    avoidOpponentIds: normalizeTextArray(row.avoid_opponent_ids ?? row.avoidOpponentIds),
    createdAt: String(row.created_at || row.createdAt || "").trim(),
    updatedAt: String(row.updated_at || row.updatedAt || "").trim(),
  };
}

export function normalizeMatchupProfilePayload(input) {
  const normalized = normalizeMatchupProfileRecord(input);
  if (!normalized) {
    throw new Error("A player must be selected.");
  }
  return {
    person_id: normalized.personId,
    league: normalized.league,
    team_id: normalized.teamId || null,
    full_name: normalized.fullName || null,
    height_in: normalized.heightIn,
    archetype: normalized.archetype || null,
    defender_role: normalized.defenderRole || null,
    offensive_role: normalized.offensiveRole || null,
    prefer_offensive_roles: normalized.preferOffensiveRoles,
    avoid_offensive_roles: normalized.avoidOffensiveRoles,
    prefer_opponent_ids: normalized.preferOpponentIds,
    avoid_opponent_ids: normalized.avoidOpponentIds,
  };
}

export async function listMatchupProfiles() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("matchup_player_profiles")
    .select("*")
    .order("full_name", { ascending: true, nullsFirst: false })
    .order("person_id", { ascending: true });
  if (error) {
    if (/jwt|permission|not configured|relation .* does not exist/i.test(String(error.message || ""))) {
      return [];
    }
    throw error;
  }
  return (data || []).map(normalizeMatchupProfileRecord).filter(Boolean);
}

export async function saveMatchupProfile(record) {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }
  const payload = normalizeMatchupProfilePayload(record);
  const { data, error } = await supabase
    .from("matchup_player_profiles")
    .upsert(payload, { onConflict: "person_id" })
    .select("*")
    .single();
  if (error) throw error;
  return normalizeMatchupProfileRecord(data);
}

export async function deleteMatchupProfile(personId) {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }
  const { error } = await supabase
    .from("matchup_player_profiles")
    .delete()
    .eq("person_id", String(personId || "").trim());
  if (error) throw error;
}

export function buildMatchupProfileMap(rows) {
  return (rows || []).reduce((accumulator, row) => {
    const normalized = normalizeMatchupProfileRecord(row);
    if (!normalized) return accumulator;
    accumulator[normalized.personId] = {
      heightIn: normalized.heightIn,
      archetype: normalized.archetype || undefined,
      defenderRole: normalized.defenderRole || undefined,
      offensiveRole: normalized.offensiveRole || undefined,
      preferOffensiveRoles: normalized.preferOffensiveRoles,
      avoidOffensiveRoles: normalized.avoidOffensiveRoles,
      preferOpponentIds: normalized.preferOpponentIds,
      avoidOpponentIds: normalized.avoidOpponentIds,
    };
    return accumulator;
  }, {});
}

export function buildResolvedMatchupProfileMap(rows) {
  return {
    ...MATCHUP_PLAYER_PROFILES,
    ...buildMatchupProfileMap(rows),
  };
}

