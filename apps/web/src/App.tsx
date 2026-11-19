import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import type { Arrow } from "react-chessboard/dist/chessboard/types";
import { motion, AnimatePresence } from "framer-motion";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { GameControls } from "./components/GameControls";
import { GameOverlay } from "./components/GameOverlay";
import { GameSidebar } from "./components/GameSidebar";
import { PlayerPanel } from "./components/PlayerPanel";
import { SideSelectionDialog } from "./components/SideSelectionDialog";
import { useGameController } from "./hooks/useGame";
import { getMoveQualityVisual } from "./components/MoveQualitySymbol";
import { EffectsLayer } from "./components/EffectsLayer";
import { EvaluationBar } from "./components/EvaluationBar";
import { Navbar } from "./components/Navbar";
import { AuthModal } from "./components/AuthModal";
import { GameHistoryModal } from "./components/GameHistoryModal";
import { HomePage } from "./components/HomePage";
import { useAuth } from "./hooks/useAuth";
import type { StyleId } from "@chessverse/contracts";
import { BOARD_THEMES, CLASSIC_GREEN, getStoredBoardTheme, type BoardTheme } from "./lib/boardThemes";
import { soundEngine } from "./lib/sound";
import { SwordsIcon, ShieldIcon, DicesIcon, ZapIcon, KingPieceIcon, Volume2Icon, VolumeXIcon, PaletteIcon, AlertTriangleIcon, CheckIcon, ChevronDownIcon, RotateCcwIcon, ArrowUpDownIcon, PlusIcon, FlagIcon, LightbulbIcon } from "./components/icons";

const STYLE_HEADER_META: Record<
  string,
  {
    name: string;
    tag: string;
    Icon: typeof SwordsIcon;
    badgeBg: string;
    badgeBorder: string;
    badgeText: string;
    glow: string;
  }
> = {
  aggressive: {
    name: "Aggressive",
    tag: "King Attacker",
    Icon: SwordsIcon,
    badgeBg: "bg-rose-500/15",
    badgeBorder: "border-rose-400/35",
    badgeText: "text-rose-200",
    glow: "shadow-[0_0_12px_rgba(244,63,94,0.2)]",
  },
  solid: {
    name: "Solid",
    tag: "Positional Master",
    Icon: ShieldIcon,
    badgeBg: "bg-cyan-500/15",
    badgeBorder: "border-cyan-400/35",
    badgeText: "text-cyan-200",
    glow: "shadow-[0_0_12px_rgba(6,182,212,0.2)]",
  },
  gambiteer: {
    name: "Gambiteer",
    tag: "Romantic Sacrifices",
    Icon: DicesIcon,
    badgeBg: "bg-purple-500/15",
    badgeBorder: "border-purple-400/35",
    badgeText: "text-purple-200",
    glow: "shadow-[0_0_12px_rgba(168,85,247,0.2)]",
  },
  tricky: {
    name: "Tricky",
    tag: "Tactical Swindler",
    Icon: ZapIcon,
    badgeBg: "bg-amber-500/15",
    badgeBorder: "border-amber-400/35",
    badgeText: "text-amber-200",
    glow: "shadow-[0_0_12px_rgba(245,158,11,0.2)]",
  },
};

const DIFFICULTY_HEADER_META: Record<string, { label: string; depth: number }> = {
  beginner: { label: "Beginner", depth: 4 },
  casual: { label: "Casual", depth: 6 },
  intermediate: { label: "Intermediate", depth: 8 },
  advanced: { label: "Advanced", depth: 10 },
  master: { label: "Master", depth: 18 },
};

const tabs = [
  { id: "info", label: "Intelligence" },
  { id: "moves", label: "Match Log" },
  { id: "controls", label: "Options" },
] as const;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const calculateBoardWidth = (viewportWidth: number, viewportHeight: number) => {
  if (viewportWidth < 480) {
    return clamp(Math.min(viewportWidth - 20, viewportHeight - 205), 250, 400);
  }
  if (viewportWidth < 640) {
    return clamp(Math.min(viewportWidth - 32, viewportHeight - 210), 290, 460);
  }
  if (viewportWidth < 1024) {
    return clamp(Math.min(viewportWidth - 48, viewportHeight - 210), 340, 580);
  }
  if (viewportWidth < 1440) {
    const colWidth = (Math.min(viewportWidth, 1820) - 72) * 0.55;
    return clamp(Math.min(colWidth - 44, viewportHeight - 190), 440, 720);
  }
  const colWidth = (Math.min(viewportWidth, 1820) - 88) * 0.58;
  return clamp(Math.min(colWidth - 52, viewportHeight - 190), 520, 840);
};

const getBoardWidth = () => {
  if (typeof window === "undefined") {
    return 600;
  }

  return calculateBoardWidth(window.innerWidth, window.innerHeight);
};

const PIECE_VALUES: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

interface CapturedInfo {
  pieces: string[];
  advantage: number;
}

const SAFE_PIECE_UNICODE: Record<string, string> = {
  P: "\u2659",
  N: "\u2658",
  B: "\u2657",
  R: "\u2656",
  Q: "\u2655",
  p: "\u265F",
  n: "\u265E",
  b: "\u265D",
  r: "\u265C",
  q: "\u265B",
};

