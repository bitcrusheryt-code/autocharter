// Web Audio API Synthesizer for low-latency Rhythm Game Hitsounds

class HitSoundManager {
  private ctx: AudioContext | null = null;
  private enabled: boolean = true;
  private volume: number = 0.7;

  private holdLoopOsc: OscillatorNode | null = null;
  private holdLoopGain: GainNode | null = null;
  private holdLoopFilter: BiquadFilterNode | null = null;
  private activeHoldIds: Set<string> = new Set();
  private holdSoundEnabled: boolean = true;

  constructor() {
    try {
      const savedEnabled = localStorage.getItem('rhythm_engine_hitsounds');
      this.enabled = savedEnabled !== 'false'; // Enabled by default
      const savedHold = localStorage.getItem('rhythm_engine_hold_sound');
      this.holdSoundEnabled = savedHold !== 'false'; // Enabled by default
      const savedVol = localStorage.getItem('rhythm_engine_hitsound_vol');
      if (savedVol) this.volume = Math.max(0, Math.min(2.0, parseFloat(savedVol)));
    } catch {
      this.enabled = true;
      this.holdSoundEnabled = true;
    }
  }

  public setHoldSoundEnabled(val: boolean) {
    this.holdSoundEnabled = val;
    try {
      localStorage.setItem('rhythm_engine_hold_sound', val ? 'true' : 'false');
    } catch {}
    if (!val) {
      this.stopAllHoldSounds();
    }
  }

  public isHoldSoundEnabled(): boolean {
    return this.holdSoundEnabled;
  }

  public setEnabled(val: boolean) {
    this.enabled = val;
    try {
      localStorage.setItem('rhythm_engine_hitsounds', val ? 'true' : 'false');
    } catch {}
    if (!val) {
      this.stopAllHoldSounds();
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(2.0, vol));
    try {
      localStorage.setItem('rhythm_engine_hitsound_vol', this.volume.toString());
    } catch {}
  }

  public getVolume(): number {
    return this.volume;
  }

  private initCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public playHitSound(mode: string = '4', lane: number = 0) {
    if (!this.enabled || this.volume <= 0) return;

    try {
      this.initCtx();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const masterGain = this.ctx.createGain();
      masterGain.gain.setValueAtTime(this.volume * 0.8, now);
      masterGain.connect(this.ctx.destination);

      if (mode === 'taiko') {
        if (lane === 0) {
          // DON - Low Punchy Drum Beat
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(190, now);
          osc.frequency.exponentialRampToValueAtTime(35, now + 0.08);

          gain.gain.setValueAtTime(1.0, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

          osc.connect(gain);
          gain.connect(masterGain);
          osc.start(now);
          osc.stop(now + 0.08);
        } else {
          // KAT - Crisp High Rim Click
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(850, now);
          osc.frequency.exponentialRampToValueAtTime(250, now + 0.05);

          gain.gain.setValueAtTime(1.0, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

          osc.connect(gain);
          gain.connect(masterGain);
          osc.start(now);
          osc.stop(now + 0.05);
        }
      } else {
        // Standard Hitsound / Key Click (Crisp woodblock / tick sound)
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1400, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.045);

        gain.gain.setValueAtTime(0.85, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.045);
      }
    } catch {
      // AudioContext play fallback
    }
  }

  // Smooth, non-intrusive harmonic hum / laser sustain loop for hold notes
  public startHoldSound(id: string = 'default') {
    if (!this.enabled || !this.holdSoundEnabled || this.volume <= 0) return;

    this.activeHoldIds.add(id);

    if (this.holdLoopOsc) {
      // Already actively humming; ramp volume slightly if multiple holds
      if (this.ctx && this.holdLoopGain) {
        const now = this.ctx.currentTime;
        const targetVol = Math.min(0.22, 0.12 + (this.activeHoldIds.size - 1) * 0.04) * this.volume;
        this.holdLoopGain.gain.cancelScheduledValues(now);
        this.holdLoopGain.gain.linearRampToValueAtTime(targetVol, now + 0.05);
      }
      return;
    }

    try {
      this.initCtx();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      // Soft warm triangle/sine wave with subtle lowpass filter
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now); // Warm A4 pitch

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(700, now);
      filter.Q.setValueAtTime(1.5, now);

      // Smooth fade-in attack to avoid any clicks
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.14 * this.volume, now + 0.04);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);

      this.holdLoopOsc = osc;
      this.holdLoopGain = gain;
      this.holdLoopFilter = filter;
    } catch {
      // Ignore
    }
  }

  public stopHoldSound(id?: string) {
    if (id) {
      this.activeHoldIds.delete(id);
    } else {
      this.activeHoldIds.clear();
    }

    if (this.activeHoldIds.size > 0) {
      // Still other hold notes being pressed
      if (this.ctx && this.holdLoopGain) {
        const now = this.ctx.currentTime;
        const targetVol = Math.min(0.22, 0.12 + (this.activeHoldIds.size - 1) * 0.04) * this.volume;
        this.holdLoopGain.gain.cancelScheduledValues(now);
        this.holdLoopGain.gain.linearRampToValueAtTime(targetVol, now + 0.05);
      }
      return;
    }

    this.stopAllHoldSounds();
  }

  public stopAllHoldSounds() {
    this.activeHoldIds.clear();

    if (!this.holdLoopGain || !this.holdLoopOsc || !this.ctx) {
      this.holdLoopOsc = null;
      this.holdLoopGain = null;
      this.holdLoopFilter = null;
      return;
    }

    try {
      const now = this.ctx.currentTime;
      const osc = this.holdLoopOsc;
      const gain = this.holdLoopGain;

      this.holdLoopOsc = null;
      this.holdLoopGain = null;
      this.holdLoopFilter = null;

      // Smooth release fade-out
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0.0001, now + 0.05);

      setTimeout(() => {
        try {
          osc.stop();
          osc.disconnect();
          gain.disconnect();
        } catch {}
      }, 60);
    } catch {
      this.holdLoopOsc = null;
      this.holdLoopGain = null;
      this.holdLoopFilter = null;
    }
  }

  // Helper for testing hold sound in settings
  public playTestHoldSound() {
    this.startHoldSound('test_preview');
    setTimeout(() => {
      this.stopHoldSound('test_preview');
    }, 600);
  }
}

export const hitSoundManager = new HitSoundManager();
