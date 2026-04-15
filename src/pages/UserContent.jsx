import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteDrawingRecord, deleteNoteRecord, listOwnedDrawings, listOwnedNotes } from "../accountData.js";
import { useAuth } from "../auth/useAuth.js";
import { fetchGame, inferLeagueFromTeamId } from "../api.js";
import { getOpponentTeamForGame, getTrackedTeamForGame } from "../teamConfig.js";
import {
  deleteSavedToolRecord,
  deleteSavedToolRecordRemote,
  listSavedToolRecords,
  listSavedToolRecordsRemote,
} from "../toolVault.js";
import styles from "./UserContent.module.css";

const DEFAULT_NOTE_TAG_OPTIONS = [
  "Reminder",
  "Playcall",
  "Injury",
  "Good",
  "Bad",
  "Offense",
  "Defense",
  "Concept",
  "Misc",
];

function formatTimestamp(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

function formatClock(note) {
  if (note.minutes == null || note.seconds == null) return "--";
  return `${note.minutes}:${String(note.seconds).padStart(2, "0")}`;
}

function getClipUrl(note) {
  const clipUrl = note?.source_meta?.clip_url;
  return clipUrl ? String(clipUrl) : "";
}

function normalizeDateOnly(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function buildOpponentLabel(team) {
  const city = String(team?.teamCity || "").trim();
  const name = String(team?.teamName || "").trim();
  if (!city && !name) return "Unknown opponent";
  if (!city) return name;
  if (!name) return city;
  return `${city} ${name}`;
}

function buildGameMeta(game) {
  const trackedTeam = getTrackedTeamForGame(game);
  const opponentTeam = getOpponentTeamForGame(game);

  const gameDate = normalizeDateOnly(game?.gameEt || game?.gameTimeUTC || game?.gameDate);
  const opponentLabel = opponentTeam ? buildOpponentLabel(opponentTeam) : "Unknown opponent";
  const opponentLeague = opponentTeam ? inferLeagueFromTeamId(opponentTeam.teamId) : "nba";
  const trackedLabel = trackedTeam ? buildOpponentLabel(trackedTeam) : "";
  return {
    gameDate,
    opponentLabel,
    opponentLeague,
    opponentKey: opponentTeam ? `${opponentLeague}:${opponentTeam.teamId || opponentLabel}` : "",
    trackedLabel,
  };
}

export default function UserContent() {
  const { user, profile, hasFeature, accountsEnabled } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const canUseTools = hasFeature("tools");
  const rawTab = params.get("tab");
  const tab = rawTab === "drawings" ? "drawings" : rawTab === "tools" && canUseTools ? "tools" : "notes";
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [opponentFilter, setOpponentFilter] = useState("all");
  const [tagFilters, setTagFilters] = useState([]);
  const [deletingKey, setDeletingKey] = useState("");

  const { data: notes = [], isLoading: loadingNotes } = useQuery({
    queryKey: ["owned-notes", user?.id],
    queryFn: () => listOwnedNotes(user.id),
    enabled: Boolean(user?.id),
  });

  const { data: drawings = [], isLoading: loadingDrawings } = useQuery({
    queryKey: ["owned-drawings", user?.id],
    queryFn: () => listOwnedDrawings(user.id),
    enabled: Boolean(user?.id),
  });

  const { data: savedTools = [] } = useQuery({
    queryKey: ["owned-tools", user?.id],
    enabled: Boolean(user?.id && canUseTools),
    queryFn: async () => {
      if (!user?.id || !canUseTools) return [];
      if (!accountsEnabled) return listSavedToolRecords(user.id);
      try {
        return await listSavedToolRecordsRemote(user.id);
      } catch (error) {
        console.error("Failed to load remote tool drafts, falling back to local storage.", error);
        return listSavedToolRecords(user.id);
      }
    },
  });

  const uniqueGameIds = useMemo(() => (
    Array.from(
      new Set(
        [...notes, ...drawings]
          .map((item) => String(item?.game_id || "").trim())
          .filter(Boolean)
      )
    )
  ), [drawings, notes]);

  const gameQueries = useQueries({
    queries: uniqueGameIds.map((gameId) => ({
      queryKey: ["user-content-game", gameId],
      queryFn: () => fetchGame(gameId),
      enabled: Boolean(gameId),
      staleTime: 5 * 60 * 1000,
    })),
  });

  const gameMetaById = useMemo(() => {
    const next = new Map();
    uniqueGameIds.forEach((gameId, index) => {
      const query = gameQueries[index];
      if (query?.data) {
        next.set(gameId, buildGameMeta(query.data));
      }
    });
    return next;
  }, [gameQueries, uniqueGameIds]);

  const opponentOptions = useMemo(() => {
    const map = new Map();
    gameMetaById.forEach((meta) => {
      if (!meta.opponentKey) return;
      if (!map.has(meta.opponentKey)) {
        map.set(meta.opponentKey, {
          key: meta.opponentKey,
          label: meta.opponentLabel,
          league: meta.opponentLeague,
        });
      }
    });
    return {
      wnba: [...map.values()].filter((option) => option.league === "wnba").sort((a, b) => a.label.localeCompare(b.label)),
    };
  }, [gameMetaById]);

  const availableTagOptions = useMemo(() => {
    const extras = new Set();
    notes.forEach((note) => {
      const tags = Array.isArray(note?.tags) ? note.tags : [];
      tags.forEach((tag) => {
        const normalized = String(tag || "").trim();
        if (normalized) {
          extras.add(normalized);
        }
      });
    });
    return [
      ...DEFAULT_NOTE_TAG_OPTIONS.filter((tag) => extras.delete(tag) || true),
      ...[...extras].sort((a, b) => a.localeCompare(b)),
    ];
  }, [notes]);

  const itemMatchesBaseFilters = (item) => {
    if (!fromDate && !toDate && opponentFilter === "all") return true;
    const meta = gameMetaById.get(String(item?.game_id || "").trim());
    if (!meta) return false;
    if (fromDate && (!meta.gameDate || meta.gameDate < fromDate)) return false;
    if (toDate && (!meta.gameDate || meta.gameDate > toDate)) return false;
    if (opponentFilter !== "all" && meta.opponentKey !== opponentFilter) return false;
    return true;
  };

  const filteredNotes = useMemo(() => (
    notes.filter((note) => {
      if (!itemMatchesBaseFilters(note)) return false;
      if (!tagFilters.length) return true;
      const noteTags = Array.isArray(note?.tags) ? note.tags : [];
      return tagFilters.some((tag) => noteTags.includes(tag));
    })
  ), [notes, fromDate, toDate, opponentFilter, gameMetaById, tagFilters]);
  const filteredDrawings = useMemo(
    () => drawings.filter((drawing) => {
      if (!drawing.game_id && (fromDate || toDate || opponentFilter !== "all")) {
        return false;
      }
      return itemMatchesBaseFilters(drawing);
    }),
    [drawings, fromDate, toDate, opponentFilter, gameMetaById]
  );

  const tagSummaryLabel = useMemo(() => {
    if (!tagFilters.length) return "All Tags";
    if (tagFilters.length === 1) return tagFilters[0];
    return `${tagFilters.length} Tags`;
  }, [tagFilters]);

  const setTab = (nextTab) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set("tab", nextTab);
    setParams(nextParams, { replace: true });
  };

  const handleDeleteNote = async (note) => {
    if (!user?.id) return;
    const confirmed = window.confirm("Delete this saved note?");
    if (!confirmed) return;
    const key = `note:${note.id}`;
    try {
      setDeletingKey(key);
      await deleteNoteRecord(note.id, user.id);
      await queryClient.invalidateQueries({ queryKey: ["owned-notes", user.id] });
      await queryClient.invalidateQueries({ queryKey: ["notes"] });
    } finally {
      setDeletingKey("");
    }
  };

  const handleDeleteDrawing = async (drawing) => {
    if (!user?.id) return;
    const confirmed = window.confirm(`Delete "${drawing.title || "Untitled"}"?`);
    if (!confirmed) return;
    const key = `drawing:${drawing.id}`;
    try {
      setDeletingKey(key);
      await deleteDrawingRecord(drawing.id, user.id);
      await queryClient.invalidateQueries({ queryKey: ["owned-drawings", user.id] });
      await queryClient.invalidateQueries({ queryKey: ["drawings"] });
    } finally {
      setDeletingKey("");
    }
  };

  const handleDeleteTool = async (toolRecord) => {
    if (!user?.id) return;
    const confirmed = window.confirm(`Delete "${toolRecord.title || "Untitled"}"?`);
    if (!confirmed) return;
    const key = `tool:${toolRecord.id}`;
    try {
      setDeletingKey(key);
      if (accountsEnabled) {
        await deleteSavedToolRecordRemote(user.id, toolRecord.id);
      } else {
        deleteSavedToolRecord(user.id, toolRecord.id);
      }
      await queryClient.invalidateQueries({ queryKey: ["owned-tools", user.id] });
    } catch (error) {
      console.error("Failed to delete remote tool draft, falling back to local storage.", error);
      deleteSavedToolRecord(user.id, toolRecord.id);
      await queryClient.invalidateQueries({ queryKey: ["owned-tools", user.id] });
    } finally {
      setDeletingKey("");
    }
  };

  const toggleTagFilter = (tag) => {
    setTagFilters((current) => (
      current.includes(tag)
        ? current.filter((value) => value !== tag)
        : [...current, tag]
    ));
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <div className={styles.kicker}>My Vault</div>
          <h1 className={styles.title}>{profile?.display_name || profile?.email || "My Saved Content"}</h1>
        </div>
      </section>

      <div className={styles.tabRow}>
        <button
          type="button"
          className={`${styles.tabButton} ${tab === "notes" ? styles.tabButtonActive : ""}`}
          onClick={() => setTab("notes")}
        >
          Notes
        </button>
        <button
          type="button"
          className={`${styles.tabButton} ${tab === "drawings" ? styles.tabButtonActive : ""}`}
          onClick={() => setTab("drawings")}
        >
          Court Drawings
        </button>
        {canUseTools ? (
          <button
            type="button"
            className={`${styles.tabButton} ${tab === "tools" ? styles.tabButtonActive : ""}`}
            onClick={() => setTab("tools")}
          >
            Match-Up Graphics
          </button>
        ) : null}
      </div>

      {tab === "tools" ? null : (
        <section className={styles.filterPanel}>
        <div className={styles.filterGrid}>
          <label className={styles.filterField}>
            <span>From Date</span>
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label className={styles.filterField}>
            <span>To Date</span>
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
          <label className={styles.filterField}>
            <span>Opponent</span>
            <select value={opponentFilter} onChange={(event) => setOpponentFilter(event.target.value)}>
              <option value="all">All Opponents</option>
              {opponentOptions.wnba.length ? (
                <optgroup label="WNBA">
                  {opponentOptions.wnba.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>
          {tab === "notes" && availableTagOptions.length ? (
            <div className={styles.filterField}>
              <span>Tag</span>
              <details className={styles.tagFilterMenu}>
                <summary>{tagSummaryLabel}</summary>
                <div className={styles.tagFilterOptions}>
                  {availableTagOptions.map((tag) => (
                    <label key={tag} className={styles.tagFilterOption}>
                      <input
                        type="checkbox"
                        checked={tagFilters.includes(tag)}
                        onChange={() => toggleTagFilter(tag)}
                      />
                      <span>{tag}</span>
                    </label>
                  ))}
                </div>
              </details>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className={styles.clearFiltersButton}
          onClick={() => {
            setFromDate("");
            setToDate("");
            setOpponentFilter("all");
            setTagFilters([]);
          }}
        >
          Clear Filters
        </button>
        </section>
      )}

      {tab === "notes" ? (
        <section className={styles.section}>
          {loadingNotes ? (
            <div className={styles.emptyState}>Loading notes...</div>
          ) : filteredNotes.length === 0 ? (
            <div className={styles.emptyState}>You have not saved any notes yet.</div>
          ) : (
            <div className={styles.list}>
              {filteredNotes.map((note) => {
                const meta = gameMetaById.get(String(note.game_id || "").trim());
                const isDeleting = deletingKey === `note:${note.id}`;
                const clipUrl = getClipUrl(note);
                return (
                  <article key={note.id} className={styles.card}>
                    <div className={styles.cardHeader}>
                      <div className={styles.cardTitleGroup}>
                        <div className={styles.cardTitle}>{meta?.opponentLabel || `Game ${note.game_id}`}</div>
                        <div className={styles.cardMeta}>
                          {meta?.gameDate || "Unknown date"} · {note.period_label || "--"} · {formatClock(note)} · {note.sharing_scope}
                        </div>
                      </div>
                      <div className={styles.cardActions}>
                        {clipUrl ? (
                          <a
                            className={styles.clipLink}
                            href={clipUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="Open play clip"
                            title="Open play clip"
                          >
                            <span className={styles.playIcon} aria-hidden="true" />
                          </a>
                        ) : null}
                        <Link className={styles.cardLink} to={`/g/${note.game_id}/notes`}>
                          Open Notes
                        </Link>
                        <button
                          type="button"
                          className={styles.deleteButton}
                          onClick={() => handleDeleteNote(note)}
                          disabled={isDeleting}
                        >
                          {isDeleting ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </div>
                    <div className={styles.cardBody}>{note.text || "—"}</div>
                    {Array.isArray(note.tags) && note.tags.length ? (
                      <div className={styles.tagRow}>
                        {note.tags.map((tag) => (
                          <span key={tag} className={styles.tagChip}>{tag}</span>
                        ))}
                      </div>
                    ) : null}
                    <div className={styles.cardFooter}>Updated {formatTimestamp(note.updated_at)}</div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : tab === "drawings" ? (
        <section className={styles.section}>
          {loadingDrawings ? (
            <div className={styles.emptyState}>Loading drawings...</div>
          ) : filteredDrawings.length === 0 ? (
            <div className={styles.emptyState}>You have not saved any court drawings yet.</div>
          ) : (
            <div className={styles.list}>
              {filteredDrawings.map((drawing) => {
                const meta = gameMetaById.get(String(drawing.game_id || "").trim());
                const isDeleting = deletingKey === `drawing:${drawing.id}`;
                return (
                  <article key={drawing.id} className={styles.card}>
                    <div className={styles.cardHeader}>
                      <div className={styles.cardTitleGroup}>
                        <div className={styles.cardTitle}>{drawing.title || "Untitled"}</div>
                        <div className={styles.cardMeta}>
                          {drawing.game_id
                            ? `${meta?.opponentLabel || `Game ${drawing.game_id}`} · ${meta?.gameDate || "Unknown date"}`
                            : "General"}
                          {" · "}
                          {drawing.court_mode} court · {drawing.sharing_scope}
                        </div>
                      </div>
                      <div className={styles.cardActions}>
                        <Link
                          className={styles.cardLink}
                          to={`/draw?${new URLSearchParams({
                            ...(drawing.game_id ? { gameId: drawing.game_id } : {}),
                            boardId: drawing.id,
                            back: "/me?tab=drawings",
                          }).toString()}`}
                        >
                          Open Board
                        </Link>
                        <button
                          type="button"
                          className={styles.deleteButton}
                          onClick={() => handleDeleteDrawing(drawing)}
                          disabled={isDeleting}
                        >
                          {isDeleting ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </div>
                    <div className={styles.cardBody}>
                      Saved board
                    </div>
                    <div className={styles.cardFooter}>Updated {formatTimestamp(drawing.updated_at)}</div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section className={styles.section}>
          {savedTools.length === 0 ? (
            <div className={styles.emptyState}>You have not saved any match-up graphics yet.</div>
          ) : (
            <div className={styles.list}>
              {savedTools.map((toolRecord) => {
                const isDeleting = deletingKey === `tool:${toolRecord.id}`;
                const leftTeamLabel = String(toolRecord.payload?.leftTeamLabel || toolRecord.payload?.leftTeamName || "").trim();
                const rightTeamLabel = String(toolRecord.payload?.rightTeamLabel || toolRecord.payload?.rightTeamName || "").trim();
                return (
                  <article key={toolRecord.id} className={styles.card}>
                    <div className={styles.cardHeader}>
                      <div className={styles.cardTitleGroup}>
                        <div className={styles.cardTitle}>{toolRecord.title || "Untitled"}</div>
                        <div className={styles.cardMeta}>
                          Match-Up Graphics · Saved draft
                        </div>
                      </div>
                      <div className={styles.cardActions}>
                        <Link className={styles.cardLink} to={`/tools?draft=${encodeURIComponent(toolRecord.id)}`}>
                          Open Tool
                        </Link>
                        <button
                          type="button"
                          className={styles.deleteButton}
                          onClick={() => handleDeleteTool(toolRecord)}
                          disabled={isDeleting}
                        >
                          {isDeleting ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </div>
                    <div className={styles.cardBody}>
                      {leftTeamLabel || rightTeamLabel
                        ? `${leftTeamLabel || "Left side empty"} vs ${rightTeamLabel || "Right side empty"}`
                        : "Saved match-up graphic."}
                    </div>
                    <div className={styles.cardFooter}>Updated {formatTimestamp(toolRecord.updatedAt)}</div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
