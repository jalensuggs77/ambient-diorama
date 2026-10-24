// 程序化白噪音引擎：全部声音用 Web Audio 实时合成，不依赖任何音频文件。
// 每条音轨都挂在一个 PannerNode 上，位置对应场景里的物体，听者跟随相机，
// 所以壁炉在左、猫在右，转动视角时立体声像会随之改变。

const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function makeNoiseBuffers(ctx, seconds = 6) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const make = (fill) => {
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) fill(buf.getChannelData(ch));
    // 首尾交叉淡化，循环时不出现“咔哒”声
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < fade; i++) {
        const k = i / fade;
        d[i] = d[i] * k + d[len - fade + i] * (1 - k);
      }
    }
    return buf;
  };
  const white = make((d) => {
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  });
  const pink = make((d) => {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  });
  const brown = make((d) => {
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  });
  return { white, pink, brown };
}

function makeImpulse(ctx, seconds = 1.8, decay = 3) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

class Track {
  constructor(engine, id, { gain = 1, wet = 0.2, refDistance = 1.5 } = {}) {
    this.e = engine;
    this.ctx = engine.ctx;
    this.id = id;
    this.enabled = false;
    this.volume = 0.7;
    this.trim = gain;
    const ctx = this.ctx;
    this.input = ctx.createGain();
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.panner = new PannerNode(ctx, {
      panningModel: 'equalpower',
      distanceModel: 'inverse',
      refDistance,
      maxDistance: 30,
      rolloffFactor: 0.8,
    });
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.levelData = new Float32Array(this.analyser.fftSize);
    this.wet = ctx.createGain();
    this.wet.gain.value = wet;
    this.input.connect(this.out);
    this.out.connect(this.panner);
    this.out.connect(this.analyser);
    this.panner.connect(engine.master);
    this.panner.connect(this.wet);
    this.wet.connect(engine.reverb);
  }

  get now() {
    return this.ctx.currentTime;
  }

  /** 是否需要继续调度离散事件（开启或正在淡出时） */
  get audible() {
    return this.enabled || this.now < this.fadeUntil;
  }

  loop(buffer) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.start(this.now, Math.random() * buffer.duration);
    return src;
  }

  biquad(type, frequency, Q = 0.7) {
    return new BiquadFilterNode(this.ctx, { type, frequency, Q });
  }

  gainNode(v = 1) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  applyGain(fade = 1.2) {
    const target = this.enabled ? this.volume * this.trim : 0;
    const g = this.out.gain;
    g.cancelScheduledValues(this.now);
    g.setValueAtTime(g.value, this.now);
    g.setTargetAtTime(target, this.now, fade / 3);
    if (!this.enabled) this.fadeUntil = this.now + fade * 1.5;
  }

  setEnabled(on) {
    this.enabled = on;
    this.applyGain(on ? 1.5 : 1.0);
  }

  setVolume(v) {
    this.volume = v;
    this.applyGain(0.15);
  }

  setPosition(p) {
    this.panner.positionX.value = p.x;
    this.panner.positionY.value = p.y;
    this.panner.positionZ.value = p.z;
  }

  level() {
    this.analyser.getFloatTimeDomainData(this.levelData);
    let s = 0;
    for (let i = 0; i < this.levelData.length; i++) s += this.levelData[i] * this.levelData[i];
    return Math.sqrt(s / this.levelData.length);
  }

  /** 一次性噪声片段 */
  burst(when, { buffer, filter, freq, Q = 1, amp = 0.3, attack = 0.001, decay = 0.05, pan = 0, dest = this.input }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer || this.e.buffers.white;
    const f = this.biquad(filter, freq, Q);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(amp, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    const p = new StereoPannerNode(ctx, { pan: clamp(pan, -1, 1) });
    src.connect(f).connect(g).connect(p).connect(dest);
    src.start(when, Math.random() * (src.buffer.duration - 1), attack + decay + 0.05);
  }

  tick() {}
}

