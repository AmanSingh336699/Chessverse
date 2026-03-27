import { existsSync, readFileSync } from "fs";
import { dirname, isAbsolute, resolve } from "path";
import { fileURLToPath } from "url";
import {
  POLYGLOT_RANDOM,
  POLYGLOT_RANDOM_CASTLE_OFFSET,
  POLYGLOT_RANDOM_EN_PASSANT_OFFSET,
  POLYGLOT_RANDOM_TURN_OFFSET,
} from "./polyglotRandom.js";

export interface OpeningBookEntry {
  move: string;
  weight: number;
  learn: number;
}

export interface OpeningBook {
  getMove(fen: string): string | null;
  getEntries(fen: string): readonly OpeningBookEntry[];
}

export interface PolyglotBookEntry extends OpeningBookEntry {
  key: bigint;
}

export interface OpeningBookLogger {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
}

export const DEFAULT_BUNDLED_OPENING_BOOK_RELATIVE_PATH = "apps/api/assets/opening/gm2600.bin";

const PIECE_INDEX: Record<string, number> = {
  p: 0,
  P: 1,
  n: 2,
  N: 3,
  b: 4,
  B: 5,
  r: 6,
  R: 7,
  q: 8,
  Q: 9,
  k: 10,
  K: 11,
};

const PROMOTION_TO_INDEX: Record<string, number> = {
  n: 1,
  b: 2,
  r: 3,
  q: 4,
};

const INDEX_TO_PROMOTION = ["", "n", "b", "r", "q"] as const;
const CASTLING_WRITE_MAP: Record<string, string> = {
  e1g1: "e1h1",
  e1c1: "e1a1",
  e8g8: "e8h8",
  e8c8: "e8a8",
};
const CASTLING_READ_MAP: Record<string, string> = {
  e1h1: "e1g1",
  e1a1: "e1c1",
  e8h8: "e8g8",
  e8a8: "e8c8",
};

const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../../../../");
const bundledBookPath = resolve(repoRoot, DEFAULT_BUNDLED_OPENING_BOOK_RELATIVE_PATH);

const fileToIndex = (file: string): number => file.charCodeAt(0) - 97;
const rankToIndex = (rank: string): number => Number(rank) - 1;
const squareToIndex = (square: string): number =>
  rankToIndex(square[1] ?? "0") * 8 + fileToIndex(square[0] ?? "a");

const parseBoard = (placement: string): Map<number, string> => {
  const board = new Map<number, string>();
  const ranks = placement.split("/");
  if (ranks.length !== 8) {
    throw new Error("Polyglot hash requires 8 FEN ranks");
  }

  for (let rankIndex = 0; rankIndex < ranks.length; rankIndex += 1) {
    const rank = ranks[rankIndex] ?? "";
    let fileIndex = 0;
    for (const symbol of rank) {
      if (/^[1-8]$/.test(symbol)) {
        fileIndex += Number(symbol);
        continue;
      }

      const pieceIndex = PIECE_INDEX[symbol];
      if (pieceIndex === undefined) {
        throw new Error(`Unsupported piece symbol '${symbol}' in FEN`);
      }

      const boardRank = 7 - rankIndex;
      const squareIndex = boardRank * 8 + fileIndex;
      board.set(squareIndex, symbol);
      fileIndex += 1;
    }

    if (fileIndex !== 8) {
      throw new Error("Each FEN rank must resolve to 8 files");
    }
  }

  return board;
};

const hasEnPassantCapture = (
  board: Map<number, string>,
  epSquare: string,
  activeColor: string,
): boolean => {
  const file = epSquare[0];
  const rank = epSquare[1];
  if (!file || !rank) {
    return false;
  }

  const epFile = fileToIndex(file);
  const epRank = Number(rank);
  if (Number.isNaN(epFile) || Number.isNaN(epRank)) {
    return false;
  }

  if (activeColor === "w") {
    const sourceRank = epRank - 1;
    for (const delta of [-1, 1]) {
      const sourceFile = epFile + delta;
      if (sourceFile < 0 || sourceFile > 7 || sourceRank < 1 || sourceRank > 8) {
        continue;
      }
      const sourceIndex = (sourceRank - 1) * 8 + sourceFile;
      if (board.get(sourceIndex) === "P") {
        return true;
      }
    }
    return false;
  }

  const sourceRank = epRank + 1;
  for (const delta of [-1, 1]) {
    const sourceFile = epFile + delta;
    if (sourceFile < 0 || sourceFile > 7 || sourceRank < 1 || sourceRank > 8) {
      continue;
    }
    const sourceIndex = (sourceRank - 1) * 8 + sourceFile;
    if (board.get(sourceIndex) === "p") {
      return true;
    }
  }
  return false;
};

