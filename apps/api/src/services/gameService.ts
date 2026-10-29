import {
  defaultEngineState,
  STYLE_PROFILES,
  type CreateGameRequest,
  type Difficulty,
  type GameHistoryResponse,
  type GameSummary,
  type MoveHistoryEntry,
  type PlayerColor,
  type PlayerMoveRequest,
  type StyleId,
  type UndoRequest,
} from "@chessverse/contracts";
import { Chess } from "chess.js";
import { randomUUID } from "node:crypto";
import type { GameRepository, StoredGame } from "../types.js";
import { HttpError } from "../types.js";
import { buildMovePayload, getFullmoveNumberFromFen, getStatusSnapshot, uciToMoveShape, validateFenStrict } from "../utils/chess.js";
import type { EngineService } from "../engine/engineService.js";
import type { MoveAnalysisService } from "../engine/moveAnalysis/moveAnalysisService.js";
import type { Logger } from "pino";
import {
  decrementGambitCooldown,
  normalizeGambitState,
  resolveGambitReplyState,
} from "../engine/behavior/gambitState.js";
import type { ContextStore } from "../engine/contextStore.js";
import type { SpeculationEngine } from "../engine/speculation.js";

const STARTING_FEN = new Chess().fen();
const oppositeColor = (color: PlayerColor): PlayerColor => (color === "white" ? "black" : "white");

export class ValidationService {
  validateFen(fen: string): Chess {
    const validation = validateFenStrict(fen);
    if (!validation.valid) {
      throw new HttpError(400, validation.error ?? "Invalid FEN string", { error: validation.error ?? "Invalid FEN string" });
    }

    return new Chess(fen);
  }

  ensureGamePlayable(chess: Chess): void {
    if (chess.isCheckmate() || chess.isStalemate() || chess.isDraw() || chess.isInsufficientMaterial()) {
      throw new HttpError(422, "Game is already over", { error: "Game is already over" });
    }
  }
}

export class GameService {
  private readonly inFlightMoves = new Set<string>();
  private readonly idempotencyCache = new Map<string, Map<string, import("@chessverse/contracts").PlayerMoveResponse>>();

  constructor(
    private readonly repository: GameRepository,
    private readonly validation: ValidationService,
    private readonly engineService: EngineService,
    private readonly logger: Logger,
    private readonly moveAnalysis?: MoveAnalysisService,
    private readonly contextStore?: ContextStore,
    private readonly speculation?: SpeculationEngine,
  ) {}

  async createGame(input: CreateGameRequest): Promise<StoredGame> {
    const now = new Date().toISOString();
    const gameId = randomUUID();
    const playerColor: PlayerColor = input.playerColor ?? "white";
    const difficulty: Difficulty = input.difficulty ?? "advanced";
    const style: StyleId = input.style ?? "solid";
    const baseGame: StoredGame = {
      gameId,
      userId: input.userId ?? null,
      playerColor,
      difficulty,
      style,
      fen: STARTING_FEN,
      status: "playing",
      moveHistory: [],
      evaluation: null,
      engineState: defaultEngineState(style),
      result: null,
      totalMoves: 0,
      startTime: now,
      endTime: null,
      createdAt: now,
      updatedAt: now,
    };

    const game = playerColor === "black"
      ? await this.playOpeningAiMove(baseGame)
      : baseGame;

    game.engineState.gambit = normalizeGambitState(game.engineState.gambit);
    await this.repository.saveGame(game);
    if (this.contextStore) {
      await this.contextStore.writeContext(
        game.gameId,
        game.engineState,
        game.moveHistory.length,
      );
    }
    await this.repository.incrementEngineStats({ totalGames: 1 });
    return game;
  }

  async getGame(gameId: string): Promise<StoredGame> {
    const game = await this.repository.getGame(gameId);
    if (!game) {
      throw new HttpError(404, "Game not found", { error: "Game not found" });
    }

    game.engineState.gambit = normalizeGambitState(game.engineState.gambit);
    return game;
  }

