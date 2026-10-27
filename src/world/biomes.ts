import * as THREE from 'three';
import { hash2, mulberry32 } from '../engine/lowpoly';
import { Noise2D, lerp, smoothstep } from '../engine/noise';
import { PAL, type PalName } from '../engine/palette';
import { t } from '../i18n';

export type BiomeId = 'grasland' | 'schaere' | 'berge' | 'schnee' | 'basalt';

export const BIOME_NAMES: Record<BiomeId, string> = {
  grasland: t('biome.grasland'), schaere: t('biome.schaere'), berge: t('biome.berge'), schnee: t('biome.schnee'), basalt: t('biome.basalt'),
};

/** surface classes a triangle can be emitted into */
export type Surface = 'ground' | 'ice';

export interface Species {
  kind: 'nadelbaum' | 'laubbaum' | 'busch' | 'fels' | 'schneetanne';
  count: number;
  minH: number; maxH: number;
  maxSlope: number;          // 1 - normal.y
  /** 0..1: how strongly instances cluster in groves (0 = evenly scattered) */
  clump: number;
}

const C = (n: PalName) => new THREE.Color(PAL[n]);
const P = {
  sand: C('sandHell'), sandWet: C('sandNass'), earth: C('erde'),
  greens: [C('gruen1'), C('gruen2'), C('gruen3'), C('gruen4')],
  rocks: [C('fels1'), C('fels2'), C('fels3'), C('fels4')],
  snow: C('schnee'), snowShade: C('schneeSchatten'), ice: C('eis'), iceDark: C('eisDunkel'),
  skerry: { lichen: C('flechte'), rock: C('schaerenFels'), dark: C('schaerenDunkel'), moss: C('moos'), heath: C('heide'), dry: C('grasTrocken'), lime: C('vogelkot'), pool: C('tuempel') },
  basalt: C('basalt'), basaltLight: C('basaltHell'), ash: C('asche'),
};
/** a skerry's pools: only where the ground lies at least this deep in a hollow (0..1, Island's hollows()); they cover some 4–6 % of the land */
const POOL = { hollow: 0.12 };
/** water stands in it: not darkened like the ground in a hollow */
export const isPool = (c: THREE.Color) => c.equals(P.skerry.pool);

/** a landing place on a cliff coast, island-local (Island.landings has it in world coordinates) */
export interface LandingSite {
  /** where its axis crosses the coast line */
  x: number; z: number;
  /** unit vector along its axis, out to sea */
  nx: number; nz: number;
  /** the height of the upland at its top */
  top: number;
  /** how far (m) from the coast line its steps reach: to the water line, and on under water to `reach` */
  dry: number; reach: number;
}

// coast profile shared by all biomes: land factor (0 sea .. 1 inland) -> height.
// A wide shallow shelf and gentle beaches so the Walrus can land everywhere.
const PROFILE: [number, number][] = [[0, -40], [0.2, -8], [0.5, 1.5], [0.65, 4], [1, 15]];
function profile(land: number): number {
  for (let i = 0; i + 1 < PROFILE.length; i++) {
    const [a, ha] = PROFILE[i], [b, hb] = PROFILE[i + 1];
    if (land <= b) return lerp(ha, hb, (land - a) / (b - a));
  }
  return PROFILE[PROFILE.length - 1][1];
}

export function bump(x: number, z: number, cx: number, cz: number, r: number): number {
  const d = Math.min(Math.hypot(x - cx, z - cz) / r, 1);
  return Math.pow(0.5 + 0.5 * Math.cos(Math.PI * d), 1.3);
}

/** Base class: coastline and beaches; subclasses add relief, colours and features. */
export abstract class Biome {
  abstract readonly id: BiomeId;
  protected n: Noise2D;
  protected rnd: () => number;

  /** skerries, small rocky islets on the shelf round every island (as on the title picture): x, z, radius, height */
  protected skerries: [number, number, number, number][] = [];
  /** where an Otter gets ashore where the coast is cliff (island-local; none: anywhere) */
  readonly landings: LandingSite[] = [];

  constructor(seed: number, protected R: number) {
    this.n = new Noise2D(seed);
    this.rnd = mulberry32(seed * 7 + 3);
    // their own random numbers, so the rest of the island stays as it was before them
    const rs = mulberry32(seed * 13 + 5);
    const want = 8 + Math.floor(rs() * 6);
    for (let tries = 0; tries < 400 && this.skerries.length < want; tries++) {
      const a = rs() * Math.PI * 2, d = this.R * (0.75 + rs() * 0.55);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const l = this.land(x, z);
      if (l < 0.2 || l > 0.45 || this.skerries.some(([sx, sz, sr]) => Math.hypot(x - sx, z - sz) < sr + 120)) continue;
      this.skerries.push([x, z, 40 + rs() * 60, 14 + rs() * 42]);
    }
  }

  /** the coast as a level set: under 0.5 inland, about 0.78 at the water line, beyond 1.02 open sea */
  protected edge(x: number, z: number): number {
    return Math.hypot(x, z * 1.22) / this.R + this.n.fbm(x * 0.0013 + 3.1, z * 0.0013 - 1.7, 4) * 0.32;
  }

