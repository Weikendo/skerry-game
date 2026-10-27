import * as THREE from 'three';
import { mulberry32 } from '../engine/lowpoly';
import { PAL } from '../engine/palette';
import { waveHeight } from './ocean';
import type { Environment } from './environment';

const MAX_BLOBS = 900;
const GRAVITY = -16;

interface Blob { x: number; y: number; z: number; vx: number; vy: number; vz: number; size: number; t: number; life: number }

/** the bow of a hull for the spray: where the stem meets the water (z forward of the middle), its half width just aft of it */
export interface Bow { stemZ: number; halfBeam: number; scale: number }

/**
 * Bow spray in the manner of Wind Waker: round white blobs (low-poly balls)
 * thrown up and out at the stem, more and higher the faster the hull goes,
 * falling back into the sea and shrinking away.
 */
export class Spray {
  readonly mesh: THREE.InstancedMesh;
  private blobs: Blob[] = [];
  private acc = new Map<object, number>();
  private rnd = mulberry32(7);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private v = new THREE.Vector3();

  constructor() {
    const mat = new THREE.MeshLambertMaterial({ color: PAL.gischt, emissive: PAL.wasserFlach, emissiveIntensity: 0.25, flatShading: true });
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat, MAX_BLOBS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.name = 'spray';
  }

  /** throw spray at the bow of a hull under way (key: the hull, for its emission count) */
  emit(key: object, dt: number, pos: THREE.Vector3, forward: THREE.Vector3, speed: number, bow: Bow, env: Environment) {
    const v = Math.abs(speed);
    const rate = Math.max(0, v - 2.5) * 2.4 * Math.sqrt(bow.scale);
    let acc = (this.acc.get(key) ?? 0) + rate * dt;
    const r = this.rnd, f = forward, px = f.z, pz = -f.x, k = THREE.MathUtils.clamp(v / 15, 0.4, 1.5) * Math.sqrt(bow.scale);
    while (acc >= 1 && this.blobs.length < MAX_BLOBS) {
      acc -= 1;
      const side = r() < 0.5 ? -1 : 1, back = r() * bow.halfBeam * 0.8, out = (0.2 + r() * 0.5) * bow.halfBeam * 0.4;
      const lx = side * out, lz = bow.stemZ - back;
      const x = pos.x + px * lx + f.x * lz, z = pos.z + pz * lx + f.z * lz;
      const sideSpeed = (3 + r() * 6) * k, up = (5 + r() * 7) * k, carry = speed * (0.75 + r() * 0.2);
      this.blobs.push({
        x, y: waveHeight(x, z, env.elapsed, env.w.waves) + 0.3, z,
        vx: px * side * sideSpeed + f.x * carry, vy: up, vz: pz * side * sideSpeed + f.z * carry,
        size: (0.5 + r() * 1.1) * bow.scale, t: 0, life: 1.1 + r() * 0.8,
      });
    }
    this.acc.set(key, acc);
  }

  update(dt: number, env: Environment) {
    for (const b of this.blobs) {
      b.t += dt;
      b.vy += GRAVITY * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      // back in the sea: gone
      if (b.vy < 0 && b.y < waveHeight(b.x, b.z, env.elapsed, env.w.waves) - b.size * 0.5) b.t = b.life;
    }
    this.blobs = this.blobs.filter(b => b.t < b.life);
    let n = 0;
    for (const b of this.blobs) {
      const f = b.t / b.life;
      // swells quickly, then shrinks away
      const size = b.size * Math.min(1, f * 6) * (1 - f * f);
      this.s.setScalar(Math.max(0.01, size));
      this.q.setFromAxisAngle(this.v.set(0.3, 1, 0.2).normalize(), b.x * 0.7 + b.t * 2);
      this.m.compose(this.v.set(b.x, b.y, b.z), this.q, this.s);
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * The bow wave as Wind Waker draws it: on each side a flat white sheet that
 * rises from the stem, runs back along the hull and out, and curls over at its
 * top. It stands up with the speed and lies flat when the hull stops.
 */
export class BowCurl {
  readonly mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array;
  private col: Float32Array;
  private segs = 18;
  private static ROWS = 5;
  private base = new THREE.Color(PAL.wasserFlach);
  private white = new THREE.Color(PAL.gischt);

  /** halfWidth: the hull's half width at local z, `above` metres over the waterline; height: the wave's height at full speed (20 m/s) */
  constructor(private halfWidth: (z: number, above: number) => number, private stemZ: number, private length: number, private height: number) {
    const quads = 2 * this.segs * (BowCurl.ROWS - 1);
    this.pos = new Float32Array(quads * 6 * 3);
    this.col = new Float32Array(quads * 6 * 4);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = 'bow-curl';
  }

  /** on: in the water (an Otter ashore or aboard has none) */
  update(pos: THREE.Vector3, forward: THREE.Vector3, speed: number, env: Environment, on = true) {
    const H = on && speed > 0 ? this.height * THREE.MathUtils.clamp((speed - 1.5) / 14, 0, 1.4) : 0;
    this.mesh.visible = H > 0.05;
    if (!this.mesh.visible) return;
    const f = forward, px = f.z, pz = -f.x, L = this.length, segs = this.segs;
    let vi = 0, ci = 0;
    const c = new THREE.Color();
    // a column of the sheet: t along it (0 at the stem); its rows from the water up to the curling lip
    const column = (side: number, t: number) => {
      const z = this.stemZ - t * L;
      // the foot runs out from the hull along the Kelvin angle; every row stays clear of the (flaring) side
      const x = this.halfWidth(z, 0) + 0.3 + Math.pow(t, 1.3) * L * 0.25;
      const h = H * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.3 + 0.02)), 0.7) * (1 - 0.3 * t);
      const fade = Math.min(1, t * 12) * (1 - THREE.MathUtils.smoothstep(t, 0.6, 1));
      // from the water up the face, over the crest and down the curling lip
      const rows: [number, number][] = [[-0.6, -0.3], [0.1 * h, 0.5 * h], [0.3 * h, 0.9 * h], [0.62 * h, 0.95 * h], [0.9 * h, 0.6 * h]];
      return rows.map(([out, y], r) => {
        const lx = side * Math.max(x + out, this.halfWidth(z, y) + 0.6 + out * 0.5), wx = pos.x + px * lx + f.x * z, wz = pos.z + pz * lx + f.z * z;
        return { x: wx, y: waveHeight(wx, wz, env.elapsed, env.w.waves) + y, z: wz, a: fade * (r === 0 ? 0.3 : 1), w: Math.min(1, r / 2) };
      });
    };
    const put = (p: { x: number; y: number; z: number; a: number; w: number }) => {
      this.pos[vi++] = p.x; this.pos[vi++] = p.y; this.pos[vi++] = p.z;
      c.copy(this.base).lerp(this.white, 0.35 + 0.65 * p.w);
      this.col[ci++] = c.r; this.col[ci++] = c.g; this.col[ci++] = c.b; this.col[ci++] = p.a;
    };
    for (const side of [-1, 1]) {
      let prev = column(side, 0);
      for (let i = 1; i <= segs; i++) {
        const next = column(side, i / segs);
        for (let r = 0; r + 1 < BowCurl.ROWS; r++) {
          put(prev[r]); put(next[r]); put(next[r + 1]);
          put(prev[r]); put(next[r + 1]); put(prev[r + 1]);
        }
        prev = next;
      }
    }
    this.geo.setDrawRange(0, vi / 3);
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}
