import * as THREE from 'three';
import type { Archipelago } from '../world/archipelago';
import type { IslandBase } from '../world/base';
import type { Environment } from '../world/environment';
import { waveHeight } from '../world/ocean';
import { buildCarrier, CARRIER_WATERLINE } from '../models/carrier';
import { buildWalrus } from '../models/walrus';
import { enemyTint } from '../models/tint';
import { CARRIER_HULL_SHARE, HP } from './arsenal';
import { SINK_TIME } from './carrierController';
import type { Combat, Target } from './combat';
import type { Obstacle } from './walrus';
import { t } from '../i18n';

/** deep enough for both ships (their keels reach 26 m) */
const DEEP = -30;
/** the dummy tanks: hit points (an Otter's laser needs three hits, a Harbinger one, a Skua an Assassin and four laser hits) */
const TANK_HP = 2000;
/** a dummy tank shot down stands up again after this long (s); a new target ship drops anchor this long after the
 *  last one was sunk (once it has gone under) */
const RAISE = 20, RAISE_SHIP = SINK_TIME + 10;
/** how far apart the tanks stand along the beach, and how far inland from the waterline (m) */
const TANK_SIDES = [-120, -40, 40, 120], INLAND = 30;
/**
 * The Stoorworm lies this far beyond the deep-water line and this far along the coast from the tanks, its bow
 * pointing at them: the Skua leaves the catapult straight towards the beach a good kilometre off, and the island
 * comes at it obliquely. The target ship lies this much further out to sea (m).
 */
const SHIP_OUT = 400, SHIP_ALONG = 900, DUMMY_OFF = 750;
/** islands that are someone's (their guns reach 950 m) and the Nuckelavee stay at least this far away, better
 *  much further (m) */
const CLEAR_OF_ISLANDS = 1800, CLEAR_OF_FOE = 3500;

/** where the training takes place: the island, the Stoorworm's berth, the target ship and the tanks on the beach */
export interface RangeSpot {
  island: number;
  carrier: { x: number; z: number; heading: number };
  ship: { x: number; z: number; heading: number };
  tanks: { x: number; z: number; heading: number }[];
}

/**
 * A neutral island for the combat training, far from every island that is someone's and from the Nuckelavee: a
 * stretch of open sea in front of a gentle beach with room for four tanks; null if the world has none.
 */
export function findRange(world: Archipelago, bases: IslandBase[], foe: { x: number; z: number }): RangeSpot | null {
  const h = (x: number, z: number) => world.heightAt(x, z);
  const deep = (x: number, z: number) => h(x, z) < DEEP;
  const held = bases.filter(b => b.team !== 'neutral' || b.pending).map(b => b.island);
  const clear = (x: number, z: number) => Math.min(Infinity, ...held.map(i => i.distanceTo(x, z)));
  let best: { spot: RangeSpot; score: number } | null = null;
  world.islands.forEach((isl, k) => {
    if (bases[k].team !== 'neutral' || bases[k].pending) return;
    for (let a = 0; a < 24; a++) {
      const ang = a / 24 * Math.PI * 2, dx = Math.sin(ang), dz = Math.cos(ang);
      // `out` metres out along the ray from the island's centre and `side` metres to its right
      const at = (out: number, side = 0) => ({ x: isl.cx + dx * out + dz * side, z: isl.cz + dz * out - dx * side });
      let coast = 0;
      while (coast < 6000 && !deep(at(coast).x, at(coast).z)) coast += 40;
      if (coast >= 6000) continue;
      // open sea in front of the beach
      let open = true;
      for (let s = 0; s <= 1600 && open; s += 100) { const p = at(coast + s); open = deep(p.x, p.z); }
      if (!open) continue;
      // the berth along the coast, on whichever side has deep water round it and round the target ship
      const sea = (out: number, side: number) => [[0, 0], [250, 0], [-250, 0], [0, 250], [0, -250]].every(([o, s]) => { const p = at(out + o, side + s); return deep(p.x, p.z); });
      const sgn = [-1, 1].find(g => sea(coast + SHIP_OUT, g * SHIP_ALONG) && sea(coast + SHIP_OUT + DUMMY_OFF, g * SHIP_ALONG));
      if (sgn === undefined) continue;
      // the tanks: a little inland from the waterline, on gentle ground
      const tanks: RangeSpot['tanks'] = [];
      for (const side of TANK_SIDES) {
        let r = coast;
        while (r > 0 && h(at(r, side).x, at(r, side).z) < 1.5) r -= 5;
        if (r <= INLAND) break;
        const p = at(r - INLAND, side), y = h(p.x, p.z);
        const slope = Math.max(Math.abs(h(p.x + 4, p.z) - h(p.x - 4, p.z)), Math.abs(h(p.x, p.z + 4) - h(p.x, p.z - 4))) / 8;
        if (y < 1.5 || y > 25 || slope > 0.3) break;
        // in plain sight from the sea: nothing in front of it higher than where it stands (no dune crest)
        let seen = true;
        for (let k = 5; k <= INLAND + 60 && seen; k += 5) { const q = at(r - INLAND + k, side); seen = h(q.x, q.z) <= y + 0.5; }
        if (!seen) break;
        tanks.push({ x: p.x, z: p.z, heading: Math.atan2(dx, dz) });
      }
      if (tanks.length < TANK_SIDES.length) continue;
      const berth = at(coast + SHIP_OUT, sgn * SHIP_ALONG), room = clear(berth.x, berth.z);
      const far = Math.hypot(berth.x - foe.x, berth.z - foe.z);
      if (room < CLEAR_OF_ISLANDS || far < CLEAR_OF_FOE) continue;
      // the bow straight at the tanks (the Skua leaves the catapult towards them); the target ship seaward, lying
      // along the coast
      const dummy = at(coast + SHIP_OUT + DUMMY_OFF, sgn * SHIP_ALONG);
      const along = Math.atan2(dz, -dx), mid = { x: (tanks[1].x + tanks[2].x) / 2, z: (tanks[1].z + tanks[2].z) / 2 };
      const bow = Math.atan2(mid.x - berth.x, mid.z - berth.z);
      // plenty of room and a short way to the beach
      const beach = Math.hypot(tanks[1].x - berth.x, tanks[1].z - berth.z);
      const score = Math.min(room, 8000) + Math.min(far, 12000) * 0.3 - beach * 2;
      if (!best || score > best.score) {
        best = { score, spot: { island: k, carrier: { ...berth, heading: bow }, ship: { ...dummy, heading: along }, tanks } };
      }
    }
  });
  return best ? (best as { spot: RangeSpot }).spot : null;
}

