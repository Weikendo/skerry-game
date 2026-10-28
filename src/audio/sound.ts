import * as THREE from 'three';
import { FORGE_KINDS, forge, type ForgeKind, type LoopKind } from './forge';

/** Mixer channels, 0..1 (music: the title music, see music.ts; voice: the ship computer, see voice.ts) */
export interface SoundLevels { master: number; effects: number; ambience: number; engines: number; music: number; voice: number }

interface Engine { gain: GainNode; panner: PannerNode | null; nodes: AudioNode[]; set(v: Record<string, number>): void }

const MAX_VOICES = 40;
/** the ship computer's voice over the mix (its recordings are levelled to −20 LUFS) */
const SPEECH_GAIN = 1.25;
/** while it speaks, effects and engines step back to this share, sea and weather to the other (out in a storm the
 *  voice was hardly above the wind) */
const SPEECH_DUCK = 0.55;
const SPEECH_DUCK_AMB = 0.6;

/** the recorded sounds (CC0, see src/assets/sfx/QUELLEN.md), grouped by name without the number: 'explosion-nah' … */
const SAMPLE_URLS = [
  new URL('../assets/sfx/boden-1.ogg', import.meta.url).href,
  new URL('../assets/sfx/boden-2.ogg', import.meta.url).href,
  new URL('../assets/sfx/boden-3.ogg', import.meta.url).href,
  new URL('../assets/sfx/explosion-fern-1.ogg', import.meta.url).href,
  new URL('../assets/sfx/explosion-fern-2.ogg', import.meta.url).href,
  new URL('../assets/sfx/explosion-nah-1.ogg', import.meta.url).href,
  new URL('../assets/sfx/explosion-nah-2.ogg', import.meta.url).href,
  new URL('../assets/sfx/feuer-schleife.ogg', import.meta.url).href,
  new URL('../assets/sfx/nachrollen.ogg', import.meta.url).href,
  new URL('../assets/sfx/rakete-start.ogg', import.meta.url).href,
  new URL('../assets/sfx/schuss-1.ogg', import.meta.url).href,
  new URL('../assets/sfx/schuss-2.ogg', import.meta.url).href,
  new URL('../assets/sfx/scheibe-leicht.ogg', import.meta.url).href,
  new URL('../assets/sfx/scheibe-stark.ogg', import.meta.url).href,
  new URL('../assets/sfx/wasser-gross.ogg', import.meta.url).href,
  new URL('../assets/sfx/wasser-klein.ogg', import.meta.url).href,
];
const GROUPS = ['explosion-nah', 'explosion-fern', 'nachrollen', 'schuss', 'wasser-gross', 'wasser-klein', 'rakete-start',
  'boden', 'feuer-schleife', 'scheibe-leicht', 'scheibe-stark'] as const;
/** the soundscapes' loops: worked out in code (forge.ts), or recorded (rain on the bridge's windows: worked out, its
 *  drops rang like a soft xylophone) */
type BedKind = LoopKind | 'scheibe-leicht' | 'scheibe-stark';
/** a group of recordings, or of the sounds worked out in code when the sound starts (forge.ts) */
type SampleGroup = typeof GROUPS[number] | ForgeKind;
/** how long each worked-out sound lasts (s) */
const FORGED = new Map(FORGE_KINDS.map(f => [f.kind, f.seconds]));

/** seconds for sea, wind and rain to swell in when the sound first starts */
const AMBIENCE_FADE_IN = 6;

/** how much louder a unit's own engine is from inside its cab (about +5 dB) */
const CAB_ENGINE = 1.8;

/** where the player listens from: each view has its own soundscape, and it fades over when the view changes */
export type SoundScene = 'karte' | 'bruecke' | 'deck' | 'sonde' | 'kabine' | 'aussen';

interface SceneMix {
  /** sea, wind and rain from outside, through the hull or the glass: low-passed (Hz) and quieter */
  muffle: number; through: number;
  /** shares of the sea's rumble, its waves washing past, the wind's hiss, its gusts and the rain's hiss */
  sea: number; waves: number; wind: number; gusts: number; rain: number;
  /** the sea falls off with the height down to this share (the spotter pod still hears it from far up) */
  seaFloor: number;
  /** inside: the wind whistling round the windows in a storm, rain on the glass, the air conditioning */
  whistle: number; glass: number; hvac: number;
  /** the ship's machines through the hull; its engine as heard on deck (null: by how near the camera is to it) */
  hum: number; engine: number | null;
  /** bangs and engines outside, through the hull or the glass: low-passed (Hz) and quieter */
  outside: number; outsideLevel: number;
  /** the ship computer's voice: a little quieter where it is quiet round it (inside the ship, in a cab) */
  voice: number;
}

const OPEN = 20000;
const SCENES: Record<SoundScene, SceneMix> = {
  // the operations room under the map, deep in the ship: the machines' drone, the air conditioning, the sea faint outside
  karte: { muffle: 320, through: 0.5, sea: 0.5, waves: 0.6, wind: 0.2, gusts: 0, rain: 0.15, seaFloor: 0.15, whistle: 0, glass: 0, hvac: 1, hum: 1, engine: 0, outside: 450, outsideLevel: 0.45, voice: 0.7 },
  // the bridge: the sea a little louder through the windows, the machines, in a storm the wind whistling, rain on the glass
  bruecke: { muffle: 900, through: 0.6, sea: 0.65, waves: 1.6, wind: 0.3, gusts: 0, rain: 0.2, seaFloor: 0.15, whistle: 1, glass: 1, hvac: 0, hum: 0.7, engine: 0, outside: 1600, outsideLevel: 0.7, voice: 0.7 },
  // a camera out on deck: the weather, the sea louder, the ship's engine
  deck: { muffle: OPEN, through: 1, sea: 1.3, waves: 2, wind: 1, gusts: 0.5, rain: 1, seaFloor: 0.15, whistle: 0, glass: 0, hvac: 0, hum: 0, engine: 4, outside: OPEN, outsideLevel: 1, voice: 1 },
  // the spotter pod high up under its chute: loud wind, the sea far below
  sonde: { muffle: OPEN, through: 1, sea: 1.6, waves: 2, wind: 1.3, gusts: 1, rain: 0.7, seaFloor: 0.5, whistle: 0, glass: 0, hvac: 0, hum: 0, engine: 0, outside: OPEN, outsideLevel: 1, voice: 1 },
  // the Skua's cockpit, the Otter's cab: the outside muffled through the glass (as before)
  kabine: { muffle: 1100, through: 0.5, sea: 1, waves: 0, wind: 1, gusts: 0, rain: 1, seaFloor: 0.15, whistle: 0, glass: 0, hvac: 0, hum: 0, engine: null, outside: OPEN, outsideLevel: 1, voice: 0.8 },
  // every other camera (a unit's from outside, an island's, the title's): as before
  aussen: { muffle: OPEN, through: 1, sea: 1, waves: 0, wind: 1, gusts: 0, rain: 1, seaFloor: 0.15, whistle: 0, glass: 0, hvac: 0, hum: 0, engine: null, outside: OPEN, outsideLevel: 1, voice: 1 },
};
/** how fast one soundscape fades into the next (time constant, s): about as quick as a cut, without a click */
const SCENE_FADE = 0.2;

