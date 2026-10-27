import * as THREE from 'three';
import { hash2, lowPolyMaterial } from '../engine/lowpoly';
import { Noise2D, lerp } from '../engine/noise';
import { BIOME_NAMES, Basalt, createBiome, isPool, type Biome, type BiomeId } from './biomes';
import { buildColumns, disposeColumns } from './basalt';
import { LARGE_R, type IslandRole } from './worldgen';
import { OVERLAY, SHADOW_LAYER, SLOPE_COS, slopeFromHeights, type Ground, type TerrainStats } from './terrain';

export interface IslandOptions {
  name: string;
  biome: BiomeId;
  seed: number;
  x: number; z: number;   // world position of the centre
  R?: number;             // size scale (1000 = the original home island)
  /** who holds the island at the start */
  owner?: 'spieler' | 'feind' | 'neutral';
  /** what an owned island does (decides its buildings) */
  role?: IslandRole | null;
}

/** a landing place on a cliff coast (world coordinates): the only way ashore there */
export interface Landing {
  /** where its axis crosses the coast line */
  x: number; z: number;
  /** unit vector along its axis, out to sea */
  nx: number; nz: number;
  /** on the upland behind its top, at its foot in the water, and out in open water in front of it */
  top: { x: number; z: number }; foot: { x: number; z: number }; approach: { x: number; z: number };
}

export const DEPTH_RES = 256;
export const DEPTH_MIN = -40, DEPTH_RANGE = 50; // encoding of the water-depth tile
const COARSE = 20, FINE = 10, FAR_CELL = 40;
const SHARED_MAT = lowPolyMaterial({ side: THREE.FrontSide });
/**
 * Shade in hollows (after the low-poly article's baked ambient occlusion): a point that lies below the mean height
 * of its surroundings (`near` and `far` m round) gets darker and a little cooler, fully at `nearDepth` / `farDepth`
 * m below, by `darken` per channel. So the feet of mountains and the floors of valleys darken; flat land stays.
 */
const HOLLOW = { near: 30, far: 100, nearDepth: 3, farDepth: 8, darken: [0.44, 0.40, 0.30] };

/** slow noise for the colour patches (see colourSeed) */
const PATCHES = new Noise2D(4242);
/**
 * Calm colours: a biome picks between its colours by a number per triangle, which set light and dark facets side by
 * side like confetti. Now only a quarter of that number is the triangle's own and three quarters come from a slow
 * noise (patches some 80 m across), so neighbours mostly agree and facets differ mainly by their light. World
 * coordinates; the map's island chart uses it too.
 */
export function colourSeed(x: number, z: number, own: number): number {
  return lerp(0.5 + 0.5 * PATCHES.get(x * 0.012, z * 0.012), own, 0.25);
}

interface Grid { cell: number; N: number; data: Float32Array }

export type DetailState = 'grob' | 'laedt' | 'fein';

/**
 * One island. Everything starts coarse (20 m height grid, far mesh, water
 * depth tile); the fine 10 m grid, the faceted near mesh and shadow proxy
 * are built only when the island comes close — computed a few rows per
 * frame so nothing stutters — and dropped again when it is far away.
 */
export class Island implements Ground {
  readonly name: string;
  readonly owner: 'spieler' | 'feind' | 'neutral';
  /** changes when an ACCB founds a new base */
  role: IslandRole | null;
  /** large islands get more buildings (original: area class) */
  readonly large: boolean;
  readonly biome: Biome;
  readonly cx: number; readonly cz: number;
  readonly size: number;
  readonly group = new THREE.Group();
  readonly depthTile = new Uint8Array(DEPTH_RES * DEPTH_RES * 4);
  readonly depthRes = DEPTH_RES;
  /** set when depthTile changed (the archipelago copies it into the atlas) */
  depthDirty = true;
  detail: DetailState = 'grob';
  stats: TerrainStats | null = null;
  private coarse: Grid;
  private fine: Grid | null = null;
  private loading: { grid: Grid; row: number } | null = null;
  private far: THREE.Mesh;
  private near: THREE.Mesh | null = null;
  private proxy: THREE.Mesh | null = null;
  private natural: Float32Array | null = null;
  private overlay: Float32Array | null = null;
  private overlayOn = false;
  /** a basalt island's columns, built with the fine terrain */
  private columns: THREE.Group | null = null;
  /** where Otters get ashore on a cliff coast (empty: anywhere) */
  readonly landings: Landing[];

