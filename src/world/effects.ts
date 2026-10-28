import * as THREE from 'three';
import { glowMaterial, updateGlowUniforms } from '../engine/glow';
import { mulberry32 } from '../engine/lowpoly';
import { PAL } from '../engine/palette';
import type { Ground } from './terrain';
import { additiveMaterial, fogFade, spindle, star } from './fxShapes';

interface Flash { x: number; y: number; z: number; r: number; g: number; b: number; size: number; t: number; life: number }
interface Particle {
  pos: THREE.Vector3; vel: THREE.Vector3; rot: THREE.Vector3; spin: THREE.Vector3;
  size: number; t: number; life: number; color: THREE.Color; kind: 'debris' | 'smoke' | 'spray';
  /** how much a smoke puff swells over its life (1.4: a column of smoke; a missile's trail stays slimmer) */
  grow?: number;
  /** the colour a smoke puff pales to (dark smoke greys to ash, light smoke whitens) */
  fade?: THREE.Color;
  /** a burning piece of debris trails smoke for this many seconds more */
  trail?: number;
}
interface Emitter { pos: THREE.Vector3; t: number; life: number; every: number; acc: number; size: number }
/** a glowing spark streak, a muzzle flash, a scorch mark on the ground */
interface Spark { pos: THREE.Vector3; vel: THREE.Vector3; t: number; life: number; color: THREE.Color }
interface Muzzle { pos: THREE.Vector3; q: THREE.Quaternion; size: number; t: number; life: number; color: THREE.Color }
interface Scorch { m: THREE.Matrix4; t: number; r: number }
/** a ball of fire that swells, burns down from white-hot to red and turns into smoke; a blast ring running out */
interface Fire { pos: THREE.Vector3; vel: THREE.Vector3; t: number; life: number; size: number; rot: THREE.Euler }
interface Ring { pos: THREE.Vector3; t: number; life: number; radius: number; color: THREE.Color }

const MAX_GLOW = 512, MAX_DEBRIS = 500, MAX_SMOKE = 1200, MAX_SPARKS = 320, MAX_MUZZLES = 48, MAX_SCORCH = 96;
const MAX_FIRE = 96, MAX_RINGS = 16, MAX_FLAMES = 64;
/** scorch marks last this long (s), shrinking away over the last SCORCH_FADE */
const SCORCH_LIFE = 45, SCORCH_FADE = 10;
const C = (c: string) => new THREE.Color(c);
const FIRE = [C(PAL.lavaHell), C(PAL.lava), C(PAL.signalOrange)];
const SMOKE_DARK = C(PAL.anthrazit), SMOKE_LIGHT = C(PAL.stahlHell), SMOKE_FADE = C(PAL.schneeSchatten), ASH = C(PAL.asche), FOAM = C(PAL.gischt);
/** a fireball's colour over its life: white-hot, yellow, orange, red, then smoke */
const FIRE_RAMP: [number, THREE.Color][] = [
  [0, C(PAL.lichtWarm).multiplyScalar(2.4)], [0.14, C(PAL.lavaHell).multiplyScalar(1.8)], [0.4, C(PAL.lava).multiplyScalar(1.35)],
  [0.7, C(PAL.lavaDunkel)], [1, C(PAL.anthrazit)],
];
const SPARK_WHITE = C(PAL.lichtWarm).multiplyScalar(1.6), SCORCH = [C(PAL.basalt), C(PAL.anthrazit), C(PAL.basaltHell)];
const Z = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Pooled combat effects: explosion flashes and halos (additive points), flying
 * debris and splashes (instanced tetrahedra), smoke (instanced icosahedra) and
 * burning ruins (emitters). All low-poly and palette coloured.
 */
/** something that wants to hear explosions and impacts (the sound engine) */
export interface EffectsListener {
  explosion(p: THREE.Vector3, scale: number): void;
  /** a Hammerhead's warhead (its own, heavier sound) */
  hammerHit(p: THREE.Vector3): void;
  impact(p: THREE.Vector3, surface: 'land' | 'water' | 'hit'): void;
  splash(p: THREE.Vector3, scale: number): void;
  debris(p: THREE.Vector3): void;
}

