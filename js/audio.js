// Every sound in the game is synthesized here with the Web Audio API (no audio files to download).
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19];

export class Sound {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.musicOn = true;
    this.playing = false;
    this.lastTick = 0;
  }

  /** Must be called from a tap/click (browsers only allow audio after a user gesture). */
  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
      this.master.connect(comp).connect(ctx.destination);

      this.sfx = ctx.createGain();
      this.sfx.gain.value = this.sfxOn ? 0.85 : 0;
      this.sfx.connect(this.master);

      this.music = ctx.createGain();
      this.music.gain.value = this.musicOn ? 0.3 : 0;
      this.musicLP = ctx.createBiquadFilter();
      this.musicLP.type = 'lowpass';
      this.musicLP.frequency.value = 18000;
      this.music.connect(this.musicLP).connect(this.master);

      this.verb = ctx.createConvolver();
      this.verb.buffer = this.impulse(2.6, 2.4);
      this.verbIn = ctx.createGain();
      this.verbIn.gain.value = 0.55;
      this.verbIn.connect(this.verb).connect(this.master);

      this.delay = ctx.createDelay(1.5);
      this.delay.delayTime.value = (60 / 96) * 0.75;
      const fb = ctx.createGain(); fb.gain.value = 0.36;
      const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2800;
      this.delay.connect(dlp); dlp.connect(fb); fb.connect(this.delay); dlp.connect(this.master);
      this.delayIn = ctx.createGain(); this.delayIn.gain.value = 0.35;
      this.delayIn.connect(this.delay);

      this.noiseBuf = this.noiseBuffer(2);
      // Whenever audio comes back (after a resume), pick the music up from "now" instead of
      // firing a pile of notes that were due while it was paused.
      ctx.onstatechange = () => { if (ctx.state === 'running') this.realign(); };
    }
    if (this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {});
      // iPad/iPhone: starting a silent sound inside the tap is what makes the unlock stick.
      const src = this.ctx.createBufferSource();
      src.buffer = this.ctx.createBuffer(1, 1, 22050);
      src.connect(this.ctx.destination);
      src.start(0);
    }
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
  /** Try to resume without a tap (works on desktop; iPad may refuse, and then the next tap resumes it). */
  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); }
  realign() { if (this.playing && this.nextT < this.now) this.nextT = this.now + 0.05; }

  setSfx(on) { this.sfxOn = on; if (this.sfx) this.sfx.gain.setTargetAtTime(on ? 0.85 : 0, this.ctx.currentTime, 0.05); }
  setMusic(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    this.music.gain.setTargetAtTime(on ? 0.3 : 0, this.ctx.currentTime, 0.2);
    if (on) this.startMusic();
  }

  impulse(sec, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }
  noiseBuffer(sec) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  get now() { return this.ctx.currentTime; }
  get ok() { return !!this.ctx && this.ctx.state === 'running'; }

  // ------------------------------------------------------------ building blocks
  env(gainNode, t, a, dur, g, r) {
    const p = gainNode.gain;
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(g, t + a);
    const hold = Math.max(t + a, t + dur - r);
    p.setValueAtTime(g, hold);
    p.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, a + 0.02));
  }

  tone({ type = 'sine', f = 440, f2 = 0, t = this.now, dur = 0.2, a = 0.004, r = 0.12, g = 0.2, out, verb = 0, delay = 0, detune = 0, lp = 0, lp2 = 0, q = 0.8, glide }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + (glide || dur));
    o.detune.value = detune;
    let node = o;
    if (lp) {
      const bq = ctx.createBiquadFilter();
      bq.type = 'lowpass'; bq.Q.value = q;
      bq.frequency.setValueAtTime(lp, t);
      if (lp2) bq.frequency.exponentialRampToValueAtTime(lp2, t + dur);
      node.connect(bq); node = bq;
    }
    const v = ctx.createGain();
    this.env(v, t, a, dur, g, r);
    node.connect(v);
    v.connect(out || this.sfx);
    if (verb) { const s = ctx.createGain(); s.gain.value = verb; v.connect(s); s.connect(this.verbIn); }
    if (delay) { const s = ctx.createGain(); s.gain.value = delay; v.connect(s); s.connect(this.delayIn); }
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  noise({ t = this.now, dur = 0.1, g = 0.2, type = 'bandpass', f = 1000, f2 = 0, q = 1, a = 0.002, r = 0.08, out, verb = 0 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const bq = ctx.createBiquadFilter();
    bq.type = type; bq.Q.value = q;
    bq.frequency.setValueAtTime(f, t);
    if (f2) bq.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const v = ctx.createGain();
    this.env(v, t, a, dur, g, r);
    src.connect(bq).connect(v).connect(out || this.sfx);
    if (verb) { const s = ctx.createGain(); s.gain.value = verb; v.connect(s); s.connect(this.verbIn); }
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------ game sounds
  key(i) {
    if (!this.ok) return;
    const f = mtof(72 + PENTA[i % 7]);
    this.tone({ type: 'square', f, f2: f * 1.01, dur: 0.07, g: 0.07, lp: 3200 });
    this.tone({ type: 'sine', f: f * 2, dur: 0.05, g: 0.05 });
  }
  del() { if (!this.ok) return; this.tone({ type: 'triangle', f: 520, f2: 260, dur: 0.09, g: 0.12 }); }
  select() { if (!this.ok) return; this.tone({ type: 'sine', f: 1400, f2: 1800, dur: 0.05, g: 0.07 }); }
  ui() { if (!this.ok) return; this.tone({ type: 'triangle', f: 880, f2: 1320, dur: 0.06, g: 0.08 }); }
  /** The lever unlocks: a quick rising two-note chime. */
  leverReady() {
    if (!this.ok) return;
    const t = this.now;
    this.tone({ type: 'triangle', f: 1047, t, dur: 0.07, g: 0.07 });
    this.tone({ type: 'triangle', f: 1568, t: t + 0.07, dur: 0.18, g: 0.07, r: 0.16, verb: 0.2 });
  }
  whoosh() { if (!this.ok) return; this.noise({ dur: 0.32, g: 0.12, f: 400, f2: 3800, q: 1.2, a: 0.08, r: 0.2 }); }

  lever() {
    if (!this.ok) return;
    const t = this.now;
    for (let i = 0; i < 6; i++) this.noise({ t: t + i * 0.035, dur: 0.025, g: 0.22, f: 2600 - i * 180, q: 6 });
    this.tone({ type: 'sine', f: 130, f2: 48, t: t + 0.22, dur: 0.25, g: 0.6, r: 0.2 });
    this.noise({ t: t + 0.22, dur: 0.12, g: 0.3, type: 'lowpass', f: 900, q: 0.7 });
  }

  /** Whirring reels while they spin. Returns a function that stops it. */
  spinLoop() {
    if (!this.ok) return () => {};
    const ctx = this.ctx, t = this.now;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 2.5;
    const g = ctx.createGain(); g.gain.value = 0;
    const am = ctx.createGain(); am.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 26; lfo.type = 'square';
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.5;
    lfo.connect(lfoG).connect(am.gain);
    src.connect(bp).connect(am).connect(g).connect(this.sfx);
    const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 62;
    const humLP = ctx.createBiquadFilter(); humLP.type = 'lowpass'; humLP.frequency.value = 380;
    const humG = ctx.createGain(); humG.gain.value = 0;
    hum.connect(humLP).connect(humG).connect(this.sfx);
    g.gain.linearRampToValueAtTime(0.16, t + 0.15);
    humG.gain.linearRampToValueAtTime(0.07, t + 0.2);
    src.start(t); lfo.start(t); hum.start(t);
    this.musicLP.frequency.setTargetAtTime(700, t, 0.15);
    const stop = () => {
      const n = this.now;
      g.gain.cancelScheduledValues(n); humG.gain.cancelScheduledValues(n);
      g.gain.setTargetAtTime(0, n, 0.06); humG.gain.setTargetAtTime(0, n, 0.06);
      src.stop(n + 0.5); lfo.stop(n + 0.5); hum.stop(n + 0.5);
      this.musicLP.frequency.setTargetAtTime(18000, n + 0.2, 0.4);
    };
    stop.level = (x) => { // 0..1 fraction of reels still spinning
      const n = this.now;
      g.gain.setTargetAtTime(0.16 * x, n, 0.05);
      humG.gain.setTargetAtTime(0.07 * x, n, 0.05);
      lfo.frequency.setTargetAtTime(14 + 14 * x, n, 0.05);
    };
    return stop;
  }

  tick(i, speed) {
    if (!this.ok) return;
    const n = this.now;
    if (n - this.lastTick < 0.028) return;
    this.lastTick = n;
    this.tone({ type: 'square', f: 1900 + i * 110, dur: 0.018, g: Math.min(0.07, 0.25 / Math.max(speed, 3)), a: 0.001, r: 0.012, lp: 5000 });
  }

  land(result, i) {
    if (!this.ok) return;
    const t = this.now;
    this.tone({ type: 'sine', f: 150, f2: 55, t, dur: 0.14, g: 0.45, r: 0.1 });
    this.noise({ t, dur: 0.04, g: 0.18, f: 3000, q: 2 });
    if (result === 'hit') {
      const f = mtof(84 + PENTA[i % PENTA.length]);
      this.tone({ type: 'sine', f, t: t + 0.01, dur: 0.9, g: 0.16, r: 0.8, verb: 0.5, delay: 0.25 });
      this.tone({ type: 'sine', f: f * 2.005, t: t + 0.01, dur: 0.5, g: 0.06, r: 0.45, verb: 0.4 });
      this.tone({ type: 'triangle', f: f * 0.5, t: t + 0.01, dur: 0.4, g: 0.08, r: 0.35 });
      this.noise({ t: t + 0.02, dur: 0.25, g: 0.05, type: 'highpass', f: 7000, r: 0.2 });
    } else if (result === 'near') {
      const f = mtof(72 + PENTA[i % PENTA.length]);
      this.tone({ type: 'triangle', f, t: t + 0.01, dur: 0.6, g: 0.14, r: 0.5, verb: 0.4, delay: 0.15 });
      this.tone({ type: 'sine', f: f * 1.5, t: t + 0.01, dur: 0.35, g: 0.05, r: 0.3 });
    } else {
      this.tone({ type: 'sawtooth', f: 98, f2: 82, t: t + 0.01, dur: 0.2, g: 0.11, lp: 700, r: 0.12 });
    }
  }

  invalid() {
    if (!this.ok) return;
    const t = this.now;
    this.tone({ type: 'square', f: 220, t, dur: 0.13, g: 0.12, lp: 1400 });
    this.tone({ type: 'square', f: 165, t: t + 0.14, dur: 0.18, g: 0.12, lp: 1200 });
  }

  /** Rising tension for the last reel when everything else hit. */
  riser(dur) {
    if (!this.ok) return;
    const t = this.now;
    this.tone({ type: 'sawtooth', f: 220, f2: 880, t, dur, g: 0.06, a: 0.3, r: 0.2, lp: 1200, lp2: 6000, verb: 0.3 });
    this.noise({ t, dur, g: 0.07, f: 500, f2: 6000, q: 1.5, a: dur * 0.8, r: 0.15 });
  }

  coin(t = this.now) {
    this.tone({ type: 'square', f: 1976, t, dur: 0.07, g: 0.06, lp: 6000 });
    this.tone({ type: 'square', f: 2637, t: t + 0.07, dur: 0.3, g: 0.06, r: 0.25, lp: 6000, delay: 0.2 });
  }

  win(tier) {
    if (!this.ok) return;
    const t = this.now + 0.05;
    const notes = [60, 64, 67, 72, 76, 79, 84];
    notes.forEach((m, i) => {
      this.tone({ type: 'sawtooth', f: mtof(m), t: t + i * 0.085, dur: 0.32, g: 0.07, lp: 4000, verb: 0.35, delay: 0.3 });
      this.tone({ type: 'square', f: mtof(m + 12), t: t + i * 0.085, dur: 0.2, g: 0.03, lp: 5000 });
    });
    const st = t + notes.length * 0.085;
    [72, 76, 79, 84].forEach((m) => {
      this.tone({ type: 'sawtooth', f: mtof(m), t: st, dur: 1.6, g: 0.06, a: 0.01, r: 1.3, lp: 5000, lp2: 1200, verb: 0.6, detune: -8 });
      this.tone({ type: 'sawtooth', f: mtof(m), t: st, dur: 1.6, g: 0.06, a: 0.01, r: 1.3, lp: 5000, lp2: 1200, verb: 0.6, detune: 8 });
    });
    this.tone({ type: 'sine', f: 130, f2: 40, t: st, dur: 0.5, g: 0.5 });
    this.noise({ t: st, dur: 1.2, g: 0.1, type: 'highpass', f: 6000, r: 1.0, verb: 0.5 });
    const coins = 6 + tier * 3;
    for (let i = 0; i < coins; i++) this.coin(st + 0.15 + i * 0.11 + Math.random() * 0.04);
  }

  lose() {
    if (!this.ok) return;
    const t = this.now + 0.05;
    [[67, 66], [65, 64], [63, 62], [60, 55]].forEach(([a, b], i) => {
      const last = i === 3;
      this.tone({ type: 'sawtooth', f: mtof(a), f2: mtof(b), t: t + i * 0.42, dur: last ? 1.1 : 0.38, glide: last ? 1.0 : 0.3, g: 0.09, lp: 1600, lp2: 500, verb: 0.4, r: last ? 0.6 : 0.1 });
    });
  }

  // ------------------------------------------------------------ music
  startMusic() {
    if (!this.ctx || this.playing || !this.musicOn) return;
    this.playing = true;
    this.step = 0;
    this.bpm = 96;
    this.nextT = this.now + 0.12;
    this.timer = setInterval(() => this.schedule(), 25);
  }
  stopMusic() { clearInterval(this.timer); this.playing = false; }

  schedule() {
    if (!this.ok) return;
    const spb = 60 / this.bpm / 4;
    // If timers were held back (background tab, busy frame), skip ahead rather than cram late notes in.
    if (this.nextT < this.now - 0.2) this.nextT = this.now + 0.05;
    while (this.nextT < this.now + 0.16) {
      this.playStep(this.step, this.nextT, spb);
      this.nextT += spb;
      this.step++;
    }
  }

  playStep(s, t, spb) {
    if (!this.musicOn) return;
    const out = this.music;
    const bar = Math.floor(s / 16) % 4;
    const st = s % 16;
    const section = Math.floor(s / 64) % 4;
    const roots = [45, 41, 48, 43];               // A F C G
    const chords = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];
    const root = roots[bar];

    // bass: driving 8ths with octave jumps
    if (st % 2 === 0) {
      const m = st % 8 === 6 ? root + 12 : root;
      this.tone({ type: 'sawtooth', f: mtof(m), t, dur: spb * 1.7, g: 0.12, lp: 900, lp2: 260, q: 4, out, r: spb });
    }
    // pad
    if (st === 0) {
      for (const m of chords[bar]) {
        for (const dt of [-9, 9]) this.tone({ type: 'sawtooth', f: mtof(m), t, dur: spb * 16, a: 0.7, r: 1.2, g: 0.022, lp: 1400, out, verb: 0.5, detune: dt });
      }
    }
    // drums (from section 1)
    if (section >= 1) {
      if (st === 0 || st === 8) this.tone({ type: 'sine', f: 140, f2: 42, t, dur: 0.22, g: 0.55, out, r: 0.18 });
      if (st === 4 || st === 12) {
        this.noise({ t, dur: 0.18, g: 0.22, f: 1900, q: 0.8, out, verb: 0.9 });
        this.tone({ type: 'triangle', f: 190, f2: 120, t, dur: 0.1, g: 0.12, out });
      }
      if (st % 2 === 1 || section === 3) this.noise({ t, dur: 0.035, g: st % 4 === 2 ? 0.05 : 0.03, type: 'highpass', f: 8000, out });
    }
    // arpeggio (sections 2 and 3)
    if (section >= 2) {
      const ch = chords[bar];
      const pat = [0, 1, 2, 1, 0, 2, 1, 2];
      const m = ch[pat[st % 8]] + 12 + (st >= 8 && section === 3 ? 12 : 0);
      this.tone({ type: 'square', f: mtof(m), t, dur: spb * 0.9, g: 0.025, lp: 2600, out, delay: 0.5, r: spb * 0.6 });
    }
  }
}
