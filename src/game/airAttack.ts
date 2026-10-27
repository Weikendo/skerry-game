import * as THREE from 'three';
import type { VirtualInput } from './autopilot';
import type { Target } from './combat';
import { MANTA_KEYS, MAX_SPEED, MIN_SPEED, type Manta } from './manta';

/**
 * A Skua's attack flying, shared by the enemy's sorties (omega.ts) and the player's strikes (strikes.ts): runs at a
 * target with the Assassins and the Quasar, and the hard turn round towards home.
 */

/** the Skua's steepest bank in a turn (rad): its turning circle is speed² / (g · tan) */
export const HARD_BANK = 0.95;

/** what an attack run remembers: the pass it flies on after going by (s), when it last fired a missile (s) */
export interface Run { pass: number; shotAt: number }

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const aim = new THREE.Vector3(), vel = new THREE.Vector3();

/**
 * Fly at the target: lead it, keep clear of the ground, fire the Assassins on a lock (one every 5 s) and the Quasar
 * when lined up. It never strays further than `leash` from `home` (its radio) and keeps slow enough to turn round
 * inside it. Steers through `v`; returns the fire orders. `time`: a clock in seconds.
 */
export function attackRun(m: Manta, t: Target, run: Run, v: VirtualInput, home: THREE.Vector3, leash: number, time: number, dt: number): { trigger: boolean; missile: boolean } {
  t.centre(aim);
  const dist = aim.distanceTo(m.pos);
  if (t.velocity) aim.addScaledVector(t.velocity(vel), dist / 500);
  const dx = aim.x - m.pos.x, dz = aim.z - m.pos.z, horiz = Math.hypot(dx, dz);
  const ground = m.pos.y - m.altitude, air = aim.y - ground > 60;
  // after a pass close by it flies on a little before turning in again
  if (run.pass > 0) run.pass -= dt;
  else if (horiz < 320) run.pass = 4;
  const diff = run.pass > 0 ? 0 : wrap(Math.atan2(dx, dz) - m.yaw);
  let wantAlt = air ? THREE.MathUtils.clamp(aim.y, ground + 120, ground + 1500) : Math.max(ground + 140, aim.y + 120);
  // on a run at something on the surface it comes down so the nose points at it
  if (!air && horiz < 1800 && Math.abs(diff) < 0.3) wantAlt = Math.max(ground + 80, aim.y + 50);
  const k = MANTA_KEYS;
  v.clear();
  // hard over in the turn and slower there (at full speed the circle is kilometres wide)
  const wantBank = THREE.MathUtils.clamp(-diff * 3, -HARD_BANK, HARD_BANK);
  v.set(k.right, (wantBank - m.bank) * 2.5);
  const climb = THREE.MathUtils.clamp((wantAlt - m.pos.y) * 0.004, -0.25, 0.3);
  v.set(k.noseUp, (climb + (1 - Math.cos(m.bank)) * 0.5 - m.pitch) * 3);
  // no faster than lets it fly on past the target (its 4 s pass) and still turn round inside its leash; the
  // speed follows the throttle only slowly, so this holds from the start of the run
  const room = leash - 150 - Math.max(Math.hypot(aim.x - home.x, aim.z - home.z), Math.hypot(m.pos.x - home.x, m.pos.z - home.z));
  const a = 1.2 / (9.81 * Math.tan(HARD_BANK)), vmax = room > 0 ? (-4 + Math.sqrt(16 + 4 * a * room)) / (2 * a) : 0;
  const cap = THREE.MathUtils.clamp((vmax - MIN_SPEED - 7) / (MAX_SPEED - MIN_SPEED - 7), 0, 1);
  v.set(k.more, (Math.min(Math.abs(diff) > 0.25 ? 0.4 : 0.75, cap) - m.throttle) * 4);
  // weapons: an Assassin on a lock every few seconds, the Quasar when the nose is on it
  const lined = aim.clone().sub(m.pos).normalize().dot(m.forward) > 0.995;
  const missile = !!m.lock && m.lock === t && m.missiles > 0 && time - run.shotAt > 5;
  if (missile) run.shotAt = time;
  return { trigger: m.armed && dist < 900 && lined, missile };
}

/** how far from home a Skua gets before it has turned round, flying on as it does now */
export function reachOut(m: Manta, home: THREE.Vector3): number {
  const dx = m.pos.x - home.x, dz = m.pos.z - home.z, d = Math.hypot(dx, dz) || 1;
  const out = (dx * m.forward.x + dz * m.forward.z) / (d * (Math.hypot(m.forward.x, m.forward.z) || 1));
  const circle = m.speed * m.speed / (9.81 * Math.tan(HARD_BANK));
  return d + Math.max(0, out) * circle * 1.2 + 150;
}

/**
 * Steer round towards home, banked hard and throttled back for a tight circle (`throttle`: higher for a wider but
 * faster turn, to get away from a target that fires back); false once it points there
 */
export function turnRound(m: Manta, home: THREE.Vector3, v: VirtualInput, throttle = 0.1): boolean {
  const diff = wrap(Math.atan2(home.x - m.pos.x, home.z - m.pos.z) - m.yaw);
  if (Math.abs(diff) < 0.5) return false;
  const k = MANTA_KEYS, ground = m.pos.y - m.altitude;
  v.clear();
  v.set(k.right, (-Math.sign(diff) * HARD_BANK - m.bank) * 2.5);
  const climb = THREE.MathUtils.clamp((Math.max(ground + 180, 260) - m.pos.y) * 0.004, -0.25, 0.3);
  v.set(k.noseUp, (climb + (1 - Math.cos(m.bank)) * 0.5 - m.pitch) * 3);
  v.set(k.more, (throttle - m.throttle) * 4);
  return true;
}
