import { motion, AnimatePresence } from "framer-motion";
import type {
  MoveAnalysisDisplayMode,
  MoveClassification,
} from "../contracts";

interface MoveQualitySymbolProps {
  classification: MoveClassification | null | undefined;
  displayMode?: MoveAnalysisDisplayMode | null;
  analyzing?: boolean;
  size?: "sm" | "md" | "lg";
}

type GlyphName =
  | "diamond"
  | "star"
  | "double-check"
  | "check"
  | "question"
  | "warning"
  | "blunder"
  | "mate";

export type ClassificationVisual = {
  icon: GlyphName;
  label: string;
  color: string;
  badge: string;
  tint: string;
  glow: string;
};

export const CLASSIFICATION_CONFIG: Record<
  MoveClassification,
  ClassificationVisual
> = {
  brilliant: {
    icon: "diamond",
    label: "Brilliant",
    color: "#1BACA6",
    badge: "rgba(27,172,166,0.92)",
    tint: "rgba(27,172,166,0.10)",
    glow: "0 0 18px rgba(27,172,166,0.28)",
  },
  best: {
    icon: "star",
    label: "Best",
    color: "#F6C700",
    badge: "rgba(246,199,0,0.94)",
    tint: "rgba(246,199,0,0.10)",
    glow: "0 0 18px rgba(246,199,0,0.22)",
  },
  excellent: {
    icon: "double-check",
    label: "Excellent",
    color: "#5B8A3C",
    badge: "rgba(91,138,60,0.94)",
    tint: "rgba(91,138,60,0.10)",
    glow: "0 0 16px rgba(91,138,60,0.2)",
  },
  good: {
    icon: "check",
    label: "Good",
    color: "#96BC4B",
    badge: "rgba(150,188,75,0.94)",
    tint: "rgba(150,188,75,0.10)",
    glow: "0 0 14px rgba(150,188,75,0.16)",
  },
  inaccuracy: {
    icon: "question",
    label: "Inaccuracy",
    color: "#F0A500",
    badge: "rgba(240,165,0,0.94)",
    tint: "rgba(240,165,0,0.10)",
    glow: "0 0 14px rgba(240,165,0,0.16)",
  },
  mistake: {
    icon: "warning",
    label: "Mistake",
    color: "#E07B1F",
    badge: "rgba(224,123,31,0.94)",
    tint: "rgba(224,123,31,0.10)",
    glow: "0 0 14px rgba(224,123,31,0.18)",
  },
  blunder: {
    icon: "blunder",
    label: "Blunder",
    color: "#CA3431",
    badge: "rgba(202,52,49,0.94)",
    tint: "rgba(202,52,49,0.12)",
    glow: "0 0 18px rgba(202,52,49,0.24)",
  },
};

const MATE_VISUAL: ClassificationVisual = {
  icon: "mate",
  label: "Checkmate",
  color: "#F6C700",
  badge: "rgba(246,199,0,0.94)",
  tint: "rgba(246,199,0,0.10)",
  glow: "0 0 18px rgba(246,199,0,0.24)",
};

const SIZE_MAP = {
  sm: { outer: 20, glyph: 11 },
  md: { outer: 34, glyph: 18 },
  lg: { outer: 40, glyph: 22 },
} as const;

const glyphStroke = (width: number) => Math.max(1.7, width / 7);

