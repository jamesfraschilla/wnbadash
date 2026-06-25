"""
Builds src/data/rosters.json using nba_api's commonteamroster.

Usage:
  python3 scripts/build_rosters.py
  python3 scripts/build_rosters.py --season 2024-25
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
import time
from pathlib import Path

try:
    from nba_api.stats.endpoints import commonteamroster
    from nba_api.stats.static import teams
except Exception as exc:
    raise SystemExit(
        "nba_api is required. Install with: pip install nba_api"
    ) from exc


def most_recent_season_start_year() -> int:
    now = datetime.utcnow()
    # NBA season typically starts in Oct; if we're before Aug, use previous year.
    return now.year - 1 if now.month < 8 else now.year


def default_season_string() -> str:
    start = most_recent_season_start_year()
    return f"{start}-{str(start + 1)[-2:]}"


def load_existing_rosters(out_path: Path) -> dict[str, list[dict]]:
    if not out_path.exists():
        return {}

    try:
        payload = json.loads(out_path.read_text())
    except Exception:
        return {}

    return payload if isinstance(payload, dict) else {}


def build_rosters(
    season: str,
    existing_rosters: dict[str, list[dict]] | None = None,
) -> dict[str, list[dict]]:
    roster_map: dict[str, list[dict]] = {}
    existing_rosters = existing_rosters or {}
    failures: list[str] = []

    for team in teams.get_teams():
        team_id = str(team["id"])
        attempt = 0
        roster = None
        while attempt < 3:
            attempt += 1
            try:
                roster = commonteamroster.CommonTeamRoster(
                    team_id=team_id,
                    season=season,
                    league_id_nullable="00",
                    timeout=60,
                )
                break
            except Exception as exc:
                if attempt >= 3:
                    existing_team_roster = existing_rosters.get(team_id)
                    if existing_team_roster:
                        print(
                            f"Warning: timed out for team {team_id}; "
                            "reusing existing roster data."
                        )
                        roster_map[team_id] = existing_team_roster
                        failures.append(team_id)
                        break
                    raise exc
                time.sleep(2 * attempt)
        if roster is None:
            continue
        data = roster.get_dict()
        rows = data.get("resultSets", [{}])[0].get("rowSet", [])
        headers = data.get("resultSets", [{}])[0].get("headers", [])
        players = []
        for row in rows:
            entry = dict(zip(headers, row))
            full_name = entry.get("PLAYER", "") or ""
            parts = full_name.split()
            first_name = parts[0] if parts else ""
            family_name = " ".join(parts[1:]) if len(parts) > 1 else ""
            players.append(
                {
                    "personId": entry.get("PLAYER_ID"),
                    "firstName": first_name,
                    "familyName": family_name,
                    "fullName": full_name,
                    "jerseyNum": str(entry.get("NUM", "") or ""),
                    "position": entry.get("POSITION", ""),
                }
            )
        roster_map[team_id] = players

    if failures:
        print(
            "Completed with fallback data for team IDs: "
            + ", ".join(sorted(failures))
        )
    return roster_map


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", default=default_season_string())
    args = parser.parse_args()

    out_path = Path("src/data/rosters.json")
    existing_rosters = load_existing_rosters(out_path)
    roster_map = build_rosters(args.season, existing_rosters=existing_rosters)
    out_path.write_text(json.dumps(roster_map, indent=2))
    print(f"Wrote {out_path} for season {args.season}")


if __name__ == "__main__":
    main()
