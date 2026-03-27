import type {
    Difficulty,
    EngineState,
    GamePhase,
    PlayerColor,
    TacticalTheme,
} from "../../contracts.js";
import { Chess } from "chess.js";
import type {
    CandidatePhaseTag,
    FilteredCandidate,
    SharedBoardAnalysis,
    SharedBehaviorContext,
    StockfishTruthLayer,
} from "../../types.js";
import type { CandidateMove, MoveHistoryEntry } from "../../contracts.js";
import type { Logger } from "pino";
import { totalMaterial, uciToMoveShape } from "../../utils/chess.js";
import {
    attackedKingZoneCount,
    countOverloadedDefenders,
    detectBatteryFormations,
    getKingSquare,
    legalMovesForColor,
} from "./helpers.js";

const DEFAULT_EVAL_WINDOW = 1.5;
const DEFAULT_ABSOLUTE_FLOOR = -1.5;
const ACCEPTED_GAMBIT_FLOOR = -1.8;
const CENTER_SQUARES = new Set(["d4", "d5", "e4", "e5"]);
const WHITE_DEVELOPMENT_SQUARES = new Set([
    "c3",
    "f3",
    "c4",
    "f4",
    "b5",
    "g5",
    "d3",
    "e2",
]);
const BLACK_DEVELOPMENT_SQUARES = new Set([
    "c6",
    "f6",
    "c5",
    "f5",
    "b4",
    "g4",
    "d6",
    "e7",
]);

const sortByEval = (left: CandidateMove, right: CandidateMove): number => {
    if (right.eval !== left.eval) {
        return right.eval - left.eval;
    }

    if (left.multipv !== right.multipv) {
        return left.multipv - right.multipv;
    }

    return left.move.localeCompare(right.move);
};

const safeApplyMove = (fen: string, move: string): Chess | null => {
    const chess = new Chess(fen);
    const payload = uciToMoveShape(move);
    if (!payload) {
        return null;
    }

    try {
        const applied = chess.move(payload);
        return applied ? chess : null;
    } catch {
        return null;
    }
};

const isOpenFileTowardKing = (chess: Chess, kingSquare: string): boolean => {
    const file = kingSquare[0];
    if (!file) {
        return false;
    }

    const fileIndex = file.charCodeAt(0) - 97;
    let pawnsOnFile = 0;
    for (const row of chess.board()) {
        const piece = row[fileIndex];
        if (piece?.type === "p") {
            pawnsOnFile += 1;
        }
    }

    return pawnsOnFile <= 1;
};

const hasOpenDiagonalTowardKing = (
    chess: Chess,
    aiColor: PlayerColor,
    kingSquare: string,
): boolean => {
    const attackerColor = aiColor === "white" ? "w" : "b";
    for (const row of chess.board()) {
        for (const piece of row) {
            if (
                !piece ||
                piece.color !== attackerColor ||
                !["b", "q"].includes(piece.type)
            ) {
                continue;
            }

            const fileDelta = Math.abs(
                piece.square.charCodeAt(0) - kingSquare.charCodeAt(0) || 0,
            );
            const rankDelta = Math.abs(
                Number(piece.square[1]) - Number(kingSquare[1]),
            );
            if (fileDelta === rankDelta && fileDelta > 0) {
                return true;
            }
        }
    }

    return false;
};

const countDevelopedPieces = (chess: Chess, color: PlayerColor): number => {
    const target = color === "white" ? "w" : "b";
    let developed = 0;
    for (const row of chess.board()) {
        for (const piece of row) {
            if (
                !piece ||
                piece.color !== target ||
                !["n", "b", "q"].includes(piece.type)
            ) {
                continue;
            }

            if (
                (target === "w" &&
                    WHITE_DEVELOPMENT_SQUARES.has(piece.square)) ||
                (target === "b" && BLACK_DEVELOPMENT_SQUARES.has(piece.square))
            ) {
                developed += 1;
            }
        }
    }
    return developed;
};

