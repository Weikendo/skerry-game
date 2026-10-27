import type { Archipelago } from '../world/archipelago';
import type { IslandBase } from '../world/base';
import { SLOPE } from '../world/terrain';
import type { CarrierController } from '../game/carrierController';
import type { Walrus } from '../game/walrus';
import type { Manta } from '../game/manta';
import type { Input } from '../game/input';
import { TRANSFER_RANGE } from '../game/transfer';
import { SHIP_NAME, ENEMY_SHIP_NAME } from '../game/names';
import { bearing, type Vehicle } from './hud';
import { POINTS } from './fleetStatus';
import { padGlyphs, type GlyphName } from './glyphs';
import { uiScale } from './scale';
import { t, km } from '../i18n';

/** what the guided first game needs to see of the game, and may do in it */
export interface TutorialGame {
  world: Archipelago;
  bases: IslandBase[];
  carrier: CarrierController;
  walruses: Walrus[];
  mantas: Manta[];
  input: Input;
  /** the pointer is captured (a click into the picture: the mouse or trackpad turns the camera, Esc lets it go) */
  pointerLocked(): boolean;
  /** a click into the picture captures the pointer at all (Einstellungen → Trackpad und Maus) */
  mapOpen(): boolean;
  supplyOpen(): boolean;
  /** the kind of unit the player drives, and which Otter or Skua that is */
  active(): Vehicle;
  driving(): Walrus | Manta | null;
  timewarp(): number;
  setTimewarp(n: number): void;
  /** the console's islands section shows island k (and the map, if it is open) */
  showIsland(k: number): void;
  /** the enemy keeps still (true); let go, its deadlines start as in a new game (false) */
  holdEnemy(on: boolean): void;
  notify(text: string, cls?: string): void;
  /** a step is done */
  blip(): void;
}

export type TutorialStep = 'mouse' | 'map' | 'course' | 'warp' | 'arrive' | 'cargo' | 'launch' | 'land' | 'drop' | 'home' | 'stores' | 'skua' | 'done';
const STEPS: TutorialStep[] = ['mouse', 'map', 'course', 'warp', 'arrive', 'cargo', 'launch', 'land', 'drop', 'home', 'stores', 'skua', 'done'];

/** what a save keeps of it (null: no tutorial running) */
export interface TutorialState {
  step: TutorialStep; island: number; plot: { k: number; x: number; z: number } | null; flown: number; founded: boolean; skipped: TutorialStep[];
}

interface Step {
  /** the condition that moves on */
  done(): boolean;
  /** passed over: an optional step already done another way, or one that cannot be done now */
  skip?(): boolean;
  /** the earlier step to go back to when what this one builds on was undone (a course cleared, the Otter back aboard) */
  back?(): TutorialStep | null;
  /** the card's text (HTML) */
  text(): string;
  /** the button that lights up (a selector) */
  glow?(): string | null;
}

/** the player finished (or ended) it once: "Mit Einführung" is off from then on */
const DONE_KEY = 'skerry-tutorial-done';
export function tutorialDone(): boolean {
  try { return localStorage.getItem(DONE_KEY) === '1'; } catch { return false; }
}
function markDone() {
  try { localStorage.setItem(DONE_KEY, '1'); } catch { /* storage blocked */ }
}

/** seconds in the Skua's seat in the air before the last step counts as done */
const FLIGHT = 15;
/** a neutral island with cliffs is suggested only if no other lies within this much further (m) */
const CLIFF_DETOUR = 8000;
/** the Stoorworm has arrived once it lies without a course this close (m) to the berth the map chose, or to the island's square after a waypoint set by hand */
const ARRIVED = { berth: 700, island: 2000 };
/** the last card closes by itself after this long (s) */
const DONE_SHOWN = 40;
/** the console blocks whose buttons light up */
const OTTER = '#deck .ublock[data-g="otter"]', SKUA = '#deck .ublock[data-g="skua"]';
/** the keys the cards name: on the keyboard, and the pad's button where it has one (map, stores and time warp stay on the keyboard) */
type Act = 'map' | 'warp' | 'launch' | 'cargo' | 'stores' | 'cam';
const KEY: Record<Act, string> = { map: 'M', warp: 'Z', launch: 'L', cargo: 'K', stores: 'G', cam: 'C' };
const PAD_KEY: Partial<Record<Act, GlyphName>> = { launch: 'b', cargo: 'x', cam: 'y' };

