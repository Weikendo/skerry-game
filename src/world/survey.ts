import type { Island } from './island';

const RES = 64;   // mask cells per island tile side (about 30–60 m per cell)

/**
 * What the player has mapped. Sea charts give every island's name, position and
 * coastline; terrain, buildings, owner and role only appear on the map once the
 * drone's camera has seen them. Own islands are known from the start.
 */
export class Survey {
  /** bumps when an island's mask changes (the map redraws its picture) */
  readonly version: number[];
  private masks: Uint8Array[];
  private land: Uint8Array[];
  private landCount: number[];
  private seenLand: number[];

  constructor(private islands: Island[]) {
    this.masks = islands.map(() => new Uint8Array(RES * RES));
    this.version = islands.map(() => 0);
    this.seenLand = islands.map(() => 0);
    this.land = islands.map(isl => {
      const m = new Uint8Array(RES * RES), c = isl.size / RES;
      for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
        const x = isl.cx - isl.size / 2 + (i + 0.5) * c, z = isl.cz - isl.size / 2 + (j + 0.5) * c;
        m[j * RES + i] = isl.heightAt(x, z) > 0.3 ? 1 : 0;
      }
      return m;
    });
    this.landCount = this.land.map(m => Math.max(1, m.reduce((a, v) => a + v, 0)));
  }

  /** mask cells per side */
  readonly res = RES;

  /** the camera saw a circle of radius r around (x, z) */
  reveal(x: number, z: number, r: number): Island[] {
    const touched: Island[] = [];
    this.islands.forEach((isl, k) => {
      const half = isl.size / 2;
      if (Math.abs(x - isl.cx) > half + r || Math.abs(z - isl.cz) > half + r) return;
      const c = isl.size / RES, m = this.masks[k], land = this.land[k];
      const x0 = isl.cx - half, z0 = isl.cz - half;
      const i0 = Math.max(0, Math.floor((x - r - x0) / c)), i1 = Math.min(RES - 1, Math.floor((x + r - x0) / c));
      const j0 = Math.max(0, Math.floor((z - r - z0) / c)), j1 = Math.min(RES - 1, Math.floor((z + r - z0) / c));
      let changed = false;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const idx = j * RES + i;
        if (m[idx]) continue;
        const cxp = x0 + (i + 0.5) * c, czp = z0 + (j + 0.5) * c;
        if ((cxp - x) ** 2 + (czp - z) ** 2 > r * r) continue;
        m[idx] = 1;
        this.seenLand[k] += land[idx];
        changed = true;
      }
      if (changed) { this.version[k]++; touched.push(isl); }
    });
    return touched;
  }

  revealAll(k: number) {
    this.masks[k].fill(1);
    this.seenLand[k] = this.landCount[k];
    this.version[k]++;
  }

  /** mapped share of the island's land, 0..1 */
  progress(k: number): number {
    return Math.min(1, this.seenLand[k] / this.landCount[k]);
  }

  /** enough seen to tell owner and role */
  known(k: number): boolean {
    return this.progress(k) >= 0.5;
  }

  /** has the cell at world (x, z) of island k been seen? */
  seen(k: number, x: number, z: number): boolean {
    const isl = this.islands[k], c = isl.size / RES;
    const i = Math.floor((x - isl.cx + isl.size / 2) / c), j = Math.floor((z - isl.cz + isl.size / 2) / c);
    if (i < 0 || j < 0 || i >= RES || j >= RES) return false;
    return this.masks[k][j * RES + i] === 1;
  }

  mask(k: number): Uint8Array {
    return this.masks[k];
  }

  // ---- save game: one bit per cell, all-seen and nothing-seen islands as a single letter ----
  saveState(): string[] {
    return this.masks.map(m => {
      let ones = 0;
      for (const v of m) ones += v;
      if (ones === 0) return '0';
      if (ones === m.length) return '1';
      const bytes = new Uint8Array(m.length / 8);
      for (let i = 0; i < m.length; i++) if (m[i]) bytes[i >> 3] |= 1 << (i & 7);
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      return btoa(bin);
    });
  }

  loadState(data: string[]) {
    data.forEach((d, k) => {
      if (k >= this.masks.length) return;
      const m = this.masks[k];
      if (d === '0' || d === '1') m.fill(d === '1' ? 1 : 0);
      else {
        const bin = atob(d);
        for (let i = 0; i < m.length; i++) m[i] = (bin.charCodeAt(i >> 3) >> (i & 7)) & 1;
      }
      let seen = 0;
      for (let i = 0; i < m.length; i++) seen += m[i] & this.land[k][i];
      this.seenLand[k] = seen;
      this.version[k]++;
    });
  }
}
