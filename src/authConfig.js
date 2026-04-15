import { APP_KEY, PRIMARY_TEAM_SCOPE } from "./appConfig.js";

export const ACCOUNTS_ENABLED = import.meta.env.VITE_ENABLE_ACCOUNTS !== "false";
export const ALLOWED_EMAIL_DOMAIN = (import.meta.env.VITE_ALLOWED_EMAIL_DOMAIN || "monumentalsports.com")
  .replace(/^@/, "")
  .toLowerCase();

export const APP_AUTH_KEY = APP_KEY;
export const ACCOUNT_ROLES = ["admin", "coach"];
export const ACCOUNT_TEAM_SCOPES = [PRIMARY_TEAM_SCOPE];
export const ACCOUNT_FEATURE_FLAGS = [
  { key: "match_ups", label: "Match-Ups" },
  { key: "tools", label: "Tools" },
];

export function normalizeAccountEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function isAllowedAccountEmail(value) {
  const normalized = normalizeAccountEmail(value);
  return normalized.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}

export function buildAuthRedirectUrl() {
  if (typeof window === "undefined") return undefined;
  return `${window.location.origin}${window.location.pathname}`;
}