/**
 * The guided first game: a card under the status bar names the next step,
 * notices by itself when it is done and moves on, and lights up the console
 * button it means in gold. The keys in its text follow the device in hand
 * (keyboard, PlayStation or Xbox pad, trackpad). From the first look at the
 * chart to the first own island, a trip back aboard, the stores and a Skua in
 * the air; meanwhile the enemy keeps still, and its deadlines start as in a
 * new game when the card says it is coming. Skippable step by step, or ended.
 */
export class Tutorial {
  private el: HTMLDivElement;
  private tn: HTMLElement;
  private th: HTMLElement;
  private tx: HTMLElement;
  private btn: Record<'skip' | 'end' | 'close', HTMLButtonElement>;
  /** index in STEPS, -1 while none runs */
  private step = -1;
  /** the island the Stoorworm sails to (-1: none yet) */
  private island = -1;
  /** the last course the map set: to island k, the waypoint (x, z) */
  private plot: { k: number; x: number; z: number } | null = null;
  /** seconds flown in the Skua's seat */
  private flown = 0;
  /** the ACCB is down (its island builds) */
  private founded = false;
  private storesSeen = false;
  /** the pointer was captured in the first step (it is done once it is let go again) */
  private caught = false;
  private skipped = new Set<TutorialStep>();
  private shownFor = 0;
  private html = '';
  private lit: Element | null = null;
  private armed = 0;
  private steps: Record<Exclude<TutorialStep, 'done'>, Step>;

  constructor(private g: TutorialGame) {
    this.el = document.createElement('div');
    this.el.id = 'tut';
    this.el.className = 'skin';
    this.el.hidden = true;
    this.el.innerHTML = `<section class="sec">
        <header><span class="tn"></span><b class="th"></b><span class="grow"></span>` +
          `<button data-t="skip" title="${t('tut.skipTitle')}">${t('tut.skip')}</button><button data-t="end">${t('tut.end')}</button>` +
          `<button data-t="close">${t('tut.close')}</button></header>
        <div class="tx"></div>
      </section>`;
    document.body.append(this.el);
    const q = (c: string) => this.el.querySelector<HTMLElement>(c)!;
    this.tn = q('.tn'); this.th = q('.th'); this.tx = q('.tx');
    this.btn = { skip: q('[data-t="skip"]') as HTMLButtonElement, end: q('[data-t="end"]') as HTMLButtonElement, close: q('[data-t="close"]') as HTMLButtonElement };
    this.btn.skip.addEventListener('click', () => { this.skip(); this.btn.skip.blur(); });
    this.btn.end.addEventListener('click', () => {
      this.btn.end.blur();
      // a second press ends it
      if (!this.armed) { this.armed = 4; this.btn.end.textContent = t('tut.endConfirm'); this.btn.end.classList.add('arm'); return; }
      this.end();
    });
    this.btn.close.addEventListener('click', () => this.close());
    // the messages and the stores' window keep clear of the card
    new ResizeObserver(() => {
      const h = this.el.getBoundingClientRect().height;
      if (h) document.documentElement.style.setProperty('--tut-h', `${(h / uiScale()).toFixed(1)}px`);
    }).observe(this.el);
    this.steps = this.makeSteps();
  }

  get active(): boolean { return this.step >= 0; }

  /** a new game with it: from the first step, the enemy keeping still */
  start() {
    this.reset();
    this.step = 0;
    this.g.holdEnemy(true);
    this.enter();
    this.show();
  }

  /** no tutorial (a new game without it) */
  stop() {
    this.reset();
    this.show();
  }

  private reset() {
    this.step = -1; this.island = -1; this.plot = null; this.flown = 0; this.founded = false; this.storesSeen = false; this.caught = false; this.shownFor = 0;
    this.skipped.clear();
  }

