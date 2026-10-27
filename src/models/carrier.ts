import * as THREE from 'three';
import { LowPolyBuilder, lowPolyMaterial, type V3 } from '../engine/lowpoly';
import { PAL } from '../engine/palette';
import { GlowSet, type GlowPoints } from '../engine/glow';
import { glbCamera, glbModel, triangleCount } from './glb';

let glows = new GlowSet();

// The carriers. The player's Stoorworm is built in Blender (art/stoorworm, loaded by glb.ts).
// The enemy's is built here after the original model (1 original unit = 0.1 m): deck
// 80 x 200 m, ski ramp at the bow, Walrus dock in the stern; a steel ship standing high out
// of the water (20 m freeboard), its hull a faceted wedge that flares out under the deck
// edge, narrows to the keel and runs out into a sharp prow; lit hangar bays along the sides.
// The base colours, which the enemy's then turns to anthracite and violet:
const BASE_COL = {
  deck: PAL.deckDunkel, deckUnder: PAL.anthrazit, deckEdge: PAL.metall, deckDark: PAL.anthrazit,
  hull: PAL.stahlHell, hullMid: PAL.stahl, hullLow: PAL.stahl, boot: PAL.anthrazit, antifoul: PAL.deckDunkel,
  plate: PAL.stahlHell, seam: PAL.metall,
  sup: PAL.stahl, supLight: PAL.stahlHell, supTop: PAL.metallHell, supDark: PAL.metall,
  accent: PAL.ocker, accentDark: PAL.ockerDunkel,
  hatch: PAL.schwarz, window: PAL.fensterBlau, windowLit: PAL.lichtWarm,
  tower: PAL.stahl, towerDark: PAL.metall, platform: PAL.metall, platformTop: PAL.metallHell,
  radar: PAL.stahlHell, radarLight: PAL.weiss, radarDark: PAL.metall,
  turret: PAL.glasBlau, turretBody: PAL.stahlHell, barrel: PAL.weiss,
  lift: PAL.metall, liftSeam: PAL.anthrazit,
  white: PAL.weiss, yellow: PAL.signalGelb, dark: PAL.anthrazit, black: PAL.schwarz,
  dock: PAL.schwarz, dockWall: PAL.anthrazit, dockCeiling: PAL.deckDunkel, boat: PAL.rettungsOrange, boatTop: PAL.signalOrange,
  lightWarm: PAL.lichtWarm, lightWhite: PAL.lichtWeiss, lightRed: PAL.lichtRot, lightGreen: PAL.lichtGruen, lightBlue: PAL.lichtBlau,
  /** the running lights along the hull */
  accentLight: PAL.lichtBlau,
};
type Colours = Record<keyof typeof BASE_COL, string>;
// ACC Omega, the enemy's carrier (the remake's Nuckelavee): anthracite with violet trim,
// red-lit windows and a raked island on the starboard edge
const ENEMY_COL: Colours = {
  ...BASE_COL,
  deck: PAL.anthrazit, deckUnder: PAL.schwarz, deckEdge: PAL.anthrazit, deckDark: PAL.schwarz,
  hull: PAL.deckDunkel, hullMid: PAL.deckDunkel, hullLow: PAL.anthrazit, boot: PAL.schwarz, antifoul: PAL.feindDunkel,
  plate: PAL.metall, seam: PAL.schwarz,
  sup: PAL.deckDunkel, supLight: PAL.metall, supTop: PAL.anthrazit, supDark: PAL.anthrazit,
  accent: PAL.feind, accentDark: PAL.feindDunkel,
  windowLit: PAL.lichtRot,
  tower: PAL.feind, towerDark: PAL.feindDunkel, platform: PAL.anthrazit, platformTop: PAL.deckDunkel,
  radar: PAL.feind, radarLight: PAL.feindHell, radarDark: PAL.feindDunkel,
  turret: PAL.feindHell, turretBody: PAL.feindHell, barrel: PAL.stahlHell,
  lift: PAL.deckDunkel, yellow: PAL.feindHell, white: PAL.feindGrau,
  boat: PAL.feindGrau, boatTop: PAL.feindHell,
  accentLight: PAL.lichtRot,
};
const COL: Colours = ENEMY_COL;

// hull: four levels from under the deck edge to the keel, the half width of each station at
// them (under the deck, knuckle, waterline, keel). The sides flare out to the knuckle, then
// slope in to the waterline and the keel; towards the bow every level comes to a point at its
// own z: the prow's chin juts out under the deck, below the water the stem sweeps back
const HULL_Y = [-1.5, -7, -20, -26];
export const CARRIER_WATERLINE = -20;              // local y of the waterline (20 m freeboard)
/** how far the Stoorworm's Skua lift sinks to the hangar */
export const LIFT_DEPTH = 9;
const DOCK_X = 27, DOCK_TOP = -11, DOCK_FLOOR = -26, DOCK_END = -74;
const lerp = THREE.MathUtils.lerp;

/** a hull and deck: everything the game's frame (lift, dock, pad, cameras) does not fix */
interface Shape {
  stations: { z: number; w: number[] }[];
  /** z where each hull level comes to its point */
  bowTip: number[];
  /** the deck's half width along z and the z values where its outline bends (the last one its end) */
  deckW: (z: number) => number;
  deckZ: number[];
  /** the ski ramp's height at the bow lip (0: a flat catapult deck running out into the point) */
  rampH: number;
  /** hangar bays and running lights along the sides */
  bays: [number, number][];
  runLights: [number, number, number, number][];
}
const DECK_W = 40, RAMP0 = 75, BOW_Z = 100, TAPER0 = 55, BOW_W = 26;
const TURM: Shape = {
  stations: [
    { z: -100, w: [38.5, 40, 35, 31] }, { z: -60, w: [40, 41.5, 35, 28] }, { z: 0, w: [40, 41.5, 33, 24] },
    { z: 30, w: [38, 39.5, 30, 20] }, { z: 55, w: [33, 34.5, 24, 14] }, { z: 75, w: [24, 26, 15, 7] }, { z: 90, w: [13, 15, 7, 2] },
  ],
  bowTip: [107, 109, 104, 94],
  deckW: (z) => z <= TAPER0 ? DECK_W : DECK_W + (BOW_W - DECK_W) * (z - TAPER0) / (BOW_Z - TAPER0),
  deckZ: [-100, TAPER0, 65, RAMP0, BOW_Z],
  rampH: 4.5,
  bays: [[-88, -72], [-50, -34], [-12, 4], [24, 38]],
  runLights: [[46, 80, -3.2, -4.6], [-96, -82, -3.4, -3.4]],
};
const SHAPE: Shape = TURM;
/** the player's Stoorworm as art/stoorworm/build_stoorworm.py builds it: its hull for the foam, the bow wave and the shallows */
const STOORWORM_HULL = {
  stations: [
    { z: -100, w: [34, 35.5, 31.5, 26] }, { z: -92, w: [36, 37.5, 33, 27] }, { z: 30, w: [36, 37.5, 33, 26] },
    { z: 65, w: [32, 33.5, 28, 20] }, { z: 95, w: [23, 24, 18, 11] }, { z: 118, w: [13, 13.5, 7, 2] },
  ],
  bowTip: [150, 146, 132, 121],
  rampH: 0,
};
/** its runway, sunk a little into the deck behind and ahead of the lift (z ranges), with sloping edges */
const STOORWORM_RUNWAY = { depth: 0.2, bevel: 0.6, parts: [[-54, 10], [40, 124]] as [number, number][] };

