import * as THREE from 'three';
import { PAL } from '../engine/palette';
import { waveHeight } from './ocean';
import type { Environment } from './environment';

interface WakePoint { x: number; z: number; sx: number; sz: number; age: number; strength: number }

export interface WakeOptions {
  width0: number;   // half width at the stern
  width1: number;   // half width when it fades out
  life: number;     // seconds
  spacing: number;  // metres between trail points
  maxPoints?: number;
}

/**
 * Trail behind a vessel: a strip that widens and fades with age. It is drawn
 * into the wake field texture, which the ocean shader outlines.
 */
export class Wake {
  readonly mesh: THREE.Mesh;
  private pts: WakePoint[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private geo: THREE.BufferGeometry;
  private max: number;
  private lastX = NaN;
  private lastZ = NaN;
  private foam = new THREE.Color(PAL.gischt);

  constructor(private o: WakeOptions) {
    this.max = o.maxPoints ?? 160;
    // 3 vertices per point (left, centre, right); 4 triangles per segment, non-indexed
    const tris = (this.max - 1) * 4;
    this.pos = new Float32Array(tris * 9);
    this.col = new Float32Array(tris * 12);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true, transparent: true, depthWrite: false, flatShading: true, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'wake';
  }

  /** stern: emission point, dir: heading unit vector, speed in m/s, active: in water */
  update(dt: number, stern: THREE.Vector3, dir: THREE.Vector3, speed: number, active: boolean, env: Environment) {
    for (const p of this.pts) p.age += dt;
    while (this.pts.length && this.pts[0].age > this.o.life) this.pts.shift();

    const moving = active && Math.abs(speed) > 0.6;
    const dist = Math.hypot(stern.x - this.lastX, stern.z - this.lastZ);
    if (moving && (!(dist < this.o.spacing))) {
      this.pts.push({ x: stern.x, z: stern.z, sx: dir.z, sz: -dir.x, age: 0,
        strength: Math.min(1, Math.abs(speed) / 8) });
      if (this.pts.length > this.max) this.pts.shift();
      this.lastX = stern.x; this.lastZ = stern.z;
    }
    if (!moving) { this.lastX = NaN; }
    this.rebuild(env);
  }

  private rebuild(env: Environment) {
    const n = this.pts.length;
    const t = env.elapsed, amp = env.w.waves;
    const rows: number[][] = [];
    for (const p of this.pts) {
      const f = p.age / this.o.life;
      const hw = THREE.MathUtils.lerp(this.o.width0, this.o.width1, Math.sqrt(f));
      // tent profile across the trail: the ocean shader outlines it, so the contour
      // narrows to a point as the wake fades
      const alpha = Math.pow(1 - f, 1.2) * p.strength * 0.9;
      const row: number[] = [];
      for (const s of [1, 0, -1]) {
        const x = p.x + p.sx * hw * s, z = p.z + p.sz * hw * s;
        row.push(x, waveHeight(x, z, t, amp) + 0.45, z, s === 0 ? alpha : 0);
      }
      rows.push(row);
    }
    let vi = 0, ci = 0;
    const put = (r: number[], k: number) => {
      this.pos[vi++] = r[k * 4]; this.pos[vi++] = r[k * 4 + 1]; this.pos[vi++] = r[k * 4 + 2];
      this.col[ci++] = this.foam.r; this.col[ci++] = this.foam.g; this.col[ci++] = this.foam.b; this.col[ci++] = r[k * 4 + 3];
    };
    for (let i = 0; i + 1 < n; i++) {
      const A = rows[i], B = rows[i + 1];
      put(A, 0); put(B, 0); put(B, 1);
      put(A, 0); put(B, 1); put(A, 1);
      put(A, 1); put(B, 1); put(B, 2);
      put(A, 1); put(B, 2); put(A, 2);
    }
    this.geo.setDrawRange(0, vi / 3);
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}
