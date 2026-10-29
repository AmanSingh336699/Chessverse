import { z } from "zod";

export const difficultySchema = z.enum([
  "beginner",
  "intermediate",
  "advanced",
  "master",
]);
export type Difficulty = z.infer<typeof difficultySchema>;

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
  status: z.enum(["idle", "offered", "accepted", "declined", "failed"]),
  cooldown: z.number().int().nonnegative(),
  attemptMoveNumber: z.number().int().nonnegative().nullable().optional(),
  handoffMode: z.enum(["none", "exploitation", "pressure", "recovery", "clean"]).optional(),
  refuted: z.boolean().optional(),
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
});
export type CreateGameRequest = z.infer<typeof createGameRequestSchema>;

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
  playerColor: playerColorSchema,
  difficulty: difficultySchema,
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

export const defaultEngineState = (): EngineState => ({
  behaviorSuccessScore: 0,
  fallbackMovesRemaining: 0,
  pureStockfishMovesRemaining: 0,
  sacrificeCooldownMoves: 0,
  recentEvaluations: [],
  currentRecoveryMode: "none",
  gambit: {
    active: false,
    status: "idle",
    cooldown: 0,
    handoffMode: "none",
    refuted: false,
    attemptMoveNumber: null,
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