/** the target ship: the Nuckelavee's shape at anchor; sunk, it goes down as a carrier does, and a new one takes its place */
class DummyShip implements Target {
  readonly kind = 'einheit' as const;
  readonly team = 'feind' as const;
  readonly dummy = true;
  /** s since it was sunk (-1: afloat), as a carrier's (main.ts sets off the blasts and fires on it) */
  sinking = -1;
  private raiseIn = 0;
  readonly name = t('train.shipName');
  readonly maxHp = HP.carrier;
  hp = HP.carrier;
  readonly model = buildCarrier('feind');
  readonly pos: THREE.Vector3;
  readonly forward: THREE.Vector3;
  private port: THREE.Vector3;
  private p = new THREE.Vector3();

  constructor(private x: number, private z: number, private heading: number) {
    this.pos = new THREE.Vector3(x, 0, z);
    this.forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    this.port = new THREE.Vector3(this.forward.z, 0, -this.forward.x);
  }

  private local(x: number, z: number, out: THREE.Vector3) {
    return out.set(this.x, 0, this.z).addScaledVector(this.forward, z).addScaledVector(this.port, x);
  }
  /** world position of a point in ship coordinates (x to port, z forward), as the carrier's */
  localToWorld(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 { return this.local(x, z, out); }
  get alive(): boolean { return this.sinking < 0; }

  spheres(): [number, number, number, number][] {
    return (this.model.stemZ > 120 ? [-80, -40, 0, 40, 80, 115] : [-80, -40, 0, 40, 80]).map(z => {
      const p = this.local(0, z, this.p);
      return [p.x, 9, p.z, 38];
    });
  }
  centre(out: THREE.Vector3) { return out.set(this.x, 12, this.z); }
  velocity(out: THREE.Vector3) { return out.set(0, 0, 0); }
  /** the hull takes its share of a hit as a carrier's does; at nothing it goes down */
  hit(damage: number): boolean {
    if (!this.alive) return false;
    this.hp = Math.max(0, this.hp - damage * CARRIER_HULL_SHARE);
    if (this.hp > 0) return false;
    this.sinking = 0;
    this.raiseIn = RAISE_SHIP;
    return true;
  }

  /** riding the waves as a carrier does (carrierController.ts place), going down as it does (goDown); returns true
   *  when a new one lies at anchor */
  update(dt: number, env: Environment): boolean {
    let anew = false;
    if (this.sinking >= 0) {
      this.sinking = Math.min(SINK_TIME, this.sinking + dt);
      if ((this.raiseIn -= dt) <= 0) { this.sinking = -1; this.hp = this.maxHp; anew = true; }
    }
    const amp = env.w.waves, time = env.elapsed;
    const at = (dz: number, dx: number) => { const p = this.local(dx, dz, this.p); return waveHeight(p.x, p.z, time, amp); };
    const bow = at(90, 0), stern = at(-90, 0), port = at(0, 34), star = at(0, -34), mid = at(0, 0);
    const heave = (bow + stern + port + star + mid) / 5;
    const g = this.model.group;
    g.position.set(this.x, -CARRIER_WATERLINE + heave * 0.8, this.z);
    g.rotation.set(-Math.atan2(bow - stern, 180) * 0.8, this.heading, Math.atan2(port - star, 68) * 0.8, 'YXZ');
    if (this.sinking >= 0) {
      const k = this.sinking / SINK_TIME;
      g.position.y -= Math.max(0, k - 0.25) / 0.75 * 70;
      g.rotation.z += 0.32 * Math.min(1, k * 1.6);
      g.rotation.x -= 0.14 * Math.max(0, k - 0.3);
    }
    g.visible = this.sinking < SINK_TIME;
    return anew;
  }
}

/** a tank on the beach: an Otter in the enemy's colours that does not move or shoot; shot down, it stands up again */
class DummyTank implements Target {
  readonly kind = 'einheit' as const;
  readonly team = 'feind' as const;
  readonly dummy = true;
  readonly maxHp = TANK_HP;
  hp = TANK_HP;
  alive = true;
  readonly model = buildWalrus();
  private down = 0;

