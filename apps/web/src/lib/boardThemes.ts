export interface BoardTheme {
  id: string;
  name: string;
  darkSquare: string;
  lightSquare: string;
  lastMoveColor: string;
  selectedColor: string;
  borderPreview: string;
}

export const CLASSIC_GREEN: BoardTheme = {
  id: "green",
  name: "Classic Green",
  darkSquare: "#739552",
  lightSquare: "#ebecd0",
  lastMoveColor: "rgba(255, 255, 51, 0.42)",
  selectedColor: "rgba(255, 255, 51, 0.58)",
  borderPreview: "from-[#739552] to-[#ebecd0]",
};

export const BOARD_THEMES: Record<string, BoardTheme> = {
  green: CLASSIC_GREEN,
  wood: {
    id: "wood",
    name: "Warm Walnut",
    darkSquare: "#b58863",
    lightSquare: "#f0d9b5",
    lastMoveColor: "rgba(245, 215, 110, 0.45)",
    selectedColor: "rgba(245, 215, 110, 0.65)",
    borderPreview: "from-[#b58863] to-[#f0d9b5]",
  },
  ocean: {
    id: "ocean",
    name: "Cool Slate",
    darkSquare: "#8ca2ad",
    lightSquare: "#dee3e6",
    lastMoveColor: "rgba(100, 200, 240, 0.38)",
    selectedColor: "rgba(100, 200, 240, 0.55)",
    borderPreview: "from-[#8ca2ad] to-[#dee3e6]",
  },
  charcoal: {
    id: "charcoal",
    name: "Charcoal",
    darkSquare: "#4e4b47",
    lightSquare: "#706e6b",
    lastMoveColor: "rgba(250, 204, 21, 0.38)",
    selectedColor: "rgba(250, 204, 21, 0.55)",
    borderPreview: "from-[#4e4b47] to-[#706e6b]",
  },
  cyber: {
    id: "cyber",
    name: "Cyber Neon",
    darkSquare: "#2a4c60",
    lightSquare: "#e8eff2",
    lastMoveColor: "rgba(124, 231, 214, 0.35)",
    selectedColor: "rgba(124, 231, 214, 0.55)",
    borderPreview: "from-[#2a4c60] to-[#e8eff2]",
  },
};

export const DEFAULT_BOARD_THEME = "green";

export const getStoredBoardTheme = (): string => {
  if (typeof window === "undefined") return DEFAULT_BOARD_THEME;
  const stored = localStorage.getItem("chessverse:board-theme");
  return stored && BOARD_THEMES[stored] ? stored : DEFAULT_BOARD_THEME;
};