const hasRookOnSeventh = (chess: Chess, color: PlayerColor): boolean => {
    const target = color === "white" ? "w" : "b";
    const targetRank = color === "white" ? "7" : "2";
    return chess
        .board()
        .some((row) =>
            row.some(
                (piece) =>
                    piece?.type === "r" &&
                    piece.color === target &&
                    piece.square[1] === targetRank,
            ),
        );
};

const hasBishopPair = (chess: Chess, color: PlayerColor): boolean => {
    const target = color === "white" ? "w" : "b";
    let bishops = 0;
    let pawns = 0;
    for (const row of chess.board()) {
        for (const piece of row) {
            if (!piece) {
                continue;
            }
            if (piece.color === target && piece.type === "b") {
                bishops += 1;
            }
            if (piece.type === "p") {
                pawns += 1;
            }
        }
    }
    return bishops >= 2 && pawns <= 12;
};

const hasKnightOutpost = (chess: Chess, color: PlayerColor): boolean => {
    const target = color === "white" ? "w" : "b";
    const validRanks =
        color === "white" ? new Set(["5", "6"]) : new Set(["3", "4"]);
    return chess
        .board()
        .some((row) =>
            row.some(
                (piece) =>
                    piece?.type === "n" &&
                    piece.color === target &&
                    validRanks.has(piece.square[1] ?? ""),
            ),
        );
};

const hasPassedPawn = (chess: Chess, color: PlayerColor): boolean => {
    const target = color === "white" ? "w" : "b";
    const enemy = color === "white" ? "b" : "w";
    const enemyPawns = new Map<number, number[]>();

    for (const row of chess.board()) {
        for (const piece of row) {
            if (piece?.type !== "p" || piece.color !== enemy) {
                continue;
            }
            const file = piece.square.charCodeAt(0) - 97;
            const rank = Number(piece.square[1]);
            const bucket = enemyPawns.get(file) ?? [];
            bucket.push(rank);
            enemyPawns.set(file, bucket);
        }
    }

    for (const row of chess.board()) {
        for (const piece of row) {
            if (piece?.type !== "p" || piece.color !== target) {
                continue;
            }
            const file = piece.square.charCodeAt(0) - 97;
            const rank = Number(piece.square[1]);
            let blocked = false;
            for (const fileOffset of [-1, 0, 1]) {
                const enemyFile = file + fileOffset;
                const enemyRanks = enemyPawns.get(enemyFile) ?? [];
                if (
                    enemyRanks.some((enemyRank) =>
                        color === "white" ? enemyRank > rank : enemyRank < rank,
                    )
                ) {
                    blocked = true;
                    break;
                }
            }
            if (!blocked) {
                return true;
            }
        }
    }

    return false;
};

const lacksLuft = (chess: Chess, color: PlayerColor): boolean => {
    const kingSquare = getKingSquare(chess, color);
    const rank = kingSquare[1];
    if (rank !== (color === "white" ? "1" : "8")) {
        return false;
    }

    const forwardRank = color === "white" ? "2" : "7";
    const fileCode = kingSquare.charCodeAt(0);
    const targetColor = color === "white" ? "w" : "b";
    let supportingPawns = 0;

    for (const delta of [-1, 0, 1]) {
        const square = `${String.fromCharCode(fileCode + delta)}${forwardRank}`;
        const piece = chess.get(square as Parameters<Chess["get"]>[0]);
        if (piece?.type === "p" && piece.color === targetColor) {
            supportingPawns += 1;
        }
    }

    return supportingPawns >= 2;
};

const hasCentralSpaceAdvantage = (
    chess: Chess,
    color: PlayerColor,
): boolean => {
    const target = color === "white" ? "w" : "b";
    let ownControl = 0;
    let enemyControl = 0;

    const moves = chess.moves({ verbose: true });
    for (const move of moves) {
        if (!CENTER_SQUARES.has(move.to)) {
            continue;
        }
        if (move.color === target) {
            ownControl += 1;
        } else {
            enemyControl += 1;
        }
    }

    return ownControl > enemyControl;
};

const countUniqueCaptureTargets = (
    moves: ReturnType<Chess["moves"]>,
): number => new Set(moves.filter((move) => move.captured).map((move) => move.to))
    .size;

