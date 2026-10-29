import { z } from "zod";

export const difficultySchema = z.enum([
  "beginner",
  "intermediate",
  "advanced",
  "master",
]);
export type Difficulty = z.infer<typeof difficultySchema>;

export const styleIdSchema = z.enum([
  "aggressive",
  "gambiteer",
  "tricky",
  "solid",
]);
export type StyleId = z.infer<typeof styleIdSchema>;

export const styleModeSchema = z.enum([
  "opening",
  "gambit",
  "attack",
  "consolidate",
  "convert",
  "endgame",
  "swindle",
]);
export type StyleMode = z.infer<typeof styleModeSchema>;

export const styleProfileSchema = z.object({
  id: styleIdSchema,
  name: z.string(),
  description: z.string(),
  multiPv: z.number().int().min(6).max(10),
  evalBudgetCp: z.object({
    opening: z.number().int().nonnegative(),
    middlegame: z.number().int().nonnegative(),
    endgame: z.number().int().nonnegative(),
  }),
  bonusWeights: z.object({
    gambit: z.number().nonnegative(),
    trap: z.number().nonnegative(),
    sacrifice: z.number().nonnegative(),
    aggression: z.number().nonnegative(),
    psychological: z.number().nonnegative(),
  }),
  repertoireId: z.string().min(1),
  temperature: z.number().positive(),
  convertThresholdCp: z.number().int(),
  swindleThresholdCp: z.number().int(),
  drawAcceptance: z.object({
    minEvalCp: z.number().int(),
    allowContempt: z.boolean(),
  }),
});
export type StyleProfile = z.infer<typeof styleProfileSchema>;

export const AGGRESSIVE_PROFILE: StyleProfile = {
  id: "aggressive",
  name: "Aggressive",
  description: "Relentless attacker that pushes pawns toward your king, hunts open files, and values piece activity over safety.",
  multiPv: 8,
  evalBudgetCp: { opening: 60, middlegame: 80, endgame: 40 },
  bonusWeights: { gambit: 30, trap: 40, sacrifice: 80, aggression: 100, psychological: 50 },
  repertoireId: "aggressive-repertoire",
  temperature: 0.7,
  convertThresholdCp: 300,
  swindleThresholdCp: -150,
  drawAcceptance: { minEvalCp: -150, allowContempt: true },
};

export const GAMBITEER_PROFILE: StyleProfile = {
  id: "gambiteer",
  name: "Gambiteer",
  description: "Loves offering pawns and material in the opening for rapid development and chaotic initiative.",
  multiPv: 8,
  evalBudgetCp: { opening: 100, middlegame: 70, endgame: 30 },
  bonusWeights: { gambit: 120, trap: 60, sacrifice: 70, aggression: 60, psychological: 40 },
  repertoireId: "gambiteer-repertoire",
  temperature: 0.8,
  convertThresholdCp: 300,
  swindleThresholdCp: -150,
  drawAcceptance: { minEvalCp: -200, allowContempt: true },
};

export const TRICKY_PROFILE: StyleProfile = {
  id: "tricky",
  name: "Tricky",
  description: "Crafty tactical specialist that lays deep traps, creates sharp imbalances, and tests your tactical vision.",
  multiPv: 8,
  evalBudgetCp: { opening: 70, middlegame: 80, endgame: 40 },
  bonusWeights: { gambit: 50, trap: 120, sacrifice: 50, aggression: 50, psychological: 100 },
  repertoireId: "tricky-repertoire",
  temperature: 0.85,
  convertThresholdCp: 300,
  swindleThresholdCp: -150,
  drawAcceptance: { minEvalCp: -100, allowContempt: true },
};

export const SOLID_PROFILE: StyleProfile = {
  id: "solid",
  name: "Solid",
  description: "Classical, principled grandmaster style. Prioritizes king safety, structure, and pure Stockfish accuracy.",
  multiPv: 6,
  evalBudgetCp: { opening: 25, middlegame: 35, endgame: 20 },
  bonusWeights: { gambit: 0, trap: 10, sacrifice: 10, aggression: 20, psychological: 10 },
  repertoireId: "solid-repertoire",
  temperature: 0.3,
  convertThresholdCp: 300,
  swindleThresholdCp: -150,
  drawAcceptance: { minEvalCp: 0, allowContempt: false },
};

