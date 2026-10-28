/**
 * Combat sounds worked out in code once, when the sound starts, as buffers the engine then plays like its recordings.
 * Testers found the lasers, the hits on vehicles and the debris thin, "like a PC speaker in 1985": a few oscillators
 * at play time. These are layers instead: noise rung through falling resonances (a laser's discharge), a saturated
 * punch for the bass (its overtones carry it on notebook speakers too), the damped modes of a thick steel plate,
 * grains of crumpling metal, and a short reverb over it all. Each kind comes in a few variants (fixed seeds); the
 * engine varies them further in pitch.
 */

export type ForgeKind = 'duesen' | 'laser' | 'laser-schwer' | 'turm' | 'turm-kurz' | 'rakete' | 'treffer' | 'truemmer' | 'ui-treffer' | 'ui-abschuss'
  | LoopKind;
/** the loops of the soundscapes: the sea washing past, wind in gusts, the wind whistling round the bridge (the rain on
 *  its windows is recorded, sound.ts) */
export type LoopKind = 'seegang' | 'boeen' | 'pfeifen';

/** the modes of a struck plate, as multiples of its lowest */
const PLATE = [1, 1.59, 2.14, 2.3, 2.65, 2.92, 3.5, 4.15];

interface Hiss {
  /** the filter: low-pass, band-pass or high-pass, sweeping from f0 to f1 (Hz) over the layer */
  mode: 'low' | 'band' | 'high'; f0: number; f1: number; q?: number;
  /** s to full; the decay's time constant (default a quarter of the layer) */
  attack?: number; tau?: number;
  brown?: boolean;
  /** 0..1: the level wanders at random, a rocket motor's rumble; `roughRate`: new levels per second (default 500) */
  rough?: number; roughRate?: number;
}

interface Grains { fmin: number; fmax: number; q: number; lenMin: number; lenMax: number; fall: number }

/** a sound being worked out: its samples, its sample rate and the variant's random numbers */
class Sketch {
  readonly x: Float32Array;
  private seed: number;

  constructor(readonly sr: number, seconds: number, seed: number) {
    this.x = new Float32Array(Math.ceil(seconds * sr));
    this.seed = seed >>> 0;
  }

