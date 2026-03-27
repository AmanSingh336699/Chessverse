import { useEffect, useMemo, useRef, useState } from "react";
import type {
  GameSnapshot,
  MoveAnalysisResult,
  MoveClassification,
  MoveHistoryEntry,
  PlayerColor,
} from "../contracts";
import { motion, AnimatePresence } from "framer-motion";
import { MoveQualitySymbol, getMoveQualityVisual } from "./MoveQualitySymbol";
import { MoveExplanationPanel } from "./MoveExplanationPanel";

interface GameSidebarProps {
  game: GameSnapshot | null;
  behaviorLabel: string;
  balance: number;
  section?: "full" | "info" | "moves";
  thinking?: boolean;
  analysisPendingKeys?: string[];
  onSelectMove?: (index: number) => void;
  selectedMoveIndex?: number | null;
  playerColor?: PlayerColor;
}

const QUALITY_WEIGHTS: Record<MoveClassification, number> = {
  brilliant: 100,
  best: 100,
  excellent: 90,
  good: 75,
  inaccuracy: 50,
  mistake: 20,
  blunder: 0,
};

const PIECE_ICONS: Record<string, string> = {
  p: "♙",
  n: "♘",
  b: "♗",
  r: "♖",
  q: "♕",
};

const titleCase = (value: string): string =>
  value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join(" ");

const formatContribution = (score: number) =>
  `${score > 0 ? "+" : ""}${score.toFixed(1)}`;

const groupedMoves = (history: GameSnapshot["moveHistory"]) => {
  const rows: Array<{
    turn: number;
    whiteEntry?: MoveHistoryEntry;
    blackEntry?: MoveHistoryEntry;
  }> = [];

  for (let index = 0; index < history.length; index += 2) {
    const row: typeof rows[number] = { turn: Math.floor(index / 2) + 1 };
    const whiteEntry = history[index];
    const blackEntry = history[index + 1];
    if (whiteEntry) row.whiteEntry = whiteEntry;
    if (blackEntry) row.blackEntry = blackEntry;
    rows.push(row);
  }

  return rows;
};

const getAnalysisSummary = (analysis: MoveAnalysisResult | null | undefined) =>
  analysis?.shortExplanation ?? analysis?.explanations[0]?.short ?? "";

const getMoveCellTone = (
  analysis: MoveAnalysisResult | null | undefined,
  isSelected: boolean,
) => {
  const visual = getMoveQualityVisual(
    analysis?.classification,
    analysis?.displayMode,
  );

  if (isSelected) {
    return {
      background: "rgba(86, 199, 255, 0.12)",
      boxShadow: "inset 0 0 0 1px rgba(86, 199, 255, 0.22)",
    };
  }
  if (!visual) return undefined;
  return { background: visual.tint };
};

const buildMoveAriaLabel = (entry: MoveHistoryEntry, analysisPending: boolean) => {
  const analysis = entry.analysis;
  const summary = getAnalysisSummary(analysis);
  if (!analysis || analysis.displayMode === "none") {
    return `Move ${entry.moveNumber}, ${entry.moveNotation}${analysisPending ? ", analysis in progress" : ""}${entry.player === "ai" ? ", AI move" : ""}`;
  }
  const visual = getMoveQualityVisual(analysis.classification, analysis.displayMode);
  return `Move ${entry.moveNumber}, ${entry.moveNotation}, classified as ${visual?.label ?? analysis.classification}${summary ? ` - ${summary}` : ""}${entry.player === "ai" ? ", AI move" : ""}`;
};

