
import type {
    CandidateMove,
    Difficulty,
    EngineMode,
    EngineState,
    GamePhase,
    MoveHistoryEntry,
    PlayerColor,
    TacticalTheme,
} from "../contracts.js";
import type {
    CandidatePositionSnapshot,
    EvaluatedCandidate,
    FilteredCandidate,
    SharedBehaviorContext,
} from "../types.js";
import type { Logger } from "pino";
import { Chess } from "chess.js";
import { AggressivePlayEngine } from "./behavior/aggressiveEngine.js";
import {
    GambitEngine,
    type GambitBehaviorContext,
    type OpeningBook,
} from "./behavior/gambitEngine.js";
import { PsychologicalComplexityEngine } from "./behavior/psychologicalEngine.js";
import { SacrificeDetector } from "./behavior/sacrificeDetector.js";
import { TrapGenerator } from "./behavior/trapGenerator.js";
import {
    getBehaviorScale,
    computeStockfishWeight,
    sortCandidates,
} from "./difficulty.js";
import { buildFinalScore, dominantModeFromBreakdown } from "./scoring.js";
import { normalizeGambitState } from "./behavior/gambitState.js";
import {
    buildSharedBehaviorContext,
    detectThemesForPosition,
} from "./behavior/behaviorContext.js";
import { uciToMoveShape } from "../utils/chess.js";
import { legalMovesForColor } from "./behavior/helpers.js";


export interface BehaviorEngineOptions {
    openingBook?: OpeningBook;
    logger?: Pick<Logger, "warn">;
}


const contextlessGetKingSquare = (chess: Chess, color: PlayerColor): string => {
    const target = color === "white" ? "w" : "b";
    for (const row of chess.board()) {
        for (const piece of row) {
            if (piece?.type === "k" && piece.color === target)
                return piece.square;
        }
    }
    throw new Error(`King square not found for ${color}`);
};


export class BehaviorEngine {
    private readonly gambit: GambitEngine;
    private readonly sacrifice = new SacrificeDetector();
    private readonly psychological = new PsychologicalComplexityEngine();
    private readonly aggressive = new AggressivePlayEngine();
    private readonly openingBook: OpeningBook | undefined;
    private readonly logger: Pick<Logger, "warn"> | undefined;

    constructor(options: BehaviorEngineOptions = {}) {
        this.openingBook = options.openingBook;
        this.logger = options.logger;
        this.gambit = new GambitEngine({
            ...(options.openingBook
                ? { openingBook: options.openingBook }
                : {}),
            ...(options.logger ? { logger: options.logger } : {}),
        });
    }


