
import type { Logger } from "pino";
import { env } from "../config/env.js";
import { HttpError } from "../types.js";
import { StockfishWorker } from "./stockfishWorker.js";


export type TaskPriority = 1 | 2;

interface QueueItem {
    readonly gameId: string;
    readonly priority: TaskPriority;
    readonly enqueuedAt: number;
    resolve: (worker: StockfishWorker) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
}

interface WorkerCrashRecord {
    timestamps: number[];
}

interface PoolMetrics {
    totalTasksDispatched: number;
    totalTasksFailed503: number;
    totalTasksFailedError: number;
    totalWorkerRestarts: number;
    totalWorkerPermanentFails: number;
    totalQueueTimeouts: number;
    totalBackgroundRejections: number;
    peakQueueDepth: number;
    peakActiveWorkers: number;
}



function isHardWorkerError(message: string | undefined): boolean {
    if (!message) return false;
    return (
        message.includes("Stockfish engine could not be started") ||
        message.includes("Failed to resolve Stockfish") ||
        message.includes("missing its src directory") ||
        message.includes("does not contain a runnable JavaScript engine entry")
    );
}



export class WorkerPool {
    private readonly workers: StockfishWorker[] = [];
    private readonly queue: QueueItem[] = [];
    private readonly crashRecords = new Map<number, WorkerCrashRecord>();
    private readonly consecutiveHeartbeatFailures = new Map<number, number>();

    private heartbeatTimer: NodeJS.Timeout | null = null;
    private metricsTimer: NodeJS.Timeout | null = null;
    private unavailableReason: string | null = null;
    private shuttingDown = false;

    private readonly metrics: PoolMetrics = {
        totalTasksDispatched: 0,
        totalTasksFailed503: 0,
        totalTasksFailedError: 0,
        totalWorkerRestarts: 0,
        totalWorkerPermanentFails: 0,
        totalQueueTimeouts: 0,
        totalBackgroundRejections: 0,
        peakQueueDepth: 0,
        peakActiveWorkers: 0,
    };

    constructor(private readonly logger: Logger) {}



    getUnavailableReason(): string | null {
        return this.hasUsableWorker()
            ? null
            : (this.unavailableReason ?? "Engine is still starting up");
    }

    getMetrics(): Readonly<PoolMetrics> {
        return { ...this.metrics };
    }


    async withWorker<T>(
        gameId: string,
        task: (worker: StockfishWorker) => Promise<T>,
        priority: TaskPriority = 1,
    ): Promise<T> {
        if (this.shuttingDown) {
            throw new HttpError(503, "Engine shutting down", {
                error: "Engine shutting down",
            });
        }


        const maxAttempts = priority === 1 ? 2 : 1;
        let attempt = 0;

        while (attempt < maxAttempts) {
            attempt += 1;
            const worker = await this.acquire(gameId, priority);

            try {
                const result = await task(worker);
                this.metrics.totalTasksDispatched += 1;
                return result;
            } catch (err) {

                if (err instanceof HttpError) {
                    this.metrics.totalTasksFailed503 += 1;
                    throw err;
                }


                const workerActuallyCrashed =
                    worker.getState() === "RESTARTING" ||
                    worker.getState() === "PERMANENTLY_FAILED";

                if (workerActuallyCrashed) {
                    this.logger.warn(
                        {
                            err,
                            gameId,
                            workerId: worker.getWorkerId(),
                            attempt,
                            maxAttempts,
                        },
                        "Engine task failed — worker crashed, recovering",
                    );
                    this.metrics.totalTasksFailedError += 1;
                    await this.recoverWorker(worker, err, "task");

                    if (attempt >= maxAttempts) throw err;
                    this.logger.info(
                        { gameId, attempt: attempt + 1 },
                        "Retrying engine task after worker recovery",
                    );
                } else {
                    this.logger.warn(
                        { err, gameId, workerId: worker.getWorkerId() },
                        "Engine task failed with application error — worker healthy, propagating",
                    );
                    this.metrics.totalTasksFailedError += 1;
                    throw err;
                }
            } finally {
                this.release(worker);
            }
        }

        throw new Error("Engine task failed after all retries");
    }



