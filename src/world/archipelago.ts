import * as THREE from 'three';
import { DEPTH_MIN, DEPTH_RES, Island } from './island';
import { slopeFromHeights, type Ground } from './terrain';
import { hops, type WorldPlan } from './worldgen';

/** islands the ocean shader looks at per frame (the nearest ones) */
export const MAX_ISLANDS = 8;
const DETAIL_IN = 3500;    // start loading the fine terrain this close to an island
const DETAIL_OUT = 9000;   // drop it again beyond this
const BUDGET_MS = 6;       // per-frame time for streaming terrain rows

export class Archipelago implements Ground {
  readonly islands: Island[];
  readonly group = new THREE.Group();
  readonly size: number;
  /** how much farther apart the islands lie than among 64 (distances of the game that depend on it scale with it) */
  readonly spread: number;
  /** supply network as island index pairs */
  readonly links: [number, number][];
  /** atlas of all depth tiles in a square grid */
  readonly depthTexture: THREE.DataTexture;
  /** per shader slot: minX, minZ, size, size (world) — refilled every frame */
  readonly bounds: THREE.Vector4[] = [];
  /** per shader slot: u0, v0, du, dv in the atlas */
  readonly tiles: THREE.Vector4[] = [];
  /** called when an island got (true) or lost (false) its detailed terrain */
  onDetail: ((isl: Island, ready: boolean) => void) | null = null;
  private atlasCols: number;
  private atlasData: Uint8Array;
  private tileOf = new Map<Island, THREE.Vector4>();

  constructor(plan: WorldPlan) {
    this.size = plan.size;
    this.spread = plan.spread;
    this.links = plan.links;
    this.islands = plan.islands.map(d => new Island(d));
    for (const isl of this.islands) this.group.add(isl.group);

    const res = DEPTH_RES;
    this.atlasCols = Math.ceil(Math.sqrt(this.islands.length));
    const W = this.atlasCols * res;
    this.atlasData = new Uint8Array(W * W * 4);
    this.islands.forEach((isl, k) => {
      const cx = k % this.atlasCols, cy = Math.floor(k / this.atlasCols);
      // inset half a texel so linear filtering never reads the neighbour tile
      this.tileOf.set(isl, new THREE.Vector4((cx * res + 0.5) / W, (cy * res + 0.5) / W, (res - 1) / W, (res - 1) / W));
    });
    for (let i = 0; i < MAX_ISLANDS; i++) { this.bounds.push(new THREE.Vector4(1e9, 1e9, 1, 1)); this.tiles.push(new THREE.Vector4()); }
    this.depthTexture = new THREE.DataTexture(this.atlasData, W, W, THREE.RGBAFormat);
    this.depthTexture.magFilter = this.depthTexture.minFilter = THREE.LinearFilter;
    this.depthTexture.wrapS = this.depthTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.copyDirtyTiles();
    this.group.name = 'archipelago';
  }

  private copyDirtyTiles() {
    const res = DEPTH_RES, W = this.atlasCols * res;
    let any = false;
    this.islands.forEach((isl, k) => {
      if (!isl.depthDirty) return;
      const cx = k % this.atlasCols, cy = Math.floor(k / this.atlasCols);
      for (let j = 0; j < res; j++) {
        this.atlasData.set(isl.depthTile.subarray(j * res * 4, (j + 1) * res * 4), ((cy * res + j) * W + cx * res) * 4);
      }
      isl.depthDirty = false;
      any = true;
    });
    if (any) this.depthTexture.needsUpdate = true;
  }

  /**
   * Per frame: stream fine terrain for islands near any point of interest
   * (camera, units and what the console's monitors show), pick near/far
   * meshes and hand the nearest islands to the ocean shader.
   */
  update(camera: THREE.Vector3, interest: { x: number; z: number }[], farLimit: number) {
    const pts = [camera, ...interest];
    const dist = (isl: Island) => Math.min(...pts.map(p => isl.distanceTo(p.x, p.z)));
    let loading = this.islands.find(i => i.detail === 'laedt') ?? null;
    if (!loading) {
      let best: Island | null = null, bd = DETAIL_IN;
      for (const isl of this.islands) {
        if (isl.detail !== 'grob') continue;
        const d = dist(isl);
        if (d < bd) { bd = d; best = isl; }
      }
      if (best) { best.requestDetail(); loading = best; }
    }
    if (loading && loading.stepDetail(BUDGET_MS)) this.onDetail?.(loading, true);
    for (const isl of this.islands) {
      if (isl.detail === 'fein' && dist(isl) > DETAIL_OUT) { isl.dropDetail(); this.onDetail?.(isl, false); }
    }
    this.copyDirtyTiles();
    this.viewFrom(camera.x, camera.z, farLimit);
  }

  /**
   * Near or far meshes and the ocean's island slots for a view from (x, z).
   * A second view of the scene (a console monitor) sets its own before it
   * renders and the big picture's again afterwards.
   */
  viewFrom(x: number, z: number, farLimit: number) {
    for (const isl of this.islands) isl.updateLod(x, z, farLimit);
    // nearest islands into the shader slots
    const sorted = [...this.islands].sort((a, b) => a.distanceTo(x, z) - b.distanceTo(x, z));
    for (let i = 0; i < MAX_ISLANDS; i++) {
      const isl = sorted[i];
      if (isl) {
        this.bounds[i].set(isl.cx - isl.size / 2, isl.cz - isl.size / 2, isl.size, isl.size);
        this.tiles[i].copy(this.tileOf.get(isl)!);
      } else this.bounds[i].set(1e9, 1e9, 1, 1);
    }
  }

  /**
   * Hop counts over the links whose two islands satisfy `open` (in the original a
   * link only carries supplies when both ends have the same owner).
   */
  hopsFrom(from: number, open: (a: number, b: number) => boolean): number[] {
    const adj: number[][] = this.islands.map(() => []);
    for (const [a, b] of this.links) if (open(a, b)) { adj[a].push(b); adj[b].push(a); }
    return hops(adj, from);
  }

  islandAt(x: number, z: number): Island | null {
    for (const isl of this.islands) if (isl.contains(x, z)) return isl;
    return null;
  }

  nearest(x: number, z: number): { island: Island; distance: number } {
    let best = this.islands[0], bd = Infinity;
    for (const isl of this.islands) {
      const d = Math.hypot(x - isl.cx, z - isl.cz);
      if (d < bd) { bd = d; best = isl; }
    }
    return { island: best, distance: bd };
  }

  heightAt(x: number, z: number): number {
    const isl = this.islandAt(x, z);
    return isl ? isl.heightAt(x, z) : DEPTH_MIN;
  }

  slopeAt(x: number, z: number, d = 4): number {
    return slopeFromHeights(this, x, z, d);
  }

  setOverlay(on: boolean) {
    for (const isl of this.islands) isl.setOverlay(on);
  }
}
