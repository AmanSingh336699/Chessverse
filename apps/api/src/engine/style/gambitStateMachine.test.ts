import { describe, expect, it } from "vitest";
import {
  checkGambitRefutation,
  createAbandonedGambitState,
  createAcceptedGambitState,
  createDeclinedGambitState,
  createIdleGambitState,
  createOfferedGambitState,
  createRefutedGambitState,
  decrementGambitCooldown,
  normalizeGambitState,
  resolveGambitReplyState,
} from "../behavior/gambitState.js";
import { findRepertoireMove } from "./repertoire.js";

describe("Phase 2: Gambit State Machine & Transitions", () => {
  it("initializes with idle state", () => {
    const idle = createIdleGambitState();
    expect(idle.status).toBe("idle");
    expect(idle.active).toBe(false);
    expect(idle.handoffMode).toBe("clean");
  });

  it("transitions to offered when gambit is played", () => {
    const offered = createOfferedGambitState("King's Gambit", 2);
    expect(offered.status).toBe("offered");
    expect(offered.active).toBe(true);
    expect(offered.line).toBe("King's Gambit");
    expect(offered.attemptMoveNumber).toBe(2);
  });

  it("transitions offered -> accepted when opponent takes pawn (material drops)", () => {
    const offered = createOfferedGambitState("King's Gambit", 2);

    // Before: 1. e4 e5 2. f4 (White offered f4 pawn)
    const beforeFen = "rnbqkbnr/pppp1ppp/8/4p3/4PP2/8/PPPP2PP/RNBQKBNR b KQkq f3 0 2";
    // After: 2... exf4 (Black captured White's pawn, so White's material decreased)
    const afterFen = "rnbqkbnr/pppp1ppp/8/8/4Pp2/8/PPPP2PP/RNBQKBNR w KQkq - 0 3";

    const reply = resolveGambitReplyState({
      state: offered,
      aiColor: "white",
      beforeFen,
      afterFen,
    });

    expect(reply.status).toBe("accepted");
    expect(reply.active).toBe(true);
    expect(reply.handoffMode).toBe("exploitation");
  });

  it("transitions offered -> declined when opponent does not take pawn (e.g. 2... d6)", () => {
    const offered = createOfferedGambitState("King's Gambit", 2);

    const beforeFen = "rnbqkbnr/pppp1ppp/8/4p3/4PP2/8/PPPP2PP/RNBQKBNR b KQkq f3 0 2";
    // After: 2... d6 (no pawn captured, material unchanged)
    const afterFen = "rnbqkbnr/ppp2ppp/3p4/4p3/4PP2/8/PPPP2PP/RNBQKBNR w KQkq - 0 3";

    const reply = resolveGambitReplyState({
      state: offered,
      aiColor: "white",
      beforeFen,
      afterFen,
    });

    expect(reply.status).toBe("declined");
    expect(reply.active).toBe(true);
    expect(reply.handoffMode).toBe("pressure");
  });

  it("transitions to refuted when evaluation stays below budget for 2 consecutive moves", () => {
    const activeGambit = createAcceptedGambitState({
      active: true,
      status: "accepted",
      cooldown: 0,
      attemptMoveNumber: 2,
      handoffMode: "exploitation",
      refuted: false,
      refutedCount: 0,
    });

    const budgetCp = 80;

    // Move 1: eval drops to -120cp (< -80cp) -> refutedCount becomes 1
    const check1 = checkGambitRefutation(activeGambit, -120, budgetCp);
    expect(check1.status).toBe("accepted");
    expect(check1.refutedCount).toBe(1);

    // Move 2: eval still drops to -130cp (< -80cp) -> refutedCount becomes 2 -> refuted!
    const check2 = checkGambitRefutation(check1, -130, budgetCp);
    expect(check2.status).toBe("refuted");
    expect(check2.active).toBe(false);
    expect(check2.refuted).toBe(true);
    expect(check2.handoffMode).toBe("recovery");
  });

  it("resets refutedCount if evaluation recovers within budget", () => {
    const activeGambit = {
      ...createAcceptedGambitState(),
      refutedCount: 1,
    };

    const budgetCp = 80;
    // Eval recovers to -40cp (within -80cp budget)
    const check = checkGambitRefutation(activeGambit, -40, budgetCp);
    expect(check.refutedCount).toBe(0);
    expect(check.status).toBe("accepted");
  });

  it("transitions to abandoned cleanly when requested", () => {
    const active = createAcceptedGambitState();
    const abandoned = createAbandonedGambitState(active);
    expect(abandoned.status).toBe("abandoned");
    expect(abandoned.active).toBe(false);
    expect(abandoned.handoffMode).toBe("clean");
  });

  it("decrements cooldown properly when in failed/refuted recovery mode", () => {
    const refuted = createRefutedGambitState();
    expect(refuted.cooldown).toBe(5);

    const step1 = decrementGambitCooldown(refuted, 2);
    expect(step1.cooldown).toBe(3);

    const step2 = decrementGambitCooldown(step1, 3);
    expect(step2.cooldown).toBe(0);
    expect(step2.status).toBe("idle");
  });
});
