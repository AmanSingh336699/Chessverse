import type { GambitState } from "../../contracts.js";
import { Chess } from "chess.js";
import { describe, expect, it, vi } from "vitest";
import {
  GambitEngine,
  type OpeningBook,
  type GambitStateSink,
} from "./gambitEngine.js";
import {
  createFailedGambitState,
  createOfferedGambitState,
  decrementGambitCooldown,
  resolveGambitReplyState,
} from "./gambitState.js";

const openingContext = {
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  history: [] as string[],
  moveNumber: 1,
  aiColor: "white" as const,
  phase: "opening" as const,
};

const buildBookContinuationMock = (): OpeningBook => {
  const afterOffer = new Chess();
  afterOffer.move({ from: "e2", to: "e4" });
  afterOffer.move({ from: "e7", to: "e5" });
  afterOffer.move({ from: "f2", to: "f4" });

  const accepted = new Chess(afterOffer.fen());
  accepted.move({ from: "e5", to: "f4" });

  const entriesByFen = new Map<string, readonly { move: string; weight: number }[]>([
    [afterOffer.fen(), [{ move: "e5f4", weight: 32 }]],
    [accepted.fen(), [{ move: "g1f3", weight: 28 }]],
  ]);

  return {
    getMove: (fen) => entriesByFen.get(fen)?.[0]?.move ?? null,
    getEntries: (fen) => entriesByFen.get(fen) ?? [],
  };
};

describe("GambitEngine", () => {
  it("returns +25 when a candidate continues a gambit prefix", () => {
    const engine = new GambitEngine();

    const score = engine.scoreCandidate(
      {
        ...openingContext,
        history: ["e2e4", "e7e5"],
        moveNumber: 3,
      },
      { move: "g1f3", eval: 0.2 },
    );

    expect(score).toBe(25);
  });

  it("returns +50 when a candidate completes a gambit line", () => {
    const engine = new GambitEngine();

    const score = engine.scoreCandidate(
      {
        ...openingContext,
        history: ["e2e4", "e7e5"],
        moveNumber: 3,
      },
      { move: "f2f4", eval: 0.35 },
    );

    expect(score).toBe(50);
  });

  it("returns +25 for a book-backed continuation after the gambit is offered", () => {
    const engine = new GambitEngine({ openingBook: buildBookContinuationMock() });

    const score = engine.scoreCandidate(
      {
        ...openingContext,
        fen: "rnbqkbnr/pppp1ppp/8/8/5p2/8/PPPPP1PP/RNBQKBNR w KQkq - 0 3",
        history: ["e2e4", "e7e5", "f2f4", "e5f4"],
        moveNumber: 5,
        gambitState: createOfferedGambitState("King's Gambit"),
      },
      { move: "g1f3", eval: 0.28 },
    );

    expect(score).toBe(25);
  });

  it("returns 0 for non-gambit candidates", () => {
    const engine = new GambitEngine();

    const score = engine.scoreCandidate(openingContext, { move: "a2a3", eval: 0.1 });

    expect(score).toBe(0);
  });

  it("returns 0 outside the opening window", () => {
    const engine = new GambitEngine();

    const score = engine.scoreCandidate(
      {
        ...openingContext,
        moveNumber: 10,
        phase: "middlegame",
      },
      { move: "f2f4", eval: 0.4 },
    );

    expect(score).toBe(0);
  });

  it("returns 0 when stockfish eval is too negative", () => {
    const engine = new GambitEngine();

    const score = engine.scoreCandidate(
      {
        ...openingContext,
        history: ["e2e4", "e7e5"],
        moveNumber: 3,
      },
      { move: "f2f4", eval: -1.6 },
    );

    expect(score).toBe(0);
  });

  it("returns 0 for malformed history instead of throwing", () => {
    const engine = new GambitEngine();

    const score = engine.scoreCandidate(
      {
        ...openingContext,
        history: ["bad-move"],
      },
      { move: "f2f4", eval: 0.1 },
    );

    expect(score).toBe(0);
  });

  it("suppresses all bonuses during failed cooldown", () => {
    const engine = new GambitEngine();

    const score = engine.scoreCandidate(
      {
        ...openingContext,
        history: ["e2e4", "e7e5"],
        moveNumber: 3,
        gambitState: createFailedGambitState(
          createOfferedGambitState("King's Gambit"),
          5,
        ),
      },
      { move: "f2f4", eval: 0.2 },
    );

    expect(score).toBe(0);
  });

  it("scores opening-book gambit completions and persists offered state", () => {
    const persisted: GambitState[] = [];
    const openingBook: OpeningBook = {
      getMove: vi.fn(() => "f2f4"),
      getEntries: vi.fn(() => []),
    };
    const stateSink: GambitStateSink = {
      persist: (state) => {
        persisted.push(state);
      },
    };
    const engine = new GambitEngine({ openingBook, stateSink });

    const score = engine.scoreCandidate(
      {
        ...openingContext,
        history: ["e2e4", "e7e5"],
        moveNumber: 3,
      },
      { move: "f2f4", eval: 0.3 },
    );

    expect(score).toBe(50);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      active: true,
      line: "King's Gambit",
      status: "offered",
      cooldown: 0,
      handoffMode: "none",
      refuted: false,
    });
  });

  it("scores a book-backed gambit prefix without prematurely persisting offered state", () => {
    const persist = vi.fn();
    const engine = new GambitEngine({
      openingBook: {
        getMove: () => "e2e4",
        getEntries: () => [],
      },
      stateSink: { persist },
    });

    const score = engine.scoreCandidate(openingContext, { move: "e2e4", eval: 0.22 });

    expect(score).toBe(25);
    expect(persist).not.toHaveBeenCalled();
  });
});

