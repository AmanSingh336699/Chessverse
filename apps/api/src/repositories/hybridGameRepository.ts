import type { Logger } from "pino";
import type {
  EngineStatDelta,
  GameRepository,
  PersistentGameRepository,
  StoredGame,
  UserRecord,
} from "../types.js";
import { InMemoryGameRepository } from "./memoryGameRepository.js";

interface WriteTask {
  gameId: string;
  game: StoredGame;
  attempts: number;
  nextAttemptAt: number;
  resolve: () => void;
  reject: (err: unknown) => void;
}

export class HybridGameRepository implements GameRepository {
  private readonly memory = new InMemoryGameRepository();
  private readonly pendingWrites = new Map<string, WriteTask>();
  private readonly pendingStats = new Map<string, EngineStatDelta[]>();
  private isProcessing = false;
  private queueTimer: NodeJS.Timeout | null = null;
  private isDraining = false;

  constructor(
    private readonly logger: Logger,
    private readonly persistent?: PersistentGameRepository | null,
    private readonly maxRetries = 5,
  ) {}

  async getGame(gameId: string): Promise<StoredGame | null> {
    const memoryGame = await this.memory.getGame(gameId);
    if (memoryGame) {
      return memoryGame;
    }

    if (!this.persistent) {
      return null;
    }

    try {
      const persistentGame = await this.persistent.getGame(gameId);
      if (persistentGame) {
        await this.memory.saveGame(persistentGame);
      }
      return persistentGame;
    } catch (error) {
      this.logger.error(
        { error, gameId },
        "Failed to load game from persistent storage",
      );
      return null;
    }
  }

  async saveGame(game: StoredGame): Promise<void> {
    // Immediate memory save
    await this.memory.saveGame(game);

    if (!this.persistent) {
      return;
    }

    // Queue for write-behind persistence
    const existing = this.pendingWrites.get(game.gameId);
    if (existing) {
      // Merge with latest game state
      existing.game = structuredClone(game);
    } else {
      this.pendingWrites.set(game.gameId, {
        gameId: game.gameId,
        game: structuredClone(game),
        attempts: 0,
        nextAttemptAt: Date.now(),
        resolve: () => {},
        reject: () => {},
      });
    }

    this.scheduleProcessQueue(0);
  }

  async incrementEngineStats(delta: EngineStatDelta): Promise<void> {
    await this.memory.incrementEngineStats(delta);
    if (!this.persistent) {
      return;
    }

    try {
      await this.persistent.incrementEngineStats(delta);
    } catch (error) {
      this.logger.warn({ error, delta }, "Failed to persist engine stats — retaining in memory");
    }
  }

  async getUserGames(userId: string): Promise<StoredGame[]> {
    if (this.persistent) {
      try {
        return await this.persistent.getUserGames(userId);
      } catch (error) {
        this.logger.warn(
          { error, userId },
          "Failed to fetch user games from persistent storage — falling back to memory",
        );
      }
    }
    return this.memory.getUserGames(userId);
  }

  async getUserById(id: string): Promise<UserRecord | null> {
    const memoryUser = await this.memory.getUserById(id);
    if (memoryUser) return memoryUser;

    if (this.persistent) {
      try {
        const user = await this.persistent.getUserById(id);
        if (user) {
          await this.memory.saveUser(user);
        }
        return user;
      } catch (error) {
        this.logger.warn({ error, id }, "Failed to load user by ID from persistent storage");
      }
    }
    return null;
  }

  async getUserByUsernameOrEmail(identifier: string): Promise<UserRecord | null> {
    const memoryUser = await this.memory.getUserByUsernameOrEmail(identifier);
    if (memoryUser) return memoryUser;

    if (this.persistent) {
      try {
        const user = await this.persistent.getUserByUsernameOrEmail(identifier);
        if (user) {
          await this.memory.saveUser(user);
        }
        return user;
      } catch (error) {
        this.logger.warn({ error, identifier }, "Failed to load user from persistent storage");
      }
    }
    return null;
  }

  async saveUser(user: UserRecord): Promise<void> {
    await this.memory.saveUser(user);
    if (this.persistent) {
      try {
        await this.persistent.saveUser(user);
      } catch (error) {
        this.logger.warn(
          { error, userId: user.id },
          "Failed to persist user to persistent storage — retaining in memory",
        );
      }
    }
  }

  private scheduleProcessQueue(delayMs = 50): void {
    if (this.queueTimer || this.isProcessing) return;
    this.queueTimer = setTimeout(() => {
      this.queueTimer = null;
      void this.processQueue();
    }, delayMs);
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || !this.persistent) return;
    this.isProcessing = true;

    try {
      const now = Date.now();
      const tasksToProcess = Array.from(this.pendingWrites.values()).filter(
        (task) => task.nextAttemptAt <= now,
      );

      for (const task of tasksToProcess) {
        try {
          await this.persistent.saveGame(task.game);
          this.pendingWrites.delete(task.gameId);
          task.resolve();
        } catch (error) {
          task.attempts += 1;
          if (task.attempts >= this.maxRetries) {
            this.logger.error(
              { error, gameId: task.gameId, attempts: task.attempts },
              "Exceeded max persistence attempts for game — retaining in memory fallback",
            );
            this.pendingWrites.delete(task.gameId);
            task.resolve(); // Do not throw to caller; game remains safe in memory
          } else {
            // Exponential backoff: 100ms, 200ms, 400ms, 800ms...
            const backoffMs = Math.min(5000, 100 * Math.pow(2, task.attempts));
            task.nextAttemptAt = Date.now() + backoffMs;
            this.logger.warn(
              { error, gameId: task.gameId, attempts: task.attempts, nextRetryInMs: backoffMs },
              "Write-behind persistence failed — scheduled for retry",
            );
          }
        }
      }
    } finally {
      this.isProcessing = false;
      if (this.pendingWrites.size > 0 && !this.isDraining) {
        this.scheduleProcessQueue(200);
      }
    }
  }

  async flush(timeoutMs = 5000): Promise<void> {
    this.isDraining = true;
    if (this.queueTimer) {
      clearTimeout(this.queueTimer);
      this.queueTimer = null;
    }

    const start = Date.now();
    while (this.pendingWrites.size > 0 && Date.now() - start < timeoutMs) {
      // Force all pending tasks to attempt immediately
      for (const task of this.pendingWrites.values()) {
        task.nextAttemptAt = 0;
      }
      await this.processQueue();
      if (this.pendingWrites.size > 0) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    if (this.pendingWrites.size > 0) {
      this.logger.warn(
        { remaining: this.pendingWrites.size },
        "Flush completed with pending writes remaining after timeout",
      );
    } else {
      this.logger.info("Write-behind queue successfully flushed to persistent storage");
    }
  }

  async reconcileStartup(): Promise<void> {
    if (!this.persistent) {
      this.logger.info("Hybrid repository running in in-memory mode (no persistent DB)");
      return;
    }

    try {
      const healthy = await this.persistent.isHealthy();
      if (healthy) {
        this.logger.info("Persistent database storage verified and healthy on startup");
      }
    } catch (error) {
      this.logger.warn(
        { error },
        "Database check failed during startup reconciliation — in-memory fallback active",
      );
    }
  }

  getPendingWritesCount(): number {
    return this.pendingWrites.size;
  }
}
