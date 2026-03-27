import type { SacrificeTrackingState, SacrificeType } from "../../contracts.js";
import type { FilteredCandidate, SharedBehaviorContext } from "../../types.js";
import {
    attackedKingZoneCount,
    applyMoveToFen,
    compensationSignals,
    countDefendersAroundKing,
    detectBatteryFormations,
    getKingSquare,
    materialOfferValue,
} from "./helpers.js";
import { Chess } from "chess.js";

export interface SacrificeAnalysis {
    score: number;
    type: SacrificeType;
    materialOffered: number;
    targetEvaluation: number | null;
    tracking: SacrificeTrackingState | null;
    strategy: string;
}

/* ── Sacrifice tracking record ──────────────────────────── */
const createTracking = (
    type: SacrificeType,
    materialOffered: number,
    referenceEvaluation: number,
    targetEvaluation: number,
    moveNumber: number,
): SacrificeTrackingState => ({
    active: true,
    type,
    materialOffered,
    referenceEvaluation,
    targetEvaluation,
    status: "pending",
    startedAtMoveNumber: moveNumber,
    lastUpdatedMoveNumber: moveNumber,
});

/* ── Named sacrifice pattern detection ──────────────────── */
interface SacrificePatternMatch {
    name: string;
    confidence: number;
}

const detectGreekGift = (
    fen: string,
    move: string,
    aiColor: PlayerColor,
): SacrificePatternMatch | null => {
    const chess = new Chess(fen);
    const target = aiColor === "white" ? "w" : "b";
    const opponentColor = aiColor === "white" ? "black" : "white";

    /* Greek Gift: Bxh7+ or Bxh2+ */
    const destination = move.slice(2, 4);
    const sacrificeSquare = aiColor === "white" ? "h7" : "h2";
    if (destination !== sacrificeSquare) return null;

    const source = move.slice(0, 2);
    const piece = chess.get(source as Parameters<Chess["get"]>[0]);
    if (!piece || piece.type !== "b" || piece.color !== target) return null;

    /* Check for supporting knight on f3/f6 */
    const knightSquare = aiColor === "white" ? "f3" : "f6";
    const knight = chess.get(knightSquare as Parameters<Chess["get"]>[0]);
    const hasKnight = knight?.type === "n" && knight?.color === target;

    /* Check opponent king is castled kingside */
    const opponentKing = getKingSquare(chess, opponentColor);
    const isCastled =
        opponentKing === (opponentColor === "white" ? "g1" : "g8");

    if (hasKnight && isCastled) {
        return { name: "greek-gift", confidence: 0.9 };
    }
    if (hasKnight || isCastled) {
        return { name: "greek-gift", confidence: 0.6 };
    }
    return null;
};

const detectExchangeSacrifice = (
    fen: string,
    move: string,
    aiColor: PlayerColor,
): SacrificePatternMatch | null => {
    const chess = new Chess(fen);
    const target = aiColor === "white" ? "w" : "b";
    const source = move.slice(0, 2);
    const dest = move.slice(2, 4);
    const piece = chess.get(source as Parameters<Chess["get"]>[0]);
    const captured = chess.get(dest as Parameters<Chess["get"]>[0]);

    if (!piece || piece.type !== "r" || piece.color !== target) return null;
    if (!captured || !["n", "b"].includes(captured.type)) return null;

    return { name: "exchange-sacrifice", confidence: 0.7 };
};

const detectPawnStormSacrifice = (
    fen: string,
    move: string,
    aiColor: PlayerColor,
): SacrificePatternMatch | null => {
    const chess = new Chess(fen);
    const target = aiColor === "white" ? "w" : "b";
    const source = move.slice(0, 2);
    const piece = chess.get(source as Parameters<Chess["get"]>[0]);

    if (!piece || piece.type !== "p" || piece.color !== target) return null;

    /* Only relevant if advancing toward opponent's castled king side */
    const destFile = move[2]!;
    const kingside = ["f", "g", "h"].includes(destFile);
    const queenside = ["a", "b", "c"].includes(destFile);
    if (!kingside && !queenside) return null;

    const opponentColor = aiColor === "white" ? "black" : "white";
    const opponentKing = getKingSquare(chess, opponentColor);
    const kingFile = opponentKing[0]!;
    const isKingsideKing = ["f", "g", "h"].includes(kingFile);

    if ((kingside && isKingsideKing) || (queenside && !isKingsideKing)) {
        return { name: "pawn-storm-sacrifice", confidence: 0.6 };
    }
    return null;
};