const QualityGlyph = ({
  icon,
  size,
}: {
  icon: GlyphName;
  size: number;
}) => {
  const stroke = glyphStroke(size);

  switch (icon) {
    case "diamond":
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
          <path d="M12 2.8 20.5 12 12 21.2 3.5 12 12 2.8Z" fill="white" fillOpacity="0.12" />
          <path d="M12 2.8 20.5 12 12 21.2 3.5 12 12 2.8Z" stroke="white" strokeWidth={stroke} />
          <path d="M7.5 12h9M12 7.5v9" stroke="white" strokeWidth={stroke - 0.4} strokeLinecap="round" />
        </svg>
      );
    case "star":
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
          <path
            d="m12 3 2.4 4.9 5.4.8-3.9 3.8.9 5.5L12 15.8 7.2 18l.9-5.5-3.9-3.8 5.4-.8L12 3Z"
            fill="white"
            fillOpacity="0.15"
            stroke="white"
            strokeWidth={stroke - 0.2}
            strokeLinejoin="round"
          />
        </svg>
      );
    case "double-check":
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
          <path d="m4.8 12.4 2.6 2.7 4.6-4.9" stroke="white" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
          <path d="m10.8 12.4 2.6 2.7 5.8-6.3" stroke="white" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "check":
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
          <path d="m6 12.6 3.4 3.4 8.4-8.8" stroke="white" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "question":
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
          <path d="M8.6 8.6a3.8 3.8 0 1 1 5.8 3.2c-1.3.8-2.1 1.5-2.1 3" stroke="white" strokeWidth={stroke} strokeLinecap="round" />
          <circle cx="12" cy="17.8" r="1.15" fill="white" />
        </svg>
      );
    case "warning":
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
          <path d="M12 6.2v7.4" stroke="white" strokeWidth={stroke} strokeLinecap="round" />
          <circle cx="12" cy="17.4" r="1.2" fill="white" />
          <circle cx="12" cy="12" r="9" stroke="white" strokeWidth={stroke - 0.4} strokeDasharray="2 2" />
        </svg>
      );
    case "blunder":
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
          <path d="m8 8 8 8M16 8l-8 8" stroke="white" strokeWidth={stroke} strokeLinecap="round" />
          <circle cx="12" cy="12" r="8.5" stroke="white" strokeWidth={stroke - 0.5} />
        </svg>
      );
    case "mate":
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
          <path d="M6 18h12M8.3 16.2h7.4l-1-6.4H9.3l-1 6.4Z" fill="white" fillOpacity="0.16" stroke="white" strokeWidth={stroke - 0.5} />
          <path d="M7 6.3 9 8l3-2.7L15 8l2-1.7v3.5H7V6.3Z" fill="white" fillOpacity="0.16" stroke="white" strokeWidth={stroke - 0.5} strokeLinejoin="round" />
          <path d="M12 4.4v2.1M9 5.3v1.6M15 5.3v1.6" stroke="white" strokeWidth={stroke - 0.8} strokeLinecap="round" />
        </svg>
      );
  }
};

export const getMoveQualityVisual = (
  classification: MoveClassification | null | undefined,
  displayMode: MoveAnalysisDisplayMode | null | undefined = "badge",
): ClassificationVisual | null => {
  if (!classification || displayMode === "none") {
    return null;
  }

  if (displayMode === "mate") {
    return MATE_VISUAL;
  }

  return CLASSIFICATION_CONFIG[classification];
};

export const MoveQualitySymbol = ({
  classification,
  displayMode = "badge",
  analyzing = false,
  size = "sm",
}: MoveQualitySymbolProps) => {
  const dimensions = SIZE_MAP[size];
  const visual = getMoveQualityVisual(classification, displayMode);

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center"
      style={{ width: dimensions.outer, height: dimensions.outer }}
      aria-label={
        analyzing
          ? "Analyzing move"
          : visual
            ? `${visual.label} move`
            : undefined
      }
      role={visual ? "img" : undefined}
    >
      <AnimatePresence mode="wait">
        {analyzing && !visual ? (
          <motion.span
            key="analyzing"
            className="inline-flex items-center justify-center rounded-full"
            style={{
              width: dimensions.outer,
              height: dimensions.outer,
              background:
                "linear-gradient(135deg, rgba(136,196,255,0.18), rgba(255,255,255,0.05))",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
            initial={{ opacity: 0, scale: 0.65 }}
            animate={{ opacity: [0.45, 1, 0.45], scale: [0.92, 1, 0.92] }}
            exit={{ opacity: 0, scale: 0.65 }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          >
            <span
              className="rounded-full"
              style={{
                width: Math.max(6, dimensions.outer / 3.5),
                height: Math.max(6, dimensions.outer / 3.5),
                background: "rgba(255,255,255,0.9)",
              }}
            />
          </motion.span>
        ) : visual ? (
          <motion.span
            key={`${classification}-${displayMode}`}
            className="relative inline-flex items-center justify-center rounded-full"
            style={{
              width: dimensions.outer,
              height: dimensions.outer,
              background: visual.badge,
              border: "1px solid rgba(255,255,255,0.18)",
              boxShadow: `${visual.glow}, 0 1px 3px rgba(0,0,0,0.34)`,
            }}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{
              opacity: 1,
              scale: displayMode === "mate" || classification === "brilliant"
                ? [1, 1.06, 1]
                : 1,
            }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            title={visual.label}
          >
            <QualityGlyph icon={visual.icon} size={dimensions.glyph} />
          </motion.span>
        ) : (
          <motion.span
            key="empty"
            style={{ width: dimensions.outer, height: dimensions.outer }}
            initial={false}
          />
        )}
      </AnimatePresence>
    </span>
  );
};
