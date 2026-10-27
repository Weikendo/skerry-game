import * as THREE from 'three';
import { LowPolyBuilder, type V3 } from '../engine/lowpoly';
import { PAL } from '../engine/palette';
import { t } from '../i18n';

// Island structures, loosely after the original object set: domed command
// centre (43), lattice mast (48), round hangar (50), factory with chimney (51),
// tank (52), warehouse (47), the rotating gun turret (44), bunker (45/46) and
// the defence dome (43). Origin = centre of
// the footprint on the foundation top; +z faces the command centre.

export type BuildingType = 'kommandozentrale' | 'funkmast' | 'hangar' | 'fabrik' | 'tanklager' | 'geschuetzturm' | 'lagerhalle' | 'bunker' | 'kuppel' | 'landeplatz';

export interface BuildingDef {
  name: string;
  radius: number;                 // collision / spacing radius
  plinth: { shape: 'oct' | 'rect'; a: number; b: number };
  hp: number;
  /** hit spheres in building coordinates: x, y, z, r */
  hits: [number, number, number, number][];
  /** height for the map / targeting */
  height: number;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  kommandozentrale: { name: t('building.kommandozentrale'), radius: 30, plinth: { shape: 'oct', a: 29, b: 29 }, hp: 4096, hits: [[0, 9, 0, 26]], height: 22 },
  funkmast: { name: t('building.funkmast'), radius: 10, plinth: { shape: 'rect', a: 8.5, b: 8.5 }, hp: 4000, hits: [[0, 8, 0, 8], [0, 26, 0, 5], [0, 42, 0, 4]], height: 46 },
  hangar: { name: t('building.hangar'), radius: 30, plinth: { shape: 'rect', a: 19, b: 25 }, hp: 4000, hits: [[0, 7, 0, 17], [0, 7, 13, 15], [0, 7, -13, 15]], height: 14 },
  fabrik: { name: t('building.fabrik'), radius: 27, plinth: { shape: 'rect', a: 26, b: 16 }, hp: 4000, hits: [[-8, 8, 0, 14], [8, 8, 0, 14], [23, 20, -5, 5]], height: 40 },
  tanklager: { name: t('building.tanklager'), radius: 20, plinth: { shape: 'rect', a: 18, b: 11 }, hp: 4000, hits: [[-8, 6, -1, 8.5], [8.5, 5, 2, 7]], height: 12 },
  geschuetzturm: { name: t('building.geschuetzturm'), radius: 8, plinth: { shape: 'oct', a: 7.5, b: 7.5 }, hp: 1000, hits: [[0, 4.5, 0, 6.5]], height: 8 },
  lagerhalle: { name: t('building.lagerhalle'), radius: 20, plinth: { shape: 'rect', a: 16, b: 11 }, hp: 4000, hits: [[-6, 6, 0, 10], [6, 6, 0, 10]], height: 13 },
  bunker: { name: t('building.bunker'), radius: 9, plinth: { shape: 'oct', a: 8.6, b: 8.6 }, hp: 1500, hits: [[0, 2, 0, 6.8]], height: 5 },
  kuppel: { name: t('building.kuppel'), radius: 24, plinth: { shape: 'oct', a: 23, b: 23 }, hp: 6000, hits: [[0, 5, 0, 19], [0, 12, 0, 10]], height: 18 },
  landeplatz: { name: t('building.landeplatz'), radius: 24, plinth: { shape: 'oct', a: 16.5, b: 16.5 }, hp: 4000, hits: [[0, 1, 0, 15], [20, 2, 4, 3.5]], height: 3 },
};

/** faction accent ramp (player ochre, enemy violet) */
export interface Accent { hell: string; main: string; dunkel: string; grau: string }
export const ACCENTS: Record<'spieler' | 'feind' | 'neutral', Accent> = {
  spieler: { hell: PAL.ockerHell, main: PAL.ocker, dunkel: PAL.ockerDunkel, grau: PAL.ockerGrau },
  feind: { hell: PAL.feindHell, main: PAL.feind, dunkel: PAL.feindDunkel, grau: PAL.feindGrau },
  neutral: { hell: PAL.stahlHell, main: PAL.stahl, dunkel: PAL.metall, grau: PAL.metallHell },
};

