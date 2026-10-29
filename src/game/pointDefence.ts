import * as THREE from 'three';
import { DAMAGE } from './arsenal';
import type { CarrierController } from './carrierController';
import { shotSpeed, type Combat, type Incoming, type Target, type Team } from './combat';
import { LaserWeapon } from './weapons';

/**
 * A carrier's laser turret, as in the original: all the way round, up and down, zoom up to 8× and a heat gauge;
 * hot, it first loses power, then cuts out. Here it also fights on its own: the other side's missiles first, then
 * its aircraft and vehicles near the ship, in short bursts, and with nothing of those about the other side's carrier
 * within the same reach (its bolts do a carrier's armoured hull little harm, TURRET_VS_HULL, but they add up). The player takes over the Stoorworm's through its
 * turret camera; the enemy's fights the better the harder the game.
 */
export const TURRET = {
  /** turning speed round and up (rad/s); how far the barrels go down and up (rad) */
  yawRate: 2.4, pitchRate: 1.6, minPitch: -0.08, maxPitch: 1.4,
  /** missiles are fought this far from the ship, aircraft and vehicles this far (m) */
  missileRange: 900, unitRange: 1300,
  /** on its own against aircraft and vehicles: shots per burst, the pause after one at skill 0 and 1 (s) */
  burst: 3, pause: [4, 2],
  /** on its own: aim error (rad) and how long a new target takes to come on (s), at skill 0 and 1 */
  spread: [0.016, 0.004], reaction: [1.2, 0.3],
  /**
   * on its own: how far its aim strays from where the target will be (m either way, at skill 0 and 1). Alone it shoots
   * down about a quarter to three in five of the missiles coming at the ship (easy to hard; at its own skill 0.65 about
   * half), and a Skua flying past 500 m off takes up to two hits: driven off, not shot down. By hand it does much better.
   */
  track: { missile: [10, 6], unit: [30, 14] },
  /** it fires once the barrels point within this angle of the aim (rad); by hand a little wider */
  onTarget: 0.03, onTargetHand: 0.06,
  /** above this heat it loses half its power */
  weak: 0.7,
};
/** the end of a barrel in the barrel's frame (the twin barrels at x = ±0.75) */
const TIP = 8.4, TWIN = 0.75;
/** on its own it looks for a target this often (s) */
const SEEK = 0.3;
/** a missile this close is fought even with the laser hot (m) */
const LAST_DITCH = 400;

