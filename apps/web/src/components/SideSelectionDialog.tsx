import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Difficulty, PlayerColor } from "../contracts";

interface SideSelectionDialogProps {
  open: boolean;
  onChoose: (color: PlayerColor) => void;
  difficulty: Difficulty;
  setDifficulty: (difficulty: Difficulty) => void;
}

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
          <div className="absolute inset-0 bg-[rgba(3,8,15,0.64)] backdrop-blur-[7px]" />

          <motion.div
            className="relative z-1 w-full max-w-[720px] rounded-[34px] border border-brand-200/14 bg-[linear-gradient(180deg,rgba(10,20,33,0.96),rgba(8,16,28,0.98))] p-5 shadow-[0_35px_120px_rgba(2,8,20,0.68),inset_0_1px_0_rgba(255,255,255,0.06)] sm:p-8"
            initial={{ opacity: 0, scale: 0.96, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="side-selection-title"
            aria-describedby="side-selection-copy"
          >
            <div className="pointer-events-none absolute inset-0 rounded-[34px] bg-[radial-gradient(circle_at_top,rgba(86,208,255,0.08),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(124,231,214,0.08),transparent_30%)]" />

            <div className="relative z-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-gradient-gold">
                Match Launch
              </p>
              <h2
                id="side-selection-title"
                className="font-display mt-3 text-3xl text-brand-100 sm:text-[2.7rem]"
              >
                Choose Your Side
              </h2>
              <p
                id="side-selection-copy"
                className="mt-3 max-w-2xl text-sm leading-7 text-stone-300/88 sm:text-base"
              >
                Select which color you want to play as. The board is waiting
                behind the curtain and will unlock the moment your choice lands.
              </p>

              <div className="mt-6 flex flex-col gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-stone-400">
                  Select Difficulty
                </p>
                <div className="flex flex-wrap gap-2">
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
                      className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
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

              <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {OPTIONS.map((option) => {
                  const highlighted =
                    randomPreview === option.color && randomizing;

                  return (
                    <motion.button
                      key={option.color}
                      type="button"
                      className="group relative overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] px-4 py-5 text-left shadow-[0_18px_55px_rgba(2,8,20,0.35)] transition sm:px-5 sm:py-6"
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
                          className="inline-flex h-18 w-18 items-center justify-center rounded-[24px] border border-white/10 bg-white/6 text-[3.6rem] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                          style={{ color: option.accent }}
                        >
                          {option.glyph}
                        </div>
                        <p className="mt-5 text-xl font-semibold text-brand-100">
                          {option.label}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-stone-300/82">
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