export interface BuildCtx {
  b: LowPolyBuilder;
  lights: LowPolyBuilder;
  accent: Accent;
  /** halo at a point in the building's local frame */
  glow(p: V3, color: string, size: number): void;
}

const ring = (r: number, y: number, n: number, phase = 0): V3[] =>
  Array.from({ length: n }, (_, i) => {
    const a = phase + (i / n) * Math.PI * 2;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  });

function bandedRings(b: LowPolyBuilder, rings: [number, number][], n: number, colors: string[], phase: number) {
  for (let k = 0; k + 1 < rings.length; k++) {
    const A = ring(rings[k][0], rings[k][1], n, phase), B = ring(rings[k + 1][0], rings[k + 1][1], n, phase);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (rings[k + 1][0] < 1e-3) b.tri(A[i], A[j], B[0], colors[k % colors.length]);
      else b.quad(A[i], A[j], B[j], B[i], colors[k % colors.length]);
    }
  }
}

export function plinth(b: LowPolyBuilder, def: BuildingDef, depth: number) {
  const { shape, a, b: bb } = def.plinth;
  if (shape === 'rect') b.box([-a, -depth, -bb], [a, 0.3, bb], { side: PAL.deckDunkel, top: PAL.deck });
  else {
    const prof = ring(a, 0, 8, Math.PI / 8).map(([x, , z]) => [x, z] as [number, number]);
    b.pushTRS([0, 0.3, 0], 0, [1, 1, 1], Math.PI / 2);
    b.prismZ(prof, 0, depth + 0.3, PAL.deckDunkel, PAL.deck);
    b.pop();
  }
}

export function kommandozentrale({ b, lights, glow, accent: A }: BuildCtx) {
  const ph = Math.PI / 8;
  b.cylinder([0, 0, 0], 26, 26, 7, 8, PAL.stahlHell, PAL.stahlHell, null, ph);
  bandedRings(b, [[26, 7], [23.5, 13], [17, 18.5], [8, 21.5], [0, 22.5]], 8, [PAL.weiss, PAL.stahlHell], ph);
  // window band, every other window lit at night
  const W = ring(26.08, 0, 8, ph);
  for (let i = 0; i < 8; i++) {
    const p = W[i], q = W[(i + 1) % 8];
    for (let k = 0; k < 3; k++) {
      const t0 = 0.12 + k * 0.28, t1 = t0 + 0.2;
      const a: V3 = [p[0] + (q[0] - p[0]) * t0, 3, p[2] + (q[2] - p[2]) * t0];
      const c: V3 = [p[0] + (q[0] - p[0]) * t1, 3, p[2] + (q[2] - p[2]) * t1];
      const lit = (i + k) % 2 === 0;
      (lit ? lights : b).quad(a, c, [c[0], 5, c[2]], [a[0], 5, a[2]], lit ? PAL.lichtWarm : PAL.fensterBlau);
      if (lit) glow([(a[0] + c[0]) / 2 * 1.02, 4, (a[2] + c[2]) / 2 * 1.02], PAL.lichtWarm, 6);
    }
  }
  // two entrances in the player's accent colour
  for (const s of [-1, 1]) {
    b.box([-4.5, 0, s > 0 ? 24 : -30], [4.5, 5.5, s > 0 ? 30 : -24], { side: A.main, top: A.grau });
    b.quad([-2.2, 0.1, s * 30.06], [2.2, 0.1, s * 30.06], [2.2, 4, s * 30.06], [-2.2, 4, s * 30.06], PAL.anthrazit);
  }
  // the vent above the front entrance: the one opening a virus bomb gets through (red frame)
  b.box([-3.2, 6.2, 25.2], [3.2, 9.4, 26.4], PAL.signalRot);
  b.box([-2.4, 6.7, 25.6], [2.4, 8.9, 26.5], PAL.schwarz);
  // antenna on top
  b.cylinder([0, 22.3, 0], 0.5, 0.25, 12, 6, PAL.anthrazit);
  b.cone([3, 21.4, 2], 2.2, 1.2, 8, PAL.weiss, 0, PAL.stahlHell);
  lights.box([-0.4, 34.1, -0.4], [0.4, 34.9, 0.4], PAL.lichtRot);
  glow([0, 34.5, 0], PAL.lichtRot, 7);
}