  /** mulberry32 */
  rand(): number {
    let t = (this.seed = (this.seed + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  between(a: number, b: number): number { return a + (b - a) * this.rand(); }

  /** a layer is worked out on its own, brought to `amp` at its peak and added from `at` (s) */
  private add(at: number, amp: number, layer: Float32Array) {
    let peak = 0;
    for (const v of layer) peak = Math.max(peak, Math.abs(v));
    if (!peak) return;
    const k = amp / peak, o = Math.round(at * this.sr), x = this.x;
    for (let i = 0; i + o < x.length && i < layer.length; i++) x[i + o] += layer[i] * k;
  }

  /** a sine falling from f0 to f1 (Hz), dying away over `len` s; `drive` saturates it (overtones: bass a small speaker can give) */
  thump(at: number, f0: number, f1: number, len: number, amp: number, drive = 0) {
    const n = Math.ceil(len * this.sr), y = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / this.sr, f = f1 + (f0 - f1) * Math.exp(-t / (len * 0.3));
      ph += 2 * Math.PI * f / this.sr;
      const env = Math.min(1, t / 0.002) * Math.exp(-t / (len / 4));
      const s = Math.sin(ph);
      y[i] = env * (drive ? Math.tanh(s * drive) : s);
    }
    this.add(at, amp, y);
  }

  /** noise through a swept filter (a state-variable filter, stable while it sweeps) */
  hiss(at: number, len: number, amp: number, o: Hiss) {
    const n = Math.ceil(len * this.sr), y = new Float32Array(n), k = 1 / (o.q ?? 0.7);
    const attack = o.attack ?? 0.001, tau = o.tau ?? len / 4;
    let ic1 = 0, ic2 = 0, brown = 0, wander = 1, goal = 1;
    const every = o.roughRate ? Math.max(1, Math.round(this.sr / o.roughRate)) : 96, ease = o.roughRate ? Math.min(1, 2 / every) : 0.02;
    let a1 = 0, a2 = 0, a3 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / this.sr;
      let v0 = this.rand() * 2 - 1;
      if (o.brown) { brown = (brown + 0.02 * v0) / 1.02; v0 = brown * 3.5; }
      // the filter follows its sweep every 16 samples (slow against that, and the tangent is the costly part)
      if ((i & 15) === 0) {
        const g = Math.tan(Math.PI * Math.min(o.f0 * Math.pow(o.f1 / o.f0, t / len), this.sr * 0.45) / this.sr);
        a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2;
      }
      const v3 = v0 - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
      const s = o.mode === 'low' ? v2 : o.mode === 'band' ? k * v1 : v0 - k * v1 - v2;
      if (o.rough) {
        if (i % every === 0) goal = 1 - o.rough + 2 * o.rough * this.rand();
        wander += (goal - wander) * ease;
      }
      y[i] = s * Math.min(1, t / attack) * Math.exp(-Math.max(0, t - attack) / tau) * (o.rough ? wander : 1);
    }
    this.add(at, amp, y);
  }

  /** sparse clicks of bright noise (`perSecond` of them): an electric sizzle, a motor's sputter */
  crackle(at: number, len: number, perSecond: number, amp: number) {
    const n = Math.ceil(len * this.sr), y = new Float32Array(n), p = perSecond / this.sr;
    let left = 0, hp = 0, last = 0;
    for (let i = 0; i < n; i++) {
      if (left <= 0 && this.rand() < p) left = Math.floor(this.sr * this.between(0.0008, 0.003));
      const w = left-- > 0 ? this.rand() * 2 - 1 : 0;
      hp = 0.85 * (hp + w - last); last = w;
      y[i] = hp * (1 - i / n);
    }
    this.add(at, amp, y);
  }

  /** damped sines at `base` × the ratios (a struck plate or bar), the higher ones quieter by `tilt` and shorter */
  modes(at: number, base: number, ratios: number[], decay: number, amp: number, tilt = 0.75) {
    const n = Math.ceil(decay * 5 * this.sr), y = new Float32Array(n);
    ratios.forEach((r, j) => {
      const f = base * r * this.between(0.98, 1.02), a = Math.pow(tilt, j) * this.between(0.7, 1), tau = decay / (1 + 0.5 * j), ph = this.rand() * 6.28;
      for (let i = 0; i < n; i++) {
        const t = i / this.sr;
        y[i] += a * Math.min(1, t / 0.0006) * Math.exp(-t / tau) * Math.sin(ph + 2 * Math.PI * f * t);
      }
    });
    this.add(at, amp, y);
  }

  /** `count` short bursts of band-passed noise, thinning out over `len` s (`fall` > 1: crowded at the start), quieter later */
  grains(at: number, len: number, count: number, amp: number, o: Grains) {
    const y = new Float32Array(Math.ceil((len + o.lenMax) * this.sr) + 1);
    for (let c = 0; c < count; c++) {
      const when = len * Math.pow(this.rand(), o.fall), glen = this.between(o.lenMin, o.lenMax);
      const fc = o.fmin * Math.pow(o.fmax / o.fmin, this.rand()), k = 1 / o.q, g = Math.tan(Math.PI * Math.min(fc, this.sr * 0.45) / this.sr);
      const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2, level = (1 - 0.7 * when / len) * this.between(0.4, 1);
      let ic1 = 0, ic2 = 0;
      const o0 = Math.floor(when * this.sr), m = Math.ceil(glen * this.sr);
      for (let i = 0; i < m && o0 + i < y.length; i++) {
        const v3 = this.rand() * 2 - 1 - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
        ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
        y[o0 + i] += k * v1 * level * Math.min(1, i / 24) * Math.exp(-i / (m / 3));
      }
    }
    this.add(at, amp, y);
  }

  /**
   * Noise rung through a narrow band whose pitch and level wander (`rate` new goals a second, the pitch by up to
   * `spread` octaves round `f`, the level now and then down to nothing): wind whistling through a gap
   */
  whistle(len: number, f: number, q: number, amp: number, rate: number, spread: number) {
    const n = Math.ceil(len * this.sr), y = new Float32Array(n), k = 1 / q, every = Math.max(1, Math.round(this.sr / rate)), ease = 3 / every;
    let ic1 = 0, ic2 = 0, pitch = 0, pGoal = 0, level = 0, lGoal = 0, a1 = 0, a2 = 0, a3 = 0;
    for (let i = 0; i < n; i++) {
      if (i % every === 0) { pGoal = this.rand() * 2 - 1; lGoal = Math.pow(this.rand(), 2); }
      pitch += (pGoal - pitch) * ease; level += (lGoal - level) * ease;
      if ((i & 15) === 0) {
        const g = Math.tan(Math.PI * Math.min(f * Math.pow(2, spread * pitch), this.sr * 0.45) / this.sr);
        a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2;
      }
      const v3 = this.rand() * 2 - 1 - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
      y[i] = k * v1 * level;
    }
    this.add(0, amp, y);
  }

  /** everything so far rises and falls together in gusts, between 1 − `depth` and 1 + `depth` (`rate` new goals a second) */
  gusts(rate: number, depth: number) {
    const x = this.x, every = Math.max(1, Math.round(this.sr / rate)), ease = 2 / every;
    let level = 1, goal = 1;
    for (let i = 0; i < x.length; i++) {
      if (i % every === 0) goal = 1 - depth + 2 * depth * this.rand();
      level += (goal - level) * ease;
      x[i] *= level;
    }
  }

  /** soft clipping over everything so far */
  saturate(drive: number) {
    const x = this.x;
    let peak = 0;
    for (const v of x) peak = Math.max(peak, Math.abs(v));
    if (!peak) return;
    for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] / peak * drive);
  }

  /** a short reverb (Freeverb's combs and all-passes): `wet` its peak against the dry, `room` 0..1 its length */
  reverb(wet: number, room: number) {
    const x = this.x, k = this.sr / 44100, out = new Float32Array(x.length), fb = 0.7 + 0.28 * room, damp = 0.3;
    for (const len of [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]) {
      const n = Math.round(len * k), buf = new Float32Array(n);
      let i = 0, lp = 0;
      for (let s = 0; s < x.length; s++) {
        const y = buf[i];
        lp = y * (1 - damp) + lp * damp;
        buf[i] = x[s] * 0.015 + lp * fb;
        out[s] += y;
        if (++i === n) i = 0;
      }
    }
    for (const len of [556, 441, 341, 225]) {
      const n = Math.round(len * k), buf = new Float32Array(n);
      let i = 0;
      for (let s = 0; s < out.length; s++) {
        const b = buf[i], v = out[s];
        out[s] = b - v;
        buf[i] = v + b * 0.5;
        if (++i === n) i = 0;
      }
    }
    let pd = 0, pw = 0;
    for (let s = 0; s < x.length; s++) { pd = Math.max(pd, Math.abs(x[s])); pw = Math.max(pw, Math.abs(out[s])); }
    if (!pw) return;
    const g = wet * pd / pw;
    for (let s = 0; s < x.length; s++) x[s] += out[s] * g;
  }

  /** a seamless loop of `seconds`: the extra tail is faded into the start (equal power: the noise does not dip) */
  loop(seconds: number, peak = 0.95): Float32Array {
    const n = Math.round(seconds * this.sr), fade = this.x.length - n, y = this.x.slice(0, n);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      y[i] = y[i] * Math.sqrt(k) + this.x[n + i] * Math.sqrt(1 - k);
    }
    let p = 0;
    for (const v of y) p = Math.max(p, Math.abs(v));
    if (p) for (let i = 0; i < y.length; i++) y[i] *= peak / p;
    return y;
  }

  /** fade the end, then up to `peak` */
  finish(peak = 0.95): Float32Array {
    const x = this.x, fade = Math.min(x.length, Math.round(0.03 * this.sr));
    for (let i = 0; i < fade; i++) x[x.length - 1 - i] *= i / fade;
    let p = 0;
    for (const v of x) p = Math.max(p, Math.abs(v));
    if (p) for (let i = 0; i < x.length; i++) x[i] *= peak / p;
    return x;
  }
}

