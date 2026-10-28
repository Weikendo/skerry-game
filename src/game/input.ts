export interface InputLike {
  down(...codes: string[]): boolean;
  hit(...codes: string[]): boolean;
  /** -1..+1 from a pair of code groups (analog for gamepad sticks) */
  axis(neg: string[], pos: string[]): number;
}

// Gamepad codes ("standard" mapping, Xbox / PlayStation / most Bluetooth pads), named by the Xbox labels
// (A = the bottom face button, ✕ on a PlayStation pad). Sticks are split into half axes so they slot into the
// same code groups as keys: 'Pad.LY-' = left stick up, 'Pad.RX+' = right stick right, and so on. 'Pad.TY' is
// the left stick's Y without the curve, for the throttle (half a throw is half the speed).
const PAD_BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'LS', 'RS', 'Up', 'Down', 'Left', 'Right'];
const TRIGGERS = new Set(['LT', 'RT']);

export type PadKind = 'playstation' | 'xbox';

/** the controller settings (Einstellungen → Controller), kept in this browser */
export interface PadSettings {
  /** button pictures in the help: by the connected pad, or fixed */
  glyphs: 'auto' | PadKind;
  /** round dead zone of each stick (0..1 of its throw) */
  deadzone: number;
  /** 0 = linear, 1 = cubic: how much finer small stick throws steer */
  curve: number;
  /** speed of the camera on the right stick */
  lookSpeed: number;
  invertLook: boolean;
  /** the Skua climbs and dives the other way round, with every device (keys, pad, trackpad): Einstellungen → Steuerung */
  invertPitch: boolean;
  rumble: boolean;
  rumbleStrength: number;
  /** light aim assist: the camera turns slower over an enemy (never follows by itself) */
  aimAssist: boolean;
}
export const PAD_DEFAULTS: PadSettings = {
  glyphs: 'auto', deadzone: 0.12, curve: 0.6, lookSpeed: 1, invertLook: false, invertPitch: false, rumble: true, rumbleStrength: 0.7,
  aimAssist: true,
};
const SETTINGS_KEY = 'skerry-pad';
/** a worn stick may never quite reach the rim */
const OUTER = 0.96;
/** triggers fire from 0.30 and let go below 0.20; sticks used as buttons from 0.6 and below 0.4 */
const TRIGGER_ON = 0.3, TRIGGER_OFF = 0.2, AXIS_ON = 0.6, AXIS_OFF = 0.4;

/**
 * Keyboard and gamepad state: held codes, one-shot presses (consumed per frame)
 * and analog values. Letter keys follow the printed label (a German QWERTZ
 * keyboard's Z is 'KeyZ' here, not its US position 'KeyY').
 *
 * Sticks get a round dead zone (a slightly crooked stick does not snap to an
 * axis) and a curve, so small throws steer finely and full throws still reach 1.
 */
export class Input implements InputLike {
  /** same codes, but presses never fire — for extra simulation sub-steps */
  readonly heldOnly: InputLike = {
    down: (...c) => this.down(...c),
    hit: () => false,
    axis: (n, p) => this.axis(n, p),
  };
  /** keyboard only (while a window such as the stores is open, the pad does nothing in the game) */
  readonly keysOnly: InputLike = {
    down: (...c) => this.down(...c.filter(k => !k.startsWith('Pad.'))),
    hit: (...c) => this.hit(...c.filter(k => !k.startsWith('Pad.'))),
    axis: (n, p) => this.axis(n.filter(k => !k.startsWith('Pad.')), p.filter(k => !k.startsWith('Pad.'))),
  };
  /** name of the connected gamepad, '' if none */
  padName = '';
  /** which the player used last, for the help line */
  lastDevice: 'keys' | 'pad' = 'keys';
  /** a pad was connected (its name, and whether it has the standard button layout) */
  onConnect: ((name: string, standard: boolean) => void) | null = null;
  settings: PadSettings = { ...PAD_DEFAULTS };

