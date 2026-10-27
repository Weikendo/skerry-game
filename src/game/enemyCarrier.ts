import type { Archipelago } from '../world/archipelago';
import type { IslandBase } from '../world/base';
import type { Island } from '../world/island';
import { mulberry32 } from '../engine/lowpoly';
import type { CarrierController } from './carrierController';
import { CARRIER_TANK } from './stores';
import { TRANSFER_RANGE } from './transfer';

/** what the enemy's ship is doing: lying at home (refuelling), under way, lying off an island on watch, or on an order of its strategy */
export type Duty = 'hafen' | 'fahrt' | 'wache' | 'auftrag';

/** a full tank at home takes this long (s), if the network has the fuel */
const REFUEL_TIME = 180;
/** how long it lies off an island on watch (s) */
const WATCH = [150, 360];
/** islands it patrols lie at most this far from its home (times the world's spread) */
const PATROL_RADIUS = 10000;
/** tank share it keeps in hand beyond the way there and home */
const RESERVE = 0.15;
/** the speed steps on patrol (Halbe Fahrt) and on an order (Volle Fahrt) */
const PATROL_STEP = 3, ORDER_STEP = 4;
/** waiting at home for fuel that does not come: after this long (s) it sails with what it has */
const DRY_WAIT = 150;
/** share of its patrols that go to the front (when its strategy names one) */
const FRONT_SHARE = 0.65;
/** off a player's island it lies this far out (its guns reach 950 m) */
const STANDOFF = 2400;

/** deep water off an island, on the side facing (fromX, fromZ) if that is clear, else the nearest clear side */
export function offshore(world: Archipelago, isl: Island, fromX: number, fromZ: number, gap = 900): { x: number; z: number } {
  const a0 = Math.atan2(fromX - isl.cx, fromZ - isl.cz), r = isl.size / 2 * Math.SQRT2 + gap;
  for (let k = 0; k < 12; k++) {
    const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 6;
    const x = isl.cx + Math.sin(a) * r, z = isl.cz + Math.cos(a) * r;
    if (world.islands.every(o => o === isl || o.distanceTo(x, z) > gap)) return { x, z };
  }
  return { x: isl.cx + Math.sin(a0) * r, z: isl.cz + Math.cos(a0) * r };
}

/**
 * The Nuckelavee's helm. Without an order it keeps watch: it sails at half
 * speed to the front its strategy names (or from one of its islands, or a
 * neutral one linked to them, to the next), lies off each for a few minutes
 * and goes home to refuel from its network when the tank runs low. The enemy's strategy (Omega) gives it orders:
 * sail to a point at full speed and hold there until released.
 */
export class EnemyCarrier {
  duty: Duty = 'wache';
  /** the island it is heading for or lying off (-1: none, or an order) */
  station = -1;
  wait = 120;
  /** fuel from the home network: units wanted → units given (null: unlimited) */
  supply: ((units: number) => number) | null = null;
  /** its home island (where it refuels), -1 when it holds none */
  home: () => number;
  /** the islands at the front its strategy wants watched (a player's island among them: lain off out of gun range) */
  front: () => number[] = () => [];
  private rnd: () => number;
  private orderAt: { x: number; z: number } | null = null;
  private dry = 0;

  constructor(readonly ship: CarrierController, private world: Archipelago, private bases: IslandBase[], seed: number) {
    this.rnd = mulberry32(seed);
    ship.cruise = PATROL_STEP;
    this.home = () => this.nearestOwn();
  }

