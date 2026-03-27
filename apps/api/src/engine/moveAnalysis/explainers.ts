import type { CandidateMove, ExplanationDetail, MoveClassification, PlayerColor } from "../../contracts.js";
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
   Detector 1 — Hanging Piece
   ═══════════════════════════════════════════════════════ */

export const detectHangingPiece = (ctx: ExplainerContext): ExplanationDetail | null => {
  if (ctx.classification === "best" || ctx.classification === "excellent" || ctx.classification === "brilliant") {
    return null;
  }

  const chessAfter = new Chess(ctx.fenAfter);

  const opponentMoves = chessAfter.moves({ verbose: true });

  for (const move of opponentMoves) {
    if (!move.captured) continue;

    /* Check if captured piece belongs to the player */
    const targetSquare = move.to;
    /* Verify defender count */
    const isDefended = opponentMoves.some(
      (m) => m.from !== move.from && m.to === targetSquare && !m.captured,
    );

    if (!isDefended) {
      const capturedPiece = pieceName(move.captured);
      return {
        short: `This move leaves your ${capturedPiece} undefended on ${squareLabel(targetSquare)}. Your opponent can simply capture it.`,
        expanded: `After your move, the ${capturedPiece} on ${squareLabel(targetSquare)} has no defenders. Your opponent plays ${move.san} to win it for free. The engine recommended ${ctx.bestMoveNotation} instead.`,
        detectorId: "hanging-piece",
        evidence: [move.san, `Captures ${capturedPiece} on ${targetSquare}`],
      };
    }
  }
  return null;
};

/* ═══════════════════════════════════════════════════════
   Detector 2 — Forced Checkmate Allowed
   ═══════════════════════════════════════════════════════ */

