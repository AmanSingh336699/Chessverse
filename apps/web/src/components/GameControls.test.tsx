import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GameControls } from "../components/GameControls";

describe("GameControls", () => {
  it("disables undo when not allowed", () => {
    render(
      <GameControls
        difficulty="advanced"
        playerColor="white"
        onNewGame={vi.fn()}
        onFlipBoard={vi.fn()}
        onResign={vi.fn()}
        onUndo={vi.fn()}
        canUndo={false}
        canFlipBoard={true}
        undoHint="Undo last move"
        undoPulseVisible={false}
        premoveStatusText={null}
        disabled={false}
      />,
    );

    expect(screen.getByRole("button", { name: /undo move/i })).toBeDisabled();
  });

  it("renders current side summary instead of inline side buttons", () => {
    render(
      <GameControls
        difficulty="advanced"
        playerColor="black"
        onNewGame={vi.fn()}
        onFlipBoard={vi.fn()}
        onResign={vi.fn()}
        onUndo={vi.fn()}
        canUndo={true}
        canFlipBoard={true}
        undoHint="Undo last move"
        undoPulseVisible={false}
        premoveStatusText={null}
        disabled={false}
      />,
    );

    expect(screen.getByText(/you command black/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /play white/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /play black/i })).not.toBeInTheDocument();
  });

  it("shows premove lane copy when a premove is queued", () => {
    render(
      <GameControls
        difficulty="advanced"
        playerColor="white"
        onNewGame={vi.fn()}
        onFlipBoard={vi.fn()}
        onResign={vi.fn()}
        onUndo={vi.fn()}
        canUndo={true}
        canFlipBoard={false}
        undoHint="Undo last move"
        undoPulseVisible={true}
        premoveStatusText="Premove queued - Knight to f6"
        disabled={false}
      />,
    );

    expect(screen.getByText(/premove queued - knight to f6/i)).toBeInTheDocument();
  });
});