  constructor(o: IslandOptions) {
    const R = o.R ?? 1000;
    this.name = o.name;
    this.owner = o.owner ?? 'neutral';
    this.role = o.role ?? null;
    this.large = R >= LARGE_R;
    this.cx = o.x; this.cz = o.z;
    this.size = Math.round((R * 2.8) / COARSE) * COARSE;
    this.biome = createBiome(o.biome, o.seed, R);
    this.coarse = this.newGrid(COARSE);
    for (let j = 0; j <= this.coarse.N; j++) this.fillRow(this.coarse, j);
    this.far = this.buildMesh(FAR_CELL, 0.5, false);
    this.group.add(this.far);
    this.buildDepthTile();
    this.landings = this.biome.landings.map(L => {
      const at = (s: number) => ({ x: this.cx + L.x + L.nx * s, z: this.cz + L.z + L.nz * s });
      return { x: this.cx + L.x, z: this.cz + L.z, nx: L.nx, nz: L.nz, top: at(-40), foot: at(L.dry), approach: at(L.reach + 90) };
    });
    this.group.name = `island-${this.name}`;
  }

  get biomeName(): string {
    return BIOME_NAMES[this.biome.id];
  }

  contains(x: number, z: number, margin = 0): boolean {
    const h = this.size / 2 - margin;
    return Math.abs(x - this.cx) < h && Math.abs(z - this.cz) < h;
  }

  /** distance from a point to the island's square (0 inside) */
  distanceTo(x: number, z: number): number {
    const dx = Math.max(0, Math.abs(x - this.cx) - this.size / 2), dz = Math.max(0, Math.abs(z - this.cz) - this.size / 2);
    return Math.hypot(dx, dz);
  }

  // ---------- heights ----------
  private newGrid(cell: number): Grid {
    const N = Math.round(this.size / cell);
    return { cell, N, data: new Float32Array((N + 1) * (N + 1)) };
  }

  private fillRow(g: Grid, j: number) {
    const half = this.size / 2, N1 = g.N + 1;
    for (let i = 0; i < N1; i++) g.data[j * N1 + i] = this.biome.height(-half + i * g.cell, -half + j * g.cell);
  }

  /** bilinear height from the finest grid available (world coordinates) */
  heightAt(x: number, z: number): number {
    const g = this.fine ?? this.coarse, half = this.size / 2;
    const fx = (x - this.cx + half) / g.cell, fz = (z - this.cz + half) / g.cell;
    if (fx < 0 || fz < 0 || fx > g.N || fz > g.N) return DEPTH_MIN;
    const i = Math.min(g.N - 1, Math.floor(fx)), j = Math.min(g.N - 1, Math.floor(fz));
    const tx = fx - i, tz = fz - j, N1 = g.N + 1, d = g.data;
    const a = d[j * N1 + i], b = d[j * N1 + i + 1], c = d[(j + 1) * N1 + i], e = d[(j + 1) * N1 + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + e * tx) * tz;
  }

