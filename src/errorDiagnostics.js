import { readLocalStorage, writeLocalStorage } from "./storage.js";

const ERROR_LOG_KEY = "nba-dashboard:error-log:v1";
const MAX_ERROR_LOG_ENTRIES = 50;

function normalizeErrorEntry(entry) {
  return {
    message: String(entry?.message || "Unknown error"),
    source: String(entry?.source || "runtime"),
    route: String(entry?.route || ""),
    userAgent: String(entry?.userAgent || ""),
    timestamp: Number(entry?.timestamp || Date.now()),
  };
}

export function recordClientError(entry) {
  try {
    const raw = readLocalStorage(ERROR_LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(parsed) ? parsed : [];
    next.push(normalizeErrorEntry(entry));
    writeLocalStorage(ERROR_LOG_KEY, JSON.stringify(next.slice(-MAX_ERROR_LOG_ENTRIES)));
  } catch {
    // Ignore diagnostics write failures.
  }
}
