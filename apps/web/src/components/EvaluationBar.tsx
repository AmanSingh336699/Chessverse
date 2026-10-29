import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type {
    MoveAnalysisDisplayMode,
    MoveClassification,
    PlayerColor,
} from "../contracts";
import { getMoveQualityVisual } from "./MoveQualitySymbol";

interface EvaluationBarProps {
    evaluation: number | null;
    mateIn?: number | null | undefined;
    lastClassification?: MoveClassification | null | undefined;
    lastDisplayMode?: MoveAnalysisDisplayMode | null | undefined;
    perspective?: PlayerColor | undefined;
    height?: number | undefined;
}

const normalize = (
    evaluation: number | null,
    mateIn?: number | null,
): number => {
    // Explicit mateIn prop takes precedence
    if (typeof mateIn === "number") {
        return mateIn > 0 ? 98 : 2;
    }

    if (evaluation === null) return 50;

    // Mate-encoded evaluations: ±100 indicates forced mate
    if (Math.abs(evaluation) >= 100) {
        return evaluation > 0 ? 98 : 2;
    }

    // Continuous sigmoid curve: non-linear scaling so ±1 is distinct, ±5 is decisive
    const clamped = Math.max(-10, Math.min(10, evaluation));
    const normalized = 50 + Math.tanh(clamped / 3) * 50;
    return Math.max(2, Math.min(98, normalized));
};

const formatEval = (
    evaluation: number | null,
    mateIn?: number | null,
): string => {
    if (typeof mateIn === "number") {
        return `M${Math.abs(mateIn)}`;
    }

    if (evaluation === null) return "0.0";

    if (Math.abs(evaluation) >= 100) {
        return "M?";
    }

    return evaluation > 0 ? `+${evaluation.toFixed(1)}` : evaluation.toFixed(1);
};