const getCaptured = (
  fen: string,
): { white: CapturedInfo; black: CapturedInfo } => {
  const initial: Record<string, number> = {
    P: 8,
    N: 2,
    B: 2,
    R: 2,
    Q: 1,
    p: 8,
    n: 2,
    b: 2,
    r: 2,
    q: 1,
  };
  const current: Record<string, number> = {};
  const placement = fen.split(" ")[0] ?? "";

  for (const ch of placement) {
    if (/[PNBRQpnbrqKk]/.test(ch)) {
      current[ch] = (current[ch] ?? 0) + 1;
    }
  }

  const whiteCaptures: string[] = [];
  const blackCaptures: string[] = [];
  let whiteMaterial = 0;
  let blackMaterial = 0;

  for (const [piece, count] of Object.entries(initial)) {
    const remaining = current[piece] ?? 0;
    const captured = count - remaining;
    const unicode = SAFE_PIECE_UNICODE[piece];

    if (captured <= 0 || !unicode) {
      continue;
    }

    if (piece === piece.toUpperCase()) {
      for (let index = 0; index < captured; index += 1) {
        blackCaptures.push(unicode);
      }
      blackMaterial += captured * (PIECE_VALUES[piece.toLowerCase()] ?? 0);
    } else {
      for (let index = 0; index < captured; index += 1) {
        whiteCaptures.push(unicode);
      }
      whiteMaterial += captured * (PIECE_VALUES[piece] ?? 0);
    }
  }

  return {
    white: { pieces: whiteCaptures, advantage: whiteMaterial - blackMaterial },
    black: { pieces: blackCaptures, advantage: blackMaterial - whiteMaterial },
  };
};

const EMPTY_ARROWS: Arrow[] = [];