  /** how deep (x, z) lies in a hollow, 0..1, like the meshes' hollows() but from rings of height samples (for the
   *  map's island chart, whose grid is too coarse for the box means) */
  hollowAt(x: number, z: number): number {
    const h = this.heightAt(x, z);
    if (h < 0.5) return 0;
    const ring = (r: number) => { let s = 0; for (let k = 0; k < 8; k++) s += this.heightAt(x + Math.cos(k * Math.PI / 4) * r, z + Math.sin(k * Math.PI / 4) * r); return s / 8; };
    const near = (ring(HOLLOW.near / 2) + ring(HOLLOW.near)) / 2, far = (ring(HOLLOW.far / 2) + ring(HOLLOW.far)) / 2;
    return Math.min(1, Math.max(0, 0.6 * (near - h) / HOLLOW.nearDepth + 0.4 * (far - h) / HOLLOW.farDepth));
  }

  slopeAt(x: number, z: number, d = 4): number {
    return slopeFromHeights(this, x, z, d);
  }

  // ---------- detail streaming ----------
  requestDetail() {
    if (this.detail !== 'grob') return;
    this.detail = 'laedt';
    this.loading = { grid: this.newGrid(FINE), row: 0 };
  }

  /** compute fine rows until the time budget is used up; true when the island became detailed */
  stepDetail(budgetMs: number): boolean {
    if (!this.loading) return false;
    // a basalt island's columns come a frame after its mesh, so the two do not stutter together
    if (this.fine && this.biome instanceof Basalt) {
      this.columns = buildColumns(this, this.biome);
      this.group.add(this.columns);
      return this.detailDone();
    }
    const t0 = performance.now(), L = this.loading;
    while (L.row <= L.grid.N && performance.now() - t0 < budgetMs) this.fillRow(L.grid, L.row++);
    if (L.row <= L.grid.N) return false;
    this.fine = L.grid;
    this.near = this.buildMesh(FINE, 0.75, true);
    this.group.add(this.near);
    this.proxy = this.buildShadowProxy(22);
    this.group.add(this.proxy);
    return this.biome instanceof Basalt ? false : this.detailDone();
  }

  private detailDone(): boolean {
    this.loading = null;
    this.buildDepthTile();
    this.detail = 'fein';
    if (this.overlayOn) this.setOverlay(true);
    return true;
  }

  dropDetail() {
    if (this.detail === 'grob') return;
    this.loading = null;
    for (const m of [this.near, this.proxy]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
      if (m !== this.near) (m.material as THREE.Material).dispose();
    }
    this.near = this.proxy = null;
    if (this.columns) { this.group.remove(this.columns); disposeColumns(this.columns); this.columns = null; }
    this.natural = this.overlay = null;
    this.fine = null;
    this.detail = 'grob';
    this.buildDepthTile();
  }

  /** near or far mesh by distance; far islands beyond the fog are not drawn at all */
  updateLod(camX: number, camZ: number, farLimit: number) {
    const d = this.distanceTo(camX, camZ);
    const near = !!this.near && d < 3500;
    if (this.near) this.near.visible = near;
    if (this.columns) this.columns.visible = near;
    this.far.visible = !near && d < farLimit;
    this.group.visible = d < farLimit;
  }

  setOverlay(on: boolean) {
    this.overlayOn = on;
    if (!this.near || !this.natural || !this.overlay) return;
    const attr = this.near.geometry.getAttribute('color') as THREE.BufferAttribute;
    (attr.array as Float32Array).set(on ? this.overlay : this.natural);
    attr.needsUpdate = true;
  }

  // ---------- meshes ----------
  private buildMesh(cell: number, jitter: number, detailed: boolean): THREE.Mesh {
    const N = Math.round(this.size / cell), half = this.size / 2;
    const N1 = N + 1;
    const px = new Float32Array(N1 * N1), pz = new Float32Array(N1 * N1), py = new Float32Array(N1 * N1);
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const k = j * N1 + i;
      const edge = i === 0 || j === 0 || i === N || j === N;
      px[k] = this.cx - half + i * cell + (edge ? 0 : (hash2(i, j, 1) - 0.5) * cell * jitter);
      pz[k] = this.cz - half + j * cell + (edge ? 0 : (hash2(i, j, 2) - 0.5) * cell * jitter);
      py[k] = this.heightAt(px[k], pz[k]);
      if (detailed) py[k] -= this.biome.meshDrop(px[k] - this.cx, pz[k] - this.cz, py[k]);
    }
    const hollow = hollows(py, N1, cell), slope = smoothSlope(py, N1, cell);
    const pos: number[] = [], col: number[] = [], ovl: number[] = [];
    const area = { land: 0, build: 0, drive: 0, steep: 0, blocked: 0 };
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
    const color = new THREE.Color();

