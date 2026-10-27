import * as THREE from 'three';
import type { DroneModel } from '../models/drone';
import { waveHeight } from '../world/ocean';
import type { Ground } from '../world/terrain';
import type { Environment } from '../world/environment';
import type { CarrierController } from './carrierController';
import type { InputLike } from './input';
import type { Target } from './combat';
import { linkDistance, SIGNAL_LOST, signalAt } from './telemetry';
import { HP } from './arsenal';
import { t, pct } from '../i18n';

export type DroneState = 'deck' | 'start' | 'flug' | 'rueckkehr' | 'zerstoert';

const PAD_Z = -70;            // landing circle behind the superstructure (carrier-local)
const MAX_SPEED = 24;         // m/s horizontal
/** the pace steps (share of MAX_SPEED for full stick): slow for mapping and close shots, normal, fast */
export const DRONE_PACES = [0.4, 0.7, 1];
const CLIMB = 7;              // m/s vertical
const YAW_RATE = 1.5;         // rad/s
const CEILING = 600;          // m above sea level
export const DRONE_RANGE = SIGNAL_LOST;  // radio range around the carrier (m)
const FLIGHT_TIME = 8 * 60;   // s on a full battery
const CHARGE_TIME = 90;       // s from empty to full on the pad
const RETURN_AT = 0.22;       // battery level for the automatic return
const TAKEOFF_H = 22;         // m above the pad before the pilot takes over
const LEAN = 0.6;             // a big airframe leans less into the motion than a small quad

export const DRONE_KEYS = {
  forward: ['KeyW', 'ArrowUp', 'Pad.RY-'], back: ['KeyS', 'ArrowDown', 'Pad.RY+'],
  yawL: ['KeyA', 'ArrowLeft', 'Pad.LX-'], yawR: ['KeyD', 'ArrowRight', 'Pad.LX+'],
  strafeL: ['KeyQ', 'Pad.RX-'], strafeR: ['KeyE', 'Pad.RX+'],
  up: ['KeyR', 'Pad.LY-'], down: ['KeyF', 'Pad.LY+'],
};

/**
 * Unarmed reconnaissance drone (quadcopter). Flies like a real camera drone: the
 * sticks command velocities and it holds its position when they are released.
 * Battery and radio range limit it to the carrier's surroundings; it maps the
 * islands its camera sees. Starts from and lands on the landing circle in the stern.
 */
export class Drone implements Target {
  readonly name = t('drone.name');
  readonly team = 'spieler' as const;
  readonly kind = 'einheit' as const;
  readonly maxHp = HP.drone;
  hp = HP.drone;
  state: DroneState = 'deck';
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;              // 0 = +z, increases to the left (same as the other units)
  battery = 1;
  /** 0..1 link quality to the carrier */
  signal = 1;
  altitude = 0;
  /** gimbal (set from the camera head while the drone camera is selected) */
  gimbalPan = 0;
  gimbalTilt = -0.45;
  /** one of DRONE_PACES */
  pace = 1;
  /** it carries the long-range radio pod (fitted aboard from the hold): in the air it relays the link for the Otters
   *  and Skuas, and needs none to the carrier itself (only the battery limits it) */
  pod = false;
  waypoint: THREE.Vector2 | null = null;
  message = '';
  /** one-off messages for the message log (low battery, return …) */
  notice = '';
  private msgTimer = 0;
  private respawn = 0;
  private rotorSpin = 0;
  private pitchVis = 0;
  private rollVis = 0;
  private startY = 0;
  private holdAt: THREE.Vector2 | null = null;

  constructor(readonly model: DroneModel, private ground: Ground, private env: Environment, private carrier: CarrierController) {
    this.placeOnPad();
  }

