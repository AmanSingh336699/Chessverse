import { motion } from "framer-motion";
import { KingPieceIcon } from "./icons";

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
      ? "bg-gradient-to-br from-stone-100 to-stone-300 text-slate-900 border-white/20"
      : "bg-gradient-to-br from-slate-800 to-slate-950 text-stone-100 border-white/10";

  return (
    <div className="flex items-center justify-between gap-2 px-1.5 py-1.5 sm:px-3 sm:py-2">
      <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border sm:h-9 sm:w-9 ${iconBg} shadow-[0_4px_12px_rgba(0,0,0,0.3)]`}
        >
          <KingPieceIcon size={20} fill={color} />
        </div>

        <div className="min-w-0">
          <p className="truncate text-xs sm:text-sm font-semibold text-stone-100">{label}</p>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">
              {color}
            </span>
            {isThinking ? (
              <motion.span
                className="inline-flex items-center gap-1 text-[9px] font-medium text-cyan-300"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              >
                <span className="h-1 w-1 rounded-full bg-cyan-400" />
                <span>thinking...</span>
              </motion.span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 max-w-[55%] flex-wrap items-center justify-end gap-1 sm:gap-1.5">
        {captured.pieces.length > 0 ? (
          <span className="flex items-center gap-px rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs leading-none text-stone-300 overflow-hidden">
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
          <span className="rounded-full border border-emerald-400/25 bg-emerald-500/15 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-bold text-emerald-300">
            +{captured.advantage}
          </span>
        ) : null}
      </div>
    </div>
  );
};
