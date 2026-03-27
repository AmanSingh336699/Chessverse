import type { CandidateMove, EngineMode, EngineState, GamePhase } from "../contracts.js";
import type { EvaluatedCandidate } from "../types.js";
import { clamp } from "./difficulty.js";
import {
  createFailedGambitState,
  createOfferedGambitState,
  decrementGambitCooldown,
  normalizeGambitState,
} from "./behavior/gambitState.js";

export const dominantModeFromBreakdown = (candidate: {
  gambit: number;
  trap: number;
  sacrifice: number;
  aggression: number;
  psychological: number;
}): EngineMode => {
  const entries = [
    ["gambit", candidate.gambit],
    ["trap", candidate.trap],
    ["sacrifice", candidate.sacrifice],
    ["aggressive", candidate.aggression],
    ["psychological", candidate.psychological],
  ] as const;
  const [mode, score] = entries.reduce((best, current) =>
    current[1] > best[1] ? current : best,
  );
  return score <= 0 ? "stockfish" : mode;
};

const extractActiveBehaviors = (
  selected: EvaluatedCandidate,
): EngineState["lastActiveBehaviors"] =>
  [
    { mode: "gambit" as const, score: selected.breakdown.gambit },
    { mode: "trap" as const, score: selected.breakdown.trap },
    { mode: "sacrifice" as const, score: selected.breakdown.sacrifice },
    { mode: "aggressive" as const, score: selected.breakdown.aggression },
    { mode: "psychological" as const, score: selected.breakdown.psychological },
  ]
    .filter((entry) => entry.score > 0.05)
    .sort((left, right) => right.score - left.score || left.mode.localeCompare(right.mode));

const cloneState = (state: EngineState): EngineState => structuredClone(state);

const advanceRecovery = (state: EngineState): void => {
  if (state.currentRecoveryMode === "fallback") {
    state.fallbackMovesRemaining = Math.max(0, state.fallbackMovesRemaining - 1);
    if (state.fallbackMovesRemaining === 0) {
      state.currentRecoveryMode = state.pureStockfishMovesRemaining > 0 ? "pure-stockfish" : "none";
    }
  }

  if (state.currentRecoveryMode === "pure-stockfish") {
    state.pureStockfishMovesRemaining = Math.max(0, state.pureStockfishMovesRemaining - 1);
    if (state.pureStockfishMovesRemaining === 0) {
      state.currentRecoveryMode = state.behaviorSuccessScore <= -3 ? "fallback" : "none";
      if (state.currentRecoveryMode === "fallback" && state.fallbackMovesRemaining === 0) {
        state.fallbackMovesRemaining = 2;
      }
    }
  }
};

const updateBehaviorHealth = (state: EngineState, selected: EvaluatedCandidate): void => {
  const previousEval = state.recentEvaluations.at(-1);
  if (typeof previousEval === "number") {
    if (selected.eval >= previousEval - 0.5) {
      state.behaviorSuccessScore += 1;
    } else if (previousEval - selected.eval > 0.5) {
      state.behaviorSuccessScore -= 2;
    }
  } else {
    state.behaviorSuccessScore += 1;
  }

  state.recentEvaluations = [...state.recentEvaluations, selected.eval].slice(-5);
  if (state.behaviorSuccessScore <= -5) {
    state.currentRecoveryMode = "pure-stockfish";
    state.pureStockfishMovesRemaining = Math.max(state.pureStockfishMovesRemaining, 5);
  } else if (state.behaviorSuccessScore <= -3 && state.currentRecoveryMode === "none") {
    state.currentRecoveryMode = "fallback";
    state.fallbackMovesRemaining = Math.max(state.fallbackMovesRemaining, 5);
  }
};

const updateSacrificeTracking = (state: EngineState, selected: EvaluatedCandidate): void => {
  const pendingTracking = selected.annotation.sacrificeTracking;
  if (pendingTracking) {
    state.sacrificeTracking = pendingTracking;
    state.sacrificeCooldownMoves = 0;
    return;
  }

  if (!state.sacrificeTracking.active) {
    if (state.sacrificeCooldownMoves > 0) {
      state.sacrificeCooldownMoves -= 1;
    }
    return;
  }

  const target = state.sacrificeTracking.targetEvaluation;
  if (typeof target === "number") {
    if (selected.eval >= target) {
      state.sacrificeTracking.status = "succeeding";
      state.behaviorSuccessScore += 1;
    } else if (selected.eval >= target - 1) {
      state.sacrificeTracking.status = "pending";
    } else {
      state.sacrificeTracking.status = "failed";
      state.sacrificeTracking.active = false;
      state.sacrificeCooldownMoves = 5;
      state.behaviorSuccessScore -= 2;
      state.currentRecoveryMode = "pure-stockfish";
      state.pureStockfishMovesRemaining = Math.max(state.pureStockfishMovesRemaining, 5);
    }
  }
  state.sacrificeTracking.lastUpdatedMoveNumber = selected.annotation.lastDecision?.moveNumber ?? state.sacrificeTracking.lastUpdatedMoveNumber;
};