/** half width of level l at z (0 at the bow tip) */
function levelWidthOf(S: Pick<Shape, 'stations' | 'bowTip'>, l: number, z: number): number {
  const st = S.stations;
  if (z <= st[0].z) return st[0].w[l];
  for (let i = 0; i + 1 < st.length; i++) if (z <= st[i + 1].z) return lerp(st[i].w[l], st[i + 1].w[l], (z - st[i].z) / (st[i + 1].z - st[i].z));
  const last = st[st.length - 1];
  return Math.max(0, last.w[l] * (S.bowTip[l] - z) / (S.bowTip[l] - last.z));
}

/** hull half width at any z and height y */
function hullWidthOf(S: Pick<Shape, 'stations' | 'bowTip'>, z: number, y: number): number {
  if (y >= HULL_Y[0]) return levelWidthOf(S, 0, z);
  for (let l = 0; l + 1 < HULL_Y.length; l++) {
    if (y >= HULL_Y[l + 1]) return lerp(levelWidthOf(S, l, z), levelWidthOf(S, l + 1, z), (HULL_Y[l] - y) / (HULL_Y[l] - HULL_Y[l + 1]));
  }
  return levelWidthOf(S, HULL_Y.length - 1, z);
}
const levelWidth = (l: number, z: number) => levelWidthOf(SHAPE, l, z);
const hullWidth = (z: number, y: number) => hullWidthOf(SHAPE, z, y);
const deckW = (z: number) => SHAPE.deckW(z);

/** what the game needs of a carrier's hull: the waterline for the foam, the side for the bow wave, the stem, the length and the ramp */
export function shipShape(team: 'spieler' | 'feind') {
  const S = team === 'spieler' ? STOORWORM_HULL : TURM, stemZ = S.bowTip[2];
  return {
    /** the waterline once round the hull in its own coordinates (x to port, z forward) */
    waterline(): [number, number][] {
      const zs: number[] = [];
      for (let z = -100; z < stemZ - 1; z += 8) zs.push(z);
      const port = zs.map(z => [levelWidthOf(S, 2, z), z] as [number, number]);
      return [[0, -100], ...port, [0, stemZ], ...port.slice().reverse().map(([x, z]) => [-x, z] as [number, number])];
    },
    /** the hull's half width at z, `above` metres over the waterline (the sides flare out above it) */
    widthAbove: (z: number, above: number) => hullWidthOf(S, z, CARRIER_WATERLINE + above),
    /** where the stem meets the water */
    stemZ,
    /** the foremost point (the deck's tip, or the prow under the ramp) */
    bowZ: Math.max(S.bowTip[0], S.bowTip[1]),
    rampH: S.rampH,
  };
}

/** a point on the hull surface (a little proud of it, for decals) */
const onHull = (s: number, y: number, z: number, out = 0.06): V3 => [s * (hullWidth(z, y) + out), y, z];

