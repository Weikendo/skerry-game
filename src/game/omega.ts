import * as THREE from 'three';
import type { Archipelago } from '../world/archipelago';
import type { IslandBase } from '../world/base';
import type { Island } from '../world/island';
import type { IslandRole } from '../world/worldgen';
import { SLOPE } from '../world/terrain';
import type { Combat, Target } from './combat';
import type { Walrus } from './walrus';
import type { Manta } from './manta';
import { attackRun, reachOut, turnRound } from './airAttack';
import { VirtualInput, type UnitPilots } from './autopilot';
import type { Economy } from './economy';
import { offshore, type EnemyCarrier } from './enemyCarrier';
import { GOODS, type Good } from './stores';
import { AVATAR_SHOTS, skuaFit } from './arsenal';
import { TUNING, type Difficulty, type Tuning } from './difficulty';
import { ShieldDrone } from './defenceDrones';

/** the enemy's side: its ship (with the helm), its vehicles, their autopilots and its island network */
export interface Foe {
  helm: EnemyCarrier;
  otters: Walrus[];
  skuas: Manta[];
  pilots: UnitPilots;
  economy: Economy;
  combat: Combat;
}

/** what the strategy needs from the game */
export interface OmegaHooks {
  /** the player's vehicles out in the field and the Stoorworm: what its Skuas may hunt */
  foes(): Target[];
  /** the Stoorworm: hunted by its Skuas when in sight, kept at a distance by its ship */
  prey(): Target;
  /** can the enemy see this point (its ship's radar, its islands, its vehicles) */
  sees(x: number, z: number): boolean;
  /** an ACCB has landed on island k (the game refreshes the island) */
  found(k: number): void;
  /** news the player may get to hear of */
  event(e: OmegaEvent): void;
}

export type OmegaEvent =
  | { kind: 'accb'; island: number }
  | { kind: 'attack'; island: number }
  | { kind: 'raid'; island: number }
  | { kind: 'sortie'; skua: Manta; target: Target };

/** an operation with the ship and one Otter: found a base on a neutral island, or knock out a player's command centre */
interface Plan {
  kind: 'erobern' | 'angriff';
  island: number;
  stage: 'anfahrt' | 'einsatz' | 'heim';
  otter: number;
  goal: { x: number; z: number } | null;
  tries: number;
  /** seconds in the current stage */
  clock: number;
  role: Exclude<IslandRole, 'basis'>;
  reported: boolean;
  /** firing positions already tried (attack) */
  spots?: { x: number; z: number }[];
}

/** a Skua sent after an intruder (hunt: after the Stoorworm, a shorter run) */
interface Sortie {
  skua: number; target: Target | null; stage: 'start' | 'jagd' | 'heim'; unseen: number; shotAt: number; pass: number; clock: number; hunt?: boolean;
  /** on the way home, still turning round towards the ship (steered by Omega, not the autopilot) */
  turning?: boolean;
}

const THINK = 5;
/** conquest: neutral islands at most this far from an own island (or linked to one); like the other distances between islands, times the world's spread */
const CONQUEST_RADIUS = 9000;
/** the ship's tank share kept beyond the way to the target and home */
const RESERVE = 0.15;
// (its first attack, then at most one per pause, the raids and the hunts' pauses come with the difficulty: TUNING;
// with nothing neutral in reach it attacks without waiting)
/** Skua raids on the command centre of a player's island without a gun standing: at most this far from the ship */
const RAID_RANGE = 4300;
/** the Stoorworm in sight this close to its ship: a Skua goes after it for a run of HUNT_TIME, then a pause
 *  (the Stoorworm's laser turret fires back: a Skua down to 40 % breaks off and flies home) */
const HUNT = 4300, HUNT_TIME = 90;
/** the Stoorworm this close: its ship turns away (unless an Otter of its own is out), so it stays in its Skuas' reach but out of harm's way */
const KEEP_OFF = 2500;
/** its patrols reach this far out from its island nearest the player (times the world's spread) */
const FRONT_DEPTH = 12000;
/** an island the enemy failed at is left alone for this long (s) */
const SHUN = 1500;
/** the ship scrambles its Skuas against intruders within this distance */
const SCRAMBLE = 3800;
/** a Skua never strays further from its ship than this (its radio reaches 5 km): hunts and raids stay within it too */
const LEASH = 4700;
/** the Otter fires on a command centre from this close (the Avatar's bolts reach about 1.5 km) */
const FIRE_RANGE = 700;
/** firing positions it tries before giving up an attack */
const MAX_SPOTS = 6;
/** goods the ship takes on at home, up to these quantities */
const RESTOCK: Partial<Record<Good, number>> = { accb: 4, assassin: 24, avatar: 3, quasar: 3, walrus: 2, manta: 2, treibstoffWalrus: 128, treibstoffManta: 128, taeuschkoerper: 16, abwehrdrohne: 12, hammerhead: 4, beobachtungsdrohne: 4 };

/** under this share of its hull the ship breaks off and goes to a yard; it sails again at YARD_DONE */
const YARD_GO = 0.5, YARD_DONE = 0.95;
/** a yard that does not finish the work (no raw material) is given up after this long (s), and not sought again for as long */
const YARD_WAIT = 600;
/** it lies this far off the yard island */
const BERTH = 600;