const updateGambitState = (state: EngineState, selected: EvaluatedCandidate): void => {
  state.gambit = normalizeGambitState(state.gambit);
  if (state.gambit.status === "failed" && state.gambit.cooldown > 0) {
    state.gambit = decrementGambitCooldown(state.gambit, 1);
  }

  if (
    selected.engineMode === "gambit" &&
    selected.breakdown.gambit >= 50 &&
    (state.gambit.status === "idle" || state.gambit.line !== selected.annotation.lastDecision?.strategy)
  ) {
    state.gambit = createOfferedGambitState(
      selected.annotation.lastDecision?.strategy,
      selected.annotation.lastDecision?.moveNumber ?? null,
    );
  }

  if (selected.engineMode === "gambit" && selected.eval < -1.5) {
    state.gambit = createFailedGambitState(state.gambit, 5);
    state.currentRecoveryMode = "pure-stockfish";
    state.pureStockfishMovesRemaining = Math.max(state.pureStockfishMovesRemaining, 5);
    state.behaviorSuccessScore -= 3;
  }
};

export const updateEngineStateAfterDecision = (
  current: EngineState,
  phase: GamePhase,
  selected: EvaluatedCandidate,
): EngineState => {
  const next = cloneState(current);
  advanceRecovery(next);
  updateBehaviorHealth(next, selected);
  updateSacrificeTracking(next, selected);
  updateGambitState(next, selected);

  next.activeThemes = selected.annotation.tacticalThemes;
  next.trapSequence = selected.annotation.trapSequence ?? next.trapSequence;
  next.opponentPressure = selected.annotation.opponentPressure ?? next.opponentPressure;
  next.complexityDial = clamp(selected.annotation.lastDecision?.moveNumber ? selected.annotation.continuityDelta + next.complexityDial : next.complexityDial, 0, 10);
  next.lastDominantMode = selected.engineMode;
  next.lastScoreBreakdown = selected.breakdown;
  next.lastActiveBehaviors = extractActiveBehaviors(selected);
  next.lastDecision = selected.annotation.lastDecision ?? {
    dominantEngine: selected.engineMode,
    strategy: selected.annotation.strategies[0],
    move: selected.move,
    moveNumber: null,
  };

  if (phase === "endgame") {
    next.behaviorSuccessScore = clamp(next.behaviorSuccessScore, -5, 5);
    next.complexityDial = clamp(next.complexityDial, 0, 4);
  } else {
    next.complexityDial = clamp(next.complexityDial, 0, 10);
  }

  return next;
};

export const buildFinalScore = (
  candidate: CandidateMove,
  stockfishWeight: number,
  scores: {
    gambit: number;
    trap: number;
    sacrifice: number;
    aggression: number;
    psychological: number;
  },
  annotation: EvaluatedCandidate["annotation"],
): EvaluatedCandidate => {
  const finalScore = Number(
    (
      candidate.eval * stockfishWeight +
      scores.gambit +
      scores.trap +
      scores.sacrifice +
      scores.aggression +
      scores.psychological
    ).toFixed(2)
  );

  const engineMode = dominantModeFromBreakdown(scores);
  const lastDecision = {
    dominantEngine: engineMode,
    move: candidate.move,
    moveNumber: annotation.lastDecision?.moveNumber ?? null,
    ...(annotation.lastDecision?.strategy ?? annotation.strategies[0]
      ? { strategy: annotation.lastDecision?.strategy ?? annotation.strategies[0] }
      : {}),
  };

  return {
    ...candidate,
    engineMode,
    annotation: {
      ...annotation,
      lastDecision,
    },
    breakdown: {
      stockfishEval: candidate.eval,
      stockfishWeight,
      gambit: Number(scores.gambit.toFixed(2)),
      trap: Number(scores.trap.toFixed(2)),
      sacrifice: Number(scores.sacrifice.toFixed(2)),
      aggression: Number(scores.aggression.toFixed(2)),
      psychological: Number(scores.psychological.toFixed(2)),
      finalScore,
    },
  };
};