  async applyPlayerMove(gameId: string, move: PlayerMoveRequest) {
    // 1. Idempotency check: duplicate clientMoveId returns identical response
    const cachedResponse = this.idempotencyCache.get(gameId)?.get(move.clientMoveId);
    if (cachedResponse) {
      this.logger.info(
        { gameId, clientMoveId: move.clientMoveId },
        "Idempotent move replay detected — returning existing response",
      );
      return cachedResponse;
    }

    // 2. In-flight move conflict check (per-game mutex)
    if (this.inFlightMoves.has(gameId)) {
      throw new HttpError(409, "Move already in flight for this game", {
        error: "Move already in flight for this game",
      });
    }

    this.inFlightMoves.add(gameId);

    let releaseLock: (() => Promise<void>) | null = null;
    try {
      // 3. Stale expectedPly check
      const currentGame = await this.getGame(gameId);
      if (move.expectedPly !== currentGame.moveHistory.length) {
        throw new HttpError(
          409,
          `Stale ply: expected ${currentGame.moveHistory.length}, got ${move.expectedPly}`,
          {
            error: "Stale ply",
            expectedPly: currentGame.moveHistory.length,
            receivedPly: move.expectedPly,
          },
        );
      }

      // 4. Acquire distributed/context lock if Redis is configured
      if (this.contextStore) {
        releaseLock = await this.contextStore.acquireLock(gameId);
        if (releaseLock === null) {
          throw new HttpError(409, "Move already in flight for this game", {
            error: "Move already in flight for this game",
          });
        }
      }
      // Check if engine is available before modifying game state
      const unavailableReason = this.engineService.getUnavailableReason();
      if (unavailableReason) {
        throw new HttpError(503, "Engine unavailable", { error: "Engine unavailable" });
      }

      // Re-verify expectedPly against latest repository state
      const latestGame = await this.getGame(gameId);
      if (move.expectedPly !== latestGame.moveHistory.length) {
        throw new HttpError(
          409,
          `Stale ply: expected ${latestGame.moveHistory.length}, got ${move.expectedPly}`,
          {
            error: "Stale ply",
            expectedPly: latestGame.moveHistory.length,
            receivedPly: move.expectedPly,
          },
        );
      }

      const response = await this.applyPlayerMoveInner(gameId, move);

      // Cache response for clientMoveId idempotency
      let gameCache = this.idempotencyCache.get(gameId);
      if (!gameCache) {
        gameCache = new Map();
        this.idempotencyCache.set(gameId, gameCache);
      }
      gameCache.set(move.clientMoveId, response);
      if (gameCache.size > 50) {
        const oldest = gameCache.keys().next().value;
        if (oldest) gameCache.delete(oldest);
      }

      return response;
    } finally {
      this.inFlightMoves.delete(gameId);
      if (releaseLock) {
        await releaseLock();
      }
    }
  }

  private queueMoveAnalysisJob(params: {
    gameId: string;
    playerColor: PlayerColor;
    difficulty: Difficulty;
    playerMove: MoveHistoryEntry;
    aiMove: MoveHistoryEntry | null;
    playerEvalBeforeHint: number | null;
    aiEvalBeforeHint: number | null;
  }): void {
    if (!this.moveAnalysis) {
      return;
    }

    setImmediate(() => {
      void this.persistMoveAnalysis(params);
    });
  }