// ---------------- 雨声 ----------------
class RainTrack extends Track {
  constructor(engine) {
    super(engine, 'rain', { gain: 1.1, wet: 0.08, refDistance: 4 });
    const b = engine.buffers;
    this.hiss = this.gainNode(0.4);
    this.loop(b.pink).connect(this.biquad('highpass', 450)).connect(this.biquad('lowpass', 8000)).connect(this.hiss).connect(this.input);
    this.body = this.gainNode(0.5);
    this.loop(b.brown).connect(this.biquad('lowpass', 420)).connect(this.body).connect(this.input);
    this.intensity = 0.7;
    this.nextDrop = 0;
  }

  setIntensity(v) {
    this.intensity = v;
    this.hiss.gain.setTargetAtTime(0.06 + 0.5 * v, this.now, 0.4);
    this.body.gain.setTargetAtTime(0.1 + 0.6 * v, this.now, 0.4);
  }

  tick(from, to) {
    if (!this.audible) {
      this.nextDrop = to;
      return;
    }
    const rate = 3 + 45 * this.intensity;
    let t = Math.max(this.nextDrop, from);
    while (t < to) {
      const r = Math.random();
      if (r < 0.75) {
        // 雨点打在玻璃上
        this.burst(t, { filter: 'bandpass', freq: rand(1800, 6500), Q: rand(1.5, 6), amp: 0.25 * Math.pow(Math.random(), 2.5) + 0.02, decay: rand(0.01, 0.04), pan: rand(-0.9, 0.9) });
      } else {
        // 落在窗台上的较大水滴，有一点音高
        this.burst(t, { filter: 'bandpass', freq: rand(700, 1600), Q: rand(8, 18), amp: rand(0.15, 0.45), decay: rand(0.04, 0.09), pan: rand(-0.7, 0.7) });
      }
      t += -Math.log(1 - Math.random()) / rate;
    }
    this.nextDrop = t;
  }

  thunder(when, strength = 1) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.e.buffers.brown;
    const lp = this.biquad('lowpass', 1600 * strength + 200, 0.8);
    lp.frequency.setValueAtTime(1400 * strength + 200, when);
    lp.frequency.exponentialRampToValueAtTime(160, when + 1.6);
    lp.frequency.exponentialRampToValueAtTime(70, when + 7);
    const g = ctx.createGain();
    const a = 1.4 * strength;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(a, when + 0.05);
    g.gain.exponentialRampToValueAtTime(a * 0.35, when + 0.7);
    g.gain.linearRampToValueAtTime(a * 0.6, when + 1.3);
    g.gain.exponentialRampToValueAtTime(a * 0.25, when + 2.6);
    g.gain.linearRampToValueAtTime(a * 0.35, when + 3.4);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 8);
    const p = new StereoPannerNode(ctx, { pan: rand(-0.6, 0.6) });
    src.connect(lp).connect(g).connect(p).connect(this.input);
    src.start(when, rand(0, 2), 8.2);
    if (strength > 0.75) {
      this.burst(when, { filter: 'highpass', freq: 1500, amp: 0.35 * strength, attack: 0.005, decay: 0.35, pan: p.pan.value });
    }
  }
}

// ---------------- 壁炉 ----------------
class FireTrack extends Track {
  constructor(engine) {
    super(engine, 'fire', { gain: 1.0, wet: 0.2 });
    const b = engine.buffers;
    this.roar = this.gainNode(0.5);
    this.loop(b.brown).connect(this.biquad('lowpass', 300)).connect(this.roar).connect(this.input);
    this.hiss = this.gainNode(0.03);
    this.loop(b.pink).connect(this.biquad('bandpass', 2600, 0.6)).connect(this.hiss).connect(this.input);
    this.roarLevel = 0.6;
    this.nextCrackle = 0;
  }

