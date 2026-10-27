import * as THREE from 'three';
import { VirtualInput, type UnitPilots } from './autopilot';
import { attackRun, turnRound, type Run } from './airAttack';
import type { CarrierController } from './carrierController';
import type { Combat, Target } from './combat';
import type { Manta } from './manta';
import { SIGNAL_LOST } from './telemetry';
import { t, km } from '../i18n';

/** a strike stays this close to its radio link (the ship, or the drone with the radio pod; a Skua is lost at SIGNAL_LOST) */
const LEASH = SIGNAL_LOST - 300;
/** with its missiles and its bomb gone it goes on with the Quasar this long, then flies home (s) */
const LASER_ONLY = 25;
/** it breaks off below these: fuel, armour (share of full), signal */
const BREAK = { fuel: 0.3, hp: 0.4, signal: 0.45 };
/** it gives up after this long at the target (s) */
const MAX_TIME = 300;
/** within this of its target it turns for home fast rather than tight (a ship's turret would get it in a slow circle) */
const CLEAR = 1800;
/** the bomb keeps this share of the Skua's speed when it falls away (Manta.dropBomb) */
const BOMB_CARRY = 0.85;

export type StrikeStage = 'start' | 'angriff' | 'heim';
interface Strike extends Run {
  m: Manta; target: Target; stage: StrikeStage;
  /** s in this stage; s with nothing left but the laser; launch attempts (the lift may be busy) */
  clock: number; spentFor: number; tries: number;
  /** on the way home, still turning round towards the ship */
  turning: boolean;
}

/** why a strike ends, for the message */
type End = 'down' | 'spent' | 'fuel' | 'hit' | 'signal' | 'time';

const at = new THREE.Vector3();

/**
 * The player's Skuas attacking on their own (testers: on a notebook the fight in the air gets too hectic). Given a
 * target (picked on the map, or the missile lock in the cockpit), a Skua takes off, flies attack runs at it with
 * its missiles, its Quasar and its bomb (the enemy's sorties fly the same, airAttack.ts), and when the target is down,
 * its weapons are spent or it runs low on fuel, armour or signal, it flies home and lands. Steering it by hand ends
 * the strike. Not saved: after loading, the Skua flies on as it is.
 */
export class Strikes {
  private list: Strike[] = [];
  private sticks = new Map<Manta, VirtualInput>();
  private orders = new Map<Manta, { trigger: boolean; missile: boolean }>();
  private time = 0;
  /** messages for the log, taken by the game (`home`: the Skua turns for home) */
  readonly notices: { text: string; home: boolean }[] = [];

  /** `link`: the radio link nearest a point (the ship, or the drone with the radio pod) and how far it is */
  constructor(private ship: CarrierController, private pilots: UnitPilots, private combat: Combat,
    private link: (x: number, z: number) => { at: THREE.Vector3; dist: number }) {}

  /** send the Skua at the target; '' when it goes, otherwise why not */
  order(m: Manta, target: Target): string {
    if (!target.alive || target.team === m.team) return t('strike.noTarget');
    if (m.state !== 'deck' && m.state !== 'pad' && m.state !== 'flug') return t('strike.busy', { unit: m.name });
    if (m.fuel < BREAK.fuel + 0.1) return t('strike.lowFuel', { unit: m.name });
    target.centre(at);
    if (this.link(at.x, at.z).dist > LEASH - 200) return t('strike.outOfRange', { dist: km(SIGNAL_LOST, 0) });
    this.drop(m);
    this.pilots.setManta(m, null);
    this.list.push({ m, target, stage: m.state === 'flug' ? 'angriff' : 'start', clock: 0, spentFor: 0, tries: 0, turning: false, pass: 0, shotAt: -99 });
    return '';
  }

  /** the strike called off: the Skua flies home and lands */
  recall(m: Manta) {
    const s = this.find(m);
    if (!s) return;
    if (s.stage === 'start' && m.state !== 'flug') { this.drop(m); return; }
    s.stage = 'heim';
    this.orders.delete(m);
  }

  /** the strike ends at once (the player takes the Skua) */
  drop(m: Manta) {
    this.list = this.list.filter(s => s.m !== m);
    this.orders.delete(m);
  }

  active(m: Manta): boolean { return !!this.find(m); }
  stage(m: Manta): StrikeStage | null { return this.find(m)?.stage ?? null; }
  target(m: Manta): Target | null { return this.find(m)?.target ?? null; }
  /** what the strikes fly at, for the map: each Skua's position and its target's */
  lines(): { from: THREE.Vector3; to: THREE.Vector3; home: boolean }[] {
    return this.list.filter(s => s.m.state === 'flug').map(s => ({ from: s.m.pos, to: s.target.centre(new THREE.Vector3()), home: s.stage === 'heim' }));
  }

