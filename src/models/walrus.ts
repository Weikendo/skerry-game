import * as THREE from 'three';
import { LowPolyBuilder, lowPolyMaterial, type V3 } from '../engine/lowpoly';
import { GlowSet, type GlowPoints } from '../engine/glow';
import { PAL } from '../engine/palette';
import { glbModel } from './glb';

// Walrus amphibious assault vehicle after the original (model 6): a wedge-shaped
// hull with an ochre top and grey sloped sides over two track units (the tracks
// double as the hull in the water). Detailed for the remake: moving tracks with
// road wheels, sprocket and idler, a faceted turret with the twin Avatar laser
// (cooling fins, elevation), driver cab, cargo cradle for the pod, water jets.
// Origin: centre of the track bottoms; +z forward. Length ~18.5 m, width 9 m.
export const WALRUS_DRAFT = 1.8; // how deep the tracks sit below the surface when floating

export interface WalrusParts {
  /** gun elevation: rotation.x < 0 lifts the barrels; muzzle at local (0, 0, 5) */
  barrel: THREE.Object3D;
  /** the barrels themselves: position.z < 0 = recoil after a shot */
  recoil: THREE.Object3D;
  /** road wheels, sprocket and idler per side (port +x first), with their radius */
  wheels: { mesh: THREE.Object3D; r: number; side: 1 | -1 }[];
  /** track cleats: top and bottom run per side, shifted along z to look like moving links */
  cleats: { top: THREE.Object3D; bottom: THREE.Object3D; side: 1 | -1 }[];
}

export interface WalrusModel {
  group: THREE.Group;
  turret: THREE.Object3D;
  lights: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  glow: GlowPoints;
  parts: WalrusParts;
}

/** link spacing of the track cleats */
export const CLEAT_PITCH = 1.0;
const TRACK_X0 = 3.0, TRACK_X1 = 4.5;
const DECK = 4.3;
/** the turret stands on a raised ring so the barrels clear the cab roof */
const RISER = 1.25;
export const TURRET_Z = -2.6;

