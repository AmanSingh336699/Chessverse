import type { TrapGrade, TrapSequenceState } from "../../contracts.js";
import type { FilteredCandidate, SharedBehaviorContext } from "../../types.js";
import { Chess } from "chess.js";
import {
    applyMoveToFen,
    attackedKingZoneCount,
    countOverloadedDefenders,
    countTrappedPieces,
    detectBatteryFormations,
    getKingSquare,
} from "./helpers.js";

export interface TrapAnalysis {
    score: number;
    grade: TrapGrade | null;
    sequence: TrapSequenceState | null;
    strategy: string;
}

/* ── Score bonuses by grade ─────────────────────────────── */
const SCORE_BY_GRADE: Record<TrapGrade, number> = {
    basic: 40,
    strong: 60,
    mating: 90,
};

/* ── Depth-reliability multiplier ───────────────────────── */
const depthReliability = (movesNeeded: number): number => {
    if (movesNeeded <= 2) return 1.2;
    if (movesNeeded <= 3) return 1.0;
    if (movesNeeded <= 4) return 0.85;
    return 0.7;
};

/* ── Sequence builder ───────────────────────────────────── */
const buildSequence = (
    status: TrapSequenceState["status"],
    pattern: string,
    grade: TrapGrade,
    remainingMoves: string[],
    remainingPlies: number,
    triggerMove?: string,
): TrapSequenceState => ({
    active: status === "armed" || status === "continuing",
    status,
    pattern,
    grade,
    triggerMove,
    remainingMoves,
    remainingPlies,
});

/* ── Named trap patterns ────────────────────────────────── */
interface TrapPatternResult {
    name: string;
    confidence: number; // 0-1
}

const detectNamedPatterns = (
    context: SharedBehaviorContext,
    candidateFen: string,
    candidate: FilteredCandidate,
): TrapPatternResult[] => {
    const patterns: TrapPatternResult[] = [];
    const opponentColor = context.aiColor === "white" ? "black" : "white";
    const afterChess = new Chess(candidateFen);

    /* Back-Rank Trap: opponent king on back rank, no luft, open file available */
    try {
        const opponentKing = getKingSquare(afterChess, opponentColor);
        const backRank = opponentColor === "white" ? "1" : "8";
        if (opponentKing[1] === backRank) {
            const kingAttacks = attackedKingZoneCount(
                candidateFen,
                context.aiColor,
            );
            const hasOpenFile = context.activeThemes.includes(
                "open-file-toward-king",
            );
            if (kingAttacks >= 2 || hasOpenFile) {
                patterns.push({
                    name: "back-rank-trap",
                    confidence: hasOpenFile ? 0.9 : 0.6,
                });
            }
        }
    } catch {
        /* king square not found — skip */
    }

    /* Piece Overload Trap: single defender guarding 2+ targets */
    const overloaded = countOverloadedDefenders(candidateFen, opponentColor);
    if (overloaded >= 1) {
        patterns.push({
            name: "piece-overload-trap",
            confidence: Math.min(1, 0.5 + overloaded * 0.2),
        });
    }

    /* Discovery Trap: battery formation that can be unleashed */
    const batteries = detectBatteryFormations(candidateFen, context.aiColor);
    if (batteries >= 1) {
        const discoveryActive = context.activeThemes.includes(
            "open-diagonal-toward-king",
        );
        patterns.push({
            name: "discovery-trap",
            confidence: discoveryActive ? 0.8 : 0.5,
        });
    }

    /* En Prise Trap: opponent piece with ≤1 escape, one prep move closes routes */
    const trappedCount = countTrappedPieces(candidateFen, opponentColor);
    if (trappedCount >= 1) {
        patterns.push({
            name: "en-prise-trap",
            confidence: Math.min(1, 0.4 + trappedCount * 0.25),
        });
    }

    /* Promotion Trap: passed pawn close to promotion, distraction possible */
    if (
        context.activeThemes.includes("passed-pawn") &&
        context.phase !== "opening"
    ) {
        const pawnRace =
            candidate.phaseTags.includes("pawn-race") ||
            candidate.phaseTags.includes("endgame-technique");
        if (pawnRace) {
            patterns.push({ name: "promotion-trap", confidence: 0.7 });
        }
    }

    return patterns;
};

/* ══════════════════════════════════════════════════════════
   POSITIONAL SCAN — pre-conditions that make traps viable
   ══════════════════════════════════════════════════════════ */
interface PositionalScanResult {
    overloadedPieces: number;
    trappedPieces: number;
    batteries: number;
    hasPromotionThreat: boolean;
    preconditionScore: number;
}

const positionalScan = (
    context: SharedBehaviorContext,
): PositionalScanResult => {
    const opponentColor = context.aiColor === "white" ? "black" : "white";
    const overloadedPieces = countOverloadedDefenders(
        context.fen,
        opponentColor,
    );
    const trappedPieces = countTrappedPieces(context.fen, opponentColor);
    const batteries = detectBatteryFormations(context.fen, context.aiColor);
    const hasPromotionThreat =
        context.activeThemes.includes("passed-pawn") &&
        context.phase !== "opening";
    const preconditionScore =
        overloadedPieces * 2 +
        trappedPieces * 1.5 +
        batteries +
        (hasPromotionThreat ? 1 : 0);

    return {
        overloadedPieces,
        trappedPieces,
        batteries,
        hasPromotionThreat,
        preconditionScore,
    };
};

