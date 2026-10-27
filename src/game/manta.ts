import * as THREE from 'three';
import { MANTA_GEAR, type MantaModel } from '../models/manta';
import { LIFT_DEPTH } from '../models/carrier';
import { waveHeight } from '../world/ocean';
import type { Ground } from '../world/terrain';
import type { Environment } from '../world/environment';
import type { CarrierController } from './carrierController';
import type { InputLike } from './input';
import type { Combat, Target, Team } from './combat';
import { LaserWeapon } from './weapons';
import { GOODS, VEHICLE_TANK } from './stores';
import { linkDistance, SIGNAL_LOST, signalAt, type Side } from './telemetry';
import { DAMAGE, HP, LEAK_BELOW, mantaAssassins, normaliseSkua, skuaFit, type MantaLoad } from './arsenal';
import { t, km, pct } from '../i18n';

/** 'padland', 'pad', 'padstart': landing on, parked on and lifting off a landing pad of an own island */
export type MantaState = 'deck' | 'start' | 'flug' | 'landung' | 'absturz' | 'padland' | 'pad' | 'padstart';

/** a landing pad on an own island: where to set down (top of the deck), its heading and island */
export interface Pad { x: number; y: number; z: number; rot: number; island: number; name: string }

// carrier-local spots (deck top is y = 0 in carrier coordinates)
const LIFT_Z = 25;          // the middle of the lift
/** m/s up and down the lift shaft (the Skuas wait in the hangar below deck) */
export const LIFT_SPEED = 3;
const RAMP_END = 100;       // ski ramp lip
const CATAPULT = 32;        // m/s² along the deck
export const MIN_SPEED = 38, MAX_SPEED = 190;
const G = 9.81;
// in the original a Manta tank (163 km) lasts 6.3 times its radio range (26 km); kept as a ratio
const FUEL_RANGE = 6.3 * SIGNAL_LOST;
/**
 * The landing approach in forward flight (it used to slide the Skua straight at the approach point while the nose
 * came round slowly, so it flew in sideways): along its nose at `speed` m/s, braking or speeding up by `brake`
 * m/s², turning at most `turn` rad/s, climbing or sinking at most `sink` m/s; to the carrier through two gates
 * astern (carrier-local z) `height` m over the deck, so it comes in along the deck; a gate is passed within `near` m
 */
const APPROACH = { speed: 75, brake: 15, turn: 0.5, sink: 12, gates: [-1600, -900], height: 150, near: 80 };

// gamepad: left stick flies (pitch, roll), R1/L1 thrust up/down while held, right stick rudder (left/right)
export const MANTA_KEYS = {
  // (the trackpad finger points: up is nose up; Einstellungen → Steuerung turns climb and dive round for the player)
  noseDown: ['KeyW', 'ArrowUp', 'Pad.LY-', 'Ptr.Y+'], noseUp: ['KeyS', 'ArrowDown', 'Pad.LY+', 'Ptr.Y-'],
  left: ['KeyA', 'ArrowLeft', 'Pad.LX-', 'Ptr.X-'], right: ['KeyD', 'ArrowRight', 'Pad.LX+', 'Ptr.X+'],
  more: ['KeyR', 'Pad.RB'], less: ['KeyF', 'Pad.LB'], yawL: ['KeyQ', 'Pad.RX-'], yawR: ['KeyE', 'Pad.RX+'],
};

/**
 * Air defence fighter. Arcade flight model: bank angle makes the turn, pitch and
 * throttle trade speed for height, too slow = stall, ground or water = crash.
 * Launch by catapult over the ski ramp; landing is an autopilot that flies in
 * from astern and sets the Manta down vertically on the lift (VTOL).
 */