    async start(): Promise<void> {
        this.logger.info(
            { poolSize: env.WORKER_POOL_SIZE },
            "Starting worker pool",
        );

        for (let i = 0; i < env.WORKER_POOL_SIZE; i++) {
            const worker = new StockfishWorker(
                i + 1,
                this.logger.child({ workerId: i + 1 }),
            );
            this.workers.push(worker);

            void worker
                .initialize()
                .then(() => {
                    this.updateAvailability(null);


                    this.dispatchQueue();


                    void worker.warmup().then(() => {
                        this.updateAvailability(null);
                        this.dispatchQueue();
                    });
                })
                .catch((err: unknown) => {
                    const message =
                        err instanceof Error
                            ? err.message
                            : "Engine unavailable";
                    this.updateAvailability(message);
                    this.logger.error(
                        { err, workerId: i + 1 },
                        "Worker initialization failed",
                    );
                    if (this.recordCrash(worker.getWorkerId())) {
                        worker.setState("PERMANENTLY_FAILED");
                        this.metrics.totalWorkerPermanentFails += 1;
                    }
                });
        }

        this.heartbeatTimer = setInterval(
            () => void this.runHeartbeat(),
            env.HEARTBEAT_INTERVAL_MS,
        );


        this.metricsTimer = setInterval(
            () =>
                this.logger.info(
                    { ...this.metrics, ...this.snapshotPoolState() },
                    "Worker pool metrics",
                ),
            60_000,
        );
    }

    async stop(): Promise<void> {
        this.shuttingDown = true;
        this.logger.info("Stopping worker pool");

        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.metricsTimer) {
            clearInterval(this.metricsTimer);
            this.metricsTimer = null;
        }

