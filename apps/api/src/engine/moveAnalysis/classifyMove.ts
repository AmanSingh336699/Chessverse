import type { MoveClassification, PlayerColor } from "@chessverse/contracts";

export interface ClassificationThresholds {
  bestMax: number;
  excellentMax: number;
  goodMax: number;
  inaccuracyMax: number;
  mistakeMax: number;
}

export const DEFAULT_THRESHOLDS: ClassificationThresholds = {
  bestMax: 0.2,
  excellentMax: 0.5,
  goodMax: 1.0,
  inaccuracyMax: 2.0,
  mistakeMax: 4.0,
};

/**
 * Calculates evaluation loss from the moving player's perspective.
 * Positive loss means player lost evaluation points.
 */
export function calculateEvalLoss(
  evalBefore: number,
  evalAfter: number,
  playerColor: PlayerColor,
): number {
  if (playerColor === "white") {
    return evalBefore - evalAfter;
  } else {
    // For Black, evalBefore = -1.0, evalAfter = +1.0 means Black lost 2.0
    return evalAfter - evalBefore;
  }
}

/**
 * Normalizes mate score to pawn units for evaluation calculations.
 * e.g. mate in 1 -> +99.0, mate in -2 -> -98.0
 */
export function normalizeMateScore(mateIn: number): number {
  if (mateIn > 0) {
    return Math.max(90, 100 - mateIn);
  } else {
    return Math.min(-90, -100 - mateIn);
  }
}

export const classifyByEvalLoss = (
  evalLoss: number,
  thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS,
  options?: { isMateAgainstPlayer?: boolean },
): MoveClassification => {
  if (options?.isMateAgainstPlayer) {
    return "blunder";
  }

  // Loss should be non-negative (eval improvements are treated as 0 loss -> best)
  const loss = Math.max(0, evalLoss);

  if (loss <= thresholds.bestMax) {
    return "best";
  }

  if (loss <= thresholds.excellentMax) {
    return "excellent";
  }

  if (loss <= thresholds.goodMax) {
    return "good";
  }

  if (loss <= thresholds.inaccuracyMax) {
    return "inaccuracy";
  }

  if (loss <= thresholds.mistakeMax) {
    return "mistake";
  }

  return "blunder";
};
