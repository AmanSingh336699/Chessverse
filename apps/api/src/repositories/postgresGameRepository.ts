import { eq, sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { EngineState, MoveHistoryEntry } from "../contracts.js";
import { gamesTable, movesTable } from "../db/schema.js";
import type { EngineStatDelta, PersistentGameRepository, StoredGame } from "../types.js";

const encodeEvaluation = (value: number | null): number | null =>
  value === null ? null : Math.round(value * 100);
const decodeEvaluation = (value: number | null): number | null =>
  value === null ? null : Number((value / 100).toFixed(2));

export class PostgresGameRepository implements PersistentGameRepository {
  constructor(
    private readonly db: any,
    private readonly pool: Pool,
  ) {}

  async getGame(gameId: string): Promise<StoredGame | null> {
    const [game] = await this.db.select().from(gamesTable).where(eq(gamesTable.gameId, gameId));
    if (!game) {
      return null;
    }

    const moveRows = await this.db
      .select()
      .from(movesTable)
      .where(eq(movesTable.gameId, gameId))
      .orderBy(movesTable.moveId);

    return {
      gameId: game.gameId,
      playerColor: game.playerColor as StoredGame["playerColor"],
      difficulty: game.difficulty as StoredGame["difficulty"],
      fen: game.currentFen,
      status: game.status as StoredGame["status"],
      evaluation: null,
      moveHistory: moveRows.map((row: typeof movesTable.$inferSelect): MoveHistoryEntry => ({
        moveNumber: row.moveNumber,
        player: row.player as "human" | "ai",
        fenBefore: row.fenBefore,
        fenAfter: row.fenAfter,
        moveUci: row.moveUci,
        moveNotation: row.moveNotation,
        evaluation: decodeEvaluation(row.evaluation),
        engineMode: row.engineMode as MoveHistoryEntry["engineMode"],
        timestamp: row.timestamp.toISOString(),
      })),
      engineState: game.engineState as EngineState,
      result: (game.result as StoredGame["result"]) ?? null,
      totalMoves: game.totalMoves,
      startTime: game.startTime.toISOString(),
      endTime: game.endTime ? game.endTime.toISOString() : null,
      createdAt: game.createdAt.toISOString(),
      updatedAt: game.updatedAt.toISOString(),
    };
  }

  async saveGame(game: StoredGame): Promise<void> {
    await this.db.transaction(async (tx: any) => {
      await tx
        .insert(gamesTable)
        .values({
          gameId: game.gameId,
          playerColor: game.playerColor,
          difficulty: game.difficulty,
          status: game.status,
          currentFen: game.fen,
          result: game.result,
          totalMoves: game.totalMoves,
          engineState: game.engineState,
          startTime: new Date(game.startTime),
          endTime: game.endTime ? new Date(game.endTime) : null,
          createdAt: new Date(game.createdAt),
          updatedAt: new Date(game.updatedAt),
        })
        .onConflictDoUpdate({
          target: gamesTable.gameId,
          set: {
            playerColor: game.playerColor,
            difficulty: game.difficulty,
            status: game.status,
            currentFen: game.fen,
            result: game.result,
            totalMoves: game.totalMoves,
            engineState: game.engineState,
            startTime: new Date(game.startTime),
            endTime: game.endTime ? new Date(game.endTime) : null,
            updatedAt: new Date(game.updatedAt),
          },
        });

      await tx.delete(movesTable).where(eq(movesTable.gameId, game.gameId));
      if (game.moveHistory.length > 0) {
        await tx.insert(movesTable).values(
          game.moveHistory.map((move) => ({
            gameId: game.gameId,
            moveNumber: move.moveNumber,
            player: move.player,
            fenBefore: move.fenBefore,
            fenAfter: move.fenAfter,
            moveUci: move.moveUci,
            moveNotation: move.moveNotation,
            evaluation: encodeEvaluation(move.evaluation),
            engineMode: move.engineMode,
            timestamp: new Date(move.timestamp),
          })),
        );
      }
    });
  }

  async incrementEngineStats(delta: EngineStatDelta): Promise<void> {
    const date = new Date().toISOString().slice(0, 10);
    const thinkingTimeMs = delta.thinkingTimeMs ?? 0;
    await this.db.execute(sql`
      INSERT INTO engine_stats (
        date,
        total_games,
        gambits_attempted,
        gambits_accepted,
        sacrifices_played,
        traps_set,
        traps_triggered,
        avg_thinking_time_ms
      ) VALUES (
        ${date},
        ${delta.totalGames ?? 0},
        ${delta.gambitsAttempted ?? 0},
        ${delta.gambitsAccepted ?? 0},
        ${delta.sacrificesPlayed ?? 0},
        ${delta.trapsSet ?? 0},
        ${delta.trapsTriggered ?? 0},
        ${thinkingTimeMs}
      )
      ON CONFLICT (date) DO UPDATE SET
        total_games = engine_stats.total_games + ${delta.totalGames ?? 0},
        gambits_attempted = engine_stats.gambits_attempted + ${delta.gambitsAttempted ?? 0},
        gambits_accepted = engine_stats.gambits_accepted + ${delta.gambitsAccepted ?? 0},
        sacrifices_played = engine_stats.sacrifices_played + ${delta.sacrificesPlayed ?? 0},
        traps_set = engine_stats.traps_set + ${delta.trapsSet ?? 0},
        traps_triggered = engine_stats.traps_triggered + ${delta.trapsTriggered ?? 0},
        avg_thinking_time_ms = CASE
          WHEN engine_stats.avg_thinking_time_ms = 0 THEN ${thinkingTimeMs}
          WHEN ${thinkingTimeMs} = 0 THEN engine_stats.avg_thinking_time_ms
          ELSE ROUND((engine_stats.avg_thinking_time_ms + ${thinkingTimeMs}) / 2.0)
        END
    `);
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.pool.query("select 1");
      return true;
    } catch {
      return false;
    }
  }
}
