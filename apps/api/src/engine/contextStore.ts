import type { EngineState } from "../contracts.js";
import { defaultEngineState } from "../contracts.js";
import Redis from "ioredis";
import type { Logger } from "pino";
import { env } from "../config/env.js";

export interface StoredContext {
  engineState: EngineState;
  moveNumber: number;
  recovered?: boolean;
}

export interface ContextReadResult {
  context: StoredContext;
  degraded: boolean;
}

const CONTEXT_KEY_PREFIX = "chessverse:ctx:";
const LOCK_KEY_PREFIX = "chessverse:lock:";
const CONTEXT_HISTORY_KEY_PREFIX = "chessverse:ctxhist:";
const PENDING_UNDO_KEY_PREFIX = "chessverse:undo:";

export interface PendingUndoRequest {
  pendingMoveUci: string;
  pendingMoveNumber: number;
  requestedAt: number;
}

export class ContextStore {
  private redis: Redis | null = null;

  constructor(private readonly logger: Logger) {}

  async connect(redisUrl: string | undefined): Promise<void> {
    if (!redisUrl) {
      this.logger.warn("No REDIS_URL configured — context store disabled, using in-memory state only");
      return;
    }

    try {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        enableReadyCheck: true,
      });
      await this.redis.connect();
      this.logger.info("Context store connected to Redis");
    } catch (error) {
      this.logger.warn({ error }, "Context store Redis unavailable — falling back to in-memory");
      this.redis = null;
    }
  }

  async readContext(gameId: string, expectedMoveNumber?: number): Promise<ContextReadResult> {
    if (!this.redis) {
      return { context: { engineState: defaultEngineState(), moveNumber: 0 }, degraded: true };
    }

    try {
      const raw = await this.redis.get(`${CONTEXT_KEY_PREFIX}${gameId}`);
      if (!raw) {
        return { context: { engineState: defaultEngineState(), moveNumber: 0 }, degraded: false };
      }

      const stored = JSON.parse(raw) as StoredContext;

      // Staleness detection: if move number differs by more than 1, context is stale
      if (
        expectedMoveNumber !== undefined &&
        Math.abs(stored.moveNumber - expectedMoveNumber) > 1
      ) {
        this.logger.warn(
          { gameId, storedMoveNumber: stored.moveNumber, expectedMoveNumber },
          "Stale context detected — entering degraded mode for this move",
        );
        return { context: this.buildDegradedContext(stored), degraded: true };
      }

      return { context: stored, degraded: false };
    } catch (error) {
      this.logger.error(
        { error, gameId },
        "Redis context read failed — entering degraded mode",
      );
      return { context: this.buildDegradedContext(), degraded: true };
    }
  }

  async writeContext(gameId: string, state: EngineState, moveNumber: number): Promise<boolean> {
    if (!this.redis) {
      return false;
    }

    const stored: StoredContext = { engineState: state, moveNumber };

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.redis.set(
          `${CONTEXT_KEY_PREFIX}${gameId}`,
          JSON.stringify(stored),
          "EX",
          env.CONTEXT_REDIS_TTL_SECONDS,
        );
        await this.redis.set(
          `${CONTEXT_HISTORY_KEY_PREFIX}${gameId}:${moveNumber}`,
          JSON.stringify(stored),
          "EX",
          env.CONTEXT_REDIS_TTL_SECONDS,
        );
        return true;
      } catch (error) {
        if (attempt === 0) {
          this.logger.warn({ error, gameId, moveNumber }, "Context write failed — retrying");
        } else {
          this.logger.error(
            { error, gameId, moveNumber, contextSnapshot: stored },
            "Context write failed after retry — context may be lost for this move",
          );
        }
      }
    }

    return false;
  }

  async readSnapshot(gameId: string, moveNumber: number): Promise<StoredContext | null> {
    if (!this.redis) {
      return null;
    }

    try {
      const raw = await this.redis.get(`${CONTEXT_HISTORY_KEY_PREFIX}${gameId}:${moveNumber}`);
      return raw ? (JSON.parse(raw) as StoredContext) : null;
    } catch (error) {
      this.logger.warn({ error, gameId, moveNumber }, "Failed to read context snapshot");
      return null;
    }
  }

  async acquireLock(gameId: string): Promise<(() => Promise<void>) | null> {
    if (!this.redis) {
      // No Redis = no contention protection, but game still works
      return async () => {};
    }

    const lockKey = `${LOCK_KEY_PREFIX}${gameId}`;
    const lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const lockTimeoutSec = Math.ceil(env.CONTEXT_LOCK_TIMEOUT_MS / 1000);

    try {
      const acquired = await this.redis.set(lockKey, lockValue, "EX", lockTimeoutSec, "NX");
      if (!acquired) {
        // Another request is processing this game
        // Wait briefly and retry once
        await new Promise((r) => setTimeout(r, Math.min(env.CONTEXT_LOCK_ACQUIRE_MS, 500)));
        const retryAcquired = await this.redis.set(lockKey, lockValue, "EX", lockTimeoutSec, "NX");
        if (!retryAcquired) {
          this.logger.warn({ gameId }, "Could not acquire context lock — concurrent request detected");
          return null;
        }
      }

      return async () => {
        try {
          // Only release if we still own the lock (compare-and-delete via Lua)
          const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
              return redis.call("del", KEYS[1])
            else
              return 0
            end
          `;
          await this.redis!.eval(script, 1, lockKey, lockValue);
        } catch (error) {
          this.logger.warn({ error, gameId }, "Failed to release context lock");
        }
      };
    } catch (error) {
      this.logger.warn({ error, gameId }, "Lock acquisition failed — proceeding without lock");
      return async () => {};
    }
  }

  async deleteContext(gameId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(`${CONTEXT_KEY_PREFIX}${gameId}`);
      await this.redis.del(`${PENDING_UNDO_KEY_PREFIX}${gameId}`);
    } catch { /* non-critical */ }
  }

  async markPendingUndo(
    gameId: string,
    pendingMoveNumber: number,
    pendingMoveUci: string,
  ): Promise<void> {
    if (!this.redis) {
      return;
    }

    const payload: PendingUndoRequest = {
      pendingMoveNumber,
      pendingMoveUci,
      requestedAt: Date.now(),
    };

    try {
      await this.redis.set(
        `${PENDING_UNDO_KEY_PREFIX}${gameId}`,
        JSON.stringify(payload),
        "EX",
        30,
      );
    } catch (error) {
      this.logger.warn({ error, gameId, pendingMoveNumber, pendingMoveUci }, "Failed to mark pending undo");
    }
  }

  async consumePendingUndo(gameId: string): Promise<PendingUndoRequest | null> {
    if (!this.redis) {
      return null;
    }

    const key = `${PENDING_UNDO_KEY_PREFIX}${gameId}`;

    try {
      const raw = await this.redis.get(key);
      if (!raw) {
        return null;
      }

      await this.redis.del(key);
      return JSON.parse(raw) as PendingUndoRequest;
    } catch (error) {
      this.logger.warn({ error, gameId }, "Failed to consume pending undo marker");
      return null;
    }
  }

  private buildDegradedContext(partial?: StoredContext): StoredContext {
    const base = defaultEngineState();

    // Reset behavior tracker to neutral (zero)
    base.behaviorSuccessScore = 0;

    // Trap engine: no active sequence
    base.trapSequence = defaultEngineState().trapSequence;

    // Sacrifice engine: conservative mode, no sacrifice bonuses
    base.sacrificeTracking = defaultEngineState().sacrificeTracking;
    base.sacrificeCooldownMoves = 0;

    // Keep gambit info if available (can determine opening phase from move number)
    if (partial?.engineState.gambit) {
      base.gambit = partial.engineState.gambit;
    }

    // Keep recent evaluations if available for psychological engine
    if (partial?.engineState.recentEvaluations) {
      base.recentEvaluations = partial.engineState.recentEvaluations;
    }

    return {
      engineState: base,
      moveNumber: partial?.moveNumber ?? 0,
      recovered: true,
    };
  }

  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
  }
}
