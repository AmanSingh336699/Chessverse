import React from "react";
import type { UserProfile } from "@chessverse/contracts";

interface NavbarProps {
  currentView: "home" | "arena";
  onNavigate: (view: "home" | "arena") => void;
  user: UserProfile | null;
  onOpenAuth: () => void;
  onOpenHistory: () => void;
  onLogout: () => void;
  onNewGame: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentView,
  onNavigate,
  user,
  onOpenAuth,
  onOpenHistory,
  onLogout,
  onNewGame,
}) => {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/10 bg-slate-950/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand Logo */}
        <div
          onClick={() => onNavigate("home")}
          className="group flex cursor-pointer items-center gap-3 transition-transform hover:scale-[1.02]"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-500 via-indigo-600 to-cyan-400 p-0.5 shadow-lg shadow-indigo-500/20">
            <div className="flex h-full w-full items-center justify-center rounded-[10px] bg-slate-950 text-xl font-black text-amber-400">
              ♟
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="bg-gradient-to-r from-white via-slate-200 to-indigo-300 bg-clip-text text-lg font-black tracking-wider text-transparent">
                CHESSVERSE
              </span>
              <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold text-indigo-400 border border-indigo-500/30">
                AI 2.0
              </span>
            </div>
            <p className="text-[10px] font-medium text-slate-400">Living AI Personalities</p>
          </div>
        </div>

        {/* Center Navigation Links */}
        <nav className="hidden md:flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1 backdrop-blur-md">
          <button
            onClick={() => onNavigate("home")}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
              currentView === "home"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/30"
                : "text-slate-300 hover:text-white hover:bg-white/5"
            }`}
          >
            Overview & Styles
          </button>
          <button
            onClick={() => onNavigate("arena")}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
              currentView === "arena"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/30"
                : "text-slate-300 hover:text-white hover:bg-white/5"
            }`}
          >
            Play Arena
          </button>
          {user && (
            <button
              onClick={onOpenHistory}
              className="rounded-full px-4 py-1.5 text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/5 transition-all"
            >
              Match History
            </button>
          )}
        </nav>

        {/* Right Action / Auth Area */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={onNewGame}
            className="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-amber-600/20 px-3 py-1.5 text-xs font-semibold text-amber-300 transition-all hover:border-amber-400 hover:bg-amber-500/20 active:scale-95"
          >
            <span>⚔️</span>
            <span>New Game</span>
          </button>

          {user ? (
            <div className="flex items-center gap-2">
              <button
                onClick={onOpenHistory}
                className="group flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition-all hover:border-indigo-500/40 hover:bg-white/10"
                title="View Match History & Profile"
              >
                <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white uppercase shadow">
                  {user.username.slice(0, 1)}
                </div>
                <div className="hidden sm:block text-left">
                  <div className="font-semibold text-slate-100 leading-tight">
                    {user.username}
                  </div>
                  <div className="text-[10px] text-emerald-400 font-mono">
                    {user.stats.winRate}% win ({user.stats.wins}W - {user.stats.losses}L)
                  </div>
                </div>
              </button>

              <button
                onClick={onLogout}
                className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-400 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 transition-all"
                title="Sign Out"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenAuth}
              className="flex items-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg shadow-indigo-600/30 transition-all hover:bg-indigo-500 active:scale-95"
            >
              <span>👤</span>
              <span>Sign In</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
