import { describe, expect, it, vi } from "vitest";
import { Chess } from "chess.js";
import { GameService, ValidationService } from "../services/gameService.js";
import { InMemoryGameRepository } from "../repositories/memoryGameRepository.js";
import type { EngineService } from "./engineService.js";
import pino from "pino";
import type { PlayerMoveRequest } from "@chessverse/contracts";

const logger = pino({ level: "silent" });

/**
 * Creates an intelligent mock engine that always plays a legal move for its color.
 */
function createDynamicLegalEngine(): EngineService {
  return {
    getUnavailableReason: vi.fn().mockReturnValue(null),
    chooseMove: vi.fn().mockImplementation(async (params: { fen: string } | string) => {
      const fen = typeof params === "string" ? params : params.fen;
      const chess = new Chess(fen);
      const legalMoves = chess.moves({ verbose: true });
      if (legalMoves.length === 0) {
        throw new Error("No legal moves available for engine");
      }
      const chosen = legalMoves[0]!;
      return {
        move: `${chosen.from}${chosen.to}${chosen.promotion ?? ""}`,
        moveNotation: chosen.san,
        evaluation: 0,
        thinkingTime: 10,
        engineMode: "stockfish",
        engineState: {
          gambit: { state: "none", gambitId: null, movesSinceTrigger: 0 },
          lastDecision: { strategy: "soak-test" },
        },
      };
    }),
    getTopStockfishMove: vi.fn().mockImplementation(async (params: { fen: string } | string) => {
      const fen = typeof params === "string" ? params : params.fen;
      const chess = new Chess(fen);
      const legalMoves = chess.moves({ verbose: true });
      const chosen = legalMoves[0]!;
      return {
        move: `${chosen.from}${chosen.to}${chosen.promotion ?? ""}`,
        evaluation: 0,
      };
    }),
  } as unknown as EngineService;
}

describe("Phase 5: Fuzz & Soak Invariant Hardening", () => {
  it("maintains strict chess invariants across multi-ply simulated games", async () => {
    const repository = new InMemoryGameRepository();
    const validation = new ValidationService();
    const engine = createDynamicLegalEngine();
    const gameService = new GameService(repository, validation, engine, logger);

    const game = await gameService.createGame({
      playerColor: "white",
      difficulty: "advanced",
      style: "aggressive",
    });

    let currentFen = game.fen;
    let expectedPly = 0;

    // Simulate 20 successive move cycles (40 half-moves / plies)
    for (let cycle = 0; cycle < 20; cycle++) {
      const chess = new Chess(currentFen);
      if (chess.isGameOver()) {
        break;
      }

      const legalHumanMoves = chess.moves({ verbose: true });
      if (legalHumanMoves.length === 0) {
        break;
      }

      // Pick a legal human move
      const chosenHumanMove = legalHumanMoves[cycle % legalHumanMoves.length]!;
      const clientMoveId = `soak-move-${cycle}-${chosenHumanMove.from}-${chosenHumanMove.to}`;

      const moveRequest: PlayerMoveRequest = {
        clientMoveId,
        expectedPly,
        from: chosenHumanMove.from,
        to: chosenHumanMove.to,
        ...(chosenHumanMove.promotion ? { promotion: "q" } : {}),
      };

      const response = await gameService.applyPlayerMove(game.gameId, moveRequest);

      // INVARIANT 1: FEN must be valid chess syntax
      expect(() => new Chess(response.game.fen)).not.toThrow();

      // INVARIANT 2: Player move must be recorded as human
      expect(response.playerMove.player).toBe("human");
      expect(response.playerMove.moveUci).toBe(
        `${chosenHumanMove.from}${chosenHumanMove.to}${chosenHumanMove.promotion ?? ""}`,
      );

      // INVARIANT 3: Ply count must increment monotonically
      if (response.aiMove) {
        expectedPly += 2;
        expect(response.game.moveHistory.length).toBe(expectedPly);
        expect(response.aiMove.player).toBe("ai");
      } else {
        expectedPly += 1;
        expect(response.game.moveHistory.length).toBe(expectedPly);
      }

      // INVARIANT 4: Idempotency under identical clientMoveId
      const replayResponse = await gameService.applyPlayerMove(game.gameId, moveRequest);
      expect(replayResponse.game.moveHistory.length).toBe(response.game.moveHistory.length);
      expect(replayResponse.game.fen).toBe(response.game.fen);

      currentFen = response.game.fen;
    }

    // Verify final state persistence
    const saved = await gameService.getGame(game.gameId);
    expect(saved.moveHistory.length).toBe(expectedPly);
    expect(() => new Chess(saved.fen)).not.toThrow();
  });

  it("handles high-concurrency game creation without state bleeding or ID collisions", async () => {
    const repository = new InMemoryGameRepository();
    const validation = new ValidationService();
    const engine = createDynamicLegalEngine();
    const gameService = new GameService(repository, validation, engine, logger);

    const STYLES = ["solid", "aggressive", "gambiteer", "tricky"] as const;
    const concurrentCount = 25;

    const gamePromises = Array.from({ length: concurrentCount }).map((_, i) =>
      gameService.createGame({
        playerColor: i % 2 === 0 ? "white" : "black",
        difficulty: "intermediate",
        style: STYLES[i % STYLES.length],
      }),
    );

    const games = await Promise.all(gamePromises);
    const ids = new Set(games.map((g) => g.gameId));

    // All game IDs must be uniquely generated UUIDs
    expect(ids.size).toBe(concurrentCount);

    // Each game retains its requested style and independent board
    for (let i = 0; i < concurrentCount; i++) {
      expect(games[i]!.style).toBe(STYLES[i % STYLES.length]);
      expect(games[i]!.fen).toBeDefined();
    }
  });
});
