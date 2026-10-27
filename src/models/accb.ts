import * as THREE from 'three';
import { LowPolyBuilder, lowPolyMaterial } from '../engine/lowpoly';
import { GlowSet } from '../engine/glow';
import { PAL } from '../engine/palette';

/**
 * ACCB capsule (Automatic Command Centre Builder): an upright pod in the
 * player's ochre with landing feet and a beacon. Origin on the ground, about
 * 5 m tall; scaled down it rides on the Walrus' rear deck.
 */
export function buildAccb(): THREE.Group {
  const b = new LowPolyBuilder(), lights = new LowPolyBuilder();
  const ph = Math.PI / 8;
  b.cylinder([0, 0.6, 0], 1.6, 1.7, 2.6, 8, PAL.ocker, PAL.ocker, null, ph);
  b.cylinder([0, 3.2, 0], 1.7, 1.7, 0.35, 8, PAL.anthrazit, PAL.anthrazit, null, ph);
  b.cylinder([0, 3.55, 0], 1.7, 1.15, 0.9, 8, PAL.weiss, PAL.stahlHell, null, ph);
  b.cone([0, 4.45, 0], 1.15, 0.5, 8, PAL.ockerHell);
  b.cylinder([0, 4.9, 0], 0.08, 0.05, 1.2, 4, PAL.anthrazit);
  // a dark band with the hatch, landing feet
  b.cylinder([0, 1.5, 0], 1.66, 1.66, 0.3, 8, PAL.ockerDunkel, PAL.ockerDunkel, null, ph);
  b.box([-0.55, 0.9, 1.5], [0.55, 2.6, 1.72], PAL.anthrazit);
  for (let i = 0; i < 4; i++) {
    const a = ph + i * Math.PI / 2, x = Math.cos(a), z = Math.sin(a);
    b.beam([x * 1.4, 0.9, z * 1.4], [x * 2.1, 0.05, z * 2.1], 0.14, PAL.metall);
    b.cylinder([x * 2.1, 0, z * 2.1], 0.35, 0.3, 0.12, 6, PAL.metall);
  }
  lights.box([-0.12, 6.05, -0.12], [0.12, 6.3, 0.12], PAL.lichtGruen);
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(b.build(), lowPolyMaterial());
  mesh.castShadow = mesh.receiveShadow = true;
  g.add(mesh, new THREE.Mesh(lights.build(), new THREE.MeshBasicMaterial({ vertexColors: true })));
  g.add(new GlowSet().add([0, 6.2, 0], PAL.lichtGruen, 4).build());
  g.name = 'accb';
  return g;
}
