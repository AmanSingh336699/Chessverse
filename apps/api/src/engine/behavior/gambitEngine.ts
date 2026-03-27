import type { CandidateMove, GambitState, GamePhase, PlayerColor } from "../../contracts.js";
import { Chess } from "chess.js";
import {
  createOfferedGambitState,
  isGambitSuppressed,
  normalizeGambitState,
} from "./gambitState.js";

export interface GambitBehaviorContext {
  fen: string;
  history: string[];
  moveNumber: number;
  aiColor: PlayerColor;
  phase: GamePhase;
  gambitState?: GambitState;
}

export interface GambitLine {
  name: string;
  color: PlayerColor;
  moves: readonly string[];
  offeredAtPly: number;
}

export interface OpeningBookEntry {
  move: string;
  weight: number;
  learn?: number;
}

export interface OpeningBook {
  getMove(fen: string): string | null | undefined;
  getEntries?(fen: string): readonly OpeningBookEntry[];
}

export interface GambitStateSink {
  persist(state: GambitState, meta: { fen: string; history: readonly string[]; source: "opening-book" | "candidate-score" }): void | Promise<void>;
}

export interface GambitLogger {
  warn(payload: Record<string, unknown>, message: string): void;
}

export interface GambitEngineOptions {
  openingBook?: OpeningBook;
  stateSink?: GambitStateSink;
  logger?: GambitLogger;
}

const OPENING_MOVE_LIMIT = 10;
const COMPLETE_BONUS = 50;
const CONTINUE_BONUS = 25;
const EVAL_FLOOR = -1.5;
const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const MAX_BOOK_EXTENSION_PLIES = 4;
const MAX_BOOK_BRANCHES_PER_POSITION = 3;
const MAX_BOOK_LINES_PER_GAMBIT = 48;