  private held = new Set<string>();
  private pressed = new Set<string>();
  private analog = new Map<string, number>();
  private physical = new Map<string, string>(); // e.code → code used on keydown
  private pad: Gamepad | null = null;
  /** seconds the right stick has been held at the rim (camera acceleration) */
  private rimFor = 0;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const k = Input.codeOf(e);
      this.physical.set(e.code, k);
      if (!this.held.has(k)) this.pressed.add(k);
      this.held.add(k);
      this.lastDevice = 'keys';
      if (k.startsWith('Arrow') || k === 'Space' || k === 'PageUp' || k === 'PageDown' || k === 'Tab') e.preventDefault();
    });
    target.addEventListener('keyup', (e) => {
      this.held.delete(this.physical.get(e.code) ?? Input.codeOf(e));
      this.physical.delete(e.code);
    });
    target.addEventListener('blur', () => { this.held.clear(); this.physical.clear(); });
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
      // (the inversion was the pad's alone at first)
      if (saved.invertSkua !== undefined && saved.invertPitch === undefined) saved.invertPitch = saved.invertSkua;
      delete saved.invertSkua;
      Object.assign(this.settings, saved);
    } catch { /* storage blocked */ }
  }

  saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* storage blocked */ }
  }

  private static codeOf(e: KeyboardEvent): string {
    // letters by their label, everything else by position
    return /^[a-zA-Z]$/.test(e.key) && e.code.startsWith('Key') ? `Key${e.key.toUpperCase()}` : e.code;
  }

  /** the connected pad's maker, from its name (Sony's vendor id 054c), for the button pictures */
  get padKind(): PadKind {
    if (this.settings.glyphs !== 'auto') return this.settings.glyphs;
    return /054c|dualsense|dualshock|playstation/i.test(this.padName) ? 'playstation' : 'xbox';
  }

  /** read the first connected gamepad (one with the standard layout first); call once per frame before the game reads input */
  pollGamepad() {
    const pads = Array.from((typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : []) ?? []).filter((p): p is Gamepad => !!p && p.connected);
    const pad = pads.find(p => p.mapping === 'standard') ?? pads[0] ?? null;
    const name = pad ? pad.id : '';
    if (name && name !== this.padName) this.onConnect?.(name, pad!.mapping === 'standard');
    this.padName = name;
    this.pad = pad;
    if (!pad) {
      // the pad's codes let go (the trackpad's 'Ptr.…' stay: cleared here, a held click would count as a new one each frame)
      for (const k of [...this.analog.keys()]) if (k.startsWith('Pad.')) { this.held.delete(k); this.analog.delete(k); }
      return;
    }
    let used = false;
    const set = (code: string, v: number, on: number, off: number) => {
      const was = this.held.has(code);
      this.analog.set(code, v);
      if (was ? v >= off : v >= on) { if (!was) this.pressed.add(code); this.held.add(code); }
      else this.held.delete(code);
    };
    PAD_BUTTONS.forEach((name, i) => {
      const b = pad.buttons[i], v = b ? Math.max(b.value, b.pressed ? 1 : 0) : 0;
      if (TRIGGERS.has(name)) set(`Pad.${name}`, v, TRIGGER_ON, TRIGGER_OFF);
      else set(`Pad.${name}`, v, 0.5, 0.5);
      if (v > TRIGGER_ON) used = true;
    });
    const stick = (side: 'L' | 'R', ix: number) => {
      const [x, y] = this.shape(pad.axes[ix] ?? 0, pad.axes[ix + 1] ?? 0, this.settings.curve);
      if (x || y) used = true;
      set(`Pad.${side}X-`, Math.max(0, -x), AXIS_ON, AXIS_OFF); set(`Pad.${side}X+`, Math.max(0, x), AXIS_ON, AXIS_OFF);
      set(`Pad.${side}Y-`, Math.max(0, -y), AXIS_ON, AXIS_OFF); set(`Pad.${side}Y+`, Math.max(0, y), AXIS_ON, AXIS_OFF);
      return y;
    };
    stick('L', 0);
    stick('R', 2);
    const ty = this.shape(pad.axes[0] ?? 0, pad.axes[1] ?? 0, 0)[1];
    set('Pad.TY-', Math.max(0, -ty), AXIS_ON, AXIS_OFF); set('Pad.TY+', Math.max(0, ty), AXIS_ON, AXIS_OFF);
    if (used) this.lastDevice = 'pad';
  }

  /** round dead zone, a little outer dead zone, then the curve `c`: 0 inside, 1 at the rim, finer in between */
  private shape(x: number, y: number, c: number): [number, number] {
    const m = Math.hypot(x, y), dz = this.settings.deadzone;
    if (m <= dz) return [0, 0];
    const s = Math.min(1, (m - dz) / (OUTER - dz));
    const k = ((1 - c) * s + c * s * s * s) / m;
    return [x * k, y * k];
  }

  /**
   * The right stick as camera turn rates (-1..1 and a little beyond): held at the rim for 0.2 s it speeds up
   * to 1.6× over 0.4 s, so a long turn is quick and a small one stays fine.
   */
  look(dt: number): { x: number; y: number } {
    const x = this.axis(['Pad.RX-'], ['Pad.RX+']), y = this.axis(['Pad.RY+'], ['Pad.RY-']);
    this.rimFor = Math.hypot(x, y) > 0.95 ? this.rimFor + dt : 0;
    const boost = 1 + 0.6 * Math.min(1, Math.max(0, this.rimFor - 0.2) / 0.4);
    const k = this.settings.lookSpeed * boost;
    return { x: x * k, y: y * k * (this.settings.invertLook ? -1 : 1) };
  }

  /** a rumble on the pad, if it has one, the setting allows it and the pad is in hand; strong/weak 0..1 */
  rumble(strong: number, weak: number, ms: number) {
    if (!this.settings.rumble || this.lastDevice !== 'pad') return;
    const act = (this.pad as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null)?.vibrationActuator;
    const k = this.settings.rumbleStrength, c = (v: number) => Math.min(1, Math.max(0, v * k));
    act?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: c(strong), weakMagnitude: c(weak) })?.catch(() => { /* no motor */ });
  }

  /** another device's code for this frame ('Ptr.…' from the trackpad), 0..1, pressed when it crosses 0.5 */
  feed(code: string, v: number) {
    const was = this.held.has(code);
    this.analog.set(code, v);
    if (v >= 0.5) { if (!was) this.pressed.add(code); this.held.add(code); }
    else this.held.delete(code);
  }

  /** 0..1: keys are 0 or 1, gamepad codes analog */
  value(code: string): number {
    return this.analog.get(code) ?? (this.held.has(code) ? 1 : 0);
  }

  down(...codes: string[]): boolean {
    return codes.some(c => this.held.has(c));
  }

  /** true once per key press */
  hit(...codes: string[]): boolean {
    return codes.some(c => this.pressed.has(c));
  }

  axis(neg: string[], pos: string[]): number {
    const max = (codes: string[]) => codes.reduce((m, c) => Math.max(m, this.value(c)), 0);
    return Math.max(-1, Math.min(1, max(pos) - max(neg)));
  }

  endFrame() {
    this.pressed.clear();
  }
}

