import { normalizeClock } from "./utils.js";

function safeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function analysisPeriodLabel(period) {
  const numeric = safeNumber(period, 0);
  if (numeric <= 0) return "--";
  if (numeric <= 4) return `Q${numeric}`;
  const overtimeNumber = numeric - 4;
  return overtimeNumber === 1 ? "OT" : `${overtimeNumber}OT`;
}

export function analysisPeriodLengthMinutes(period) {
  return safeNumber(period, 0) > 4 ? 5 : 10;
}

export function analysisPeriodLengthSeconds(period) {
  return analysisPeriodLengthMinutes(period) * 60;
}

const ANALYSIS_SEGMENT_PRESETS = [
  { value: "all", label: "All Segments", minPeriod: 1, minMinutes: 10, minSeconds: 0, maxPeriod: 4, maxMinutes: 0, maxSeconds: 0 },
  { value: "q1", label: "Q1", minPeriod: 1, minMinutes: 10, minSeconds: 0, maxPeriod: 1, maxMinutes: 0, maxSeconds: 0 },
  { value: "q2", label: "Q2", minPeriod: 2, minMinutes: 10, minSeconds: 0, maxPeriod: 2, maxMinutes: 0, maxSeconds: 0 },
  { value: "q3", label: "Q3", minPeriod: 3, minMinutes: 10, minSeconds: 0, maxPeriod: 3, maxMinutes: 0, maxSeconds: 0 },
  { value: "q1-q3", label: "Q1-Q3", minPeriod: 1, minMinutes: 10, minSeconds: 0, maxPeriod: 3, maxMinutes: 0, maxSeconds: 0 },
  { value: "q4", label: "Q4", minPeriod: 4, minMinutes: 10, minSeconds: 0, maxPeriod: 4, maxMinutes: 0, maxSeconds: 0 },
  { value: "first-half", label: "1st Half", minPeriod: 1, minMinutes: 10, minSeconds: 0, maxPeriod: 2, maxMinutes: 0, maxSeconds: 0 },
  { value: "second-half", label: "2nd Half", minPeriod: 3, minMinutes: 10, minSeconds: 0, maxPeriod: 4, maxMinutes: 0, maxSeconds: 0 },
];

export function buildAnalysisPeriodOptions(maxPeriod) {
  const safeMaxPeriod = Math.max(1, safeNumber(maxPeriod, 1));
  return Array.from({ length: safeMaxPeriod }, (_, index) => {
    const period = index + 1;
    return {
      value: String(period),
      label: analysisPeriodLabel(period),
    };
  });
}

export function buildAnalysisSegmentOptions(game, isLive) {
  const currentPeriod = Math.max(1, safeNumber(game?.period, 4));
  const finishedPeriod = Math.max(4, currentPeriod);
  return [
    { value: "custom", label: "Custom" },
    ...ANALYSIS_SEGMENT_PRESETS.filter((segment) => {
      if (isLive) {
        return segment.minPeriod <= currentPeriod;
      }
      return segment.minPeriod <= finishedPeriod;
    }).map((segment) => ({
      value: segment.value,
      label: segment.label,
    })),
  ];
}

export function buildAnalysisMinuteOptions(period) {
  const maxMinutes = analysisPeriodLengthMinutes(period);
  return Array.from({ length: maxMinutes + 1 }, (_, index) => String(maxMinutes - index));
}

export function buildAnalysisSecondOptions(period, minute) {
  const numericMinute = safeNumber(minute, 0);
  if (numericMinute === analysisPeriodLengthMinutes(period)) {
    return ["00"];
  }
  return Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));
}

export function buildAnalysisPoint(period, minutes, seconds) {
  return {
    period: safeNumber(period, 1),
    minutes: safeNumber(minutes, 0),
    seconds: safeNumber(seconds, 0),
  };
}

export function normalizeAnalysisPoint(point) {
  const period = Math.max(1, safeNumber(point?.period, 1));
  const maxMinutes = analysisPeriodLengthMinutes(period);
  let minutes = safeNumber(point?.minutes, maxMinutes);
  minutes = Math.min(Math.max(minutes, 0), maxMinutes);
  const secondOptions = buildAnalysisSecondOptions(period, minutes);
  let seconds = String(point?.seconds ?? "00").padStart(2, "0");
  if (!secondOptions.includes(seconds)) {
    seconds = secondOptions[0];
  }
  return {
    period,
    minutes,
    seconds: safeNumber(seconds, 0),
  };
}

export function formatAnalysisPoint(point) {
  const normalized = normalizeAnalysisPoint(point);
  return `${analysisPeriodLabel(normalized.period)} ${normalized.minutes}:${String(normalized.seconds).padStart(2, "0")}`;
}

export function analysisPointToElapsedSeconds(point) {
  const normalized = normalizeAnalysisPoint(point);
  let elapsed = 0;
  for (let period = 1; period < normalized.period; period += 1) {
    elapsed += analysisPeriodLengthSeconds(period);
  }
  const remaining = (normalized.minutes * 60) + normalized.seconds;
  return elapsed + Math.max(0, analysisPeriodLengthSeconds(normalized.period) - remaining);
}

export function buildCurrentAnalysisPoint(game, isLive) {
  if (isLive && game?.period && game?.gameClock) {
    const normalizedClock = normalizeClock(game.gameClock);
    const [minutesRaw, secondsRaw] = normalizedClock.split(":");
    return normalizeAnalysisPoint({
      period: Number(game.period) || 1,
      minutes: safeNumber(minutesRaw, 0),
      seconds: safeNumber(secondsRaw, 0),
    });
  }

  const finalPeriod = Math.max(1, safeNumber(game?.period, 4));
  return normalizeAnalysisPoint({
    period: finalPeriod,
    minutes: 0,
    seconds: 0,
  });
}

