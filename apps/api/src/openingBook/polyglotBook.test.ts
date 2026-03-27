import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  PolyglotOpeningBook,
  computePolyglotHash,
  loadPolyglotOpeningBook,
  polyglotMoveToUci,
  uciToPolyglotMove,
} from "./polyglotBook.js";

const tempDirs: string[] = [];
const startingFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const createTempFile = (name: string, buffer: Buffer): string => {
  const dir = mkdtempSync(join(tmpdir(), "polyglot-book-"));
  tempDirs.push(dir);
  const filePath = join(dir, name);
  writeFileSync(filePath, buffer);
  return filePath;
};

const buildEntryBuffer = (
  entries: Array<{ key: bigint; move: string; weight: number; learn?: number }>,
): Buffer => {
  const sorted = [...entries].sort((left, right) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
  );
  const buffer = Buffer.alloc(sorted.length * 16);
  sorted.forEach((entry, index) => {
    const offset = index * 16;
    buffer.writeBigUInt64BE(entry.key, offset);
    buffer.writeUInt16BE(uciToPolyglotMove(entry.move), offset + 8);
    buffer.writeUInt16BE(entry.weight, offset + 10);
    buffer.writeUInt32BE(entry.learn ?? 0, offset + 12);
  });
  return buffer;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("polyglot book hashing", () => {
  it("matches the canonical starting-position polyglot hash", () => {
    const hash = computePolyglotHash(startingFen);
    expect(hash).toBe(0x463b96181691fc9cn);
  });

  it("round-trips castling moves through polyglot encoding", () => {
    const encoded = uciToPolyglotMove("e1g1");
    expect(polyglotMoveToUci(encoded)).toBe("e1g1");
  });
});

describe("PolyglotOpeningBook", () => {
  it("returns the highest-weight move for a matching position", () => {
    const key = computePolyglotHash(startingFen);
    const path = createTempFile(
      "main.bin",
      buildEntryBuffer([
        { key, move: "d2d4", weight: 20 },
        { key, move: "e2e4", weight: 35 },
      ]),
    );

    const book = PolyglotOpeningBook.loadFromFile(path);
    expect(book.entryCount).toBe(2);
    expect(book.getMove(startingFen)).toBe("e2e4");
    expect(book.getEntries(startingFen).map((entry) => entry.move)).toEqual(["e2e4", "d2d4"]);
  });

  it("loads the configured book when a valid path is provided", () => {
    const key = computePolyglotHash(startingFen);
    const path = createTempFile(
      "startup.bin",
      buildEntryBuffer([{ key, move: "c2c4", weight: 12 }]),
    );

    const book = loadPolyglotOpeningBook(path);
    expect(book?.getMove(startingFen)).toBe("c2c4");
  });

  it("loads bundled gm2600 when OPENING_BOOK_PATH is absent", () => {
    const book = loadPolyglotOpeningBook(undefined);
    expect(book).not.toBeNull();
    expect(book?.entryCount).toBeGreaterThan(0);
    expect(book?.getMove(startingFen)).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
  });

  it("returns null when a configured opening-book path is missing", () => {
    const book = loadPolyglotOpeningBook("definitely-missing-book.bin");
    expect(book).toBeNull();
  });
});
