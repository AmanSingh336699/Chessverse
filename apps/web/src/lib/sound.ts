/**
 * High-fidelity Web Audio API Sound Synthesizer for Chessverse.
 * Accurately synthesizes tactile wooden piece impacts, captures,
 * checks, castling, promotion, and game alerts with zero network latency.
 */

class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted: boolean = false;
  private volume: number = 0.85;

  constructor() {
    if (typeof window !== "undefined") {
      const storedMuted = localStorage.getItem("chessverse:sound-muted");
      this.muted = storedMuted === "true";

      // Initialize on first user touch / click
      const initAudio = () => {
        this.ensureContext();
        window.removeEventListener("pointerdown", initAudio);
        window.removeEventListener("keydown", initAudio);
      };
      window.addEventListener("pointerdown", initAudio, { once: true });
      window.addEventListener("keydown", initAudio, { once: true });
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;

    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }

    if (this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume();
    }

    return this.ctx;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (typeof window !== "undefined") {
      localStorage.setItem("chessverse:sound-muted", String(muted));
    }
  }

  public toggleMute(): boolean {
    const next = !this.muted;
    this.setMuted(next);
    if (!next) {
      // Play a subtle test tap when unmuting
      this.playMove();
    }
    return next;
  }

  /**
   * Generates a short white noise burst with bandpass filtering
   * representing piece contact friction/snap.
   */
  private createNoiseTransient(
    ctx: AudioContext,
    durationSec: number,
    filterFreq: number,
    q: number,
    gainLevel: number,
    startTime: number,
  ) {
    const bufferSize = Math.floor(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp((-i / bufferSize) * 6);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(filterFreq, startTime);
    filter.Q.setValueAtTime(q, startTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainLevel * this.volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start(startTime);
    noise.stop(startTime + durationSec);
  }

  /**
   * Tactile wooden chess piece placed down cleanly on the board.
   */
  public playMove(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // 1. Initial surface contact snap (click transient)
    this.createNoiseTransient(ctx, 0.025, 2100, 2.8, 0.35, now);

    // 2. Wooden body resonance (warm weighted piece thud)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "triangle";
    osc1.frequency.setValueAtTime(320, now);
    osc1.frequency.exponentialRampToValueAtTime(140, now + 0.055);

    gain1.gain.setValueAtTime(0.4 * this.volume, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.06);

    // 3. Sub-thud for piece weight
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(180, now);
    osc2.frequency.exponentialRampToValueAtTime(80, now + 0.045);

    gain2.gain.setValueAtTime(0.3 * this.volume, now);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now);
    osc2.stop(now + 0.05);
  }

  /**
   * Satisfying capture sound: piece knocks enemy piece off the board with heavy impact.
   */
  public playCapture(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // 1. First piece collision strike
    this.createNoiseTransient(ctx, 0.03, 2600, 3.2, 0.55, now);

    const oscStrike = ctx.createOscillator();
    const gainStrike = ctx.createGain();
    oscStrike.type = "triangle";
    oscStrike.frequency.setValueAtTime(480, now);
    oscStrike.frequency.exponentialRampToValueAtTime(220, now + 0.04);
    gainStrike.gain.setValueAtTime(0.5 * this.volume, now);
    gainStrike.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

    oscStrike.connect(gainStrike);
    gainStrike.connect(ctx.destination);
    oscStrike.start(now);
    oscStrike.stop(now + 0.045);

    // 2. Board impact (15ms delayed double-tap)
    const t2 = now + 0.018;
    this.createNoiseTransient(ctx, 0.035, 1600, 2.5, 0.45, t2);

    const oscBoard = ctx.createOscillator();
    const gainBoard = ctx.createGain();
    oscBoard.type = "sine";
    oscBoard.frequency.setValueAtTime(220, t2);
    oscBoard.frequency.exponentialRampToValueAtTime(90, t2 + 0.07);
    gainBoard.gain.setValueAtTime(0.45 * this.volume, t2);
    gainBoard.gain.exponentialRampToValueAtTime(0.001, t2 + 0.08);

    oscBoard.connect(gainBoard);
    gainBoard.connect(ctx.destination);
    oscBoard.start(t2);
    oscBoard.stop(t2 + 0.08);
  }

  /**
   * Distinct warning chime + wood tap when King is placed in Check.
   */
  public playCheck(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // Tactile base tap
    this.playMove();

    // High warning chime tone
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(740, now);
    osc.frequency.exponentialRampToValueAtTime(660, now + 0.22);

    gain.gain.setValueAtTime(0.25 * this.volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  /**
   * King moves then Rook slides into place.
   */
  public playCastle(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    // King move
    this.playMove();

    // Rook move shortly after
    setTimeout(() => {
      this.playMove();
    }, 110);
  }

  /**
   * Triumphant promotion chime.
   */
  public playPromote(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    this.playMove();

    const now = ctx.currentTime;
    [
      { freq: 523.25, time: 0 },
      { freq: 659.25, time: 0.08 },
      { freq: 783.99, time: 0.16 },
    ].forEach(({ freq, time }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + time);
      gain.gain.setValueAtTime(0.22 * this.volume, now + time);
      gain.gain.exponentialRampToValueAtTime(0.001, now + time + 0.15);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + time);
      osc.stop(now + time + 0.15);
    });
  }

  /**
   * Soft ping when game session begins.
   */
  public playGameStart(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [587.33, 880]; // D5 -> A5
    notes.forEach((freq, idx) => {
      const t = now + idx * 0.09;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.18 * this.volume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  }

  /**
   * End of game fanfare or notification.
   */
  public playGameEnd(result: "win" | "loss" | "draw" = "win"): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    if (result === "win") {
      // Victory triad: C5, E5, G5, C6
      const chord = [523.25, 659.25, 783.99, 1046.5];
      chord.forEach((freq, i) => {
        const t = now + i * 0.07;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.24 * this.volume, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.4);
      });
    } else if (result === "loss") {
      // Defeat descending tone
      const chord = [440, 392, 349.23];
      chord.forEach((freq, i) => {
        const t = now + i * 0.12;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.22 * this.volume, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.35);
      });
    } else {
      // Draw gentle balance chime
      const chord = [523.25, 659.25];
      chord.forEach((freq, i) => {
        const t = now + i * 0.1;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.2 * this.volume, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.3);
      });
    }
  }

  /**
   * Premove registration click.
   */
  public playPremove(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    this.createNoiseTransient(ctx, 0.015, 2800, 3.5, 0.22, now);
  }

  /**
   * Soft muffled thud for illegal moves.
   */
  public playIllegal(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.08);

    gain.gain.setValueAtTime(0.35 * this.volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  }
}

export const soundEngine = new SoundEngine();

