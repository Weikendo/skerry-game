import * as THREE from 'three';
import { LowPolyBuilder, lowPolyMaterial, type V3 } from '../engine/lowpoly';
import { GlowSet, type GlowPoints } from '../engine/glow';
import { PAL } from '../engine/palette';

export interface DroneModel {
  group: THREE.Group;
  lights: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  glow: GlowPoints;
  /** the four rotor hubs (spin around y) */
  rotors: THREE.Object3D[];
  /** see-through blur discs, faded in with the rotor speed */
  discs: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
  /** sensor ball under the nose; the lens looks along its +z, the drone stabilises it */
  gimbal: THREE.Object3D;
}

const COL = {
  top: PAL.metallHell, side: PAL.metall, low: PAL.deckDunkel, belly: PAL.anthrazit,
  wing: PAL.metallHell, wingUnder: PAL.metall, edge: PAL.deckDunkel, dark: PAL.anthrazit,
  accent: PAL.ocker, accentDark: PAL.ockerDunkel, glass: PAL.glasBlau, metal: PAL.metall,
};

/** rotor positions (local x, z) at the ends of the two booms; +z is forward */
const BOOM_X = 3.8, ROTOR_Z = 4.6, ROTOR_R = 2.15, ROTOR_Y = 3.45;
const MOTORS: [number, number][] = [[BOOM_X, ROTOR_Z], [-BOOM_X, ROTOR_Z], [BOOM_X, -ROTOR_Z], [-BOOM_X, -ROTOR_Z]];
/** sensor ball centre under the nose */
export const DRONE_GIMBAL: V3 = [0, 1.3, 3.55];

function fuselage(b: LowPolyBuilder) {
  // z, half width, top, bottom: pointed sensor nose, deep mid body, slim tail
  const S: [number, number, number, number][] = [
    [5.3, 0, 2.45, 2.2], [4.4, 0.55, 2.9, 1.75], [3.0, 0.9, 3.15, 1.6], [0.8, 1.0, 3.2, 1.55],
    [-1.6, 0.95, 3.05, 1.6], [-3.4, 0.6, 2.85, 1.95], [-4.4, 0.3, 2.65, 2.25],
  ];
  const ring = (w: number, t: number, bo: number, z: number): V3[] => {
    const mid = bo + (t - bo) * 0.55;
    return [[-w * 0.55, t, z], [w * 0.55, t, z], [w, mid, z], [w * 0.7, bo, z], [-w * 0.7, bo, z], [-w, mid, z]];
  };
  const facet = [COL.top, COL.side, COL.low, COL.belly, COL.low, COL.side];
  for (let i = 0; i + 1 < S.length; i++) {
    const [za, wa, ta, ba] = S[i], [zb, wb, tb, bb] = S[i + 1];
    const A = ring(wa, ta, ba, za), B = ring(wb, tb, bb, zb);
    for (let k = 0; k < 6; k++) {
      const j = (k + 1) % 6;
      if (wa === 0) b.tri([0, (ta + ba) / 2, za], B[j], B[k], k === 0 ? COL.dark : facet[k]);
      else b.quad(A[k], A[j], B[j], B[k], facet[k]);
    }
  }
  const [zt, wt, tt, bt] = S[S.length - 1];
  b.poly(ring(wt, tt, bt, zt), COL.dark);
  // satellite-link hump on the back, ochre on top (player colour)
  const h0 = 3.18, h1 = 3.62;
  const lo: V3[] = [[-0.62, h0, 0.3], [0.62, h0, 0.3], [0.62, h0, 3.0], [-0.62, h0, 3.0]];
  const hi: V3[] = [[-0.42, h1, 0.8], [0.42, h1, 0.8], [0.42, h1, 2.2], [-0.42, h1, 2.2]];
  b.quad(hi[0], hi[1], hi[2], hi[3], COL.accent);
  b.quad(lo[3], lo[2], hi[2], hi[3], COL.side);
  b.quad(lo[0], lo[1], hi[1], hi[0], COL.low);
  b.quad(lo[1], lo[2], hi[2], hi[1], COL.accentDark);
  b.quad(lo[0], lo[3], hi[3], hi[0], COL.accentDark);
  // blade antennas, intake grille, exhaust of the generator
  b.box([-0.04, 3.05, -2.2], [0.04, 3.75, -1.6], COL.dark);
  b.box([-0.04, 1.2, -0.4], [0.04, 1.6, 0.2], COL.dark);
  b.box([-0.5, 3.12, -1.2], [0.5, 3.22, -0.4], COL.dark);
  b.cylinder([0, 2.4, -4.4], 0.22, 0.18, 0.12, 6, COL.dark, COL.dark);
}

