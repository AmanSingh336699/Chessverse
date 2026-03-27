import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { GameSnapshot } from "../contracts";

interface GameOverlayProps {
  game: GameSnapshot | null;
  onNewGame: () => void;
  onReview: () => void;
  onUndo: () => void;
  canUndo: boolean;
  undoHint: string;
  reviewMode?: boolean;
}

const getResultDetails = (
  game: GameSnapshot,
): { headline: string; subtitle: string; tone: string } => {
  const playerColor = game.playerColor;
  const status = game.status;

  if (status === "checkmate") {
    const lastMove = game.moveHistory.at(-1);
    const playerWon = lastMove?.player === "human";

    if (playerWon) {
      return {
        headline: "Victory",
        subtitle: `${playerColor === "white" ? "White" : "Black"} wins by checkmate`,
        tone: "win",
      };
    }

    return {
      headline: "Defeated",
      subtitle: `${playerColor === "white" ? "Black" : "White"} wins by checkmate`,
      tone: "loss",
    };
  }

  if (status === "draw") {
    return {
      headline: "Draw",
      subtitle: "The game ends in a draw",
      tone: "draw",
    };
  }

  if (status === "stalemate") {
    return {
      headline: "Stalemate",
      subtitle: "No legal moves remain and the game is drawn",
      tone: "draw",
    };
  }

  if (status === "resigned") {
    return {
      headline: "Resigned",
      subtitle: `You resigned. ${playerColor === "white" ? "Black" : "White"} wins`,
      tone: "loss",
    };
  }

  return {
    headline: "Game Over",
    subtitle: "The game has ended",
    tone: "draw",
  };
};

const ResultGlyph = ({ tone }: { tone: string }) => {
  if (tone === "win") {
    return (
      <svg viewBox="0 0 24 24" className="h-10 w-10 text-emerald-200" fill="none">
        <path d="M7 4h10v3a5 5 0 0 1-5 5 5 5 0 0 1-5-5V4Z" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.6" />
        <path d="M9 12h6v3a3 3 0 0 1-6 0v-3Z" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 20h8M10 17h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }

  if (tone === "loss") {
    return (
      <svg viewBox="0 0 24 24" className="h-10 w-10 text-rose-200" fill="none">
        <path d="m8 7 8 10M16 7l-8 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-10 w-10 text-cyan-200" fill="none">
      <path d="M7 8h10M7 12h10M7 16h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="4" y="5" width="16" height="14" rx="4" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
};

const toneStyles: Record<string, { ring: string }> = {
  win: {
    ring: "border-emerald-400/25",
  },
  loss: {
    ring: "border-rose-400/20",
  },
  draw: {
    ring: "border-cyan-400/20",
  },
};

export const GameOverlay = ({
  game,
  onNewGame,
  onReview,
  onUndo,
  canUndo,
  undoHint,
  reviewMode = false,
}: GameOverlayProps) => {
  const [delayedVisible, setDelayedVisible] = useState(false);
  const terminalStatus = ["checkmate", "draw", "stalemate", "resigned"].includes(game?.status ?? "");

  useEffect(() => {
    if (terminalStatus && !reviewMode) {
      const timer = setTimeout(() => {
        setDelayedVisible(true);
      }, 10000); // 10 second delay
      return () => clearTimeout(timer);
    } else {
      setDelayedVisible(false);
    }
  }, [terminalStatus, reviewMode]);

  const visible = !reviewMode && delayedVisible;

  const result = game ? getResultDetails(game) : null;
  const tone = toneStyles[result?.tone ?? "draw"] ?? toneStyles.draw ?? { ring: "border-cyan-400/20" };

  return (
    <AnimatePresence>
      {visible && game && result ? (
        <motion.div
          className="absolute inset-3 z-20 grid place-items-center rounded-[28px] bg-bg-base/82 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className={`w-[min(92%,24rem)] rounded-[30px] glass-panel-accent border p-8 text-center ${tone.ring}`}
            initial={{ scale: 0.88, y: 32, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, y: 12, opacity: 0 }}
            transition={{
              type: "spring",
              stiffness: 140,
              damping: 16,
            }}
          >
            <motion.span
              className="inline-flex"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.15, type: "spring", stiffness: 200, damping: 12 }}
            >
              <ResultGlyph tone={result.tone} />
            </motion.span>

            <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.24em] text-gradient-gold">
              Match Complete
            </p>

            <h2 className="font-display mt-2 text-4xl text-brand-100 drop-shadow-lg">
              {result.headline}
            </h2>

            <p className="mt-3 text-sm font-medium leading-6 text-stone-300/90">
              {result.subtitle}
            </p>

            <div className="mt-4 flex justify-center gap-4">
              <div className="rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-center">
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Moves</p>
                <p className="text-sm font-semibold text-stone-200">{game.moveHistory.length}</p>
              </div>
              <div className="rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-center">
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Final Eval</p>
                <p className="text-sm font-semibold text-stone-200">
                  {game.evaluation !== null
                    ? `${game.evaluation > 0 ? "+" : ""}${game.evaluation.toFixed(1)}`
                    : "0.0"}
                </p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-stone-200 transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={onUndo}
                disabled={!canUndo}
                title={undoHint}
              >
                Undo
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-stone-200 transition hover:bg-white/8"
                onClick={onReview}
              >
                Review Game
              </button>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="inline-flex items-center justify-center rounded-2xl btn-premium px-4 py-3 text-sm font-bold"
                onClick={onNewGame}
              >
                Play Again
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
