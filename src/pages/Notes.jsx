import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteNoteRecord,
  listNotesForGame,
  updateNoteRecord,
} from "../accountData.js";
import { useAuth } from "../auth/useAuth.js";
import styles from "./Notes.module.css";

const periodOrder = {
  Q1: 1,
  Q2: 2,
  Q3: 3,
  Q4: 4,
  OT: 5,
};

const filterPeriods = ["All", "--", "Q1", "Q2", "Q3", "Q4", "OT"];
const filterTags = [
  "All",
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
const noteTags = filterTags.filter((tag) => tag !== "All");

const getPeriodOrder = (note) => periodOrder[note.period_label] || 99;

const getRemainingSeconds = (note) => {
  if (note.minutes == null || note.seconds == null) return -1;
  return Number(note.minutes) * 60 + Number(note.seconds);
};

const formatClock = (note) => {
  if (note.minutes == null || note.seconds == null) return "--";
  return `${note.minutes}:${String(note.seconds).padStart(2, "0")}`;
};

const getClipUrl = (note) => {
  const clipUrl = note?.source_meta?.clip_url;
  return clipUrl ? String(clipUrl) : "";
};

export default function Notes() {
  const { gameId } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const dateParam = params.get("d");
  const fromParam = params.get("from");
  const backPath = fromParam === "atc" ? `/g/${gameId}/atc` : `/g/${gameId}`;
  const backUrl = dateParam ? `${backPath}?d=${dateParam}` : backPath;
  const [periodFilter, setPeriodFilter] = useState("All");
  const [tagFilter, setTagFilter] = useState("All");
  const [editNote, setEditNote] = useState(null);
  const [editDraft, setEditDraft] = useState({ text: "", tags: [] });
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const { data: notes = [], isLoading, error } = useQuery({
    queryKey: ["notes", gameId],
    queryFn: () => listNotesForGame(gameId, user?.id),
    enabled: Boolean(gameId && user?.id),
  });

  const filteredNotes = useMemo(() => {
    return notes.filter((note) => {
      const periodValue = note.period_label || "--";
      const matchesPeriod = periodFilter === "All" || periodFilter === periodValue;
      const tags = Array.isArray(note.tags) ? note.tags : [];
      const matchesTag = tagFilter === "All" || tags.includes(tagFilter);
      return matchesPeriod && matchesTag;
    });
  }, [notes, periodFilter, tagFilter]);

  const sortedNotes = useMemo(() => {
    return [...filteredNotes].sort((a, b) => {
      const periodDiff = getPeriodOrder(a) - getPeriodOrder(b);
      if (periodDiff) return periodDiff;
      const remainingDiff = getRemainingSeconds(b) - getRemainingSeconds(a);
      if (remainingDiff) return remainingDiff;
      return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
    });
  }, [filteredNotes]);

  const invalidateNotes = () => {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ["notes", gameId] }),
    ]);
  };

  const handleDelete = async (id) => {
    const confirmed = window.confirm("Delete this note?");
    if (!confirmed) return;
    await deleteNoteRecord(id, user?.id);
    await invalidateNotes();
  };

  const openEdit = (note) => {
    setEditNote(note);
    setEditDraft({
      text: note.text || "",
      tags: Array.isArray(note.tags) ? note.tags : [],
    });
    setEditError("");
  };

  const closeEdit = () => {
    setEditNote(null);
    setEditDraft({ text: "", tags: [] });
    setEditError("");
    setSavingEdit(false);
  };

  const saveEdit = async () => {
    if (!editNote || savingEdit) return;
    try {
      setSavingEdit(true);
      setEditError("");
      await updateNoteRecord(editNote.id, {
        text: String(editDraft.text || "").trim(),
        tags: Array.isArray(editDraft.tags) ? editDraft.tags : [],
      }, user?.id);
      await invalidateNotes();
      closeEdit();
    } catch (saveError) {
      setEditError(saveError?.message || "Unable to save note.");
      setSavingEdit(false);
    }
  };

  if (isLoading) {
    return <div className={styles.container}>Loading notes...</div>;
  }

  if (error) {
    return <div className={styles.container}>Failed to load notes.</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.backRow}>
        <Link className={styles.backButton} to={backUrl}>
          Back
        </Link>
      </div>

      <h2 className={styles.title}>Notes</h2>

      <div className={styles.filters}>
        <label className={styles.filterField}>
          <span>Quarter</span>
          <select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}>
            {filterPeriods.map((period) => (
              <option key={period} value={period}>
                {period}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterField}>
          <span>Tag</span>
          <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
            {filterTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </label>
      </div>

      {sortedNotes.length === 0 ? (
        <div className={styles.empty}>No notes saved yet.</div>
      ) : (
        <div className={styles.list}>
          {sortedNotes.map((note) => (
            (() => {
              const canManage = note.owner_id === user?.id;
              const clipUrl = getClipUrl(note);
              return (
                <div key={note.id} className={styles.noteRow}>
                  {canManage ? (
                    <button
                      type="button"
                      className={styles.noteDelete}
                      onClick={() => handleDelete(note.id)}
                      aria-label="Delete note"
                    >
                      ×
                    </button>
                  ) : (
                    <div className={styles.noteDeleteSpacer} />
                  )}
                  <div className={styles.noteMeta}>
                    <span className={styles.notePeriod}>{note.period_label || "--"}</span>
                    <span className={styles.noteClock}>{formatClock(note)}</span>
                    {note.sharing_scope === "shared" ? (
                      <span className={styles.sharedBadge}>Shared</span>
                    ) : (
                      <span className={styles.privateBadge}>Private</span>
                    )}
                  </div>
                  <div>
                    <div className={styles.noteBody}>{note.text || "—"}</div>
                    {Array.isArray(note.tags) && note.tags.length ? (
                      <div className={styles.tagRow}>
                        {note.tags.map((tag) => (
                          <span key={tag} className={styles.tagChip}>{tag}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className={styles.noteButtons}>
                    {clipUrl ? (
                      <a
                        href={clipUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={styles.noteClipLink}
                        aria-label="Open play clip"
                        title="Open play clip"
                      >
                        <span className={styles.playIcon} aria-hidden="true" />
                      </a>
                    ) : null}
                    {canManage ? (
                      <button type="button" className={styles.noteEdit} onClick={() => openEdit(note)}>
                        Edit
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })()
          ))}
        </div>
      )}

      {editNote && (
        <div className={styles.noteOverlay} onClick={closeEdit}>
          <div
            className={styles.noteModal}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h3>Edit Note</h3>
            <details className={styles.noteTags} open>
              <summary>Tags</summary>
              <div className={styles.noteTagsGrid}>
                {noteTags.map((tag) => {
                  const checked = editDraft.tags.includes(tag);
                  return (
                    <label key={tag} className={styles.noteTagOption}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const next = event.target.checked
                            ? [...editDraft.tags, tag]
                            : editDraft.tags.filter((value) => value !== tag);
                          setEditDraft((prev) => ({ ...prev, tags: next }));
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
              placeholder="Type your note..."
              value={editDraft.text}
              onChange={(event) => setEditDraft((prev) => ({ ...prev, text: event.target.value }))}
            />
            {savingEdit ? <div className={styles.modalStatus}>Saving...</div> : null}
            {editError ? <div className={styles.modalError}>{editError}</div> : null}
            <div className={styles.noteActions}>
              <button type="button" className={styles.noteCancel} onClick={closeEdit} disabled={savingEdit}>
                Cancel
              </button>
              <button type="button" className={styles.noteSave} onClick={saveEdit} disabled={savingEdit}>
                {savingEdit ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
