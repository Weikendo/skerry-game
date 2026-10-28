import * as THREE from 'three';
import type { CarrierController } from '../game/carrierController';
import type { Walrus } from '../game/walrus';
import type { Manta } from '../game/manta';
import type { Input } from '../game/input';
import { SHIP_NAME } from '../game/names';
import { bearing, type Vehicle } from './hud';
import { POINTS } from './fleetStatus';
import { padGlyphs, type GlyphName } from './glyphs';
import { uiScale } from './scale';
import { t, km } from '../i18n';

/** what the combat training needs to see of the game, and may do in it */
export interface TrainingGame {
  carrier: CarrierController;
  walruses: Walrus[];
  mantas: Manta[];
  input: Input;
  pointerLocked(): boolean;
  active(): Vehicle;
  driving(): Walrus | Manta | null;
  /** the laser turret is in hand (its camera) */
  turretInHand(): boolean;
  /** the observation drone: none up, on its way up, or hanging under its chute */
  observer(): 'none' | 'climbing' | 'ready';
  /** looking through the observation drone */
  obsInHand(): boolean;
  /** the target ship (`shipUp`: afloat, not going down) and the middle of the beach with the tanks */
  targets(): { ship: THREE.Vector3; shipUp: boolean; beach: THREE.Vector3; island: string };
  /** a step is done */
  blip(): void;
  /** "Noch einmal": the training from the start */
  restart(): void;
  /** "Training beenden", "Zum Titel" */
  leave(): void;
}

/** what hit a dummy */
export type Shot = 'turret' | 'hammer' | 'skuaLaser' | 'skuaMissile' | 'otterLaser' | 'harbinger';

type StepId = 'turret' | 'observer' | 'hammer' | 'skuaUp' | 'skuaLaser' | 'skuaMissile' | 'otterOut' | 'otterLaser' | 'harbinger' | 'done';
const STEPS: StepId[] = ['turret', 'observer', 'hammer', 'skuaUp', 'skuaLaser', 'skuaMissile', 'otterOut', 'otterLaser', 'harbinger', 'done'];

interface Step {
  done(): boolean;
  text(): string;
  glow?(): string | null;
}

/** hits each step asks for */
const NEED = { turret: 3, skuaLaser: 2 };
/** the console blocks whose buttons light up */
const SHIP = '#deck .ublock[data-g="ship"]', OTTER = '#deck .ublock[data-g="otter"]', SKUA = '#deck .ublock[data-g="skua"]';
/** the keys the cards name: on the keyboard, and the pad's button */
type Act = 'fire' | 'missile' | 'harbinger' | 'hammer' | 'launch' | 'turn';
const KEY: Record<Act, string> = { fire: 'Leertaste', missile: 'X', harbinger: 'X', hammer: 'X', launch: 'L', turn: 'U' };
const PAD_KEY: Record<Act, GlyphName> = { fire: 'rt', missile: 'lt', harbinger: 'rb', hammer: 'a', launch: 'b', turn: 'rs' };

/**
 * The combat training (Hauptmenü → Kampftraining): a short scenario off a quiet island, with no enemy and no
 * saving. A card like the guided first game's names the next step, notices hits on the dummies and moves on: the
 * Stoorworm's laser turret and a Hammerhead at the anchored target ship, then the Skua's laser and an Assassin and
 * the Otter's laser and a Harbinger at the tanks on the beach.
 */
export class Training {
  private el: HTMLDivElement;
  private tn: HTMLElement;
  private th: HTMLElement;
  private tx: HTMLElement;
  private btn: Record<'skip' | 'end' | 'again' | 'title', HTMLButtonElement>;
  /** index in STEPS, -1 while none runs */
  private step = -1;
  private hits: Record<Shot, number> = { turret: 0, hammer: 0, skuaLaser: 0, skuaMissile: 0, otterLaser: 0, harbinger: 0 };
  private kills: Record<Shot, number> = { turret: 0, hammer: 0, skuaLaser: 0, skuaMissile: 0, otterLaser: 0, harbinger: 0 };
  private html = '';
  private lit: Element | null = null;
  private armed = 0;
  private steps: Record<Exclude<StepId, 'done'>, Step>;

