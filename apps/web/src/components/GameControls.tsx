import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { Difficulty, PlayerColor } from "../contracts";

interface GameControlsProps {
  difficulty: Difficulty;
  playerColor: PlayerColor;
  onNewGame: () => void;
  onFlipBoard: () => void;
  onResign: () => void;
  onUndo: () => void;
  canUndo: boolean;
  canFlipBoard: boolean;
  undoHint: string;
  undoPulseVisible: boolean;
  premoveStatusText?: string | null;
  disabled: boolean;
}

const panelClass = "rounded-[32px] glass-panel p-5 sm:p-6 lg:p-7";
const eyebrowClass =
  "text-[11px] font-bold uppercase tracking-[0.24em] text-gradient-gold";
const buttonClass =
  "inline-flex w-full items-center justify-center rounded-2xl btn-premium px-4 py-3 text-sm font-bold";

const difficultyOptions: Array<{
  value: Difficulty;
  label: string;
  copy: string;
}> = [
  {
    value: "beginner",
    label: "Beginner",
    copy: "Loose guardrails and generous takebacks",
  },
  {
    value: "intermediate",
    label: "Intermediate",
    copy: "Sharper play with recovery room",
  },
  {
    value: "advanced",
    label: "Advanced",
    copy: "Tournament pressure. No undo safety net",
  },
  {
    value: "master",
    label: "Master",
    copy: "Clinical conversion and strict rules",
  },
];

const difficultyLabel = (difficulty: Difficulty) =>
  difficultyOptions.find((option) => option.value === difficulty)?.label ??
  difficulty;

const sideMeta: Record<
  PlayerColor,
  { label: string; glyph: string; copy: string; accent: string }
> = {
  white: {
    label: "You command White",
    glyph: "\u2654",
    copy: "You open first and dictate the opening cadence.",
    accent: "text-brand-100",
  },
  black: {
    label: "You command Black",
    glyph: "\u265A",
    copy: "The AI opens first. You counter from the dark side.",
    accent: "text-brand-200",
  },
};

export const GameControls = ({
  difficulty,
  playerColor,
  onNewGame,
  onFlipBoard,
  onResign,
  onUndo,
  canUndo,
  canFlipBoard,
  undoHint,
  undoPulseVisible,
  premoveStatusText,
  disabled,
}: GameControlsProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const side = sideMeta[playerColor];

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [menuOpen]);

  return (
    <section className={panelClass}>
      <div className="space-y-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-md">
            <p className={eyebrowClass}>Controls</p>
            <h3 className="font-display mt-2 text-2xl text-brand-100 sm:text-[2.15rem]">
              Match Setup
            </h3>
            <p className="mt-3 text-sm leading-6 text-stone-300/78">
              Launch a fresh game, manage takebacks, and keep the board aligned
              to your command without losing the premium match flow.
            </p>
          </div>

          <div className="relative z-30 w-full max-w-64 lg:w-64">
            <div
              className="flex w-full items-center justify-between rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,33,51,0.92),rgba(12,23,38,0.98))] px-4 py-3 text-left text-sm font-medium text-stone-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
            >
              <span>
                <span className="block text-[10px] uppercase tracking-[0.22em] text-stone-400">
                  Difficulty (Active)
                </span>
                <span className="mt-1 block truncate text-base text-brand-100">
                  {difficultyLabel(difficulty)}
                </span>
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.04fr)_minmax(0,0.96fr)]">
          <div className="rounded-[28px] border border-white/10 bg-white/4 p-4 sm:p-5">
            <div className="flex flex-wrap items-start gap-4">
              <div className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] border border-white/10 bg-white/6 text-[2.7rem] shadow-[0_18px_40px_rgba(2,8,20,0.3)]">
                <span className={side.accent}>{side.glyph}</span>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-stone-400">
                  Selected Side
                </p>
                <p className="mt-2 text-lg font-semibold text-brand-100">
                  {side.label}
                </p>
                <p className="mt-2 text-sm leading-6 text-stone-300/82">
                  {side.copy} Switch sides from the launch dialog when you start
                  a fresh game.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/4 p-4 sm:p-5">
            <p className="text-[10px] uppercase tracking-[0.2em] text-stone-400">
              Live Actions
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <div className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-brand-100">
                      Undo Window
                    </p>
                    <p className="mt-1 text-xs leading-5 text-stone-400">
                      {undoHint}
                    </p>
                  </div>
                  <span
                    className={`inline-flex h-3.5 w-3.5 rounded-full ${
                      canUndo ? "bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.4)]" : "bg-white/18"
                    } ${undoPulseVisible ? "animate-pulse" : ""}`}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3">
                <p className="text-sm font-semibold text-brand-100">
                  Premove Lane
                </p>
                <p className="mt-1 text-xs leading-5 text-stone-400">
                  {premoveStatusText ??
                    "Queue your next move while the AI thinks. One premove stays live until it executes or you cancel it."}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <motion.button
          whileHover={disabled ? {} : { scale: 1.02 }}
          whileTap={disabled ? {} : { scale: 0.98 }}
          className={`${buttonClass} border-brand-300/50 bg-linear-to-r from-[rgba(34,153,173,0.28)] to-[rgba(124,231,214,0.16)] text-brand-100 hover:from-[rgba(61,191,179,0.34)] hover:to-[rgba(124,231,214,0.22)]`}
          onClick={onNewGame}
          disabled={disabled}
        >
          New Game
        </motion.button>
        <motion.button
          whileHover={disabled || !canFlipBoard ? {} : { scale: 1.02 }}
          whileTap={disabled || !canFlipBoard ? {} : { scale: 0.98 }}
          className={buttonClass}
          onClick={onFlipBoard}
          disabled={disabled || !canFlipBoard}
          title={
            canFlipBoard
              ? "Flip board orientation"
              : "Board flipping locks during a live game"
          }
        >
          Flip Board
        </motion.button>
        <motion.button
          whileHover={disabled || !canUndo ? {} : { scale: 1.02 }}
          whileTap={disabled || !canUndo ? {} : { scale: 0.98 }}
          className={`${buttonClass} ${undoPulseVisible && canUndo ? "shadow-[0_0_0_1px_rgba(124,231,214,0.26),0_0_32px_rgba(124,231,214,0.14)]" : ""}`}
          onClick={onUndo}
          disabled={disabled || !canUndo}
          title={undoHint}
        >
          Undo Move
        </motion.button>
        <motion.button
          whileHover={disabled ? {} : { scale: 1.02 }}
          whileTap={disabled ? {} : { scale: 0.98 }}
          className={`${buttonClass} border border-[#f38e8e]/20 text-[#f38e8e] hover:border-[#f38e8e]/50 hover:bg-[#f38e8e]/10`}
          onClick={onResign}
          disabled={disabled}
        >
          Resign
        </motion.button>
      </div>
    </section>
  );
};