const GAMBIT_SEEDS: readonly Omit<GambitLine, "offeredAtPly">[] = [
  { name: "King's Gambit", color: "white", moves: ["e2e4", "e7e5", "f2f4"] },
  { name: "Evans Gambit", color: "white", moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5", "b2b4"] },
  { name: "Danish Gambit", color: "white", moves: ["e2e4", "e7e5", "d2d4", "e5d4", "c2c3"] },
  { name: "Smith-Morra Gambit", color: "white", moves: ["e2e4", "c7c5", "d2d4", "c5d4", "c2c3"] },
  { name: "Halloween Gambit", color: "white", moves: ["e2e4", "e7e5", "g1f3", "b8c6", "b1c3", "g8f6", "f3e5"] },
  { name: "Budapest Gambit", color: "black", moves: ["d2d4", "g8f6", "c2c4", "e7e5"] },
  { name: "Englund Gambit", color: "black", moves: ["d2d4", "e7e5"] },
  { name: "Albin Counter-Gambit", color: "black", moves: ["d2d4", "d7d5", "c2c4", "e7e5"] },
  { name: "Benko Gambit", color: "black", moves: ["d2d4", "g8f6", "c2c4", "c7c5", "d4d5", "b7b5"] },
  { name: "Falkbeer Counter Gambit", color: "black", moves: ["e2e4", "e7e5", "f2f4", "d7d5"] },
] as const;

const joinHistoryKey = (moves: readonly string[]): string => moves.join(":");

const isValidHistory = (history: readonly string[]): boolean => history.every((move) => UCI_PATTERN.test(move));

const toMoveShape = (uci: string) => {
  const base = {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
  };
  const promotion = uci[4];

  return promotion
    ? {
        ...base,
        promotion,
      }
    : base;
};

const applyUciMove = (chess: Chess, move: string) => {
  try {
    return chess.move(toMoveShape(move));
  } catch {
    return null;
  }
};

const defaultLogger: GambitLogger = {
  warn: () => undefined,
};

const seedCatalog: readonly GambitLine[] = Object.freeze(
  GAMBIT_SEEDS.map((line) => ({
    ...line,
    offeredAtPly: line.moves.length,
  })),
);

const applyLine = (line: GambitLine): Chess | null => {
  const chess = new Chess();
  for (const move of line.moves) {
    if (!UCI_PATTERN.test(move)) {
      return null;
    }

    const applied = applyUciMove(chess, move);
    if (!applied) {
      return null;
    }
  }

  return chess;
};

const sanitizeBookEntries = (entries: readonly OpeningBookEntry[] | undefined): readonly OpeningBookEntry[] =>
  (entries ?? [])
    .filter((entry) => entry.weight > 0 && UCI_PATTERN.test(entry.move))
    .slice(0, MAX_BOOK_BRANCHES_PER_POSITION);

const expandSeedWithBook = (seed: GambitLine, openingBook: OpeningBook): readonly GambitLine[] => {
  if (!openingBook.getEntries) {
    return [];
  }

  const startingPosition = applyLine(seed);
  if (!startingPosition) {
    return [];
  }

  const generated: GambitLine[] = [];
  const seenLines = new Set<string>();
  const visited = new Set<string>();
  const queue: Array<{ fen: string; moves: readonly string[]; depth: number }> = [
    { fen: startingPosition.fen(), moves: seed.moves, depth: 0 },
  ];

  while (queue.length > 0 && generated.length < MAX_BOOK_LINES_PER_GAMBIT) {
    const node = queue.shift();
    if (!node || node.depth >= MAX_BOOK_EXTENSION_PLIES) {
      continue;
    }

    const entries = sanitizeBookEntries(openingBook.getEntries(node.fen));
    for (const entry of entries) {
      const chess = new Chess(node.fen);
      const applied = applyUciMove(chess, entry.move);
      if (!applied) {
        continue;
      }

      const nextMoves = Object.freeze([...node.moves, entry.move]);
      const lineKey = `${seed.name}:${joinHistoryKey(nextMoves)}`;
      if (!seenLines.has(lineKey)) {
        seenLines.add(lineKey);
        generated.push({
          name: seed.name,
          color: seed.color,
          moves: nextMoves,
          offeredAtPly: seed.offeredAtPly,
        });
      }

      const visitKey = `${chess.fen()}|${node.depth + 1}`;
      if (!visited.has(visitKey) && generated.length < MAX_BOOK_LINES_PER_GAMBIT) {
        visited.add(visitKey);
        queue.push({
          fen: chess.fen(),
          moves: nextMoves,
          depth: node.depth + 1,
        });
      }
    }
  }

  return generated;
};

const buildGambitCatalog = (openingBook?: OpeningBook): readonly GambitLine[] => {
  const deduped = new Map<string, GambitLine>();
  for (const seed of seedCatalog) {
    deduped.set(`${seed.name}:${joinHistoryKey(seed.moves)}`, seed);
  }

  if (openingBook?.getEntries) {
    for (const seed of seedCatalog) {
      for (const expandedLine of expandSeedWithBook(seed, openingBook)) {
        deduped.set(`${expandedLine.name}:${joinHistoryKey(expandedLine.moves)}`, expandedLine);
      }
    }
  }

  return Object.freeze([...deduped.values()]);
};

const buildPrefixIndex = (
  catalog: readonly GambitLine[],
): Record<PlayerColor, Map<string, readonly GambitLine[]>> => {
  const byColor: Record<PlayerColor, Map<string, GambitLine[]>> = {
    white: new Map<string, GambitLine[]>(),
    black: new Map<string, GambitLine[]>(),
  };

  for (const line of catalog) {
    for (let length = 1; length <= line.moves.length; length += 1) {
      const prefix = joinHistoryKey(line.moves.slice(0, length));
      const existing = byColor[line.color].get(prefix);
      if (existing) {
        existing.push(line);
      } else {
        byColor[line.color].set(prefix, [line]);
      }
    }
  }

  const freezeBuckets = (map: Map<string, GambitLine[]>) =>
    new Map(
      Array.from(map.entries(), ([key, lines]) => [
        key,
        Object.freeze(
          [...lines].sort((left, right) => {
            if (left.offeredAtPly !== right.offeredAtPly) {
              return left.offeredAtPly - right.offeredAtPly;
            }
            if (left.moves.length !== right.moves.length) {
              return left.moves.length - right.moves.length;
            }
            return left.name.localeCompare(right.name);
          }),
        ),
      ]),
    );

  return {
    white: freezeBuckets(byColor.white),
    black: freezeBuckets(byColor.black),
  };
};

const selectOfferedLine = (
  matchedLines: readonly GambitLine[],
  historyLength: number,
): GambitLine | null =>
  matchedLines.find((line) => line.offeredAtPly === historyLength) ?? null;

export class GambitEngine {
  private readonly prefixIndex: Record<PlayerColor, Map<string, readonly GambitLine[]>>;

  private readonly logger: GambitLogger;

  constructor(private readonly options: GambitEngineOptions = {}) {
    this.prefixIndex = buildPrefixIndex(buildGambitCatalog(options.openingBook));
    this.logger = options.logger ?? defaultLogger;
  }

  scoreCandidate(context: GambitBehaviorContext, candidate: Pick<CandidateMove, "move" | "eval">): number {
    try {
      if (context.moveNumber >= OPENING_MOVE_LIMIT || context.phase !== "opening") {
        return 0;
      }

      if (!UCI_PATTERN.test(candidate.move) || candidate.eval < EVAL_FLOOR) {
        return 0;
      }

      if (!Array.isArray(context.history) || !isValidHistory(context.history)) {
        return 0;
      }

      if (isGambitSuppressed(context.gambitState)) {
        return 0;
      }

      const simulatedHistory = [...context.history, candidate.move];
      const matchedLines = this.matchLines(context.aiColor, simulatedHistory);
      if (matchedLines.length === 0) {
        return 0;
      }

      const bookMove = this.options.openingBook?.getMove(context.fen);
      const offeredLine = selectOfferedLine(matchedLines, simulatedHistory.length);
      const normalized = normalizeGambitState(context.gambitState);
      if (offeredLine && (normalized.status !== "offered" || normalized.line !== offeredLine.name)) {
        const source =
          typeof bookMove === "string" && bookMove === candidate.move
            ? "opening-book"
            : "candidate-score";
        this.options.stateSink?.persist(createOfferedGambitState(offeredLine.name), {
          fen: context.fen,
          history: simulatedHistory,
          source,
        });
      }

      return offeredLine ? COMPLETE_BONUS : CONTINUE_BONUS;
    } catch (error) {
      this.logger.warn(
        {
          error,
          move: candidate.move,
          fen: context.fen,
          moveNumber: context.moveNumber,
        },
        "GambitEngine scoring failed; defaulting to zero",
      );
      return 0;
    }
  }

  private matchLines(aiColor: PlayerColor, history: readonly string[]): readonly GambitLine[] {
    const key = joinHistoryKey(history);
    return this.prefixIndex[aiColor].get(key) ?? [];
  }
}

