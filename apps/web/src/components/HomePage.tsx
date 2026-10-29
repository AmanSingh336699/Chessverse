import React from "react";
import { motion } from "framer-motion";
import type { StyleId, UserProfile } from "@chessverse/contracts";

interface HomePageProps {
  onStartGame: (style?: StyleId) => void;
  onOpenSideDialog: () => void;
  onOpenAuth: () => void;
  onOpenHistory: () => void;
  user: UserProfile | null;
}

const stylesData: Array<{
  id: StyleId;
  name: string;
  badge: string;
  icon: string;
  color: string;
  borderHover: string;
  gradient: string;
  quote: string;
  repertoire: string;
  multiPv: number;
  temperature: string;
  evalBudget: string;
  personality: string;
}> = [
  {
    id: "solid",
    name: "Solid",
    badge: "Positional Master",
    icon: "🛡️",
    color: "text-blue-400",
    borderHover: "hover:border-blue-500/50",
    gradient: "from-blue-600/10 via-slate-900 to-slate-950",
    quote: "Patience and prophylaxis. Wait for your opponent to overextend.",
    repertoire: "Classical Ruy Lopez, Queen's Gambit Declined, Berlin Wall, Caro-Kann.",
    multiPv: 6,
    temperature: "0.15 (Deterministic)",
    evalBudget: "20-30 cp (Tight)",
    personality: "Plays like Anatoly Karpov & Jose Raul Capablanca. Refuses unsound attacks, capitalizes on structural weaknesses, and converts endgames cleanly.",
  },
  {
    id: "aggressive",
    name: "Aggressive",
    badge: "The Firebreather",
    icon: "⚡",
    color: "text-rose-400",
    borderHover: "hover:border-rose-500/50",
    gradient: "from-rose-600/10 via-slate-900 to-slate-950",
    quote: "Attack relentlessly. King safety is merely an illusion.",
    repertoire: "Sicilian Najdorf & Dragon attacks, Fried Liver (Ng5), King's Indian assaults.",
    multiPv: 8,
    temperature: "0.35 (Bold)",
    evalBudget: "45-75 cp (Active)",
    personality: "Plays like Garry Kasparov & Mikhail Tal. Will sacrifice pawns for piece activity and open lines toward your king.",
  },
  {
    id: "gambiteer",
    name: "Gambiteer",
    badge: "Romantic Era",
    icon: "🔥",
    color: "text-amber-400",
    borderHover: "hover:border-amber-500/50",
    gradient: "from-amber-600/10 via-slate-900 to-slate-950",
    quote: "A piece given is an initiative earned. Welcome to 19th-century chess.",
    repertoire: "King's Gambit (f4), Danish Gambit, Evans Gambit, Budapest, Albin Countergambit.",
    multiPv: 10,
    temperature: "0.45 (Romantic)",
    evalBudget: "80-110 cp (Sacrificial)",
    personality: "Plays like Paul Morphy & Adolf Anderssen. Throws material out the window to generate breathtaking tactical complexity.",
  },
  {
    id: "tricky",
    name: "Tricky",
    badge: "Tactical Magician",
    icon: "🎭",
    color: "text-purple-400",
    borderHover: "hover:border-purple-500/50",
    gradient: "from-purple-600/10 via-slate-900 to-slate-950",
    quote: "Look one square, strike from another. Traps within traps.",
    repertoire: "Fishing Pole traps, Legal's Mate lines, Noah's Ark, Blackmar-Diemer Halosar trap.",
    multiPv: 8,
    temperature: "0.40 (Cunning)",
    evalBudget: "35-65 cp (Swindler)",
    personality: "Plays like Mikhail Tal & Hikaru Nakamura. Deliberately leaves bait squares, sets tactical ambushes, and creates chaos when behind.",
  },
];