  saveState(): TutorialState | null {
    if (this.step < 0 || STEPS[this.step] === 'done') return null;
    return { step: STEPS[this.step], island: this.island, plot: this.plot && { ...this.plot }, flown: this.flown, founded: this.founded, skipped: [...this.skipped] };
  }

  /** a save's tutorial goes on where it was (older saves have none) */
  loadState(s: TutorialState | null) {
    this.reset();
    const i = s ? STEPS.indexOf(s.step) : -1;
    if (s && i >= 0 && s.step !== 'done') {
      this.step = i; this.island = s.island ?? -1; this.plot = s.plot ?? null; this.flown = s.flown ?? 0; this.founded = !!s.founded;
      for (const k of s.skipped ?? []) this.skipped.add(k);
      this.g.holdEnemy(true);
      this.enter();
    }
    this.show();
  }

  /** "Überspringen": on to the next step */
  skip() {
    if (this.step < 0 || STEPS[this.step] === 'done') return;
    this.skipped.add(STEPS[this.step]);
    this.leave(STEPS[this.step]);
    this.step++;
    // (the steps that build on it and cannot be done now fall away as well)
    if (STEPS[this.step] === 'done') this.finish(); else { this.enter(); this.advance(); }
    this.render();
  }

  /** "Einführung beenden": the enemy is let go at once */
  end() {
    if (this.step < 0) return;
    const was = STEPS[this.step];
    this.reset();
    markDone();
    if (was !== 'done') { this.g.holdEnemy(false); this.g.notify(t('tut.ended'), 'bad'); }
    this.show();
  }

  /** the last card goes */
  private close() {
    this.reset();
    this.show();
  }

  /** each frame of play: what is done, the card, the light on the button */
  update(dt: number) {
    if (this.step < 0) return;
    if (this.armed > 0 && (this.armed -= dt) <= 0) { this.armed = 0; this.btn.end.textContent = t('tut.end'); this.btn.end.classList.remove('arm'); }
    const now = STEPS[this.step];
    if (now === 'done') {
      this.shownFor += dt;
      if (this.shownFor > DONE_SHOWN) { this.close(); return; }
    } else {
      if (now === 'mouse' && this.g.pointerLocked()) this.caught = true;
      // in the Skua's seat in the air
      const d = this.g.driving();
      if (now === 'skua' && this.g.active() === 'manta' && d && (d as Manta).state === 'flug') this.flown += dt;
      this.advance();
    }
    this.render();
  }

  private advance() {
    const back = this.steps[STEPS[this.step] as Exclude<TutorialStep, 'done'>].back?.();
    if (back && !this.skipped.has(back)) { this.step = STEPS.indexOf(back); this.enter(); return; }
    let moved = false;
    for (let n = 0; n < STEPS.length; n++) {
      const id = STEPS[this.step];
      if (id === 'done') break;
      const s = this.steps[id];
      if (!this.skipped.has(id) && !s.skip?.() && !s.done()) break;
      this.leave(id);
      this.step++;
      moved = true;
      if (STEPS[this.step] !== 'done') this.enter();
    }
    if (!moved) return;
    this.g.blip();
    if (STEPS[this.step] === 'done') this.finish();
  }

  /** the last card: done once and for all, and the enemy is let go */
  private finish() {
    markDone();
    this.shownFor = 0;
    this.g.holdEnemy(false);
  }

  private enter() {
    // the island to sail to shows in the console's islands section, with its "Kurs setzen" button
    if (STEPS[this.step] === 'course') { const k = this.suggest(); if (k >= 0) this.g.showIsland(k); }
  }

  private leave(id: TutorialStep) {
    // arrived: the Otter is driven at normal speed
    if (id === 'arrive' && this.g.timewarp() > 1) { this.g.setTimewarp(1); this.g.notify(t('tut.warpOff')); }
  }

  // ---------- what the steps look at ----------
  private neutral(k: number): boolean {
    const b = this.g.bases[k];
    return !!b && b.team === 'neutral' && !b.pending;
  }

  /** the map set the ship's course to island k (its waypoint lies off the island, maybe nearer a neighbour) */
  plotted(k: number) {
    const wp = this.g.carrier.waypoint;
    this.plot = wp ? { k, x: wp.x, z: wp.y } : null;
  }

