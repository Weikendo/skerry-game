import * as THREE from 'three';
import { LowPolyBuilder, lowPolyMaterial } from '../engine/lowpoly';
import { PAL } from '../engine/palette';

/** the canopy's outline from its top down to its rim (radius, height above the pod), and how many gores it has */
const CANOPY: [number, number][] = [[0, 8.4], [2.3, 7.9], [3.9, 6.9], [4.6, 5.5]];
const GORES = 8;

export interface ObservationDroneModel {
  group: THREE.Group;
  /** the parachute (scaled up as it opens) */
  chute: THREE.Object3D;
}

/**
 * The observation drone of the Hammerhead: a camera pod shot up from the carrier that comes down slowly under its
 * parachute (orange and white gores, eight lines) and looks round with the lens under its nose. The Nuckelavee's
 * in its violet.
 */
export function buildObservationDrone(team: 'spieler' | 'feind'): ObservationDroneModel {
  const foe = team === 'feind';
  const mat = lowPolyMaterial();
  const pod = new LowPolyBuilder();
  const body = foe ? PAL.feindDunkel : PAL.anthrazit, stripe = foe ? PAL.feind : PAL.rettungsOrange;
  pod.cylinder([0, -0.9, 0], 0.5, 0.5, 1.8, 8, body, body, body);
  pod.cylinder([0, 0.2, 0], 0.52, 0.52, 0.25, 8, stripe, stripe);
  pod.cone([0, 0.9, 0], 0.5, 0.6, 8, body);
  // the lens: a dark dome under the pod, its glass towards the front
  pod.cylinder([0, -1.25, 0], 0.32, 0.38, 0.35, 8, PAL.schwarz, PAL.schwarz, PAL.fensterBlau);
  // three small fins round the tail it flew up on
  for (let k = 0; k < 3; k++) {
    pod.pushTRS([0, 0, 0], k * Math.PI * 2 / 3);
    pod.box([-0.04, -0.9, 0.45], [0.04, -0.2, 0.85], stripe);
    pod.pop();
  }
  const chute = new LowPolyBuilder();
  const white = foe ? PAL.feindHell : PAL.weiss, orange = foe ? PAL.feind : PAL.rettungsOrange;
  const at = (r: number, y: number, k: number): [number, number, number] => {
    const a = k / GORES * Math.PI * 2;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };
  for (let k = 0; k < GORES; k++) {
    const col = k % 2 ? white : orange;
    for (let i = 0; i + 1 < CANOPY.length; i++) {
      const [r0, y0] = CANOPY[i], [r1, y1] = CANOPY[i + 1];
      chute.quad(at(r0, y0, k), at(r0, y0, k + 1), at(r1, y1, k + 1), at(r1, y1, k), col);
    }
    // a line from the rim down to the pod
    const [rr, yr] = CANOPY[CANOPY.length - 1];
    chute.beam(at(rr, yr, k), [0, 1.1, 0], 0.05, PAL.stahl);
  }
  const group = new THREE.Group();
  group.name = foe ? 'observation-drone-foe' : 'observation-drone';
  const podMesh = new THREE.Mesh(pod.build(), mat);
  const chuteMesh = new THREE.Mesh(chute.build(), mat);
  podMesh.castShadow = chuteMesh.castShadow = true;
  group.add(podMesh, chuteMesh);
  return { group, chute: chuteMesh };
}