  /** land factor 0 (open sea) .. 1 (inland) with an irregular coast */
  protected land(x: number, z: number): number {
    return 1 - smoothstep(0.5, 1.02, this.edge(x, z));
  }

  /** how much lower than the ground `h` the near mesh lies here (where something built on it covers it) */
  meshDrop(_x: number, _z: number, _h: number): number { return 0; }

  /** something of the island's own covers the ground here (nothing grows there) */
  covered(_x: number, _z: number): boolean { return false; }

  protected base(x: number, z: number): { h: number; land: number; inland: number } {
    const land = this.land(x, z);
    let h = profile(land);
    for (const [cx, cz, r, hh] of this.skerries) {
      if (Math.abs(x - cx) < r && Math.abs(z - cz) < r) h = Math.max(h, h + Math.pow(bump(x, z, cx, cz, r), 1.4) * (hh - h));
    }
    return { h, land, inland: smoothstep(0.55, 0.85, land) };
  }

  abstract height(x: number, z: number): number;
  /** `hollow`: how deep the spot lies in a hollow, 0..1 (Island's hollows()) */
  abstract color(x: number, h: number, z: number, ny: number, seed: number, out: THREE.Color, hollow?: number): void;
  surface(_x: number, _h: number, _z: number): Surface { return 'ground'; }
  abstract readonly species: Species[];

  /** shared shore colours */
  protected shore(h: number, ny: number, v: number, seed: number, out: THREE.Color): boolean {
    if (h < 0.6) { out.copy(P.sandWet); return true; }
    if (h < 4.5 + v * 1.5 && ny > 0.97) { out.copy(seed < 0.15 ? P.sandWet : P.sand); return true; }
    return false;
  }

  protected rock(seed: number, out: THREE.Color) {
    out.copy(P.rocks[Math.floor(seed * P.rocks.length)]);
  }

  protected green(x: number, z: number, h: number, seed: number, out: THREE.Color) {
    const t = this.n.get(x * 0.004 + 50, z * 0.004);
    let shade = t > 0.35 ? 3 : t > 0 ? 2 : t > -0.4 ? 1 : 0;
    if (h > 70) shade++;
    if (seed < 0.12) shade--; else if (seed > 0.88) shade++;
    out.copy(P.greens[Math.max(0, Math.min(3, shade))]);
  }

  protected randomSpot(radius: number): [number, number] {
    const a = this.rnd() * Math.PI * 2, d = Math.sqrt(this.rnd()) * radius;
    return [Math.cos(a) * d, Math.sin(a) * d];
  }
}

/** Grassland: gentle plains, a few moderate hills, scattered trees and groves (no forest). */
export class Grasland extends Biome {
  readonly id = 'grasland' as const;
  private hills: [number, number, number, number][] = [];
  // fewer and in groves, so the meadows read as green faces (as on the title picture), not as dark speckles
  readonly species: Species[] = [
    { kind: 'laubbaum', count: 150, minH: 4, maxH: 160, maxSlope: 0.15, clump: 0.8 },
    { kind: 'nadelbaum', count: 90, minH: 10, maxH: 200, maxSlope: 0.15, clump: 0.85 },
    { kind: 'busch', count: 200, minH: 3, maxH: 200, maxSlope: 0.2, clump: 0.6 },
    { kind: 'fels', count: 90, minH: 1, maxH: 250, maxSlope: 0.5, clump: 0.2 },
  ];

  constructor(seed: number, R: number) {
    super(seed, R);
    for (let i = 0; i < 3; i++) {
      const [x, z] = this.randomSpot(this.R * 0.45);
      this.hills.push([x, z, 200 + this.rnd() * 250, 25 + this.rnd() * 70]);
    }
  }

  height(x: number, z: number): number {
    const { h, inland, land } = this.base(x, z);
    let y = h + inland * this.n.fbm(x * 0.0021 + 11, z * 0.0021 - 4, 3) * 11;
    for (const [cx, cz, r, hh] of this.hills) y += inland * bump(x, z, cx, cz, r) * hh;
    y -= bump(x, z, this.R * 0.12, this.R * 0.56, 260) * 26 * land; // lagoon
    return y;
  }

  color(x: number, h: number, z: number, ny: number, seed: number, out: THREE.Color) {
    const v = this.n.get(x * 0.01, z * 0.01);
    if (this.shore(h, ny, v, seed, out)) return;
    if (ny < 0.85) return this.rock(seed, out);
    if (ny < 0.91) { out.copy(seed < 0.5 ? P.earth : P.rocks[2]); return; }
    this.green(x, z, h, seed, out);
  }
}

/**
 * Skerry: a low, rough island of grey rock like those off Scotland's north and west coasts. Slabs of rock run in
 * ribs along the strata, grey with lichen; grass and moss lie between them, dry and yellowish in places; small
 * pools stand in the hollows of the flat top, the seabirds whiten the ledges, and the rock at the sea is dark and
 * wet. Low knolls, but mostly flat ground to build on, and the shared gentle shelf so the Otter can land anywhere.
 */