export const KEYS = {
  forward: ['KeyW', 'ArrowUp', 'Pad.TY-'],
  back: ['KeyS', 'ArrowDown', 'Pad.TY+'],
  left: ['KeyA', 'ArrowLeft', 'Pad.LX-'],
  right: ['KeyD', 'ArrowRight', 'Pad.LX+'],
  fire: ['Space', 'Pad.RT', 'Ptr.Fire'],
  missile: ['KeyX', 'Pad.LT', 'Ptr.Second'],
  /** the Otter's Harbinger (its LT and second click zoom the camera) */
  harbinger: ['KeyX', 'Pad.RB'],
  /** the speed step: the ship's gear, the Otter's cruise control, the Skua's thrust step, the drone's pace */
  faster: ['Pad.Up', 'Ptr.Faster'],
  slower: ['Pad.Down', 'Ptr.Slower'],
};

/**
 * Key map (no key does two things):
 *  vehicles   W/S A/D (+ Skua Q/E rudder, R/F thrust; drone Q/E sideways, R/F up/down,
 *             PageUp/PageDown camera tilt), Space fire, X missile, L launch / land, K cargo (Otter) or Quaker (Skua)
 *  general    V unit, C cameras (Shift+C back), I island cameras, M map, G stores & supply, Z time warp,
 *             T time, 1-4 weather, N sound, H hide UI
 *  developer  O free camera, B drivability overlay
 * Gamepad (only the units; map, stores and menus stay with the mouse), the same pattern for every unit:
 *  left stick steer (Otter: and throttle, Skua: pitch and roll, drone: climb and turn), right stick camera
 *  (Skua: thrust and rudder, drone: forward and sideways as on a real drone remote), D-pad up/down speed step,
 *  RT fire, LT Skua missile, X cargo (Otter) or Quaker (Skua), B launch/land, Y next camera, L3 camera straight
 *  ahead, LB/RB drone camera tilt, LT drone zoom, Start pause.
 * Trackpad / mouse (src/game/pointer.ts, 'Ptr.…' codes): a click into the picture captures the pointer; the finger
 *  aims (Skua: flies), click fire, two-finger click Otter aim mode / Skua missile, two-finger swipe speed step,
 *  pinch zoom, Esc lets the pointer go.
 */