function hull(b: LowPolyBuilder, decals: LowPolyBuilder, lights: LowPolyBuilder) {
  // armour plates: rows every 12.5 m (the bow segment runs out to each level's tip)
  const last = SHAPE.stations[SHAPE.stations.length - 1].z, rows: number[] = [];
  for (let z = -100; z < last - 1; z += 12.5) rows.push(z);
  rows.push(last);
  const ring = (l: number) => [...rows.map(z => ({ z, w: levelWidth(l, z) })), { z: SHAPE.bowTip[l], w: 0 }];
  const band = [[COL.hull, COL.plate], [COL.hullMid, COL.hullLow], [COL.antifoul, COL.antifoul]];
  for (let l = 0; l + 1 < HULL_Y.length; l++) {
    const A = ring(l), B = ring(l + 1), ya = HULL_Y[l], yb = HULL_Y[l + 1];
    for (let i = 0; i + 1 < A.length; i++) {
      for (const s of [-1, 1]) {
        b.poly([[s * A[i].w, ya, A[i].z], [s * B[i].w, yb, B[i].z], [s * B[i + 1].w, yb, B[i + 1].z], [s * A[i + 1].w, ya, A[i + 1].z]], band[l][i % 2]);
      }
    }
  }
  // the tower design's prow top ahead of the deck: a pointed foredeck just under the ramp's lip
  if (SHAPE.rampH > 0) {
    const wb = levelWidth(0, BOW_Z), tip = SHAPE.bowTip[0];
    b.tri([-wb, -1.5, BOW_Z], [wb, -1.5, BOW_Z], [0, -1.5, tip], COL.deckEdge);
    decals.quad([-0.3, -1.45, BOW_Z + 0.5], [0.3, -1.45, BOW_Z + 0.5], [0.3, -1.45, tip - 1], [-0.3, -1.45, tip - 1], COL.accent);
  }
  const K = ring(3);
  for (let i = 0; i + 1 < K.length; i++) b.quad([-K[i].w, -26, K[i].z], [K[i].w, -26, K[i].z], [K[i + 1].w, -26, K[i + 1].z], [-K[i + 1].w, -26, K[i + 1].z], COL.antifoul);

  for (const s of [-1, 1]) {
    // plate seams down the flare and the lower side
    for (let z = -92; z <= last - 6; z += 12.5) {
      decals.quad(onHull(s, -1.7, z), onHull(s, -6.9, z), onHull(s, -6.9, z + 0.35), onHull(s, -1.7, z + 0.35), COL.seam);
      decals.quad(onHull(s, -7.1, z), onHull(s, -19.4, z), onHull(s, -19.4, z + 0.35), onHull(s, -7.1, z + 0.35), COL.seam);
    }
    // ochre line along the knuckle, a dark boot-top at the waterline
    for (let i = 0; i + 1 < rows.length; i++) {
      const za = rows[i] + 0.01, zb = rows[i + 1];
      decals.quad(onHull(s, -6.5, za), onHull(s, -6.5, zb), onHull(s, -7, zb), onHull(s, -7, za), COL.accent);
      decals.quad(onHull(s, -18.4, za), onHull(s, -18.4, zb), onHull(s, -19.9, zb), onHull(s, -19.9, za), COL.boot);
    }
    // hangar bays along the lower side, lit inside, one with a vehicle at the door
    for (const [z0, z1] of SHAPE.bays) {
      decals.quad(onHull(s, -8.4, z0), onHull(s, -8.4, z1), onHull(s, -14.2, z1), onHull(s, -14.2, z0), COL.hatch);
      lights.quad(onHull(s, -8.8, z0 + 0.8, 0.1), onHull(s, -8.8, z1 - 0.8, 0.1), onHull(s, -9.5, z1 - 0.8, 0.1), onHull(s, -9.5, z0 + 0.8, 0.1), COL.lightWarm);
      for (let k = 0; k < 3; k++) {
        const z = z0 + (z1 - z0) * (k + 0.5) / 3, p = onHull(s, -11.5, z, 0.8);
        glows.add(p, COL.lightWarm, 5);
      }
      // the frame round the door
      for (const zz of [z0 - 0.5, z1]) decals.quad(onHull(s, -8.2, zz, 0.08), onHull(s, -8.2, zz + 0.5, 0.08), onHull(s, -14.4, zz + 0.5, 0.08), onHull(s, -14.4, zz, 0.08), COL.seam);
    }
    // running lights in a raked line on the flare towards the bow, and at the stern corners
    for (const [za, zb, ya, yb] of SHAPE.runLights) {
      lights.quad(onHull(s, ya, za, 0.1), onHull(s, yb, zb, 0.1), onHull(s, yb - 0.6, zb, 0.1), onHull(s, ya - 0.6, za, 0.1), COL.accentLight);
      for (let k = 0; k <= 4; k++) glows.add(onHull(s, lerp(ya, yb, k / 4) - 0.3, lerp(za, zb, k / 4), 0.6), COL.accentLight, 3.5);
    }
  }

  // transom: above the dock portal the full width, beside it down to the keel
  const z = -100, wy = (y: number) => hullWidth(z, y);
  b.poly([[-wy(-1.5), -1.5, z], [wy(-1.5), -1.5, z], [wy(-7), -7, z], [wy(DOCK_TOP), DOCK_TOP, z], [-wy(DOCK_TOP), DOCK_TOP, z], [-wy(-7), -7, z]], COL.hullMid);
  for (const s of [-1, 1]) {
    b.poly([[s * DOCK_X, DOCK_TOP, z], [s * wy(DOCK_TOP), DOCK_TOP, z], [s * wy(-20), -20, z], [s * wy(-26), -26, z], [s * DOCK_X, -26, z]], s < 0 ? COL.hullMid : COL.hull);
  }
  // portal frame: angular pillars and a lintel standing proud of the transom
  for (const s of [-1, 1]) {
    b.box([s > 0 ? DOCK_X : -DOCK_X - 3.5, -22, z - 1.2], [s > 0 ? DOCK_X + 3.5 : -DOCK_X, DOCK_TOP + 3.5, z + 0.2], { side: COL.hullLow, top: COL.hullMid, back: COL.hullLow });
  }
  b.box([-DOCK_X - 3.5, DOCK_TOP, z - 1.6], [DOCK_X + 3.5, DOCK_TOP + 3.5, z + 0.2], { side: COL.hullLow, top: COL.hullMid, back: COL.hullMid });
  decals.quad([-DOCK_X, DOCK_TOP + 1.6, z - 1.65], [DOCK_X, DOCK_TOP + 1.6, z - 1.65], [DOCK_X, DOCK_TOP + 2.4, z - 1.65], [-DOCK_X, DOCK_TOP + 2.4, z - 1.65], COL.accent);
  // stern hangar: two side bays with lit doors above the waterline
  for (const s of [-1, 1]) {
    const x0 = s * (DOCK_X + 4.2), x1 = s * 35;
    b.box([Math.min(x0, x1), -17.5, z - 0.5], [Math.max(x0, x1), -13, z + 0.05], { side: COL.dark, back: COL.dark });
    for (let k = 0; k < 2; k++) {
      const xa = Math.min(x0, x1) + 0.4 + k * 1.75;
      lights.quad([xa, -13.9, z - 0.55], [xa + 1.2, -13.9, z - 0.55], [xa + 1.2, -13.5, z - 0.55], [xa, -13.5, z - 0.55], COL.lightWarm);
    }
    glows.add([s * 33, -13.7, z - 1.2], COL.lightWarm, 7);
  }
  // dock tunnel: walls with frames, ceiling, back wall, lights
  b.quad([-DOCK_X, DOCK_FLOOR, z], [-DOCK_X, DOCK_TOP, z], [-DOCK_X, DOCK_TOP, DOCK_END], [-DOCK_X, DOCK_FLOOR, DOCK_END], COL.dockWall);
  b.quad([DOCK_X, DOCK_FLOOR, z], [DOCK_X, DOCK_FLOOR, DOCK_END], [DOCK_X, DOCK_TOP, DOCK_END], [DOCK_X, DOCK_TOP, z], COL.dockWall);
  b.quad([-DOCK_X, DOCK_TOP, z], [DOCK_X, DOCK_TOP, z], [DOCK_X, DOCK_TOP, DOCK_END], [-DOCK_X, DOCK_TOP, DOCK_END], COL.dockCeiling);
  b.quad([-DOCK_X, DOCK_FLOOR, DOCK_END], [-DOCK_X, DOCK_TOP, DOCK_END], [DOCK_X, DOCK_TOP, DOCK_END], [DOCK_X, DOCK_FLOOR, DOCK_END], COL.dock);
  for (let fz = z + 4; fz < DOCK_END; fz += 6) {
    for (const s of [-1, 1]) b.box([s > 0 ? DOCK_X - 0.6 : -DOCK_X, -19, fz], [s > 0 ? DOCK_X : -DOCK_X + 0.6, DOCK_TOP, fz + 0.5], COL.hullLow);
    b.box([-DOCK_X, DOCK_TOP - 0.6, fz], [DOCK_X, DOCK_TOP, fz + 0.5], COL.hullLow);
  }
  for (let i = 0; i < 6; i++) {
    const lz = z + 2 + i * 4, ly = DOCK_TOP - 1.2;
    lights.box([-DOCK_X + 0.05, ly - 0.3, lz], [-DOCK_X + 0.35, ly + 0.3, lz + 1.2], COL.lightWarm);
    lights.box([DOCK_X - 0.35, ly - 0.3, lz], [DOCK_X - 0.05, ly + 0.3, lz + 1.2], COL.lightWarm);
    glows.add([-DOCK_X + 0.6, ly, lz + 0.6], COL.lightWarm, 5).add([DOCK_X - 0.6, ly, lz + 0.6], COL.lightWarm, 5);
  }
  for (let x = -20; x <= 20; x += 10) {
    lights.box([x - 1.5, DOCK_TOP - 0.15, DOCK_END - 4], [x + 1.5, DOCK_TOP - 0.05, DOCK_END - 3], COL.lightWhite);
  }
}