function hull(b: LowPolyBuilder) {
  // sections: z, half width, bottom, deck; 8-point ring with chamfered deck edges
  const S: [number, number, number, number][] = [
    [-8.3, 3.8, 1.5, 3.6], [-7.2, 4.15, 0.95, 4.15], [-2.5, 4.3, 0.85, DECK], [3.0, 4.3, 0.85, DECK],
    [6.0, 3.9, 1.05, 3.95], [8.2, 2.6, 1.6, 3.05], [9.5, 1.0, 2.0, 2.45],
  ];
  // the edges sit relative to the section's height, so the narrow bow keeps a clean (non-crossing) outline
  const ring = (hw: number, yb: number, yt: number): [number, number][] => {
    const h = yt - yb;
    const chamfer = yt - Math.min(0.5, h * 0.22), side = Math.max(yb + Math.min(0.35, h * 0.3), yt - 1.4);
    const inset = Math.min(0.65, hw * 0.3);
    return [[-(hw - inset), yt], [hw - inset, yt], [hw, chamfer], [hw, side], [hw * 0.8, yb], [-hw * 0.8, yb], [-hw, side], [-hw, chamfer]];
  };
  const bands = [PAL.ocker, PAL.ockerDunkel, PAL.stahl, PAL.metall, PAL.anthrazit, PAL.metall, PAL.stahl, PAL.ockerDunkel];
  for (let i = 0; i + 1 < S.length; i++) {
    const [za, wa, ba, ta] = S[i], [zb, wb, bb, tb] = S[i + 1];
    const A = ring(wa, ba, ta), B = ring(wb, bb, tb);
    const glacis = i >= S.length - 3;
    for (let k = 0; k < 8; k++) {
      const j = (k + 1) % 8;
      // the sloped front is ochre over its whole width, as the original's wedge
      const col = glacis && k === 0 ? PAL.ockerHell : bands[k];
      b.quad([A[k][0], A[k][1], za], [A[j][0], A[j][1], za], [B[j][0], B[j][1], zb], [B[k][0], B[k][1], zb], col);
    }
  }
  b.poly(ring(S[0][1], S[0][2], S[0][3]).map(([x, y]) => [x, y, S[0][0]] as V3), PAL.stahl);
  b.poly(ring(S[6][1], S[6][2], S[6][3]).map(([x, y]) => [x, y, S[6][0]] as V3).reverse(), PAL.ockerHell);
  // deck plates, grab rails along the edges, tow hooks
  for (const [z0, z1] of [[-6.6, -3.2], [-2.6, 0.6]]) b.quad([-2.9, DECK + 0.02, z0], [2.9, DECK + 0.02, z0], [2.9, DECK + 0.02, z1], [-2.9, DECK + 0.02, z1], PAL.ockerGrau);
  for (const s of [-1, 1]) {
    b.beam([s * 3.5, DECK + 0.35, -6.8], [s * 3.5, DECK + 0.35, 0.6], 0.08, PAL.metall);
    for (const z of [-6.8, -2.8, 0.6]) b.beam([s * 3.5, DECK, z], [s * 3.5, DECK + 0.35, z], 0.08, PAL.metall);
    b.box([s * 1.6 - 0.25, 2.2, 9.0], [s * 1.6 + 0.25, 2.6, 9.4], PAL.anthrazit);
  }
  // water jets at the stern, exhaust stacks, cargo cradle for the pod (starboard rear)
  for (const x of [-1.6, 1.6]) {
    b.pushTRS([x, 1.6, -8.25], 0, [1, 1, 1], -Math.PI / 2);
    b.cylinder([0, 0, 0], 0.55, 0.48, 0.5, 8, PAL.metall, PAL.schwarz);
    b.pop();
  }
  b.box([-3.5, DECK, -7.0], [-2.7, DECK + 1.1, -6.2], { side: PAL.metall, top: PAL.schwarz });
  b.box([-2.5, DECK, -7.0], [-1.9, DECK + 0.9, -6.4], { side: PAL.metall, top: PAL.schwarz });
  for (const x of [1.2, 2.6]) b.beam([x, DECK + 0.15, -7.6], [x, DECK + 0.15, -5.6], 0.18, PAL.anthrazit);
  // turret ring on its riser
  b.cylinder([0, DECK, TURRET_Z], 1.9, 1.7, RISER, 8, PAL.stahl, PAL.metall, null, Math.PI / 8);
  b.cylinder([0, DECK + RISER - 0.25, TURRET_Z], 1.78, 1.78, 0.12, 8, PAL.ocker, PAL.ocker, null, Math.PI / 8);
  b.box([0.9, DECK, -7.7], [2.9, DECK + 0.12, -7.4], PAL.metall);
  b.box([0.9, DECK, -5.8], [2.9, DECK + 0.12, -5.5], PAL.metall);
}

function tracks(b: LowPolyBuilder) {
  // side profile (z, y) of a track unit, rounded at both ends
  const prof: [number, number][] = [
    [-8.0, 1.25], [-7.6, 0.45], [-6.8, 0.05], [6.8, 0.05], [7.6, 0.45], [8.0, 1.25], [7.6, 2.05], [6.8, 2.45], [-6.8, 2.45], [-7.6, 2.05],
  ];
  for (const s of [-1, 1]) {
    const x0 = s * TRACK_X0, x1 = s * TRACK_X1;
    for (let i = 0; i < prof.length; i++) {
      const [za, ya] = prof[i], [zb, yb] = prof[(i + 1) % prof.length];
      b.quad([x0, ya, za], [x1, ya, za], [x1, yb, zb], [x0, yb, zb], PAL.anthrazit);
    }
    b.poly(prof.map(([z, y]) => [x0, y, z] as V3), PAL.schwarz);
    b.poly(prof.map(([z, y]) => [x1, y, z] as V3).reverse(), PAL.schwarz);
    // side skirt over the upper run, chamfered at the ends
    const sx = s * (TRACK_X1 + 0.08);
    b.poly([[sx, 1.45, -7.2], [sx, 1.45, 7.2], [sx, 2.25, 7.9], [sx, 2.7, 7.4], [sx, 2.7, -7.4], [sx, 2.25, -7.9]], PAL.metall);
    b.quad([sx, 2.7, -7.4], [sx, 2.7, 7.4], [s * TRACK_X0, 2.75, 7.4], [s * TRACK_X0, 2.75, -7.4], PAL.metallHell);
    for (const z of [-4.4, 0, 4.4]) b.box([sx - 0.04, 1.6, z - 0.9], [sx + s * 0.06, 2.55, z + 0.9], PAL.stahl);
  }
}