const buildKingZone = (kingSquare: string): Set<string> => {
    const zone = new Set<string>();
    const file = kingSquare[0];
    const rank = kingSquare[1];
    if (!file || !rank) {
        return zone;
    }

    for (let df = -2; df <= 2; df += 1) {
        for (let dr = -2; dr <= 2; dr += 1) {
            const nextFile = String.fromCharCode(file.charCodeAt(0) + df);
            const nextRank = Number(rank) + dr;
            if (
                nextFile >= "a" &&
                nextFile <= "h" &&
                nextRank >= 1 &&
                nextRank <= 8
            ) {
                zone.add(`${nextFile}${nextRank}`);
            }
        }
    }

    return zone;
};

const countMovesIntoZone = (
    moves: ReturnType<Chess["moves"]>,
    zone: Set<string>,
): number => moves.filter((move) => zone.has(move.to)).length;

const countDefendersAroundKingOnBoard = (
    chess: Chess,
    kingColor: PlayerColor,
): number => {
    const kingSquare = getKingSquare(chess, kingColor);
    const colorCode = kingColor === "white" ? "w" : "b";
    const file = kingSquare[0];
    const rank = kingSquare[1];
    if (!file || !rank) {
        return 0;
    }

    let count = 0;
    for (let df = -2; df <= 2; df += 1) {
        for (let dr = -2; dr <= 2; dr += 1) {
            if (df === 0 && dr === 0) {
                continue;
            }

            const nextFile = String.fromCharCode(file.charCodeAt(0) + df);
            const nextRank = Number(rank) + dr;
            if (
                nextFile < "a" ||
                nextFile > "h" ||
                nextRank < 1 ||
                nextRank > 8
            ) {
                continue;
            }

            const square = `${nextFile}${nextRank}` as Parameters<
                Chess["get"]
            >[0];
            const piece = chess.get(square);
            if (piece && piece.color === colorCode && piece.type !== "k") {
                count += 1;
            }
        }
    }

    return count;
};

const buildBoardAnalysis = (
    chess: Chess,
    fen: string,
    aiColor: PlayerColor,
): SharedBoardAnalysis => {
    const opponentColor = aiColor === "white" ? "black" : "white";
    const aiMovesBefore = chess.moves({ verbose: true });
    const opponentMovesBefore = legalMovesForColor(fen, opponentColor);
    const opponentKingSquare = getKingSquare(chess, opponentColor);
    const opponentKingZone = buildKingZone(opponentKingSquare);

    return {
        opponentColor,
        opponentKingSquare,
        opponentKingZone,
        aiCaptureTargetCountBefore: countUniqueCaptureTargets(aiMovesBefore),
        opponentMobilityBefore: opponentMovesBefore.length,
        opponentKingPressureBefore: countMovesIntoZone(
            aiMovesBefore,
            opponentKingZone,
        ),
        opponentKingDefendersBefore: countDefendersAroundKingOnBoard(
            chess,
            opponentColor,
        ),
        defendedSquaresByOpponent: new Set(
            opponentMovesBefore.map((move) => move.to),
        ),
    };
};

