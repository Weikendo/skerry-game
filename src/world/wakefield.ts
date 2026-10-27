import * as THREE from 'three';
import type { Wake } from './wake';

const SIZE = 2400;   // metres covered around the camera
export const WAKE_RES = 2048;    // texels (≈ 1.2 m each)

/**
 * Wakes are rendered from above into an intensity texture (tent profiles: 0 at
 * the edges, highest on the centre line). The ocean shader draws a crisp
 * contour of it, Wind Waker style: lighter water inside, a white outline and a
 * white churn where the wake is fresh.
 */
export class WakeField {
  readonly target = new THREE.WebGLRenderTarget(WAKE_RES, WAKE_RES, {
    // one 16-bit float channel: the shader derives the outline from the gradient, which 8 bits make jagged
    type: THREE.HalfFloatType, format: THREE.RedFormat, depthBuffer: false,
  });
  /** minX, minZ, size, size of the texture in world space */
  readonly rect = new THREE.Vector4(0, 0, SIZE, SIZE);
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-SIZE / 2, SIZE / 2, SIZE / 2, -SIZE / 2, 1, 6000);
  private mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  });
  private bow: BowWaves[] = [];
  private clear = new THREE.Color();

  constructor() {
    this.target.texture.minFilter = this.target.texture.magFilter = THREE.LinearFilter;
    this.cam.up.set(0, 0, -1); // screen right = +x, screen up = -z
  }

  add(w: Wake) {
    w.mesh.material = this.mat;
    this.scene.add(w.mesh);
  }

  addBowWaves(halfBeam: number, bowZ: number, length: number): BowWaves {
    const b = new BowWaves(halfBeam, bowZ, length, this.mat);
    this.bow.push(b);
    this.scene.add(b.mesh);
    return b;
  }

  /** a foam ring round a hull: `outline` its waterline (x port, z forward), `width` how far out it reaches */
  addRing(outline: [number, number][], width: number): HullRing {
    const r = new HullRing(outline, width, this.mat);
    this.scene.add(r.mesh);
    return r;
  }

  render(renderer: THREE.WebGLRenderer, centre: THREE.Vector3) {
    const texel = SIZE / WAKE_RES;
    const cx = Math.round(centre.x / texel) * texel, cz = Math.round(centre.z / texel) * texel;
    this.rect.set(cx - SIZE / 2, cz - SIZE / 2, SIZE, SIZE);
    this.cam.position.set(cx, 3000, cz);
    this.cam.lookAt(cx, 0, cz);
    this.cam.updateMatrixWorld();
    const prevTarget = renderer.getRenderTarget(), prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clear);
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(this.clear, prevAlpha);
  }
}

/** the bow splash: two short, wide wedges along the hull that fade towards the back */
export class BowWaves {
  readonly mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array;
  private col: Float32Array;
  private segs = 12;

  constructor(private halfBeam: number, private bowZ: number, private length: number, mat: THREE.Material) {
    const tris = this.segs * 2 * 4;
    this.pos = new Float32Array(tris * 9);
    this.col = new Float32Array(tris * 12);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
  }

  /** pos/forward of the hull, speed in m/s */
  update(pos: THREE.Vector3, forward: THREE.Vector3, speed: number) {
    const strength = THREE.MathUtils.clamp((Math.abs(speed) - 1) / 10, 0, 1);
    const f = forward, s = new THREE.Vector3(f.z, 0, -f.x);
    const arm = 0.34; // ~19.5°, the Kelvin wake angle
    let vi = 0, ci = 0;
    const put = (x: number, z: number, a: number) => {
      this.pos[vi++] = x; this.pos[vi++] = 0; this.pos[vi++] = z;
      this.col[ci++] = 1; this.col[ci++] = 1; this.col[ci++] = 1; this.col[ci++] = a;
    };
    for (const side of [-1, 1]) {
      for (let i = 0; i < this.segs; i++) {
        const rows: [number, number, number][][] = [];
        for (const t of [i / this.segs, (i + 1) / this.segs]) {
          const back = t * this.length;
          const out = this.halfBeam * 0.95 + back * Math.tan(arm);
          const w = this.halfBeam * (0.22 + 0.12 * t);
          const cx = pos.x + f.x * (this.bowZ - back) + s.x * side * out;
          const cz = pos.z + f.z * (this.bowZ - back) + s.z * side * out;
          const a = strength * (1 - t * t * t) * 1.5;   // above the churn threshold: white spray
          rows.push([[cx - s.x * side * w, cz - s.z * side * w, 0], [cx, cz, a], [cx + s.x * side * w, cz + s.z * side * w, 0]]);
        }
        const [A, B] = rows;
        for (const k of [0, 1]) {
          put(A[k][0], A[k][1], A[k][2]); put(A[k + 1][0], A[k + 1][1], A[k + 1][2]); put(B[k + 1][0], B[k + 1][1], B[k + 1][2]);
          put(A[k][0], A[k][1], A[k][2]); put(B[k + 1][0], B[k + 1][1], B[k + 1][2]); put(B[k][0], B[k][1], B[k][2]);
        }
      }
    }
    this.geo.setDrawRange(0, vi / 3);
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}

/**
 * The foam round a hull lying in the water (Wind Waker): a band that hugs the
 * waterline and ripples slowly; the ocean draws a white fringe at the hull, a
 * fine line and an outer rim from it. Under way the bow pushes it forward.
 */
export class HullRing {
  readonly mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array;
  private col: Float32Array;
  private normals: [number, number][];
  private length: number;

