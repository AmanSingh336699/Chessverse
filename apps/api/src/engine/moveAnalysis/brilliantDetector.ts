import type { CandidateMove, PlayerColor } from "../../contracts.js";
import { Chess } from "chess.js";
import {
  materialOfferValue,
  isMoveCheck,
} from "../behavior/helpers.js";

export interface BrilliantContext {
  fenBefore: string;
  fenAfter: string;
  moveUci: string;
  playerColor: PlayerColor;
  playerEval: number;
  engineBestEval: number;
  engineBestMove: string;
  candidates: CandidateMove[];
  deepConfirmEval?: number | null;
}

export interface BrilliantResult {
  brilliant: boolean;
  evidence: string[];
}

const EVAL_TOLERANCE = 0.3;

export const detectBrilliant = (ctx: BrilliantContext): BrilliantResult => {
  const evidence: string[] = [];

  /* ── Condition 1: Material sacrifice ── */
  const sacrifice = materialOfferValue(ctx.fenBefore, ctx.moveUci, ctx.playerColor);
  if (sacrifice < 1) {
    return { brilliant: false, evidence: ["No material sacrifice detected"] };
  }
  evidence.push(`Sacrificed ${sacrifice} points of material`);

  /* ── Condition 2: Player eval >= engine best eval (within tolerance) ── */
  if (ctx.playerEval < ctx.engineBestEval - EVAL_TOLERANCE) {
    return {
      brilliant: false,
      evidence: [
        ...evidence,
        `Player eval (${ctx.playerEval.toFixed(2)}) is below engine best (${ctx.engineBestEval.toFixed(2)}) by more than ${EVAL_TOLERANCE}`,
      ],
    };
  }
  evidence.push(
    `Position after move evaluates to ${ctx.playerEval.toFixed(2)}, matching or exceeding engine recommendation`,
  );

  /* ── Condition 3: Deep confirmation agrees ── */
  if (typeof ctx.deepConfirmEval === "number") {
    if (ctx.deepConfirmEval < ctx.engineBestEval - EVAL_TOLERANCE) {
      return {
        brilliant: false,
        evidence: [
          ...evidence,
          `Deep confirmation eval (${ctx.deepConfirmEval.toFixed(2)}) does not hold up`,
        ],
      };
    }
    evidence.push(`Deeper analysis confirms the evaluation at ${ctx.deepConfirmEval.toFixed(2)}`);
  }

  /* ── Condition 4: Forcing lines in continuation ── */
  let hasForcing = false;
  try {
    const chessAfter = new Chess(ctx.fenAfter);
    const opponentMoves = chessAfter.moves({ verbose: true });
    const checksOrCaptures = opponentMoves.filter(
      (m) => m.captured || isMoveCheck(ctx.fenAfter, `${m.from}${m.to}${m.promotion ?? ""}`),
    );
    if (checksOrCaptures.length >= 2 || chessAfter.inCheck()) {
      hasForcing = true;
    }
    /* Mate score is always forcing */
    if (Math.abs(ctx.playerEval) >= 99) {
      hasForcing = true;
    }
  } catch {
    /* Non-critical: if we can't verify forcing, we don't block */
  }

  if (!hasForcing) {
    return {
      brilliant: false,
      evidence: [...evidence, "No forcing continuation found after the move"],
    };
  }
  evidence.push("Position leads to forcing continuation with checks, captures, or mate threats");

  /* ── Condition 5: Not the obvious top choice in a quiet position ── */
  const topCandidate = ctx.candidates[0];
  if (topCandidate && topCandidate.move === ctx.moveUci) {
    const chessBefore = new Chess(ctx.fenBefore);
    const isQuiet = !chessBefore.inCheck() && sacrifice > 0;
    if (!isQuiet) {
      return {
        brilliant: false,
        evidence: [
          ...evidence,
          "Move is the engine's top choice in a non-tactical position — this is Best, not Brilliant",
        ],
      };
    }
  }
  evidence.push("Move was not the obvious engine choice — genuine creative insight");

  return { brilliant: true, evidence };
};