const lerp = THREE.MathUtils.lerp;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class PointDefence {
  /** a shot every 0.15 s; held fire heats it faster than it cools, so it overheats after about 7 s */
  readonly laser = new LaserWeapon(0.15, 0.05, 0.2);
  /** how well it fights on its own, 0..1 (the enemy's comes with the difficulty) */
  skill = 0.65;
  /** taken over by hand: the point the turret camera looks at (null: it fights on its own) */
  aim: THREE.Vector3 | null = null;
  /** the barrels point where it wants */
  onTarget = false;
  /** how fast it turns now (rad/s, round and up together: the servos' sound) */
  slew = 0;
  /** what it fights on its own: a missile, or else a vehicle or an aircraft */
  missile: Incoming | null = null;
  unit: Target | null = null;
  private burstLeft = TURRET.burst;
  private wait = 0;
  private seek = 0;
  /** time on the current target (it takes a moment to come on) */
  private onFor = 0;
  private side = 1;
  private clock = 0;
  private base = new THREE.Vector3();
  private lead = new THREE.Vector3();
  private local = new THREE.Vector3();
  private shipVel = new THREE.Vector3();
  private tp = new THREE.Vector3();
  private tv = new THREE.Vector3();

  constructor(private ship: CarrierController, private turret: THREE.Object3D, private barrel: THREE.Object3D,
    private team: Team, private ships: Target[]) {}

  /** the end of the barrels (for the lead marker) */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    return this.barrel.localToWorld(out.set(0, 0, TIP));
  }

  /** `trigger`: the fire key, while taken over by hand */
  update(dt: number, combat: Combat, trigger: boolean) {
    this.laser.update(dt);
    this.clock += dt;
    this.wait -= dt;
    this.onFor += dt;
    if (!this.ship.alive) { this.onTarget = false; return; }
    this.ship.velocity(this.shipVel);
    this.turret.updateWorldMatrix(true, true);
    const from = this.barrel.getWorldPosition(this.base);
    let aim = this.aim;
    if (!aim) {
      if (this.missile && !combat.inFlight(this.missile)) this.missile = null;
      if (this.unit && !this.unit.alive) this.unit = null;
      if ((this.seek -= dt) <= 0) { this.seek = SEEK; this.pick(combat, from); }
      aim = this.missile || this.unit ? this.leadPoint(from) : null;
    }

    const off = this.turn(dt, aim);
    this.onTarget = !!aim && off < (this.aim ? TURRET.onTargetHand : TURRET.onTarget);
    if (!aim || !this.onTarget || !this.laser.ready()) return;

    // by hand: as long as the key is held
    if (this.aim) { if (trigger) this.shoot(combat, aim, 0); return; }
    // on its own: once the target has come on; it keeps its heat down, but not against a missile close by
    if (this.onFor < lerp(TURRET.reaction[0], TURRET.reaction[1], this.skill)) return;
    const close = !!this.missile && this.missile.pos.distanceTo(this.ship.pos) < LAST_DITCH;
    if (this.laser.heat > 0.8 && !close) return;
    // missiles get every shot it has, aircraft and vehicles bursts
    const spread = lerp(TURRET.spread[0], TURRET.spread[1], this.skill);
    const [e0, e1] = this.missile ? TURRET.track.missile : TURRET.track.unit, stray = lerp(e0, e1, this.skill);
    aim.x += (Math.random() - 0.5) * 2 * stray; aim.y += (Math.random() - 0.5) * 2 * stray; aim.z += (Math.random() - 0.5) * 2 * stray;
    if (this.missile) { this.shoot(combat, aim, spread); return; }
    if (this.wait > 0) return;
    this.shoot(combat, aim, spread);
    if (--this.burstLeft <= 0) { this.burstLeft = TURRET.burst; this.wait = lerp(TURRET.pause[0], TURRET.pause[1], this.skill); }
  }

  /** at rest (the title picture): only the slow sweep */
  rest(dt: number) {
    this.clock += dt;
    this.turn(dt, null);
  }

  /** turn round and up towards the aim (at rest a slow sweep); returns how far off it still points (rad) */
  private turn(dt: number, aim: THREE.Vector3 | null): number {
    let yawErr: number, pitchErr: number;
    const pitch = -this.barrel.rotation.x;
    if (aim) {
      const l = this.turret.worldToLocal(this.local.copy(aim));
      yawErr = Math.atan2(l.x, l.z);
      l.sub(this.barrel.position);
      pitchErr = THREE.MathUtils.clamp(Math.atan2(l.y, Math.hypot(l.x, l.z)), TURRET.minPitch, TURRET.maxPitch) - pitch;
    } else {
      yawErr = wrap(Math.sin(this.clock * 0.25) * 0.7 - this.turret.rotation.y);
      pitchErr = 0.12 + Math.sin(this.clock * 0.4) * 0.08 - pitch;
    }
    const dy = THREE.MathUtils.clamp(yawErr, -TURRET.yawRate * dt, TURRET.yawRate * dt);
    const dp = THREE.MathUtils.clamp(pitchErr, -TURRET.pitchRate * dt, TURRET.pitchRate * dt);
    this.turret.rotation.y = wrap(this.turret.rotation.y + dy);
    this.barrel.rotation.x = -(pitch + dp);
    this.slew = dt > 0 ? (Math.abs(dy) + Math.abs(dp)) / dt : 0;
    return Math.abs(yawErr - dy) + Math.abs(pitchErr - dp);
  }

  private shoot(combat: Combat, aim: THREE.Vector3, spread: number) {
    this.side = -this.side;
    const from = this.barrel.localToWorld(new THREE.Vector3(TWIN * this.side, 0, TIP));
    const dir = aim.clone().sub(from).normalize();
    if (spread) {
      dir.x += (Math.random() - 0.5) * 2 * spread; dir.y += (Math.random() - 0.5) * 2 * spread; dir.z += (Math.random() - 0.5) * 2 * spread;
      dir.normalize();
    }
    // hot, it loses half its power
    const damage = DAMAGE.avatar * (this.laser.heat > TURRET.weak ? 0.5 : 1);
    combat.fire({ kind: 'laser', team: this.team, heavy: true, from, dir, inherit: this.shipVel.clone(), damage, intercept: true, source: this });
    this.laser.fired();
  }

  /** where to aim so a bolt (with the ship's speed in it) meets the target */
  private leadPoint(from: THREE.Vector3): THREE.Vector3 {
    const speed = shotSpeed('laser');
    let pos: THREE.Vector3, vel: THREE.Vector3;
    if (this.missile) { pos = this.tp.copy(this.missile.pos); vel = this.tv.copy(this.missile.vel); }
    else { const u = this.unit!; pos = u.centre(this.tp); vel = u.velocity ? u.velocity(this.tv) : this.tv.set(0, 0, 0); }
    vel.sub(this.shipVel);
    let time = pos.distanceTo(from) / speed;
    for (let i = 0; i < 3; i++) time = this.lead.copy(pos).addScaledVector(vel, time).distanceTo(from) / speed;
    return this.lead.copy(pos).addScaledVector(vel, time);
  }

  /** the nearest missile coming closer, or else the nearest aircraft (or, farther down the list, vehicle) in reach */
  private pick(combat: Combat, from: THREE.Vector3) {
    const before = this.missile ?? this.unit, ship = this.ship.pos;
    this.missile = null; this.unit = null;
    let bd = Infinity;
    for (const m of combat.incoming(this.team, ship, TURRET.missileRange)) {
      const to = this.tp.subVectors(ship, m.pos);
      if (m.vel.dot(to) <= 0) continue;
      const d = to.length();
      if (d < bd && combat.clear(from, m.pos)) { bd = d; this.missile = m; }
    }
    if (!this.missile) {
      bd = Infinity;
      for (const t of combat.targets) {
        if (!t.alive || t.dummy || t.shield || t.kind !== 'einheit' || t.team === this.team || t.team === 'neutral' || this.ships.includes(t)) continue;
        const c = t.centre(this.tp);
        const d = c.distanceTo(ship);
        if (d > TURRET.unitRange) continue;
        // aboard the other ship (on its deck, in its hangar) it is out of the fight
        if (c.y < 30 && this.ships.some(s => s.team !== this.team && Math.hypot(s.centre(this.tv).x - c.x, this.tv.z - c.z) < 110)) continue;
        const score = c.y > 25 ? d : d * 1.5;
        if (score < bd && combat.clear(from, c)) { bd = score; this.unit = t; }
      }
    }
    if (!this.missile && !this.unit) {
      for (const s of this.ships) {
        if (!s.alive || s.team === this.team) continue;
        const c = s.centre(this.tp);
        if (c.distanceTo(ship) < TURRET.unitRange && combat.clear(from, c)) this.unit = s;
      }
    }
    if ((this.missile ?? this.unit) !== before) { this.onFor = 0; this.burstLeft = TURRET.burst; }
  }
}
