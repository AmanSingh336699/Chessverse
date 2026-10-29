import { describe, expect, it, vi } from "vitest";
import { WorkerPool } from "./workerPool.js";
import type { StockfishWorker } from "./stockfishWorker.js";
import pino from "pino";

const logger = pino({ level: "silent" });

function createMockWorker(id: number, initialState: "IDLE" | "BUSY" | "WARMUP" | "RESTARTING" = "IDLE") {
  let state = initialState;
  return {
    getWorkerId: () => id,
    getState: () => state,
    setState: (newState: "IDLE" | "BUSY" | "WARMUP" | "RESTARTING") => {
      state = newState;
    },
    isOperational: () => state !== "RESTARTING",
    isPermanentlyFailed: () => false,
    getLastIdleAt: () => Date.now(),
    stopSearch: vi.fn(),
    cancelWarmup: vi.fn(),
    initialize: vi.fn().mockResolvedValue(undefined),
    warmup: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  } as unknown as StockfishWorker;
}

describe("WorkerPool - Preemption & Crash Recovery (Phase 1)", () => {
  it("engine crash mid-search -> recovers worker and retries so move still comes back", async () => {
    const pool = new WorkerPool(logger);

    const worker1 = createMockWorker(1, "IDLE");
    // Inject mock workers into private field
    Object.assign(pool, { workers: [worker1] });

    let attempts = 0;
    const task = vi.fn().mockImplementation(async (w: StockfishWorker) => {
      attempts++;
      if (attempts === 1) {
        // Simulate crash mid-search on first attempt
        (w as any).setState("RESTARTING");
        throw new Error("Worker process died unexpectedly");
      }
      // On second attempt (after recovery/restart), task succeeds
      return { move: "e7e5", evaluation: 20 };
    });

    // Mock recoverWorker to reset state to IDLE
    vi.spyOn(pool as any, "recoverWorker").mockImplementation(async (w: any) => {
      w.setState("IDLE");
    });

    const result = await pool.withWorker("game-crash-test", task, 1);

    expect(attempts).toBe(2);
    expect(result).toEqual({ move: "e7e5", evaluation: 20 });
  });

  it("reserves dedicated worker for interactive priority-1 moves against background tasks", async () => {
    const pool = new WorkerPool(logger);
    const worker1 = createMockWorker(1, "IDLE");
    const worker2 = createMockWorker(2, "IDLE");
    Object.assign(pool, { workers: [worker1, worker2] });

    // Worker 1 becomes busy with something
    (worker1 as any).setState("BUSY");

    // Only 1 idle worker remains. A background task (priority 2) should be rejected
    // to preserve that last worker for interactive player moves.
    await expect(
      (pool as any).acquire("game-bg", 2),
    ).rejects.toMatchObject({
      statusCode: 503,
      message: "Engine busy, retry",
    });

    // An interactive player move (priority 1) SHOULD be allowed to acquire the idle worker
    const acquired = await (pool as any).acquire("game-interactive", 1);
    expect(acquired).toBe(worker2);
  });

  it("interactive priority-1 task preempts background analysis by calling stopSearch()", async () => {
    const pool = new WorkerPool(logger);
    const worker1 = createMockWorker(1, "BUSY");
    Object.assign(pool, { workers: [worker1] });

    // Mark worker 1 as currently running a background task (priority 2)
    (pool as any).workerTaskPriority.set(1, 2);

    // Call acquire with priority 1
    // It should trigger worker1.stopSearch() to preempt the background calculation
    try {
      await (pool as any).acquire("game-interactive-preempt", 1);
    } catch {
      // It may enqueue or reject if queue is full, but stopSearch must have been invoked
    }

    expect(worker1.stopSearch).toHaveBeenCalled();
  });
});