  /**
   * The island the Stoorworm's course leads to (whoever holds it), -1 without a course: the one the map set it to,
   * or for a waypoint set by hand the one whose coast (as the map's click circle) is nearest
   */
  private courseTo(): number {
    const wp = this.g.carrier.waypoint, p = this.plot;
    if (!wp) return -1;
    if (p && p.x === wp.x && p.z === wp.y) return p.k;
    let best = -1, bd = TRANSFER_RANGE + 500;
    this.g.world.islands.forEach((isl, k) => {
      const d = Math.hypot(isl.cx - wp.x, isl.cz - wp.y) - isl.size * 0.42;
      if (d < bd) { bd = d; best = k; }
    });
    return best;
  }

  /** the neutral island nearest the Stoorworm (-1: none left); one with cliffs only if none without is anywhere near (a first landing should not need a landing place) */
  private suggest(): number {
    const p = this.g.carrier.pos;
    let best = -1, bd = Infinity;
    this.g.world.islands.forEach((isl, k) => {
      if (!this.neutral(k)) return;
      const d = isl.distanceTo(p.x, p.z) + (isl.landings.length ? CLIFF_DETOUR : 0);
      if (d < bd) { bd = d; best = k; }
    });
    return best;
  }

  private arrived(): boolean {
    const c = this.g.carrier, p = this.plot;
    if (this.island < 0 || c.waypoint) return false;
    if (p && p.k === this.island) return Math.hypot(p.x - c.pos.x, p.z - c.pos.z) < ARRIVED.berth;
    return this.g.world.islands[this.island].distanceTo(c.pos.x, c.pos.z) < ARRIVED.island;
  }

  /** what is left of the voyage: to the waypoint, without one to the island */
  private toGo(): string {
    const c = this.g.carrier;
    return km(c.waypoint ? c.waypointDistance : this.g.world.islands[this.island].distanceTo(c.pos.x, c.pos.z));
  }

  /** a course set to a neutral island counts (another one is taken up); without one, back to setting it unless the ship is there */
  private voyageBack(): TutorialStep | null {
    const k = this.courseTo();
    if (k >= 0 && this.neutral(k)) { this.island = k; return null; }
    return this.arrived() ? null : 'course';
  }

  /** an Otter carrying an ACCB (aboard: fitted with one) */
  private accbOtter(): Walrus | null {
    return this.g.walruses.find(w => w.state !== 'zerstoert' && (w.state === 'dock' ? w.fit : w.load).cargo === 'accb') ?? null;
  }

  /** the Otter out on the way to the island: the one with the ACCB (any, when the cargo was skipped) */
  private outOtter(): Walrus | null {
    const any = this.skipped.has('cargo');
    return this.g.walruses.find(w => (w.state === 'aussetzen' || w.state === 'fahren') && (any || w.load.cargo === 'accb')) ?? null;
  }

  private onNeutralLand(w: Walrus): boolean {
    if (w.state !== 'fahren' || w.medium !== 'land') return false;
    const isl = this.g.world.islandAt(w.pos.x, w.pos.z);
    return !!isl && this.neutral(this.g.world.islands.indexOf(isl));
  }

  /** the ACCB is down: an island of the player's building */
  private dropped(): boolean {
    if (!this.founded) this.founded = this.g.bases.some(b => b.pending?.team === 'spieler');
    return this.founded;
  }

  private islandName(): string {
    const k = this.island >= 0 ? this.island : this.suggest();
    return k >= 0 ? this.g.world.islands[k].name : '';
  }

  private inUnit(v: Walrus | Manta | null): boolean {
    return !!v && this.g.driving() === v;
  }

  // ---------- keys by the device in hand ----------
  private device(): 'keys' | 'pad' | 'ptr' {
    const inp = this.g.input;
    if (inp.lastDevice === 'pad' && inp.padName) return 'pad';
    return this.g.pointerLocked() ? 'ptr' : 'keys';
  }

  private key(a: Act): string {
    const pad = this.device() === 'pad' ? PAD_KEY[a] : undefined;
    return pad ? padGlyphs(this.g.input.padKind)[pad] : `<kbd>${KEY[a]}</kbd>`;
  }

