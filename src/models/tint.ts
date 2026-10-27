import * as THREE from 'three';
import { PAL, type PalName } from '../engine/palette';
import { ENEMY_GEOMETRY } from './glb';

/**
 * The enemy's vehicles are the player's models in the enemy's colours: the
 * player's ochre and signal orange become the enemy's violet. The vertex
 * colours of every mesh are swapped in place (each geometry once). The models from Blender come
 * in the enemy's colours already: their geometry is swapped for that version.
 */
const ENEMY_SWAP: [PalName, PalName][] = [
  ['ockerHell', 'feindHell'], ['ocker', 'feind'], ['ockerDunkel', 'feindDunkel'], ['ockerGrau', 'feindGrau'],
  ['signalOrange', 'feind'], ['signalOrangeDunkel', 'feindDunkel'], ['rettungsOrange', 'feindHell'],
];

export function enemyTint(obj: THREE.Object3D) {
  // the builders store colours as THREE.Color does (linear), so compare the same way
  const swap = ENEMY_SWAP.map(([a, b]) => [new THREE.Color(PAL[a]), new THREE.Color(PAL[b])] as const);
  obj.traverse(o => {
    const alt = (o as THREE.Mesh).isMesh ? ENEMY_GEOMETRY.get((o as THREE.Mesh).geometry) : undefined;
    if (alt) { (o as THREE.Mesh).geometry = alt; return; }
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    const c = g?.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!g || !c || g.userData.tinted) return;
    g.userData.tinted = true;
    for (let i = 0; i < c.count; i++) {
      const r = c.getX(i), gr = c.getY(i), b = c.getZ(i);
      for (const [from, to] of swap) {
        if (Math.abs(r - from.r) + Math.abs(gr - from.g) + Math.abs(b - from.b) < 1e-3) { c.setXYZ(i, to.r, to.g, to.b); break; }
      }
    }
    c.needsUpdate = true;
  });
}