export class Schaere extends Biome {
  readonly id = 'schaere' as const;
  /** which way the strata run */
  private dir: number;
  private knolls: [number, number, number, number][] = [];
  readonly species: Species[] = [
    // heather and moss spread loosely over the heath
    { kind: 'busch', count: 320, minH: 3, maxH: 60, maxSlope: 0.2, clump: 0.2 },
    { kind: 'fels', count: 300, minH: 0.5, maxH: 80, maxSlope: 0.7, clump: 0.5 },
  ];

  constructor(seed: number, R: number) {
    super(seed, R);
    this.dir = this.rnd() * Math.PI;
    for (let i = 0; i < 3; i++) {
      const [x, z] = this.randomSpot(this.R * 0.4);
      this.knolls.push([x, z, 160 + this.rnd() * 220, 8 + this.rnd() * 18]);
    }
  }

  /** 0..1: the crests of the rock ribs along the strata; bent, and only in patches (elsewhere rock and grass mix freely) */
  private rib(x: number, z: number): number {
    const u = x * Math.cos(this.dir) + z * Math.sin(this.dir), v = -x * Math.sin(this.dir) + z * Math.cos(this.dir);
    const patch = smoothstep(-0.15, 0.45, this.n.get(x * 0.0035 + 30, z * 0.0035 - 12));
    return patch * Math.pow(Math.abs(Math.sin(u * 0.06 + this.n.get(v * 0.004, u * 0.003) * 4)), 4);
  }

  height(x: number, z: number): number {
    const { h, inland } = this.base(x, z);
    let y = h + inland * this.n.fbm(x * 0.003 + 5, z * 0.003 - 2, 3) * 5;
    for (const [cx, cz, r, hh] of this.knolls) y += inland * bump(x, z, cx, cz, r) * hh;
    return y + inland * this.rib(x, z) * 1.6;
  }

  color(x: number, h: number, z: number, ny: number, seed: number, out: THREE.Color, hollow = 0) {
    const S = P.skerry, v = this.n.get(x * 0.01, z * 0.01);
    // at the sea: dark wet rock, above it a band of bare rock the waves wash
    if (h < 1.2) { out.copy(seed < 0.55 ? S.dark : S.rock); return; }
    if (h < 4 + v * 2) { out.copy(seed < 0.3 ? S.dark : seed < 0.85 ? S.rock : S.lichen); return; }
    // steep faces are rock, whitened where the seabirds sit
    if (ny < 0.82) { out.copy(h < 40 && seed < 0.16 ? S.lime : seed < 0.55 ? S.rock : S.dark); return; }
    // pools in the hollows of the flat top (only in real ones: they used to lie wherever the ground was flat), with a
    // rim of bare rock round them
    if (hollow > POOL.hollow / 2) {
      const p = this.n.get(x * 0.014 + 40, z * 0.014 - 9) + 2.5 * hollow;
      if (hollow > POOL.hollow && ny > 0.985 && p > 0.8) { out.copy(S.pool); return; }
      if (ny > 0.95 && p > 0.62) { out.copy(S.lichen); return; }
    }
    // lichen-grey rock in ribs and in broad slabs (about half the top), grass and moss between
    const rocky = this.rib(x, z) + this.n.get(x * 0.02, z * 0.02) * 0.35 + Math.max(0, this.n.get(x * 0.006 + 15, z * 0.006 - 4)) * 0.7;
    if (rocky > 0.38 || ny < 0.9) { out.copy(seed < 0.6 ? S.lichen : S.rock); return; }
    // the heath in patches of moss, heather and dry grass (the seed comes in patches, see Island's colourSeed)
    const t = this.n.get(x * 0.005 + 70, z * 0.005);
    if (t > 0.3) { out.copy(seed < 0.3 ? S.moss : seed > 0.68 ? S.dry : S.heath); return; }
    out.copy(seed < 0.55 ? S.moss : P.greens[2]);
  }
}

/** Mountains with trees: two big massifs, passable valleys, forested lower slopes, snow caps. */
export class Berge extends Biome {
  readonly id = 'berge' as const;
  private massifs: [number, number, number, number][] = [];
  readonly species: Species[] = [
    // fewer and in groves, so the slopes read as green faces (as on the title picture), not as dark speckles
    { kind: 'nadelbaum', count: 400, minH: 15, maxH: 210, maxSlope: 0.35, clump: 0.7 },
    { kind: 'laubbaum', count: 120, minH: 4, maxH: 60, maxSlope: 0.12, clump: 0.6 },
    { kind: 'fels', count: 220, minH: 30, maxH: 400, maxSlope: 0.8, clump: 0.3 },
  ];

  constructor(seed: number, R: number) {
    super(seed, R);
    const a = this.rnd() * Math.PI * 2;
    for (const k of [0, 1]) {
      const ang = a + k * (2.4 + this.rnd() * 0.8), d = this.R * (0.25 + this.rnd() * 0.15);
      this.massifs.push([Math.cos(ang) * d, Math.sin(ang) * d, this.R * (0.38 + this.rnd() * 0.1), 340 + this.rnd() * 160]);
    }
  }

