import type { PlayerColor } from "@chessverse/contracts";

export interface RepertoireGambit {
  id: string;
  name: string;
  color: PlayerColor;
  moves: string[]; // UCI sequence
  minEvalCp: number; // Discard line if position drops below this cp
  acceptedMove?: string;
  onAccepted?: string;
  onDeclined?: string;
}

export interface StyleRepertoire {
  id: string;
  name: string;
  lines: RepertoireGambit[];
}

export const GAMBITEER_REPERTOIRE: StyleRepertoire = {
  id: "gambiteer-repertoire",
  name: "Gambiteer Repertoire",
  lines: [
    {
      id: "kings-gambit",
      name: "King's Gambit",
      color: "white",
      moves: ["e2e4", "e7e5", "f2f4"],
      minEvalCp: -100,
      acceptedMove: "e5f4",
      onAccepted: "King's Gambit Accepted",
      onDeclined: "King's Gambit Declined",
    },
    {
      id: "evans-gambit",
      name: "Evans Gambit",
      color: "white",
      moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5", "b2b4"],
      minEvalCp: -80,
      acceptedMove: "c5b4",
      onAccepted: "Evans Gambit Accepted",
      onDeclined: "Evans Gambit Declined",
    },
    {
      id: "danish-gambit",
      name: "Danish Gambit",
      color: "white",
      moves: ["e2e4", "e7e5", "d2d4", "e5d4", "c2c3"],
      minEvalCp: -100,
      acceptedMove: "d4c3",
      onAccepted: "Danish Gambit Accepted",
      onDeclined: "Danish Gambit Declined",
    },
    {
      id: "smith-morra",
      name: "Smith-Morra Gambit",
      color: "white",
      moves: ["e2e4", "c7c5", "d2d4", "c5d4", "c2c3"],
      minEvalCp: -80,
      acceptedMove: "d4c3",
      onAccepted: "Smith-Morra Accepted",
      onDeclined: "Smith-Morra Declined",
    },
    {
      id: "benko-gambit",
      name: "Benko Gambit",
      color: "black",
      moves: ["d2d4", "g8f6", "c2c4", "c7c5", "d4d5", "b7b5"],
      minEvalCp: -80,
      acceptedMove: "c4b5",
      onAccepted: "Benko Gambit Accepted",
      onDeclined: "Benko Gambit Declined",
    },
    {
      id: "budapest-gambit",
      name: "Budapest Gambit",
      color: "black",
      moves: ["d2d4", "g8f6", "c2c4", "e7e5"],
      minEvalCp: -90,
      acceptedMove: "d4e5",
      onAccepted: "Budapest Gambit Accepted",
      onDeclined: "Budapest Gambit Declined",
    },
    {
      id: "stafford-gambit",
      name: "Stafford Gambit",
      color: "black",
      moves: ["e2e4", "e7e5", "g1f3", "g8f6", "f3e5", "b8c6"],
      minEvalCp: -140,
      acceptedMove: "e5c6",
      onAccepted: "Stafford Gambit Accepted",
    },
  ],
};

export const AGGRESSIVE_REPERTOIRE: StyleRepertoire = {
  id: "aggressive-repertoire",
  name: "Aggressive Repertoire",
  lines: [
    {
      id: "fried-liver",
      name: "Fried Liver Attack",
      color: "white",
      moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "f3g5", "d7d5", "e4d5", "f6d5", "g5f7"],
      minEvalCp: -60,
    },
    {
      id: "grand-prix",
      name: "Grand Prix Attack",
      color: "white",
      moves: ["e2e4", "c7c5", "b1c3", "b8c6", "f2f4"],
      minEvalCp: -40,
    },
    {
      id: "scotch-game",
      name: "Scotch Game",
      color: "white",
      moves: ["e2e4", "e7e5", "g1f3", "b8c6", "d2d4"],
      minEvalCp: -30,
    },
    {
      id: "sicilian-dragon",
      name: "Sicilian Dragon",
      color: "black",
      moves: ["e2e4", "c7c5", "g1f3", "d7d6", "d2d4", "c5d4", "f3d4", "g8f6", "b1c3", "g7g6"],
      minEvalCp: -40,
    },
  ],
};

