import * as THREE from 'three';
import { LowPolyBuilder } from '../engine/lowpoly';
import { PAL } from '../engine/palette';

/** the body's outline along its length (z, radius), nose at +z: a fat inflated sausage like a barrage balloon */
const BODY: [number, number][] = [[5, 0.3], [4.3, 1.25], [3, 1.85], [1.2, 2.1], [-0.8, 2.1], [-2.6, 1.8], [-4, 1.15], [-5, 0.35]];
const SIDES = 10;
/** the ring of the body that carries the side's colour band */
const BAND = 3;

/**
 * A defence drone: an inflatable balloon 10 m long with three fins at the tail, a small gondola underneath and its
 * propeller (+z forward). Light with an ochre band for the Stoorworm, violet for the Nuckelavee.
 */
export function buildShieldDrone(team: 'spieler' | 'feind'): THREE.BufferGeometry {
  const foe = team === 'feind';
  const skin = foe ? PAL.feindHell : PAL.weiss, band = foe ? PAL.feind : PAL.ocker, dark = foe ? PAL.feindDunkel : PAL.anthrazit;
  const b = new LowPolyBuilder();
  const ring = (z: number, r: number): [number, number, number][] => Array.from({ length: SIDES }, (_, k) => {
    const a = (k + 0.5) / SIDES * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r, z];
  });
  const rings = BODY.map(([z, r]) => ring(z, r));
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let k = 0; k < SIDES; k++) {
      const k1 = (k + 1) % SIDES;
      b.quad(rings[i][k], rings[i + 1][k], rings[i + 1][k1], rings[i][k1], i === BAND ? band : skin);
    }
  }
  // nose and tail
  b.poly(rings[0], skin);
  b.poly([...rings[rings.length - 1]].reverse(), skin);
  // three fins at the tail, one up and two below, as on a barrage balloon
  for (const a of [0, Math.PI * 2 / 3, -Math.PI * 2 / 3]) {
    b.pushTRS([0, 0, 0], 0, [1, 1, 1], 0, a);
    b.box([-0.1, 1.0, -4.9], [0.1, 2.9, -2.4], band);
    b.pop();
  }
  // the gondola with its motor, and a two-bladed propeller behind it
  b.box([-0.45, -2.85, -1.0], [0.45, -2.1, 1.2], { side: dark, top: dark });
  b.box([-1.0, -2.55, -1.2], [1.0, -2.4, -1.1], PAL.metall);
  b.box([-0.08, -3.3, -1.2], [0.08, -1.65, -1.1], PAL.metall);
  return b.build();
}