/** a berth off a yard island: BERTH from it, on the side facing (fromX, fromZ) if that is clear, else the nearest clear side */
function berth(world: Archipelago, isl: Island, fromX: number, fromZ: number): { x: number; z: number } {
  const a0 = Math.atan2(fromX - isl.cx, fromZ - isl.cz);
  for (let k = 0; k < 12; k++) {
    const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 6, dx = Math.sin(a), dz = Math.cos(a);
    let r = isl.size / 2;
    while (isl.distanceTo(isl.cx + dx * r, isl.cz + dz * r) < BERTH) r += 50;
    const x = isl.cx + dx * r, z = isl.cz + dz * r;
    if (world.islands.every(o => o === isl || o.distanceTo(x, z) > BERTH)) return { x, z };
  }
  return offshore(world, isl, fromX, fromZ, BERTH);
}

const v3 = new THREE.Vector3(), vel = new THREE.Vector3();

/**
 * Omega, the enemy's strategy (named after the original's enemy carrier ACC
 * Omega). Every few seconds it picks an operation for its ship and one Otter:
 * found a base on a neutral island next to its network (those towards the
 * player first), or knock out the command centre of a weakly defended island
 * of the player's so the island falls and can be taken; with nothing neutral
 * left in reach it is on the offensive. Its stockpile moves to the island
 * nearest the target so the ship refuels at the front, and between operations
 * the ship patrols the front. Its Skuas take off against the player's vehicles
 * that come near its ship, an island it is building or its Otter at work, hunt
 * the Stoorworm when it is in sight (the ship itself keeps its distance) and
 * raid the player's islands that have no gun standing. Low on fuel it breaks
 * off and goes home, where it takes on fuel and goods from its own network.
 */
export class Omega {
  plan: Plan | null = null;
  private sorties: Sortie[] = [];
  private shun = new Map<number, number>();
  private think = 3;
  private scan = 0;
  /** what the difficulty sets: pauses, damage, production, how many of its vehicles it uses */
  tune: Tuning = TUNING.normal;
  private attackIn = TUNING.normal.firstAttack;
  private raidIn = TUNING.normal.firstRaid;
  private huntIn = 0;
  /** the guided first game: it keeps still (no operations, raids, hunts or Skuas against the player); see setHold */
  private hold = false;
  /** held still by the guided first game (its Hammerheads wait as well) */
  get holding(): boolean { return this.hold; }
  /** the island its Skuas raid now (-1: none), and for how much longer more Skuas take off for it */
  private raidOn = -1;
  private raidFor = 0;
  /** seconds it still keeps away from the Stoorworm */
  private evade = 0;
  /** the yard island it lies at (-1: none), how long it has been at it, and how long it does not seek one again */
  private yard = -1;
  private yardClock = 0;
  private yardShun = 0;
  private time = 0;
  private sticks = new Map<Manta, VirtualInput>();
  /** this frame's fire orders, read by the shooting step */
  private fireOrders = new Map<object, { trigger: boolean; missile: boolean }>();

  constructor(private foe: Foe, private world: Archipelago, private bases: IslandBase[], private hooks: OmegaHooks) {
    // the enemy's factories make what conquest and defence use up
    const o = foe.economy.orders;
    o.accb = { priority: 2, target: 4 };
    for (const g of ['assassin', 'avatar', 'quasar', 'walrus', 'manta'] as Good[]) o[g] = { priority: 1, target: g === 'assassin' ? 16 : 2 };
    o.taeuschkoerper = { priority: 1, target: 10 };
    o.abwehrdrohne = { priority: 1, target: 6 };
    o.hammerhead = { priority: 1, target: 2 };
    o.beobachtungsdrohne = { priority: 1, target: 2 };
    // the vehicles' fitting: the Otter with an Avatar, the Skua with a Quasar and an Assassin under each wing
    for (const w of foe.otters) { w.fit = { weapon: 'avatar', ammo: AVATAR_SHOTS, cargo: null, missiles: 0, role: 'rohstoff' }; w.rearm(); }
    for (const m of foe.skuas) { m.fit = skuaFit(); m.rearm(); }
    foe.helm.home = () => {
      const k = foe.economy.stockpile;
      return this.bases[k]?.team === 'feind' ? k : foe.helm.nearestOwn();
    };
    foe.helm.front = () => this.frontline();
    foe.helm.supply = (units) => {
      const st = foe.economy.stockpileGoods, got = Math.min(units, st.treibstoffTraeger);
      st.treibstoffTraeger -= got;
      return got;
    };
  }

  /** the steering a Skua on a sortie gets this frame (null: its autopilot or nothing) */
  stick(m: Manta): VirtualInput | null {
    const s = this.sorties.find(x => this.foe.skuas[x.skua] === m);
    return s && (s.stage === 'jagd' || s.turning) ? this.sticks.get(m) ?? null : null;
  }

  /** fire orders for a vehicle this frame */
  fire(u: Walrus | Manta): { trigger: boolean; missile: boolean } {
    return this.fireOrders.get(u) ?? { trigger: false, missile: false };
  }

  get ship() { return this.foe.helm.ship; }

  /** the difficulty; `fresh` (a new game) also sets when it first attacks and raids */
  setDifficulty(d: Difficulty, fresh: boolean) {
    this.tune = TUNING[d];
    if (fresh) { this.attackIn = this.tune.firstAttack; this.raidIn = this.tune.firstRaid; }
  }