  height(x: number, z: number): number {
    const { h, inland } = this.base(x, z);
    let y = h + inland * this.n.fbm(x * 0.0022 + 4, z * 0.0022, 3) * 12;
    // two octaves for fewer, larger faces, a steep falloff for sharp peaks (as on the title picture)
    const ridge = this.n.ridge(x * 0.0024 + 10, z * 0.0024 + 5, 2);
    for (const [cx, cz, r, hh] of this.massifs) y += inland * Math.pow(bump(x, z, cx, cz, r), 1.5) * (hh * (0.45 + ridge * 0.75));
    return y;
  }

  color(x: number, h: number, z: number, ny: number, seed: number, out: THREE.Color) {
    const v = this.n.get(x * 0.01, z * 0.01);
    if (this.shore(h, ny, v, seed, out)) return;
    if (h > 300 + v * 30) { if (ny > 0.66) { out.copy(seed < 0.5 ? P.snow : P.snowShade); return; } return this.rock(seed, out); }
    if (ny < 0.8) return this.rock(seed, out);
    if (ny < 0.88 || h > 200) { out.copy(seed < 0.5 ? P.earth : P.rocks[2]); return; }
    this.green(x, z, h + 40, seed, out);
  }
}

/** Snow: rolling white hills with rocky ridges, a frozen lagoon, snowy pines. */
export class Schnee extends Biome {
  readonly id = 'schnee' as const;
  private hills: [number, number, number, number][] = [];
  // fewer and in groves: dark firs scattered over white snow speckle the most
  readonly species: Species[] = [
    { kind: 'schneetanne', count: 160, minH: 4, maxH: 180, maxSlope: 0.18, clump: 0.85 },
    { kind: 'fels', count: 160, minH: 2, maxH: 300, maxSlope: 0.6, clump: 0.3 },
  ];

  constructor(seed: number, R: number) {
    super(seed, R);
    for (let i = 0; i < 4; i++) {
      const [x, z] = this.randomSpot(this.R * 0.45);
      this.hills.push([x, z, 180 + this.rnd() * 220, 30 + this.rnd() * 90]);
    }
  }

  height(x: number, z: number): number {
    const { h, inland, land } = this.base(x, z);
    let y = h + inland * this.n.fbm(x * 0.0024 + 2, z * 0.0024 - 9, 3) * 13;
    for (const [cx, cz, r, hh] of this.hills) y += inland * bump(x, z, cx, cz, r) * hh;
    y += inland * Math.pow(this.n.ridge(x * 0.005, z * 0.005, 3), 3) * 16;
    y -= bump(x, z, -this.R * 0.2, this.R * 0.5, 280) * 24 * land; // frozen lagoon
    return y;
  }

  color(_x: number, h: number, _z: number, ny: number, seed: number, out: THREE.Color) {
    if (h < 1.2) { out.copy(seed < 0.5 ? P.rocks[0] : P.iceDark); return; } // icy gravel shore
    if (ny < 0.82) return this.rock(seed, out);
    out.copy(ny < 0.93 || seed < 0.3 ? P.snowShade : P.snow);
  }

  surface(x: number, h: number, z: number): Surface {
    // the lagoon is frozen over
    return h < 0.2 && h > -12 && bump(x, z, -this.R * 0.2, this.R * 0.5, 280) > 0.25 ? 'ice' : 'ground';
  }
}

/** the edge value of a basalt island's coast line (see Biome.edge) */
const COAST_E = 0.78;
/** its cliff across the coast line (m, inland positive): the foot under water, the face, the lip at the top */
const CLIFF = { foot: -6, footH: -3, face: 6, lip: 12 };
/** the landing ramps: their rise (tan 16.5°, with the bends at top and foot still under SLOPE.DRIVE), flat half width, the slope of their sides, and how far inland they reach the top */
export const RAMP = { k: Math.tan(16.5 * Math.PI / 180), half: 32, wall: 3, inland: 12 };
/** the lattice of the cliff columns and of the steps (circumradius, m) */
const COLUMN = { cliff: 5, step: 3 };
/** the steps go on as a pavement of column tops this far onto the upland behind a landing's top (m) */
const PAVEMENT = 20;

/** the height of a sea cave's arched roof `u` metres from its middle */
export function caveRoof(cave: { w: number; h: number }, u: number): number {
  return cave.h * (0.72 + 0.28 * Math.sqrt(Math.max(0, 1 - (u / (cave.w / 2)) ** 2)));
}

/** one basalt column (island-local): a hexagonal prism of radius `r` from `y0` up to `y1`, in look 0 weathered grey, 1 dark, 2 turf on top, 3 white with the seabirds, 4 a step */
export interface Column { x: number; z: number; y0: number; y1: number; r: number; look: 0 | 1 | 2 | 3 | 4 }

