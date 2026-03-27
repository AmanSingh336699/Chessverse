import type {
  CandidatePositionSnapshot,
  FilteredCandidate,
  SharedBehaviorContext,
} from "../../types.js";
import type { OpponentPressureModel } from "../../contracts.js";

export interface PsychologicalAnalysis {
  score: number;
  dial: number;
  strategies: string[];
  continuityDelta: number;
  opponentPressure: OpponentPressureModel;
  strategy: string;
}

const updatePressureModel = (
  current: OpponentPressureModel,
  selectedEval: number,
): OpponentPressureModel => {
  const worsening = current.lastObservedEvalSwing - selectedEval;
  const consecutiveMistakes =
    worsening > 0.75 ? current.consecutiveMistakes + 1 : 0;
  const consecutiveSolidMoves =
    worsening <= 0.25 ? current.consecutiveSolidMoves + 1 : 0;
  const level =
    consecutiveMistakes >= 3
      ? "crumbling"
      : consecutiveMistakes >= 1
        ? "pressured"
        : consecutiveSolidMoves >= 3
          ? "calm"
          : "stable";

  return {
    level,
    consecutiveMistakes,
    consecutiveSolidMoves,
    lastObservedEvalSwing: selectedEval,
  };
};

export class PsychologicalComplexityEngine {
  analyzeCandidate(
    context: SharedBehaviorContext,
    candidate: FilteredCandidate,
    position: CandidatePositionSnapshot | null,
  ): PsychologicalAnalysis {
    if (!position) {
      return {
        score: 0,
        dial: context.complexityDial,
        strategies: [],
        continuityDelta: 0,
        opponentPressure: context.engineState.opponentPressure,
        strategy: "invalid-candidate",
      };
    }

    const strategies: string[] = [];
    let score = 0;

    let dial = context.complexityDial;
    if (dial <= 2) {
      dial = Math.max(0, Math.round(dial * 0.4));
    }

    const gambitAccepted = context.engineState.gambit.status === "accepted";
    const gambitMultiplier = gambitAccepted ? 1.5 : 1;

    const beforeThreats = context.boardAnalysis.aiCaptureTargetCountBefore;
    const afterThreats = position.aiCaptureTargetCountAfter;
    const fork = position.movedPieceCaptureTargetCount >= 2;
    const discovery = afterThreats - beforeThreats >= 2;
    const pin =
      position.givesCheck &&
      position.opponentKingDefendersAfter <
        context.boardAnalysis.opponentKingDefendersBefore;

    const threatMultiplicity =
      Math.max(0, afterThreats - beforeThreats) +
      Number(fork) +
      Number(discovery) +
      Number(pin);

    if (threatMultiplicity >= 3) {
      score += 30;
      strategies.push("threat-multiplication");
    } else if (
      threatMultiplicity >= 2 ||
      (afterThreats > beforeThreats && afterThreats > 0)
    ) {
      score += 15;
      strategies.push("threat-multiplication");
    }

    const opponentMobility = position.opponentMobilityAfter;
    const tacticalLoad = Number(fork) + Number(discovery) + Number(pin);
    if (tacticalLoad >= 2 && opponentMobility >= 18) {
      score += 25;
      strategies.push("calculation-overload");
    } else if (tacticalLoad >= 1 && opponentMobility >= 12) {
      score += 15;
      strategies.push("calculation-overload");
    }

    const kingDangerBefore = context.boardAnalysis.opponentKingPressureBefore;
    const kingDangerAfter = position.opponentKingPressureAfter;
    const defendersBefore = context.boardAnalysis.opponentKingDefendersBefore;
    const defendersAfter = position.opponentKingDefendersAfter;
    const effectiveKingDanger =
      kingDangerAfter -
      kingDangerBefore +
      (position.givesCheck ? 2 : 0) +
      (defendersBefore - defendersAfter);

    if (effectiveKingDanger > 10) {
      score += 25;
      strategies.push("king-danger");
    } else if (
      effectiveKingDanger >= 5 ||
      candidate.phaseTags.includes("king-attack")
    ) {
      score += 15;
      strategies.push("king-danger");
    }

    const baselineMobility = context.boardAnalysis.opponentMobilityBefore;
    const reductionRatio =
      baselineMobility === 0
        ? 0
        : 1 - opponentMobility / baselineMobility;

    if (reductionRatio >= 0.5) {
      score += 20;
      strategies.push("restriction");
    } else if (reductionRatio >= 0.3) {
      score += 10;
      strategies.push("restriction");
    }

    if (opponentMobility <= 4) {
      score += 25;
      strategies.push("zugzwang-pressure");
    }

    let continuityDelta = 0;
    const continuingThemes = context.activeThemes.filter((theme) => {
      switch (theme) {
        case "open-file-toward-king":
        case "open-diagonal-toward-king":
        case "exposed-king":
          return candidate.phaseTags.includes("king-attack");
        case "passed-pawn":
          return (
            candidate.phaseTags.includes("pawn-race") ||
            candidate.phaseTags.includes("endgame-technique")
          );
        case "central-space-advantage":
        case "development-lead":
          return (
            candidate.phaseTags.includes("center") ||
            candidate.phaseTags.includes("development")
          );
        case "knight-outpost":
        case "rook-on-seventh":
        case "bishop-pair-open-board":
          return (
            candidate.phaseTags.includes("restriction") ||
            candidate.phaseTags.includes("king-attack")
          );
        default:
          return (
            candidate.phaseTags.includes("restriction") ||
            candidate.phaseTags.includes("king-attack")
          );
      }
    });

    if (context.activeThemes.length > 0 && continuingThemes.length > 0) {
      continuityDelta += 10;
      strategies.push("narrative-continuity");
      if (dial > 6) {
        continuityDelta += 10;
      }
    } else if (context.activeThemes.length > 0 && strategies.length > 0) {
      continuityDelta -= 5;
      strategies.push("theme-abandonment-penalty");
    }

    if (
      dial > 6 &&
      candidate.phaseTags.includes("simplification") &&
      !strategies.includes("king-danger")
    ) {
      score -= 15;
      strategies.push("anti-simplification");
    }

    if (gambitAccepted && candidate.phaseTags.includes("simplification")) {
      score -= 10;
      strategies.push("gambit-anti-simplify");
    }

    const opponentPressure = context.engineState.opponentPressure;
    if (opponentPressure.level === "crumbling") {
      score += 10;
      strategies.push("opponent-crumbling-pressure");
    } else if (opponentPressure.level === "pressured") {
      score += 5;
      strategies.push("opponent-pressure-amplify");
    } else if (
      opponentPressure.level === "calm" &&
      opponentPressure.consecutiveSolidMoves >= 3
    ) {
      score += 3;
      strategies.push("composure-challenge");
    }

    let dialScale: number;
    if (dial <= 2) {
      dialScale = 0.4;
    } else if (dial <= 5) {
      dialScale = 1;
    } else if (dial <= 8) {
      dialScale = 1.5;
    } else {
      dialScale = 2;
    }

    const total = Number(
      ((score + continuityDelta) * dialScale * gambitMultiplier).toFixed(2),
    );

    return {
      score: total,
      dial,
      strategies,
      continuityDelta,
      opponentPressure: updatePressureModel(
        context.engineState.opponentPressure,
        candidate.eval,
      ),
      strategy: strategies[0] ?? "measured-complexity",
    };
  }
}