describe("gambit outcome tracking", () => {
  const offered = createOfferedGambitState("King's Gambit");

  it("marks accepted when AI material drops after the opponent reply", () => {
    const next = resolveGambitReplyState({
      state: offered,
      aiColor: "white",
      beforeFen: "rnbqkbnr/pppp1ppp/8/4p3/5P2/8/PPPPP1PP/RNBQKBNR b KQkq - 0 2",
      afterFen: "rnbqkbnr/pppp1ppp/8/8/4p3/8/PPPPP1PP/RNBQKBNR w KQkq - 0 3",
    });

    expect(next.status).toBe("accepted");
    expect(next.active).toBe(true);
  });

  it("marks declined when AI material is unchanged after the opponent reply", () => {
    const next = resolveGambitReplyState({
      state: offered,
      aiColor: "white",
      beforeFen: "rnbqkbnr/pppp1ppp/8/4p3/5P2/8/PPPPP1PP/RNBQKBNR b KQkq - 0 2",
      afterFen: "rnbqkbnr/pppp1ppp/8/4p3/5P2/8/PPPPP1PP/RNBQKBNR w KQkq - 1 3",
    });

    expect(next.status).toBe("declined");
    expect(next.active).toBe(true);
  });

  it("marks failed and starts cooldown when evaluation collapses", () => {
    const next = resolveGambitReplyState({
      state: offered,
      aiColor: "white",
      beforeFen: "rnbqkbnr/pppp1ppp/8/4p3/5P2/8/PPPPP1PP/RNBQKBNR b KQkq - 0 2",
      afterFen: "rnbqkbnr/pppp1ppp/8/8/4p3/8/PPPPP1PP/RNBQKBNR w KQkq - 0 3",
      evaluation: -1.6,
    });

    expect(next.status).toBe("failed");
    expect(next.cooldown).toBe(5);
    expect(next.active).toBe(false);
  });

  it("decrements cooldown per ply and resets to idle when it expires", () => {
    let state = createFailedGambitState(offered, 2);
    state = decrementGambitCooldown(state, 1);
    expect(state.status).toBe("failed");
    expect(state.cooldown).toBe(1);

    state = decrementGambitCooldown(state, 1);
    expect(state).toMatchObject({
      active: false,
      status: "idle",
      cooldown: 0,
      handoffMode: "clean",
      refuted: false,
    });
  });
});