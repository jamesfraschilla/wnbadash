import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMinutes, teamLogoUrl } from "../api.js";
import styles from "./Minutes.module.css";

function StintCell({ stint, isLast, view }) {
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

  return (
    <div className={`${styles.stintCell} ${isLast ? styles.lastCell : ""}`}>
      <div className={styles.stintHeader}>
        <span className={`${styles.timeValue} ${valueClass(displayPlusMinus)}`}>{stint.startClock}</span>
        <span className={`${styles.netValue} ${valueClass(displayPlusMinus)}`}>
          ({plusMinusLabel})
        </span>
      </div>
      <div className={styles.playersSection}>
        {stint.playersAway.map((player) => (
          <div
            key={player.personId}
            className={hasPrevAway && !prevAway.has(player.personId) ? styles.subbedIn : ""}
          >
            {player.nameI}
          </div>
        ))}
      </div>
      <div className={styles.playersSection}>
        {stint.playersHome.map((player) => (
          <div
            key={player.personId}
            className={hasPrevHome && !prevHome.has(player.personId) ? styles.subbedIn : ""}
          >
            {player.nameI}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Minutes() {
  const { gameId } = useParams();
  const [params] = useSearchParams();
  const dateParam = params.get("d");
  const [view, setView] = useState("away");
  const { data, isLoading, error } = useQuery({
    queryKey: ["minutes", gameId],
    queryFn: () => fetchMinutes(gameId),
    enabled: Boolean(gameId),
  });

  if (isLoading) {
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
