import type { CandidateMove, ExplanationDetail, MoveClassification, PlayerColor } from "@chessverse/contracts";
import { Chess } from "chess.js";
import { isSquare } from "../../utils/chess.js";

/* ═══════════════════════════════════════════════════════
   Shared helpers
   ═══════════════════════════════════════════════════════ */

const PIECE_NAMES: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

const PIECE_VALUES: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

const pieceName = (type: string): string => PIECE_NAMES[type.toLowerCase()] ?? type;

const squareLabel = (sq: string): string => sq;

const pvToSan = (fen: string, moves: string[], limit = 5): string => {
  const chess = new Chess(fen);
  const notations: string[] = [];
  for (const uci of moves.slice(0, limit)) {
    try {
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promotion = uci.length > 4 ? uci[4] : undefined;
      if (!isSquare(from) || !isSquare(to)) break;
      const result = chess.move(promotion ? { from, to, promotion } : { from, to });
      if (!result) break;
      notations.push(result.san);
    } catch {
      break;
    }
  }
  return notations.join(" ");
};

/* ═══════════════════════════════════════════════════════
   Detector context — passed to all detectors
   ═══════════════════════════════════════════════════════ */

export interface ExplainerContext {
  fenBefore: string;
  fenAfter: string;
  moveUci: string;
  moveNotation: string;
  playerColor: PlayerColor;
  classification: MoveClassification;
  evalBefore: number;
  evalAfter: number;
  evalLoss: number;
  bestMove: string;
  bestMoveNotation: string;
  candidates: CandidateMove[];
  bestLinePV?: string[];
  openingBookName?: string | null | undefined;
}

/* ═══════════════════════════════════════════════════════
   Detector 1 — Hanging Piece & Removed Guard
   ═══════════════════════════════════════════════════════ */

export const detectHangingPiece = (ctx: ExplainerContext): ExplanationDetail | null => {
  if (ctx.classification === "best" || ctx.classification === "excellent" || ctx.classification === "brilliant") {
    return null;
  }

  const fromSquare = ctx.moveUci.slice(0, 2);
  const toSquare = ctx.moveUci.slice(2, 4);
  const chessAfter = new Chess(ctx.fenAfter);
  const opponentMoves = chessAfter.moves({ verbose: true });
  const friendlyColor = ctx.playerColor === "white" ? "w" : "b";

  /* Check 1: Did the moved piece blunder directly on toSquare? */
  const capturesOnTarget = opponentMoves.filter((m) => m.to === toSquare);
  if (capturesOnTarget.length > 0) {
    capturesOnTarget.sort(
      (a, b) => (PIECE_VALUES[a.piece] ?? 1) - (PIECE_VALUES[b.piece] ?? 1),
    );
    const oppCap = capturesOnTarget[0]!;

    const testGame = new Chess(ctx.fenAfter);
    try {
      testGame.move(oppCap);
      const playerRecaptures = testGame.moves({ verbose: true }).filter((m) => m.to === toSquare);
      const isDefended = playerRecaptures.length > 0;
      const movedPiece = chessAfter.get(toSquare as any);
      const movedType = movedPiece ? pieceName(movedPiece.type) : "piece";
      const attackerType = pieceName(oppCap.piece);
      const targetVal = PIECE_VALUES[movedPiece?.type ?? "p"] ?? 1;
      const attackerVal = PIECE_VALUES[oppCap.piece] ?? 1;

      if (!isDefended) {
        return {
          short: `Leaves ${movedType} undefended on ${toSquare}. Best: ${ctx.bestMoveNotation}`,
          expanded: `Your ${movedType} on ${toSquare} has no defenders. Opponent can play ${oppCap.san} to capture for free. Best was ${ctx.bestMoveNotation}.`,
          detectorId: "hanging-piece",
          evidence: [oppCap.san, `Leaves ${movedType} hanging on ${toSquare}`],
        };
      } else if (targetVal > attackerVal && targetVal - attackerVal >= 2) {
        return {
          short: `Blunders ${movedType} on ${toSquare} to a ${attackerType}. Best: ${ctx.bestMoveNotation}`,
          expanded: `Your ${movedType} on ${toSquare} can be traded unfavorably for a ${attackerType} (${oppCap.san}). Best was ${ctx.bestMoveNotation}.`,
          detectorId: "hanging-piece",
          evidence: [oppCap.san, `Loses ${movedType} for ${attackerType}`],
        };
      }
    } catch {}
  }

  /* Check 2: Did moving from fromSquare remove the defense of another friendly piece? */
  for (const move of opponentMoves) {
    if (!move.captured || move.to === toSquare) continue;
    const targetSquare = move.to;
    const victim = chessAfter.get(targetSquare as any);
    if (!victim || victim.color !== friendlyColor) continue;

    const testGame = new Chess(ctx.fenAfter);
    try {
      testGame.move(move);
      const recaptures = testGame.moves({ verbose: true }).filter((m) => m.to === targetSquare);
      if (recaptures.length === 0) {
        const victimName = pieceName(victim.type);
        return {
          short: `Leaves ${victimName} on ${targetSquare} undefended. Best: ${ctx.bestMoveNotation}`,
          expanded: `Moving from ${fromSquare} removed defense of your ${victimName} on ${targetSquare}, allowing ${move.san}. Best was ${ctx.bestMoveNotation}.`,
          detectorId: "hanging-piece-removed-guard",
          evidence: [move.san, `Leaves ${victimName} on ${targetSquare} undefended`],
        };
      }
    } catch {}
  }

  return null;
};

