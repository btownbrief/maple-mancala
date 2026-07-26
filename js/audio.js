// MAPLE MANCALA — procedural Web Audio sound effects. No external assets.

const LS_MUTE = 'maple-mancala.muted';

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = localStorage.getItem(LS_MUTE) === '1';
  }

  // Must be called from a user gesture at least once.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem(LS_MUTE, this.muted ? '1' : '0');
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.8;
    return this.muted;
  }

  tone(freq, { type = 'triangle', at = 0, dur = 0.12, vol = 0.5, glide = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + at;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glide) osc.frequency.exponentialRampToValueAtTime(freq + glide, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // One candy drop landing in a pit — pitch climbs as the sow goes on,
  // which is most of the game feel.
  plink(step) {
    this.tone(340 + Math.min(step, 14) * 45 + Math.random() * 18, { dur: 0.09, vol: 0.4 });
  }

  // A drop landing in a store: deeper, woodier.
  thunk() {
    this.tone(180, { type: 'sine', dur: 0.18, vol: 0.6, glide: -60 });
    this.tone(340, { dur: 0.08, vol: 0.25 });
  }

  capture() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, { at: i * 0.06, dur: 0.14, vol: 0.4 }));
  }

  extraTurn() {
    this.tone(660, { dur: 0.1, vol: 0.4 });
    this.tone(880, { at: 0.09, dur: 0.16, vol: 0.4 });
  }

  win() {
    [392, 523, 659, 784].forEach((f, i) => this.tone(f, { at: i * 0.13, dur: 0.3, vol: 0.5 }));
  }

  lose() {
    [330, 262, 196].forEach((f, i) => this.tone(f, { at: i * 0.16, dur: 0.28, vol: 0.4, type: 'sine' }));
  }
}

export const sound = new SoundEngine();