  constructor(readonly name: string, x: number, z: number, heading: number, ground: (x: number, z: number) => number) {
    enemyTint(this.model.group);
    const f = { x: Math.sin(heading), z: Math.cos(heading) }, s = { x: f.z, z: -f.x };
    const at = (dz: number, dx: number) => ground(x + f.x * dz + s.x * dx, z + f.z * dz + s.z * dx);
    const yF = at(6.5, 0), yB = at(-6.5, 0), yL = at(0, 3.5), yR = at(0, -3.5);
    const g = this.model.group;
    g.position.set(x, Math.max((yF + yB + yL + yR) / 4, ground(x, z)), z);
    g.rotation.set(-Math.atan2(yF - yB, 13), heading, Math.atan2(yL - yR, 7), 'YXZ');
  }

  spheres(): [number, number, number, number][] {
    const g = this.model.group.position;
    return [[g.x, g.y + 3, g.z, 6.5]];
  }
  centre(out: THREE.Vector3) { return out.copy(this.model.group.position).setY(this.model.group.position.y + 3); }
  velocity(out: THREE.Vector3) { return out.set(0, 0, 0); }
  hit(damage: number): boolean {
    if (!this.alive) return false;
    this.hp -= damage;
    if (this.hp > 0) return false;
    this.hp = 0;
    this.alive = false;
    this.model.group.visible = false;
    this.down = RAISE;
    return true;
  }

  /** true when it stood up again this frame */
  update(dt: number): boolean {
    if (this.alive || (this.down -= dt) > 0) return false;
    this.alive = true;
    this.hp = this.maxHp;
    this.model.group.visible = true;
    return true;
  }
}

/**
 * The combat training's targets: the anchored target ship for the Stoorworm's laser turret and its Hammerheads,
 * and four tanks on the beach for the Skua and the Otter. They never shoot back, and nothing aims at them by
 * itself (`dummy`): only what the player fires by hand.
 */
export class TrainingRange {
  readonly group = new THREE.Group();
  readonly ship: DummyShip;
  readonly tanks: DummyTank[];
  /** where the tanks stand: the Otters drive round them, the trees keep clear */
  readonly obstacles: Obstacle[];

  constructor(readonly spot: RangeSpot, world: Archipelago, combat: Combat) {
    this.group.name = 'training-range';
    const s = spot.ship;
    this.ship = new DummyShip(s.x, s.z, s.heading);
    this.tanks = spot.tanks.map((p, i) => new DummyTank(t('train.tankName', { n: i + 1 }), p.x, p.z, p.heading, (x, z) => world.heightAt(x, z)));
    this.obstacles = spot.tanks.map(p => ({ x: p.x, z: p.z, r: 6 }));
    this.group.add(this.ship.model.group, ...this.tanks.map(d => d.model.group));
    combat.add(this.ship);
    for (const d of this.tanks) combat.add(d);
  }

  /** the tanks in the middle of the beach (for bearings) */
  get beach(): THREE.Vector3 {
    const p = this.spot.tanks;
    return new THREE.Vector3((p[1].x + p[2].x) / 2, 0, (p[1].z + p[2].z) / 2);
  }

  /** what came back this frame: tanks standing up again, a new target ship */
  update(dt: number, env: Environment): { tanks: boolean; ship: boolean } {
    const ship = this.ship.update(dt, env);
    let tanks = false;
    for (const d of this.tanks) tanks = d.update(dt) || tanks;
    return { tanks, ship };
  }

  isTarget(t: Target): boolean {
    return t === this.ship || this.tanks.includes(t as DummyTank);
  }
}