/* ═══════════════════════════════════════════════════════
   Detector 2 — Forced Checkmate Allowed
   ═══════════════════════════════════════════════════════ */

export const detectForcedCheckmate = (ctx: ExplainerContext): ExplanationDetail | null => {
  if (ctx.evalAfter > -99) {
    return null;
  }

  return {
    short: `Allows forced checkmate. Best: ${ctx.bestMoveNotation}`,
    expanded: `After this move, opponent has a forced checkmate. Recommended defense was ${ctx.bestMoveNotation}.`,
    detectorId: "forced-checkmate-allowed",
    evidence: [`Eval after: ${ctx.evalAfter}`],
  };
};

/* ═══════════════════════════════════════════════════════
   Detector 3 — Tactical Pattern Recognition
   ═══════════════════════════════════════════════════════ */

export const detectTacticalPattern = (ctx: ExplainerContext): ExplanationDetail | null => {
  if (ctx.classification === "best" || ctx.classification === "brilliant") {
    return null;
  }

  const chessAfter = new Chess(ctx.fenAfter);
  const opponentMoves = chessAfter.moves({ verbose: true });

  /* ── Fork detection ── */
  for (const move of opponentMoves) {
    if (!move.captured) continue;
    const fromSquare = move.from;
    const attacksFromSameSquare = opponentMoves.filter(
      (m) => m.from === fromSquare && m.captured,
    );
    const uniqueTargets = [...new Set(attacksFromSameSquare.map((m) => m.to))];
    if (uniqueTargets.length >= 2) {
      const piece = chessAfter.get(fromSquare);
      if (piece) {
        const attackerName = pieceName(piece.type);
        const targets = uniqueTargets.slice(0, 2).map(squareLabel).join(" & ");
        return {
          short: `Allows ${attackerName} fork on ${targets}. Best: ${ctx.bestMoveNotation}`,
          expanded: `Opponent's ${attackerName} on ${fromSquare} forks ${targets}, winning material. Best was ${ctx.bestMoveNotation}.`,
          detectorId: "tactical-fork",
          evidence: [`Fork by ${attackerName} on ${fromSquare}`, `Targets: ${targets}`],
        };
      }
    }
  }

  /* ── Pin detection ── */
  const playerColorCode = ctx.playerColor === "white" ? "w" : "b";
  for (const row of chessAfter.board()) {
    for (const piece of row) {
      if (!piece || piece.color !== playerColorCode || piece.type === "k") continue;
      const pieceMoves = chessAfter.moves({ square: piece.square, verbose: true });
      if (pieceMoves.length === 0 && opponentMoves.some((m) => m.to === piece.square)) {
        return {
          short: `Pins ${pieceName(piece.type)} on ${squareLabel(piece.square)}. Best: ${ctx.bestMoveNotation}`,
          expanded: `Your ${pieceName(piece.type)} on ${squareLabel(piece.square)} is pinned and cannot move. Best was ${ctx.bestMoveNotation}.`,
          detectorId: "tactical-pin",
          evidence: [`Pinned ${pieceName(piece.type)} on ${piece.square}`],
        };
      }
    }
  }

  return null;
};

