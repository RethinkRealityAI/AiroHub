/**
 * Procedural Web Audio API Sound Effects Engine
 * Generates realistic real-time audio synthesis for aerosol spray, brush strokes,
 * authentic metal spray can ball-bearing rattle, and tactile UI feedback.
 */

class SoundEngine {
  private ctx: AudioContext | null = null;
  private sprayNode: {
    source: AudioBufferSourceNode;
    gain: GainNode;
    filter: BiquadFilterNode;
  } | null = null;
  private brushNode: {
    source: AudioBufferSourceNode;
    gain: GainNode;
    filter: BiquadFilterNode;
  } | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private isMuted: boolean = false;
  private isSprayActive: boolean = false;
  private isBrushActive: boolean = false;

  private init() {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.createNoiseBuffer();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  private createNoiseBuffer() {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 2; // 2 seconds loop
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (muted) {
      this.stopSpray();
      this.stopBrush();
    }
  }

  public getMuted() {
    return this.isMuted;
  }

  public toggleMute() {
    this.setMuted(!this.isMuted);
    return this.isMuted;
  }

  /**
   * Continuous pressurized aerosol spray hiss
   */
  public startSpray(pressure = 1.0) {
    if (this.isMuted || this.isSprayActive) return;
    this.init();
    if (!this.ctx || !this.noiseBuffer) return;

    this.isSprayActive = true;
    const now = this.ctx.currentTime;

    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(4600, now);
    filter.Q.setValueAtTime(1.1, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(
      0.35 * Math.min(Math.max(pressure, 0.2), 1.2),
      now + 0.05
    );

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    source.start(now);
    this.sprayNode = { source, gain, filter };
  }

  public updateSprayPressure(pressure: number) {
    if (!this.ctx || !this.sprayNode || this.isMuted) return;
    const now = this.ctx.currentTime;
    const targetGain = 0.35 * Math.min(Math.max(pressure, 0.2), 1.2);
    this.sprayNode.gain.gain.setTargetAtTime(targetGain, now, 0.05);
    this.sprayNode.filter.frequency.setTargetAtTime(3500 + pressure * 1500, now, 0.05);
  }

  public stopSpray() {
    if (!this.isSprayActive || !this.sprayNode || !this.ctx) return;
    const now = this.ctx.currentTime;
    const { source, gain } = this.sprayNode;
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    setTimeout(() => {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // already stopped
      }
    }, 100);
    this.sprayNode = null;
    this.isSprayActive = false;
  }

  /**
   * Wet bristle continuous brush stroke sound
   */
  public startBrush() {
    if (this.isMuted || this.isBrushActive) return;
    this.init();
    if (!this.ctx || !this.noiseBuffer) return;

    this.isBrushActive = true;
    const now = this.ctx.currentTime;

    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.Q.setValueAtTime(2.5, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.28, now + 0.06);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    source.start(now);
    this.brushNode = { source, gain, filter };
  }

  public modulateBrush(speed: number) {
    if (!this.ctx || !this.brushNode || this.isMuted) return;
    const now = this.ctx.currentTime;
    const targetFreq = 1000 + Math.min(speed * 30, 2200);
    this.brushNode.filter.frequency.setTargetAtTime(targetFreq, now, 0.03);
  }

  public stopBrush() {
    if (!this.isBrushActive || !this.brushNode || !this.ctx) return;
    const now = this.ctx.currentTime;
    const { source, gain } = this.brushNode;
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    setTimeout(() => {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // already stopped
      }
    }, 100);
    this.brushNode = null;
    this.isBrushActive = false;
  }

  /**
   * Authentic Aerosol Spray Can Metal Agitator Ball Bearing Rattle
   * Simulates the realistic physical sound of a heavy steel ball bearing clacking against
   * the interior metal walls of a tin can submerged in viscous paint liquid.
   */
  public playCanRattle() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.noiseBuffer) return;

    const now = this.ctx.currentTime;

    // A single vigorous shake generates 2-3 rapid micro impacts as the ball bounces
    const impacts = [
      { delay: 0.0, vol: 0.38, pitchMod: 1.0 },
      { delay: 0.045, vol: 0.28, pitchMod: 0.88 },
      { delay: 0.095, vol: 0.16, pitchMod: 1.12 },
    ];

    impacts.forEach(({ delay, vol, pitchMod }) => {
      const t = now + delay;
      if (!this.ctx) return;

      // 1. Metal Body Resonant Ping (Steel can resonance: ~1750Hz & ~3300Hz with rapid decay)
      const oscMetal1 = this.ctx.createOscillator();
      const oscMetal2 = this.ctx.createOscillator();
      const metalGain = this.ctx.createGain();

      oscMetal1.type = 'sine';
      oscMetal1.frequency.setValueAtTime(1750 * pitchMod, t);
      oscMetal1.frequency.exponentialRampToValueAtTime(1200 * pitchMod, t + 0.035);

      oscMetal2.type = 'sine';
      oscMetal2.frequency.setValueAtTime(3480 * pitchMod, t);
      oscMetal2.frequency.exponentialRampToValueAtTime(2100 * pitchMod, t + 0.025);

      metalGain.gain.setValueAtTime(vol * 0.9, t);
      metalGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);

      oscMetal1.connect(metalGain);
      oscMetal2.connect(metalGain);
      metalGain.connect(this.ctx.destination);

      oscMetal1.start(t);
      oscMetal2.start(t);
      oscMetal1.stop(t + 0.05);
      oscMetal2.stop(t + 0.05);

      // 2. Viscous Paint Slosh & Tin Clack (Bandpass filtered noise burst)
      const noiseSrc = this.ctx.createBufferSource();
      noiseSrc.buffer = this.noiseBuffer;

      const noiseFilter = this.ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(2200 * pitchMod, t);
      noiseFilter.Q.setValueAtTime(3.5, t);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(vol * 0.7, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);

      noiseSrc.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);

      noiseSrc.start(t);
      noiseSrc.stop(t + 0.035);
    });
  }

  /**
   * Tactile button / cap click
   */
  public playClick(pitch = 1.0) {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200 * pitch, now);
    osc.frequency.exponentialRampToValueAtTime(300 * pitch, now + 0.03);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.04);
  }

  /**
   * Clear canvas whoosh sound
   */
  public playWhoosh() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.noiseBuffer) return;

    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(400, now);
    filter.frequency.exponentialRampToValueAtTime(3000, now + 0.15);
    filter.frequency.exponentialRampToValueAtTime(200, now + 0.35);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    source.start(now);
    source.stop(now + 0.4);
  }
}

export const sounds = new SoundEngine();