    async evaluateCandidates(params: {
        gameId: string;
        fen: string;
        moveNumber: number;
        aiColor: PlayerColor;
        difficulty: Difficulty;
        phase: GamePhase;
        engineState: EngineState;
        candidates: CandidateMove[];
        moveHistory: MoveHistoryEntry[];
        logger: Logger;
        evaluateFen: (fen: string, depth: number) => Promise<number>;
    }): Promise<EvaluatedCandidate[]> {
        // Nothing to evaluate — caller should have checked, but be defensive
        if (params.candidates.length === 0) return [];

        const sharedContext = buildSharedBehaviorContext(params);

        // buildSharedBehaviorContext may filter candidates through a legal-move
        // check with a flipped color.  If the ep square is tainted and createChess
        // strips it, some moves can disappear from the context.  Fall back to raw
        // scoring of the original candidates so we always produce output.
        if (sharedContext.candidates.length === 0) {
            params.logger.warn(
                {
                    gameId: params.gameId,
                    fen: params.fen,
                    inputCandidates: params.candidates.length,
                },
                "buildSharedBehaviorContext filtered all candidates — using raw Stockfish fallback",
            );
            return this.buildRawFallback(
                params.candidates,
                params.difficulty,
                params.phase,
                params.engineState,
            );
        }

        const stockfishWeight = computeStockfishWeight(
            sharedContext.phase,
            params.difficulty,
            params.engineState,
        );
        const trapGenerator = new TrapGenerator(
            sharedContext,
            params.evaluateFen,
        );

        const gambitContext: GambitBehaviorContext = {
            fen: params.fen,
            history: params.moveHistory.map((e) => e.moveUci),
            moveNumber: params.moveNumber,
            aiColor: params.aiColor,
            phase: params.phase,
            gambitState: normalizeGambitState(params.engineState.gambit),
        };

        const openingObservationMode = params.phase === "opening";
        const openingObservationScale = openingObservationMode ? 0.2 : 1;

        // Pre-build all position snapshots synchronously
        const moveSnapshots = new Map<string, CandidatePositionSnapshot | null>(
            sharedContext.candidates.map((c) => [
                c.move,
                this.buildCandidateSnapshot(sharedContext, c),
            ]),
        );

        // Run synchronous budgeted sub-engines
        const aggressionAnalyses = this.runBudgetedSynchronousAnalysis({
            candidates: sharedContext.candidates,
            moveSnapshots,
            logger: params.logger,
            module: "aggressive",
            budgetMs: 15,
            fallback: {
                score: 0,
                multiplier: 1,
                rules: [],
                passivePenalty: false,
                strategy: "aggression-budget-exhausted",
            },
            analyze: (c, s) =>
                this.aggressive.analyzeCandidate(sharedContext, c, s),
        });

        const psychologicalAnalyses = this.runBudgetedSynchronousAnalysis({
            candidates: sharedContext.candidates,
            moveSnapshots,
            logger: params.logger,
            module: "psychological",
            budgetMs: 25,
            fallback: {
                score: 0,
                dial: sharedContext.complexityDial,
                strategies: [],
                continuityDelta: 0,
                opponentPressure: sharedContext.engineState.opponentPressure,
                strategy: "psychology-budget-exhausted",
            },
            analyze: (c, s) =>
                this.psychological.analyzeCandidate(sharedContext, c, s),
        });

        // Async scoring for each candidate
        const evaluated = await Promise.all(
            sharedContext.candidates.map(async (candidate) => {
                const snapshot = moveSnapshots.get(candidate.move) ?? null;
                const afterFen = snapshot?.afterFen ?? sharedContext.fen;

                const baseAnnotation = {
                    phaseTags: candidate.phaseTags,
                    strategies: [] as string[],
                    continuityDelta: 0,
                    tacticalThemes: detectThemesForPosition(
                        afterFen,
                        sharedContext.aiColor,
                        sharedContext.phase,
                    ),
                    opponentPressure:
                        sharedContext.engineState.opponentPressure,
                    lastDecision: {
                        dominantEngine: "stockfish" as const,
                        move: candidate.move,
                        moveNumber: sharedContext.moveNumber,
                    },
                };

                // Pure Stockfish path — skip all behavior scoring
                if (sharedContext.stockfishTruth.lockedToStockfish) {
                    return buildFinalScore(
                        candidate,
                        stockfishWeight,
                        {
                            gambit: 0,
                            trap: 0,
                            sacrifice: 0,
                            aggression: 0,
                            psychological: 0,
                        },
                        baseAnnotation,
                    );
                }

                const gambitScore = await this.safeScore(
                    () =>
                        Promise.resolve(
                            this.gambit.scoreCandidate(
                                gambitContext,
                                candidate,
                            ),
                        ),
                    params.logger,
                    candidate.move,
                    "gambit",
                );

                const capturedGambitState =
                    gambitScore > 0
                        ? this.captureGambitState(gambitContext, candidate)
                        : null;

                const trapAnalysis = openingObservationMode
                    ? {
                          score: 0,
                          grade: null,
                          sequence: null,
                          strategy: "opening-observation",
                      }
                    : await this.safeModule(
                          () => trapGenerator.analyzeCandidate(candidate),
                          params.logger,
                          candidate.move,
                          "trap",
                          {
                              score: 0,
                              grade: null,
                              sequence: null,
                              strategy: "trap-error",
                          },
                          80,
                      );

                const sacrificeAnalysis = openingObservationMode
                    ? {
                          score: 0,
                          type: "none",
                          materialOffered: 0,
                          targetEvaluation: null,
                          tracking: null,
                          strategy: "opening-observation",
                      }
                    : await this.safeModule(
                          () =>
                              Promise.resolve(
                                  this.sacrifice.analyzeCandidate(
                                      sharedContext,
                                      candidate,
                                  ),
                              ),
                          params.logger,
                          candidate.move,
                          "sacrifice",
                          {
                              score: 0,
                              type: "none",
                              materialOffered: 0,
                              targetEvaluation: null,
                              tracking: null,
                              strategy: "sacrifice-error",
                          },
                          30,
                      );

                const aggressionAnalysis = aggressionAnalyses.get(
                    candidate.move,
                ) ?? {
                    score: 0,
                    multiplier: 1,
                    rules: [],
                    passivePenalty: false,
                    strategy: "aggression-error",
                };

                const psychologicalAnalysis = psychologicalAnalyses.get(
                    candidate.move,
                ) ?? {
                    score: 0,
                    dial: sharedContext.complexityDial,
                    strategies: [],
                    continuityDelta: 0,
                    opponentPressure:
                        sharedContext.engineState.opponentPressure,
                    strategy: "psychology-error",
                };

                const scaledScores = {
                    gambit:
                        gambitScore *
                        getBehaviorScale(
                            params.difficulty,
                            params.phase,
                            params.engineState,
                            "gambit",
                        ),
                    trap:
                        trapAnalysis.score *
                        getBehaviorScale(
                            params.difficulty,
                            params.phase,
                            params.engineState,
                            "trap",
                        ),
                    sacrifice:
                        sacrificeAnalysis.score *
                        getBehaviorScale(
                            params.difficulty,
                            params.phase,
                            params.engineState,
                            "sacrifice",
                        ),
                    aggression:
                        aggressionAnalysis.score *
                        getBehaviorScale(
                            params.difficulty,
                            params.phase,
                            params.engineState,
                            "aggression",
                        ) *
                        openingObservationScale,
                    psychological:
                        psychologicalAnalysis.score *
                        getBehaviorScale(
                            params.difficulty,
                            params.phase,
                            params.engineState,
                            "psychological",
                        ) *
                        openingObservationScale,
                };

                const dominantMode = dominantModeFromBreakdown(scaledScores);
                const dominantStrategy = this.resolveDominantStrategy({
                    dominantMode,
                    gambitLine: capturedGambitState?.line,
                    trapStrategy: openingObservationMode
                        ? null
                        : trapAnalysis.strategy,
                    sacrificeStrategy: openingObservationMode
                        ? null
                        : sacrificeAnalysis.strategy,
                    aggressionStrategy: aggressionAnalysis.strategy,
                    psychologicalStrategy: psychologicalAnalysis.strategy,
                });

                const strategies = [
                    this.normalizeStrategyLabel(capturedGambitState?.line),
                    this.normalizeStrategyLabel(
                        openingObservationMode ? null : trapAnalysis.strategy,
                    ),
                    this.normalizeStrategyLabel(
                        openingObservationMode
                            ? null
                            : sacrificeAnalysis.strategy,
                    ),
                    this.normalizeStrategyLabel(aggressionAnalysis.strategy),
                    this.normalizeStrategyLabel(psychologicalAnalysis.strategy),
                ].filter((v): v is string => Boolean(v));

                const finalCandidate = buildFinalScore(
                    candidate,
                    stockfishWeight,
                    scaledScores,
                    {
                        ...baseAnnotation,
                        strategies,
                        continuityDelta: psychologicalAnalysis.continuityDelta,
                        opponentPressure:
                            psychologicalAnalysis.opponentPressure,
                        lastDecision: {
                            dominantEngine: dominantMode,
                            move: candidate.move,
                            moveNumber: sharedContext.moveNumber,
                            ...(dominantStrategy
                                ? { strategy: dominantStrategy }
                                : {}),
                        },
                        ...(!openingObservationMode && trapAnalysis.sequence
                            ? { trapSequence: trapAnalysis.sequence }
                            : {}),
                        ...(!openingObservationMode &&
                        sacrificeAnalysis.tracking
                            ? { sacrificeTracking: sacrificeAnalysis.tracking }
                            : {}),
                    },
                );

                params.logger.info(
                    {
                        move: candidate.move,
                        stockfishEval: candidate.eval,
                        stockfishGap: candidate.stockfishGap,
                        stockfishWeight,
                        openingObservationMode,
                        scores: finalCandidate.breakdown,
                        engineMode: finalCandidate.engineMode,
                        themes: sharedContext.activeThemes,
                        strategies,
                        complexityDial: psychologicalAnalysis.dial,
                    },
                    "Behavior scores computed for candidate",
                );

                return finalCandidate;
            }),
        );

        if (evaluated.length === 0) {
            params.logger.warn(
                { gameId: params.gameId, fen: params.fen },
                "evaluated array is empty after Promise.all — using raw Stockfish fallback",
            );
            return this.buildRawFallback(
                params.candidates,
                params.difficulty,
                params.phase,
                params.engineState,
            );
        }

        return sortCandidates(evaluated);
    }