  constructor(private g: TrainingGame) {
    this.el = document.createElement('div');
    this.el.id = 'train';
    this.el.className = 'skin';
    this.el.hidden = true;
    this.el.innerHTML = `<section class="sec">
        <header><span class="tn"></span><b class="th"></b><span class="grow"></span>` +
          `<button data-t="skip" title="${t('tut.skipTitle')}">${t('tut.skip')}</button><button data-t="end">${t('train.end')}</button>` +
          `<button data-t="again">${t('train.again')}</button><button data-t="title">${t('train.toTitle')}</button></header>
        <div class="tx"></div>
      </section>`;
    document.body.append(this.el);
    const q = (c: string) => this.el.querySelector<HTMLElement>(c)!;
    this.tn = q('.tn'); this.th = q('.th'); this.tx = q('.tx');
    const b = (k: string) => q(`[data-t="${k}"]`) as HTMLButtonElement;
    this.btn = { skip: b('skip'), end: b('end'), again: b('again'), title: b('title') };
    this.btn.skip.addEventListener('click', () => { this.skip(); this.btn.skip.blur(); });
    this.btn.end.addEventListener('click', () => {
      this.btn.end.blur();
      // a second press ends it
      if (!this.armed) { this.armed = 4; this.btn.end.textContent = t('tut.endConfirm'); this.btn.end.classList.add('arm'); return; }
      this.g.leave();
    });
    this.btn.again.addEventListener('click', () => this.g.restart());
    this.btn.title.addEventListener('click', () => this.g.leave());
    // the messages keep clear of the card
    new ResizeObserver(() => {
      const h = this.el.getBoundingClientRect().height;
      if (h) document.documentElement.style.setProperty('--tut-h', `${(h / uiScale()).toFixed(1)}px`);
    }).observe(this.el);
    this.steps = this.makeSteps();
  }

  get active(): boolean { return this.step >= 0; }

  start() {
    this.step = 0;
    for (const k of Object.keys(this.hits) as Shot[]) { this.hits[k] = 0; this.kills[k] = 0; }
    this.el.hidden = false;
    document.body.classList.add('tut');
    this.html = '';
    this.render();
  }

  /** a dummy was hit by the player */
  hit(shot: Shot, killed: boolean) {
    if (this.step < 0) return;
    this.hits[shot]++;
    if (killed) this.kills[shot]++;
  }

  /** "Überspringen": on to the next step */
  skip() {
    if (this.step < 0 || STEPS[this.step] === 'done') return;
    this.step++;
    this.render();
  }

  /** each frame: what is done, the card, the light on the button */
  update(dt: number) {
    if (this.step < 0) return;
    if (this.armed > 0 && (this.armed -= dt) <= 0) { this.armed = 0; this.btn.end.textContent = t('train.end'); this.btn.end.classList.remove('arm'); }
    let moved = false;
    while (STEPS[this.step] !== 'done' && this.steps[STEPS[this.step] as Exclude<StepId, 'done'>].done()) { this.step++; moved = true; }
    if (moved) this.g.blip();
    this.render();
  }

  // ---------- what the steps look at ----------
  /** the Skua in the air, the Otter out (the one the player is in first) */
  private skuaUp(): Manta | null {
    const d = this.g.driving();
    if (this.g.active() === 'manta' && d && (d as Manta).state === 'flug') return d as Manta;
    return this.g.mantas.find(m => m.state === 'start' || m.state === 'flug') ?? null;
  }
  private otterOut(): Walrus | null {
    const d = this.g.driving();
    if (this.g.active() === 'walrus' && d && (d as Walrus).state === 'fahren') return d as Walrus;
    return this.g.walruses.find(w => w.state === 'aussetzen' || w.state === 'fahren') ?? null;
  }
  private inUnit(v: Walrus | Manta | null): boolean {
    return !!v && this.g.driving() === v;
  }
  /** distance and direction from where the player is (the unit in hand, else the ship) */
  private way(to: THREE.Vector3): { dist: string; dir: string } {
    const from = this.g.driving()?.pos ?? this.g.carrier.pos;
    return { dist: km(Math.hypot(to.x - from.x, to.z - from.z)), dir: POINTS[Math.round(bearing(Math.atan2(to.x - from.x, to.z - from.z)) / 45) % 8] };
  }

