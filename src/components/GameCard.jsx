import { Link, useSearchParams } from "react-router-dom";
import { formatTipTime, gameStatusLabel, normalizeClock } from "../utils.js";
import styles from "./GameCard.module.css";

export default function GameCard({ game }) {
  const [params] = useSearchParams();
  const dateParam = params.get("d");
  const href = dateParam ? `/g/${game.gameId}?d=${dateParam}` : `/g/${game.gameId}`;

  const status = gameStatusLabel(game);
  const isFinal = game.gameStatus === 3 || (game.gameStatusText || "").toLowerCase().includes("final");
  const isLive = game.gameStatus === 2;

  const timeLabel = isLive ? normalizeClock(game.gameClock) : formatTipTime(game.gameTimeUTC, game.gameEt);

  return (
    <Link to={href} className={styles.gameLink}>
      <div className={styles.gameCard}>
        <div className={styles.gameContent}>
          <div className={styles.teamTricodes}>
            <span className={styles.teamTricode}>{game.awayTeam.teamTricode}</span>
            <span className={styles.teamTricode}>{game.homeTeam.teamTricode}</span>
          </div>

          {(isLive || isFinal) && (
            <div className={styles.scoresColumn}>
              <span className={styles.teamScore}>{game.awayTeam.score}</span>
              <span className={styles.teamScore}>{game.homeTeam.score}</span>
            </div>
          )}

          <div className={styles.statusColumn}>
            {status ? (
              <>
                <div className={`${styles.gameStatus} ${isFinal ? styles.statusFinal : ""}`}>
                  {status}
                </div>
                {isLive && timeLabel && <div className={styles.gameTime}>{timeLabel}</div>}
              </>
            ) : (
              <div className={styles.gameStatus}>{timeLabel}</div>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