/**
 * Basalt: a flat, grassy upland like Staffa's in the Hebrides, 25–45 m up, walled all round by cliffs of dark
 * hexagonal columns (src/world/basalt.ts builds them). At two to four landing places the columns step down into the
 * sea like the Giant's Causeway: a ramp under SLOPE.DRIVE, and the only way an Otter gets ashore (the cliffs are far
 * too steep). Sea stacks of columns stand off the coast, and a sea cave opens in one cliff, after Fingal's Cave.
 */
export class Basalt extends Biome {
  readonly id = 'basalt' as const;
  readonly species: Species[] = [
    // (both too fussy about slope to stand on the ramps)
    { kind: 'busch', count: 120, minH: 8, maxH: 80, maxSlope: 0.035, clump: 0.6 },
    { kind: 'fels', count: 90, minH: 8, maxH: 80, maxSlope: 0.035, clump: 0.4 },
  ];
  /** the column lattice's turn (rad) */
  readonly grain: number;
  /** the sea cave: where its mouth is on the coast line, the way out, its width and height */
  readonly cave: { x: number; z: number; nx: number; nz: number; w: number; h: number } | null = null;
  private top0: number;
  private tilt: [number, number];
  private knolls: [number, number, number, number][] = [];

  constructor(seed: number, R: number) {
    super(seed, R);
    this.grain = this.rnd() * Math.PI / 3;
    this.top0 = 26 + this.rnd() * 6;
    const a = this.rnd() * Math.PI * 2;
    this.tilt = [Math.cos(a) * 3 / this.R, Math.sin(a) * 3 / this.R];
    for (let i = 0; i < 2; i++) {
      const [x, z] = this.randomSpot(this.R * 0.35);
      this.knolls.push([x, z, 160 + this.rnd() * 120, 3 + this.rnd() * 4]);
    }
    // sea stacks: flat-topped pillars, so lower and not all of them
    this.skerries = this.skerries.filter(() => this.rnd() < 0.6).map(([x, z, r, h]) => [x, z, r * 0.7, 12 + (h - 14) * 0.6]);
    this.pickLandings(2 + Math.floor(this.rnd() * 2) + (R > 1000 ? 1 : 0));
    // no stack in a landing's way
    this.skerries = this.skerries.filter(([x, z, r]) => this.landings.every(L => {
      const px = x - L.x, pz = z - L.z, s = px * L.nx + pz * L.nz, u = Math.abs(px * L.nz - pz * L.nx);
      return s < -40 || s > L.reach + 400 || u > RAMP.half + 80 + r;
    }));
    this.cave = this.pickCave();
  }

  /** signed distance (m) from the coast line, inland positive: to first order the edge value over its gradient */
  coastDist(x: number, z: number): number {
    const e = this.edge(x, z), ex = this.edge(x + 2, z) - e, ez = this.edge(x, z + 2) - e;
    return (COAST_E - e) / Math.max(Math.hypot(ex, ez) / 2, 0.25 / this.R);
  }

  /** the outward normal of the coast (unit) near (x, z) */
  private normal(x: number, z: number): [number, number] {
    const ex = this.edge(x + 3, z) - this.edge(x - 3, z), ez = this.edge(x, z + 3) - this.edge(x, z - 3), l = Math.hypot(ex, ez) || 1;
    return [ex / l, ez / l];
  }

  /** the upland: flat for building, gently domed and tilted, with a couple of low rises */
  upland(x: number, z: number): number {
    let y = this.top0 + this.n.fbm(x * 0.0024 + 7, z * 0.0024 - 3, 3) * 3 + x * this.tilt[0] + z * this.tilt[1] + bump(x, z, 0, 0, this.R) * 5;
    for (const [cx, cz, r, hh] of this.knolls) y += bump(x, z, cx, cz, r) * hh;
    return y;
  }

  height(x: number, z: number): number {
    const e = this.edge(x, z), ex = this.edge(x + 2, z) - e, ez = this.edge(x, z + 2) - e;
    const d = (COAST_E - e) / Math.max(Math.hypot(ex, ez) / 2, 0.25 / this.R);
    let y: number;
    if (d > CLIFF.foot) {
      const top = this.upland(x, z);
      y = d >= CLIFF.lip ? top : d >= CLIFF.face ? lerp(top - 1, top, (d - CLIFF.face) / (CLIFF.lip - CLIFF.face))
        : lerp(CLIFF.footH, top - 1, (d - CLIFF.foot) / (CLIFF.face - CLIFF.foot));
    } else {
      // deep water close in under the cliffs, then the shared shelf's depths further out
      const off = CLIFF.foot - d;
      y = Math.min(CLIFF.footH - 9 * smoothstep(0, 30, off) - 10 * smoothstep(30, 200, off), profile(1 - smoothstep(0.5, 1.02, e)));
    }
    for (const [cx, cz, r, hh] of this.skerries) {
      if (Math.abs(x - cx) < r && Math.abs(z - cz) < r) y += smoothstep(0.3, 0.55, bump(x, z, cx, cz, r)) * Math.max(0, hh - y);
    }
    for (const L of this.landings) y = this.ramp(L, x, z, y);
    return y;
  }