export const TRICKY_REPERTOIRE: StyleRepertoire = {
  id: "tricky-repertoire",
  name: "Tricky Repertoire",
  lines: [
    {
      id: "legals-mate-trap",
      name: "Legal's Mate Trap",
      color: "white",
      moves: ["e2e4", "e7e5", "g1f3", "d7d6", "f1c4", "c8g4", "b1c3", "g7g6", "f3e5"],
      minEvalCp: -70,
    },
    {
      id: "halosar-trap",
      name: "Halosar Trap",
      color: "white",
      moves: ["d2d4", "d7d5", "e2e4", "d5e4", "b1c3", "g8f6", "f2f3"],
      minEvalCp: -80,
    },
    {
      id: "fishing-pole",
      name: "Fishing Pole Trap",
      color: "black",
      moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "g8f6", "e1g1", "f6g4", "h2h3", "h7h5"],
      minEvalCp: -100,
    },
    {
      id: "elephant-gambit",
      name: "Elephant Gambit",
      color: "black",
      moves: ["e2e4", "e7e5", "g1f3", "d7d5"],
      minEvalCp: -90,
    },
  ],
};

export const SOLID_REPERTOIRE: StyleRepertoire = {
  id: "solid-repertoire",
  name: "Solid Repertoire",
  lines: [
    {
      id: "queens-gambit",
      name: "Queen's Gambit",
      color: "white",
      moves: ["d2d4", "d7d5", "c2c4"],
      minEvalCp: 0,
    },
    {
      id: "london-system",
      name: "London System",
      color: "white",
      moves: ["d2d4", "d7d5", "c1f4"],
      minEvalCp: 0,
    },
    {
      id: "ruy-lopez",
      name: "Ruy Lopez",
      color: "white",
      moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"],
      minEvalCp: 0,
    },
    {
      id: "qgd",
      name: "Queen's Gambit Declined",
      color: "black",
      moves: ["d2d4", "d7d5", "c2c4", "e7e6"],
      minEvalCp: -20,
    },
    {
      id: "caro-kann",
      name: "Caro-Kann Classical",
      color: "black",
      moves: ["e2e4", "c7c6", "d2d4", "d7d5", "b1c3", "d5e4", "c3e4", "c8f5"],
      minEvalCp: -25,
    },
    {
      id: "berlin-defense",
      name: "Berlin Defense",
      color: "black",
      moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "g8f6"],
      minEvalCp: -20,
    },
  ],
};

const REPERTOIRES: Record<string, StyleRepertoire> = {
  "gambiteer-repertoire": GAMBITEER_REPERTOIRE,
  "aggressive-repertoire": AGGRESSIVE_REPERTOIRE,
  "tricky-repertoire": TRICKY_REPERTOIRE,
  "solid-repertoire": SOLID_REPERTOIRE,
};

export const getRepertoireById = (id: string): StyleRepertoire | null =>
  REPERTOIRES[id] ?? null;

/**
 * Searches the style repertoire for the next move matching the current move history.
 */
export const findRepertoireMove = (
  repertoireId: string,
  color: PlayerColor,
  moveHistory: string[],
  currentEvalCp = 0,
): { move: string; gambit: RepertoireGambit } | null => {
  const repertoire = getRepertoireById(repertoireId);
  if (!repertoire) return null;

  for (const line of repertoire.lines) {
    if (line.color !== color) continue;

    // Check if the current moveHistory is an exact prefix of line.moves
    if (moveHistory.length >= line.moves.length) continue;

    let prefixMatches = true;
    for (let i = 0; i < moveHistory.length; i++) {
      if (moveHistory[i] !== line.moves[i]) {
        prefixMatches = false;
        break;
      }
    }

    if (prefixMatches) {
      // Check evaluation budget
      if (currentEvalCp < line.minEvalCp) {
        continue;
      }

      const nextMove = line.moves[moveHistory.length];
      if (nextMove) {
        return { move: nextMove, gambit: line };
      }
    }
  }

  return null;
};
