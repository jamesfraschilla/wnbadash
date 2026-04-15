import { readLocalStorage, writeLocalStorage } from "./storage.js";

const STORAGE_KEY = "nba-dashboard:notes";
const IMPORT_STATE_PREFIX = "nba-dashboard:notes-import:v1:";

const readNotes = () => {
  if (typeof window === "undefined") return [];
  try {
    const raw = readLocalStorage(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeNotes = (notes) => {
  if (typeof window === "undefined") return;
  writeLocalStorage(STORAGE_KEY, JSON.stringify(notes));
};

export const loadNotes = () => readNotes();

export const loadNotesForGame = (gameId) =>
  readNotes().filter((note) => note.gameId === gameId);

export const saveNote = (note) => {
  const notes = readNotes();
  notes.push(note);
  writeNotes(notes);
  return notes;
};

export const deleteNote = (id) => {
  const notes = readNotes();
  const next = notes.filter((note) => note.id !== id);
  writeNotes(next);
  return next;
};

export const updateNote = (id, updates) => {
  const notes = readNotes();
  const next = notes.map((note) => (note.id === id ? { ...note, ...updates } : note));
  writeNotes(next);
  return next;
};

export const loadLegacyLocalNotes = () => readNotes();

export const countLegacyLocalNotes = () => readNotes().length;

export const hasLegacyLocalNotes = () => countLegacyLocalNotes() > 0;

export const readLegacyNoteImportState = (userId) => {
  if (typeof window === "undefined" || !userId) return null;
  try {
    const raw = readLocalStorage(`${IMPORT_STATE_PREFIX}${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

export const writeLegacyNoteImportState = (userId, state) => {
  if (typeof window === "undefined" || !userId) return;
  writeLocalStorage(`${IMPORT_STATE_PREFIX}${userId}`, JSON.stringify({
    ...state,
    updatedAt: Date.now(),
  }));
};