// bow: the deck tapers from 80 m to 52 m wide; the ski ramp (the Skua takes off on it) runs
// down the middle, angular cheeks fall away to the edges.
const RAMP_X = 17;
const RAMP_H = () => SHAPE.rampH;
const rampY = (z: number) => z <= RAMP0 || !SHAPE.rampH ? 0 : SHAPE.rampH * Math.pow(Math.min(1, (z - RAMP0) / (BOW_Z - RAMP0)), 1.6);

function deck(b: LowPolyBuilder, decals: LowPolyBuilder, lights: LowPolyBuilder) {
  const ramp = SHAPE.rampH > 0, end = SHAPE.deckZ[SHAPE.deckZ.length - 1];
  const flat = ramp ? [-100, TAPER0, 65, RAMP0] : SHAPE.deckZ;
  const rampZ = ramp ? [RAMP0, 80, 85, 90, 95, BOW_Z] : [];
  const all = ramp ? [...flat, ...rampZ.slice(1)] : flat;
  const k1 = SHAPE.deckZ[1];   // where the deck starts to narrow
  // flat deck, following the planform
  for (let i = 0; i + 1 < flat.length; i++) {
    const za = flat[i], zb = flat[i + 1], wa = deckW(za), wb = deckW(zb);
    b.quad([-wa, 0, za], [-wb, 0, zb], [wb, 0, zb], [wa, 0, za], COL.deck);
  }
  // ski ramp of steel strips, cheeks to both sides
  for (let i = 0; i + 1 < rampZ.length; i++) {
    const za = rampZ[i], zb = rampZ[i + 1], ya = rampY(za), yb = rampY(zb), wa = deckW(za), wb = deckW(zb);
    b.quad([-RAMP_X, ya, za], [-RAMP_X, yb, zb], [RAMP_X, yb, zb], [RAMP_X, ya, za], i % 2 ? COL.deckDark : COL.deck);
    for (const s of [-1, 1]) {
      const q: V3[] = [[s * RAMP_X, ya, za], [s * RAMP_X, yb, zb], [s * wb, 0, zb], [s * wa, 0, za]];
      b.poly(s > 0 ? q : q.slice().reverse(), i % 2 ? COL.deckDark : COL.deck);
    }
  }
  // underside and edge faces along the whole planform
  for (let i = 0; i + 1 < all.length; i++) {
    const za = all[i], zb = all[i + 1], wa = deckW(za), wb = deckW(zb);
    b.quad([-wa, -1.5, za], [wa, -1.5, za], [wb, -1.5, zb], [-wb, -1.5, zb], COL.deckUnder);
    for (const s of [-1, 1]) b.quad([s * wa, -1.5, za], [s * wa, 0, za], [s * wb, 0, zb], [s * wb, -1.5, zb], COL.deckEdge);
  }
  b.quad([-DECK_W, -1.5, -100], [-DECK_W, 0, -100], [DECK_W, 0, -100], [DECK_W, -1.5, -100], COL.deckEdge);
  // bow face over the lip with a dark band, and under the overhang a bulkhead down to the prow's chin
  if (ramp) {
    const rh = RAMP_H();
    b.poly([[-BOW_W, -1.5, BOW_Z], [BOW_W, -1.5, BOW_Z], [BOW_W, 0, BOW_Z], [RAMP_X, rh, BOW_Z], [-RAMP_X, rh, BOW_Z], [-BOW_W, 0, BOW_Z]], COL.hullMid);
    decals.quad([-RAMP_X, rh - 0.9, BOW_Z + 0.05], [RAMP_X, rh - 0.9, BOW_Z + 0.05], [RAMP_X, rh - 0.3, BOW_Z + 0.05], [-RAMP_X, rh - 0.3, BOW_Z + 0.05], COL.accent);
    const chin = hullWidth(BOW_Z, -7);
    b.poly([[-BOW_W, -1.5, BOW_Z], [BOW_W, -1.5, BOW_Z], [chin, -7, BOW_Z], [-chin, -7, BOW_Z]], COL.hullLow);
  }
  // flare panels under the overhang: from the knuckle up to the deck edge, where the deck is the wider
  for (let z = 30; z < end; z += 5) {
    const z2 = Math.min(end, z + 5);
    const in0 = hullWidth(z, -7), in1 = hullWidth(z2, -7), out0 = deckW(z), out1 = deckW(z2);
    if (out0 - in0 < 0.3 && out1 - in1 < 0.3) continue;
    for (const s of [-1, 1]) {
      const q: V3[] = [[s * in0, -7, z], [s * out0, -1.5, z], [s * out1, -1.5, z2], [s * in1, -7, z2]];
      b.poly(s > 0 ? q : q.slice().reverse(), z % 10 ? COL.hullMid : COL.hull);
    }
  }

  // markings (separate mesh with depth offset), in three layers a few cm apart so that
  // overlapping decals never share a height (that flickers): panels, lines, details on lines
  const y0 = 0.03, y = 0.06, y2 = 0.09;
  const LIFT = { x: 16.5, z0: 12, z1: 38 };
  // darker deck panels: landing area aft, catapult lane forward, the lift (a steel plate)
  decals.quad([-30, y0, -98], [30, y0, -98], [30, y0, -54.5], [-30, y0, -54.5], COL.deckDark);
  const laneEnd = ramp ? RAMP0 : end - 14;
  decals.quad([-4, y0, 40], [4, y0, 40], [4, y0, laneEnd], [-4, y0, laneEnd], COL.deckDark);
  decals.quad([-LIFT.x, y0, LIFT.z0], [-LIFT.x, y0, LIFT.z1], [LIFT.x, y0, LIFT.z1], [LIFT.x, y0, LIFT.z0], COL.lift);
  // centre line, interrupted by the lift
  for (let z = -16; z < (ramp ? 70 : end - 16); z += 8) {
    if (z + 4.5 > LIFT.z0 - 1 && z < LIFT.z1 + 1) continue;
    decals.quad([-0.5, y, z], [-0.5, y, z + 4.5], [0.5, y, z + 4.5], [0.5, y, z], COL.white);
  }
  for (const s of [-1, 1]) {
    const lane = ramp ? 74 : 112;
    decals.quad([s * 7.6, y, 42], [s * 7.6, y, lane], [s * 8.4, y, lane], [s * 8.4, y, 42], COL.dark);
    // yellow safety line and ochre deck-edge band follow the planform
    for (const [za, zb] of [[-96, k1], [k1, ramp ? 73 : end - 22]]) {
      decals.quad([s * (deckW(za) - 3.4), y, za], [s * (deckW(zb) - 3.4), y, zb], [s * (deckW(zb) - 2.6), y, zb], [s * (deckW(za) - 2.6), y, za], COL.yellow);
    }
    for (const [za, zb] of [[-99, k1], [k1, ramp ? RAMP0 : end - 10]]) {
      decals.quad([s * (deckW(za) - 0.8), y, za], [s * (deckW(zb) - 0.8), y, zb], [s * (deckW(zb) - 0.1), y, zb], [s * (deckW(za) - 0.1), y, za], COL.accent);
    }
  }
  // ramp markings: centre dashes, yellow edges, warning chevrons at the lip
  for (let i = 0; i + 1 < rampZ.length; i++) {
    const za = rampZ[i] + 0.8, zb = Math.min(rampZ[i + 1] - 0.8, 97.4);
    const ya = rampY(za) + y, yb = rampY(zb) + y;
    decals.quad([-0.5, ya, za], [-0.5, yb, zb], [0.5, yb, zb], [0.5, ya, za], COL.white);
    for (const s of [-1, 1]) {
      const x0 = s * (RAMP_X - 0.9), x1 = s * (RAMP_X - 0.2), za2 = rampZ[i], zb2 = rampZ[i + 1];
      decals.quad([x0, rampY(za2) + y, za2], [x0, rampY(zb2) + y, zb2], [x1, rampY(zb2) + y, zb2], [x1, rampY(za2) + y, za2], COL.yellow);
    }
  }
  if (ramp) for (let x = -RAMP_X + 1; x < RAMP_X - 1; x += 2) {
    decals.quad([x, rampY(98.2) + y, 98.2], [x + 1, rampY(98.2) + y, 98.2], [x + 1, rampY(99.6) + y, 99.6], [x, rampY(99.6) + y, 99.6], Math.round(x) % 4 === 0 ? COL.yellow : COL.dark);
  }
  // lift: yellow and black hazard border, seams across the plate
  const hz = (x0: number, z0: number, x1: number, z1: number, col: string) => decals.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], col);
  const band = 0.9;
  for (let x = -LIFT.x, k = 0; x < LIFT.x - 0.01; x += 1.5, k++) {
    const x1 = Math.min(LIFT.x, x + 1.5), col = k % 2 ? COL.dark : COL.yellow;
    hz(x, LIFT.z0, x1, LIFT.z0 + band, col);
    hz(x, LIFT.z1 - band, x1, LIFT.z1, col);
  }
  for (let z = LIFT.z0 + band, k = 0; z < LIFT.z1 - band - 0.01; z += 1.5, k++) {
    const z1 = Math.min(LIFT.z1 - band, z + 1.5), col = k % 2 ? COL.yellow : COL.dark;
    hz(-LIFT.x, z, -LIFT.x + band, z1, col);
    hz(LIFT.x - band, z, LIFT.x, z1, col);
  }
  for (const z of [20.5, 29.5]) hz(-LIFT.x + band, z - 0.12, LIFT.x - band, z + 0.12, COL.liftSeam);
  // landing spot circle (drone pad) with a cross, sized for the large drone
  const cz = -70, r0 = 12, r1 = 13;
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2, c = ((i + 1) / 20) * Math.PI * 2;
    decals.quad([Math.cos(a) * r0, y, cz + Math.sin(a) * r0], [Math.cos(a) * r1, y, cz + Math.sin(a) * r1],
      [Math.cos(c) * r1, y, cz + Math.sin(c) * r1], [Math.cos(c) * r0, y, cz + Math.sin(c) * r0], COL.white);
  }
  decals.quad([-0.6, y, cz - 7], [0.6, y, cz - 7], [0.6, y, cz + 7], [-0.6, y, cz + 7], COL.white);
  for (const s of [-1, 1]) decals.quad([s * 0.6, y, cz - 0.6], [s * 7, y, cz - 0.6], [s * 7, y, cz + 0.6], [s * 0.6, y, cz + 0.6], COL.white);
  decals.quad([-2.5, y2, cz + 9], [2.5, y2, cz + 9], [0, y2, cz + 11], [0, y2, cz + 11], COL.yellow);

  // deck edge lights (inside the tapering edge), blue approach lights at the stern, lip lights
  for (let z = -96; z <= (ramp ? 72 : end - 16); z += 12) {
    if (deckW(z) < 4) continue;
    for (const s of [-1, 1]) {
      const x = s * (deckW(z) - 1.4);
      lights.box([x - 0.3, 0, z - 0.3], [x + 0.3, 0.35, z + 0.3], COL.lightWhite);
      glows.add([x, 0.45, z], COL.lightWhite, 3.5);
    }
  }
  for (let x = -24; x <= 24; x += 6) {
    lights.box([x - 0.3, 0, -99.4], [x + 0.3, 0.35, -98.8], COL.lightBlue);
    glows.add([x, 0.45, -99.1], COL.lightBlue, 4);
  }
  if (ramp) for (const s of [-1, 1]) {
    const rh = RAMP_H();
    lights.box([s * (RAMP_X - 0.6) - 0.3, rh, BOW_Z - 0.7], [s * (RAMP_X - 0.6) + 0.3, rh + 0.35, BOW_Z - 0.1], COL.lightRed);
    glows.add([s * (RAMP_X - 0.6), rh + 0.5, BOW_Z - 0.4], COL.lightRed, 4);
  } else {
    lights.box([-0.3, 0, end - 4], [0.3, 0.35, end - 3.4], COL.lightRed);
    glows.add([0, 0.5, end - 3.7], COL.lightRed, 5);
  }
  // safety rails along the deck edges (segments follow the taper)
  for (const s of [-1, 1]) {
    const pts = ramp ? [-99, -64, -29, 6, 41, TAPER0, 65, 74] : [-99, -64, -29, 6, 20, 50, 80, 110, 132];
    for (let i = 0; i + 1 < pts.length; i++) {
      const za = pts[i], zb = pts[i + 1];
      b.beam([s * (deckW(za) - 0.1), 1.1, za], [s * (deckW(zb) - 0.1), 1.1, zb], 0.12, COL.platform);
    }
    for (let z = -99; z <= pts[pts.length - 1]; z += 7) b.beam([s * (deckW(z) - 0.1), 0, z], [s * (deckW(z) - 0.1), 1.1, z], 0.12, COL.platform);
  }
  // close-in weapon systems on the deck corners: base, dome and gun
  for (const [x, z] of ramp ? [[-35, -94], [35, -94], [-32, 64], [32, 64]] : [[-35, -94], [35, -94], [-24, 62], [24, 62]]) {
    b.cylinder([x, 0, z], 2.4, 2.2, 1.2, 8, COL.platform, COL.platformTop);
    b.cylinder([x, 1.2, z], 1.9, 1.3, 1.6, 8, COL.white, COL.white);
    b.cone([x, 2.8, z], 1.3, 1.0, 8, COL.white);
    b.box([x - 0.25, 1.5, z + 1.4], [x + 0.25, 1.9, z + 3.4], COL.dark);
  }
}