export class Manta implements Target {
  readonly name: string;
  readonly team: Team;
  /** distance to the radio link */
  private link: (x: number, z: number) => number;
  readonly kind = 'einheit' as const;
  readonly maxHp = HP.vehicle;
  hp = HP.vehicle;
  readonly laser = new LaserWeapon(0.11, 0.055);
  /** what it should carry (the cargo is picked on its card; the Quasar and the two Assassins are built in, refilled after landing) and what hangs on it right now */
  fit: MantaLoad = skuaFit();
  load: MantaLoad = skuaFit();
  get missiles(): number { return mantaAssassins(this.load); }
  get maxMissiles(): number { return Math.max(mantaAssassins(this.fit), this.missiles); }
  /** the Quasar laser is built in */
  get armed(): boolean { return true; }
  /** current missile lock (enemy in the nose cone) */
  lock: Target | null = null;
  /** called when the Manta crashes or is shot down (for the explosion) */
  onCrash: ((at: THREE.Vector3) => void) | null = null;
  /** it was lost: its model as it flew and how fast, for the wreck (before the model is hidden) */
  onWreck: ((model: THREE.Object3D, vel: THREE.Vector3) => void) | null = null;
  /** does a point (the Skua's gear) lie in a ship; `ignore`: its own ship, just after the catapult launched it off the bow */
  shipContact: ((p: THREE.Vector3, ignore: CarrierController | null) => boolean) | null = null;
  /** seconds since the catapult threw it off its ship's bow */
  private sinceLaunch = Infinity;
  private gunSide = 1;
  /** map waypoint for the autopilot (launches from the deck if needed) */
  waypoint: THREE.Vector2 | null = null;
  /** tank 0..1 */
  fuel = 1;
  /** radio link to the carrier 0..1 */
  signal = 1;
  /** one-off messages for the message log */
  notice = '';
  /** last control inputs (moves the elevons and the rudder on the model) */
  readonly ctl = { pitch: 0, roll: 0, yaw: 0 };
  state: MantaState = 'deck';
  readonly pos = new THREE.Vector3();
  readonly forward = new THREE.Vector3(0, 0, 1);
  yaw = 0;          // 0 = +z, increases to the left
  pitch = 0;        // nose up positive
  bank = 0;         // right wing down positive
  speed = 0;        // m/s along the nose
  throttle = 0.6;   // 0..1
  altitude = 0;     // above ground or sea
  message = '';
  private msgTimer = 0;
  private deckZ = LIFT_Z;
  private local = new THREE.Vector3();     // carrier-local position during landing
  /** 0 approach, 1 hover, 2 touch-down, 3 down to the hangar on the lift */
  landPhase = 0;
  /** in the approach to the carrier: the gate it flies to next (APPROACH.gates) */
  private gate = 0;
  /** the catapult start: 0 the lift goes down for the Skua, 1 brings it up from the hangar, 2 the catapult run */
  private startPhase = 2;
  /** the lift's height while this Skua uses it (0 at the deck, -LIFT_DEPTH in the hangar); null when it doesn't */
  liftY: number | null = null;
  /** the landing pad the Skua flies to, stands on or lifts off from */
  pad: Pad | null = null;
  /** where the approach to the pad begins (set when the landing is ordered) */
  private padApproach = new THREE.Vector3();
  /** fuel for a pad from the island network: units wanted → units given (set by the game) */
  padFuel: ((pad: Pad, units: number) => number) | null = null;
  private padDry = false;
  private crashTimer = 0;

  constructor(readonly model: MantaModel, private ground: Ground, private env: Environment, private carrier: CarrierController,
    readonly index = 0, private fleet: Manta[] = [], side?: Side) {
    this.name = side?.name ?? t('skua.name', { n: index + 1 });
    this.team = side?.team ?? 'spieler';
    this.link = side?.link ?? ((x, z) => linkDistance(x, z, carrier.pos));
    this.placeOnDeck(LIFT_Z);
  }

  /** in the hangar below deck (hidden): parked there, or waiting for the lift to come down */
  get belowDeck(): boolean {
    return this.state === 'deck' || (this.state === 'start' && this.startPhase === 0);
  }

  /** the lift takes one aircraft at a time: a catapult start or the end of a landing */
  get liftBusy(): boolean {
    return this.fleet.some(o => o !== this && (o.state === 'start' || (o.state === 'landung' && o.landPhase >= 1)));
  }

  private say(msg: string, seconds = 2.5) {
    this.message = msg;
    this.msgTimer = seconds;
  }

  /** fly to a landing pad of an own island and set down there vertically */
  landOnPad(p: Pad) {
    if (this.state !== 'flug') return;
    this.pad = p;
    // the approach begins 450 m short of the pad on the side the Skua comes from, 150 m above it
    const dx = this.pos.x - p.x, dz = this.pos.z - p.z, d = Math.hypot(dx, dz) || 1;
    this.padApproach.set(p.x + dx / d * 450, p.y + 150, p.z + dz / d * 450);
    this.landPhase = 0;
    this.waypoint = null;
    this.state = 'padland';
    this.say(t('skua.padApproach', { island: p.name }));
  }

