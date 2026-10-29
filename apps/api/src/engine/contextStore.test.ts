import { describe, expect, it, vi } from "vitest";
import { ContextStore } from "./contextStore.js";
import pino from "pino";

const logger = pino({ level: "silent" });

describe("ContextStore - Lock Renewal & Concurrency Protection (Phase 1)", () => {
  it("when Redis is not connected, acquireLock returns a no-op release function", async () => {
    const store = new ContextStore(logger);
    // Not calling connect()
    const release = await store.acquireLock("game-1");
    expect(release).not.toBeNull();
    await expect(release!()).resolves.toBeUndefined();
  });

  it("acquireLock acquires lock via Redis SET NX EX and releases cleanly", async () => {
    const store = new ContextStore(logger);

    const mockRedis = {
      set: vi.fn().mockResolvedValue("OK"),
      eval: vi.fn().mockResolvedValue(1),
    };

    // Inject mock redis client into private property
    Object.assign(store, { redis: mockRedis });

    const release = await store.acquireLock("game-test-lock");
    expect(release).not.toBeNull();
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining("game-test-lock"),
      expect.any(String),
      "EX",
      expect.any(Number),
      "NX",
    );

    // Call release
    await release!();
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call(\"del\""),
      1,
      expect.stringContaining("game-test-lock"),
      expect.any(String),
    );
  });

  it("search slower than old lock TTL: renewal heartbeat fires to extend expiration", async () => {
    vi.useFakeTimers();

    const store = new ContextStore(logger);
    const mockRedis = {
      set: vi.fn().mockResolvedValue("OK"),
      eval: vi.fn().mockResolvedValue(1),
    };
    Object.assign(store, { redis: mockRedis });

    const release = await store.acquireLock("long-search-game");
    expect(release).not.toBeNull();

    // Advance timers by 6 seconds (exceeding 1/3 of 15s lock TTL)
    await vi.advanceTimersByTimeAsync(6000);

    // Renewal script must have been called via eval
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining("expire"),
      1,
      expect.stringContaining("long-search-game"),
      expect.any(String),
      expect.any(Number),
    );

    // Cleanup
    await release!();
    vi.useRealTimers();
  });

  it("concurrent acquisition fails when lock is already held", async () => {
    const store = new ContextStore(logger);
    const mockRedis = {
      set: vi.fn().mockResolvedValue(null), // Redis returns null when NX fails
    };
    Object.assign(store, { redis: mockRedis });

    const release = await store.acquireLock("contested-game");
    expect(release).toBeNull();
  });
});