  /**
   * A landing's ramp over the ground y: rising from under the sea to the upland along its axis, built out into the
   * sea with steep sides and cut through the cliff where the coast runs askew to it (or the cliff's face would stand
   * in its way at the top).
   */
  private ramp(L: LandingSite, x: number, z: number, y: number): number {
    const px = x - L.x, pz = z - L.z, s = px * L.nx + pz * L.nz, u = Math.abs(px * L.nz - pz * L.nx);
    if (u > RAMP.half + 40 || s > L.reach + 60 || s < -RAMP.inland - 60) return y;
    const side = Math.max(0, u - RAMP.half) * RAMP.wall, line = L.top - RAMP.k * (s + RAMP.inland);
    // the cut: none inland of its top (the walls rise fast there, so the upland stays)
    y = Math.min(y, line + side + Math.max(0, -RAMP.inland - s) * 10);
    // (beyond its top it falls away inland as steeply, so the upland takes over)
    return Math.max(y, L.top - RAMP.k * Math.abs(s + RAMP.inland) - side);
  }

  /** a landing's steps cover (x, z): along its axis from a pavement on the upland behind its top into the water, across its width and sides */
  onSteps(x: number, z: number, margin = 0): LandingSite | null {
    for (const L of this.landings) {
      const px = x - L.x, pz = z - L.z, s = px * L.nx + pz * L.nz, u = Math.abs(px * L.nz - pz * L.nx);
      if (s > -RAMP.inland - PAVEMENT - margin && s < L.reach + margin && u < RAMP.half + 10 + margin) return L;
    }
    return null;
  }

  covered(x: number, z: number): boolean { return !!this.onSteps(x, z, 6); }

  /**
   * The near mesh lies lower than the ground where the columns stand, so none of it shows between them (the ground
   * stays where the Otter drives and shots hit): under the steps (it comes up again under the pavement's edge), and
   * the lower cliff faces and stack sides, the only other low land, squashed under the water line. The coarse 10 m
   * mesh would poke out there in front of the columns.
   */
  meshDrop(x: number, z: number, h: number): number {
    for (const L of this.landings) {
      const px = x - L.x, pz = z - L.z, s = px * L.nx + pz * L.nz, u = Math.abs(px * L.nz - pz * L.nx);
      if (s < -RAMP.inland - PAVEMENT || s > L.reach + 6 || u > RAMP.half + 20) continue;
      return 2.5 * smoothstep(-RAMP.inland - PAVEMENT, -RAMP.inland - PAVEMENT + 14, s) * smoothstep(RAMP.half + 20, RAMP.half + 12, u);
    }
    // (-14..8 m onto -14..-6, 8..18 m onto -6..18: deep enough that no mesh triangle reaching out from the face rises out of the water)
    return h <= -14 || h >= 18 ? 0 : h - (h <= 8 ? -14 + (h + 14) * (8 / 22) : -6 + (h - 8) * 2.4);
  }

  color(x: number, h: number, z: number, ny: number, seed: number, out: THREE.Color) {
    if (h < 1 || this.onSteps(x, z)) { out.copy(seed < 0.6 ? P.basalt : P.basaltLight); return; }
    // the faces of the cliffs and stacks (behind the columns)
    if (ny < 0.75) { out.copy(seed < 0.6 ? P.basalt : P.basaltLight); return; }
    // the lip of the cliffs: bare rock and thin turf
    if (ny < 0.93) { out.copy(seed < 0.4 ? P.basaltLight : seed < 0.7 ? P.ash : P.skerry.moss); return; }
    // the upland: grass and heather, patches of bare column tops
    if (this.n.get(x * 0.009 + 21, z * 0.009 - 5) > 0.62) { out.copy(seed < 0.5 ? P.basaltLight : P.ash); return; }
    const t = this.n.get(x * 0.005 + 70, z * 0.005);
    out.copy(t > 0.4 ? P.skerry.heath : t > 0 ? (seed < 0.5 ? P.greens[1] : P.greens[2]) : seed < 0.6 ? P.skerry.moss : P.greens[2]);
  }

