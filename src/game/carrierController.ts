import * as THREE from 'three';
import { CARRIER_WATERLINE, type CarrierModel } from '../models/carrier';
import { waveHeight } from '../world/ocean';
import type { Environment } from '../world/environment';
import type { Ground } from '../world/terrain';
import { KEYS, type InputLike } from './input';
import type { Target, Team } from './combat';
import { CARRIER_TANK, startStores, type Stores } from './stores';
import { CARRIER_HULL_SHARE, HP } from './arsenal';
import { SHIP_NAME } from './names';
import type { RepairState } from './hullRepair';
import { t } from '../i18n';

export const THROTTLE = [
  { name: t('ship.back'), short: t('ship.back'), speed: -6 },
  { name: t('ship.stop'), short: t('ship.stop'), speed: 0 },
  { name: t('ship.slow'), short: t('ship.slow'), speed: 6 },
  { name: t('ship.half'), short: t('ship.halfShort'), speed: 13 },
  { name: t('ship.full'), short: t('ship.fullShort'), speed: 20 },
  { name: t('ship.flank'), short: t('ship.flank'), speed: 40 },
];

// near land the ship throttles itself: at COAST_NEAR metres of shallow water
// ahead it may only make COAST_MIN m/s, from COAST_FAR on full speed. Flank
// speed (twice full, the remake's addition for the open sea) needs HIGH_SEA
// metres of free water ahead; in between it eases down to full speed, slowly
// enough for the ship's brakes (0.9 m/s²)
const COAST_MIN = 6, COAST_NEAR = 140, COAST_FAR = 700, HIGH_SEA = 1800;
/** water shallower than this (m) is land to the ship's course: its probes, the coast limiter, a waypoint on land */
export const SHALLOW = -14;
const FULL = 20, FLANK = 40;
const FAN = [-0.6, -0.3, 0, 0.3, 0.6];          // radians around the course
const FAN_DIST = [140, 260, 420, 560, 700];
const FAN_FAR = [900, 1150, 1450, 1800];        // only looked at when going faster than full speed
/** fuel per metre at flank speed, relative to full speed and below (constant per metre there, as in the original) */
const FLANK_BURN = 1.5;
/**
 * Wind (the remake's addition, symmetric on purpose for play): straight against the ship it
 * costs, straight from behind it saves the same, ±40 % at storm strength (22 m/s), with the
 * cosine of the angle in between, so a wind from the side changes nothing
 */
const WIND_FUEL = 0.4, WIND_STORM = 22;
/** the waypoint autopilot brakes in time: the ship may make sqrt(2·a·(d − 300 m)) + 6 m/s */
const WP_BRAKE = 0.8;

// fuel: the original's tank lasts 419 km, about 3.9 times the typical distance between
// neighbouring islands (107 km); the world sets `fuelRange` to the same share of its own spacing
const EMPTY_SPEED = 2;      // m/s on the last reserve (the original stops dead)

/** deck outline for building collisions (half width incl. the boom, half length) */
const DECK_HALF_W = 42, DECK_HALF_L = 101;
const KEEL_CLEARANCE = -6; // terrain above this height (m) under the hull = grounded
// hull sample points (local x, z) for grounding
/** the bow sample sits at the stem (the spear's reaches further forward) */
/** from the hull giving out to the ship gone under (s) */
export const SINK_TIME = 40;
const HULL_SAMPLES: [number, number][] = [[-20, 60], [20, 60], [-32, 0], [32, 0], [-32, -95], [32, -95]];