function cab(b: LowPolyBuilder, lights: LowPolyBuilder, glows: GlowSet) {
  // faceted driver cab at the front: footprint, roof, sloped front with windows
  const y0 = DECK, y1 = 6.1;
  const bl: V3[] = [[-2.6, y0, 1.0], [2.6, y0, 1.0], [2.6, y0, 5.0], [-2.6, y0, 5.0]];
  const tl: V3[] = [[-2.15, y1, 1.35], [2.15, y1, 1.35], [2.15, y1, 3.7], [-2.15, y1, 3.7]];
  b.quad(tl[0], tl[3], tl[2], tl[1], PAL.ockerGrau);
  b.quad(bl[3], bl[2], tl[2], tl[3], PAL.ockerHell);     // front slope
  b.quad(bl[1], bl[0], tl[0], tl[1], PAL.ockerDunkel);   // back
  b.quad(bl[0], bl[3], tl[3], tl[0], PAL.ocker);         // port side
  b.quad(bl[2], bl[1], tl[1], tl[2], PAL.ocker);         // starboard side
  // window panes on the front slope, framed
  const along = (u: number, x: number): V3 => {
    const z = 5.0 + (3.7 - 5.0) * u, y = y0 + (y1 - y0) * u, hw = 2.6 + (2.15 - 2.6) * u;
    return [x * hw, y, z + 0.04];
  };
  for (const [x0, x1] of [[-0.9, -0.35], [-0.3, 0.3], [0.35, 0.9]]) {
    b.quad(along(0.45, x0), along(0.45, x1), along(0.88, x1), along(0.88, x0), PAL.fensterBlau);
  }
  b.beam(along(0.42, -0.92), along(0.42, 0.92), 0.08, PAL.anthrazit);
  // side vision slits, roof hatch and sensor mast
  for (const s of [-1, 1]) b.quad([s * 2.42, 5.35, 1.6], [s * 2.42, 5.35, 3.8], [s * 2.42, 5.65, 3.6], [s * 2.42, 5.65, 1.7], PAL.fensterBlau);
  b.cylinder([-0.9, y1, 2.3], 0.5, 0.5, 0.18, 8, PAL.metall, PAL.stahl);
  b.beam([1.3, y1, 2.0], [1.3, y1 + 1.0, 2.0], 0.12, PAL.anthrazit);
  b.box([1.05, y1 + 1.0, 1.75], [1.55, y1 + 1.35, 2.25], { side: PAL.anthrazit, front: PAL.glasBlau });
  // head lights in the glacis, rear light, antenna with a red tip
  for (const s of [-1, 1]) {
    b.box([s * 2.2 - 0.5, 2.9, 7.8], [s * 2.2 + 0.5, 3.5, 8.25], PAL.anthrazit);
    lights.box([s * 2.2 - 0.35, 3.0, 8.25], [s * 2.2 + 0.35, 3.4, 8.32], PAL.lichtWeiss);
    glows.add([s * 2.2, 3.2, 8.6], PAL.lichtWeiss, 5);
  }
  lights.box([-0.5, 3.4, -8.32], [0.5, 3.7, -8.28], PAL.lichtRot);
  glows.add([0, 3.55, -8.5], PAL.lichtRot, 3);
  b.cylinder([-3.3, DECK, -5.3], 0.12, 0.06, 4.5, 4, PAL.anthrazit);
  lights.box([-3.45, DECK + 4.4, -5.45], [-3.15, DECK + 4.7, -5.15], PAL.lichtRot);
  glows.add([-3.3, DECK + 4.55, -5.3], PAL.lichtRot, 2.5);
}

