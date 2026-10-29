import { describe, expect, it } from "vitest";
import {
  currentCheckSquare,
  isSquare,
  legalTargetsForSquare,
  materialBalance,
  statusLabel,
  toChessMoveInput,
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
});