  tick(from, to) {
    this.roarLevel = clamp(this.roarLevel + rand(-0.12, 0.12), 0.3, 1);
    this.roar.gain.setTargetAtTime(0.2 + 0.55 * this.roarLevel, from, 0.25);
    this.hiss.gain.setTargetAtTime(0.015 + 0.03 * this.roarLevel, from, 0.25);
    if (!this.audible) {
      this.nextCrackle = to;
      return;
    }
    let t = Math.max(this.nextCrackle, from);
    while (t < to) {
      const big = Math.random() < 0.18;
      this.burst(t, { filter: 'highpass', freq: rand(900, 3000), amp: big ? rand(0.4, 0.8) : rand(0.08, 0.3), decay: rand(0.002, 0.014), pan: rand(-0.3, 0.3) });
      if (big) {
        // 木头爆裂：低频“啪”+ 一串细碎的噼啪声
        this.burst(t, { filter: 'bandpass', freq: rand(250, 600), Q: 2, amp: rand(0.3, 0.6), decay: rand(0.02, 0.05) });
        const n = Math.floor(rand(2, 7));
        for (let i = 0; i < n; i++) {
          this.burst(t + rand(0.01, 0.18), { filter: 'highpass', freq: rand(1500, 4500), amp: rand(0.05, 0.25), decay: rand(0.002, 0.008), pan: rand(-0.3, 0.3) });
        }
        this.e.emit('crackle', t, Math.min(8, n + 2));
      }
      t += -Math.log(1 - Math.random()) / (5 + this.roarLevel * 6);
    }
    this.nextCrackle = t;
  }
}

// ---------------- 收音机：沙沙的电台底噪 + lo-fi 和弦 ----------------
const CHORDS = [
  [53, 57, 60, 64], // Fmaj7
  [52, 55, 59, 62], // Em7
  [50, 53, 57, 60], // Dm7
  [48, 52, 55, 59], // Cmaj7
];
const MELODY = [72, 74, 76, 79, 81, 84];

