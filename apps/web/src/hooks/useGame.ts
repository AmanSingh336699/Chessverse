import { useEffect, useRef, useState, startTransition } from "react";
import { useMutation } from "@tanstack/react-query";
import type {
  CreateGameResponse,
  Difficulty,
  GameSnapshot,
  MoveHistoryEntry,
  PlayerColor,
  PlayerMoveRequest,
  PlayerMoveResponse,
  ResignResponse,
  StyleId,
  UndoRequest,
} from "@chessverse/contracts";
import { Chess } from "chess.js";
import { api } from "../api/client";
import {
  boardFen,
  currentCheckSquare,
  describePremove,
  isSquare,
  lastMoveSquares,
  legalTargetsForSquare,
  materialBalance,
  promotionFromPiece,
  pseudoLegalTargetsForSquare,
  toChessMoveInput,
  validatePremoveLegality,
  type PromotionPiece,
} from "../lib/chess";

const MIN_THINKING_DELAY_MS = 500;
const AI_MOVE_ANIMATION_MS = 320;
const PREMOVE_TRIGGER_DELAY_MS = 50;
const PREMOVE_ANIMATION_MS = 180;
const UNDO_STEP_MS = 150;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ANALYSIS_POLL_DELAY_MS = 1200;
const ANALYSIS_POLL_MAX_ATTEMPTS = 6;
const STORAGE_KEYS = {
  gameId: "chessverse:game-id",
  difficulty: "chessverse:difficulty",
  playerColor: "chessverse:player-color",
  style: "chessverse:style",
} as const;

const readStoredStyle = (): StyleId => {
  if (typeof window === "undefined") {
    return "solid";
  }

  const stored = window.localStorage.getItem(STORAGE_KEYS.style);
  return stored === "aggressive" ||
    stored === "gambiteer" ||
    stored === "tricky" ||
    stored === "solid"
    ? stored
    : "solid";
};

const readStoredDifficulty = (): Difficulty => {
  if (typeof window === "undefined") {
    return "advanced";
  }

  const stored = window.localStorage.getItem(STORAGE_KEYS.difficulty);
  return stored === "beginner" ||
    stored === "intermediate" ||
    stored === "advanced" ||
    stored === "master"
    ? stored
    : "advanced";
};

const readStoredPlayerColor = (): PlayerColor => {
  if (typeof window === "undefined") {
    return "white";
  }

  return window.localStorage.getItem(STORAGE_KEYS.playerColor) === "black"
    ? "black"
    : "white";
};

const readStoredGameId = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(STORAGE_KEYS.gameId)?.trim() ?? null;
};

const countHumanMoves = (history: MoveHistoryEntry[]) =>
  history.filter((entry) => entry.player === "human").length;


const isTerminalStatus = (status: GameSnapshot["status"] | undefined) =>
  Boolean(status && ["checkmate", "stalemate", "draw", "resigned"].includes(status));

const localStatusForFen = (fen: string): GameSnapshot["status"] => {
  const chess = new Chess(fen);

  if (chess.isCheckmate()) {
    return "checkmate";
  }

  if (chess.isStalemate()) {
    return "stalemate";
  }

  if (chess.isDraw() || chess.isInsufficientMaterial()) {
    return "draw";
  }

  if (chess.inCheck()) {
    return "check";
  }

  return "playing";
};