  /** L key: catapult launch from the deck, take-off from a pad, or start the landing autopilot */
  toggleLaunch() {
    if (this.state === 'pad') {
      if (this.link(this.pos.x, this.pos.z) > SIGNAL_LOST) { this.say(t('skua.padNoLink')); return; }
      this.state = 'padstart'; this.speed = 0; this.say(t('skua.padTakeoff')); return;
    }
    if (this.state === 'deck') {
      if (this.liftBusy) { this.say(t('skua.liftBusy')); return; }
      const lift = this.carrier.model.lift;
      this.state = 'start'; this.deckZ = LIFT_Z; this.speed = 0;
      this.startPhase = lift ? 0 : 2; this.liftY = lift ? lift.position.y : null;
      this.say(t('skua.catapult')); return;
    }
    if (this.state !== 'flug') return;
    const l = this.carrier.worldToLocal(this.pos);
    const dist = Math.hypot(l.x, l.z);
    if (dist > 3000) { this.say(t('skua.tooFarToLand', { max: km(3000) })); return; }
    this.local.set(l.x, this.pos.y - this.deckY(), l.z);
    this.landPhase = 0;
    // straight to the near gate when it already comes in from astern along the deck
    const along = Math.abs(Math.atan2(Math.sin(this.yaw - this.carrier.heading), Math.cos(this.yaw - this.carrier.heading))) < 0.8;
    this.gate = l.z < APPROACH.gates[1] - 100 && Math.abs(l.x) < 400 && along ? 1 : 0;
    this.waypoint = null;
    this.state = 'landung';
    this.say(t('skua.approach'));
  }

  private deckY(): number {
    // carrier deck height in world space at the lift (ignores pitch/roll)
    return this.carrier.model.group.position.y;
  }

  private placeOnDeck(localZ: number, liftY = 0) {
    const c = this.carrier, cg = c.model.group;
    cg.updateMatrixWorld();
    // the enemy's ski ramp; the Stoorworm's runway, sunk a little into the deck (its edges slope)
    const rh = c.model.rampH, ramp = rh > 0 ? Math.max(0, localZ - 75) / 25 : 0;
    let deck = ramp > 0 ? rh * Math.pow(Math.min(1, ramp), 1.6) : 0;
    const rw = c.model.runway;
    if (rw) for (const [z0, z1] of rw.parts) if (localZ > z0 && localZ < z1) deck -= rw.depth * Math.min(1, (localZ - z0) / rw.bevel, (z1 - localZ) / rw.bevel);
    const p = new THREE.Vector3(0, deck + liftY + MANTA_GEAR, localZ).applyMatrix4(cg.matrixWorld);
    this.pos.copy(p);
    this.yaw = c.heading;
    this.pitch = ramp > 0 ? 0.14 * Math.min(1, ramp) : 0;
    this.bank = 0;
    this.updateForward();
    const g = this.model.group;
    g.position.copy(p).y -= MANTA_GEAR;
    g.rotation.set(cg.rotation.x - this.pitch, this.yaw, cg.rotation.z, 'YXZ');
  }

  /** 0..1 brightness of the engine flame */
  get exhaust(): number {
    return this.state === 'deck' || this.state === 'pad' || this.state === 'absturz' || this.liftY !== null ? 0 : 0.3 + this.throttle * 0.7;
  }

  /** fuel and the fitted load from the carrier's hold (after landing); returns what was short */
  rearm(): string {
    const st = this.carrier.stores, f = this.fit, l = this.load, miss: string[] = [];
    const fill = Math.min((1 - this.fuel) * VEHICLE_TANK, st.treibstoffManta);
    this.fuel += fill / VEHICLE_TANK; st.treibstoffManta -= fill;
    if (this.fuel < 0.99) miss.push(t('gear.tankOnly', { pct: pct(this.fuel) }));
    // the middle mount: a dropped Quaker is replaced (the cargo is swapped on the card while aboard)
    if (l.centre !== f.centre) {
      if (l.centre === 'quaker') st.quaker++;
      const g = f.centre === 'quaker' ? f.centre : null;
      if (g) { if (st[g] > 0) { st[g]--; l.centre = g; } else { miss.push(GOODS[g].short); l.centre = null; } }
      else l.centre = null;
    }
    for (const side of ['left', 'right'] as const) {
      const n = Math.min(f[side] - l[side], st.assassin);
      if (n > 0) { st.assassin -= n; l[side] += n; }
      if (l[side] < f[side]) miss.push(GOODS.assassin.short);
    }
    return [...new Set(miss)].join(', ');
  }