export const EvaluationBar = ({
    evaluation,
    mateIn,
    lastClassification,
    lastDisplayMode = "badge",
    perspective = "white",
    height,
}: EvaluationBarProps) => {
    // Normalise to white-perspective
    const whitePerspectiveEval =
        perspective === "black" && evaluation !== null
            ? -evaluation
            : evaluation;
    const whitePerspectiveMate =
        perspective === "black" && typeof mateIn === "number"
            ? -mateIn
            : mateIn;

    const percent = normalize(whitePerspectiveEval, whitePerspectiveMate);
    const label = formatEval(whitePerspectiveEval, whitePerspectiveMate);

    const isMate =
        typeof whitePerspectiveMate === "number" ||
        (whitePerspectiveEval !== null &&
            Math.abs(whitePerspectiveEval) >= 100);

    // Advantage state
    const evalVal = whitePerspectiveEval ?? 0;
    const isWhiteAhead = evalVal > 0.15 || (typeof whitePerspectiveMate === "number" && whitePerspectiveMate > 0);
    const isBlackAhead = evalVal < -0.15 || (typeof whitePerspectiveMate === "number" && whitePerspectiveMate < 0);
    const isEqual = !isWhiteAhead && !isBlackAhead;

    const [flashKey, setFlashKey] = useState(0);
    const flashVisual = getMoveQualityVisual(
        lastClassification,
        lastDisplayMode,
    );

    useEffect(() => {
        if (!flashVisual) return;
        setFlashKey((current) => current + 1);
    }, [lastClassification, lastDisplayMode, whitePerspectiveEval]);

    // Bottom region is white when perspective="white", black when perspective="black"
    const whiteOnBottom = perspective === "white";
    const whiteHeightPercent = percent;
    const blackHeightPercent = 100 - percent;

    return (
        <div
            className="relative w-9 sm:w-10 overflow-hidden rounded-2xl border border-white/14 bg-[#060c16] shadow-[0_16px_45px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.08)] select-none shrink-0"
            style={{
                height: height ? `${height}px` : "100%",
                minHeight: "280px",
            }}
            role="meter"
            aria-label={`Evaluation: ${label}`}
            aria-valuenow={whitePerspectiveEval ?? 0}
            aria-valuemin={-10}
            aria-valuemax={10}
        >
            {/* Outer subtle glow line */}
            <div className="pointer-events-none absolute inset-0 rounded-2xl border border-cyan-400/10 z-20" />

            {/* Black Region (Top in standard orientation) */}
            <motion.div
                className={`absolute inset-x-0 ${whiteOnBottom ? "top-0" : "bottom-0"} ${
                    isMate && isBlackAhead
                        ? "bg-linear-to-b from-[#1b0b22] via-[#0d0714] to-[#060b13]"
                        : "bg-linear-to-b from-[#060b13] via-[#0b1422] to-[#121f33]"
                }`}
                animate={{
                    height: `${whiteOnBottom ? blackHeightPercent : whiteHeightPercent}%`,
                }}
                transition={{ type: "spring", stiffness: 120, damping: 20 }}
            />

            {/* White Region (Bottom in standard orientation) */}
            <motion.div
                className={`absolute inset-x-0 ${whiteOnBottom ? "bottom-0" : "top-0"} ${
                    isMate && isWhiteAhead
                        ? "bg-linear-to-t from-amber-200 via-[#ffffff] to-amber-100 shadow-[0_0_24px_rgba(251,191,36,0.3)]"
                        : "bg-linear-to-t from-[#d9e2ec] via-[#f8fafc] to-[#ffffff]"
                }`}
                animate={{
                    height: `${whiteOnBottom ? whiteHeightPercent : blackHeightPercent}%`,
                }}
                transition={{ type: "spring", stiffness: 120, damping: 20 }}
            />

            {/* Luminous Horizon Dividing Line */}
            <motion.div
                className="pointer-events-none absolute inset-x-0 h-[2px] bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.9),0_0_20px_rgba(103,232,249,0.4)] z-20"
                animate={{
                    bottom: `${whiteOnBottom ? percent : 100 - percent}%`,
                }}
                transition={{ type: "spring", stiffness: 120, damping: 20 }}
            />

            {/* Reference Tick Marks */}
            <div className="pointer-events-none absolute inset-y-0 right-0 w-2.5 flex flex-col justify-between py-4 z-15 opacity-40">
                <span className="w-1.5 h-px bg-white/50 ml-auto" title="+5" />
                <span className="w-2 h-px bg-white/60 ml-auto" title="+3" />
                <span className="w-2.5 h-px bg-cyan-300/80 ml-auto" title="0.0" />
                <span className="w-2 h-px bg-white/60 ml-auto" title="-3" />
                <span className="w-1.5 h-px bg-white/50 ml-auto" title="-5" />
            </div>

            {/* Move-Quality Flash Overlay */}
            <AnimatePresence>
                {flashVisual ? (
                    <motion.div
                        key={flashKey}
                        className="pointer-events-none absolute inset-0 rounded-2xl z-25"
                        style={{
                            background: flashVisual.tint,
                            boxShadow: `inset 0 0 0 2px ${flashVisual.color}`,
                        }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: [0, 1, 0] }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.45, ease: "easeOut" }}
                    />
                ) : null}
            </AnimatePresence>

            {/* ======================================================== */}
            {/* High-Contrast Dynamic Evaluation Badges                   */}
            {/* Never obscured, 100% readable regardless of background   */}
            {/* ======================================================== */}

            {/* Top Score Badge (Visible when Black is leading, or Black mate) */}
            {isBlackAhead && (
                <div className="absolute top-2.5 inset-x-0 flex justify-center z-30 pointer-events-none">
                    <motion.span
                        key={`black-${label}`}
                        className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded-md font-mono text-[11px] font-black tracking-tight border shadow-lg ${
                            isMate
                                ? "bg-rose-500 text-white border-rose-300 shadow-[0_0_14px_rgba(244,63,94,0.7)] animate-pulse"
                                : "bg-black/90 text-white border-white/25 shadow-[0_2px_8px_rgba(0,0,0,0.85)]"
                        }`}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.15 }}
                    >
                        {label}
                    </motion.span>
                </div>
            )}

            {/* Bottom Score Badge (Visible when White is leading, or White mate) */}
            {isWhiteAhead && (
                <div className="absolute bottom-2.5 inset-x-0 flex justify-center z-30 pointer-events-none">
                    <motion.span
                        key={`white-${label}`}
                        className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded-md font-mono text-[11px] font-black tracking-tight border shadow-lg ${
                            isMate
                                ? "bg-amber-400 text-slate-950 border-amber-200 shadow-[0_0_14px_rgba(251,191,36,0.7)] animate-pulse"
                                : "bg-white/98 text-slate-950 border-slate-300/80 shadow-[0_2px_8px_rgba(0,0,0,0.25)]"
                        }`}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.15 }}
                    >
                        {label}
                    </motion.span>
                </div>
            )}

            {/* Center Neutral Badge (Visible when game is balanced: 0.0) */}
            {isEqual && (
                <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
                    <motion.span
                        key="equal-0.0"
                        className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-md font-mono text-[10px] font-black tracking-tight bg-[#071322]/95 text-cyan-200 border border-cyan-400/40 shadow-[0_0_12px_rgba(34,211,238,0.3)]"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.15 }}
                    >
                        0.0
                    </motion.span>
                </div>
            )}
        </div>
    );
};
