import { defaultEngineState } from "../contracts.js";
import { describe, expect, it, vi } from "vitest";
import { chooseCandidate, computeStockfishWeight } from "./difficulty.js";

const createEvaluatedCandidate = (move: string, finalScore: number, evalScore = finalScore / 10) => ({
  move,
  eval: evalScore,
  multipv: 1,
  depth: 14,
  mate: null,
  engineMode: "stockfish" as const,
  annotation: {
    phaseTags: [],
    strategies: [],
    continuityDelta: 0,
    tacticalThemes: [],
    opponentPressure: defaultEngineState().opponentPressure,
    lastDecision: {
      dominantEngine: "stockfish" as const,
      move,
      moveNumber: 1,
    },
  },
  breakdown: {
    stockfishEval: evalScore,
    stockfishWeight: 0.5,
    gambit: 0,
    trap: 0,
    sacrifice: 0,
    aggression: 0,
    psychological: 0,
    finalScore,
  },
});

describe("computeStockfishWeight", () => {
  it("uses phase-driven baseline weights", () => {
    expect(computeStockfishWeight("opening", "advanced", defaultEngineState())).toBe(0.4);
    expect(computeStockfishWeight("middlegame", "advanced", defaultEngineState())).toBe(0.5);
    expect(computeStockfishWeight("endgame", "advanced", defaultEngineState())).toBe(0.9);
  });

  it("raises weight in fallback and pure-stockfish recovery", () => {
    const fallbackState = defaultEngineState();
    fallbackState.currentRecoveryMode = "fallback";
    expect(computeStockfishWeight("middlegame", "beginner", fallbackState)).toBe(0.8);

    const pureState = defaultEngineState();
    pureState.currentRecoveryMode = "pure-stockfish";
    expect(computeStockfishWeight("middlegame", "master", pureState)).toBe(1);
  });
});

describe("chooseCandidate", () => {
  it("throws when no evaluated candidates are available", () => {
    expect(() => chooseCandidate([], "advanced")).toThrow(/at least one evaluated candidate/i);
  });

  it("returns the only candidate without random selection", () => {
    const candidate = createEvaluatedCandidate("e2e4", 22.45, 0.45);
    expect(chooseCandidate([candidate], "master")).toBe(candidate);
  });

  it("uses fixed advanced weights across the top two candidates", () => {
    const first = createEvaluatedCandidate("e2e4", 22.45, 0.45);
    const second = createEvaluatedCandidate("d2d4", 12.25, 0.25);

    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.81);
    expect(chooseCandidate([first, second], "advanced")).toBe(second);
    randomSpy.mockRestore();
  });

  it("forces the top move in pure-stockfish mode", () => {
    const engineState = defaultEngineState();
    engineState.currentRecoveryMode = "pure-stockfish";
    const first = createEvaluatedCandidate("e2e4", 22.45, 0.45);
    const second = createEvaluatedCandidate("d2d4", 40, 0.5);

    expect(chooseCandidate([first, second], "beginner", engineState)).toBe(second);
  });
});