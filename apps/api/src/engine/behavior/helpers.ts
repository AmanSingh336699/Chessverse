import type { PlayerColor } from "../../contracts.js";
import { Chess } from "chess.js";
import {
    createChess,
    distanceBetweenSquares,
    isSquare,
    materialForColor,
    uciToMoveShape,
} from "../../utils/chess.js";


export const PIECE_VALUES: Record<string, number> = {
    p: 1,
    n: 3,
    b: 3,
    r: 5,
    q: 9,
    k: 0,
};


export const normalizeFenKey = (fen: string): string =>
    fen.split(" ").slice(0, 4).join(" ");

export const fenForColorToMove = (fen: string, color: PlayerColor): string => {
    const segments = fen.split(" ");
    segments[1] = color === "white" ? "w" : "b";
    return segments.join(" ");
};


export const applyMoveToFen = (fen: string, uci: string): Chess => {
    const chess = createChess(fen);
    const movePayload = uciToMoveShape(uci);
    if (!movePayload) throw new Error(`Unable to decode move ${uci}`);
    const move = chess.move(movePayload);
    if (!move) throw new Error(`Unable to apply move ${uci} to position`);
    return chess;
};

export const legalMovesForColor = (fen: string, color: PlayerColor) => {
    const chess = createChess(fenForColorToMove(fen, color));
    return chess.moves({ verbose: true });
};


export const getKingSquare = (chess: Chess, color: PlayerColor): string => {
    const target = color === "white" ? "w" : "b";
    for (const row of chess.board()) {
        for (const piece of row) {
            if (piece?.type === "k" && piece.color === target)
                return piece.square;
        }
    }
    throw new Error(`King square not found for ${color}`);
};


export const isMoveCheck = (fen: string, uci: string): boolean =>
    applyMoveToFen(fen, uci).inCheck();