/** an ACCB capsule standing on deck (the player's ochre, like the one an Otter carries) */
function deckAccb(b: LowPolyBuilder, x: number, z: number) {
  const ph = Math.PI / 8;
  b.cylinder([x, 0.6, z], 1.6, 1.7, 2.6, 8, COL.accent, COL.accent, null, ph);
  b.cylinder([x, 1.5, z], 1.66, 1.66, 0.3, 8, COL.accentDark, COL.accentDark, null, ph);
  b.cylinder([x, 3.2, z], 1.7, 1.7, 0.35, 8, COL.dark, COL.dark, null, ph);
  b.cylinder([x, 3.55, z], 1.7, 1.15, 0.9, 8, COL.white, COL.platformTop, null, ph);
  b.cone([x, 4.45, z], 1.15, 0.5, 8, COL.accent);
  for (let i = 0; i < 4; i++) {
    const a = ph + i * Math.PI / 2, cx = Math.cos(a), cz = Math.sin(a);
    b.beam([x + cx * 1.4, 0.9, z + cz * 1.4], [x + cx * 2.1, 0.05, z + cz * 2.1], 0.14, COL.platform);
  }
}

/**
 * Life on deck: the ships run themselves and keep their Skuas in the hangar, so on
 * deck stand only ACCBs waiting to be loaded, clear of the lift, the catapult lane,
 * the drone pad and the stern.
 */