export function funkmast({ b, lights, glow }: BuildCtx) {
  b.box([-7, 0, -7], [7, 0.6, 7], PAL.deck);
  const H = 44, base = 6, top = 1.4, segs = 6;
  const at = (sx: number, sz: number, u: number): V3 => {
    const w = base + (top - base) * u;
    return [sx * w, 0.6 + H * u, sz * w];
  };
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let s = 0; s < segs; s++) {
    const u0 = s / segs, u1 = (s + 1) / segs;
    const col = s % 2 ? PAL.weiss : PAL.signalRot;
    for (let c = 0; c < 4; c++) {
      const [ax, az] = corners[c], [bx, bz] = corners[(c + 1) % 4];
      b.beam(at(ax, az, u0), at(ax, az, u1), 0.55, col);
      // X bracing on each face
      b.beam(at(ax, az, u0), at(bx, bz, u1), 0.22, PAL.metall);
      b.beam(at(bx, bz, u0), at(ax, az, u1), 0.22, PAL.metall);
      b.beam(at(ax, az, u1), at(bx, bz, u1), 0.25, PAL.metall);
    }
  }
  b.box([-2.6, H + 0.6, -2.6], [2.6, H + 1.2, 2.6], PAL.metall);
  b.cylinder([-1.2, H + 1.2, 0], 0.18, 0.08, 9, 4, PAL.anthrazit);
  b.cylinder([1.4, H + 1.2, 0.8], 0.15, 0.08, 6, 4, PAL.anthrazit);
  b.pushTRS([0, H - 4, 2.2], 0, [1, 1, 1], Math.PI / 2);
  b.cone([0, 0, 0], 2.4, 1.3, 10, PAL.weiss, 0, PAL.stahlHell);
  b.pop();
  lights.box([-1.6, H + 10, -0.4], [-0.8, H + 10.8, 0.4], PAL.lichtRot);
  glow([-1.2, H + 10.4, 0], PAL.lichtRot, 8);
}

export function hangar({ b, lights, glow, accent: A }: BuildCtx) {
  const R = 16, L = 22, n = 8;
  const arc = Array.from({ length: n + 1 }, (_, i) => {
    const a = Math.PI * (i / n);
    return [Math.cos(a) * R, Math.sin(a) * R * 0.85] as [number, number];
  });
  for (let i = 0; i < n; i++) {
    const [x0, y0] = arc[i], [x1, y1] = arc[i + 1];
    b.quad([x0, y0, -L], [x1, y1, -L], [x1, y1, L], [x0, y0, L], i % 2 ? A.hell : A.main);
  }
  // ribs
  for (let z = -L; z <= L; z += 11) {
    for (let i = 0; i < n; i++) {
      const [x0, y0] = arc[i], [x1, y1] = arc[i + 1];
      b.beam([x0 * 1.01, y0 * 1.01, z], [x1 * 1.01, y1 * 1.01, z], 0.5, A.dunkel);
    }
  }
  // end walls: back closed, front with a big door and warning stripes
  b.poly(arc.map(([x, y]) => [x, y, -L] as V3), PAL.stahl);
  b.poly(arc.map(([x, y]) => [x, y, L] as V3), PAL.stahl);
  const dz = L + 0.06;
  b.quad([-9, 0.1, dz], [9, 0.1, dz], [9, 10.5, dz], [-9, 10.5, dz], PAL.metall);
  for (let i = 0; i < 9; i++) {
    b.quad([-9 + i * 2, 0.1, dz + 0.02], [-8 + i * 2, 0.1, dz + 0.02], [-8 + i * 2, 1.2, dz + 0.02], [-9 + i * 2, 1.2, dz + 0.02],
      i % 2 ? PAL.anthrazit : PAL.signalGelb);
  }
  lights.box([-0.8, 11.3, dz], [0.8, 11.9, dz + 0.4], PAL.lichtWarm);
  glow([0, 11.6, dz + 0.8], PAL.lichtWarm, 9);
}