export const detectForcedCheckmate = (ctx: ExplainerContext): ExplanationDetail | null => {
  /* Triggers when eval after shows a mate score for the opponent */
  if (ctx.evalAfter > -99) {
    return null;
  }

  const mateIn = Math.abs(ctx.evalAfter) >= 1000 ? 1 : undefined;
  const pvLine = ctx.bestLinePV && ctx.bestLinePV.length > 0
    ? ` starting with ${pvToSan(ctx.fenAfter, ctx.bestLinePV, 1)}`
    : "";

  return {
    short: `This move allows forced checkmate${mateIn ? ` in ${mateIn} move` : ""}${pvLine}.`,
    expanded: `After your move, the engine finds a forced checkmate sequence for your opponent. ${ctx.bestMoveNotation} was the engine's recommended defense.`,
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
    const uniqueTargets = new Set(attacksFromSameSquare.map((m) => m.to));
    if (uniqueTargets.size >= 2) {
      const piece = chessAfter.get(fromSquare);
      if (piece) {
        const attackerName = pieceName(piece.type);
        const targets = [...uniqueTargets].map(squareLabel).join(" and ");
        return {
          short: `After this move, your opponent's ${attackerName} on ${squareLabel(fromSquare)} attacks both ${targets} simultaneously.`,
          expanded: `This creates a fork — one piece attacking two or more of your pieces. You will lose material. The engine recommended ${ctx.bestMoveNotation}.`,
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
          short: `Your ${pieceName(piece.type)} on ${squareLabel(piece.square)} is pinned and cannot move.`,
          expanded: `A pin locks your piece in place because moving it would expose a more valuable piece behind it. Consider ${ctx.bestMoveNotation} instead.`,
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
  if (!ctx.bestLinePV || ctx.bestLinePV.length < 2) return null;

  const pvNotation = pvToSan(ctx.fenAfter, ctx.bestLinePV, 4);
  if (!pvNotation) return null;

  return {
    short: `After this move, a forced exchange sequence loses material. Best continuation: ${pvNotation}.`,
    expanded: `The engine found a line where your opponent wins material through a sequence of forced captures and recaptures. The evaluation drops by ${ctx.evalLoss.toFixed(1)} pawns. ${ctx.bestMoveNotation} avoided this.`,
    detectorId: "material-loss-sequence",
    evidence: [pvNotation],
  };
};

/* ═══════════════════════════════════════════════════════
   Detector 5 — Sacrifice Explanation (for Brilliant)
   ═══════════════════════════════════════════════════════ */

export const detectSacrificeExplanation = (ctx: ExplainerContext): ExplanationDetail | null => {
  if (ctx.classification !== "brilliant") return null;

  const chessBefore = new Chess(ctx.fenBefore);
  const moveObj = (() => {
    try {
      const from = ctx.moveUci.slice(0, 2);
      const to = ctx.moveUci.slice(2, 4);
      const promotion = ctx.moveUci.length > 4 ? ctx.moveUci[4] : undefined;
      if (!isSquare(from) || !isSquare(to)) return null;
      return chessBefore.move(promotion ? { from, to, promotion } : { from, to });
    } catch {
      return null;
    }
  })();

  if (!moveObj) return null;

  const pieceSacrificed = pieceName(moveObj.piece);
  const destination = squareLabel(moveObj.to);
  const pvLine = ctx.bestLinePV
    ? pvToSan(ctx.fenAfter, ctx.bestLinePV, 5)
    : "";

  return {
    short: `Brilliant! You sacrificed your ${pieceSacrificed} on ${destination} for a winning attack.`,
    expanded: `You played a non-obvious ${pieceSacrificed} sacrifice that the engine confirms leads to a decisive advantage. ${pvLine ? `The continuation: ${pvLine}` : "The resulting position is winning."}`,
    detectorId: "sacrifice-explanation",
    evidence: [`Sacrificed ${pieceSacrificed} on ${destination}`, pvLine],
  };
};

/* ═══════════════════════════════════════════════════════
   Detector 6 — Positional Weakening
   ═══════════════════════════════════════════════════════ */

export const detectPositionalWeakening = (ctx: ExplainerContext): ExplanationDetail | null => {
  if (ctx.classification === "best" || ctx.classification === "excellent" || ctx.classification === "brilliant") {
    return null;
  }
  if (ctx.evalLoss < 0.5) return null;

  const chessBefore = new Chess(ctx.fenBefore);
  const playerColorCode = ctx.playerColor === "white" ? "w" : "b";

  /* ── Check pawn structure weakening ── */
  const moveFrom = ctx.moveUci.slice(0, 2);
  const movedPiece = (() => {
    try {
      const chess = new Chess(ctx.fenBefore);
      if (!isSquare(moveFrom)) return null;
      return chess.get(moveFrom);
    } catch {
      return null;
    }
  })();

  if (movedPiece?.type === "p") {
    /* Pawn moved — check if it was shielding the king */
    const kingSquare = (() => {
      for (const row of chessBefore.board()) {
        for (const p of row) {
          if (p?.type === "k" && p.color === playerColorCode) return p.square;
        }
      }
      return null;
    })();

    if (kingSquare) {
      const kFile = kingSquare.charCodeAt(0);
      const pFile = moveFrom.charCodeAt(0);
      const fileDist = Math.abs(kFile - pFile);
      if (fileDist <= 1) {
        return {
          short: `Moving this pawn weakens the shelter around your king.`,
          expanded: `This pawn was part of your king's defensive structure. Advancing or removing it creates permanent weaknesses that your opponent can target. ${ctx.bestMoveNotation} maintained a safer structure.`,
          detectorId: "positional-weakening",
          evidence: [`Pawn moved from ${moveFrom} near king on ${kingSquare}`],
        };
      }
    }
  }

  /* ── Defender removal ── */
  if (movedPiece && movedPiece.type !== "p" && movedPiece.type !== "k") {
    const beforeDefenses = chessBefore.moves({ square: moveFrom as any, verbose: true })
      .filter((m) => !m.captured).length;
    if (beforeDefenses >= 2) {
      return {
        short: `Moving this ${pieceName(movedPiece.type)} removes an important defender from the position.`,
        expanded: `Your ${pieceName(movedPiece.type)} was actively defending key squares. Relocating it leaves gaps in your position. The engine preferred ${ctx.bestMoveNotation}.`,
        detectorId: "positional-weakening",
        evidence: [`${pieceName(movedPiece.type)} defended ${beforeDefenses} squares from ${moveFrom}`],
      };
    }
  }

  return null;
};

/* ═══════════════════════════════════════════════════════
   Detector 7 — Opening Book Recognition
   ═══════════════════════════════════════════════════════ */

export const detectOpeningBook = (ctx: ExplainerContext): ExplanationDetail | null => {
  if (!ctx.openingBookName) return null;

  return {
    short: `This is a standard move in the ${ctx.openingBookName}.`,
    expanded: `You are following well-established opening theory. This move is part of the ${ctx.openingBookName} opening line.`,
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