        this.rejectQueuedRequests("Engine shutting down");
        await Promise.all(this.workers.map((w) => w.dispose()));
        this.logger.info("Worker pool stopped");
    }




    private acquire(
        gameId: string,
        priority: TaskPriority,
    ): Promise<StockfishWorker> {

        const idle = this.findIdleWorker();
        if (idle) {
            idle.setState("BUSY");
            return Promise.resolve(idle);
        }


        if (priority === 1) {
            const warmup = this.findWarmupWorker();
            if (warmup) {
                warmup.cancelWarmup();
                warmup.setState("BUSY");
                this.logger.debug(
                    { gameId },
                    "Pre-empted warmup worker for priority-1 request",
                );
                return Promise.resolve(warmup);
            }
        }


        if (this.hasHardUnavailableWorkers()) {
            const reason = this.unavailableReason ?? "Engine unavailable";
            return Promise.reject(
                new HttpError(503, reason, { error: reason }),
            );
        }


        if (priority === 2) {
            this.metrics.totalBackgroundRejections += 1;
            this.logger.debug(
                { gameId },
                "Background task rejected — all workers busy",
            );
            return Promise.reject(
                new HttpError(503, "Engine busy, retry", {
                    error: "Engine busy, retry",
                }),
            );
        }


        if (this.queue.length >= env.MAX_QUEUE_DEPTH) {
            this.metrics.totalTasksFailed503 += 1;
            return Promise.reject(
                new HttpError(503, "Engine queue full, retry after 2 seconds", {
                    error: "Engine queue full, retry after 2 seconds",
                    retryAfter: 2,
                }),
            );
        }

        return new Promise<StockfishWorker>((resolve, reject) => {
            const timeoutMs = env.WORKER_QUEUE_TIMEOUT_MS;

            const timeout = setTimeout(() => {
                const idx = this.queue.findIndex(
                    (item) =>
                        item.gameId === gameId && item.resolve === resolve,
                );
                if (idx >= 0) this.queue.splice(idx, 1);
                this.metrics.totalQueueTimeouts += 1;
                this.logger.warn(
                    { gameId, queueDepth: this.queue.length },
                    "Queue timeout for priority-1 request",
                );
                reject(
                    new HttpError(503, "Engine busy, retry", {
                        error: "Engine busy, retry",
                    }),
                );
            }, timeoutMs);

            const item: QueueItem = {
                gameId,
                priority,
                enqueuedAt: Date.now(),
                resolve,
                reject,
                timeout,
            };

            this.queue.push(item);
            this.metrics.peakQueueDepth = Math.max(
                this.metrics.peakQueueDepth,
                this.queue.length,
            );


            this.queue.sort(
                (a, b) =>
                    a.priority - b.priority || a.enqueuedAt - b.enqueuedAt,
            );
        });
    }

    private release(worker: StockfishWorker): void {
        const state = worker.getState();
        if (state === "RESTARTING" || state === "PERMANENTLY_FAILED") return;
        worker.setState("IDLE");
        this.dispatchQueue();
    }



    private dispatchQueue(): void {
        while (this.queue.length > 0) {
            let worker = this.findIdleWorker();

            if (!worker) {

                const head = this.queue[0];
                if (head?.priority === 1) {
                    const warmup = this.findWarmupWorker();
                    if (warmup) {
                        warmup.cancelWarmup();
                        worker = warmup;
                    }
                }
            }

            if (!worker) break;

            const item = this.queue.shift()!;
            clearTimeout(item.timeout);
            worker.setState("BUSY");

            const queueWaitMs = Date.now() - item.enqueuedAt;
            this.logger.debug(
                {
                    gameId: item.gameId,
                    priority: item.priority,
                    queueWaitMs,
                    workerId: worker.getWorkerId(),
                },
                "Dispatched queued request to worker",
            );

            item.resolve(worker);
        }


        const active = this.workers.filter(
            (w) => w.getState() === "BUSY",
        ).length;
        this.metrics.peakActiveWorkers = Math.max(
            this.metrics.peakActiveWorkers,
            active,
        );
    }




    private findIdleWorker(): StockfishWorker | null {
        let best: StockfishWorker | null = null;
        let bestIdleAt = Infinity;

        for (const worker of this.workers) {
            if (worker.getState() !== "IDLE") continue;
            const idleAt = worker.getLastIdleAt();
            if (idleAt < bestIdleAt) {
                bestIdleAt = idleAt;
                best = worker;
            }
        }

        return best;
    }

    private findWarmupWorker(): StockfishWorker | null {
        return this.workers.find((w) => w.getState() === "WARMUP") ?? null;
    }



    private hasUsableWorker(): boolean {
        return this.workers.some((w) => {
            const s = w.getState();
            return s === "IDLE" || s === "BUSY" || s === "WARMUP";
        });
    }

    private hasHardUnavailableWorkers(): boolean {
        return (
            this.workers.length > 0 &&
            this.workers.every(
                (w) =>
                    isHardWorkerError(w.getLastError()?.message) ||
                    w.getState() === "PERMANENTLY_FAILED",
            )
        );
    }

    private updateAvailability(reason: string | null): void {
        const next = this.hasUsableWorker()
            ? null
            : (reason ?? this.unavailableReason ?? "Engine unavailable");
        if (next !== this.unavailableReason) {
            this.unavailableReason = next;
            if (next) {
                this.logger.warn(
                    { reason: next },
                    "Worker pool became unavailable",
                );
            } else {
                this.logger.info("Worker pool is available again");
            }
        }
    }

    private rejectQueuedRequests(reason: string): void {
        while (this.queue.length > 0) {
            const item = this.queue.shift()!;
            clearTimeout(item.timeout);
            item.reject(new HttpError(503, reason, { error: reason }));
        }
    }




    private recordCrash(workerId: number): boolean {
        const now = Date.now();
        const record = this.crashRecords.get(workerId) ?? { timestamps: [] };


        record.timestamps = record.timestamps.filter(
            (t) => now - t < env.WORKER_CRASH_WINDOW_MS,
        );
        record.timestamps.push(now);
        this.crashRecords.set(workerId, record);

        if (record.timestamps.length > env.MAX_WORKER_CRASHES) {
            this.logger.error(
                {
                    workerId,
                    crashCount: record.timestamps.length,
                    windowMs: env.WORKER_CRASH_WINDOW_MS,
                },
                "Worker exceeded crash limit — permanently removing from pool",
            );
            return true;
        }

        return false;
    }


    private async recoverWorker(
        worker: StockfishWorker,
        err: unknown,
        context: "heartbeat" | "task",
    ): Promise<void> {
        if (this.recordCrash(worker.getWorkerId())) {
            worker.setState("PERMANENTLY_FAILED");
            this.metrics.totalWorkerPermanentFails += 1;
            const msg = "Worker permanently failed due to crash loop";
            this.updateAvailability(msg);
            this.logger.error({ workerId: worker.getWorkerId(), context }, msg);
            return;
        }

        const message =
            err instanceof Error ? err.message : "Engine unavailable";
        worker.setState("RESTARTING");
        this.updateAvailability(message);
        this.metrics.totalWorkerRestarts += 1;

        try {
            await worker.dispose();
            await worker.initialize();
            this.updateAvailability(null);
            this.dispatchQueue();
            this.logger.info(
                { workerId: worker.getWorkerId(), context },
                "Worker recovered successfully",
            );
        } catch (restartErr: unknown) {
            const restartMsg =
                restartErr instanceof Error
                    ? restartErr.message
                    : "Engine unavailable";
            this.updateAvailability(restartMsg);
            this.logger.error(
                { err: restartErr, workerId: worker.getWorkerId(), context },
                "Worker recovery failed",
            );

            if (this.recordCrash(worker.getWorkerId())) {
                worker.setState("PERMANENTLY_FAILED");
                this.metrics.totalWorkerPermanentFails += 1;
            } else {
                worker.scheduleRestart();
            }
        }
    }




    private async runHeartbeat(): Promise<void> {
        const checks = this.workers
            .filter((w) => w.getState() === "IDLE")
            .map(async (worker) => {
                try {
                    await worker.ping();
                    this.consecutiveHeartbeatFailures.set(
                        worker.getWorkerId(),
                        0,
                    );
                    this.updateAvailability(null);
                } catch (err: unknown) {
                    const fails =
                        (this.consecutiveHeartbeatFailures.get(
                            worker.getWorkerId(),
                        ) ?? 0) + 1;
                    this.consecutiveHeartbeatFailures.set(
                        worker.getWorkerId(),
                        fails,
                    );

                    if (fails >= 3) {
                        this.logger.error(
                            {
                                workerId: worker.getWorkerId(),
                                consecutiveFailures: fails,
                            },
                            "Worker failed 3 consecutive heartbeats — force restarting",
                        );
                        this.consecutiveHeartbeatFailures.set(
                            worker.getWorkerId(),
                            0,
                        );
                        await worker.dispose();
                        await this.recoverWorker(worker, err, "heartbeat");
                    } else {
                        this.logger.warn(
                            {
                                err,
                                workerId: worker.getWorkerId(),
                                consecutiveFailures: fails,
                            },
                            "Worker heartbeat failed — will retry",
                        );
                    }
                }
            });

        await Promise.allSettled(checks);
    }



    private snapshotPoolState() {
        const stateCounts: Record<string, number> = {};
        for (const worker of this.workers) {
            const s = worker.getState();
            stateCounts[s] = (stateCounts[s] ?? 0) + 1;
        }
        return {
            queueDepth: this.queue.length,
            workerStates: stateCounts,
        };
    }
}
