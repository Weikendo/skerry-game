import * as THREE from 'three';
import { LowPolyBuilder, lowPolyMaterial } from '../engine/lowpoly';
import { PAL } from '../engine/palette';
import type { Effects } from '../world/effects';
import type { Ground } from '../world/terrain';
import { additiveMaterial, fogFade, spindle } from '../world/fxShapes';
import { DAMAGE, HAMMERHEAD, HARBINGER, QUAKER } from './arsenal';

export type Team = 'spieler' | 'feind' | 'neutral';
export type WeaponKind = 'laser' | 'kanone' | 'rakete' | 'harbinger' | 'quaker' | 'virus' | 'hammerhead';
const UP_AXIS = new THREE.Vector3(0, 1, 0);
/** the missiles (they leave a trail, burst at the end, and a turret's bolt can strike them) */
const MISSILES: WeaponKind[] = ['rakete', 'harbinger', 'hammerhead'];

/** a Hammerhead's guidance: the point it flies at, the target its drone keeps it on, and that drone */
export interface SeaGuide {
  readonly point: THREE.Vector3;
  target: Target | null;
  /** the observation drone that guides it (dead or null: it flies on blind to `point`) */
  eye: { readonly alive: boolean; readonly pos: THREE.Vector3 } | null;
  /** seconds since it left the stern */
  age: number;
}

/** a wire-guided missile in flight: the shooter turns `steer` (rad/s), `done` once it is gone */
export interface Guided {
  readonly pos: THREE.Vector3;
  readonly dir: THREE.Vector3;
  travelled: number;
  done: boolean;
  steer: { yaw: number; pitch: number };
}

/** anything that can be shot */
export interface Target {
  readonly name: string;
  readonly team: Team;
  readonly kind: 'gebaeude' | 'einheit';
  readonly alive: boolean;
  hp: number;
  readonly maxHp: number;
  /** world-space hit spheres: x, y, z, r */
  spheres(): [number, number, number, number][];
  centre(out: THREE.Vector3): THREE.Vector3;
  velocity?(out: THREE.Vector3): THREE.Vector3;
  /** apply damage; return true if this hit destroyed the target */
  hit(damage: number, at: THREE.Vector3): boolean;
  /** a dummy of the combat training: hit only by hand, nothing aims at it by itself */
  readonly dummy?: boolean;
}

interface Projectile {
  kind: WeaponKind; team: Team;
  pos: THREE.Vector3; vel: THREE.Vector3;
  life: number; damage: number;
  target?: Target; smokeAcc: number;
  /** metres flown, so a bolt's streak never reaches back past the muzzle */
  flown: number;
  /** the Otter's heavy Avatar (a bigger bolt) */
  heavy?: boolean;
  guided?: Guided;
  /** Quaker: ground contacts left */
  bounces?: number;
  /** who fired it (for the hit marker) */
  source?: object;
  /** a carrier's laser turret: its bolts also strike the other side's missiles */
  intercept?: boolean;
  /** a missile: the decoy it follows instead of its target, and the decoys it has already looked at */
  lure?: Decoy;
  judged?: Set<Decoy>;
  /** a Hammerhead's guidance */
  sea?: SeaGuide;
}

/** a decoy flare: thrown up from a carrier, then under its parachute it sinks and drifts with the wind while it burns */
export interface Decoy {
  readonly team: Team;
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  /** seconds of burning left */
  life: number;
  /** seconds since it was thrown */
  age: number;
  smokeAcc: number;
}
/**
 * How decoys work: they burn this long (s), open their chute after this (s) and then sink at this rate (m/s) with
 * this share of the wind. An Assassin (a heat seeker; the wire-guided Harbinger is not fooled) looks at every
 * burning decoy of the other side that comes within `seen` m ahead of it, inside `cone` of its course and nearer
 * than its target (one beyond the ship would lead it into the hull), once: with `lure` it follows that one from then
 * on and bursts on it.
 */
export const DECOY = { life: 9, chute: 1.2, sink: 2.5, drift: 0.8, seen: 700, cone: Math.cos(THREE.MathUtils.degToRad(45)), lure: 0.4 };

/** a missile in the air, as a laser turret sees it (read only) */
export interface Incoming {
  readonly kind: WeaponKind;
  readonly team: Team;
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  readonly target?: Target;
  /** the decoy it follows (then it is no longer coming at its target) */
  readonly lure?: Decoy;
}