function deckLife(b: LowPolyBuilder) {
  for (const [x, z] of [[33.5, -47], [33.5, -41.5], [29.5, -44.3]] as [number, number][]) deckAccb(b, x, z);
}

/**
 * The enemy's island: two raked tiers on the starboard deck edge, a lattice mast leaning
 * aft with the radar on top, red-lit bridge windows and violet trim. The flight deck stays
 * clear down the middle.
 */
function enemyIsland(b: LowPolyBuilder, decals: LowPolyBuilder, lights: LowPolyBuilder) {
  // a block whose four corners per level are given as [x outer, x inner, z aft, z fore]
  const block = (lo: [number, number, number, number], hi: [number, number, number, number], y0: number, y1: number,
    cols: { top: string; out: string; in: string; fore: string; aft: string }) => {
    const [xo0, xi0, za0, zf0] = lo, [xo1, xi1, za1, zf1] = hi;
    b.quad([xo1, y1, za1], [xo1, y1, zf1], [xi1, y1, zf1], [xi1, y1, za1], cols.top);
    b.quad([xo0, y0, za0], [xo0, y0, zf0], [xo1, y1, zf1], [xo1, y1, za1], cols.out);
    b.quad([xi0, y0, za0], [xi1, y1, za1], [xi1, y1, zf1], [xi0, y0, zf0], cols.in);
    b.quad([xo0, y0, zf0], [xi0, y0, zf0], [xi1, y1, zf1], [xo1, y1, zf1], cols.fore);
    b.quad([xo0, y0, za0], [xo1, y1, za1], [xi1, y1, za1], [xi0, y0, za0], cols.aft);
  };
  const cols = { top: COL.supTop, out: COL.sup, in: COL.supLight, fore: COL.supLight, aft: COL.supDark };
  // lower tier: long and low, steeply raked at both ends
  block([-39.5, -23, -50, 8], [-37.5, -26, -42, -4], 0, 11, cols);
  // upper tier with the bridge, its front raked sharply
  block([-37, -27, -38, -9], [-35.5, -28.5, -34, -15.5], 11, 19.5, cols);
  // violet trim along the lower tier's top edges
  const n = 0.06;
  decals.quad([-26 + n, 10.2, -42], [-26 + n, 10.2, -4], [-26 + n, 10.95, -4], [-26 + n, 10.95, -42], COL.accent);
  decals.quad([-37.5 - n, 10.2, -42], [-37.5 - n, 10.95, -42], [-37.5 - n, 10.95, -4], [-37.5 - n, 10.2, -4], COL.accent);
  // window rows on the inner side of the lower tier, a few lit red
  let k = 0;
  for (let wz = -40; wz < -6; wz += 3.2) {
    const lit = k++ % 4 === 1, x = -25.2 + n;
    (lit ? lights : decals).quad([x, 5.6, wz], [x, 5.6, wz + 2], [x, 6.6, wz + 2], [x, 6.6, wz], lit ? COL.windowLit : COL.window);
    if (lit) glows.add([x + 0.6, 6.1, wz + 1], COL.lightRed, 3.5);
  }
  // bridge: a red band across the raked front and down both sides of the upper tier
  const front = (u: number, x: number): V3 => {
    const y = 11 + 8.5 * u, z = -9 + (-15.5 - -9) * u, xo = -37 + 1.5 * u, xi = -27 - 1.5 * u;
    return [xo + (xi - xo) * x, y, z + 0.08];
  };
  lights.quad(front(0.62, 0.08), front(0.62, 0.92), front(0.82, 0.92), front(0.82, 0.08), COL.windowLit);
  for (let x = 0.2; x < 0.9; x += 0.18) b.beam(front(0.62, x), front(0.82, x), 0.14, COL.dark);
  glows.add([-32, 17, -12.5], COL.lightRed, 12);
  for (const sx of [-35.85, -28.15]) {
    const out = sx < -32 ? -0.07 : 0.07;
    lights.quad([sx + out, 16.6, -32], [sx + out, 16.6, -17], [sx + out, 17.6, -17], [sx + out, 17.6, -32], COL.windowLit);
  }
  // radomes and vents on the lower tier's aft roof, antennas
  for (const [x, z, r] of [[-31.5, -39, 1.9], [-34.5, -6.5, 1.4]] as [number, number, number][]) {
    b.cylinder([x, 11, z], r * 0.8, r * 0.8, 0.8, 8, COL.platform, COL.platformTop);
    b.cylinder([x, 11.8, z], r, r * 0.75, r * 0.7, 8, COL.white, COL.white);
    b.cone([x, 11.8 + r * 0.7, z], r * 0.75, r * 0.6, 8, COL.white);
  }
  for (let i = 0; i < 3; i++) b.box([-29.5 + i * 1.2, 11, -36], [-28.9 + i * 1.2, 11.6, -32], COL.dark);
  for (const [x, z, h] of [[-36.5, -36, 6], [-27.5, -10, 4.5]] as [number, number, number][]) b.beam([x, 11, z], [x, 11 + h, z], 0.16, COL.dark);
  // lattice mast leaning aft from the upper tier's roof
  const foot: V3[] = [[-34.2, 19.5, -30], [-29.8, 19.5, -30], [-29.8, 19.5, -20.5], [-34.2, 19.5, -20.5]];
  const top: V3 = [-32, 38, -31];
  const at = (p: V3, u: number): V3 => [p[0] + (top[0] - p[0]) * u, p[1] + (top[1] - p[1]) * u, p[2] + (top[2] - p[2]) * u];
  for (let i = 0; i < 4; i++) b.beam(foot[i], at(foot[i], 0.92), 0.45, COL.towerDark);
  for (const u of [0.25, 0.5, 0.72]) {
    for (let i = 0; i < 4; i++) b.beam(at(foot[i], u), at(foot[(i + 1) % 4], u), 0.25, COL.tower);
    b.beam(at(foot[0], u), at(foot[2], u - 0.2), 0.18, COL.towerDark);
  }
  b.cylinder([top[0], 36, top[2]], 1.3, 1.1, 1.0, 6, COL.platform, COL.platformTop);
  // aircraft warning lights on the masthead and the yardarm
  b.beam([top[0] - 3.2, 33, top[2] + 0.5], [top[0] + 3.2, 33, top[2] + 0.5], 0.18, COL.dark);
  lights.box([top[0] - 3.5, 33.1, top[2] + 0.2], [top[0] - 2.9, 33.7, top[2] + 0.8], COL.lightRed);
  lights.box([top[0] + 2.9, 33.1, top[2] + 0.2], [top[0] + 3.5, 33.7, top[2] + 0.8], COL.lightRed);
  glows.add([top[0] - 3.2, 33.4, top[2] + 0.5], COL.lightRed, 6).add([top[0] + 3.2, 33.4, top[2] + 0.5], COL.lightRed, 6);
  // barbette for the laser turret ahead of the island
  b.cylinder([-30, 0, 22], 4.2, 3.6, 2.6, 8, COL.supDark, COL.supTop, null, Math.PI / 8);
  b.cylinder([-30, 2.1, 22], 3.7, 3.7, 0.35, 8, COL.accent, COL.accent, null, Math.PI / 8);
}