export const attackedKingZoneCount = (
    fen: string,
    attackerColor: PlayerColor,
): number => {
    const chess = createChess(fen);
    const defenderColor = attackerColor === "white" ? "black" : "white";
    const kingSquare = getKingSquare(chess, defenderColor);
    const file = kingSquare[0];
    const rank = kingSquare[1];
    if (!file || !rank) return 0;

    const zone = new Set<string>();
    for (let df = -2; df <= 2; df++) {
        for (let dr = -2; dr <= 2; dr++) {
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

    return legalMovesForColor(fen, attackerColor).filter((m) => zone.has(m.to))
        .length;
};

export const movedPieceForksTargets = (
    fen: string,
    uci: string,
    attackerColor: PlayerColor,
): boolean => {
    const after = applyMoveToFen(fen, uci);
    const moveShape = uciToMoveShape(uci);
    if (!moveShape) return false;

    const threatened = new Set(
        legalMovesForColor(after.fen(), attackerColor)
            .filter((m) => m.from === moveShape.to && m.captured)
            .map((m) => m.to),
    );
    return threatened.size >= 2;
};

export const createsDiscoveredAttack = (
    fen: string,
    uci: string,
    attackerColor: PlayerColor,
): boolean => {
    const beforeCaptures = legalMovesForColor(fen, attackerColor).filter(
        (m) => m.captured,
    ).length;
    const afterCaptures = legalMovesForColor(
        applyMoveToFen(fen, uci).fen(),
        attackerColor,
    ).filter((m) => m.captured).length;
    return afterCaptures - beforeCaptures >= 2;
};

export const threatensMultiplePieces = (
    fen: string,
    attackerColor: PlayerColor,
): boolean => {
    const threats = legalMovesForColor(fen, attackerColor).filter(
        (m) => m.captured,
    );
    return new Set(threats.map((m) => m.to)).size >= 2;
};

export const createsPinOrSkewer = (
    fen: string,
    uci: string,
    attackerColor: PlayerColor,
): boolean => {
    const after = applyMoveToFen(fen, uci);
    const defenderColor = attackerColor === "white" ? "black" : "white";
    const kingSquare = getKingSquare(after, defenderColor);
    const destination = uci.slice(2, 4);
    if (!isSquare(destination)) return false;

    const piece = after.get(destination);
    if (!piece || !["b", "r", "q"].includes(piece.type)) return false;
    if (distanceBetweenSquares(destination, kingSquare) > 7) return false;

    return legalMovesForColor(after.fen(), attackerColor)
        .filter((m) => m.from === destination)
        .some(
            (m) =>
                m.to === kingSquare || m.captured === "q" || m.captured === "r",
        );
};

export const materialOfferValue = (
    fen: string,
    uci: string,
    attackerColor: PlayerColor,
): number => {
    const after = applyMoveToFen(fen, uci);
    const destination = uci.slice(2, 4);
    if (!isSquare(destination)) return 0;

    const movedPiece = after.get(destination);
    if (!movedPiece) return 0;

    const opponentColor = attackerColor === "white" ? "black" : "white";
    const attacksOnDestination = legalMovesForColor(
        after.fen(),
        opponentColor,
    ).filter((m) => m.to === destination).length;

    return attacksOnDestination === 0
        ? 0
        : Math.max(0, PIECE_VALUES[movedPiece.type] ?? 0);
};

export const compensationSignals = (
    fen: string,
    uci: string,
    attackerColor: PlayerColor,
): boolean => {
    const after = applyMoveToFen(fen, uci);
    const destination = uci.slice(2, 4);
    const defenderColor = attackerColor === "white" ? "black" : "white";

    const beforeActivity = legalMovesForColor(fen, attackerColor).length;
    const afterActivity = legalMovesForColor(after.fen(), attackerColor).length;
    const kingPressure = attackedKingZoneCount(after.fen(), attackerColor);
    const moveTowardKing =
        distanceBetweenSquares(
            destination,
            getKingSquare(after, defenderColor),
        ) <= 3;

    return afterActivity > beforeActivity || kingPressure > 0 || moveTowardKing;
};

export const materialDeltaForOpponentResponse = (
    beforeFen: string,
    afterFen: string,
    aiColor: PlayerColor,
): number => {
    // createChess used defensively — before/after FENs come from behavior pipeline.
    const before = materialForColor(createChess(beforeFen), aiColor);
    const after = materialForColor(createChess(afterFen), aiColor);
    return Number((after - before).toFixed(2));
};


export const countDefendersAroundKing = (
    fen: string,
    kingColor: PlayerColor,
): number => {
    const chess = createChess(fen);
    const kingSquare = getKingSquare(chess, kingColor);
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
                nextFile >= "a" &&
                nextFile <= "h" &&
                nextRank >= 1 &&
                nextRank <= 8
            ) {
                const sq = `${nextFile}${nextRank}` as Parameters<
                    Chess["get"]
                >[0];
                const piece = chess.get(sq);
                if (piece && piece.color === colorCode && piece.type !== "k")
                    count++;
            }
        }
    }
    return count;
};

export const countOverloadedDefenders = (
    fen: string,
    defenderColor: PlayerColor,
): number => {
    const attackerColor = defenderColor === "white" ? "black" : "white";
    const defenderMoves = legalMovesForColor(fen, defenderColor);
    const attackedSquares = new Set(
        legalMovesForColor(fen, attackerColor)
            .filter((m) => m.captured)
            .map((m) => m.to),
    );

    // Map each attacked square to the set of pieces defending it
    const defenderMap = new Map<string, Set<string>>();
    for (const move of defenderMoves) {
        if (!attackedSquares.has(move.to)) continue;
        const defenders = defenderMap.get(move.to) ?? new Set<string>();
        defenders.add(move.from);
        defenderMap.set(move.to, defenders);
    }

    // A piece is overloaded if it is the SOLE defender of ≥2 attacked squares
    const soloDefenderCount = new Map<string, number>();
    for (const [, defenders] of defenderMap) {
        if (defenders.size === 1) {
            const sq = [...defenders][0]!;
            soloDefenderCount.set(sq, (soloDefenderCount.get(sq) ?? 0) + 1);
        }
    }

    let overloaded = 0;
    for (const [, count] of soloDefenderCount) {
        if (count >= 2) overloaded++;
    }
    return overloaded;
};