  /** the guided first game holds it still; let go, its deadlines start as in a new game (its ship, network and yard go on meanwhile) */
  setHold(on: boolean) {
    if (this.hold && !on) { this.attackIn = this.tune.firstAttack; this.raidIn = this.tune.firstRaid; this.huntIn = 0; }
    this.hold = on;
  }

  /** the Otters and Skuas it uses (the first ones; the others stay aboard) */
  private get otters(): Walrus[] { return this.foe.otters.slice(0, this.tune.otters); }
  private get skuas(): Manta[] { return this.foe.skuas.slice(0, this.tune.skuas); }

  update(dt: number) {
    this.time += dt;
    this.fireOrders.clear();
    for (const w of this.foe.otters) w.aimValid = false;
    for (const [k, s] of this.shun) { if (s - dt <= 0) this.shun.delete(k); else this.shun.set(k, s - dt); }
    if (!this.hold) {
      this.attackIn -= dt;
      this.raidIn -= dt;
      this.raidFor -= dt;
      this.huntIn -= dt;
    }
    this.foe.economy.update(dt * this.tune.production);
    this.foe.helm.update(dt);
    this.restock();
    this.repair(dt);
    this.keepOff(dt);
    this.scan -= dt;
    if (this.scan <= 0) { this.scan = 1; this.toYard(); if (!this.hold) { this.raid(); this.defend(); } }
    this.flySorties(dt);
    if (this.plan) this.runPlan(dt);
    this.think -= dt;
    if (this.think <= 0) { this.think = THINK; if (!this.plan && !this.hold) this.decide(); }
  }

  // ---------- supplies ----------
  /** at home the ship takes on goods from its network's stockpile */
  private restock() {
    const helm = this.foe.helm;
    if (helm.duty !== 'hafen' || !helm.atHome) return;
    const st = this.ship.stores, pile = this.foe.economy.stockpileGoods;
    for (const [g, want] of Object.entries(RESTOCK) as [Good, number][]) {
      const n = Math.min(pile[g], Math.max(0, Math.min(want, GOODS[g].cap) - st[g]));
      if (n > 0) { pile[g] -= n; st[g] += n; }
    }
  }

  /** the hangar repairs what stands aboard (as on the player's ship) */
  private repair(dt: number) {
    const aboard = [...this.foe.otters.filter(w => w.state === 'dock'), ...this.foe.skuas.filter(m => m.state === 'deck')].filter(v => v.hp < v.maxHp);
    for (const v of aboard) v.hp = Math.min(v.maxHp, v.hp + 40 / aboard.length * dt);
  }

  // ---------- the yard ----------
  /**
   * Badly hit (hull under YARD_GO) and with no Otter out on an operation, the ship breaks off and lies off its
   * nearest base or factory island until the hull is mended (the same yard rules as the Stoorworm's). Once a second.
   */
  private toYard() {
    const s = this.ship, helm = this.foe.helm;
    this.yardShun -= 1;
    if (this.yard >= 0) {
      this.yardClock += 1;
      const lost = this.bases[this.yard].team !== 'feind', done = s.hp >= s.maxHp * YARD_DONE;
      if (!s.alive || lost || done || this.yardClock > YARD_WAIT) {
        if (!lost && !done) this.yardShun = YARD_WAIT;
        this.yard = -1;
        if (this.evade <= 0) helm.release();
        return;
      }
      // driven off (it kept away from the Stoorworm): back to the yard
      if (this.evade <= 0 && helm.duty !== 'auftrag') this.berthAt(this.yard);
      return;
    }
    if (!s.alive || s.hp >= s.maxHp * YARD_GO || this.yardShun > 0 || this.evade > 0 || (this.plan && this.plan.stage !== 'anfahrt')) return;
    let k = -1, kd = Infinity;
    this.bases.forEach((b, j) => {
      if (b.team !== 'feind' || (b.island.role !== 'basis' && b.island.role !== 'fabrik')) return;
      const d = Math.hypot(b.island.cx - s.pos.x, b.island.cz - s.pos.z);
      if (d < kd) { kd = d; k = j; }
    });
    if (k < 0) return;
    if (this.plan) this.end();
    this.yard = k;
    this.yardClock = 0;
    this.berthAt(k);
  }

  private berthAt(k: number) {
    const p = berth(this.world, this.world.islands[k], this.ship.pos.x, this.ship.pos.z);
    this.foe.helm.order(p.x, p.z);
  }

  // ---------- strategy ----------
  private decide() {
    const ship = this.ship, helm = this.foe.helm;
    // at a yard it only waits for the work to be done
    if (this.yard >= 0) return;
    // an Otter still out (left over, or from a loaded game): wait for it where the ship is
    const out = this.foe.otters.find(w => w.state === 'fahren' || w.state === 'aussetzen' || w.state === 'andocken');
    if (out) {
      helm.order(ship.pos.x, ship.pos.z);
      this.foe.pilots.homeWalrus(out);
      this.plan = { kind: 'erobern', island: -1, stage: 'heim', otter: this.foe.otters.indexOf(out), goal: null, tries: 0, clock: 0, role: 'rohstoff', reported: false };
      return;
    }
    // not while it is on its way home for fuel or still refuelling, nor while it keeps away from the Stoorworm
    if (ship.fuel < 0.35 || (helm.duty === 'hafen' && ship.fuel < 0.9) || this.evade > 0) return;
    const otter = this.otters.find(w => w.state === 'dock' && w.hp >= w.maxHp * 0.85);
    if (!otter) return;
    const capture = ship.stores.accb > 0 ? this.captureTarget() : null;
    const armed = otter.load.weapon === 'avatar' || ship.stores.avatar > 0;
    // on the offensive when nothing neutral is left in reach, otherwise an attack after each pause
    const attack = armed && (this.attackIn <= 0 || !capture) ? this.attackTarget(!capture) : null;
    const go = attack ?? capture;
    if (!go) return;
    // refuel at the island nearest the target: the stockpile moves there first (as the player can move it)
    const e = this.foe.economy;
    if (go.from !== e.stockpile) { if (!e.moving) { e.setStockpile(go.from); helm.goHome(); } return; }
    if (this.reaches(go.island)) {
      if (go === attack) this.attackIn = this.tune.attackPause;
      this.start(go === attack ? 'angriff' : 'erobern', go.island, otter);
      return;
    }
    if (helm.duty === 'wache') helm.goHome();
  }