    private buildRawFallback(
        candidates: CandidateMove[],
        difficulty: Difficulty,
        phase: GamePhase,
        engineState: EngineState,
    ): EvaluatedCandidate[] {
        const stockfishWeight = computeStockfishWeight(
            phase,
            difficulty,
            engineState,
        );
        const fallbackAnnotation = {
            phaseTags: [] as FilteredCandidate["phaseTags"],
            strategies: ["raw-stockfish-fallback"],
            continuityDelta: 0,
            tacticalThemes: [] as TacticalTheme[],
            opponentPressure: {
                level: "calm" as const,
                consecutiveMistakes: 0,
                consecutiveSolidMoves: 0,
                lastObservedEvalSwing: 0,
            },
            lastDecision: {
                dominantEngine: "stockfish" as const,
                strategy: "raw-stockfish-fallback",
                move: "",
                moveNumber: 0,
            },
        };

        return sortCandidates(
            candidates.map((c) =>
                buildFinalScore(
                    c,
                    stockfishWeight,
                    {
                        gambit: 0,
                        trap: 0,
                        sacrifice: 0,
                        aggression: 0,
                        psychological: 0,
                    },
                    {
                        ...fallbackAnnotation,
                        lastDecision: {
                            ...fallbackAnnotation.lastDecision,
                            move: c.move,
                        },
                    },
                ),
            ),
        );
    }

