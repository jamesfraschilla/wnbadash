import { supabase } from "./supabaseClient.js";
import { loadLegacyLocalNotes } from "./notesStorage.js";

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }
}

function normalizeTextArray(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function normalizeNoteSourceMeta(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const next = {};
  const type = String(value.type || "").trim();
  const clipUrl = String(value.clip_url || "").trim();
  const actionNumber = Number(value.action_number);
  const videoEventId = Number(value.video_event_id);

  if (type) next.type = type;
  if (clipUrl) next.clip_url = clipUrl;
  if (!Number.isNaN(actionNumber)) next.action_number = actionNumber;
  if (!Number.isNaN(videoEventId)) next.video_event_id = videoEventId;
  return next;
}

function assignIfDefined(target, key, value) {
  if (value !== undefined) {
    target[key] = value;
  }
}

async function insertAuditLog(actorId, entityType, entityId, action, detail = {}) {
  if (!supabase || !actorId) return;
  await supabase.from("audit_logs").insert({
    actor_id: actorId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    detail,
  });
}

async function createVersionRow(table, payload) {
  requireSupabase();
  const { error } = await supabase.from(table).insert(payload);
  if (error) throw error;
}

async function clearDrawingVersions(drawingId) {
  requireSupabase();
  const { error } = await supabase.from("user_drawing_versions").delete().eq("drawing_id", drawingId);
  if (error) throw error;
}

export async function fetchProfile(userId) {
  requireSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function touchProfileLastLogin(userId) {
  requireSupabase();
  const { error } = await supabase
    .from("profiles")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw error;
}

export async function fetchVisibleProfiles() {
  requireSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,display_name,role,team_scopes,status,feature_flags,last_login_at,created_at,updated_at")
    .order("display_name", { ascending: true, nullsFirst: false })
    .order("email", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function updateProfile(profileId, updates, actorId) {
  requireSupabase();
  const payload = {};
  assignIfDefined(payload, "display_name", updates.display_name);
  assignIfDefined(payload, "email", updates.email);
  assignIfDefined(payload, "role", updates.role);
  assignIfDefined(payload, "status", updates.status);
  if (updates.team_scopes !== undefined) {
    payload.team_scopes = normalizeTextArray(updates.team_scopes);
  }
  if (updates.feature_flags !== undefined) {
    payload.feature_flags = normalizeTextArray(updates.feature_flags);
  }
  const { data, error } = await supabase
    .from("profiles")
    .update(payload)
    .eq("id", profileId)
    .select("*")
    .single();
  if (error) throw error;
  await insertAuditLog(actorId, "profile", profileId, "updated", payload);
  return data;
}

export async function fetchPendingInvites() {
  requireSupabase();
  const { data, error } = await supabase
    .from("account_invites")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getCurrentAccessToken(explicitAccessToken) {
  if (explicitAccessToken) return explicitAccessToken;
  requireSupabase();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data?.session?.access_token || "";
}

export async function createUserInvite({ accessToken, email, displayName, role, teamScopes }) {
  requireSupabase();
  const currentAccessToken = await getCurrentAccessToken(accessToken);
  const { data, error } = await supabase.functions.invoke("admin-users", {
    body: {
      action: "invite",
      accessToken: currentAccessToken,
      email,
      displayName,
      role,
      teamScopes,
    },
  });
  if (error) {
    throw new Error(error.message || "Unable to create invite.");
  }
  if (data?.error) {
    throw new Error(data.error);
  }
  return data;
}

export async function createManagedUser({ accessToken, email, password, displayName, role, teamScopes }) {
  requireSupabase();
  const currentAccessToken = await getCurrentAccessToken(accessToken);
  const { data, error } = await supabase.functions.invoke("admin-users", {
    body: {
      action: "create_user",
      accessToken: currentAccessToken,
      email,
      password,
      displayName,
      role,
      teamScopes,
    },
  });
  if (error) {
    throw new Error(error.message || "Unable to create user.");
  }
  if (data?.error) {
    throw new Error(data.error);
  }
  return data;
}

export async function listNotesForGame(gameId, actorId) {
  requireSupabase();
  if (!actorId) return [];
  const { data, error } = await supabase
    .from("user_notes")
    .select("*")
    .eq("game_id", gameId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const notes = data || [];
  const sharedCandidateIds = notes
    .filter((note) => note.owner_id !== actorId)
    .map((note) => note.id);

  if (!sharedCandidateIds.length) {
    return notes.filter((note) => note.owner_id === actorId);
  }

  const { data: sharedRows, error: sharedError } = await supabase
    .from("user_note_shares")
    .select("note_id")
    .eq("user_id", actorId)
    .in("note_id", sharedCandidateIds);
  if (sharedError) throw sharedError;

  const sharedNoteIds = new Set((sharedRows || []).map((row) => row.note_id));
  return notes.filter((note) => note.owner_id === actorId || sharedNoteIds.has(note.id));
}

export async function listOwnedNotes(actorId) {
  requireSupabase();
  const { data, error } = await supabase
    .from("user_notes")
    .select("*")
    .eq("owner_id", actorId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createNote(note, actorId) {
  requireSupabase();
  const noteId = String(note.id || (typeof crypto !== "undefined" ? crypto.randomUUID() : `note-${Date.now()}`));
  const createdAtIso = note.createdAtIso || new Date().toISOString();
  const payload = {
    id: noteId,
    owner_id: actorId,
    legacy_local_id: note.legacyLocalId || null,
    game_id: String(note.gameId || ""),
    period_label: note.periodLabel || null,
    minutes: note.minutes ?? null,
    seconds: note.seconds ?? null,
    text: String(note.text || "").trim(),
    tags: normalizeTextArray(note.tags),
    source_meta: normalizeNoteSourceMeta(note.sourceMeta),
    sharing_scope: note.sharingScope === "shared" ? "shared" : "private",
    created_at: createdAtIso,
    updated_at: createdAtIso,
  };
  const { error } = await supabase.from("user_notes").insert(payload);
  if (error) throw error;
  await createVersionRow("user_note_versions", {
    note_id: noteId,
    version_number: 1,
    snapshot: payload,
    created_by: actorId,
  });
  await insertAuditLog(actorId, "note", noteId, "created", { gameId: payload.game_id });
  return payload;
}

export async function importLegacyLocalNotes(actorId) {
  requireSupabase();
  const localNotes = loadLegacyLocalNotes();
  if (!actorId) {
    throw new Error("A signed-in user is required to import notes.");
  }
  if (!localNotes.length) {
    return { importedCount: 0, skippedCount: 0 };
  }

  const rows = localNotes.map((note, index) => {
    const createdAt = Number(note?.createdAt || 0);
    const createdAtIso = createdAt ? new Date(createdAt).toISOString() : new Date().toISOString();
    const legacyLocalId = String(note?.id || `${note?.gameId || "game"}-${createdAt || Date.now()}-${index}`);
    return {
      owner_id: actorId,
      legacy_local_id: legacyLocalId,
      game_id: String(note?.gameId || ""),
      period_label: note?.periodLabel || null,
      minutes: note?.minutes ?? null,
      seconds: note?.seconds ?? null,
      text: String(note?.text || "").trim(),
      tags: normalizeTextArray(note?.tags),
      sharing_scope: "private",
      created_at: createdAtIso,
      updated_at: createdAtIso,
    };
  });

  const dedupedRows = Array.from(
    new Map(rows.map((row) => [row.legacy_local_id, row])).values()
  );

  const legacyIds = dedupedRows
    .map((row) => row.legacy_local_id)
    .filter(Boolean);

  const { data: existingRows, error: existingError } = await supabase
    .from("user_notes")
    .select("legacy_local_id")
    .eq("owner_id", actorId)
    .in("legacy_local_id", legacyIds);

  if (existingError) throw existingError;

  const existingLegacyIds = new Set((existingRows || []).map((row) => row.legacy_local_id));
  const rowsToInsert = dedupedRows.filter((row) => !existingLegacyIds.has(row.legacy_local_id));

  if (!rowsToInsert.length) {
    return {
      importedCount: 0,
      skippedCount: dedupedRows.length,
    };
  }

  const importedNotes = [];
  for (const row of rowsToInsert) {
    const importedNote = await createNote({
      legacyLocalId: row.legacy_local_id,
      gameId: row.game_id,
      periodLabel: row.period_label,
      minutes: row.minutes,
      seconds: row.seconds,
      text: row.text,
      tags: row.tags,
      sourceMeta: row.source_meta,
      sharingScope: row.sharing_scope,
      createdAtIso: row.created_at,
    }, actorId);
    importedNotes.push(importedNote);
  }

  await insertAuditLog(actorId, "note_import", null, "imported_legacy_local_notes", {
    importedCount: importedNotes.length,
    sourceCount: localNotes.length,
  });

  return {
    importedCount: importedNotes.length,
    skippedCount: Math.max(0, dedupedRows.length - importedNotes.length),
  };
}

export async function updateNoteRecord(noteId, updates, actorId) {
  requireSupabase();
  const { data: existing, error: fetchError } = await supabase
    .from("user_notes")
    .select("*")
    .eq("id", noteId)
    .single();
  if (fetchError) throw fetchError;

  const { count } = await supabase
    .from("user_note_versions")
    .select("id", { count: "exact", head: true })
    .eq("note_id", noteId);

  await createVersionRow("user_note_versions", {
    note_id: noteId,
    version_number: Number(count || 0) + 1,
    snapshot: existing,
    created_by: actorId,
  });

  const payload = {
    text: updates.text != null ? String(updates.text || "").trim() : existing.text,
    tags: updates.tags != null ? normalizeTextArray(updates.tags) : existing.tags,
    period_label: updates.periodLabel !== undefined ? updates.periodLabel : existing.period_label,
    minutes: updates.minutes !== undefined ? updates.minutes : existing.minutes,
    seconds: updates.seconds !== undefined ? updates.seconds : existing.seconds,
    source_meta: updates.sourceMeta !== undefined ? normalizeNoteSourceMeta(updates.sourceMeta) : (existing.source_meta || {}),
    sharing_scope: updates.sharingScope || existing.sharing_scope,
  };

  const { error } = await supabase
    .from("user_notes")
    .update(payload)
    .eq("id", noteId);
  if (error) throw error;
  await insertAuditLog(actorId, "note", noteId, "updated", payload);
  return { ...existing, ...payload, id: noteId };
}

export async function deleteNoteRecord(noteId, actorId) {
  requireSupabase();
  const { data: existing, error: fetchError } = await supabase
    .from("user_notes")
    .select("*")
    .eq("id", noteId)
    .single();
  if (fetchError) throw fetchError;
  const { count } = await supabase
    .from("user_note_versions")
    .select("id", { count: "exact", head: true })
    .eq("note_id", noteId);
  await createVersionRow("user_note_versions", {
    note_id: noteId,
    version_number: Number(count || 0) + 1,
    snapshot: existing,
    created_by: actorId,
  });
  const { error } = await supabase.from("user_notes").delete().eq("id", noteId);
  if (error) throw error;
  await insertAuditLog(actorId, "note", noteId, "deleted", { gameId: existing.game_id });
}

export async function listNoteVersions(noteId) {
  requireSupabase();
  const { data, error } = await supabase
    .from("user_note_versions")
    .select("*")
    .eq("note_id", noteId)
    .order("version_number", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listNoteShares(noteId) {
  requireSupabase();
  const { data, error } = await supabase
    .from("user_note_shares")
    .select("user_id")
    .eq("note_id", noteId);
  if (error) throw error;
  return (data || []).map((row) => row.user_id);
}

export async function updateNoteShares(noteId, userIds, actorId) {
  requireSupabase();
  const normalizedUserIds = normalizeTextArray(userIds);
  const { error: deleteError } = await supabase.from("user_note_shares").delete().eq("note_id", noteId);
  if (deleteError) throw deleteError;
  if (normalizedUserIds.length) {
    const { error: insertError } = await supabase.from("user_note_shares").insert(
      normalizedUserIds.map((userId) => ({
        note_id: noteId,
        user_id: userId,
        shared_by: actorId,
      }))
    );
    if (insertError) throw insertError;
  }
  await updateNoteRecord(
    noteId,
    { sharingScope: normalizedUserIds.length ? "shared" : "private" },
    actorId
  );
  await insertAuditLog(actorId, "note", noteId, "shared", { userIds: normalizedUserIds });
}

export async function listDrawings(gameId = null) {
  requireSupabase();
  let query = supabase
    .from("user_drawings")
    .select("*")
    .order("updated_at", { ascending: false });
  if (gameId) query = query.eq("game_id", gameId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function listOwnedDrawings(actorId) {
  requireSupabase();
  const { data, error } = await supabase
    .from("user_drawings")
    .select("*")
    .eq("owner_id", actorId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createDrawing(drawing, actorId) {
  requireSupabase();
  const drawingId = String(drawing.id || (typeof crypto !== "undefined" ? crypto.randomUUID() : `drawing-${Date.now()}`));
  const createdAtIso = drawing.createdAtIso || new Date().toISOString();
  const payload = {
    id: drawingId,
    owner_id: actorId,
    game_id: drawing.gameId || null,
    title: String(drawing.title || "").trim() || "Untitled",
    court_mode: drawing.courtMode === "full" ? "full" : "half",
    strokes: Array.isArray(drawing.strokes) ? drawing.strokes : [],
    sharing_scope: drawing.sharingScope === "shared" ? "shared" : "private",
    created_at: createdAtIso,
    updated_at: createdAtIso,
  };
  const { error } = await supabase.from("user_drawings").insert(payload);
  if (error) throw error;
  await clearDrawingVersions(drawingId);
  await insertAuditLog(actorId, "drawing", drawingId, "created", { gameId: payload.game_id });
  return payload;
}

export async function updateDrawingRecord(drawingId, updates, actorId) {
  requireSupabase();
  const { data: existing, error: fetchError } = await supabase
    .from("user_drawings")
    .select("*")
    .eq("id", drawingId)
    .single();
  if (fetchError) throw fetchError;

  const payload = {
    title: updates.title != null ? String(updates.title || "").trim() || "Untitled" : existing.title,
    court_mode: updates.courtMode === "full" ? "full" : (updates.courtMode || existing.court_mode),
    strokes: Array.isArray(updates.strokes) ? updates.strokes : existing.strokes,
    sharing_scope: updates.sharingScope || existing.sharing_scope,
  };

  const { error } = await supabase
    .from("user_drawings")
    .update(payload)
    .eq("id", drawingId);
  if (error) throw error;
  await clearDrawingVersions(drawingId);
  await insertAuditLog(actorId, "drawing", drawingId, "updated", { title: payload.title });
  return { ...existing, ...payload, id: drawingId };
}

export async function deleteDrawingRecord(drawingId, actorId) {
  requireSupabase();
  const { data: existing, error: fetchError } = await supabase
    .from("user_drawings")
    .select("*")
    .eq("id", drawingId)
    .single();
  if (fetchError) throw fetchError;
  const { error } = await supabase.from("user_drawings").delete().eq("id", drawingId);
  if (error) throw error;
  await insertAuditLog(actorId, "drawing", drawingId, "deleted", { title: existing.title });
}

export async function listDrawingVersions(drawingId) {
  requireSupabase();
  const { data, error } = await supabase
    .from("user_drawing_versions")
    .select("*")
    .eq("drawing_id", drawingId)
    .order("version_number", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listDrawingShares(drawingId) {
  requireSupabase();
  const { data, error } = await supabase
    .from("user_drawing_shares")
    .select("user_id")
    .eq("drawing_id", drawingId);
  if (error) throw error;
  return (data || []).map((row) => row.user_id);
}

export async function updateDrawingShares(drawingId, userIds, actorId) {
  requireSupabase();
  const normalizedUserIds = normalizeTextArray(userIds);
  const { error: deleteError } = await supabase.from("user_drawing_shares").delete().eq("drawing_id", drawingId);
  if (deleteError) throw deleteError;
  if (normalizedUserIds.length) {
    const { error: insertError } = await supabase.from("user_drawing_shares").insert(
      normalizedUserIds.map((userId) => ({
        drawing_id: drawingId,
        user_id: userId,
        shared_by: actorId,
      }))
    );
    if (insertError) throw insertError;
  }
  await updateDrawingRecord(
    drawingId,
    { sharingScope: normalizedUserIds.length ? "shared" : "private" },
    actorId
  );
  await insertAuditLog(actorId, "drawing", drawingId, "shared", { userIds: normalizedUserIds });
}
