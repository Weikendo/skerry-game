import * as THREE from 'three';
import { CARRIER_WATERLINE } from '../models/carrier';
import { WALRUS_DRAFT, type WalrusModel } from '../models/walrus';
import { waveHeight } from '../world/ocean';
import { SLOPE, type Ground } from '../world/terrain';
import type { Environment } from '../world/environment';
import type { CarrierController } from './carrierController';
import { KEYS, type InputLike } from './input';
import type { Combat, Target, Team } from './combat';
import { LaserWeapon } from './weapons';
import { GOODS, VEHICLE_TANK } from './stores';
import { linkDistance, SIGNAL_LOST, signalAt, type Side } from './telemetry';
import {
  AVATAR_SHOTS, emptyWalrusLoad, HP, LEAK_BELOW, normaliseOtter, otterFit, type WalrusLoad,
} from './arsenal';
import type { Guided } from './combat';
import { t, km, num, pct } from '../i18n';

export type WalrusState = 'dock' | 'aussetzen' | 'fahren' | 'andocken' | 'zerstoert';
export interface Obstacle { x: number; z: number; r: number }

const DOCK_Z = -86;          // carrier-local z of the parked Walrus (dock spans -100 .. -74)
/** carrier-local x of the four bays side by side in the dock (x ±27), one for each Walrus: 1 to 4 from left to right as
 *  seen from astern (+x is port); floating fenders part them (art/stoorworm/build_stoorworm.py) */
const DOCK_BAYS = [20.25, 6.75, -6.75, -20.25];
/** carrier-local z where a Walrus coming in is taken over: its bow just inside the portal, clear of the others */
const DOCK_TAKE = -100 - 6.5;
const LAUNCH_Z = -124;       // where the launch animation hands over control
const DOCK_MAX_SPEED = 6.5;  // carrier speed limit for docking ("Langsam" is 6 m/s)
const HALF_LEN = 8.5, HALF_WID = 4.3;
// in the original a Walrus tank lasts 264 km; scaled down with the sea like the carrier's tank (419 → 18 km). (It used
// to keep the original's ratio to the radio range, ten times 5 km: testers found an Otter never ran dry.)
const FUEL_RANGE = 264000 * 18 / 419, EMPTY_SPEED = 1.5;
/** the cruise control's steps (share of full speed; -1 = full astern, 0 = off: it coasts as before) */
export const CRUISE_STEPS = [-1, 0, 0.25, 0.5, 0.75, 1];

/**
 * Amphibious tracked vehicle. Floats on the analytic waves, crawls ashore where
 * the ground rises above the water line, and respects the gameplay slope classes:
 * full speed up to SLOPE.BUILD, slower up to SLOPE.STEEP, blocked above.
 */
export class Walrus implements Target {
  readonly name: string;
  readonly team: Team;
  /** distance to the radio link */
  private link: (x: number, z: number) => number;
  readonly kind = 'einheit' as const;
  readonly maxHp = HP.vehicle;
  hp = HP.vehicle;
  /** what it should carry (the cargo is picked on its card, the Avatar is built in; refilled from the hold after docking) and what it carries right now */
  fit: WalrusLoad = otterFit();
  load: WalrusLoad = otterFit();
  /** a Harbinger in flight, steered by the player */
  guided: Guided | null = null;
  readonly laser = new LaserWeapon(0.22, 0.09);
  /** where the turret should point (set from the camera every frame) */
  readonly aim = new THREE.Vector3();
  aimValid = false;
  private respawn = 0;
  /** map waypoint for the autopilot (launches from the dock if needed) */
  waypoint: THREE.Vector2 | null = null;
  /** one-off messages for the message log */
  notice = '';
  /** tank 0..1 */
  fuel = 1;
  private kick = 0;
  /** radio link to the carrier 0..1 */
  signal = 1;
  /** the link was lost: the Walrus blew itself up (for the explosion) */
  onSelfDestruct: ((at: THREE.Vector3) => void) | null = null;
  /** it was destroyed: its model as it stood and how it moved, for the wreck (before the model is hidden) */
  onWreck: ((model: THREE.Object3D, vel: THREE.Vector3) => void) | null = null;
  state: WalrusState = 'dock';
  readonly pos = new THREE.Vector3();
  readonly prev = new THREE.Vector3();
  readonly forward = new THREE.Vector3(0, 0, 1);
  heading = 0;
  speed = 0;
  medium: 'wasser' | 'land' = 'wasser';
  slopeDeg = 0;
  /** cruise control (one of CRUISE_STEPS): the speed it keeps while the throttle is let go */
  cruise = 0;
  /** the turret points close enough to the aim that its shots go there (otherwise they leave along the barrels) */
  onTarget = false;
  /** it ran into something it cannot cross this step (too steep, a building, the hull) */
  blocked = false;
  /** does a point lie in a ship other than `own` (the hull of its own ship is handled with the dock) */
  shipContact: ((p: THREE.Vector3, own: CarrierController) => boolean) | null = null;
  message = '';
  private anim = 0;
  /** its own bay in the stern dock (carrier-local x) */
  readonly dockX: number;
  /** where it was taken over coming in (carrier-local) */
  private dockFrom = { x: 0, z: DOCK_TAKE };
  private pitch = 0;
  private roll = 0;
  private msgTimer = 0;