export class Effects {
  readonly group = new THREE.Group();
  listener: EffectsListener | null = null;
  private glowGeo: THREE.BufferGeometry;
  private glow: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private flashes: Flash[] = [];
  private frame: number[] = []; // immediate halos for this frame: x,y,z,r,g,b,size
  private debris: THREE.InstancedMesh;
  private smoke: THREE.InstancedMesh;
  private particles: Particle[] = [];
  private emitters: Emitter[] = [];
  private fireMesh: THREE.InstancedMesh;
  private ringMesh: THREE.InstancedMesh;
  private flameMesh: THREE.InstancedMesh;
  private fires: Fire[] = [];
  private rings: Ring[] = [];
  private sparkMesh: THREE.InstancedMesh;
  private muzzleMesh: THREE.InstancedMesh;
  private scorchMesh: THREE.InstancedMesh;
  private sparks: Spark[] = [];
  private muzzles: Muzzle[] = [];
  private scorches: Scorch[] = [];
  private rnd = mulberry32(99);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();
  private tc = new THREE.Color();

  constructor(private ground: Ground) {
    this.glowGeo = new THREE.BufferGeometry();
    this.glowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_GLOW * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.glowGeo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(MAX_GLOW * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.glowGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MAX_GLOW), 1).setUsage(THREE.DynamicDrawUsage));
    this.glow = new THREE.Points(this.glowGeo, glowMaterial());
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 11;

    const mat = new THREE.MeshLambertMaterial({ flatShading: true });
    // smoke: rounder puffs, slightly see-through, never writes depth (no hard edges)
    const smokeMat = new THREE.MeshLambertMaterial({ flatShading: true, transparent: true, opacity: 0.8, depthWrite: false });
    this.debris = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(1, 0), mat, MAX_DEBRIS);
    this.smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), smokeMat, MAX_SMOKE);
    this.smoke.renderOrder = 3;
    for (const im of [this.debris, this.smoke]) {
      im.count = 0;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, new THREE.Color());
    }
    this.debris.castShadow = true;
    // glowing bits drawn additively: spark streaks (a thin box stretched along the way they fly), muzzle stars
    this.sparkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.16, 1).translate(0, 0, -0.5), additiveMaterial(), MAX_SPARKS);
    this.muzzleMesh = new THREE.InstancedMesh(star(), additiveMaterial(), MAX_MUZZLES);
    // scorch marks: flat dark hexagons lying on the ground, drawn just above it
    const scorchMat = new THREE.MeshLambertMaterial({ flatShading: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.scorchMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 6).rotateX(-Math.PI / 2), scorchMat, MAX_SCORCH);
    // fireballs: faceted balls, unlit but shaded by facet (lighter on top) so they read as low-poly shapes
    const ball = new THREE.IcosahedronGeometry(1, 0), bn = ball.getAttribute('normal'), shade: number[] = [];
    for (let i = 0; i < bn.count; i += 3) {
      const k = 0.72 + 0.28 * (bn.getY(i) * 0.5 + 0.5);
      for (let j = 0; j < 3; j++) shade.push(k, k, k);
    }
    ball.setAttribute('color', new THREE.Float32BufferAttribute(shade, 3));
    this.fireMesh = new THREE.InstancedMesh(ball, new THREE.MeshBasicMaterial({ vertexColors: true }), MAX_FIRE);
    // the blast ring: bright at its rim, nothing inside
    const ring = new THREE.RingGeometry(0.75, 1, 18, 1).rotateX(-Math.PI / 2), rp = ring.getAttribute('position'), rc: number[] = [];
    for (let i = 0; i < rp.count; i++) { const k = Math.hypot(rp.getX(i), rp.getZ(i)) > 0.9 ? 1 : 0; rc.push(k, k, k); }
    ring.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
    this.ringMesh = new THREE.InstancedMesh(ring, additiveMaterial(), MAX_RINGS);
    // flames at the foot of a burning ruin: cones of fire pointing up, fading at the tip
    this.flameMesh = new THREE.InstancedMesh(spindle(5, 0.02, 0), additiveMaterial(), MAX_FLAMES);
    for (const im of [this.fireMesh, this.ringMesh, this.flameMesh, this.sparkMesh, this.muzzleMesh, this.scorchMesh]) {
      im.count = 0;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, new THREE.Color());
    }
    this.sparkMesh.renderOrder = this.muzzleMesh.renderOrder = this.ringMesh.renderOrder = this.flameMesh.renderOrder = 12;
    this.scorchMesh.receiveShadow = true;
    this.group.add(this.glow, this.debris, this.smoke, this.fireMesh, this.ringMesh, this.flameMesh, this.sparkMesh, this.muzzleMesh, this.scorchMesh);
    this.group.name = 'effects';
  }

  /** a halo for this frame only (projectiles, muzzle) */
  halo(p: THREE.Vector3, color: THREE.Color, size: number) {
    if (this.frame.length / 7 < MAX_GLOW / 2) this.frame.push(p.x, p.y, p.z, color.r, color.g, color.b, size);
  }

  flash(p: THREE.Vector3, color: THREE.Color, size: number, life: number) {
    this.flashes.push({ x: p.x, y: p.y, z: p.z, r: color.r, g: color.g, b: color.b, size, t: 0, life });
  }

  /** live smoke puffs and other particles (counted, so a full pool turns new ones away cheaply) */
  private nSmoke = 0;
  private nBits = 0;
  private add(kind: Particle['kind'], pos: THREE.Vector3, vel: THREE.Vector3, size: number, life: number, color: THREE.Color, grow?: number, fade?: THREE.Color): Particle | null {
    // (spray is drawn with the smoke, so it counts against the smoke's pool)
    const puff = kind !== 'debris';
    if (puff ? this.nSmoke >= MAX_SMOKE : this.nBits >= MAX_DEBRIS) return null;
    if (puff) this.nSmoke++; else this.nBits++;
    const r = this.rnd;
    const p: Particle = {
      pos: pos.clone(), vel, size, t: 0, life, color, kind, grow, fade,
      rot: new THREE.Vector3(r() * 6, r() * 6, r() * 6), spin: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(8),
    };
    this.particles.push(p);
    return p;
  }

  /** a puff of smoke; dark smoke (fire, wrecks) is anthracite, climbs fast and lives long, so it stands as a column */
  smokePuff(p: THREE.Vector3, size: number, dark = true) {
    const r = this.rnd;
    const at = p.clone().add(new THREE.Vector3((r() - 0.5) * size, 0, (r() - 0.5) * size));
    if (dark) this.add('smoke', at, new THREE.Vector3((r() - 0.5) * 2, 7 + r() * 5, (r() - 0.5) * 2), size * (0.5 + r() * 0.4), 7 + r() * 5, SMOKE_DARK.clone().lerp(ASH, r() * 0.3), undefined, ASH);
    else this.add('smoke', at, new THREE.Vector3((r() - 0.5) * 2, 4 + r() * 4, (r() - 0.5) * 2), size * (0.5 + r() * 0.4), 3.5 + r() * 2.5, C(PAL.metall).lerp(SMOKE_LIGHT, 0.5 + r() * 0.5));
  }

  /** fireball, debris, smoke; scale 1 = a vehicle, 3 = a building */
  /**
   * Fireball, blast ring, debris (some of it burning and trailing smoke), smoke; scale 1 = a vehicle, 3 = a building.
   * Near the ground it leaves a scorch mark, on the water it throws up a column of spray instead.
   */
  /** a Hammerhead's warhead going off: a big blast with a sound of its own */
  hammerBlast(p: THREE.Vector3) {
    this.explosion(p, 2.4, PAL.metall, true);
    this.listener?.hammerHit(p);
  }

  explosion(p: THREE.Vector3, scale = 1, debrisColor: THREE.ColorRepresentation = PAL.metall, quiet = false) {
    const r = this.rnd, ks = Math.sqrt(scale);
    // (`quiet`: its sound comes from elsewhere, a bursting defence drone's)
    if (!quiet) this.listener?.explosion(p, scale);
    this.flash(p, FIRE[0].clone().multiplyScalar(2.2), 28 * scale, 0.5 + 0.2 * scale);
    this.flash(p.clone().add(new THREE.Vector3(0, 3 * scale, 0)), FIRE[1].clone().multiplyScalar(1.6), 55 * scale, 0.9 + 0.3 * scale);
    // the fireball: a cluster of faceted balls that swell, burn down and go up in smoke
    for (let i = 0; i < Math.min(14, Math.round(4 + 3 * scale)); i++) {
      const off = new THREE.Vector3(r() - 0.5, r() * 0.7, r() - 0.5).multiplyScalar(4 * ks);
      const vel = off.clone().normalize().multiplyScalar(4 + r() * 6 * ks).add(new THREE.Vector3(0, 3 + r() * 4, 0));
      this.fire(p.clone().add(off), vel, (3 + r() * 2.5) * ks, 0.75 + r() * 0.55);
    }
    const g = this.ground.heightAt(p.x, p.z), surface = Math.max(g, 0), wet = g < 0;
    // the blast: a ring running out over the ground or the water (only for something that went up close to it)
    if (p.y < surface + 15) this.ring(new THREE.Vector3(p.x, surface + 0.4, p.z), 14 * ks, wet ? FOAM : FIRE[0]);
    const dc = new THREE.Color(debrisColor);
    for (let i = 0; i < 14 * scale; i++) {
      const v = new THREE.Vector3(r() - 0.5, 0.6 + r(), r() - 0.5).normalize().multiplyScalar(12 + r() * 22 * ks);
      const d = this.add('debris', p, v, (0.5 + r() * 1.2) * ks, 2.5 + r() * 2, r() < 0.3 ? FIRE[2].clone() : dc.clone());
      // a few burning pieces trail smoke as they fly
      if (d && i % 4 === 0) d.trail = 1.2 + r();
    }
    for (let i = 0; i < 4 * scale; i++) this.smokePuff(p.clone().add(new THREE.Vector3(0, r() * 4 * scale, 0)), 2.6 * ks, false);
    if (p.y < surface + 4) { if (wet) this.splash(p, scale); else this.scorch(p, 3 * ks); }
    // a building (or a wreck) coming down on land: metal crashing
    if (!wet && scale >= 2 && p.y < surface + 30) this.listener?.debris(p);
  }

  /** a wreck crashes down on land: the clatter of it (the explosion has its own sound) */
  clatter(p: THREE.Vector3) {
    this.listener?.debris(p);
  }

  /** the biggest fire burning within `range` of `p` (for its crackle), weighed by size and nearness */
  nearestFire(p: THREE.Vector3, range = 600): { pos: THREE.Vector3; size: number } | null {
    let best: Emitter | null = null, score = 0;
    for (const em of this.emitters) {
      const d = em.pos.distanceTo(p);
      if (d > range) continue;
      const k = em.size * (1 - em.t / em.life) / Math.max(30, d);
      if (k > score) { score = k; best = em; }
    }
    return best ? { pos: best.pos, size: best.size * (1 - best.t / best.life) } : null;
  }

  /** a ball of fire (see FIRE_RAMP), `size` metres across when it has swollen */
  private fire(p: THREE.Vector3, vel: THREE.Vector3, size: number, life: number) {
    if (this.fires.length >= MAX_FIRE) this.fires.shift();
    const r = this.rnd;
    this.fires.push({ pos: p.clone(), vel, t: 0, life, size, rot: new THREE.Euler(r() * 6, r() * 6, r() * 6) });
  }

  /** a flat ring running out from `p` to `radius` metres and fading */
  ring(p: THREE.Vector3, radius: number, color: THREE.Color) {
    if (this.rings.length >= MAX_RINGS) this.rings.shift();
    this.rings.push({ pos: p.clone(), t: 0, life: 0.5, radius, color: color.clone().multiplyScalar(1.3) });
  }

  /** something blew up on the water or fell into it: a column of spray, a ring of foam and mist at its foot */
  splash(p: THREE.Vector3, scale = 1) {
    const r = this.rnd, ks = Math.sqrt(scale);
    this.listener?.splash(p, scale);
    const at = new THREE.Vector3(p.x, 0.3, p.z);
    for (let i = 0; i < 30 * ks; i++) {
      this.add('spray', at.clone().add(new THREE.Vector3((r() - 0.5) * 3 * ks, 0, (r() - 0.5) * 3 * ks)),
        new THREE.Vector3((r() - 0.5) * 6, (14 + r() * 18) * ks, (r() - 0.5) * 6), (1.1 + r() * 1.3) * ks, 2.4 + r() * 0.8, FOAM.clone());
    }
    this.ring(at, 16 * ks, FOAM);
    for (let i = 0; i < 4 * ks; i++) this.add('smoke', at.clone().add(new THREE.Vector3((r() - 0.5) * 6, r() * 3, (r() - 0.5) * 6)),
      new THREE.Vector3((r() - 0.5) * 3, 2 + r() * 2, (r() - 0.5) * 3), (2.5 + r()) * ks, 2.5 + r() * 1.5, FOAM.clone(), 1.2);
  }

  /**
   * A shot strikes. `dir`: the way it flew (sparks fly back off the surface), `size`: 1 for a laser bolt or a
   * shell, more for heavier hits. On land it leaves a scorch mark.
   */
  impact(p: THREE.Vector3, surface: 'land' | 'water' | 'hit', dir?: THREE.Vector3, size = 1) {
    const r = this.rnd;
    this.listener?.impact(p, surface);
    if (surface === 'water') {
      for (let i = 0; i < 8; i++) this.add('spray', p, new THREE.Vector3((r() - 0.5) * 6, 8 + r() * 10, (r() - 0.5) * 6), 0.5 + r() * 0.6, 1.2, FOAM.clone());
      return;
    }
    const hit = surface === 'hit';
    this.flash(p, FIRE[hit ? 0 : 1].clone().multiplyScalar(1.8), (hit ? 12 : 8) * size, 0.22);
    // a spray of sparks, back the way the shot came and up
    const back = dir ? dir.clone().negate() : new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < (hit ? 18 : 10) * size; i++) {
      const v = new THREE.Vector3(r() - 0.5, r() - 0.3, r() - 0.5).multiplyScalar(1.6).add(back).normalize().multiplyScalar(18 + r() * 34);
      this.spark(p, v, 0.25 + r() * 0.35, r() < 0.5 ? FIRE[0] : SPARK_WHITE);
    }
    for (let i = 0; i < 4; i++) this.add('debris', p, new THREE.Vector3((r() - 0.5) * 10, 6 + r() * 8, (r() - 0.5) * 10), 0.3 + r() * 0.4, 1.2, hit ? FIRE[2].clone() : C(PAL.erde));
    this.smokePuff(p, 1.6, false);
    if (!hit) this.scorch(p, (1.6 + r() * 0.8) * size);
  }

  private spark(p: THREE.Vector3, vel: THREE.Vector3, life: number, color: THREE.Color) {
    if (this.sparks.length >= MAX_SPARKS) this.sparks.shift();
    this.sparks.push({ pos: p.clone(), vel, t: 0, life, color });
  }

  /** a muzzle flash: a star of flame along `dir`, `size` metres long, gone in a few hundredths of a second */
  muzzle(p: THREE.Vector3, dir: THREE.Vector3, color: THREE.Color, size: number) {
    if (this.muzzles.length >= MAX_MUZZLES) this.muzzles.shift();
    const q = new THREE.Quaternion().setFromUnitVectors(Z, dir.clone().normalize());
    q.multiply(new THREE.Quaternion().setFromAxisAngle(Z, this.rnd() * Math.PI));
    this.muzzles.push({ pos: p.clone(), q, size, t: 0, life: 0.07, color: color.clone() });
  }

  /** a dark mark where something burnt into the ground, lying on its slope (none on water) */
  scorch(p: THREE.Vector3, radius: number) {
    const g = this.ground, h = g.heightAt(p.x, p.z);
    if (h < 0.3 || p.y > h + 3) return;
    const n = new THREE.Vector3(g.heightAt(p.x - 1, p.z) - g.heightAt(p.x + 1, p.z), 2, g.heightAt(p.x, p.z - 1) - g.heightAt(p.x, p.z + 1)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, n).multiply(new THREE.Quaternion().setFromAxisAngle(UP, this.rnd() * Math.PI));
    const at = new THREE.Vector3(p.x, h, p.z).addScaledVector(n, 0.06);
    if (this.scorches.length >= MAX_SCORCH) this.scorches.shift();
    this.scorches.push({ m: new THREE.Matrix4().compose(at, q, new THREE.Vector3(radius, 1, radius)), t: 0, r: radius });
  }

  /** a puff of black smoke trailing behind something burning that moves (a falling wreck): it billows up at once */
  smokeTrail(p: THREE.Vector3, size: number) {
    const r = this.rnd;
    this.add('smoke', p, new THREE.Vector3((r() - 0.5) * 2, 2 + r() * 2, (r() - 0.5) * 2), size * (0.8 + r() * 0.4), 2.2 + r(), SMOKE_DARK.clone().lerp(ASH, r() * 0.25), 1.6, ASH);
  }

  /** a puff of a missile's smoke trail: pale, hanging in the air where it was left, the puffs overlapping into one
   *  line; `scale`: thinner for a small missile */
  trail(p: THREE.Vector3, scale = 1) {
    // missile trails may fill half the pool at most, so fires and wrecks always have smoke
    if (this.nSmoke > MAX_SMOKE * 0.5) return;
    const r = this.rnd;
    this.add('smoke', p, new THREE.Vector3((r() - 0.5) * 1.2, 0.4 + r() * 0.6, (r() - 0.5) * 1.2), (1.9 + r() * 0.4) * scale, 1.8 + r() * 0.8, SMOKE_LIGHT.clone().lerp(SMOKE_FADE, r() * 0.4), 1.0);
  }

  /** a burning ruin: flickering fire and a column of smoke */
  burn(p: THREE.Vector3, size: number, seconds: number) {
    this.emitters.push({ pos: p.clone(), t: 0, life: seconds, every: 0.2, acc: 0, size: Math.min(size * 2.5, 16) });
  }

  update(dt: number, windX: number, windZ: number, camera: THREE.PerspectiveCamera, viewportH: number, fog: THREE.Fog) {
    // emitters
    for (const em of this.emitters) {
      em.t += dt; em.acc += dt;
      while (em.acc > em.every) { em.acc -= em.every; this.smokePuff(em.pos, em.size); }
      const flick = 0.7 + 0.3 * Math.sin(em.t * 13 + em.pos.x);
      this.halo(em.pos, FIRE[1].clone().multiplyScalar(1.3 * flick * (1 - em.t / em.life)), em.size * 4);
    }
    this.emitters = this.emitters.filter(e => e.t < e.life);
    // their flames: two or three cones at the foot, flickering, lower as the fire dies down
    let nl = 0;
    for (const em of this.emitters) {
      const left = 1 - em.t / em.life;
      for (let k = 0; k < 3 && nl < MAX_FLAMES; k++) {
        const ph = em.t * (9 + k * 3) + k * 2.1 + em.pos.x;
        const h = em.size * (0.6 + 0.18 * Math.sin(ph)) * (0.4 + 0.6 * left), w = em.size * 0.1 * (1 + 0.3 * k);
        const ang = k * 2.1 + em.pos.z;
        this.s.set(em.pos.x + Math.cos(ang) * em.size * 0.08 * k, em.pos.y, em.pos.z + Math.sin(ang) * em.size * 0.08 * k);
        this.q.setFromUnitVectors(Z, DOWN);
        this.m.compose(this.s, this.q, new THREE.Vector3(w, w, h));
        this.flameMesh.setMatrixAt(nl, this.m);
        this.flameMesh.setColorAt(nl++, this.tc.copy(k === 0 ? FIRE[0] : FIRE[1]).multiplyScalar(1.5 * fogFade(em.pos, camera, fog)));
      }
    }
    this.flameMesh.count = nl;

    // fireballs: swell fast, burn down, then go up as dark smoke
    for (const f of this.fires) {
      f.t += dt;
      f.vel.multiplyScalar(Math.exp(-dt * 2.2));
      f.vel.y += 3 * dt;
      f.pos.addScaledVector(f.vel, dt);
      if (f.t >= f.life) this.smokePuff(f.pos, f.size * 0.9);
    }
    this.fires = this.fires.filter(f => f.t < f.life);
    let nf = 0;
    for (const f of this.fires) {
      const k = f.t / f.life, swell = k < 0.12 ? 0.35 + 0.65 * k / 0.12 : 1 + (k - 0.12) * 0.45;
      this.s.setScalar(f.size * 0.5 * swell * (k > 0.85 ? (1 - k) / 0.15 * 0.5 + 0.5 : 1));
      this.q.setFromEuler(this.e.set(f.rot.x, f.rot.y + k, f.rot.z));
      this.m.compose(f.pos, this.q, this.s);
      this.fireMesh.setMatrixAt(nf, this.m);
      let i = 0;
      while (i + 2 < FIRE_RAMP.length && k > FIRE_RAMP[i + 1][0]) i++;
      const [a, ca] = FIRE_RAMP[i], [b, cb] = FIRE_RAMP[i + 1];
      this.fireMesh.setColorAt(nf++, this.tc.copy(ca).lerp(cb, Math.min(1, (k - a) / (b - a))));
    }
    this.fireMesh.count = nf;
    // blast rings: run out fast, fading
    let nr = 0;
    for (const g2 of this.rings) g2.t += dt;
    this.rings = this.rings.filter(g2 => g2.t < g2.life);
    for (const g2 of this.rings) {
      const k = g2.t / g2.life, rad = g2.radius * (0.15 + 0.85 * Math.sqrt(k));
      this.m.compose(g2.pos, this.q.identity(), this.s.set(rad, 1, rad));
      this.ringMesh.setMatrixAt(nr, this.m);
      this.ringMesh.setColorAt(nr++, this.tc.copy(g2.color).multiplyScalar((1 - k) * fogFade(g2.pos, camera, fog)));
    }
    this.ringMesh.count = nr;
    for (const im of [this.fireMesh, this.ringMesh, this.flameMesh]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }

    // particles
    let nd = 0, ns = 0;
    const g = -22;
    for (const p of this.particles) {
      p.t += dt;
      if (p.kind === 'smoke') {
        p.vel.x += (windX * 0.6 - p.vel.x) * dt * 0.5;
        p.vel.z += (windZ * 0.6 - p.vel.z) * dt * 0.5;
        p.pos.addScaledVector(p.vel, dt);
      } else {
        p.vel.y += g * dt;
        p.pos.addScaledVector(p.vel, dt);
        p.rot.addScaledVector(p.spin, dt);
        // a burning piece: a thin dark trail behind it while it flies
        if (p.trail && p.trail > 0) {
          p.trail -= dt;
          if (this.rnd() < dt * 30) this.add('smoke', p.pos, new THREE.Vector3(0, 1.5, 0), 0.8 + this.rnd() * 0.4, 1.4 + this.rnd(), SMOKE_DARK.clone(), 1.6, ASH);
        }
        const gh = this.ground.heightAt(p.pos.x, p.pos.z);
        if (gh < 0 && p.pos.y < 0) p.t = p.life;            // sinks in the sea
        else if (p.pos.y < gh) {                              // bounces and settles on land
          p.pos.y = gh; p.vel.y *= -0.25; p.vel.x *= 0.5; p.vel.z *= 0.5; p.spin.multiplyScalar(0.5);
        }
      }
    }
    this.particles = this.particles.filter(p => p.t < p.life);
    this.nBits = this.particles.filter(p => p.kind === 'debris').length;
    this.nSmoke = this.particles.length - this.nBits;
    for (const p of this.particles) {
      const f = p.t / p.life;
      if (p.kind === 'smoke') {
        const size = p.size * (0.5 + f * (p.grow ?? 1.4)) * Math.sin(Math.PI * Math.min(1, f * 1.1 + 0.05));
        this.s.setScalar(Math.max(size, 0.01));
        this.q.setFromEuler(this.e.set(p.rot.x, p.rot.y + f, p.rot.z));
        this.m.compose(p.pos, this.q, this.s);
        this.smoke.setMatrixAt(ns, this.m);
        // dark at the source, paler as it rises
        this.smoke.setColorAt(ns, this.tc.copy(p.color).lerp(p.fade ?? SMOKE_FADE, f * 0.8));
        ns++;
      } else if (p.kind === 'spray') {
        // water: white blobs (in the smoke's mesh), shrinking a little as they fall back
        this.s.setScalar(p.size * (1 - f * 0.4));
        this.q.setFromEuler(this.e.set(p.rot.x, p.rot.y, p.rot.z));
        this.m.compose(p.pos, this.q, this.s);
        this.smoke.setMatrixAt(ns, this.m);
        this.smoke.setColorAt(ns, p.color);
        ns++;
      } else {
        this.s.setScalar(p.size * (f > 0.75 ? (1 - f) * 4 : 1));
        this.q.setFromEuler(this.e.set(p.rot.x, p.rot.y, p.rot.z));
        this.m.compose(p.pos, this.q, this.s);
        this.debris.setMatrixAt(nd, this.m);
        this.debris.setColorAt(nd, p.color);
        nd++;
      }
    }
    this.debris.count = nd; this.smoke.count = ns;
    for (const im of [this.debris, this.smoke]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }

    // sparks: thrown, falling, each a streak along its way and fading out
    let nk = 0;
    for (const k of this.sparks) {
      k.t += dt;
      k.vel.y += g * 0.6 * dt;
      k.pos.addScaledVector(k.vel, dt);
    }
    this.sparks = this.sparks.filter(k => k.t < k.life && k.pos.y > this.ground.heightAt(k.pos.x, k.pos.z) - 0.5);
    for (const k of this.sparks) {
      const sp = k.vel.length(), f = 1 - k.t / k.life;
      this.q.setFromUnitVectors(Z, this.s.copy(k.vel).divideScalar(sp || 1));
      this.m.compose(k.pos, this.q, this.s.set(1, 1, Math.max(0.4, sp * 0.06)));
      this.sparkMesh.setMatrixAt(nk, this.m);
      this.sparkMesh.setColorAt(nk++, this.tc.copy(k.color).multiplyScalar(2.2 * f * fogFade(k.pos, camera, fog)));
    }
    this.sparkMesh.count = nk;
    // muzzle flashes: flare up, then shrink away
    let nm = 0;
    for (const u of this.muzzles) u.t += dt;
    this.muzzles = this.muzzles.filter(u => u.t < u.life);
    for (const u of this.muzzles) {
      const f = u.t / u.life, k = u.size * (0.7 + 0.6 * Math.sin(Math.PI * Math.min(1, f * 1.4 + 0.2)));
      this.m.compose(u.pos, u.q, this.s.set(k * 0.8, k * 0.8, k));
      this.muzzleMesh.setMatrixAt(nm, this.m);
      this.muzzleMesh.setColorAt(nm++, this.tc.copy(u.color).multiplyScalar((1 - f * 0.6) * fogFade(u.pos, camera, fog)));
    }
    this.muzzleMesh.count = nm;
    // scorch marks: stay, then shrink away
    let nc = 0;
    for (const c of this.scorches) c.t += dt;
    this.scorches = this.scorches.filter(c => c.t < SCORCH_LIFE);
    for (const c of this.scorches) {
      const k = Math.min(1, (SCORCH_LIFE - c.t) / SCORCH_FADE);
      this.m.copy(c.m);
      if (k < 1) this.m.multiply(new THREE.Matrix4().makeScale(k, 1, k));
      this.scorchMesh.setMatrixAt(nc, this.m);
      this.scorchMesh.setColorAt(nc++, SCORCH[(Math.floor(c.r * 97) % SCORCH.length)]);
    }
    this.scorchMesh.count = nc;
    for (const im of [this.sparkMesh, this.muzzleMesh, this.scorchMesh]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }

    // halos: timed flashes + this frame's immediate halos
    for (const f of this.flashes) f.t += dt;
    this.flashes = this.flashes.filter(f => f.t < f.life);
    const pos = this.glowGeo.getAttribute('position') as THREE.BufferAttribute;
    const col = this.glowGeo.getAttribute('aColor') as THREE.BufferAttribute;
    const siz = this.glowGeo.getAttribute('aSize') as THREE.BufferAttribute;
    let n = 0;
    for (const f of this.flashes) {
      if (n >= MAX_GLOW) break;
      const k = 1 - f.t / f.life;
      pos.setXYZ(n, f.x, f.y, f.z); col.setXYZ(n, f.r * k, f.g * k, f.b * k); siz.setX(n, f.size * (0.6 + 0.4 * k)); n++;
    }
    for (let i = 0; i + 6 < this.frame.length && n < MAX_GLOW; i += 7, n++) {
      const a = this.frame;
      pos.setXYZ(n, a[i], a[i + 1], a[i + 2]); col.setXYZ(n, a[i + 3], a[i + 4], a[i + 5]); siz.setX(n, a[i + 6]);
    }
    this.frame.length = 0;
    this.glowGeo.setDrawRange(0, n);
    pos.needsUpdate = col.needsUpdate = siz.needsUpdate = true;
    updateGlowUniforms(this.glow.material, 1, camera, viewportH, fog);
  }
}
