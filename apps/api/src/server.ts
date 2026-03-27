import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  createGameRequestSchema,
  defaultEngineState,
  moveRequestSchema,
  playerMoveRequestSchema,
  undoRequestSchema,
} from "./contracts.js";
import { createDatabase } from "./db/client.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { createEvalCache } from "./utils/cache.js";
import { PostgresGameRepository } from "./repositories/postgresGameRepository.js";
import { HybridGameRepository } from "./repositories/hybridGameRepository.js";
import { WorkerPool } from "./engine/workerPool.js";
import { AnalysisService } from "./engine/analysisService.js";
import { EngineService } from "./engine/engineService.js";
import { GameService, ValidationService } from "./services/gameService.js";
import { HttpError } from "./types.js";
import { BehaviorEngine } from "./engine/behaviorEngine.js";
import { loadPolyglotOpeningBook } from "./openingBook/polyglotBook.js";
import { MoveAnalysisService } from "./engine/moveAnalysis/moveAnalysisService.js";
import { ContextStore } from "./engine/contextStore.js";
import { SpeculationEngine } from "./engine/speculation.js";
import { MetricsCollector } from "./utils/metrics.js";

const oppositeColor = (color: "white" | "black") =>
  color === "white" ? "black" : "white";

export const buildServer = async () => {
  const app = Fastify({
    loggerInstance: logger,
  });

  await app.register(cors, {
    origin: env.FRONTEND_ORIGIN,
  });

  const database = createDatabase();
  const persistentRepository = database
    ? new PostgresGameRepository(database.db, database.pool)
    : null;
  const repository = new HybridGameRepository(app.log, persistentRepository);
  const validationService = new ValidationService();
  const cache = await createEvalCache<number>(env.REDIS_URL, app.log);
  const candidateCache = await createEvalCache<import("./contracts.js").CandidateMove[]>(env.REDIS_URL, app.log);
  const workerPool = new WorkerPool(app.log);
  await workerPool.start();
  const analysisService = new AnalysisService(app.log, cache, candidateCache);
  const openingBook = loadPolyglotOpeningBook(env.OPENING_BOOK_PATH, app.log);
  const behaviorEngineOptions = {
    ...(openingBook ? { openingBook } : {}),
    logger: app.log,
  };
  const behaviorEngine = new BehaviorEngine(behaviorEngineOptions);
  const engineService = new EngineService(
    workerPool,
    analysisService,
    app.log,
    behaviorEngine,
    openingBook,
  );
  const moveAnalysisService = new MoveAnalysisService(
    workerPool,
    analysisService,
    app.log,
  );
  const contextStore = new ContextStore(app.log);
  await contextStore.connect(env.REDIS_URL);
  const speculationEngine = new SpeculationEngine(workerPool, analysisService, app.log);
  const metricsCollector = new MetricsCollector(app.log);
  const gameService = new GameService(
    repository,
    validationService,
    engineService,
    app.log,
    moveAnalysisService,
    contextStore,
    speculationEngine,
  );

  app.addHook("onRequest", async (request) => {
    request.log.info(
      {
        method: request.method,
        url: request.url,
        body: request.body,
      },
      "Incoming request",
    );
  });

  app.get("/health", async () => ({
    status: "ok",
    engineAvailable: !workerPool.getUnavailableReason(),
    engineError: workerPool.getUnavailableReason(),
    openingBookLoaded: Boolean(openingBook),
    openingBookEntries: openingBook?.entryCount ?? 0,
    openingBookPath: openingBook?.resolvedPath ?? env.OPENING_BOOK_PATH ?? null,
  }));

  app.get("/metrics", async () => ({
    ...metricsCollector.getAggregated(),
    engineCacheHitRate: analysisService.getCacheHitRate(),
    candidateCacheHitRate: analysisService.getCandidateCacheHitRate(),
    openingBookLoaded: Boolean(openingBook),
    workerPoolStatus: !workerPool.getUnavailableReason() ? "healthy" : workerPool.getUnavailableReason(),
  }));

  app.get("/ready", async (_request, reply) => {
    const engineError = workerPool.getUnavailableReason();
    if (engineError) {
      reply.code(503);
      return {
        status: "degraded",
        engineAvailable: false,
        error: engineError,
        openingBookLoaded: Boolean(openingBook),
      };
    }

    return {
      status: "ready",
      engineAvailable: true,
      openingBookLoaded: Boolean(openingBook),
      openingBookEntries: openingBook?.entryCount ?? 0,
    };
  });

  app.post("/engine/move", async (request, reply) => {
    const payload = moveRequestSchema.parse(request.body);
    const chess = validationService.validateFen(payload.fen);
    validationService.ensureGamePlayable(chess);

    try {
      const existingGame = await repository.getGame(payload.gameId);
      if (existingGame && existingGame.fen !== payload.fen) {
        throw new HttpError(
          409,
          "FEN does not match stored game state",
          { error: "FEN does not match stored game state" },
        );
      }

      const decision = await engineService.chooseMove({
        gameId: payload.gameId,
        fen: payload.fen,
        difficulty: payload.difficulty,
        moveNumber: payload.moveNumber,
        aiColor: oppositeColor(payload.playerColor),
        engineState: existingGame?.engineState ?? defaultEngineState(),
        moveHistory: existingGame?.moveHistory ?? [],
      });

      return {
        move: decision.move,
        moveNotation: decision.moveNotation,
        evaluation: decision.evaluation,
        engineMode: decision.engineMode,
        thinkingTime: decision.thinkingTime,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Engine busy, retry"
      ) {
        reply.code(503);
        return { error: "Engine busy, retry" };
      }
      throw error;
    }
  });

  app.post("/games", async (request) => {
    const payload = createGameRequestSchema.parse(request.body ?? {});
    return gameService.createGame(payload);
  });

  app.get("/games/:id", async (request) => {
    const params = request.params as { id: string };
    return gameService.getGame(params.id);
  });

  app.post("/games/:id/player-move", async (request) => {
    const params = request.params as { id: string };
    const payload = playerMoveRequestSchema.parse(request.body);
    return gameService.applyPlayerMove(params.id, payload);
  });

  app.post("/games/:id/undo", async (request) => {
    const params = request.params as { id: string };
    const payload = undoRequestSchema.parse(request.body ?? {});
    return {
      game: await gameService.undoGame(params.id, payload),
    };
  });

  app.post("/games/:id/resign", async (request) => {
    const params = request.params as { id: string };
    return gameService.resignGame(params.id);
  });

  app.post("/games/:id/draw-offer", async (request) => {
    const params = request.params as { id: string };
    return gameService.offerDraw(params.id);
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error({ error }, "Request failed");
    if (error instanceof HttpError) {
      reply
        .code(error.statusCode)
        .send(error.payload ?? { error: error.message });
      return;
    }

    if (error instanceof Error && error.message === "Engine busy, retry") {
      reply.code(503).send({ error: "Engine busy, retry" });
      return;
    }

    reply.code(500).send({
      error: (error as Error).message || "Internal server error",
    });
  });

  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      {
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
      },
      "Request completed",
    );
  });

  app.addHook("onClose", async () => {
    speculationEngine.cancelAll();
    await workerPool.stop();
    await contextStore.disconnect();
    await database?.pool.end();
  });

  return app;
};