export const STYLE_PROFILES: Record<StyleId, StyleProfile> = {
  aggressive: AGGRESSIVE_PROFILE,
  gambiteer: GAMBITEER_PROFILE,
  tricky: TRICKY_PROFILE,
  solid: SOLID_PROFILE,
};

export const moveTelemetrySchema = z.object({
  style: styleIdSchema,
  module: z.string(),
  cpCost: z.number(),
  reason: z.string(),
});
export type MoveTelemetry = z.infer<typeof moveTelemetrySchema>;

export const engineModeSchema = z.enum([
  "gambit",
  "trap",
  "sacrifice",
  "aggressive",
  "psychological",
  "stockfish",
]);
export type EngineMode = z.infer<typeof engineModeSchema>;

export const gamePhaseSchema = z.enum(["opening", "middlegame", "endgame"]);
export type GamePhase = z.infer<typeof gamePhaseSchema>;

export const gameStatusSchema = z.enum([
  "playing",
  "check",
  "checkmate",
  "stalemate",
  "draw",
  "resigned",
]);
export type GameStatus = z.infer<typeof gameStatusSchema>;

export const playerColorSchema = z.enum(["white", "black"]);
export type PlayerColor = z.infer<typeof playerColorSchema>;

export const engineRecoveryModeSchema = z.enum([
  "none",
  "fallback",
  "pure-stockfish",
]);
export type EngineRecoveryMode = z.infer<typeof engineRecoveryModeSchema>;

export const tacticalThemeSchema = z.enum([
  "open-file-toward-king",
  "open-diagonal-toward-king",
  "rook-on-seventh",
  "bishop-pair-open-board",
  "knight-outpost",
  "passed-pawn",
  "opponent-king-lacking-luft",
  "central-space-advantage",
  "development-lead",
  "exposed-king",
]);
export type TacticalTheme = z.infer<typeof tacticalThemeSchema>;

export const trapGradeSchema = z.enum(["basic", "strong", "mating"]);
export type TrapGrade = z.infer<typeof trapGradeSchema>;

export const trapSequenceStateSchema = z.object({
  active: z.boolean(),
  status: z.enum(["idle", "armed", "continuing", "sprung", "cancelled"]),
  pattern: z.string().min(1).optional(),
  grade: trapGradeSchema.optional(),
  triggerMove: z.string().min(4).optional(),
  targetSquare: z.string().length(2).optional(),
  remainingMoves: z.array(z.string().min(4)),
  remainingPlies: z.number().int().nonnegative(),
});
export type TrapSequenceState = z.infer<typeof trapSequenceStateSchema>;

export const sacrificeTypeSchema = z.enum(["none", "positional", "dynamic", "mating"]);
export type SacrificeType = z.infer<typeof sacrificeTypeSchema>;

export const sacrificeTrackingStateSchema = z.object({
  active: z.boolean(),
  type: sacrificeTypeSchema,
  materialOffered: z.number(),
  referenceEvaluation: z.number().nullable(),
  targetEvaluation: z.number().nullable(),
  status: z.enum(["idle", "pending", "succeeding", "failed"]),
  startedAtMoveNumber: z.number().int().nonnegative().nullable(),
  lastUpdatedMoveNumber: z.number().int().nonnegative().nullable(),
});
export type SacrificeTrackingState = z.infer<typeof sacrificeTrackingStateSchema>;

export const opponentPressureLevelSchema = z.enum([
  "calm",
  "stable",
  "pressured",
  "crumbling",
]);
export type OpponentPressureLevel = z.infer<typeof opponentPressureLevelSchema>;

