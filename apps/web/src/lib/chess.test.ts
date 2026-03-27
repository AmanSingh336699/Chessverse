import { describe, expect, it } from "vitest";
import { currentCheckSquare, materialBalance, statusLabel } from "./chess";

describe("frontend chess helpers", () => {
  it("returns a friendly status label", () => {
    expect(statusLabel("checkmate")).toBe("Checkmate");
  });

  it("finds the checked king square", () => {
    expect(currentCheckSquare("4k3/8/8/8/8/8/4Q3/4K3 b - - 0 1")).toBe("e8");
  });

  it("calculates material balance from the player perspective", () => {
    expect(materialBalance("4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1", "white")).toBe(9);
  });
});
