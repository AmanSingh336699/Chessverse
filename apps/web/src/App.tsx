import { useEffect, useMemo, useRef, useState } from "react";
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

const tabs = [
  { id: "info", label: "Intelligence" },
  { id: "moves", label: "Match Log" },
  { id: "controls", label: "Options" },
] as const;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const calculateBoardWidth = (viewportWidth: number, viewportHeight: number) => {
  if (viewportWidth < 480) {
    return clamp(Math.min(viewportWidth - 36, viewportHeight - 240), 260, 380);
  }
  if (viewportWidth < 640) {
    return clamp(Math.min(viewportWidth - 48, viewportHeight - 230), 300, 440);
  }
  if (viewportWidth < 1024) {
    return clamp(Math.min(viewportWidth - 64, viewportHeight - 220), 360, 580);
  }
  if (viewportWidth < 1440) {
    const colWidth = (Math.min(viewportWidth, 1820) - 80) * 0.55;
    return clamp(Math.min(colWidth - 48, viewportHeight - 200), 440, 720);
  }
  const colWidth = (Math.min(viewportWidth, 1820) - 96) * 0.58;
  return clamp(Math.min(colWidth - 56, viewportHeight - 200), 520, 840);
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

const App = () => {
  const controller = useGameController();
  const [boardWidth, setBoardWidth] = useState<number>(getBoardWidth);
  const [selectedMoveIndex, setSelectedMoveIndex] = useState<number | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [shakeBoard, setShakeBoard] = useState(false);
  const boardContainerRef = useRef<HTMLDivElement | null>(null);

  const handleShake = () => {
    setShakeBoard(true);
    setTimeout(() => setShakeBoard(false), 200);
  };

  useEffect(() => {
    const updateSize = () => {
      if (!boardContainerRef.current) {
        setBoardWidth(getBoardWidth());
        return;
      }
      const containerWidth = boardContainerRef.current.clientWidth;
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const isMobile = viewportWidth < 640;
      const isTablet = viewportWidth >= 640 && viewportWidth < 1024;

      const evalBarOffset = isMobile ? 0 : 84;
      const innerPadding = isMobile ? 12 : isTablet ? 20 : 28;
      const availableWidth = Math.max(250, containerWidth - innerPadding - evalBarOffset);
      const reservedHeight = isMobile ? 240 : isTablet ? 210 : 190;
      const availableHeight = Math.max(250, viewportHeight - reservedHeight);

      const optimalSize = Math.floor(Math.min(availableWidth, availableHeight));
      const minSize = isMobile ? 260 : isTablet ? 340 : 440;
      const maxSize = isMobile ? 420 : isTablet ? 580 : 800;

      setBoardWidth(clamp(optimalSize, minSize, maxSize));
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    if (boardContainerRef.current) {
      observer.observe(boardContainerRef.current);
    }
    window.addEventListener("resize", updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, []);

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

  const customSquareStyles = Object.fromEntries([
    ...(controller.lastSquares ?? []).map((square) => [
      square,
      { background: "rgba(227,169,76,0.30)" },
    ]),
    ...controller.legalTargets.map((square) => [
      square,
      {
        background:
          "radial-gradient(circle, rgba(246,199,110,0.86) 16%, rgba(246,199,110,0.14) 17%)",
      },
    ]),
    ...controller.captureTargets.map((square) => [
      square,
      {
        background: "transparent",
        boxShadow: "inset 0 0 0 3px #FF4B4B",
        animation: "pulse-ring 2s infinite ease-in-out",
        transition: "transform 0.15s ease-out, box-shadow 0.15s ease-out",
        transform: "scale(1)",
        cursor: "pointer",
        className: "threat-ring",
      },
    ]),
    ...(controller.selectedSquare
      ? [[controller.selectedSquare, { background: "rgba(247,240,223,0.14)" }]]
      : []),
    ...(controller.checkSquare
      ? [[controller.checkSquare, { background: "rgba(205,54,54,0.48)" }]]
      : []),
    ...(controller.capturedSquare
      ? [[controller.capturedSquare, { className: "ripple-flash" }]]
      : []),
    ...Object.entries(blunderHighlight),
    ...(controller.premoveSquares
      ? controller.premoveSquares.map((square) => [
          square,
          {
            background: "rgba(56,189,248,0.24)",
            boxShadow: "inset 0 0 0 2px rgba(86,208,255,0.58)",
          },
        ])
      : []),
  ]);

  const reviewArrows = useMemo<Arrow[]>(() => {
    if (!selectedEntry) {
      return [];
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

    return arrows;
  }, [selectedEntry]);

  const boardArrows = useMemo<Arrow[]>(() => {
    const arrows = [...reviewArrows];

    if (controller.premoveArrow) {
      const [from, to, color] = controller.premoveArrow;
      arrows.push([from as Arrow[0], to as Arrow[1], color]);
    }

    return arrows;
  }, [controller.premoveArrow, reviewArrows]);

  const statusToneClass =
    controller.statusTone === "error"
      ? "border-rose-300/30 bg-rose-400/10 text-rose-100"
      : controller.statusTone === "loading"
        ? "border-white/10 bg-white/[0.06] text-stone-200"
        : controller.statusTone === "thinking"
          ? "border-cyan-300/35 bg-cyan-400/10 text-cyan-100 shadow-[0_0_36px_rgba(88,215,229,0.14)]"
          : "border-emerald-400/25 bg-emerald-500/10 text-emerald-100";

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
    setSelectedMoveIndex(null);
    if (
      controller.game?.status === "playing" ||
      controller.game?.status === "check"
    ) {
      setReviewMode(false);
    }
  }, [controller.game?.gameId, controller.game?.moveHistory.length, controller.game?.status]);

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
    <div className="relative min-h-screen overflow-x-hidden bg-bg-base px-2.5 py-3 sm:px-5 sm:py-5 lg:px-8 lg:py-6 selection:bg-brand-200/30 selection:text-brand-100">
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
          {/* Responsive Header */}
          <header className="grid gap-3 sm:gap-4 rounded-2xl sm:rounded-[34px] border border-white/8 bg-[linear-gradient(180deg,rgba(12,22,36,0.68),rgba(8,16,28,0.34))] p-3.5 sm:px-6 sm:py-5 shadow-[0_24px_80px_rgba(2,8,20,0.24)] backdrop-blur-xl sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-gradient-gold">
                  Chessverse
                </span>
                <span className="inline-flex items-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-300">
                  AI Chess
                </span>
              </div>
              <h1 className="font-display mt-1 sm:mt-2 text-2xl sm:text-[3.2rem] lg:text-[4.2rem] 2xl:text-[4.8rem] leading-[1.02] sm:leading-[0.94] text-brand-100 drop-shadow-xl sm:max-w-[11ch]">
                Dangerous chess, with a conscience.
              </h1>
              <p className="mt-2 sm:mt-4 max-w-2xl text-xs sm:text-base leading-relaxed text-stone-300/90 hidden sm:block">
                A premium head-to-head board where the AI opens with venom, hunts for traps, and still knows when to switch into pure technique.
              </p>
            </div>

            <div className="flex flex-row flex-wrap sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 sm:gap-3">
              <div
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 sm:px-5 sm:py-2.5 text-xs sm:text-sm font-semibold backdrop-blur-xl ${statusToneClass}`}
              >
                <span
                  className={`h-2 w-2 sm:h-2.5 sm:w-2.5 rounded-full ${
                    controller.statusTone === "thinking" ||
                    controller.statusTone === "loading"
                      ? "animate-pulse bg-current"
                      : "bg-current"
                  }`}
                />
                {controller.statusText}
              </div>

              <div className="flex items-center gap-2 text-xs text-stone-300/78">
                <div className="rounded-xl sm:rounded-2xl border border-white/8 bg-white/4 px-2.5 py-1.5 sm:px-3 sm:py-2">
                  <span className="block text-[9px] sm:text-[10px] uppercase tracking-[0.18em] text-stone-500">
                    Driver
                  </span>
                  <span className="mt-0.5 block font-semibold text-brand-100 text-xs sm:text-sm">
                    {controller.behaviorLabel}
                  </span>
                </div>
                <div className="rounded-xl sm:rounded-2xl border border-white/8 bg-white/4 px-2.5 py-1.5 sm:px-3 sm:py-2">
                  <span className="block text-[9px] sm:text-[10px] uppercase tracking-[0.18em] text-stone-500">
                    Side
                  </span>
                  <span className="mt-0.5 block font-semibold text-brand-100 text-xs sm:text-sm capitalize">
                    {controller.orientation}
                  </span>
                </div>
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
                  <span className="inline-flex w-fit rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2.5 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
                    {controller.premoveStatusText}
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
                className="relative grid place-items-center w-full max-w-fit rounded-[20px] sm:rounded-[30px] border border-white/6 bg-[linear-gradient(180deg,rgba(11,24,39,0.82),rgba(9,18,31,0.96))] p-1.5 sm:p-3 lg:p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
              >
                <div className="pointer-events-none absolute inset-2.5 sm:inset-4 rounded-2xl sm:rounded-3xl border border-cyan-300/8" />
                <Chessboard
                  id="chessverse-board"
                  position={reviewFen}
                  arePiecesDraggable={boardInteractive}
                  arePremovesAllowed={true}
                  boardOrientation={controller.orientation}
                  animationDuration={controller.boardAnimationDuration}
                  boardWidth={boardWidth}
                  customSquareStyles={customSquareStyles}
                  customArrows={boardArrows}
                  showBoardNotation={true}
                  onPieceDragBegin={(_piece, square) =>
                    controller.refreshTargets(square)
                  }
                  onPieceDragEnd={() => controller.clearTargets()}
                  onSquareClick={controller.handleSquareClick}
                  onSquareRightClick={controller.handleSquareRightClick}
                  onPieceDrop={controller.handleDrop}
                  customDarkSquareStyle={{
                    backgroundColor: "#2a4c60",
                  }}
                  customLightSquareStyle={{
                    backgroundColor: "#e8eff2",
                  }}
                  customBoardStyle={{
                    borderRadius: "18px",
                    boxShadow:
                      "0 24px 70px rgba(2,8,20,0.55), 0 0 0 1px rgba(124,231,214,0.12)",
                  }}
                  customNotationStyle={{
                    fontSize: boardWidth < 360 ? "9px" : "11px",
                    fontWeight: "700",
                    opacity: "0.75",
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

            {/* Quick Action Toolbar directly under the board */}
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-white/6 px-1 pt-2.5 sm:px-2">
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
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7v6h6" />
                    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
                  </svg>
                  <span>Undo</span>
                </button>

                <button
                  type="button"
                  onClick={controller.flipBoard}
                  disabled={!controller.canFlipBoard}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs font-semibold text-stone-200 transition hover:bg-white/10 disabled:opacity-40 touch-manipulation"
                  title="Flip Board View"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 16V4M7 4L3 8M7 4L11 8M17 8V20M17 20L21 16M17 20L13 16" />
                  </svg>
                  <span>Flip</span>
                </button>

                <button
                  type="button"
                  onClick={controller.startNewGame}
                  className="inline-flex items-center gap-1.5 rounded-xl btn-premium px-3.5 py-1.5 sm:py-2 text-xs font-bold touch-manipulation"
                  title="Start New Game"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
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
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                    <line x1="4" y1="22" x2="4" y2="15" />
                  </svg>
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
                      : "Connect to begin"}
                  </h2>
                  <p className="mt-3 text-xs sm:text-sm leading-relaxed text-stone-300/90">
                    {controller.isBootstrapping
                      ? "Setting up the game state and preparing the AI personality. This only takes a moment."
                      : "The board is ready visually, but the backend has to be available before moves can be processed."}
                  </p>
                  <motion.button
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    className="mt-5 inline-flex w-full items-center justify-center rounded-2xl btn-premium px-4 py-3 text-sm font-bold touch-manipulation"
                    onClick={controller.retryConnection}
                    disabled={controller.isBootstrapping}
                  >
                    {controller.isBootstrapping
                      ? "Connecting..."
                      : "Retry Connection"}
                  </motion.button>
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
        </aside>
      </motion.main>

      <SideSelectionDialog
        open={controller.sideSelectionOpen}
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
    </div>
  );
};

export default App;
