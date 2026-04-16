import { Link } from "react-router-dom";
import styles from "./TestDashboards.module.css";

const TEST_GAMES = [
  {
    gameId: "1022500001",
    label: "Atlanta Dream at Washington Mystics",
    dateLabel: "May 16, 2025",
    note: "Verified boxscore + play-by-play",
  },
  {
    gameId: "1022500002",
    label: "Minnesota Lynx at Dallas Wings",
    dateLabel: "May 16, 2025",
    note: "Verified boxscore + play-by-play",
  },
  {
    gameId: "1022500003",
    label: "Los Angeles Sparks at Golden State Valkyries",
    dateLabel: "May 16, 2025",
    note: "Verified boxscore + play-by-play",
  },
  {
    gameId: "1022500010",
    label: "Las Vegas Aces at Connecticut Sun",
    dateLabel: "May 20, 2025",
    note: "Verified boxscore + play-by-play",
  },
];

export default function TestDashboards() {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Historical Test Dashboards</h1>
          <p className={styles.subtitle}>
            These are 2025 WNBA games with confirmed live-data JSON still available.
          </p>
        </div>
        <Link className={styles.backLink} to="/">
          Back Home
        </Link>
      </div>

      <div className={styles.grid}>
        {TEST_GAMES.map((game) => (
          <section key={game.gameId} className={styles.card}>
            <div className={styles.date}>{game.dateLabel}</div>
            <div className={styles.label}>{game.label}</div>
            <div className={styles.meta}>Game ID {game.gameId}</div>
            <div className={styles.note}>{game.note}</div>
            <div className={styles.actions}>
              <Link className={styles.primaryAction} to={`/g/${game.gameId}`}>
                Open Dashboard
              </Link>
              <Link className={styles.secondaryAction} to={`/g/${game.gameId}/events`}>
                Play-by-Play
              </Link>
              <Link className={styles.secondaryAction} to={`/m/${game.gameId}`}>
                Minutes
              </Link>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
