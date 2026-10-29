import { motion } from "framer-motion";

interface CapturedInfo {
  pieces: string[];
  advantage: number;
}

interface PlayerPanelProps {
  label: string;
  color: "white" | "black";
  captured: CapturedInfo;
  isThinking?: boolean;
}

export const PlayerPanel = ({
  label,
  color,
  captured,
  isThinking = false,
}: PlayerPanelProps) => {
  const iconBg =
    color === "white"
      ? "bg-linear-to-br from-stone-100 to-stone-300"
      : "bg-linear-to-br from-slate-700 to-slate-950";
  const iconText = color === "white" ? "text-slate-900" : "text-stone-100";
  const kingGlyph = color === "white" ? "\u2654" : "\u265A";

  return (
    <div className="flex items-center justify-between gap-2 px-1.5 py-1.5 sm:px-3 sm:py-2">
      <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 sm:h-10 sm:w-10 ${iconBg} text-sm sm:text-base font-bold ${iconText} shadow-[0_8px_20px_rgba(0,0,0,0.24)]`}
        >
          {kingGlyph}
        </div>

        <div className="min-w-0">
          <p className="truncate text-xs sm:text-sm font-semibold text-stone-100">{label}</p>
          <p className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">
            {color} command
          </p>
          {isThinking ? (
            <motion.p
              className="text-[9px] sm:text-[10px] font-medium text-brand-200/80"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              thinking...
            </motion.p>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 max-w-[55%] flex-wrap items-center justify-end gap-1 sm:gap-1.5">
        {captured.pieces.length > 0 ? (
          <span className="flex items-center gap-px rounded-full border border-white/8 bg-white/5 px-2 py-0.5 text-xs leading-none text-stone-300 overflow-hidden">
            {captured.pieces.map((piece, index) => (
              <span
                key={index}
                className="inline-block leading-none opacity-80"
                style={{ fontSize: "11px" }}
              >
                {piece}
              </span>
            ))}
          </span>
        ) : null}
        {captured.advantage > 0 ? (
          <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-bold text-emerald-200">
            +{captured.advantage}
          </span>
        ) : null}
      </div>
    </div>
  );
};
