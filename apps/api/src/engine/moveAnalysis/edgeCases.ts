import type {
  MoveAnalysisDisplayMode,
  MoveClassification,
} from "../../contracts.js";
import { Chess } from "chess.js";
import { totalMaterial } from "../../utils/chess.js";

export interface EdgeCaseContext {
  fenBefore: string;
  fenAfter: string;
  moveUci: string;
  evalBefore: number;
}

export interface EdgeCaseOverride {
  classification: MoveClassification;
  explanation: string;
  detectorId: string;
  displayMode?: MoveAnalysisDisplayMode;
}

const MATE_SCORE = 1000;

export const normalizeMateEval = (
  evalValue: number,
  mate?: number | null,
): number => {
  if (typeof mate === "number") {
    return mate > 0 ? MATE_SCORE : -MATE_SCORE;
  }

  return evalValue;
};

export const checkEdgeCases = (ctx: EdgeCaseContext): EdgeCaseOverride | null => {
  const chessBefore = new Chess(ctx.fenBefore);
  const chessAfter = new Chess(ctx.fenAfter);

  const legalMovesBefore = chessBefore.moves();
  if (legalMovesBefore.length === 1) {
    return {
      classification: "best",
      explanation: "This was the only legal move available.",
      detectorId: "forced-move",
      displayMode: "none",
    };
  }

  if (chessAfter.isCheckmate()) {
    return {
      classification: "best",
      explanation: "Checkmate delivered. Perfect move.",
      detectorId: "checkmate-delivered",
      displayMode: "mate",
    };
  }

  if (chessAfter.isStalemate()) {
    if (ctx.evalBefore >= 2.0) {
      return {
        classification: "blunder",
        explanation:
          "You stalemated your opponent, throwing away a winning position. The game is now a draw.",
        detectorId: "stalemate-from-winning",
      };
    }

    if (ctx.evalBefore <= -2.0) {
      return {
        classification: "best",
        explanation:
          "You found stalemate from a losing position, saving the game with a draw.",
        detectorId: "stalemate-from-losing",
      };
    }

    return {
      classification: "good",
      explanation: "The game ends in stalemate. The result is a draw.",
      detectorId: "stalemate-neutral",
    };
  }

  if (chessAfter.isThreefoldRepetition()) {
    if (ctx.evalBefore <= -1.0) {
      return {
        classification: "good",
        explanation: "You secured a draw by repetition from a difficult position.",
        detectorId: "draw-repetition-saving",
      };
    }

    if (ctx.evalBefore >= 1.5) {
      return {
        classification: "mistake",
        explanation:
          "You allowed a draw by repetition despite having a winning advantage.",
        detectorId: "draw-repetition-wasted",
      };
    }

    return {
      classification: "good",
      explanation: "The game is drawn by threefold repetition.",
      detectorId: "draw-repetition-neutral",
    };
  }

  if (chessAfter.isInsufficientMaterial()) {
    return {
      classification: "best",
      explanation:
        "The position is a theoretical draw due to insufficient material.",
      detectorId: "insufficient-material",
    };
  }

  if (chessAfter.isDraw()) {
    return {
      classification: "good",
      explanation: "The game ends in a draw.",
      detectorId: "draw-generic",
    };
  }

  const materialAfter = totalMaterial(chessAfter);
  if (materialAfter <= 6 && Math.abs(ctx.evalBefore) < 0.5) {
    return {
      classification: "best",
      explanation:
        "This is a theoretically drawn endgame. No winning plan exists for either side.",
      detectorId: "drawn-endgame",
    };
  }

  if (ctx.evalBefore <= -5.0) {
    return {
      classification: "good",
      explanation:
        "You were already in a very difficult position. This move keeps the game going.",
      detectorId: "checkmate-avoidance",
    };
  }

  const beforeKey = ctx.fenBefore.split(" ").slice(0, 4).join(" ");
  const afterKey = ctx.fenAfter.split(" ").slice(0, 4).join(" ");
  if (beforeKey === afterKey) {
    return {
      classification: "good",
      explanation:
        "This position has repeated. One more repetition will result in a draw.",
      detectorId: "approaching-repetition",
    };
  }

  if (ctx.moveUci.length === 5) {
    const promotionPiece = ctx.moveUci[4]?.toLowerCase();
    if (promotionPiece && promotionPiece !== "q") {
      const pieceLabel =
        promotionPiece === "n"
          ? "knight"
          : promotionPiece === "r"
            ? "rook"
            : "bishop";

      return {
        classification: "best",
        explanation: `You correctly promoted to a ${pieceLabel} instead of a queen. This was the best choice in the position.`,
        detectorId: "underpromotion-correct",
      };
    }
  }

  return null;
};