export interface FireOrder {
  kind: WeaponKind; team: Team;
  /** heavy variant (the Walrus' Avatar laser), for the sound */
  heavy?: boolean;
  from: THREE.Vector3; dir: THREE.Vector3;
  /** velocity of the shooter, added to the projectile */
  inherit?: THREE.Vector3;
  target?: Target;
  /** instead of the kind's damage (the Manta's Quasar is weaker than the Avatar) */
  damage?: number;
  /** who fires (the unit), told back with its hits */
  source?: object;
  /** a laser turret's bolt: it also strikes the other side's missiles */
  intercept?: boolean;
  /** a Hammerhead: how it is guided */
  sea?: SeaGuide;
}

// damage in the original's units (vehicles and most buildings have 4000 hit points)
const SPEC: Record<WeaponKind, { speed: number; damage: number; life: number; color: string; glow: number }> = {
  laser: { speed: 650, damage: DAMAGE.avatar, life: 2.4, color: PAL.lichtBlau, glow: 5 },
  kanone: { speed: 380, damage: DAMAGE.turretShell, life: 3.2, color: PAL.lava, glow: 4 },
  rakete: { speed: 240, damage: DAMAGE.assassin, life: 9, color: PAL.lavaHell, glow: 6 },
  harbinger: { speed: HARBINGER.speed, damage: DAMAGE.harbinger, life: HARBINGER.range / HARBINGER.speed, color: PAL.lavaHell, glow: 7 },
  quaker: { speed: 0, damage: DAMAGE.quaker, life: 40, color: PAL.signalGelb, glow: 3 },
  virus: { speed: 110, damage: 0, life: 3.5, color: PAL.lichtGruen, glow: 6 },
  hammerhead: { speed: HAMMERHEAD.launch, damage: DAMAGE.hammerhead, life: HAMMERHEAD.life, color: PAL.lavaHell, glow: 8 },
};
const MAX = 256;
/**
 * How a bolt looks: a bright core and a glow round it that trails off behind (radius, length in m). Lasers glow
 * in their side's colour (blue for the player, red for the enemy), shells orange, the virus green.
 */
const BOLT: Record<'avatar' | 'quasar' | 'kanone' | 'virus', { core: [number, number]; glow: [number, number] }> = {
  avatar: { core: [0.22, 9], glow: [0.95, 16] },
  quasar: { core: [0.16, 6], glow: [0.7, 11] },
  kanone: { core: [0.26, 3.5], glow: [0.8, 11] },
  virus: { core: [0.3, 3], glow: [1.2, 6] },
};
/** seconds between two puffs of a missile's smoke trail */
const TRAIL_EVERY = 0.006;
/** a Harbinger's trail (a thin one, it is a small missile) begins this far from the launcher (m), out of the way of
 *  the Otter's driver */
const HARBINGER_TRAIL = { from: 40, scale: 0.45 };
/** a turret's bolt destroys a missile it passes this close to (m) */
const INTERCEPT = 2;
const TEAM_LASER: Record<Team, string> = { spieler: PAL.lichtBlau, feind: PAL.lichtRot, neutral: PAL.lichtWeiss };
const WHITE = new THREE.Color(PAL.lichtWeiss);

export interface KillEvent { target: Target; by: Team }
/** a shot struck: what, where, which way it flew, who fired it, and whether it destroyed the target */
export interface HitEvent { target: Target; team: Team; kind: WeaponKind; at: THREE.Vector3; dir: THREE.Vector3; source?: object; killed: boolean }

/** how fast a weapon's shot flies (m/s), for the lead marker */
export function shotSpeed(kind: WeaponKind): number { return SPEC[kind].speed; }
/** how far a shot flies before it is spent (m) */
export function shotReach(kind: WeaponKind): number { return SPEC[kind].speed * SPEC[kind].life; }

