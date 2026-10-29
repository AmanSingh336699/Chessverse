import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Difficulty, PlayerColor, StyleId } from "@chessverse/contracts";

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
  icon: string;
  description: string;
  color: string;
}> = [
  {
    id: "solid",
    name: "Solid",
    badge: "Positional",
    icon: "🛡️",
    description: "Classical grandmaster style. Prioritizes king safety, structure, and pure positional chess.",
    color: "#56d0ff",
  },
  {
    id: "aggressive",
    name: "Aggressive",
    badge: "Attacker",
    icon: "⚔️",
    description: "Relentless king attacks, pawn pushes, and active piece pressure.",
    color: "#ff6b4a",
  },
  {
    id: "gambiteer",
    name: "Gambiteer",
    badge: "Romantic",
    icon: "🎲",
    description: "Sacrifices material freely for dynamic initiative, rapid development, and open files.",
    color: "#c084fc",
  },
  {
    id: "tricky",
    name: "Tricky",
    badge: "Traps",
    icon: "⚡",
    description: "Lays cunning tactical traps, sharp complications, and tests your tactical vision.",
    color: "#fbbf24",
  },
];

const OPTIONS: Array<{
  color: PlayerColor;
  label: string;
  description: string;
  glyph: string;
  accent: string;
}> = [
  {
    color: "white",
    label: "White",
    description: "You open first and control the initiative.",
    glyph: "\u2654",
    accent: "rgba(247,240,223,0.92)",
  },
  {
    color: "black",
    label: "Black",
    description: "The AI opens immediately. You counter from the dark side.",
    glyph: "\u265A",
    accent: "rgba(86,208,255,0.92)",
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
        onChoose(finalColor);
      }, 180);
    }, 620);
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6 sm:px-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
        >
          <div
            onClick={onClose}
            className="absolute inset-0 bg-[rgba(3,8,15,0.64)] backdrop-blur-[7px] cursor-pointer"
          />

          <motion.div
            className="relative z-1 w-full max-w-[760px] max-h-[92vh] overflow-y-auto rounded-[26px] sm:rounded-[34px] border border-brand-200/14 bg-[linear-gradient(180deg,rgba(10,20,33,0.96),rgba(8,16,28,0.98))] p-4 sm:p-7 md:p-8 shadow-[0_35px_120px_rgba(2,8,20,0.68),inset_0_1px_0_rgba(255,255,255,0.06)] [scrollbar-width:thin] [scrollbar-color:rgba(124,231,214,0.3)_transparent]"
            initial={{ opacity: 0, scale: 0.96, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="side-selection-title"
            aria-describedby="side-selection-copy"
          >
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="absolute top-4 right-4 sm:top-6 sm:right-6 z-10 rounded-full p-2 text-stone-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Close match selection"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            ) : null}

            <div className="pointer-events-none absolute inset-0 rounded-[34px] bg-[radial-gradient(circle_at_top,rgba(86,208,255,0.08),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(124,231,214,0.08),transparent_30%)]" />

            <div className="relative z-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-gradient-gold">
                Match Launch
              </p>
              <h2
                id="side-selection-title"
                className="font-display mt-2 sm:mt-3 text-2xl sm:text-3xl md:text-[2.7rem]"
              >
                Choose Your Match
              </h2>
              <p
                id="side-selection-copy"
                className="mt-2 sm:mt-3 max-w-2xl text-xs sm:text-base leading-relaxed text-stone-300/88"
              >
                Select your preferred opponent style, difficulty, and color to begin.
              </p>

              {/* Style Selection */}
              <div className="mt-5 sm:mt-6 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-stone-400">
                    Opponent Style
                  </p>
                  <span className="text-[10px] text-brand-200/80 font-mono">
                    Data-driven AI personality
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {STYLES.map((st) => {
                    const isSelected = style === st.id;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => setStyle?.(st.id)}
                        className={`group relative flex flex-col items-start gap-1 rounded-2xl border p-2.5 sm:p-3 text-left transition-all touch-manipulation ${
                          isSelected
                            ? "border-brand-300/60 bg-brand-300/15 shadow-[0_0_18px_rgba(86,208,255,0.22)]"
                            : "border-white/8 bg-white/4 hover:border-white/20 hover:bg-white/8"
                        }`}
                      >
                        <div className="flex w-full items-center justify-between">
                          <span className="text-lg">{st.icon}</span>
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
                        <p className="line-clamp-2 text-[10px] leading-snug text-stone-300/70">
                          {st.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Difficulty Selection */}
              <div className="mt-4 sm:mt-5 flex flex-col gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-stone-400">
                  Select Difficulty
                </p>
                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  {(
                    [
                      { value: "beginner", label: "Beginner" },
                      { value: "intermediate", label: "Intermediate" },
                      { value: "advanced", label: "Advanced" },
                      { value: "master", label: "Master" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDifficulty(opt.value)}
                      className={`rounded-full border px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium transition touch-manipulation ${
                        difficulty === opt.value
                          ? "border-brand-300/50 bg-brand-300/20 text-brand-100 shadow-[0_0_12px_rgba(86,208,255,0.2)]"
                          : "border-white/10 bg-white/5 text-stone-300 hover:border-brand-300/30 hover:bg-brand-300/10 hover:text-brand-100"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-6 sm:mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {OPTIONS.map((option) => {
                  const highlighted =
                    randomPreview === option.color && randomizing;

                  return (
                    <motion.button
                      key={option.color}
                      type="button"
                      className="group relative overflow-hidden rounded-[22px] sm:rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-4 sm:px-5 sm:py-6 text-left shadow-[0_18px_55px_rgba(2,8,20,0.35)] transition touch-manipulation"
                      onClick={() => onChoose(option.color)}
                      whileHover={{
                        y: -2,
                        boxShadow: `0 28px 70px rgba(2,8,20,0.48), 0 0 0 1px ${option.accent}33`,
                      }}
                      whileTap={{ scale: 0.97 }}
                      style={{
                        borderColor: highlighted
                          ? option.accent
                          : "rgba(255,255,255,0.08)",
                        boxShadow: highlighted
                          ? `0 0 0 1px ${option.accent}66, 0 0 42px ${option.accent}22`
                          : undefined,
                      }}
                    >
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_42%)] opacity-70" />
                      <div className="relative z-1">
                        <div
                          className="inline-flex h-14 w-14 sm:h-18 sm:w-18 items-center justify-center rounded-[18px] sm:rounded-3xl border border-white/10 bg-white/6 text-4xl sm:text-[3.6rem] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                          style={{ color: option.accent }}
                        >
                          {option.glyph}
                        </div>
                        <p className="mt-3.5 sm:mt-5 text-lg sm:text-xl font-semibold text-brand-100">
                          {option.label}
                        </p>
                        <p className="mt-1 sm:mt-2 text-xs sm:text-sm leading-5 sm:leading-6 text-stone-300/82">
                          {option.description}
                        </p>
                      </div>
                    </motion.button>
                  );
                })}
              </div>

              <div className="mt-4 flex justify-center">
                <motion.button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-stone-200 transition hover:border-brand-200/35 hover:bg-brand-200/10 hover:text-brand-100"
                  onClick={handleRandom}
                  whileTap={{ scale: 0.97 }}
                  disabled={randomizing}
                >
                  <span className="text-brand-200">
                    {randomPreview === "black"
                      ? "\u265A"
                      : randomPreview === "white"
                        ? "\u2654"
                        : "\u25C7"}
                  </span>
                  {randomizing ? "Flipping a coin..." : "Random Side"}
                </motion.button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