    private countUniqueCaptureTargets(
        moves: ReturnType<Chess["moves"]>,
    ): number {
        return new Set(moves.filter((m) => m.captured).map((m) => m.to)).size;
    }

    private countDefendersAroundKing(
        chess: Chess,
        kingColor: PlayerColor,
    ): number {
        const kingSquare = contextlessGetKingSquare(chess, kingColor);
        const colorCode = kingColor === "white" ? "w" : "b";
        const file = kingSquare[0];
        const rank = kingSquare[1];
        if (!file || !rank) return 0;

        let count = 0;
        for (let df = -2; df <= 2; df++) {
            for (let dr = -2; dr <= 2; dr++) {
                if (df === 0 && dr === 0) continue;
                const nextFile = String.fromCharCode(file.charCodeAt(0) + df);
                const nextRank = Number(rank) + dr;
                if (
                    nextFile < "a" ||
                    nextFile > "h" ||
                    nextRank < 1 ||
                    nextRank > 8
                )
                    continue;
                const sq = `${nextFile}${nextRank}` as Parameters<
                    Chess["get"]
                >[0];
                const piece = chess.get(sq);
                if (piece?.color === colorCode && piece.type !== "k") count++;
            }
        }
        return count;
    }

    private countMovesIntoZone(
        moves: ReturnType<Chess["moves"]>,
        zone: Set<string>,
    ): number {
        return moves.filter((m) => zone.has(m.to)).length;
    }

    private buildCandidateSnapshot(
        context: SharedBehaviorContext,
        candidate: FilteredCandidate,
    ): CandidatePositionSnapshot | null {
        const chess = new Chess(context.fen);
        const payload = uciToMoveShape(candidate.move);
        if (!payload) return null;

        try {
            const appliedMove = chess.move(payload);
            if (!appliedMove) return null;

            const afterFen = chess.fen();
            const opponentMovesAfter = chess.moves({ verbose: true });
            const aiMovesAfter = legalMovesForColor(afterFen, context.aiColor);
            const movedPieceCaptureTargetCount = new Set(
                aiMovesAfter
                    .filter((m) => m.from === appliedMove.to && m.captured)
                    .map((m) => m.to),
            ).size;

            return {
                afterFen,
                afterChess: chess,
                appliedMove,
                aiMovesAfter,
                opponentMovesAfter,
                aiCaptureTargetCountAfter:
                    this.countUniqueCaptureTargets(aiMovesAfter),
                movedPieceCaptureTargetCount,
                opponentMobilityAfter: opponentMovesAfter.length,
                opponentKingPressureAfter: this.countMovesIntoZone(
                    aiMovesAfter,
                    context.boardAnalysis.opponentKingZone,
                ),
                opponentKingDefendersAfter: this.countDefendersAroundKing(
                    chess,
                    context.boardAnalysis.opponentColor,
                ),
                givesCheck: chess.inCheck(),
            };
        } catch {
            return null;
        }
    }