/** Ship handling: throttle steps, a slow rudder, inertia and grounding on the island (both sides' carriers). */
export class CarrierController implements Target {
  readonly name: string;
  readonly team: Team;
  readonly kind = 'einheit' as const;
  readonly armoured = true;
  readonly maxHp = HP.carrier;
  hp = HP.carrier;
  /** seconds since the hull gave out (-1 afloat): the ship stops, burns, lists and goes down */
  sinking = -1;
  /** gone under (the model is hidden) */
  get sunk(): boolean { return this.sinking >= SINK_TIME; }
  get alive(): boolean { return this.hp > 0; }
  /** seconds since the last hit (the repair waits for a quiet spell) */
  sinceHit = Infinity;
  /** what its hull's repair does now (set by the game each frame, for the displays) */
  repair: RepairState = { kind: '', yard: -1, island: '' };
  /** the hold: fuels, ACCBs, missiles, spare vehicles (filled by the transfer drone) */
  readonly stores: Stores = startStores();
  /** own tank 0..1 (the hold's carrier fuel, 256 units); a full tank lasts FUEL_RANGE metres */
  get fuel(): number { return this.stores.treibstoffTraeger / CARRIER_TANK; }
  /** metres on a full tank */
  fuelRange = 18000;
  /** autopilot destination (map click), null = manual */
  waypoint: THREE.Vector2 | null = null;
  autopilotMessage = '';
  readonly pos = new THREE.Vector3();
  readonly prev = new THREE.Vector3();
  readonly forward = new THREE.Vector3(0, 0, 1);
  readonly port = new THREE.Vector3(1, 0, 0); // local +x
  heading = 0;      // 0 = +z, increases towards port (left)
  speed = 0;        // m/s along forward
  throttle = 2;
  /** the speed step the waypoint autopilot sails at (Langsam, Halbe, Volle Fahrt or Äußerste Kraft) */
  cruise = 4;
  /** buildings (circles); the deck must not run over them (shared, kept up to date by main) */
  obstacles: { x: number; z: number; r: number }[] = [];
  rudder = 0;       // -1 starboard .. +1 port
  grounded = false;
  /** current top speed allowed by the coast limiter (m/s) */
  speedLimit = 20;
  /** its defence drones out hold it to this speed (m/s; set by DefenceDrones, Infinity with none out) */
  dragLimit = Infinity;
  /** braking ahead of the autopilot's waypoint (m/s, Infinity without one) */
  private waypointLimit = Infinity;
  /** more waypoints follow (a route): sail through this one instead of stopping at it */
  passThrough = false;

  constructor(readonly model: CarrierModel, private terrain: Ground, private env: Environment,
    start: { x: number; z: number; heading: number; throttle?: number }, side: { team: Team; name: string } = { team: 'spieler', name: SHIP_NAME }) {
    this.team = side.team;
    this.name = side.name;
    this.pos.set(start.x, 0, start.z);
    this.prev.copy(this.pos);
    this.heading = start.heading;
    this.throttle = start.throttle ?? 2;
    this.speed = THROTTLE[this.throttle].speed;
    this.updateAxes();
    this.place(0);
  }

  get throttleName(): string {
    return THROTTLE[this.throttle].name;
  }

  /** input is null while another vehicle is being driven: the ship keeps its orders */
  update(dt: number, input: InputLike | null) {
    if (this.hp <= 0) { this.goDown(dt); return; }
    this.sinceHit += dt;
    let rudderTarget = 0;
    if (input) {
      // gears: W/S, on the pad the D-pad (the stick only steers, so a slanted throw never shifts a gear)
      if (input.hit('KeyW', 'ArrowUp', ...KEYS.faster)) this.setThrottle(Math.min(THROTTLE.length - 1, this.throttle + 1));
      if (input.hit('KeyS', 'ArrowDown', ...KEYS.slower)) this.setThrottle(Math.max(0, this.throttle - 1));
      rudderTarget = input.axis(KEYS.right, KEYS.left);
      // steering by hand takes the ship off autopilot
      if (rudderTarget !== 0 && this.waypoint) { this.waypoint = null; this.autopilotMessage = t('pilot.off'); }
    }
    if (this.waypoint) rudderTarget = this.autopilot(dt);
    else this.waypointLimit = Infinity;
    this.rudder += (rudderTarget - this.rudder) * Math.min(1, dt * 1.2);

    this.speedLimit = Math.min(this.coastLimit(), this.waypointLimit, this.dragLimit);
    if (this.fuel <= 0) this.speedLimit = Math.min(this.speedLimit, EMPTY_SPEED);
    const order = THROTTLE[this.throttle].speed;
    const target = Math.sign(order) * Math.min(Math.abs(order), this.speedLimit);
    const accel = Math.abs(target) > Math.abs(this.speed) ? 0.6 : 0.9;
    this.speed += THREE.MathUtils.clamp(target - this.speed, -accel * dt, accel * dt);

    // a big ship turns slowly and only while it moves (turning circle ~460 m at full speed)
    const newHeading = this.heading + this.rudder * this.speed * 0.0022 * dt;
    const fwd = new THREE.Vector3(Math.sin(newHeading), 0, Math.cos(newHeading));
    const next = this.pos.clone().addScaledVector(fwd, this.speed * dt);

    const depthNow = this.shallowest(this.pos, this.heading);
    const depthNext = this.shallowest(next, newHeading);
    this.prev.copy(this.pos);
    // a building on the shore under the overhanging deck stops the ship like a shoal
    const gapNext = this.buildingGap(next, newHeading);
    const hitsBuilding = gapNext < 3 && gapNext < this.buildingGap(this.pos, this.heading) - 1e-3;
    if (hitsBuilding || (depthNext > KEEL_CLEARANCE && depthNext > depthNow + 1e-3)) {
      // running aground: stop; moving away (e.g. astern) is still allowed
      this.grounded = true;
      this.speed = 0;
      if (this.throttle > 1) this.throttle = 1;
    } else {
      // stays "aground" until the ship has backed into clearly deeper water
      this.grounded = depthNext > KEEL_CLEARANCE - (this.grounded ? 1.5 : 0);
      this.heading = newHeading;
      this.pos.copy(next);
      // fuel by distance: constant per metre up to full speed (as in the original), half as much again at
      // flank speed, more against the wind and less with it
      const burn = this.speedBurn * this.windFactor;
      this.stores.treibstoffTraeger = Math.max(0, this.stores.treibstoffTraeger - Math.abs(this.speed) * burn * dt / this.fuelRange * CARRIER_TANK);
    }
    this.updateAxes();
    this.place(dt);
  }