  /**
   * Two to four landing places, spread round the coast: where the coast runs straight, the upland behind it is wide
   * and open water lies far out in front (for the ramp and for an Otter coming in). The strict rules first; if too
   * few places meet them, looser ones.
   */
  private pickLandings(want: number) {
    const cands: { site: LandingSite; score: number }[] = [];
    const N = 96, rs = this.rnd;
    for (const strict of [true, false]) {
      cands.length = 0;
      for (let k = 0; k < N; k++) {
        const a = (k + rs() * 0.6) / N * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        // the outermost crossing of the coast line along this ray
        let r1 = this.R * 1.4;
        while (r1 > 50 && this.edge(ca * r1, sa * r1) > COAST_E) r1 -= 10;
        if (r1 <= 50) continue;
        let lo = r1, hi = r1 + 10;
        for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (this.edge(ca * m, sa * m) > COAST_E) hi = m; else lo = m; }
        const x = ca * lo, z = sa * lo, [nx, nz] = this.normal(x, z);
        if (nx * ca + nz * sa < (strict ? 0.75 : 0.45)) continue;
        const tx = -nz, tz = nx;
        const at = (s: number, u: number) => this.coastDist(x + nx * s + tx * u, z + nz * s + tz * u);
        // a straight stretch of coast either side
        if ([-1, 1].some(side => Math.abs(at(0, side * (RAMP.half + 15))) > (strict ? 14 : 30))) continue;
        // the upland behind: wide and deep enough
        if ([20, 45, 80, 130].some(s => [-1, 0, 1].some(side => at(-s, side * RAMP.half) < (strict ? 18 : 12)))) continue;
        const top = this.upland(x - nx * RAMP.inland, z - nz * RAMP.inland);
        const dry = top / RAMP.k - RAMP.inland, reach = (top + 15) / RAMP.k - RAMP.inland;
        // open water in front: the ramp's sides and a lane to come in by
        let open = true;
        for (let s = 25; s < reach + (strict ? 260 : 120) && open; s += 20) {
          for (const u of [-RAMP.half - 30, 0, RAMP.half + 30]) if (at(s, u) > -(strict ? 20 : 12)) { open = false; break; }
        }
        if (!open) continue;
        cands.push({ site: { x, z, nx, nz, top, dry, reach }, score: rs() });
      }
      cands.sort((p, q) => p.score - q.score);
      this.landings.length = 0;
      for (const c of cands) {
        if (this.landings.length >= want) break;
        // spread round the island
        if (this.landings.some(L => Math.hypot(L.x - c.site.x, L.z - c.site.z) < this.R * 0.9)) continue;
        this.landings.push(c.site);
      }
      if (this.landings.length >= 2) return;
    }
    // (an odd coast: any place that has water in front will do, at least one)
    if (!this.landings.length && cands.length) this.landings.push(cands[0].site);
  }

  /** a sea cave in a stretch of high cliff away from the landings (and from the stacks): or none */
  private pickCave(): Basalt['cave'] {
    for (let k = 0; k < 24; k++) {
      const a = this.rnd() * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      let r1 = this.R * 1.4;
      while (r1 > 50 && this.edge(ca * r1, sa * r1) > COAST_E) r1 -= 10;
      if (r1 <= 50) continue;
      const x = ca * r1, z = sa * r1, [nx, nz] = this.normal(x, z);
      if (nx * ca + nz * sa < 0.8 || Math.abs(this.coastDist(x - nz * 20, z + nx * 20)) > 8 || Math.abs(this.coastDist(x + nz * 20, z - nx * 20)) > 8) continue;
      if (this.landings.some(L => Math.hypot(L.x - x, L.z - z) < 250) || this.skerries.some(([sx, sz, r]) => Math.hypot(sx - x, sz - z) < r + 120)) continue;
      const h = this.upland(x, z);
      if (h < 28) continue;
      return { x, z, nx, nz, w: 22, h: h * 0.7 };
    }
    return null;
  }

  /**
   * The columns: a hexagonal lattice along the cliffs (where the ground is steep, so they hide its faces), round the
   * stacks, and a finer one for the steps of the landings, whose tops follow the ramp. `ground` is the island's height
   * at island-local (x, z).
   */
  columns(ground: (x: number, z: number) => number): Column[] {
    const out: Column[] = [];
    const half = this.R * 1.4, cg = Math.cos(this.grain), sg = Math.sin(this.grain);
    const hash = (x: number, z: number, k: number) => hash2(Math.round(x * 3), Math.round(z * 3), k);
    // the lattice points in a box (island-local x0..x1, z0..z1)
    const lattice = (rc: number, [x0, x1, z0, z1]: number[], visit: (x: number, z: number) => void) => {
      const dx = Math.sqrt(3) * rc, dz = 1.5 * rc;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
        const lx = x * cg + z * sg, lz = -x * sg + z * cg;
        a0 = Math.min(a0, lx); a1 = Math.max(a1, lx); b0 = Math.min(b0, lz); b1 = Math.max(b1, lz);
      }
      for (let j = Math.floor(b0 / dz) - 1; j <= Math.ceil(b1 / dz) + 1; j++) for (let i = Math.floor(a0 / dx) - 1; i <= Math.ceil(a1 / dx) + 1; i++) {
        const lx = i * dx + (j & 1) * dx / 2, lz = j * dz;
        const x = lx * cg - lz * sg, z = lx * sg + lz * cg;
        if (x > x0 && x < x1 && z > z0 && z < z1) visit(x, z);
      }
    };
    // where to look for cliff columns: a 10 m raster of steep cells (over 4 m between corners), widened by one cell
    // for the faces and by three for the stumps at their foot, and the stacks' discs
    const C = 10, N = Math.ceil(2 * half / C), H = new Float32Array((N + 1) * (N + 1));
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) H[j * (N + 1) + i] = ground(-half + i * C, -half + j * C);
    const steep0 = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * (N + 1) + i, a = H[k], b = H[k + 1], c = H[k + N + 1], e = H[k + N + 2];
      if (Math.max(a, b, c, e) - Math.min(a, b, c, e) > 4) steep0[j * N + i] = 1;
    }
    const widen = (m: Uint8Array, by: number) => {
      const o = new Uint8Array(N * N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        if (!m[j * N + i]) continue;
        for (let v = Math.max(0, j - by); v <= Math.min(N - 1, j + by); v++) for (let w = Math.max(0, i - by); w <= Math.min(N - 1, i + by); w++) o[v * N + w] = 1;
      }
      return o;
    };
    const steep = widen(steep0, 1), near = widen(steep0, 3);
    const cell = (x: number, z: number) => Math.min(N - 1, Math.floor((x + half) / C)) + Math.min(N - 1, Math.floor((z + half) / C)) * N;
    const cave = this.cave;
    // the cliffs and stacks
    lattice(COLUMN.cliff, [-half, half, -half, half], (x, z) => {
      // (a stack's foot blurs out a cell on the 10 m grid: its ring reaches that far)
      const stack = this.skerries.find(([cx, cz, r]) => Math.abs(x - cx) < r + C && Math.abs(z - cz) < r + C && Math.hypot(x - cx, z - cz) < r * 0.62 + C);
      const k = cell(x, z);
      if (!stack && !near[k]) return;
      const h = ground(x, z);
      if (h < -14 || this.onSteps(x, z, 2)) return;
      const r = hash(x, z, 1), look = (r < 0.1 ? 3 : r < 0.4 ? 1 : 0) as Column['look'];
      if (stack) {
        if (steep[k] || h > -4) out.push({ x, z, y0: -12, y1: stack[3] - hash(x, z, 2) * 3, r: COLUMN.cliff, look });
        return;
      }
      const d = this.coastDist(x, z);
      // (the front row zigzags along the coast through the lattice: further out where it still hides ground above the water)
      if (steep[k] && d < 6 && (d > -14 || (d > -18 && Math.max(h, ground(x + 3, z), ground(x - 3, z), ground(x, z + 3), ground(x, z - 3)) > -2.5))) {
        // up to the upland's lip, a few broken short; the inner ones carry turf
        let y1 = this.upland(x, z) - 0.6 + (hash(x, z, 2) - 0.5) * 2.2;
        if (hash(x, z, 3) < 0.08) y1 -= 4 + hash(x, z, 4) * 8;
        let y0 = -12;
        if (cave) {
          const px = x - cave.x, pz = z - cave.z, u = Math.abs(px * cave.nz - pz * cave.nx), sAx = px * cave.nx + pz * cave.nz;
          // over the cave's mouth only the hanging columns of its roof are left
          if (u < cave.w / 2 + 2 && sAx > -16 && sAx < 20) y0 = caveRoof(cave, u);
        }
        out.push({ x, z, y0, y1, r: COLUMN.cliff, look: d > 1 && hash(x, z, 5) < 0.6 ? 2 : look });
      } else if (!steep[k] && h > -6 && h < -1.5 && d > -30 && hash(x, z, 6) < 0.3) {
        // broken stumps at the foot, as the walkway at Staffa
        out.push({ x, z, y0: -12, y1: 0.4 + hash(x, z, 7) * 2.6, r: COLUMN.cliff, look: 0 });
      }
    });
    // the steps: their tops on the ramp where the Otter drives (it rides over their middles), over the whole
    // hexagon at the sides, so the ground under them never shows; the edge rows step down into the sea
    for (const L of this.landings) {
      const xs: number[] = [], zs: number[] = [];
      for (const s of [-RAMP.inland - PAVEMENT, L.reach]) for (const u of [-RAMP.half - 10, RAMP.half + 10]) {
        xs.push(L.x + L.nx * s - L.nz * u); zs.push(L.z + L.nz * s + L.nx * u);
      }
      lattice(COLUMN.step, [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)], (x, z) => {
        if (this.onSteps(x, z) !== L) return;
        const h = ground(x, z);
        if (h < -5) return;
        const u = Math.abs((x - L.x) * L.nz - (z - L.z) * L.nx);
        let y1 = h;
        if (u > RAMP.half - 4) for (let k = 0; k < 6; k++) y1 = Math.max(y1, ground(x + Math.cos(k * Math.PI / 3) * COLUMN.step, z + Math.sin(k * Math.PI / 3) * COLUMN.step));
        const r = hash(x, z, 8);
        out.push({ x, z, y0: -12, y1: y1 + 0.05 + r * 0.2, r: COLUMN.step, look: r < 0.3 ? 1 : 4 });
      });
    }
    return out;
  }
}

export function createBiome(id: BiomeId, seed: number, R: number): Biome {
  switch (id) {
    case 'grasland': return new Grasland(seed, R);
    case 'schaere': return new Schaere(seed, R);
    case 'berge': return new Berge(seed, R);
    case 'schnee': return new Schnee(seed, R);
    case 'basalt': return new Basalt(seed, R);
  }
}

export const ICE_COLORS = [P.ice, P.iceDark];
