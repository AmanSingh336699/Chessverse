import { describe, expect, it } from "vitest";
import {
  currentCheckSquare,
  describePremove,
  isSquare,
  legalTargetsForSquare,
  materialBalance,
  pseudoLegalTargetsForSquare,
  statusLabel,
  swapFenTurn,
  toChessMoveInput,
  validatePremoveLegality,
} from "./chess.js";

describe("web chess utils", () => {
  it("validates algebraic squares", () => {
    expect(isSquare("e4")).toBe(true);
    expect(isSquare("a1")).toBe(true);
    expect(isSquare("h8")).toBe(true);
    expect(isSquare("i9")).toBe(false);
    expect(isSquare("e")).toBe(false);
  });

  it("formats valid chess move inputs", () => {
    expect(toChessMoveInput("e2", "e4")).toEqual({ from: "e2", to: "e4" });
    expect(toChessMoveInput("e7", "e8", "q")).toEqual({
      from: "e7",
      to: "e8",
      promotion: "q",
    });
    expect(toChessMoveInput("invalid", "e4")).toBeNull();
  });

  it("calculates material balance accurately", () => {
    // Initial board: material balance is 0
    const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    expect(materialBalance(startFen, "white")).toBe(0);
    expect(materialBalance(startFen, "black")).toBe(0);

    // Board where white is up a queen
    const whiteUpQueenFen = "rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    expect(materialBalance(whiteUpQueenFen, "white")).toBe(9);
    expect(materialBalance(whiteUpQueenFen, "black")).toBe(-9);
  });

  it("detects checked king square", () => {
    // White king on e1 in check by black rook on e8, black king on a2
    const checkFen = "4r3/8/8/8/8/8/k7/4K3 w - - 0 1";
    expect(currentCheckSquare(checkFen)).toBe("e1");

    // No check position
    const normalFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    expect(currentCheckSquare(normalFen)).toBeNull();
  });

  it("lists legal targets for piece square", () => {
    const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const targets = legalTargetsForSquare(startFen, "e2");
    expect(targets).toEqual(expect.arrayContaining(["e3", "e4"]));
  });

  it("returns human friendly status label", () => {
    expect(statusLabel("checkmate")).toBe("Checkmate");
    expect(statusLabel("check")).toBe("Check");
    expect(statusLabel("draw")).toBe("Draw");
    expect(statusLabel("playing")).toBe("Playing");
  });

  describe("premove engine utilities", () => {
    it("swaps active turn in FEN and resets en-passant", () => {
      const fenWhiteTurn = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
      const swapped = swapFenTurn(fenWhiteTurn);
      expect(swapped).toContain(" w KQkq - 0 1");

      const backAgain = swapFenTurn(swapped);
      expect(backAgain).toContain(" b KQkq - 0 1");
    });

    it("calculates pseudo-legal candidate targets during opponent turn", () => {
      // 1. e4 played, black to move. Player is white with knight on g1.
      const fenBlackTurn = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
      const targets = pseudoLegalTargetsForSquare(fenBlackTurn, "g1", "w");
      expect(targets).toEqual(expect.arrayContaining(["f3", "h3"]));

      // Opponent's pieces return empty targets for the player
      const opponentTargets = pseudoLegalTargetsForSquare(fenBlackTurn, "b8", "w");
      expect(opponentTargets).toEqual([]);
    });

    it("validates premove execution against newly arrived board FEN", () => {
      // Suppose black responded 1... e5: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"
      const fenAfterAiMove = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";

      // Case 1: Legal premove (Nf3)
      const validResult = validatePremoveLegality(fenAfterAiMove, "g1", "f3");
      expect(validResult.legal).toBe(true);
      expect(validResult.san).toBe("Nf3");
      expect(validResult.uci).toBe("g1f3");
      expect(validResult.resultingFen).toBeDefined();

      // Case 2: Illegal premove (trying to move white pawn e4 to e5 which is blocked by black pawn)
      const blockedResult = validatePremoveLegality(fenAfterAiMove, "e4", "e5");
      expect(blockedResult.legal).toBe(false);

      // Case 3: Completely impossible move
      const impossibleResult = validatePremoveLegality(fenAfterAiMove, "a1", "h8");
      expect(impossibleResult.legal).toBe(false);
    });

    it("generates readable premove descriptions", () => {
      const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
      expect(describePremove(fen, "g1", "f3")).toBe("Premove queued: Knight to f3");
      expect(describePremove(fen, "e2", "e4")).toBe("Premove queued: Pawn to e4");
    });
  });
});