const detectQueenSacrifice = (
    fen: string,
    move: string,
    aiColor: PlayerColor,
): SacrificePatternMatch | null => {
    const chess = new Chess(fen);
    const target = aiColor === "white" ? "w" : "b";
    const source = move.slice(0, 2);
    const piece = chess.get(source as Parameters<Chess["get"]>[0]);

    if (!piece || piece.type !== "q" || piece.color !== target) return null;

    return { name: "queen-sacrifice", confidence: 0.8 };
};

type PlayerColor = "white" | "black";

const detectSacrificePatterns = (
    fen: string,
    move: string,
    aiColor: PlayerColor,
): SacrificePatternMatch[] => {
    const matches: SacrificePatternMatch[] = [];
    const greekGift = detectGreekGift(fen, move, aiColor);
    if (greekGift) matches.push(greekGift);
    const exchange = detectExchangeSacrifice(fen, move, aiColor);
    if (exchange) matches.push(exchange);
    const pawnStorm = detectPawnStormSacrifice(fen, move, aiColor);
    if (pawnStorm) matches.push(pawnStorm);
    const queenSac = detectQueenSacrifice(fen, move, aiColor);
    if (queenSac) matches.push(queenSac);
    return matches;
};

/* ══════════════════════════════════════════════════════════
   SACRIFICE ENGINE
   ══════════════════════════════════════════════════════════ */
