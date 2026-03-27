import type {
  CandidateMove,
  Difficulty,
  EngineMode,
  EngineState,
  GamePhase,
  GameSnapshot,
  GameStatus,
  LastDecisionRecord,
  MoveHistoryEntry,
  OpponentPressureModel,
  PlayerColor,
  SacrificeTrackingState,
  ScoreBreakdown,
  TacticalTheme,
  TrapSequenceState,
} from "./contracts.js";
import type { Chess, Move } from "chess.js";
import type { Logger } from "pino";

export type WorkerState = "INITIALIZING" | "WARMUP" | "IDLE" | "BUSY" | "RESTARTING" | "PERMANENTLY_FAILED";

export interface DifficultyProfile {
  depth: number;
  movetimeMs: number;
  minDepth: number;
  behaviorBudgetMs: number;
  stockfishWeight: number;
  behaviorMultiplier: number;
  randomTopN: number;
}

export interface AnalysisResult {
  candidates: CandidateMove[];
  bestMove: string | null;
  thinkingTime: number;
  depthReached: number;
  partial: boolean;
}

export interface BehaviorResult {
  score: number;
  triggered: boolean;
  details?: string;
}

export type CandidatePhaseTag =
  | "opening-principle"
  | "development"
  | "center"
  | "king-attack"
  | "simplification"
  | "restriction"
  | "endgame-technique"
  | "pawn-race";

export interface CandidateAnnotation {
  phaseTags: CandidatePhaseTag[];
  strategies: string[];
  continuityDelta: number;
  tacticalThemes: TacticalTheme[];
  trapSequence?: TrapSequenceState;
  sacrificeTracking?: SacrificeTrackingState;
  opponentPressure?: OpponentPressureModel;
  lastDecision?: LastDecisionRecord;
}

export interface FilteredCandidate extends CandidateMove {
  phaseTags: CandidatePhaseTag[];
  stockfishGap: number;
  legal: boolean;
}

export interface StockfishTruthLayer {
  topMove: string;
  topEval: number;
  evaluationWindow: number;
  absoluteFloor: number;
  lockedToStockfish: boolean;
}

export interface SharedBoardAnalysis {
  opponentColor: PlayerColor;
  opponentKingSquare: string;
  opponentKingZone: Set<string>;
  aiCaptureTargetCountBefore: number;
  opponentMobilityBefore: number;
  opponentKingPressureBefore: number;
  opponentKingDefendersBefore: number;
  defendedSquaresByOpponent: Set<string>;
}

export interface CandidatePositionSnapshot {
  afterFen: string;
  afterChess: Chess;
  appliedMove: Move;
  aiMovesAfter: Move[];
  opponentMovesAfter: Move[];
  aiCaptureTargetCountAfter: number;
  movedPieceCaptureTargetCount: number;
  opponentMobilityAfter: number;
  opponentKingPressureAfter: number;
  opponentKingDefendersAfter: number;
  givesCheck: boolean;
}

export interface SharedBehaviorContext {
  gameId: string;
  fen: string;
  moveNumber: number;
  aiColor: PlayerColor;
  difficulty: Difficulty;
  phase: GamePhase;
  chess: Chess;
  totalMaterial: number;
  engineState: EngineState;
  moveHistory: MoveHistoryEntry[];
  logger: Logger;
  stockfishTruth: StockfishTruthLayer;
  candidates: FilteredCandidate[];
  activeThemes: TacticalTheme[];
  complexityDial: number;
  boardAnalysis: SharedBoardAnalysis;
}

export interface EvaluatedCandidate extends CandidateMove {
  breakdown: ScoreBreakdown;
  engineMode: EngineMode;
  annotation: CandidateAnnotation;
}

export interface BehaviorContext {
  gameId: string;
  fen: string;
  moveNumber: number;
  aiColor: PlayerColor;
  difficulty: Difficulty;
  phase: GamePhase;
  chess: Chess;
  engineState: EngineState;
  candidates: CandidateMove[];
  moveHistory: MoveHistoryEntry[];
  logger: Logger;
}

export interface EngineDecision {
  move: string;
  moveNotation: string;
  evaluation: number;
  engineMode: EngineMode;
  thinkingTime: number;
  candidateScores: EvaluatedCandidate[];
  engineState: EngineState;
}

export interface StoredGame extends GameSnapshot {
  result: "win" | "loss" | "draw" | null;
  totalMoves: number;
  startTime: string;
  endTime: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EngineStatDelta {
  gambitsAttempted?: number;
  gambitsAccepted?: number;
  sacrificesPlayed?: number;
  trapsSet?: number;
  trapsTriggered?: number;
  thinkingTimeMs?: number;
  totalGames?: number;
}

export interface CandidateBreakdown {
  candidate: CandidateMove;
  gambit: number;
  trap: number;
  sacrifice: number;
  aggression: number;
  psychological: number;
  stockfishWeight: number;
  finalScore: number;
  dominantMode: EngineMode;
}

export interface EvalCache<T> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T, ttlSeconds?: number): Promise<void>;
  disconnect(): Promise<void>;
}

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly payload?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface PersistentGameRepository {
  getGame(gameId: string): Promise<StoredGame | null>;
  saveGame(game: StoredGame): Promise<void>;
  incrementEngineStats(delta: EngineStatDelta): Promise<void>;
  isHealthy(): Promise<boolean>;
}

export interface GameRepository {
  getGame(gameId: string): Promise<StoredGame | null>;
  saveGame(game: StoredGame): Promise<void>;
  incrementEngineStats(delta: EngineStatDelta): Promise<void>;
}

export interface StatusSnapshot {
  status: GameStatus;
  winner: "win" | "loss" | "draw" | null;
}
