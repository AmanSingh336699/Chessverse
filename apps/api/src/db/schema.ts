import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const gamesTable = pgTable("games", {
  gameId: uuid("game_id").primaryKey(),
  playerColor: varchar("player_color", { length: 16 }).notNull(),
  difficulty: varchar("difficulty", { length: 16 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  currentFen: text("current_fen").notNull(),
  result: varchar("result", { length: 16 }),
  totalMoves: integer("total_moves").notNull(),
  engineState: jsonb("engine_state").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({
  statusIdx: index("games_status_idx").on(table.status),
  updatedAtIdx: index("games_updated_at_idx").on(table.updatedAt),
}));

export const movesTable = pgTable("moves", {
  moveId: serial("move_id").primaryKey(),
  gameId: uuid("game_id")
    .notNull()
    .references(() => gamesTable.gameId, { onDelete: "cascade" }),
  moveNumber: integer("move_number").notNull(),
  player: varchar("player", { length: 16 }).notNull(),
  fenBefore: text("fen_before").notNull(),
  fenAfter: text("fen_after").notNull(),
  moveUci: varchar("move_uci", { length: 8 }).notNull(),
  moveNotation: varchar("move_notation", { length: 32 }).notNull(),
  evaluation: integer("evaluation"),
  engineMode: varchar("engine_mode", { length: 32 }),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
}, (table) => ({
  gameIdIdx: index("moves_game_id_idx").on(table.gameId),
  moveNumberIdx: index("moves_move_number_idx").on(table.moveNumber),
}));

export const engineStatsTable = pgTable("engine_stats", {
  statId: serial("stat_id").primaryKey(),
  date: varchar("date", { length: 10 }).notNull().unique(),
  totalGames: integer("total_games").notNull().default(0),
  gambitsAttempted: integer("gambits_attempted").notNull().default(0),
  gambitsAccepted: integer("gambits_accepted").notNull().default(0),
  sacrificesPlayed: integer("sacrifices_played").notNull().default(0),
  trapsSet: integer("traps_set").notNull().default(0),
  trapsTriggered: integer("traps_triggered").notNull().default(0),
  avgThinkingTimeMs: integer("avg_thinking_time_ms").notNull().default(0),
}, (table) => ({
  dateIdx: index("engine_stats_date_idx").on(table.date),
}));
