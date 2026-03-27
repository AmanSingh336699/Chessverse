import type { GambitState, PlayerColor } from "../../contracts.js";
import { Chess } from "chess.js";
import { materialForColor } from "../../utils/chess.js";

export interface GambitReplyContext {
  state?: GambitState;
  aiColor: PlayerColor;
  beforeFen: string;
  afterFen: string;
  evaluation?: number | null;
  cooldownPlies?: number;
}

const FAILED_COOLDOWN_PLIES = 5;

type LegacyGambitState = Partial<GambitState> & { status?: string | undefined };

const withOptionalLine = (state: Omit<GambitState, "line">, line?: string): GambitState =>
  line ? { ...state, line } : state;

const deriveHandoff = (status: GambitState["status"]): GambitState["handoffMode"] => {
  switch (status) {
    case "accepted":
      return "exploitation";
    case "declined":
      return "pressure";
    case "failed":
      return "recovery";
    case "idle":
      return "clean";
    default:
      return "none";
  }
};

export const createIdleGambitState = (): GambitState => ({
  active: false,
  status: "idle",
  cooldown: 0,
  attemptMoveNumber: null,
  handoffMode: "clean",
  refuted: false,
});

export const normalizeGambitState = (state?: LegacyGambitState | null): GambitState => {
  if (!state) {
    return createIdleGambitState();
  }

  const rawStatus: string = typeof state.status === "string" ? state.status : "idle";
  const status = rawStatus === "none" ? "idle" : rawStatus;
  const cooldown = Math.max(0, Math.trunc(state.cooldown ?? 0));
  const line = typeof state.line === "string" && state.line.length > 0 ? state.line : undefined;
  const active = typeof state.active === "boolean"
    ? state.active
    : status === "offered" || status === "accepted" || status === "declined";

  if (
    status !== "idle" &&
    status !== "offered" &&
    status !== "accepted" &&
    status !== "declined" &&
    status !== "failed"
  ) {
    return createIdleGambitState();
  }

  return withOptionalLine(
    {
      active,
      status,
      cooldown,
      attemptMoveNumber: state.attemptMoveNumber ?? null,
      handoffMode: state.handoffMode ?? deriveHandoff(status),
      refuted: Boolean(state.refuted ?? (status === "failed")),
    },
    line,
  );
};

export const createOfferedGambitState = (line?: string, attemptMoveNumber?: number | null): GambitState =>
  withOptionalLine(
    {
      active: true,
      status: "offered",
      cooldown: 0,
      attemptMoveNumber: attemptMoveNumber ?? null,
      handoffMode: "none",
      refuted: false,
    },
    line,
  );

export const createAcceptedGambitState = (state?: GambitState): GambitState => {
  const normalized = normalizeGambitState(state);
  return withOptionalLine(
    {
      active: true,
      status: "accepted",
      cooldown: normalized.cooldown,
      attemptMoveNumber: normalized.attemptMoveNumber ?? null,
      handoffMode: "exploitation",
      refuted: false,
    },
    normalized.line,
  );
};

export const createDeclinedGambitState = (state?: GambitState): GambitState => {
  const normalized = normalizeGambitState(state);
  return withOptionalLine(
    {
      active: true,
      status: "declined",
      cooldown: normalized.cooldown,
      attemptMoveNumber: normalized.attemptMoveNumber ?? null,
      handoffMode: "pressure",
      refuted: false,
    },
    normalized.line,
  );
};

export const createFailedGambitState = (
  state?: GambitState,
  cooldownPlies = FAILED_COOLDOWN_PLIES,
): GambitState => {
  const normalized = normalizeGambitState(state);
  return withOptionalLine(
    {
      active: false,
      status: "failed",
      cooldown: Math.max(0, Math.trunc(cooldownPlies)),
      attemptMoveNumber: normalized.attemptMoveNumber ?? null,
      handoffMode: "recovery",
      refuted: true,
    },
    normalized.line,
  );
};

export const decrementGambitCooldown = (state?: GambitState, plies = 1): GambitState => {
  const normalized = normalizeGambitState(state);
  if (normalized.status !== "failed" || normalized.cooldown === 0) {
    return normalized;
  }

  const nextCooldown = Math.max(0, normalized.cooldown - Math.max(1, Math.trunc(plies)));
  if (nextCooldown === 0) {
    return createIdleGambitState();
  }

  return withOptionalLine(
    {
      active: false,
      status: "failed",
      cooldown: nextCooldown,
      attemptMoveNumber: normalized.attemptMoveNumber ?? null,
      handoffMode: "recovery",
      refuted: true,
    },
    normalized.line,
  );
};

export const isGambitSuppressed = (state?: GambitState): boolean => {
  const normalized = normalizeGambitState(state);
  return normalized.status === "failed" && normalized.cooldown > 0;
};

export const resolveGambitReplyState = (context: GambitReplyContext): GambitState => {
  const current = normalizeGambitState(context.state);
  if (current.status !== "offered") {
    return current;
  }

  if (typeof context.evaluation === "number" && context.evaluation < -1.5) {
    return createFailedGambitState(current, context.cooldownPlies);
  }

  try {
    const before = materialForColor(new Chess(context.beforeFen), context.aiColor);
    const after = materialForColor(new Chess(context.afterFen), context.aiColor);

    if (after < before) {
      return createAcceptedGambitState(current);
    }

    if (after === before) {
      return createDeclinedGambitState(current);
    }

    return current;
  } catch {
    return current;
  }
};