  /** the steering this frame while it attacks or turns for home (otherwise its autopilots fly it) */
  stick(m: Manta): VirtualInput | null {
    const s = this.find(m);
    return s && (s.stage === 'angriff' || s.turning) ? this.sticks.get(m) ?? null : null;
  }

  /** fire orders this frame */
  fire(m: Manta): { trigger: boolean; missile: boolean } {
    return this.orders.get(m) ?? { trigger: false, missile: false };
  }

  update(dt: number) {
    this.time += dt;
    this.list = this.list.filter(s => {
      const m = s.m;
      s.clock += dt;
      if (m.state === 'absturz') { this.orders.delete(m); return false; }
      if (s.stage === 'start') return this.start(s);
      if (s.stage === 'angriff') return this.attack(s, dt);
      return this.home(s);
    });
  }

  // ---- inside ----
  private find(m: Manta): Strike | undefined { return this.list.find(s => s.m === m); }

  private stickOf(m: Manta): VirtualInput {
    let v = this.sticks.get(m);
    if (!v) { v = new VirtualInput(); this.sticks.set(m, v); }
    return v;
  }

  /** off the deck or the pad (the lift may be busy: it tries again every second, for a minute) */
  private start(s: Strike): boolean {
    const m = s.m;
    if (m.state === 'flug') { s.stage = 'angriff'; s.clock = 0; return true; }
    if ((m.state === 'deck' || m.state === 'pad') && s.clock >= s.tries) {
      if (++s.tries > 60) { this.notices.push({ text: t('strike.noStart', { unit: m.name }), home: false }); return false; }
      m.toggleLaunch();
    }
    return true;
  }

  private attack(s: Strike, dt: number): boolean {
    const m = s.m, tg = s.target;
    const spent = m.missiles <= 0 && m.load.centre !== 'quaker';
    s.spentFor = spent ? s.spentFor + dt : 0;
    const end: End | null = !tg.alive ? 'down' : s.spentFor > LASER_ONLY ? 'spent' : m.fuel < BREAK.fuel ? 'fuel'
      : m.hp < m.maxHp * BREAK.hp ? 'hit' : m.signal < BREAK.signal ? 'signal' : s.clock > MAX_TIME ? 'time' : null;
    if (end) {
      this.notices.push({ text: t(`strike.end.${end}`, { unit: m.name, target: tg.name }), home: true });
      s.stage = 'heim';
      this.orders.delete(m);
      return true;
    }
    tg.centre(at);
    const home = this.link(at.x, at.z).at;
    this.orders.set(m, attackRun(m, tg, s, this.stickOf(m), home, LEASH, this.time, dt));
    if (m.load.centre === 'quaker' && this.bombNow(m, tg)) m.dropBomb(this.combat);
    return true;
  }

  /** back to the ship: round towards it, then its waypoint autopilot, near it the landing autopilot */
  private home(s: Strike): boolean {
    const m = s.m;
    if (m.state !== 'flug') { this.orders.delete(m); return false; }
    const ship = this.ship.pos, d = Math.hypot(m.pos.x - ship.x, m.pos.z - ship.z);
    const near = s.target.alive && s.target.centre(at).distanceTo(m.pos) < CLEAR;
    s.turning = d > 1500 && turnRound(m, ship, this.stickOf(m), near ? 0.75 : 0.1);
    if (s.turning) return true;
    if (d < 2600) { this.pilots.setManta(m, null); m.toggleLaunch(); return false; }
    if (!m.waypoint || Math.hypot(m.waypoint.x - ship.x, m.waypoint.y - ship.z) > 300) this.pilots.setManta(m, new THREE.Vector2(ship.x, ship.z));
    return true;
  }

  /** the bomb's moment on a run at something on the surface: lined up, and as far short of it as the bomb flies on while it falls */
  private bombNow(m: Manta, tg: Target): boolean {
    tg.centre(at);
    const ground = m.pos.y - m.altitude, h = m.pos.y - at.y;
    if (at.y - ground > 60 || h < 20) return false;
    const lead = m.speed * BOMB_CARRY * Math.sqrt(2 * h / 9.81);
    const dx = at.x - m.pos.x, dz = at.z - m.pos.z, off = Math.atan2(dx, dz) - m.yaw;
    return Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) < 0.12 && Math.abs(Math.hypot(dx, dz) - lead) < 40;
  }
}
