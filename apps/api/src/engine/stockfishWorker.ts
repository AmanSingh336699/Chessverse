import { existsSync, readdirSync, readFileSync, readlinkSync } from "fs";
import { dirname, extname, resolve } from "path";
import { createRequire } from "module";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { createInterface, type Interface } from "readline";
import type { CandidateMove } from "../contracts.js";
import type { Logger } from "pino";
import { env } from "../config/env.js";
import type { AnalysisResult, WorkerState } from "../types.js";



const require = createRequire(import.meta.url);

const MULTI_PV = 10;
const MIN_STABLE_DEPTH = 10;

const EARLY_EXIT_CONSECUTIVE_DEPTHS = 3;
const EARLY_EXIT_EVAL_VARIANCE = 0.1;
const EARLY_EXIT_MIN_TIME_FRACTION = 0.6;
const EARLY_EXIT_MIN_ABS_MS = 400;

type EngineCommand = {
    readonly command: string;
    readonly args: readonly string[];
    readonly source: string;
};

type StockfishPackageMeta = {
    main?: string;
};

type LineListener = (line: string) => void;

interface AnalysisOptions {
    signal?: AbortSignal;
    noFallback?: boolean;
}



const JS_ENGINE_EXTENSIONS = new Set([".js", ".cjs", ".mjs"]);

function getNodeWasmArgs(): string[] {
    const major = Number.parseInt(
        process.versions.node.split(".")[0] ?? "0",
        10,
    );
    if (major >= 14 && major < 19) {
        return ["--experimental-wasm-simd", "--experimental-wasm-threads"];
    }
    return [];
}

function createNodeEngineCommand(
    entryPath: string,
    source: string,
): EngineCommand {
    return {
        command: process.execPath,
        args: [...getNodeWasmArgs(), entryPath],
        source,
    };
}

function resolveExplicitEngineCommand(enginePath: string): EngineCommand {
    const ext = extname(enginePath).toLowerCase();
    if (JS_ENGINE_EXTENSIONS.has(ext)) {
        return createNodeEngineCommand(
            enginePath,
            `STOCKFISH_PATH override (${enginePath})`,
        );
    }
    return {
        command: enginePath,
        args: [],
        source: `STOCKFISH_PATH override (${enginePath})`,
    };
}

function scorePackagedEngine(fileName: string): number {
    if (!/^stockfish-.*\.js$/i.test(fileName)) return Number.NEGATIVE_INFINITY;
    let score = 0;
    if (!fileName.includes("lite")) score += 40;
    if (!fileName.includes("asm")) score += 30;
    if (!fileName.includes("single")) score += 20;
    if (fileName.includes("worker")) score -= 100;
    return score;
}

function resolvePackageAlias(
    packageDir: string,
    relative: string | undefined,
): string | null {
    if (!relative) return null;
    const candidate = resolve(packageDir, relative);
    if (!existsSync(candidate)) return null;
    try {
        return resolve(dirname(candidate), readlinkSync(candidate));
    } catch {
        return candidate;
    }
}

function resolvePackagedStockfishEntry(
    packageDir: string,
    meta: StockfishPackageMeta,
): string {
    for (const alias of [meta.main, "src/stockfish.js"]) {
        const resolved = resolvePackageAlias(packageDir, alias);
        if (resolved) return resolved;
    }

    const srcDir = resolve(packageDir, "src");
    if (!existsSync(srcDir)) {
        throw new Error(
            "The installed stockfish npm package is missing its src directory.",
        );
    }

    const best = readdirSync(srcDir)
        .filter((f) => JS_ENGINE_EXTENSIONS.has(extname(f).toLowerCase()))
        .map((f) => ({ f, score: scorePackagedEngine(f) }))
        .filter((c) => Number.isFinite(c.score))
        .sort((a, b) => b.score - a.score || a.f.localeCompare(b.f))[0];

    if (!best) {
        throw new Error(
            "The installed stockfish npm package does not contain a runnable JavaScript engine entry.",
        );
    }

    return resolve(srcDir, best.f);
}

