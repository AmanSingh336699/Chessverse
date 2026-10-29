import { describe, expect, it } from "vitest";
import {
  createGameRequestSchema,
  defaultEngineState,
  difficultySchema,
  engineModeSchema,
  gameHistoryResponseSchema,
  gameStatusSchema,
  loginRequestSchema,
  moveRequestSchema,
  playerMoveRequestSchema,
  registerRequestSchema,
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

  describe("Phase 3: Auth & Game History Schemas", () => {
    it("validates valid register request", () => {
      const valid = {
        username: "magnus_carlsen",
        email: "magnus@example.com",
        password: "secretPassword123",
      };
      expect(() => registerRequestSchema.parse(valid)).not.toThrow();
    });

    it("rejects invalid username with spaces or special characters", () => {
      expect(() =>
        registerRequestSchema.parse({
          username: "magnus carlsen!",
          email: "magnus@example.com",
          password: "password123",
        }),
      ).toThrow();
    });

    it("validates login request with username or email", () => {
      expect(
        loginRequestSchema.parse({
          usernameOrEmail: "magnus_carlsen",
          password: "password123",
        }),
      ).toEqual({
        usernameOrEmail: "magnus_carlsen",
        password: "password123",
      });
    });

    it("validates gameHistoryResponseSchema structure", () => {
      const history = {
        total: 1,
        games: [
          {
            gameId: "123e4567-e89b-12d3-a456-426614174000",
            userId: "123e4567-e89b-12d3-a456-426614174001",
            playerColor: "white",
            difficulty: "advanced",
            style: "aggressive",
            status: "checkmate",
            result: "win",
            totalMoves: 34,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            previewFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
          },
        ],
      };
      expect(() => gameHistoryResponseSchema.parse(history)).not.toThrow();
    });
  });
});