class RadioTrack extends Track {
  constructor(engine) {
    super(engine, 'radio', { gain: 0.9, wet: 0.15 });
    const ctx = this.ctx;
    const b = engine.buffers;
    // 收音机频响：带通 + 轻微失真
    this.bus = this.gainNode(1);
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8);
    }
    shaper.curve = curve;
    this.bus.connect(this.biquad('highpass', 300)).connect(this.biquad('lowpass', 3400)).connect(shaper).connect(this.input);

    this.staticGain = this.gainNode(0.06);
    this.loop(b.pink).connect(this.biquad('bandpass', 2400, 0.7)).connect(this.staticGain).connect(this.input);
    const hum = new OscillatorNode(ctx, { type: 'sine', frequency: 60 });
    const humGain = this.gainNode(0.008);
    hum.connect(humGain).connect(this.bus);
    hum.start();

    // 磁带抖动
    this.wow = new OscillatorNode(ctx, { type: 'sine', frequency: 0.45 });
    this.wowDepth = this.gainNode(7);
    this.wow.connect(this.wowDepth);
    this.wow.start();

    this.bpm = 72;
    this.beat = 0;
    this.nextBeat = 0;
  }

  get beatDur() {
    return 60 / this.bpm;
  }

  tick(from, to) {
    this.staticGain.gain.setTargetAtTime(0.04 + 0.03 * Math.random(), from, 0.3);
    if (!this.audible) {
      this.nextBeat = Math.max(this.nextBeat, to);
      return;
    }
    if (this.nextBeat < from) this.nextBeat = from + 0.05;
    while (this.nextBeat < to) {
      const t = this.nextBeat;
      const b = this.beat;
      const d = this.beatDur;
      const bar = b % 8;
      if (bar === 0) {
        const chord = CHORDS[Math.floor(b / 8) % CHORDS.length];
        this.chord(t, chord, d * 8.4);
        this.bass(t, chord[0] - 12, d * 3.6);
        this.bass(t + d * 4, chord[0] - 12, d * 3.6);
      }
      if (bar % 4 === 0) this.kick(t);
      if (bar % 4 === 2) this.kick(t + d * 0.5, 0.6);
      if (bar % 2 === 1) this.burst(t, { filter: 'bandpass', freq: 2000, Q: 0.8, amp: 0.16, decay: 0.14, dest: this.bus });
      this.burst(t, { filter: 'highpass', freq: 7000, amp: 0.05, decay: 0.03, dest: this.bus });
      this.burst(t + d * 0.58, { filter: 'highpass', freq: 7000, amp: 0.03, decay: 0.03, dest: this.bus });
      if (Math.random() < 0.38) {
        const n = MELODY[Math.floor(Math.random() * MELODY.length)];
        this.keys(t + (Math.random() < 0.3 ? d * 0.5 : 0), n);
      }
      // 黑胶噼啪
      if (Math.random() < 0.7) this.burst(t + rand(0, d), { filter: 'highpass', freq: 3000, amp: rand(0.04, 0.12), decay: 0.002, dest: this.input });
      this.e.emit('beat', t, bar % 2 === 0 ? 1 : 0.5);
      this.beat++;
      this.nextBeat += d;
    }
  }

  chord(when, notes, dur) {
    const ctx = this.ctx;
    const lp = this.biquad('lowpass', 1500, 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.055, when + 0.35);
    g.gain.setTargetAtTime(0.0, when + dur - 0.9, 0.35);
    lp.connect(g).connect(this.bus);
    for (const n of notes) {
      for (const det of [-6, 6]) {
        const o = new OscillatorNode(ctx, { type: 'triangle', frequency: mtof(n), detune: det });
        this.wowDepth.connect(o.detune);
        o.connect(lp);
        o.start(when);
        o.stop(when + dur + 1);
      }
    }
  }

  bass(when, note, dur) {
    const o = new OscillatorNode(this.ctx, { type: 'sine', frequency: mtof(note) });
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.22, when + 0.02);
    g.gain.setTargetAtTime(0.0, when + dur * 0.6, dur * 0.2);
    o.connect(g).connect(this.bus);
    o.start(when);
    o.stop(when + dur + 0.5);
  }

  kick(when, amp = 1) {
    const o = new OscillatorNode(this.ctx, { type: 'sine', frequency: 120 });
    o.frequency.setValueAtTime(120, when);
    o.frequency.exponentialRampToValueAtTime(48, when + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.5 * amp, when + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.35);
    o.connect(g).connect(this.bus);
    o.start(when);
    o.stop(when + 0.4);
  }

  keys(when, note) {
    const ctx = this.ctx;
    const f = mtof(note);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.09, when + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 1.8);
    g.connect(this.bus);
    [
      [1, 1],
      [2, 0.25],
      [3.5, 0.08],
    ].forEach(([ratio, amp]) => {
      const o = new OscillatorNode(ctx, { type: 'sine', frequency: f * ratio });
      this.wowDepth.connect(o.detune);
      const pg = this.gainNode(amp);
      o.connect(pg).connect(g);
      o.start(when);
      o.stop(when + 1.9);
    });
  }
}

// ---------------- 风铃 ----------------
const CHIME_FREQS = [783.99, 880.0, 1046.5, 1174.66, 1318.51];
const CHIME_PARTIALS = [
  [1, 1, 4.0],
  [2.756, 0.45, 2.0],
  [5.404, 0.22, 1.0],
  [8.933, 0.1, 0.5],
];

class ChimeTrack extends Track {
  constructor(engine) {
    super(engine, 'chime', { gain: 0.8, wet: 0.35 });
    this.windGain = this.gainNode(0.02);
    this.loop(engine.buffers.pink).connect(this.biquad('bandpass', 520, 0.5)).connect(this.windGain).connect(this.input);
    this.gust = 0.3;
    this.nextStrike = 0;
  }