  /** the wind (m/s, x east, z south) */
  get wind(): { x: number; z: number } { return { x: this.env.windX, z: this.env.windZ }; }

  /** fuel factor of the wind for a course (unit vector x, z): above 1 against the wind, below 1 with it */
  windFactorFor(dx: number, dz: number): number {
    const along = dx * this.env.windX + dz * this.env.windZ;   // m/s of wind along the course, + from behind
    return THREE.MathUtils.clamp(1 - WIND_FUEL * along / WIND_STORM, 0.4, 1.6);
  }

  /** the wind's factor on the way the ship goes right now (going astern counts backwards) */
  get windFactor(): number {
    const s = this.speed < -0.1 ? -1 : 1;
    return this.windFactorFor(this.forward.x * s, this.forward.z * s);
  }

  /** fuel per metre against calm water at full speed: more at flank speed */
  get speedBurn(): number {
    return 1 + Math.max(0, Math.abs(this.speed) - FULL) / (FLANK - FULL) * (FLANK_BURN - 1);
  }

  /** true while the coast limiter (or the defence drones) hold the ship below its ordered speed */
  get limited(): boolean {
    return this.speedLimit < Math.abs(THROTTLE[this.throttle].speed) - 0.01;
  }

  /** held back by its defence drones, not by the coast */
  get dragged(): boolean {
    return this.limited && this.dragLimit <= this.speedLimit + 0.01;
  }

  /** a speed step by hand: under way it also becomes the autopilot's cruise; stopping ends the autopilot */
  setThrottle(step: number) {
    this.throttle = step;
    if (step >= 2) this.cruise = step;
    else if (this.waypoint) { this.waypoint = null; this.autopilotMessage = t('pilot.off'); }
  }

  setWaypoint(x: number, z: number, quiet = false) {
    this.waypoint = new THREE.Vector2(x, z);
    this.throttle = this.cruise;
    if (!quiet) this.autopilotMessage = t('ship.autopilotOn');
  }

  get waypointDistance(): number {
    return this.waypoint ? Math.hypot(this.waypoint.x - this.pos.x, this.waypoint.y - this.pos.z) : 0;
  }

  /** distance to the first shallow water along a heading (corridor as wide as the ship), Infinity if clear */
  private probe(heading: number, range: number): number {
    const fx = Math.sin(heading), fz = Math.cos(heading), sx = fz, sz = -fx;
    for (let d = 150; d <= range; d += 110) {
      for (const off of [-45, 0, 45]) {
        const x = this.pos.x + fx * d + sx * off, z = this.pos.z + fz * d + sz * off;
        if (this.terrain.heightAt(x, z) > SHALLOW) return d;
      }
    }
    return Infinity;
  }

  private avoidSide = 1;
  private recover = 0;