  /** one Assassin leaves: wings in turn, then the middle rack */
  private useAssassin() {
    const l = this.load;
    if (l.left >= l.right && l.left > 0) l.left--;
    else if (l.right > 0) l.right--;
    else if (l.centre === 'assassin3') l.centre = null;
  }

  /** K: release the Quaker cluster bomb */
  dropBomb(combat: Combat): boolean {
    if (this.state !== 'flug') return false;
    if (this.load.centre !== 'quaker') { this.say(t('skua.noQuaker')); return false; }
    this.load.centre = null;
    const from = this.pos.clone().add(new THREE.Vector3(0, -2.5, 0));
    combat.fire({ kind: 'quaker', team: this.team, from, dir: this.forward, inherit: this.forward.clone().multiplyScalar(this.speed * 0.85), source: this });
    this.say(t('skua.quakerDropped'), 1.5);
    return true;
  }

  private updateForward() {
    const cp = Math.cos(this.pitch);
    this.forward.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
  }

  update(dt: number, input: InputLike | null) {
    this.msgTimer -= dt;
    if (this.msgTimer <= 0) this.message = '';
    switch (this.state) {
      case 'deck': this.speed = 0; this.placeOnDeck(LIFT_Z, this.carrier.model.lift ? -LIFT_DEPTH : 0); break;
      case 'start': this.catapult(dt); break;
      case 'flug':
        this.fly(dt, input);
        // badly damaged: the tank leaks (a full one lasts about 4 minutes)
        if (this.hp < this.maxHp * LEAK_BELOW) { this.fuel = Math.max(0, this.fuel - dt / 240); this.say(t('skua.leak'), 0.5); }
        if (this.state === 'flug') this.radio();
        break;
      case 'landung': this.autoland(dt); break;
      case 'padland': this.padLand(dt); if (this.state === 'padland') this.radio(); break;
      case 'pad': this.onPad(dt); break;
      case 'padstart': this.padStart(dt); break;
      case 'absturz':
        this.crashTimer -= dt;
        // the wreck falls or burns on its own; with nobody taking it the model blinks where it crashed
        this.model.group.visible = !this.onWreck && Math.floor(this.crashTimer * 4) % 2 === 0;
        if (this.crashTimer <= 0) {
          const st = this.carrier.stores;
          if (st.manta > 0) {
            st.manta--;
            this.model.group.visible = true; this.state = 'deck'; this.hp = this.maxHp; this.fuel = 1;
            this.load = { left: 0, right: 0, centre: null };
            this.rearm();
            this.say(t('skua.spareReady'));
          } else {
            this.model.group.visible = false;
            this.crashTimer = 5;
            this.say(t('skua.noSpare'), 5);
          }
        }
        break;
    }
    const surf = Math.max(this.ground.heightAt(this.pos.x, this.pos.z), waveHeight(this.pos.x, this.pos.z, this.env.elapsed, this.env.w.waves));
    this.altitude = this.state === 'flug' || this.state === 'landung' || this.state === 'padland' || this.state === 'padstart' ? Math.max(0, this.pos.y - surf - MANTA_GEAR) : 0;
  }

  private catapult(dt: number) {
    // first up from the hangar: the lift goes down for the Skua and brings it up to the deck
    if (this.startPhase < 2 && this.liftY !== null) {
      this.liftY = this.startPhase === 0 ? Math.max(-LIFT_DEPTH, this.liftY - LIFT_SPEED * dt) : Math.min(0, this.liftY + LIFT_SPEED * dt);
      this.placeOnDeck(LIFT_Z, this.liftY);
      if (this.startPhase === 0 && this.liftY <= -LIFT_DEPTH) this.startPhase = 1;
      else if (this.startPhase === 1 && this.liftY >= 0) { this.startPhase = 2; this.liftY = null; }
      return;
    }
    this.speed += CATAPULT * dt;
    this.deckZ += this.speed * dt;
    this.placeOnDeck(this.deckZ);
    if (this.deckZ >= RAMP_END) {
      // off the ramp: hand over to the pilot, carrier speed adds to ours
      this.state = 'flug';
      this.sinceLaunch = 0;
      this.speed += Math.max(0, this.carrier.speed);
      this.pitch = 0.16;
      this.throttle = Math.max(this.throttle, 0.7);
      this.say(t('skua.airborne'));
    }
  }

