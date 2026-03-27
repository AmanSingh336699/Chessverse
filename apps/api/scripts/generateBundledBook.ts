import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";
import {
  BUNDLED_BOOK_LINES,
  BUNDLED_OPENING_BOOK_RELATIVE_PATH,
} from "../src/openingBook/bundledBookData.ts";
import {
  computePolyglotHash,
  uciToPolyglotMove,
  type PolyglotBookEntry,
} from "../src/openingBook/polyglotBook.ts";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../../..");
const outputPath = resolve(repoRoot, BUNDLED_OPENING_BOOK_RELATIVE_PATH);

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

const strongerEntry = (candidate: PolyglotBookEntry, current: PolyglotBookEntry): boolean => {
  if (candidate.weight !== current.weight) {
    return candidate.weight > current.weight;
  }

  if (candidate.learn !== current.learn) {
    return candidate.learn > current.learn;
  }

  return candidate.move.localeCompare(current.move) < 0;
};

const deduped = new Map<string, PolyglotBookEntry>();
for (const line of BUNDLED_BOOK_LINES) {
  const chess = new Chess();
  for (const move of line.moves) {
    const fenBefore = chess.fen();
    const applied = chess.move(toMoveShape(move));
    if (!applied) {
      throw new Error(`Illegal bundled opening book move '${move}' from '${fenBefore}'`);
    }

    const entry: PolyglotBookEntry = {
      key: computePolyglotHash(fenBefore),
      move,
      weight: line.weight,
      learn: line.learn ?? 0,
    };
    const dedupeKey = `${entry.key.toString(16)}:${entry.move}`;
    const existing = deduped.get(dedupeKey);
    if (!existing || strongerEntry(entry, existing)) {
      deduped.set(dedupeKey, entry);
    }
  }
}

const entries = [...deduped.values()].sort((left, right) => {
  if (left.key < right.key) {
    return -1;
  }
  if (left.key > right.key) {
    return 1;
  }
  if (right.weight !== left.weight) {
    return right.weight - left.weight;
  }
  if (right.learn !== left.learn) {
    return right.learn - left.learn;
  }
  return left.move.localeCompare(right.move);
});

const buffer = Buffer.alloc(entries.length * 16);
entries.forEach((entry, index) => {
  const offset = index * 16;
  buffer.writeBigUInt64BE(entry.key, offset);
  buffer.writeUInt16BE(uciToPolyglotMove(entry.move), offset + 8);
  buffer.writeUInt16BE(entry.weight, offset + 10);
  buffer.writeUInt32BE(entry.learn, offset + 12);
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, buffer);
console.log(`Wrote ${entries.length} entries to ${outputPath}`);
