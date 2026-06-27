import { normalizeClock } from "./utils.js";

export function normalizeActionText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getRawActionDescription(action, describeAction = null) {
  if (typeof describeAction === "function") {
    return normalizeActionText(describeAction(action));
  }
  return normalizeActionText(
    action?.description ||
      action?.officialDescription ||
      action?.displayDescription ||
      action?.actionType ||
      "",
  );
}

export function getActionDescription(action, describeAction = null) {
  return normalizeActionText(action?.displayDescription || getRawActionDescription(action, describeAction));
}

export function isSubstitutionAction(action, describeAction = null) {
  const actionType = String(action?.actionType || "").toLowerCase();
  const subType = String(action?.subType || "").toLowerCase();
  const description = getRawActionDescription(action, describeAction).toLowerCase();
  return actionType.includes("substitution") ||
    actionType === "sub" ||
    subType === "in" ||
    subType === "out" ||
    /\bsub(?:stitution)?\b/.test(description);
}

export function cleanSubName(value) {
  return normalizeActionText(value)
    .replace(/\s*\([^)]*\).*$/g, "")
    .replace(/^sub(?:stitution)?\s*:?\s*/i, "")
    .replace(/^in\s*:?\s*/i, "")
    .replace(/^out\s*:?\s*/i, "")
    .trim();
}