  private fly(dt: number, input: InputLike | null) {
    const k = MANTA_KEYS;
    const pitchIn = input ? input.axis(k.noseDown, k.noseUp) : 0;
    const rollIn = input ? input.axis(k.left, k.right) : 0;
    const yawIn = input ? input.axis(k.yawR, k.yawL) : 0;
    this.ctl.pitch = pitchIn; this.ctl.roll = rollIn; this.ctl.yaw = yawIn;
    if (input) this.throttle = THREE.MathUtils.clamp(this.throttle + input.axis(k.less, k.more) * 0.5 * dt, 0, 1);
    // fuel burns with the throttle; an empty tank leaves only gliding (and stalling)
    this.fuel = Math.max(0, this.fuel - this.speed * dt / FUEL_RANGE * (0.6 + 0.6 * this.throttle));
    if (this.fuel <= 0) { this.throttle = 0; this.say(t('skua.fuelEmpty'), 0.5); }
    else if (this.fuel < 0.15) this.say(t('skua.fuelLow', { pct: pct(this.fuel) }), 0.5);

    // bank: input rolls, otherwise the wings level themselves
    if (rollIn) this.bank = THREE.MathUtils.clamp(this.bank + rollIn * 1.7 * dt, -1.35, 1.35);
    else this.bank *= Math.exp(-dt * 1.3);
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitchIn * 0.9 * dt, -1.2, 1.2);
    // a banked wing lifts less: the nose sinks unless the pilot pulls
    this.pitch -= (1 - Math.cos(this.bank)) * 0.3 * dt;

    // coordinated turn
    this.yaw += (-G * Math.tan(this.bank) / Math.max(this.speed, 40) + yawIn * 0.25) * dt;

    const target = THREE.MathUtils.lerp(MIN_SPEED + 7, MAX_SPEED, this.throttle);
    this.speed += (target - this.speed) * 0.12 * dt - Math.sin(this.pitch) * G * dt;
    this.speed = THREE.MathUtils.clamp(this.speed, 0, 230);
    if (this.speed < MIN_SPEED) {
      this.pitch -= (MIN_SPEED - this.speed) * 0.04 * dt + 0.3 * dt;
      this.say(t('skua.stall'), 0.5);
    }
    if (this.pos.y > 3000) this.pitch = Math.min(this.pitch, 0);

    this.updateForward();
    this.pos.addScaledVector(this.forward, this.speed * dt);

