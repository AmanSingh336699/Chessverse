import { motion, AnimatePresence } from "framer-motion";
import type { MoveAnalysisResult } from "../contracts";
import {
  MoveQualitySymbol,
  getMoveQualityVisual,
} from "./MoveQualitySymbol";

interface MoveExplanationPanelProps {
  analysis: MoveAnalysisResult;
  moveNotation: string;
  moveNumber: number;
  onClose: () => void;
  mobile?: boolean;
}

const evalTone = (value: number) => {
  if (value > 0.75) {
    return "text-emerald-300";
  }

  if (value < -0.75) {
    return "text-rose-300";
  }

  return "text-stone-100";
};

export const MoveExplanationPanel = ({
  analysis,
  moveNotation,
  moveNumber,
  onClose,
  mobile = false,
}: MoveExplanationPanelProps) => {
  const visual = getMoveQualityVisual(
    analysis.classification,
    analysis.displayMode,
  );
  const primary = analysis.explanations[0];
  const secondary = analysis.explanations.slice(1);
  const headingLabel =
    visual?.label ?? analysis.classification.replace(/^\w/, (char) => char.toUpperCase());

  const content = (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5"
            style={{
              background: visual?.tint ?? "rgba(255,255,255,0.04)",
              borderColor: visual ? `${visual.color}33` : "rgba(255,255,255,0.08)",
            }}
          >
            <MoveQualitySymbol
              classification={analysis.classification}
              displayMode={analysis.displayMode}
              size="lg"
            />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-gradient-gold">
              Move Review
            </p>
            <h4
              className="mt-1 font-display text-2xl leading-tight"
              style={{ color: visual?.color ?? "#f4efe5" }}
            >
              {headingLabel}
            </h4>
            <p className="mt-1 text-sm font-semibold text-stone-200">
              {moveNumber}. {moveNotation}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg p-1.5 text-stone-400 transition hover:bg-white/8 hover:text-stone-200"
          aria-label="Close explanation"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M1 1l12 12M13 1 1 13"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="rounded-2xl border border-white/8 bg-white/3 px-4 py-4">
        <p className={`${mobile ? "text-[15px]" : "text-sm"} leading-relaxed text-stone-100`}>
          {analysis.shortExplanation}
        </p>
        {primary?.expanded ? (
          <p className="mt-2 text-sm leading-6 text-stone-300/88">
            {primary.expanded}
          </p>
        ) : null}
        {secondary.length > 0 ? (
          <div className="mt-3 space-y-1.5">
            {secondary.map((exp) => (
              <p key={`${exp.detectorId}-${exp.short}`} className="text-xs leading-5 text-stone-400">
                • {exp.short}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {analysis.recommendedMoves.length > 0 ? (
        <div className="rounded-2xl border border-emerald-400/15 bg-emerald-500/8 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-300/80">
            Engine Recommends
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {analysis.recommendedMoves.map((move) => (
              <span
                key={`${move.move}-${move.notation}`}
                className="inline-flex items-center rounded-full border border-emerald-300/15 bg-white/6 px-3 py-1.5 text-xs font-semibold text-emerald-100"
              >
                {move.notation}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-white/6 bg-white/4 px-2.5 py-2 text-center">
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Before</p>
          <p className={`mt-0.5 text-sm font-semibold ${evalTone(analysis.evalBefore)}`}>
            {analysis.evalBefore > 0 ? "+" : ""}
            {analysis.evalBefore.toFixed(2)}
          </p>
        </div>
        <div className="rounded-xl border border-white/6 bg-white/4 px-2.5 py-2 text-center">
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">After</p>
          <p className={`mt-0.5 text-sm font-semibold ${evalTone(analysis.evalAfter)}`}>
            {analysis.evalAfter > 0 ? "+" : ""}
            {analysis.evalAfter.toFixed(2)}
          </p>
        </div>
        <div className="rounded-xl border border-white/6 bg-white/4 px-2.5 py-2 text-center">
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Loss</p>
          <p
            className={`mt-0.5 text-sm font-semibold ${
              analysis.evalLoss > 4
                ? "text-rose-300"
                : analysis.evalLoss > 2
                  ? "text-orange-300"
                  : analysis.evalLoss > 1
                    ? "text-amber-300"
                    : "text-emerald-300"
            }`}
          >
            {analysis.evalLoss.toFixed(2)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-[10px] text-stone-500">
        <span>{analysis.analysisTimeMs}ms</span>
        {analysis.openingBookName ? (
          <>
            <span>•</span>
            <span>{analysis.openingBookName}</span>
          </>
        ) : null}
        {analysis.partial ? (
          <>
            <span>•</span>
            <span className="text-yellow-400/70">Partial</span>
          </>
        ) : null}
        {analysis.fromCache ? (
          <>
            <span>•</span>
            <span className="text-cyan-400/70">Cached</span>
          </>
        ) : null}
      </div>
    </div>
  );

  if (mobile) {
    return (
      <AnimatePresence>
        <motion.div
          className="fixed inset-x-0 bottom-0 z-50 max-h-[62vh] overflow-y-auto rounded-t-3xl border-t border-white/10 bg-[#0d1726]/96 px-5 py-5 backdrop-blur-xl"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
          <div className="mb-4 flex justify-center">
            <div className="h-1 w-10 rounded-full bg-white/20" />
          </div>
          {content}
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <motion.div
      className="rounded-2xl border border-white/8 bg-[#0d1726]/90 px-4 py-4 backdrop-blur-xl"
      initial={{ opacity: 0, y: -8, height: 0 }}
      animate={{ opacity: 1, y: 0, height: "auto" }}
      exit={{ opacity: 0, y: -8, height: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      {content}
    </motion.div>
  );
};
