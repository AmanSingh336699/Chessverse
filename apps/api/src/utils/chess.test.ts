import { describe, expect, it } from "vitest";
import { getFullmoveNumberFromFen, validateFenStrict } from "./chess.js";

describe("validateFenStrict", () => {
  it("accepts valid FEN strings", () => {
    expect(validateFenStrict("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1").valid).toBe(true);
  });

  it("rejects malformed FEN strings", () => {
    const result = validateFenStrict("invalid fen");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("6");
  });
});

describe("getFullmoveNumberFromFen", () => {
  it("reads the fullmove counter from a valid FEN", () => {
    expect(getFullmoveNumberFromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 7")).toBe(7);
  });

  it("falls back to 1 when the FEN is malformed", () => {
    expect(getFullmoveNumberFromFen("invalid fen")).toBe(1);
  });
});
