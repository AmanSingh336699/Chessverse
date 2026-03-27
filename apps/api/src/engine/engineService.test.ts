import { Chess } from "chess.js";
import { describe, expect, it, vi } from "vitest";
import { defaultEngineState } from "../contracts.js";
import { EngineService } from "./engineService.js";
import { BehaviorEngine } from "./behaviorEngine.js";
import { loadPolyglotOpeningBook } from "../openingBook/polyglotBook.js";

describe("EngineService behavior pipeline", () => {
  const createLogger = () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    };
    logger.child.mockReturnValue(logger);
    return logger;
  };

  it("keeps Stockfish in the loop even when a bundled opening book is available", async () => {
    const withWorker = vi.fn(async (_gameId, task) => task({}));
    const analysisService = {
      getCandidatesWithMovetime: vi.fn().mockResolvedValue({
        candidates: [
          { move: "e2e4", eval: 0.34, multipv: 1, depth: 8, mate: null },
          { move: "d2d4", eval: 0.31, multipv: 2, depth: 8, mate: null },
        ],
        bestMove: "e2e4",
        thinkingTime: 91,
        partial: false,
        depthReached: 8,
      }),
      keepTopCandidates: vi.fn((candidates) => candidates),
      evaluatePosition: vi.fn().mockResolvedValue(0),
    };
    const logger = createLogger();
    const bundledBook = loadPolyglotOpeningBook(undefined);
    const behaviorEngine = new BehaviorEngine(bundledBook ? { openingBook: bundledBook } : {});
    const service = new EngineService(
      { withWorker } as never,
      analysisService as never,
      logger as never,
      behaviorEngine,
      bundledBook,
    );

    const decision = await service.chooseMove({
      gameId: "game-1",
      fen: new Chess().fen(),
      difficulty: "advanced",
      moveNumber: 1,
      aiColor: "white",
      engineState: defaultEngineState(),
      moveHistory: [],
    });

    expect(withWorker).toHaveBeenCalledTimes(1);
    expect(analysisService.getCandidatesWithMovetime).toHaveBeenCalledTimes(1);
    expect(analysisService.getCandidatesWithMovetime).toHaveBeenCalledWith(
      expect.anything(),
      new Chess().fen(),
      660,
      8,
    );
    expect(["e2e4", "d2d4"]).toContain(decision.move);
    expect(decision.thinkingTime).toBe(91);
  });

  it("allows a gambit move to beat a quieter move when both stay inside the Stockfish floor", async () => {
    const afterE4 = new Chess();
    afterE4.move({ from: "e2", to: "e4" });
    const afterE5 = new Chess(afterE4.fen());
    afterE5.move({ from: "e7", to: "e5" });

    const withWorker = vi.fn(async (_gameId, task) => task({}));
    const analysisService = {
      getCandidatesWithMovetime: vi.fn().mockResolvedValue({
        candidates: [
          { move: "g1f3", eval: 0.4, multipv: 1, depth: 8, mate: null },
          { move: "f2f4", eval: 0.2, multipv: 2, depth: 8, mate: null },
        ],
        bestMove: "g1f3",
        thinkingTime: 140,
        partial: false,
        depthReached: 8,
      }),
      keepTopCandidates: vi.fn((candidates) => candidates),
      evaluatePosition: vi.fn().mockResolvedValue(0.3),
    };
    const logger = createLogger();
    const openingBook = {
      getMove: () => null,
      getEntries: () => [{ move: "f2f4", weight: 50, learn: 0 }],
    };
    const behaviorEngine = new BehaviorEngine({ openingBook, logger: logger as never });
    const service = new EngineService(
      { withWorker } as never,
      analysisService as never,
      logger as never,
      behaviorEngine,
      openingBook as never,
    );

    const decision = await service.chooseMove({
      gameId: "game-2",
      fen: afterE5.fen(),
      difficulty: "master",
      moveNumber: 2,
      aiColor: "white",
      engineState: defaultEngineState(),
      moveHistory: [
        {
          moveNumber: 1,
          player: "ai",
          fenBefore: new Chess().fen(),
          fenAfter: afterE4.fen(),
          moveUci: "e2e4",
          moveNotation: "e4",
          evaluation: 0,
          engineMode: "stockfish",
          timestamp: new Date(0).toISOString(),
        },
        {
          moveNumber: 2,
          player: "human",
          fenBefore: afterE4.fen(),
          fenAfter: afterE5.fen(),
          moveUci: "e7e5",
          moveNotation: "e5",
          evaluation: 0,
          engineMode: null,
          timestamp: new Date(1).toISOString(),
        },
      ],
    });

    expect(decision.move).toBe("f2f4");
    expect(decision.engineMode).toBe("gambit");
    expect(decision.engineState.gambit.status).toBe("offered");
    expect(decision.engineState.gambit.line).toBe("King's Gambit");
  });

  it("enriches opening candidates from the opening book when Stockfish omits the gambit move", async () => {
    const afterE4 = new Chess();
    afterE4.move({ from: "e2", to: "e4" });
    const afterE5 = new Chess(afterE4.fen());
    afterE5.move({ from: "e7", to: "e5" });

    const withWorker = vi.fn(async (_gameId, task) => task({}));
    const analysisService = {
      getCandidatesWithMovetime: vi.fn().mockResolvedValue({
        candidates: [
          { move: "g1f3", eval: 0.35, multipv: 1, depth: 8, mate: null },
          { move: "b1c3", eval: 0.22, multipv: 2, depth: 8, mate: null },
        ],
        bestMove: "g1f3",
        thinkingTime: 64,
        partial: false,
        depthReached: 8,
      }),
      keepTopCandidates: vi.fn((candidates) => candidates),
      evaluatePosition: vi.fn().mockResolvedValue(-0.12),
    };
    const logger = createLogger();
    const openingBook = {
      getMove: () => "f2f4",
      getEntries: () => [{ move: "f2f4", weight: 80, learn: 0 }],
    };
    const behaviorEngine = new BehaviorEngine({ openingBook, logger: logger as never });
    const service = new EngineService(
      { withWorker } as never,
      analysisService as never,
      logger as never,
      behaviorEngine,
      openingBook as never,
    );

    const decision = await service.chooseMove({
      gameId: "game-book",
      fen: afterE5.fen(),
      difficulty: "master",
      moveNumber: 2,
      aiColor: "white",
      engineState: defaultEngineState(),
      moveHistory: [
        {
          moveNumber: 1,
          player: "ai",
          fenBefore: new Chess().fen(),
          fenAfter: afterE4.fen(),
          moveUci: "e2e4",
          moveNotation: "e4",
          evaluation: 0,
          engineMode: "stockfish",
          timestamp: new Date(0).toISOString(),
        },
        {
          moveNumber: 2,
          player: "human",
          fenBefore: afterE4.fen(),
          fenAfter: afterE5.fen(),
          moveUci: "e7e5",
          moveNotation: "e5",
          evaluation: 0,
          engineMode: null,
          timestamp: new Date(1).toISOString(),
        },
      ],
    });

    expect(analysisService.getCandidatesWithMovetime).toHaveBeenCalledWith(
      expect.anything(),
      afterE5.fen(),
      1200,
      8,
    );
    expect(analysisService.evaluatePosition).toHaveBeenCalled();
    expect(decision.move).toBe("f2f4");
    expect(decision.engineMode).toBe("gambit");
  });
});