  // ---------- keys by the device in hand ----------
  private pad(): boolean {
    const inp = this.g.input;
    return inp.lastDevice === 'pad' && !!inp.padName;
  }
  private key(a: Act): string {
    return this.pad() ? padGlyphs(this.g.input.padKind)[PAD_KEY[a]] : `<kbd>${a === 'fire' ? t('train.space') : KEY[a]}</kbd>`;
  }
  /** how to aim (a sentence): with the mouse only once the Trackpad button has caught the pointer */
  private aim(): string {
    if (this.pad()) return t('train.aim.pad', padGlyphs(this.g.input.padKind));
    return this.g.pointerLocked() ? t('train.aim.ptr') : t('train.aim.keys', { btn: t('cambar.ptr') });
  }
  /** while the mouse does not aim yet, the Trackpad button lights up */
  private ptrGlow(): string | null {
    return this.pad() || this.g.pointerLocked() ? null : '#cambar [data-c="ptr"]';
  }
  private controls(what: 'drive' | 'fly'): string {
    if (this.pad()) return t(what === 'drive' ? 'tut.drive.pad' : 'tut.fly.pad', padGlyphs(this.g.input.padKind));
    const ptr = this.g.pointerLocked();
    return t(what === 'drive' ? (ptr ? 'tut.drive.ptr' : 'tut.drive.keys') : (ptr ? 'tut.fly.ptr' : 'tut.fly.keys'));
  }
  private count(n: number, of: number): string {
    return ` <b>(${Math.min(n, of)}/${of})</b>`;
  }
  /** for the Skua: how to turn about after flying past */
  private turnHint(): string {
    return `<small>${t('train.turnHint', { key: this.key('turn'), btn: t('cmd.turn') })}</small>`;
  }
  /** while the target ship goes down: that a new one comes */
  private shipNote(): string {
    return this.g.targets().shipUp ? '' : `<span class="note">${t('train.shipDown')}</span>`;
  }

