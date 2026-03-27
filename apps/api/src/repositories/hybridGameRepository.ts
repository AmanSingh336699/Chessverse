import type { Logger } from "pino";
import type { EngineStatDelta, GameRepository, PersistentGameRepository, StoredGame } from "../types.js";
import { InMemoryGameRepository } from "./memoryGameRepository.js";

export class HybridGameRepository implements GameRepository {
  private readonly memory = new InMemoryGameRepository();

  constructor(
    private readonly logger: Logger,
    private readonly persistent?: PersistentGameRepository | null,
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
      this.logger.error({ error, gameId }, "Failed to load game from persistent storage");
      return null;
    }
  }

  async saveGame(game: StoredGame): Promise<void> {
    await this.memory.saveGame(game);

    if (!this.persistent) {
      return;
    }

    try {
      await this.persistent.saveGame(game);
    } catch (error) {
      this.logger.error({ error, gameId: game.gameId }, "Failed to persist game, continuing with memory store");
    }
  }

  async incrementEngineStats(delta: EngineStatDelta): Promise<void> {
    await this.memory.incrementEngineStats(delta);
    if (!this.persistent) {
      return;
    }

    try {
      await this.persistent.incrementEngineStats(delta);
    } catch (error) {
      this.logger.error({ error, delta }, "Failed to persist engine stats");
    }
  }
}
