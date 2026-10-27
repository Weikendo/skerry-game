import * as THREE from 'three';
import { LowPolyBuilder, lowPolyMaterial, type V3 } from '../engine/lowpoly';
import { PAL } from '../engine/palette';
import { GlowSet, type GlowPoints } from '../engine/glow';
import { glbModel } from './glb';

// Manta multi-role fighter after the original (model 5): a cranked delta with a
// single fin, grey back, orange-red flanks and light blue-grey wings. Detailed
// for the remake: canopy frame, intakes, twin nozzles, moving elevons and
// rudder, retracting gear and the Assassin missiles on their pylons.
// Model units are scaled by 0.75 (span about 18 m, length 16 m).
const COL = {
  top: PAL.metallHell, topLight: PAL.stahlHell, flank: PAL.signalOrange, flankDark: PAL.signalOrangeDunkel,
  belly: PAL.stahl, wing: PAL.stahlHell, wingDark: PAL.stahl, wingUnder: PAL.metallHell,
  red: PAL.signalRot, glass: PAL.glasBlau, frame: PAL.anthrazit, engine: PAL.anthrazit, metal: PAL.metall,
  missile: PAL.weiss,
};

export interface MantaParts {
  /** port (+x) and starboard elevon: rotation.x > 0 lifts the trailing edge */
  elevons: [THREE.Object3D, THREE.Object3D];
  /** rotation.y > 0 swings the trailing edge to starboard */
  rudder: THREE.Object3D;
  /** gear legs: rotation.x folds them back into the belly */
  gear: THREE.Object3D[];
  /** the six Assassins on the wing pylons, in firing order */
  missiles: THREE.Object3D[];
}

export interface MantaModel {
  group: THREE.Group;
  lights: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  glow: GlowPoints;
  /** engine flame, intensity follows the throttle */
  exhaust: GlowPoints;
  parts: MantaParts;
}

/** height of the model origin above the wheels' contact patch */
export const MANTA_GEAR = 2.4 * 0.75;

// wing outline (port side, x > 0): root leading edge, crank, tip, hinge line of the elevon
const ROOT_LE: [number, number] = [1.7, 5.4], CRANK: [number, number] = [4.6, -1.0], TIP_LE: [number, number] = [12, -6.0];
const TIP_TE: [number, number] = [12, -7.3], ROOT_TE: [number, number] = [1.8, -7.8];
const HINGE0 = 3.5, HINGE1 = 10.3, HINGE_Z = -6.6;
const wingTop = (x: number) => 0.18 - 0.16 * (x - 1.7) / 10.3;
const wingBot = (x: number) => -0.32 + 0.16 * (x - 1.7) / 10.3;

function fuselage(b: LowPolyBuilder) {
  // z, half width, top, bottom
  const S: [number, number, number, number][] = [
    [11.6, 0, 0.2, -0.1], [9.6, 0.5, 0.5, -0.4], [7.2, 0.95, 0.95, -0.72], [4.6, 1.35, 1.3, -0.95], [2.0, 1.6, 1.25, -1.05],
    [-1.0, 1.75, 1.12, -1.1], [-4.0, 1.8, 1.02, -1.05], [-6.6, 1.72, 0.95, -0.95], [-8.6, 1.55, 0.85, -0.85],
  ];
  const ring = (w: number, t: number, bo: number, z: number): V3[] => [
    [0, t, z], [w * 0.6, t * 0.86, z], [w, t * 0.22, z], [w * 0.86, bo * 0.55, z], [w * 0.42, bo, z],
    [-w * 0.42, bo, z], [-w * 0.86, bo * 0.55, z], [-w, t * 0.22, z], [-w * 0.6, t * 0.86, z],
  ];
  // facet colours around the ring: back, upper side, flank, lower flank, belly
  const facet = [COL.top, COL.topLight, COL.flank, COL.flankDark, COL.belly, COL.flankDark, COL.flank, COL.topLight, COL.top];
  for (let i = 0; i + 1 < S.length; i++) {
    const [za, wa, ta, ba] = S[i], [zb, wb, tb, bb] = S[i + 1];
    const A = ring(wa, ta, ba, za), B = ring(wb, tb, bb, zb), n = A.length;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      // red nose cone, as on the original
      const col = i === 0 ? COL.red : facet[k];
      if (wa === 0) b.tri([0, (ta + ba) / 2, za], B[j], B[k], col);
      else b.quad(A[k], A[j], B[j], B[k], col);
    }
  }
  const [zt, wt, tt, bt] = S[S.length - 1];
  b.poly(ring(wt, tt, bt, zt), COL.engine);
  // spine stripe and a small dorsal intake behind the canopy
  b.quad([-0.18, 1.29, 1.6], [0.18, 1.29, 1.6], [0.18, 1.05, -6.2], [-0.18, 1.05, -6.2], COL.red);
  b.box([-0.45, 1.1, -1.6], [0.45, 1.45, 0.4], { side: COL.topLight, top: COL.top, front: COL.engine });
  // pitot tube
  b.beam([0, 0.05, 11.5], [0, 0.05, 13.0], 0.06, COL.metal);
}

