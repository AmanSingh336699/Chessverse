import { Chess } from "chess.js";
import {
  defaultEngineState,
  STYLE_PROFILES,
  type EngineState,
  type MoveHistoryEntry,
  type PlayerColor,
  type StyleId,
} from "@chessverse/contracts";
import { findRepertoireMove } from "./repertoire.js";
import {
  applyBudgetFilter,
  calculateCandidateStyleScore,
  isMoveSafeFromBlunder,
  resolveEngineMode,
  softmaxSelect,
} from "./stylePipeline.js";
import { uciToMoveShape } from "../../utils/chess.js";

export interface SelfPlayGameResult {
  gameIndex: number;
  style: StyleId;
  aiColor: PlayerColor;
  movesCount: number;
  result: "win" | "loss" | "draw" | "terminated";
  illegalMoves: number;
  gambitPlayed: boolean;
  gambitName?: string | undefined;
  modesVisited: string[];
  finalFen: string;
}

export interface SelfPlayBenchmarkResult {
  style: StyleId;
  totalGames: number;
  wins: number;
  losses: number;
  draws: number;
  illegalMovesCount: number;
  gambitPlayRate: number;
  averagePlies: number;
  games: SelfPlayGameResult[];
}

/**
 * Simulates a single game between a Style engine and a baseline Stockfish player.
 * In unit testing or self-play simulation mode without a live child process,
 * the simulation uses deterministic legal candidate generation.
 */
export async function simulateSelfPlayGame(params: {
  gameIndex: number;
  style: StyleId;
  aiColor: PlayerColor;
  maxPlies?: number;
  seed?: number;
}): Promise<SelfPlayGameResult> {
  const { gameIndex, style, aiColor, maxPlies = 60, seed = gameIndex * 1000 + 42 } = params;
  const profile = STYLE_PROFILES[style] ?? STYLE_PROFILES.solid;
  const chess = new Chess();
  const moveHistory: MoveHistoryEntry[] = [];
  let engineState: EngineState = defaultEngineState(style);
  let illegalMoves = 0;
  let gambitPlayed = false;
  let gambitName: string | undefined;
  const modesVisited = new Set<string>([engineState.mode]);

  for (let ply = 1; ply <= maxPlies; ply++) {
    if (chess.isGameOver()) break;

    const currentTurnColor: PlayerColor = chess.turn() === "w" ? "white" : "black";
    const fenBefore = chess.fen();
    const isAiTurn = currentTurnColor === aiColor;

    let chosenUci: string | null = null;

    if (isAiTurn) {
      // 1. Stage 1: Check Style Repertoire
      if (ply <= 12) {
        const uciHistory = moveHistory.map((m) => m.moveUci);
        const repMatch = findRepertoireMove(profile.repertoireId, aiColor, uciHistory, 0);
        if (repMatch) {
          chosenUci = repMatch.move;
          gambitPlayed = true;
          gambitName = repMatch.gambit.name;
          engineState.mode = "gambit";
          modesVisited.add("gambit");
        }
      }

      // 2. If no repertoire move, generate legal candidate moves and apply style pipeline
      if (!chosenUci) {
        const legalMoves = chess.moves({ verbose: true });
        if (legalMoves.length === 0) break;

        // Simulate multi-pv candidate evaluations
        const candidates = legalMoves.slice(0, profile.multiPv).map((m, idx) => ({
          move: `${m.from}${m.to}${m.promotion ?? ""}`,
          eval: Number((0.2 - idx * 0.15).toFixed(2)),
          multipv: idx + 1,
          depth: 10,
          mate: null,
          breakdown: {
            gambit: style === "gambiteer" ? 80 : 10,
            trap: style === "tricky" ? 90 : 15,
            sacrifice: style === "aggressive" || style === "gambiteer" ? 60 : 5,
            aggression: style === "aggressive" ? 90 : 20,
            psychological: 30,
            stockfishWeight: 50,
            finalScore: 50,
            dominantMode: "stockfish" as const,
          },
          engineMode: "stockfish" as const,
          annotation: { phaseTags: [], strategies: [], continuityDelta: 0, tacticalThemes: [] },
        }));

        const phase = ply <= 15 ? "opening" : ply <= 40 ? "middlegame" : "endgame";
        const budgeted = applyBudgetFilter(candidates, profile.evalBudgetCp[phase]);
        const bestEval = budgeted[0]?.eval ?? 0;

        const scoredWithStyle = budgeted.map((c) => {
          const weights = profile.bonusWeights;
          const bonusCp = Math.min(
            200,
            Math.round(
              (c.breakdown.gambit * weights.gambit +
                c.breakdown.trap * weights.trap +
                c.breakdown.sacrifice * weights.sacrifice +
                c.breakdown.aggression * weights.aggression +
                c.breakdown.psychological * weights.psychological) /
                100,
            ),
          );
          return calculateCandidateStyleScore({ candidate: c, bestEval, bonusCp });
        });

        const picked = softmaxSelect(scoredWithStyle, profile.temperature, seed + ply);
        const isSafe = isMoveSafeFromBlunder(fenBefore, picked.move, aiColor);
        chosenUci = isSafe ? picked.move : (candidates[0]?.move ?? picked.move);

        const currentMode = resolveEngineMode({
          phase,
          evalCp: Math.round((candidates[0]?.eval ?? 0) * 100),
          profile,
          isGambitActive: gambitPlayed,
          hasAttackAdvantage: false,
        });
        modesVisited.add(currentMode);
      }
    } else {
      // Baseline opponent (Stockfish top move / principled responder)
      const legalMoves = chess.moves({ verbose: true });
      if (legalMoves.length === 0) break;
      const topMove = legalMoves[0]!;
      chosenUci = `${topMove.from}${topMove.to}${topMove.promotion ?? ""}`;
    }

    if (!chosenUci) break;

    // Verify legality
    const shape = uciToMoveShape(chosenUci);
    if (!shape) {
      illegalMoves++;
      break;
    }

    try {
      const applied = chess.move(shape);
      if (!applied) {
        illegalMoves++;
        break;
      }

      moveHistory.push({
        moveNumber: ply,
        player: isAiTurn ? "ai" : "human",
        fenBefore,
        fenAfter: chess.fen(),
        moveUci: chosenUci,
        moveNotation: applied.san,
        evaluation: 0,
        engineMode: null,
        timestamp: new Date().toISOString(),
      });
    } catch {
      illegalMoves++;
      break;
    }
  }

  let result: SelfPlayGameResult["result"] = "draw";
  if (chess.isCheckmate()) {
    const winnerColor = chess.turn() === "w" ? "black" : "white";
    result = winnerColor === aiColor ? "win" : "loss";
  } else if (!chess.isGameOver()) {
    result = "terminated";
  }

  return {
    gameIndex,
    style,
    aiColor,
    movesCount: moveHistory.length,
    result,
    illegalMoves,
    gambitPlayed,
    gambitName,
    modesVisited: Array.from(modesVisited),
    finalFen: chess.fen(),
  };
}

