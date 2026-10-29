import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { detectGamePhase } from "./phaseDetector.js";

describe("detectGamePhase", () => {
  it("classifies initial moves as opening", () => {
    const chess = new Chess();
    expect(detectGamePhase(1, chess)).toBe("opening");
    expect(detectGamePhase(5, chess)).toBe("opening");
  });

  it("classifies endgames when major material is reduced", () => {
    // King + pawn endgame
    const chess = new Chess("4k3/4p3/8/8/8/8/4P3/4K3 w - - 0 35");
    expect(detectGamePhase(35, chess)).toBe("endgame");
  });

  it("classifies middlegame when past opening threshold with material present", () => {
    const chess = new Chess();
    // Move number 15 with full board
    expect(detectGamePhase(15, chess)).toBe("middlegame");
  });
});