  /** the tank reaches the island and home again with a reserve */
  private reaches(k: number): boolean {
    // the way it really sails: to where it lies off the island (as start() places it) and from there back to the coast of
    // home, not between the islands' centres (that left targets at the edge of its range picked but never begun)
    const s = this.ship, isl = this.world.islands[k], home = this.foe.helm.home();
    const p = offshore(this.world, isl, s.pos.x, s.pos.z, 450);
    const there = Math.hypot(p.x - s.pos.x, p.z - s.pos.z);
    const h = home >= 0 ? this.world.islands[home] : null;
    const back = h ? Math.max(0, Math.hypot(p.x - h.cx, p.z - h.cz) - h.size / 2) : 0;
    return (there + back) / s.fuelRange < s.fuel - RESERVE;
  }

  /**
   * The neutral island to take next, and the own island the ship refuels at for it
   * (the stockpile if it is close enough, else the own linked island nearest to it):
   * a full tank must reach there and back with a reserve.
   */
  private captureTarget(): { island: number; from: number } | null {
    const isl = this.world.islands;
    let best: { island: number; from: number } | null = null, bs = Infinity;
    isl.forEach((I, k) => {
      const b = this.bases[k];
      if (b.team !== 'neutral' || b.pending || this.shun.has(k) || b.construction) return;
      const from = this.frontFor(k, CONQUEST_RADIUS * this.world.spread);
      if (from < 0) return;
      // the nearest first, and those towards the player
      const score = this.dist(from, k) + 0.3 * Math.hypot(I.cx - this.ship.pos.x, I.cz - this.ship.pos.z) + 0.4 * this.toPlayer(k);
      if (score < bs) { bs = score; best = { island: k, from }; }
    });
    return best;
  }

  /**
   * A player's island to knock out, and the own island the ship refuels at for it:
   * a command centre with at most one gun left, or two while the island is still
   * building (or the enemy is on the offensive); the weakest and nearest first.
   */
  private attackTarget(offensive: boolean): { island: number; from: number } | null {
    let best: { island: number; from: number } | null = null, bs = Infinity;
    this.bases.forEach((b, k) => {
      if (b.team !== 'spieler' || !b.commandCentre?.alive || this.shun.has(k)) return;
      const guns = this.guns(b), building = !!b.construction;
      if (guns > (offensive || building ? 2 : 1)) return;
      const from = this.frontFor(k);
      if (from < 0) return;
      const isl = this.world.islands[k];
      const score = guns * 6000 - (building ? 3000 : 0) + this.dist(from, k) + 0.3 * Math.hypot(isl.cx - this.ship.pos.x, isl.cz - this.ship.pos.z);
      if (score < bs) { bs = score; best = { island: k, from }; }
    });
    return best;
  }

  /** gun turrets standing on an island */
  private guns(b: IslandBase): number { return b.buildings.filter(x => x.head && x.alive).length; }

  private dist(a: number, b: number): number {
    const isl = this.world.islands;
    return Math.hypot(isl[a].cx - isl[b].cx, isl[a].cz - isl[b].cz);
  }

  /** from island k to the player's nearest island (0 when the player holds none) */
  private toPlayer(k: number): number {
    let d = Infinity;
    this.bases.forEach((b, j) => { if (b.team === 'spieler') d = Math.min(d, this.dist(k, j)); });
    return Number.isFinite(d) ? d : 0;
  }

  /**
   * The own island (linked to its network) the ship refuels at for an operation
   * at island k: the stockpile if it is close enough, else the one nearest k; a
   * full tank must reach there and back with a reserve. -1 when none does.
   */
  private frontFor(k: number, radius = Infinity): number {
    // (a full tank there and back with the reserve; every trip is checked again before it starts, see reaches(). An extra
    // tenth on top left it nothing in reach in a world of few, widely spread islands one time in five.)
    const e = this.foe.economy, limit = Math.min(radius, (1 - RESERVE) * this.ship.fuelRange / 2);
    const front = (f: number) => this.bases[f]?.team === 'feind' && e.linked[f];
    if (front(e.stockpile) && this.dist(e.stockpile, k) <= limit) return e.stockpile;
    let from = -1, fd = Infinity;
    this.bases.forEach((_, f) => { if (front(f) && this.dist(f, k) < fd) { fd = this.dist(f, k); from = f; } });
    return fd <= limit ? from : -1;
  }

