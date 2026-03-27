export interface BundledBookLine {
  readonly name: string;
  readonly weight: number;
  readonly learn?: number;
  readonly moves: readonly string[];
}

export const BUNDLED_OPENING_BOOK_RELATIVE_PATH = "apps/api/assets/opening/chessverse-default.bin";

export const BUNDLED_BOOK_LINES: readonly BundledBookLine[] = [
  {
    name: "White mainline start",
    weight: 120,
    moves: ["e2e4"],
  },
  {
    name: "King's Gambit",
    weight: 130,
    moves: ["e2e4", "e7e5", "f2f4"],
  },
  {
    name: "King's Gambit Accepted development",
    weight: 126,
    moves: ["e2e4", "e7e5", "f2f4", "e5f4", "g1f3"],
  },
  {
    name: "King's Gambit Accepted h-pawn thrust",
    weight: 122,
    moves: ["e2e4", "e7e5", "f2f4", "e5f4", "g1f3", "g7g5", "h2h4"],
  },
  {
    name: "Falkbeer response as white",
    weight: 118,
    moves: ["e2e4", "e7e5", "f2f4", "d7d5", "e4d5"],
  },
  {
    name: "Smith-Morra start",
    weight: 125,
    moves: ["e2e4", "c7c5", "d2d4"],
  },
  {
    name: "Smith-Morra gambit",
    weight: 123,
    moves: ["e2e4", "c7c5", "d2d4", "c5d4", "c2c3"],
  },
  {
    name: "Smith-Morra recapture",
    weight: 120,
    moves: ["e2e4", "c7c5", "d2d4", "c5d4", "c2c3", "d4c3", "b1c3"],
  },
  {
    name: "French advance setup",
    weight: 92,
    moves: ["e2e4", "e7e6", "d2d4"],
  },
  {
    name: "Caro setup",
    weight: 91,
    moves: ["e2e4", "c7c6", "d2d4"],
  },
  {
    name: "Alekhine space gain",
    weight: 88,
    moves: ["e2e4", "g8f6", "e4e5"],
  },
  {
    name: "Black open game start",
    weight: 119,
    moves: ["e2e4", "e7e5"],
  },
  {
    name: "Falkbeer Counter-Gambit",
    weight: 132,
    moves: ["e2e4", "e7e5", "f2f4", "d7d5"],
  },
  {
    name: "Falkbeer space wedge",
    weight: 126,
    moves: ["e2e4", "e7e5", "f2f4", "d7d5", "e4d5", "e5e4"],
  },
  {
    name: "Queen pawn response",
    weight: 117,
    moves: ["d2d4", "g8f6"],
  },
  {
    name: "Benko setup",
    weight: 124,
    moves: ["d2d4", "g8f6", "c2c4", "c7c5"],
  },
  {
    name: "Benko Gambit",
    weight: 130,
    moves: ["d2d4", "g8f6", "c2c4", "c7c5", "d4d5", "b7b5"],
  },
  {
    name: "English ambush",
    weight: 86,
    moves: ["c2c4", "e7e5"],
  },
] as const;