  private async persistMoveAnalysis(params: {
    gameId: string;
    playerColor: PlayerColor;
    difficulty: Difficulty;
    playerMove: MoveHistoryEntry;
    aiMove: MoveHistoryEntry | null;
    playerEvalBeforeHint: number | null;
    aiEvalBeforeHint: number | null;
  }): Promise<void> {
    if (!this.moveAnalysis) {
      return;
    }

    let playerAnalysis = null;
    let aiAnalysis = null;

    try {
      playerAnalysis = await this.moveAnalysis.analyzePlayerMove({
        gameId: params.gameId,
        fenBefore: params.playerMove.fenBefore,
        fenAfter: params.playerMove.fenAfter,
        moveUci: params.playerMove.moveUci,
        moveNotation: params.playerMove.moveNotation,
        playerColor: params.playerColor,
        difficulty: params.difficulty,
        evalBeforeHint: params.playerEvalBeforeHint,
      });
    } catch (error) {
      this.logger.warn(
        { gameId: params.gameId, move: params.playerMove.moveUci, error },
        "Background player move analysis failed",
      );
    }

    if (params.aiMove) {
      try {
        aiAnalysis = await this.moveAnalysis.analyzePlayerMove({
          gameId: params.gameId,
          fenBefore: params.aiMove.fenBefore,
          fenAfter: params.aiMove.fenAfter,
          moveUci: params.aiMove.moveUci,
          moveNotation: params.aiMove.moveNotation,
          playerColor: oppositeColor(params.playerColor),
          difficulty: params.difficulty,
          evalBeforeHint: params.aiEvalBeforeHint,
        });
      } catch (error) {
        this.logger.warn(
          { gameId: params.gameId, move: params.aiMove.moveUci, error },
          "Background AI move analysis failed",
        );
      }
    }

    if (!playerAnalysis && !aiAnalysis) {
      return;
    }

    const latestGame = await this.repository.getGame(params.gameId);
    if (!latestGame) {
      return;
    }

    let changed = false;
    latestGame.moveHistory = latestGame.moveHistory.map((entry) => {
      if (
        playerAnalysis &&
        entry.player === "human" &&
        entry.moveNumber === params.playerMove.moveNumber &&
        entry.moveUci === params.playerMove.moveUci
      ) {
        changed = true;
        return { ...entry, analysis: playerAnalysis };
      }

      if (
        aiAnalysis &&
        params.aiMove &&
        entry.player === "ai" &&
        entry.moveNumber === params.aiMove.moveNumber &&
        entry.moveUci === params.aiMove.moveUci
      ) {
        changed = true;
        return { ...entry, analysis: aiAnalysis };
      }

      return entry;
    });

    if (!changed) {
      return;
    }

    latestGame.updatedAt = new Date().toISOString();
    await this.repository.saveGame(latestGame);
  }