  /** driving the Otter, flying the Skua */
  private controls(what: 'drive' | 'fly'): string {
    const dev = this.device();
    if (dev === 'pad') return what === 'drive' ? t('tut.drive.pad', padGlyphs(this.g.input.padKind)) : t('tut.fly.pad', padGlyphs(this.g.input.padKind));
    if (what === 'drive') return t(dev === 'ptr' ? 'tut.drive.ptr' : 'tut.drive.keys');
    return t(dev === 'ptr' ? 'tut.fly.ptr' : 'tut.fly.keys');
  }

  // ---------- the steps ----------
  private makeSteps(): Record<Exclude<TutorialStep, 'done'>, Step> {
    const g = this.g;
    return {
      mouse: {
        done: () => this.caught && !g.pointerLocked(),
        text: () => (g.pointerLocked() ? t('tut.mouseCaught') : this.device() === 'pad' ? t('tut.mousePad') : t('tut.mouse')),
        glow: () => '#cambar [data-c="ptr"]',
      },
      map: {
        done: () => g.mapOpen(),
        skip: () => { const k = this.courseTo(); return k >= 0 && this.neutral(k); },
        text: () => t('tut.map', { key: this.key('map'), btn: t('helm.plot') }),
        glow: () => '#helm [data-h="plot"]',
      },
      course: {
        done: () => {
          const k = this.courseTo();
          if (k < 0 || !this.neutral(k)) return false;
          this.island = k;
          return true;
        },
        text: () => {
          const s = this.suggest(), c = g.carrier.pos;
          if (s < 0) return t('tut.courseAny');
          const isl = g.world.islands[s];
          let html = t('tut.course', {
            island: isl.name, dist: km(isl.distanceTo(c.x, c.z)), btn: t('isl.b.course'),
            dir: POINTS[Math.round(bearing(Math.atan2(isl.cx - c.x, isl.cz - c.z)) / 45) % 8],
          });
          // a course to an island that is not free
          const k = this.courseTo();
          if (k >= 0 && !this.neutral(k)) {
            const name = g.world.islands[k].name;
            html += `<span class="note">${g.bases[k].team === 'spieler' ? t('tut.courseOwn', { island: name, near: isl.name }) : t('tut.courseOther', { near: isl.name })}</span>`;
          }
          return html;
        },
        glow: () => '#deck [data-sec="islands"] [data-i="course"]',
      },
      warp: {
        done: () => g.timewarp() > 1,
        skip: () => this.island < 0 || this.arrived(),
        back: () => this.voyageBack(),
        text: () => {
          const isl = g.world.islands[this.island];
          if (!isl) return t('tut.courseAny');
          return t('tut.warp', { island: isl.name, dist: this.toGo(), key: this.key('warp') });
        },
      },
      arrive: {
        done: () => this.arrived(),
        skip: () => this.island < 0,
        back: () => this.voyageBack(),
        text: () => {
          const isl = g.world.islands[this.island];
          if (!isl) return t('tut.courseAny');
          return t('tut.arrive', { ship: SHIP_NAME, island: isl.name, dist: this.toGo() });
        },
      },
      cargo: {
        done: () => !!this.accbOtter() || this.dropped(),
        text: () => t('tut.cargo', { btn: t('cmd.load'), what: t('load.accbRole', { role: t('role.rohstoff') }) }),
        glow: () => `${OTTER} button[data-cmd="load"]`,
      },
      launch: {
        done: () => !!this.outOtter() || this.dropped(),
        back: () => (this.accbOtter() ? null : 'cargo'),
        text: () => t('tut.launch', { btn: t('cmd.launch'), key: this.key('launch') }),
        glow: () => `${OTTER} button[data-cmd="launch"]`,
      },
      land: {
        done: () => { const w = this.outOtter(); return this.dropped() || (!!w && this.onNeutralLand(w)); },
        back: () => (this.outOtter() || this.dropped() ? null : this.accbOtter() ? 'launch' : 'cargo'),
        text: () => (this.inUnit(this.outOtter())
          ? t('tut.landDrive', { island: this.islandName(), drive: this.controls('drive') })
          : t('tut.land', { island: this.islandName(), aim: t('cmd.aim'), cockpit: t('map.cockpit') })),
        glow: () => (this.inUnit(this.outOtter()) ? null : `${OTTER} button[data-cmd="aim"]`),
      },
      drop: {
        done: () => this.dropped(),
        // an Otter without an ACCB (its cargo was skipped) has nothing to set down
        skip: () => { const w = this.outOtter(); return !!w && w.load.cargo !== 'accb'; },
        back: () => {
          const w = this.outOtter();
          if (this.dropped()) return null;
          if (!w) return this.accbOtter() ? 'launch' : 'cargo';
          return w.medium === 'land' ? null : 'land';
        },
        text: () => t('tut.drop', { btn: t('cmd.accb'), key: this.key('cargo'), deg: SLOPE.BUILD }),
        glow: () => `${OTTER} button[data-cmd="cargo"]`,
      },
      home: {
        done: () => g.walruses.every(w => w.state === 'dock' || w.state === 'zerstoert'),
        text: () => t('tut.home', { btn: t('cmd.home'), ship: SHIP_NAME, key: this.key('warp') }),
        glow: () => `${OTTER} button[data-cmd="home"]`,
      },
      stores: {
        done: () => {
          if (g.supplyOpen()) this.storesSeen = true;
          return this.storesSeen && !g.supplyOpen();
        },
        text: () => (g.supplyOpen() ? t('tut.storesOpen', { key: this.key('stores') }) : t('tut.stores', { key: this.key('stores'), btn: t('map.supplyBtn') })),
        glow: () => (g.supplyOpen() ? '#supply .close' : '#deck [data-f="supply"]'),
      },
      skua: {
        done: () => this.flown >= FLIGHT,
        text: () => {
          const up = g.mantas.find(m => m.state === 'start' || m.state === 'flug');
          if (!up) return t('tut.skua', { btn: t('cmd.start'), key: this.key('launch') });
          if (!this.inUnit(up)) return t('tut.skuaBoard', { btn: t('map.cockpit') });
          return t('tut.skuaFly', { fly: this.controls('fly'), cam: this.key('cam'), land: t('cmd.land'), key: this.key('launch') });
        },
        glow: () => {
          const up = g.mantas.find(m => m.state === 'start' || m.state === 'flug');
          return !up ? `${SKUA} button[data-cmd="launch"]` : !this.inUnit(up) ? `${SKUA} [data-h="cockpit"]` : null;
        },
      },
    };
  }