  /**
   * Where its ship patrols: its own island nearest the player, the neutral
   * islands in a corridor from there towards the player's island nearest to
   * it (at most FRONT_DEPTH out), and that one too once it is that close (the
   * ship lies off it out of its guns' reach). Empty while either side holds none.
   */
  frontline(): number[] {
    let a = -1, p = -1, best = Infinity;
    this.bases.forEach((ba, i) => {
      if (ba.team !== 'feind') return;
      this.bases.forEach((bp, j) => { if (bp.team === 'spieler' && this.dist(i, j) < best) { best = this.dist(i, j); a = i; p = j; } });
    });
    if (a < 0) return [];
    const depth = FRONT_DEPTH * this.world.spread;
    return this.bases.map((_, k) => k).filter(k => k === a || (k === p && best < depth)
      || (this.bases[k].team === 'neutral' && this.dist(a, k) < depth && this.dist(a, k) + this.dist(k, p) < best * 1.12));
  }

  /** what a new base should be: defence facing the player, otherwise a factory for every two resource islands */
  private roleFor(k: number): Exclude<IslandRole, 'basis'> {
    const isl = this.world.islands[k];
    const nearPlayer = this.bases.some(b => b.team === 'spieler' && Math.hypot(b.island.cx - isl.cx, b.island.cz - isl.cz) < 7000 * this.world.spread);
    if (nearPlayer) return 'verteidigung';
    const own = this.bases.filter(b => b.team === 'feind').map(b => b.island.role);
    const fab = own.filter(r => r === 'fabrik').length, raw = own.filter(r => r === 'rohstoff').length;
    return fab * 2 < raw ? 'fabrik' : 'rohstoff';
  }

  private start(kind: Plan['kind'], k: number, otter: Walrus) {
    const isl = this.world.islands[k];
    // close in for a conquest; for an attack stay out of the island's gun range
    const p = offshore(this.world, isl, this.ship.pos.x, this.ship.pos.z, kind === 'angriff' ? 1300 : 450);
    this.foe.helm.order(p.x, p.z);
    this.plan = { kind, island: k, stage: 'anfahrt', otter: this.foe.otters.indexOf(otter), goal: null, tries: 0, clock: 0, role: this.roleFor(k), reported: false };
  }

  private end(shun = false) {
    const p = this.plan;
    if (!p) return;
    if (shun && p.island >= 0) this.shun.set(p.island, SHUN);
    this.plan = null;
    this.foe.helm.release();
    this.think = THINK;
  }

  private setStage(stage: Plan['stage']) {
    this.plan!.stage = stage;
    this.plan!.clock = 0;
  }

  private runPlan(dt: number) {
    const p = this.plan!, w = this.foe.otters[p.otter], base = this.bases[p.island], isl = this.world.islands[p.island];
    const pilots = this.foe.pilots;
    p.clock += dt;
    if (w.state === 'zerstoert') { this.end(p.island >= 0); return; }
    if (this.ship.fuel < 0.2 && p.stage !== 'heim') { pilots.homeWalrus(w); this.setStage('heim'); return; }
    if (p.stage === 'anfahrt') {
      if (p.clock > 900) { this.end(true); return; }
      if (p.kind === 'erobern' && (base.team !== 'neutral' || base.pending)) { this.end(); return; }
      if (p.kind === 'angriff' && base.team !== 'spieler') { this.end(); return; }
      if (!this.foe.helm.onStation || w.state !== 'dock') return;
      // fit the Otter for the job: the Avatar always, an ACCB for a conquest
      w.fit = { weapon: 'avatar', ammo: AVATAR_SHOTS, cargo: p.kind === 'erobern' ? 'accb' : null, missiles: 0, role: p.role };
      w.rearm();
      if (p.kind === 'erobern' && w.load.cargo !== 'accb') { this.end(); return; }
      const cc = base.commandCentre;
      p.goal = p.kind === 'erobern' ? this.siteGoal(p) : cc?.alive ? this.firingSpot(p, w, cc, this.aimPoint(cc)) : null;
      if (!p.goal) { this.end(true); return; }
      pilots.setWalrus(w, new THREE.Vector2(p.goal.x, p.goal.z));
      this.setStage('einsatz');
      return;
    }
    if (p.stage === 'einsatz') {
      // the drive in from out of gun range takes a while: an attack gets longer
      if (p.clock > (p.kind === 'angriff' ? 900 : 600)) { pilots.homeWalrus(w); this.setStage('heim'); this.shun.set(p.island, SHUN); return; }
      if (p.kind === 'erobern') this.conquer(p, w, base, isl);
      else this.attack(p, w, base);
      return;
    }
    // heim: the ship waits until the Otter is back in the dock (only a lost cause is left behind)
    if (w.state === 'dock' || p.clock > 900) { this.end(); return; }
    if (w.state === 'fahren' && !pilots.isHome(w)) pilots.homeWalrus(w);
  }

