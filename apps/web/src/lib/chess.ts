import type { GameSnapshot, GameStatus, MoveHistoryEntry, PlayerColor } from "../contracts";
import { Chess, type Square } from "chess.js";

const PIECE_VALUES: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

export type PromotionPiece = "q" | "r" | "b" | "n";

const SQUARE_PATTERN = /^[a-h][1-8]$/;

export const isSquare = (value: string): value is Square => SQUARE_PATTERN.test(value);

export const toChessMoveInput = (
  from: string,
  to: string,
  promotion?: PromotionPiece,
) => {
  if (!isSquare(from) || !isSquare(to)) {
    return null;
  }

  return promotion ? { from, to, promotion } : { from, to };
};

export const statusLabel = (status: GameStatus): string => {
  switch (status) {
    case "check":
      return "Check";
    case "checkmate":
      return "Checkmate";
    case "stalemate":
      return "Stalemate";
    case "draw":
      return "Draw";
    case "resigned":
      return "Resigned";
    default:
      return "Playing";
  }
};

export const boardFen = (game: GameSnapshot | null, optimisticFen: string | null): string =>
  optimisticFen ?? game?.fen ?? new Chess().fen();

export const legalTargetsForSquare = (fen: string, square: string): string[] => {
  if (!isSquare(square)) {
    return [];
  }

  const chess = new Chess(fen);
  return chess.moves({ square, verbose: true }).map((move) => move.to);
};

export const currentCheckSquare = (fen: string): string | null => {
  const chess = new Chess(fen);
  if (!chess.inCheck()) {
    return null;
  }

  const activeColor = chess.turn();
  for (const row of chess.board()) {
    for (const piece of row) {
      if (piece?.type === "k" && piece.color === activeColor) {
        return piece.square;
      }
    }
  }

  return null;
};

export const materialBalance = (fen: string, playerColor: PlayerColor): number => {
  let white = 0;
  let black = 0;
  const chess = new Chess(fen);
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece) {
        continue;
      }

      const value = PIECE_VALUES[piece.type] ?? 0;
      if (piece.color === "w") {
        white += value;
      } else {
        black += value;
      }
    }
  }

  return Number((playerColor === "white" ? white - black : black - white).toFixed(1));
};

export const lastMoveSquares = (move: MoveHistoryEntry | null): [string, string] | null => {
  if (!move) {
    return null;
  }
  return [move.moveUci.slice(0, 2), move.moveUci.slice(2, 4)];
};

export const promotionFromPiece = (piece?: string): PromotionPiece | undefined => {
  if (!piece) {
    return undefined;
  }
  return piece.toLowerCase().includes("q") ? "q" : undefined;
};