  // ---------- the steps ----------
  private makeSteps(): Record<Exclude<StepId, 'done'>, Step> {
    const g = this.g;
    return {
      turret: {
        done: () => this.hits.turret >= NEED.turret,
        text: () => {
          const w = this.way(g.targets().ship);
          if (!g.turretInHand()) return t('train.turret', { ship: SHIP_NAME, btn: t('helm.turret'), ...w }) + this.shipNote();
          return t('train.turretAim', { aim: this.aim(), fire: this.key('fire') }) + this.count(this.hits.turret, NEED.turret) + this.shipNote();
        },
        glow: () => (g.turretInHand() ? this.ptrGlow() : '#helm [data-h="turret"]'),
      },
      observer: {
        done: () => g.observer() === 'ready' || this.hits.hammer > 0,
        text: () => (g.observer() === 'climbing' ? t('train.observerUp')
          : t('train.observer', { key: this.key('hammer'), btn: t('cmd.hammer'), ship: SHIP_NAME })),
        glow: () => (g.observer() === 'none' ? `${SHIP} button[data-cmd="hammer"]` : null),
      },
      hammer: {
        done: () => this.hits.hammer > 0,
        text: () => {
          if (g.observer() === 'none') return t('train.observer', { key: this.key('hammer'), btn: t('cmd.hammer'), ship: SHIP_NAME });
          if (!g.obsInHand()) return t('train.hammerView', { key: this.key('hammer'), btn: t('cmd.hammer') });
          return t('train.hammer', { aim: this.aim(), fire: this.key('fire'), key: this.key('hammer') }) + this.shipNote();
        },
        glow: () => (g.obsInHand() ? this.ptrGlow() : `${SHIP} button[data-cmd="hammer"]`),
      },
      skuaUp: {
        done: () => { const m = this.skuaUp(); return !!m && m.state === 'flug' && this.inUnit(m); },
        text: () => (!this.skuaUp() ? t('train.skuaUp', { btn: t('cmd.start'), key: this.key('launch') })
          : t('train.board', { btn: t('map.cockpit'), unit: this.skuaUp()!.name })),
        glow: () => (!this.skuaUp() ? `${SKUA} button[data-cmd="launch"]` : `${SKUA} [data-h="cockpit"]`),
      },
      skuaLaser: {
        done: () => this.hits.skuaLaser >= NEED.skuaLaser,
        text: () => {
          const m = this.skuaUp();
          if (!m || !this.inUnit(m)) return this.steps.skuaUp.text();
          const tg = g.targets();
          return t('train.skuaLaser', { island: tg.island, ...this.way(tg.beach), fly: this.controls('fly'), fire: this.key('fire') }) + this.count(this.hits.skuaLaser, NEED.skuaLaser) + this.turnHint();
        },
        glow: () => (this.inUnit(this.skuaUp()) ? null : this.steps.skuaUp.glow!()),
      },
      skuaMissile: {
        done: () => this.hits.skuaMissile > 0,
        text: () => {
          const m = this.skuaUp();
          if (!m || !this.inUnit(m)) return this.steps.skuaUp.text();
          if (m.missiles <= 0 && !this.hits.skuaMissile) return t('train.skuaNoMissile', { btn: t('cmd.land') });
          return t('train.skuaMissile', { key: this.key('missile'), n: m.missiles }) + this.turnHint();
        },
        glow: () => (this.inUnit(this.skuaUp()) ? null : this.steps.skuaUp.glow!()),
      },
      otterOut: {
        done: () => { const w = this.otterOut(); return !!w && w.state === 'fahren' && this.inUnit(w); },
        text: () => (!this.otterOut() ? t('train.otterOut', { btn: t('cmd.launch'), key: this.key('launch') })
          : t('train.board', { btn: t('map.cockpit'), unit: this.otterOut()!.name })),
        glow: () => (!this.otterOut() ? `${OTTER} button[data-cmd="launch"]` : `${OTTER} [data-h="cockpit"]`),
      },
      otterLaser: {
        done: () => this.kills.otterLaser > 0,
        text: () => {
          const w = this.otterOut();
          if (!w || !this.inUnit(w)) return this.steps.otterOut.text();
          const tg = g.targets();
          return t('train.otterLaser', { island: tg.island, ...this.way(tg.beach), drive: this.controls('drive'), aim: this.aim(), fire: this.key('fire') });
        },
        glow: () => (this.inUnit(this.otterOut()) ? this.ptrGlow() : this.steps.otterOut.glow!()),
      },
      harbinger: {
        done: () => this.hits.harbinger > 0,
        text: () => {
          const w = this.otterOut();
          if (!w || !this.inUnit(w)) return this.steps.otterOut.text();
          if (w.guided) return t('train.harbingerFly', { steer: this.pad() ? padGlyphs(this.g.input.padKind).ls : '<kbd>W</kbd>/<kbd>S</kbd>/<kbd>A</kbd>/<kbd>D</kbd>', m: Math.round(w.guided.travelled) });
          if (w.load.cargo !== 'harbinger' || w.load.missiles <= 0) return t('train.harbingerEmpty');
          return t('train.harbinger', { key: this.key('harbinger'), n: w.load.missiles, dist: km(Math.hypot(g.targets().beach.x - w.pos.x, g.targets().beach.z - w.pos.z)) });
        },
        glow: () => (this.inUnit(this.otterOut()) ? null : this.steps.otterOut.glow!()),
      },
    };
  }

  // ---------- the card ----------
  private render() {
    const id = STEPS[this.step], last = id === 'done';
    const text = last ? t('train.done', { ship: SHIP_NAME }) : this.steps[id].text();
    const glow = last ? null : this.steps[id].glow?.() ?? null;
    const num = last ? '✓' : t('tut.step', { n: this.step + 1, total: STEPS.length - 1 });
    const head = `${num}|${id}|${text}`;
    if (head !== this.html) {
      this.html = head;
      this.tn.textContent = num;
      this.th.textContent = t(`train.h.${id}`);
      this.tx.innerHTML = text;
      this.btn.skip.hidden = last; this.btn.end.hidden = last; this.btn.again.hidden = !last; this.btn.title.hidden = !last;
    }
    this.light(glow ? document.querySelector(glow) : null);
  }

  /** the button meant lights up in gold (looked up each frame: the console rebuilds its buttons now and then) */
  private light(el: Element | null) {
    if (el === this.lit && el?.classList.contains('tut-glow')) return;
    this.lit?.classList.remove('tut-glow');
    this.lit = el;
    el?.classList.add('tut-glow');
  }
}
