export const MATCHUP_PLAYER_PROFILES = {
  "1628401": {
    heightIn: 76,
    archetype: "big_guard",
    defenderRole: "point_of_attack",
    preferOffensiveRoles: ["primary_ball_guard", "combo_guard"],
    avoidOffensiveRoles: ["center_big"],
  },
  "1630202": {
    heightIn: 73,
    archetype: "small_guard",
    defenderRole: "small_guard",
    preferOffensiveRoles: ["primary_ball_guard", "combo_guard"],
    avoidOffensiveRoles: ["power_wing", "stretch_big", "power_big", "center_big"],
    avoidOpponentIds: ["1628384", "1628389"],
  },
  "1628973": {
    heightIn: 74,
    archetype: "small_guard",
    offensiveRole: "primary_ball_guard",
  },
  "1628384": {
    heightIn: 79,
    archetype: "power_wing",
    offensiveRole: "power_wing",
  },
  "1628389": {
    heightIn: 81,
    archetype: "center_big",
    offensiveRole: "center_big",
  },
  "1641731": {
    heightIn: 80,
    archetype: "wing",
    defenderRole: "wing_stopper",
    preferOffensiveRoles: ["power_wing", "wing_creator", "primary_ball_guard"],
  },
  "203935": {
    heightIn: 76,
    archetype: "big_guard",
    defenderRole: "point_of_attack",
    preferOffensiveRoles: ["primary_ball_guard", "combo_guard"],
  },
};

export function getMatchupPlayerProfile(personId) {
  return MATCHUP_PLAYER_PROFILES[String(personId || "")] || null;
}