export const detectBatteryFormations = (
    fen: string,
    color: PlayerColor,
): number => {
    const chess = createChess(fen);
    const colorCode = color === "white" ? "w" : "b";
    const pieces: Array<{ type: string; square: string }> = [];

    for (const row of chess.board()) {
        for (const piece of row) {
            if (piece?.color === colorCode)
                pieces.push({ type: piece.type, square: piece.square });
        }
    }

    const sliders = pieces.filter((p) => ["b", "r", "q"].includes(p.type));
    const blockers = pieces.filter((p) =>
        ["n", "p", "b", "r"].includes(p.type),
    );

    let batteries = 0;
    for (const slider of sliders) {
        for (const blocker of blockers) {
            if (slider.square === blocker.square) continue;

            const sf = slider.square.charCodeAt(0) - 97;
            const sr = Number(slider.square[1]);
            const bf = blocker.square.charCodeAt(0) - 97;
            const br = Number(blocker.square[1]);
            const df = bf - sf;
            const dr = br - sr;

            const isRookLine =
                (slider.type === "r" || slider.type === "q") &&
                (df === 0 || dr === 0);
            const isBishopLine =
                (slider.type === "b" || slider.type === "q") &&
                Math.abs(df) === Math.abs(dr) &&
                df !== 0;

            if (
                (isRookLine || isBishopLine) &&
                Math.max(Math.abs(df), Math.abs(dr)) <= 3
            ) {
                batteries++;
            }
        }
    }
    return batteries;
};

export const pieceActivityValue = (
    fen: string,
    square: string,
    color: PlayerColor,
): number => {
    if (!isSquare(square)) return 0;

    const chess = createChess(fen);
    const piece = chess.get(square as Parameters<Chess["get"]>[0]);
    if (!piece) return 0;

    const baseValue = PIECE_VALUES[piece.type] ?? 0;
    const mobility = legalMovesForColor(fen, color).filter(
        (m) => m.from === square,
    ).length;

    let adjustment = 0;

    if (piece.type === "b" && mobility <= 2) {
        adjustment = -1;
    }

    if (piece.type === "r") {
        const rank = square[1];
        if (
            (color === "white" && rank === "7") ||
            (color === "black" && rank === "2")
        ) {
            adjustment = 1;
        }
    }

    if (piece.type === "n") {
        const file = square[0]!;
        if (file === "a" || file === "h") adjustment -= 0.5;
        const rank = Number(square[1]);
        if (
            (color === "white" && rank >= 5) ||
            (color === "black" && rank <= 4)
        ) {
            adjustment += 0.5;
        }
    }

    return Math.max(0.5, baseValue + adjustment);
};

export const countTrappedPieces = (
    fen: string,
    targetColor: PlayerColor,
): number => {
    const chess = createChess(fen);
    const colorCode = targetColor === "white" ? "w" : "b";
    const moves = legalMovesForColor(fen, targetColor);

    const mobilityMap = new Map<string, number>();
    for (const move of moves) {
        mobilityMap.set(move.from, (mobilityMap.get(move.from) ?? 0) + 1);
    }

    let trapped = 0;
    for (const row of chess.board()) {
        for (const piece of row) {
            if (
                !piece ||
                piece.color !== colorCode ||
                piece.type === "k" ||
                piece.type === "p"
            ) {
                continue;
            }
            if ((mobilityMap.get(piece.square) ?? 0) <= 1) trapped++;
        }
    }
    return trapped;
};
