import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { detectGamePhase } from "./phaseDetector.js";

describe("detectGamePhase", () => {
  it("detects opening positions under move ten", () => {
    expect(detectGamePhase(4, new Chess())).toBe("opening");
  });

  it("detects endgame when queens are off and material is low", () => {
    const chess = new Chess("8/8/8/3k4/8/4K3/8/8 w - - 0 1");
    expect(detectGamePhase(20, chess)).toBe("endgame");
  });
});
