import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Difficulty, PlayerColor, StyleId } from "@chessverse/contracts";
import {
  ShieldIcon,
  SwordsIcon,
  DicesIcon,
  ZapIcon,
  KingPieceIcon,
} from "./icons";

interface SideSelectionDialogProps {
  open: boolean;
  onChoose: (color: PlayerColor) => void;
  difficulty: Difficulty;
  setDifficulty: (difficulty: Difficulty) => void;
  style?: StyleId;
  setStyle?: (style: StyleId) => void;
  onClose?: () => void;
}

const STYLES: Array<{
  id: StyleId;
  name: string;
  badge: string;
  Icon: typeof ShieldIcon;
  description: string;
  color: string;
}> = [
  {
    id: "solid",
    name: "Solid",
    badge: "Positional",
    Icon: ShieldIcon,
    description: "Classical grandmaster style. Prioritizes king safety, structure, and pure positional chess.",
    color: "#56d0ff",
  },
  {
    id: "aggressive",
    name: "Aggressive",
    badge: "Attacker",
    Icon: SwordsIcon,
    description: "Relentless king attacks, pawn pushes, and active piece pressure.",
    color: "#ff6b4a",
  },
  {
    id: "gambiteer",
    name: "Gambiteer",
    badge: "Romantic",
    Icon: DicesIcon,
    description: "Sacrifices material freely for dynamic initiative, rapid development, and open files.",
    color: "#c084fc",
  },
  {
    id: "tricky",
    name: "Tricky",
    badge: "Traps",
    Icon: ZapIcon,
    description: "Lays cunning tactical traps, sharp complications, and tests your tactical vision.",
    color: "#fbbf24",
  },
];

const OPTIONS: Array<{
  color: PlayerColor;
  label: string;
  description: string;
  accent: string;
}> = [
  {
    color: "white",
    label: "White",
    description: "You open first and dictate the dynamic initiative.",
    accent: "rgba(247,240,223,0.95)",
  },
  {
    color: "black",
    label: "Black",
    description: "The AI opens immediately. Counter with sharp defenses.",
    accent: "rgba(86,208,255,0.95)",
  },
];