/** the enemy's radar: a tall violet blade on a turntable */
function enemyRadar(): THREE.BufferGeometry {
  const b = new LowPolyBuilder();
  b.cylinder([0, 0, 0], 0.7, 0.5, 1.6, 6, COL.dark);
  b.cylinder([0, 1.5, 0], 1.3, 1.1, 0.5, 6, COL.platform, COL.platformTop);
  // a tall shallow pyramid: face forward, framed back
  const y0 = 2.0, y1 = 9.5;
  const pts: V3[] = [[-3.4, y0, 0], [3.4, y0, 0], [0, y1, -0.4]];
  const face: V3 = [0, y0 + 2.6, 1.2], back: V3 = [0, y0 + 2.6, -1.6];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    b.tri(pts[i], pts[j], face, i === 1 ? COL.radarLight : COL.radar);
    b.tri(pts[j], pts[i], back, i === 1 ? COL.radar : COL.radarDark);
  }
  b.beam([0, y0, -0.8], [0, y1 - 1.5, -0.8], 0.25, COL.dark);
  return b.build();
}

function turret(): { housing: THREE.BufferGeometry; barrel: THREE.BufferGeometry } {
  const h = new LowPolyBuilder();
  h.cylinder([0, 0, 0], 3.0, 2.6, 1.4, 8, COL.platform, COL.platformTop, null, Math.PI / 8);
  h.cylinder([0, 1.25, 0], 2.7, 2.7, 0.2, 8, COL.accent, COL.accent, null, Math.PI / 8);
  // faceted housing: light blue like the original's laser pod
  h.pushTRS([0, 1.4, 0], 0);
  h.prismZ([[-2.4, 0], [2.4, 0], [2.8, 1.5], [1.6, 2.9], [-1.6, 2.9], [-2.8, 1.5]], -2.8, 2.2, COL.turretBody, COL.white);
  h.pop();
  h.box([-1.0, 4.3, -2.2], [1.0, 4.9, -0.6], { side: COL.dark, top: COL.platform });
  const b = new LowPolyBuilder();
  // twin barrels along +z (forward), with cooling rings and lens tips
  b.box([-1.6, -0.8, -1.2], [1.6, 0.8, 1.0], { side: COL.dark, top: COL.platform });
  for (const x of [-0.75, 0.75]) {
    b.pushTRS([x, 0, 1.0], 0, [1, 1, 1], Math.PI / 2);
    b.cylinder([0, 0, 0], 0.55, 0.45, 6.2, 6, COL.barrel, COL.barrel);
    for (let k = 0; k < 4; k++) b.cylinder([0, 0.4 + k * 0.55, 0], 0.72, 0.72, 0.16, 6, COL.platform, COL.platform);
    b.cylinder([0, 6.2, 0], 0.55, 0.55, 0.5, 6, COL.platform, COL.platform);
    b.cone([0, 6.7, 0], 0.45, 1.0, 6, COL.turret);
    b.pop();
  }
  return { housing: h.build(), barrel: b.build() };
}