  /**
   * Rudder for the waypoint. If the direct course runs into land, the smallest
   * detour (in 15° steps, keeping the side once chosen) that is clear for 1.4 km
   * is taken. Aground: back off for a while, then carry on.
   */
  private autopilot(dt: number): number {
    const wp = this.waypoint!;
    const dist = Math.hypot(wp.x - this.pos.x, wp.y - this.pos.z);
    const want = Math.atan2(wp.x - this.pos.x, wp.y - this.pos.z);
    const wpOnLand = this.terrain.heightAt(wp.x, wp.y) > SHALLOW;
    const blockedAt = this.probe(want, Math.min(1400, dist));
    this.waypointLimit = this.passThrough ? Infinity : Math.sqrt(2 * WP_BRAKE * Math.max(0, dist - 300)) + COAST_MIN;
    if (dist < (this.passThrough ? 600 : 350) || (wpOnLand && blockedAt < 650)) {
      this.waypoint = null;
      this.waypointLimit = Infinity;
      // the last point of a route (or a single one): stop; on the way through a route keep going
      if (!this.passThrough || wpOnLand) {
        this.throttle = 1;
        this.autopilotMessage = wpOnLand ? t('ship.targetOnLand') : t('ship.waypointReached');
      }
      return 0;
    }
    if (this.grounded && this.recover <= 0) this.recover = 14;
    if (this.recover > 0) {
      this.recover -= dt;
      this.throttle = this.recover > 0.1 ? 0 : this.cruise;
      return 0;
    }
    this.throttle = this.cruise;

    let course = want;
    if (blockedAt < Infinity && !(wpOnLand && dist < 1600)) {
      search: for (let k = 1; k <= 11; k++) {
        for (const side of [this.avoidSide, -this.avoidSide]) {
          const h = want + side * k * 0.26;
          if (this.probe(h, 1400) === Infinity) { course = h; this.avoidSide = side; break search; }
        }
      }
    }
    // land right ahead on the current heading: hard over to the clearer side
    if (this.probe(this.heading, 750) < Infinity) {
      const l = this.probe(this.heading + 0.6, 950), r = this.probe(this.heading - 0.6, 950);
      return l >= r ? 1 : -1;
    }
    let d = course - this.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    // a big course change sweeps through intermediate headings: turn the way that stays clear
    if (Math.abs(d) > 0.5) {
      const clear = (sgn: number, span: number) => {
        for (let a = 0.26; a < span; a += 0.26) if (this.probe(this.heading + sgn * a, 650) < Infinity) return false;
        return true;
      };
      const short = Math.sign(d);
      if (!clear(short, Math.abs(d)) && clear(-short, Math.PI * 2 - Math.abs(d))) return -short;
    }
    return THREE.MathUtils.clamp(d * 2.5, -1, 1);
  }

  // ---- Target ----
  spheres(): [number, number, number, number][] {
    const out: [number, number, number, number][] = [];
    for (const z of this.model.stemZ > 120 ? [-80, -40, 0, 40, 80, 115] : [-80, -40, 0, 40, 80]) {
      const p = this.localToWorld(0, z);
      out.push([p.x, 9, p.z, 38]);
    }
    return out;
  }
  centre(out: THREE.Vector3) { return out.set(this.pos.x, 12, this.pos.z); }
  velocity(out: THREE.Vector3) { return out.copy(this.forward).multiplyScalar(this.speed); }
  hit(damage: number): boolean {
    if (this.hp <= 0) return false;
    this.sinceHit = 0;
    // the hull carries 3/16 of a hit (the rest would fall on the ship's sections)
    this.hp = Math.max(0, this.hp - damage * CARRIER_HULL_SHARE);
    if (this.hp > 0) return false;
    this.sinking = 0;
    this.waypoint = null;
    return true;
  }

  /** the hull is gone: way off, a list to port, bow up, then under (the model is hidden at the end) */
  private goDown(dt: number) {
    this.sinking = Math.min(SINK_TIME, this.sinking + dt);
    this.speed *= Math.exp(-dt * 0.5);
    this.prev.copy(this.pos);
    this.pos.addScaledVector(this.forward, this.speed * dt);
    this.place(dt);
    const k = this.sinking / SINK_TIME, g = this.model.group;
    g.position.y -= Math.max(0, k - 0.25) / 0.75 * 70;
    g.rotation.z += 0.32 * Math.min(1, k * 1.6);
    g.rotation.x -= 0.14 * Math.max(0, k - 0.3);
    g.visible = !this.sunk;
  }