    const emit = (ka: number, kb: number, kc: number, seed: number) => {
      if (py[ka] < -7 && py[kb] < -7 && py[kc] < -7) return; // hidden under opaque water
      a.set(px[ka], py[ka], pz[ka]); b.set(px[kb], py[kb], pz[kb]); c.set(px[kc], py[kc], pz[kc]);
      nrm.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
      const triArea = nrm.length() / 2;
      nrm.normalize();
      const flip = nrm.y < 0;
      if (flip) nrm.negate();
      const cy = (a.y + b.y + c.y) / 3;
      const lx = (a.x + b.x + c.x) / 3 - this.cx, lz = (a.z + b.z + c.z) / 3 - this.cz;
      const verts = flip ? [a, c, b] : [a, b, c];
      // the colour by the slope over a few cells, so a single steep facet keeps its surroundings' colour (only its
      // light differs), and in patches (colourSeed); the overlay below goes by the facet's own slope
      const ny = (slope[ka] + slope[kb] + slope[kc]) / 3;
      const o = (hollow[ka] + hollow[kb] + hollow[kc]) / 3;
      this.biome.color(lx, cy, lz, ny, colourSeed(lx + this.cx, lz + this.cz, seed), color, o);
      if (o > 0 && !isPool(color)) color.setRGB(color.r * (1 - HOLLOW.darken[0] * o), color.g * (1 - HOLLOW.darken[1] * o), color.b * (1 - HOLLOW.darken[2] * o));

      let cls = color;
      if (detailed && cy > 0.5) {
        area.land += triArea;
        if (nrm.y >= SLOPE_COS.BUILD) { area.build += triArea; cls = OVERLAY.build; }
        else if (nrm.y >= SLOPE_COS.DRIVE) { area.drive += triArea; cls = OVERLAY.drive; }
        else if (nrm.y >= SLOPE_COS.STEEP) { area.steep += triArea; cls = OVERLAY.steep; }
        else { area.blocked += triArea; cls = OVERLAY.blocked; }
      }
      for (const p of verts) {
        pos.push(p.x, p.y, p.z);
        col.push(color.r, color.g, color.b);
        if (detailed) ovl.push(cls.r, cls.g, cls.b);
      }
    };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k00 = j * N1 + i, k10 = k00 + 1, k01 = k00 + N1, k11 = k01 + 1;
      const s = hash2(i, j, 3);
      if (s < 0.5) { emit(k00, k01, k11, hash2(i, j, 4)); emit(k00, k11, k10, hash2(i, j, 5)); }
      else { emit(k00, k01, k10, hash2(i, j, 4)); emit(k10, k01, k11, hash2(i, j, 5)); }
    }
    if (detailed) {
      const L = area.land || 1;
      this.stats = { landKm2: area.land / 1e6, build: area.build / L, drive: area.drive / L, steep: area.steep / L, blocked: area.blocked / L };
      this.natural = new Float32Array(col);
      this.overlay = new Float32Array(ovl);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, SHARED_MAT);
    mesh.receiveShadow = true;
    mesh.name = detailed ? 'terrain' : 'terrain-far';
    return mesh;
  }

  /** coarse copy that only renders into the shadow map, a bit lower to avoid acne */
  private buildShadowProxy(cell: number): THREE.Mesh {
    const N = Math.round(this.size / cell);
    const g = new THREE.PlaneGeometry(this.size, this.size, N, N).rotateX(-Math.PI / 2).translate(this.cx, 0, this.cz);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setY(i, this.heightAt(p.getX(i), p.getZ(i)) - 1.5);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.castShadow = true;
    mesh.layers.set(SHADOW_LAYER);
    mesh.name = 'terrain-shadow-proxy';
    return mesh;
  }

  /** R: ground height for water depth, G: 255 where the water is frozen */
  private buildDepthTile() {
    const res = DEPTH_RES, half = this.size / 2;
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const lx = -half + ((i + 0.5) / res) * this.size, lz = -half + ((j + 0.5) / res) * this.size;
      const h = this.heightAt(this.cx + lx, this.cz + lz);
      const k = (j * res + i) * 4;
      this.depthTile[k] = Math.round(THREE.MathUtils.clamp((h - DEPTH_MIN) / DEPTH_RANGE, 0, 1) * 255);
      this.depthTile[k + 1] = this.biome.surface(lx, Math.min(h, 0.1), lz) === 'ice' ? 255 : 0;
      this.depthTile[k + 2] = 0;
      this.depthTile[k + 3] = 255;
    }
    this.depthDirty = true;
  }
}

