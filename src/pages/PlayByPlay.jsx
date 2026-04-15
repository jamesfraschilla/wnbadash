import { useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { createNote } from "../accountData.js";
import PlayerHeadshot from "../components/PlayerHeadshot.jsx";
import { fetchGame, nbaEventVideoUrl, teamLogoUrl } from "../api.js";
import { useAuth } from "../auth/useAuth.js";
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

export default function PlayByPlay() {
  const { gameId } = useParams();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const dateParam = params.get("d");
  const [period, setPeriod] = useState(null);
  const [latestFirst, setLatestFirst] = useState(true);
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

  const { data: game, isLoading, error } = useQuery({
    queryKey: ["game", gameId],
    queryFn: () => fetchGame(gameId),
    enabled: Boolean(gameId),
    staleTime: 30_000,
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
    const list = period ? scoreTracked.filter((action) => action.period === period) : scoreTracked;
    return latestFirst ? [...list].reverse() : list;
  }, [scoreTracked, period, latestFirst]);

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
          const videoEventId =
            actionNumber != null ? (videoEventIdByActionNumber.get(actionNumber) ?? actionNumber) : null;
          const rowKey = actionNumber ?? `${action.period}-${index}`;
          const clipUrl = nbaEventVideoUrl({
            gameId,
            actionNumber: videoEventId,
            seasonYear: game.seasonYear,
            title: describePlayByPlayAction(action),
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
                    <span>{describePlayByPlayAction(action)}</span>
                    {action.personId && (
                      <PlayerHeadshot
                        personId={action.personId}
                        teamId={action.teamId}
                        alt={action.playerNameI || "player"}
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
                    {action.personId && (
                      <PlayerHeadshot
                        personId={action.personId}
                        teamId={action.teamId}
                        alt={action.playerNameI || "player"}
                        fallback={null}
                      />
                    )}
                    <span>{describePlayByPlayAction(action)}</span>
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
