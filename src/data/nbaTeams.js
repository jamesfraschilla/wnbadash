import rostersByTeamId from "./rosters.json";

export const NBA_TEAMS = [
  { teamId: "1610612737", tricode: "ATL", fullName: "Atlanta Hawks" },
  { teamId: "1610612738", tricode: "BOS", fullName: "Boston Celtics" },
  { teamId: "1610612751", tricode: "BKN", fullName: "Brooklyn Nets" },
  { teamId: "1610612766", tricode: "CHA", fullName: "Charlotte Hornets" },
  { teamId: "1610612741", tricode: "CHI", fullName: "Chicago Bulls" },
  { teamId: "1610612739", tricode: "CLE", fullName: "Cleveland Cavaliers" },
  { teamId: "1610612742", tricode: "DAL", fullName: "Dallas Mavericks" },
  { teamId: "1610612743", tricode: "DEN", fullName: "Denver Nuggets" },
  { teamId: "1610612765", tricode: "DET", fullName: "Detroit Pistons" },
  { teamId: "1610612744", tricode: "GSW", fullName: "Golden State Warriors" },
  { teamId: "1610612745", tricode: "HOU", fullName: "Houston Rockets" },
  { teamId: "1610612754", tricode: "IND", fullName: "Indiana Pacers" },
  { teamId: "1610612746", tricode: "LAC", fullName: "LA Clippers" },
  { teamId: "1610612747", tricode: "LAL", fullName: "Los Angeles Lakers" },
  { teamId: "1610612763", tricode: "MEM", fullName: "Memphis Grizzlies" },
  { teamId: "1610612748", tricode: "MIA", fullName: "Miami Heat" },
  { teamId: "1610612749", tricode: "MIL", fullName: "Milwaukee Bucks" },
  { teamId: "1610612750", tricode: "MIN", fullName: "Minnesota Timberwolves" },
  { teamId: "1610612740", tricode: "NOP", fullName: "New Orleans Pelicans" },
  { teamId: "1610612752", tricode: "NYK", fullName: "New York Knicks" },
  { teamId: "1610612760", tricode: "OKC", fullName: "Oklahoma City Thunder" },
  { teamId: "1610612753", tricode: "ORL", fullName: "Orlando Magic" },
  { teamId: "1610612755", tricode: "PHI", fullName: "Philadelphia 76ers" },
  { teamId: "1610612756", tricode: "PHX", fullName: "Phoenix Suns" },
  { teamId: "1610612757", tricode: "POR", fullName: "Portland Trail Blazers" },
  { teamId: "1610612758", tricode: "SAC", fullName: "Sacramento Kings" },
  { teamId: "1610612759", tricode: "SAS", fullName: "San Antonio Spurs" },
  { teamId: "1610612761", tricode: "TOR", fullName: "Toronto Raptors" },
  { teamId: "1610612762", tricode: "UTA", fullName: "Utah Jazz" },
  { teamId: "1610612764", tricode: "WAS", fullName: "Washington Wizards" },
].sort((a, b) => a.fullName.localeCompare(b.fullName));

export const GLEAGUE_TEAMS = [
  { teamId: "1612709890", fullName: "Austin Spurs" },
  { teamId: "1612709913", fullName: "Birmingham Squadron" },
  { teamId: "1612709928", fullName: "Capital City Go-Go" },
  { teamId: "1612709893", fullName: "Cleveland Charge" },
  { teamId: "1612709929", fullName: "College Park Skyhawks" },
  { teamId: "1612709909", fullName: "Delaware Blue Coats" },
  { teamId: "1612709917", fullName: "Grand Rapids Gold" },
  { teamId: "1612709922", fullName: "Greensboro Swarm" },
  { teamId: "1612709911", fullName: "Iowa Wolves" },
  { teamId: "1612709921", fullName: "Long Island Nets" },
  { teamId: "1612709915", fullName: "Maine Celtics" },
  { teamId: "1612709926", fullName: "Memphis Hustle" },
  { teamId: "1612709931", fullName: "Mexico City Capitanes" },
  { teamId: "1612709932", fullName: "Motor City Cruise" },
  { teamId: "1612709910", fullName: "Noblesville Boom" },
  { teamId: "1612709889", fullName: "Oklahoma City Blue" },
  { teamId: "1612709925", fullName: "Osceola Magic" },
  { teamId: "1612709920", fullName: "Raptors 905" },
  { teamId: "1612709908", fullName: "Rio Grande Valley Vipers" },
  { teamId: "1612709933", fullName: "Rip City Remix" },
  { teamId: "1612709903", fullName: "Salt Lake City Stars" },
  { teamId: "1612709924", fullName: "San Diego Clippers" },
  { teamId: "1612709902", fullName: "Santa Cruz Warriors" },
  { teamId: "1612709904", fullName: "Sioux Falls Skyforce" },
  { teamId: "1612709905", fullName: "South Bay Lakers" },
  { teamId: "1612709914", fullName: "Stockton Kings" },
  { teamId: "1612709918", fullName: "Texas Legends" },
  { teamId: "1612709934", fullName: "Valley Suns" },
  { teamId: "1612709919", fullName: "Westchester Knicks" },
  { teamId: "1612709923", fullName: "Windy City Bulls" },
  { teamId: "1612709927", fullName: "Wisconsin Herd" },
].sort((a, b) => a.fullName.localeCompare(b.fullName));

function toSortableJersey(value) {
  const text = String(value || "").trim();
  if (!text) return Number.POSITIVE_INFINITY;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function getNbaTeam(teamId) {
  return NBA_TEAMS.find((team) => team.teamId === String(teamId || "")) || null;
}

export function getGLeagueTeam(teamId) {
  return GLEAGUE_TEAMS.find((team) => team.teamId === String(teamId || "")) || null;
}

export function getLeagueTeam(teamId, league = "nba") {
  return league === "gleague" ? getGLeagueTeam(teamId) : getNbaTeam(teamId);
}

export function getNbaTeamRoster(teamId) {
  const players = Array.isArray(rostersByTeamId?.[String(teamId || "")])
    ? rostersByTeamId[String(teamId || "")]
    : [];

  return [...players]
    .map((player) => ({
      personId: String(player?.personId || "").trim(),
      firstName: String(player?.firstName || "").trim(),
      familyName: String(player?.familyName || "").trim(),
      fullName: String(player?.fullName || "").trim(),
      jerseyNum: String(player?.jerseyNum || "").trim(),
      teamId: String(teamId || "").trim(),
    }))
    .filter((player) => player.personId && player.fullName)
    .sort((a, b) => {
      const jerseyCompare = toSortableJersey(a.jerseyNum) - toSortableJersey(b.jerseyNum);
      if (jerseyCompare !== 0) return jerseyCompare;
      return a.fullName.localeCompare(b.fullName);
    });
}
