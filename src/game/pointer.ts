/** settings for the trackpad and the mouse (Einstellungen → Trackpad und Maus), kept in this browser */
export interface PointerSettings {
  /** a click into the picture captures the pointer too (off by default: testers found it confusing; the camera bar's
   *  trackpad button does it; the setting used to be called `capture` and on) */
  clickCapture: boolean;
  /** how far the camera turns, or the Skua's stick moves, per finger travel */
  sensitivity: number;
  /** the camera up and down the other way round (the Skua: Einstellungen → Steuerung) */
  invertY: boolean;
  /** swipe up = slower (for "natural scrolling" switched off) */
  invertSwipe: boolean;
}
export const POINTER_DEFAULTS: PointerSettings = { clickCapture: false, sensitivity: 1, invertY: false, invertSwipe: false };
const SETTINGS_KEY = 'skerry-pointer';
/** swipe travel (wheel delta) per speed step */
const STEP = 90;

/**
 * Keyboard + trackpad (or mouse) in the game. The camera bar's trackpad button captures the pointer (Pointer Lock;
 * Esc lets it go), a click into the picture only when the settings say so. Then the finger turns the camera and aims, a click fires, a two-finger click (or Ctrl+click) is
 * the second button, a two-finger swipe sets the speed step and a pinch zooms. For the Skua the finger is a
 * stick that springs back to the middle.
 *
 * The game reads it once per frame with `frame()`; the event handlers are public so tests can drive it without
 * a real pointer lock.
 */
export class PointerControl {
  settings: PointerSettings = { ...POINTER_DEFAULTS };
  /** the pointer is captured (the game takes it) */
  locked = false;
  /** when it was last let go (the Esc that let it go must not also open the menu) */
  releasedAt = -Infinity;
  /** the finger as a stick (-1..1 each way), springing back when it rests */
  readonly stick = { x: 0, y: 0 };

  private moveX = 0;
  private moveY = 0;
  private swipe = 0;
  private thrust = 0;
  private pinch = 0;
  private down = [false, false];
  /** pressed since the last frame (a click shorter than a frame still counts) */
  private clicked = [false, false];
  /** the held button came as Ctrl+click (it is the second one until it is let go) */
  private ctrlClick = false;

  constructor(private dom: HTMLElement, private allowed: () => boolean) {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
      delete saved.capture;   // (the old click setting: everyone starts with the button now)
      Object.assign(this.settings, saved);
    } catch { /* storage blocked */ }
    dom.addEventListener('click', () => { if (!this.locked && this.settings.clickCapture) this.capture(); });
    document.addEventListener('pointerlockchange', () => this.setLocked(document.pointerLockElement === dom));
    // Safari keeps the first Esc for itself while the pointer is captured: the page gets only its keyup, and the
    // pointer stays captured until a second press (measured in Safari 27). Let it go on that keyup (elsewhere the
    // browser has let it go by then)
    addEventListener('keyup', (e) => { if (e.code === 'Escape' && this.locked) this.release(); });
    document.addEventListener('mousemove', (e) => { if (this.locked) this.onMove(e.movementX, e.movementY); });
    dom.addEventListener('mousedown', (e) => { if (this.locked) this.onButton(e.button, true, e.ctrlKey); });
    addEventListener('mouseup', (e) => { if (this.locked) this.onButton(e.button, false, e.ctrlKey); });
    dom.addEventListener('contextmenu', (e) => { if (this.locked) e.preventDefault(); });
    // capture first, so the camera's own wheel zoom does not also act
    dom.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      this.onWheel(e.deltaY, e.ctrlKey);
      e.preventDefault();
      e.stopImmediatePropagation();
    }, { passive: false, capture: true });
  }

  saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* storage blocked */ }
  }

  /** the trackpad and mouse take the camera and the aim (from a click: browsers only allow it then) */
  capture() {
    if (!this.locked && this.allowed()) (this.dom.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => { /* refused */ });
  }

  release() {
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }

  setLocked(on: boolean) {
    if (this.locked && !on) {
      this.releasedAt = performance.now();
      this.down = [false, false];
      this.stick.x = this.stick.y = 0;
    }
    this.locked = on;
  }

  onMove(dx: number, dy: number) {
    const k = this.settings.sensitivity;
    this.moveX += dx * k;
    this.moveY += dy * k;
  }

  /** button 0 = click, 2 = two-finger click (Ctrl+click counts as that too, as on the Mac) */
  onButton(button: number, down: boolean, ctrl = false) {
    if (button !== 0 && button !== 2) return;
    if (down && button === 0) this.ctrlClick = ctrl;
    const b = button === 2 || this.ctrlClick ? 1 : 0;
    if (down) this.clicked[b] = true;
    this.down[b] = down;
    if (!down && button === 0) this.ctrlClick = false;
  }

  /** a two-finger swipe (natural scrolling: fingers up = positive) or, with Ctrl, a pinch (fingers apart = negative) */
  onWheel(deltaY: number, ctrl: boolean) {
    if (ctrl) { this.pinch += deltaY; return; }
    const d = deltaY * (this.settings.invertSwipe ? -1 : 1);
    this.swipe += d;
    this.thrust += d;
  }

  /**
   * What happened since the last frame: the camera turn in pixels, the fire buttons (held, or clicked since),
   * whole speed steps from swiping, the Skua's thrust change from swiping (0..1 scale), the zoom factor from a
   * pinch. The finger stick moves with the travel (full throw after about 125 px) and stays where the finger
   * rests, drifting back to the middle only slowly, so a turn can be held without rubbing the trackpad.
   */
  frame(dt: number) {
    const look = { x: this.moveX, y: this.moveY * (this.settings.invertY ? -1 : 1) };
    const back = Math.exp(-dt * 0.8);
    this.stick.x = Math.max(-1, Math.min(1, this.stick.x * back + this.moveX * 0.008));
    this.stick.y = Math.max(-1, Math.min(1, this.stick.y * back + this.moveY * 0.008));
    const l = Math.hypot(this.stick.x, this.stick.y);
    if (l > 1) { this.stick.x /= l; this.stick.y /= l; }
    const fire = this.down[0] || this.clicked[0], second = this.down[1] || this.clicked[1];
    const steps = Math.trunc(this.swipe / STEP);
    this.swipe -= steps * STEP;
    const out = { look, fire, second, firstPress: this.clicked[0], secondPress: this.clicked[1], steps, thrust: this.thrust * 0.0015, zoom: Math.exp(-this.pinch * 0.01) };
    this.moveX = this.moveY = this.thrust = this.pinch = 0;
    this.clicked = [false, false];
    return out;
  }
}
