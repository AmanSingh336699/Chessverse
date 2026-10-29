import { describe, expect, it, afterAll, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server.js";

describe("Server HTTP endpoints & Middleware (Phase 1)", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  }, 30000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("GET /health returns 200 with engine and opening book status", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("ok");
    expect(typeof body.engineAvailable).toBe("boolean");
    expect(typeof body.openingBookLoaded).toBe("boolean");
  });

  it("GET /ready returns 200 or 503 depending on engine and DB availability", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/ready",
    });

    // Should return 200 (ready) or 503 (degraded)
    expect([200, 503]).toContain(res.statusCode);
    const body = JSON.parse(res.body);
    expect(["ready", "degraded"]).toContain(body.status);
  });

  it("POST with payload > 1MB returns 413 Payload Too Large", async () => {
    // 1MB + 100KB payload
    const hugePayload = "x".repeat(1024 * 1024 + 100);
    const res = await app.inject({
      method: "POST",
      url: "/games",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ difficulty: "medium", playerColor: "white", padding: hugePayload }),
    });

    expect(res.statusCode).toBe(413);
  });

  it("Security headers: Helmet adds security headers to response", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });

  it("POST /games with invalid style returns 400 Bad Request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/games",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        difficulty: "intermediate",
        playerColor: "white",
        style: "invalid-super-style",
      }),
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("Bad Request");
  });

  it("POST /games with valid style initializes game with selected style", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/games",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        difficulty: "intermediate",
        playerColor: "white",
        style: "gambiteer",
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.style).toBe("gambiteer");
    expect(body.engineState.style).toBe("gambiteer");
  });

  it("POST /games/:id/draw-offer evaluates style draw acceptance", async () => {
    // 1. Create a game with Solid style
    const createRes = await app.inject({
      method: "POST",
      url: "/games",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        difficulty: "intermediate",
        playerColor: "white",
        style: "solid",
      }),
    });
    const game = JSON.parse(createRes.body);

    // 2. Offer draw at starting position (0cp eval)
    const drawRes = await app.inject({
      method: "POST",
      url: `/games/${game.gameId}/draw-offer`,
    });

    expect(drawRes.statusCode).toBe(200);
    const drawBody = JSON.parse(drawRes.body);
    // Solid style accepts equal eval (0cp)
    expect(drawBody.accepted).toBe(true);
    expect(drawBody.game.status).toBe("draw");
  });

  describe("Phase 3: Auth & Game History API", () => {
    let authToken = "";
    let registeredUserId = "";

    it("POST /auth/register creates user account and returns token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/register",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          username: "fisher_60",
          email: "bobby@example.com",
          password: "mySecretPassword123",
        }),
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.token).toBeDefined();
      expect(body.user.username).toBe("fisher_60");
      expect(body.user.email).toBe("bobby@example.com");
      authToken = body.token;
      registeredUserId = body.user.id;
    });

    it("POST /auth/login authenticates registered user", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          usernameOrEmail: "fisher_60",
          password: "mySecretPassword123",
        }),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.token).toBeDefined();
      expect(body.user.id).toBe(registeredUserId);
    });

    it("GET /auth/me returns current user profile with Bearer token", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.id).toBe(registeredUserId);
      expect(body.username).toBe("fisher_60");
    });

    it("POST /games with Authorization header associates game with user", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/games",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${authToken}`,
        },
        payload: JSON.stringify({
          difficulty: "intermediate",
          playerColor: "white",
          style: "tricky",
        }),
      });

      expect(createRes.statusCode).toBe(200);
      const game = JSON.parse(createRes.body);
      expect(game.userId).toBe(registeredUserId);
      expect(game.style).toBe("tricky");

      // Verify game appears in history
      const historyRes = await app.inject({
        method: "GET",
        url: "/games/history",
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      expect(historyRes.statusCode).toBe(200);
      const history = JSON.parse(historyRes.body);
      expect(history.total).toBeGreaterThanOrEqual(1);
      expect(history.games.some((g: any) => g.gameId === game.gameId)).toBe(true);
    });
  });

  it("Rate limit: returns 429 Too Many Requests when rate limit is exceeded", async () => {
    let got429 = false;
    for (let i = 0; i < 150; i++) {
      const res = await app.inject({
        method: "GET",
        url: "/health",
      });
      if (res.statusCode === 429) {
        got429 = true;
        const body = JSON.parse(res.body);
        expect(body.statusCode).toBe(429);
        expect(body.error).toBe("Too Many Requests");
        expect(body.message).toContain("Rate limit exceeded");
        break;
      }
    }
    expect(got429).toBe(true);
  });
});