export const SideSelectionDialog = ({
  open,
  onChoose,
  difficulty,
  setDifficulty,
  style = "solid",
  setStyle,
  onClose,
}: SideSelectionDialogProps) => {
  const [randomizing, setRandomizing] = useState(false);
  const [randomPreview, setRandomPreview] = useState<PlayerColor | null>(null);
  const intervalRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      setRandomizing(false);
      setRandomPreview(null);
    }

    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [open]);

  const handleRandom = () => {
    if (randomizing) {
      return;
    }

    setRandomizing(true);
    let current: PlayerColor = "white";
    setRandomPreview(current);

    intervalRef.current = window.setInterval(() => {
      current = current === "white" ? "black" : "white";
      setRandomPreview(current);
    }, 110);

    timeoutRef.current = window.setTimeout(() => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      const finalColor: PlayerColor = Math.random() < 0.5 ? "white" : "black";
      setRandomPreview(finalColor);

      window.setTimeout(() => {
        setRandomizing(false);
        onChoose(finalColor);
      }, 160);
    }, 700);
  };

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#020913]/85 backdrop-blur-md"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 16 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl border border-white/10 bg-[linear-gradient(145deg,rgba(13,24,38,0.96)_0%,rgba(7,18,31,0.98)_100%)] p-5 sm:p-7 shadow-[0_24px_80px_rgba(0,0,0,0.7)] backdrop-blur-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/8 pb-3.5 sm:pb-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-gradient-gold">
                  Tactical Staging
                </span>
                <h2 className="font-display text-xl sm:text-2xl font-bold text-brand-100">
                  Select Game Parameters
                </h2>
              </div>
              {onClose ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full border border-white/10 bg-white/5 p-2 text-stone-400 hover:text-white transition touch-manipulation"
                  title="Close Dialog"
                >
                  ✕
                </button>
              ) : null}
            </div>

            {/* AI Style Selection */}
            <div className="mt-4 sm:mt-5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-stone-300">
                Opponent AI Personality
              </label>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5">
                {STYLES.map((st) => {
                  const isSelected = style === st.id;
                  const Icon = st.Icon;
                  return (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => setStyle?.(st.id)}
                      className={`group relative flex flex-col items-start gap-1 rounded-2xl border p-2.5 sm:p-3 text-left transition-all touch-manipulation ${
                        isSelected
                          ? "border-cyan-400/60 bg-cyan-500/15 shadow-[0_0_18px_rgba(6,182,212,0.22)]"
                          : "border-white/8 bg-white/4 hover:border-white/20 hover:bg-white/8"
                      }`}
                    >
                      <div className="flex w-full items-center justify-between">
                        <Icon size={18} style={{ color: st.color }} />
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                          style={{
                            backgroundColor: `${st.color}22`,
                            color: st.color,
                          }}
                        >
                          {st.badge}
                        </span>
                      </div>
                      <p
                        className="mt-1 text-xs sm:text-sm font-semibold transition"
                        style={{ color: isSelected ? "#ffffff" : st.color }}
                      >
                        {st.name}
                      </p>
                      <p className="text-[10px] text-stone-400 line-clamp-2 leading-tight">
                        {st.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* AI Difficulty Selector */}
            <div className="mt-4 sm:mt-5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-stone-300">
                Stockfish Engine Depth
              </label>
              <div className="mt-2 grid grid-cols-4 gap-1.5 sm:gap-2">
                {[
                  { id: "beginner" as const, label: "Beginner", depth: "D4" },
                  { id: "intermediate" as const, label: "Medium", depth: "D8" },
                  { id: "advanced" as const, label: "Hard", depth: "D10" },
                  { id: "master" as const, label: "Master", depth: "D18" },
                ].map((diff) => (
                  <button
                    key={diff.id}
                    type="button"
                    onClick={() => setDifficulty(diff.id)}
                    className={`rounded-xl border px-2 py-2 text-center text-xs font-semibold transition touch-manipulation ${
                      difficulty === diff.id
                        ? "border-amber-400/50 bg-amber-400/15 text-amber-200 shadow-[0_0_12px_rgba(251,191,36,0.2)]"
                        : "border-white/10 bg-white/5 text-stone-300 hover:bg-white/10"
                    }`}
                  >
                    <div>{diff.label}</div>
                    <div className="text-[9px] opacity-70 font-mono mt-0.5">{diff.depth}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Choose Your Side */}
            <div className="mt-5 sm:mt-6">
              <label className="text-[11px] font-bold uppercase tracking-wider text-stone-300">
                Choose Command Side
              </label>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {OPTIONS.map((option) => {
                  const isHighlighted =
                    randomPreview === option.color && randomizing;

                  return (
                    <motion.button
                      key={option.color}
                      type="button"
                      whileHover={{ scale: 1.015 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => onChoose(option.color)}
                      className={`group relative flex flex-col items-center justify-center rounded-2xl border p-4 sm:p-5 text-center transition touch-manipulation ${
                        isHighlighted
                          ? "border-cyan-300 bg-cyan-400/20 shadow-[0_0_24px_rgba(6,182,212,0.35)]"
                          : "border-white/10 bg-white/5 hover:border-cyan-400/40 hover:bg-white/8"
                      }`}
                    >
                      <div className="flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 shadow-inner">
                        <KingPieceIcon size={32} fill={option.color} />
                      </div>
                      <p className="mt-3 text-base sm:text-lg font-bold text-brand-100">
                        {option.label}
                      </p>
                      <p className="mt-1 text-xs text-stone-400 leading-snug">
                        {option.description}
                      </p>
                    </motion.button>
                  );
                })}
              </div>

              {/* Random Choice */}
              <div className="mt-3.5 flex justify-center">
                <button
                  type="button"
                  onClick={handleRandom}
                  disabled={randomizing}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-stone-300 hover:border-cyan-400/40 hover:bg-white/10 hover:text-white transition touch-manipulation"
                >
                  <DicesIcon size={14} className={randomizing ? "animate-spin text-cyan-300" : "text-amber-400"} />
                  <span>{randomizing ? "Flipping coin..." : "Random Side (Coin Flip)"}</span>
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
};