  tick(from, to) {
    const dt = to - from;
    this.gust = clamp(this.gust + rand(-1, 1) * dt * 0.9 + (0.35 - this.gust) * dt * 0.1, 0.05, 1);
    this.windGain.gain.setTargetAtTime(0.01 + 0.05 * this.gust, from, 0.4);
    if (!this.audible) {
      this.nextStrike = to;
      return;
    }
    let t = Math.max(this.nextStrike, from);
    while (t < to) {
      const i = Math.floor(Math.random() * CHIME_FREQS.length);
      const amp = rand(0.25, 1) * (0.45 + this.gust * 0.55);
      this.strike(t, i, amp);
      if (Math.random() < 0.3) this.strike(t + rand(0.08, 0.22), i, amp * 0.35);
      t += -Math.log(1 - Math.random()) / (0.25 + this.gust * 3.2);
    }
    this.nextStrike = t;
  }

  strike(when, i, amp) {
    const ctx = this.ctx;
    const f0 = CHIME_FREQS[i] * (1 + rand(-0.002, 0.002));
    const p = new StereoPannerNode(ctx, { pan: (i / (CHIME_FREQS.length - 1) - 0.5) * 0.7 });
    p.connect(this.input);
    for (const [ratio, pa, decay] of CHIME_PARTIALS) {
      const f = f0 * ratio;
      if (f > 15000) continue;
      // 两个略微失谐的正弦，制造金属管特有的“拍频”
      for (const beat of [0, 1.3]) {
        const o = new OscillatorNode(ctx, { type: 'sine', frequency: f + beat });
        const g = ctx.createGain();
        const d = decay * (1.15 - i * 0.07);
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(amp * pa * 0.07, when + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, when + d);
        o.connect(g).connect(p);
        o.start(when);
        o.stop(when + d + 0.05);
      }
    }
    this.e.emit('chime', when, i, amp);
  }
}

// ---------------- 猫咪呼噜 ----------------
class CatTrack extends Track {
  constructor(engine) {
    super(engine, 'cat', { gain: 1.3, wet: 0.1, refDistance: 1.2 });
    const ctx = this.ctx;
    const b = engine.buffers;
    this.breath = this.gainNode(0.5);
    this.am = this.gainNode(0);
    this.loop(b.brown).connect(this.biquad('lowpass', 170, 1.2)).connect(this.am);
    const rasp = this.gainNode(0.18);
    this.loop(b.pink).connect(this.biquad('bandpass', 380, 1.4)).connect(rasp).connect(this.am);
    this.am.connect(this.breath).connect(this.input);

    // 约 25Hz 的脉冲调幅就是呼噜声的“颗粒感”
    this.purrOsc = new OscillatorNode(ctx, { type: 'sine', frequency: 25 });
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.pow(Math.max(0, x), 1.6) * 1.6;
    }
    shaper.curve = curve;
    this.purrOsc.connect(shaper).connect(this.am.gain);
    this.purrOsc.start();
    const floor = new ConstantSourceNode(ctx, { offset: 0.12 });
    floor.connect(this.am.gain);
    floor.start();

