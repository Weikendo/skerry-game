import * as THREE from 'three';

export type V3 = [number, number, number];
export type ColorLike = THREE.ColorRepresentation;

const tmpColor = new THREE.Color();
const tmpVec = new THREE.Vector3();

/**
 * Collects flat-coloured polygons and turns them into a non-indexed geometry
 * with per-vertex colours. Every face gets its own vertices, so normals are
 * per face and the result is faceted without any extra shader work.
 */
export class LowPolyBuilder {
  private pos: number[] = [];
  private col: number[] = [];
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];

  get matrix(): THREE.Matrix4 {
    return this.stack[this.stack.length - 1];
  }

  push(m: THREE.Matrix4): this {
    this.stack.push(this.matrix.clone().multiply(m));
    return this;
  }

  pushTRS(t: V3, rotY = 0, s: V3 = [1, 1, 1], rotX = 0, rotZ = 0): this {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...t),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ')),
      new THREE.Vector3(...s),
    );
    return this.push(m);
  }

  pop(): this {
    if (this.stack.length > 1) this.stack.pop();
    return this;
  }

  private vert(p: V3, c: THREE.Color) {
    tmpVec.set(p[0], p[1], p[2]).applyMatrix4(this.matrix);
    this.pos.push(tmpVec.x, tmpVec.y, tmpVec.z);
    this.col.push(c.r, c.g, c.b);
  }

  tri(a: V3, b: V3, c: V3, color: ColorLike): this {
    tmpColor.set(color);
    this.vert(a, tmpColor);
    this.vert(b, tmpColor);
    this.vert(c, tmpColor);
    return this;
  }

  /** Convex polygon, fan-triangulated. */
  poly(points: V3[], color: ColorLike): this {
    for (let i = 1; i + 1 < points.length; i++) this.tri(points[0], points[i], points[i + 1], color);
    return this;
  }

  quad(a: V3, b: V3, c: V3, d: V3, color: ColorLike): this {
    return this.poly([a, b, c, d], color);
  }

  /** Axis-aligned box; `colors` may give top/bottom/sides separately. */
  box(min: V3, max: V3, colors: ColorLike | { top?: ColorLike; bottom?: ColorLike; side: ColorLike; front?: ColorLike; back?: ColorLike }): this {
    const c = typeof colors === 'object' && colors !== null && 'side' in colors ? colors : { side: colors as ColorLike };
    const top = c.top ?? c.side, bottom = c.bottom ?? c.side;
    const front = c.front ?? c.side, back = c.back ?? c.side;
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], top);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], bottom);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], front);
    this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], back);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], c.side);
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], c.side);
    return this;
  }

  /**
   * Prism from a 2D profile (x, y) extruded along z between z0 and z1.
   */
  prismZ(profile: [number, number][], z0: number, z1: number, side: ColorLike, cap: ColorLike = side): this {
    const n = profile.length;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = profile[i], [bx, by] = profile[(i + 1) % n];
      this.quad([ax, ay, z0], [bx, by, z0], [bx, by, z1], [ax, ay, z1], side);
    }
    this.poly(profile.map(([x, y]) => [x, y, z1] as V3), cap);
    this.poly(profile.map(([x, y]) => [x, y, z0] as V3).reverse(), cap);
    return this;
  }

  /** Vertical n-sided cylinder / frustum standing on y = y0. */
  cylinder(center: V3, rBottom: number, rTop: number, height: number, sides: number, side: ColorLike, top: ColorLike = side, bottom: ColorLike | null = null, phase = 0): this {
    if (rTop <= 1e-6) return this.cone(center, rBottom, height, sides, side, phase, bottom);
    const [cx, cy, cz] = center;
    const ring = (r: number, y: number): V3[] => Array.from({ length: sides }, (_, i) => {
      const a = phase + (i / sides) * Math.PI * 2;
      return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
    });
    const lo = ring(rBottom, cy), hi = ring(rTop, cy + height);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.quad(lo[i], lo[j], hi[j], hi[i], side);
    }
    this.poly([...hi].reverse(), top);
    if (bottom !== null) this.poly(lo, bottom);
    return this;
  }

  /** Cone with apex above center. */
  cone(center: V3, r: number, height: number, sides: number, color: ColorLike, phase = 0, bottom: ColorLike | null = null): this {
    const [cx, cy, cz] = center;
    const apex: V3 = [cx, cy + height, cz];
    const ring: V3[] = Array.from({ length: sides }, (_, i) => {
      const a = phase + (i / sides) * Math.PI * 2;
      return [cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r];
    });
    for (let i = 0; i < sides; i++) this.tri(ring[i], ring[(i + 1) % sides], apex, color);
    if (bottom !== null) this.poly([...ring].reverse(), bottom);
    return this;
  }

  /** Square beam of thickness t from point a to point b (lattice masts, pipes). */
  beam(a: V3, b: V3, t: number, color: ColorLike): this {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va);
    const len = dir.length();
    if (len < 1e-6) return this;
    dir.normalize();
    const helper = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const x = new THREE.Vector3().crossVectors(helper, dir).normalize();
    const y = new THREE.Vector3().crossVectors(dir, x);
    const m = new THREE.Matrix4().makeBasis(x, y, dir).setPosition(va);
    this.push(m);
    this.box([-t / 2, -t / 2, 0], [t / 2, t / 2, len], color);
    return this.pop();
  }

  /** Merge raw triangles of another geometry (non-indexed) with one colour. */
  geometry(g: THREE.BufferGeometry, color: ColorLike): this {
    const src = g.index ? g.toNonIndexed() : g;
    const p = src.getAttribute('position');
    tmpColor.set(color);
    for (let i = 0; i < p.count; i++) this.vert([p.getX(i), p.getY(i), p.getZ(i)], tmpColor);
    return this;
  }

  get triangleCount(): number {
    return this.pos.length / 9;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** Standard material for faceted, vertex-coloured models. */
export function lowPolyMaterial(opts: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, ...opts });
}

/** Deterministic pseudo random in [0, 1) from integers / floats. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul((x | 0) ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul((y | 0) + seed * 0x3c6ef372, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
