import { createClient } from "@supabase/supabase-js";
import { APP_KEY } from "./appConfig.js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const AUTH_STORAGE_KEY = `${APP_KEY}-auth`;
const STORAGE_EVICTION_PREFIXES = [
  `${APP_KEY}-season-games:`,
  `${APP_KEY}:match-ups:`,
  "pregame:players:v2:",
  "pregame:players:v1",
];

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.warn("Supabase env vars are missing. Highlights will be disabled.");
}

function safeReadStorage(storage, key) {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeRemoveStorage(storage, key) {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignore restrictive browser storage failures.
  }
}

function parseStoredAuthValue(rawValue) {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue);
    const currentSession = parsed?.currentSession;
    const expiresAt = Number(
      currentSession?.expires_at
      || currentSession?.expiresAt
      || parsed?.expires_at
      || parsed?.expiresAt
      || 0
    );
    return {
      rawValue,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
    };
  } catch {
    return {
      rawValue,
      expiresAt: 0,
    };
  }
}

const browserStorage = typeof window !== "undefined"
  ? {
    getItem(key) {
      const localValue = safeReadStorage(window.localStorage, key);
      const sessionValue = safeReadStorage(window.sessionStorage, key);
      const localEntry = parseStoredAuthValue(localValue);
      const sessionEntry = parseStoredAuthValue(sessionValue);

      if (localEntry && sessionEntry) {
        return sessionEntry.expiresAt > localEntry.expiresAt
          ? sessionEntry.rawValue
          : localEntry.rawValue;
      }

      return localEntry?.rawValue ?? sessionEntry?.rawValue ?? null;
    },
    setItem(key, value) {
      try {
        window.localStorage.setItem(key, value);
        safeRemoveStorage(window.sessionStorage, key);
      } catch (error) {
        const isQuotaError = error?.name === "QuotaExceededError"
          || error?.name === "NS_ERROR_DOM_QUOTA_REACHED"
          || error?.code === 22
          || error?.code === 1014;

        if (!isQuotaError) throw error;

        STORAGE_EVICTION_PREFIXES.forEach((prefix) => {
          Object.keys(window.localStorage)
            .filter((storageKey) => storageKey.startsWith(prefix))
            .forEach((storageKey) => safeRemoveStorage(window.localStorage, storageKey));
        });

        try {
          window.localStorage.setItem(key, value);
          safeRemoveStorage(window.sessionStorage, key);
          return;
        } catch (retryError) {
          if (window.sessionStorage) {
            window.sessionStorage.setItem(key, value);
            return;
          }
          throw retryError;
        }
      }
    },
    removeItem(key) {
      safeRemoveStorage(window.localStorage, key);
      safeRemoveStorage(window.sessionStorage, key);
    },
  }
  : undefined;

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storageKey: AUTH_STORAGE_KEY,
      storage: browserStorage,
    },
  })
  : null;
