import type {
  EngineStatDelta,
  PersistentGameRepository,
  StoredGame,
} from "../types.js";

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
  private readonly engineStats = new Map<string, EngineStatsSnapshot>();

  async getGame(gameId: string): Promise<StoredGame | null> {
    return this.games.get(gameId) ?? null;
  }

  async saveGame(game: StoredGame): Promise<void> {
    this.games.set(game.gameId, structuredClone(game));
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
