import { describe, expect, it, vi } from "vitest";
import { GameService, ValidationService } from "./gameService.js";
import { InMemoryGameRepository } from "../repositories/memoryGameRepository.js";
import type { EngineService } from "../engine/engineService.js";
import pino from "pino";
import { HttpError } from "../types.js";
import type { PlayerMoveRequest } from "@chessverse/contracts";

const logger = pino({ level: "silent" });

function createMockEngineService(overrides: Partial<EngineService> = {}): EngineService {
  return {
    getUnavailableReason: vi.fn().mockReturnValue(null),
    chooseMove: vi.fn().mockResolvedValue({
      move: "e7e5",
      moveNotation: "e5",
      evaluation: 15,
      thinkingTime: 50,
      engineMode: "stockfish",
      engineState: {
        gambit: { state: "none", gambitId: null, movesSinceTrigger: 0 },
        lastDecision: { strategy: "style-engine" },
      },
    }),
    getTopStockfishMove: vi.fn().mockResolvedValue({
      move: "e7e5",
      evaluation: 10,
    }),
    ...overrides,
  } as unknown as EngineService;
}

describe("GameService - Reliability & Safety Chain (Phase 1)", () => {
  it("same clientMoveId twice -> returns identical cached response and ply is not doubled (idempotency)", async () => {
    const repository = new InMemoryGameRepository();
    const validation = new ValidationService();
    const engine = createMockEngineService();
    const gameService = new GameService(repository, validation, engine, logger);

    const game = await gameService.createGame({
      playerColor: "white",
      difficulty: "intermediate",
    });

    const moveRequest: PlayerMoveRequest = {
      clientMoveId: "unique-client-move-1",
      expectedPly: 0,
      from: "e2",
      to: "e4",
    };

    // First submission
    const res1 = await gameService.applyPlayerMove(game.gameId, moveRequest);
    expect(res1.playerMove.moveUci).toBe("e2e4");
    expect(res1.aiMove?.moveUci).toBe("e7e5");

    const savedGameAfterMove1 = await gameService.getGame(game.gameId);
    const initialMoveCount = savedGameAfterMove1.moveHistory.length; // 2 plies (white + black)
    expect(initialMoveCount).toBe(2);

    // Second submission with identical clientMoveId
    const res2 = await gameService.applyPlayerMove(game.gameId, moveRequest);
    expect(res2).toEqual(res1);

    // History should not have doubled
    const savedGameAfterMove2 = await gameService.getGame(game.gameId);
    expect(savedGameAfterMove2.moveHistory.length).toBe(initialMoveCount);
  });

  it("two concurrent moves to the same game -> one 200 and one 409 conflict", async () => {
    const repository = new InMemoryGameRepository();
    const validation = new ValidationService();

    // Make engine take 100ms so concurrent requests overlap
    const engine = createMockEngineService({
      chooseMove: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return {
          move: "e7e5",
          moveNotation: "e5",
          evaluation: 15,
          thinkingTime: 100,
          engineMode: "stockfish",
          engineState: {
            gambit: { state: "none", gambitId: null, movesSinceTrigger: 0 },
            lastDecision: { strategy: "style-engine" },
          },
        };
      }),
    });

    const gameService = new GameService(repository, validation, engine, logger);
    const game = await gameService.createGame({
      playerColor: "white",
      difficulty: "intermediate",
    });

    const move1: PlayerMoveRequest = {
      clientMoveId: "client-move-a",
      expectedPly: 0,
      from: "e2",
      to: "e4",
    };

    const move2: PlayerMoveRequest = {
      clientMoveId: "client-move-b",
      expectedPly: 0,
      from: "d2",
      to: "d4",
    };

    // Fire both moves concurrently
    const results = await Promise.allSettled([
      gameService.applyPlayerMove(game.gameId, move1),
      gameService.applyPlayerMove(game.gameId, move2),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const error = (rejected[0] as PromiseRejectedResult).reason;
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).statusCode).toBe(409);
    expect((error as HttpError).message).toContain("already in flight");
  });

  it("stale expectedPly -> 409 conflict", async () => {
    const repository = new InMemoryGameRepository();
    const validation = new ValidationService();
    const engine = createMockEngineService();
    const gameService = new GameService(repository, validation, engine, logger);

    const game = await gameService.createGame({
      playerColor: "white",
      difficulty: "intermediate",
    });

    const moveRequest: PlayerMoveRequest = {
      clientMoveId: "client-move-stale",
      expectedPly: 5, // Game is at ply 0, so 5 is stale
      from: "e2",
      to: "e4",
    };

    await expect(
      gameService.applyPlayerMove(game.gameId, moveRequest),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("Stale ply"),
    });
  });

  it("engine returns illegal move -> fallback used (safe legal move, no 500)", async () => {
    const repository = new InMemoryGameRepository();
    const validation = new ValidationService();

    // Engine returns an illegal move e.g. "a1h8" (impossible for black on move 1)
    const engine = createMockEngineService({
      chooseMove: vi.fn().mockResolvedValue({
        move: "a1h8", // completely illegal for black
        moveNotation: "Qxh8",
        evaluation: 0,
        thinkingTime: 10,
        engineMode: "stockfish",
        engineState: {
          gambit: { state: "none", gambitId: null, movesSinceTrigger: 0 },
          lastDecision: { strategy: "style-engine" },
        },
      }),
      // pure Stockfish also returns an illegal move to test arbitrary legal move fallback
      getTopStockfishMove: vi.fn().mockResolvedValue({
        move: "h1a8", // also illegal
        evaluation: 0,
      }),
    });

    const gameService = new GameService(repository, validation, engine, logger);
    const game = await gameService.createGame({
      playerColor: "white",
      difficulty: "intermediate",
    });

    const moveRequest: PlayerMoveRequest = {
      clientMoveId: "client-move-illegal-test",
      expectedPly: 0,
      from: "e2",
      to: "e4",
    };

    const response = await gameService.applyPlayerMove(game.gameId, moveRequest);

    // Must not crash with 500, must have chosen a legal fallback move
    expect(response.aiMove).not.toBeNull();
    expect(response.aiMove?.strategy).toBe("arbitrary-legal-fallback");
    expect(typeof response.aiMove?.moveUci).toBe("string");
    expect(response.game.moveHistory).toHaveLength(2);
  });

  it("engine returns illegal move -> falls back to pure Stockfish top move if legal", async () => {
    const repository = new InMemoryGameRepository();
    const validation = new ValidationService();

    const engine = createMockEngineService({
      chooseMove: vi.fn().mockResolvedValue({
        move: "e1e8", // illegal style move
        moveNotation: "Ke8",
        evaluation: 0,
        thinkingTime: 10,
        engineMode: "stockfish",
        engineState: {
          gambit: { state: "none", gambitId: null, movesSinceTrigger: 0 },
          lastDecision: { strategy: "style-engine" },
        },
      }),
      getTopStockfishMove: vi.fn().mockResolvedValue({
        move: "c7c5", // valid Sicilian reply
        evaluation: -10,
      }),
    });

    const gameService = new GameService(repository, validation, engine, logger);
    const game = await gameService.createGame({
      playerColor: "white",
      difficulty: "intermediate",
    });

    const response = await gameService.applyPlayerMove(game.gameId, {
      clientMoveId: "client-move-sf-fallback",
      expectedPly: 0,
      from: "e2",
      to: "e4",
    });

    expect(response.aiMove?.moveUci).toBe("c7c5");
    expect(response.aiMove?.strategy).toBe("pure-stockfish-fallback");
  });

  it("engine down -> 503 and game state remains untouched (never auto-resigns)", async () => {
    const repository = new InMemoryGameRepository();
    const validation = new ValidationService();

    const engine = createMockEngineService({
      getUnavailableReason: vi.fn().mockReturnValue("Stockfish process crashed and not ready"),
    });

    const gameService = new GameService(repository, validation, engine, logger);
    const game = await gameService.createGame({
      playerColor: "white",
      difficulty: "intermediate",
    });

    const moveRequest: PlayerMoveRequest = {
      clientMoveId: "client-move-engine-down",
      expectedPly: 0,
      from: "e2",
      to: "e4",
    };

    await expect(
      gameService.applyPlayerMove(game.gameId, moveRequest),
    ).rejects.toMatchObject({
      statusCode: 503,
      message: "Engine unavailable",
    });

    // Check that game state is completely untouched: FEN starting, 0 moves, status playing
    const gameAfter = await gameService.getGame(game.gameId);
    expect(gameAfter.fen).toBe(game.fen);
    expect(gameAfter.moveHistory).toHaveLength(0);
    expect(gameAfter.status).toBe("playing");
    expect(gameAfter.result).toBeNull();
  });
});