  private async applyPlayerMoveInner(gameId: string, move: PlayerMoveRequest) {
    const game = await this.getGame(gameId);

    let engineState = game.engineState;
    let contextDegraded = false;
    if (this.contextStore) {
      const ctxResult = await this.contextStore.readContext(
        gameId,
        game.moveHistory.length,
      );
      engineState = ctxResult.context.engineState;
      contextDegraded = ctxResult.degraded;
      if (contextDegraded) {
        this.logger.warn({ gameId, moveNumber: game.moveHistory.length }, "Operating in context-degraded mode");
      }
    }
    game.engineState = engineState;

    const chess = this.validation.validateFen(game.fen);
    this.validation.ensureGamePlayable(chess);

    const humanTurn = game.playerColor === "white" ? "w" : "b";
    if (chess.turn() !== humanTurn) {
      // Idempotency: If this move was already submitted and matches the last human move,
      // we can return the existing state instead of a 409 conflict.
      const lastMove = game.moveHistory.at(-1);
      const secondLastMove = game.moveHistory.at(-2);
      const matchingMove = lastMove?.player === "human" ? lastMove : (secondLastMove?.player === "human" ? secondLastMove : null);

      const moveUci = `${move.from}${move.to}${move.promotion ?? ""}`;
      if (matchingMove && matchingMove.moveUci === moveUci) {
        this.logger.info({ gameId, moveUci }, "Idempotent move submission detected — returning existing state");
        const aiMove = lastMove?.player === "ai" ? lastMove : null;
        return {
          game,
          playerMove: matchingMove,
          aiMove,
          evaluation: game.evaluation,
          engineMode: aiMove?.engineMode ?? null,
          thinkingTime: 0,
          moveAnalysis: null,
        };
      }

      throw new HttpError(409, "It is not the player's turn", { error: "It is not the player's turn" });
    }

    const beforeFen = chess.fen();
    const playerMovePayload = buildMovePayload(move.from, move.to, move.promotion);
    if (!playerMovePayload) {
      throw new HttpError(400, "Illegal move", { error: "Illegal move" });
    }

    const applied = chess.move(playerMovePayload);
    if (!applied) {
      throw new HttpError(400, "Illegal move", { error: "Illegal move" });
    }

    const playerEntry: MoveHistoryEntry = {
      moveNumber: game.moveHistory.length + 1,
      player: "human",
      fenBefore: beforeFen,
      fenAfter: chess.fen(),
      moveUci: `${applied.from}${applied.to}${applied.promotion ?? ""}`,
      moveNotation: applied.san,
      evaluation: game.evaluation,
      engineMode: null,
      timestamp: new Date().toISOString(),
    };

    game.moveHistory = [...game.moveHistory, playerEntry];
    game.fen = chess.fen();
    game.totalMoves = game.moveHistory.length;
    game.updatedAt = new Date().toISOString();
    game.engineState.gambit = normalizeGambitState(game.engineState.gambit);

    if (game.engineState.gambit.status === "offered") {
      game.engineState.gambit = resolveGambitReplyState({
        state: game.engineState.gambit,
        aiColor: oppositeColor(game.playerColor),
        beforeFen,
        afterFen: chess.fen(),
      });
    } else if (game.engineState.gambit.status === "failed" && game.engineState.gambit.cooldown > 0) {
      game.engineState.gambit = decrementGambitCooldown(game.engineState.gambit, 1);
    }

    const playerStatus = getStatusSnapshot(chess, game.playerColor);
    game.status = playerStatus.status;
    if (playerStatus.winner) {
      game.result = playerStatus.winner;
      game.endTime = new Date().toISOString();

      /* Run analysis even on game-ending moves (checkmate, stalemate) */
      let moveAnalysis = null;
      if (this.moveAnalysis) {
        this.queueMoveAnalysisJob({
          gameId: game.gameId,
          playerColor: game.playerColor,
          difficulty: game.difficulty,
          playerMove: playerEntry,
          aiMove: null,
          playerEvalBeforeHint: game.evaluation,
          aiEvalBeforeHint: null,
        });
      }

      await this.repository.saveGame(game);
      return {
        game,
        playerMove: playerEntry,
        aiMove: null,
        evaluation: game.evaluation,
        engineMode: null,
        thinkingTime: 0,
        moveAnalysis,
      };
    }

    // Safety Chain: style choice -> validate legality with chess.js -> pure Stockfish top move -> any legal move
    const aiChess = new Chess(game.fen);
    let chosenUci: string | null = null;
    let chosenSan: string | null = null;
    let chosenEval = 0;
    let chosenEngineMode: import("@chessverse/contracts").EngineMode = "stockfish";
    let chosenStrategy = "safety-chain";
    let nextEngineState = game.engineState;
    let thinkingTime = 0;

    // Step 1: Style choice
    try {
      const aiDecision = await this.engineService.chooseMove({
        gameId: game.gameId,
        fen: game.fen,
        difficulty: game.difficulty,
        style: game.style,
        moveNumber: getFullmoveNumberFromFen(game.fen),
        aiColor: oppositeColor(game.playerColor),
        engineState: game.engineState,
        moveHistory: game.moveHistory,
      });

      const payload = uciToMoveShape(aiDecision.move);
      if (payload) {
        const testMove = new Chess(game.fen).move(payload);
        if (testMove) {
          chosenUci = aiDecision.move;
          chosenSan = aiDecision.moveNotation;
          chosenEval = aiDecision.evaluation;
          chosenEngineMode = aiDecision.engineMode;
          chosenStrategy = aiDecision.engineState.lastDecision.strategy ?? "style-engine";
          nextEngineState = aiDecision.engineState;
          thinkingTime = aiDecision.thinkingTime;
        }
      }

      if (!chosenUci) {
        this.logger.warn(
          { gameId: game.gameId, move: aiDecision.move },
          "Style move was illegal according to chess.js — falling back to pure Stockfish",
        );
      }
    } catch (err) {
      if (err instanceof HttpError && err.statusCode === 503) {
        throw err;
      }
      this.logger.warn({ gameId: game.gameId, err }, "Style engine failed — falling back to pure Stockfish");
    }

    // Step 2: Pure Stockfish top move fallback
    if (!chosenUci) {
      try {
        const sfTop = await this.engineService.getTopStockfishMove(game.fen);
        if (sfTop) {
          const payload = uciToMoveShape(sfTop.move);
          if (payload) {
            const testMove = new Chess(game.fen).move(payload);
            if (testMove) {
              chosenUci = sfTop.move;
              chosenSan = testMove.san;
              chosenEval = sfTop.evaluation;
              chosenEngineMode = "stockfish";
              chosenStrategy = "pure-stockfish-fallback";
              this.logger.info({ gameId: game.gameId, chosenUci }, "Used pure Stockfish top move fallback");
            }
          }
        }
      } catch (err) {
        this.logger.warn({ gameId: game.gameId, err }, "Pure Stockfish fallback failed — falling back to legal move");
      }
    }

    // Step 3: Any legal move fallback
    if (!chosenUci) {
      const legalMoves = aiChess.moves({ verbose: true });
      if (legalMoves.length > 0) {
        const fallback = legalMoves[0]!;
        chosenUci = `${fallback.from}${fallback.to}${fallback.promotion ?? ""}`;
        chosenSan = fallback.san;
        chosenEval = 0;
        chosenEngineMode = "stockfish";
        chosenStrategy = "arbitrary-legal-fallback";
        this.logger.warn({ gameId: game.gameId, chosenUci }, "Used arbitrary legal move fallback");
      }
    }

    if (!chosenUci) {
      throw new HttpError(503, "Engine unavailable", { error: "Engine unavailable" });
    }

    const aiMovePayload = uciToMoveShape(chosenUci)!;
    aiChess.move(aiMovePayload);

    const aiEntry: MoveHistoryEntry = {
      moveNumber: game.moveHistory.length + 1,
      player: "ai",
      fenBefore: game.fen,
      fenAfter: aiChess.fen(),
      moveUci: chosenUci,
      moveNotation: chosenSan ?? chosenUci,
      evaluation: chosenEval,
      engineMode: chosenEngineMode,
      strategy: chosenStrategy,
      timestamp: new Date().toISOString(),
    };

    game.moveHistory = [...game.moveHistory, aiEntry];
    game.fen = aiChess.fen();
    game.totalMoves = game.moveHistory.length;
    const aiColor = oppositeColor(game.playerColor);
    game.evaluation = aiColor === "black" ? -chosenEval : chosenEval;
    game.engineState = nextEngineState;
    game.engineState.gambit = normalizeGambitState(game.engineState.gambit);
    game.updatedAt = new Date().toISOString();

    const pendingUndo = this.contextStore
      ? await this.contextStore.consumePendingUndo(gameId)
      : null;

    if (
      pendingUndo &&
      pendingUndo.pendingMoveNumber === playerEntry.moveNumber &&
      pendingUndo.pendingMoveUci === playerEntry.moveUci
    ) {
      this.logger.info(
        { gameId, moveNumber: playerEntry.moveNumber, move: playerEntry.moveUci },
        "Discarding in-flight player turn because an undo was requested",
      );
      return {
        game: await this.getGame(gameId),
        playerMove: playerEntry,
        aiMove: null,
        evaluation: null,
        engineMode: null,
        thinkingTime,
        moveAnalysis: null,
      };
    }

    const aiStatus = getStatusSnapshot(aiChess, game.playerColor);
    game.status = aiStatus.status;
    if (aiStatus.winner) {
      game.result = aiStatus.winner;
      game.endTime = new Date().toISOString();
    }

    await this.repository.saveGame(game);

    if (this.contextStore) {
      const writeSuccess = await this.contextStore.writeContext(
        gameId,
        game.engineState,
        game.moveHistory.length,
      );
      if (!writeSuccess) {
        this.logger.error({ gameId }, "Context write-back to Redis failed — context may be stale next move");
      }
    }

    await this.repository.incrementEngineStats({
      gambitsAttempted: chosenEngineMode === "gambit" ? 1 : 0,
      gambitsAccepted: game.engineState.gambit.status === "accepted" ? 1 : 0,
      sacrificesPlayed: chosenEngineMode === "sacrifice" ? 1 : 0,
      trapsSet: chosenEngineMode === "trap" ? 1 : 0,
      trapsTriggered: chosenEngineMode === "trap" ? 1 : 0,
      thinkingTimeMs: thinkingTime,
    });

    this.logger.info(
      {
        gameId,
        playerMove: playerEntry.moveUci,
        aiMove: aiEntry.moveUci,
        evaluation: chosenEval,
        engineMode: chosenEngineMode,
      },
      "Processed player move and AI response",
    );

    this.queueMoveAnalysisJob({
      gameId: game.gameId,
      playerColor: game.playerColor,
      difficulty: game.difficulty,
      playerMove: playerEntry,
      aiMove: aiEntry,
      playerEvalBeforeHint: playerEntry.evaluation,
      aiEvalBeforeHint: playerEntry.evaluation,
    });

    try {
      if (this.speculation && game.status === "playing") {
        void this.speculation.speculate({
          gameId: game.gameId,
          fen: game.fen,
          difficulty: game.difficulty,
          moveNumber: game.moveHistory.length,
          engineState: game.engineState,
        });
      }
    } catch (specError) {
      this.logger.warn({ gameId, error: specError }, "Speculation failed (non-critical)");
    }

    return {
      game,
      playerMove: playerEntry,
      aiMove: aiEntry,
      evaluation: chosenEval,
      engineMode: chosenEngineMode,
      thinkingTime,
      moveAnalysis: null,
    };
  }

