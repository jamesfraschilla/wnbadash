import { useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { createNote } from "../accountData.js";
import PlayerHeadshot from "../components/PlayerHeadshot.jsx";
import { nbaEventVideoUrl, teamLogoUrl } from "../api.js";
import { getGamePollingInterval } from "../gamePolling.js";
import { useGame } from "../queries.js";
import { useAuth } from "../auth/useAuth.js";
import { isTrackedGame } from "../teamConfig.js";
import {
  buildNoteFormFromAction,
  buildPlayByPlaySourceMeta,
  buildVideoEventIdByActionNumber,
  describePlayByPlayAction,
  NOTE_MINUTE_OPTIONS,
  NOTE_PERIOD_OPTIONS,
  NOTE_SECOND_OPTIONS,
  NOTE_TAG_OPTIONS,
} from "../noteHelpers.js";
import { normalizeClock } from "../utils.js";
import styles from "./PlayByPlay.module.css";

function shouldShowClip(action) {
  const actionText = [
    action?.actionType,
    action?.foulType,
    action?.subType,
    action?.descriptor,
    action?.description,
    action?.officialDescription,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const isBasketAttempt =
    (action.actionType === "2pt" || action.actionType === "3pt") &&
    (action.shotResult === "Made" || action.shotResult === "Missed");
  if (isBasketAttempt) return true;
  if (action.actionType === "turnover") return true;
  if (actionText.includes("goaltend")) return true;
  if (actionText.includes("flagrant 1") || actionText.includes("flagrant 2")) return true;

  if (action.actionType !== "foul") return false;
  return actionText.includes("shooting");
}

function normalizeActionText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getActionDescription(action) {
  return normalizeActionText(action?.displayDescription || describePlayByPlayAction(action));
}

function getRawActionDescription(action) {
  return normalizeActionText(describePlayByPlayAction(action));
}

function isSubstitutionAction(action) {
  const actionType = String(action?.actionType || "").toLowerCase();
  const subType = String(action?.subType || "").toLowerCase();
  const description = getRawActionDescription(action).toLowerCase();
  return actionType.includes("substitution") ||
    actionType === "sub" ||
    subType === "in" ||
    subType === "out" ||
    /\bsub(?:stitution)?\b/.test(description);
}

function cleanSubName(value) {
  return normalizeActionText(value)
    .replace(/\s*\([^)]*\).*$/g, "")
    .replace(/^sub(?:stitution)?\s*:?\s*/i, "")
    .replace(/^in\s*:?\s*/i, "")
    .replace(/^out\s*:?\s*/i, "")
    .trim();
}

function normalizeNameForMatch(value) {
  return cleanSubName(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getLastName(value) {
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

function getActionPlayerName(action) {
  return normalizeActionText(
    action?.playerName ||
      action?.playerNameI ||
      action?.personName ||
      action?.name,
  );
}

function actionMatchesPlayerName(action, targetName) {
  const playerName = normalizeNameForMatch(getActionPlayerName(action));
  const target = normalizeNameForMatch(targetName);
  const targetLast = normalizeNameForMatch(getLastName(targetName));
  if (!playerName || (!target && !targetLast)) return false;
  return playerName === target ||
    playerName.endsWith(` ${target}`) ||
    playerName.includes(target) ||
    playerName === targetLast ||
    playerName.endsWith(` ${targetLast}`);
}

function parseSubstitutionAction(action) {
  if (!isSubstitutionAction(action)) return null;
  const description = getRawActionDescription(action);
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

function sameSubstitutionMoment(left, right) {
  return String(left?.teamId || "") === String(right?.teamId || "") &&
    Number(left?.period || 0) === Number(right?.period || 0) &&
    String(left?.clock || "") === String(right?.clock || "");
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
    displayDescription: `SUB: ${getLastName(substitution.inName)} FOR ${getLastName(substitution.outName)}`,
    displayPersonId: incomingAction?.personId || baseAction?.personId,
    displayPlayerNameI: incomingAction?.playerNameI || incomingAction?.playerName || substitution.inName,
    displayKey,
    isSubstitutionDisplay: true,
  };
}

function collapseSubstitutionActions(actions) {
  const collapsed = [];
  const usedIndexes = new Set();

  actions.forEach((action, index) => {
    if (usedIndexes.has(index)) return;
    const parsed = parseSubstitutionAction(action);
    if (!parsed) {
      collapsed.push(action);
      return;
    }

    const momentEntries = actions
      .map((candidate, candidateIndex) => ({
        action: candidate,
        index: candidateIndex,
        parsed: parseSubstitutionAction(candidate),
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
        `sub-${action.period}-${action.clock}-${action.teamId}-${normalizeNameForMatch(parsed.inName)}-${normalizeNameForMatch(parsed.outName)}`,
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
        `sub-${incoming.action.period}-${incoming.action.clock}-${incoming.action.teamId}-${pairIndex}`,
      ));
    }
  });

  return collapsed;
}

export default function PlayByPlay() {
  const { gameId } = useParams();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const dateParam = params.get("d");
  const [period, setPeriod] = useState(null);
  const [latestFirst, setLatestFirst] = useState(true);
  const [substitutionsOnly, setSubstitutionsOnly] = useState(false);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [savingNewNote, setSavingNewNote] = useState(false);
  const [noteSourceAction, setNoteSourceAction] = useState(null);
  const [noteForm, setNoteForm] = useState({
    period: "--",
    minutes: "--",
    seconds: "--",
    text: "",
    tags: [],
  });
  const holdTimerRef = useRef(null);
  const holdTargetRef = useRef(null);

  const { data: game, isLoading, error } = useGame(gameId, {
    refetchInterval: (query) => getGamePollingInterval(query.state.data, {
      isTrackedGame: isTrackedGame(query.state.data),
    }),
    refetchIntervalInBackground: true,
  });

  const actions = game?.playByPlayActions || [];

  const scoreTracked = useMemo(() => {
    let awayScore = 0;
    let homeScore = 0;
    return actions.map((action) => {
      let scoringEvent = false;
      if (action.shotResult === "Made") {
        const points =
          action.actionType === "3pt" ? 3 : action.actionType === "2pt" ? 2 : action.actionType === "freethrow" ? 1 : 0;
        if (points) {
          scoringEvent = true;
          if (action.teamId === game?.awayTeam?.teamId) awayScore += points;
          if (action.teamId === game?.homeTeam?.teamId) homeScore += points;
        }
      }
      return { ...action, currentAwayScore: awayScore, currentHomeScore: homeScore, scoringEvent };
    });
  }, [actions, game?.awayTeam?.teamId, game?.homeTeam?.teamId]);

  const filtered = useMemo(() => {
    const collapsedActions = collapseSubstitutionActions(scoreTracked);
    const periodFiltered = period ? collapsedActions.filter((action) => action.period === period) : collapsedActions;
    const list = substitutionsOnly
      ? periodFiltered.filter((action) => action.isSubstitutionDisplay || isSubstitutionAction(action))
      : periodFiltered;
    return latestFirst ? [...list].reverse() : list;
  }, [scoreTracked, period, latestFirst, substitutionsOnly]);

  const videoEventIdByActionNumber = useMemo(() => buildVideoEventIdByActionNumber(actions), [actions]);

  const clearHoldTimer = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    holdTargetRef.current = null;
  };

  const openAddNoteForAction = (action) => {
    if (!action) return;
    setNoteSourceAction(action);
    setNoteForm(buildNoteFormFromAction(action));
    setNoteModalOpen(true);
  };

  const closeAddNote = () => {
    setNoteModalOpen(false);
    setSavingNewNote(false);
    setNoteSourceAction(null);
  };

  const saveNewNote = async () => {
    if (!gameId || !noteSourceAction || savingNewNote) return;
    const minutesValue = noteForm.minutes === "--" ? null : Number(noteForm.minutes);
    const secondsValue = noteForm.seconds === "--" ? null : Number(noteForm.seconds);
    const payload = {
      gameId,
      periodLabel: noteForm.period === "--" ? null : noteForm.period,
      minutes: Number.isNaN(minutesValue) ? null : minutesValue,
      seconds: Number.isNaN(secondsValue) ? null : secondsValue,
      text: String(noteForm.text || "").trim(),
      tags: Array.isArray(noteForm.tags) ? noteForm.tags : [],
      sourceMeta: buildPlayByPlaySourceMeta({
        gameId,
        seasonYear: game?.seasonYear,
        action: noteSourceAction,
        videoEventId: videoEventIdByActionNumber.get(noteSourceAction.actionNumber),
      }),
    };

    try {
      setSavingNewNote(true);
      await createNote(payload, user?.id);
      closeAddNote();
    } catch (saveError) {
      setSavingNewNote(false);
      window.alert(saveError?.message || "Unable to save note.");
    }
  };

  const handleHoldStart = (action) => () => {
    if (!action) return;
    clearHoldTimer();
    holdTargetRef.current = action;
    holdTimerRef.current = setTimeout(() => {
      if (holdTargetRef.current === action) {
        openAddNoteForAction(action);
      }
      clearHoldTimer();
    }, 450);
  };

  const handleHoldEnd = () => {
    clearHoldTimer();
  };

  if (isLoading) {
    return <div className={styles.stateMessage}>Loading events...</div>;
  }

  if (error || !game) {
    return <div className={styles.stateMessage}>Error loading game data</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.backRow}>
        <Link className={styles.backButton} to={dateParam ? `/g/${gameId}?d=${dateParam}` : `/g/${gameId}`}>
          Back
        </Link>
      </div>
      <h1 className={styles.title}>Play-by-Play Events</h1>
      <div className={styles.subtitle}>
        <img
          className={styles.subtitleLogo}
          src={teamLogoUrl(game.awayTeam?.teamId)}
          alt={`${game.awayTeam?.teamName || "Away team"} logo`}
        />
        <span className={styles.subtitleAt}>@</span>
        <img
          className={styles.subtitleLogo}
          src={teamLogoUrl(game.homeTeam?.teamId)}
          alt={`${game.homeTeam?.teamName || "Home team"} logo`}
        />
      </div>

      <div className={styles.controls}>
        <span>Total Events: {filtered.length}</span>
        <label className={styles.toggle}>
          <span>Latest First</span>
          <input
            type="checkbox"
            checked={latestFirst}
            onChange={(event) => setLatestFirst(event.target.checked)}
          />
        </label>
        <label className={styles.toggle}>
          <span>Substitutions Only</span>
          <input
            type="checkbox"
            checked={substitutionsOnly}
            onChange={(event) => setSubstitutionsOnly(event.target.checked)}
          />
        </label>
      </div>

      <div className={styles.periodButtons}>
        <button
          type="button"
          className={!period ? styles.active : ""}
          onClick={() => setPeriod(null)}
        >
          All
        </button>
        {[1, 2, 3, 4].map((p) => (
          <button
            key={p}
            type="button"
            className={period === p ? styles.active : ""}
            onClick={() => setPeriod(p)}
          >
            Q{p}
          </button>
        ))}
      </div>

      <div className={styles.eventsWrapper}>
        <div className={styles.headerRow}>
          <div className={styles.teamHeader}>
            <span>{game.awayTeam.teamName}</span>
            <img src={teamLogoUrl(game.awayTeam.teamId)} alt={game.awayTeam.teamName} />
          </div>
          <div className={styles.centerHeader} />
          <div className={styles.teamHeader}>
            <img src={teamLogoUrl(game.homeTeam.teamId)} alt={game.homeTeam.teamName} />
            <span>{game.homeTeam.teamName}</span>
          </div>
        </div>

        {filtered.map((action, index) => {
          const isAway = action.teamId === game.awayTeam?.teamId;
          const isHome = action.teamId === game.homeTeam?.teamId;
          const isTimeout = action.actionType === "timeout";
          const actionNumber = action.actionNumber ?? null;
          const actionDescription = getActionDescription(action);
          const displayPersonId = action.displayPersonId || action.personId;
          const displayPlayerName = action.displayPlayerNameI || action.playerNameI || action.playerName || "player";
          const videoEventId =
            actionNumber != null ? (videoEventIdByActionNumber.get(actionNumber) ?? actionNumber) : null;
          const rowKey = action.displayKey ?? actionNumber ?? `${action.period}-${index}`;
          const clipUrl = nbaEventVideoUrl({
            gameId,
            actionNumber: videoEventId,
            seasonYear: game.seasonYear,
            title: actionDescription,
          });
          const showClip = shouldShowClip(action);
          return (
            <div
              key={rowKey}
              className={`${styles.eventRow} ${isTimeout ? styles.timeout : ""}`}
              onPointerDown={handleHoldStart(action)}
              onPointerUp={handleHoldEnd}
              onPointerLeave={handleHoldEnd}
              onPointerCancel={handleHoldEnd}
              onContextMenu={(event) => event.preventDefault()}
            >
              <div className={styles.awayColumn}>
                {isAway && (
                  <div className={`${styles.eventContent} ${action.scoringEvent ? styles.scoring : ""}`}>
                    <span>{actionDescription}</span>
                    {displayPersonId && (
                      <PlayerHeadshot
                        personId={displayPersonId}
                        teamId={action.teamId}
                        alt={displayPlayerName}
                        fallback={null}
                      />
                    )}
                  </div>
                )}
              </div>
              <div className={styles.centerColumn}>
                <div className={styles.clock}>{normalizeClock(action.clock)}</div>
                <div className={styles.score}>
                  {action.currentAwayScore} - {action.currentHomeScore}
                </div>
                {showClip && clipUrl ? (
                  <a
                    className={styles.clipLink}
                    href={clipUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Play clip"
                    title="Play clip"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <span className={styles.playIcon} aria-hidden="true" />
                  </a>
                ) : null}
              </div>
              <div className={styles.homeColumn}>
                {isHome && (
                  <div className={`${styles.eventContent} ${action.scoringEvent ? styles.scoring : ""}`}>
                    {displayPersonId && (
                      <PlayerHeadshot
                        personId={displayPersonId}
                        teamId={action.teamId}
                        alt={displayPlayerName}
                        fallback={null}
                      />
                    )}
                    <span>{actionDescription}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {noteModalOpen && (
        <div className={styles.noteOverlay} onClick={closeAddNote}>
          <div
            className={styles.noteModal}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h3>Add Note From Play</h3>
            <div className={styles.noteTimeRow}>
              <div className={styles.noteTimeLabel}>Time left</div>
              <div className={styles.noteTimeControls}>
                <select
                  className={styles.noteSelect}
                  value={noteForm.period}
                  onChange={(event) =>
                    setNoteForm((prev) => ({ ...prev, period: event.target.value }))
                  }
                >
                  {NOTE_PERIOD_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <div className={styles.noteClockSelects}>
                  <select
                    className={styles.noteSelect}
                    value={noteForm.minutes}
                    onChange={(event) =>
                      setNoteForm((prev) => ({ ...prev, minutes: event.target.value }))
                    }
                  >
                    {NOTE_MINUTE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <span className={styles.noteClockSeparator}>:</span>
                  <select
                    className={styles.noteSelect}
                    value={noteForm.seconds}
                    onChange={(event) =>
                      setNoteForm((prev) => ({ ...prev, seconds: event.target.value }))
                    }
                  >
                    {NOTE_SECOND_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <details className={styles.noteTags}>
              <summary>Tags</summary>
              <div className={styles.noteTagsGrid}>
                {NOTE_TAG_OPTIONS.map((tag) => {
                  const checked = noteForm.tags.includes(tag);
                  return (
                    <label key={tag} className={styles.noteTagOption}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const next = event.target.checked
                            ? [...noteForm.tags, tag]
                            : noteForm.tags.filter((value) => value !== tag);
                          setNoteForm((prev) => ({ ...prev, tags: next }));
                        }}
                      />
                      <span>{tag}</span>
                    </label>
                  );
                })}
              </div>
            </details>
            <textarea
              value={noteForm.text}
              onChange={(event) => setNoteForm((prev) => ({ ...prev, text: event.target.value }))}
              placeholder="Add context for this play..."
              rows={4}
            />
            <div className={styles.noteActions}>
              <button type="button" className={styles.noteCancel} onClick={closeAddNote} disabled={savingNewNote}>
                Cancel
              </button>
              <button type="button" className={styles.noteSave} onClick={saveNewNote} disabled={savingNewNote}>
                {savingNewNote ? "Saving..." : "OK"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
