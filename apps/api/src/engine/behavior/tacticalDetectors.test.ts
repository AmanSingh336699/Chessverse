import { describe, expect, it } from "vitest";
import { SacrificeDetector } from "./sacrificeDetector.js";
import { materialOfferValue } from "./helpers.js";
import { isMoveSafeFromBlunder } from "../style/stylePipeline.js";
import { findRepertoireMove } from "../style/repertoire.js";

describe("Phase 2: Tactical Detectors (Sacrifices & Traps)", () => {
  describe("Sacrifice Detector", () => {
    it("detects Greek Gift sacrifice pattern (Bxh7+ against castled king with supporting knight)", () => {
      // Classic Greek Gift setup:
      // White: Bishop on d3 (or c4), Knight on f3, King on e1.
      // Black: King on g8 (castled), pawns on f7, g7, h7.
      // FEN: White bishop on d3 can capture h7 with Bxh7+ (d3h7)
      const fen = "r1bq1rk1/ppp2ppp/2n1pn2/3p4/3P4/3BPN2/PPP2PPP/RNBQK2R w KQ - 0 1";

      const offerValue = materialOfferValue(fen, "d3h7", "white");
      // White bishop (value 3) is sacrificed on h7 (which has a pawn of value 1) -> net 2 points offered
      expect(offerValue).toBeGreaterThan(0);
    });

    it("rejects hanging queen as a valid sacrifice (negative test)", () => {
      // White queen on d4 moves to b6 where Black's a7 pawn can capture it without compensation
      const fen = "r1bqkbnr/pppp1ppp/2n5/8/3QP3/8/PPP2PPP/RNB1KBNR w KQkq - 1 4";

      const isSafe = isMoveSafeFromBlunder(fen, "d4b6", "white");
      expect(isSafe).toBe(false); // Blunder guard rejects hanging queen
    });
  });

  describe("Trap Detector & Legal's Mate Line", () => {
    it("recognizes Legal's mate trap line in the style repertoire", () => {
      // Legal's Mate: 1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5!
      const history = [
        "e2e4",
        "e7e5",
        "g1f3",
        "d7d6",
        "f1c4",
        "c8g4",
        "b1c3",
        "g7g6",
      ];

      const match = findRepertoireMove("tricky-repertoire", "white", history, 0);
      expect(match).not.toBeNull();
      expect(match?.move).toBe("f3e5");
      expect(match?.gambit.name).toBe("Legal's Mate Trap");
    });
  });
});