/** turret body (yaw); the barrels are a child group for the elevation */
function turret(mat: THREE.Material): { turret: THREE.Group; barrel: THREE.Group; recoil: THREE.Object3D } {
  const b = new LowPolyBuilder();
  b.cylinder([0, 0, 0], 2.1, 2.0, 0.45, 8, PAL.metall, PAL.metallHell, null, Math.PI / 8);
  // faceted, sloped armour
  const lo = 0.45, hi = 1.75;
  const B: V3[] = [[-1.75, lo, -1.9], [1.75, lo, -1.9], [1.75, lo, 1.4], [0.9, lo, 2.2], [-0.9, lo, 2.2], [-1.75, lo, 1.4]];
  const T: V3[] = [[-1.2, hi, -1.5], [1.2, hi, -1.5], [1.2, hi, 0.9], [0.6, hi, 1.4], [-0.6, hi, 1.4], [-1.2, hi, 0.9]];
  b.poly([...T].reverse(), PAL.stahlHell);
  const cols = [PAL.stahl, PAL.stahl, PAL.stahlHell, PAL.stahlHell, PAL.stahlHell, PAL.stahl];
  for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; b.quad(B[i], B[j], T[j], T[i], cols[i]); }
  // ochre stripe, sensor block with glass, small antenna
  b.quad([-1.22, hi - 0.35, -1.52], [1.22, hi - 0.35, -1.52], [1.22, hi - 0.1, -1.5], [-1.22, hi - 0.1, -1.5], PAL.ocker);
  b.box([0.35, hi, -0.9], [1.05, hi + 0.5, -0.1], { side: PAL.anthrazit, front: PAL.glasBlau });
  b.beam([-0.8, hi, -1.1], [-0.8, hi + 1.6, -1.1], 0.07, PAL.anthrazit);
  const tMesh = new THREE.Mesh(b.build(), mat);
  tMesh.castShadow = true;

  // twin Avatar laser: housing, cooling fins, emitter tubes, lenses
  const g = new LowPolyBuilder();
  g.box([-0.75, -0.42, -0.6], [0.75, 0.42, 0.9], { side: PAL.anthrazit, top: PAL.metall });
  for (const x of [-0.36, 0.36]) {
    g.pushTRS([x, 0, 0.9], 0, [1, 1, 1], Math.PI / 2);   // +y of the cylinder becomes +z
    g.cylinder([0, 0, 0], 0.24, 0.2, 3.6, 6, PAL.weiss, PAL.weiss);
    for (let k = 0; k < 5; k++) g.cylinder([0, 0.25 + k * 0.32, 0], 0.36, 0.36, 0.1, 6, PAL.metall, PAL.metall);
    g.cylinder([0, 3.6, 0], 0.27, 0.27, 0.35, 6, PAL.metall, PAL.metall);
    g.cone([0, 3.95, 0], 0.22, 0.32, 6, PAL.glasBlau);
    g.pop();
  }
  const bMesh = new THREE.Mesh(g.build(), mat);
  bMesh.castShadow = true;
  const barrel = new THREE.Group();
  barrel.position.set(0, 1.1, 1.5);
  barrel.add(bMesh);

  const t = new THREE.Group();
  t.position.set(0, DECK + RISER, TURRET_Z);
  t.add(tMesh, barrel);
  return { turret: t, barrel, recoil: bMesh };
}

function wheelGeometry(r: number, w: number): THREE.BufferGeometry {
  const b = new LowPolyBuilder();
  b.pushTRS([0, 0, 0], 0, [1, 1, 1], 0, Math.PI / 2);   // axis along x
  b.cylinder([0, -w / 2, 0], r, r, w, 8, PAL.metallHell, PAL.metall, PAL.metall);
  b.cylinder([0, w / 2, 0], r * 0.45, r * 0.4, 0.06, 6, PAL.anthrazit, PAL.anthrazit);
  b.pop();
  return b.build();
}

