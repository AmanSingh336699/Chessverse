import { describe, expect, it } from "vitest";
import {
  createGameRequestSchema,
  defaultEngineState,
  difficultySchema,
  engineModeSchema,
  gameStatusSchema,
  moveRequestSchema,
  playerMoveRequestSchema,
  undoRequestSchema,
} from "./index.js";

describe("@chessverse/contracts", () => {
  describe("difficultySchema", () => {
    it("accepts valid difficulties", () => {
      const valid = ["beginner", "intermediate", "advanced", "master"];
      for (const diff of valid) {
        expect(difficultySchema.parse(diff)).toBe(diff);
      }
    });

    it("rejects invalid difficulties", () => {
      expect(() => difficultySchema.parse("grandmaster")).toThrow();
      expect(() => difficultySchema.parse("")).toThrow();
    });
  });

  describe("engineModeSchema", () => {
    it("accepts supported engine modes", () => {
      const modes = ["gambit", "trap", "sacrifice", "aggressive", "psychological", "stockfish"];
      for (const mode of modes) {
        expect(engineModeSchema.parse(mode)).toBe(mode);
      }
    });
  });

  describe("createGameRequestSchema", () => {
    it("uses default values when body is empty", () => {
      const parsed = createGameRequestSchema.parse({});
      expect(parsed.playerColor).toBe("white");
      expect(parsed.difficulty).toBe("advanced");
    });

    it("parses explicit playerColor and difficulty", () => {
      const parsed = createGameRequestSchema.parse({
        playerColor: "black",
        difficulty: "beginner",
      });
      expect(parsed.playerColor).toBe("black");
      expect(parsed.difficulty).toBe("beginner");
    });
  });

  describe("playerMoveRequestSchema", () => {
    it("validates UCI square coordinate moves", () => {
      const move = playerMoveRequestSchema.parse({
        from: "e2",
        to: "e4",
      });
      expect(move.from).toBe("e2");
      expect(move.to).toBe("e4");
      expect(move.promotion).toBeUndefined();
    });

    it("supports pawn promotion pieces", () => {
      const move = playerMoveRequestSchema.parse({
        from: "e7",
        to: "e8",
        promotion: "q",
      });
      expect(move.promotion).toBe("q");
    });

    it("rejects invalid square lengths", () => {
      expect(() => playerMoveRequestSchema.parse({ from: "e22", to: "e4" })).toThrow();
      expect(() => playerMoveRequestSchema.parse({ from: "e2", to: "" })).toThrow();
    });
  });

  describe("defaultEngineState", () => {
    it("returns standard idle state structure", () => {
      const state = defaultEngineState();
      expect(state.behaviorSuccessScore).toBe(0);
      expect(state.currentRecoveryMode).toBe("none");
      expect(state.gambit.active).toBe(false);
      expect(state.gambit.status).toBe("idle");
      expect(state.trapSequence.active).toBe(false);
      expect(state.sacrificeTracking.active).toBe(false);
      expect(state.complexityDial).toBe(5);
    });
  });
});
