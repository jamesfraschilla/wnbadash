import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchGamesByDate, filterGamesByLeague, teamLogoUrl } from "../api.js";
import { formatDateInput, formatDateLabel, formatTipTime, gameStatusLabel, normalizeClock, parseDateInput } from "../utils.js";
import styles from "./Home.module.css";

export default function Home() {
  const [params] = useSearchParams();
  const dateParam = params.get("d");
  const date = dateParam ? parseDateInput(dateParam) : new Date();
  const dateInput = formatDateInput(date);
  const dateLabel = formatDateLabel(date);
  const [, setParams] = useSearchParams();

  const { data: games = [], isLoading, error } = useQuery({
    queryKey: ["games", dateInput],
    queryFn: () => fetchGamesByDate(dateInput),
    refetchInterval: (query) =>
      query.state.data?.some((game) => game.gameStatus === 2) ? 30_000 : false,
    refetchIntervalInBackground: true,
  });

  const wnbaGames = useMemo(() => filterGamesByLeague(games, "wnba"), [games]);

  if (isLoading) {
    return <div className={styles.stateMessage}>Loading games...</div>;
  }

  if (error) {
    return <div className={styles.stateMessage}>Failed to load games.</div>;
  }

  if (!wnbaGames.length) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.stateMessage}>No games scheduled for this date.</div>
        <Link className={styles.testLink} to="/tests">
          Open Historical Test Dashboards
        </Link>
      </div>
    );
  }

  const changeDateBy = (deltaDays) => {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + deltaDays);
    const nextParams = new URLSearchParams(params);
    nextParams.set("d", formatDateInput(next));
    setParams(nextParams);
  };

  const renderGames = (list) =>
    list.map((game) => {
      const status = gameStatusLabel(game);
      const isLive = game.gameStatus === 2;
      const scoreVisible = game.gameStatus === 2 || game.gameStatus === 3;
      const clock = isLive ? normalizeClock(game.gameClock) : "";
      const tipTime = !isLive && game.gameStatus !== 3
        ? formatTipTime(game.gameTimeUTC, game.gameStatusText || game.gameEt)
        : "";

      return (
        <Link
          key={game.gameId}
          className={styles.gameCard}
          to={`/g/${game.gameId}${dateParam ? `?d=${dateParam}` : ""}`}
        >
          <div className={styles.mainContent}>
            <div className={styles.teams}>
              {[game.awayTeam, game.homeTeam].map((team) => (
                <div key={team.teamId} className={styles.teamRow}>
                  <div
                    className={styles.teamLogo}
                    style={{ backgroundImage: `url(${teamLogoUrl(team.teamId)})` }}
                  />
                  <div className={styles.teamInfo}>
                    <div className={styles.teamHeader}>
                      <div className={styles.teamTricode}>{team.teamTricode}</div>
                      {scoreVisible && <div className={styles.score}>{team.score}</div>}
                    </div>
                    <div className={styles.teamRecord}>
                      {team.wins}-{team.losses}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.statusContainer}>
              {status ? (
                <div className={styles.statusStacked}>
                  <div className={`${styles.statusLabel} ${isLive ? styles.live : ""}`}>{status}</div>
                  {clock && (
                    <div className={`${styles.statusLabel} ${isLive ? styles.live : ""}`}>{clock}</div>
                  )}
                </div>
              ) : (
                <div className={styles.statusLabel}>{tipTime}</div>
              )}
            </div>
          </div>
          <div className={styles.gameInfo}>
            <span className={styles.arena}>{game.arena?.arenaName || ""}</span>
          </div>
        </Link>
      );
    });

  return (
    <div className={styles.container}>
      <div className={styles.dateNav}>
        <button type="button" className={styles.dateButton} onClick={() => changeDateBy(-1)}>
          Prev
        </button>
        <div className={styles.dateLabel}>{dateLabel}</div>
        <button type="button" className={styles.dateButton} onClick={() => changeDateBy(1)}>
          Next
        </button>
        <Link className={styles.testLinkInline} to="/tests">
          Historical Tests
        </Link>
      </div>
      <div className={styles.gameList}>{renderGames(wnbaGames)}</div>
    </div>
  );
}