export const useGameController = () => {
  const [difficulty, setDifficultyState] = useState<Difficulty>(readStoredDifficulty);
  const [style, setStyle] = useState<StyleId>(readStoredStyle);
  const [selectedPlayerColor, setSelectedPlayerColor] = useState<PlayerColor>(
    readStoredPlayerColor,
  );
  const [orientation, setOrientation] = useState<PlayerColor>(readStoredPlayerColor);
  const [game, setGame] = useState<GameSnapshot | null>(null);
  const [optimisticFen, setOptimisticFen] = useState<string | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [legalTargets, setLegalTargets] = useState<string[]>([]);
  const [captureTargets, setCaptureTargets] = useState<string[]>([]);
  const [thinking, setThinking] = useState(false);
  const [undoAnimating, setUndoAnimating] = useState(false);
  const [premoveExecuting, setPremoveExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<MoveHistoryEntry | null>(null);
  const [behaviorLabel, setBehaviorLabel] = useState<string>("stockfish");
  const [analysisPendingKeys, setAnalysisPendingKeys] = useState<string[]>([]);
  const [mobileTab, setMobileTab] = useState<"info" | "moves" | "controls">("info");
  const [isRestoringGame, setIsRestoringGame] = useState(false);
  const [sideSelectionOpen, setSideSelectionOpen] = useState<boolean>(
    !readStoredGameId(),
  );
  const [confirmNewGameOpen, setConfirmNewGameOpen] = useState(false);
  const [undoPulseVisible, setUndoPulseVisible] = useState(false);
  const [premoveSquares, setPremoveSquares] = useState<[string, string] | null>(null);
  const [premoveStatusText, setPremoveStatusText] = useState<string | null>(null);
  const [premoveNotice, setPremoveNotice] = useState<string | null>(null);
  const premoveNoticeTimerRef = useRef<number | null>(null);
  const capturedSquareRef = useRef<string | null>(null);
  const bootstrappedRef = useRef(false);
  const premoveRef = useRef<{
    from: string;
    to: string;
    promotion?: PromotionPiece;
  } | null>(null);
  const analysisPollTimerRef = useRef<number | null>(null);
  const analysisPollAttemptsRef = useRef(0);
  const moveAbortControllerRef = useRef<AbortController | null>(null);
  const pendingSubmittedMoveRef = useRef<{
    moveNumber: number;
    moveUci: string;
    fenBefore: string;
  } | null>(null);
  const previousCanUndoRef = useRef(false);

  const moveKey = (entry: MoveHistoryEntry) =>
    `${entry.player}:${entry.moveNumber}:${entry.moveUci}`;

  const clearPremove = (clearSelection = false) => {
    premoveRef.current = null;
    setPremoveSquares(null);
    setPremoveStatusText(null);

    if (clearSelection) {
      setSelectedSquare(null);
      setLegalTargets([]);
      setCaptureTargets([]);
    }
  };

  const resetTransientState = () => {
    moveAbortControllerRef.current?.abort();
    moveAbortControllerRef.current = null;
    pendingSubmittedMoveRef.current = null;
    setOptimisticFen(null);
    setSelectedSquare(null);
    setLegalTargets([]);
    setCaptureTargets([]);
    setLastMove(null);
    setThinking(false);
    setUndoAnimating(false);
    setPremoveExecuting(false);
    capturedSquareRef.current = null;
    clearPremove();
    setPremoveNotice(null);
    if (premoveNoticeTimerRef.current !== null) {
      window.clearTimeout(premoveNoticeTimerRef.current);
      premoveNoticeTimerRef.current = null;
    }
    setAnalysisPendingKeys([]);
    if (analysisPollTimerRef.current !== null) {
      window.clearTimeout(analysisPollTimerRef.current);
      analysisPollTimerRef.current = null;
    }
    analysisPollAttemptsRef.current = 0;
  };

  const syncGameSnapshot = (snapshot: GameSnapshot) => {
    setGame(snapshot);
    setOrientation(snapshot.playerColor);
    setSelectedPlayerColor(snapshot.playerColor);
    setLastMove(snapshot.moveHistory.at(-1) ?? null);
    setBehaviorLabel(snapshot.engineState.lastDominantMode);
    setError(null);
    setThinking(false);
    setUndoAnimating(false);
    setPremoveExecuting(false);
    capturedSquareRef.current = null;
    pendingSubmittedMoveRef.current = null;
    moveAbortControllerRef.current = null;
  };

  const scheduleAnalysisRefresh = (gameId: string, pendingKeys: string[]) => {
    if (typeof window === "undefined" || pendingKeys.length === 0) {
      setAnalysisPendingKeys([]);
      return;
    }

    if (analysisPollTimerRef.current !== null) {
      window.clearTimeout(analysisPollTimerRef.current);
      analysisPollTimerRef.current = null;
    }

    analysisPollAttemptsRef.current = 0;
    setAnalysisPendingKeys(pendingKeys);

    const poll = () => {
      analysisPollAttemptsRef.current += 1;
      void api.getGame(gameId)
        .then((snapshot) => {
          const unresolved = pendingKeys.filter((key) => {
            const entry = snapshot.moveHistory.find((moveEntry) => moveKey(moveEntry) === key);
            return entry && !entry.analysis;
          });

          startTransition(() => {
            syncGameSnapshot(snapshot);
          });

          if (
            unresolved.length === 0 ||
            analysisPollAttemptsRef.current >= ANALYSIS_POLL_MAX_ATTEMPTS
          ) {
            setAnalysisPendingKeys(unresolved);
            analysisPollTimerRef.current = null;
            return;
          }

          setAnalysisPendingKeys(unresolved);
          analysisPollTimerRef.current = window.setTimeout(
            poll,
            ANALYSIS_POLL_DELAY_MS,
          );
        })
        .catch(() => {
          if (analysisPollAttemptsRef.current >= ANALYSIS_POLL_MAX_ATTEMPTS) {
            analysisPollTimerRef.current = null;
            return;
          }

          analysisPollTimerRef.current = window.setTimeout(
            poll,
            ANALYSIS_POLL_DELAY_MS,
          );
        });
    };

    analysisPollTimerRef.current = window.setTimeout(
      poll,
      ANALYSIS_POLL_DELAY_MS,
    );
  };

  const createGameMutation = useMutation({
    mutationFn: api.createGame,
    onMutate: () => {
      setError(null);
      resetTransientState();
    },
    onSuccess: (response: CreateGameResponse) => {
      startTransition(() => {
        syncGameSnapshot(response);
      });
    },
    onError: (mutationError: Error) => {
      setGame(null);
      setError(mutationError.message);
      setThinking(false);
    },
  });

  const moveMutation = useMutation({
    mutationFn: ({
      gameId,
      from,
      to,
      promotion,
      clientMoveId,
      expectedPly,
      signal,
    }: {
      gameId: string;
      from: string;
      to: string;
      promotion?: PromotionPiece;
      clientMoveId?: string;
      expectedPly?: number;
      signal?: AbortSignal;
    }) => {
      const payload: PlayerMoveRequest = {
        clientMoveId: clientMoveId ?? crypto.randomUUID(),
        expectedPly: expectedPly ?? 0,
        from,
        to,
        ...(promotion ? { promotion } : {}),
      };
      return api.submitPlayerMove(gameId, payload, signal);
    },
  });

  const undoMutation = useMutation({
    mutationFn: ({
      gameId,
      payload,
    }: {
      gameId: string;
      payload?: UndoRequest;
    }) => api.undo(gameId, payload),
  });

  const resignMutation = useMutation({
    mutationFn: api.resign,
    onSuccess: (response: ResignResponse) => {
      setGame(response.game);
      setError(null);
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.difficulty, difficulty);
  }, [difficulty]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.style, style);
  }, [style]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.playerColor, selectedPlayerColor);
  }, [selectedPlayerColor]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (game?.gameId) {
      window.localStorage.setItem(STORAGE_KEYS.gameId, game.gameId);
      return;
    }

    if (!createGameMutation.isPending && !isRestoringGame) {
      window.localStorage.removeItem(STORAGE_KEYS.gameId);
    }
  }, [game?.gameId, createGameMutation.isPending, isRestoringGame]);

  useEffect(() => {
    if (bootstrappedRef.current) {
      return;
    }

    bootstrappedRef.current = true;
    const storedGameId = readStoredGameId();

    if (!storedGameId) {
      setIsRestoringGame(false);
      setSideSelectionOpen(true);
      return;
    }

    setSideSelectionOpen(false);
    setIsRestoringGame(true);
    void api.getGame(storedGameId)
      .then((response) => {
        startTransition(() => {
          syncGameSnapshot(response);
        });
      })
      .catch((restoreError) => {
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(STORAGE_KEYS.gameId);
        }

        const message =
          restoreError instanceof Error
            ? restoreError.message
            : "Unable to restore saved game.";
        if (message === "Game not found") {
          setGame(null);
          setSideSelectionOpen(true);
          return;
        }

        setGame(null);
        setError(message);
        setSideSelectionOpen(true);
      })
      .finally(() => {
        setIsRestoringGame(false);
      });
  }, []);

  const loadGame = async (gameId: string) => {
    setIsRestoringGame(true);
    try {
      const response = await api.getGame(gameId);
      startTransition(() => {
        syncGameSnapshot(response);
      });
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEYS.gameId, gameId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load game");
    } finally {
      setIsRestoringGame(false);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (sideSelectionOpen) {
        event.preventDefault();
        return;
      }

      if (thinking && (premoveRef.current || selectedSquare)) {
        event.preventDefault();
        clearPremove(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedSquare, sideSelectionOpen, thinking]);

  const activePlayerColor = game?.playerColor ?? selectedPlayerColor;
  const displayedFen = boardFen(game, optimisticFen);
  const checkSquare = currentCheckSquare(displayedFen);
  const balance = materialBalance(displayedFen, activePlayerColor);
  const lastSquares = lastMoveSquares(lastMove);
  const playerSide = activePlayerColor === "white" ? "w" : "b";
  const canChangePlayerColor = !game || game.moveHistory.length === 0;
  const persistedHumanMoves = game ? countHumanMoves(game.moveHistory) : 0;
  const pendingHumanMove = pendingSubmittedMoveRef.current;
  const hasUndoablePendingMove = Boolean(thinking && pendingHumanMove);
  const canUndo =
    !undoAnimating &&
    !undoMutation.isPending &&
    !resignMutation.isPending &&
    (difficulty === "beginner" || difficulty === "intermediate") &&
    (persistedHumanMoves > 0 || hasUndoablePendingMove);

  useEffect(() => {
    if (!previousCanUndoRef.current && canUndo) {
      setUndoPulseVisible(true);
      const timeout = window.setTimeout(() => setUndoPulseVisible(false), 320);
      previousCanUndoRef.current = canUndo;
      return () => window.clearTimeout(timeout);
    }

    previousCanUndoRef.current = canUndo;
  }, [canUndo]);

  const undoHint = canUndo ? "Undo last move" : "No moves to undo";

  const setDifficulty = (nextDifficulty: Difficulty) => {
    setDifficultyState(nextDifficulty);
  };

  const refreshTargets = (square?: string) => {
    if (!square || !game) {
      setSelectedSquare(null);
      setLegalTargets([]);
      setCaptureTargets([]);
      return;
    }

    setSelectedSquare(square);
    if (thinking) {
      setLegalTargets(pseudoLegalTargetsForSquare(displayedFen, square, playerSide));
      return;
    }

    setLegalTargets(legalTargetsForSquare(displayedFen, square));
  };

  const queuePremove = (
    sourceSquare: string,
    targetSquare: string,
    promotion?: PromotionPiece,
  ) => {
    premoveRef.current = {
      from: sourceSquare,
      to: targetSquare,
      ...(promotion ? { promotion } : {}),
    };
    setPremoveSquares([sourceSquare, targetSquare]);
    setPremoveStatusText(describePremove(displayedFen, sourceSquare, targetSquare));
    setPremoveNotice(null);
    setSelectedSquare(null);
    setLegalTargets([]);
  };

  const applyMoveResponse = (response: PlayerMoveResponse) => {
    syncGameSnapshot(response.game);
    setOptimisticFen(null);
    setBehaviorLabel(response.engineMode ?? response.game.engineState.lastDominantMode);
    setLastMove(response.aiMove ?? response.playerMove);
    setError(null);
    setThinking(false);
    setPremoveExecuting(false);
    capturedSquareRef.current = null;
    pendingSubmittedMoveRef.current = null;

    const queued = premoveRef.current;
    if (queued) {
      if (response.game.status !== "playing") {
        clearPremove(true);
      } else {
        clearPremove(true);
        window.setTimeout(() => {
          executePremove(response.game, queued);
        }, PREMOVE_TRIGGER_DELAY_MS);
      }
    }

    const pendingKeys = [response.playerMove, response.aiMove]
      .filter((entry): entry is MoveHistoryEntry => Boolean(entry))
      .filter((entry) => !entry.analysis)
      .map((entry) => moveKey(entry));
    scheduleAnalysisRefresh(response.game.gameId, pendingKeys);
  };

  const submitMove = async (
    currentGame: GameSnapshot,
    sourceSquare: string,
    targetSquare: string,
    promotion?: PromotionPiece,
  ) => {
    const startedAt = Date.now();
    const moveUci = `${sourceSquare}${targetSquare}${promotion ?? ""}`;
    pendingSubmittedMoveRef.current = {
      moveNumber: currentGame.moveHistory.length + 1,
      moveUci,
      fenBefore: currentGame.fen,
    };

    const controller = new AbortController();
    moveAbortControllerRef.current = controller;

    try {
      const response = await moveMutation.mutateAsync({
        gameId: currentGame.gameId,
        from: sourceSquare,
        to: targetSquare,
        ...(promotion ? { promotion } : {}),
        clientMoveId: crypto.randomUUID(),
        expectedPly: currentGame.moveHistory.length,
        signal: controller.signal,
      });

      if (controller.signal.aborted) {
        return;
      }

      await delay(Math.max(0, MIN_THINKING_DELAY_MS - (Date.now() - startedAt)));
      startTransition(() => {
        applyMoveResponse(response);
      });
    } catch (mutationError) {
      if (mutationError instanceof DOMException && mutationError.name === "AbortError") {
        return;
      }

      await delay(Math.max(0, MIN_THINKING_DELAY_MS - (Date.now() - startedAt)));
      setOptimisticFen(null);
      setError(
        mutationError instanceof Error ? mutationError.message : "Move failed",
      );

      // Auto-resync on conflict or internal error to recover from state desync
      const isConflict = mutationError instanceof Error && mutationError.message.includes("409");
      const isInternal = mutationError instanceof Error && mutationError.message.includes("500");
      if (isConflict || isInternal) {
        void syncWithBackend();
      }

      setThinking(false);
      setPremoveExecuting(false);
      pendingSubmittedMoveRef.current = null;
      moveAbortControllerRef.current = null;
      capturedSquareRef.current = null;
    } finally {
      if (moveAbortControllerRef.current === controller) {
        moveAbortControllerRef.current = null;
      }
    }
  };

  const syncWithBackend = async () => {
    if (!game?.gameId) return;
    try {
      const latest = await api.getGame(game.gameId);
      startTransition(() => {
        syncGameSnapshot(latest);
      });
    } catch (e) {
      console.error("Failed to resync game state", { error: e, gameId: game.gameId });
    }
  };

  const openFreshGameDialog = () => {
    resetTransientState();
    setGame(null);
    setBehaviorLabel("stockfish");
    setError(null);
    setConfirmNewGameOpen(false);
    setSideSelectionOpen(true);
  };

  const retryConnection = () => {
    setError(null);
    resetTransientState();
    createGameMutation.mutate({
      playerColor: selectedPlayerColor,
      difficulty,
      style,
    });
  };

  const startNewGame = () => {
    clearPremove(true);

    if (
      game &&
      game.moveHistory.length > 0 &&
      !isTerminalStatus(game.status)
    ) {
      setConfirmNewGameOpen(true);
      return;
    }

    openFreshGameDialog();
  };

  const chooseSide = (nextColor: PlayerColor) => {
    setSelectedPlayerColor(nextColor);
    setOrientation(nextColor);
    setSideSelectionOpen(false);
    setConfirmNewGameOpen(false);
    setError(null);
    setBehaviorLabel("stockfish");
    resetTransientState();
    createGameMutation.mutate({ playerColor: nextColor, difficulty, style });
  };

  const previewMove = (sourceSquare: string, targetSquare: string, piece?: string) => {
    const attemptMove = (promotion?: PromotionPiece) => {
      const preview = new Chess(displayedFen);
      const moveInput = toChessMoveInput(sourceSquare, targetSquare, promotion);
      if (!moveInput) {
        return null;
      }

      let move;
      try {
        move = preview.move(moveInput);
      } catch (e) {
        return null;
      }

      if (!move) {
        return null;
      }

      return {
        preview,
        move,
        submittedPromotion: move.promotion
          ? (move.promotion as PromotionPiece)
          : promotion,
      };
    };

    return attemptMove(promotionFromPiece(piece)) ?? attemptMove("q");
  };

  const executePremove = (
    currentGame: GameSnapshot,
    queued: { from: string; to: string; promotion?: PromotionPiece },
  ) => {
    const validation = validatePremoveLegality(
      currentGame.fen,
      queued.from,
      queued.to,
      queued.promotion,
    );

    if (!validation.legal || !validation.resultingFen) {
      setPremoveExecuting(false);
      setPremoveNotice("Premove cancelled: move is no longer legal in this position");
      if (premoveNoticeTimerRef.current !== null) {
        window.clearTimeout(premoveNoticeTimerRef.current);
      }
      premoveNoticeTimerRef.current = window.setTimeout(() => {
        setPremoveNotice(null);
      }, 3500);
      return;
    }

    setSelectedSquare(null);
    setLegalTargets([]);
    setCaptureTargets([]);
    setOptimisticFen(validation.resultingFen);
    setLastMove({
      moveNumber: currentGame.moveHistory.length + 1,
      player: "human",
      fenBefore: currentGame.fen,
      fenAfter: validation.resultingFen,
      moveUci: validation.uci ?? `${queued.from}${queued.to}${queued.promotion ?? ""}`,
      moveNotation: validation.san ?? queued.to,
      evaluation: currentGame.evaluation,
      engineMode: null,
      timestamp: new Date().toISOString(),
    });
    capturedSquareRef.current = validation.capturedSquare ?? null;
    setThinking(true);
    setError(null);
    setPremoveExecuting(true);
    setPremoveNotice(null);
    void submitMove(
      currentGame,
      queued.from,
      queued.to,
      queued.promotion,
    );
  };

  const commitMove = (sourceSquare: string, targetSquare: string, piece?: string) => {
    if (!game) {
      setError((current) => current ?? "Connect the backend before making a move.");
      return false;
    }

    if (thinking) {
      const candidateTargets = pseudoLegalTargetsForSquare(
        displayedFen,
        sourceSquare,
        playerSide,
      );
      if (!candidateTargets.includes(targetSquare)) {
        return false;
      }

      queuePremove(sourceSquare, targetSquare, promotionFromPiece(piece));
      return true;
    }

    const previewResult = previewMove(sourceSquare, targetSquare, piece);
    if (!previewResult) {
      return false;
    }

    const { preview, move, submittedPromotion } = previewResult;

    setSelectedSquare(null);
    setLegalTargets([]);
    setCaptureTargets([]);
    setOptimisticFen(preview.fen());
    setLastMove({
      moveNumber: game.moveHistory.length + 1,
      player: "human",
      fenBefore: game.fen,
      fenAfter: preview.fen(),
      moveUci: `${move.from}${move.to}${move.promotion ?? ""}`,
      moveNotation: move.san,
      evaluation: game.evaluation,
      engineMode: null,
      timestamp: new Date().toISOString(),
    });
    capturedSquareRef.current = move.captured ? targetSquare : null;
    setThinking(true);
    setError(null);
    clearPremove();
    void submitMove(game, sourceSquare, targetSquare, submittedPromotion);
    return true;
  };

  const handleSquareClick = (square: string) => {
    if (sideSelectionOpen || confirmNewGameOpen) {
      return;
    }

    if (!game) {
      return;
    }

    if (thinking) {
      const board = new Chess(displayedFen);
      const piece = isSquare(square) ? board.get(square) : null;

      // 1. If clicking a candidate target for previously selected piece
      if (selectedSquare && legalTargets.includes(square)) {
        queuePremove(selectedSquare, square);
        return;
      }

      // 2. If clicking the already selected piece, deselect
      if (selectedSquare === square) {
        setSelectedSquare(null);
        setLegalTargets([]);
        return;
      }

      // 3. If clicking own piece, select and compute candidate targets
      if (piece?.color === playerSide) {
        setSelectedSquare(square);
        const candidates = pseudoLegalTargetsForSquare(displayedFen, square, playerSide);
        setLegalTargets(candidates);
        return;
      }

      // 4. Clicking anywhere else clears premove and selection
      clearPremove(true);
      return;
    }

    if (selectedSquare && (legalTargets.includes(square) || captureTargets.includes(square))) {
      void commitMove(selectedSquare, square);
      return;
    }

    if (selectedSquare === square) {
      setSelectedSquare(null);
      setLegalTargets([]);
      setCaptureTargets([]);
      return;
    }

    if (!isSquare(square)) {
      setSelectedSquare(null);
      setLegalTargets([]);
      setCaptureTargets([]);
      return;
    }

    const board = new Chess(displayedFen);
    const piece = board.get(square);
    if (piece?.color === playerSide) {
      const moves = board.moves({ square, verbose: true });
      const normals: string[] = [];
      const captures: string[] = [];
      moves.forEach((move) => {
        if (move.flags.includes("c") || move.flags.includes("e")) {
          captures.push(move.to);
        } else {
          normals.push(move.to);
        }
      });
      setSelectedSquare(square);
      setLegalTargets(normals);
      setCaptureTargets(captures);
      return;
    }

    setSelectedSquare(null);
    setLegalTargets([]);
    setCaptureTargets([]);
  };

  const handlePlayerColorChange = (nextColor: PlayerColor) => {
    if (!canChangePlayerColor) {
      return;
    }

    setSelectedPlayerColor(nextColor);
    setOrientation(nextColor);
  };

  const handleUndo = async () => {
    if (!game || !canUndo) {
      return;
    }

    clearPremove(true);

    const originalGame = game;
    const originalOptimisticFen = optimisticFen;
    const originalLastMove = lastMove;
    const pendingMove = pendingSubmittedMoveRef.current;

    setError(null);
    setUndoAnimating(true);

    try {
      if (thinking && pendingMove) {
        moveAbortControllerRef.current?.abort();
        moveAbortControllerRef.current = null;
        pendingSubmittedMoveRef.current = null;
        setThinking(false);
        setPremoveExecuting(false);
        setOptimisticFen(originalGame.fen);
        setLastMove(originalGame.moveHistory.at(-1) ?? null);
        capturedSquareRef.current = null;
        await delay(UNDO_STEP_MS);

        const response = await undoMutation.mutateAsync({
          gameId: game.gameId,
          payload: {
            mode: "pending-player",
            pendingMoveNumber: pendingMove.moveNumber,
            pendingMoveUci: pendingMove.moveUci,
          },
        });
        syncGameSnapshot(response.game);
        setOptimisticFen(null);
        return;
      }

      const history = originalGame.moveHistory;
      const lastEntry = history.at(-1) ?? null;
      const previousEntry = history.at(-2) ?? null;

      if (lastEntry?.player === "ai" && previousEntry?.player === "human") {
        setGame({
          ...originalGame,
          moveHistory: history.slice(0, -1),
          fen: lastEntry.fenBefore,
          status: localStatusForFen(lastEntry.fenBefore),
        });
        setOptimisticFen(lastEntry.fenBefore);
        setLastMove(previousEntry);
        await delay(UNDO_STEP_MS + 40);

        const remainingHistory = history.slice(0, -2);
        const previousFen = previousEntry.fenBefore;
        const latestAi = [...remainingHistory].reverse().find((entry) => entry.player === "ai") ?? null;
        setGame({
          ...originalGame,
          moveHistory: remainingHistory,
          fen: previousFen,
          evaluation: latestAi?.evaluation ?? null,
          status: localStatusForFen(previousFen),
        });
        setOptimisticFen(previousFen);
        setLastMove(remainingHistory.at(-1) ?? null);
        await delay(UNDO_STEP_MS);
      } else if (lastEntry?.player === "human") {
        setGame({
          ...originalGame,
          moveHistory: history.slice(0, -1),
          fen: lastEntry.fenBefore,
          status: localStatusForFen(lastEntry.fenBefore),
        });
        setOptimisticFen(lastEntry.fenBefore);
        setLastMove(history.at(-2) ?? null);
        await delay(UNDO_STEP_MS);
      }

      const response = await undoMutation.mutateAsync({
        gameId: game.gameId,
        payload: { mode: "auto" },
      });
      syncGameSnapshot(response.game);
      setOptimisticFen(null);
    } catch (undoError) {
      setGame(originalGame);
      setOptimisticFen(originalOptimisticFen);
      setLastMove(originalLastMove);
      setError("Could not undo move. Please try again.");
    } finally {
      setUndoAnimating(false);
    }
  };

  const hasLiveGame = Boolean(game);
  const isSessionBootstrapping =
    (createGameMutation.isPending || isRestoringGame) && !hasLiveGame;
  const isActionPending =
    thinking ||
    moveMutation.isPending ||
    undoMutation.isPending ||
    resignMutation.isPending ||
    undoAnimating;
  const connectionIssue = !hasLiveGame && !sideSelectionOpen ? error : null;
  const statusText = sideSelectionOpen
    ? "Choose your side"
    : connectionIssue
      ? "Backend unavailable"
      : isActionPending
        ? premoveStatusText ?? "AI is thinking..."
        : hasLiveGame
          ? "Board ready"
          : isRestoringGame
            ? "Restoring your board..."
            : isSessionBootstrapping
              ? "Connecting to engine..."
              : "Preparing board...";
  const statusTone = connectionIssue
    ? "error"
    : isActionPending
      ? "thinking"
      : hasLiveGame
        ? "ready"
        : "loading";
  const canFlipBoard =
    !game ||
    game.moveHistory.length === 0 ||
    ["checkmate", "draw", "resigned", "stalemate"].includes(game.status);

  return {
    difficulty,
    setDifficulty,
    style,
    setStyle,
    playerColor: selectedPlayerColor,
    setPlayerColor: handlePlayerColorChange,
    canChangePlayerColor,
    orientation,
    flipBoard: () => {
      if (!canFlipBoard) {
        return;
      }

      setOrientation((current) => (current === "white" ? "black" : "white"));
    },
    game,
    displayedFen,
    thinking,
    undoAnimating,
    boardAnimationDuration: premoveExecuting ? PREMOVE_ANIMATION_MS : 300,
    error,
    setError,
    behaviorLabel,
    legalTargets,
    captureTargets,
    selectedSquare,
    refreshTargets,
    clearTargets: () => {
      setSelectedSquare(null);
      setLegalTargets([]);
      setCaptureTargets([]);
    },
    handleDrop: (
      sourceSquare: string,
      targetSquare: string,
      piece?: string,
    ) => commitMove(sourceSquare, targetSquare, piece),
    handleSquareClick,
    handleSquareRightClick: () => {
      clearPremove(true);
    },
    startNewGame,
    confirmNewGame: openFreshGameDialog,
    cancelNewGameConfirmation: () => setConfirmNewGameOpen(false),
    retryConnection,
    chooseSide,
    undoMove: handleUndo,
    resignGame: () => game && resignMutation.mutate(game.gameId),
    checkSquare,
    lastSquares,
    capturedSquare: capturedSquareRef.current,
    premoveSquares,
    premoveStatusText,
    premoveNotice,
    clearPremoveNotice: () => setPremoveNotice(null),
    premoveArrow:
      premoveSquares && premoveSquares[0] && premoveSquares[1]
        ? ([premoveSquares[0], premoveSquares[1], "#56d0ff"] as const)
        : null,
    clearPremove: () => clearPremove(true),
    balance,
    mobileTab,
    setMobileTab,
    canUndo,
    undoHint,
    undoPulseVisible,
    canFlipBoard,
    isPending: isSessionBootstrapping || isActionPending,
    isBootstrapping: isSessionBootstrapping,
    hasLiveGame,
    connectionIssue,
    statusText,
    statusTone,
    analysisPendingKeys,
    sideSelectionOpen,
    openSideSelection: () => setSideSelectionOpen(true),
    confirmNewGameOpen,
    loadGame,
  };
};
