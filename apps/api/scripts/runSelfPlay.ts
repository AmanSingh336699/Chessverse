import { runSelfPlayBenchmark } from "../src/engine/style/selfPlay.js";
import type { StyleId } from "@chessverse/contracts";

async function main() {
  console.log("=================================================");
  console.log("  Chessverse Style Engine Self-Play Runner       ");
  console.log("=================================================\n");

  const styles: StyleId[] = ["gambiteer", "aggressive", "tricky", "solid"];
  const gamesPerStyle = 25; // 25 games per style = 100 games total

  for (const style of styles) {
    console.log(`Running self-play for style: [${style.toUpperCase()}] (${gamesPerStyle} games)...`);
    const benchmark = await runSelfPlayBenchmark({
      style,
      totalGames: gamesPerStyle,
      maxPliesPerGame: 50,
    });

    console.log(`  Total Games:     ${benchmark.totalGames}`);
    console.log(`  Wins:            ${benchmark.wins}`);
    console.log(`  Losses:          ${benchmark.losses}`);
    console.log(`  Draws/Term:      ${benchmark.draws}`);
    console.log(`  Illegal Moves:   ${benchmark.illegalMovesCount}`);
    console.log(`  Gambit Rate:     ${Math.round(benchmark.gambitPlayRate * 100)}%`);
    console.log(`  Avg Plies:       ${benchmark.averagePlies}`);

    if (benchmark.illegalMovesCount > 0) {
      console.error(`FAILED: ${benchmark.illegalMovesCount} illegal moves detected for style ${style}!`);
      process.exit(1);
    }

    if (style === "gambiteer" && benchmark.gambitPlayRate < 0.6) {
      console.warn(`WARNING: Gambiteer play rate ${benchmark.gambitPlayRate} below 60% threshold`);
    }

    console.log("  Status: PASSED (0 illegal moves)\n");
  }

  console.log("All 100 self-play style matches completed with 0 illegal moves!");
}

main().catch((err) => {
  console.error("Self-play runner failed:", err);
  process.exit(1);
});