  async undoGame(gameId: string, request: UndoRequest = {}): Promise<StoredGame> {
    const releaseLock = this.contextStore
      ? await this.contextStore.acquireLock(gameId)
      : null;

    if (this.contextStore && !releaseLock) {
      if (
        request.mode === "pending-player" &&
        request.pendingMoveNumber &&
        request.pendingMoveUci &&
        this.contextStore
      ) {
        await this.contextStore.markPendingUndo(
          gameId,
          request.pendingMoveNumber,
          request.pendingMoveUci,
        );
        return this.getGame(gameId);
      }

      throw new HttpError(429, "Another request is processing this game", {
        error: "Another request is processing this game",
      });
    }

    try {
      const game = await this.getGame(gameId);

      const plan = this.resolveUndoPlan(game, request);
      if (plan.type === "none") {
        if (plan.reason === "pending-not-persisted") {
          return game;
        }

        throw new HttpError(409, plan.message, {
          error: plan.message,
        });
      }

      const nextHistory = game.moveHistory.slice(0, Math.max(0, game.moveHistory.length - plan.removeCount));
      const fen = nextHistory.at(-1)?.fenAfter ?? STARTING_FEN;
      const chess = new Chess(fen);
      const status = getStatusSnapshot(chess, game.playerColor);
      const latestAiEntry = [...nextHistory].reverse().find((entry) => entry.player === "ai") ?? null;
      const snapshot = this.contextStore
        ? await this.contextStore.readSnapshot(gameId, nextHistory.length)
        : null;

      game.moveHistory = nextHistory;
      game.fen = fen;
      game.totalMoves = nextHistory.length;
      game.status = status.status;
      game.result = status.winner;
      game.evaluation = latestAiEntry?.evaluation ?? null;
      game.engineState = snapshot?.engineState ?? defaultEngineState();
      game.engineState.gambit = normalizeGambitState(game.engineState.gambit);
      game.updatedAt = new Date().toISOString();
      game.endTime = status.winner ? new Date().toISOString() : null;

      await this.repository.saveGame(game);

      this.speculation?.cancelForGame(gameId);
      if (this.contextStore) {
        await this.contextStore.writeContext(
          gameId,
          game.engineState,
          game.moveHistory.length,
        );
      }

      return game;
    } finally {
      await releaseLock?.();
    }
  }