  // ---------- the card ----------
  private show() {
    const on = this.step >= 0;
    this.el.hidden = !on;
    document.body.classList.toggle('tut', on);
    this.html = '';
    if (on) this.render(); else this.light(null);
  }

  private render() {
    const id = STEPS[this.step], last = id === 'done';
    const s = last ? null : this.steps[id];
    let text = last ? t('tut.done', { ship: SHIP_NAME, foe: ENEMY_SHIP_NAME }) : s!.text();
    const glow = s?.glow?.() ?? null;
    // the pointer captured (a click into the picture), whatever the step: how to get it back
    if (this.g.pointerLocked() && id !== 'mouse') text += `<span class="note">${t('tut.ptrFree')}</span>`;
    const head = `${last ? '✓' : t('tut.step', { n: this.step + 1, total: STEPS.length - 1 })}|${t(`tut.h.${id}`)}|${text}`;
    if (head !== this.html) {
      this.html = head;
      this.tn.textContent = last ? '✓' : t('tut.step', { n: this.step + 1, total: STEPS.length - 1 });
      this.th.textContent = t(`tut.h.${id}`);
      this.tx.innerHTML = text;
      this.btn.skip.hidden = last; this.btn.end.hidden = last; this.btn.close.hidden = !last;
    }
    this.light(glow ? document.querySelector(glow) : null);
  }

  /** the button meant lights up in gold (the console rebuilds its buttons now and then: looked up each frame) */
  private light(el: Element | null) {
    if (el === this.lit && el?.classList.contains('tut-glow')) return;
    this.lit?.classList.remove('tut-glow');
    this.lit = el;
    el?.classList.add('tut-glow');
  }
}