export const opponentPressureModelSchema = z.object({
  level: opponentPressureLevelSchema,
  consecutiveMistakes: z.number().int().nonnegative(),
  consecutiveSolidMoves: z.number().int().nonnegative(),
  lastObservedEvalSwing: z.number(),
});
export type OpponentPressureModel = z.infer<typeof opponentPressureModelSchema>;

export const lastDecisionRecordSchema = z.object({
  dominantEngine: engineModeSchema,
  strategy: z.string().min(1).optional(),
  move: z.string().min(4).optional(),
  moveNumber: z.number().int().nonnegative().nullable(),
});
export type LastDecisionRecord = z.infer<typeof lastDecisionRecordSchema>;

export const gambitStateSchema = z.object({
  active: z.boolean(),
  line: z.string().min(1).optional(),
  status: z.enum([
    "idle",
    "offered",
    "accepted",
    "declined",
    "refuted",
    "abandoned",
    "failed",
  ]),
  cooldown: z.number().int().nonnegative(),
  attemptMoveNumber: z.number().int().nonnegative().nullable().optional(),
  handoffMode: z.enum(["none", "exploitation", "pressure", "recovery", "clean"]).optional(),
  refuted: z.boolean().optional(),
  refutedCount: z.number().int().nonnegative().optional(),
});
export type GambitState = z.infer<typeof gambitStateSchema>;

export const scoreBreakdownSchema = z.object({
  stockfishEval: z.number(),
  stockfishWeight: z.number(),
  gambit: z.number(),
  trap: z.number(),
  sacrifice: z.number(),
  aggression: z.number(),
  psychological: z.number(),
  finalScore: z.number(),
});
export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;

export const engineContributionSchema = z.object({
  mode: engineModeSchema,
  score: z.number(),
});
export type EngineContribution = z.infer<typeof engineContributionSchema>;

export const engineStateSchema = z.object({
  behaviorSuccessScore: z.number().int(),
  fallbackMovesRemaining: z.number().int().nonnegative(),
  pureStockfishMovesRemaining: z.number().int().nonnegative(),
  sacrificeCooldownMoves: z.number().int().nonnegative(),
  recentEvaluations: z.array(z.number()),
  currentRecoveryMode: engineRecoveryModeSchema,
  style: styleIdSchema.default("solid"),
  mode: styleModeSchema.default("opening"),
  telemetry: moveTelemetrySchema.optional(),
  gambit: gambitStateSchema,
  activeThemes: z.array(tacticalThemeSchema),
  trapSequence: trapSequenceStateSchema,
  sacrificeTracking: sacrificeTrackingStateSchema,
  opponentPressure: opponentPressureModelSchema,
  lastDecision: lastDecisionRecordSchema,
  complexityDial: z.number().int().min(0).max(10),
  lastDominantMode: engineModeSchema,
  lastScoreBreakdown: scoreBreakdownSchema,
  lastActiveBehaviors: z.array(engineContributionSchema),
});
export type EngineState = z.infer<typeof engineStateSchema>;

export const createGameRequestSchema = z.object({
  playerColor: playerColorSchema.default("white"),
  difficulty: difficultySchema.default("advanced"),
  style: styleIdSchema.default("solid"),
  userId: z.string().uuid().optional(),
});
export type CreateGameRequest = z.input<typeof createGameRequestSchema>;

export const moveRequestSchema = z.object({
  fen: z.string().min(1),
  difficulty: difficultySchema,
  moveNumber: z.number().int().nonnegative(),
  playerColor: playerColorSchema,
  gameId: z.string().uuid(),
});
export type MoveRequest = z.infer<typeof moveRequestSchema>;

export const moveResponseSchema = z.object({
  move: z.string().min(4),
  moveNotation: z.string().min(1),
  evaluation: z.number(),
  engineMode: engineModeSchema,
  thinkingTime: z.number().int().nonnegative(),
});
export type MoveResponse = z.infer<typeof moveResponseSchema>;

export const playerMoveRequestSchema = z.object({
  clientMoveId: z.string().min(1),
  expectedPly: z.number().int().nonnegative(),
  from: z.string().length(2),
  to: z.string().length(2),
  promotion: z.enum(["q", "r", "b", "n"]).optional(),
});
export type PlayerMoveRequest = z.infer<typeof playerMoveRequestSchema>;

