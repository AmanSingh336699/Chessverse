import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { loadPolyglotOpeningBook } from "../../openingBook/polyglotBook.js";
import { GambitEngine } from "./gambitEngine.js";

describe("GambitEngine performance", () => {
  it("scores candidates under 0.2 ms on average", () => {
    const openingBook = loadPolyglotOpeningBook(undefined);
    const engine = openingBook
      ? new GambitEngine({ openingBook })
      : new GambitEngine();
    const context = {
      fen: "rnbqkbnr/pppp1ppp/8/8/5p2/8/PPPPP1PP/RNBQKBNR w KQkq - 0 3",
      history: ["e2e4", "e7e5", "f2f4", "e5f4"],
      moveNumber: 5,
      aiColor: "white" as const,
      phase: "opening" as const,
      gambitState: {
        active: true,
        line: "King's Gambit",
        status: "offered" as const,
        cooldown: 0,
      },
    };
    const candidate = { move: "g1f3", eval: 0.32 };

    for (let index = 0; index < 20000; index += 1) {
      engine.scoreCandidate(context, candidate);
    }

    const iterations = 100000;
    const start = performance.now();
    for (let index = 0; index < iterations; index += 1) {
      engine.scoreCandidate(context, candidate);
    }
    const duration = performance.now() - start;
    const averageMs = duration / iterations;

    console.info(
      `GambitEngine average score time: ${averageMs.toFixed(6)} ms over ${iterations} iterations`,
    );
    expect(averageMs).toBeLessThan(0.2);
  });
});