function canopy(b: LowPolyBuilder) {
  const F: V3 = [0, 1.05, 6.8], T: V3 = [0, 2.05, 4.1], B: V3 = [0, 1.7, 1.5];
  const L1: V3 = [0.82, 1.32, 4.6], L2: V3 = [0.9, 1.28, 2.1], R1: V3 = [-0.82, 1.32, 4.6], R2: V3 = [-0.9, 1.28, 2.1];
  b.tri(F, L1, T, COL.glass); b.tri(F, T, R1, COL.glass);
  b.quad(T, L1, L2, B, COL.glass); b.quad(T, B, R2, R1, COL.glass);
  b.tri(F, R1, L1, COL.glass);
  // frame bars
  for (const [p, q] of [[F, T], [T, B], [L1, T], [R1, T], [F, L1], [F, R1], [L1, L2], [R1, R2]] as [V3, V3][]) b.beam(p, q, 0.07, COL.frame);
}

function wing(b: LowPolyBuilder, s: 1 | -1) {
  const P = (p: [number, number], top: boolean): V3 => [s * p[0], top ? wingTop(p[0]) : wingBot(p[0]), p[1]];
  const h0: [number, number] = [HINGE0, HINGE_Z], h1: [number, number] = [HINGE1, HINGE_Z];
  const te0: [number, number] = [HINGE0, -7.7], te1: [number, number] = [HINGE1, -7.35];
  // three convex panels per side: inner (with the root), outer, tip; the elevon fills the notch
  const panels: { pts: [number, number][]; top: string; under: string }[] = [
    { pts: [ROOT_LE, CRANK, h0, te0, ROOT_TE], top: COL.wing, under: COL.wingUnder },
    { pts: [CRANK, TIP_LE, h1, h0], top: COL.wing, under: COL.wingUnder },
    { pts: [TIP_LE, TIP_TE, te1, h1], top: COL.red, under: COL.red },
  ];
  for (const p of panels) {
    const top = p.pts.map(q => P(q, true)), bot = p.pts.map(q => P(q, false)).reverse();
    b.poly(s > 0 ? top : top.slice().reverse(), p.top);
    b.poly(s > 0 ? bot : bot.slice().reverse(), p.under);
  }
  // a darker band along the inner panel (panel line look)
  b.poly([P([2.4, 2.5], true), P([3.4, 0.4], true), P([3.4, -5.6], true), P([2.4, -5.6], true)].map(v => [v[0], v[1] + 0.01, v[2]] as V3), COL.wingDark);
  // closing edges: leading edge, tip, trailing edges
  const edge = (a: [number, number], c: [number, number], col: string) => b.quad(P(a, true), P(c, true), P(c, false), P(a, false), col);
  edge(ROOT_LE, CRANK, COL.wingDark); edge(CRANK, TIP_LE, COL.wingDark);
  edge(TIP_LE, TIP_TE, COL.red); edge(TIP_TE, te1, COL.red);
  edge(te0, ROOT_TE, COL.wingDark); edge(h0, h1, COL.wingDark);
  edge(te0, h0, COL.wingDark); edge(h1, te1, COL.wingDark);
  // intake under the wing root
  b.box([s > 0 ? 1.45 : -2.35, -0.95, 0.6], [s > 0 ? 2.35 : -1.45, 0.1, 3.8], { side: COL.flankDark, top: COL.belly, front: COL.engine });
  b.quad([s * 1.5, -0.9, 3.81], [s * 2.3, -0.9, 3.81], [s * 2.3, 0.05, 3.81], [s * 1.5, 0.05, 3.81], COL.frame);
}