  private say(msg: string, seconds = 2.5) {
    this.message = msg;
    this.msgTimer = seconds;
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** horizontal distance to the carrier */
  /** distance to the nearest link (the carrier, or itself with the radio pod) */
  get range(): number {
    return linkDistance(this.pos.x, this.pos.z, this.carrier.pos);
  }

  /** it relays the link (see `pod`) */
  get relay(): boolean { return this.pod && (this.state === 'flug' || this.state === 'rueckkehr'); }

  get flying(): boolean {
    return this.state === 'start' || this.state === 'flug' || this.state === 'rueckkehr';
  }

  /** L key / gamepad B: take off, or fly home and land */
  toggleLaunch() {
    if (this.state === 'deck') {
      if (this.battery < 0.3) { this.say(t('drone.batteryLowCharging', { pct: pct(this.battery) })); return; }
      this.state = 'start';
      this.startY = 0;
      this.say(t('drone.launch'));
    } else if (this.state === 'flug') {
      this.goHome(t('drone.returning'));
    } else if (this.state === 'rueckkehr' && this.battery > RETURN_AT && this.signal > 0.05) {
      this.state = 'flug';
      this.say(t('drone.returnCancelled'));
    }
  }

  /** map command: stop where it is and hover (also calls off the return flight if the battery allows) */
  hold() {
    if (this.state === 'rueckkehr') {
      if (this.battery <= RETURN_AT || this.signal <= 0.05) { this.say(t('drone.cannotHold')); return; }
      this.state = 'flug';
    }
    if (this.state !== 'flug') return;
    this.waypoint = null;
    this.holdAt = new THREE.Vector2(this.pos.x, this.pos.z);
    this.say(t('drone.hovering'));
  }

  /** map command: fly home and land */
  recall() {
    if (this.state === 'flug') this.goHome(t('drone.returning'));
  }

  private goHome(why: string) {
    this.state = 'rueckkehr';
    this.waypoint = null;
    this.holdAt = null;
    this.say(why, 3);
  }

  private padWorld(heightAbove = 0): THREE.Vector3 {
    const cg = this.carrier.model.group;
    cg.updateMatrixWorld();
    return new THREE.Vector3(0, heightAbove, PAD_Z).applyMatrix4(cg.matrixWorld);
  }

  private placeOnPad(lift = 0) {
    const c = this.carrier, cg = c.model.group;
    this.pos.copy(this.padWorld(lift));
    this.vel.copy(c.forward).multiplyScalar(c.speed);
    this.yaw = c.heading;
    const g = this.model.group;
    g.position.copy(this.pos);
    g.rotation.set(cg.rotation.x, this.yaw, cg.rotation.z, 'YXZ');
  }

  private surface(x: number, z: number): number {
    return Math.max(this.ground.heightAt(x, z), waveHeight(x, z, this.env.elapsed, this.env.w.waves));
  }

  update(dt: number, input: InputLike | null) {
    this.msgTimer -= dt;
    if (this.msgTimer <= 0) this.message = '';
    const k = DRONE_KEYS;
    let fwd = 0, side = 0, yawIn = 0, climb = 0;
    if (input) {
      fwd = input.axis(k.back, k.forward);
      side = input.axis(k.strafeL, k.strafeR);
      yawIn = input.axis(k.yawR, k.yawL);
      climb = input.axis(k.down, k.up);
    }
    const manual = fwd !== 0 || side !== 0 || yawIn !== 0 || climb !== 0;

    switch (this.state) {
      case 'deck':
        this.battery = Math.min(1, this.battery + dt / CHARGE_TIME);
        this.placeOnPad();
        // a waypoint on the map launches the drone
        if (this.waypoint && this.battery >= 0.3) this.toggleLaunch();
        break;
      case 'zerstoert':
        this.respawn -= dt;
        if (this.respawn <= 0) {
          if (this.carrier.stores.drohne > 0) {
            this.carrier.stores.drohne--;
            this.state = 'deck'; this.hp = this.maxHp; this.battery = 0.5;
            this.model.group.visible = true;
            this.say(t('drone.spareReady'));
          } else {
            this.respawn = 5;
            this.say(t('drone.noSpare'), 5);
          }
        }
        break;
      case 'start': {
        // vertical take-off, riding along with the carrier
        this.startY = Math.min(TAKEOFF_H, this.startY + 4 * dt);
        this.placeOnPad(this.startY);
        if (this.startY >= TAKEOFF_H) { this.state = 'flug'; this.say(t('drone.airborne')); }
        break;
      }
      case 'flug':
        if (manual && this.waypoint) { this.waypoint = null; this.say(t('pilot.off')); }
        if (manual) this.holdAt = null;
        if (!manual && this.waypoint) this.autopilot(dt);
        else this.fly(dt, fwd, side, yawIn, climb);
        this.limits();
        break;
      case 'rueckkehr':
        this.flyHome(dt);
        break;
    }

    if (this.flying && this.state !== 'start') {
      // battery: hovering costs, speed and climbing cost more
      const h = Math.hypot(this.vel.x, this.vel.z) / MAX_SPEED;
      this.battery -= dt / FLIGHT_TIME * (0.85 + 0.25 * Math.min(1, h) + 0.2 * Math.max(0, this.vel.y / CLIMB));
      if (this.battery <= 0) { this.battery = 0; this.destroy(t('drone.batteryDead')); return; }
    }
    const surf = this.surface(this.pos.x, this.pos.z);
    this.altitude = this.flying ? Math.max(0, this.pos.y - surf) : 0;
    this.signal = this.pod ? 1 : signalAt(this.range);
    this.pose(dt);
  }

  /** pilot or hold: velocity commands like a GPS camera drone */
  private fly(dt: number, fwd: number, side: number, yawIn: number, climb: number) {
    this.yaw += yawIn * YAW_RATE * dt;
    const f = this.forward, r = new THREE.Vector3(-f.z, 0, f.x); // r = right of the nose
    const top = MAX_SPEED * this.pace;
    const want = f.multiplyScalar(fwd * top).addScaledVector(r, side * top * 0.7);
    // position hold: no stick → stay over the spot where the sticks were released
    if (fwd === 0 && side === 0) {
      if (!this.holdAt) this.holdAt = new THREE.Vector2(this.pos.x, this.pos.z);
      want.set((this.holdAt.x - this.pos.x) * 0.6, 0, (this.holdAt.y - this.pos.z) * 0.6).clampLength(0, MAX_SPEED);
    } else this.holdAt = null;
    this.steer(dt, want, climb * CLIMB);
  }

  private steer(dt: number, want: THREE.Vector3, vy: number) {
    const kh = 1 - Math.exp(-dt * 1.8), kv = 1 - Math.exp(-dt * 3);
    this.vel.x += (want.x - this.vel.x) * kh;
    this.vel.z += (want.z - this.vel.z) * kh;
    this.vel.y += (vy - this.vel.y) * kv;
    // strong wind pushes the drone a little
    const wind = this.env.w.wind;
    if (wind > 12) { this.vel.x += Math.sin(this.env.elapsed * 0.7) * (wind - 12) * 0.02 * dt; this.vel.z += Math.cos(this.env.elapsed * 0.5) * (wind - 12) * 0.02 * dt; }
    this.pos.addScaledVector(this.vel, dt);
    const surf = this.surface(this.pos.x, this.pos.z);
    if (this.pos.y < surf + 0.4) {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (hs > 9 || this.vel.y < -6) { this.destroy(t('drone.crashed')); return; }
      this.pos.y = surf + 0.4;
      this.vel.y = Math.max(0, this.vel.y);
      this.vel.x *= 0.8; this.vel.z *= 0.8;
    }
    if (this.pos.y > CEILING) { this.pos.y = CEILING; this.vel.y = Math.min(0, this.vel.y); }
  }

  /** out of range or low on battery: fly home automatically */
  private limits() {
    if (this.state !== 'flug') return;
    if (this.battery < RETURN_AT) { this.goHome(t('drone.lowBattery')); this.notice = t('drone.lowBatteryMsg'); }
    else if (!this.pod && this.range > DRONE_RANGE) { this.goHome(t('drone.outOfRange')); this.notice = t('drone.outOfRangeMsg'); }
  }

  /** waypoint autopilot: cruise at a safe height, then hover over the point */
  private autopilot(dt: number) {
    const wp = this.waypoint!;
    const dx = wp.x - this.pos.x, dz = wp.y - this.pos.z, dist = Math.hypot(dx, dz);
    if (Math.hypot(wp.x - this.carrier.pos.x, wp.y - this.carrier.pos.z) > DRONE_RANGE) {
      this.waypoint = null; this.say(t('drone.waypointOutOfRange')); return;
    }
    const groundAhead = Math.max(this.surface(this.pos.x, this.pos.z), this.surface(this.pos.x + dx / Math.max(dist, 1) * 150, this.pos.z + dz / Math.max(dist, 1) * 150));
    const cruise = Math.max(groundAhead + 90, 120);
    const speed = Math.min(MAX_SPEED, dist * 0.35);
    const want = new THREE.Vector3(dx, 0, dz).normalize().multiplyScalar(speed);
    if (dist > 30) {
      let d = Math.atan2(dx, dz) - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += THREE.MathUtils.clamp(d, -YAW_RATE * dt, YAW_RATE * dt);
    } else {
      this.waypoint = null;
      this.holdAt = new THREE.Vector2(wp.x, wp.y);
      this.say(t('drone.waypointReached'));
      this.notice = t('drone.waypointReachedMsg');
    }
    this.steer(dt, want, THREE.MathUtils.clamp((cruise - this.pos.y) * 0.5, -CLIMB, CLIMB));
  }

  /** return to the landing circle: climb clear, approach, match the carrier, set down */
  private flyHome(dt: number) {
    const c = this.carrier;
    const carrierVel = c.forward.clone().multiplyScalar(c.speed);
    const pad = this.padWorld(0);
    const dx = pad.x - this.pos.x, dz = pad.z - this.pos.z, dist = Math.hypot(dx, dz);
    const high = Math.max(pad.y + 45, this.surface(this.pos.x, this.pos.z) + 60);
    let vy: number;
    const want = new THREE.Vector3();
    if (dist > 4) {
      want.set(dx, 0, dz).normalize().multiplyScalar(Math.min(MAX_SPEED, dist * 0.4)).add(carrierVel);
      vy = THREE.MathUtils.clamp(((dist > 120 ? high : pad.y + 25) - this.pos.y) * 0.6, -CLIMB, CLIMB);
      let d = (dist > 60 ? Math.atan2(dx, dz) : c.heading) - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += THREE.MathUtils.clamp(d, -YAW_RATE * dt, YAW_RATE * dt);
    } else {
      // over the circle: match the ship and sink onto it
      want.set(dx * 2, 0, dz * 2).add(carrierVel);
      vy = -Math.min(4, Math.max(0.8, (this.pos.y - pad.y) * 0.5));
      let d = c.heading - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += THREE.MathUtils.clamp(d, -YAW_RATE * dt, YAW_RATE * dt);
      if (this.pos.y - pad.y < 0.3) {
        this.state = 'deck';
        this.hp = this.maxHp;
        this.say(t('drone.landed', { pct: pct(this.battery) }));
        this.placeOnPad();
        return;
      }
    }
    const kh = 1 - Math.exp(-dt * 2.5), kv = 1 - Math.exp(-dt * 3);
    this.vel.x += (want.x - this.vel.x) * kh;
    this.vel.z += (want.z - this.vel.z) * kh;
    this.vel.y += (vy - this.vel.y) * kv;
    this.pos.addScaledVector(this.vel, dt);
    const floor = Math.max(this.surface(this.pos.x, this.pos.z), dist < 60 ? pad.y : -Infinity) + 0.25;
    if (this.pos.y < floor) { this.pos.y = floor; this.vel.y = Math.max(0, this.vel.y); }
  }

  private destroy(msg: string) {
    this.state = 'zerstoert';
    this.pod = false;   // (the pod goes down with it)
    this.respawn = 20;
    this.vel.set(0, 0, 0);
    this.waypoint = null;
    this.holdAt = null;
    this.model.group.visible = false;
    this.say(msg, 3);
    this.notice = msg;
    this.onCrash?.(this.pos.clone());
  }

  onCrash: ((at: THREE.Vector3) => void) | null = null;

  /** the sensor ball holds its heading + pan/tilt level, whatever the airframe does */
  private stabiliseGimbal() {
    const g = this.model.group, gim = this.model.gimbal;
    const level = new THREE.Quaternion().setFromEuler(new THREE.Euler(-this.gimbalTilt, this.yaw + this.gimbalPan, 0, 'YXZ'));
    gim.quaternion.copy(g.quaternion).invert().multiply(level);
  }

  private pose(dt: number) {
    const g = this.model.group;
    // rotors: idle on the pad, spinning in flight (blur discs fade in)
    const rpm = this.flying ? 55 + Math.max(0, this.vel.y) * 4 : 0;
    this.rotorSpin += rpm * dt;
    this.model.rotors.forEach((r, i) => { r.rotation.y = this.rotorSpin * (i % 3 === 0 ? 1 : -1); });
    for (const d of this.model.discs) d.material.opacity = rpm > 0 ? 0.22 : 0;
    if (this.state === 'deck' || this.state === 'zerstoert' || this.state === 'start') {
      if (this.state === 'start') this.model.group.position.copy(this.pos);
      this.stabiliseGimbal();
      return;
    }
    // body leans into the motion
    const f = this.forward, r = new THREE.Vector3(-f.z, 0, f.x);
    const rel = this.vel.clone();
    if (this.state === 'rueckkehr') rel.addScaledVector(this.carrier.forward, -this.carrier.speed);
    const k = Math.min(1, dt * 4);
    this.pitchVis += (THREE.MathUtils.clamp(rel.dot(f) / MAX_SPEED, -1, 1) * 0.32 * LEAN - this.pitchVis) * k;
    this.rollVis += (THREE.MathUtils.clamp(rel.dot(r) / MAX_SPEED, -1, 1) * 0.28 * LEAN - this.rollVis) * k;
    g.position.copy(this.pos);
    g.rotation.set(this.pitchVis, this.yaw, this.rollVis, 'YXZ');
    this.stabiliseGimbal();
  }

  // ---- Target ----
  get alive(): boolean { return this.state === 'flug' || this.state === 'rueckkehr'; }
  spheres(): [number, number, number, number][] { return [[this.pos.x, this.pos.y + 2.4, this.pos.z, 6]]; }
  centre(out: THREE.Vector3) { return out.copy(this.pos).setY(this.pos.y + 2.4); }
  velocity(out: THREE.Vector3) { return out.copy(this.vel); }
  hit(damage: number): boolean {
    if (!this.alive) return false;
    this.hp -= damage;
    if (this.hp > 0) { this.say(t('unit.hitCondition', { pct: pct(this.hp / this.maxHp) }), 1.2); return false; }
    this.hp = 0;
    this.destroy(t('drone.shotDown'));
    return true;
  }

  // ---- save game ----
  /** the vertical take-off is saved as "on the pad" */
  saveState() {
    const state: DroneState = this.state === 'start' ? 'deck' : this.state;
    return {
      state, pos: this.pos.toArray(), vel: this.vel.toArray(), yaw: this.yaw, battery: this.battery, hp: this.hp,
      respawn: this.respawn, gimbalPan: this.gimbalPan, gimbalTilt: this.gimbalTilt, pod: this.pod,
      waypoint: this.waypoint ? [this.waypoint.x, this.waypoint.y] as [number, number] : null,
      holdAt: this.holdAt ? [this.holdAt.x, this.holdAt.y] as [number, number] : null,
    };
  }

  loadState(s: ReturnType<Drone['saveState']>) {
    this.state = s.state; this.battery = s.battery; this.hp = s.hp; this.respawn = s.respawn;
    this.gimbalPan = s.gimbalPan; this.gimbalTilt = s.gimbalTilt; this.pod = !!s.pod;
    this.waypoint = s.waypoint ? new THREE.Vector2(s.waypoint[0], s.waypoint[1]) : null;
    this.holdAt = s.holdAt ? new THREE.Vector2(s.holdAt[0], s.holdAt[1]) : null;
    this.model.group.visible = s.state !== 'zerstoert';
    if (s.state === 'flug' || s.state === 'rueckkehr') {
      this.pos.fromArray(s.pos); this.vel.fromArray(s.vel); this.yaw = s.yaw;
      this.pose(0);
    } else this.placeOnPad();
  }
}
