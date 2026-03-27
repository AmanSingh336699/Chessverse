import type { MoveClassification } from "../../contracts.js";

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

export const classifyByEvalLoss = (
  evalLoss: number,
  thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS,
): MoveClassification => {
  const loss = Math.abs(evalLoss);

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
