import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { MoveHistoryEntry, PlayerColor, GameStatus } from "../contracts";

interface EffectsLayerProps {
  lastMove: MoveHistoryEntry | null;
  status: GameStatus;
  orientation: PlayerColor;
  boardWidth: number;
  onShake: () => void;
}

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

export const EffectsLayer = ({
  lastMove,
  status,
  orientation,
  boardWidth,
  onShake,
}: EffectsLayerProps) => {
  const squareSize = boardWidth / 8;
  const [activeEffect, setActiveEffect] = useState<{
    id: string;
    type: "queen-capture" | "checkmate";
    square: string;
    x: number;
    y: number;
    size: number;
  } | null>(null);

  useEffect(() => {
    if (!lastMove || !boardWidth) return;

    const isCheckmate = status === "checkmate";
    
    if (isCheckmate && lastMove.moveNotation.includes("#")) {
      const targetSquare = lastMove.moveUci?.slice(2, 4);
      if (!targetSquare || targetSquare.length < 2) return;

      const fileLetter = targetSquare[0];
      const rankDigit = targetSquare[1];
      if (!fileLetter || !rankDigit) return;

      const fileIndex = FILES.indexOf(fileLetter);
      const rankIndex = parseInt(rankDigit) - 1;

      let col = fileIndex;
      let row = 7 - rankIndex;

      if (orientation === "black") {
        col = 7 - fileIndex;
        row = rankIndex;
      }

      const x = col * squareSize;
      const y = row * squareSize;

      setActiveEffect({
        id: `${lastMove.timestamp}-${targetSquare}-mate`,
        type: "checkmate",
        square: targetSquare,
        x,
        y,
        size: squareSize,
      });
    }
  }, [lastMove, status, orientation, boardWidth, onShake]);

  return (
    <div 
      className="absolute inset-0 pointer-events-none z-30"
      style={{ width: boardWidth, height: boardWidth }}
    >
      <AnimatePresence>
        {activeEffect?.type === "checkmate" && (
           <CheckmateEffect key={activeEffect.id} data={activeEffect} />
        )}
      </AnimatePresence>
    </div>
  );
};

const CheckmateEffect = ({ data }: { data: any }) => {
   return (
    <div 
      className="absolute" 
      style={{ left: data.x, top: data.y, width: data.size, height: data.size }}
    >
       {/* Cinematic Golden Aura */}
       <motion.div
        className="absolute inset-[-150%] rounded-full bg-[radial-gradient(circle,rgba(251,191,36,0.15),transparent_70%)]"
        animate={{ 
          scale: [1, 1.2, 1],
          opacity: [0.5, 0.8, 0.5]
        }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Rising Golden Particles */}
      {[...Array(15)].map((_, i) => (
        <motion.div
          key={i}
          className="gold-dot"
          initial={{ 
            x: Math.random() * data.size, 
            y: data.size, 
            opacity: 0,
            scale: 0.5
          }}
          animate={{ 
            y: -data.size * 2, 
            opacity: [0, 1, 0],
            scale: [0.5, 1, 0.5],
            x: (Math.random() * data.size) + (Math.random() - 0.5) * 50
          }}
          transition={{ 
            duration: 2 + Math.random() * 2, 
            repeat: Infinity, 
            delay: Math.random() * 2,
            ease: "easeOut" 
          }}
        />
      ))}

      {/* Crown Icon Placeholder or Checkmate Text */}
       <motion.div
        className="absolute inset-0 flex items-center justify-center"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1.5, type: "spring", bounce: 0.4 }}
      >
        <span className="font-display text-2xl text-brand-100 drop-shadow-[0_0_10px_rgba(251,191,36,0.6)]">
          &dagger;
        </span>
      </motion.div>
    </div>
  );
};
