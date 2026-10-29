import { describe, expect, it } from "vitest";
import {
  createGameRequestSchema,
  defaultEngineState,
  difficultySchema,
  engineModeSchema,
  gameStatusSchema,
  moveRequestSchema,
  playerMoveRequestSchema,
  styleIdSchema,
  styleProfileSchema,
  STYLE_PROFILES,
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
    it("validates UCI square coordinate moves with clientMoveId and expectedPly", () => {
      const move = playerMoveRequestSchema.parse({
        clientMoveId: "move-1",
        expectedPly: 0,
        from: "e2",
        to: "e4",
      });
      expect(move.clientMoveId).toBe("move-1");
      expect(move.expectedPly).toBe(0);
      expect(move.from).toBe("e2");
      expect(move.to).toBe("e4");
      expect(move.promotion).toBeUndefined();
    });

    it("supports pawn promotion pieces", () => {
      const move = playerMoveRequestSchema.parse({
        clientMoveId: "move-2",
        expectedPly: 20,
        from: "e7",
        to: "e8",
        promotion: "q",
      });
      expect(move.promotion).toBe("q");
    });

    it("rejects missing clientMoveId or negative expectedPly", () => {
      expect(() =>
        playerMoveRequestSchema.parse({
          expectedPly: 0,
          from: "e2",
          to: "e4",
        }),
      ).toThrow();

      expect(() =>
        playerMoveRequestSchema.parse({
          clientMoveId: "move-3",
          expectedPly: -1,
          from: "e2",
          to: "e4",
        }),
      ).toThrow();
    });

    it("rejects invalid square lengths", () => {
      expect(() =>
        playerMoveRequestSchema.parse({
          clientMoveId: "move-4",
          expectedPly: 0,
          from: "e22",
          to: "e4",
        }),
      ).toThrow();
      expect(() =>
        playerMoveRequestSchema.parse({
          clientMoveId: "move-5",
          expectedPly: 0,
          from: "e2",
          to: "",
        }),
      ).toThrow();
    });
  });

  describe("defaultEngineState", () => {
    it("returns standard idle state structure with style and mode", () => {
      const state = defaultEngineState("aggressive");
      expect(state.behaviorSuccessScore).toBe(0);
      expect(state.currentRecoveryMode).toBe("none");
      expect(state.style).toBe("aggressive");
      expect(state.mode).toBe("opening");
      expect(state.gambit.active).toBe(false);
      expect(state.gambit.status).toBe("idle");
      expect(state.trapSequence.active).toBe(false);
      expect(state.sacrificeTracking.active).toBe(false);
      expect(state.complexityDial).toBe(5);
    });
  });

  describe("styleProfileSchema & STYLE_PROFILES", () => {
    it("every predefined profile passes schema validation", () => {
      const styles = ["aggressive", "gambiteer", "tricky", "solid"] as const;
      for (const id of styles) {
        const profile = STYLE_PROFILES[id];
        expect(profile).toBeDefined();
        const parsed = styleProfileSchema.parse(profile);
        expect(parsed.id).toBe(id);
        expect(parsed.multiPv).toBeGreaterThanOrEqual(6);
        expect(parsed.multiPv).toBeLessThanOrEqual(10);
        expect(parsed.evalBudgetCp.opening).toBeGreaterThan(0);
        expect(parsed.temperature).toBeGreaterThan(0);
      }
    });

    it("parses style in createGameRequestSchema", () => {
      const withDefault = createGameRequestSchema.parse({});
      expect(withDefault.style).toBe("solid");

      const explicit = createGameRequestSchema.parse({ style: "gambiteer" });
      expect(explicit.style).toBe("gambiteer");
    });

    it("rejects invalid style", () => {
      expect(() => styleIdSchema.parse("invalid-style")).toThrow();
    });
  });
});