/** elevon as its own part: origin on the hinge line, trailing edge at -z */
function elevon(s: 1 | -1, mat: THREE.Material): THREE.Object3D {
  const b = new LowPolyBuilder();
  const xs = [HINGE0, HINGE1], len = [7.7 + HINGE_Z, 7.35 + HINGE_Z];
  const p = (i: number, top: boolean, aft: boolean): V3 => [s * xs[i], (top ? wingTop(xs[i]) : wingBot(xs[i])) * (aft ? 0.3 : 1), aft ? -len[i] : 0];
  b.quad(p(0, true, false), p(1, true, false), p(1, true, true), p(0, true, true), COL.wingDark);
  b.quad(p(0, false, false), p(0, false, true), p(1, false, true), p(1, false, false), COL.wingUnder);
  b.quad(p(0, true, true), p(1, true, true), p(1, false, true), p(0, false, true), COL.wingDark);
  b.quad(p(0, true, false), p(0, true, true), p(0, false, true), p(0, false, false), COL.wingDark);
  b.quad(p(1, true, false), p(1, false, false), p(1, false, true), p(1, true, true), COL.wingDark);
  const m = new THREE.Mesh(b.build(), mat);
  m.castShadow = true;
  const g = new THREE.Group();
  g.position.set(0, 0, HINGE_Z);
  g.add(m);
  return g;
}

function fin(b: LowPolyBuilder) {
  // single fin like the original; the rudder is its own part
  const t = 0.14;
  const prof: V3[] = [[0, 1.0, -1.8], [0, 4.7, -6.3], [0, 4.7, -7.25], [0, 1.0, -7.25]];
  for (const s of [-1, 1]) b.poly(prof.map(([, y, z]) => [s * t, y, z] as V3), s > 0 ? COL.top : COL.topLight);
  b.quad([-t, 1.0, -1.8], [t, 1.0, -1.8], [t, 4.7, -6.3], [-t, 4.7, -6.3], COL.topLight);
  b.box([-t - 0.02, 4.4, -7.3], [t + 0.02, 4.75, -6.2], COL.red);
}

function rudder(mat: THREE.Material): THREE.Object3D {
  const b = new LowPolyBuilder();
  const t = 0.12;
  const prof: V3[] = [[0, 1.05, 0], [0, 4.4, 0], [0, 4.4, -1.15], [0, 1.0, -1.55]];
  for (const s of [-1, 1]) b.poly(prof.map(([, y, z]) => [s * t, y, z] as V3), COL.top);
  b.quad([-t, 4.4, 0], [t, 4.4, 0], [t, 4.4, -1.15], [-t, 4.4, -1.15], COL.topLight);
  b.quad([-t, 4.4, -1.15], [t, 4.4, -1.15], [t, 1.0, -1.55], [-t, 1.0, -1.55], COL.topLight);
  const m = new THREE.Mesh(b.build(), mat);
  m.castShadow = true;
  const g = new THREE.Group();
  g.position.set(0, 0, -7.25);
  g.add(m);
  return g;
}

function nozzles(b: LowPolyBuilder) {
  for (const x of [-0.75, 0.75]) {
    b.pushTRS([x, -0.05, -8.5], 0, [1, 1, 1], -Math.PI / 2);   // cylinder axis along -z
    b.cylinder([0, 0, 0], 0.62, 0.55, 1.1, 8, COL.metal, COL.engine);
    b.cylinder([0, 1.1, 0], 0.5, 0.42, 0.06, 8, PAL.schwarz, PAL.schwarz);
    b.pop();
  }
}

/** a gear leg pivoting at its top (folds back into the belly) */
function gearLeg(x: number, z: number, top: number, wheels: number, mat: THREE.Material): THREE.Object3D {
  const b = new LowPolyBuilder();
  const len = top - -2.4;
  b.beam([0, 0, 0], [0, -len + 0.45, 0], 0.16, COL.metal);
  b.box([-0.22, -0.5, -0.12], [0.22, 0, 0.12], COL.metal);
  for (let i = 0; i < wheels; i++) {
    const wx = wheels > 1 ? (i ? 0.28 : -0.28) : 0;
    b.pushTRS([wx, -len + 0.45, 0], 0, [1, 1, 1], 0, Math.PI / 2);   // wheel axis along x
    b.cylinder([0, -0.12, 0], 0.45, 0.45, 0.24, 8, PAL.schwarz, PAL.anthrazit);
    b.pop();
  }
  // gear door
  b.quad([0.35, -0.2, 0.6], [0.35, -0.2, -0.6], [0.35, -len * 0.6, -0.6], [0.35, -len * 0.6, 0.6], COL.belly);
  const m = new THREE.Mesh(b.build(), mat);
  m.castShadow = true;
  const g = new THREE.Group();
  g.position.set(x, top, z);
  g.add(m);
  return g;
}

/** Assassin: white body, red nose, four small fins; origin on the pylon */
function missileGeometry(): THREE.BufferGeometry {
  const b = new LowPolyBuilder();
  b.pushTRS([0, -0.28, 0], 0, [1, 1, 1], Math.PI / 2);
  b.cylinder([0, -1.2, 0], 0.17, 0.17, 2.1, 6, COL.missile, COL.missile);
  b.cone([0, 0.9, 0], 0.17, 0.5, 6, COL.red);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    b.tri([Math.cos(a) * 0.16, -1.2, Math.sin(a) * 0.16], [Math.cos(a) * 0.48, -1.2, Math.sin(a) * 0.48], [Math.cos(a) * 0.16, -0.7, Math.sin(a) * 0.16], COL.red);
  }
  b.pop();
  // pylon
  b.box([-0.06, -0.12, -0.6], [0.06, 0, 0.6], COL.metal);
  return b.build();
}