  /**
   * A free building site on the island: the whole island is searched on a grid
   * (a volcano may have only a handful of flat spots), the sites nearest the ship
   * and lowest first; a retry takes the next one.
   */
  private siteGoal(p: Plan): { x: number; z: number } | null {
    const isl = this.world.islands[p.island], base = this.bases[p.island], s = this.ship.pos, step = 90;
    const sites: { x: number; z: number; score: number }[] = [];
    for (let z = -isl.size / 2; z <= isl.size / 2; z += step) for (let x = -isl.size / 2; x <= isl.size / 2; x += step) {
      const h = isl.heightAt(isl.cx + x, isl.cz + z);
      if (h < 5 || h > 80) continue;
      const site = base.findSite(isl.cx + x, isl.cz + z, step / 2, 0);
      if (site) sites.push({ ...site, score: Math.hypot(site.x - s.x, site.z - s.z) + isl.heightAt(site.x, site.z) * 8 });
    }
    sites.sort((a, b) => a.score - b.score);
    // several grid points find the same flat spot: skip those close to one already tried
    const picks: { x: number; z: number }[] = [];
    for (const c of sites) if (picks.every(q => Math.hypot(q.x - c.x, q.z - c.z) > 150)) picks.push(c);
    return picks[p.tries] ? { x: picks[p.tries].x, z: picks[p.tries].z } : null;
  }

  /**
   * A place to fire from: on a ring of points round the command centre, the ones
   * the Otter can stand on (afloat, or ground not too steep) with nothing but the
   * building between its guns and the aim point; the nearest not yet tried.
   */
  private firingSpot(p: Plan, w: Walrus, target: Target, aim: THREE.Vector3): { x: number; z: number } | null {
    const tried = p.spots ?? (p.spots = []);
    if (tried.length >= MAX_SPOTS) return null;
    const from = new THREE.Vector3(), dir = new THREE.Vector3();
    let best: { x: number; z: number } | null = null, bs = Infinity;
    for (const r of [FIRE_RANGE * 0.9, FIRE_RANGE * 0.7, FIRE_RANGE * 0.5, FIRE_RANGE * 0.32]) {
      for (let i = 0; i < 24; i++) {
        const a = i / 24 * Math.PI * 2, x = aim.x + Math.sin(a) * r, z = aim.z + Math.cos(a) * r;
        if (tried.some(q => Math.hypot(q.x - x, q.z - z) < 120)) continue;
        const h = this.world.heightAt(x, z);
        if (h > 0 && Math.acos(Math.min(1, 1 - this.world.slopeAt(x, z))) * 180 / Math.PI > SLOPE.DRIVE) continue;
        const score = Math.hypot(x - w.pos.x, z - w.pos.z);
        if (score >= bs) continue;
        from.set(x, Math.max(h, 0) + 4.5, z);
        dir.copy(aim).sub(from);
        const len = dir.length();
        const hit = this.foe.combat.raycast(from, dir.divideScalar(len), len + 30, w);
        if (hit.target !== target && hit.point.distanceTo(aim) > 20) continue;
        bs = score; best = { x, z };
      }
    }
    if (best) tried.push(best);
    return best;
  }

  private conquer(p: Plan, w: Walrus, base: IslandBase, isl: Island) {
    const pilots = this.foe.pilots;
    if (base.team !== 'neutral' || base.pending) { pilots.homeWalrus(w); this.setStage('heim'); return; }
    if (w.state !== 'fahren' || w.waypoint) return;
    // arrived (or the autopilot gave up): set the ACCB down where it can, or try another way up
    const here = this.world.islandAt(w.pos.x, w.pos.z);
    const site = w.medium === 'land' && here === isl ? base.findSite(w.pos.x, w.pos.z) : null;
    if (site && w.load.cargo === 'accb') {
      base.found('feind', p.role, site);
      w.load.cargo = null;
      this.hooks.found(p.island);
      this.hooks.event({ kind: 'accb', island: p.island });
      pilots.homeWalrus(w);
      this.setStage('heim');
      return;
    }
    if (++p.tries > 3) { this.shun.set(p.island, SHUN); pilots.homeWalrus(w); this.setStage('heim'); return; }
    p.goal = this.siteGoal(p);
    if (p.goal) pilots.setWalrus(w, new THREE.Vector2(p.goal.x, p.goal.z));
  }

  private attack(p: Plan, w: Walrus, base: IslandBase) {
    const pilots = this.foe.pilots, cc = base.commandCentre;
    // the island fell (or someone else took it): done, a conquest may follow
    if (base.team !== 'spieler' || !cc?.alive) { pilots.homeWalrus(w); this.setStage('heim'); return; }
    // out of shots or badly hit: back home
    if (w.load.weapon !== 'avatar' || w.hp < w.maxHp * 0.35) { pilots.homeWalrus(w); this.setStage('heim'); this.shun.set(p.island, SHUN); return; }
    if (w.state !== 'fahren') return;
    // the top of the building: over a crest the middle may be hidden while the roof is not
    const aim = this.aimPoint(cc);
    const d = Math.hypot(aim.x - w.pos.x, aim.z - w.pos.z);
    if (d > FIRE_RANGE || !this.clearShot(w, cc, aim)) {
      // arrived without a clear line, or stuck on the way (too steep, a building): the next firing position
      if (!w.waypoint) {
        p.tries++;
        const spot = this.firingSpot(p, w, cc, aim);
        if (spot) pilots.setWalrus(w, new THREE.Vector2(spot.x, spot.z));
        else { pilots.homeWalrus(w); this.setStage('heim'); this.shun.set(p.island, SHUN); }
      }
      return;
    }
    if (w.waypoint) pilots.stopWalrus(w);
    if (!p.reported) { p.reported = true; this.hooks.event({ kind: 'attack', island: p.island }); }
    w.aim.copy(aim);
    w.aimValid = true;
    this.fireOrders.set(w, { trigger: true, missile: false });
  }