/* ══════════════════════════════════════════════════════════
   TRAP GENERATOR ENGINE
   ══════════════════════════════════════════════════════════ */
export class TrapGenerator {
    private readonly scan: PositionalScanResult;
    private readonly gambitMultiplier: number;
    private readonly conservativeMode: boolean;

    constructor(
        private readonly context: SharedBehaviorContext,
        private readonly evaluateFen: (
            fen: string,
            depth: number,
        ) => Promise<number>,
    ) {
        this.scan = positionalScan(context);

        /* Gambit handoff context reading */
        const gambit = context.engineState.gambit;
        if (gambit.status === "accepted") {
            /* Material deficit — prioritize traps along open lines toward exposed king */
            this.gambitMultiplier = 1.3;
        } else if (gambit.status === "declined") {
            /* Opponent chose safety — exploit passive placement */
            this.gambitMultiplier = 1.1;
        } else {
            this.gambitMultiplier = 1.0;
        }

        /* Deteriorating evaluation → conservative mode */
        const evals = context.engineState.recentEvaluations;
        const recent3 = evals.slice(-3);
        const declining =
            recent3.length >= 2 &&
            recent3.every((v, i) => i === 0 || v < (recent3[i - 1] ?? v));
        this.conservativeMode =
            declining || context.engineState.behaviorSuccessScore < -3;
    }

    /* ── Rank opponent responses by human-intuitive order ── */
    private rankOpponentResponses(fen: string): string[] {
        const chess = new Chess(fen);
        return chess
            .moves({ verbose: true })
            .sort((left, right) => {
                const scoreLeft =
                    (left.captured ? 4 : 0) +
                    (left.san.includes("+") ? 3 : 0) +
                    (left.promotion ? 2 : 0) +
                    (["c3", "c4", "d4", "d5", "e4", "e5", "f3", "f6"].includes(
                        left.to,
                    )
                        ? 1
                        : 0);
                const scoreRight =
                    (right.captured ? 4 : 0) +
                    (right.san.includes("+") ? 3 : 0) +
                    (right.promotion ? 2 : 0) +
                    (["c3", "c4", "d4", "d5", "e4", "e5", "f3", "f6"].includes(
                        right.to,
                    )
                        ? 1
                        : 0);
                return scoreRight - scoreLeft;
            })
            .slice(0, this.conservativeMode ? 3 : 5)
            .map((move) => `${move.from}${move.to}${move.promotion ?? ""}`);
    }

    /* ── Legacy precondition patterns (theme-based) ─────── */
    private preconditionPatterns(candidate: FilteredCandidate): string[] {
        const patterns: string[] = [];
        if (
            this.context.activeThemes.includes("open-file-toward-king") ||
            candidate.phaseTags.includes("king-attack")
        ) {
            patterns.push("back-rank-pressure");
        }
        if (
            this.context.activeThemes.includes("knight-outpost") ||
            candidate.phaseTags.includes("restriction")
        ) {
            patterns.push("piece-trap");
        }
        if (this.context.activeThemes.includes("open-diagonal-toward-king")) {
            patterns.push("discovery-setup");
        }
        if (candidate.phaseTags.includes("center")) {
            patterns.push("zwischenzug-net");
        }
        return patterns;
    }

