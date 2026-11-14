// Audio: WebAudio, decoded WAVs, unlocked on first user gesture (Safari requirement).
const FILES = {
  kick: 'assets/sound/kick.wav',
  whistle: 'assets/sound/whistle.wav',
  goal: 'assets/sound/goal.wav',
  bounce: 'assets/sound/bounce.wav',
  boos: 'assets/sound/boos.wav',
  crowd: 'assets/sound/crowd.wav',
  thunder1: 'assets/sound/thunder1.wav',
  thunder2: 'assets/sound/thunder2.wav',
};

class Audio {
  constructor() { this.ctx = null; this.buffers = new Map(); this.crowd = null; this.crowdGain = null; }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    for (const [k, url] of Object.entries(FILES)) {
      fetch(url).then(r => r.arrayBuffer()).then(ab => this.ctx.decodeAudioData(ab)).then(buf => this.buffers.set(k, buf)).catch(() => {});
    }
  }
  play(name, vol = 1) {
    if (!this.ctx || !this.buffers.has(name)) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.get(name);
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.ctx.destination);
    src.start();
  }
  startCrowd() {
    if (!this.ctx || this.crowd) return;
    const buf = this.buffers.get('crowd');
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const g = this.ctx.createGain(); g.gain.value = 0.25;
    src.connect(g).connect(this.ctx.destination);
    src.start();
    this.crowd = src; this.crowdGain = g;
  }
  stopCrowd() {
    if (this.crowd) { try { this.crowd.stop(); } catch (e) {} this.crowd = null; }
  }
}
export const audio = new Audio();