function isAnalysisAnchorAction(action, livePeriod) {
  const actionType = String(action?.actionType || "").toLowerCase();
  const subType = String(action?.subType || "").toLowerCase();
  const period = safeNumber(action?.period, 0);
  if (!period || (livePeriod && period > livePeriod)) return false;
  if (actionType === "timeout") return true;
  return actionType === "period" && subType === "start";
}

function buildLiveDefaultMinPoint(game) {
  const livePeriod = safeNumber(game?.period, 0);
  const currentPoint = buildCurrentAnalysisPoint(game, true);
  const currentElapsed = analysisPointToElapsedSeconds(currentPoint);
  const actions = Array.isArray(game?.playByPlayActions) ? game.playByPlayActions : [];
  const anchor = [...actions]
    .filter((action) => isAnalysisAnchorAction(action, livePeriod))
    .map((action) => {
      const normalizedClock = normalizeClock(action.clock);
      const [minutesRaw, secondsRaw] = normalizedClock.split(":");
      const point = normalizeAnalysisPoint({
        period: safeNumber(action.period, 1),
        minutes: safeNumber(minutesRaw, analysisPeriodLengthMinutes(safeNumber(action.period, 1))),
        seconds: safeNumber(secondsRaw, 0),
      });
      return {
        action,
        point,
        elapsed: analysisPointToElapsedSeconds(point),
      };
    })
    .filter(({ elapsed }) => elapsed < currentElapsed)
    .sort((a, b) => {
      const actionDelta = safeNumber(b.action?.orderNumber ?? b.action?.actionNumber, 0)
        - safeNumber(a.action?.orderNumber ?? a.action?.actionNumber, 0);
      if (actionDelta !== 0) return actionDelta;
      return b.elapsed - a.elapsed;
    })[0];

  if (!anchor) return null;

  return anchor.point;
}

export function buildInitialAnalysisForm(game, isLive) {
  const maxPoint = buildCurrentAnalysisPoint(game, isLive);
  const minPoint = isLive
    ? (buildLiveDefaultMinPoint(game) || normalizeAnalysisPoint({
      period: 1,
      minutes: analysisPeriodLengthMinutes(1),
      seconds: 0,
    }))
    : normalizeAnalysisPoint({
      period: 1,
      minutes: analysisPeriodLengthMinutes(1),
      seconds: 0,
    });
  return {
    segmentShortcut: "custom",
    minPeriod: String(minPoint.period),
    minMinutes: String(minPoint.minutes),
    minSeconds: String(minPoint.seconds).padStart(2, "0"),
    maxPeriod: String(maxPoint.period),
    maxMinutes: String(maxPoint.minutes),
    maxSeconds: String(maxPoint.seconds).padStart(2, "0"),
  };
}

export function applyAnalysisSegmentShortcut(shortcut, game, isLive) {
  const preset = ANALYSIS_SEGMENT_PRESETS.find((segment) => segment.value === shortcut);
  if (!preset) {
    return {
      ...buildInitialAnalysisForm(game, isLive),
      segmentShortcut: "custom",
    };
  }

  const maxAllowedPoint = buildCurrentAnalysisPoint(game, isLive);
  const presetMinPoint = normalizeAnalysisPoint({
    period: preset.minPeriod,
    minutes: preset.minMinutes,
    seconds: preset.minSeconds,
  });
  const presetMaxPoint = normalizeAnalysisPoint({
    period: preset.maxPeriod,
    minutes: preset.maxMinutes,
    seconds: preset.maxSeconds,
  });
  const clampedMaxPoint = isLive && analysisPointToElapsedSeconds(presetMaxPoint) > analysisPointToElapsedSeconds(maxAllowedPoint)
    ? maxAllowedPoint
    : presetMaxPoint;

  return {
    segmentShortcut: shortcut,
    minPeriod: String(presetMinPoint.period),
    minMinutes: String(presetMinPoint.minutes),
    minSeconds: String(presetMinPoint.seconds).padStart(2, "0"),
    maxPeriod: String(clampedMaxPoint.period),
    maxMinutes: String(clampedMaxPoint.minutes),
    maxSeconds: String(clampedMaxPoint.seconds).padStart(2, "0"),
  };
}

export function normalizeAnalysisForm(form, game, isLive) {
  const maxAllowedPoint = buildCurrentAnalysisPoint(game, isLive);
  const minPoint = normalizeAnalysisPoint({
    period: form?.minPeriod,
    minutes: form?.minMinutes,
    seconds: form?.minSeconds,
  });
  const selectedMaxPoint = normalizeAnalysisPoint({
    period: form?.maxPeriod,
    minutes: form?.maxMinutes,
    seconds: form?.maxSeconds,
  });

  return {
    minPoint,
    maxPoint: selectedMaxPoint,
    maxAllowedPoint,
  };
}

export function validateAnalysisForm(form, game, isLive) {
  const { minPoint, maxPoint, maxAllowedPoint } = normalizeAnalysisForm(form, game, isLive);
  const minElapsed = analysisPointToElapsedSeconds(minPoint);
  const maxElapsed = analysisPointToElapsedSeconds(maxPoint);
  const maxAllowedElapsed = analysisPointToElapsedSeconds(maxAllowedPoint);

  if (maxElapsed > maxAllowedElapsed) {
    return {
      error: `Max time cannot be later than ${formatAnalysisPoint(maxAllowedPoint)}.`,
    };
  }

  if (minElapsed >= maxElapsed) {
    return {
      error: "Min time must be earlier than max time.",
    };
  }

  return {
    error: "",
    minPoint,
    maxPoint,
    rangeLabel: `${formatAnalysisPoint(minPoint)} to ${formatAnalysisPoint(maxPoint)}`,
  };
}
