import type { PlayerColor } from "../contracts.js";
import { Chess, type Square } from "chess.js";
import type { StatusSnapshot } from "../types.js";


export const PIECE_VALUES: Record<string, number> = {
    p: 1,
    n: 3,
    b: 3,
    r: 5,
    q: 9,
    k: 0,
};

const SQUARE_PATTERN = /^[a-h][1-8]$/;


type PromotionPiece = "q" | "r" | "b" | "n";

export interface FenValidationResult {
    valid: boolean;
    error?: string;
}


export const isSquare = (value: string): value is Square =>
    SQUARE_PATTERN.test(value);

export const buildMovePayload = (
    from: string,
    to: string,
    promotion?: PromotionPiece,
) => {
    if (!isSquare(from) || !isSquare(to)) return null;
    return promotion ? { from, to, promotion } : { from, to };
};


const stripEnPassant = (fen: string): string => {
    const parts = fen.trim().split(/\s+/);
    if (parts.length !== 6 || parts[3] === "-") return fen;
    parts[3] = "-";
    return parts.join(" ");
};


export const createChess = (fen?: string): Chess => {
    if (!fen) return new Chess();

    try {
        return new Chess(fen);
    } catch (err) {
        if (
            err instanceof Error &&
            err.message.toLowerCase().includes("en-passant")
        ) {
            const sanitized = stripEnPassant(fen);
            if (sanitized !== fen) {
                // Second throw is intentional — if the FEN is broken beyond ep, surface it.
                return new Chess(sanitized);
            }
        }
        throw err;
    }
};


export const validateFenStrict = (fen: string): FenValidationResult => {
    const segments = fen.trim().split(/\s+/);
    if (segments.length !== 6) {
        return {
            valid: false,
            error: "FEN must contain 6 space-separated fields",
        };
    }

    const [placement, activeColor, castling, enPassant, halfmove, fullmove] =
        segments as [string, string, string, string, string, string];

    const ranks = placement.split("/");
    if (ranks.length !== 8) {
        return { valid: false, error: "Piece placement must contain 8 ranks" };
    }

    for (const rank of ranks) {
        let squares = 0;
        for (const char of rank) {
            if (/^[1-8]$/.test(char)) {
                squares += Number(char);
            } else if (/^[pnbrqkPNBRQK]$/.test(char)) {
                squares += 1;
            } else {
                return {
                    valid: false,
                    error: `Invalid piece character '${char}'`,
                };
            }
        }
        if (squares !== 8) {
            return {
                valid: false,
                error: "Each rank must resolve to exactly 8 squares",
            };
        }
    }

    if (!/^[wb]$/.test(activeColor)) {
        return { valid: false, error: "Active color must be 'w' or 'b'" };
    }

    if (!/^(-|[KQkq]{1,4})$/.test(castling)) {
        return { valid: false, error: "Invalid castling rights field" };
    }

    if (!/^(-|[a-h][36])$/.test(enPassant)) {
        return { valid: false, error: "Invalid en-passant square" };
    }

    if (!/^\d+$/.test(halfmove) || !/^\d+$/.test(fullmove)) {
        return {
            valid: false,
            error: "Halfmove and fullmove counters must be integers",
        };
    }

    try {
        // Use strict new Chess() here — validation intentionally rejects bad FENs.
        new Chess(fen);
        return { valid: true };
    } catch (error) {
        return {
            valid: false,
            error:
                error instanceof Error ? error.message : "Invalid FEN string",
        };
    }
};


export const totalMaterial = (chess: Chess): number => {
    let total = 0;
    for (const row of chess.board()) {
        for (const piece of row) {
            if (piece) total += PIECE_VALUES[piece.type] ?? 0;
        }
    }
    return total;
};

export const materialForColor = (chess: Chess, color: PlayerColor): number => {
    const target = color === "white" ? "w" : "b";
    let total = 0;
    for (const row of chess.board()) {
        for (const piece of row) {
            if (piece?.color === target) total += PIECE_VALUES[piece.type] ?? 0;
        }
    }
    return total;
};

export const queensOffBoard = (chess: Chess): boolean => {
    let queens = 0;
    for (const row of chess.board()) {
        for (const piece of row) {
            if (piece?.type === "q") queens += 1;
        }
    }
    return queens === 0;
};


export const getStatusSnapshot = (
    chess: Chess,
    playerColor: PlayerColor,
): StatusSnapshot => {
    if (chess.isCheckmate()) {
        const winner =
            chess.turn() === (playerColor === "white" ? "w" : "b")
                ? "loss"
                : "win";
        return { status: "checkmate", winner };
    }

    if (
        chess.isStalemate() ||
        chess.isDraw() ||
        chess.isInsufficientMaterial() ||
        chess.isThreefoldRepetition()
    ) {
        return { status: "draw", winner: "draw" };
    }

    if (chess.inCheck()) {
        return { status: "check", winner: null };
    }

    return { status: "playing", winner: null };
};


export const uciToMoveShape = (uci: string) => {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion =
        uci.length > 4 ? (uci.slice(4, 5) as PromotionPiece) : undefined;
    return buildMovePayload(from, to, promotion);
};

export const sanFromUci = (fen: string, uci: string): string => {
    // sanFromUci always receives persisted legal FENs — new Chess() is correct here.
    const chess = new Chess(fen);
    const movePayload = uciToMoveShape(uci);
    if (!movePayload) throw new Error(`Unable to decode invalid move ${uci}`);
    const result = chess.move(movePayload);
    if (!result)
        throw new Error(`Unable to convert illegal move ${uci} into SAN`);
    return result.san;
};

export const getFullmoveNumberFromFen = (fen: string): number => {
    const raw = fen.trim().split(/\s+/)[5];
    const parsed = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};


const parseSquareCoordinates = (square: string) => {
    const file = square[0];
    const rank = square[1];
    if (!file || !rank || !isSquare(square)) {
        throw new Error(`Invalid square '${square}'`);
    }
    return { fileCode: file.charCodeAt(0), rank: Number(rank) };
};

export const distanceBetweenSquares = (a: string, b: string): number => {
    const from = parseSquareCoordinates(a);
    const to = parseSquareCoordinates(b);
    return Math.max(
        Math.abs(from.fileCode - to.fileCode),
        Math.abs(from.rank - to.rank),
    );
};


export const normalizeEvaluation = (
    evalValue: number,
    mate?: number | null,
): number => {
    if (typeof mate === "number") return mate > 0 ? 100 : -100;
    return Number(evalValue.toFixed(2));
};
