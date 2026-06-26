import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDateInput,
  formatMinutes,
  formatTipTime,
  gameStatusLabel,
  normalizeClock,
  parseDateInput,
} from "./utils.js";

test("date input parsing round-trips local WNBA schedule dates", () => {
  const parsed = parseDateInput("2026-05-14");

  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 4);
  assert.equal(parsed.getDate(), 14);
  assert.equal(formatDateInput(parsed), "2026-05-14");
});

test("tip times prefer normalized WNBA fallback text", () => {
  assert.equal(formatTipTime("2026-05-14T23:00:00Z", "7:00 p.m. ET"), "7:00 PM");
  assert.equal(formatTipTime("2026-05-14T23:00:00Z", "10:30 A.M. ET"), "10:30 AM");
});

test("tip times fall back to Eastern time when no schedule text is available", () => {
  assert.equal(formatTipTime("2026-05-14T23:30:00Z", ""), "7:30 PM");
});

test("clock formatters normalize ISO duration clocks", () => {
  assert.equal(normalizeClock("PT9M05.00S"), "9:05");
  assert.equal(normalizeClock("PT0S"), "0:00");
  assert.equal(formatMinutes("PT24M31.00S"), "24:31");
});

test("WNBA game status labels handle regulation, halftime, and overtime", () => {
  assert.equal(gameStatusLabel({ gameStatus: 2, period: 1, gameClock: "PT8M04.00S" }), "Q1");
  assert.equal(gameStatusLabel({ gameStatus: 2, period: 2, gameClock: "PT0S" }), "HT");
  assert.equal(gameStatusLabel({ gameStatus: 2, period: 4, gameClock: "PT0S" }), "End Q4");
  assert.equal(gameStatusLabel({ gameStatus: 3, period: 4, gameStatusText: "Final" }), "F");
  assert.equal(gameStatusLabel({ gameStatus: 3, period: 5, gameStatusText: "Final" }), "F/OT");
});