const normalizeBookPath = (bookPath: string): string => {
  if (isAbsolute(bookPath)) {
    return bookPath;
  }

  const cwdPath = resolve(process.cwd(), bookPath);
  if (existsSync(cwdPath)) {
    return cwdPath;
  }

  const repoPath = resolve(repoRoot, bookPath);
  if (existsSync(repoPath)) {
    return repoPath;
  }

  return cwdPath;
};

const compareEntries = (left: PolyglotBookEntry, right: PolyglotBookEntry): number => {
  if (right.weight !== left.weight) {
    return right.weight - left.weight;
  }
  if (right.learn !== left.learn) {
    return right.learn - left.learn;
  }
  return left.move.localeCompare(right.move);
};

export const computePolyglotHash = (fen: string): bigint => {
  const segments = fen.trim().split(/\s+/);
  if (segments.length !== 6) {
    throw new Error("Polyglot hash requires a full 6-field FEN");
  }

  const placement = segments[0] ?? "";
  const activeColor = segments[1] ?? "w";
  const castling = segments[2] ?? "-";
  const enPassant = segments[3] ?? "-";
  const board = parseBoard(placement);

  let hash = 0n;
  for (const [squareIndex, symbol] of board.entries()) {
    const pieceIndex = PIECE_INDEX[symbol];
    if (pieceIndex === undefined) {
      continue;
    }
    hash ^= POLYGLOT_RANDOM[pieceIndex * 64 + squareIndex] ?? 0n;
  }

  if (castling.includes("K")) {
    hash ^= POLYGLOT_RANDOM[POLYGLOT_RANDOM_CASTLE_OFFSET] ?? 0n;
  }
  if (castling.includes("Q")) {
    hash ^= POLYGLOT_RANDOM[POLYGLOT_RANDOM_CASTLE_OFFSET + 1] ?? 0n;
  }
  if (castling.includes("k")) {
    hash ^= POLYGLOT_RANDOM[POLYGLOT_RANDOM_CASTLE_OFFSET + 2] ?? 0n;
  }
  if (castling.includes("q")) {
    hash ^= POLYGLOT_RANDOM[POLYGLOT_RANDOM_CASTLE_OFFSET + 3] ?? 0n;
  }

  if (enPassant !== "-" && hasEnPassantCapture(board, enPassant, activeColor)) {
    hash ^=
      POLYGLOT_RANDOM[
        POLYGLOT_RANDOM_EN_PASSANT_OFFSET + fileToIndex(enPassant[0] ?? "a")
      ] ?? 0n;
  }

  if (activeColor === "w") {
    hash ^= POLYGLOT_RANDOM[POLYGLOT_RANDOM_TURN_OFFSET] ?? 0n;
  }

  return hash;
};

export const polyglotMoveToUci = (move: number): string => {
  const from = (move >> 6) & 0o77;
  const to = move & 0o77;
  const promotionIndex = (move >> 12) & 0x7;

  const fromFile = String.fromCharCode(97 + (from & 0x7));
  const fromRank = String.fromCharCode(49 + ((from >> 3) & 0x7));
  const toFile = String.fromCharCode(97 + (to & 0x7));
  const toRank = String.fromCharCode(49 + ((to >> 3) & 0x7));
  const promotion = INDEX_TO_PROMOTION[promotionIndex] ?? "";
  const rawMove = `${fromFile}${fromRank}${toFile}${toRank}${promotion}`;

  return CASTLING_READ_MAP[rawMove] ?? rawMove;
};