export function fabrik({ b, lights, glow, accent: A }: BuildCtx) {
  const hx = 18, hz = 12, h = 12;
  b.box([-hx, 0, -hz], [hx, h, hz], { side: PAL.stahlHell, top: PAL.metallHell });
  // saw-tooth roof with glazed north faces
  for (let i = 0; i < 3; i++) {
    const x0 = -hx + i * 12, x1 = x0 + 12;
    b.quad([x0, h, -hz], [x0, h, hz], [x1, h + 5, hz], [x1, h + 5, -hz], PAL.metall);
    b.quad([x1, h, -hz], [x1, h + 5, -hz], [x1, h + 5, hz], [x1, h, hz], PAL.glasBlau);
    b.tri([x0, h, hz], [x1, h, hz], [x1, h + 5, hz], PAL.stahlHell);
    b.tri([x0, h, -hz], [x1, h + 5, -hz], [x1, h, -hz], PAL.stahlHell);
  }
  // office annex and windows
  b.box([-10, 0, hz], [2, 7, hz + 6], { side: A.main, top: A.grau });
  for (let i = 0; i < 4; i++) {
    const x = -9 + i * 2.8;
    lights.quad([x, 3.5, hz + 6.06], [x + 1.8, 3.5, hz + 6.06], [x + 1.8, 5.2, hz + 6.06], [x, 5.2, hz + 6.06], PAL.lichtWarm);
    if (i % 2 === 0) glow([x + 0.9, 4.3, hz + 6.6], PAL.lichtWarm, 4);
  }
  // chimney (red like the original) with white bands
  const cx = hx + 5, cz = -5;
  b.box([cx - 4, 0, cz - 4], [cx + 4, 3, cz + 4], PAL.deckDunkel);
  b.cylinder([cx, 3, cz], 2.9, 2.5, 30, 8, PAL.rumpfRot, PAL.rumpfRot);
  b.cylinder([cx, 33, cz], 2.5, 2.4, 2.5, 8, PAL.weiss, PAL.weiss);
  b.cylinder([cx, 35.5, cz], 2.4, 2.3, 3.5, 8, PAL.rumpfRot, PAL.anthrazit);
  b.cylinder([cx, 39, cz], 2.3, 2.3, 1.2, 8, PAL.weiss, PAL.anthrazit);
  lights.box([cx - 0.4, 40.2, cz - 0.4], [cx + 0.4, 40.9, cz + 0.4], PAL.lichtRot);
  glow([cx, 40.6, cz], PAL.lichtRot, 6);
}

export function tanklager({ b, lights, glow, accent: A }: BuildCtx) {
  const tanks: [number, number, number, number][] = [[-8, -1, 7.5, 11], [8.5, 2, 6, 9]];
  for (const [x, z, r, h] of tanks) {
    b.cylinder([x, 0, z], r, r, h, 12, PAL.weiss, PAL.stahlHell);
    b.cylinder([x, h * 0.55, z], r + 0.08, r + 0.08, 1.4, 12, PAL.signalRot, PAL.signalRot);
    b.cone([x, h, z], r, 1.8, 12, PAL.stahlHell);
    // ladder
    b.beam([x + r + 0.3, 0, z], [x + r + 0.3, h, z], 0.25, PAL.metall);
  }
  b.beam([-0.5, 2, -1], [2.5, 2, 2], 0.9, PAL.metall);
  b.beam([-8, 1.2, -1 - 7.5], [10, 1.2, -9], 0.7, PAL.metall);
  b.box([-17, 0, 6], [-11, 3.5, 10.5], { side: A.main, top: A.grau });
  lights.box([-14.4, 3.6, 10.5], [-13.6, 4.1, 10.9], PAL.lichtWarm);
  glow([-14, 3.9, 11.2], PAL.lichtWarm, 4);
}