  constructor(readonly model: WalrusModel, private terrain: Ground, private env: Environment,
    private carrier: CarrierController, private obstacles: Obstacle[], readonly index = 0, private fleet: Walrus[] = [], side?: Side) {
    this.name = side?.name ?? t('otter.name', { n: index + 1 });
    this.team = side?.team ?? 'spieler';
    this.link = side?.link ?? ((x, z) => linkDistance(x, z, carrier.pos));
    this.dockX = DOCK_BAYS[index % DOCK_BAYS.length];
    this.placeInDock(DOCK_Z);
  }

  /** the ACCB on board (the hangar fixes what it builds) */
  get payload(): 'accb' | null { return this.load.cargo === 'accb' ? 'accb' : null; }

  /** only one Walrus at a time can roll out of or into the stern dock */
  private get dockBusy(): boolean {
    return this.fleet.some(o => o !== this && (o.state === 'aussetzen' || o.state === 'andocken'));
  }

  /** after docking (and for a new vehicle): recharge the Avatar, take the cargo from the hold, refuel; returns what was short */
  rearm(): string {
    const st = this.carrier.stores, f = this.fit, l = this.load, miss: string[] = [];
    // the Avatar is built in: aboard it charges up again
    l.weapon = 'avatar'; l.ammo = AVATAR_SHOTS;
    if (f.cargo && !l.cargo) {
      const g = f.cargo;
      if (st[g] > 0) { st[g]--; l.cargo = g; } else miss.push(GOODS[g].short);
    }
    l.role = f.role;
    const fill = Math.min((1 - this.fuel) * VEHICLE_TANK, st.treibstoffWalrus);
    this.fuel += fill / VEHICLE_TANK; st.treibstoffWalrus -= fill;
    if (this.fuel < 0.99) miss.push(t('gear.tankOnly', { pct: pct(this.fuel) }));
    return miss.join(', ');
  }

  get stern(): THREE.Vector3 {
    return this.pos.clone().addScaledVector(this.forward, -HALF_LEN);
  }

  /** L key: launch from the dock (docking happens by driving into it) */
  toggleLaunch() {
    if (this.state === 'dock') {
      if (this.dockBusy) { this.say(t('otter.dockBusy')); return; }
      this.state = 'aussetzen'; this.anim = 0;
    }
    else if (this.state === 'fahren') this.say(t('otter.howToDock'));
  }

  // ---- Target ----
  get alive(): boolean { return this.state === 'fahren'; }
  spheres(): [number, number, number, number][] {
    const g = this.model.group.position;
    return [[g.x, g.y + 3, g.z, 6.5]];
  }
  centre(out: THREE.Vector3) { return out.copy(this.model.group.position).setY(this.model.group.position.y + 3); }
  velocity(out: THREE.Vector3) { return out.copy(this.forward).multiplyScalar(this.speed); }
  hit(damage: number): boolean {
    if (!this.alive) return false;
    this.hp -= damage;
    if (this.hp > 0) { this.say(t('unit.hitArmour', { pct: pct(this.hp / this.maxHp) }), 1.2); return false; }
    this.hp = 0;
    this.state = 'zerstoert';
    this.waypoint = null;
    if (this.load.cargo === 'accb') this.notice = t('otter.accbLost', { unit: this.name });
    this.load = { ...emptyWalrusLoad(), weapon: 'avatar' };
    this.respawn = 12;
    this.onWreck?.(this.model.group, this.forward.clone().multiplyScalar(this.speed));
    this.speed = 0;
    this.model.group.visible = false;
    this.say(t('otter.destroyed', { unit: this.name }), 5);
    return true;
  }