export const uciToPolyglotMove = (uci: string): number => {
  if (!UCI_PATTERN.test(uci)) {
    throw new Error(`Invalid UCI move '${uci}'`);
  }

  const normalized = CASTLING_WRITE_MAP[uci] ?? uci;
  const from = squareToIndex(normalized.slice(0, 2));
  const to = squareToIndex(normalized.slice(2, 4));
  const promotion = normalized[4] ? PROMOTION_TO_INDEX[normalized[4]] ?? 0 : 0;
  return (promotion << 12) | (from << 6) | to;
};

export class PolyglotOpeningBook implements OpeningBook {
  readonly enabled = true;

  private constructor(
    readonly resolvedPath: string,
    private readonly entriesByKey: ReadonlyMap<bigint, readonly PolyglotBookEntry[]>,
    readonly entryCount: number,
  ) {}

  static loadFromFile(bookPath: string): PolyglotOpeningBook {
    const resolvedPath = normalizeBookPath(bookPath);
    const buffer = readFileSync(resolvedPath);
    return PolyglotOpeningBook.fromBuffer(buffer, resolvedPath);
  }

  static fromBuffer(buffer: Buffer, resolvedPath = "<memory>"): PolyglotOpeningBook {
    if (buffer.length % 16 !== 0) {
      throw new Error("Polyglot book length must be a multiple of 16 bytes");
    }

    const entries = new Map<bigint, PolyglotBookEntry[]>();
    for (let offset = 0; offset < buffer.length; offset += 16) {
      const key = buffer.readBigUInt64BE(offset);
      const move = polyglotMoveToUci(buffer.readUInt16BE(offset + 8));
      if (move.length === 0) {
        continue;
      }
      const entry: PolyglotBookEntry = {
        key,
        move,
        weight: buffer.readUInt16BE(offset + 10),
        learn: buffer.readUInt32BE(offset + 12),
      };

      const bucket = entries.get(key);
      if (bucket) {
        bucket.push(entry);
      } else {
        entries.set(key, [entry]);
      }
    }

    const stableEntries = new Map<bigint, readonly PolyglotBookEntry[]>();
    for (const [key, bucket] of entries.entries()) {
      stableEntries.set(key, Object.freeze([...bucket].sort(compareEntries)));
    }

    return new PolyglotOpeningBook(resolvedPath, stableEntries, buffer.length / 16);
  }

  getMove(fen: string): string | null {
    return this.getEntries(fen)[0]?.move ?? null;
  }

  getEntries(fen: string): readonly PolyglotBookEntry[] {
    try {
      return this.entriesByKey.get(computePolyglotHash(fen)) ?? [];
    } catch {
      return [];
    }
  }
}

export const loadPolyglotOpeningBook = (
  bookPath: string | undefined,
  logger?: OpeningBookLogger,
): PolyglotOpeningBook | null => {
  const configuredPath = bookPath?.trim();
  const candidatePath = configuredPath ? normalizeBookPath(configuredPath) : bundledBookPath;
  const source = configuredPath ? "configured" : "bundled-gm2600";

  if (!existsSync(candidatePath)) {
    logger?.warn(
      {
        openingBookPath: configuredPath ?? DEFAULT_BUNDLED_OPENING_BOOK_RELATIVE_PATH,
        resolvedPath: candidatePath,
        source,
      },
      "Polyglot opening book file does not exist; continuing without opening book",
    );
    return null;
  }

  try {
    const book = PolyglotOpeningBook.loadFromFile(candidatePath);
    logger?.info(
      {
        openingBookPath: configuredPath ?? DEFAULT_BUNDLED_OPENING_BOOK_RELATIVE_PATH,
        resolvedPath: book.resolvedPath,
        entryCount: book.entryCount,
        source,
      },
      "Polyglot opening book loaded into memory",
    );
    return book;
  } catch (error) {
    logger?.warn(
      {
        error,
        openingBookPath: configuredPath ?? DEFAULT_BUNDLED_OPENING_BOOK_RELATIVE_PATH,
        resolvedPath: candidatePath,
        source,
      },
      "Failed to load polyglot opening book; continuing without opening book",
    );
    return null;
  }
};