  async resignGame(gameId: string): Promise<{ game: StoredGame; result: "win" | "loss" | "draw" }> {
    const game = await this.getGame(gameId);
    game.status = "resigned";
    game.result = "loss";
    game.endTime = new Date().toISOString();
    game.updatedAt = new Date().toISOString();
    await this.repository.saveGame(game);

    // Cancel speculation on resign
    this.speculation?.cancelForGame(gameId);

    return {
      game,
      result: "loss",
    };
  }

  async offerDraw(gameId: string): Promise<{ accepted: boolean; game: StoredGame }> {
    const game = await this.getGame(gameId);
    if (game.status !== "playing") {
      throw new HttpError(400, "Cannot offer draw on finished game", { error: "Cannot offer draw on finished game" });
    }

    const profile = STYLE_PROFILES[game.style] ?? STYLE_PROFILES.solid;
    const aiColor = oppositeColor(game.playerColor);
    const baseEvalCp = game.evaluation !== null ? Math.round(game.evaluation * 100) : 0;
    const aiEvalCp = aiColor === "white" ? baseEvalCp : -baseEvalCp;

    const accepted = aiEvalCp <= profile.drawAcceptance.minEvalCp;

    if (accepted) {
      game.status = "draw";
      game.result = "draw";
      game.endTime = new Date().toISOString();
      game.updatedAt = new Date().toISOString();
      await this.repository.saveGame(game);
      this.speculation?.cancelForGame(gameId);
    }

    return {
      accepted,
      game,
    };
  }