/** stub wings carrying the two rotor booms (quadplane layout), ochre tips */
function wingsAndBooms(b: LowPolyBuilder) {
  for (const s of [-1, 1]) {
    const P = (x: number, y: number, z: number): V3 => [s * x, y, z];
    const top = [P(0.9, 2.8, 1.2), P(5.8, 2.72, 0.6), P(5.8, 2.72, -0.45), P(0.9, 2.8, -0.95)];
    const bot = [P(0.9, 2.52, 1.2), P(5.8, 2.6, 0.6), P(5.8, 2.6, -0.45), P(0.9, 2.52, -0.95)];
    b.poly(top, COL.wing);
    b.poly(bot, COL.wingUnder);
    b.quad(top[0], top[1], bot[1], bot[0], COL.edge);
    b.quad(top[3], top[2], bot[2], bot[3], COL.edge);
    // ochre tip band
    const tipT = [P(5.0, 2.735, 0.7), P(5.8, 2.725, 0.6), P(5.8, 2.725, -0.45), P(5.0, 2.735, -0.53)];
    b.poly(tipT, COL.accent);
    b.quad(top[1], top[2], bot[2], bot[1], COL.accentDark);
    // boom with motor pods at both ends
    b.box([s * BOOM_X - 0.19, 2.42, -ROTOR_Z - 0.35], [s * BOOM_X + 0.19, 2.8, ROTOR_Z + 0.35], { side: COL.side, top: COL.top, bottom: COL.low });
    for (const z of [ROTOR_Z, -ROTOR_Z]) {
      b.cylinder([s * BOOM_X, 2.8, z], 0.36, 0.3, 0.5, 8, COL.dark, COL.metal);
      b.cylinder([s * BOOM_X, 2.15, z], 0.22, 0.3, 0.27, 6, COL.low, COL.low);
    }
  }
}

/** V-tail on the tail cone */
function vTail(b: LowPolyBuilder) {
  for (const s of [-1, 1]) {
    const root0: V3 = [s * 0.25, 2.8, -2.7], root1: V3 = [s * 0.2, 2.7, -4.3];
    const tip0: V3 = [s * 1.55, 4.05, -3.75], tip1: V3 = [s * 1.6, 4.0, -4.55];
    b.poly([root0, tip0, tip1, root1], COL.side);
    b.quad([s * 1.4, 3.9, -3.85], tip0, tip1, [s * 1.45, 3.85, -4.53], COL.accent);
  }
}

function gear(b: LowPolyBuilder) {
  for (const s of [-1, 1]) {
    b.beam([s * 1.35, 0.08, -2.6], [s * 1.35, 0.08, 2.4], 0.12, COL.dark);
    b.beam([s * 1.35, 0.08, 2.4], [s * 1.35, 0.32, 2.85], 0.12, COL.dark);
    for (const z of [-1.7, 1.6]) b.beam([s * 1.35, 0.1, z], [s * 0.6, 1.62, z * 0.9], 0.11, COL.metal);
  }
}

/**
 * Large military reconnaissance drone (VTOL quadplane): fuselage about 10 m
 * long, stub wings with two booms, four lifting rotors (12 m across), V-tail and
 * a stabilised sensor ball under the nose. Origin = where the skids touch the
 * ground, so the model stands on y = 0.
 */
