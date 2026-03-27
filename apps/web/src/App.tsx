import { useEffect, useMemo, useState } from "react";
import { Chessboard } from "react-chessboard";
import type { Arrow } from "react-chessboard/dist/chessboard/types";
import { motion } from "framer-motion";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { GameControls } from "./components/GameControls";
import { GameOverlay } from "./components/GameOverlay";
import { GameSidebar } from "./components/GameSidebar";
import { PlayerPanel } from "./components/PlayerPanel";
import { SideSelectionDialog } from "./components/SideSelectionDialog";
import { useGameController } from "./hooks/useGame";
import { getMoveQualityVisual } from "./components/MoveQualitySymbol";
import { EffectsLayer } from "./components/EffectsLayer";

const tabs = [
  { id: "info", label: "Info" },
  { id: "moves", label: "Moves" },
  { id: "controls", label: "Controls" },
] as const;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const calculateBoardWidth = (viewportWidth: number, viewportHeight: number) => {
  if (viewportWidth < 640) {
    return clamp(
      Math.min(viewportWidth - 24, viewportHeight - 200),
      300,
      440,
    );
  }

  if (viewportWidth < 1024) {
    return clamp(
      Math.min(viewportWidth - 46, viewportHeight - 220),
      430,
      700,
    );
  }

  return clamp(
    Math.min(viewportWidth * 0.58, viewportHeight - 180),
    560,
    920,
  );
};