    /* ══════════════════════════════════════════════════════
     MAIN ANALYSIS — called per candidate move
     ══════════════════════════════════════════════════════ */
    async analyzeCandidate(
        candidate: FilteredCandidate,
    ): Promise<TrapAnalysis> {
        /* ── Active sequence continuation ────────────────── */
        const activeSequence = this.context.engineState.trapSequence;
        if (
            activeSequence.active &&
            activeSequence.remainingMoves[0] === candidate.move
        ) {
            const grade = activeSequence.grade ?? "basic";
            return {
                score: SCORE_BY_GRADE[grade],
                grade,
                sequence: buildSequence(
                    activeSequence.remainingMoves.length > 1
                        ? "continuing"
                        : "sprung",
                    activeSequence.pattern ?? "trap-continuation",
                    grade,
                    activeSequence.remainingMoves.slice(1),
                    Math.max(0, activeSequence.remainingPlies - 1),
                    activeSequence.triggerMove,
                ),
                strategy: "trap-sequence-continuation",
            };
        }

        /* ── Apply candidate move and simulate responses ─── */
        const candidatePosition = applyMoveToFen(
            this.context.fen,
            candidate.move,
        ).fen();
        const replies = this.rankOpponentResponses(candidatePosition);
        const evaluationDepth = candidate.phaseTags.includes("king-attack")
            ? 8
            : 6;

        /* Conservative mode reduces bonuses by 50% */
        const behaviorMultiplier = this.conservativeMode ? 0.5 : 1;
        /* Precondition scan boosts trap confidence */
        const preconditionBonus = Math.min(
            1.3,
            1 + this.scan.preconditionScore * 0.05,
        );

        let strongReplies = 0;
        let basicReplies = 0;
        let bestSwing = Number.NEGATIVE_INFINITY;
        let triggerMove: string | undefined;

        /* Simulate opponent's most natural responses */
        for (const reply of replies) {
            const replyPosition = applyMoveToFen(
                candidatePosition,
                reply,
            ).fen();
            const evalAfterReply = await this.evaluateFen(
                replyPosition,
                evaluationDepth,
            );
            const swing = evalAfterReply - candidate.eval;
            if (swing > bestSwing) {
                bestSwing = swing;
                triggerMove = reply;
            }

            /* Mating trap — instant return */
            if (evalAfterReply >= 99) {
                const matingScore = Number(
                    (
                        SCORE_BY_GRADE.mating *
                        behaviorMultiplier *
                        this.gambitMultiplier
                    ).toFixed(2),
                );
                return {
                    score: matingScore,
                    grade: "mating",
                    sequence: buildSequence(
                        "sprung",
                        "mating-net",
                        "mating",
                        [],
                        0,
                        triggerMove,
                    ),
                    strategy: "mating-trap",
                };
            }
            if (swing >= 5) {
                strongReplies += 1;
            }
            if (swing >= 3) {
                basicReplies += 1;
            }

            /* Early exit: already enough evidence for strong trap grading */
            if (strongReplies >= 2) {
                break;
            }
        }

        /* ── Detect named trap patterns in resulting position ─ */
        const namedPatterns = detectNamedPatterns(
            this.context,
            candidatePosition,
            candidate,
        );
        const legacyPatterns = this.preconditionPatterns(candidate);
        const bestPattern = namedPatterns[0]?.name ?? legacyPatterns[0] ?? null;
        const patternConfidence = namedPatterns[0]?.confidence ?? 0;

        /* ── Grading: strong trap ─────────────────────────── */
        if (
            strongReplies >= 2 ||
            (strongReplies >= 1 && patternConfidence >= 0.7) ||
            bestSwing >= 5
        ) {
            const movesNeeded = 1;
            const score = Number(
                (
                    SCORE_BY_GRADE.strong *
                    behaviorMultiplier *
                    this.gambitMultiplier *
                    preconditionBonus *
                    depthReliability(movesNeeded)
                ).toFixed(2),
            );
            return {
                score,
                grade: "strong",
                sequence: buildSequence(
                    "armed",
                    bestPattern ?? "strong-trap",
                    "strong",
                    [candidate.move],
                    1,
                    triggerMove,
                ),
                strategy: namedPatterns[0]?.name ?? "strong-trap",
            };
        }

        /* ── Grading: basic trap ──────────────────────────── */
        if (
            basicReplies >= 1 ||
            (patternConfidence >= 0.5 && bestSwing >= 2.2) ||
            (legacyPatterns.length > 0 && bestSwing >= 2.2)
        ) {
            const movesNeeded = 1;
            const score = Number(
                (
                    SCORE_BY_GRADE.basic *
                    behaviorMultiplier *
                    this.gambitMultiplier *
                    preconditionBonus *
                    depthReliability(movesNeeded)
                ).toFixed(2),
            );
            return {
                score,
                grade: "basic",
                sequence: buildSequence(
                    "armed",
                    bestPattern ?? "basic-trap",
                    "basic",
                    [candidate.move],
                    1,
                    triggerMove,
                ),
                strategy:
                    namedPatterns[0]?.name ?? legacyPatterns[0] ?? "basic-trap",
            };
        }

        /* ── Multi-move trap attempt ──────────────────────── */
        if (
            namedPatterns.length >= 2 &&
            bestSwing >= 1.5 &&
            !this.conservativeMode &&
            this.scan.preconditionScore >= 2
        ) {
            const score = Number(
                (
                    SCORE_BY_GRADE.basic *
                    0.6 *
                    this.gambitMultiplier *
                    depthReliability(3)
                ).toFixed(2),
            );
            return {
                score,
                grade: "basic",
                sequence: buildSequence(
                    "armed",
                    namedPatterns[0]!.name,
                    "basic",
                    [candidate.move],
                    2,
                    triggerMove,
                ),
                strategy: `multi-move-${namedPatterns[0]!.name}`,
            };
        }

        /* ── Cancel active sequence if trap didn't fire ───── */
        if (activeSequence.active) {
            return {
                score: 0,
                grade: null,
                sequence: {
                    ...activeSequence,
                    active: false,
                    status: "cancelled",
                    remainingMoves: [],
                    remainingPlies: 0,
                },
                strategy: "trap-sequence-cancelled",
            };
        }

        /* ── No trap detected ─────────────────────────────── */
        return {
            score: 0,
            grade: null,
            sequence: null,
            strategy: "no-trap",
        };
    }
}
