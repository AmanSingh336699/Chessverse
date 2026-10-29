import { describe, expect, it } from "vitest";
import {
  calculateEvalLoss,
  classifyByEvalLoss,
  DEFAULT_THRESHOLDS,
  normalizeMateScore,
} from "./classifyMove.js";
import { detectBrilliant } from "./brilliantDetector.js";

describe("Phase 2: Move Classification & Brilliant Detector", () => {
  describe("ClassifyMove boundary values", () => {
    it("classifies <= 0.2 loss as 'best'", () => {
      expect(classifyByEvalLoss(0.0)).toBe("best");
      expect(classifyByEvalLoss(0.19)).toBe("best");
      expect(classifyByEvalLoss(0.2)).toBe("best");
    });

    it("classifies <= 0.5 loss as 'excellent'", () => {
      expect(classifyByEvalLoss(0.21)).toBe("excellent");
      expect(classifyByEvalLoss(0.49)).toBe("excellent");
      expect(classifyByEvalLoss(0.5)).toBe("excellent");
    });

    it("classifies <= 1.0 loss as 'good'", () => {
      expect(classifyByEvalLoss(0.51)).toBe("good");
      expect(classifyByEvalLoss(0.99)).toBe("good");
      expect(classifyByEvalLoss(1.0)).toBe("good");
    });

    it("classifies <= 2.0 loss as 'inaccuracy'", () => {
      expect(classifyByEvalLoss(1.01)).toBe("inaccuracy");
      expect(classifyByEvalLoss(1.99)).toBe("inaccuracy");
      expect(classifyByEvalLoss(2.0)).toBe("inaccuracy");
    });

    it("classifies <= 4.0 loss as 'mistake'", () => {
      expect(classifyByEvalLoss(2.01)).toBe("mistake");
      expect(classifyByEvalLoss(3.99)).toBe("mistake");
      expect(classifyByEvalLoss(4.0)).toBe("mistake");
    });

    it("classifies > 4.0 loss as 'blunder'", () => {
      expect(classifyByEvalLoss(4.01)).toBe("blunder");
      expect(classifyByEvalLoss(10.0)).toBe("blunder");
    });

    it("immediately classifies as blunder when allowing mate against the player", () => {
      expect(classifyByEvalLoss(0.1, DEFAULT_THRESHOLDS, { isMateAgainstPlayer: true })).toBe("blunder");
    });
  });

  describe("Black perspective evaluation loss", () => {
    it("computes eval loss correctly for White", () => {
      // White was +1.0, after move became +0.2 -> White lost 0.8 pawns
      const loss = calculateEvalLoss(1.0, 0.2, "white");
      expect(loss).toBeCloseTo(0.8);
    });

    it("computes eval loss correctly for Black", () => {
      // White eval was -1.0 (Black was +1.0). After move White eval is +0.5 (White is ahead)
      // Black lost 1.5 pawns
      const loss = calculateEvalLoss(-1.0, 0.5, "black");
      expect(loss).toBeCloseTo(1.5);

      // Black improved from -0.5 to -1.5 (Black gained 1.0) -> negative loss (gain)
      const gain = calculateEvalLoss(-0.5, -1.5, "black");
      expect(gain).toBeCloseTo(-1.0);
    });
  });

  describe("Mate score normalization", () => {
    it("normalizes positive mate (mate in 1..N)", () => {
      expect(normalizeMateScore(1)).toBe(99);
      expect(normalizeMateScore(3)).toBe(97);
      expect(normalizeMateScore(15)).toBe(90); // clamped to min 90
    });

    it("normalizes negative mate (opponent mate in 1..N)", () => {
      expect(normalizeMateScore(-1)).toBe(-99);
      expect(normalizeMateScore(-3)).toBe(-97);
      expect(normalizeMateScore(-15)).toBe(-90); // clamped to max -90
    });
  });

  describe("Brilliant move condition 0: NOT awarded when already completely winning", () => {
    it("rejects Brilliant when engineBestEval >= +4.0 before the move", () => {
      const result = detectBrilliant({
        fenBefore: "r1bqkb1r/pppp1ppp/2n5/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 0 1",
        fenAfter: "r1bqkb1r/pppp1Npp/2n5/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR b KQkq - 0 1",
        moveUci: "f3f7",
        playerColor: "white",
        playerEval: 8.5,
        engineBestEval: 4.5, // Already completely winning (+4.5)
        engineBestMove: "f3f7",
        candidates: [],
      });

      expect(result.brilliant).toBe(false);
      expect(result.evidence[0]).toContain("Position is already completely winning");
    });

    it("rejects Brilliant when playerEval >= +7.0", () => {
      const result = detectBrilliant({
        fenBefore: "r1bqkb1r/pppp1ppp/2n5/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 0 1",
        fenAfter: "r1bqkb1r/pppp1Npp/2n5/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR b KQkq - 0 1",
        moveUci: "f3f7",
        playerColor: "white",
        playerEval: 7.5, // Eval after move is +7.5
        engineBestEval: 3.5,
        engineBestMove: "f3f7",
        candidates: [],
      });

      expect(result.brilliant).toBe(false);
      expect(result.evidence[0]).toContain("Position is already completely winning");
    });
  });
});