  /** Space: the Avatar fires while held, a Harbinger leaves on the press (one in the air at a time) */
  shoot(dt: number, trigger: boolean, combat: Combat, pressed = false) {
    if (this.guided?.done) this.guided = null;
    this.laser.update(dt);
    // turret follows the aim point (relative to the hull)
    const turret = this.model.turret;
    let want = 0;
    if (this.aimValid && this.state === 'fahren') {
      const tp = turret.getWorldPosition(new THREE.Vector3());
      want = Math.atan2(this.aim.x - tp.x, this.aim.z - tp.z) - this.heading;
    }
    let d = want - turret.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.onTarget = this.aimValid && Math.abs(d) < 0.25;
    turret.rotation.y += THREE.MathUtils.clamp(d, -dt * 2.2, dt * 2.2);
    // barrels follow the aim point in elevation (-4° .. +35°; lower would hit the cab roof)
    const barrel = this.model.parts.barrel;
    let pitch = 0;
    if (this.aimValid && this.state === 'fahren') {
      const bp = barrel.getWorldPosition(new THREE.Vector3());
      pitch = THREE.MathUtils.clamp(Math.atan2(this.aim.y - bp.y, Math.hypot(this.aim.x - bp.x, this.aim.z - bp.z)), -0.07, 0.6);
    }
    barrel.rotation.x += THREE.MathUtils.clamp(-pitch - barrel.rotation.x, -dt * 1.5, dt * 1.5);
    // recoil: the barrels jump back after a shot and run out again
    this.kick = Math.max(0, this.kick - dt * 6);
    this.model.parts.recoil.position.z = -0.35 * this.kick;
    if (this.state !== 'fahren') return;
    const l = this.load;
    const muzzle = barrel.localToWorld(new THREE.Vector3(0, 0, 5.0));
    const dir = this.aimValid && Math.abs(d) < 0.25 ? this.aim.clone().sub(muzzle) : barrel.localToWorld(new THREE.Vector3(0, 0, 20)).sub(muzzle);
    if (l.weapon === 'harbinger') {
      if (!pressed) return;
      if (this.guided) { this.say(t('otter.harbingerFlying')); return; }
      if (l.ammo <= 0) { this.say(t('otter.noHarbinger')); return; }
      // it leaves level or climbing a little (on the waves the barrels may dip), then the player steers
      const level = dir.clone().normalize();
      level.y = Math.max(level.y, 0.04);
      this.guided = combat.fire({ kind: 'harbinger', team: this.team, from: muzzle, dir: level.normalize(), source: this }) ?? null;
      l.ammo--;
      this.say(t('otter.harbingerAway', { n: l.ammo }), 2);
      return;
    }
    if (!trigger) return;
    if (l.weapon !== 'avatar' || l.ammo <= 0) { if (pressed) this.say(t('otter.unarmed', { unit: this.name })); return; }
    // aimed through the camera it waits for the turret to come round, so no shot leaves along the barrels into nowhere
    if (!this.laser.ready() || (this.aimValid && !this.onTarget)) return;
    combat.fire({ kind: 'laser', team: this.team, from: muzzle, dir, heavy: true, source: this });
    this.laser.fired();
    this.kick = 1;
    if (--l.ammo <= 0) {
      l.ammo = 0;
      this.notice = t('otter.avatarEmpty', { unit: this.name });
    }
  }