  /** its base, or failing that its nearest island; -1 when it holds none */
  nearestOwn(): number {
    const own = this.bases.map((b, k) => ({ b, k })).filter(({ b }) => b.team === 'feind');
    const base = own.find(({ b }) => b.island.role === 'basis');
    if (base) return base.k;
    let best = -1, bd = Infinity;
    for (const { k } of own) {
      const isl = this.world.islands[k], d = Math.hypot(isl.cx - this.ship.pos.x, isl.cz - this.ship.pos.z);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  /** a place to start: off its home on the side facing the middle of the sea */
  placeAtHome() {
    const k = this.home();
    if (k < 0) return;
    const isl = this.world.islands[k];
    const p = offshore(this.world, isl, 0, 0, 1200);
    this.ship.pos.set(p.x, 0, p.z);
    this.ship.prev.copy(this.ship.pos);
    this.ship.heading = Math.atan2(p.x - isl.cx, p.z - isl.cz);
    this.ship.throttle = 1;
    this.ship.speed = 0;
    this.ship.waypoint = null;
    this.station = k;
    this.duty = 'wache';
    this.wait = 120;
    this.orderAt = null;
  }

  /** an order: sail there at full speed and hold */
  order(x: number, z: number) {
    this.orderAt = { x, z };
    this.duty = 'auftrag';
    this.station = -1;
    this.ship.cruise = ORDER_STEP;
    this.ship.setWaypoint(x, z, true);
  }

  /** at the ordered point and stopped */
  get onStation(): boolean {
    return this.duty === 'auftrag' && !this.ship.waypoint && Math.abs(this.ship.speed) < 1.5;
  }

  /** the order is done: back to patrolling (after a short pause) */
  release() {
    this.orderAt = null;
    if (this.duty === 'auftrag') { this.duty = 'wache'; this.wait = 30; }
  }

  /** within reach of its home network's transfer drones */
  get atHome(): boolean {
    const home = this.home();
    return home >= 0 && this.world.islands[home].distanceTo(this.ship.pos.x, this.ship.pos.z) < TRANSFER_RANGE;
  }

  /** break off and sail home to refuel (an order is dropped) */
  goHome() {
    const home = this.home();
    this.orderAt = null;
    if (home >= 0) this.sail(home); else { this.duty = 'wache'; this.wait = WATCH[0]; }
  }

  update(dt: number) {
    const s = this.ship;
    s.autopilotMessage = '';   // its autopilot reports to the enemy, not to the player
    const home = this.home();
    if (this.duty === 'auftrag') {
      // pushed off the point (or the autopilot gave up short of it): sail there again
      if (!s.waypoint && this.orderAt && Math.hypot(this.orderAt.x - s.pos.x, this.orderAt.z - s.pos.z) > 700) s.setWaypoint(this.orderAt.x, this.orderAt.z, true);
      return;
    }
    if (this.duty === 'fahrt') {
      if (s.waypoint) {
        // running dry on the way: break off and go home
        if (s.fuel < 0.25 && home >= 0 && this.station !== home) this.sail(home);
        return;
      }
      this.duty = this.station === home ? 'hafen' : 'wache';
      this.wait = WATCH[0] + this.rnd() * (WATCH[1] - WATCH[0]);
      this.dry = 0;
      return;
    }
    // lying still: at home it takes on fuel from its network (within the transfer drones' reach of the island)
    if (this.duty === 'hafen') {
      if (home < 0) this.duty = 'wache';
      else if (!this.atHome) { this.sail(home); return; }
      else {
        const want = Math.min(CARRIER_TANK - s.stores.treibstoffTraeger, CARRIER_TANK / REFUEL_TIME * dt);
        const got = this.supply ? this.supply(want) : want;
        s.stores.treibstoffTraeger += got;
        this.dry = got > 0 || want <= 0 ? 0 : this.dry + dt;
      }
    }
    this.wait -= dt;
    const thirsty = this.duty === 'hafen' && s.fuel < 0.95 && !(this.dry > DRY_WAIT && s.fuel > 0.5);
    if (this.wait > 0 || thirsty) return;
    this.patrol(home);
  }

  /** the next island to watch: mostly one at the front, otherwise its own and the neutral ones linked to them near home;
   *  only where the tank still reaches there and back home with a reserve; otherwise home to refuel */
  private patrol(home: number) {
    const isl = this.world.islands, ref = home >= 0 ? isl[home] : null, s = this.ship;
    const reach = (k: number) => !ref || (Math.hypot(isl[k].cx - s.pos.x, isl[k].cz - s.pos.z) + Math.hypot(isl[k].cx - ref.cx, isl[k].cz - ref.cz)) / s.fuelRange < s.fuel - RESERVE;
    const front = this.front().filter(k => k !== this.station && reach(k));
    if (front.length && this.rnd() < FRONT_SHARE) { this.sail(front[Math.floor(this.rnd() * front.length)]); return; }
    const linked = new Set<number>();
    for (const [a, b] of this.world.links) {
      if (this.bases[a].team === 'feind') linked.add(b);
      if (this.bases[b].team === 'feind') linked.add(a);
    }
    const options = isl.map((_, k) => k).filter(k => k !== this.station && this.bases[k].team !== 'spieler'
      && (this.bases[k].team === 'feind' || linked.has(k))
      && (!ref || Math.hypot(isl[k].cx - ref.cx, isl[k].cz - ref.cz) < PATROL_RADIUS * this.world.spread) && reach(k));
    if (!options.length) {
      if (home >= 0 && this.duty !== 'hafen') this.sail(home); else this.wait = WATCH[0];
      return;
    }
    this.sail(options[Math.floor(this.rnd() * options.length)]);
  }

  private sail(k: number) {
    const s = this.ship, p = offshore(this.world, this.world.islands[k], s.pos.x, s.pos.z, this.bases[k].team === 'spieler' ? STANDOFF : 900);
    this.station = k;
    this.duty = 'fahrt';
    s.cruise = PATROL_STEP;
    s.setWaypoint(p.x, p.z, true);
  }

  saveState() {
    return { ship: this.ship.saveState(), duty: this.duty, station: this.station, wait: this.wait, orderAt: this.orderAt };
  }

  loadState(s: ReturnType<EnemyCarrier['saveState']>) {
    this.ship.loadState(s.ship);
    this.duty = s.duty; this.station = s.station; this.wait = s.wait; this.orderAt = s.orderAt ?? null;
    this.dry = 0;
  }
}