/** a laser's discharge: a crack, then noise rung through a resonance that falls from `top`, and one a fifth above */
function discharge(s: Sketch, at: number, top: number, bottom: number, len: number, amp: number) {
  s.hiss(at, 0.004, 0.5 * amp, { mode: 'high', f0: 3000, f1: 3000 });
  s.hiss(at + 0.002, len, 2 * amp, { mode: 'band', f0: top, f1: bottom, q: 12, attack: 0.002 });
  s.hiss(at + 0.008, len * 0.85, amp, { mode: 'band', f0: top * 1.5, f1: bottom * 1.5, q: 10, attack: 0.002 });
}

/** `loop`: a seamless loop of `seconds` (worked out a little longer, the tail faded into the start); `soft`: nothing in
 *  it above a few kHz, so it is worked out at half the sample rate (half the work) */
interface Recipe { seconds: number; variants: number; loop?: boolean; soft?: boolean; make(s: Sketch): void }

const LOOP_FADE = 0.4;

const RECIPES: Record<ForgeKind, Recipe> = {
  /**
   * The Skua's jet, as a loop the engine pitches and filters with the thrust (testers: before, it was white noise
   * through a band-pass): a turbulent roar, the jet's tearing howl in the low mids, a body under it and a flickering
   * hiss of the exhaust; the turbine's whine is added live.
   */
  duesen: { seconds: 4, variants: 1, loop: true, make(s) {
    const len = 4 + LOOP_FADE, steady = 1e9;
    s.hiss(0, len, 1, { mode: 'low', f0: 2200, f1: 2200, tau: steady, rough: 0.35, roughRate: 40 });
    s.hiss(0, len, 0.8, { mode: 'band', f0: 520, f1: 520, q: 1.4, tau: steady, rough: 0.5, roughRate: 25 });
    s.hiss(0, len, 0.9, { mode: 'low', f0: 260, f1: 260, brown: true, tau: steady, rough: 0.3, roughRate: 12 });
    s.hiss(0, len, 0.22, { mode: 'high', f0: 5000, f1: 5000, tau: steady, rough: 0.6, roughRate: 60 });
  } },
  /**
   * The sea round the ship, as a loop (before, it was only brown noise under an even, slow swell): a hissing bed, and
   * wave after wave washing past at uneven times, each at its own pitch, swelling and running out
   */
  seegang: { seconds: 16, variants: 1, loop: true, soft: true, make(s) {
    const len = 16 + LOOP_FADE;
    s.hiss(0, len, 0.3, { mode: 'band', f0: 900, f1: 900, q: 0.5, tau: 1e9, rough: 0.3, roughRate: 1.5 });
    for (let t = s.between(0, 0.8); t < len; t += s.between(1.2, 2.8)) {
      const dur = s.between(1.8, 4), f = s.between(400, 1300);
      s.hiss(t, dur, s.between(0.45, 1), { mode: 'band', f0: f * 1.5, f1: f * 0.55, q: 0.55, attack: dur * s.between(0.25, 0.45), tau: dur * 0.22, rough: 0.35, roughRate: 40 });
    }
  } },
  /** wind in gusts, as a loop: a broad roar, its bands and a buffeting rumble under it rising and falling together */
  boeen: { seconds: 12, variants: 1, loop: true, soft: true, make(s) {
    const len = 12 + LOOP_FADE, steady = 1e9;
    s.hiss(0, len, 1, { mode: 'low', f0: 1100, f1: 1100, q: 0.6, tau: steady, rough: 0.3, roughRate: 2 });
    s.hiss(0, len, 0.5, { mode: 'band', f0: 380, f1: 380, q: 1.4, tau: steady, rough: 0.5, roughRate: 1.4 });
    s.hiss(0, len, 0.22, { mode: 'high', f0: 3000, f1: 3000, tau: steady, rough: 0.6, roughRate: 0.9 });
    s.hiss(0, len, 0.9, { mode: 'low', f0: 140, f1: 140, brown: true, tau: steady, rough: 0.7, roughRate: 6 });
    s.gusts(0.5, 0.65);
  } },
  /** the wind whistling round the bridge's windows in a storm, as a loop: narrow tones that wander, come and go */
  pfeifen: { seconds: 10, variants: 1, loop: true, soft: true, make(s) {
    const len = 10 + LOOP_FADE;
    s.whistle(len, 1250, 40, 1, 0.9, 0.35);
    s.whistle(len, 1900, 50, 0.6, 1.3, 0.3);
    s.whistle(len, 640, 18, 0.5, 0.6, 0.4);
  } },
  /** the Quasar of a Skua and the Otters' laser */
  laser: { seconds: 1, variants: 3, make(s) {
    s.thump(0, s.between(180, 200), 60, 0.16, 0.9, 2.5);
    discharge(s, 0, s.between(2400, 3000), 320, 0.2, 1);
    s.saturate(1.6);
    s.crackle(0, 0.07, 400, 0.25);
    s.hiss(0.01, 0.35, 0.5, { mode: 'low', f0: 500, f1: 90, attack: 0.01, brown: true });
    s.reverb(0.15, 0.5);
  } },
  /** the heavy laser (an Otter's Avatar): deeper, longer, a rumble after it */
  'laser-schwer': { seconds: 1.4, variants: 3, make(s) {
    s.thump(0, s.between(140, 160), 42, 0.26, 1, 3);
    discharge(s, 0, s.between(1600, 1900), 200, 0.3, 1);
    s.saturate(2);
    s.crackle(0, 0.1, 500, 0.25);
    s.hiss(0.01, 0.6, 0.7, { mode: 'low', f0: 420, f1: 70, attack: 0.015, brown: true, rough: 0.5 });
    s.reverb(0.2, 0.65);
  } },
  /** the carrier's laser turret: two barrels 18 ms apart, the deepest crack, a rolling rumble */
  turm: { seconds: 1.8, variants: 3, make(s) {
    const top = s.between(1400, 1600);
    for (const [d, k] of [[0, 1], [0.018, 0.75]]) {
      s.thump(d, s.between(115, 130), 36, 0.3, k, 3);
      discharge(s, d, top * (d ? 0.94 : 1), 160, 0.32, k);
    }
    s.saturate(2.2);
    s.crackle(0, 0.12, 500, 0.25);
    s.hiss(0.02, 0.9, 0.8, { mode: 'low', f0: 380, f1: 60, attack: 0.02, brown: true, rough: 0.6, tau: 0.3 });
    s.reverb(0.22, 0.75);
  } },
  /** the turret within a burst: shorter, no rumble, so sustained fire does not grate */
  'turm-kurz': { seconds: 0.9, variants: 3, make(s) {
    const top = s.between(1400, 1600);
    for (const [d, k] of [[0, 1], [0.018, 0.7]]) {
      s.thump(d, s.between(115, 130), 40, 0.2, k, 2.5);
      discharge(s, d, top * (d ? 0.94 : 1), 180, 0.2, k);
    }
    s.saturate(1.8);
    s.reverb(0.15, 0.6);
  } },
  /** a guided missile leaves: the boom of ignition, then the motor's rough roar, duller as it goes */
  rakete: { seconds: 2.2, variants: 3, make(s) {
    s.thump(0, 110, 45, 0.25, 0.9, 3);
    s.hiss(0, 0.012, 0.8, { mode: 'high', f0: 1500, f1: 1500 });
    s.hiss(0.01, 1.6, 1, { mode: 'low', f0: 2200, f1: 500, q: 0.9, attack: 0.04, rough: 0.6, tau: 0.7 });
    s.hiss(0, 1.4, 0.9, { mode: 'low', f0: 400, f1: 120, attack: 0.03, brown: true, rough: 0.5, tau: 0.6 });
    s.hiss(0.03, 0.9, 0.45, { mode: 'band', f0: 1200, f1: 4200, q: 1.2, attack: 0.08 });
    s.crackle(0.02, 1, 120, 0.25);
    s.saturate(1.4);
    s.reverb(0.25, 0.75);
  } },
  /**
   * A shot strikes a vehicle: a deep thud with a rough body, a crack, metal tearing, the damped ring of thick armour
   * and fragments scattering (the engine lays a short recorded blast over it)
   */
  treffer: { seconds: 1.4, variants: 3, make(s) {
    s.thump(0, s.between(110, 130), 45, 0.22, 1, 3.5);
    s.hiss(0, 0.35, 1, { mode: 'low', f0: 1200, f1: 100, brown: true, rough: 0.4 });
    s.hiss(0, 0.06, 0.8, { mode: 'band', f0: 2400, f1: 900, q: 0.9, attack: 0.0005 });
    s.grains(0, 0.12, 25, 0.7, { fmin: 400, fmax: 3000, q: 2.5, lenMin: 0.005, lenMax: 0.025, fall: 1.5 });
    s.modes(0.001, s.between(110, 150), PLATE, 0.15, 0.6, 0.7);
    s.grains(0.05, 0.5, 10, 0.25, { fmin: 1500, fmax: 5000, q: 4, lenMin: 0.003, lenMax: 0.012, fall: 1.4 });
    s.saturate(2.2);
    s.reverb(0.2, 0.6);
  } },
  /** a wreck crashes down on land: a heavy thud, crumpling metal, panels clanking, pieces scattering */
  truemmer: { seconds: 2.2, variants: 3, make(s) {
    s.thump(0, 85, 32, 0.35, 1, 3);
    s.hiss(0, 0.5, 0.9, { mode: 'low', f0: 500, f1: 80, brown: true });
    s.hiss(0, 0.04, 0.6, { mode: 'band', f0: 1800, f1: 900, q: 1, attack: 0.0005 });
    s.grains(0, 0.9, 70, 0.8, { fmin: 250, fmax: 2400, q: 2.5, lenMin: 0.008, lenMax: 0.04, fall: 1.8 });
    for (let i = 0; i < 3; i++) s.modes(s.between(0, 0.35), s.between(90, 160), PLATE, s.between(0.15, 0.3), s.between(0.5, 0.7), 0.7);
    s.grains(0.35, 0.9, 14, 0.3, { fmin: 1200, fmax: 4000, q: 4, lenMin: 0.004, lenMax: 0.015, fall: 1.3 });
    s.saturate(1.5);
    s.reverb(0.22, 0.7);
  } },
  /** UI: a shot of the unit in hand struck home: a crisp tick on a short knock */
  'ui-treffer': { seconds: 0.4, variants: 2, make(s) {
    s.hiss(0, 0.012, 0.8, { mode: 'band', f0: s.between(3600, 4000), f1: 3600, q: 1.5, attack: 0.0005 });
    s.thump(0, 260, 150, 0.06, 1, 1.8);
    s.hiss(0, 0.03, 0.4, { mode: 'low', f0: 1500, f1: 300 });
    s.reverb(0.06, 0.3);
  } },
  /** UI: the target destroyed: a deep whump with a short crunch in it and a crisp double tick (nothing tuned) */
  'ui-abschuss': { seconds: 1.2, variants: 2, make(s) {
    s.thump(0, 110, 40, 0.35, 0.7, 3);
    s.hiss(0, 0.5, 0.8, { mode: 'low', f0: 1500, f1: 80, brown: true, rough: 0.3 });
    s.grains(0.01, 0.1, 12, 0.8, { fmin: 500, fmax: 2500, q: 2.5, lenMin: 0.005, lenMax: 0.02, fall: 1.5 });
    s.saturate(2);
    s.hiss(0, 0.012, 0.7, { mode: 'band', f0: 3800, f1: 3800, q: 1.5, attack: 0.0005 });
    s.hiss(0.07, 0.012, 0.6, { mode: 'band', f0: 4500, f1: 4500, q: 1.5, attack: 0.0005 });
    s.reverb(0.18, 0.6);
  } },
};

/** each kind, how many variants, how long it lasts (s), whether it is a loop, and the share of the sample rate it is worked out at */
export const FORGE_KINDS = (Object.keys(RECIPES) as ForgeKind[]).map(kind => ({ kind, variants: RECIPES[kind].variants, seconds: RECIPES[kind].seconds,
  loop: !!RECIPES[kind].loop, rate: RECIPES[kind].soft ? 0.5 : 1 }));

/** the samples of one variant at sample rate `sr` (a few ms of work each; give a soft one its share of the rate, FORGE_KINDS) */
export function forge(kind: ForgeKind, variant: number, sr: number): Float32Array {
  let seed = 7 + variant * 7919;
  for (const c of kind) seed = Math.imul(seed ^ c.charCodeAt(0), 2654435761);
  const r = RECIPES[kind], s = new Sketch(sr, r.seconds + (r.loop ? LOOP_FADE : 0), seed);
  r.make(s);
  return r.loop ? s.loop(r.seconds) : s.finish();
}