function cleatGeometry(y0: number, y1: number): THREE.BufferGeometry {
  const b = new LowPolyBuilder();
  for (let z = -6.5; z <= 6.5; z += CLEAT_PITCH) b.box([TRACK_X0, y0, z - 0.17], [TRACK_X1, y1, z + 0.17], PAL.schwarz);
  return b.build();
}

/** the Walrus as built in Blender (art/otter), or null when that file is missing */
function walrusFromBlender(): WalrusModel | null {
  const m = glbModel('otter');
  if (!m) return null;
  const part = (name: string) => m.root.getObjectByName(name)!;
  const wheels: WalrusParts['wheels'] = [];
  m.root.traverse(o => { if (o.name.startsWith('wheel_')) wheels.push({ mesh: o, r: o.userData.r, side: o.userData.side }); });
  const cleats: WalrusParts['cleats'] = ([[1, 'L'], [-1, 'R']] as const).map(([side, k]) => ({ top: part(`cleats_top_${k}`), bottom: part(`cleats_bottom_${k}`), side }));
  m.root.name = 'walrus';
  return { group: m.root, turret: part('turret'), lights: m.lights, glow: m.glow, parts: { barrel: part('barrel'), recoil: part('recoil'), wheels, cleats } };
}

/** the Walrus from Blender, or the one built here (`code`, and whenever the Blender file is missing) */
export function buildWalrus(from: 'blender' | 'code' = 'blender'): WalrusModel {
  return (from === 'blender' && walrusFromBlender()) || buildWalrusInCode();
}

function buildWalrusInCode(): WalrusModel {
  const body = new LowPolyBuilder();
  const lightsB = new LowPolyBuilder();
  const glows = new GlowSet();
  hull(body);
  tracks(body);
  cab(body, lightsB, glows);

  const mat = lowPolyMaterial();
  const group = new THREE.Group();
  group.name = 'walrus';
  const mesh = new THREE.Mesh(body.build(), mat);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);

  const { turret: tGroup, barrel, recoil } = turret(mat);
  group.add(tGroup);

  // running gear: 6 road wheels, sprocket at the front, idler at the back
  const road = wheelGeometry(0.72, 0.5), big = wheelGeometry(0.85, 0.5);
  const wheels: WalrusParts['wheels'] = [];
  const cleats: WalrusParts['cleats'] = [];
  const topGeo = cleatGeometry(2.45, 2.6), botGeo = cleatGeometry(-0.1, 0.05);
  for (const s of [1, -1] as const) {
    const x = s * (TRACK_X1 - 0.3);
    for (const z of [-5.5, -3.3, -1.1, 1.1, 3.3, 5.5]) {
      const w = new THREE.Mesh(road, mat);
      w.position.set(x, 0.78, z);
      if (s < 0) w.rotation.y = Math.PI;
      wheels.push({ mesh: w, r: 0.72, side: s });
      group.add(w);
    }
    for (const z of [7.05, -7.05]) {
      const w = new THREE.Mesh(big, mat);
      w.position.set(x, 1.25, z);
      if (s < 0) w.rotation.y = Math.PI;
      wheels.push({ mesh: w, r: 0.85, side: s });
      group.add(w);
    }
    const top = new THREE.Mesh(topGeo, mat), bottom = new THREE.Mesh(botGeo, mat);
    if (s < 0) { top.scale.x = -1; bottom.scale.x = -1; }
    group.add(top, bottom);
    cleats.push({ top, bottom, side: s });
  }

  const lights = new THREE.Mesh(lightsB.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
  group.add(lights);
  const glow = glows.build();
  group.add(glow);
  return { group, turret: tGroup, lights, glow, parts: { barrel, recoil, wheels, cleats } };
}