export const undoModeSchema = z.enum(["auto", "full-turn", "pending-player"]);
export type UndoMode = z.infer<typeof undoModeSchema>;

export const undoRequestSchema = z.object({
  mode: undoModeSchema.default("auto").optional(),
  pendingMoveUci: z.string().min(4).max(8).optional(),
  pendingMoveNumber: z.number().int().positive().optional(),
});
export type UndoRequest = z.infer<typeof undoRequestSchema>;

export const moveClassificationSchema = z.enum([
  "best",
  "excellent",
  "good",
  "inaccuracy",
  "mistake",
  "blunder",
  "brilliant",
]);
export type MoveClassification = z.infer<typeof moveClassificationSchema>;

export const moveAnalysisDisplayModeSchema = z.enum(["badge", "none", "mate"]);
export type MoveAnalysisDisplayMode = z.infer<typeof moveAnalysisDisplayModeSchema>;

export const explanationDetailSchema = z.object({
  short: z.string(),
  expanded: z.string().optional(),
  detectorId: z.string(),
  evidence: z.array(z.string()).optional(),
});
export type ExplanationDetail = z.infer<typeof explanationDetailSchema>;

export const recommendedMoveSchema = z.object({
  move: z.string().min(4),
  notation: z.string().min(1),
});
export type RecommendedMove = z.infer<typeof recommendedMoveSchema>;

export const moveAnalysisResultSchema = z.object({
  classification: moveClassificationSchema,
  displayMode: moveAnalysisDisplayModeSchema.default("badge"),
  shortExplanation: z.string(),
  evalBefore: z.number(),
  evalAfter: z.number(),
  evalLoss: z.number(),
  bestMove: z.string(),
  bestMoveNotation: z.string(),
  recommendedMoves: z.array(recommendedMoveSchema).default([]),
  openingBookName: z.string().nullable().optional(),
  explanations: z.array(explanationDetailSchema),
  analysisDepth: z.number().int().positive(),
  analysisTimeMs: z.number().int().nonnegative(),
  fromCache: z.boolean(),
  partial: z.boolean(),
});
export type MoveAnalysisResult = z.infer<typeof moveAnalysisResultSchema>;

export const moveHistoryEntrySchema = z.object({
  moveNumber: z.number().int().positive(),
  player: z.enum(["human", "ai"]),
  fenBefore: z.string(),
  fenAfter: z.string(),
  moveUci: z.string(),
  moveNotation: z.string(),
  evaluation: z.number().nullable(),
  engineMode: engineModeSchema.nullable(),
  strategy: z.string().optional(),
  timestamp: z.string(),
  analysis: moveAnalysisResultSchema.nullable().optional(),
});
export type MoveHistoryEntry = z.infer<typeof moveHistoryEntrySchema>;

export const gameSnapshotSchema = z.object({
  gameId: z.string().uuid(),
  userId: z.string().uuid().nullable().optional(),
  playerColor: playerColorSchema,
  difficulty: difficultySchema,
  style: styleIdSchema,
  fen: z.string(),
  status: gameStatusSchema,
  moveHistory: z.array(moveHistoryEntrySchema),
  evaluation: z.number().nullable(),
  engineState: engineStateSchema,
});
export type GameSnapshot = z.infer<typeof gameSnapshotSchema>;

export const createGameResponseSchema = gameSnapshotSchema;
export type CreateGameResponse = z.infer<typeof createGameResponseSchema>;

export const playerMoveResponseSchema = z.object({
  game: gameSnapshotSchema,
  playerMove: moveHistoryEntrySchema,
  aiMove: moveHistoryEntrySchema.nullable(),
  evaluation: z.number().nullable(),
  engineMode: engineModeSchema.nullable(),
  thinkingTime: z.number().int().nonnegative(),
  moveAnalysis: moveAnalysisResultSchema.nullable().optional(),
});
export type PlayerMoveResponse = z.infer<typeof playerMoveResponseSchema>;