  private async playOpeningAiMove(game: StoredGame): Promise<StoredGame> {
    const aiDecision = await this.engineService.chooseMove({
      gameId: game.gameId,
      fen: game.fen,
      difficulty: game.difficulty,
      style: game.style,
      moveNumber: 1,
      aiColor: "white",
      engineState: game.engineState,
      moveHistory: [],
      depthOverride: 10,
    });

    const chess = new Chess(game.fen);
    const aiMovePayload = uciToMoveShape(aiDecision.move);
    if (!aiMovePayload) {
      throw new HttpError(500, "Engine produced an invalid opening move", { error: "Engine produced an invalid opening move" });
    }
    const aiMoveResult = chess.move(aiMovePayload);
    if (!aiMoveResult) {
      throw new HttpError(500, "Engine produced an illegal opening move", { error: "Engine produced an illegal opening move" });
    }

    game.moveHistory = [
      {
        moveNumber: 1,
        player: "ai",
        fenBefore: STARTING_FEN,
        fenAfter: chess.fen(),
        moveUci: aiDecision.move,
        moveNotation: aiDecision.moveNotation,
        evaluation: aiDecision.evaluation,
        engineMode: aiDecision.engineMode,
        strategy: aiDecision.engineState.lastDecision.strategy,
        timestamp: new Date().toISOString(),
      },
    ];
    game.fen = chess.fen();
    game.totalMoves = 1;
    game.evaluation = aiDecision.evaluation;
    game.engineState = aiDecision.engineState;
    game.engineState.gambit = normalizeGambitState(game.engineState.gambit);
    game.status = getStatusSnapshot(chess, game.playerColor).status;
    return game;
  }

  private resolveUndoPlan(
    game: StoredGame,
    request: UndoRequest,
  ):
    | { type: "none"; reason: "empty" | "difficulty" | "pending-not-persisted"; message: string }
    | { type: "undo"; removeCount: 1 | 2 } {
    const history = game.moveHistory;
    const last = history.at(-1) ?? null;
    const previous = history.at(-2) ?? null;

    if (history.length === 0) {
      return {
        type: "none",
        reason: "empty",
        message: "No moves to undo",
      };
    }

    if (
      request.mode === "pending-player" &&
      request.pendingMoveNumber &&
      request.pendingMoveUci
    ) {
      if (
        last?.player === "human" &&
        last.moveNumber === request.pendingMoveNumber &&
        last.moveUci === request.pendingMoveUci
      ) {
        return { type: "undo", removeCount: 1 };
      }

      if (
        last?.player === "ai" &&
        previous?.player === "human" &&
        previous.moveNumber === request.pendingMoveNumber &&
        previous.moveUci === request.pendingMoveUci
      ) {
        return { type: "undo", removeCount: 2 };
      }

      return {
        type: "none",
        reason: "pending-not-persisted",
        message: "Pending move was not persisted",
      };
    }

    if (last?.player === "human") {
      return { type: "undo", removeCount: 1 };
    }

    if (last?.player === "ai" && previous?.player === "human") {
      return { type: "undo", removeCount: 2 };
    }

    return {
      type: "none",
      reason: "empty",
      message: "No moves to undo",
    };
  }

  async getUserGameHistory(userId: string): Promise<GameHistoryResponse> {
    const games = await this.repository.getUserGames(userId);
    const summaries: GameSummary[] = games.map((game) => ({
      gameId: game.gameId,
      userId: game.userId ?? null,
      playerColor: game.playerColor,
      difficulty: game.difficulty,
      style: game.style,
      status: game.status,
      result: game.result,
      totalMoves: game.totalMoves,
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
      previewFen: game.fen,
    }));
    return {
      games: summaries,
      total: summaries.length,
    };
  }
}

