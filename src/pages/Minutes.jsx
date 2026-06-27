import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { teamLogoUrl } from "../api.js";
import { getGamePollingInterval } from "../gamePolling.js";
import { useGame, useMinutes } from "../queries.js";
import { isTrackedGame } from "../teamConfig.js";
import { normalizeClock } from "../utils.js";
import styles from "./Minutes.module.css";

function normalizeActionText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
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

function parseSubstitutionPair(action) {
  const description = normalizeActionText(action?.description || "");
  const match = /\bSUB(?:STITUTION)?\s*:?\s*(.+?)\s+FOR\s+(.+?)\s*$/i.exec(description);
  if (!match) return null;
  return {
    inName: cleanSubName(match[1]),
    outName: cleanSubName(match[2]),
  };
}

function getActionPlayerName(action) {
  return normalizeActionText(
    action?.playerName ||
      action?.playerNameI ||
      action?.personName ||
      action?.name,
  );
}

function actionMatchesName(action, targetName) {
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

function buildSubstitutionAnnotationLookup(actions) {
  const lookup = new Map();
  (Array.isArray(actions) ? actions : []).forEach((action) => {
    const pair = parseSubstitutionPair(action);
    const personId = String(action?.personId || "");
    if (!pair || !personId) return;

    const subType = String(action?.subType || "").toLowerCase();
    const isIncomingAction = subType === "in" || (!subType && actionMatchesName(action, pair.inName));
    if (!isIncomingAction) return;

    const outgoingLastName = getLastName(pair.outName);
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

function StintCell({
  stint,
  isLast,
  view,
  period,
  awayTeamId,
  homeTeamId,
  substitutionLookup,
}) {
  const prevAway = new Set((stint.prevPlayersAway || []).map((player) => player.personId));
  const prevHome = new Set((stint.prevPlayersHome || []).map((player) => player.personId));
  const hasPrevAway = (stint.prevPlayersAway || []).length > 0;
  const hasPrevHome = (stint.prevPlayersHome || []).length > 0;

  const valueClass = (value) => {
    if (value > 0) return styles.valuePositive;
    if (value < 0) return styles.valueNegative;
    return styles.valueZero;
  };

  const displayPlusMinus = (() => {
    if (view === "away") return -(stint.plusMinus || 0);
    if (view === "neutral") return Math.abs(stint.plusMinus || 0);
    return stint.plusMinus || 0;
  })();

  const plusMinusLabel = view === "neutral"
    ? `${displayPlusMinus}`
    : `${displayPlusMinus > 0 ? "+" : ""}${displayPlusMinus}`;
  const formatSubbedInName = (player, teamId) => {
    const keyParts = {
      period,
      teamId,
      clock: stint.startClock,
      personId: player.personId,
    };
    const outgoingLastName = substitutionLookup.get(substitutionLookupKey(keyParts)) ||
      substitutionLookup.get(substitutionLookupKey({ ...keyParts, teamId: "" }));
    return outgoingLastName ? `${player.nameI} (${outgoingLastName})` : player.nameI;
  };

  return (
    <div className={`${styles.stintCell} ${isLast ? styles.lastCell : ""}`}>
      <div className={styles.stintHeader}>
        <span className={`${styles.timeValue} ${valueClass(displayPlusMinus)}`}>{stint.startClock}</span>
        <span className={`${styles.netValue} ${valueClass(displayPlusMinus)}`}>
          ({plusMinusLabel})
        </span>
      </div>
      <div className={styles.playersSection}>
        {stint.playersAway.map((player) => {
          const isSubbedIn = hasPrevAway && !prevAway.has(player.personId);
          return (
          <div
            key={player.personId}
            className={isSubbedIn ? styles.subbedIn : ""}
          >
            {isSubbedIn
              ? formatSubbedInName(player, awayTeamId)
              : player.nameI}
          </div>
          );
        })}
      </div>
      <div className={styles.playersSection}>
        {stint.playersHome.map((player) => {
          const isSubbedIn = hasPrevHome && !prevHome.has(player.personId);
          return (
          <div
            key={player.personId}
            className={isSubbedIn ? styles.subbedIn : ""}
          >
            {isSubbedIn
              ? formatSubbedInName(player, homeTeamId)
              : player.nameI}
          </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Minutes() {
  const { gameId } = useParams();
  const [params] = useSearchParams();
  const dateParam = params.get("d");
  const [view, setView] = useState("away");
  const { data: game, isLoading: isGameLoading } = useGame(gameId, {
    refetchInterval: (query) => getGamePollingInterval(query.state.data, {
      isTrackedGame: isTrackedGame(query.state.data),
    }),
    refetchIntervalInBackground: true,
  });
  const { data, isLoading, error } = useMinutes(gameId, {
    refetchInterval: (query) => getGamePollingInterval(query.state.data, {
      isTrackedGame: isTrackedGame(query.state.data),
    }),
    refetchIntervalInBackground: true,
  });
  const substitutionLookup = useMemo(
    () => buildSubstitutionAnnotationLookup(game?.playByPlayActions || []),
    [game?.playByPlayActions],
  );

  if (isLoading || (!game && isGameLoading)) {
    return <div className={styles.stateMessage}>Loading minutes data...</div>;
  }

  if (error || !data) {
    return <div className={styles.stateMessage}>Failed to load minutes data.</div>;
  }

  const { homeTeam, awayTeam, periods } = data;

  return (
    <div className={styles.container}>
      <div className={styles.backRow}>
        <Link className={styles.backButton} to={dateParam ? `/g/${gameId}?d=${dateParam}` : `/g/${gameId}`}>
          Back
        </Link>
      </div>
      <div className={styles.viewToggle}>
        <span>View:</span>
        {["away", "neutral", "home"].map((option) => (
          <button
            key={option}
            type="button"
            className={`${styles.viewButton} ${view === option ? styles.viewButtonActive : ""}`}
            onClick={() => setView(option)}
          >
            {option[0].toUpperCase() + option.slice(1)}
          </button>
        ))}
      </div>
      <section className={styles.header}>
        <div className={styles.teamSection}>
          <div className={styles.teamSummary}>
            <img className={styles.teamLogo} src={teamLogoUrl(awayTeam.teamId)} alt={`${awayTeam.teamName} logo`} />
            <div className={styles.teamScore}>{awayTeam.score}</div>
          </div>
        </div>
        <div className={styles.vs}>@</div>
        <div className={styles.teamSection}>
          <div className={styles.teamSummary}>
            <img className={styles.teamLogo} src={teamLogoUrl(homeTeam.teamId)} alt={`${homeTeam.teamName} logo`} />
            <div className={styles.teamScore}>{homeTeam.score}</div>
          </div>
        </div>
      </section>

      <section className={styles.periods}>
        {periods.map((period) => (
          <div key={period.period} className={styles.period}>
            <div className={styles.periodTitle}>{period.periodLabel}</div>
            <div className={styles.stintRow}>
              <div className={styles.teamLabels}>
                <div className={styles.labelSpacer} />
                <div className={styles.teamLabel}>
                  <img
                    className={styles.teamLabelLogo}
                    src={teamLogoUrl(awayTeam.teamId)}
                    alt={`${awayTeam.teamName} logo`}
                  />
                </div>
                <div className={styles.teamLabel}>
                  <img
                    className={styles.teamLabelLogo}
                    src={teamLogoUrl(homeTeam.teamId)}
                    alt={`${homeTeam.teamName} logo`}
                  />
                </div>
              </div>
              <div className={styles.stintsContainer}>
                {period.stints.map((stint, index) => (
                  <StintCell
                    key={`${period.period}-${index}`}
                    stint={stint}
                    isLast={index === period.stints.length - 1}
                    view={view}
                    period={period.period}
                    awayTeamId={awayTeam.teamId}
                    homeTeamId={homeTeam.teamId}
                    substitutionLookup={substitutionLookup}
                  />
                ))}
              </div>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