const smooth = (a: number, b: number, x: number) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/**
 * The game's sound (Web Audio): sea, wind, rain and thunder, the engines and UI blips are synthesised as they play;
 * explosions, shells, splashes and fire mix recordings (CC0) with synthesis, a little different every time. Lasers,
 * the missile's launch, hits on vehicles, debris and the hit confirmations are worked out in code once when the
 * sound starts (forge.ts) and then played like recordings. One-shots are positional and the further away the duller; near islands they echo. The listener
 * sits at the active camera — the "microphone" of the remote camera the player is watching through. Each view has
 * its own soundscape (scene()): the operations room under the map, the bridge, the deck, the spotter pod, a cab.
 */
export class SoundEngine {
  enabled = true;
  readonly levels: SoundLevels = { master: 0.8, effects: 0.9, ambience: 0.7, engines: 0.7, music: 0.7, voice: 0.9 };
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  /** room: what is heard inside the ship itself (the air conditioning, rain on the bridge's glass), at the ambience's level */
  private bus!: { effects: GainNode; ambience: GainNode; engines: GainNode; voice: GainNode; room: GainNode };
  /** effects and engines pass through this, to step back while the voice speaks */
  private duckNode!: GainNode;
  /** the weather and the sea as heard from inside (a cab, the bridge, the operations room): muffled and quieter */
  private muffle!: BiquadFilterNode;
  private muffleGain!: GainNode;
  /** sea and weather step back through this while the voice speaks */
  private ambDuck!: GainNode;
  /** bangs and engines out there as heard from inside the ship: through the hull or the glass */
  private outFx!: { filter: BiquadFilterNode; gain: GainNode };
  private outEng!: { filter: BiquadFilterNode; gain: GainNode };
  /** the soundscape of the view the player looks through (scene()) */
  private mix: SceneMix = SCENES.aussen;
  private sceneNow: SoundScene = 'aussen';
  /** the soundscapes' loops (forge.ts): their gains are there from the start, the sound comes once it is worked out */
  private beds = new Map<BedKind, { gain: GainNode; src: AudioBufferSourceNode | null }>();
  /** the sea's waves into this: duller from far up */
  private wavesFilter!: BiquadFilterNode;
  /** the ship's machines through its hull (their pitch and brightness follow the speed), and the air conditioning */
  private room: { hum: GainNode; shaft: OscillatorNode[]; tone: BiquadFilterNode; hvac: GainNode } | null = null;
  private white!: AudioBuffer;
  private brown!: AudioBuffer;
  private voices = 0;
  private amb: { sea: GainNode; seaFilter: BiquadFilterNode; wind: GainNode; windFilter: BiquadFilterNode; rain: GainNode } | null = null;
  /** 0..1 while sea and weather swell in after the sound has started */
  private ambIn = 0;
  private engines: { carrier: Engine; walrus: Engine; manta: Engine; drohne: Engine } | null = null;
  private thunderIn = 25;
  /** where the listener is (for the speed-of-sound delay) */
  private ear = new THREE.Vector3();
  /** watching through the spotter pod: its picture is a feed, and the sound comes with it, without the delay */
  private live = false;
  private fwd = new THREE.Vector3();
  private up = new THREE.Vector3();
  private samples = new Map<SampleGroup, AudioBuffer[]>();
  /** the Skua's jet loop and the filter it plays into (forge.ts 'duesen', started once it is worked out) */
  private jet: AudioBufferSourceNode | null = null;
  private jetIn: AudioNode | null = null;
  /** the echo near islands: a send from the effects into a reverb */
  private echo: GainNode | null = null;
  /** the fire nearest the camera: a crackling loop */
  private fire: { gain: GainNode; panner: PannerNode } | null = null;
  /** warning beeps while an enemy has locked on to the unit in hand */
  private warnIn = 0;
  /** the carrier defences' loops: the laser turret's drive, the nearest defence drone's propeller, the nearest
   *  Hammerhead's motor */
  private defenceLoops: {
    servo: { gain: GainNode; motor: OscillatorNode; octave: OscillatorNode; filter: BiquadFilterNode; teeth: OscillatorNode };
    hum: { gain: GainNode; panner: PannerNode };
    roar: { gain: GainNode; panner: PannerNode; band: BiquadFilterNode; whine: OscillatorNode };
  } | null = null;

