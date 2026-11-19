import { eq, or, sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { EngineState, MoveHistoryEntry } from "@chessverse/contracts";
import { gamesTable, movesTable, usersTable } from "../db/schema.js";
import type {
  EngineStatDelta,
  PersistentGameRepository,
  StoredGame,
  UserRecord,
} from "../types.js";

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

    const storedAnalyses = ((game.engineState as any)?.moveAnalyses ?? {}) as Record<string, any>;

    return {
      gameId: game.gameId,
      userId: game.userId ?? null,
      playerColor: game.playerColor as StoredGame["playerColor"],
      difficulty: game.difficulty as StoredGame["difficulty"],
      style: (game.style ?? "solid") as StoredGame["style"],
      fen: game.currentFen,
      status: game.status as StoredGame["status"],
      evaluation: null,
      moveHistory: moveRows.map((row: typeof movesTable.$inferSelect): MoveHistoryEntry => {
        const key = `${row.player}:${row.moveNumber}:${row.moveUci}`;
        const analysis = storedAnalyses[key];
        return {
          moveNumber: row.moveNumber,
          player: row.player as "human" | "ai",
          fenBefore: row.fenBefore,
          fenAfter: row.fenAfter,
          moveUci: row.moveUci,
          moveNotation: row.moveNotation,
          evaluation: decodeEvaluation(row.evaluation),
          engineMode: row.engineMode as MoveHistoryEntry["engineMode"],
          timestamp: row.timestamp.toISOString(),
          ...(analysis ? { analysis } : {}),
        };
      }),
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
    const existingAnalyses = ((game.engineState as any)?.moveAnalyses ?? {}) as Record<string, any>;
    const updatedAnalyses = { ...existingAnalyses };
    for (const move of game.moveHistory) {
      if (move.analysis) {
        const key = `${move.player}:${move.moveNumber}:${move.moveUci}`;
        updatedAnalyses[key] = move.analysis;
      }
    }
    const engineStateToPersist = {
      ...game.engineState,
      moveAnalyses: updatedAnalyses,
    };

    await this.db.transaction(async (tx: any) => {
      await tx
        .insert(gamesTable)
        .values({
          gameId: game.gameId,
          userId: game.userId ?? null,
          playerColor: game.playerColor,
          difficulty: game.difficulty,
          style: game.style ?? "solid",
          status: game.status,
          currentFen: game.fen,
          result: game.result,
          totalMoves: game.totalMoves,
          engineState: engineStateToPersist,
          startTime: new Date(game.startTime),
          endTime: game.endTime ? new Date(game.endTime) : null,
          createdAt: new Date(game.createdAt),
          updatedAt: new Date(game.updatedAt),
        })
        .onConflictDoUpdate({
          target: gamesTable.gameId,
          set: {
            userId: game.userId ?? null,
            playerColor: game.playerColor,
            difficulty: game.difficulty,
            style: game.style ?? "solid",
            status: game.status,
            currentFen: game.fen,
            result: game.result,
            totalMoves: game.totalMoves,
            engineState: engineStateToPersist,
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

  async getUserGames(userId: string): Promise<StoredGame[]> {
    const rows = await this.db
      .select()
      .from(gamesTable)
      .where(eq(gamesTable.userId, userId))
      .orderBy(sql`${gamesTable.createdAt} desc`);

    return rows.map((game: typeof gamesTable.$inferSelect): StoredGame => ({
      gameId: game.gameId,
      userId: game.userId ?? null,
      playerColor: game.playerColor as StoredGame["playerColor"],
      difficulty: game.difficulty as StoredGame["difficulty"],
      style: (game.style ?? "solid") as StoredGame["style"],
      fen: game.currentFen,
      status: game.status as StoredGame["status"],
      evaluation: null,
      moveHistory: [],
      engineState: game.engineState as EngineState,
      result: (game.result as StoredGame["result"]) ?? null,
      totalMoves: game.totalMoves,
      startTime: game.startTime.toISOString(),
      endTime: game.endTime ? game.endTime.toISOString() : null,
      createdAt: game.createdAt.toISOString(),
      updatedAt: game.updatedAt.toISOString(),
    }));
  }

  async getUserById(id: string): Promise<UserRecord | null> {
    const [user] = await this.db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!user) {
      return null;
    }
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      passwordHash: user.passwordHash,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  async getUserByUsernameOrEmail(identifier: string): Promise<UserRecord | null> {
    const [user] = await this.db
      .select()
      .from(usersTable)
      .where(or(eq(usersTable.username, identifier), eq(usersTable.email, identifier)));
    if (!user) {
      return null;
    }
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      passwordHash: user.passwordHash,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  async saveUser(user: UserRecord): Promise<void> {
    await this.db
      .insert(usersTable)
      .values({
        id: user.id,
        username: user.username,
        email: user.email,
        passwordHash: user.passwordHash,
        createdAt: new Date(user.createdAt),
        updatedAt: new Date(user.updatedAt),
      })
      .onConflictDoUpdate({
        target: usersTable.id,
        set: {
          username: user.username,
          email: user.email,
          passwordHash: user.passwordHash,
          updatedAt: new Date(user.updatedAt),
        },
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

  async initializeSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY,
        username varchar(64) NOT NULL UNIQUE,
        email varchar(255) NOT NULL UNIQUE,
        password_hash text NOT NULL,
        created_at timestamp with time zone NOT NULL,
        updated_at timestamp with time zone NOT NULL
      );

      CREATE TABLE IF NOT EXISTS games (
        game_id uuid PRIMARY KEY,
        user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        player_color varchar(16) NOT NULL,
        difficulty varchar(16) NOT NULL,
        style varchar(32) DEFAULT 'solid',
        status varchar(32) NOT NULL,
        current_fen text NOT NULL,
        result varchar(16),
        total_moves integer NOT NULL,
        engine_state jsonb NOT NULL,
        start_time timestamp with time zone NOT NULL,
        end_time timestamp with time zone,
        created_at timestamp with time zone NOT NULL,
        updated_at timestamp with time zone NOT NULL
      );

      ALTER TABLE games ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE games ADD COLUMN IF NOT EXISTS style varchar(32) DEFAULT 'solid';

      CREATE TABLE IF NOT EXISTS moves (
        move_id serial PRIMARY KEY,
        game_id uuid NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
        move_number integer NOT NULL,
        player varchar(16) NOT NULL,
        fen_before text NOT NULL,
        fen_after text NOT NULL,
        move_uci varchar(8) NOT NULL,
        move_notation varchar(32) NOT NULL,
        evaluation integer,
        engine_mode varchar(32),
        timestamp timestamp with time zone NOT NULL
      );

      ALTER TABLE moves ADD COLUMN IF NOT EXISTS evaluation integer;
      ALTER TABLE moves ADD COLUMN IF NOT EXISTS engine_mode varchar(32);

      CREATE TABLE IF NOT EXISTS engine_stats (
        stat_id serial PRIMARY KEY,
        date varchar(10) NOT NULL UNIQUE,
        total_games integer NOT NULL DEFAULT 0,
        gambits_attempted integer NOT NULL DEFAULT 0,
        gambits_accepted integer NOT NULL DEFAULT 0,
        sacrifices_played integer NOT NULL DEFAULT 0,
        traps_set integer NOT NULL DEFAULT 0,
        traps_triggered integer NOT NULL DEFAULT 0,
        avg_thinking_time_ms integer NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS users_username_idx ON users(username);
      CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);
      CREATE INDEX IF NOT EXISTS games_status_idx ON games(status);
      CREATE INDEX IF NOT EXISTS games_user_id_idx ON games(user_id);
      CREATE INDEX IF NOT EXISTS games_updated_at_idx ON games(updated_at);
      CREATE INDEX IF NOT EXISTS moves_game_id_idx ON moves(game_id);
      CREATE INDEX IF NOT EXISTS moves_move_number_idx ON moves(move_number);
      CREATE INDEX IF NOT EXISTS engine_stats_date_idx ON engine_stats(date);
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