  update(dt: number, input: InputLike | null) {
    this.prev.copy(this.pos);
    if (this.state !== 'fahren') { this.cruise = 0; this.blocked = false; }
    this.msgTimer -= dt;
    if (this.msgTimer <= 0) this.message = '';
    if (this.state === 'zerstoert') {
      this.respawn -= dt;
      if (this.respawn <= 0) {
        // a replacement only if the hold has one
        if (this.carrier.stores.walrus > 0) {
          this.carrier.stores.walrus--;
          this.state = 'dock'; this.hp = this.maxHp; this.fuel = 1; this.model.group.visible = true;
          const short = this.rearm();
          this.say(t('otter.spareReady'));
          this.notice = (short ? t('otter.spareForShort', { unit: this.name, short }) : t('otter.spareFor', { unit: this.name }));
        } else {
          this.respawn = 5;
          this.say(t('otter.noSpare'), 5);
        }
      }
      return;
    }

    if (this.state === 'dock') this.placeInDock(DOCK_Z);
    else if (this.state === 'aussetzen') {
      // straight out of its own bay
      this.anim = Math.min(1, this.anim + dt / 4);
      this.placeInDock(THREE.MathUtils.lerp(DOCK_Z, LAUNCH_Z, THREE.MathUtils.smoothstep(this.anim, 0, 1)));
      if (this.anim >= 1) {
        this.state = 'fahren';
        this.speed = this.carrier.speed - 2; // still backing away from the carrier
      }
    } else if (this.state === 'andocken') {
      // first across to its own bay just inside the portal, then straight in: it never runs over another
      this.anim = Math.min(1, this.anim + dt / 3.5);
      const x = THREE.MathUtils.lerp(this.dockFrom.x, this.dockX, THREE.MathUtils.smoothstep(this.anim, 0, 0.55));
      const z = THREE.MathUtils.lerp(this.dockFrom.z, DOCK_Z, THREE.MathUtils.smoothstep(this.anim, 0.35, 1));
      this.placeInDock(z, x);
      if (this.anim >= 1) {
        this.state = 'dock'; this.speed = 0;
        // refuel and refit from the hold; the hangar repairs over time
        const short = this.rearm();
        this.say((short ? t('otter.dockedShort', { unit: this.name, short }) : t('otter.dockedFull', { unit: this.name })));
      }
    } else {
      this.drive(dt, input);
      // badly damaged: the tank leaks (a full one lasts about 2 minutes)
      if (this.hp < this.maxHp * LEAK_BELOW) { this.fuel = Math.max(0, this.fuel - dt / 128); this.say(t('otter.leak'), 0.5); }
      this.radio();
    }
  }

  /** out of radio range the picture breaks up; beyond it the Walrus destroys itself */
  private radio() {
    const d = this.link(this.pos.x, this.pos.z);
    this.signal = signalAt(d);
    if (d > SIGNAL_LOST && this.state === 'fahren') {
      const at = this.pos.clone();
      this.hit(this.hp);
      this.notice = t('otter.linkLost');
      this.onSelfDestruct?.(at);
    } else if (this.signal < 0.7) this.say(t('otter.weakSignal', { dist: km(d) }), 0.5);
  }

  private say(msg: string, seconds = 2.5) {
    this.message = msg;
    this.msgTimer = seconds;
  }

  /** in the dock or on the way in or out: `localX` defaults to its own bay */
  private placeInDock(localZ: number, localX = this.dockX) {
    const c = this.carrier;
    c.localToWorld(localX, localZ, this.pos);
    this.heading = c.heading;
    this.speed = c.speed;
    this.medium = 'wasser';
    this.slopeDeg = 0;
    this.updateForward();
    // inside the dock: ride on the carrier's waterline (incl. its pitch and roll);
    // outside the stern blend over to the open-sea waves
    const cg = c.model.group;
    cg.updateMatrixWorld();
    const docked = new THREE.Vector3(localX, CARRIER_WATERLINE - WALRUS_DRAFT, localZ).applyMatrix4(cg.matrixWorld);
    const wave = waveHeight(this.pos.x, this.pos.z, this.env.elapsed, this.env.w.waves) - WALRUS_DRAFT;
    const out = THREE.MathUtils.smoothstep(-localZ, 100, 112);
    const g = this.model.group;
    g.position.set(docked.x, THREE.MathUtils.lerp(docked.y, wave, out), docked.z);
    g.rotation.set(cg.rotation.x * (1 - out), this.heading, cg.rotation.z * (1 - out), 'YXZ');
  }