function resolveStockfishPackageCommand(): EngineCommand {
    const pkgJsonPath = require.resolve("stockfish/package.json");
    const pkgDir = dirname(pkgJsonPath);
    const meta = JSON.parse(
        readFileSync(pkgJsonPath, "utf8"),
    ) as StockfishPackageMeta;
    const entry = resolvePackagedStockfishEntry(pkgDir, meta);
    return createNodeEngineCommand(entry, `npm package stockfish (${entry})`);
}

function resolveEngineCommand(): EngineCommand {
    return env.STOCKFISH_PATH
        ? resolveExplicitEngineCommand(env.STOCKFISH_PATH)
        : resolveStockfishPackageCommand();
}

function formatStockfishError(
    err: NodeJS.ErrnoException,
    source: string,
): Error {
    if (err.code === "ENOENT") {
        return new Error(
            `Stockfish engine could not be started from ${source}. ` +
                `Run 'npm install' inside apps/api to install the stockfish package, ` +
                `or set STOCKFISH_PATH to a valid binary override.`,
        );
    }
    return new Error(
        `Failed to start Stockfish from ${source}: ${err.message}`,
    );
}

export function isMissingBinaryError(err: Error | null): boolean {
    if (!err) return false;
    return (
        err.message.includes("Stockfish engine could not be started") ||
        err.message.includes("Failed to resolve Stockfish") ||
        err.message.includes("missing its src directory") ||
        err.message.includes(
            "does not contain a runnable JavaScript engine entry",
        )
    );
}



function parseInfoLine(line: string): CandidateMove | null {
    if (
        !line.startsWith("info") ||
        !line.includes(" multipv ") ||
        !line.includes(" pv ")
    ) {
        return null;
    }

    const depthMatch = line.match(/ depth (\d+)/);
    const multipvMatch = line.match(/ multipv (\d+)/);
    const scoreMatch = line.match(/ score (cp|mate) (-?\d+)/);
    const pvMatch = line.match(/ pv ([a-h][1-8][a-h][1-8][nbrq]?)/);

    if (!depthMatch || !multipvMatch || !scoreMatch || !pvMatch) return null;

    const depth = Number(depthMatch[1]!);
    const multipv = Number(multipvMatch[1]!);
    const scoreType = scoreMatch[1]! as "cp" | "mate";
    const rawScore = Number(scoreMatch[2]!);

    return {
        move: pvMatch[1]!,
        eval: Number(
            (scoreType === "cp"
                ? rawScore / 100
                : rawScore > 0
                  ? 100
                  : -100
            ).toFixed(2),
        ),
        multipv,
        depth,
        mate: scoreType === "mate" ? rawScore : null,
    };
}



export class StockfishWorker {

    private process: ChildProcessWithoutNullStreams | null = null;
    private rl: Interface | null = null;


    private readonly lineListeners = new Set<LineListener>();


    private initialized = false;
    private initializingPromise: Promise<void> | null = null;
    private restartTimer: NodeJS.Timeout | null = null;
    private state: WorkerState = "INITIALIZING";
    private shuttingDown = false;
    private lastError: Error | null = null;
    private engineSource = "unresolved";


    private warmupAbort: AbortController | null = null;


    private lastIdleAt = 0;


    private tablebasesLoaded = false;

    constructor(
        private readonly workerId: number,
        private readonly logger: Logger,
    ) {}



    getWorkerId(): number {
        return this.workerId;
    }

    getState(): WorkerState {
        return this.state;
    }

    getLastError(): Error | null {
        return this.lastError;
    }

    getLastIdleAt(): number {
        return this.lastIdleAt;
    }

    getTablebasesLoaded(): boolean {
        return this.tablebasesLoaded;
    }

    setState(next: WorkerState): void {
        const prev = this.state;
        this.state = next;
        if (next === "IDLE") {
            this.lastIdleAt = Date.now();
        }
        if (prev !== next) {
            this.logger.debug(
                { workerId: this.workerId, prev, next },
                "Worker state transition",
            );
        }
    }



    async initialize(): Promise<void> {
        this.shuttingDown = false;

        if (this.initialized) return;
        if (this.initializingPromise) return this.initializingPromise;

        this.lastError = null;
        this.state = "INITIALIZING";
        this.initializingPromise = this.bootstrap();

        try {
            await this.initializingPromise;
            this.initialized = true;
            this.lastError = null;
            this.state = "IDLE";
            this.lastIdleAt = Date.now();
            this.logger.info(
                { workerId: this.workerId, engineSource: this.engineSource },
                "Stockfish worker ready",
            );
        } catch (err) {
            this.initialized = false;
            this.lastError =
                err instanceof Error ? err : new Error(String(err));
            this.state = "RESTARTING";
            throw this.lastError;
        } finally {
            this.initializingPromise = null;
        }
    }