  /** the highest of the target's hit spheres, a little below its top */
  private aimPoint(t: Target): THREE.Vector3 {
    let best: [number, number, number, number] | null = null;
    for (const sp of t.spheres()) if (!best || sp[1] + sp[3] > best[1] + best[3]) best = sp;
    return best ? new THREE.Vector3(best[0], best[1] + best[3] * 0.4, best[2]) : t.centre(new THREE.Vector3());
  }

  /** nothing but the target between the Otter's guns and the aim point */
  private clearShot(w: Walrus, t: Target, to: THREE.Vector3): boolean {
    const from = new THREE.Vector3(w.pos.x, w.model.group.position.y + 4.5, w.pos.z);
    const dir = to.clone().sub(from), len = dir.length();
    const hit = this.foe.combat.raycast(from, dir.divideScalar(len), len + 30, w);
    return hit.target === t || hit.point.distanceTo(to) < 20;
  }

  // ---------- the Stoorworm ----------
  /** the Stoorworm close and in sight: the ship sails off into open water (an Otter of its own out: it stays and waits) */
  private keepOff(dt: number) {
    const s = this.ship.pos, helm = this.foe.helm;
    this.hooks.prey().centre(v3);
    const d = Math.hypot(v3.x - s.x, v3.z - s.z);
    if (this.evade > 0) {
      this.evade -= dt;
      if (this.evade <= 0 || d > KEEP_OFF * 1.6) { this.evade = 0; if (!this.plan) helm.release(); }
      return;
    }
    if (d > KEEP_OFF || !this.hooks.prey().alive || !this.hooks.sees(v3.x, v3.z)) return;
    if (this.plan && this.plan.stage !== 'anfahrt') return;
    // straight away from it, or as near that as the islands and the edge of the sea allow
    const a = Math.atan2(s.x - v3.x, s.z - v3.z), edge = this.world.size / 2 - 800;
    for (const da of [0, 0.5, -0.5, 1, -1, 1.6, -1.6]) {
      const x = s.x + Math.sin(a + da) * 3000, z = s.z + Math.cos(a + da) * 3000;
      if (Math.abs(x) > edge || Math.abs(z) > edge || this.world.islands.some(i => i.distanceTo(x, z) < 700)) continue;
      if (this.plan) this.end();      // the approach is called off (and tried again later)
      helm.order(x, z);
      this.evade = 100;
      return;
    }
  }

  // ---------- air defence and air attack ----------
  /**
   * Who its Skuas go after: intruders near its ship, an island it is building or
   * its Otter at work (one Skua each), the Stoorworm in sight and in reach (one
   * now and then), and the command centre of a raid (two). One take-off per call
   * (the lift is busy).
   */
  private defend() {
    const s = this.ship.pos, p = this.plan, worker = p && p.stage === 'einsatz' ? this.foe.otters[p.otter] : null;
    const building = this.bases.filter(b => b.pending?.team === 'feind').map(b => b.island);
    const prey = this.hooks.prey();
    const wants: { t: Target; n: number; hunt?: boolean }[] = this.hooks.foes().filter(t => {
      if (!t.alive || t === prey) return false;
      t.centre(v3);
      if (!this.hooks.sees(v3.x, v3.z)) return false;
      return Math.hypot(v3.x - s.x, v3.z - s.z) < SCRAMBLE
        || building.some(i => i.distanceTo(v3.x, v3.z) < 2000)
        || (!!worker && Math.hypot(v3.x - worker.pos.x, v3.z - worker.pos.z) < 2000);
    }).sort((a, b) => a.centre(v3).distanceTo(s) - b.centre(vel).distanceTo(s)).map(t => ({ t, n: 1 }));
    // the hunt for the Stoorworm
    if (this.huntIn <= 0 && prey.alive && this.hooks.sees(prey.centre(v3).x, v3.z) && Math.hypot(v3.x - s.x, v3.z - s.z) < HUNT) wants.push({ t: prey, n: 1, hunt: true });
    const cc = this.raidOn >= 0 && this.raidFor > 0 ? this.bases[this.raidOn].commandCentre : undefined;
    if (cc?.alive && cc.team === 'spieler') wants.push({ t: cc, n: 2 });
    for (const w of wants) {
      if (this.sorties.filter(x => x.target === w.t && x.stage !== 'heim').length >= w.n) continue;
      if (this.launch(w.t, w.hunt) && w.hunt) this.huntIn = this.tune.huntPause;
      return;
    }
  }

  /** a ready Skua takes off against a target; false if none could */
  private launch(t: Target, hunt = false): boolean {
    const i = this.skuas.findIndex(m => m.state === 'deck' && m.hp >= m.maxHp * 0.6 && m.fuel > 0.5 && (m.missiles > 0 || m.armed));
    if (i < 0) return false;
    const m = this.foe.skuas[i];
    if (m.liftBusy) return false;
    m.toggleLaunch();
    if (m.state !== 'start') return false;
    this.sorties.push({ skua: i, target: t, stage: 'start', unseen: 0, shotAt: -99, pass: 0, clock: 0, hunt });
    this.hooks.event({ kind: 'sortie', skua: m, target: t });
    return true;
  }