export const HomePage: React.FC<HomePageProps> = ({
  onStartGame,
  onOpenSideDialog,
  onOpenAuth,
  onOpenHistory,
  user,
}) => {
  return (
    <div className="relative min-h-[calc(100vh-4rem)] w-full overflow-hidden bg-slate-950 text-slate-100">
      {/* Background Glows */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-indigo-600/20 blur-[128px]" />
      <div className="pointer-events-none absolute top-1/3 -left-40 h-96 w-96 rounded-full bg-cyan-600/15 blur-[128px]" />
      <div className="pointer-events-none absolute top-2/3 -right-40 h-96 w-96 rounded-full bg-amber-600/15 blur-[128px]" />

      <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        {/* User Stats Card if logged in */}
        {user && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/40 via-slate-900/60 to-slate-950/40 p-5 shadow-xl backdrop-blur-md"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-lg font-black text-white shadow-lg shadow-indigo-600/30">
                {user.username.slice(0, 1).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-white">Welcome back, {user.username}!</h3>
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/30">
                    Online
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  {user.stats.gamesPlayed} matches recorded • Favorite style:{" "}
                  <span className="font-semibold text-amber-300 capitalize">
                    {user.stats.favoriteStyle ?? "Solid"}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-3 rounded-xl bg-slate-950/60 px-4 py-2 border border-white/5 font-mono text-xs">
                <span className="text-emerald-400">{user.stats.wins} W</span>
                <span className="text-slate-600">|</span>
                <span className="text-rose-400">{user.stats.losses} L</span>
                <span className="text-slate-600">|</span>
                <span className="text-amber-400">{user.stats.draws} D</span>
                <span className="text-slate-600">|</span>
                <span className="text-indigo-300 font-bold">{user.stats.winRate}% Win</span>
              </div>

              <button
                onClick={onOpenHistory}
                className="rounded-xl border border-indigo-500/40 bg-indigo-600/20 px-4 py-2 text-xs font-semibold text-indigo-300 transition-all hover:bg-indigo-600 hover:text-white"
              >
                Match History
              </button>
            </div>
          </motion.div>
        )}

        {/* Hero Section */}
        <section className="text-center py-8 sm:py-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-4 py-1.5 text-xs font-semibold text-indigo-300 backdrop-blur-md mb-6">
              <span>✨</span>
              <span>Next-Generation Chess Intelligence</span>
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />
            </div>

            <h1 className="mx-auto max-w-4xl bg-gradient-to-b from-white via-slate-100 to-slate-400 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent sm:text-6xl sm:leading-[1.15]">
              Chess AI with a <span className="text-indigo-400 underline decoration-indigo-500/30 decoration-wavy">Living Soul</span>.
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-base text-slate-300 sm:text-lg leading-relaxed">
              Tired of sterile, robotic engines that play the same predictable moves?
              Chessverse introduces four distinct psychological personalities: from the romantic sacrifices of Morphy to the cunning tactical swindles of Tal.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <button
                onClick={() => onStartGame()}
                className="group flex items-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-cyan-500 px-7 py-3.5 text-sm font-bold text-white shadow-xl shadow-indigo-500/25 transition-all hover:brightness-110 active:scale-95"
              >
                <span>⚔️</span>
                <span>Play Now</span>
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </button>

              <button
                onClick={onOpenSideDialog}
                className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-6 py-3.5 text-sm font-semibold text-slate-200 backdrop-blur-md transition-all hover:border-white/25 hover:bg-white/10 active:scale-95"
              >
                <span>🎭</span>
                <span>Choose AI Style & Color</span>
              </button>

              {!user && (
                <button
                  onClick={onOpenAuth}
                  className="flex items-center gap-2 rounded-2xl border border-indigo-500/30 bg-indigo-600/10 px-6 py-3.5 text-sm font-semibold text-indigo-300 backdrop-blur-md transition-all hover:bg-indigo-600/20 active:scale-95"
                >
                  <span>👤</span>
                  <span>Sign In / Free Account</span>
                </button>
              )}
            </div>
          </motion.div>
        </section>

        {/* 4 Living Personalities Grid */}
        <section className="py-12">
          <div className="flex flex-col items-center text-center mb-10">
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Meet the 4 Opponent Personalities
            </h2>
            <p className="mt-2 text-sm text-slate-400 max-w-xl">
              Each style runs through our validated 8-stage decision pipeline, calibrated evaluation budgets, and curated data-driven repertoires.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {stylesData.map((s, idx) => (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: idx * 0.1 }}
                className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b ${s.gradient} p-6 shadow-xl backdrop-blur-md transition-all hover:-translate-y-1 ${s.borderHover}`}
              >
                <div>
                  {/* Card Header */}
                  <div className="flex items-center justify-between">
                    <span className="text-3xl">{s.icon}</span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-300">
                      {s.badge}
                    </span>
                  </div>

                  <h3 className={`mt-4 text-xl font-black ${s.color}`}>
                    {s.name}
                  </h3>

                  <p className="mt-2 text-xs italic text-slate-300">
                    "{s.quote}"
                  </p>

                  <p className="mt-3 text-xs text-slate-400 leading-relaxed">
                    {s.personality}
                  </p>

                  {/* Repertoire highlight */}
                  <div className="mt-4 rounded-xl border border-white/5 bg-slate-950/60 p-3 text-[11px]">
                    <div className="font-semibold text-slate-300 mb-1">Curated Repertoire:</div>
                    <div className="text-slate-400 line-clamp-2">{s.repertoire}</div>
                  </div>

                  {/* Technical dials */}
                  <div className="mt-3 space-y-1 text-[10px] text-slate-500 font-mono">
                    <div className="flex justify-between">
                      <span>MultiPV Candidates:</span>
                      <span className="text-slate-300">{s.multiPv}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Softmax Temperature:</span>
                      <span className="text-slate-300">{s.temperature}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Eval Budget Window:</span>
                      <span className="text-slate-300">{s.evalBudget}</span>
                    </div>
                  </div>
                </div>

                {/* Direct Action Button */}
                <button
                  onClick={() => onStartGame(s.id)}
                  className={`mt-6 w-full rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs font-bold text-white transition-all group-hover:bg-indigo-600 group-hover:border-indigo-500 group-hover:shadow-lg active:scale-95`}
                >
                  Play vs {s.name} →
                </button>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Feature Highlights Grid */}
        <section className="py-12 border-t border-white/5">
          <div className="flex flex-col items-center text-center mb-10">
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Engineered for Chess Players
            </h2>
            <p className="mt-2 text-sm text-slate-400 max-w-xl">
              Production-grade architecture with zero compromises on responsiveness, tactical analysis, or reliability.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-6 backdrop-blur-md">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-2xl mb-4">
                💎
              </div>
              <h3 className="text-base font-bold text-white">Move Quality & Brilliant Sacrifices</h3>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Deep analysis categorizes every move from Brilliant to Blunder. Brilliant detector enforces strict sacrifice validation and evaluation ceilings to eliminate fake brilliant claims.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-6 backdrop-blur-md">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-2xl mb-4">
                ⚡
              </div>
              <h3 className="text-base font-bold text-white">Fluid Premoves Like Chess.com</h3>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Stack up to multiple premoves in advance with client-side optimistic execution. Automatically validates against opponents' incoming replies with zero lag.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-6 backdrop-blur-md">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20 text-2xl mb-4">
                🛡️
              </div>
              <h3 className="text-base font-bold text-white">Resilient Write-Behind Persistence</h3>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Zero crash risk. If Postgres or Redis fluctuates, games automatically persist in memory with write-behind queues and exponential retry backoff.
              </p>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-16 border-t border-white/10 py-8 text-center text-xs text-slate-500">
          <p>© 2026 Chessverse. Powered by Stockfish 17, Fastify, React 19, and Drizzle ORM.</p>
        </footer>
      </div>
    </div>
  );
};