/** stern door over the dock opening: hinged at the top, swings up and aft to open */
function sternDoor(mat: THREE.Material): THREE.Object3D {
  const b = new LowPolyBuilder();
  const h = DOCK_TOP - (CARRIER_WATERLINE - 1.2);   // reaches below the waterline when closed
  b.box([-DOCK_X + 0.3, -h, -0.9], [DOCK_X - 0.3, 0, 0], { side: COL.hullMid, front: COL.hullLow, back: COL.hullMid });
  for (let x = -DOCK_X + 4; x < DOCK_X - 2; x += 7.5) b.box([x, -h + 0.5, -1.25], [x + 0.6, -0.5, -0.9], COL.hullLow);
  b.box([-DOCK_X + 0.3, -1.2, -1.3], [DOCK_X - 0.3, -0.6, -0.9], COL.accent);
  const m = new THREE.Mesh(b.build(), mat);
  m.castShadow = true;
  const g = new THREE.Group();
  g.position.set(0, DOCK_TOP, -100.05);
  g.add(m);
  return g;
}

export interface CarrierModel {
  group: THREE.Group;
  /** where the stem meets the water (local z): the hull reaches this far forward */
  stemZ: number;
  /** the ski ramp's height at the lip (0: flat catapult deck) */
  rampH: number;
  radar: THREE.Object3D;
  turret: THREE.Object3D;
  barrel: THREE.Object3D;
  /** stern door: rotation.x from 0 (closed) to 1.45 (open, swung up and aft) */
  sternDoor: THREE.Object3D;
  /** the Skua lift's platform: position.y from 0 (flush with the deck) down to -LIFT_DEPTH (hangar); null on models without one */
  lift: THREE.Object3D | null;
  /** the runway sunk into the deck (the Skua rolls that much lower there); null on decks without one */
  runway: typeof STOORWORM_RUNWAY | null;
  /** unlit light sources; scale material.color with darkness */
  lights: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** additive halos around the lights (cheap night glow) */
  glow: GlowPoints;
  triangles: number;
}

/** the player's Stoorworm as built in Blender (art/stoorworm): its moving parts, the lift and the sunk runway */
function stoorwormFromBlender(): CarrierModel {
  const m = glbModel('stoorworm');
  if (!m) throw new Error('art/stoorworm/stoorworm.glb fehlt');
  const part = (name: string) => m.root.getObjectByName(name)!;
  for (const cam of ['cam_bridge', 'cam_stern', 'cam_outside']) m.root.getObjectByName(cam)?.removeFromParent();
  m.root.name = 'carrier';
  m.lights.name = 'carrier-lights';
  return {
    group: m.root, stemZ: STOORWORM_HULL.bowTip[2], rampH: 0, radar: part('radar'), turret: part('turret'), barrel: part('barrel'),
    sternDoor: part('sternDoor'), lift: part('lift'), runway: STOORWORM_RUNWAY, lights: m.lights, glow: m.glow, triangles: triangleCount(m.root),
  };
}

/** the player's Stoorworm (from Blender), or the enemy's carrier built here: the tower hull with its own island, colours and radar */
export function buildCarrier(team: 'spieler' | 'feind'): CarrierModel {
  if (team === 'spieler') return stoorwormFromBlender();
  const body = new LowPolyBuilder();
  const decals = new LowPolyBuilder();
  const lightsB = new LowPolyBuilder();
  glows = new GlowSet();
  hull(body, decals, lightsB);
  deck(body, decals, lightsB);
  deckLife(body);
  enemyIsland(body, decals, lightsB);

  const mat = lowPolyMaterial();
  const decalMat = lowPolyMaterial({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const group = new THREE.Group();
  group.name = 'enemy-carrier';
  const bodyMesh = new THREE.Mesh(body.build(), mat);
  const decalMesh = new THREE.Mesh(decals.build(), decalMat);
  for (const m of [bodyMesh, decalMesh]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }
  decalMesh.castShadow = false;
  const lights = new THREE.Mesh(lightsB.build(), new THREE.MeshBasicMaterial({
    vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  }));
  lights.name = 'carrier-lights';
  group.add(lights);
  const glow = glows.build();
  glow.name = 'carrier-glow';
  group.add(glow);

  const radarMesh = new THREE.Mesh(enemyRadar(), mat);
  radarMesh.position.set(-32, 37, -31);
  radarMesh.castShadow = true;
  group.add(radarMesh);

  const t = turret();
  const turretObj = new THREE.Mesh(t.housing, mat);
  turretObj.position.set(-30, 2.45, 22);
  turretObj.castShadow = true;
  const barrel = new THREE.Mesh(t.barrel, mat);
  barrel.position.set(0, 2.9, 1.6);
  barrel.castShadow = true;
  turretObj.add(barrel);
  group.add(turretObj);

  const door = sternDoor(mat);
  group.add(door);

  let triangles = body.triangleCount + decals.triangleCount + lightsB.triangleCount;
  for (const m of [radarMesh, turretObj, barrel]) triangles += m.geometry.getAttribute('position').count / 3;
  return { group, stemZ: SHAPE.bowTip[2], rampH: SHAPE.rampH, radar: radarMesh, turret: turretObj, barrel, sternDoor: door, lift: null, runway: null, lights, glow, triangles };
}

/** the Stoorworm's three cameras, from its model (carrier coordinates): the bridge, astern from the mast, outside as on the title picture */
export function shipCameras(): Record<'bruecke' | 'achtern' | 'aussen', { eye: V3; look: V3 }> {
  const cam = (name: string) => {
    const c = glbCamera('stoorworm', name);
    if (!c) throw new Error(`Kamera ${name} fehlt im Stoorworm-Modell`);
    return c;
  };
  return { bruecke: cam('cam_bridge'), achtern: cam('cam_stern'), aussen: cam('cam_outside') };
}
