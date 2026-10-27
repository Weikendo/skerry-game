import * as THREE from 'three';
import type { Archipelago } from '../world/archipelago';
import type { Island } from '../world/island';

/** a point in world x/z */
export interface P2 { x: number; z: number }

/** the routing grid's cell (m) */
const CELL = 10;
/** how far out round an island's square the grid reaches (m): open water all round */
const MARGIN = 400;
/** an Otter floats over ground this deep (m): water shallower than this by a cliff counts as the cliff (on the 10 m grid its foot blurs out into the sea) */
const AFLOAT = -6;
/** the steepest ground a route uses (°), well under the Otter's own limit (SLOPE.STEEP) */
const MAX_SLOPE = 22;
/** a landing's ramp: its middle this wide either side (m) is always a way, from the top down to the water in front */
const LANE = 14;

/**
 * Where an Otter can go round one island with cliffs: a 10 m grid over its square and some open water round it,
 * free where the Otter floats or the ground is gentle, and at least a cell away from anything steeper. The middle
 * of each landing's ramp is free whatever the grid says (its sides blur into the cliffs on a coarse grid).
 */
class NavGrid {
  readonly x0: number; readonly z0: number; readonly N: number;
  readonly free: Uint8Array;

  constructor(world: Archipelago, isl: Island) {
    const half = isl.size / 2 + MARGIN, N = Math.ceil(2 * half / CELL) + 1;
    this.x0 = isl.cx - half; this.z0 = isl.cz - half; this.N = N;
    const H = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = world.heightAt(this.x0 + i * CELL, this.z0 + j * CELL);
    const raw = new Uint8Array(N * N), tanMax = Math.tan(THREE.MathUtils.degToRad(MAX_SLOPE));
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (H[k] < AFLOAT) { raw[k] = 1; continue; }
      if (j === 0 || i === 0 || j === N - 1 || i === N - 1) continue;
      const gx = (H[k + 1] - H[k - 1]) / (2 * CELL), gz = (H[k + N] - H[k - N]) / (2 * CELL);
      raw[k] = Math.hypot(gx, gz) <= tanMax ? 1 : 0;
    }
    // a cell of room to anything steep (beyond the grid's edge: open water)
    const free = this.free = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let ok = raw[j * N + i];
      for (let v = -1; v <= 1 && ok; v++) for (let w = -1; w <= 1; w++) {
        const jj = j + v, ii = i + w;
        if (jj >= 0 && ii >= 0 && jj < N && ii < N && !raw[jj * N + ii]) { ok = 0; break; }
      }
      free[j * N + i] = ok;
    }
    for (const L of isl.landings) {
      const s0 = (L.top.x - L.x) * L.nx + (L.top.z - L.z) * L.nz, s1 = (L.approach.x - L.x) * L.nx + (L.approach.z - L.z) * L.nz;
      for (let s = s0; s <= s1; s += CELL / 2) for (let u = -LANE; u <= LANE; u += CELL / 2) {
        const k = this.node(L.x + L.nx * s - L.nz * u, L.z + L.nz * s + L.nx * u);
        if (k >= 0) free[k] = 1;
      }
    }
  }

  /** block the nodes under buildings (with room for an Otter round them) until the returned function undoes it */
  block(obstacles: { x: number; z: number; r: number }[]): () => void {
    const changed: number[] = [], N = this.N;
    for (const o of obstacles) {
      const r = o.r + 6, i0 = Math.max(0, Math.floor((o.x - r - this.x0) / CELL)), i1 = Math.min(N - 1, Math.ceil((o.x + r - this.x0) / CELL));
      const j0 = Math.max(0, Math.floor((o.z - r - this.z0) / CELL)), j1 = Math.min(N - 1, Math.ceil((o.z + r - this.z0) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * N + i;
        if (this.free[k] && Math.hypot(this.x0 + i * CELL - o.x, this.z0 + j * CELL - o.z) < r) { this.free[k] = 0; changed.push(k); }
      }
    }
    return () => { for (const k of changed) this.free[k] = 1; };
  }

  /** the nearest node to a world point (-1 outside) */
  node(x: number, z: number): number {
    const i = Math.round((x - this.x0) / CELL), j = Math.round((z - this.z0) / CELL);
    return i < 0 || j < 0 || i >= this.N || j >= this.N ? -1 : j * this.N + i;
  }

  at(k: number): P2 { return { x: this.x0 + (k % this.N) * CELL, z: this.z0 + Math.floor(k / this.N) * CELL }; }

  /** every node round a point is free (outside the grid: open water) */
  clear(x: number, z: number): boolean {
    const fx = (x - this.x0) / CELL, fz = (z - this.z0) / CELL;
    const i = Math.floor(fx), j = Math.floor(fz), N = this.N;
    if (i < 0 || j < 0 || i >= N - 1 || j >= N - 1) return true;
    const k = j * N + i;
    return !!(this.free[k] && this.free[k + 1] && this.free[k + N] && this.free[k + N + 1]);
  }

  /** a straight drive from a to b keeps clear */
  lineFree(a: P2, b: P2): boolean {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 4);
    for (let i = 0; i <= n; i++) if (!this.clear(a.x + (b.x - a.x) * i / n, a.z + (b.z - a.z) * i / n)) return false;
    return true;
  }

  /** the free node nearest to a point, within a few cells (-1: none) */
  private snap(p: P2): number {
    const k0 = this.node(p.x, p.z);
    if (k0 < 0) return -1;
    if (this.free[k0]) return k0;
    const N = this.N, i0 = k0 % N, j0 = Math.floor(k0 / N);
    for (let r = 1; r <= 15; r++) {
      let best = -1, bd = Infinity;
      for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
        if (i < 0 || j < 0 || i >= N || j >= N || Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== r) continue;
        const k = j * N + i, q = this.at(k), d = Math.hypot(q.x - p.x, q.z - p.z);
        if (this.free[k] && d < bd) { bd = d; best = k; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /**
   * A* from a to b over the free nodes (8 neighbours), pulled straight where the line keeps clear: the points after a,
   * the last one b itself if it is free, else the nearest free spot to it. Null when there is no way.
   */
  search(a: P2, b: P2): P2[] | null {
    const s = this.snap(a), t = this.snap(b);
    if (s < 0 || t < 0) return null;
    const N = this.N, n = N * N;
    const g = new Float32Array(n).fill(Infinity), from = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    const ti = t % N, tj = Math.floor(t / N);
    const h = (k: number) => {
      const dx = Math.abs(k % N - ti), dz = Math.abs(Math.floor(k / N) - tj);
      return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * CELL;
    };
    // a binary heap of nodes by g + h
    const heap: number[] = [], f = new Float32Array(n);
    const push = (k: number) => {
      heap.push(k);
      for (let c = heap.length - 1; c > 0;) { const p = (c - 1) >> 1; if (f[heap[p]] <= f[heap[c]]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let c = 0; ;) {
          const l = 2 * c + 1, r = l + 1;
          let m = c;
          if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l;
          if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r;
          if (m === c) break;
          [heap[m], heap[c]] = [heap[c], heap[m]]; c = m;
        }
      }
      return top;
    };
    g[s] = 0; f[s] = h(s); push(s);
    const steps: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    let found = false;
    while (heap.length) {
      const k = pop();
      if (done[k]) continue;
      done[k] = 1;
      if (k === t) { found = true; break; }
      const i = k % N, j = Math.floor(k / N);
      for (const [di, dj, c] of steps) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const m = nj * N + ni;
        if (!this.free[m] || done[m]) continue;
        // no corner cutting past a blocked node
        if (di && dj && (!this.free[j * N + ni] || !this.free[nj * N + i])) continue;
        const ng = g[k] + c * CELL;
        if (ng < g[m]) { g[m] = ng; from[m] = k; f[m] = ng + h(m); push(m); }
      }
    }
    if (!found) return null;
    const nodes: number[] = [];
    for (let k = t; k >= 0; k = from[k]) nodes.push(k);
    nodes.reverse();
    // pull the string: from each point on to the farthest node still in a clear line (from a start off the free
    // nodes, to the nearest one first)
    const out: P2[] = [];
    let at: P2 = a;
    for (let i = this.clear(a.x, a.z) ? 1 : 0; i < nodes.length;) {
      let j = i;
      while (j + 1 < nodes.length && this.lineFree(at, this.at(nodes[j + 1]))) j++;
      at = this.at(nodes[j]);
      out.push(at);
      i = j + 1;
    }
    // the goal itself where it is free and in a clear line from the last point
    if (this.clear(b.x, b.z) && (!out.length || this.lineFree(out[out.length - 1], b))) { if (out.length) out[out.length - 1] = b; else out.push(b); }
    else if (!out.length) out.push(this.at(t));
    return out;
  }
}

/**
 * Routes for Otters round and onto islands with cliff coasts (basalt): up and down only at their landing places,
 * never into a cliff, and round the buildings standing there. Elsewhere an Otter drives straight as before.
 */
export class OtterRoutes {
  private grids = new Map<Island, NavGrid>();

  /** `obstacles`: the buildings (kept up to date by the game) */
  constructor(private world: Archipelago, private obstacles: { x: number; z: number; r: number }[] = []) {}

  /** nothing steep lies on the straight line from a to b (on any island with cliffs) */
  clearWay(a: P2, b: P2): boolean {
    for (const isl of this.world.islands) {
      if (!isl.landings.length) continue;
      const half = isl.size / 2 + MARGIN - CELL;
      const t = clip(a, b, isl.cx - half, isl.cx + half, isl.cz - half, isl.cz + half);
      if (!t) continue;
      const p = (u: number): P2 => ({ x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u });
      if (!this.grid(isl).lineFree(p(t[0]), p(t[1]))) return false;
    }
    return true;
  }

  /** the point is ashore on an island with cliffs */
  ashore(p: P2): boolean {
    const isl = this.world.islandAt(p.x, p.z);
    return !!isl?.landings.length && isl.heightAt(p.x, p.z) > 0.5;
  }

  private grid(isl: Island): NavGrid {
    let g = this.grids.get(isl);
    if (!g) { g = new NavGrid(this.world, isl); this.grids.set(isl, g); }
    return g;
  }

  /**
   * The way from `from` to `to`: the points to drive through, the last one `to` itself (or, if that cannot be
   * reached, the nearest spot to it that can). Null when the straight line will do, or no way was found (then the
   * Otter tries the straight line as before; past an island it finds no way round, likewise).
   */
  plan(from: P2, to: P2): P2[] | null {
    const legs: { isl: Island; t0: number; t1: number }[] = [];
    for (const isl of this.world.islands) {
      if (!isl.landings.length) continue;
      const half = isl.size / 2 + MARGIN - CELL;
      const t = clip(from, to, isl.cx - half, isl.cx + half, isl.cz - half, isl.cz + half);
      if (t) legs.push({ isl, t0: t[0], t1: t[1] });
    }
    if (!legs.length) return null;
    legs.sort((p, q) => p.t0 - q.t0);
    const at = (t: number): P2 => ({ x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t });
    const out: P2[] = [];
    // (after a detour that left a grid, the way goes on to `to`; one that ended in it ends at `to` or the spot nearest it)
    let open = true;
    for (const { isl, t0, t1 } of legs) {
      const g = this.grid(isl), a = t0 > 0 ? at(t0) : from, b = t1 < 1 ? at(t1) : to;
      if (g.lineFree(a, b)) continue;
      // round the buildings too; if they shut it in (a base just founded round it), round the cliffs only: it
      // slides along buildings anyway. (No way at all: straight on past this island, as before.)
      const undo = g.block(this.obstacles);
      let way = g.search(a, b);
      undo();
      way ??= g.search(a, b);
      if (!way) continue;
      // (where the straight line enters the grid, drive there first)
      if (t0 > 0) out.push(a);
      out.push(...way);
      open = t1 < 1;
    }
    if (!out.length) return null;
    if (open) out.push(to);
    return out;
  }
}

/** the part t0..t1 of the segment a→b inside the box (Liang–Barsky), or null */
function clip(a: P2, b: P2, x0: number, x1: number, z0: number, z1: number): [number, number] | null {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dz, a.z - z0], [dz, z1 - a.z]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [t0, t1];
}