export const undoResponseSchema = z.object({
  game: gameSnapshotSchema,
});
export type UndoResponse = z.infer<typeof undoResponseSchema>;

export const resignResponseSchema = z.object({
  game: gameSnapshotSchema,
  result: z.enum(["win", "loss", "draw"]),
});
export type ResignResponse = z.infer<typeof resignResponseSchema>;

export const drawOfferResponseSchema = z.object({
  accepted: z.boolean(),
  game: gameSnapshotSchema,
});
export type DrawOfferResponse = z.infer<typeof drawOfferResponseSchema>;

export const candidateMoveSchema = z.object({
  move: z.string(),
  eval: z.number(),
  multipv: z.number().int().positive(),
  depth: z.number().int().positive(),
  mate: z.number().int().nullable().optional(),
});
export type CandidateMove = z.infer<typeof candidateMoveSchema>;

export const defaultEngineState = (style: StyleId = "solid"): EngineState => ({
  behaviorSuccessScore: 0,
  fallbackMovesRemaining: 0,
  pureStockfishMovesRemaining: 0,
  sacrificeCooldownMoves: 0,
  recentEvaluations: [],
  currentRecoveryMode: "none",
  style,
  mode: "opening",
  gambit: {
    active: false,
    status: "idle",
    cooldown: 0,
    handoffMode: "none",
    refuted: false,
    attemptMoveNumber: null,
    refutedCount: 0,
  },
  activeThemes: [],
  trapSequence: {
    active: false,
    status: "idle",
    remainingMoves: [],
    remainingPlies: 0,
  },
  sacrificeTracking: {
    active: false,
    type: "none",
    materialOffered: 0,
    referenceEvaluation: null,
    targetEvaluation: null,
    status: "idle",
    startedAtMoveNumber: null,
    lastUpdatedMoveNumber: null,
  },
  opponentPressure: {
    level: "stable",
    consecutiveMistakes: 0,
    consecutiveSolidMoves: 0,
    lastObservedEvalSwing: 0,
  },
  lastDecision: {
    dominantEngine: "stockfish",
    moveNumber: null,
  },
  complexityDial: 5,
  lastDominantMode: "stockfish",
  lastScoreBreakdown: {
    stockfishEval: 0,
    stockfishWeight: 1,
    gambit: 0,
    trap: 0,
    sacrifice: 0,
    aggression: 0,
    psychological: 0,
    finalScore: 0,
  },
  lastActiveBehaviors: [],
});

export const userStatsSchema = z.object({
  gamesPlayed: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  draws: z.number().int().nonnegative(),
  winRate: z.number().nonnegative(),
  favoriteStyle: styleIdSchema.optional(),
});
export type UserStats = z.infer<typeof userStatsSchema>;

export const userProfileSchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(3).max(32),
  email: z.string().email(),
  createdAt: z.string(),
  stats: userStatsSchema,
});
export type UserProfile = z.infer<typeof userProfileSchema>;

export const registerRequestSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(32, "Username cannot exceed 32 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
  email: z.string().trim().email("Please provide a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  usernameOrEmail: z.string().trim().min(3, "Username or email is required"),
  password: z.string().min(1, "Password is required"),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const authResponseSchema = z.object({
  token: z.string(),
  user: userProfileSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const gameSummarySchema = z.object({
  gameId: z.string().uuid(),
  userId: z.string().uuid().nullable().optional(),
  playerColor: playerColorSchema,
  difficulty: difficultySchema,
  style: styleIdSchema,
  status: gameStatusSchema,
  result: z.enum(["win", "loss", "draw"]).nullable(),
  totalMoves: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  previewFen: z.string(),
});
export type GameSummary = z.infer<typeof gameSummarySchema>;

export const gameHistoryResponseSchema = z.object({
  games: z.array(gameSummarySchema),
  total: z.number().int().nonnegative(),
});
export type GameHistoryResponse = z.infer<typeof gameHistoryResponseSchema>;