  constructor() {
    const unlock = () => { this.unlock(); };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
    // no droning engines from a background tab
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden || this.paused) void this.ctx.suspend(); else void this.ctx.resume();
    });
  }

  private paused = false;
  /** the game is paused: everything falls silent */
  setPaused(on: boolean) {
    this.paused = on;
    if (!this.ctx) return;
    if (on) void this.ctx.suspend(); else if (!document.hidden) void this.ctx.resume();
  }

  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** browsers only allow audio after a user gesture: call from one */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended' && !this.paused) void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.bus = { effects: ctx.createGain(), ambience: ctx.createGain(), engines: ctx.createGain(), voice: ctx.createGain(), room: ctx.createGain() };
    this.duckNode = ctx.createGain();
    this.duckNode.connect(this.master);
    this.bus.effects.connect(this.duckNode);
    this.bus.engines.connect(this.duckNode);
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = OPEN; this.muffle.Q.value = 0.7;
    this.muffleGain = ctx.createGain();
    this.ambDuck = ctx.createGain();
    this.bus.ambience.connect(this.muffle).connect(this.muffleGain).connect(this.ambDuck).connect(this.master);
    this.bus.room.connect(this.master);
    const through = (to: AudioNode) => {
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = OPEN; filter.Q.value = 0.7;
      const gain = ctx.createGain();
      filter.connect(gain).connect(to);
      return { filter, gain };
    };
    this.outFx = through(this.bus.effects);
    this.outEng = through(this.bus.engines);
    this.bus.voice.connect(this.master);
    this.white = this.noiseBuffer('white');
    this.brown = this.noiseBuffer('brown');
    this.buildAmbience();
    this.buildRoom();
    this.buildEngines();
    this.buildDefenceLoops();
    this.buildEcho();
    this.applyLevels();
    void this.loadSamples();
    void this.forgeAll();
  }

  /** the audio clock (s; it stands while the sound is suspended) */
  get now(): number { return this.ctx?.currentTime ?? 0; }

  /** fetch and decode a recording (null if it fails) */
  async decode(url: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    try { return await this.ctx.decodeAudioData(await (await fetch(url)).arrayBuffer()); } catch (e) { console.warn(`Klang ${url} nicht geladen`, e); return null; }
  }

  /** the ship computer says a line (voice.ts): effects, engines, sea and weather step back while it speaks; returns its length (s) */
  speak(buf: AudioBuffer): number {
    if (!this.ctx) return 0;
    const ctx = this.ctx, t = ctx.currentTime, src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.bus.voice);
    src.start(t);
    for (const [g, to] of [[this.duckNode.gain, SPEECH_DUCK], [this.ambDuck.gain, SPEECH_DUCK_AMB]] as const) {
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else g.cancelScheduledValues(t);
      g.setTargetAtTime(to, t, 0.06);
      g.setTargetAtTime(1, t + buf.duration, 0.35);
    }
    return buf.duration;
  }

  /** work out the forged sounds, one variant at a time so no frame waits long (until each is there, it is silent) */
  private async forgeAll() {
    const ctx = this.ctx!;
    for (const f of FORGE_KINDS) {
      const list: AudioBuffer[] = [];
      for (let v = 0; v < f.variants; v++) {
        await new Promise(r => setTimeout(r, 0));
        const sr = Math.round(ctx.sampleRate * f.rate), x = forge(f.kind, v, sr), buf = ctx.createBuffer(1, x.length, sr);
        buf.copyToChannel(x as Float32Array<ArrayBuffer>, 0);
        list.push(buf);
        this.samples.set(f.kind, list);
      }
      if (f.kind === 'duesen') this.startJet();
      else if (f.loop) this.startBed(f.kind as LoopKind);
    }
  }

  /** a soundscape's loop, once worked out, into its gain (from a random point, so it does not start on the same wave) */
  private startBed(kind: BedKind) {
    const bed = this.beds.get(kind), buf = this.samples.get(kind)?.[0];
    if (!bed || !buf || bed.src) return;
    const src = this.ctx!.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.connect(bed.gain);
    src.start(0, Math.random() * buf.duration);
    bed.src = src;
  }

  private startJet() {
    const buf = this.samples.get('duesen')?.[0];
    if (!buf || this.jet || !this.jetIn) return;
    const src = this.ctx!.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.connect(this.jetIn);
    src.start(0, Math.random() * buf.duration);
    this.jet = src;
  }

  /** fetch and decode the recordings; until (or if never) they are there, the synthesis plays alone */
  private async loadSamples() {
    const ctx = this.ctx!;
    await Promise.all(SAMPLE_URLS.map(async (url) => {
      // the group is the start of the file name (then its number, and in the build a hash)
      const name = decodeURIComponent(new URL(url, location.href).pathname).replace(/^.*\//, '');
      const group = GROUPS.find(g => name.startsWith(`${g}-`) || name.startsWith(`${g}.`));
      if (!group) return;
      const path = name;
      try {
        const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
        if (!this.samples.has(group)) this.samples.set(group, []);
        this.samples.get(group)!.push(buf);
      } catch (e) { console.warn(`Klang ${path} nicht geladen`, e); }
    }));
    if (this.samples.has('feuer-schleife')) this.buildFire();
    this.startBed('scheibe-leicht');
    this.startBed('scheibe-stark');
  }

  /**
   * One of a group's recordings into `out` at `t`: `rate` changes its pitch and speed (a variation of ±6 % is
   * added), `offset` skips into it. False if the group is not loaded.
   */
  private sample(out: AudioNode, t: number, group: SampleGroup, gain: number, rate = 1, offset = 0): boolean {
    const list = this.samples.get(group);
    if (!list?.length) return false;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(g).connect(out);
    src.start(t, offset);
    return true;
  }

  /** a short room: decaying noise as the impulse response (the islands' cliffs throw the bangs back) */
  private buildEcho() {
    const ctx = this.ctx!, len = Math.floor(ctx.sampleRate * 2.4), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let energy = 0;
      for (let i = 0; i < len; i++) {
        const tt = i / ctx.sampleRate;
        // a gap before the first reflections, then a tail of about 2 s
        d[i] = tt < 0.07 ? 0 : (Math.random() * 2 - 1) * Math.exp(-tt * 2.6) * (tt < 0.16 ? 1.6 : 1);
        energy += d[i] * d[i];
      }
      // unit energy: the echo is as loud as the send says, whatever the length
      const k = 1 / Math.sqrt(energy);
      for (let i = 0; i < len; i++) d[i] *= k;
    }
    const conv = ctx.createConvolver(); conv.normalize = false; conv.buffer = ir;
    const send = ctx.createGain(); send.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    this.bus.effects.connect(send).connect(lp).connect(conv).connect(this.master);
    this.echo = send;
  }

  /** near land the bangs echo: 0 out at sea .. 1 right at a coast */
  space(near: number) {
    if (!this.ctx || !this.echo) return;
    this.echo.gain.setTargetAtTime(0.1 + near * 0.6, this.ctx.currentTime, 0.5);
  }

  private buildFire() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.samples.get('feuer-schleife')![0];
    src.loop = true;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const panner = this.panner(); panner.refDistance = 25;
    src.connect(gain).connect(panner).connect(this.bus.ambience);
    src.start(0, Math.random() * 10);
    this.fire = { gain, panner };
  }

  /** the carrier defences' loops (silent until their sources say otherwise) */
  private buildDefenceLoops() {
    const ctx = this.ctx!;
    // the turret's drive, a heavy one (the small servo whine sounded like a toy): a deep electric motor (a low saw and
    // its octave, darkly filtered), the slewing ring's gears grinding under it (rumbling noise beaten at the tooth
    // rate) and a faint hiss of the hydraulics
    const servo = ctx.createGain(); servo.gain.value = 0;
    const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.Q.value = 0.9; sf.frequency.value = 300;
    const so = ctx.createOscillator(); so.type = 'sawtooth'; so.frequency.value = 44;
    const so2 = ctx.createOscillator(); so2.type = 'square'; so2.frequency.value = 89;
    const s2g = ctx.createGain(); s2g.gain.value = 0.3;
    so.connect(sf); so2.connect(s2g).connect(sf);
    sf.connect(servo);
    const ring = ctx.createBiquadFilter(); ring.type = 'bandpass'; ring.frequency.value = 230; ring.Q.value = 1.3;
    const grind = ctx.createGain(); grind.gain.value = 0.55;
    const teeth = ctx.createOscillator(); teeth.frequency.value = 16;
    const tg = ctx.createGain(); tg.gain.value = 0.45;
    teeth.connect(tg).connect(grind.gain);
    const ringGain = ctx.createGain(); ringGain.gain.value = 2.2;
    this.loopNoise('brown').connect(ring).connect(grind).connect(ringGain).connect(servo);
    const hiss = ctx.createBiquadFilter(); hiss.type = 'highpass'; hiss.frequency.value = 2600;
    const hg = ctx.createGain(); hg.gain.value = 0.035;
    this.loopNoise('white').connect(hiss).connect(hg).connect(servo);
    servo.connect(this.bus.engines);
    so.start(); so2.start(); teeth.start();
    // a defence drone's propeller: two slightly detuned saws, beaten by its two blades
    const hum = ctx.createGain(); hum.gain.value = 0;
    const hp = this.panner(); hp.refDistance = 30;
    const hl = ctx.createBiquadFilter(); hl.type = 'lowpass'; hl.frequency.value = 700;
    const am = ctx.createGain(); am.gain.value = 0.6;
    for (const f of [118, 121.5]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(hl); o.start(); }
    const blade = ctx.createOscillator(), bg = ctx.createGain(); blade.frequency.value = 23; bg.gain.value = 0.4;
    blade.connect(bg).connect(am.gain); blade.start();
    hl.connect(am).connect(hum).connect(hp).connect(this.outEng.filter);
    // a Hammerhead's motor: rushing noise in a band, a rumble under it and a thin whine
    const roar = ctx.createGain(); roar.gain.value = 0;
    const rp = this.panner(); rp.refDistance = 70;
    const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 900; band.Q.value = 0.7;
    this.loopNoise('white').connect(band).connect(roar);
    const rumble = ctx.createBiquadFilter(); rumble.type = 'lowpass'; rumble.frequency.value = 180;
    const rg = ctx.createGain(); rg.gain.value = 0.9;
    this.loopNoise('brown').connect(rumble).connect(rg).connect(roar);
    const whine = ctx.createOscillator(), wg = ctx.createGain(); whine.type = 'triangle'; whine.frequency.value = 1400; wg.gain.value = 0.04;
    whine.connect(wg).connect(roar); whine.start();
    roar.connect(rp).connect(this.outFx.filter);
    this.defenceLoops = { servo: { gain: servo, motor: so, octave: so2, filter: sf, teeth }, hum: { gain: hum, panner: hp }, roar: { gain: roar, panner: rp, band, whine } };
  }

  /** the laser turret turning: 0..1 of its top rate (0 when still, or when it is not watched through its camera) */
  servo(level: number) {
    const s = this.defenceLoops?.servo;
    if (!s) return;
    const t = this.ctx!.currentTime;
    // (a heavy turret: it spins up and runs down with some inertia)
    const f = 42 + 46 * level;
    s.gain.gain.setTargetAtTime(0.13 * level, t, 0.12);
    s.motor.frequency.setTargetAtTime(f, t, 0.22);
    s.octave.frequency.setTargetAtTime(f * 2.03, t, 0.22);
    s.filter.frequency.setTargetAtTime(240 + 380 * level, t, 0.2);
    s.teeth.frequency.setTargetAtTime(10 + 22 * level, t, 0.22);
  }

  /** the nearest defence drone (or none): its propeller hums from there */
  shieldHum(pos: THREE.Vector3 | null) {
    const h = this.defenceLoops?.hum;
    if (!h) return;
    h.gain.gain.setTargetAtTime(pos ? 0.25 : 0, this.ctx!.currentTime, 0.3);
    if (pos) this.place(h.panner, pos);
  }

  /** the nearest Hammerhead in flight (or none): its motor roars from there, higher while it comes closer (m/s) */
  missileRoar(pos: THREE.Vector3 | null, closing = 0) {
    const r = this.defenceLoops?.roar;
    if (!r) return;
    const t = this.ctx!.currentTime;
    r.gain.gain.setTargetAtTime(pos ? 0.5 : 0, t, pos ? 0.05 : 0.25);
    if (!pos) return;
    this.place(r.panner, pos);
    const k = THREE.MathUtils.clamp(1 + 0.3 * closing / 240, 0.7, 1.35);
    r.band.frequency.setTargetAtTime(900 * k, t, 0.05);
    r.whine.frequency.setTargetAtTime(1400 * k, t, 0.05);
  }

  /** the nearest fire (or none): its crackle comes from there, louder for a bigger fire */
  fireAt(pos: THREE.Vector3 | null, size: number) {
    if (!this.ctx || !this.fire) return;
    const t = this.ctx.currentTime;
    this.fire.gain.gain.setTargetAtTime(pos ? Math.min(1.6, 0.4 + size * 0.08) : 0, t, 0.3);
    if (pos) this.place(this.fire.panner, pos);
  }

  /**
   * An enemy has locked on to the unit in hand (`missiles`: how many of its missiles fly at it): a warning beep,
   * faster with a missile on the way.
   */
  lockWarning(dt: number, locked: boolean, missiles: number) {
    if (!locked && !missiles) { this.warnIn = 0; return; }
    this.warnIn -= dt;
    if (this.warnIn > 0) return;
    this.warnIn = missiles ? 0.16 : 0.55;
    this.voice(null, 0.2, (out, t) => this.tone(out, t, 'square', missiles ? 1320 : 990, missiles ? 1320 : 990, 0.07, 0.003, 0.08));
  }

  /** a shot of the unit in hand struck home: a crisp tick on a knock (a deep whump and a double tick when it destroyed the target) */
  hitConfirm(killed: boolean) {
    this.forged(null, killed ? 'ui-abschuss' : 'ui-treffer', killed ? 0.5 : 0.35);
  }

  /** the sea and weather's share while music plays (1: as set) */
  private duckBy = 1;
  /** sea and weather give way to the music (the share of their level, eased over a second or so) */
  duck(v: number) {
    if (Math.abs(v - this.duckBy) < 0.005) return;
    this.duckBy = v;
    if (!this.ctx) return;
    this.bus.ambience.gain.setTargetAtTime(this.levels.ambience * v, this.ctx.currentTime, 0.4);
    this.bus.room.gain.setTargetAtTime(this.levels.ambience * v, this.ctx.currentTime, 0.4);
  }

  applyLevels() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.enabled ? this.levels.master : 0, t, 0.05);
    this.bus.effects.gain.setTargetAtTime(this.levels.effects, t, 0.05);
    this.bus.ambience.gain.setTargetAtTime(this.levels.ambience * this.duckBy, t, 0.05);
    this.bus.room.gain.setTargetAtTime(this.levels.ambience * this.duckBy, t, 0.05);
    this.bus.engines.gain.setTargetAtTime(this.levels.engines, t, 0.05);
    this.bus.voice.gain.setTargetAtTime(this.levels.voice * SPEECH_GAIN * this.mix.voice, t, 0.05);
  }

  private noiseBuffer(kind: 'white' | 'brown'): AudioBuffer {
    const ctx = this.ctx!, len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
    return buf;
  }

  private loopNoise(kind: 'white' | 'brown'): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = kind === 'white' ? this.white : this.brown;
    src.loop = true;
    src.start(0, Math.random() * 2);
    return src;
  }

  private panner(): PannerNode {
    const p = this.ctx!.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 40;
    p.rolloffFactor = 1.1;
    p.maxDistance = 6000;
    return p;
  }

  private lfo(freq: number, depth: number, target: AudioParam) {
    const o = this.ctx!.createOscillator(), g = this.ctx!.createGain();
    o.frequency.value = freq; g.gain.value = depth;
    o.connect(g).connect(target);
    o.start();
  }

  // ---------- ambience ----------
  private buildAmbience() {
    const ctx = this.ctx!;
    const sea = ctx.createGain(), seaFilter = ctx.createBiquadFilter();
    seaFilter.type = 'lowpass'; seaFilter.frequency.value = 480;
    this.loopNoise('brown').connect(seaFilter).connect(sea).connect(this.bus.ambience);
    this.lfo(0.09, 120, seaFilter.frequency);         // waves washing in and out
    const wind = ctx.createGain(), windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass'; windFilter.frequency.value = 850; windFilter.Q.value = 0.7;
    this.loopNoise('white').connect(windFilter).connect(wind).connect(this.bus.ambience);
    this.lfo(0.17, 260, windFilter.frequency);        // gusts
    const rain = ctx.createGain(), rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'highpass'; rainFilter.frequency.value = 2400;
    this.loopNoise('white').connect(rainFilter).connect(rain).connect(this.bus.ambience);
    sea.gain.value = wind.gain.value = rain.gain.value = 0;
    this.amb = { sea, seaFilter, wind, windFilter, rain };
    // the loops (forge.ts): the sea's waves and the wind's gusts from outside, through the muffle like the rest;
    // the whistling and the rain on the glass inside, on the bridge
    this.wavesFilter = ctx.createBiquadFilter(); this.wavesFilter.type = 'lowpass'; this.wavesFilter.frequency.value = OPEN;
    this.wavesFilter.connect(this.bus.ambience);
    const bed = (kind: BedKind, to: AudioNode) => {
      const gain = ctx.createGain(); gain.gain.value = 0;
      gain.connect(to);
      this.beds.set(kind, { gain, src: null });
    };
    bed('seegang', this.wavesFilter);
    bed('boeen', this.bus.ambience);
    bed('pfeifen', this.bus.room);
    bed('scheibe-leicht', this.bus.room);
    bed('scheibe-stark', this.bus.room);
  }

  /**
   * Inside the ship: its machines through the hull (the generators' drone, two diesels a little apart that beat
   * slowly, with overtones a small speaker gives, and the shafts' rumble under them) and the air conditioning in the
   * operations room (air rushing softly from the vents, the fan's whirr in it)
   */
  private buildRoom() {
    const ctx = this.ctx!;
    const hum = ctx.createGain(); hum.gain.value = 0;
    const hl = ctx.createBiquadFilter(); hl.type = 'lowpass'; hl.frequency.value = 320; hl.Q.value = 0.8;
    const shaft = [49, 49.6, 73.8].map((f, i) => {
      const o = ctx.createOscillator(); o.type = i < 2 ? 'sawtooth' : 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = i < 2 ? 0.5 : 0.25;
      o.connect(g).connect(hl); o.start();
      return o;
    });
    const rumble = ctx.createBiquadFilter(); rumble.type = 'lowpass'; rumble.frequency.value = 120;
    const rg = ctx.createGain(); rg.gain.value = 0.9;
    this.loopNoise('brown').connect(rumble).connect(rg).connect(hum);
    hl.connect(hum);
    hum.connect(this.bus.engines);
    const hvac = ctx.createGain(); hvac.gain.value = 0;
    const air = ctx.createBiquadFilter(); air.type = 'bandpass'; air.frequency.value = 520; air.Q.value = 0.5;
    const soft = ctx.createBiquadFilter(); soft.type = 'lowpass'; soft.frequency.value = 2200;
    this.loopNoise('white').connect(air).connect(soft).connect(hvac);
    const fan = ctx.createGain(); fan.gain.value = 0.14;
    const blade = ctx.createOscillator(), bg = ctx.createGain(); blade.frequency.value = 27; bg.gain.value = 0.05;
    blade.connect(bg).connect(fan.gain); blade.start();
    const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 700;
    for (const [type, f, g] of [['triangle', 112, 1], ['sine', 224, 0.5], ['sine', 466, 0.18]] as const) {
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.value = f; og.gain.value = g;
      o.connect(og).connect(fl); o.start();
    }
    fl.connect(fan).connect(hvac);
    hvac.connect(this.bus.room);
    this.room = { hum, shaft, tone: hl, hvac };
  }

  /** the view the player looks through changes: its soundscape fades in (the outside through the hull or the glass …) */
  scene(s: SoundScene) {
    if (s === this.sceneNow) return;
    this.sceneNow = s;
    this.mix = SCENES[s];
    if (!this.ctx) return;
    const t = this.ctx.currentTime, m = this.mix;
    this.muffle.frequency.setTargetAtTime(m.muffle, t, SCENE_FADE);
    this.muffleGain.gain.setTargetAtTime(m.through, t, SCENE_FADE);
    for (const o of [this.outFx, this.outEng]) {
      o.filter.frequency.setTargetAtTime(m.outside, t, SCENE_FADE);
      o.gain.gain.setTargetAtTime(m.outsideLevel, t, SCENE_FADE);
    }
    this.bus.voice.gain.setTargetAtTime(this.levels.voice * SPEECH_GAIN * m.voice, t, SCENE_FADE);
  }

  /** waves 0..3, wind m/s, rain 0..1, camera height above the sea; the soundscape is the view's (scene()) */
  ambience(dt: number, waves: number, wind: number, rain: number, height: number, storm: number) {
    if (!this.ctx || !this.amb) return;
    const t = this.ctx.currentTime, m = this.mix;
    // when the sound first starts, sea, wind and rain swell in instead of setting in at once
    this.ambIn = Math.min(1, this.ambIn + dt / AMBIENCE_FADE_IN);
    const swell = this.ambIn * this.ambIn;
    const high = THREE.MathUtils.clamp(1 - (height - 30) / 400, m.seaFloor, 1);
    // (the weather changes slowly by itself: these follow the view as quickly as it changes)
    this.amb.sea.gain.setTargetAtTime(0.26 * (0.5 + waves * 0.35) * high * swell * m.sea, t, SCENE_FADE);
    this.amb.wind.gain.setTargetAtTime(Math.min(0.5, 0.03 + wind / 22 * 0.22) * swell * m.wind, t, SCENE_FADE);
    this.amb.rain.gain.setTargetAtTime(rain * 0.22 * swell * m.rain, t, SCENE_FADE);
    const bed = (kind: BedKind, level: number, rate = 1) => {
      const b = this.beds.get(kind)!;
      b.gain.gain.setTargetAtTime(level * swell, t, SCENE_FADE);
      if (b.src) b.src.playbackRate.setTargetAtTime(rate, t, 0.5);
    };
    // the waves washing past: bigger and slower in a heavy sea, duller from far up
    bed('seegang', 0.1 * (0.4 + waves * 0.3) * high * m.waves, 1.08 - waves * 0.06);
    this.wavesFilter.frequency.setTargetAtTime(height > 120 ? 900 : OPEN, t, SCENE_FADE);
    // the gusts: louder and quicker in a stronger wind
    bed('boeen', 0.5 * Math.min(2, 0.4 + wind / 15) * m.gusts * (m.gusts < 1 ? smooth(6, 20, wind) : 1), 0.85 + Math.min(wind, 26) / 26 * 0.3);
    // the bridge in a storm: the wind whistles, higher the stronger it blows; rain on the glass (recordings), drops, then a patter
    const storming = smooth(12, 20, wind);
    bed('pfeifen', 0.03 * storming * m.whistle, 0.9 + storming * 0.25);
    bed('scheibe-leicht', 0.1 * smooth(0, 0.3, rain) * (1 - 0.5 * smooth(0.5, 1, rain)) * m.glass);
    bed('scheibe-stark', 0.27 * smooth(0.25, 0.9, rain) * m.glass);
    if (this.room) {
      this.room.hvac.gain.setTargetAtTime(0.026 * m.hvac, t, SCENE_FADE);
    }
    if (storm > 0.6) {
      this.thunderIn -= dt;
      if (this.thunderIn <= 0) { this.thunder(); this.thunderIn = 14 + Math.random() * 28; }
    }
  }

  private thunder() {
    const ctx = this.ctx!, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.brown;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.3, t + 1.2);
    g.gain.exponentialRampToValueAtTime(0.001, t + 4.5);
    src.connect(f).connect(g).connect(this.bus.ambience);
    src.start(t, Math.random()); src.stop(t + 4.6);
  }

  // ---------- engines ----------
  private buildEngines() {
    const ctx = this.ctx!;
    const make = (positional: boolean, build: (out: GainNode) => Engine['set']): Engine => {
      const gain = ctx.createGain(); gain.gain.value = 0;
      const panner = positional ? this.panner() : null;
      if (panner) gain.connect(panner).connect(this.outEng.filter); else gain.connect(this.bus.engines);
      return { gain, panner, nodes: [], set: build(gain) };
    };
    // carrier: deep two-oscillator drone plus rumble, and the funnel's exhaust chuffing at the firing rate (that
    // carries on a small speaker too, where the drone is too deep)
    const carrier = make(false, (out) => {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 170;
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      o1.type = o2.type = 'sawtooth';
      o1.connect(lp); o2.connect(lp); lp.connect(out);
      const rumble = ctx.createBiquadFilter(); rumble.type = 'lowpass'; rumble.frequency.value = 110;
      this.loopNoise('brown').connect(rumble).connect(out);
      const ex = ctx.createBiquadFilter(); ex.type = 'bandpass'; ex.frequency.value = 210; ex.Q.value = 1.1;
      const exG = ctx.createGain(); exG.gain.value = 0.6;
      const firing = ctx.createOscillator(), fg = ctx.createGain(); fg.gain.value = 0.25;
      firing.connect(fg).connect(exG.gain);
      this.loopNoise('brown').connect(ex).connect(exG).connect(out);
      o1.start(); o2.start(); firing.start();
      return (v) => {
        o1.frequency.value = 31 + v.speed * 9; o2.frequency.value = 46.7 + v.speed * 13; firing.frequency.value = 6.5 + v.speed * 4;
        lp.frequency.value = 140 + v.speed * 60; ex.frequency.value = 180 + v.speed * 60;
      };
    });
    // walrus: chugging diesel
    const walrus = make(true, (out) => {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
      const o = ctx.createOscillator(), o2 = ctx.createOscillator();
      o.type = 'square'; o2.type = 'sawtooth';
      const chug = ctx.createGain(); chug.gain.value = 0.6;
      const mod = ctx.createOscillator(), modG = ctx.createGain(); modG.gain.value = 0.4;
      mod.connect(modG).connect(chug.gain);
      o.connect(lp); o2.connect(lp); lp.connect(chug).connect(out);
      o.start(); o2.start(); mod.start();
      return (v) => { o.frequency.value = 46 + v.rpm * 40; o2.frequency.value = 69 + v.rpm * 58; mod.frequency.value = 7 + v.rpm * 9; };
    });
    // manta: the jet's roar (a loop from forge.ts, from the moment it is worked out), brighter and higher with the
    // thrust, a rumble under it and the turbine's whine, two tones a little off a fifth that beat
    const manta = make(true, (out) => {
      const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.Q.value = 0.6;
      tone.connect(out);
      this.jetIn = tone;
      const rumble = ctx.createBiquadFilter(); rumble.type = 'lowpass'; rumble.frequency.value = 150;
      const rg = ctx.createGain(); rg.gain.value = 0.35;
      this.loopNoise('brown').connect(rumble).connect(rg).connect(out);
      const soft = ctx.createBiquadFilter(); soft.type = 'bandpass'; soft.Q.value = 1.2;
      const wg = ctx.createGain(); wg.gain.value = 0.03;
      const whines = ['triangle', 'sine'].map(type => {
        const o = ctx.createOscillator(); o.type = type as OscillatorType; o.connect(soft); o.start();
        return o;
      });
      soft.connect(wg).connect(out);
      return (v) => {
        tone.frequency.value = 700 + v.thrust * 2600;
        const f = 900 + v.thrust * 1700;
        whines[0].frequency.value = f; whines[1].frequency.value = f * 1.51;
        soft.frequency.value = f * 1.2;
        wg.gain.value = 0.02 + v.thrust * 0.025;
        if (this.jet) this.jet.playbackRate.value = 0.8 + v.thrust * 0.45;
      };
    });
    // drone: four big, slightly detuned rotors (deep blade thump) and a turbine generator whine
    const drohne = make(true, (out) => {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.8;
      const oscs = [0, 1, 2, 3].map(i => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = i * 11 - 16;
        o.connect(lp); o.start();
        return o;
      });
      // blade passes: a strong, low amplitude modulation gives the "wop-wop"
      const am = ctx.createGain(); am.gain.value = 0.55;
      const blade = ctx.createOscillator(), bladeG = ctx.createGain(); bladeG.gain.value = 0.45;
      blade.connect(bladeG).connect(am.gain); blade.start();
      lp.connect(am).connect(out);
      const rumble = ctx.createBiquadFilter(); rumble.type = 'lowpass'; rumble.frequency.value = 160;
      const rg = ctx.createGain(); rg.gain.value = 0.6;
      this.loopNoise('brown').connect(rumble).connect(rg).connect(am);
      const whine = ctx.createOscillator(), wg = ctx.createGain(); wg.gain.value = 0.05;
      whine.type = 'triangle'; whine.connect(wg).connect(out); whine.start();
      return (v) => {
        const f = 48 + v.rpm * 16;
        oscs.forEach(o => { o.frequency.value = f; });
        blade.frequency.value = 11 + v.rpm * 4;
        lp.frequency.value = 320 + v.rpm * 260;
        whine.frequency.value = 1150 + v.rpm * 180;
      };
    });
    // a diesel's drone fades sooner with the distance than a jet's: an Otter driving home is not heard for long
    walrus.panner!.rolloffFactor = 2;
    this.engines = { carrier, walrus, manta, drohne };
  }

  /** levels 0..1; positions in world space; carrierNear 0..1 (how close the camera is to the ship, for a view whose
   *  soundscape does not say how loud its engine is); `cab`: the unit whose cab the camera sits in (its own engine is
   *  loud there) */
  enginesUpdate(o: {
    carrierSpeed: number; carrierNear: number; walrus: { on: boolean; rpm: number; pos: THREE.Vector3 };
    manta: { on: boolean; thrust: number; pos: THREE.Vector3 }; drohne: { on: boolean; rpm: number; pos: THREE.Vector3 };
    cab?: 'walrus' | 'manta' | null;
  }) {
    if (!this.ctx || !this.engines) return;
    const t = this.ctx.currentTime, e = this.engines;
    const inCab = (u: 'walrus' | 'manta') => (o.cab === u ? CAB_ENGINE : 1);
    e.carrier.set({ speed: o.carrierSpeed });
    // the engine idles quietly while the ship stands and grows louder with each step of the throttle (full ahead:
    // about 18 dB over the idle)
    e.carrier.gain.gain.setTargetAtTime((0.01 + o.carrierSpeed * 0.07) * (this.mix.engine ?? o.carrierNear), t, SCENE_FADE);
    // inside, the machines drone through the hull: at a standstill only the generators, faint and low; with the speed
    // the propulsion comes in, louder, higher and brighter (full ahead about 16 dB over the standstill)
    if (this.room) {
      const v = Math.min(1.5, o.carrierSpeed);
      this.room.hum.gain.setTargetAtTime((0.03 + 0.15 * v) * this.mix.hum, t, SCENE_FADE);
      this.room.shaft.forEach((s, i) => s.frequency.setTargetAtTime([49, 49.6, 73.8][i] * (0.75 + 0.25 * v), t, 1.5));
      this.room.tone.frequency.setTargetAtTime(220 + 120 * v, t, 1.5);
    }
    e.walrus.set({ rpm: o.walrus.rpm });
    e.walrus.gain.gain.setTargetAtTime(o.walrus.on ? (0.07 + o.walrus.rpm * 0.13) * inCab('walrus') : 0, t, 0.15);
    this.place(e.walrus.panner!, o.walrus.pos);
    e.manta.set({ thrust: o.manta.thrust });
    e.manta.gain.gain.setTargetAtTime(o.manta.on ? (0.14 + o.manta.thrust * 0.3) * inCab('manta') : 0, t, 0.2);
    this.place(e.manta.panner!, o.manta.pos);
    e.drohne.set({ rpm: o.drohne.rpm });
    e.drohne.gain.gain.setTargetAtTime(o.drohne.on ? 0.05 + o.drohne.rpm * 0.05 : 0, t, 0.15);
    this.place(e.drohne.panner!, o.drohne.pos);
  }

  private place(p: PannerNode, pos: THREE.Vector3) {
    const t = this.ctx!.currentTime;
    p.positionX.setTargetAtTime(pos.x, t, 0.03); p.positionY.setTargetAtTime(pos.y, t, 0.03); p.positionZ.setTargetAtTime(pos.z, t, 0.03);
  }

  /** the listener follows the camera every frame (`live`: a remote camera's feed, heard without the delay) */
  listener(camera: THREE.Camera, live = false) {
    this.ear.copy(camera.position);
    this.live = live;
    if (!this.ctx) return;
    const l = this.ctx.listener, t = this.ctx.currentTime, p = camera.position;
    const f = camera.getWorldDirection(this.fwd), u = this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02); l.positionY.setTargetAtTime(p.y, t, 0.02); l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(f.x, t, 0.02); l.forwardY.setTargetAtTime(f.y, t, 0.02); l.forwardZ.setTargetAtTime(f.z, t, 0.02);
      l.upX.setTargetAtTime(u.x, t, 0.02); l.upY.setTargetAtTime(u.y, t, 0.02); l.upZ.setTargetAtTime(u.z, t, 0.02);
    } else {
      // older Safari
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  // ---------- one-shots ----------
  /** a forged sound (forge.ts) on its own */
  private forged(pos: THREE.Vector3 | null, kind: ForgeKind, gain: number, reach = 40) {
    this.voice(pos, FORGED.get(kind)!, (out, t) => this.sample(out, t, kind, gain), reach);
  }

  /** `reach`: how far it carries (the panner's reference distance; big bangs are heard far off) */
  private voice(pos: THREE.Vector3 | null, seconds: number, build: (out: AudioNode, t: number) => void, reach = 40) {
    if (!this.ctx || this.voices >= MAX_VOICES) return;
    const ctx = this.ctx;
    // far away things are heard later: the flash first, then the bang (not through the spotter pod's feed)
    const dist = pos ? pos.distanceTo(this.ear) : 0;
    const delay = this.live ? 0 : Math.min(3, dist / 343);
    const t = ctx.currentTime + delay;
    const out = ctx.createGain();
    if (pos) {
      const p = this.panner();
      p.refDistance = reach;
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      // the air swallows the highs: the further, the duller
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = Math.max(450, 16000 * Math.exp(-dist / 900));
      out.connect(lp).connect(p).connect(this.outFx.filter);
    } else out.connect(this.bus.effects);
    build(out, t);
    this.voices++;
    setTimeout(() => { this.voices--; out.disconnect(); }, (seconds + delay + 0.2) * 1000);
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private noiseBurst(out: AudioNode, t: number, o: { type: BiquadFilterType; f0: number; f1: number; peak: number; attack: number; decay: number; brown?: boolean; q?: number }) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = o.brown ? this.brown : this.white;
    const f = ctx.createBiquadFilter(); f.type = o.type; f.Q.value = o.q ?? 0.8;
    f.frequency.setValueAtTime(o.f0, t);
    f.frequency.exponentialRampToValueAtTime(o.f1, t + o.attack + o.decay);
    const g = ctx.createGain();
    this.env(g, t, o.peak, o.attack, o.decay);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 2); src.stop(t + o.attack + o.decay + 0.05);
  }

  private tone(out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, peak: number, attack: number, decay: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + attack + decay);
    const g = ctx.createGain();
    this.env(g, t, peak, attack, decay);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + attack + decay + 0.05);
  }

  /**
   * Lasers are heavy chemical weapons, not toys (forge.ts): `heavy` is an Otter's Avatar (deeper and longer),
   * otherwise the fast Quasar.
   */
  shot(kind: 'laser' | 'kanone' | 'rakete', pos: THREE.Vector3, player: boolean, heavy = false) {
    void player;
    if (kind === 'laser') this.forged(pos, heavy ? 'laser-schwer' : 'laser', heavy ? 1.3 : 1);
    else if (kind === 'kanone') this.voice(pos, 1.4, (out, t) => {
      // a rifle shot an octave down is a gun: crack and boom; under it the synthesised thump
      const rec = this.sample(out, t, 'schuss', 0.9, 0.55);
      this.noiseBurst(out, t, { type: 'lowpass', f0: 2400, f1: 200, peak: rec ? 0.3 : 0.6, attack: 0.004, decay: 0.32 });
      this.tone(out, t, 'sine', 130, 42, 0.5, 0.004, 0.28);
    });
    else this.voice(pos, FORGED.get('rakete')!, (out, t) => {
      // the missile leaves: ignition and the motor's roar (forge.ts), the recorded whoosh over them
      this.sample(out, t, 'rakete', 0.45);
      this.sample(out, t, 'rakete-start', 0.4, 0.8);
    });
  }

  /**
   * The crack of a recording close by, the body of a far one, the synthesised boom under them and, for a big
   * one, a long roll of thunder after it (deeper the bigger it is).
   */
  explosion(pos: THREE.Vector3, scale: number) {
    const dur = 0.9 + scale * 0.7, far = pos.distanceTo(this.ear) > 1100, deep = 1 / (1 + scale * 0.12);
    this.voice(pos, dur + (scale >= 1.8 ? 5 : 1.5), (out, t) => {
      const rec = !far && this.sample(out, t, 'explosion-nah', 1, 0.9 * deep);
      this.sample(out, t + 0.01, 'explosion-fern', far ? 1 : 0.7, 0.85 * deep);
      if (scale >= 1.8) this.sample(out, t + 0.12, 'nachrollen', Math.min(0.9, 0.25 * scale), 0.8 * deep, 0.3);
      this.noiseBurst(out, t, { type: 'lowpass', f0: 3200, f1: 140, peak: Math.min(1, 0.5 + scale * 0.18) * (rec ? 0.4 : 1), attack: 0.006, decay: dur, brown: false });
      this.noiseBurst(out, t, { type: 'lowpass', f0: 400, f1: 60, peak: 0.8, attack: 0.01, decay: dur * 1.2, brown: true });
      this.tone(out, t, 'sine', 90, 28, 0.7, 0.005, dur * 0.6);
    }, 40 * (1 + scale));
  }

  /**
   * A Hammerhead strikes home. The listener is usually far off, up at the spotter pod's camera, and the plain blast
   * came through thin there; this one carries much further: the big blast with its long roll, a deep thump and a
   * low rumble under it, and a second blast a moment later as what it struck goes up.
   */
  hammerHit(pos: THREE.Vector3) {
    this.voice(pos, 8, (out, t) => {
      this.sample(out, t, 'explosion-nah', 1, 0.72);
      this.sample(out, t + 0.01, 'explosion-fern', 1, 0.66);
      this.sample(out, t + 0.1, 'nachrollen', 0.9, 0.7, 0.3);
      this.noiseBurst(out, t, { type: 'lowpass', f0: 4200, f1: 110, peak: 1, attack: 0.004, decay: 2.4, brown: false });
      this.noiseBurst(out, t, { type: 'lowpass', f0: 320, f1: 35, peak: 1, attack: 0.008, decay: 3.4, brown: true });
      this.tone(out, t, 'sine', 64, 20, 1, 0.004, 1.8);
      this.sample(out, t + 0.55, 'explosion-nah', 0.55, 0.6);
      this.noiseBurst(out, t + 0.55, { type: 'lowpass', f0: 1800, f1: 90, peak: 0.6, attack: 0.01, decay: 1.6, brown: true });
    }, 420);
  }

  /** something big into the water (a blast, a wreck) */
  splash(pos: THREE.Vector3, scale: number) {
    this.voice(pos, 3.5, (out, t) => {
      if (!this.sample(out, t, 'wasser-gross', Math.min(1, 0.5 + scale * 0.25), 0.9 / (1 + scale * 0.1)))
        this.noiseBurst(out, t, { type: 'bandpass', f0: 1200, f1: 300, peak: 0.5, attack: 0.02, decay: 1.2, q: 0.7 });
    });
  }

  /** a wreck crashes down on land: a heavy thud, metal crumpling and scattering (forge.ts) */
  debris(pos: THREE.Vector3) {
    this.forged(pos, 'truemmer', 0.65);
  }

  /** a shot strikes: armour on a hit (forge.ts), earth and stone thud on land, a splash on the water */
  impact(pos: THREE.Vector3, surface: 'land' | 'water' | 'hit') {
    if (surface === 'water') this.voice(pos, 2.8, (out, t) => {
      if (!this.sample(out, t, 'wasser-klein', 0.45, 1.15)) this.noiseBurst(out, t, { type: 'bandpass', f0: 1400, f1: 500, peak: 0.3, attack: 0.01, decay: 0.4, q: 0.9 });
    });
    else if (surface === 'hit') this.voice(pos, FORGED.get('treffer')!, (out, t) => {
      this.sample(out, t, 'treffer', 0.85);
      // a close blast's crack, short and high, for the body of a real impact
      this.sample(out, t, 'explosion-nah', 0.3, 1.5);
    });
    else this.voice(pos, 1.1, (out, t) => {
      const rec = this.sample(out, t, 'boden', 0.6, 0.8);
      this.noiseBurst(out, t, { type: 'lowpass', f0: 2600, f1: 400, peak: rec ? 0.15 : 0.35, attack: 0.002, decay: 0.2 });
    });
  }

  /** a decoy flare is thrown: the launcher's dull pop, the flare's hiss as it lights, then it burns, crackling */
  decoy(pos: THREE.Vector3) {
    this.voice(pos, 9.5, (out, t) => {
      this.tone(out, t, 'sine', 170, 55, 0.45, 0.003, 0.18);
      this.noiseBurst(out, t, { type: 'lowpass', f0: 1800, f1: 250, peak: 0.3, attack: 0.002, decay: 0.15 });
      this.sample(out, t + 0.05, 'rakete-start', 0.35, 1.35);
      this.noiseBurst(out, t + 0.08, { type: 'bandpass', f0: 3200, f1: 1800, peak: 0.25, attack: 0.05, decay: 1.2, q: 1.5 });
      // its nine seconds of burning: a bright hiss, and crackles scattered over it
      this.noiseBurst(out, t + 0.6, { type: 'bandpass', f0: 3800, f1: 2600, peak: 0.6, attack: 0.4, decay: 8, q: 0.8 });
      for (let i = 0; i < 30; i++) {
        this.noiseBurst(out, t + 0.8 + Math.random() * 8, { type: 'highpass', f0: 2400, f1: 2400, peak: 0.15 + Math.random() * 0.25, attack: 0.001, decay: 0.012 + Math.random() * 0.02 });
      }
    });
  }

  /**
   * The carrier's laser turret: deeper and heavier than the Otter's laser, a crack doubled by the twin barrels and a
   * rumble after (forge.ts). `rapid`: within a burst the shots are quieter and shorter, so sustained fire does not grate.
   */
  turretShot(pos: THREE.Vector3, rapid: boolean) {
    this.forged(pos, rapid ? 'turm-kurz' : 'turm', rapid ? 0.6 : 1, 60);
  }

  /** a defence drone leaves the deck: it is blown up with a rush of compressed air, and its little motor starts */
  shieldLaunch(pos: THREE.Vector3) {
    this.voice(pos, 2, (out, t) => {
      this.noiseBurst(out, t, { type: 'bandpass', f0: 700, f1: 2600, peak: 0.9, attack: 0.05, decay: 1.3, q: 0.8 });
      this.noiseBurst(out, t + 0.05, { type: 'lowpass', f0: 500, f1: 150, peak: 0.5, attack: 0.02, decay: 0.6, brown: true });
      this.tone(out, t + 0.4, 'triangle', 80, 150, 0.25, 0.15, 0.9);
    }, 60);
  }

  /** a defence drone is hit: its skin bursts with a bang and flaps as the air rushes out */
  shieldBurst(pos: THREE.Vector3) {
    this.voice(pos, 1.5, (out, t) => {
      this.noiseBurst(out, t, { type: 'highpass', f0: 1800, f1: 700, peak: 0.9, attack: 0.001, decay: 0.07 });
      this.tone(out, t, 'sine', 160, 48, 0.55, 0.002, 0.22);
      // the flapping skin: noise in a band, chopped by a slowing square
      const ctx = this.ctx!, flap = ctx.createGain(); flap.gain.value = 0.5;
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.type = 'square'; lfo.frequency.setValueAtTime(34, t); lfo.frequency.exponentialRampToValueAtTime(12, t + 0.7); lg.gain.value = 0.5;
      lfo.connect(lg).connect(flap.gain); lfo.start(t); lfo.stop(t + 0.9);
      flap.connect(out);
      this.noiseBurst(flap, t + 0.03, { type: 'bandpass', f0: 600, f1: 250, peak: 0.45, attack: 0.01, decay: 0.75, q: 1.1 });
    }, 50);
  }

  /** an observation drone is shot up: a brighter, longer motor than a missile's, dying away as it climbs */
  observerLaunch(pos: THREE.Vector3) {
    this.voice(pos, 6, (out, t) => {
      this.sample(out, t, 'rakete-start', 0.7, 1.45);
      this.noiseBurst(out, t, { type: 'bandpass', f0: 1800, f1: 3600, peak: 0.35, attack: 0.06, decay: 5, q: 1.3 });
      this.tone(out, t, 'triangle', 900, 1500, 0.04, 0.05, 4);
    }, 60);
  }

  /** its parachute opens: the canopy snaps full of air */
  chute(pos: THREE.Vector3) {
    this.voice(pos, 1.2, (out, t) => {
      this.noiseBurst(out, t, { type: 'bandpass', f0: 1100, f1: 500, peak: 0.6, attack: 0.003, decay: 0.12, q: 1.4 });
      this.tone(out, t, 'sine', 95, 55, 0.35, 0.004, 0.18);
      this.noiseBurst(out, t + 0.08, { type: 'bandpass', f0: 500, f1: 300, peak: 0.15, attack: 0.03, decay: 0.5, q: 1 });
    }, 120);
  }

  /** a Hammerhead leaves the stern: a heavy whoosh, a deep roar under it */
  hammerhead(pos: THREE.Vector3) {
    this.voice(pos, 3, (out, t) => {
      this.sample(out, t, 'rakete-start', 1, 0.62);
      this.noiseBurst(out, t, { type: 'bandpass', f0: 280, f1: 1700, peak: 0.7, attack: 0.12, decay: 2.2, q: 0.9 });
      this.tone(out, t, 'sine', 72, 38, 0.5, 0.02, 0.9);
    }, 70);
  }

  catapult(pos: THREE.Vector3) {
    this.voice(pos, 2.6, (out, t) => {
      this.noiseBurst(out, t, { type: 'bandpass', f0: 300, f1: 3000, peak: 0.5, attack: 0.3, decay: 2.2, q: 0.7 });
      this.tone(out, t + 0.05, 'square', 60, 30, 0.3, 0.01, 0.25); // catapult release clunk
    });
  }

  clunk(pos: THREE.Vector3) {
    this.voice(pos, 0.6, (out, t) => {
      this.tone(out, t, 'square', 110, 50, 0.35, 0.003, 0.3);
      this.noiseBurst(out, t, { type: 'lowpass', f0: 1200, f1: 200, peak: 0.25, attack: 0.002, decay: 0.25 });
    });
  }

  /** UI: kind 'info' short blip, 'good' rising, 'bad' alarm */
  blip(kind: 'info' | 'good' | 'bad' = 'info') {
    this.voice(null, 0.6, (out, t) => {
      if (kind === 'bad') { this.tone(out, t, 'square', 740, 740, 0.12, 0.005, 0.12); this.tone(out, t + 0.16, 'square', 520, 520, 0.12, 0.005, 0.14); }
      else if (kind === 'good') { this.tone(out, t, 'sine', 660, 660, 0.14, 0.005, 0.1); this.tone(out, t + 0.1, 'sine', 990, 990, 0.14, 0.005, 0.16); }
      else this.tone(out, t, 'sine', 880, 880, 0.1, 0.004, 0.08);
    });
  }

  overheat() {
    this.voice(null, 0.7, (out, t) => {
      for (let i = 0; i < 3; i++) this.tone(out, t + i * 0.13, 'square', 1500, 1500, 0.07, 0.003, 0.07);
    });
  }
}
