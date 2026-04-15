import { supabase } from "./supabaseClient.js";
import { readLocalStorage, writeLocalStorage } from "./storage.js";

const TOOL_VAULT_STORAGE_PREFIX = "nba-dashboard:tool-vault:v1:";
const TOOL_RECORD_TYPE = "matchup_graphic";

function toolVaultKey(userId) {
  return `${TOOL_VAULT_STORAGE_PREFIX}${String(userId || "guest").trim() || "guest"}`;
}

function safeParse(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeRecord(record) {
  if (!record || typeof record !== "object") return null;
  const id = String(record.id || "").trim();
  if (!id) return null;
  return {
    id,
    type: String(record.type || "matchup_graphic").trim() || "matchup_graphic",
    title: String(record.title || "Untitled").trim() || "Untitled",
    payload: record.payload && typeof record.payload === "object" ? record.payload : {},
    createdAt: String(record.createdAt || record.updatedAt || new Date().toISOString()),
    updatedAt: String(record.updatedAt || record.createdAt || new Date().toISOString()),
  };
}

export function listSavedToolRecords(userId) {
  const raw = readLocalStorage(toolVaultKey(userId));
  const parsed = safeParse(raw, []);
  return (Array.isArray(parsed) ? parsed : [])
    .map(normalizeRecord)
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }
}

function mergeToolRecords(...lists) {
  const byId = new Map();
  lists.flat().forEach((record) => {
    const normalized = normalizeRecord(record);
    if (!normalized) return;
    const existing = byId.get(normalized.id);
    if (!existing || String(normalized.updatedAt) >= String(existing.updatedAt)) {
      byId.set(normalized.id, normalized);
    }
  });
  return [...byId.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function getSavedToolRecord(userId, recordId) {
  return listSavedToolRecords(userId).find((record) => record.id === String(recordId || "").trim()) || null;
}

export function saveToolRecord(userId, record) {
  const normalized = normalizeRecord(record);
  if (!normalized) return null;
  const records = listSavedToolRecords(userId);
  const existingIndex = records.findIndex((entry) => entry.id === normalized.id);
  const nextRecords = [...records];
  if (existingIndex >= 0) {
    nextRecords[existingIndex] = {
      ...nextRecords[existingIndex],
      ...normalized,
      createdAt: nextRecords[existingIndex].createdAt || normalized.createdAt,
    };
  } else {
    nextRecords.unshift(normalized);
  }
  writeLocalStorage(toolVaultKey(userId), JSON.stringify(nextRecords));
  return normalized;
}

export function deleteSavedToolRecord(userId, recordId) {
  const nextRecords = listSavedToolRecords(userId).filter((record) => record.id !== String(recordId || "").trim());
  writeLocalStorage(toolVaultKey(userId), JSON.stringify(nextRecords));
}

function syncRemoteRecordsToLocal(userId, records) {
  const merged = mergeToolRecords(listSavedToolRecords(userId), records);
  writeLocalStorage(toolVaultKey(userId), JSON.stringify(merged));
  return merged;
}

export async function listSavedToolRecordsRemote(userId) {
  if (!userId) return [];
  await requireSupabase();
  const { data, error } = await supabase
    .from("user_tool_records")
    .select("*")
    .eq("owner_id", userId)
    .eq("type", TOOL_RECORD_TYPE)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const records = (data || [])
    .map((row) => normalizeRecord({
      id: row.id,
      type: row.type,
      title: row.title,
      payload: row.payload,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
    .filter(Boolean);
  return syncRemoteRecordsToLocal(userId, records);
}

export async function getSavedToolRecordRemote(userId, recordId) {
  const normalizedId = String(recordId || "").trim();
  if (!userId || !normalizedId) return null;
  await requireSupabase();
  const { data, error } = await supabase
    .from("user_tool_records")
    .select("*")
    .eq("owner_id", userId)
    .eq("id", normalizedId)
    .maybeSingle();
  if (error) throw error;
  const record = data ? normalizeRecord({
    id: data.id,
    type: data.type,
    title: data.title,
    payload: data.payload,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  }) : null;
  if (record) {
    syncRemoteRecordsToLocal(userId, [record]);
  }
  return record || getSavedToolRecord(userId, normalizedId);
}

export async function saveToolRecordRemote(userId, record) {
  if (!userId) return null;
  await requireSupabase();
  const normalized = normalizeRecord(record);
  if (!normalized) return null;
  const payload = {
    id: normalized.id,
    owner_id: userId,
    type: normalized.type || TOOL_RECORD_TYPE,
    title: normalized.title,
    payload: normalized.payload,
    created_at: normalized.createdAt,
    updated_at: normalized.updatedAt,
  };
  const { data, error } = await supabase
    .from("user_tool_records")
    .upsert(payload)
    .select("*")
    .single();
  if (error) throw error;
  const saved = normalizeRecord({
    id: data.id,
    type: data.type,
    title: data.title,
    payload: data.payload,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  });
  syncRemoteRecordsToLocal(userId, [saved]);
  return saved;
}

export async function deleteSavedToolRecordRemote(userId, recordId) {
  const normalizedId = String(recordId || "").trim();
  if (!userId || !normalizedId) return;
  await requireSupabase();
  const { error } = await supabase
    .from("user_tool_records")
    .delete()
    .eq("owner_id", userId)
    .eq("id", normalizedId);
  if (error) throw error;
  deleteSavedToolRecord(userId, normalizedId);
}