const detectActiveThemes = (
    chess: Chess,
    aiColor: PlayerColor,
    phase: GamePhase,
): TacticalTheme[] => {
    const opponentColor = aiColor === "white" ? "black" : "white";
    const opponentKingSquare = getKingSquare(chess, opponentColor);
    const themes = new Set<TacticalTheme>();

    if (isOpenFileTowardKing(chess, opponentKingSquare)) {
        themes.add("open-file-toward-king");
    }

    if (hasOpenDiagonalTowardKing(chess, aiColor, opponentKingSquare)) {
        themes.add("open-diagonal-toward-king");
    }

    if (hasRookOnSeventh(chess, aiColor)) {
        themes.add("rook-on-seventh");
    }

    if (hasBishopPair(chess, aiColor)) {
        themes.add("bishop-pair-open-board");
    }

    if (hasKnightOutpost(chess, aiColor)) {
        themes.add("knight-outpost");
    }

    if (hasPassedPawn(chess, aiColor)) {
        themes.add("passed-pawn");
    }

    if (lacksLuft(chess, opponentColor)) {
        themes.add("opponent-king-lacking-luft");
    }

    if (hasCentralSpaceAdvantage(chess, aiColor)) {
        themes.add("central-space-advantage");
    }

    if (
        phase === "opening" &&
        countDevelopedPieces(chess, aiColor) >=
            countDevelopedPieces(chess, opponentColor) + 1
    ) {
        themes.add("development-lead");
    }

    if (attackedKingZoneCount(chess.fen(), aiColor) >= 3) {
        themes.add("exposed-king");
    }

    const overloaded = countOverloadedDefenders(chess.fen(), opponentColor);
    if (overloaded > 0) {
        themes.add("opponent-king-lacking-luft");
    }

    const batteries = detectBatteryFormations(chess.fen(), aiColor);
    if (batteries > 0) {
        themes.add("open-diagonal-toward-king");
    }

    return [...themes];
};

const detectPhaseTags = (
    fen: string,
    candidate: CandidateMove,
    phase: GamePhase,
    aiColor: PlayerColor,
): CandidatePhaseTag[] => {
    const chessBefore = new Chess(fen);
    const chessAfter = safeApplyMove(fen, candidate.move);
    if (!chessAfter) {
        return [];
    }

    const payload = uciToMoveShape(candidate.move);
    if (!payload) {
        return [];
    }

    let applied;
    try {
        applied = chessBefore.move(payload);
    } catch {
        return [];
    }

    if (!applied) {
        return [];
    }

    const tags = new Set<CandidatePhaseTag>();
    if (phase === "opening") {
        tags.add("opening-principle");
    }

    if (
        ["n", "b", "q"].includes(applied.piece) &&
        ((aiColor === "white" && WHITE_DEVELOPMENT_SQUARES.has(applied.to)) ||
            (aiColor === "black" && BLACK_DEVELOPMENT_SQUARES.has(applied.to)))
    ) {
        tags.add("development");
    }

    if (CENTER_SQUARES.has(applied.to)) {
        tags.add("center");
    }

    if (
        chessBefore.isCheck() ||
        chessAfter.inCheck() ||
        attackedKingZoneCount(chessAfter.fen(), aiColor) >
            attackedKingZoneCount(fen, aiColor)
    ) {
        tags.add("king-attack");
    }

    if (applied.captured && ["q", "r", "b", "n"].includes(applied.captured)) {
        tags.add("simplification");
    }

    if (
        phase === "endgame" &&
        (applied.piece === "k" || applied.piece === "p")
    ) {
        tags.add("endgame-technique");
    }

    if (applied.piece === "p") {
        const rank = Number(applied.to[1]);
        if (
            (aiColor === "white" && rank >= 5) ||
            (aiColor === "black" && rank <= 4)
        ) {
            tags.add("pawn-race");
        }
    }

    if (
        chessAfter.moves().length <=
        Math.max(6, Math.floor(chessBefore.moves().length * 0.75))
    ) {
        tags.add("restriction");
    }

    return [...tags];
};

const computeComplexityDial = (
    engineState: EngineState,
    phase: GamePhase,
    topEval: number,
): number => {
    let dial = 5;

    if (engineState.gambit.status === "accepted") {
        dial += 1;
    }
    if (engineState.behaviorSuccessScore > 0) {
        dial += 1;
    }
    if (topEval > 1) {
        dial += 1;
    }
    if (
        engineState.trapSequence.active &&
        ["armed", "continuing"].includes(engineState.trapSequence.status)
    ) {
        dial += 1;
    }
    if (
        ["pressured", "crumbling"].includes(engineState.opponentPressure.level)
    ) {
        dial += 1;
    }

    if (engineState.sacrificeTracking.status === "failed") {
        dial -= 1;
    }
    if (engineState.behaviorSuccessScore < -2) {
        dial -= 1;
    }
    if (topEval < -1) {
        dial -= 1;
    }
    if (phase === "endgame") {
        dial -= 1;
    }
    if (engineState.opponentPressure.consecutiveSolidMoves >= 3) {
        dial -= 1;
    }

    return Math.max(0, Math.min(10, dial));
};

