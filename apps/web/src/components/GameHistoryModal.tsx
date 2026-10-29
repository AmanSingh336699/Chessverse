import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { GameSummary } from "@chessverse/contracts";
import { api } from "../api/client.js";

interface GameHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResumeGame: (gameId: string) => void;
}

const styleColorMap: Record<string, string> = {
  solid: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  aggressive: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  gambiteer: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  tricky: "bg-purple-500/20 text-purple-300 border-purple-500/30",
};

export const GameHistoryModal: React.FC<GameHistoryModalProps> = ({
  isOpen,
  onClose,
  onResumeGame,
}) => {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    api
      .getHistory()
      .then((res) => {
        if (isMounted) {
          setGames(res.games);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to load match history");
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 15 }}
          className="relative max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-slate-900/95 p-6 shadow-2xl backdrop-blur-xl flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">📜</span>
              <div>
                <h2 className="text-lg font-bold text-white">Your Match History</h2>
                <p className="text-xs text-slate-400">
                  Track your tactical evolution across AI styles and game outcomes
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Content Area */}
          <div className="mt-4 flex-1 overflow-y-auto pr-1">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent mb-3" />
                <p className="text-sm">Loading your recorded games...</p>
              </div>
            ) : error ? (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300">
                {error}
              </div>
            ) : games.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-slate-400">
                <span className="text-4xl mb-2">♟️</span>
                <p className="font-semibold text-slate-300">No match records found yet</p>
                <p className="text-xs text-slate-500 max-w-xs mt-1">
                  Complete your first match against any AI personality to log and analyze your games.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {games.map((game) => {
                  const stylePill =
                    styleColorMap[game.style] ?? "bg-slate-500/20 text-slate-300 border-slate-500/30";
                  const dateStr = new Date(game.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  });

                  return (
                    <div
                      key={game.gameId}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-white/5 bg-slate-950/50 p-3.5 transition-all hover:border-white/15 hover:bg-white/5"
                    >
                      <div className="flex items-center gap-3">
                        {/* Result Badge */}
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-bold text-xs ${
                            game.result === "win"
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                              : game.result === "loss"
                              ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                              : game.result === "draw"
                              ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                              : "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                          }`}
                        >
                          {game.result === "win"
                            ? "WIN"
                            : game.result === "loss"
                            ? "LOSS"
                            : game.result === "draw"
                            ? "DRAW"
                            : "PLAY"}
                        </div>

                        {/* Game Meta */}
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${stylePill}`}>
                              {game.style}
                            </span>
                            <span className="text-xs font-medium text-slate-300 capitalize">
                              vs {game.difficulty} AI
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              ({game.playerColor === "white" ? "White" : "Black"})
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-400">
                            <span>{game.totalMoves} moves</span>
                            <span>•</span>
                            <span>Status: {game.status}</span>
                            <span>•</span>
                            <span>{dateStr}</span>
                          </div>
                        </div>
                      </div>

                      {/* Action */}
                      <button
                        onClick={() => {
                          onResumeGame(game.gameId);
                          onClose();
                        }}
                        className="rounded-lg border border-indigo-500/30 bg-indigo-600/20 px-3 py-1.5 text-xs font-semibold text-indigo-300 transition-all hover:bg-indigo-600 hover:text-white"
                      >
                        Replay / View
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