/** the Manta as built in Blender (art/skua), wrapped like the code-built one; null when that file is missing */
function mantaFromBlender(): MantaModel | null {
  const m = glbModel('skua');
  if (!m) return null;
  const part = (name: string) => m.root.getObjectByName(name)!;
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.y = 2.4;
  inner.add(m.root);
  g.add(inner);
  g.scale.setScalar(0.75);
  g.name = 'manta';
  return {
    group: g, lights: m.lights, glow: m.glow, exhaust: m.exhaust ?? new GlowSet().build(),
    parts: {
      elevons: [part('elevon_L'), part('elevon_R')], rudder: part('rudder'),
      gear: [0, 1, 2].map(i => part(`gear_${i}`)), missiles: [0, 1, 2, 3, 4, 5].map(i => part(`missile_${i}`)),
    },
  };
}

/** the Manta from Blender, or the one built here (`code`, and whenever the Blender file is missing) */
export function buildManta(from: 'blender' | 'code' = 'blender'): MantaModel {
  return (from === 'blender' && mantaFromBlender()) || buildMantaInCode();
}

function buildMantaInCode(): MantaModel {
  const b = new LowPolyBuilder();
  const lightsB = new LowPolyBuilder();
  const glows = new GlowSet();
  const mat = lowPolyMaterial();
  fuselage(b);
  canopy(b);
  wing(b, 1); wing(b, -1);
  fin(b);
  nozzles(b);
  // fixed pylons (the missiles hang on them)
  for (const s of [-1, 1]) for (const x of [4.2, 6.2, 8.2]) b.box([s * x - 0.07, wingBot(x) - 0.14, -2.6], [s * x + 0.07, wingBot(x), -0.8], COL.metal);

  // navigation lights: red port (+x), green starboard, white tail, red beacon on the spine
  lightsB.box([11.95, -0.15, -6.9], [12.15, 0.1, -6.4], PAL.lichtRot);
  lightsB.box([-12.15, -0.15, -6.9], [-11.95, 0.1, -6.4], PAL.lichtGruen);
  lightsB.box([-0.12, 4.75, -7.1], [0.12, 4.95, -6.8], PAL.lichtWeiss);
  lightsB.box([-0.12, 1.3, 0.8], [0.12, 1.5, 1.1], PAL.lichtRot);
  glows.add([12.2, 0, -6.6], PAL.lichtRot, 3).add([-12.2, 0, -6.6], PAL.lichtGruen, 3).add([0, 5.0, -6.95], PAL.lichtWeiss, 2.5).add([0, 1.6, 0.95], PAL.lichtRot, 2);

  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.y = 2.4;
  const mesh = new THREE.Mesh(b.build(), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  inner.add(mesh);
  const lights = new THREE.Mesh(lightsB.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
  inner.add(lights);
  const glow = glows.build();
  inner.add(glow);
  const exhaust = new GlowSet()
    .add([0.75, -0.05, -9.8], PAL.lichtBlau, 5.5).add([-0.75, -0.05, -9.8], PAL.lichtBlau, 5.5)
    .add([0, -0.05, -11.2], PAL.lavaHell, 4).build();
  inner.add(exhaust);

  // moving parts
  const elevons: [THREE.Object3D, THREE.Object3D] = [elevon(1, mat), elevon(-1, mat)];
  const rud = rudder(mat);
  const gear = [gearLeg(0, 6.6, -0.6, 1, mat), gearLeg(2.5, -3.2, -0.75, 2, mat), gearLeg(-2.5, -3.2, -0.75, 2, mat)];
  const mGeo = missileGeometry();
  const missiles: THREE.Object3D[] = [];
  // firing order alternates the wings, outer pairs first
  for (const x of [8.2, 6.2, 4.2]) for (const s of [1, -1]) {
    const m = new THREE.Mesh(mGeo, mat);
    m.castShadow = true;
    m.position.set(s * x, wingBot(x) - 0.14, -1.7);
    missiles.push(m);
  }
  inner.add(...elevons, rud, ...gear, ...missiles);
  g.add(inner);
  g.scale.setScalar(0.75);
  g.name = 'manta';
  return { group: g, lights, glow, exhaust, parts: { elevons, rudder: rud, gear, missiles } };
}
