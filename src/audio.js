// Ambient sound, all synthesised so the site stays a handful of static files:
// wind, the odd bleat from somewhere in the flock, the dog's bark when it is
// sent, a soft bell as each sheep goes in, and a little tune when they are all
// home. Browsers only allow sound after a gesture, so start() is called from
// the first tap, click or key.
export class Ambience {
  constructor() {
    this.ctx = null;
    let muted = false;
    try { muted = localStorage.getItem('sheep-muted') === '1'; } catch {}
    this.muted = muted;
    this.baaT = 2;
    this.bellT = 0;
    this.wind = null;
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(ctx.destination);
    this._makeWind();
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('sheep-muted', m ? '1' : '0'); } catch {}
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }
  toggleMuted() { this.setMuted(!this.muted); return this.muted; }

  _makeWind() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = 0.98 * last + 0.02 * (Math.random() * 2 - 1); d[i] = last * 6; }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(lp).connect(g).connect(this.master);
    src.start();
    this.wind = { lp, g, freq: 420, gust: 0.05, t: 0 };
  }

  _pan(node, pan) {
    const ctx = this.ctx;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(p).connect(this.master);
    } else {
      node.connect(this.master);
    }
  }

  // A bleat: a buzzy tone with vibrato through two vowel-ish resonances.
  baa(pan = 0, vol = 0.25, pitch = 260, fear = 0) {
    const ctx = this.ctx; if (!ctx) return;
    const t0 = ctx.currentTime;
    const dur = 0.45 + Math.random() * 0.25 - fear * 0.1;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(pitch * (1 + fear * 0.25), t0);
    osc.frequency.linearRampToValueAtTime(pitch * 0.9, t0 + dur);
    const vib = ctx.createOscillator();
    vib.frequency.value = 6.5 + fear * 3;
    const vibG = ctx.createGain(); vibG.gain.value = pitch * 0.045;
    vib.connect(vibG).connect(osc.frequency);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 650; f1.Q.value = 3.5;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1500; f2.Q.value = 4;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(vol, t0 + 0.06);
    env.gain.setValueAtTime(vol, t0 + dur - 0.12);
    env.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.connect(f1).connect(env);
    osc.connect(f2).connect(env);
    this._pan(env, pan);
    osc.start(t0); vib.start(t0);
    osc.stop(t0 + dur + 0.05); vib.stop(t0 + dur + 0.05);
  }

  // Two short barks.
  bark(pan = 0, vol = 0.22) {
    const ctx = this.ctx; if (!ctx) return;
    for (let k = 0; k < 2; k++) {
      const t0 = ctx.currentTime + k * 0.17;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(190, t0);
      osc.frequency.exponentialRampToValueAtTime(95, t0 + 0.12);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.2;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(vol, t0 + 0.015);
      env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
      osc.connect(bp).connect(env);
      this._pan(env, pan);
      osc.start(t0); osc.stop(t0 + 0.16);
    }
  }

  // A soft bell as a sheep goes in.
  bell(vol = 0.12) {
    const ctx = this.ctx; if (!ctx) return;
    const now = ctx.currentTime;
    if (now < this.bellT + 0.12) return;   // do not stack when several go in together
    this.bellT = now;
    for (const [freq, amp] of [[880, 1], [1318, 0.5], [1760, 0.25]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = freq * (0.98 + Math.random() * 0.04);
      const env = ctx.createGain();
      env.gain.setValueAtTime(vol * amp, now);
      env.gain.exponentialRampToValueAtTime(0.0005, now + 0.7);
      osc.connect(env).connect(this.master);
      osc.start(now); osc.stop(now + 0.75);
    }
  }

  // All home.
  win() {
    const ctx = this.ctx; if (!ctx) return;
    [523, 659, 784, 1047].forEach((f, i) => {
      const t0 = ctx.currentTime + i * 0.16;
      const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = f;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(0.16, t0 + 0.03);
      env.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.9);
      osc.connect(env).connect(this.master);
      osc.start(t0); osc.stop(t0 + 1);
    });
  }

  // Wind that gusts, and a bleat now and then from a sheep near the camera.
  update(dt, flock, focus) {
    const ctx = this.ctx; if (!ctx || this.muted) return;
    const w = this.wind;
    if (w) {
      w.t += dt;
      const gust = 0.5 + 0.5 * Math.sin(w.t * 0.23) * Math.sin(w.t * 0.071 + 1.3);
      w.freq += (300 + 500 * gust - w.freq) * Math.min(1, dt * 0.6);
      w.lp.frequency.setTargetAtTime(w.freq, ctx.currentTime, 0.2);
      w.g.gain.setTargetAtTime(0.03 + 0.06 * gust, ctx.currentTime, 0.3);
    }
    this.baaT -= dt;
    if (this.baaT <= 0 && flock) {
      const S = flock.sheep;
      const s = S[Math.floor(Math.random() * S.length)];
      const dx = s.x - focus.x, dz = s.z - focus.z;
      const dist = Math.hypot(dx, dz);
      let meanFear = 0; for (const q of S) meanFear += q.fear; meanFear /= S.length;
      if (dist < 90) {
        const vol = 0.28 * Math.max(0.15, 1 - dist / 90) * (s.penned ? 0.6 : 1);
        this.baa(dx / 35, vol, s.isBlack ? 200 : 240 + s.tint * 70, s.fear);
      }
      this.baaT = (1.2 + Math.random() * 4.5) * (1 - 0.6 * meanFear);
    }
  }
}
