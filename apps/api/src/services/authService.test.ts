import { describe, expect, it } from "vitest";
import { AuthService } from "./authService.js";
import { InMemoryGameRepository } from "../repositories/memoryGameRepository.js";
import { HttpError, type StoredGame } from "../types.js";
import { defaultEngineState } from "@chessverse/contracts";

describe("AuthService (Phase 3)", () => {
  const repository = new InMemoryGameRepository();
  const authService = new AuthService(repository, "test-super-secret-key-32-chars-long");

  it("hashes passwords securely and verifies them accurately", () => {
    const password = "mySecurePassword123!";
    const hash = authService.hashPassword(password);
    expect(hash).toContain(":");

    expect(authService.verifyPassword(password, hash)).toBe(true);
    expect(authService.verifyPassword("wrongPassword", hash)).toBe(false);
  });

  it("creates and verifies signed HMAC tokens, rejecting tampered tokens", () => {
    const payload = { userId: "user-123", username: "grandmaster" };
    const token = authService.createToken(payload, 3600);

    const verified = authService.verifyToken(token);
    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe("user-123");
    expect(verified?.username).toBe("grandmaster");

    // Tampered payload
    const parts = token.split(".");
    const tamperedToken = `${parts[0]}tampered.${parts[1]}`;
    expect(authService.verifyToken(tamperedToken)).toBeNull();

    // Expired token
    const expiredToken = authService.createToken(payload, -10);
    expect(authService.verifyToken(expiredToken)).toBeNull();
  });

  it("registers a new user and denies duplicates", async () => {
    const res = await authService.register({
      username: "kasparov_tactics",
      email: "kasparov@example.com",
      password: "password123",
    });

    expect(res.token).toBeDefined();
    expect(res.user.username).toBe("kasparov_tactics");
    expect(res.user.email).toBe("kasparov@example.com");
    expect(res.user.stats.gamesPlayed).toBe(0);

    // Duplicate username
    await expect(
      authService.register({
        username: "kasparov_tactics",
        email: "other@example.com",
        password: "password123",
      }),
    ).rejects.toThrow(HttpError);

    // Duplicate email
    await expect(
      authService.register({
        username: "other_user",
        email: "kasparov@example.com",
        password: "password123",
      }),
    ).rejects.toThrow(HttpError);
  });

  it("authenticates via login with username or email and computes game stats", async () => {
    const reg = await authService.register({
      username: "tal_sacrificer",
      email: "tal@example.com",
      password: "flamePassword123",
    });

    const now = new Date().toISOString();
    // Simulate past games for Tal
    const winGame: StoredGame = {
      gameId: "game-tal-1",
      userId: reg.user.id,
      playerColor: "white",
      difficulty: "master",
      style: "aggressive",
      fen: "8/8/8/8/8/8/8/8 w - - 0 1",
      status: "checkmate",
      moveHistory: [],
      evaluation: null,
      engineState: defaultEngineState("aggressive"),
      result: "win",
      totalMoves: 42,
      startTime: now,
      endTime: now,
      createdAt: now,
      updatedAt: now,
    };
    const drawGame: StoredGame = {
      ...winGame,
      gameId: "game-tal-2",
      style: "aggressive",
      result: "draw",
      status: "draw",
    };

    await repository.saveGame(winGame);
    await repository.saveGame(drawGame);

    // Login with username
    const loginUser = await authService.login({
      usernameOrEmail: "tal_sacrificer",
      password: "flamePassword123",
    });
    expect(loginUser.token).toBeDefined();
    expect(loginUser.user.stats.gamesPlayed).toBe(2);
    expect(loginUser.user.stats.wins).toBe(1);
    expect(loginUser.user.stats.draws).toBe(1);
    expect(loginUser.user.stats.winRate).toBe(50);
    expect(loginUser.user.stats.favoriteStyle).toBe("aggressive");

    // Login with email
    const loginEmail = await authService.login({
      usernameOrEmail: "tal@example.com",
      password: "flamePassword123",
    });
    expect(loginEmail.user.id).toBe(reg.user.id);

    // Invalid password throws 401
    await expect(
      authService.login({
        usernameOrEmail: "tal_sacrificer",
        password: "wrongPassword",
      }),
    ).rejects.toThrow(HttpError);
  });
});
