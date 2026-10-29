import type {
  EngineStatDelta,
  PersistentGameRepository,
  StoredGame,
} from "../types.js";
import { env } from "../config/env.js";

type EngineStatsSnapshot = {
  totalGames: number;
  gambitsAttempted: number;
  gambitsAccepted: number;
  sacrificesPlayed: number;
  trapsSet: number;
  trapsTriggered: number;
  avgThinkingTimeMs: number;
  sampleCount: number;
};

const createEmptyEngineStats = (): EngineStatsSnapshot => ({
  totalGames: 0,
  gambitsAttempted: 0,
  gambitsAccepted: 0,
  sacrificesPlayed: 0,
  trapsSet: 0,
  trapsTriggered: 0,
  avgThinkingTimeMs: 0,
  sampleCount: 0,
});

export class InMemoryGameRepository implements PersistentGameRepository {
  private readonly games = new Map<string, StoredGame>();
  private readonly lastAccessed = new Map<string, number>();
  private readonly engineStats = new Map<string, EngineStatsSnapshot>();

  constructor(
    private readonly maxGames: number = env.MAX_CONCURRENT_GAMES,
    private readonly ttlMs: number = env.GAME_INACTIVITY_TTL_MS,
  ) {}

  async getGame(gameId: string): Promise<StoredGame | null> {
    this.evictExpired();
    const game = this.games.get(gameId);
    if (game) {
      this.lastAccessed.set(gameId, Date.now());
      return structuredClone(game);
    }
    return null;
  }

  async saveGame(game: StoredGame): Promise<void> {
    this.evictExpired();
    if (!this.games.has(game.gameId) && this.games.size >= this.maxGames) {
      this.evictOldest();
    }
    this.games.set(game.gameId, structuredClone(game));
    this.lastAccessed.set(game.gameId, Date.now());
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [gameId, accessTime] of this.lastAccessed.entries()) {
      if (now - accessTime > this.ttlMs) {
        this.games.delete(gameId);
        this.lastAccessed.delete(gameId);
      }
    }
  }

  private evictOldest(): void {
    let oldestId: string | null = null;
    let oldestTime = Infinity;
    for (const [gameId, time] of this.lastAccessed.entries()) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestId = gameId;
      }
    }
    if (oldestId) {
      this.games.delete(oldestId);
      this.lastAccessed.delete(oldestId);
    }
  }

  getGameCount(): number {
    return this.games.size;
  }

  async incrementEngineStats(delta: EngineStatDelta): Promise<void> {
    const dateKey = new Date().toISOString().slice(0, 10);
    const current = this.engineStats.get(dateKey) ?? createEmptyEngineStats();

    current.totalGames += delta.totalGames ?? 0;
    current.gambitsAttempted += delta.gambitsAttempted ?? 0;
    current.gambitsAccepted += delta.gambitsAccepted ?? 0;
    current.sacrificesPlayed += delta.sacrificesPlayed ?? 0;
    current.trapsSet += delta.trapsSet ?? 0;
    current.trapsTriggered += delta.trapsTriggered ?? 0;

    if (typeof delta.thinkingTimeMs === "number") {
      current.sampleCount += 1;
      current.avgThinkingTimeMs = Math.round(
        (current.avgThinkingTimeMs * (current.sampleCount - 1) + delta.thinkingTimeMs) /
          current.sampleCount,
      );
    }

    this.engineStats.set(dateKey, current);
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }
}