    private async bootstrap(): Promise<void> {
        const startupTimeoutMs = Math.max(env.ENGINE_TIMEOUT_MS, 15_000);
        await this.spawnProcess();
        await this.sendAndWait(
            "uci",
            (line) => line === "uciok",
            startupTimeoutMs,
        );

        this.sendCommand(`setoption name MultiPV value ${MULTI_PV}`);
        this.sendCommand(
            `setoption name Threads value ${env.STOCKFISH_THREADS}`,
        );
        this.sendCommand(`setoption name Hash value ${env.STOCKFISH_HASH_MB}`);

        if (env.SYZYGY_PATH) {
            this.sendCommand(
                `setoption name SyzygyPath value ${env.SYZYGY_PATH}`,
            );
            this.tablebasesLoaded = true;
            this.logger.info(
                { workerId: this.workerId, syzygyPath: env.SYZYGY_PATH },
                "Configured Syzygy tablebases",
            );
        }

        await this.sendAndWait(
            "isready",
            (line) => line === "readyok",
            startupTimeoutMs,
        );
    }

    private spawnProcess(): Promise<void> {
        this.process?.kill();
        this.rl?.close();
        this.process = null;
        this.rl = null;

        return new Promise<void>((resolve, reject) => {
            let engineCommand: EngineCommand;
            try {
                engineCommand = resolveEngineCommand();
            } catch (err) {
                const wrapped =
                    err instanceof Error
                        ? err
                        : new Error(
                              "Failed to resolve Stockfish package entrypoint.",
                          );
                this.lastError = wrapped;
                this.initialized = false;
                this.state = "RESTARTING";
                this.engineSource = "unresolved";
                this.logger.error(
                    { workerId: this.workerId, error: wrapped },
                    "Stockfish resolution failed",
                );
                reject(wrapped);
                return;
            }

            this.engineSource = engineCommand.source;

            const child = spawn(
                engineCommand.command,
                [...engineCommand.args],
                {
                    stdio: ["pipe", "pipe", "pipe"],
                    windowsHide: true,
                },
            );

            const cleanup = () => {
                child.off("spawn", onSpawn);
                child.off("error", onStartupError);
            };

            const onSpawn = () => {
                cleanup();
                this.logger.info(
                    {
                        workerId: this.workerId,
                        engineSource: this.engineSource,
                        command: engineCommand.command,
                    },
                    "Stockfish worker spawned",
                );
                resolve();
            };

            const onStartupError = (err: NodeJS.ErrnoException) => {
                cleanup();
                const wrapped = formatStockfishError(err, this.engineSource);
                this.lastError = wrapped;
                this.initialized = false;
                this.state = "RESTARTING";
                this.logger.error(
                    {
                        workerId: this.workerId,
                        error: wrapped,
                        engineSource: this.engineSource,
                    },
                    "Stockfish worker failed to start",
                );
                this.rl?.close();
                this.rl = null;
                this.process = null;
                reject(wrapped);
            };

            this.process = child;
            this.rl = createInterface({ input: child.stdout });

            this.rl.on("line", (line) => {
                this.logger.debug(
                    { workerId: this.workerId, line },
                    "Stockfish stdout",
                );
                for (const listener of [...this.lineListeners]) {
                    listener(line);
                }
            });

            child.stderr.on("data", (chunk: Buffer) => {
                this.logger.warn(
                    {
                        workerId: this.workerId,
                        stderr: chunk.toString(),
                        engineSource: this.engineSource,
                    },
                    "Stockfish stderr",
                );
            });

            child.once("spawn", onSpawn);
            child.once("error", onStartupError);


            child.on("error", (err) => {
                const wrapped = formatStockfishError(
                    err as NodeJS.ErrnoException,
                    this.engineSource,
                );
                this.lastError = wrapped;
                this.initialized = false;
                if (!this.shuttingDown) {
                    this.state = "RESTARTING";
                    this.logger.error(
                        {
                            workerId: this.workerId,
                            error: wrapped,
                            engineSource: this.engineSource,
                        },
                        "Stockfish worker runtime error",
                    );
                }
            });

            child.on("exit", (code, signal) => {
                this.initialized = false;
                this.rl?.close();
                this.rl = null;
                this.process = null;

                if (this.shuttingDown) return;

                this.state = "RESTARTING";
                this.logger.error(
                    {
                        workerId: this.workerId,
                        code,
                        signal,
                        lastError: this.lastError?.message,
                        engineSource: this.engineSource,
                    },
                    "Stockfish worker exited unexpectedly",
                );

                if (!isMissingBinaryError(this.lastError)) {
                    this.scheduleRestart();
                }
            });
        });
    }