/* ═══════════════════════════════════════════════════════
   Detector 4 — Material Loss Sequence
   ═══════════════════════════════════════════════════════ */

export const detectMaterialLossSequence = (ctx: ExplainerContext): ExplanationDetail | null => {
  if (ctx.evalLoss < 1.5) return null;

  return {
    short: `Loses material (-${ctx.evalLoss.toFixed(1)} pawns). Best: ${ctx.bestMoveNotation}`,
    expanded: `A tactical exchange sequence loses material (-${ctx.evalLoss.toFixed(1)} pawns). Best was ${ctx.bestMoveNotation}.`,
    detectorId: "material-loss-sequence",
    evidence: [`Eval loss: ${ctx.evalLoss}`],
  };
};

/* ═══════════════════════════════════════════════════════
   Detector 5 — Sacrifice Explanation (for Brilliant)
   ═══════════════════════════════════════════════════════ */

export const detectSacrificeExplanation = (ctx: ExplainerContext): ExplanationDetail | null => {
  if (ctx.classification !== "brilliant") return null;

  const toSquare = ctx.moveUci.slice(2, 4);
  return {
    short: `Brilliant sacrifice on ${toSquare}! Winning attack.`,
    expanded: `Decisive piece sacrifice on ${toSquare} unlocking a winning attack.`,
    detectorId: "sacrifice-explanation",
    evidence: [`Sacrifice on ${toSquare}`],
  };
};

/* ═══════════════════════════════════════════════════════
   Detector 6 — Positional Weakening
   ═══════════════════════════════════════════════════════ */

export const detectPositionalWeakening = (ctx: ExplainerContext): ExplanationDetail | null => {
  if (ctx.classification === "best" || ctx.classification === "excellent" || ctx.classification === "brilliant") {
    return null;
  }
  if (ctx.evalLoss < 0.6) return null;

  const moveFrom = ctx.moveUci.slice(0, 2);
  const chessBefore = new Chess(ctx.fenBefore);
  let movedPiece;
  try {
    if (isSquare(moveFrom)) movedPiece = chessBefore.get(moveFrom);
  } catch {}

  if (movedPiece?.type === "p") {
    return {
      short: `Weakens king shelter / pawn structure. Best: ${ctx.bestMoveNotation}`,
      expanded: `Advancing this pawn weakens key defensive squares. Preferred was ${ctx.bestMoveNotation}.`,
      detectorId: "positional-weakening",
      evidence: [`Pawn move from ${moveFrom}`],
    };
  }

  return {
    short: `Weakens piece coordination (-${ctx.evalLoss.toFixed(1)}). Best: ${ctx.bestMoveNotation}`,
    expanded: `Reduces piece activity and coordination. Preferred was ${ctx.bestMoveNotation}.`,
    detectorId: "positional-weakening",
    evidence: [`Eval loss: ${ctx.evalLoss}`],
  };
};

/* ═══════════════════════════════════════════════════════
   Detector 7 — Opening Book Recognition
   ═══════════════════════════════════════════════════════ */

export const detectOpeningBook = (ctx: ExplainerContext): ExplanationDetail | null => {
  if (!ctx.openingBookName) return null;

  return {
    short: `Book move · ${ctx.openingBookName}`,
    expanded: `Standard opening move in the ${ctx.openingBookName}.`,
    detectorId: "opening-book",
    evidence: [ctx.openingBookName],
  };
};

/* ═══════════════════════════════════════════════════════
   Orchestrator — runs all detectors in priority order
   ═══════════════════════════════════════════════════════ */

export const generateExplanations = (ctx: ExplainerContext): ExplanationDetail[] => {
  const detectors = [
    detectSacrificeExplanation,
    detectForcedCheckmate,
    detectHangingPiece,
    detectTacticalPattern,
    detectMaterialLossSequence,
    detectPositionalWeakening,
    detectOpeningBook,
  ];

  const results: ExplanationDetail[] = [];
  for (const detector of detectors) {
    try {
      const result = detector(ctx);
      if (result) {
        results.push(result);
      }
    } catch {
      /* Individual detector failure never breaks the pipeline */
    }
  }
  return results;
};