export function normalizeNameForMatch(value) {
  return cleanSubName(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function getSubstitutionLastName(value) {
  const cleaned = cleanSubName(value);
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const suffixes = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
  const last = parts[parts.length - 1].replace(/\./g, "").toLowerCase();
  if (suffixes.has(last) && parts.length >= 2) {
    return `${parts[parts.length - 2]} ${parts[parts.length - 1]}`;
  }
  if (parts.length === 2 && /^[A-Z]\.$/.test(parts[0])) return parts[1];
  return parts[parts.length - 1];
}

export function getActionPlayerName(action) {
  return normalizeActionText(
    action?.playerName ||
      action?.playerNameI ||
      action?.personName ||
      action?.name,
  );
}

export function actionMatchesPlayerName(action, targetName) {
  const playerName = normalizeNameForMatch(getActionPlayerName(action));
  const target = normalizeNameForMatch(targetName);
  const targetLast = normalizeNameForMatch(getSubstitutionLastName(targetName));
  if (!playerName || (!target && !targetLast)) return false;
  return playerName === target ||
    playerName.endsWith(` ${target}`) ||
    playerName.includes(target) ||
    playerName === targetLast ||
    playerName.endsWith(` ${targetLast}`);
}

export function parseSubstitutionAction(action, describeAction = null) {
  if (!isSubstitutionAction(action, describeAction)) return null;
  const description = getRawActionDescription(action, describeAction);
  const pairMatch = /\bSUB(?:STITUTION)?\s*:?\s*(.+?)\s+FOR\s+(.+?)\s*$/i.exec(description);
  if (pairMatch) {
    return {
      kind: "pair",
      inName: cleanSubName(pairMatch[1]),
      outName: cleanSubName(pairMatch[2]),
    };
  }

  const inMatch = /\bSUB(?:STITUTION)?\s+in\s*:?\s*(.+?)\s*$/i.exec(description);
  if (inMatch) {
    return { kind: "single", direction: "in", name: cleanSubName(inMatch[1]) };
  }

  const outMatch = /\bSUB(?:STITUTION)?\s+out\s*:?\s*(.+?)\s*$/i.exec(description);
  if (outMatch) {
    return { kind: "single", direction: "out", name: cleanSubName(outMatch[1]) };
  }

  const subType = String(action?.subType || "").toLowerCase();
  if (subType === "in" || subType === "out") {
    return { kind: "single", direction: subType, name: getActionPlayerName(action) };
  }

  return null;
}

function normalizeSubstitutionClock(clock) {
  const normalized = normalizeClock(String(clock || ""));
  const [minutes, seconds] = normalized.split(":");
  if (seconds == null) return normalized;
  const minuteNumber = Number(minutes);
  return `${Number.isFinite(minuteNumber) ? minuteNumber : minutes}:${String(seconds).padStart(2, "0")}`;
}

function substitutionLookupKey({ period, teamId, clock, personId }) {
  return [
    Number(period) || 0,
    String(teamId || ""),
    normalizeSubstitutionClock(clock),
    String(personId || ""),
  ].join("|");
}

function sameSubstitutionMoment(left, right) {
  return String(left?.teamId || "") === String(right?.teamId || "") &&
    Number(left?.period || 0) === Number(right?.period || 0) &&
    normalizeSubstitutionClock(left?.clock) === normalizeSubstitutionClock(right?.clock);
}

function sameSubstitutionPair(left, right) {
  return left?.kind === "pair" &&
    right?.kind === "pair" &&
    normalizeNameForMatch(left.inName) === normalizeNameForMatch(right.inName) &&
    normalizeNameForMatch(left.outName) === normalizeNameForMatch(right.outName);
}

function buildSubstitutionDisplayAction(baseAction, substitution, candidateActions, displayKey) {
  const incomingAction = candidateActions.find((candidate) => (
    String(candidate?.subType || "").toLowerCase() === "in" &&
    actionMatchesPlayerName(candidate, substitution.inName)
  )) || candidateActions.find((candidate) => actionMatchesPlayerName(candidate, substitution.inName)) || baseAction;

  return {
    ...incomingAction,
    currentAwayScore: baseAction.currentAwayScore,
    currentHomeScore: baseAction.currentHomeScore,
    scoringEvent: false,
    displayDescription: `SUB: ${getSubstitutionLastName(substitution.inName)} FOR ${getSubstitutionLastName(substitution.outName)}`,
    displayPersonId: incomingAction?.personId || baseAction?.personId,
    displayPlayerNameI: incomingAction?.playerNameI || incomingAction?.playerName || substitution.inName,
    displayKey,
    isSubstitutionDisplay: true,
  };
}

export function collapseSubstitutionActions(actions, options = {}) {
  const collapsed = [];
  const usedIndexes = new Set();
  const describeAction = options.describeAction || null;

  actions.forEach((action, index) => {
    if (usedIndexes.has(index)) return;
    const parsed = parseSubstitutionAction(action, describeAction);
    if (!parsed) {
      collapsed.push(action);
      return;
    }

    const momentEntries = actions
      .map((candidate, candidateIndex) => ({
        action: candidate,
        index: candidateIndex,
        parsed: parseSubstitutionAction(candidate, describeAction),
      }))
      .filter((entry) => (
        !usedIndexes.has(entry.index) &&
        entry.parsed &&
        sameSubstitutionMoment(action, entry.action)
      ));

    if (parsed.kind === "pair") {
      const pairEntries = momentEntries.filter((entry) => sameSubstitutionPair(parsed, entry.parsed));
      pairEntries.forEach((entry) => usedIndexes.add(entry.index));
      collapsed.push(buildSubstitutionDisplayAction(
        action,
        parsed,
        pairEntries.map((entry) => entry.action),
        `sub-${action.period}-${normalizeSubstitutionClock(action.clock)}-${action.teamId}-${normalizeNameForMatch(parsed.inName)}-${normalizeNameForMatch(parsed.outName)}`,
      ));
      return;
    }

    const singleEntries = momentEntries.filter((entry) => entry.parsed?.kind === "single");
    const incomingEntries = singleEntries.filter((entry) => entry.parsed.direction === "in");
    const outgoingEntries = singleEntries.filter((entry) => entry.parsed.direction === "out");
    const pairCount = Math.max(incomingEntries.length, outgoingEntries.length);

    singleEntries.forEach((entry) => usedIndexes.add(entry.index));
    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      const incoming = incomingEntries[pairIndex];
      const outgoing = outgoingEntries[pairIndex];
      if (!incoming || !outgoing) {
        collapsed.push((incoming || outgoing).action);
        continue;
      }
      collapsed.push(buildSubstitutionDisplayAction(
        incoming.action,
        {
          kind: "pair",
          inName: incoming.parsed.name,
          outName: outgoing.parsed.name,
        },
        [incoming.action, outgoing.action],
        `sub-${incoming.action.period}-${normalizeSubstitutionClock(incoming.action.clock)}-${incoming.action.teamId}-${pairIndex}`,
      ));
    }
  });

  return collapsed;
}

export function buildSubstitutionAnnotationLookup(actions, options = {}) {
  const lookup = new Map();
  const describeAction = options.describeAction || null;

  (Array.isArray(actions) ? actions : []).forEach((action) => {
    const pair = parseSubstitutionAction(action, describeAction);
    const personId = String(action?.personId || "");
    if (!pair || pair.kind !== "pair" || !personId) return;

    const subType = String(action?.subType || "").toLowerCase();
    const isIncomingAction = subType === "in" || (!subType && actionMatchesPlayerName(action, pair.inName));
    if (!isIncomingAction) return;

    const outgoingLastName = getSubstitutionLastName(pair.outName);
    if (!outgoingLastName) return;

    const keyParts = {
      period: action.period,
      teamId: action.teamId,
      clock: action.clock,
      personId,
    };
    lookup.set(substitutionLookupKey(keyParts), outgoingLastName);
    lookup.set(substitutionLookupKey({ ...keyParts, teamId: "" }), outgoingLastName);
  });
  return lookup;
}

export function getSubstitutionAnnotation(lookup, keyParts) {
  if (!lookup) return "";
  return lookup.get(substitutionLookupKey(keyParts)) ||
    lookup.get(substitutionLookupKey({ ...keyParts, teamId: "" })) ||
    "";
}
