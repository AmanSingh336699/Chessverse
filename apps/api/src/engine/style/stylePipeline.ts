import { Chess } from "chess.js";
import type { CandidateMove, GamePhase, PlayerColor, StyleMode, StyleProfile } from "@chessverse/contracts";
import { uciToMoveShape } from "../../utils/chess.js";

export type ScoredCandidate<T extends CandidateMove = CandidateMove> = T & {
  cpLoss: number;
  bonus: number;
  finalScoreCp: number;
  probabilities?: number | undefined;
};

/**
 * Deterministic pseudo-random number generator (Mulberry32)
 */
export function createMulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Filter 1: Drop candidates whose centipawn loss exceeds the style's eval budget for the phase.
 * Always guarantees at least the top candidate remains.
 */
export function applyBudgetFilter<T extends CandidateMove = CandidateMove>(
  candidates: T[],
  evalBudgetCp: number,
): T[] {
  if (candidates.length <= 1) return [...candidates];

  // Top candidate is the highest evaluation move
  const sorted = [...candidates].sort((a, b) => b.eval - a.eval);
  const bestEval = sorted[0]!.eval;

  const filtered = sorted.filter((c) => {
    const cpLoss = Math.round((bestEval - c.eval) * 100);
    return cpLoss <= evalBudgetCp;
  });

  return filtered.length > 0 ? filtered : [sorted[0]!];
}

/**
 * Scores candidates: score = -cpLoss + capped style bonuses
 */
export function calculateCandidateStyleScore<T extends CandidateMove = CandidateMove>(params: {
  candidate: T;
  bestEval: number;
  bonusCp: number;
}): ScoredCandidate<T> {
  const { candidate, bestEval, bonusCp } = params;
  const cpLoss = Math.max(0, Math.round((bestEval - candidate.eval) * 100));
  const finalScoreCp = -cpLoss + bonusCp;

  return {
    ...candidate,
    cpLoss,
    bonus: bonusCp,
    finalScoreCp,
  };
}

/**
 * Softmax pick with temperature and optional seed for deterministic play
 */
export function softmaxSelect<T extends CandidateMove = CandidateMove>(
  candidates: ScoredCandidate<T>[],
  temperature: number,
  seed?: number,
): ScoredCandidate<T> {
  if (candidates.length === 0) {
    throw new Error("softmaxSelect requires at least one candidate");
  }
  if (candidates.length === 1) return candidates[0]!;

  const temp = Math.max(0.05, temperature);
  const maxScore = Math.max(...candidates.map((c) => c.finalScoreCp));

  // Compute exp((score - maxScore) / (temp * 100)) for numerical stability
  const expWeights = candidates.map((c) =>
    Math.exp((c.finalScoreCp - maxScore) / (temp * 100)),
  );
  const sumExp = expWeights.reduce((acc, val) => acc + val, 0);
  const probabilities = expWeights.map((w) => w / sumExp);

  const rng = seed !== undefined ? createMulberry32(seed) : Math.random;
  const randomValue = rng();

  let cumulative = 0;
  for (let i = 0; i < candidates.length; i++) {
    cumulative += probabilities[i]!;
    if (randomValue <= cumulative) {
      return {
        ...candidates[i]!,
        probabilities: probabilities[i],
      };
    }
  }

  return candidates[candidates.length - 1]!;
}

/**
 * Blunder Guard: Vetoes candidate if it allows immediate mate-in-1 against us
 * or hangs a queen with 0 compensation. Returns true if move is safe, false if blunder.
 */
export function isMoveSafeFromBlunder(
  fenBefore: string,
  moveUci: string,
  aiColor: PlayerColor,
): boolean {
  try {
    const chess = new Chess(fenBefore);
    const shape = uciToMoveShape(moveUci);
    if (!shape) return false;

    const moveObj = chess.move(shape);
    if (!moveObj) return false;

    // 1. Check if opponent has immediate mate in 1
    const opponentMoves = chess.moves({ verbose: true });
    for (const reply of opponentMoves) {
      const replyChess = new Chess(chess.fen());
      replyChess.move(reply);
      if (replyChess.isCheckmate()) {
        return false; // Blunder: allows mate in 1
      }
    }

    // 2. Check if moved queen into an attacked square undefended
    if (moveObj.piece === "q") {
      const isDefended = isSquareDefended(chess, moveObj.to, aiColor);
      const isAttacked = isSquareAttackedByOpponent(chess, moveObj.to, aiColor);
      if (isAttacked && !isDefended && !moveObj.captured) {
        return false; // Blunder: hangs queen without compensation
      }
    }

    return true;
  } catch {
    return true; // If chess analysis fails, do not block
  }
}

function isSquareAttackedByOpponent(
  chess: Chess,
  square: string,
  aiColor: PlayerColor,
): boolean {
  // chess.isAttacked takes target square and attacking color
  const opponentColor = aiColor === "white" ? "b" : "w";
  return chess.isAttacked(square as any, opponentColor);
}

function isSquareDefended(
  chess: Chess,
  square: string,
  aiColor: PlayerColor,
): boolean {
  const defendingColor = aiColor === "white" ? "w" : "b";
  return chess.isAttacked(square as any, defendingColor);
}

/**
 * Evaluates mode state machine:
 * opening -> gambit -> attack -> consolidate -> convert -> endgame
 * Safety valves: eval > +300 -> convert; eval < -150 -> swindle
 */
export function resolveEngineMode(params: {
  phase: GamePhase;
  evalCp: number;
  profile: StyleProfile;
  isGambitActive: boolean;
  hasAttackAdvantage: boolean;
}): StyleMode {
  const { phase, evalCp, profile, isGambitActive, hasAttackAdvantage } = params;

  // Safety valves have highest priority
  if (evalCp >= profile.convertThresholdCp) {
    return "convert"; // Pure Stockfish ruthless conversion
  }
  if (evalCp <= profile.swindleThresholdCp) {
    return "swindle"; // Swindle mode: tactical complications & traps
  }

  if (phase === "endgame") {
    return "endgame";
  }

  if (isGambitActive) {
    return "gambit";
  }

  if (hasAttackAdvantage) {
    return "attack";
  }

  if (phase === "opening") {
    return "opening";
  }

  return "consolidate";
}