  /** now and then a raid: the nearest island of the player's in reach that has no gun standing loses its command centre to its Skuas */
  private raid() {
    if (this.raidIn > 0 || !this.skuas.some(m => m.state === 'deck' && m.hp >= m.maxHp * 0.6 && (m.missiles > 0 || m.armed))) return;
    const s = this.ship.pos;
    let best = -1, bd = RAID_RANGE;
    this.bases.forEach((b, k) => {
      const cc = b.commandCentre;
      if (b.team !== 'spieler' || !cc?.alive || this.guns(b) > 0) return;
      const d = Math.hypot(cc.p.x - s.x, cc.p.z - s.z);
      if (d < bd) { bd = d; best = k; }
    });
    if (best < 0) return;
    this.raidOn = best;
    this.raidFor = 60;
    this.raidIn = this.tune.raidPause;
    this.hooks.event({ kind: 'raid', island: best });
  }

  private flySorties(dt: number) {
    const ship = this.ship.pos, pilots = this.foe.pilots;
    this.sorties = this.sorties.filter(s => {
      const m = this.foe.skuas[s.skua];
      s.clock += dt;
      if (m.state === 'absturz') return false;
      if (s.stage === 'start') {
        if (m.state === 'flug') { s.stage = 'jagd'; s.clock = 0; }
        else if (m.state === 'deck') return false;    // the catapult never fired
        return true;
      }
      if (s.stage === 'jagd') {
        const t = s.target;
        const visible = !!t && t.alive && this.canSee(m, t);
        s.unseen = visible ? 0 : s.unseen + dt;
        const spent = m.missiles <= 0 && !m.armed;
        if (!t || !t.alive || s.unseen > 15 || spent || m.fuel < 0.35 || m.hp < m.maxHp * 0.4 || this.reachOut(m) > LEASH || s.clock > (s.hunt ? HUNT_TIME : 240)) {
          s.stage = 'heim';
          return true;
        }
        // a defence drone in the way (its lock fell on one): it goes for that first, missile and all (the drone swallows
        // the missile, which is what it is there for), then on to its target
        const drone = m.lock instanceof ShieldDrone && m.lock.alive ? m.lock : null;
        this.pursue(s, m, drone ?? t, dt);
        return true;
      }
      // heim: fly back to the ship, then the landing autopilot takes over
      if (m.state === 'deck') return false;
      if (m.state === 'flug') {
        const d = Math.hypot(m.pos.x - ship.x, m.pos.z - ship.z);
        // first round hard and slow towards the ship (the autopilot's wide turn would carry it out of radio range)
        s.turning = d > 1500 && this.turnBack(m, ship);
        if (s.turning) return true;
        if (d < 2600) { pilots.setManta(m, null); m.toggleLaunch(); }
        else if (!m.waypoint || Math.hypot(m.waypoint.x - ship.x, m.waypoint.y - ship.z) > 300) pilots.setManta(m, new THREE.Vector2(ship.x, ship.z));
      }
      return true;
    });
  }

  /** how far from its ship a Skua gets before it has turned round, flying on as it does now */
  private reachOut(m: Manta): number {
    return reachOut(m, this.ship.pos);
  }

  /** steer round towards the ship (see airAttack.ts); false once it points there */
  private turnBack(m: Manta, ship: THREE.Vector3): boolean {
    let v = this.sticks.get(m);
    if (!v) { v = new VirtualInput(); this.sticks.set(m, v); }
    if (!turnRound(m, ship, v)) return false;
    this.fireOrders.delete(m);
    return true;
  }

  /** its own eyes reach 3 km, otherwise what the enemy sees */
  private canSee(m: Manta, t: Target): boolean {
    t.centre(v3);
    return Math.hypot(v3.x - m.pos.x, v3.z - m.pos.z) < 3000 || this.hooks.sees(v3.x, v3.z);
  }

  /** fly at the target (see airAttack.ts), within its leash round the ship */
  private pursue(s: Sortie, m: Manta, t: Target, dt: number) {
    let v = this.sticks.get(m);
    if (!v) { v = new VirtualInput(); this.sticks.set(m, v); }
    this.fireOrders.set(m, attackRun(m, t, s, v, this.ship.pos, LEASH, this.time, dt));
  }

  // ---- save game ----
  saveState() {
    return {
      plan: this.plan ? { ...this.plan } : null, shun: [...this.shun], attackIn: this.attackIn, time: this.time,
      raidIn: this.raidIn, raidOn: this.raidOn, raidFor: this.raidFor, evade: this.evade, huntIn: this.huntIn,
      yard: this.yard, yardClock: this.yardClock, yardShun: this.yardShun,
      // a Skua's target cannot be saved: after loading, Skuas in the air fly home
      sorties: this.sorties.map(s => ({ skua: s.skua, stage: s.stage === 'jagd' ? 'heim' as const : s.stage })),
    };
  }

  loadState(s: ReturnType<Omega['saveState']>) {
    this.plan = s.plan ? { ...s.plan } : null;
    this.shun = new Map(s.shun);
    this.attackIn = s.attackIn; this.time = s.time;
    // (saves from before the raids have none of these)
    this.raidIn = s.raidIn ?? this.tune.firstRaid; this.raidOn = s.raidOn ?? -1; this.raidFor = s.raidFor ?? 0; this.evade = s.evade ?? 0; this.huntIn = s.huntIn ?? 0;
    this.yard = s.yard ?? -1; this.yardClock = s.yardClock ?? 0; this.yardShun = s.yardShun ?? 0;
    this.sorties = s.sorties.map(x => ({ skua: x.skua, target: null, stage: x.stage, unseen: 0, shotAt: -99, pass: 0, clock: 0 }));
  }
}
