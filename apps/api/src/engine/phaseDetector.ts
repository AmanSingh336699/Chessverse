import type { GamePhase } from "../contracts.js";
import type { Chess } from "chess.js";
import { queensOffBoard, totalMaterial } from "../utils/chess.js";

const CENTRAL_FILES = new Set(["c", "d", "e", "f"]);

const isKingActive = (chess: Chess): boolean => {
  for (const row of chess.board()) {
    for (const piece of row) {
      if (piece?.type === "k") {
        const file = piece.square[0]!;
        const rank = Number(piece.square[1]);
        const isCentral = CENTRAL_FILES.has(file) && rank >= 3 && rank <= 6;
        if (isCentral) {
          return true;
        }
      }
    }
  }
  return false;
};

export const detectGamePhase = (moveNumber: number, chess: Chess): GamePhase => {
  if (moveNumber < 10) {
    return "opening";
  }

  const material = totalMaterial(chess);
  const noQueens = queensOffBoard(chess);

  if (moveNumber >= 36 && (noQueens && material < 15)) {
    return "endgame";
  }

  /* King activity: a centralized king with reduced material signals endgame
     even if move count hasn't reached 36 and material isn't below 15 */
  if (noQueens && material < 24 && isKingActive(chess)) {
    return "endgame";
  }

  if (moveNumber >= 10 && material > 30) {
    return "middlegame";
  }

  return material < 15 ? "endgame" : "middlegame";
};
