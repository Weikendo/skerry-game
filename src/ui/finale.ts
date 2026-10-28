import * as THREE from 'three';
import { t } from '../i18n';

/** what the film looks at: the sinking ship (x across it, z along it; `deck` the height its deck sinks to), and the
 *  ground's height (a camera over an island stays above it) */
export interface FinaleShip {
  localToWorld(x: number, z: number): THREE.Vector3;
  readonly deck: number;
  ground(x: number, z: number): number;
}

/**
 * One shot of the film, in the ship's frame: where the camera is and what it looks at, from the shot's start (`a`) to
 * its end (`b`), eased; `fov` its field of view
 */
interface Shot { seconds: number; fov: number; a: { eye: [number, number, number]; look: [number, number, number] }; b: { eye: [number, number, number]; look: [number, number, number] } }

/** x across the ship, y up (over its deck for the look), z along it (bow +100, stern −100) */
const SHOTS: Shot[] = [
  // wide from off the bow, low over the water, slowly closing in
  { seconds: 5.5, fov: 45, a: { eye: [-330, 16, 420], look: [0, 6, 0] }, b: { eye: [-260, 14, 330], look: [0, 6, -10] } },
  // from above, circling
  { seconds: 5, fov: 50, a: { eye: [180, 230, -150], look: [0, 0, 10] }, b: { eye: [230, 210, 60], look: [0, 0, -10] } },
  // close along the burning hull, stern to bow
  { seconds: 5, fov: 55, a: { eye: [110, 9, -170], look: [0, 10, -40] }, b: { eye: [115, 11, 30], look: [0, 10, 60] } },
  // just over the waves on the far side, rising a little
  { seconds: 5, fov: 42, a: { eye: [-300, 6, -200], look: [0, 8, 0] }, b: { eye: [-280, 14, -150], look: [0, 6, 10] } },
  // pulling back and up while it goes under
  { seconds: 7, fov: 50, a: { eye: [420, 60, 120], look: [0, 2, 0] }, b: { eye: [650, 120, 200], look: [0, 0, 0] } },
];

/** s before the word comes up, and before the hint under it */
const WORD_AT = 4;
const HINT_AFTER = 1.6;

/**
 * The end of a carrier as a short film: the picture cuts between cameras round the sinking ship, the console and its
 * screens out of the way; after a few seconds a big word comes up over it ("Victory" for the enemy's, "Defeat" for
 * the player's own) and stays until a click (a key, a pad button), then the end screen follows. Before the word is
 * up, a click brings it at once.
 */
export class Finale {
  on = false;
  /** after the film, its last picture stays behind the end screen (until release()) */
  private held = false;
  private time = 0;
  private word = false;
  private ship: FinaleShip | null = null;
  private done: () => void = () => {};
  private el: HTMLDivElement;
  private hint: HTMLDivElement;
  private eye = new THREE.Vector3();
  private look = new THREE.Vector3();

  /** the word comes up (the game starts the victory's music then) */
  onWord: (won: boolean) => void = () => {};
  private won = true;
  private wordEl: HTMLDivElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'finale';
    this.el.innerHTML = `<div class="word"></div><div class="hint">${t('finale.go')}</div>`;
    this.hint = this.el.querySelector('.hint')!;
    this.wordEl = this.el.querySelector('.word')!;
    document.body.append(this.el);
    this.el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.next(); });
    // any key goes on too, and nothing else hears it meanwhile (Esc would open the pause menu over the film)
    addEventListener('keydown', (e) => {
      if (!this.on || e.repeat || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      this.next();
    }, true);
  }

  /** the film starts (`won`: the enemy's carrier goes down, else the player's own); `done` once the player has clicked
   *  on through. A film already running gives way to it */
  start(ship: FinaleShip, won: boolean, done: () => void) {
    this.on = true;
    this.held = false;
    this.won = won;
    this.wordEl.textContent = t(won ? 'finale.won' : 'finale.lost');
    this.ship = ship;
    this.done = done;
    this.time = 0;
    this.word = false;
    this.hint.classList.remove('up');
    this.el.className = won ? 'on' : 'on lost';
    document.body.classList.add('finale');
  }

  /** it ends without going on (the game ended otherwise meanwhile) */
  stop() {
    if (!this.on) return;
    this.on = false;
    this.el.className = '';
    document.body.classList.remove('finale');
  }

  /** a click, a key or a pad button: the word now, or on to the end screen */
  next() {
    if (!this.on) return;
    if (!this.word) { this.time = Math.max(this.time, WORD_AT); return; }
    if (this.time < this.wordTime + 0.6) return;
    this.stop();
    this.held = true;
    this.done();
  }

  /** the end screen is closed (play on): the game's own cameras again */
  release() { this.held = false; }

  private wordTime = 0;

  /** each frame after the game's cameras: the film's camera */
  update(dt: number, camera: THREE.PerspectiveCamera) {
    if (this.held && !this.on) { camera.position.copy(this.eye); camera.up.set(0, 1, 0); camera.lookAt(this.look); return; }
    if (!this.on || !this.ship) return;
    this.time += dt;
    if (!this.word && this.time >= WORD_AT) {
      this.word = true;
      this.wordTime = this.time;
      this.el.className = this.won ? 'on word-up' : 'on lost word-up';
      this.onWord(this.won);
    }
    if (this.word && this.time >= this.wordTime + HINT_AFTER) this.hint.classList.add('up');
    // the shot, round and round while the player watches
    const total = SHOTS.reduce((a, s) => a + s.seconds, 0);
    let t = this.time % total, i = 0;
    while (t >= SHOTS[i].seconds) { t -= SHOTS[i].seconds; i++; }
    const s = SHOTS[i], k = t / s.seconds, e = k * k * (3 - 2 * k);
    const ship = this.ship;
    const at = (p: [number, number, number], q: [number, number, number], out: THREE.Vector3, overDeck: boolean) => {
      const x = p[0] + (q[0] - p[0]) * e, y = p[1] + (q[1] - p[1]) * e, z = p[2] + (q[2] - p[2]) * e;
      // (once the hull is under, the look stays on the water where it went down)
      return out.copy(ship.localToWorld(x, z)).setY(overDeck ? Math.max(-6, ship.deck) + y : y);
    };
    at(s.a.eye, s.b.eye, this.eye, false);
    at(s.a.look, s.b.look, this.look, true);
    this.eye.y = Math.max(this.eye.y, ship.ground(this.eye.x, this.eye.z) + 25);
    camera.position.copy(this.eye);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.look);
    if (Math.abs(camera.fov - s.fov) > 1e-3) { camera.fov = s.fov; camera.updateProjectionMatrix(); }
  }
}