const buildReviewSummary = (history: MoveHistoryEntry[]) => {
  const emptyCounts = { brilliant: 0, best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
  const summary = {
    human: { counts: { ...emptyCounts }, accuracy: 0, scoredMoves: 0 },
    ai: { counts: { ...emptyCounts }, accuracy: 0, scoredMoves: 0 },
  };

  for (const entry of history) {
    const analysis = entry.analysis;
    if (!analysis || analysis.displayMode === "none") continue;
    const bucket = summary[entry.player];
    bucket.counts[analysis.classification] += 1;
    bucket.accuracy += QUALITY_WEIGHTS[analysis.classification];
    bucket.scoredMoves += 1;
  }

  return {
    human: { ...summary.human, accuracy: summary.human.scoredMoves > 0 ? Math.round(summary.human.accuracy / summary.human.scoredMoves) : 0 },
    ai: { ...summary.ai, accuracy: summary.ai.scoredMoves > 0 ? Math.round(summary.ai.accuracy / summary.ai.scoredMoves) : 0 },
  };
};

/* --- SUBCOMPONENTS --- */

const SideDot = ({ player, mobileOnly }: { player: "human" | "ai", mobileOnly?: boolean }) => (
  <span
    className={`h-[7px] w-[7px] shrink-0 rounded-full ${
      mobileOnly ? "inline-block sm:hidden" : "inline-block"
    } ${
      player === "human"
        ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.45)]"
        : "bg-violet-400 shadow-[0_0_6px_rgba(167,139,250,0.45)]"
    }`}
    title={player === "human" ? "You" : "AI"}
  />
);

interface MoveCellProps {
  entry: MoveHistoryEntry | undefined;
  thinking: boolean;
  isLast: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onExplain: () => void;
  moveIndex: number;
  analysisPending?: boolean;
}

const MoveCell = ({ entry, thinking, isLast, isSelected, onSelect, onExplain, moveIndex, analysisPending = false }: MoveCellProps) => {
  if (!entry) return <span className="min-h-10 text-stone-600 select-none">-</span>;

  const analysis = entry.analysis;
  const displayMode = analysis?.displayMode ?? "badge";
  const visual = analysis && displayMode !== "none" ? getMoveQualityVisual(analysis.classification, displayMode) : null;
  const isAnalyzing = (isLast && thinking && entry.player === "human" && !analysis) || (analysisPending && !analysis);
  const summary = getAnalysisSummary(analysis);

  return (
    <button
      type="button"
      className="group relative flex min-h-10 w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-stone-200 transition-colors hover:bg-white/6 hover:text-brand-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-200/40"
      style={getMoveCellTone(analysis, isSelected)}
      onClick={() => {
        onSelect();
        if (analysis && displayMode !== "none") onExplain();
      }}
      aria-label={buildMoveAriaLabel(entry, isAnalyzing)}
      aria-current={isSelected ? "true" : undefined}
      data-move-index={moveIndex}
    >
      <SideDot player={entry.player} mobileOnly />
      <MoveQualitySymbol classification={analysis?.classification} displayMode={displayMode} analyzing={isAnalyzing} />
      <span className="text-sm font-medium" style={{ color: visual?.color }}>{entry.moveNotation}</span>
      {visual && (
        <span className="ml-auto hidden text-[10px] font-semibold uppercase tracking-wider opacity-0 transition-opacity group-hover:opacity-80 sm:block" style={{ color: visual.color }}>
          {visual.label}
        </span>
      )}
      {summary && displayMode !== "none" && (
        <span className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-64 rounded-2xl border border-white/10 bg-[#0d1726]/96 px-3 py-2 text-xs leading-5 text-stone-200 opacity-0 shadow-2xl backdrop-blur-xl transition-all duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 md:block">
          {summary}
        </span>
      )}
    </button>
  );
};

const ReviewSummaryCard = ({ history }: { history: MoveHistoryEntry[] }) => {
  const summary = buildReviewSummary(history);
  const items = [
    { label: "Brilliant", key: "brilliant", color: "#1BACA6" },
    { label: "Best", key: "best", color: "#F6C700" },
    { label: "Excellent", key: "excellent", color: "#5B8A3C" },
    { label: "Good", key: "good", color: "#96BC4B" },
    { label: "Inaccuracy", key: "inaccuracy", color: "#F0A500" },
    { label: "Mistake", key: "mistake", color: "#E07B1F" },
    { label: "Blunder", key: "blunder", color: "#CA3431" },
  ] as const;

  return (
      <div className="rounded-2xl border border-white/8 bg-bg-surface px-4 py-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-brand-200/80">
              Review Summary
          </p>
          <p className="mt-2 text-sm text-stone-300/85">
              Real-time classification totals for both sides.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
              {(["human", "ai"] as const).map((side) => (
                  <div
                      key={side}
                      className="rounded-2xl border border-white/8 bg-white/3 px-4 py-3"
                  >
                      <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold text-stone-100">
                              {side === "human" ? "You" : "Chessverse AI"}
                          </p>
                          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-brand-100">
                              {summary[side].accuracy}% accuracy
                          </span>
                      </div>
                      <div className="mt-3 space-y-2">
                          {items.map((item) => (
                              <div
                                  key={item.key}
                                  className="flex items-center justify-between text-xs text-stone-300"
                              >
                                  <span className="flex items-center gap-2">
                                      <span
                                          className="inline-flex h-2.5 w-2.5 rounded-full"
                                          style={{ background: item.color }}
                                      />
                                      {item.label}
                                  </span>
                                  <span>
                                      {
                                          summary[side].counts[
                                              item.key as keyof typeof summary.human.counts
                                          ]
                                      }
                                  </span>
                              </div>
                          ))}
                      </div>
                  </div>
              ))}
          </div>
      </div>
  );
};


const StatusBadge = ({ status, thinking }: { status: GameSnapshot["status"], thinking: boolean }) => {
  if (status === "checkmate") {
    return (
      <span className="flex items-center gap-2 rounded-full border border-yellow-500/20 bg-yellow-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-yellow-500 shadow-[0_0_12px_rgba(234,179,8,0.2)]">
        CHECKMATE
      </span>
    );
  }
  if (status === "check") {
    return (
      <span className="flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-red-400 shadow-[0_0_12px_rgba(239,68,68,0.3)]">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
        CHECK
      </span>
    );
  }
  if (status !== "playing") {
    return (
      <span className="flex items-center gap-2 rounded-full border border-slate-500/30 bg-slate-500/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-300">
        DRAW
      </span>
    );
  }
  if (thinking) {
    return (
      <span className="flex items-center gap-2 rounded-full border border-teal-500/20 bg-teal-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-teal-300">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-400" />
        THINKING
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-400">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-(--color-status-playing) shadow-[0_0_8px_rgba(74,222,128,0.6)]" />
      IN PROGRESS
    </span>
  );
};

const IntegratedEvalBar = ({ evaluation, mateIn }: { evaluation: number | null, mateIn?: number | null }) => {
  const getPercent = () => {
    if (typeof mateIn === "number") return mateIn > 0 ? 98 : 2;
    if (evaluation === null) return 50;
    const clamped = Math.max(-10, Math.min(10, evaluation));
    const normalized = 50 + Math.tanh(clamped / 3) * 50;
    return Math.max(2, Math.min(98, normalized));
  };
  
  const widthPercent = getPercent();
  const isWhiteAdvantage = (evaluation ?? 0) > 0 || (typeof mateIn === "number" && mateIn > 0);

  return (
      <div className="mt-5 mb-4 px-1">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs font-bold font-mono tracking-tight">
              <span className="text-eval-white">
                  {isWhiteAdvantage && typeof mateIn === "number"
                      ? `M${mateIn}`
                      : isWhiteAdvantage && evaluation !== null
                        ? `+${evaluation.toFixed(1)}`
                        : ""}
              </span>
              <span className="text-brand-300">Eval</span>
              <span className="text-slate-400">
                  {!isWhiteAdvantage && typeof mateIn === "number"
                      ? `M${mateIn}`
                      : !isWhiteAdvantage && evaluation !== null
                        ? `${evaluation.toFixed(1)}`
                        : ""}
              </span>
          </div>

          <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-eval-black shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]">
              <div
                  className="absolute inset-y-0 left-0 bg-eval-white transition-all duration-600 ease-in-out"
                  style={{ width: `${widthPercent}%` }}
              />
              <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-red-500/40 mix-blend-overlay" />
          </div>
      </div>
  );
};

const extractCapturedArray = (fen: string, playerColor: "white" | "black") => {
  const pieces = fen.split(" ")[0] ?? "";
  const startingCounts: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, P: 8, N: 2, B: 2, R: 2, Q: 1 };
  const currentCounts: Record<string, number> = {};
  
  for (const char of pieces) {
    if (/[a-zA-Z]/.test(char)) currentCounts[char] = (currentCounts[char] || 0) + 1;
  }
  
  const captured: string[] = [];
  const targetChars = playerColor === "white" ? ["p", "n", "b", "r", "q"] : ["P", "N", "B", "R", "Q"];
  
  for (const char of targetChars) {
    const start = startingCounts[char] || 0;
    const current = currentCounts[char] || 0;
    const diff = start - current;
    const icon = PIECE_ICONS[char.toLowerCase()];
    if (icon) {
      for (let i = 0; i < diff; i++) {
        captured.push(icon);
      }
    }
  }
  
  // Custom sorting by piece value approximate visual size roughly
  const order: Record<string, number> = { "♕": 1, "♖": 2, "♗": 3, "♘": 4, "♙": 5 };
  captured.sort((a, b) => (order[a] || 99) - (order[b] || 99));

  return captured;
};

/* --- MAIN COMPONENT --- */

export const GameSidebar = ({
  game,
  behaviorLabel,
  balance,
  section = "full",
  thinking = false,
  analysisPendingKeys = [],
  onSelectMove,
  selectedMoveIndex,
  playerColor = "white",
}: GameSidebarProps) => {
  const history = game?.moveHistory ?? [];
  const moveRows = groupedMoves(history);
  const pendingKeySet = new Set(analysisPendingKeys);
  const showInfo = section === "full" || section === "info";
  const showMoves = section === "full" || section === "moves";
  
  const currentEngineMode = titleCase(game?.engineState.lastDominantMode ?? behaviorLabel);
  const activeBehaviorRoles = (game?.engineState.lastActiveBehaviors ?? []).filter((entry) => entry.score >= 0.05);

  const movesEndRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    movesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [history.length]);

  const [explainIndex, setExplainIndex] = useState<number | null>(null);
  const explainEntry = explainIndex !== null ? history[explainIndex] : null;

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const classificationReady = useMemo(
    () => history.some((entry) => entry.analysis && entry.analysis.displayMode !== "none"),
    [history]
  );

  const playerColorStr = playerColor || "white";
  const aiColorStr = playerColor === "white" ? "black" : "white";
  const fen = game?.fen || "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  const aiCapturedPieces = extractCapturedArray(fen, playerColorStr); // AI takes human pieces
  const playerCapturedPieces = extractCapturedArray(fen, aiColorStr); // Human takes AI pieces

  const activeTurn = (history.length % 2 === 0) ? "white" : "black";

  return (
      <motion.aside
          className="flex flex-col gap-5 bg-transparent"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1 }}
      >
          {showInfo && (
              <section className="rounded-[32px] glass-panel p-5 sm:p-6 lg:p-7 relative overflow-hidden flex flex-col gap-6">
                  {/* Header Row */}
                  <div className="flex items-center justify-between z-10">
                      <h3 className="text-xl font-bold tracking-wide text-brand-100 uppercase">
                          Status
                      </h3>
                      <StatusBadge
                          status={game?.status ?? "playing"}
                          thinking={thinking}
                      />
                  </div>

                  {/* Evaluation Integrated Component */}
                  <IntegratedEvalBar evaluation={game?.evaluation ?? null} />

                  {/* Player Strip Section */}
                  <div className="flex flex-col gap-1 w-full bg-[#030912]/40 rounded-3xl p-2 border border-white/4">
                      {/* AI Strip */}
                      <div
                          className={`relative px-4 py-3 rounded-2xl transition-all duration-300 ${activeTurn === aiColorStr ? "bg-white/6 border border-white/8" : "bg-transparent border border-transparent"} flex items-center justify-between`}
                      >
                          {activeTurn === aiColorStr && (
                              <div className="absolute left-0 inset-y-4 w-1 bg-violet-400 rounded-r-md" />
                          )}
                          <div className="flex items-center gap-3">
                              <div className="h-10 w-10 flex items-center justify-center shrink-0 rounded-xl bg-linear-to-br from-slate-600 to-slate-900 shadow-md border border-white/10 text-white text-lg">
                                  {aiColorStr === "black" ? "♚" : "♔"}
                              </div>
                              <div className="flex flex-col">
                                  <span className="text-sm font-semibold text-white">
                                      Chessverse AI
                                  </span>
                                  {aiCapturedPieces.length > 0 && (
                                      <span className="truncate text-sm tracking-[0.2em] text-slate-400 ml-0.5">
                                          {aiCapturedPieces.join("")}
                                      </span>
                                  )}
                              </div>
                          </div>
                          <div className="flex items-center gap-2">
                              {(balance < 0 && playerColorStr === "white") ||
                              (balance > 0 && playerColorStr === "black") ? (
                                  <span className="text-xs font-bold text-red-400">
                                      +{Math.abs(balance)}
                                  </span>
                              ) : null}
                          </div>
                      </div>

                      {/* Human Strip */}
                      <div
                          className={`relative px-4 py-3 rounded-2xl transition-all duration-300 ${activeTurn === playerColorStr ? "bg-white/6 border border-white/8" : "bg-transparent border border-transparent"} flex items-center justify-between`}
                      >
                          {activeTurn === playerColorStr && (
                              <div className="absolute left-0 inset-y-4 w-1 bg-(--color-status-playing) rounded-r-md" />
                          )}
                          <div className="flex items-center gap-3">
                              <div className="h-10 w-10 flex items-center justify-center shrink-0 rounded-xl bg-linear-to-br from-white to-slate-200 shadow-md text-slate-900 border border-white/20 text-lg font-bold">
                                  {playerColorStr === "white" ? "♔" : "♚"}
                              </div>
                              <div className="flex flex-col">
                                  <span className="text-sm font-semibold text-white">
                                      You
                                  </span>
                                  {playerCapturedPieces.length > 0 && (
                                      <span className="truncate text-sm tracking-[0.2em] text-slate-400 ml-0.5">
                                          {playerCapturedPieces.join("")}
                                      </span>
                                  )}
                              </div>
                          </div>
                          <div className="flex items-center gap-2">
                              {(balance > 0 && playerColorStr === "white") ||
                              (balance < 0 && playerColorStr === "black") ? (
                                  <span className="text-xs font-bold text-(--color-advantage-positive)">
                                      +{Math.abs(balance)}
                                  </span>
                              ) : null}
                          </div>
                      </div>
                  </div>

                  {/* Engine Mode Card */}
                  <div className="rounded-[28px] border border-white/6 bg-[#0A111B] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] flex flex-col gap-4">
                      <h4 className="text-[10px] tracking-[0.2em] uppercase text-slate-400 font-bold">
                          Primary Behavior
                      </h4>
                      <div className="flex items-center gap-3">
                          <span
                              className={`inline-flex items-center w-8 h-8 justify-center rounded-xl bg-linear-to-br shadow-inner border border-white/10 ${
                                  currentEngineMode.includes("Gambit")
                                      ? "from-amber-600 to-amber-900/60 shadow-amber-500/20"
                                      : currentEngineMode.includes("Trap")
                                        ? "from-purple-600 to-purple-900/60 shadow-purple-500/20"
                                        : currentEngineMode.includes(
                                                "Aggressive",
                                            )
                                          ? "from-red-600 to-red-900/60 shadow-red-500/20"
                                          : currentEngineMode.includes(
                                                  "Sacrifice",
                                              )
                                            ? "from-cyan-600 to-cyan-900/60 shadow-cyan-500/20"
                                            : currentEngineMode.includes(
                                                    "Psychological",
                                                )
                                              ? "from-pink-600 to-pink-900/60 shadow-pink-500/20"
                                              : "from-slate-600 to-slate-800 shadow-slate-500/20"
                              }`}
                          >
                              {/* SVG icon placeholder or text representation as emoji */}
                              {currentEngineMode.includes("Gambit")
                                  ? "⚔"
                                  : currentEngineMode.includes("Trap")
                                    ? "🕸"
                                    : currentEngineMode.includes("Agg")
                                      ? "☇"
                                      : currentEngineMode.includes("Sac")
                                        ? "🩸"
                                        : currentEngineMode.includes("Psych")
                                          ? "👁"
                                          : "⚙"}
                          </span>
                          <div className="flex flex-col">
                              <span className="text-base text-white font-semibold font-display tracking-wide">
                                  {currentEngineMode}
                              </span>
                              {game?.engineState.lastDecision.strategy && (
                                  <span className="text-[11px] text-brand-200/90 font-medium tracking-wide">
                                      {game.engineState.lastDecision.strategy}
                                  </span>
                              )}
                          </div>
                      </div>

                      {activeBehaviorRoles.length > 0 && (
                          <div className="flex flex-col gap-2 mt-1">
                              <span className="text-[9px] uppercase tracking-[0.16em] text-slate-500/80 font-bold">
                                  Active Support Scripts
                              </span>
                              <div className="flex flex-wrap gap-2">
                                  {activeBehaviorRoles.map((entry) => (
                                      <span
                                          key={entry.mode}
                                          className="inline-flex items-center rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-mono text-slate-300"
                                      >
                                          {titleCase(entry.mode)}{" "}
                                          <span className="ml-1 text-teal-400/80">
                                              {formatContribution(entry.score)}
                                          </span>
                                      </span>
                                  ))}
                              </div>
                          </div>
                      )}
                  </div>
              </section>
          )}

          {showMoves && (
              <section className="rounded-[32px] glass-panel p-5 sm:p-6 lg:p-7 relative overflow-hidden flex flex-col">
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3 relative z-10">
                      <div>
                          <h3 className="text-xl font-bold tracking-wide text-brand-100 uppercase">
                              Match Log
                          </h3>
                      </div>
                      <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-stone-400 font-mono tracking-wider shadow-inner">
                          {history.length} PLY
                      </span>
                  </div>

                  {classificationReady && (
                      <div className="mb-4">
                          <ReviewSummaryCard history={history} />
                      </div>
                  )}

                  <div className="mb-2 grid grid-cols-[40px_minmax(0,1fr)_minmax(0,1fr)] gap-1.5 px-2 text-[10px] font-bold uppercase tracking-[0.18em]">
                      <span />
                      <span
                          className={
                              playerColor === "white"
                                  ? "text-emerald-400/80"
                                  : "text-violet-400/80"
                          }
                      >
                          {playerColor === "white" ? "You" : "AI"}
                      </span>
                      <span
                          className={
                              playerColor === "black"
                                  ? "text-emerald-400/80"
                                  : "text-violet-400/80"
                          }
                      >
                          {playerColor === "black" ? "You" : "AI"}
                      </span>
                  </div>

                  <div
                      className="h-80 min-h-48 relative rounded-xl ml-1 mr-1 border border-white/4 bg-[#0A111B] p-2 space-y-1.5 overflow-y-auto scroll-smooth pr-1 overflow-x-hidden [scrollbar-color:rgba(246,199,110,0.35)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-brand-200/35 [&::-webkit-scrollbar]:w-2"
                      role="list"
                      aria-label="Move history"
                  >
                      {moveRows.length > 0 ? (
                          moveRows.map((row, rowIndex) => {
                              const whiteIndex = rowIndex * 2;
                              const blackIndex = rowIndex * 2 + 1;
                              const isLastWhite =
                                  whiteIndex === history.length - 1;
                              const isLastBlack =
                                  blackIndex === history.length - 1;

                              return (
                                  <div key={row.turn} role="listitem">
                                      <div className="grid grid-cols-[40px_minmax(0,1fr)_minmax(0,1fr)] gap-1.5 rounded-xl border border-white/2 bg-white/2 px-2 py-1.5 text-sm text-stone-200">
                                          <span className="text-gradient-gold flex items-center justify-center text-[11px] font-mono opacity-80">
                                              {row.turn}.
                                          </span>
                                          <MoveCell
                                              entry={row.whiteEntry}
                                              thinking={thinking}
                                              isLast={isLastWhite}
                                              isSelected={
                                                  selectedMoveIndex ===
                                                  whiteIndex
                                              }
                                              analysisPending={
                                                  row.whiteEntry
                                                      ? pendingKeySet.has(
                                                            `${row.whiteEntry.player}:${row.whiteEntry.moveNumber}:${row.whiteEntry.moveUci}`,
                                                        )
                                                      : false
                                              }
                                              onSelect={() =>
                                                  onSelectMove?.(whiteIndex)
                                              }
                                              onExplain={() =>
                                                  setExplainIndex(
                                                      explainIndex ===
                                                          whiteIndex
                                                          ? null
                                                          : whiteIndex,
                                                  )
                                              }
                                              moveIndex={whiteIndex}
                                          />
                                          <MoveCell
                                              entry={row.blackEntry}
                                              thinking={thinking}
                                              isLast={isLastBlack}
                                              isSelected={
                                                  selectedMoveIndex ===
                                                  blackIndex
                                              }
                                              analysisPending={
                                                  row.blackEntry
                                                      ? pendingKeySet.has(
                                                            `${row.blackEntry.player}:${row.blackEntry.moveNumber}:${row.blackEntry.moveUci}`,
                                                        )
                                                      : false
                                              }
                                              onSelect={() =>
                                                  onSelectMove?.(blackIndex)
                                              }
                                              onExplain={() =>
                                                  setExplainIndex(
                                                      explainIndex ===
                                                          blackIndex
                                                          ? null
                                                          : blackIndex,
                                                  )
                                              }
                                              moveIndex={blackIndex}
                                          />
                                      </div>

                                      <AnimatePresence>
                                          {explainIndex !== null &&
                                              (explainIndex === whiteIndex ||
                                                  explainIndex ===
                                                      blackIndex) &&
                                              explainEntry?.analysis &&
                                              explainEntry.analysis
                                                  .displayMode !== "none" && (
                                                  <div className="mt-1 mb-2 px-1">
                                                      <MoveExplanationPanel
                                                          key={`explain-${explainIndex}`}
                                                          analysis={
                                                              explainEntry.analysis
                                                          }
                                                          moveNotation={
                                                              explainEntry.moveNotation
                                                          }
                                                          moveNumber={row.turn}
                                                          onClose={() =>
                                                              setExplainIndex(
                                                                  null,
                                                              )
                                                          }
                                                          mobile={isMobile}
                                                      />
                                                  </div>
                                              )}
                                      </AnimatePresence>
                                  </div>
                              );
                          })
                      ) : (
                          <div className="flex h-full items-center justify-center text-xs font-mono tracking-widest text-text-muted/80 my-auto uppercase">
                              Awaiting First Move
                          </div>
                      )}
                      <div ref={movesEndRef} />
                  </div>
              </section>
          )}
      </motion.aside>
  );
};