const buildStockfishTruth = (
    legalCandidates: CandidateMove[],
    engineState: EngineState,
): StockfishTruthLayer => {
    const top = legalCandidates[0] ?? null;
    if (!top) {
        return {
            topMove: "",
            topEval: 0,
            evaluationWindow: DEFAULT_EVAL_WINDOW,
            absoluteFloor: DEFAULT_ABSOLUTE_FLOOR,
            lockedToStockfish: true,
        };
    }

    const absoluteFloor =
        engineState.gambit.status === "accepted"
            ? ACCEPTED_GAMBIT_FLOOR
            : DEFAULT_ABSOLUTE_FLOOR;
    const lockedToStockfish =
        engineState.currentRecoveryMode === "pure-stockfish" ||
        engineState.behaviorSuccessScore <= -5 ||
        top.eval < absoluteFloor;

    return {
        topMove: top.move,
        topEval: top.eval,
        evaluationWindow: DEFAULT_EVAL_WINDOW,
        absoluteFloor,
        lockedToStockfish,
    };
};

const filterCandidates = (
    fen: string,
    phase: GamePhase,
    aiColor: PlayerColor,
    candidates: CandidateMove[],
    stockfishTruth: StockfishTruthLayer,
): FilteredCandidate[] => {
    const legal = [...candidates]
        .sort(sortByEval)
        .filter((candidate) => Boolean(safeApplyMove(fen, candidate.move)));

    const top = legal[0] ?? null;
    if (!top) {
        return [];
    }

    const decorate = (candidate: CandidateMove): FilteredCandidate => ({
        ...candidate,
        phaseTags: detectPhaseTags(fen, candidate, phase, aiColor),
        stockfishGap: Number(
            (stockfishTruth.topEval - candidate.eval).toFixed(2),
        ),
        legal: true,
    });

    if (stockfishTruth.lockedToStockfish) {
        return [decorate(top)];
    }

    const filtered = legal.filter(
        (candidate) =>
            candidate.eval >= stockfishTruth.absoluteFloor &&
            candidate.eval >=
                stockfishTruth.topEval - stockfishTruth.evaluationWindow,
    );

    return (filtered.length > 0 ? filtered : [top]).map(decorate);
};

export const buildSharedBehaviorContext = (params: {
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
}): SharedBehaviorContext => {
    const chess = new Chess(params.fen);
    const legalCandidates = [...params.candidates]
        .sort(sortByEval)
        .filter((candidate) =>
            Boolean(safeApplyMove(params.fen, candidate.move)),
        );
    const stockfishTruth = buildStockfishTruth(
        legalCandidates,
        params.engineState,
    );
    const activeThemes = detectActiveThemes(
        chess,
        params.aiColor,
        params.phase,
    );
    const filteredCandidates = filterCandidates(
        params.fen,
        params.phase,
        params.aiColor,
        legalCandidates,
        stockfishTruth,
    );
    const boardAnalysis = buildBoardAnalysis(chess, params.fen, params.aiColor);

    return {
        gameId: params.gameId,
        fen: params.fen,
        moveNumber: params.moveNumber,
        aiColor: params.aiColor,
        difficulty: params.difficulty,
        phase: params.phase,
        chess,
        totalMaterial: totalMaterial(chess),
        engineState: params.engineState,
        moveHistory: params.moveHistory,
        logger: params.logger,
        stockfishTruth,
        candidates: filteredCandidates,
        activeThemes:
            activeThemes.length > 0
                ? activeThemes
                : params.engineState.activeThemes,
        complexityDial: computeComplexityDial(
            params.engineState,
            params.phase,
            stockfishTruth.topEval,
        ),
        boardAnalysis,
    };
};
export const detectThemesForPosition = (
    fen: string,
    aiColor: PlayerColor,
    phase: GamePhase,
): TacticalTheme[] => detectActiveThemes(new Chess(fen), aiColor, phase);