const App = () => {
  const controller = useGameController();
  const auth = useAuth();
  const [currentView, setCurrentView] = useState<"home" | "arena">("home");
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [boardWidth, setBoardWidth] = useState<number>(getBoardWidth);
  const [selectedMoveIndex, setSelectedMoveIndex] = useState<number | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [shakeBoard, setShakeBoard] = useState(false);
  const boardContainerRef = useRef<HTMLDivElement | null>(null);
  const [boardThemeKey, setBoardThemeKey] = useState<string>(getStoredBoardTheme);
  const [userArrows, setUserArrows] = useState<Arrow[]>([]);
  const [userHighlights, setUserHighlights] = useState<Record<string, string>>({});
  const [isSoundMuted, setIsSoundMuted] = useState<boolean>(() => soundEngine.isMuted());
  const [isThemePickerOpen, setIsThemePickerOpen] = useState(false);
  const lastRefreshedGameIdRef = useRef<string | null>(null);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  const activeTheme: BoardTheme = BOARD_THEMES[boardThemeKey] ?? CLASSIC_GREEN;

  const handleSelectTheme = (themeId: string) => {
    setBoardThemeKey(themeId);
    if (typeof window !== "undefined") {
      localStorage.setItem("chessverse:board-theme", themeId);
    }
    setIsThemePickerOpen(false);
  };

  const handleToggleSound = () => {
    const next = soundEngine.toggleMute();
    setIsSoundMuted(next);
  };

  const handleSquareRightClick = (square: string) => {
    controller.clearPremove();
    setUserHighlights((prev) => {
      const next = { ...prev };
      if (next[square]) {
        delete next[square];
      } else {
        next[square] = "rgba(235, 97, 80, 0.65)";
      }
      return next;
    });
  };

  const clearUserDrawings = useCallback(() => {
    setUserArrows((prev) => (prev.length === 0 ? prev : []));
    setUserHighlights((prev) => (Object.keys(prev).length === 0 ? prev : {}));
  }, []);

  const handleArrowsChange = useCallback((arrows: Arrow[]) => {
    setUserArrows((prev) => {
      if (prev.length === 0 && arrows.length === 0) return prev;
      if (
        prev.length === arrows.length &&
        prev.every(
          (a, i) =>
            a[0] === arrows[i]?.[0] &&
            a[1] === arrows[i]?.[1] &&
            a[2] === arrows[i]?.[2],
        )
      ) {
        return prev;
      }
      return arrows;
    });
  }, []);

  const handleShake = useCallback(() => {
    setShakeBoard(true);
    setTimeout(() => setShakeBoard(false), 200);
  }, []);

  const handleStartGameFromHome = (style?: StyleId) => {
    if (style) {
      controller.setStyle(style);
    }
    if (!controller.hasLiveGame) {
      controller.openSideSelection();
    }
    setCurrentView("arena");
  };

  const handleResumeGame = (gameId: string) => {
    void controller.loadGame(gameId);
    setCurrentView("arena");
  };

  useEffect(() => {
    const status = controller.game?.status;
    const gameId = controller.game?.gameId;
    if (
      status &&
      gameId &&
      lastRefreshedGameIdRef.current !== gameId &&
      ["checkmate", "stalemate", "draw", "resigned"].includes(status)
    ) {
      lastRefreshedGameIdRef.current = gameId;
      void auth.refreshProfile();
    }
  }, [controller.game?.gameId, controller.game?.status, auth.refreshProfile]);

  useEffect(() => {
    let rafId: number | null = null;
    const updateSize = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        const nextWidth = getBoardWidth();
        setBoardWidth((prev) => (Math.abs(prev - nextWidth) > 2 ? nextWidth : prev));
      });
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", updateSize);
    };
  }, [currentView]);

  const reviewFen = useMemo(() => {
    if (selectedMoveIndex !== null && controller.game) {
      return controller.game.moveHistory[selectedMoveIndex]?.fenAfter ?? controller.displayedFen;
    }

    return controller.displayedFen;
  }, [controller.displayedFen, controller.game, selectedMoveIndex]);

  const selectedEntry =
    selectedMoveIndex !== null && controller.game
      ? controller.game.moveHistory[selectedMoveIndex] ?? null
      : null;

  const captured = useMemo(
    () => getCaptured(reviewFen),
    [reviewFen],
  );

  const lastAnalysis = controller.game?.moveHistory.at(-1)?.analysis;
  const lastMoveEntry = controller.game?.moveHistory.at(-1);

  const gameEval = controller.game?.evaluation ?? null;

  const mobileEvalPercent = useMemo(() => {
    if (typeof gameEval !== "number") return 50;
    const clamped = Math.max(-10, Math.min(10, gameEval));
    const normalized = 50 + Math.tanh(clamped / 3) * 50;
    return controller.orientation === "black" ? 100 - normalized : normalized;
  }, [gameEval, controller.orientation]);

  const blunderHighlight = useMemo(() => {
    if (
      lastAnalysis &&
      lastMoveEntry &&
      (lastAnalysis.classification === "blunder" ||
        lastAnalysis.classification === "mistake")
    ) {
      const fromSquare = lastMoveEntry.moveUci.slice(0, 2);
      const color =
        lastAnalysis.classification === "blunder"
          ? "rgba(248,113,113,0.34)"
          : "rgba(251,146,60,0.30)";
      return { [fromSquare]: { background: color } };
    }

    return {};
  }, [lastAnalysis, lastMoveEntry]);

  const customSquareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};

    for (const square of controller.lastSquares ?? []) {
      styles[square] = { background: activeTheme.lastMoveColor };
    }

    for (const square of controller.legalTargets) {
      styles[square] = {
        background:
          "radial-gradient(circle, rgba(0, 0, 0, 0.18) 22%, transparent 23%)",
        cursor: "pointer",
      };
    }

    for (const square of controller.captureTargets) {
      styles[square] = {
        background:
          "radial-gradient(circle, transparent 65%, rgba(0, 0, 0, 0.22) 66%, rgba(0, 0, 0, 0.22) 78%, transparent 79%)",
        cursor: "pointer",
      };
    }

    if (controller.selectedSquare) {
      styles[controller.selectedSquare] = { background: activeTheme.selectedColor };
    }

    if (controller.checkSquare) {
      styles[controller.checkSquare] = {
        background:
          "radial-gradient(ellipse at center, rgba(239, 68, 68, 0.9) 0%, rgba(220, 38, 38, 0.6) 38%, rgba(185, 28, 28, 0.2) 72%, transparent 100%)",
      };
    }

    for (const [square, color] of Object.entries(userHighlights)) {
      styles[square] = { background: color };
    }

    if (controller.capturedSquare) {
      styles[controller.capturedSquare] = { className: "ripple-flash" } as React.CSSProperties;
    }

    for (const [square, styleObj] of Object.entries(blunderHighlight)) {
      styles[square] = { ...styles[square], ...styleObj };
    }

    if (controller.premoveSquares) {
      for (const square of controller.premoveSquares) {
        styles[square] = {
          background: "rgba(244, 91, 53, 0.45)",
          boxShadow: "inset 0 0 0 2.5px rgba(244, 91, 53, 0.8)",
        };
      }
    }

    if (controller.hint) {
      styles[controller.hint.from] = {
        background: "radial-gradient(circle, rgba(245, 158, 11, 0.45) 0%, rgba(245, 158, 11, 0.15) 70%, transparent 100%)",
        boxShadow: "inset 0 0 0 2px rgba(245, 158, 11, 0.8)",
      };
      styles[controller.hint.to] = {
        background: "radial-gradient(circle, rgba(245, 158, 11, 0.35) 0%, rgba(245, 158, 11, 0.1) 70%, transparent 100%)",
        boxShadow: "inset 0 0 0 2px rgba(245, 158, 11, 0.7)",
      };
    }

    return styles;
  }, [
    activeTheme.lastMoveColor,
    activeTheme.selectedColor,
    blunderHighlight,
    controller.captureTargets,
    controller.capturedSquare,
    controller.checkSquare,
    controller.hint,
    controller.lastSquares,
    controller.legalTargets,
    controller.premoveSquares,
    controller.selectedSquare,
    userHighlights,
  ]);

  const reviewArrows = useMemo<Arrow[]>(() => {
    if (!selectedEntry) {
      return EMPTY_ARROWS;
    }

    const arrows: Arrow[] = [];
    const analysis = selectedEntry.analysis;
    const moveFrom = selectedEntry.moveUci.slice(0, 2);
    const moveTo = selectedEntry.moveUci.slice(2, 4);
    const visual = getMoveQualityVisual(
      analysis?.classification ?? null,
      analysis?.displayMode ?? "badge",
    );

    if (moveFrom.length === 2 && moveTo.length === 2) {
      arrows.push([moveFrom as Arrow[0], moveTo as Arrow[1], visual?.color ?? "#58d7e5"]);
    }

    if (
      analysis &&
      analysis.bestMove &&
      analysis.bestMove !== selectedEntry.moveUci &&
      analysis.displayMode !== "none"
    ) {
      const bestFrom = analysis.bestMove.slice(0, 2);
      const bestTo = analysis.bestMove.slice(2, 4);

      if (bestFrom.length === 2 && bestTo.length === 2) {
        arrows.push([bestFrom as Arrow[0], bestTo as Arrow[1], "#7ce7d6"]);
      }
    }

    return arrows.length > 0 ? arrows : EMPTY_ARROWS;
  }, [selectedEntry]);

  const boardArrows = useMemo<Arrow[]>(() => {
    const arrows: Arrow[] = [...reviewArrows];

    if (controller.premoveArrow) {
      const [from, to, color] = controller.premoveArrow;
      arrows.push([from as Arrow[0], to as Arrow[1], color]);
    }

    if (controller.hint) {
      arrows.push([
        controller.hint.from as Arrow[0],
        controller.hint.to as Arrow[1],
        "rgba(245, 158, 11, 0.92)",
      ]);
    }

    return arrows.length > 0 ? arrows : EMPTY_ARROWS;
  }, [controller.hint, controller.premoveArrow, reviewArrows]);

  const statusToneClass =
    controller.statusTone === "error"
      ? "border-rose-300/30 bg-rose-400/10 text-rose-100"
      : controller.statusTone === "loading"
        ? "border-white/10 bg-white/[0.06] text-stone-200"
        : controller.statusTone === "thinking"
          ? "border-cyan-300/35 bg-cyan-400/10 text-cyan-100 shadow-[0_0_36px_rgba(88,215,229,0.14)]"
          : "border-emerald-400/25 bg-emerald-500/10 text-emerald-100";

  const activeStyleKey = (
    controller.game?.style ??
    controller.style ??
    "aggressive"
  ).toLowerCase();
  const currentStyle =
    (STYLE_HEADER_META[activeStyleKey] ?? STYLE_HEADER_META.aggressive)!;

  const activeDiffKey = (
    controller.game?.difficulty ??
    controller.difficulty ??
    "advanced"
  ).toLowerCase();
  const currentDiff =
    (DIFFICULTY_HEADER_META[activeDiffKey] ?? DIFFICULTY_HEADER_META.advanced)!;

  const boardInteractive =
    controller.hasLiveGame &&
    !controller.sideSelectionOpen &&
    !controller.confirmNewGameOpen &&
    !controller.undoAnimating &&
    !reviewMode &&
    !["checkmate", "draw", "resigned", "stalemate"].includes(
      controller.game?.status ?? "playing",
    );

  const handleSelectMove = (index: number) => {
    setReviewMode(true);
    setSelectedMoveIndex((current) => (current === index ? null : index));
  };

  useEffect(() => {
    setSelectedMoveIndex((prev) => (prev !== null ? null : prev));
    if (
      controller.game?.status === "playing" ||
      controller.game?.status === "check"
    ) {
      setReviewMode((prev) => (prev ? false : prev));
    }
  }, [controller.game?.gameId, controller.game?.moveHistory.length, controller.game?.status]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        controllerRef.current.clearPremove();
        controllerRef.current.clearTargets();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleReviewGame = () => {
    if (!controller.game || controller.game.moveHistory.length === 0) {
      return;
    }

    setReviewMode(true);
    setSelectedMoveIndex(controller.game.moveHistory.length - 1);
  };

  const boardDimmed =
    controller.sideSelectionOpen || controller.confirmNewGameOpen;

  const topColor = controller.orientation === "white" ? "black" : "white";
  const bottomColor = controller.orientation === "white" ? "white" : "black";

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-bg-base text-brand-100 flex flex-col justify-between selection:bg-brand-200/30 selection:text-brand-100">
      <Navbar
        currentView={currentView}
        onNavigate={(view) => {
          if (view === "arena" && !controller.hasLiveGame) {
            controller.openSideSelection();
          }
          setCurrentView(view);
        }}
        user={auth.user}
        onOpenAuth={() => setIsAuthOpen(true)}
        onOpenHistory={() => setIsHistoryOpen(true)}
        onLogout={auth.logout}
        onNewGame={() => {
          controller.openSideSelection();
          setCurrentView("arena");
        }}
      />

      {currentView === "home" ? (
        <HomePage
          onStartGame={handleStartGameFromHome}
          onOpenSideDialog={() => {
            controller.openSideSelection();
            setCurrentView("arena");
          }}
          onOpenAuth={() => setIsAuthOpen(true)}
          onOpenHistory={() => setIsHistoryOpen(true)}
          user={auth.user}
        />
      ) : (
        <div className="relative flex-1 px-2.5 py-3 sm:px-5 sm:py-5 lg:px-8 lg:py-6">
          <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_at_16%_18%,rgba(61,191,179,0.16),transparent_24%),radial-gradient(circle_at_86%_18%,rgba(88,215,229,0.12),transparent_18%),radial-gradient(circle_at_50%_110%,rgba(14,52,88,0.35),transparent_45%),linear-gradient(135deg,#020913_0%,#071320_48%,#081a2f_100%)]" />
          <div className="pointer-events-none fixed inset-0 z-0 opacity-30 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-size-[52px_52px]" />
          <div className="pointer-events-none fixed -top-[18%] -left-[8%] h-[70vh] w-[70vw] rounded-full bg-[radial-gradient(circle_at_center,rgba(124,231,214,0.16),transparent_58%)] blur-[110px] animate-pulse-slow" />
          <div className="pointer-events-none fixed -bottom-[24%] right-[-12%] h-[82vh] w-[78vw] rounded-full bg-[radial-gradient(circle_at_center,rgba(58,165,198,0.14),transparent_56%)] blur-[130px] animate-float" />

          <motion.main
            className="relative z-10 mx-auto grid w-full max-w-[1820px] gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1.15fr)_420px] xl:grid-cols-[minmax(0,1.2fr)_minmax(480px,0.8fr)] 2xl:grid-cols-[minmax(0,1.25fr)_minmax(540px,0.75fr)] lg:items-start"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
        <section className="flex min-w-0 flex-col gap-3.5 sm:gap-5">
          {/* Responsive Executive Header */}
          <header className="rounded-2xl sm:rounded-3xl border border-white/10 bg-[linear-gradient(135deg,rgba(12,22,36,0.85)_0%,rgba(8,16,28,0.65)_100%)] p-3.5 sm:px-5 sm:py-3.5 shadow-[0_16px_50px_rgba(2,8,20,0.35)] backdrop-blur-xl flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-gradient-gold">
                    Chessverse Arena
                  </span>
                  <span className="inline-flex items-center rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-300">
                    Live
                  </span>
                </div>
                <h1 className="font-display text-base sm:text-xl text-brand-100 font-semibold tracking-tight mt-0.5">
                  Tactical Arena
                </h1>
              </div>

              {/* Match Configuration Badges */}
              <div className="flex flex-wrap items-center gap-2 pt-1 sm:pt-0 sm:border-l sm:border-white/10 sm:pl-4">
                {/* Opponent Style Badge */}
                <div
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold backdrop-blur-md transition-all ${currentStyle.badgeBorder} ${currentStyle.badgeBg} ${currentStyle.badgeText} ${currentStyle.glow}`}
                  title={`Opponent Style: ${currentStyle.name} (${currentStyle.tag})`}
                >
                  <currentStyle.Icon size={14} className="shrink-0" />
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-bold tracking-wide">{currentStyle.name}</span>
                    <span className="text-[10px] opacity-80 font-normal hidden sm:inline">({currentStyle.tag})</span>
                  </div>
                </div>

                {/* Difficulty Badge */}
                <div
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-stone-200"
                  title={`AI Difficulty Level: ${currentDiff.label} (Depth ${currentDiff.depth})`}
                >
                  <span className="text-stone-400 text-[10px] uppercase font-bold tracking-wider">Lvl:</span>
                  <span className="font-semibold text-brand-100">{currentDiff.label}</span>
                  <span className="text-[10px] text-stone-400 font-mono">D{currentDiff.depth}</span>
                </div>

                {/* Player Side Badge */}
                <div
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-stone-200"
                  title={`You are commanding ${controller.playerColor}`}
                >
                  <KingPieceIcon size={16} fill={controller.playerColor} className="shrink-0" />
                  <span className="capitalize font-semibold text-brand-100">{controller.playerColor}</span>
                </div>
              </div>
            </div>

            {/* Live Status & Driver */}
            <div className="flex items-center justify-between md:justify-end gap-2.5 sm:gap-3">
              <div className="hidden xl:flex flex-col text-right">
                <span className="text-[9px] uppercase tracking-[0.18em] text-stone-500 font-bold">
                  Engine Driver
                </span>
                <span className="font-mono text-xs text-brand-200/90 font-semibold">
                  {controller.behaviorLabel}
                </span>
              </div>

              <div
                className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold backdrop-blur-xl ${statusToneClass}`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    controller.statusTone === "thinking" ||
                    controller.statusTone === "loading"
                      ? "animate-pulse bg-current"
                      : "bg-current"
                  }`}
                />
                <span>{controller.statusText}</span>
              </div>
            </div>
          </header>

          {/* Live Board Stage Container */}
          <motion.div
            layout
            className={`relative overflow-hidden rounded-[26px] sm:rounded-[38px] glass-panel-accent p-2.5 sm:p-4 lg:p-5 ${
              controller.thinking ? "animate-glow" : ""
            } ${boardDimmed ? "pointer-events-none" : ""} ${shakeBoard ? "animate-shake" : ""}`}
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(124,231,214,0.08),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_32%)]" />

            {/* Board Sub-header */}
            <div className="relative z-1 mb-2.5 sm:mb-4 flex flex-col gap-2 px-2 pt-1 sm:flex-row sm:items-end sm:justify-between sm:px-4">
              <div>
                <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.24em] text-brand-200/80">
                  Live Board
                </p>
                <p className="mt-0.5 text-xs sm:text-sm text-stone-300/80 hidden sm:block">
                  Cinematic board staging with fast actions, premoves, and clean review transitions.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex w-fit rounded-full border border-white/10 bg-white/5 px-2.5 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-300">
                  {controller.orientation} side
                </span>
                {controller.premoveStatusText ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/40 bg-cyan-500/15 px-3 py-1 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-cyan-200 shadow-[0_0_12px_rgba(6,182,212,0.25)] animate-pulse">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                    <span>{controller.premoveStatusText}</span>
                    <button
                      type="button"
                      onClick={() => controller.clearPremove()}
                      className="ml-1 text-cyan-300 hover:text-white transition-colors cursor-pointer text-xs"
                      title="Cancel premove (or right-click anywhere on the board)"
                    >
                      ✕
                    </button>
                  </span>
                ) : null}
                {controller.premoveNotice ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/35 bg-amber-500/15 px-3 py-1 text-[10px] sm:text-[11px] font-medium text-amber-200 shadow-[0_0_12px_rgba(245,158,11,0.2)]">
                    <span className="flex items-center gap-1.5"><AlertTriangleIcon size={13} className="text-amber-400 shrink-0" /><span>{controller.premoveNotice}</span></span>
                    <button
                      type="button"
                      onClick={() => controller.clearPremoveNotice()}
                      className="ml-1 text-amber-300 hover:text-white transition-colors cursor-pointer text-xs"
                    >
                      ✕
                    </button>
                  </span>
                ) : null}
              </div>
            </div>

            {/* Top Player Panel (Opponent) */}
            <PlayerPanel
              label={
                topColor === controller.playerColor
                  ? "You"
                  : "Chessverse AI"
              }
              color={topColor}
              captured={
                topColor === "white"
                  ? captured.white
                  : captured.black
              }
              isThinking={
                controller.thinking &&
                topColor !== controller.orientation
              }
            />

            {/* Mobile Horizontal Evaluation Indicator Strip (<640px) */}
            <div className="sm:hidden px-2.5 my-2">
              <div className="flex items-center justify-between text-[11px] font-bold tracking-wider uppercase text-stone-300 mb-1.5">
                <span className="flex items-center gap-1.5 text-stone-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.8)]" />
                  <span>Evaluation</span>
                </span>
                <span
                  className={`font-mono text-xs font-black px-2 py-0.5 rounded-md border shadow-xs ${
                    typeof gameEval === "number" && gameEval > 0.15
                      ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/30"
                      : typeof gameEval === "number" && gameEval < -0.15
                        ? "bg-rose-500/15 text-rose-300 border-rose-400/30"
                        : "bg-white/8 text-cyan-200 border-white/12"
                  }`}
                >
                  {typeof gameEval === "number"
                    ? (gameEval > 0 ? `+${gameEval.toFixed(1)}` : gameEval.toFixed(1))
                    : "0.0"}
                </span>
              </div>
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-[#070e1a] border border-white/12 shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)]">
                <div
                  className="h-full rounded-full bg-linear-to-r from-emerald-400 via-brand-200 to-cyan-300 transition-all duration-300 shadow-[0_0_8px_rgba(124,231,214,0.4)]"
                  style={{ width: `${Math.max(4, Math.min(96, mobileEvalPercent))}%` }}
                />
              </div>
            </div>

            {/* Chessboard & Vertical Evaluation Bar Wrapper */}
            <div
              ref={boardContainerRef}
              className="relative my-1 flex items-center justify-center gap-3 sm:gap-4 md:gap-5 w-full"
            >
              {/* Vertical Evaluation Bar (Tablet and Desktop) */}
              <div className="hidden sm:flex shrink-0 items-center justify-center">
                <EvaluationBar
                  evaluation={gameEval}
                  lastClassification={lastAnalysis?.classification}
                  lastDisplayMode={lastAnalysis?.displayMode ?? "badge"}
                  perspective={controller.orientation}
                  height={boardWidth}
                />
              </div>

              {/* Chessboard Stage Card */}
              <div
                onContextMenu={(e) => {
                  e.preventDefault();
                }}
                className="relative grid place-items-center w-full max-w-fit rounded-xl border border-white/10 bg-[#161512] p-1.5 sm:p-2.5 shadow-[0_20px_60px_rgba(0,0,0,0.6)] select-none"
              >
                <Chessboard
                  id="chessverse-board"
                  position={reviewFen}
                  arePiecesDraggable={boardInteractive}
                  isDraggablePiece={({ piece }) =>
                    piece.startsWith(controller.playerColor === "white" ? "w" : "b")
                  }
                  snapToCursor={true}
                  arePremovesAllowed={true}
                  clearPremovesOnRightClick={true}
                  areArrowsAllowed={true}
                  customArrowColor="rgba(255, 170, 0, 0.88)"
                  boardOrientation={controller.orientation}
                  animationDuration={controller.boardAnimationDuration}
                  boardWidth={boardWidth}
                  customSquareStyles={customSquareStyles}
                  customArrows={boardArrows}
                  showBoardNotation={true}
                  onArrowsChange={handleArrowsChange}
                  onPieceDragBegin={(_piece, square) => {
                    clearUserDrawings();
                    controller.clearHint();
                    controller.refreshTargets(square);
                  }}
                  onPieceDragEnd={() => controller.clearTargets()}
                  onSquareClick={(square) => {
                    clearUserDrawings();
                    controller.clearHint();
                    controller.handleSquareClick(square);
                  }}
                  onSquareRightClick={(square) => handleSquareRightClick(square)}
                  onPieceDrop={(source, target, piece) => {
                    clearUserDrawings();
                    controller.clearHint();
                    return controller.handleDrop(source, target, piece);
                  }}
                  customDarkSquareStyle={{
                    backgroundColor: activeTheme.darkSquare,
                  }}
                  customLightSquareStyle={{
                    backgroundColor: activeTheme.lightSquare,
                  }}
                  customBoardStyle={{
                    borderRadius: "6px",
                    boxShadow: "0 12px 36px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08)",
                  }}
                  customNotationStyle={{
                    fontSize: boardWidth < 360 ? "10px" : "11px",
                    fontWeight: "700",
                    opacity: "0.85",
                  }}
                />
                <EffectsLayer
                  lastMove={controller.game?.moveHistory.at(-1) ?? null}
                  status={controller.game?.status ?? "playing"}
                  orientation={controller.orientation}
                  boardWidth={boardWidth}
                  onShake={handleShake}
                />
              </div>
            </div>

            {/* Bottom Player Panel (Current User) */}
            <PlayerPanel
              label={
                bottomColor === controller.playerColor
                  ? "You"
                  : "Chessverse AI"
              }
              color={bottomColor}
              captured={
                bottomColor === "white"
                  ? captured.white
                  : captured.black
              }
              isThinking={
                controller.thinking &&
                bottomColor !== controller.orientation
              }
            />

            {/* Tactical Hint Banner */}
            <AnimatePresence>
              {controller.hint ? (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.18 }}
                  className="mt-2.5 flex items-center justify-between gap-3 rounded-2xl border border-amber-400/35 bg-gradient-to-r from-amber-500/15 via-amber-950/25 to-slate-900/60 p-2.5 sm:p-3 shadow-lg backdrop-blur-md"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 border border-amber-400/30 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.25)]">
                      <LightbulbIcon size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                        <span className="font-mono text-xs font-black uppercase text-amber-300 tracking-wide">
                          Best Move: {controller.hint.san}
                        </span>
                        <span className="rounded-md bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-amber-200 uppercase border border-amber-400/25">
                          {controller.hint.from} ➔ {controller.hint.to}
                        </span>
                        {typeof controller.hint.eval === "number" ? (
                          <span className="text-[10px] text-stone-300 font-mono">
                            Eval: {controller.hint.eval > 0 ? `+${controller.hint.eval.toFixed(1)}` : controller.hint.eval.toFixed(1)}
                          </span>
                        ) : null}
                        <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-emerald-300 border border-emerald-400/25">
                          Stockfish Master 2850+
                        </span>
                      </div>
                      <p className="text-xs text-stone-200 mt-0.5 leading-snug line-clamp-2">
                        {controller.hint.explanation}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={controller.clearHint}
                    className="shrink-0 rounded-lg p-1 text-stone-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-xs"
                    title="Dismiss Hint"
                  >
                    ✕
                  </button>
                </motion.div>
              ) : null}
            </AnimatePresence>

            {controller.hintError ? (
              <div className="mt-2 flex items-center justify-between rounded-xl border border-rose-500/30 bg-rose-500/15 px-3 py-2 text-xs text-rose-200">
                <span>{controller.hintError}</span>
                <button
                  type="button"
                  onClick={controller.clearHint}
                  className="ml-2 text-rose-300 hover:text-white cursor-pointer"
                >
                  ✕
                </button>
              </div>
            ) : null}

            {/* Quick Action Toolbar directly under the board */}
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-1 pt-2.5 sm:px-2">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={controller.undoMove}
                  disabled={!controller.canUndo || controller.isPending}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs font-semibold transition touch-manipulation ${
                    controller.undoPulseVisible
                      ? "animate-pulse border-amber-400/40 bg-amber-400/20 text-amber-200 shadow-[0_0_16px_rgba(251,191,36,0.3)]"
                      : "border-white/10 bg-white/5 text-stone-200 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                  }`}
                  title={controller.undoHint}
                >
                  <RotateCcwIcon size={14} />
                  <span>Undo</span>
                </button>

                <button
                  type="button"
                  onClick={controller.flipBoard}
                  disabled={!controller.canFlipBoard}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs font-semibold text-stone-200 transition hover:bg-white/10 disabled:opacity-40 touch-manipulation"
                  title="Flip Board View"
                >
                  <ArrowUpDownIcon size={14} />
                  <span>Flip</span>
                </button>

                {/* Sound Toggle Button */}
                <button
                  type="button"
                  onClick={handleToggleSound}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs font-semibold transition touch-manipulation ${
                    isSoundMuted
                      ? "border-rose-400/25 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                      : "border-emerald-400/25 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                  }`}
                  title={isSoundMuted ? "Unmute chess sound effects" : "Mute chess sound effects"}
                >
                  {isSoundMuted ? <VolumeXIcon size={14} /> : <Volume2Icon size={14} />}
                  <span className="hidden sm:inline">{isSoundMuted ? "Muted" : "Sound"}</span>
                </button>

                {/* Board Theme Switcher Dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsThemePickerOpen((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs font-semibold text-stone-200 transition hover:bg-white/10 touch-manipulation"
                    title="Change Chessboard Theme"
                  >
                    <PaletteIcon size={14} className="text-stone-300" />
                    <span className="hidden sm:inline">{activeTheme.name}</span>
                    <ChevronDownIcon size={12} className="opacity-60" />
                  </button>

                  {isThemePickerOpen ? (
                    <div className="absolute bottom-full left-0 mb-2 z-50 w-48 rounded-xl border border-white/12 bg-[#121c28] p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl">
                      <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">
                        Board Theme
                      </p>
                      {Object.values(BOARD_THEMES).map((theme) => (
                        <button
                          key={theme.id}
                          type="button"
                          onClick={() => handleSelectTheme(theme.id)}
                          className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                            boardThemeKey === theme.id
                              ? "bg-cyan-500/20 text-cyan-200 font-semibold"
                              : "text-stone-300 hover:bg-white/5"
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <span className="flex h-3.5 w-3.5 overflow-hidden rounded-full border border-white/30">
                              <span
                                className="w-1/2 h-full"
                                style={{ backgroundColor: theme.lightSquare }}
                              />
                              <span
                                className="w-1/2 h-full"
                                style={{ backgroundColor: theme.darkSquare }}
                              />
                            </span>
                            <span>{theme.name}</span>
                          </span>
                          {boardThemeKey === theme.id ? <CheckIcon size={13} className="text-cyan-300" /> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                {/* AI Hint Button */}
                <button
                  type="button"
                  onClick={controller.requestHint}
                  disabled={
                    !controller.hasLiveGame ||
                    controller.thinking ||
                    controller.isHintLoading ||
                    ["checkmate", "draw", "stalemate", "resigned"].includes(
                      controller.game?.status ?? "",
                    )
                  }
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs font-semibold transition touch-manipulation cursor-pointer ${
                    controller.hint
                      ? "border-amber-400/50 bg-amber-500/25 text-amber-200 shadow-[0_0_12px_rgba(245,158,11,0.3)]"
                      : "border-white/10 bg-white/5 text-stone-200 hover:border-amber-400/30 hover:bg-amber-500/10 hover:text-amber-200 disabled:opacity-40 disabled:cursor-not-allowed"
                  }`}
                  title="Get Stockfish Master Move Hint (Depth 18, 2850+ Elo)"
                >
                  {controller.isHintLoading ? (
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-300 border-t-transparent" />
                  ) : (
                    <LightbulbIcon size={14} className="text-amber-300" />
                  )}
                  <span>{controller.isHintLoading ? "Analyzing..." : "Hint"}</span>
                </button>

                <button
                  type="button"
                  onClick={controller.startNewGame}
                  className="inline-flex items-center gap-1.5 rounded-xl btn-premium px-3.5 py-1.5 sm:py-2 text-xs font-bold touch-manipulation"
                  title="Start New Game"
                >
                  <PlusIcon size={14} />
                  <span>New Game</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={controller.resignGame}
                  disabled={!controller.hasLiveGame || ["checkmate", "draw", "stalemate", "resigned"].includes(controller.game?.status ?? "")}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-30 disabled:cursor-not-allowed touch-manipulation"
                  title="Resign Game"
                >
                  <FlagIcon size={14} />
                  <span>Resign</span>
                </button>
              </div>
            </div>

            {/* Offline / Reconnect Overlay */}
            {!controller.hasLiveGame &&
            !controller.sideSelectionOpen &&
            !controller.confirmNewGameOpen ? (
              <div className="absolute inset-2 sm:inset-3 z-20 grid place-items-center rounded-[22px] sm:rounded-[26px] bg-bg-base/85 p-4 sm:p-5 text-center backdrop-blur-md">
                <div className="w-full max-w-md rounded-[26px] sm:rounded-[30px] glass-panel-accent p-5 sm:p-8">
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-gradient-gold">
                    Live Board
                  </p>
                  <h2 className="font-display mt-2 sm:mt-3 text-2xl sm:text-3xl text-brand-100 drop-shadow-md">
                    {controller.isBootstrapping
                      ? "Waking up the engine"
                      : "Start a Match"}
                  </h2>
                  <p className="mt-3 text-xs sm:text-sm leading-relaxed text-stone-300/90">
                    {controller.isBootstrapping
                      ? "Setting up the game state and preparing the AI personality. This only takes a moment."
                      : "Choose your pieces and challenge the adaptive chess AI personality."}
                  </p>
                  <div className="mt-5 flex flex-col sm:flex-row gap-2.5">
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="inline-flex flex-1 items-center justify-center rounded-2xl btn-premium px-4 py-3 text-sm font-bold touch-manipulation cursor-pointer"
                      onClick={() => controller.openSideSelection()}
                      disabled={controller.isBootstrapping}
                    >
                      <PlusIcon size={16} className="mr-1.5" />
                      <span>{controller.isBootstrapping ? "Connecting..." : "New Game"}</span>
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-3 text-xs font-semibold text-stone-300 transition-colors touch-manipulation cursor-pointer"
                      onClick={controller.retryConnection}
                      disabled={controller.isBootstrapping}
                      title="Reconnect to Chess Engine"
                    >
                      <span>Reconnect</span>
                    </motion.button>
                  </div>
                </div>
              </div>
            ) : null}

            {controller.error && controller.hasLiveGame ? (
              <div className="absolute inset-x-2 top-2 sm:inset-x-4 sm:top-4 z-10 rounded-2xl border border-[#f38e8e]/25 bg-red-600/85 px-3.5 py-2.5 sm:px-4 sm:py-3 text-xs sm:text-sm text-white shadow-lg">
                {controller.error}
              </div>
            ) : null}

            <GameOverlay
              game={controller.game}
              onNewGame={controller.startNewGame}
              onReview={handleReviewGame}
              onUndo={controller.undoMove}
              canUndo={controller.canUndo}
              undoHint={controller.undoHint}
              reviewMode={reviewMode}
            />
          </motion.div>

          {/* Move Review Info Strip */}
          {selectedMoveIndex !== null ? (
            <motion.div
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-brand-200/20 bg-brand-200/8 px-3.5 py-2 sm:px-4 sm:py-2.5"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <span className="text-xs font-medium text-brand-200">
                {reviewMode
                  ? `Reviewing move ${selectedMoveIndex + 1}`
                  : `Viewing move ${selectedMoveIndex + 1}`}
              </span>
              <button
                className="rounded-lg px-2.5 py-1 text-xs font-bold text-brand-200 transition hover:bg-brand-200/15 touch-manipulation"
                onClick={() => {
                  setSelectedMoveIndex(null);
                  setReviewMode(false);
                }}
              >
                {controller.game?.status === "playing" ||
                controller.game?.status === "check"
                  ? "Back to live"
                  : "Exit review"}
              </button>
            </motion.div>
          ) : null}

          {/* Mobile & Tablet Tabbed Navigation (< 1024px) */}
          <div className="grid gap-3 lg:hidden">
            <div className="grid min-w-0 grid-cols-3 gap-1.5 sm:gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  className={`rounded-xl sm:rounded-full border px-3 py-2 sm:px-4 sm:py-2.5 text-xs sm:text-sm font-semibold transition touch-manipulation text-center truncate ${
                    controller.mobileTab === tab.id
                      ? "border-brand-300/40 bg-brand-300/15 text-brand-200 shadow-[0_0_12px_rgba(86,208,255,0.15)]"
                      : "border-white/10 bg-white/5 text-stone-200 hover:border-brand-300/40 hover:bg-brand-300/10"
                  }`}
                  onClick={() => controller.setMobileTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {controller.mobileTab === "info" ? (
              <GameSidebar
                game={controller.game}
                behaviorLabel={controller.behaviorLabel}
                balance={controller.balance}
                section="info"
                thinking={controller.thinking}
                analysisPendingKeys={controller.analysisPendingKeys}
                onSelectMove={handleSelectMove}
                selectedMoveIndex={selectedMoveIndex}
                playerColor={controller.playerColor}
              />
            ) : null}

            {controller.mobileTab === "moves" ? (
              <GameSidebar
                game={controller.game}
                behaviorLabel={controller.behaviorLabel}
                balance={controller.balance}
                section="moves"
                thinking={controller.thinking}
                analysisPendingKeys={controller.analysisPendingKeys}
                onSelectMove={handleSelectMove}
                selectedMoveIndex={selectedMoveIndex}
                playerColor={controller.playerColor}
              />
            ) : null}

            {controller.mobileTab === "controls" ? (
              <GameControls
                difficulty={controller.difficulty}
                playerColor={controller.playerColor}
                onNewGame={controller.startNewGame}
                onFlipBoard={controller.flipBoard}
                onResign={controller.resignGame}
                onUndo={controller.undoMove}
                canUndo={controller.canUndo}
                canFlipBoard={controller.canFlipBoard}
                undoHint={controller.undoHint}
                undoPulseVisible={controller.undoPulseVisible}
                premoveStatusText={controller.premoveStatusText}
                disabled={controller.isPending}
              />
            ) : null}
          </div>
        </section>

        {/* Desktop Sticky Sidebar (>= 1024px) */}
        <aside className="hidden lg:sticky lg:top-6 lg:flex lg:min-w-0 lg:flex-col lg:gap-5">
          <GameSidebar
            game={controller.game}
            behaviorLabel={controller.behaviorLabel}
            balance={controller.balance}
            section="full"
            thinking={controller.thinking}
            analysisPendingKeys={controller.analysisPendingKeys}
            onSelectMove={handleSelectMove}
            selectedMoveIndex={selectedMoveIndex}
            playerColor={controller.playerColor}
          />
        </aside>
      </motion.main>
      </div>
      )}

      <SideSelectionDialog
        open={currentView === "arena" && controller.sideSelectionOpen}
        onClose={controller.closeSideSelection}
        onChoose={controller.chooseSide}
        difficulty={controller.difficulty}
        setDifficulty={controller.setDifficulty}
        style={controller.style}
        setStyle={controller.setStyle}
      />

      <ConfirmDialog
        open={controller.confirmNewGameOpen}
        title="Start a fresh game?"
        description="Are you sure? Your current game will be lost and the side selection dialog will open again before the next match begins."
        confirmLabel="Start Fresh"
        cancelLabel="Keep Playing"
        onConfirm={controller.confirmNewGame}
        onCancel={controller.cancelNewGameConfirmation}
      />

      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onLogin={auth.login}
        onRegister={auth.register}
      />

      <GameHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        onResumeGame={handleResumeGame}
      />
    </div>
  );
};

export default App;