export class SacrificeDetector {
    analyzeCandidate(
        context: SharedBehaviorContext,
        candidate: FilteredCandidate,
    ): SacrificeAnalysis {
        /* ── Cooldown check ───────────────────────────────── */
        if (context.engineState.sacrificeCooldownMoves > 0) {
            return {
                score: 0,
                type: "none",
                materialOffered: 0,
                targetEvaluation: null,
                tracking: null,
                strategy: "cooldown",
            };
        }

        /* ── Material offer detection ─────────────────────── */
        const materialOffered = materialOfferValue(
            context.fen,
            candidate.move,
            context.aiColor,
        );
        if (materialOffered < 1) {
            return {
                score: 0,
                type: "none",
                materialOffered,
                targetEvaluation: null,
                tracking: null,
                strategy: "no-sacrifice",
            };
        }

        /* ── Deep context reading ─────────────────────────── */
        const after = applyMoveToFen(context.fen, candidate.move);
        const kingPressure = attackedKingZoneCount(
            after.fen(),
            context.aiColor,
        );
        const compensation = compensationSignals(
            context.fen,
            candidate.move,
            context.aiColor,
        );
        const phasePressureBonus = context.phase === "middlegame" ? 1 : 0;
        const acceptedGambit = context.engineState.gambit.status === "accepted";
        const opponentColor = context.aiColor === "white" ? "black" : "white";

        /* Double-sacrifice prevention: if gambit already accepted (material-down),
       do NOT sacrifice unless overwhelming force justifies it */
        if (acceptedGambit && candidate.eval < 5 && kingPressure < 5) {
            return {
                score: 0,
                type: "none",
                materialOffered,
                targetEvaluation: null,
                tracking: null,
                strategy: "gambit-accepted-conservative",
            };
        }

        /* Eval trend check: declining over last 3 evals → suppress non-mating sacrifices */
        const evals = context.engineState.recentEvaluations;
        const recent3 = evals.slice(-3);
        const evalDeclining =
            recent3.length >= 2 &&
            recent3.every((v, i) => i === 0 || v < (recent3[i - 1] ?? v));

        /* Behavior tracker suppression */
        const behaviorMultiplier =
            context.engineState.behaviorSuccessScore < -2 ? 0.5 : 1;

        /* Active theme amplification: sacrifice reinforcing existing theme gets bonus */
        const themeBonus =
            (context.activeThemes.includes("open-file-toward-king") &&
            candidate.phaseTags.includes("king-attack")
                ? 10
                : 0) + (context.activeThemes.includes("exposed-king") ? 5 : 0);

        /* ── Named sacrifice pattern detection ────────────── */
        const patterns = detectSacrificePatterns(
            context.fen,
            candidate.move,
            context.aiColor,
        );
        const patternBonus = patterns.length > 0 ? 10 : 0;
        const bestPattern = patterns[0]?.name;

        /* ── Piece activity value adjustment ──────────────── */
        const defenderCount = countDefendersAroundKing(
            after.fen(),
            opponentColor,
        );

        /* ── Structural benefits calculation ──────────────── */
        const structuralBenefits =
            Number(compensation) +
            Number(kingPressure >= 2) +
            Number(context.activeThemes.includes("passed-pawn")) +
            Number(context.activeThemes.includes("knight-outpost")) +
            Number(detectBatteryFormations(after.fen(), context.aiColor) >= 1) +
            phasePressureBonus;

        /* ── CLASS 3: Mating Sacrifice (80 bonus) ─────────── */
        if (candidate.eval > 5 || kingPressure >= 6) {
            const score = Number(
                ((80 + themeBonus + patternBonus) * behaviorMultiplier).toFixed(
                    2,
                ),
            );
            return {
                score,
                type: "mating",
                materialOffered,
                targetEvaluation: Math.max(5, candidate.eval),
                tracking: createTracking(
                    "mating",
                    materialOffered,
                    candidate.eval,
                    Math.max(5, candidate.eval),
                    context.moveNumber,
                ),
                strategy: bestPattern ?? "mating-sacrifice",
            };
        }

        /* Suppress non-mating sacrifices on declining eval trend */
        if (evalDeclining && candidate.eval < 1) {
            return {
                score: 0,
                type: "none",
                materialOffered,
                targetEvaluation: null,
                tracking: null,
                strategy: "eval-declining-suppressed",
            };
        }

        /* ── CLASS 2: Dynamic Sacrifice (50 bonus) ────────── */
        if (
            candidate.eval >= -0.5 &&
            (kingPressure >= 3 ||
                compensation ||
                (defenderCount <= 2 && kingPressure >= 2))
        ) {
            const score = Number(
                ((50 + themeBonus + patternBonus) * behaviorMultiplier).toFixed(
                    2,
                ),
            );
            return {
                score,
                type: "dynamic",
                materialOffered,
                targetEvaluation: Math.max(candidate.eval, 0.5),
                tracking: createTracking(
                    "dynamic",
                    materialOffered,
                    candidate.eval,
                    Math.max(candidate.eval, 0.5),
                    context.moveNumber,
                ),
                strategy: bestPattern ?? "dynamic-sacrifice",
            };
        }

        /* ── CLASS 1: Positional Sacrifice (30 bonus) ─────── */
        if (candidate.eval >= -1 && structuralBenefits >= 2) {
            const score = Number(
                ((30 + themeBonus + patternBonus) * behaviorMultiplier).toFixed(
                    2,
                ),
            );
            return {
                score,
                type: "positional",
                materialOffered,
                targetEvaluation: Math.max(candidate.eval, 0),
                tracking: createTracking(
                    "positional",
                    materialOffered,
                    candidate.eval,
                    Math.max(candidate.eval, 0),
                    context.moveNumber,
                ),
                strategy: bestPattern ?? "positional-sacrifice",
            };
        }

        /* ── Unsafe sacrifice — no bonus ──────────────────── */
        return {
            score: 0,
            type: "none",
            materialOffered,
            targetEvaluation: null,
            tracking: null,
            strategy: "unsafe-sacrifice",
        };
    }
}
