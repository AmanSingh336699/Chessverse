
import type { Difficulty, EngineState, GamePhase } from "../contracts.js";
import type { DifficultyProfile, EvaluatedCandidate } from "../types.js";


const profiles: Record<Difficulty, DifficultyProfile> = {
    beginner: {
        depth: 6,
        movetimeMs: 400,
        minDepth: 8,
        behaviorBudgetMs: 150,
        stockfishWeight: 0.4,
        behaviorMultiplier: 0.65,
        randomTopN: 5,
    },
    intermediate: {
        depth: 10,
        movetimeMs: 700,
        minDepth: 8,
        behaviorBudgetMs: 150,
        stockfishWeight: 0.5,
        behaviorMultiplier: 0.85,
        randomTopN: 3,
    },
    advanced: {
        depth: 14,
        movetimeMs: 1100,
        minDepth: 8,
        behaviorBudgetMs: 200,
        stockfishWeight: 0.5,
        behaviorMultiplier: 1,
        randomTopN: 2,
    },
    master: {
        depth: 18,
        movetimeMs: 2000,
        minDepth: 8,
        behaviorBudgetMs: 200,
        stockfishWeight: 0.5,
        behaviorMultiplier: 1.1,
        randomTopN: 1,
    },
};

const weightedBuckets: Record<Difficulty, number[]> = {
    beginner: [0.36, 0.24, 0.18, 0.12, 0.1],
    intermediate: [0.6, 0.25, 0.15],
    advanced: [0.8, 0.2],
    master: [1],
};


export const getDifficultyProfile = (
    difficulty: Difficulty,
): DifficultyProfile => profiles[difficulty];

export const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value));


export const computeStockfishWeight = (
    phase: GamePhase,
    _difficulty: Difficulty,
    engineState: EngineState,
): number => {
    if (
        engineState.currentRecoveryMode === "pure-stockfish" ||
        engineState.behaviorSuccessScore <= -5
    ) {
        return 1;
    }

    if (
        engineState.currentRecoveryMode === "fallback" ||
        engineState.behaviorSuccessScore <= -3
    ) {
        return 0.8;
    }

    if (phase === "opening") return 0.4;
    if (phase === "middlegame") return 0.5;
    return 0.9;
};


export const getBehaviorScale = (
    difficulty: Difficulty,
    phase: GamePhase,
    engineState: EngineState,
    mode: "gambit" | "trap" | "sacrifice" | "aggression" | "psychological",
): number => {
    // Hard suppression modes
    if (
        engineState.currentRecoveryMode === "pure-stockfish" ||
        engineState.behaviorSuccessScore <= -5
    ) {
        return 0;
    }

    let scale = getDifficultyProfile(difficulty).behaviorMultiplier;

    if (
        engineState.currentRecoveryMode === "fallback" ||
        engineState.behaviorSuccessScore <= -3
    ) {
        scale *= 0.3;
    } else if (engineState.behaviorSuccessScore < 0) {
        scale *= 0.75;
    }

    // Phase-specific scaling
    if (phase === "opening") {
        if (mode === "gambit") scale *= 1.7;
        else if (mode === "aggression") scale *= 0.25;
        else if (mode === "psychological") scale *= 0.15;
        else if (mode === "trap") scale *= 0.1;
        else if (mode === "sacrifice") return 0;
    }

    if (
        phase === "middlegame" &&
        (mode === "aggression" || mode === "psychological")
    ) {
        scale *= 1.5;
    }

    if (phase === "endgame") {
        if (mode === "aggression") scale *= 0.5;
        else if (mode === "psychological") scale *= 0.4;
        else if (mode === "trap") scale *= 0.5;
        else if (mode === "sacrifice") scale *= 0.25;
        else scale = 0;
    }

    // Gambit state modifiers
    if (engineState.gambit.status === "accepted") {
        if (mode === "aggression") scale *= 2;
        if (mode === "psychological") scale *= 1.5;
        if (mode === "sacrifice") scale *= 0.6;
    }

    if (engineState.gambit.status === "failed") {
        scale *= 0.6;
    }

    // Sacrifice cooldown
    if (engineState.sacrificeCooldownMoves > 0 && mode === "sacrifice") {
        return 0;
    }

    if (
        mode === "sacrifice" &&
        engineState.sacrificeCooldownMoves === 0 &&
        engineState.behaviorSuccessScore < 0 &&
        engineState.sacrificeTracking.status === "failed"
    ) {
        scale *= 0.5;
    }

    return Number(scale.toFixed(2));
};


export const sortCandidates = (
    candidates: EvaluatedCandidate[],
): EvaluatedCandidate[] =>
    [...candidates].sort(
        (l, r) =>
            r.breakdown.finalScore - l.breakdown.finalScore ||
            r.eval - l.eval ||
            l.move.localeCompare(r.move),
    );

export const chooseCandidate = (
    candidates: EvaluatedCandidate[],
    difficulty: Difficulty,
    engineState?: EngineState,
): EvaluatedCandidate => {
    if (candidates.length === 0) {
        // This is a programming error — the caller must pass a non-empty list.
        // engineService.ts guarantees this; if we still reach here something is
        // deeply wrong upstream.  Throw so the bug is surfaced immediately.
        throw new Error(
            "chooseCandidate requires at least one evaluated candidate. " +
                "Ensure engineService.ts applies the empty-candidates safety net before calling this function.",
        );
    }

    const sorted = sortCandidates(candidates);
    const top = sorted[0]!;

    // Deterministic top-pick conditions
    const forceBest =
        top.engineMode === "gambit" ||
        difficulty === "master" ||
        engineState?.currentRecoveryMode === "pure-stockfish" ||
        (engineState?.behaviorSuccessScore ?? 0) <= -5;

    if (forceBest) return top;

    // Weighted random selection from top-N
    const topN = getDifficultyProfile(difficulty).randomTopN;
    const eligible = sorted.slice(0, topN);
    if (eligible.length === 1) return eligible[0]!;

    const weights = weightedBuckets[difficulty].slice(0, eligible.length);
    const threshold = Math.random();
    let cumulative = 0;

    for (let i = 0; i < eligible.length; i++) {
        cumulative += weights[i] ?? 0;
        if (threshold <= cumulative) return eligible[i]!;
    }

    // Floating-point rounding fallback — should be extremely rare
    return eligible[eligible.length - 1]!;
};
