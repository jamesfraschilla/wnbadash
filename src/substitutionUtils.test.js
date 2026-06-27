import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSubstitutionAnnotationLookup,
  collapseSubstitutionActions,
  getSubstitutionAnnotation,
  getSubstitutionLastName,
  parseSubstitutionAction,
} from "./substitutionUtils.js";

test("parses direct substitution pair descriptions", () => {
  assert.deepEqual(
    parseSubstitutionAction({
      actionType: "substitution",
      subType: "in",
      description: "SUB: Harper FOR Fox",
    }),
    {
      kind: "pair",
      inName: "Harper",
      outName: "Fox",
    },
  );
});

test("collapses duplicate pair rows into one incoming-player display row", () => {
  const collapsed = collapseSubstitutionActions([
    {
      actionNumber: 53,
      period: 1,
      clock: "PT07M28.00S",
      teamId: 1610612759,
      personId: 1628368,
      playerName: "De'Aaron Fox",
      subType: "out",
      actionType: "substitution",
      description: "SUB: Harper FOR Fox",
      currentAwayScore: 2,
      currentHomeScore: 0,
    },
    {
      actionNumber: 55,
      period: 1,
      clock: "PT07M28.00S",
      teamId: 1610612759,
      personId: 1642844,
      playerName: "Dylan Harper",
      playerNameI: "D. Harper",
      subType: "in",
      actionType: "substitution",
      description: "SUB: Harper FOR Fox",
      currentAwayScore: 2,
      currentHomeScore: 0,
    },
  ]);

  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].displayDescription, "SUB: Harper FOR Fox");
  assert.equal(collapsed[0].displayPersonId, 1642844);
  assert.equal(collapsed[0].displayPlayerNameI, "D. Harper");
  assert.equal(collapsed[0].currentAwayScore, 2);
  assert.equal(collapsed[0].currentHomeScore, 0);
});

test("collapses single SUB in/out rows into one paired row", () => {
  const collapsed = collapseSubstitutionActions([
    {
      period: 4,
      clock: "0:43",
      teamId: 1611661324,
      personId: 1629489,
      playerName: "Kahleah Copper",
      subType: "out",
      actionType: "substitution",
      description: "SUB out: K. Copper",
    },
    {
      period: 4,
      clock: "0:43",
      teamId: 1611661324,
      personId: 1642295,
      playerName: "M. Suarez",
      subType: "in",
      actionType: "substitution",
      description: "SUB in: M. Suarez",
    },
  ]);

  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].displayDescription, "SUB: Suarez FOR Copper");
  assert.equal(collapsed[0].displayPersonId, 1642295);
});

test("normalizes substitution clocks for minutes annotations", () => {
  const lookup = buildSubstitutionAnnotationLookup([
    {
      period: 1,
      clock: "PT07M28.00S",
      teamId: 1610612759,
      personId: 1629640,
      playerName: "Keldon Johnson",
      subType: "in",
      actionType: "substitution",
      description: "SUB: Johnson FOR Champagnie",
    },
  ]);

  assert.equal(
    getSubstitutionAnnotation(lookup, {
      period: 1,
      clock: "7:28",
      teamId: 1610612759,
      personId: 1629640,
    }),
    "Champagnie",
  );
});

test("keeps suffixes with substitution display last names", () => {
  assert.equal(getSubstitutionLastName("Kelly Oubre Jr."), "Oubre Jr.");
  assert.equal(getSubstitutionLastName("K. Towns"), "Towns");
});