export class Combat {
  readonly targets: Target[] = [];
  readonly group = new THREE.Group();
  /** called when a target is destroyed */
  onKill: ((e: KillEvent) => void) | null = null;
  /** called for every shot fired (sound) */
  onFire: ((o: FireOrder) => void) | null = null;
  /** called for every shot that strikes a target (hit marker, where the fire comes from) */
  onHit: ((e: HitEvent) => void) | null = null;
  /** the enemy's weapons hit this much harder or softer (the difficulty) */
  foeDamage = 1;
  /** the camera and fog the glows fade by with distance (set by the game) */
  viewer: { camera: THREE.Camera; fog: THREE.Fog | null } | null = null;
  /** decoys in the air */
  readonly decoys: Decoy[] = [];
  /** the wind the decoys drift with (m/s, set by the game) */
  readonly wind = new THREE.Vector3();
  /** a carrier threw a decoy (sound) */
  onDecoy: ((at: THREE.Vector3, team: Team) => void) | null = null;
  /** a missile has taken a decoy of `team` for its target */
  onLure: ((team: Team, target?: Target) => void) | null = null;
  /** a laser turret's bolt struck a missile out of the air: where, whose turret, whose missile it was aimed at */
  onIntercept: ((at: THREE.Vector3, team: Team, target?: Target) => void) | null = null;
  /** a virus bomb reached a building; `from` is the direction it came from */
  onVirus: ((target: Target, from: THREE.Vector3, team: Team) => void) | null = null;
  private shots: Projectile[] = [];
  private boltCore: THREE.InstancedMesh;
  private boltGlow: THREE.InstancedMesh;
  private missiles: THREE.InstancedMesh;
  private flames: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private z = new THREE.Vector3(0, 0, 1);
  private tmp = new THREE.Vector3();
  private view = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(private ground: Ground, private effects: Effects, private waterLevel: (x: number, z: number) => number) {
    // bolts: a white-hot core and a coloured glow trailing off behind, both drawn additively (the glow rounder: from
    // behind, through the laser turret's zoom, it is a disc)
    this.boltCore = new THREE.InstancedMesh(spindle(6, 0.08, 0.5), additiveMaterial(), MAX);
    this.boltGlow = new THREE.InstancedMesh(spindle(10, 0.04, 0), additiveMaterial(), MAX);
    // a missile's exhaust flame: a cone of fire behind it
    this.flames = new THREE.InstancedMesh(spindle(5, 0.02, 0).scale(1, 1, 1), additiveMaterial(), 32);
    for (const im of [this.boltCore, this.boltGlow, this.flames]) { im.setColorAt(0, new THREE.Color()); im.renderOrder = 12; }
    const mb = new LowPolyBuilder();
    mb.pushTRS([0, 0, 0], 0, [1, 1, 1], Math.PI / 2);
    mb.cylinder([0, -1.4, 0], 0.22, 0.22, 2.4, 6, PAL.weiss, PAL.weiss);
    mb.cone([0, 1.0, 0], 0.22, 0.6, 6, PAL.signalRot);
    mb.pop();
    this.missiles = new THREE.InstancedMesh(mb.build(), lowPolyMaterial(), 32);
    for (const im of [this.boltCore, this.boltGlow, this.missiles, this.flames]) { im.count = 0; im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
    this.group.add(this.boltGlow, this.boltCore, this.missiles, this.flames);
    this.group.name = 'combat';
  }

  add(t: Target) {
    this.targets.push(t);
  }

  remove(t: Target) {
    const i = this.targets.indexOf(t);
    if (i >= 0) this.targets.splice(i, 1);
  }

  /** missiles in the air homing on `t` (not those a decoy has lured away) */
  missilesAt(t: Target): number {
    return this.shots.filter(s => (s.kind === 'rakete' || s.kind === 'hammerhead') && s.target === t && !s.lure).length;
  }

  get missileCount(): number {
    return this.shots.filter(s => s.kind === 'rakete').length;
  }

  /** the other sides' missiles (Assassins, Harbingers) within `range` of `at` */
  incoming(team: Team, at: THREE.Vector3, range: number): Incoming[] {
    return this.shots.filter(s => MISSILES.includes(s.kind) && s.team !== team && s.pos.distanceTo(at) < range);
  }

  /** the nearest missile of a kind within `range` of a point, of either side (for its sound) */
  nearestMissile(at: THREE.Vector3, range: number, kind: WeaponKind): Incoming | null {
    let best: Incoming | null = null, bd = range;
    for (const s of this.shots) {
      if (s.kind !== kind) continue;
      const d = s.pos.distanceTo(at);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /** the missile is still in the air */
  inFlight(m: Incoming): boolean {
    return this.shots.includes(m as Projectile);
  }

  /** no hill between the two points (sampled every 20 m) */
  clear(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const n = Math.ceil(from.distanceTo(to) / 20);
    for (let i = 1; i < n; i++) {
      this.tmp.lerpVectors(from, to, i / n);
      if (this.tmp.y < this.ground.heightAt(this.tmp.x, this.tmp.z)) return false;
    }
    return true;
  }

  /** returns the handle of a guided missile (Harbinger) */
  fire(o: FireOrder): Guided | undefined {
    if (this.shots.length >= MAX) return;
    const sp = SPEC[o.kind];
    const vel = o.dir.clone().normalize().multiplyScalar(sp.speed);
    if (o.inherit) vel.add(o.inherit);
    const damage = (o.damage ?? sp.damage) * (o.team === 'feind' ? this.foeDamage : 1);
    const p: Projectile = { kind: o.kind, team: o.team, pos: o.from.clone(), vel, life: sp.life, damage, target: o.target, smokeAcc: 0, source: o.source, flown: 0, heavy: o.heavy, intercept: o.intercept };
    if (o.kind === 'harbinger') p.guided = { pos: p.pos, dir: o.dir.clone().normalize(), travelled: 0, done: false, steer: { yaw: 0, pitch: 0 } };
    if (o.kind === 'quaker') p.bounces = QUAKER.bounces;
    if (o.sea) p.sea = o.sea;
    this.shots.push(p);
    this.effects.flash(o.from, new THREE.Color(sp.color).multiplyScalar(2), Math.min(sp.glow * 1.6, this.onScreen(o.from, 0.25)), 0.08);
    // a star of flame at the muzzle (missiles leave their rails without one)
    if (o.kind === 'laser' || o.kind === 'kanone') {
      const c = new THREE.Color(o.kind === 'laser' ? TEAM_LASER[o.team] : PAL.lavaHell).multiplyScalar(1.6);
      this.effects.muzzle(o.from, o.dir, c, o.kind === 'kanone' ? 4.5 : o.heavy ? 4 : 2.8);
    }
    this.onFire?.(o);
    return p.guided;
  }

  /** a decoy of `team` thrown from `from` with `vel` */
  launchDecoy(team: Team, from: THREE.Vector3, vel: THREE.Vector3) {
    this.decoys.push({ team, pos: from.clone(), vel: vel.clone(), life: DECOY.life, age: 0, smokeAcc: 0 });
    this.effects.flash(from, new THREE.Color(PAL.lichtWeiss).multiplyScalar(2), Math.min(6, this.onScreen(from, 0.25)), 0.1);
    this.onDecoy?.(from, team);
  }

  /** everything of another team within `radius` takes `damage` (Quaker) */
  areaDamage(at: THREE.Vector3, radius: number, damage: number, team: Team) {
    for (const t of [...this.targets]) {
      if (!t.alive || t.team === team) continue;
      const near = t.spheres().some(([x, y, z, r]) => Math.hypot(x - at.x, y - at.y, z - at.z) < radius + r);
      if (near && t.hit(damage, at)) this.onKill?.({ target: t, by: team });
    }
  }

  /** the enemy target closest to the centre of a view cone */
  findTarget(from: THREE.Vector3, dir: THREE.Vector3, team: Team, maxDist: number, coneDeg: number): Target | null {
    const cos = Math.cos(THREE.MathUtils.degToRad(coneDeg));
    let best: Target | null = null, bestScore = -Infinity;
    const d = dir.clone().normalize();
    for (const t of this.targets) {
      if (!t.alive || t.team === team || t.team === 'neutral') continue;
      const to = t.centre(this.tmp).sub(from);
      const dist = to.length();
      if (dist > maxDist || dist < 1) continue;
      const c = to.dot(d) / dist;
      if (c < cos) continue;
      const score = c * 2 - dist / maxDist;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  /** nearest live enemy unit/building of `team` within range */
  nearestEnemy(from: THREE.Vector3, team: Team, range: number, kind?: Target['kind']): Target | null {
    let best: Target | null = null, bd = range;
    for (const t of this.targets) {
      if (!t.alive || t.dummy || t.team === team || t.team === 'neutral' || (kind && t.kind !== kind)) continue;
      const dd = t.centre(this.tmp).distanceTo(from);
      if (dd < bd) { bd = dd; best = t; }
    }
    return best;
  }

  /** first thing a ray hits (targets or ground), for aiming; returns the point */
  raycast(from: THREE.Vector3, dir: THREE.Vector3, maxDist: number, ignore?: Target): { point: THREE.Vector3; target: Target | null } {
    const d = dir.clone().normalize();
    let tHit = maxDist, hitT: Target | null = null;
    for (const t of this.targets) {
      if (!t.alive || t === ignore) continue;
      for (const [x, y, z, r] of t.spheres()) {
        const tt = raySphere(from, d, x, y, z, r);
        if (tt !== null && tt < tHit) { tHit = tt; hitT = t; }
      }
    }
    // ground march (coarse, then refine)
    const step = 12;
    for (let s = step; s < tHit; s += step) {
      const p = from.clone().addScaledVector(d, s);
      if (p.y < Math.max(this.ground.heightAt(p.x, p.z), 0)) {
        let a = s - step, b = s;
        for (let k = 0; k < 6; k++) {
          const m = (a + b) / 2, q = from.clone().addScaledVector(d, m);
          if (q.y < Math.max(this.ground.heightAt(q.x, q.z), 0)) b = m; else a = m;
        }
        return { point: from.clone().addScaledVector(d, b), target: null };
      }
    }
    return { point: from.clone().addScaledVector(d, tHit), target: hitT };
  }

  update(dt: number) {
    this.updateDecoys(dt);
    const keep: Projectile[] = [];
    const prev = new THREE.Vector3();
    for (const s of this.shots) {
      s.life -= dt;
      if (s.kind === 'rakete') { this.lookForDecoys(s); this.steerMissile(s, dt); }
      if (s.sea) this.steerSea(s, dt);
      if (s.guided) this.steerGuided(s, dt);
      if (s.kind === 'quaker') s.vel.y -= 9.81 * dt;
      prev.copy(s.pos);
      s.pos.addScaledVector(s.vel, dt);
      s.flown += s.vel.length() * dt;
      if (this.collide(s, prev)) continue;
      // a missile that followed a decoy bursts on it, harmlessly
      if (s.lure && s.lure.life > 0 && s.pos.distanceToSquared(s.lure.pos) < 64) { this.effects.explosion(s.pos, 0.6); continue; }
      if (s.life <= 0) {
        if (MISSILES.includes(s.kind)) this.effects.explosion(s.pos, s.kind === 'hammerhead' ? 1 : 0.6);
        if (s.guided) s.guided.done = true;
        continue;
      }
      keep.push(s);
      this.effects.halo(s.pos, new THREE.Color(SPEC[s.kind].color).multiplyScalar(1.6), Math.min(SPEC[s.kind].glow, this.onScreen(s.pos, 0.16)));
      // (a Harbinger leaves the Otter's rear deck behind the driver: its trail begins clear of the vehicle)
      if (MISSILES.includes(s.kind) && (s.kind !== 'harbinger' || s.flown > HARBINGER_TRAIL.from)) {
        // an unbroken trail: a puff every 2–3 m, spread along the way flown this step
        s.smokeAcc += dt;
        const n = Math.floor(s.smokeAcc / TRAIL_EVERY);
        for (let i = 1; i <= n; i++) this.effects.trail(this.tmp.lerpVectors(prev, s.pos, i / n), s.kind === 'harbinger' ? HARBINGER_TRAIL.scale : 1);
        s.smokeAcc -= n * TRAIL_EVERY;
      }
    }
    this.shots = keep;
    this.interceptMissiles(dt);
    this.draw();
  }

  /** turret bolts against the other side's missiles: how close the two came over the last step */
  private interceptMissiles(dt: number) {
    const missiles = this.shots.filter(s => MISSILES.includes(s.kind));
    if (!missiles.length) return;
    const gone = new Set<Projectile>();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), ab = new THREE.Vector3();
    for (const s of this.shots) {
      if (!s.intercept) continue;
      for (const m of missiles) {
        if (m.team === s.team || gone.has(m)) continue;
        // the bolt seen from the missile: where it was a step ago, where it is now
        a.copy(s.pos).addScaledVector(s.vel, -dt).sub(m.pos).addScaledVector(m.vel, dt);
        b.copy(s.pos).sub(m.pos);
        ab.subVectors(b, a);
        const k = THREE.MathUtils.clamp(-a.dot(ab) / Math.max(ab.lengthSq(), 1e-6), 0, 1);
        if (a.addScaledVector(ab, k).length() > INTERCEPT) continue;
        gone.add(s); gone.add(m);
        this.effects.explosion(m.pos, 0.55);
        if (m.guided) m.guided.done = true;
        this.onIntercept?.(m.pos.clone(), s.team, m.target);
        break;
      }
    }
    if (gone.size) this.shots = this.shots.filter(s => !gone.has(s));
  }

  /** an Assassin looks once at every burning decoy of the other side ahead of it, and may take it for its target */
  private lookForDecoys(s: Projectile) {
    if (s.lure || !s.target || !this.decoys.length) return;
    const ahead = this.view.copy(s.vel).normalize(), toTarget = s.target.centre(this.tmp).distanceTo(s.pos);
    for (const d of this.decoys) {
      if (d.team === s.team || d.life <= 0 || s.judged?.has(d)) continue;
      const to = this.tmp.subVectors(d.pos, s.pos), dist = to.length();
      if (dist > DECOY.seen || dist > toTarget || to.dot(ahead) < DECOY.cone * dist) continue;
      (s.judged ??= new Set()).add(d);
      if (Math.random() < DECOY.lure) { s.lure = d; this.onLure?.(d.team, s.target); return; }
    }
  }

  /** decoys fly up, open their chutes, sink and drift with the wind, and burn: a white-hot glow and a trail of smoke */
  private updateDecoys(dt: number) {
    if (!this.decoys.length) return;
    const glow = new THREE.Color(PAL.lichtWeiss).multiplyScalar(2.2);
    for (const d of this.decoys) {
      d.age += dt; d.life -= dt;
      if (d.age < DECOY.chute) d.vel.y -= 9.81 * dt;
      else {
        const k = 1 - Math.exp(-2 * dt);
        d.vel.x += (this.wind.x * DECOY.drift - d.vel.x) * k;
        d.vel.z += (this.wind.z * DECOY.drift - d.vel.z) * k;
        d.vel.y += (-DECOY.sink - d.vel.y) * k;
      }
      d.pos.addScaledVector(d.vel, dt);
      // into the sea it goes out
      if (d.pos.y < this.waterLevel(d.pos.x, d.pos.z)) d.life = 0;
      if (d.life <= 0) continue;
      // it flickers as it burns, and fades in its last second
      const flick = (0.75 + 0.25 * Math.sin(d.age * 37 + d.pos.x)) * Math.min(1, d.life);
      this.effects.halo(d.pos, glow.clone().multiplyScalar(flick), Math.min(9, this.onScreen(d.pos, 0.16)));
      d.smokeAcc += dt;
      if (d.smokeAcc > 0.05) { d.smokeAcc = 0; this.effects.trail(d.pos); }
    }
    for (let i = this.decoys.length - 1; i >= 0; i--) if (this.decoys[i].life <= 0) this.decoys.splice(i, 1);
  }

  /**
   * A Hammerhead: out of the stern backwards, then round towards its point and low over the sea (over land a little
   * above the ground ahead), down onto the point in the last stretch. While its drone lives and sees the target it
   * keeps the point on the target; without the drone it flies on to where the target was.
   */
  private steerSea(s: Projectile, dt: number) {
    const g = s.sea!;
    g.age += dt;
    if (g.age < HAMMERHEAD.coast) { s.vel.y -= 6 * dt; return; }
    if (g.target?.alive && g.eye?.alive && g.eye.pos.distanceTo(g.target.centre(this.tmp)) < HAMMERHEAD.reach) g.point.copy(this.tmp);
    const to = this.view.subVectors(g.point, s.pos), horiz = Math.hypot(to.x, to.z);
    let wantY = g.point.y;
    if (horiz > HAMMERHEAD.dive) {
      const ahead = (k: number) => this.ground.heightAt(s.pos.x + s.vel.x * k, s.pos.z + s.vel.z * k);
      wantY = Math.max(HAMMERHEAD.cruise, Math.max(ahead(0), ahead(1), ahead(2)) + HAMMERHEAD.overLand);
    }
    const want = this.tmp.set(to.x, 0, to.z).normalize();
    // weaving from side to side on its way in, less and less as it dives
    const weave = HAMMERHEAD.weave * Math.sin(g.age * HAMMERHEAD.beat) * THREE.MathUtils.clamp((horiz - 150) / (HAMMERHEAD.dive - 150), 0, 1);
    want.applyAxisAngle(UP_AXIS, weave);
    want.y = THREE.MathUtils.clamp((wantY - s.pos.y) / Math.max(60, Math.min(horiz, 400)), -0.7, 0.7);
    want.normalize();
    // turn round towards it (quicker while still slow) about the axis between the two, speeding up to its cruise
    const speed = s.vel.length(), cur = this.tmp2.copy(s.vel).normalize(), angle = cur.angleTo(want);
    const turn = Math.min(angle, HAMMERHEAD.turn * dt * (speed < 150 ? 1.6 : 1));
    if (turn > 1e-5) {
      const axis = this.view.crossVectors(cur, want);
      if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0);
      cur.applyAxisAngle(axis.normalize(), turn);
    }
    s.vel.copy(cur).multiplyScalar(Math.min(speed + 70 * dt, HAMMERHEAD.speed));
  }

  /** the player turns the Harbinger; it keeps its speed and runs out of wire after HARBINGER.range */
  private steerGuided(s: Projectile, dt: number) {
    const g = s.guided!;
    const d = g.dir, up = new THREE.Vector3(0, 1, 0);
    d.applyAxisAngle(up, g.steer.yaw * HARBINGER.turn * dt);
    const side = new THREE.Vector3().crossVectors(d, up).normalize();
    if (side.lengthSq() > 0.5) d.applyAxisAngle(side, g.steer.pitch * HARBINGER.turn * dt);
    d.normalize();
    s.vel.copy(d).multiplyScalar(HARBINGER.speed);
    g.travelled += HARBINGER.speed * dt;
  }

  private steerMissile(s: Projectile, dt: number) {
    // on a decoy it follows that; once the decoy has burnt out it flies on straight until its fuel is gone
    if (s.lure) { if (s.lure.life <= 0) return; this.tmp.copy(s.lure.pos); }
    else if (!s.target || !s.target.alive) return;
    else s.target.centre(this.tmp);
    const want = this.tmp.sub(s.pos).normalize();
    const speed = s.vel.length();
    const cur = s.vel.clone().normalize();
    const angle = cur.angleTo(want);
    const maxTurn = 2.2 * dt;
    if (angle > 1e-4) cur.lerp(want, Math.min(1, maxTurn / angle)).normalize();
    s.vel.copy(cur).multiplyScalar(Math.min(speed + 60 * dt, 320));
  }

  /** segment prev→pos against targets, ground and sea; true = projectile consumed */
  private collide(s: Projectile, prev: THREE.Vector3): boolean {
    const seg = s.pos.clone().sub(prev);
    const len = seg.length();
    if (len < 1e-6) return false;
    const d = seg.divideScalar(len);
    let best = Infinity, hitT: Target | null = null;
    const proximity = s.kind === 'rakete' ? 6 : s.kind === 'hammerhead' ? 8 : 0;
    for (const t of this.targets) {
      if (!t.alive || t.team === s.team) continue;
      for (const [x, y, z, r] of t.spheres()) {
        const tt = raySphere(prev, d, x, y, z, r + proximity);
        if (tt !== null && tt <= len && tt < best) { best = tt; hitT = t; }
      }
    }
    if (hitT) {
      const at = prev.clone().addScaledVector(d, best);
      if (s.kind === 'virus') {
        this.effects.flash(at, new THREE.Color(SPEC.virus.color).multiplyScalar(2), 14, 0.5);
        this.onVirus?.(hitT, d.clone().negate(), s.team);
        return true;
      }
      if (s.kind === 'quaker') { this.burst(s, at); return true; }
      const killed = hitT.hit(s.damage, at);
      // (a Hammerhead's is a big one, with the long roll of thunder after it)
      if (s.kind === 'hammerhead') this.effects.hammerBlast(at);
      else if (MISSILES.includes(s.kind)) this.effects.explosion(at, s.kind === 'harbinger' ? 1.3 : 0.8); else this.effects.impact(at, 'hit', d, s.heavy ? 1.3 : 1);
      this.onHit?.({ target: hitT, team: s.team, kind: s.kind, at, dir: d.clone(), source: s.source, killed });
      if (killed) this.onKill?.({ target: hitT, by: s.team });
      if (s.guided) s.guided.done = true;
      return true;
    }
    const gh = this.ground.heightAt(s.pos.x, s.pos.z);
    if (s.pos.y < gh) {
      if (s.kind === 'quaker') {
        // the cluster bomb bursts and jumps on; the last contact ends it
        this.burst(s, s.pos.clone().setY(gh));
        if (--s.bounces! <= 0) return true;
        s.pos.y = gh + 0.5;
        s.vel.y = Math.abs(s.vel.y) * 0.55 + 6;
        s.vel.x *= 0.7; s.vel.z *= 0.7;
        return false;
      }
      if (s.kind === 'hammerhead') { this.effects.hammerBlast(s.pos); this.effects.scorch(s.pos, 8); }
      else if (MISSILES.includes(s.kind)) { this.effects.explosion(s.pos, 0.6); this.effects.scorch(s.pos, 4.5); }
      else this.effects.impact(s.pos, 'land', d, s.heavy ? 1.3 : 1);
      if (s.guided) s.guided.done = true;
      return true;
    }
    if (gh < 0 && s.pos.y < this.waterLevel(s.pos.x, s.pos.z)) {
      // a Quaker sinks without going off
      this.effects.impact(s.pos.setY(this.waterLevel(s.pos.x, s.pos.z)), 'water');
      if (s.guided) s.guided.done = true;
      return true;
    }
    return false;
  }

  private burst(s: Projectile, at: THREE.Vector3) {
    this.effects.explosion(at, 1.1);
    this.areaDamage(at, QUAKER.radius, s.damage, s.team);
  }

  /**
   * A size (m) that is `share` of the picture's half height at `p`: a shot close to the camera, above all through
   * the laser turret's zoom, is no bigger on the screen than this
   */
  private onScreen(p: THREE.Vector3, share: number): number {
    const cam = this.viewer?.camera;
    if (!(cam instanceof THREE.PerspectiveCamera)) return Infinity;
    return share * p.distanceTo(cam.position) * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
  }

  private draw() {
    let nb = 0, nm = 0, nf = 0;
    const col = new THREE.Color(), v = this.viewer;
    for (const s of this.shots) {
      this.q.setFromUnitVectors(this.z, this.tmp.copy(s.vel).normalize());
      const fade = v ? fogFade(s.pos, v.camera, v.fog) : 1;
      if (MISSILES.includes(s.kind) || s.kind === 'quaker') {
        if (nm >= 32) continue;
        const k = s.kind === 'hammerhead' ? 2.2 : s.kind === 'harbinger' ? 1.6 : s.kind === 'quaker' ? 1.3 : 1;
        this.m.compose(s.pos, this.q, new THREE.Vector3(k, k, k));
        this.missiles.setMatrixAt(nm++, this.m);
        if (s.kind !== 'quaker') {
          // the flame behind it, flickering (the missile's tail is 2.6 m behind its centre)
          const tail = this.tmp.copy(s.vel).normalize().multiplyScalar(-2.6 * k).add(s.pos);
          const len = (2.6 + Math.random() * 1.4) * k;
          this.m.compose(tail, this.q, new THREE.Vector3(0.38 * k, 0.38 * k, len));
          this.flames.setMatrixAt(nf, this.m);
          this.flames.setColorAt(nf++, col.set(PAL.lavaHell).multiplyScalar(1.8 * fade));
        }
        continue;
      }
      // a bolt: its streak no longer than it has flown, so it never reaches back past the muzzle; seen straight from
      // behind (or ahead) its glow narrows to a point instead of a disc filling a zoomed picture
      const b = BOLT[s.kind === 'laser' ? (s.heavy ? 'avatar' : 'quasar') : s.kind === 'kanone' ? 'kanone' : 'virus'];
      const hue = col.set(s.kind === 'laser' ? TEAM_LASER[s.team] : SPEC[s.kind].color);
      const along = v ? Math.abs(this.view.copy(s.pos).sub(v.camera.position).normalize().dot(this.tmp)) : 0;
      const r = Math.min(b.glow[0] * (1 - 0.7 * THREE.MathUtils.smoothstep(along, 0.97, 0.998)), this.onScreen(s.pos, 0.02));
      this.m.compose(s.pos, this.q, new THREE.Vector3(r, r, Math.max(0.5, Math.min(b.glow[1], s.flown))));
      this.boltGlow.setMatrixAt(nb, this.m);
      this.boltGlow.setColorAt(nb, hue.clone().multiplyScalar(0.9 * fade));
      const rc = Math.min(b.core[0], this.onScreen(s.pos, 0.008));
      this.m.compose(s.pos, this.q, new THREE.Vector3(rc, rc, Math.max(0.3, Math.min(b.core[1], s.flown))));
      this.boltCore.setMatrixAt(nb, this.m);
      this.boltCore.setColorAt(nb++, hue.lerp(WHITE, 0.65).multiplyScalar(1.5 * fade));
    }
    this.boltCore.count = this.boltGlow.count = nb; this.missiles.count = nm; this.flames.count = nf;
    for (const im of [this.boltCore, this.boltGlow, this.missiles, this.flames]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
}

/** distance along a unit ray to a sphere, or null */
export function raySphere(o: THREE.Vector3, d: THREE.Vector3, cx: number, cy: number, cz: number, r: number): number | null {
  const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  if (c < 0) return 0; // starts inside
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}