const getBoardWidth = () => {
  if (typeof window === "undefined") {
    return 640;
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

  const handleShake = () => {
    setShakeBoard(true);
    setTimeout(() => setShakeBoard(false), 200);
  };

  useEffect(() => {
    const handleResize = () => {
      setBoardWidth(getBoardWidth());
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
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
      <div className="relative min-h-screen overflow-x-hidden bg-bg-base px-4 py-4 text-stone-100 sm:px-6 lg:px-8 lg:py-6 selection:bg-brand-200/30 selection:text-brand-100">
          <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_at_16%_18%,rgba(61,191,179,0.16),transparent_24%),radial-gradient(circle_at_86%_18%,rgba(88,215,229,0.12),transparent_18%),radial-gradient(circle_at_50%_110%,rgba(14,52,88,0.35),transparent_45%),linear-gradient(135deg,#020913_0%,#071320_48%,#081a2f_100%)]" />
          <div className="pointer-events-none fixed inset-0 z-0 opacity-30 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-size-[52px_52px]" />
          <div className="pointer-events-none fixed -top-[18%] -left-[8%] h-[70vh] w-[70vw] rounded-full bg-[radial-gradient(circle_at_center,rgba(124,231,214,0.16),transparent_58%)] blur-[110px] animate-pulse-slow" />
          <div className="pointer-events-none fixed -bottom-[24%] right-[-12%] h-[82vh] w-[78vw] rounded-full bg-[radial-gradient(circle_at_center,rgba(58,165,198,0.14),transparent_56%)] blur-[130px] animate-float" />

          <motion.main
              className="relative z-10 mx-auto grid w-full max-w-[1820px] gap-6 xl:grid-cols-[minmax(0,1.12fr)_minmax(560px,0.88fr)] xl:items-start xl:gap-6 2xl:grid-cols-[minmax(0,1.18fr)_minmax(620px,0.82fr)]"
              initial={{ opacity: 0, y: 26 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
              <section className="flex min-w-0 flex-col gap-5">
                  <header className="grid gap-4 rounded-[34px] border border-white/8 bg-[linear-gradient(180deg,rgba(12,22,36,0.68),rgba(8,16,28,0.34))] px-5 py-5 shadow-[0_24px_80px_rgba(2,8,20,0.24)] backdrop-blur-xl sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                      <div className="max-w-3xl">
                          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-gradient-gold">
                              Chessverse
                          </p>
                          <h1 className="font-display mt-3 text-[2.2rem] leading-[0.96] text-brand-100 drop-shadow-xl sm:max-w-[10ch] sm:text-[3.5rem] sm:leading-[0.94] lg:max-w-[11ch] lg:text-[4.2rem] 2xl:text-[4.8rem]">
                              Dangerous chess, with a conscience.
                          </h1>
                          <p className="mt-4 max-w-2xl text-sm leading-7 text-stone-300/90 sm:text-base">
                              A premium head-to-head board where the AI opens
                              with venom, hunts for traps, and still knows when
                              to switch into pure technique.
                          </p>
                      </div>

                      <div className="flex flex-col items-center gap-3 sm:items-start lg:items-end">
                          <div
                              className={`inline-flex items-center gap-3 rounded-full border px-5 py-3 text-sm font-semibold backdrop-blur-xl ${statusToneClass}`}
                          >
                              <span
                                  className={`h-2.5 w-2.5 rounded-full ${
                                      controller.statusTone === "thinking" ||
                                      controller.statusTone === "loading"
                                          ? "animate-pulse bg-current"
                                          : "bg-current"
                                  }`}
                              />
                              {controller.statusText}
                          </div>

                          <div className="grid gap-2 text-xs text-stone-300/78 sm:grid-cols-2 lg:max-w-[320px]">
                              <div className="rounded-2xl border border-white/8 bg-white/4 px-3 py-2.5">
                                  <span className="block text-[10px] uppercase tracking-[0.18em] text-stone-500">
                                      Driver
                                  </span>
                                  <span className="mt-1 block font-semibold text-brand-100">
                                      {controller.behaviorLabel}
                                  </span>
                              </div>
                              <div className="rounded-2xl border border-white/8 bg-white/4 px-3 py-2.5">
                                  <span className="block text-[10px] uppercase tracking-[0.18em] text-stone-500">
                                      Perspective
                                  </span>
                                  <span className="mt-1 block font-semibold text-brand-100">
                                      {controller.orientation} at bottom
                                  </span>
                              </div>
                          </div>
                      </div>
                  </header>

                  <motion.div
                      layout
                      className={`relative overflow-hidden rounded-[38px] glass-panel-accent p-3 sm:p-4 lg:p-5 ${
                          controller.thinking ? "animate-glow" : ""
                      } ${boardDimmed ? "pointer-events-none" : ""} ${shakeBoard ? "animate-shake" : ""}`}
                  >
                      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(124,231,214,0.08),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_32%)]" />

                      <div className="relative z-1 mb-4 flex flex-col gap-3 px-3 pt-3 sm:flex-row sm:items-end sm:justify-between sm:px-4">
                          <div>
                              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-brand-200/80">
                                  Live Board
                              </p>
                              <p className="mt-1 text-sm text-stone-300/80">
                                  Cinematic board staging with fast actions,
                                  premoves, and clean review transitions.
                              </p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                              <span className="inline-flex w-fit rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-300">
                                  {controller.orientation} side
                              </span>
                              {controller.premoveStatusText ? (
                                  <span className="inline-flex w-fit rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
                                      {controller.premoveStatusText}
                                  </span>
                              ) : null}
                          </div>
                      </div>

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

                      <div className="relative grid place-items-center rounded-[30px] border border-white/6 bg-[linear-gradient(180deg,rgba(11,24,39,0.82),rgba(9,18,31,0.96))] p-2.5 sm:p-3 lg:p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                          <div className="pointer-events-none absolute inset-4 rounded-[24px] border border-cyan-300/8" />
                          <Chessboard
                              id="chessverse-board"
                              position={reviewFen}
                              arePiecesDraggable={boardInteractive}
                              arePremovesAllowed={true}
                              boardOrientation={controller.orientation}
                              animationDuration={
                                  controller.boardAnimationDuration
                              }
                              boardWidth={boardWidth}
                              customSquareStyles={customSquareStyles}
                              customArrows={boardArrows}
                              showBoardNotation={true}
                              onPieceDragBegin={(_piece, square) =>
                                  controller.refreshTargets(square)
                              }
                              onPieceDragEnd={() => controller.clearTargets()}
                              onSquareClick={controller.handleSquareClick}
                              onSquareRightClick={
                                  controller.handleSquareRightClick
                              }
                              onPieceDrop={controller.handleDrop}
                              customDarkSquareStyle={{
                                  backgroundColor: "#35586d",
                              }}
                              customLightSquareStyle={{
                                  backgroundColor: "#e7eced",
                              }}
                              customBoardStyle={{
                                  borderRadius: "26px",
                                  boxShadow:
                                      "0 28px 80px rgba(2,8,20,0.42), 0 0 0 1px rgba(124,231,214,0.08)",
                              }}
                              customNotationStyle={{
                                  fontSize: "10px",
                                  fontWeight: "600",
                                  opacity: "0.62",
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

                      {!controller.hasLiveGame &&
                      !controller.sideSelectionOpen &&
                      !controller.confirmNewGameOpen ? (
                          <div className="absolute inset-3 z-20 grid place-items-center rounded-[26px] bg-bg-base/82 p-5 text-center backdrop-blur-md">
                              <div className="w-full max-w-md rounded-[30px] glass-panel-accent p-6 sm:p-8">
                                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-gradient-gold">
                                      Live Board
                                  </p>
                                  <h2 className="font-display mt-3 text-3xl text-brand-100 drop-shadow-md">
                                      {controller.isBootstrapping
                                          ? "Waking up the engine"
                                          : "Connect to begin"}
                                  </h2>
                                  <p className="mt-4 text-sm leading-relaxing text-stone-300/90">
                                      {controller.isBootstrapping
                                          ? "Setting up the game state and preparing the AI personality. This only takes a moment."
                                          : "The board is ready visually, but the backend has to be available before moves can be processed."}
                                  </p>
                                  <motion.button
                                      whileHover={{ scale: 1.05 }}
                                      whileTap={{ scale: 0.95 }}
                                      className="mt-6 inline-flex w-full items-center justify-center rounded-2xl btn-premium px-4 py-3 text-sm font-bold"
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
                          <div className="absolute inset-x-3 top-3 z-10 rounded-2xl border border-[#f38e8e]/25 bg-red-600/85 px-4 py-3 text-sm text-white shadow-lg sm:inset-x-4 sm:top-4">
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

                  {selectedMoveIndex !== null ? (
                      <motion.div
                          className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-brand-200/20 bg-brand-200/8 px-4 py-2.5"
                          initial={{ opacity: 0, y: -8 }}
                          animate={{ opacity: 1, y: 0 }}
                      >
                          <span className="text-xs font-medium text-brand-200">
                              {reviewMode
                                  ? `Reviewing move ${selectedMoveIndex + 1}`
                                  : `Viewing move ${selectedMoveIndex + 1}`}
                          </span>
                          <button
                              className="rounded-lg px-2.5 py-1 text-xs font-bold text-brand-200 transition hover:bg-brand-200/15"
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

                  <div className="hidden flex-col gap-5 md:flex xl:hidden">
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
                  </div>

                  <div className="grid gap-4 md:hidden">
                      <div className="grid min-w-0 grid-cols-3 gap-2">
                          {tabs.map((tab) => (
                              <button
                                  key={tab.id}
                                  className={`rounded-full border px-4 py-3 text-sm font-medium transition ${
                                      controller.mobileTab === tab.id
                                          ? "border-brand-300/40 bg-brand-300/15 text-brand-200"
                                          : "border-white/10 bg-white/5 text-stone-200 hover:border-brand-300/40 hover:bg-brand-300/10"
                                  }`}
                                  onClick={() =>
                                      controller.setMobileTab(tab.id)
                                  }
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
                              analysisPendingKeys={
                                  controller.analysisPendingKeys
                              }
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
                              analysisPendingKeys={
                                  controller.analysisPendingKeys
                              }
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

              <aside className="hidden xl:sticky xl:top-6 xl:flex xl:min-w-0 xl:max-w-[760px] xl:flex-col xl:gap-5">
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