/** per grid point of a mesh (N1 × N1 heights, `cell` m apart): how deep it lies in a hollow, 0..1 (see HOLLOW); the
 *  box means come from a summed-area table, so this costs a few milliseconds per mesh; points under water stay 0 */
function hollows(py: Float32Array, N1: number, cell: number): Float32Array {
  const W = N1 + 1, sum = new Float64Array(W * W);
  for (let j = 0; j < N1; j++) {
    let row = 0;
    for (let i = 0; i < N1; i++) { row += py[j * N1 + i]; sum[(j + 1) * W + i + 1] = sum[j * W + i + 1] + row; }
  }
  const mean = (i: number, j: number, r: number) => {
    const i0 = Math.max(0, i - r), j0 = Math.max(0, j - r), i1 = Math.min(N1 - 1, i + r), j1 = Math.min(N1 - 1, j + r);
    const s = sum[(j1 + 1) * W + i1 + 1] - sum[j0 * W + i1 + 1] - sum[(j1 + 1) * W + i0] + sum[j0 * W + i0];
    return s / ((i1 - i0 + 1) * (j1 - j0 + 1));
  };
  const r1 = Math.max(1, Math.round(HOLLOW.near / cell)), r2 = Math.max(2, Math.round(HOLLOW.far / cell));
  const out = new Float32Array(N1 * N1);
  for (let j = 0; j < N1; j++) for (let i = 0; i < N1; i++) {
    const k = j * N1 + i, h = py[k];
    if (h < 0.5) continue;
    const o = 0.6 * (mean(i, j, r1) - h) / HOLLOW.nearDepth + 0.4 * (mean(i, j, r2) - h) / HOLLOW.farDepth;
    out[k] = Math.min(1, Math.max(0, o));
  }
  return out;
}

/** per grid point of a mesh (N1 × N1 heights, `cell` m apart): the up component of the ground's normal over two cells either side */
function smoothSlope(py: Float32Array, N1: number, cell: number): Float32Array {
  const out = new Float32Array(N1 * N1), r = 2;
  for (let j = 0; j < N1; j++) for (let i = 0; i < N1; i++) {
    const i0 = Math.max(0, i - r), i1 = Math.min(N1 - 1, i + r), j0 = Math.max(0, j - r), j1 = Math.min(N1 - 1, j + r);
    const gx = (py[j * N1 + i1] - py[j * N1 + i0]) / ((i1 - i0) * cell), gz = (py[j1 * N1 + i] - py[j0 * N1 + i]) / ((j1 - j0) * cell);
    out[j * N1 + i] = 1 / Math.sqrt(1 + gx * gx + gz * gz);
  }
  return out;
}
