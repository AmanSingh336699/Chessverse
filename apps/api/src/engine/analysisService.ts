import type { CandidateMove } from "../contracts.js";
import type { Logger } from "pino";
import type { EvalCache } from "../types.js";
import { StockfishWorker } from "./stockfishWorker.js";
import { Chess } from "chess.js";
import { env } from "../config/env.js";

const normalizeFenForCache = (fen: string): string => {
  const parts = fen.split(" ");
  if (parts.length !== 6) return fen;

  const [placement, turn, castling, enPassant, , fullmove] = parts;

  /* Normalize en passant: if there's an en passant square, verify a pawn can actually capture */
  let normalizedEp = enPassant;
  if (enPassant && enPassant !== "-") {
    try {
      const chess = new Chess(fen);
      const moves = chess.moves({ verbose: true });
      const hasEpCapture = moves.some(
        (m) => m.to === enPassant && m.flags.includes("e"),
      );
      if (!hasEpCapture) {
        normalizedEp = "-";
      }
    } catch {
      normalizedEp = "-";
    }
  }

  /* Normalize halfmove clock to 0 for cache key (doesn't affect eval) */
  return `${placement} ${turn} ${castling} ${normalizedEp} 0 ${fullmove}`;
};

export class AnalysisService {
  private cacheHits = 0;
  private cacheMisses = 0;
  private candidateCacheHits = 0;
  private candidateCacheMisses = 0;

  constructor(
    private readonly logger: Logger,
    private readonly cache: EvalCache<number>,
    private readonly candidateCache?: EvalCache<CandidateMove[]>,
  ) {}

  async getCandidates(worker: StockfishWorker, fen: string, depth: number) {
    const result = await worker.analyzePosition(fen, depth);
    this.logger.info(
      {
        fen,
        depth,
        thinkingTime: result.thinkingTime,
        topCandidates: result.candidates.slice(0, 3),
      },
      "Stockfish analysis completed",
    );
    return result;
  }

  async evaluatePosition(worker: StockfishWorker, fen: string, depth: number): Promise<number> {
    const normalizedFen = normalizeFenForCache(fen);
    const cacheKey = `eval:${depth}:${normalizedFen}`;
    const cached = await this.cache.get(cacheKey);
    if (typeof cached === "number") {
      this.cacheHits++;
      this.logger.debug({ fen, depth, cacheHit: true, hitRate: this.getCacheHitRate() }, "Cache hit");
      return cached;
    }

    this.cacheMisses++;
    const result = await worker.analyzePosition(fen, depth, 4000, { noFallback: true });
    const evaluation = result.candidates[0]?.eval ?? 0;
    await this.cache.set(cacheKey, evaluation, env.ANALYSIS_CACHE_TTL_SECONDS);
    this.logger.debug({ fen, depth, cacheHit: false, hitRate: this.getCacheHitRate() }, "Cache miss");
    return evaluation;
  }

  getCacheHitRate(): number {
    const total = this.cacheHits + this.cacheMisses;
    return total === 0 ? 0 : Math.round((this.cacheHits / total) * 100);
  }

  getCandidateCacheHitRate(): number {
    const total = this.candidateCacheHits + this.candidateCacheMisses;
    return total === 0 ? 0 : Math.round((this.candidateCacheHits / total) * 100);
  }

  async getCandidatesWithMovetime(
    worker: StockfishWorker,
    fen: string,
    movetimeMs: number,
    minDepth: number,
  ) {
    const normalizedFen = normalizeFenForCache(fen);
    const cacheKey = `candidates:${movetimeMs}:${normalizedFen}`;

    // Check candidate cache
    if (this.candidateCache) {
      const cached = await this.candidateCache.get(cacheKey);
      if (cached && cached.length > 0) {
        this.candidateCacheHits++;
        this.logger.info(
          { fen, movetimeMs, cacheHit: true, candidateCount: cached.length, hitRate: this.getCandidateCacheHitRate() },
          "Candidate cache hit",
        );
        return {
          candidates: cached,
          bestMove: cached[0]?.move ?? null,
          thinkingTime: 0,
          depthReached: cached[0]?.depth ?? 0,
          partial: false,
        };
      }
    }

    this.candidateCacheMisses++;
    const result = await worker.analyzeWithMovetime(fen, movetimeMs, minDepth);

    this.logger.info(
      {
        fen,
        movetimeMs,
        thinkingTime: result.thinkingTime,
        depthReached: result.depthReached,
        partial: result.partial,
        topCandidates: result.candidates.slice(0, 3),
        cacheHit: false,
        hitRate: this.getCandidateCacheHitRate(),
      },
      "Movetime analysis completed",
    );

    // Cache candidates
    if (this.candidateCache && result.candidates.length > 0) {
      await this.candidateCache.set(cacheKey, result.candidates, env.ANALYSIS_CACHE_TTL_SECONDS);
    }

    return result;
  }

  keepTopCandidates(candidates: CandidateMove[]): CandidateMove[] {
    return [...candidates].sort((a, b) => a.multipv - b.multipv).slice(0, 10);
  }
}