  constructor(private outline: [number, number][], private width: number, mat: THREE.Material) {
    const n = outline.length;
    // per point a quad of the band (2 triangles) and a fan triangle to the middle
    this.pos = new Float32Array(n * 3 * 9);
    this.col = new Float32Array(n * 3 * 12);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    // outward normals of the outline (pointing away from its middle)
    let cx = 0, cz = 0;
    for (const [x, z] of outline) { cx += x / n; cz += z / n; }
    this.normals = outline.map((_, i) => {
      const [ax, az] = outline[(i + n - 1) % n], [bx, bz] = outline[(i + 1) % n];
      let nx = bz - az, nz = -(bx - ax);
      const l = Math.hypot(nx, nz) || 1;
      nx /= l; nz /= l;
      if (nx * (outline[i][0] - cx) + nz * (outline[i][1] - cz) < 0) { nx = -nx; nz = -nz; }
      return [nx, nz];
    });
    this.length = Math.max(...outline.map(([, z]) => Math.abs(z))) || 1;
  }

  /** pos/forward of the hull, speed in m/s, time in s; off: nothing drawn (out of the water, aboard) */
  update(pos: THREE.Vector3, forward: THREE.Vector3, speed: number, time: number, on = true) {
    if (!on) { this.geo.setDrawRange(0, 0); return; }
    const f = forward, px = f.z, pz = -f.x;   // port (+x local) in world space
    const o = this.outline, n = o.length, A = 0.9;
    const wx = (x: number, z: number) => pos.x + px * x + f.x * z, wz = (x: number, z: number) => pos.z + pz * x + f.z * z;
    // the ripple: two slow waves running round the hull; the bow pushes the foam out under way
    const reach = o.map(([, z], i) => {
      const ripple = 1 + 0.3 * Math.sin(time * 1.6 + i * 0.85) + 0.16 * Math.sin(-time * 2.3 + i * 2.1);
      const push = Math.max(0, z / this.length) ** 2 * Math.min(Math.abs(speed), 25) * 0.45;
      return this.width * ripple + push;
    });
    let vi = 0, ci = 0;
    const put = (x: number, z: number, a: number) => {
      this.pos[vi++] = x; this.pos[vi++] = 0; this.pos[vi++] = z;
      this.col[ci++] = 1; this.col[ci++] = 1; this.col[ci++] = 1; this.col[ci++] = a;
    };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, [ax, az] = o[i], [bx, bz] = o[j];
      const [anx, anz] = this.normals[i], [bnx, bnz] = this.normals[j];
      const ox = ax + anx * reach[i], oz = az + anz * reach[i], qx = bx + bnx * reach[j], qz = bz + bnz * reach[j];
      put(wx(ax, az), wz(ax, az), A); put(wx(bx, bz), wz(bx, bz), A); put(wx(qx, qz), wz(qx, qz), 0);
      put(wx(ax, az), wz(ax, az), A); put(wx(qx, qz), wz(qx, qz), 0); put(wx(ox, oz), wz(ox, oz), 0);
      // the inside stays above the threshold (the dock shows foam, the rest is under the hull)
      put(pos.x, pos.z, A); put(wx(ax, az), wz(ax, az), A); put(wx(bx, bz), wz(bx, bz), A);
    }
    this.geo.setDrawRange(0, vi / 3);
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}
