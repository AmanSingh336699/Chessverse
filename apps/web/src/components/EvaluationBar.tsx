
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
    mateIn?: number | null;
    lastClassification?: MoveClassification | null;
    lastDisplayMode?: MoveAnalysisDisplayMode | null;
    perspective?: PlayerColor;
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

    // Mate-encoded evaluations: backend stores ±100 when there is forced mate.
    // Handle before clamping so the tanh branch never sees these values.
    if (Math.abs(evaluation) >= 100) {
        return evaluation > 0 ? 98 : 2;
    }

    // Continuous eval: sigmoid-like curve so near-certain wins look decisive
    const clamped = Math.max(-10, Math.min(10, evaluation));
    const normalized = 50 + Math.tanh(clamped / 3) * 50;
    return Math.max(2, Math.min(98, normalized));
};

const formatEval = (
    evaluation: number | null,
    mateIn?: number | null,
): string => {
    if (typeof mateIn === "number") {
        // Always show the absolute distance; sign conveyed by bar colour
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
}: EvaluationBarProps) => {
    // Normalise to white-perspective so all downstream logic is consistent.
    // If the caller passes perspective="black" (rare defensive use), negate.
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

    // Positive (white-perspective) → white is winning
    const whiteWinning =
        (whitePerspectiveEval ?? 0) > 0 ||
        (typeof whitePerspectiveMate === "number" && whitePerspectiveMate > 0);

    const [flashKey, setFlashKey] = useState(0);
    const flashVisual = getMoveQualityVisual(
        lastClassification,
        lastDisplayMode,
    );

    useEffect(() => {
        if (!flashVisual) return;
        setFlashKey((current) => current + 1);
    }, [lastClassification, lastDisplayMode, whitePerspectiveEval]);

    return (
        <div
            className="relative h-56 w-16 overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(5,12,20,0.86),rgba(9,18,31,0.96))] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_24px_60px_rgba(2,8,20,0.38)] md:h-60 md:w-[4.35rem]"
            role="meter"
            aria-label={`Evaluation: ${label}`}
            aria-valuenow={whitePerspectiveEval ?? 0}
            aria-valuemin={-10}
            aria-valuemax={10}
        >
            <div className="pointer-events-none absolute inset-[5px] rounded-[22px] border border-cyan-300/8" />

            {/* Black region (top) — grows when black is winning */}
            <motion.div
                className={`absolute inset-x-0 top-0 ${
                    isMate && !whiteWinning
                        ? "bg-linear-to-b from-slate-700 to-slate-950"
                        : "bg-linear-to-b from-slate-900 to-slate-700"
                }`}
                animate={{ height: `${100 - percent}%` }}
                transition={{ type: "spring", stiffness: 120, damping: 20 }}
            />

            {/* White region (bottom) — grows when white is winning */}
            <motion.div
                className={`absolute inset-x-0 bottom-0 ${
                    isMate && whiteWinning
                        ? "bg-linear-to-b from-white to-stone-100"
                        : "bg-linear-to-b from-[#8ff6df] via-[#d7fffa] to-white"
                }`}
                animate={{ height: `${percent}%` }}
                transition={{ type: "spring", stiffness: 120, damping: 20 }}
            />

            {/* Horizon guides */}
            <div className="pointer-events-none absolute inset-x-[5px] top-[18%] h-px bg-white/8" />
            <div className="pointer-events-none absolute inset-x-[5px] top-1/2 h-px bg-white/10" />
            <div className="pointer-events-none absolute inset-x-[5px] bottom-[18%] h-px bg-white/8" />

            {/* Move-quality flash overlay */}
            <AnimatePresence>
                {flashVisual ? (
                    <motion.div
                        key={flashKey}
                        className="pointer-events-none absolute inset-[5px] rounded-[22px]"
                        style={{
                            background: flashVisual.tint,
                            boxShadow: `inset 0 0 0 1px ${flashVisual.color}33`,
                        }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: [0, 0.9, 0] }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                    />
                ) : null}
            </AnimatePresence>

            {/* Numerical eval label */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <motion.span
                    key={label}
                    className={`text-xs font-bold leading-none ${
                        isMate
                            ? "text-cyan-400 drop-shadow-[0_0_4px_rgba(34,211,238,0.4)]"
                            : "text-stone-900 mix-blend-difference"
                    }`}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.2 }}
                >
                    {label}
                </motion.span>
            </div>
        </div>
    );
};
