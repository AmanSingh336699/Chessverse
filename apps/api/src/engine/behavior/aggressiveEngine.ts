import type {
  CandidatePositionSnapshot,
  FilteredCandidate,
  SharedBehaviorContext,
} from "../../types.js";
import { distanceBetweenSquares } from "../../utils/chess.js";

export interface AggressiveAnalysis {
  score: number;
  multiplier: number;
  rules: string[];
  passivePenalty: boolean;
  strategy: string;
}

export class AggressivePlayEngine {
  analyzeCandidate(
    context: SharedBehaviorContext,
    candidate: FilteredCandidate,
    position: CandidatePositionSnapshot | null,
  ): AggressiveAnalysis {
    if (!position) {
      return {
        score: 0,
        multiplier: 1,
        rules: [],
        passivePenalty: false,
        strategy: "invalid-candidate",
      };
    }

    const { appliedMove } = position;
    const rules: string[] = [];
    let score = 0;

    const defendedCapture = context.boardAnalysis.defendedSquaresByOpponent.has(
      appliedMove.to,
    );
    if (appliedMove.captured) {
      score += defendedCapture ? 25 : 15;
      rules.push(defendedCapture ? "defended-capture" : "capture");
    }

    if (position.givesCheck) {
      score += 20;
      rules.push("check");
    }

    if (
      distanceBetweenSquares(
        appliedMove.to,
        context.boardAnalysis.opponentKingSquare,
      ) <= 2
    ) {
      score += 20;
      rules.push("king-proximity");
    }

    if (
      position.aiCaptureTargetCountAfter >
      context.boardAnalysis.aiCaptureTargetCountBefore
    ) {
      score += 10;
      rules.push("new-threat");
    }

    if (appliedMove.piece === "p") {
      const rank = Number(appliedMove.to[1]);
      if ((context.aiColor === "white" && rank >= 5) || (context.aiColor === "black" && rank <= 4)) {
        score += 8;
        rules.push("pawn-advance");
      }
    }

    if (
      position.opponentKingPressureAfter >
        context.boardAnalysis.opponentKingPressureBefore ||
      candidate.phaseTags.includes("king-attack")
    ) {
      score += 10;
      rules.push("open-line-pressure");
    }

    if (candidate.phaseTags.includes("center")) {
      score += 5;
      rules.push("central-control");
    }

    if (context.engineState.gambit.status === "declined" && candidate.phaseTags.includes("restriction")) {
      score += 10;
      rules.push("declined-gambit-pressure");
    }

    let multiplier = 1;
    if (context.phase === "middlegame") {
      multiplier *= 1.5;
    }
    if (context.phase === "endgame") {
      multiplier *= 0.5;
    }
    if (context.engineState.gambit.status === "accepted") {
      multiplier *= 2;
    }
    if (context.engineState.sacrificeTracking.status === "failed" || context.engineState.behaviorSuccessScore < 0) {
      multiplier *= 0.5;
    }
    multiplier = Math.max(0.5, Number(multiplier.toFixed(2)));

    let passivePenalty = false;
    if (score === 0) {
      score -= 5;
      passivePenalty = true;
      rules.push("passive-penalty");
    }

    return {
      score: Number((score * multiplier).toFixed(2)),
      multiplier,
      rules,
      passivePenalty,
      strategy: rules[0] ?? "steady-pressure",
    };
  }
}