  private updateForward() {
    this.forward.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  private surfaceAt(x: number, z: number): { ground: number; water: number } {
    return {
      ground: this.terrain.heightAt(x, z),
      water: waveHeight(x, z, this.env.elapsed, this.env.w.waves) - WALRUS_DRAFT,
    };
  }

  private slopeDegAt(x: number, z: number): number {
    const ny = 1 - this.terrain.slopeAt(x, z);
    return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(ny, -1, 1)));
  }

  private drive(dt: number, input: InputLike | null) {
    const onLand = this.medium === 'land';
    // the stick (analog: how far it is pushed is the speed wanted) overrides the cruise control while it is pushed
    const stick = input ? input.axis(KEYS.back, KEYS.forward) : 0;
    const throttle = stick !== 0 ? stick : this.cruise;
    const steer = input ? input.axis(KEYS.right, KEYS.left) : 0;

    const empty = this.fuel <= 0;
    const maxFwd = empty ? EMPTY_SPEED : onLand ? 12 : 8, maxRev = empty ? EMPTY_SPEED : onLand ? 5 : 3;
    if (empty && (throttle || steer)) this.say(t('otter.fuelEmpty'), 1);
    const accel = onLand ? 3.5 : 2;
    // towards the speed wanted; against the way it is moving it brakes (up to 9 m/s² at full throw), then reverses
    if (throttle > 0) {
      const want = throttle * maxFwd;
      if (this.speed < 0) this.speed = Math.min(0, this.speed + 9 * throttle * dt);
      else if (this.speed < want) this.speed = Math.min(this.speed + accel * dt, want);
      else this.speed = Math.max(want, this.speed - (onLand ? 3 : 1.5) * dt);
    } else if (throttle < 0) {
      const want = throttle * maxRev;
      if (this.speed > 0) this.speed = Math.max(0, this.speed + 9 * throttle * dt);
      else if (this.speed > want) this.speed = Math.max(this.speed - accel * dt, want);
      else this.speed = Math.min(want, this.speed + (onLand ? 3 : 1.5) * dt);
    } else this.speed *= Math.exp(-dt * (onLand ? 1.4 : 0.45));
    // too fast after launch / on a slope: ease towards the limit
    if (this.speed > maxFwd) this.speed = Math.max(maxFwd, this.speed - 3 * dt);

    // tracks can pivot on the spot on land; in water steering needs some way on
    const yaw = onLand ? 0.75 : 0.45 * Math.min(1, Math.abs(this.speed) / 3 + 0.25);
    const newHeading = this.heading + steer * yaw * dt * (this.speed < -0.2 && !onLand ? -1 : 1);
    const fwd = new THREE.Vector3(Math.sin(newHeading), 0, Math.cos(newHeading));
    const next = this.pos.clone().addScaledVector(fwd, this.speed * dt);

    // ground under the target position
    const here = this.surfaceAt(this.pos.x, this.pos.z);
    const there = this.surfaceAt(next.x, next.z);
    const landNext = there.ground > there.water + 0.2;
    let blocked = false;
    if (landNext) {
      const slopeNext = this.slopeDegAt(next.x, next.z);
      const slopeHere = this.slopeDegAt(this.pos.x, this.pos.z);
      if (slopeNext > SLOPE.STEEP && slopeNext >= slopeHere) {
        blocked = true;
        this.say(t('otter.tooSteep', { slope: Math.ceil(slopeNext), max: SLOPE.STEEP }));
      } else if (this.speed > 0) {
        // uphill along the heading costs speed
        const climbDeg = THREE.MathUtils.radToDeg(Math.atan2(there.ground - Math.max(here.ground, here.water), Math.max(1e-3, this.speed * dt)));
        const f = 1 - THREE.MathUtils.clamp((climbDeg - SLOPE.BUILD) / (SLOPE.STEEP - SLOPE.BUILD), 0, 1) * 0.65;
        if (this.speed > maxFwd * f) this.speed = Math.max(maxFwd * f, this.speed - 6 * dt);
      }
    }
    // a building in the way: slide along it (the way round) instead of stopping dead
    const hits = (q: THREE.Vector3) => this.obstacles.find(o => {
      const d = Math.hypot(q.x - o.x, q.z - o.z);
      return d < o.r + 5 && d < Math.hypot(this.pos.x - o.x, this.pos.z - o.z);
    });
    const wall = hits(next);
    if (wall) {
      this.say(t('otter.buildingInWay'));
      const rx = this.pos.x - wall.x, rz = this.pos.z - wall.z, rl = Math.hypot(rx, rz) || 1;
      const step = Math.abs(this.speed * dt), side = (rz * fwd.x - rx * fwd.z) >= 0 ? 1 : -1;
      const slide = this.pos.clone().add(new THREE.Vector3(rz / rl * side, 0, -rx / rl * side).multiplyScalar(step * 0.8));
      if (step > 1e-4 && !hits(slide)) next.copy(slide); else blocked = true;
    }
    // carrier hull: drive into the dock opening to dock, otherwise bounce off; any other ship's hull just blocks
    if (!blocked) blocked = this.carrierContact(next);
    if (!blocked && this.shipContact) blocked = this.shipContact(next, this.carrier) || this.shipContact(next.clone().addScaledVector(fwd, HALF_LEN * Math.sign(this.speed || 1)), this.carrier);

    this.blocked = blocked && Math.abs(this.speed) > 0.5;
    if (blocked) {
      this.speed = 0;
      this.heading = newHeading; // turning on the spot is always fine
    } else {
      this.heading = newHeading;
      this.pos.copy(next);
      this.fuel = Math.max(0, this.fuel - Math.abs(this.speed) * dt / FUEL_RANGE);
    }
    this.updateForward();
    this.slopeDeg = this.slopeDegAt(this.pos.x, this.pos.z);
    this.pose(dt);
  }

  private carrierContact(next: THREE.Vector3): boolean {
    const c = this.carrier;
    const l = c.worldToLocal(next);
    const inHull = Math.abs(l.x) < 40 + HALF_WID && l.z > -100 - HALF_LEN && l.z < c.model.stemZ + HALF_LEN;
    if (!inHull) return false;
    const inDockMouth = Math.abs(l.x) < 22 && l.z < -88;
    if (inDockMouth) {
      if (this.dockBusy) { this.say(t('otter.dockBusyWait')); return true; }
      if (Math.abs(c.speed) > DOCK_MAX_SPEED) {
        this.say(t('otter.shipTooFast', { max: num(DOCK_MAX_SPEED, 1) }));
        return true;
      }
      if (l.z > DOCK_TAKE) { this.state = 'andocken'; this.anim = 0; this.dockFrom = { x: l.x, z: l.z }; this.say(t('otter.docking')); }
      return false;
    }
    // already inside the hull's outline (squeezed in at the dock corner): moving outwards is always allowed
    const out = (q: { x: number; z: number }) => Math.max(Math.abs(q.x) - 40 - HALF_WID, -100 - HALF_LEN - q.z, q.z - 100 - HALF_LEN);
    const now = c.worldToLocal(this.pos);
    if (out(now) < 0 && out(l) > out(now)) return false;
    this.say(t('otter.contact'));
    return true;
  }

  private pose(dt: number) {
    const f = this.forward, s = new THREE.Vector3(f.z, 0, -f.x);
    const sample = (dz: number, dx: number) => {
      const x = this.pos.x + f.x * dz + s.x * dx, z = this.pos.z + f.z * dz + s.z * dx;
      const h = this.surfaceAt(x, z);
      return Math.max(h.ground, h.water);
    };
    const yF = sample(6.5, 0), yB = sample(-6.5, 0), yL = sample(0, 3.5), yR = sample(0, -3.5);
    const centre = this.surfaceAt(this.pos.x, this.pos.z);
    this.medium = centre.ground > centre.water + 0.2 ? 'land' : 'wasser';
    const y = Math.max((yF + yB + yL + yR) / 4, Math.max(centre.ground, centre.water));
    const k = Math.min(1, dt * 8);
    this.pitch += (-Math.atan2(yF - yB, 13) - this.pitch) * k;
    this.roll += (Math.atan2(yL - yR, 7) - this.roll) * k;
    const g = this.model.group;
    g.position.set(this.pos.x, y, this.pos.z);
    g.rotation.set(this.pitch, this.heading, this.roll, 'YXZ');
  }

  // ---- save game ----
  /** launching and docking are short animations: they are saved as their end state */
  saveState() {
    const state: WalrusState = this.state === 'aussetzen' ? 'dock' : this.state === 'andocken' ? 'fahren' : this.state;
    return {
      state, x: this.pos.x, z: this.pos.z, heading: this.heading, speed: state === 'fahren' ? this.speed : 0,
      hp: this.hp, fuel: this.fuel, fit: { ...this.fit }, load: { ...this.load }, respawn: this.respawn, medium: this.medium,
      waypoint: this.waypoint ? [this.waypoint.x, this.waypoint.y] as [number, number] : null,
    };
  }

  loadState(s: ReturnType<Walrus['saveState']>) {
    this.state = s.state; this.hp = s.hp; this.fuel = s.fuel; this.respawn = s.respawn;
    this.fit = normaliseOtter(s.fit, true); this.load = normaliseOtter(s.load, false); this.guided = null;
    // in the dock the built-in laser is charged (an older save may have had none)
    if (s.state === 'dock') this.load.ammo = AVATAR_SHOTS;
    this.waypoint = s.waypoint ? new THREE.Vector2(s.waypoint[0], s.waypoint[1]) : null;
    this.model.group.visible = s.state !== 'zerstoert';
    if (s.state === 'fahren') {
      this.pos.set(s.x, 0, s.z);
      this.prev.copy(this.pos);
      this.heading = s.heading; this.speed = s.speed; this.medium = s.medium;
      this.updateForward();
      this.pose(1);
    } else this.placeInDock(DOCK_Z);
  }
}
