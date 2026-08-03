export type AuthSoundPreference = "on" | "off" | null;

export const AUTH_SOUND_SESSION_KEY = "athens_auth_sound_v1";

export function normalizeSoundPreference(value: string | null): AuthSoundPreference {
  return value === "on" || value === "off" ? value : null;
}

export function shouldAutoEnableSound(preference: AuthSoundPreference) {
  return preference !== "off";
}

export class AuthSoundEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientNodes: OscillatorNode[] = [];
  private ambientGain: GainNode | null = null;
  private stopTimer: number | null = null;

  async enable() {
    if (typeof window === "undefined" || !("AudioContext" in window)) return false;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = 0.16;
        this.master.connect(this.context.destination);
      }
      await this.context.resume();
      this.startAmbient();
      return this.context.state === "running";
    } catch {
      return false;
    }
  }

  disable() {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 0.08);
    if (this.stopTimer !== null) window.clearTimeout(this.stopTimer);
    this.stopTimer = window.setTimeout(() => {
      this.stopAmbient();
      this.stopTimer = null;
    }, 110);
  }

  playScan() {
    this.tone(220, 0.22, 0.05, 330);
  }

  playFailure() {
    this.tone(196, 0.32, 0.055, 139);
  }

  playIgnition() {
    this.tone(440, 0.42, 0.06, 554, 0);
    this.tone(554, 0.44, 0.05, 659, 0.07);
    this.tone(659, 0.48, 0.045, 880, 0.14);
  }

  playTravel() {
    if (!this.context || !this.master || this.context.state !== "running") return;
    const now = this.context.currentTime;
    const source = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    source.type = "sawtooth";
    source.frequency.setValueAtTime(70, now);
    source.frequency.exponentialRampToValueAtTime(260, now + 0.9);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(280, now);
    filter.frequency.exponentialRampToValueAtTime(1_500, now + 0.85);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.045, now + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.02);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(now);
    source.stop(now + 1.05);
  }

  dispose() {
    if (this.stopTimer !== null) window.clearTimeout(this.stopTimer);
    this.stopTimer = null;
    this.stopAmbient();
    if (this.context) void this.context.close();
    this.context = null;
    this.master = null;
  }

  private startAmbient() {
    if (this.stopTimer !== null) {
      window.clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    if (!this.context || !this.master || this.ambientNodes.length) {
      if (this.context && this.master) {
        const now = this.context.currentTime;
        this.master.gain.cancelScheduledValues(now);
        this.master.gain.setValueAtTime(this.master.gain.value, now);
        this.master.gain.linearRampToValueAtTime(0.16, now + 0.16);
      }
      return;
    }
    const now = this.context.currentTime;
    const ambientGain = this.context.createGain();
    ambientGain.gain.value = 0.012;
    ambientGain.connect(this.master);
    this.ambientGain = ambientGain;
    for (const frequency of [110, 164.81]) {
      const oscillator = this.context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = frequency === 110 ? -4 : 5;
      oscillator.connect(ambientGain);
      oscillator.start(now);
      this.ambientNodes.push(oscillator);
    }
    this.master.gain.setValueAtTime(0, now);
    this.master.gain.linearRampToValueAtTime(0.16, now + 0.18);
  }

  private stopAmbient() {
    for (const oscillator of this.ambientNodes) {
      try {
        oscillator.stop();
      } catch {
        // Oscillator may already have stopped during teardown.
      }
    }
    this.ambientNodes = [];
    this.ambientGain?.disconnect();
    this.ambientGain = null;
  }

  private tone(
    startFrequency: number,
    duration: number,
    volume: number,
    endFrequency = startFrequency,
    delay = 0,
  ) {
    if (!this.context || !this.master || this.context.state !== "running") return;
    const now = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(startFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + Math.min(0.06, duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }
}