export function lagerhalle({ b, lights, glow }: BuildCtx) {
  const hx = 14, hz = 9, h = 8, ridge = 13;
  b.box([-hx, 0, -hz], [hx, h, hz], PAL.sandHell);
  b.quad([-hx - 0.6, h - 0.3, -hz - 0.6], [-hx - 0.6, ridge, 0], [hx + 0.6, ridge, 0], [hx + 0.6, h - 0.3, -hz - 0.6], PAL.erde);
  b.quad([-hx - 0.6, h - 0.3, hz + 0.6], [hx + 0.6, h - 0.3, hz + 0.6], [hx + 0.6, ridge, 0], [-hx - 0.6, ridge, 0], PAL.erde);
  for (const s of [-1, 1]) b.tri([s * hx, h, -hz], [s * hx, h, hz], [s * hx, ridge - 0.3, 0], PAL.sandHell);
  for (const x of [-7, 7]) {
    b.quad([x - 3.5, 0.1, hz + 0.06], [x + 3.5, 0.1, hz + 0.06], [x + 3.5, 6, hz + 0.06], [x - 3.5, 6, hz + 0.06], PAL.metall);
    lights.box([x - 0.5, 6.5, hz], [x + 0.5, 7, hz + 0.4], PAL.lichtWarm);
    glow([x, 6.8, hz + 0.8], PAL.lichtWarm, 4);
  }
}

/** low hexagonal pillbox with firing slits and an accent band */
export function bunker({ b, lights, glow, accent: A }: BuildCtx) {
  const ph = Math.PI / 6, H = 3.4;
  b.cylinder([0, 0, 0], 7, 5.6, H, 6, PAL.deckDunkel, PAL.metall, null, ph);
  b.cylinder([0, H, 0], 5.6, 4.6, 0.7, 6, A.main, A.grau, null, ph);
  // firing slits on every other face
  for (let i = 0; i < 6; i += 2) {
    const a = ph + (i + 0.5) * (Math.PI / 3);
    b.pushTRS([Math.cos(a) * 5.55, 2.1, Math.sin(a) * 5.55], Math.PI / 2 - a, [1, 1, 1]);
    b.box([-1.7, -0.28, -0.35], [1.7, 0.28, 0.35], PAL.anthrazit);
    b.pop();
  }
  b.cylinder([1.6, H + 0.7, -1], 0.45, 0.45, 1.6, 6, PAL.metall, PAL.anthrazit);
  lights.box([-0.35, H + 0.7, -0.35], [0.35, H + 1.2, 0.35], PAL.lichtRot);
  glow([0, H + 1.1, 0], PAL.lichtRot, 4);
}

/** defence dome: ring wall, faceted dome, launch hatch on top, door to the command centre */
export function kuppel({ b, lights, glow, accent: A }: BuildCtx) {
  const ph = Math.PI / 12, R = 20;
  // darker armoured steel than the white command centre, split launch hatch on top
  b.cylinder([0, 0, 0], R, R, 4.4, 12, PAL.deckDunkel, PAL.metall, null, ph);
  bandedRings(b, [[R + 0.06, 3.0], [R + 0.06, 4.2]], 12, [A.main], ph);
  bandedRings(b, [[R, 4.4], [18.6, 9.2], [14.4, 13.4], [7.8, 16.3], [0, 17.2]], 12, [PAL.stahl, PAL.metallHell], ph);
  b.box([-3.2, 15.4, -6.2], [3.2, 17.3, 6.2], { side: A.dunkel, top: A.main });
  b.box([-0.25, 17.3, -6.2], [0.25, 17.5, 6.2], PAL.anthrazit);
  // door facing +z (a wall face sits exactly there)
  const dz = R * Math.cos(Math.PI / 12) + 0.06;
  b.quad([-2.6, 0.1, dz], [2.6, 0.1, dz], [2.6, 3.4, dz], [-2.6, 3.4, dz], PAL.anthrazit);
  lights.box([-3.4, 3.6, dz - 0.1], [3.4, 3.9, dz + 0.3], PAL.lichtWarm);
  glow([0, 3.8, dz + 0.8], PAL.lichtWarm, 5);
  lights.box([-0.4, 17.6, 5.5], [0.4, 18.3, 6.2], PAL.lichtRot);
  glow([0, 18, 5.9], PAL.lichtRot, 7);
}

