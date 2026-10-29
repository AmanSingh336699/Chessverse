import { describe, expect, it, vi } from "vitest";
import { HybridGameRepository } from "./hybridGameRepository.js";
import type { PersistentGameRepository, StoredGame } from "../types.js";
import pino from "pino";
import { defaultEngineState } from "@chessverse/contracts";

const logger = pino({ level: "silent" });

function createMockStoredGame(gameId = "game-test-1"): StoredGame {
  const now = new Date().toISOString();
  return {
    gameId,
    playerColor: "white",
    difficulty: "intermediate",
    style: "solid",
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    status: "playing",
    moveHistory: [],
    evaluation: null,
    engineState: defaultEngineState(),
    result: null,
    totalMoves: 0,
    startTime: now,
    endTime: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("HybridGameRepository - Write-Behind & Persistence Resilience (Phase 1)", () => {
  it("DB down -> memory fallback keeps game immediately retrievable without crashing caller", async () => {
    const mockPersistent: PersistentGameRepository = {
      isHealthy: vi.fn().mockResolvedValue(false),
      getGame: vi.fn().mockRejectedValue(new Error("Database connection refused")),
      saveGame: vi.fn().mockRejectedValue(new Error("Database connection refused")),
      getUserGames: vi.fn().mockResolvedValue([]),
      getUserById: vi.fn().mockResolvedValue(null),
      getUserByUsernameOrEmail: vi.fn().mockResolvedValue(null),
      saveUser: vi.fn().mockResolvedValue(undefined),
      incrementEngineStats: vi.fn().mockRejectedValue(new Error("Database connection refused")),
    };

    const hybrid = new HybridGameRepository(logger, mockPersistent, 3);
    const game = createMockStoredGame("game-db-down");

    // Saving should succeed immediately in memory without throwing
    await hybrid.saveGame(game);

    // Immediate retrieval from memory succeeds even though DB is down
    const retrieved = await hybrid.getGame("game-db-down");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.gameId).toBe("game-db-down");
    expect(retrieved?.fen).toBe(game.fen);
  });

  it("flush() drains write-behind queue when persistent storage recovers", async () => {
    let dbOnline = false;
    const persistentStore = new Map<string, StoredGame>();

    const mockPersistent: PersistentGameRepository = {
      isHealthy: vi.fn(async () => dbOnline),
      getGame: vi.fn(async (id: string) => {
        if (!dbOnline) throw new Error("DB offline");
        return persistentStore.get(id) ?? null;
      }),
      saveGame: vi.fn(async (game: StoredGame) => {
        if (!dbOnline) throw new Error("DB offline");
        persistentStore.set(game.gameId, game);
      }),
      getUserGames: vi.fn().mockResolvedValue([]),
      getUserById: vi.fn().mockResolvedValue(null),
      getUserByUsernameOrEmail: vi.fn().mockResolvedValue(null),
      saveUser: vi.fn().mockResolvedValue(undefined),
      incrementEngineStats: vi.fn().mockResolvedValue(undefined),
    };

    const hybrid = new HybridGameRepository(logger, mockPersistent, 5);
    const game1 = createMockStoredGame("game-flush-1");
    const game2 = createMockStoredGame("game-flush-2");

    // DB is offline when saving
    await hybrid.saveGame(game1);
    await hybrid.saveGame(game2);

    expect(persistentStore.size).toBe(0);

    // Bring DB back online and flush
    dbOnline = true;
    await hybrid.flush(2000);

    expect(persistentStore.size).toBe(2);
    expect(persistentStore.get("game-flush-1")?.gameId).toBe("game-flush-1");
    expect(persistentStore.get("game-flush-2")?.gameId).toBe("game-flush-2");
  });

  it("reconcileStartup() loads games from persistent storage into memory cache", async () => {
    const existingGame = createMockStoredGame("existing-game");
    const mockPersistent: PersistentGameRepository = {
      isHealthy: vi.fn().mockResolvedValue(true),
      getGame: vi.fn().mockResolvedValue(existingGame),
      saveGame: vi.fn().mockResolvedValue(undefined),
      getUserGames: vi.fn().mockResolvedValue([]),
      getUserById: vi.fn().mockResolvedValue(null),
      getUserByUsernameOrEmail: vi.fn().mockResolvedValue(null),
      saveUser: vi.fn().mockResolvedValue(undefined),
      incrementEngineStats: vi.fn().mockResolvedValue(undefined),
    };

    const hybrid = new HybridGameRepository(logger, mockPersistent);
    await hybrid.reconcileStartup();

    // Now getGame should hit memory directly
    const loaded = await hybrid.getGame("existing-game");
    expect(loaded?.gameId).toBe("existing-game");
  });
});
