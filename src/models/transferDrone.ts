import * as THREE from 'three';
import { LowPolyBuilder, lowPolyMaterial } from '../engine/lowpoly';
import { GlowSet } from '../engine/glow';
import { PAL } from '../engine/palette';

/**
 * Semi-submersible cargo drone: a flat, faceted hull about 14 m long with a
 * cargo hump. Origin at the waterline; +z forward.
 */
export function buildTransferDrone(): THREE.Group {
  const b = new LowPolyBuilder(), lights = new LowPolyBuilder();
  // hull: hexagonal section, pointed bow
  const prof: [number, number][] = [[-2.2, -1.2], [2.2, -1.2], [2.6, 0], [2.0, 0.9], [-2.0, 0.9], [-2.6, 0]];
  b.prismZ(prof, -6, 4.5, PAL.stahl, PAL.metall);
  b.poly([[-2.0, 0.9, 4.5], [2.0, 0.9, 4.5], [0, 0.3, 7.5]], PAL.stahlHell);
  b.tri([2.6, 0, 4.5], [2.0, 0.9, 4.5], [0, 0.3, 7.5], PAL.stahl);
  b.tri([-2.0, 0.9, 4.5], [-2.6, 0, 4.5], [0, 0.3, 7.5], PAL.stahl);
  b.tri([-2.6, 0, 4.5], [2.6, 0, 4.5], [0, 0.3, 7.5], PAL.deckDunkel);
  // cargo hump in the player's ochre, docking clamp at the bow
  b.box([-1.5, 0.9, -4.5], [1.5, 2.0, 2.5], { side: PAL.ockerDunkel, top: PAL.ocker });
  b.box([-0.5, 2.0, -1.0], [0.5, 2.6, 0.2], PAL.anthrazit);
  b.box([-0.6, 0.2, 7.0], [0.6, 0.8, 7.9], PAL.metall);
  lights.box([-0.15, 2.6, -0.6], [0.15, 2.9, -0.3], PAL.lichtWarm);
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(b.build(), lowPolyMaterial());
  mesh.castShadow = mesh.receiveShadow = true;
  g.add(mesh, new THREE.Mesh(lights.build(), new THREE.MeshBasicMaterial({ vertexColors: true })));
  g.add(new GlowSet().add([0, 2.8, -0.45], PAL.lichtWarm, 3.5).build());
  g.name = 'transferdrohne';
  return g;
}