export function buildDrone(): DroneModel {
  const b = new LowPolyBuilder(), lightsB = new LowPolyBuilder(), glows = new GlowSet();
  fuselage(b);
  wingsAndBooms(b);
  vTail(b);
  gear(b);
  // ball mount under the nose
  b.cylinder([DRONE_GIMBAL[0], DRONE_GIMBAL[1] + 0.3, DRONE_GIMBAL[2]], 0.2, 0.26, 0.3, 6, COL.low, COL.low);

  // nav lights: red port (+x) and green starboard wing tip, white strobe on the tail, red beacon below
  lightsB.box([5.78, 2.6, -0.1], [5.86, 2.74, 0.25], PAL.lichtRot);
  lightsB.box([-5.86, 2.6, -0.1], [-5.78, 2.74, 0.25], PAL.lichtGruen);
  lightsB.box([-0.1, 2.6, -4.47], [0.1, 2.75, -4.42], PAL.lichtWeiss);
  lightsB.box([-0.12, 1.42, -1.2], [0.12, 1.55, -0.9], PAL.lichtRot);
  glows.add([5.95, 2.67, 0.08], PAL.lichtRot, 3).add([-5.95, 2.67, 0.08], PAL.lichtGruen, 3)
    .add([0, 2.68, -4.6], PAL.lichtWeiss, 2.6).add([0, 1.3, -1.05], PAL.lichtRot, 2.4);

  const g = new THREE.Group();
  const mat = lowPolyMaterial();
  const mesh = new THREE.Mesh(b.build(), mat);
  mesh.castShadow = mesh.receiveShadow = true;
  const lights = new THREE.Mesh(lightsB.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
  const glow = glows.build();
  g.add(mesh, lights, glow);

  // rotors: three blades each, plus a blur disc for high rpm
  const blade = new LowPolyBuilder();
  for (let k = 0; k < 3; k++) {
    blade.pushTRS([0, 0, 0], (k / 3) * Math.PI * 2);
    blade.quad([0.15, 0.03, -0.13], [ROTOR_R, 0.0, -0.08], [ROTOR_R, 0.0, 0.08], [0.15, 0.03, 0.13], COL.dark);
    blade.quad([ROTOR_R - 0.25, 0.005, -0.081], [ROTOR_R, 0.002, -0.081], [ROTOR_R, 0.002, 0.081], [ROTOR_R - 0.25, 0.005, 0.081], COL.accent);
    blade.pop();
  }
  blade.cylinder([0, -0.06, 0], 0.2, 0.12, 0.16, 6, COL.metal, COL.dark);
  const bladeGeo = blade.build();
  const discGeo = new THREE.CircleGeometry(ROTOR_R, 16).rotateX(-Math.PI / 2);
  const rotors: THREE.Object3D[] = [], discs: DroneModel['discs'] = [];
  for (const [x, z] of MOTORS) {
    const hub = new THREE.Group();
    hub.position.set(x, ROTOR_Y, z);
    const bm = new THREE.Mesh(bladeGeo, mat);
    bm.castShadow = true;
    hub.add(bm);
    const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: PAL.stahlHell, transparent: true, opacity: 0, depthWrite: false }));
    disc.position.set(x, ROTOR_Y + 0.02, z);
    g.add(hub, disc);
    rotors.push(hub); discs.push(disc);
  }

  // sensor ball: faceted housing, lens window to the front (+z)
  const gimbal = new THREE.Group();
  gimbal.position.set(...DRONE_GIMBAL);
  const gb = new LowPolyBuilder();
  gb.cylinder([0, -0.22, 0], 0.44, 0.44, 0.44, 8, COL.side, COL.side, null, Math.PI / 8);
  gb.cone([0, 0.22, 0], 0.44, 0.22, 8, COL.top, Math.PI / 8);
  gb.pushTRS([0, -0.22, 0], 0, [1, 1, 1], Math.PI);
  gb.cone([0, 0, 0], 0.44, 0.22, 8, COL.low, Math.PI / 8);
  gb.pop();
  gb.pushTRS([0, 0, 0.4], 0, [1, 1, 1], Math.PI / 2);   // +y of the cylinder becomes +z
  gb.cylinder([0, 0, 0], 0.2, 0.2, 0.08, 8, COL.dark, COL.glass);
  gb.pop();
  gb.box([0.16, 0.06, 0.38], [0.3, 0.16, 0.45], COL.glass);
  const gm = new THREE.Mesh(gb.build(), mat);
  gimbal.add(gm);
  g.add(gimbal);
  g.name = 'drohne';
  return { group: g, lights, glow, rotors, discs, gimbal };
}