    private runBudgetedSynchronousAnalysis<T>(params: {
        candidates: readonly FilteredCandidate[];
        moveSnapshots: ReadonlyMap<string, CandidatePositionSnapshot | null>;
        logger: Logger;
        module: string;
        budgetMs: number;
        fallback: T;
        analyze: (
            candidate: FilteredCandidate,
            snapshot: CandidatePositionSnapshot | null,
        ) => T;
    }): Map<string, T> {
        const results = new Map<string, T>();
        const startedAt = Date.now();
        let budgetExceeded = false;

        for (const candidate of params.candidates) {
            if (budgetExceeded || Date.now() - startedAt >= params.budgetMs) {
                budgetExceeded = true;
                results.set(candidate.move, params.fallback);
                continue;
            }

            const snapshot = params.moveSnapshots.get(candidate.move) ?? null;
            results.set(candidate.move, params.analyze(candidate, snapshot));

            if (Date.now() - startedAt >= params.budgetMs) {
                budgetExceeded = true;
            }
        }

        if (budgetExceeded) {
            params.logger.warn(
                { module: params.module, budgetMs: params.budgetMs },
                "Behavior engine budget exceeded — remaining candidates zeroed",
            );
        }

        return results;
    }

    private normalizeStrategyLabel(
        strategy?: string | null,
    ): string | undefined {
        if (!strategy) return undefined;
        const ignoredStrategies = new Set([
            "opening-observation",
            "trap-error",
            "sacrifice-error",
            "aggression-error",
            "psychology-error",
            "aggression-budget-exhausted",
            "psychology-budget-exhausted",
        ]);
        return ignoredStrategies.has(strategy) ? undefined : strategy;
    }

    private resolveDominantStrategy(params: {
        dominantMode: EngineMode;
        gambitLine?: string | null | undefined;
        trapStrategy?: string | null | undefined;
        sacrificeStrategy?: string | null | undefined;
        aggressionStrategy?: string | null | undefined;
        psychologicalStrategy?: string | null | undefined;
    }): string | undefined {
        switch (params.dominantMode) {
            case "gambit":
                return this.normalizeStrategyLabel(params.gambitLine);
            case "trap":
                return this.normalizeStrategyLabel(params.trapStrategy);
            case "sacrifice":
                return this.normalizeStrategyLabel(params.sacrificeStrategy);
            case "aggressive":
                return this.normalizeStrategyLabel(params.aggressionStrategy);
            case "psychological":
                return this.normalizeStrategyLabel(
                    params.psychologicalStrategy,
                );
            default:
                return undefined;
        }
    }

    private captureGambitState(
        context: GambitBehaviorContext,
        candidate: CandidateMove,
    ): EngineState["gambit"] | null {
        let captured: EngineState["gambit"] | null = null;
        const tracker = new GambitEngine({
            ...(this.openingBook ? { openingBook: this.openingBook } : {}),
            ...(this.logger ? { logger: this.logger } : {}),
            stateSink: {
                persist: (state) => {
                    captured = state;
                },
            },
        });
        tracker.scoreCandidate(context, candidate);
        return captured;
    }

    private async safeScore(
        compute: () => Promise<number>,
        logger: Logger,
        move: string,
        module: string,
    ): Promise<number> {
        try {
            return await compute();
        } catch (error) {
            logger.error(
                { error, move, module },
                "Behavior module failed — defaulting score to zero",
            );
            return 0;
        }
    }

    private async safeModule<T>(
        compute: () => Promise<T>,
        logger: Logger,
        move: string,
        module: string,
        fallback: T,
        budgetMs?: number,
    ): Promise<T> {
        try {
            if (budgetMs && budgetMs > 0) {
                const startedAt = Date.now();
                const result = await Promise.race([
                    compute(),
                    new Promise<never>((_, reject) =>
                        setTimeout(
                            () =>
                                reject(
                                    new Error(
                                        `${module} budget exceeded (${budgetMs}ms)`,
                                    ),
                                ),
                            budgetMs,
                        ),
                    ),
                ]);
                const elapsed = Date.now() - startedAt;
                if (elapsed > budgetMs * 0.9) {
                    logger.warn(
                        { move, module, elapsed, budget: budgetMs },
                        "Behavior engine near budget limit",
                    );
                }
                return result;
            }
            return await compute();
        } catch (error) {
            const isTimeout =
                error instanceof Error &&
                error.message.includes("budget exceeded");
            if (isTimeout) {
                logger.warn(
                    { move, module, budgetMs },
                    "Behavior engine budget exceeded — returning fallback",
                );
            } else {
                logger.error(
                    { error, move, module },
                    "Behavior module failed — returning fallback",
                );
            }
            return fallback;
        }
    }
}