    const surf = Math.max(this.ground.heightAt(this.pos.x, this.pos.z), waveHeight(this.pos.x, this.pos.z, this.env.elapsed, this.env.w.waves));
    if (this.pos.y - MANTA_GEAR < surf + 0.5) { this.crash(); return; }
    // into a ship's deck, bridge or mast (its own ship only once it is clear of the bow)
    this.sinceLaunch += dt;
    if (this.shipContact?.(this.pos, this.sinceLaunch < 3 ? this.carrier : null)) { this.crash(); return; }
    this.pose();
  }

  /** out of radio range the picture breaks up; beyond it the Manta destroys itself */
  private radio() {
    const d = this.link(this.pos.x, this.pos.z);
    this.signal = signalAt(d);
    if (d > SIGNAL_LOST) {
      this.crash(t('skua.linkLost'));
      this.notice = t('skua.linkLost');
    }
    else if (this.signal < 0.7) this.say(t('skua.weakSignal', { dist: km(d) }), 0.5);
  }

  private crash(msg = t('skua.crashed')) {
    this.state = 'absturz';
    this.waypoint = null;
    this.crashTimer = 4;
    this.onWreck?.(this.model.group, this.forward.clone().multiplyScalar(this.speed));
    this.speed = 0;
    this.lock = null;
    this.say(msg, 3);
    this.onCrash?.(this.pos.clone());
  }

  // ---- Target ----
  get alive(): boolean { return this.state === 'flug' || this.state === 'landung'; }
  spheres(): [number, number, number, number][] { return [[this.pos.x, this.pos.y, this.pos.z, 7.5]]; }
  centre(out: THREE.Vector3) { return out.copy(this.pos); }
  velocity(out: THREE.Vector3) { return out.copy(this.forward).multiplyScalar(this.speed); }
  hit(damage: number): boolean {
    if (!this.alive) return false;
    this.hp -= damage;
    if (this.hp > 0) { this.say(t('unit.hitArmour', { pct: pct(this.hp / this.maxHp) }), 1.2); return false; }
    this.hp = 0;
    this.crash(t('skua.shotDown'));
    return true;
  }

  /** guns on Space, missile on X (needs a lock) */
  shoot(dt: number, trigger: boolean, missile: boolean, combat: Combat) {
    this.laser.update(dt);
    this.lock = this.state === 'flug' ? combat.findTarget(this.pos, this.forward, this.team, 2600, 20) : null;
    if (this.state !== 'flug') return;
    const vel = this.forward.clone().multiplyScalar(this.speed);
    if (trigger && !this.armed) { if (this.laser.ready()) { this.say(t('skua.noQuasar'), 1); this.laser.fired(); } }
    else if (trigger && this.laser.ready()) {
      this.gunSide = -this.gunSide;
      const side = new THREE.Vector3(this.forward.z, 0, -this.forward.x).normalize().multiplyScalar(1.6 * this.gunSide);
      const from = this.pos.clone().addScaledVector(this.forward, 8).add(side);
      combat.fire({ kind: 'laser', team: this.team, from, dir: this.forward, inherit: vel, damage: DAMAGE.quasar, source: this });
      this.laser.fired();
    }
    if (missile) {
      if (this.missiles <= 0) this.say(t('skua.noAssassin'));
      else if (!this.lock) this.say(t('skua.noLock'));
      else {
        const from = this.pos.clone().addScaledVector(this.forward, 4).add(new THREE.Vector3(0, -1.5, 0));
        combat.fire({ kind: 'rakete', team: this.team, from, dir: this.forward, inherit: vel, target: this.lock, source: this });
        this.useAssassin();
        this.say(t('skua.missileAway', { target: this.lock.name, n: this.missiles }), 1.5);
      }
    }
  }

  /** to the pad: down to the approach point, over the pad into the hover, then straight down */
  private padLand(dt: number) {
    const p = this.pad!;
    if (this.landPhase === 0) {
      if (this.flyTowards(this.padApproach, dt, 60) < APPROACH.near) this.landPhase = 1;
      return;
    }
    const wp = new THREE.Vector3(p.x, p.y + (this.landPhase === 1 ? 40 : 0) + MANTA_GEAR, p.z);
    const to = wp.clone().sub(this.pos), dist = to.length();
    const cruise = this.landPhase === 1 ? THREE.MathUtils.clamp(dist * 0.2, 8, 75) : 4;
    const v = Math.min(cruise, dist / Math.max(dt, 1e-3));
    const prev = this.pos.clone();
    this.pos.addScaledVector(to.normalize(), v * dt);
    // keep clear of the hills on the way in (not over the pad itself)
    if (this.landPhase < 2) {
      const ground = this.ground.heightAt(this.pos.x, this.pos.z);
      this.pos.y = Math.max(this.pos.y, ground + (this.landPhase === 0 ? 60 : 25) + MANTA_GEAR);
    }
    if (dist < 1.5) this.landPhase++;
    if (this.landPhase > 2) {
      this.state = 'pad';
      this.speed = 0; this.pitch = 0; this.bank = 0;
      this.pos.set(p.x, p.y + MANTA_GEAR, p.z);
      this.padDry = false;
      this.say(t('skua.padLanded', { unit: this.name, island: p.name }), 4);
      this.pose();
      return;
    }
    const move = this.pos.clone().sub(prev);
    // the nose along the way in until close, then round to the pad's heading
    const wantYaw = dist > 60 && move.lengthSq() > 1e-4 ? Math.atan2(move.x, move.z) : p.rot;
    const dy = Math.atan2(Math.sin(wantYaw - this.yaw), Math.cos(wantYaw - this.yaw));
    const yawRate = THREE.MathUtils.clamp(dy, -0.8 * dt, 0.8 * dt);
    this.yaw += yawRate;
    this.bank += (THREE.MathUtils.clamp(-yawRate / dt * 1.2, -0.7, 0.7) - this.bank) * Math.min(1, dt * 2);
    const climb = move.y / Math.max(dt, 1e-3);
    this.pitch += ((dist > 60 ? Math.atan2(climb, Math.max(v, 1)) * 0.4 : 0) - this.pitch) * Math.min(1, dt * 2);
    this.speed = v;
    this.updateForward();
    this.pose();
  }

  /** parked on a pad: the tank fills from the island network (a full tank in about 15 s) */
  private onPad(dt: number) {
    const p = this.pad!;
    this.speed = 0;
    this.pos.set(p.x, p.y + MANTA_GEAR, p.z);
    this.signal = signalAt(this.link(this.pos.x, this.pos.z));
    if (this.fuel < 0.999 && this.padFuel) {
      const want = Math.min((1 - this.fuel) * VEHICLE_TANK, VEHICLE_TANK / 15 * dt);
      const got = this.padFuel(p, want);
      this.fuel = Math.min(1, this.fuel + got / VEHICLE_TANK);
      if (got <= 0) { if (!this.padDry) this.say(t('skua.padNoFuel', { island: p.name }), 4); this.padDry = true; }
      else { this.padDry = false; this.say(this.fuel >= 0.999 ? t('skua.padFull') : t('skua.padRefuel', { pct: pct(this.fuel) }), 1); }
    }
    this.pose();
  }

  /** straight up to 60 m over the pad, then on into forward flight */
  private padStart(dt: number) {
    const p = this.pad!;
    this.pos.y += 7 * dt;
    this.yaw = p.rot;
    this.pitch = 0; this.bank = 0;
    if (this.pos.y > p.y + 60 + MANTA_GEAR) {
      this.state = 'flug';
      this.pad = null;
      this.speed = MIN_SPEED + 14;
      this.pitch = 0.08;
      this.throttle = Math.max(this.throttle, 0.7);
      this.say(t('skua.airborne'));
    }
    this.updateForward();
    this.pose();
  }

  /**
   * The approach in forward flight (see APPROACH): the nose turns towards `to`, banked, and the Skua flies along it,
   * at least `clearance` m over the ground; the distance left to `to` over the ground
   */
  private flyTowards(to: THREE.Vector3, dt: number, clearance: number): number {
    const dx = to.x - this.pos.x, dz = to.z - this.pos.z;
    const dy = Math.atan2(dx, dz) - this.yaw, turn = Math.atan2(Math.sin(dy), Math.cos(dy));
    const yawRate = THREE.MathUtils.clamp(turn, -APPROACH.turn * dt, APPROACH.turn * dt);
    this.yaw += yawRate;
    this.bank += (THREE.MathUtils.clamp(-yawRate / Math.max(dt, 1e-3) * 1.2, -0.7, 0.7) - this.bank) * Math.min(1, dt * 2);
    this.speed += THREE.MathUtils.clamp(APPROACH.speed - this.speed, -APPROACH.brake * dt, APPROACH.brake * dt);
    const vy = THREE.MathUtils.clamp((to.y - this.pos.y) * 0.4, -APPROACH.sink, APPROACH.sink);
    this.pos.x += Math.sin(this.yaw) * this.speed * dt;
    this.pos.z += Math.cos(this.yaw) * this.speed * dt;
    this.pos.y = Math.max(this.pos.y + vy * dt, Math.max(0, this.ground.heightAt(this.pos.x, this.pos.z)) + clearance + MANTA_GEAR);
    this.pitch += (Math.atan2(vy, Math.max(this.speed, 1)) * 0.8 - this.pitch) * Math.min(1, dt * 2);
    this.updateForward();
    this.pose();
    return Math.hypot(dx, dz);
  }

  /** autopilot in carrier coordinates: approach astern in forward flight, hover over the lift, touch down */
  private autoland(dt: number) {
    if (this.landPhase > 2) { this.lower(dt); return; }
    const c = this.carrier;
    if (this.landPhase === 0) {
      const g = c.localToWorld(0, APPROACH.gates[this.gate]).setY(this.deckY() + APPROACH.height);
      if (this.flyTowards(g, dt, 60) < APPROACH.near) {
        // (at the near gate it holds in a circle round it while the lift is busy)
        if (this.gate + 1 < APPROACH.gates.length) this.gate++;
        else if (!this.liftBusy) {
          const l = c.worldToLocal(this.pos);
          this.local.set(l.x, this.pos.y - this.deckY(), l.z);
          this.landPhase = 1;
        }
      }
      return;
    }
    const waypoints = [new THREE.Vector3(0, 150, -900), new THREE.Vector3(0, 45, LIFT_Z), new THREE.Vector3(0, 0, LIFT_Z)];
    const wp = waypoints[this.landPhase];
    const to = wp.clone().sub(this.local);
    const dist = to.length();
    // relative speed: cruise in, brake smoothly into the hover, slow vertical touch-down
    const cruise = this.landPhase === 0 ? 75 : this.landPhase === 1 ? THREE.MathUtils.clamp(dist * 0.2, 8, 75) : 4;
    const v = Math.min(cruise, dist / Math.max(dt, 1e-3));
    const prevLocal = this.local.clone();
    this.local.addScaledVector(to.normalize(), v * dt);
    if (dist < 1.5) this.landPhase++;
    if (this.landPhase > 2) {
      this.throttle = 0.6;
      const short = this.rearm();
      this.say((short ? t('skua.landedShort', { unit: this.name, short }) : t('skua.landedFull', { unit: this.name })));
      this.liftY = c.model.lift ? 0 : null;
      this.lower(0);
      return;
    }
    // orientation: follow the flight path on the approach, level and aligned in the hover
    const move = this.local.clone().sub(prevLocal);
    const wantYawLocal = this.landPhase === 0 && move.lengthSq() > 1e-4 ? Math.atan2(-move.x, move.z) : 0;
    const wantYaw = c.heading + wantYawLocal;
    let dy = wantYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const yawRate = THREE.MathUtils.clamp(dy, -0.8 * dt, 0.8 * dt);
    this.yaw += yawRate;
    this.bank += (THREE.MathUtils.clamp(-yawRate / dt * 1.2, -0.7, 0.7) - this.bank) * Math.min(1, dt * 2);
    const climb = move.y / Math.max(dt, 1e-3);
    const wantPitch = this.landPhase === 0 ? Math.atan2(climb, Math.max(v, 1)) * 0.8 : 0;
    this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * 2);
    this.speed = Math.max(0, v + (this.landPhase < 2 ? c.speed : 0));

    // local -> world (the local frame follows the carrier's position and heading)
    const w = c.localToWorld(this.local.x, this.local.z);
    this.pos.set(w.x, this.deckY() + this.local.y + MANTA_GEAR, w.z);
    this.updateForward();
    this.pose();
  }

  /** after the touch-down: down to the hangar on the lift (straight into it on a ship without one) */
  private lower(dt: number) {
    if (this.liftY === null) { this.state = 'deck'; this.placeOnDeck(LIFT_Z); return; }
    this.liftY = Math.max(-LIFT_DEPTH, this.liftY - LIFT_SPEED * dt);
    this.placeOnDeck(LIFT_Z, this.liftY);
    if (this.liftY <= -LIFT_DEPTH) { this.state = 'deck'; this.liftY = null; }
  }

  private pose() {
    const g = this.model.group;
    g.position.copy(this.pos).y -= MANTA_GEAR;
    g.rotation.set(-this.pitch, this.yaw, this.bank, 'YXZ');
  }

  // ---- save game ----
  /** the catapult start and the landing approach are saved as "on the lift", a pad approach as flying, a pad take-off as on the pad */
  saveState() {
    const state: MantaState = this.state === 'start' || this.state === 'landung' ? 'deck' : this.state === 'padland' ? 'flug' : this.state === 'padstart' ? 'pad' : this.state;
    return {
      pad: state === 'pad' && this.pad ? { ...this.pad } : null,
      state, x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw, pitch: this.pitch, bank: this.bank,
      speed: this.speed, throttle: this.throttle, fuel: this.fuel, hp: this.hp, fit: { ...this.fit }, load: { ...this.load }, crashTimer: this.crashTimer,
      waypoint: this.waypoint ? [this.waypoint.x, this.waypoint.y] as [number, number] : null,
    };
  }

  loadState(s: ReturnType<Manta['saveState']>) {
    this.state = s.state; this.fuel = s.fuel; this.hp = s.hp; this.throttle = s.throttle;
    this.fit = normaliseSkua(s.fit, true); this.load = normaliseSkua(s.load, false);
    this.crashTimer = s.crashTimer; this.landPhase = 0; this.startPhase = 2; this.liftY = null;
    this.waypoint = s.waypoint ? new THREE.Vector2(s.waypoint[0], s.waypoint[1]) : null;
    this.model.group.visible = s.state !== 'absturz';
    this.pad = s.pad ? { ...s.pad } : null;
    if (s.state === 'pad' && this.pad) {
      this.pos.set(this.pad.x, this.pad.y + MANTA_GEAR, this.pad.z);
      this.yaw = this.pad.rot; this.pitch = 0; this.bank = 0; this.speed = 0;
      this.updateForward();
      this.pose();
    } else if (s.state === 'pad') { this.state = 'deck'; this.speed = 0; this.placeOnDeck(LIFT_Z); }
    else if (s.state === 'flug') {
      this.pos.set(s.x, s.y, s.z);
      this.yaw = s.yaw; this.pitch = s.pitch; this.bank = s.bank; this.speed = s.speed;
      this.updateForward();
      this.pose();
    } else { this.speed = 0; this.placeOnDeck(LIFT_Z); }
  }
}