    scheduleRestart(delayMs = 500): void {
        if (this.restartTimer || this.shuttingDown) return;

        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            void this.initialize().catch((err) => {
                this.logger.error(
                    { workerId: this.workerId, error: err },
                    "Stockfish worker restart failed",
                );
                if (!isMissingBinaryError(err instanceof Error ? err : null)) {
                    this.scheduleRestart(Math.min(delayMs * 2, 10_000));
                }
            });
        }, delayMs);
    }



    private addLineListener(listener: LineListener): () => void {
        this.lineListeners.add(listener);
        return () => this.lineListeners.delete(listener);
    }

    private sendCommand(command: string): void {
        if (this.lastError) throw this.lastError;
        if (!this.process?.stdin.writable) {
            throw new Error(
                `Stockfish worker ${this.workerId} stdin is not writable`,
            );
        }
        this.process.stdin.write(`${command}\n`);
    }

    private sendAndWait(
        command: string,
        predicate: (line: string) => boolean,
        timeoutMs: number,
    ): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => {
                off();
                reject(
                    this.lastError ??
                        new Error(
                            `Timed out waiting for Stockfish worker ${this.workerId} (${command})`,
                        ),
                );
            }, timeoutMs);

            const off = this.addLineListener((line) => {
                if (predicate(line)) {
                    clearTimeout(timer);
                    off();
                    resolve(line);
                }
            });

            try {
                this.sendCommand(command);
            } catch (err) {
                clearTimeout(timer);
                off();
                reject(err);
            }
        });
    }



    async ping(
        timeoutMs = Math.max(env.HEARTBEAT_TIMEOUT_MS, 10_000),
    ): Promise<void> {
        await this.initialize();
        await this.sendAndWait(
            "isready",
            (line) => line === "readyok",
            timeoutMs,
        );
    }




    async warmup(): Promise<void> {
        this.warmupAbort = new AbortController();
        const { signal } = this.warmupAbort;
        this.state = "WARMUP";

        try {
            if (signal.aborted) return;
            await this.analyzePosition(
                "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
                8,
                3_000,
                { noFallback: true, signal },
            );
            if (!signal.aborted) {
                this.logger.info(
                    { workerId: this.workerId },
                    "Worker warmup completed",
                );
            }
        } catch {
            this.logger.debug(
                { workerId: this.workerId },
                "Worker warmup interrupted or failed",
            );
        } finally {
            this.warmupAbort = null;
            if (this.state === "WARMUP") {
                this.state = "IDLE";
                this.lastIdleAt = Date.now();
            }
        }
    }


    cancelWarmup(): void {
        if (this.warmupAbort) {
            this.warmupAbort.abort();
            try {
                this.sendCommand("stop");
            } catch {
                /* process may already be dead */
            }
        }
    }




    async analyzePosition(
        fen: string,
        depth: number,
        timeoutMs = depth > 14 ? 20_000 : env.ENGINE_TIMEOUT_MS,
        options: AnalysisOptions = {},
    ): Promise<AnalysisResult> {
        await this.initialize();

        return new Promise<AnalysisResult>((resolve, reject) => {
            const depthMap = new Map<number, Map<number, CandidateMove>>();
            let bestMove: string | null = null;
            let timedOut = false;
            let aborted = false;
            let finished = false;
            const startedAt = Date.now();

            const { signal, noFallback = false } = options;

            const finalize = async () => {
                if (finished) return;
                finished = true;
                off();
                clearTimeout(timer);
                clearTimeout(failsafe);

                const maxDepth = Math.max(0, ...depthMap.keys());
                const candidates =
                    maxDepth === 0
                        ? []
                        : [...(depthMap.get(maxDepth)?.values() ?? [])].sort(
                              (a, b) => a.multipv - b.multipv,
                          );

                if (
                    candidates.length === 0 &&
                    !noFallback &&
                    !aborted &&
                    depth > 6
                ) {
                    this.logger.warn(
                        { workerId: this.workerId, fen, depth },
                        "No candidates at target depth — using emergency fallback",
                    );
                    try {
                        const emergency = await this.analyzePosition(
                            fen,
                            6,
                            4_000,
                            { noFallback: true },
                        );
                        resolve({ ...emergency, partial: true });
                    } catch (err) {
                        reject(err);
                    }
                    return;
                }

                resolve({
                    candidates,
                    bestMove: bestMove ?? candidates[0]?.move ?? null,
                    thinkingTime: Date.now() - startedAt,
                    depthReached: maxDepth,
                    partial:
                        timedOut ||
                        aborted ||
                        maxDepth < depth ||
                        candidates.length < MULTI_PV,
                });
            };

            const off = this.addLineListener((line) => {
                if (line.startsWith("bestmove")) {
                    bestMove = line.split(" ")[1] ?? null;
                    void finalize();
                    return;
                }
                const parsed = parseInfoLine(line);
                if (!parsed) return;
                const bucket =
                    depthMap.get(parsed.depth) ??
                    new Map<number, CandidateMove>();
                bucket.set(parsed.multipv, parsed);
                depthMap.set(parsed.depth, bucket);
            });

            const timer = setTimeout(() => {
                timedOut = true;
                try {
                    this.sendCommand("stop");
                } catch (err) {
                    reject(err);
                }
            }, timeoutMs);

            const failsafe = setTimeout(
                () => void finalize(),
                timeoutMs + 1_000,
            );


            if (signal) {
                if (signal.aborted) {
                    off();
                    clearTimeout(timer);
                    clearTimeout(failsafe);
                    resolve({
                        candidates: [],
                        bestMove: null,
                        thinkingTime: 0,
                        depthReached: 0,
                        partial: true,
                    });
                    return;
                }
                signal.addEventListener(
                    "abort",
                    () => {
                        aborted = true;
                        try {
                            this.sendCommand("stop");
                        } catch {
                            /* ignore */
                        }
                    },
                    { once: true },
                );
            }

            try {
                this.sendCommand(`setoption name MultiPV value ${MULTI_PV}`);
                this.sendCommand(`position fen ${fen}`);
                const goCommand = `go depth ${depth}`;
                this.logger.info(
                    {
                        workerId: this.workerId,
                        multiPv: MULTI_PV,
                        goCommand,
                        fen,
                        requestedDepth: depth,
                    },
                    "Dispatching Stockfish depth search",
                );
                this.sendCommand(goCommand);
            } catch (err) {
                off();
                clearTimeout(timer);
                clearTimeout(failsafe);
                reject(err);
            }
        });
    }


    async analyzeWithMovetime(
        fen: string,
        movetimeMs: number,
        minDepth = 8,
        timeoutMs = movetimeMs + 3_000,
        options: AnalysisOptions = {},
    ): Promise<AnalysisResult> {
        await this.initialize();

        return new Promise<AnalysisResult>((resolve, reject) => {
            const depthMap = new Map<number, Map<number, CandidateMove>>();
            let bestMove: string | null = null;
            let earlyExitSent = false;
            let aborted = false;
            let finished = false;
            const startedAt = Date.now();


            const topMoveHistory: {
                depth: number;
                move: string;
                eval: number;
            }[] = [];

            const { signal } = options;

            const finalize = () => {
                if (finished) return;
                finished = true;
                off();
                clearTimeout(failsafe);

                const maxDepth = Math.max(0, ...depthMap.keys());
                const candidates =
                    maxDepth === 0
                        ? []
                        : [...(depthMap.get(maxDepth)?.values() ?? [])].sort(
                              (a, b) => a.multipv - b.multipv,
                          );

                resolve({
                    candidates,
                    bestMove: bestMove ?? candidates[0]?.move ?? null,
                    thinkingTime: Date.now() - startedAt,
                    depthReached: maxDepth,
                    partial:
                        earlyExitSent ||
                        aborted ||
                        maxDepth < Math.max(minDepth, MIN_STABLE_DEPTH) ||
                        candidates.length < MULTI_PV,
                });
            };

            const checkEarlyExit = () => {
                if (
                    earlyExitSent ||
                    topMoveHistory.length < EARLY_EXIT_CONSECUTIVE_DEPTHS
                )
                    return;

                const tail = topMoveHistory.slice(
                    -EARLY_EXIT_CONSECUTIVE_DEPTHS,
                );
                const sameMove = tail.every((e) => e.move === tail[0]!.move);
                if (!sameMove) return;

                const evals = tail.map((e) => e.eval);
                const variance = Math.max(...evals) - Math.min(...evals);
                if (variance >= EARLY_EXIT_EVAL_VARIANCE) return;

                const currentDepth = tail[tail.length - 1]!.depth;
                const stableFloor = Math.max(minDepth, MIN_STABLE_DEPTH);
                const elapsed = Date.now() - startedAt;
                const minElapsed = Math.max(
                    EARLY_EXIT_MIN_ABS_MS,
                    Math.floor(movetimeMs * EARLY_EXIT_MIN_TIME_FRACTION),
                );

                if (currentDepth >= stableFloor && elapsed >= minElapsed) {
                    earlyExitSent = true;
                    this.logger.debug(
                        {
                            workerId: this.workerId,
                            fen,
                            currentDepth,
                            elapsed,
                            variance,
                        },
                        "Early exit triggered — position is stable",
                    );
                    try {
                        this.sendCommand("stop");
                    } catch {
                        /* ignore */
                    }
                }
            };

            const off = this.addLineListener((line) => {
                if (line.startsWith("bestmove")) {
                    bestMove = line.split(" ")[1] ?? null;
                    finalize();
                    return;
                }
                const parsed = parseInfoLine(line);
                if (!parsed) return;

                const bucket =
                    depthMap.get(parsed.depth) ??
                    new Map<number, CandidateMove>();
                bucket.set(parsed.multipv, parsed);
                depthMap.set(parsed.depth, bucket);

                if (parsed.multipv === 1) {
                    topMoveHistory.push({
                        depth: parsed.depth,
                        move: parsed.move,
                        eval: parsed.eval,
                    });
                    checkEarlyExit();
                }
            });

            const failsafe = setTimeout(() => finalize(), timeoutMs);

            if (signal) {
                if (signal.aborted) {
                    off();
                    clearTimeout(failsafe);
                    resolve({
                        candidates: [],
                        bestMove: null,
                        thinkingTime: 0,
                        depthReached: 0,
                        partial: true,
                    });
                    return;
                }
                signal.addEventListener(
                    "abort",
                    () => {
                        aborted = true;
                        try {
                            this.sendCommand("stop");
                        } catch {
                            /* ignore */
                        }
                    },
                    { once: true },
                );
            }

            try {
                this.sendCommand(`setoption name MultiPV value ${MULTI_PV}`);
                this.sendCommand(`position fen ${fen}`);
                const goCommand = `go movetime ${movetimeMs}`;
                this.logger.info(
                    {
                        workerId: this.workerId,
                        multiPv: MULTI_PV,
                        goCommand,
                        fen,
                        minDepth,
                    },
                    "Dispatching Stockfish movetime search",
                );
                this.sendCommand(goCommand);
            } catch (err) {
                off();
                clearTimeout(failsafe);
                reject(err);
            }
        });
    }



    async dispose(): Promise<void> {
        this.shuttingDown = true;

        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }


        this.cancelWarmup();


        this.lineListeners.clear();

        this.rl?.close();
        this.rl = null;

        if (this.process) {
            this.process.kill("SIGTERM");

            await new Promise<void>((res) => {
                const force = setTimeout(() => {
                    this.process?.kill("SIGKILL");
                    res();
                }, 2_000);
                this.process!.once("exit", () => {
                    clearTimeout(force);
                    res();
                });
            });
            this.process = null;
        }

        this.initialized = false;
    }
}