export function geschuetzturmBase({ b }: BuildCtx) {
  b.cylinder([0, 0, 0], 6.2, 5.2, 4, 6, PAL.metall, PAL.metallHell, null, Math.PI / 6);
  b.cylinder([0, 4, 0], 2.4, 2.4, 0.8, 6, PAL.anthrazit, PAL.anthrazit);
}

/** rotating head of the gun turret, origin on the turret ring */
export function geschuetzturmHead(): THREE.BufferGeometry {
  const b = new LowPolyBuilder();
  b.prismZ([[-3, 0], [3, 0], [3.4, 1.8], [2, 3.4], [-2, 3.4], [-3.4, 1.8]], -3.2, 2.6, PAL.stahl, PAL.stahlHell);
  b.box([-1.2, 2.2, 2.6], [1.2, 3.2, 3.0], PAL.glasBlau);
  for (const x of [-1.2, 1.2]) {
    b.pushTRS([x, 1.6, 2.4], 0, [1, 1, 1], Math.PI / 2);
    b.cylinder([0, 0, 0], 0.35, 0.28, 6.5, 6, PAL.anthrazit, PAL.anthrazit);
    b.pop();
  }
  return b.build();
}

/** where a Skua sets down on a landing pad, above the building's base */
export const PAD_TOP = 1.3;

/**
 * Landing pad for the Skua (the original's runway: the remake's Skua is a VTOL
 * and lands vertically, as on the lift): an octagonal deck with the touch-down
 * ring and an H, blue edge lights, and a fuel tank with its pump beside it.
 */
export function landeplatz({ b, lights, glow, accent: A }: BuildCtx) {
  const ph = Math.PI / 8, R = 16, H = 1.2;
  b.cylinder([0, 0, 0], R, R, H, 8, PAL.deckDunkel, PAL.deck, null, ph);
  b.cylinder([0, H, 0], 11.4, 11.4, 0.05, 16, PAL.signalGelb, PAL.signalGelb);
  b.cylinder([0, H + 0.05, 0], 10.2, 10.2, 0.05, 16, PAL.deck, PAL.deck);
  for (const x of [-3.4, 3.4]) b.box([x - 0.8, H + 0.1, -4.4], [x + 0.8, H + 0.16, 4.4], PAL.weiss);
  b.box([-2.6, H + 0.1, -0.75], [2.6, H + 0.16, 0.75], PAL.weiss);
  for (const [x, , z] of ring(R - 0.9, 0, 8, ph)) {
    lights.box([x - 0.35, H, z - 0.35], [x + 0.35, H + 0.45, z + 0.35], PAL.lichtBlau);
    glow([x, H + 0.4, z], PAL.lichtBlau, 3);
  }
  // fuel for the Skua: tank, pump house, hose to the pad
  b.cylinder([R + 4, 0, 4], 2.6, 2.6, 4.2, 10, PAL.weiss, PAL.stahlHell);
  b.cylinder([R + 4, 2.3, 4], 2.68, 2.68, 0.7, 10, A.main, A.main);
  b.box([R + 1, 0, -3], [R + 3.4, 2.4, -0.6], { side: A.main, top: A.grau });
  b.beam([R + 1.2, 1.1, 4], [R - 1, 1.1, 4], 0.3, PAL.metall);
}

export const BUILDERS: Record<Exclude<BuildingType, 'geschuetzturm'>, (ctx: BuildCtx) => void> = {
  kommandozentrale, funkmast, hangar, fabrik, tanklager, lagerhalle, bunker, kuppel, landeplatz,
};