/**
 * Runs a self-play benchmark across multiple games.
 */
export async function runSelfPlayBenchmark(params: {
  style: StyleId;
  totalGames: number;
  maxPliesPerGame?: number;
}): Promise<SelfPlayBenchmarkResult> {
  const { style, totalGames, maxPliesPerGame = 60 } = params;
  const games: SelfPlayGameResult[] = [];
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let totalIllegalMoves = 0;
  let gambitCount = 0;
  let totalPlies = 0;

  for (let i = 0; i < totalGames; i++) {
    const aiColor: PlayerColor = i % 2 === 0 ? "white" : "black";
    const gameResult = await simulateSelfPlayGame({
      gameIndex: i + 1,
      style,
      aiColor,
      maxPlies: maxPliesPerGame,
    });

    games.push(gameResult);
    if (gameResult.result === "win") wins++;
    else if (gameResult.result === "loss") losses++;
    else draws++;

    totalIllegalMoves += gameResult.illegalMoves;
    if (gameResult.gambitPlayed) gambitCount++;
    totalPlies += gameResult.movesCount;
  }

  return {
    style,
    totalGames,
    wins,
    losses,
    draws,
    illegalMovesCount: totalIllegalMoves,
    gambitPlayRate: totalGames > 0 ? Number((gambitCount / totalGames).toFixed(2)) : 0,
    averagePlies: totalGames > 0 ? Number((totalPlies / totalGames).toFixed(1)) : 0,
    games,
  };
}
