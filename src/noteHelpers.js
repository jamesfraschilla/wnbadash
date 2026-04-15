import { nbaEventVideoUrl } from "./api.js";
import { normalizeClock } from "./utils.js";

export const NOTE_PERIOD_OPTIONS = ["--", "Q1", "Q2", "Q3", "Q4", "OT"];
export const NOTE_MINUTE_OPTIONS = ["--", ...Array.from({ length: 12 }, (_, idx) => String(idx))];
export const NOTE_SECOND_OPTIONS = ["--", ...Array.from({ length: 60 }, (_, idx) => String(idx).padStart(2, "0"))];
export const NOTE_TAG_OPTIONS = [
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

export function describePlayByPlayAction(action) {
  if (action?.description) return action.description;
  const parts = [];
  if (action?.playerNameI) parts.push(action.playerNameI);
  if (action?.descriptor) parts.push(action.descriptor);
  if (action?.subType) parts.push(action.subType);
  if (action?.shotResult) parts.push(String(action.shotResult).toLowerCase());
  return parts.join(" ").trim();
}

function stripParentheticalText(value) {
  return String(value || "")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function getNotePeriodLabel(periodNumber) {
  const numericPeriod = Number(periodNumber);
  if (!numericPeriod) return "--";
  return numericPeriod > 4 ? "OT" : `Q${numericPeriod}`;
}

export function buildDefaultNoteForm(game, isLive) {
  if (!isLive || !game?.period || !game?.gameClock) {
    return {
      period: "--",
      minutes: "--",
      seconds: "--",
      text: "",
      tags: [],
    };
  }

  const periodLabel = getNotePeriodLabel(game.period);
  const normalized = normalizeClock(game.gameClock);
  const [minRaw, secRaw] = normalized.split(":");
  if (!minRaw || !secRaw) {
    return {
      period: periodLabel,
      minutes: "--",
      seconds: "--",
      text: "",
      tags: [],
    };
  }

  return {
    period: periodLabel,
    minutes: String(Number(minRaw)),
    seconds: String(secRaw).padStart(2, "0"),
    text: "",
    tags: [],
  };
}

export function buildNoteFormFromAction(action) {
  const periodLabel = getNotePeriodLabel(action?.period);
  const normalized = normalizeClock(action?.clock);
  const [minRaw, secRaw] = normalized.split(":");

  return {
    period: periodLabel,
    minutes: minRaw ? String(Number(minRaw)) : "--",
    seconds: secRaw ? String(secRaw).padStart(2, "0") : "--",
    text: stripParentheticalText(describePlayByPlayAction(action)),
    tags: [],
  };
}

export function buildVideoEventIdByActionNumber(actions) {
  const eventMap = new Map();
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    const actionNumber = action?.actionNumber;
    if (actionNumber == null) continue;

    let videoEventId = actionNumber;
    if (action.actionType === "steal") {
      const clock = normalizeClock(action.clock);
      for (let scan = index - 1; scan >= 0 && index - scan <= 4; scan -= 1) {
        const previous = actions[scan];
        if (!previous || previous.period !== action.period) break;
        if (normalizeClock(previous.clock) !== clock) continue;
        if (previous.actionType === "turnover" && previous.actionNumber != null) {
          videoEventId = previous.actionNumber;
          break;
        }
      }
    }

    eventMap.set(actionNumber, videoEventId);
  }
  return eventMap;
}

export function buildPlayByPlaySourceMeta({ gameId, seasonYear, action, videoEventId }) {
  if (!gameId || !seasonYear || !action) return null;
  const actionNumber = action?.actionNumber ?? null;
  const resolvedVideoEventId = videoEventId ?? actionNumber;
  if (resolvedVideoEventId == null) return null;
  return {
    type: "pbp",
    action_number: actionNumber,
    video_event_id: resolvedVideoEventId,
    clip_url: nbaEventVideoUrl({
      gameId,
      actionNumber: resolvedVideoEventId,
      seasonYear,
      title: describePlayByPlayAction(action),
    }),
  };
}