  private coastLimit(): number {
    const order = THROTTLE[this.throttle].speed;
    const dir = this.speed < -0.1 || order < 0 ? Math.PI : 0;
    // the far rings only matter above full speed (ordered, or still running off)
    const rings = Math.max(Math.abs(order), Math.abs(this.speed)) > FULL + 0.1 ? [...FAN_DIST, ...FAN_FAR] : FAN_DIST;
    let nearest = Infinity;
    for (const d of rings) {
      if (d >= nearest) break;
      for (const a of FAN) {
        const h = this.heading + dir + a;
        const x = this.pos.x + Math.sin(h) * d, z = this.pos.z + Math.cos(h) * d;
        if (this.terrain.heightAt(x, z) > SHALLOW) { nearest = d; break; }
      }
    }
    if (!isFinite(nearest)) return rings === FAN_DIST ? FULL : FLANK;
    if (nearest > COAST_FAR) return THREE.MathUtils.lerp(FULL, FLANK, (nearest - COAST_FAR) / (HIGH_SEA - COAST_FAR));
    const k = THREE.MathUtils.clamp((nearest - COAST_NEAR) / (COAST_FAR - COAST_NEAR), 0, 1);
    return THREE.MathUtils.lerp(COAST_MIN, FULL, k);
  }

  /** smallest distance (m) between the deck outline and a building circle */
  private buildingGap(p: THREE.Vector3, heading: number): number {
    const fx = Math.sin(heading), fz = Math.cos(heading);
    let gap = Infinity;
    for (const o of this.obstacles) {
      const dx = o.x - p.x, dz = o.z - p.z;
      if (Math.abs(dx) > 400 || Math.abs(dz) > 400) continue;
      const along = dx * fx + dz * fz, across = dx * fz - dz * fx;
      const ex = Math.max(0, Math.abs(across) - DECK_HALF_W), ez = Math.max(0, Math.abs(along) - DECK_HALF_L);
      gap = Math.min(gap, Math.hypot(ex, ez) - o.r);
    }
    return gap;
  }

  private shallowest(p: THREE.Vector3, heading: number): number {
    const f = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const s = new THREE.Vector3(f.z, 0, -f.x);
    let max = -Infinity;
    for (const [x, z] of [[0, this.model.stemZ - 4], ...HULL_SAMPLES]) {
      max = Math.max(max, this.terrain.heightAt(p.x + f.x * z + s.x * x, p.z + f.z * z + s.z * x));
    }
    return max;
  }

  private updateAxes() {
    this.forward.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.port.set(this.forward.z, 0, -this.forward.x);
  }

  /** world position of a point given in carrier-local coordinates (ignores pitch/roll) */
  localToWorld(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.pos).addScaledVector(this.forward, z).addScaledVector(this.port, x);
  }

  /** carrier-local (x, z) of a world position */
  worldToLocal(p: THREE.Vector3): { x: number; z: number } {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    return { x: dx * this.port.x + dz * this.port.z, z: dx * this.forward.x + dz * this.forward.z };
  }

  private place(dt: number) {
    const env = this.env, amp = env.w.waves, t = env.elapsed;
    const at = (dx: number, ds: number) => {
      const p = this.localToWorld(ds, dx);
      return waveHeight(p.x, p.z, t, amp);
    };
    const bow = at(90, 0), stern = at(-90, 0), port = at(0, 34), star = at(0, -34), mid = at(0, 0);
    const heave = (bow + stern + port + star + mid) / 5;
    const g = this.model.group;
    g.position.set(this.pos.x, -CARRIER_WATERLINE + heave * 0.8, this.pos.z);
    g.rotation.set(-Math.atan2(bow - stern, 180) * 0.8, this.heading, Math.atan2(port - star, 68) * 0.8, 'YXZ');

    // (the laser turret turns itself: src/game/pointDefence.ts)
    this.model.radar.rotation.y += dt * 1.6;
  }

  // ---- save game ----
  saveState() {
    return {
      x: this.pos.x, z: this.pos.z, heading: this.heading, speed: this.speed, throttle: this.throttle, rudder: this.rudder, cruise: this.cruise,
      hp: this.hp, stores: { ...this.stores }, waypoint: this.waypoint ? [this.waypoint.x, this.waypoint.y] as [number, number] : null,
    };
  }

  loadState(s: ReturnType<CarrierController['saveState']>) {
    this.pos.set(s.x, 0, s.z);
    this.prev.copy(this.pos);
    this.heading = s.heading; this.speed = s.speed; this.throttle = s.throttle; this.rudder = s.rudder; this.hp = s.hp;
    // a ship saved while it went down is gone
    this.sinking = s.hp > 0 ? -1 : SINK_TIME;
    this.model.group.visible = s.hp > 0;
    this.cruise = s.cruise ?? 4;
    Object.assign(this.stores, s.stores);
    this.waypoint = s.waypoint ? new THREE.Vector2(s.waypoint[0], s.waypoint[1]) : null;
    this.grounded = false; this.recover = 0;
    this.updateAxes();
    this.place(0);
  }
}
