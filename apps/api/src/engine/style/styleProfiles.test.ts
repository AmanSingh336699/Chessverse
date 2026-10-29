import { describe, expect, it } from "vitest";
import {
  AGGRESSIVE_PROFILE,
  GAMBITEER_PROFILE,
  SOLID_PROFILE,
  STYLE_PROFILES,
  TRICKY_PROFILE,
  type CandidateMove,
} from "@chessverse/contracts";
import {
  applyBudgetFilter,
  calculateCandidateStyleScore,
  createMulberry32,
  isMoveSafeFromBlunder,
  resolveEngineMode,
  softmaxSelect,
} from "./stylePipeline.js";
import { findRepertoireMove } from "./repertoire.js";

describe("Phase 2: Style Profiles and Decision Pipeline", () => {
  describe("Budget Filter", () => {
    it("drops candidates whose cpLoss exceeds the evaluation budget (e.g. 120cp when budget is 80cp)", () => {
      const candidates: CandidateMove[] = [
        { move: "e2e4", eval: 0.2, multipv: 1, depth: 10, mate: null },
        { move: "d2d4", eval: 0.15, multipv: 2, depth: 10, mate: null }, // cpLoss: 5
        { move: "c2c4", eval: -0.5, multipv: 3, depth: 10, mate: null },  // cpLoss: 70 <= 80
        { move: "g1f3", eval: -1.0, multipv: 4, depth: 10, mate: null },  // cpLoss: 120 > 80 (should be dropped)
      ];

      const budgetCp = 80;
      const filtered = applyBudgetFilter(candidates, budgetCp);

      expect(filtered.map((c) => c.move)).toEqual(["e2e4", "d2d4", "c2c4"]);
      expect(filtered.some((c) => c.move === "g1f3")).toBe(false);
    });

    it("always preserves at least the top candidate if all candidates exceed budget", () => {
      const candidates: CandidateMove[] = [
        { move: "e2e4", eval: 0.5, multipv: 1, depth: 10, mate: null },
        { move: "a2a3", eval: -1.0, multipv: 2, depth: 10, mate: null }, // cpLoss: 150 > 25
      ];

      const filtered = applyBudgetFilter(candidates, 25);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.move).toBe("e2e4");
    });
  });

  describe("Centipawn Scoring and Softmax Selection", () => {
    it("computes candidate style score as -cpLoss + capped style bonuses in centipawns", () => {
      const candidate: CandidateMove = { move: "f2f4", eval: -0.2, multipv: 2, depth: 10, mate: null };
      const bestEval = 0.0;
      const bonusCp = 50; // Gambiteer bonus

      const scored = calculateCandidateStyleScore({ candidate, bestEval, bonusCp });
      expect(scored.cpLoss).toBe(20);
      expect(scored.bonus).toBe(50);
      expect(scored.finalScoreCp).toBe(30); // -20 + 50 = +30
    });

    it("seeded softmax pick is 100% deterministic with the same seed", () => {
      const candidates = [
        { move: "e2e4", eval: 0.2, multipv: 1, depth: 10, mate: null, cpLoss: 0, bonus: 0, finalScoreCp: 0 },
        { move: "f2f4", eval: -0.1, multipv: 2, depth: 10, mate: null, cpLoss: 30, bonus: 80, finalScoreCp: 50 },
        { move: "g1f3", eval: 0.1, multipv: 3, depth: 10, mate: null, cpLoss: 10, bonus: 20, finalScoreCp: 10 },
      ];

      const seed = 987654321;
      const pick1 = softmaxSelect(candidates, 0.8, seed);
      const pick2 = softmaxSelect(candidates, 0.8, seed);
      const pick3 = softmaxSelect(candidates, 0.8, seed);

      expect(pick1.move).toBe(pick2.move);
      expect(pick2.move).toBe(pick3.move);
    });

    it("createMulberry32 produces uniform deterministic values in [0, 1)", () => {
      const rng1 = createMulberry32(42);
      const rng2 = createMulberry32(42);

      const v1 = [rng1(), rng1(), rng1()];
      const v2 = [rng2(), rng2(), rng2()];

      expect(v1).toEqual(v2);
      v1.forEach((val) => {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(1);
      });
    });
  });

  describe("Blunder Guard", () => {
    it("vetoes a move that allows immediate mate-in-1 against AI", () => {
      // FEN where Black has Queen and Bishop battery. If White plays f2f3, Black mates with Qh4#
      // Scholar's mate threat: 1. e4 e5 2. Bc4 Nc6 3. Qh5 d6 4. Qxf7#
      const fen = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3";
      // Black to move: 3... d6 allows White Qxf7#
      // If AI is Black, is 3... d6 safe from blunder?
      const isSafeD6 = isMoveSafeFromBlunder(fen, "d7d6", "black");
      expect(isSafeD6).toBe(false); // Blunder! Allows immediate Qxf7# mate in 1

      // But 3... g7g6 blocks the queen and prevents mate
      const isSafeG6 = isMoveSafeFromBlunder(fen, "g7g6", "black");
      expect(isSafeG6).toBe(true);
    });

    it("vetoes a move that hangs the queen without compensation", () => {
      // White to move: Queen on d1. Moving Qd1-a4 into a pawn fork or square attacked by black piece
      // Position: 1. e4 d5. If White plays 2. Qh5??, Black can play Nf6.
      // If White plays Queen to attacked undefended square: e.g. Qd1 to f3 attacked by nothing vs Qd1 to g4 attacked by bishop
      // Let's set up: White queen moves to c6 where Black pawn on b7 captures it
      const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
      // White cannot move Qd1 to c6 legally anyway, but let's test a position where Queen can move to an attacked undefended square:
      // 1. e4 e5 2. d4 exd4 3. Qxd4 Nc6 (Queen on d4)
      const fenQueenOnD4 = "r1bqkbnr/pppp1ppp/2n5/8/3QP3/8/PPP2PPP/RNB1KBNR w KQkq - 1 4";
      // If White moves 4. Qd4 to b6 (b6 is attacked by Black's a7 or c7 pawns and undefended)
      const isHangingQueen = isMoveSafeFromBlunder(fenQueenOnD4, "d4b6", "white");
      expect(isHangingQueen).toBe(false);

      // But 4. Qd4-d1 (retreating to safety) is safe
      const isSafeRetreat = isMoveSafeFromBlunder(fenQueenOnD4, "d4d1", "white");
      expect(isSafeRetreat).toBe(true);
    });
  });

  describe("Mode State Machine & Safety Valves", () => {
    it("triggers convert mode (pure Stockfish) when evaluation >= +300cp", () => {
      const mode = resolveEngineMode({
        phase: "middlegame",
        evalCp: 350,
        profile: GAMBITEER_PROFILE,
        isGambitActive: true,
        hasAttackAdvantage: true,
      });

      expect(mode).toBe("convert");
    });

    it("triggers swindle mode when evaluation <= -150cp", () => {
      const mode = resolveEngineMode({
        phase: "middlegame",
        evalCp: -180,
        profile: SOLID_PROFILE,
        isGambitActive: false,
        hasAttackAdvantage: false,
      });

      expect(mode).toBe("swindle");
    });

    it("selects gambit mode when gambit is active within normal eval range", () => {
      const mode = resolveEngineMode({
        phase: "opening",
        evalCp: -30,
        profile: GAMBITEER_PROFILE,
        isGambitActive: true,
        hasAttackAdvantage: false,
      });

      expect(mode).toBe("gambit");
    });

    it("selects attack mode when attack advantage is present", () => {
      const mode = resolveEngineMode({
        phase: "middlegame",
        evalCp: 150,
        profile: AGGRESSIVE_PROFILE,
        isGambitActive: false,
        hasAttackAdvantage: true,
      });

      expect(mode).toBe("attack");
    });

    it("selects endgame mode during endgame phase within normal eval bounds", () => {
      const mode = resolveEngineMode({
        phase: "endgame",
        evalCp: 50,
        profile: SOLID_PROFILE,
        isGambitActive: false,
        hasAttackAdvantage: false,
      });

      expect(mode).toBe("endgame");
    });
  });

  describe("Draw Offer Acceptance Rules per Style", () => {
    it("Solid accepts equal or negative positions (minEvalCp: 0)", () => {
      const { drawAcceptance } = SOLID_PROFILE;
      expect(drawAcceptance.minEvalCp).toBe(0);

      // AI eval 0 -> accepts
      expect(0 <= drawAcceptance.minEvalCp).toBe(true);
      // AI eval -30 -> accepts
      expect(-30 <= drawAcceptance.minEvalCp).toBe(true);
      // AI eval +50 -> declines (pushes for win)
      expect(50 <= drawAcceptance.minEvalCp).toBe(false);
    });

    it("Aggressive has contempt and declines unless <= -150cp", () => {
      const { drawAcceptance } = AGGRESSIVE_PROFILE;
      expect(drawAcceptance.minEvalCp).toBe(-150);
      expect(drawAcceptance.allowContempt).toBe(true);

      // AI eval 0 -> declines
      expect(0 <= drawAcceptance.minEvalCp).toBe(false);
      // AI eval -100 -> declines (fights on)
      expect(-100 <= drawAcceptance.minEvalCp).toBe(false);
      // AI eval -180 -> accepts
      expect(-180 <= drawAcceptance.minEvalCp).toBe(true);
    });

    it("Gambiteer maintains deep contempt and declines unless <= -200cp", () => {
      const { drawAcceptance } = GAMBITEER_PROFILE;
      expect(drawAcceptance.minEvalCp).toBe(-200);

      // AI eval -150 -> declines
      expect(-150 <= drawAcceptance.minEvalCp).toBe(false);
      // AI eval -220 -> accepts
      expect(-220 <= drawAcceptance.minEvalCp).toBe(true);
    });

    it("Tricky declines balanced positions and seeks swindles unless <= -100cp", () => {
      const { drawAcceptance } = TRICKY_PROFILE;
      expect(drawAcceptance.minEvalCp).toBe(-100);

      // AI eval -50 -> declines (looks for tricks)
      expect(-50 <= drawAcceptance.minEvalCp).toBe(false);
      // AI eval -120 -> accepts
      expect(-120 <= drawAcceptance.minEvalCp).toBe(true);
    });
  });

  describe("Style Repertoire Integration", () => {
    it("finds King's Gambit for Gambiteer as White after 1. e4 e5", () => {
      const match = findRepertoireMove("gambiteer-repertoire", "white", ["e2e4", "e7e5"], 0);
      expect(match).not.toBeNull();
      expect(match?.move).toBe("f2f4");
      expect(match?.gambit.name).toBe("King's Gambit");
    });

    it("finds Stafford Gambit for Gambiteer as Black after 1. e4 e5 2. Nf3 Nf6 3. Nxe5", () => {
      const history = ["e2e4", "e7e5", "g1f3", "g8f6", "f3e5"];
      const match = findRepertoireMove("gambiteer-repertoire", "black", history, 0);
      expect(match).not.toBeNull();
      expect(match?.move).toBe("b8c6");
      expect(match?.gambit.name).toBe("Stafford Gambit");
    });

    it("discards repertoire line if evaluation drops below minEvalCp threshold", () => {
      // Evans gambit has minEvalCp: -80
      const history = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5"];
      // If position is severely losing (-150cp), line is discarded
      const match = findRepertoireMove("gambiteer-repertoire", "white", history, -150);
      expect(match).toBeNull();
    });
  });
});
