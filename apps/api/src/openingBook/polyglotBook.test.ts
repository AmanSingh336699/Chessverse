import { describe, expect, it } from "vitest";
import {
  computePolyglotHash,
  loadPolyglotOpeningBook,
  polyglotMoveToUci,
  PolyglotOpeningBook,
  uciToPolyglotMove,
} from "./polyglotBook.js";

describe("Phase 2: Polyglot Opening Book & Castling Decoding", () => {
  describe("Castling move encoding and decoding", () => {
    it("decodes Polyglot rook-target castling to standard UCI king moves", () => {
      // Polyglot encodes White kingside castle as e1h1 -> standard UCI is e1g1
      // Polyglot encodes White queenside castle as e1a1 -> standard UCI is e1c1
      // Polyglot encodes Black kingside castle as e8h8 -> standard UCI is e8g8
      // Polyglot encodes Black queenside castle as e8a8 -> standard UCI is e8c8

      const whiteKingsideUci = uciToPolyglotMove("e1g1");
      expect(polyglotMoveToUci(whiteKingsideUci)).toBe("e1g1");

      const whiteQueensideUci = uciToPolyglotMove("e1c1");
      expect(polyglotMoveToUci(whiteQueensideUci)).toBe("e1c1");

      const blackKingsideUci = uciToPolyglotMove("e8g8");
      expect(polyglotMoveToUci(blackKingsideUci)).toBe("e8g8");

      const blackQueensideUci = uciToPolyglotMove("e8c8");
      expect(polyglotMoveToUci(blackQueensideUci)).toBe("e8c8");
    });

    it("correctly encodes UCI castling to internal Polyglot representation", () => {
      // e1 (file 4, rank 0) to h1 (file 7, rank 0)
      // from = 0*8 + 4 = 4; to = 0*8 + 7 = 7
      // raw = (4 << 6) | 7 = 256 + 7 = 263
      const whiteKingsideNum = uciToPolyglotMove("e1g1");
      expect(whiteKingsideNum).toBe(263);

      // e1 (4) to a1 (0): (4 << 6) | 0 = 256
      const whiteQueensideNum = uciToPolyglotMove("e1c1");
      expect(whiteQueensideNum).toBe(256);
    });

    it("encodes and decodes promotions correctly", () => {
      // e7e8q -> promotion to queen
      const promoNum = uciToPolyglotMove("e7e8q");
      expect(polyglotMoveToUci(promoNum)).toBe("e7e8q");

      // e7e8n -> promotion to knight
      const promoKnight = uciToPolyglotMove("e7e8n");
      expect(polyglotMoveToUci(promoKnight)).toBe("e7e8n");
    });
  });

  describe("Binary format and Big-Endian parsing", () => {
    it("parses 16-byte records with big-endian integer fields", () => {
      // Create a 16-byte Polyglot entry buffer
      const buffer = Buffer.alloc(16);
      const testKey = 0x463b96181691fc9cn;
      const testMove = uciToPolyglotMove("e2e4"); // e2 (file 4, rank 1 = 12) -> e4 (file 4, rank 3 = 28)
      const testWeight = 1500;
      const testLearn = 42;

      buffer.writeBigUInt64BE(testKey, 0);
      buffer.writeUInt16BE(testMove, 8);
      buffer.writeUInt16BE(testWeight, 10);
      buffer.writeUInt32BE(testLearn, 12);

      const book = PolyglotOpeningBook.fromBuffer(buffer, "<test-buffer>");
      expect(book.entryCount).toBe(1);

      // Starting position Polyglot hash is 0x463b96181691fc9cn
      const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
      const entries = book.getEntries(startFen);

      expect(entries).toHaveLength(1);
      expect(entries[0]?.move).toBe("e2e4");
      expect(entries[0]?.weight).toBe(1500);
      expect(entries[0]?.learn).toBe(42);
    });

    it("throws an error when buffer length is not a multiple of 16 bytes", () => {
      const invalidBuffer = Buffer.alloc(15);
      expect(() => PolyglotOpeningBook.fromBuffer(invalidBuffer)).toThrow(
        "Polyglot book length must be a multiple of 16 bytes",
      );
    });
  });

  describe("Polyglot hash calculation spec vectors", () => {
    it("computes standard starting position hash", () => {
      const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
      const hash = computePolyglotHash(startFen);
      expect(hash).toBe(0x463b96181691fc9cn);
    });
  });

  describe("Missing file handling", () => {
    it("returns null gracefully when opening book file does not exist", () => {
      const result = loadPolyglotOpeningBook("/non/existent/path/to/book.bin");
      expect(result).toBeNull();
    });
  });
});