    this.cycleStart = 0;
    this.cycleDur = 3;
    this.inhale = 0.45;
  }

  tick(from, to) {
    while (this.cycleStart + this.cycleDur < to) {
      const start = Math.max(this.cycleStart + this.cycleDur, from);
      const dur = rand(2.6, 3.4);
      const inhale = dur * 0.42;
      const g = this.breath.gain;
      const f = this.purrOsc.frequency;
      g.setTargetAtTime(0.32, start, 0.15);
      f.setTargetAtTime(27, start, 0.1);
      g.setTargetAtTime(0.08, start + inhale - 0.05, 0.04);
      g.setTargetAtTime(0.62, start + inhale + 0.06, 0.12);
      f.setTargetAtTime(22.5, start + inhale, 0.1);
      g.setTargetAtTime(0.15, start + dur - 0.25, 0.08);
      this.cycleStart = start;
      this.cycleDur = dur;
      this.inhale = inhale / dur;
    }
  }

  /** 0..1：猫的胸腔起伏，与呼噜声的吸气/呼气同步 */
  breathValue() {
    const p = clamp((this.now - this.cycleStart) / this.cycleDur, 0, 1);
    return p < this.inhale ? Math.sin((p / this.inhale) * Math.PI * 0.5) : Math.cos(((p - this.inhale) / (1 - this.inhale)) * Math.PI * 0.5);
  }
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.tracks = {};
    this.listeners = {};
    this.started = false;
    this.masterVolume = 0.8;
  }

  on(evt, fn) {
    (this.listeners[evt] ||= []).push(fn);
  }

  /** 在音频时间 when 触发视觉回调 */
  emit(evt, when, ...args) {
    const fns = this.listeners[evt];
    if (!fns) return;
    const delay = Math.max(0, (when - this.ctx.currentTime) * 1000);
    setTimeout(() => fns.forEach((f) => f(...args)), delay);
  }

  async start() {
    if (this.started) return;
    const ctx = new AudioContext({ latencyHint: 'playback' });
    this.ctx = ctx;
    this.buffers = makeNoiseBuffers(ctx);

    this.master = ctx.createGain();
    this.master.gain.value = this.masterVolume;
    const comp = new DynamicsCompressorNode(ctx, { threshold: -14, knee: 10, ratio: 4, attack: 0.01, release: 0.25 });
    this.master.connect(comp).connect(ctx.destination);
    this.reverb = new ConvolverNode(ctx, { buffer: makeImpulse(ctx) });
    this.reverb.connect(this.master);

    this.tracks = {
      rain: new RainTrack(this),
      fire: new FireTrack(this),
      radio: new RadioTrack(this),
      chime: new ChimeTrack(this),
      cat: new CatTrack(this),
    };

    this.scheduledUntil = ctx.currentTime;
    this.timer = setInterval(() => this.schedule(), 50);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && ctx.state === 'suspended') ctx.resume();
    });
    if (ctx.state === 'suspended') await ctx.resume();
    this.started = true;
  }

  schedule() {
    const now = this.ctx.currentTime;
    const from = Math.max(this.scheduledUntil, now);
    const to = now + 0.25;
    if (to <= from) return;
    for (const t of Object.values(this.tracks)) t.tick(from, to);
    this.scheduledUntil = to;
  }

  setEnabled(id, on) {
    this.tracks[id]?.setEnabled(on);
  }

  setVolume(id, v) {
    this.tracks[id]?.setVolume(v);
  }

  setMaster(v) {
    this.masterVolume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setRain(v) {
    this.tracks.rain?.setIntensity(v);
  }

  thunder(delay, strength) {
    const rain = this.tracks.rain;
    if (!rain || !rain.enabled) return;
    rain.thunder(this.ctx.currentTime + delay, strength);
  }

  setPositions(map) {
    for (const [id, p] of Object.entries(map)) this.tracks[id]?.setPosition(p);
  }

  updateListener(camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const e = camera.matrixWorld.elements;
    const fwd = [-e[8], -e[9], -e[10]];
    const up = [e[4], e[5], e[6]];
    if (l.positionX) {
      l.positionX.value = e[12];
      l.positionY.value = e[13];
      l.positionZ.value = e[14];
      l.forwardX.value = fwd[0];
      l.forwardY.value = fwd[1];
      l.forwardZ.value = fwd[2];
      l.upX.value = up[0];
      l.upY.value = up[1];
      l.upZ.value = up[2];
    } else {
      l.setPosition(e[12], e[13], e[14]);
      l.setOrientation(...fwd, ...up);
    }
  }

  visualState() {
    if (!this.started) return {};
    return {
      fireRoar: this.tracks.fire.roarLevel,
      gust: this.tracks.chime.gust,
      catBreath: this.tracks.cat.breathValue(),
    };
  }

  levels() {
    const out = {};
    if (!this.started) return out;
    for (const [id, t] of Object.entries(this.tracks)) out[id] = t.level();
    return out;
  }
}
