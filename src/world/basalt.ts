import * as THREE from 'three';
import { LowPolyBuilder, lowPolyMaterial } from '../engine/lowpoly';
import { PAL, type PalName } from '../engine/palette';
import { caveRoof, type Basalt, type Column } from './biomes';
import type { Island } from './island';

/** the looks of a column (Column['look']): its sides, its top */
// (the sides lighter than one would think: standing upright under a high sun they get little light)
// (the steps: pale treads over dark risers, so a landing shows from out at sea)
const LOOKS: [PalName, PalName][] = [['asche', 'basaltHell'], ['basaltHell', 'basalt'], ['asche', 'moos'], ['asche', 'vogelkot'], ['basaltHell', 'asche']];
const MAT = lowPolyMaterial({ side: THREE.FrontSide });
/** one hexagonal prism per look, radius 1 from y 0 to 1, flat sides facing ±x; shared by every island */
const PRISMS = LOOKS.map(([side, top]) => outward(new LowPolyBuilder().cylinder([0, 0, 0], 1, 1, 1, 6, PAL[side], PAL[top], null, Math.PI / 6).build(), 12));

/**
 * The builder's cylinder winds its sides inwards (its material draws both faces, so it never shows); the columns
 * draw only front faces, so their first `n` triangles (the six sides) are turned round, or the sides facing the
 * camera were missing and one looked into the columns.
 */
function outward(g: THREE.BufferGeometry, n: number): THREE.BufferGeometry {
  for (const name of ['position', 'color']) {
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    for (let t = 0; t < n; t++) {
      const i = t * 3 + 1, j = t * 3 + 2;
      const x = a.getX(i), y = a.getY(i), z = a.getZ(i);
      a.setXYZ(i, a.getX(j), a.getY(j), a.getZ(j));
      a.setXYZ(j, x, y, z);
    }
  }
  g.computeVertexNormals();
  return g;
}
/** the columns stand a little apart, so the joints between them show as thin dark lines */
const JOINT = 0.94;

/**
 * A basalt island's columns (see Basalt.columns) as one instanced mesh per look: built with the island's fine
 * terrain and dropped with it. Their tops follow its height field, so they need that grid to be loaded.
 */
export function buildColumns(isl: Island, b: Basalt): THREE.Group {
  const group = new THREE.Group();
  group.name = `basalt-${isl.name}`;
  const byLook = LOOKS.map(() => [] as Column[]);
  for (const c of b.columns((x, z) => isl.heightAt(isl.cx + x, isl.cz + z))) byLook[c.look].push(c);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3();
  // (the lattice runs turned by the grain: the same turn for every prism)
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -b.grain);
  byLook.forEach((list, k) => {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(PRISMS[k], MAT, list.length);
    list.forEach((c, i) => {
      p.set(isl.cx + c.x, c.y0, isl.cz + c.z);
      s.set(c.r * JOINT, Math.max(0.1, c.y1 - c.y0), c.r * JOINT);
      mesh.setMatrixAt(i, m.compose(p, q, s));
    });
    // (no shadows: the terrain's coarse shadow proxy would cut dark triangles into their faces, and theirs would
    // fall almost only on the sea, at the cost of drawing them all again for the shadow map)
    mesh.computeBoundingSphere();
    group.add(mesh);
  });
  // the sea cave: a dark arched recess in the mouth the hanging columns leave open
  const cave = b.cave;
  if (cave) {
    const arch: [number, number][] = [];
    for (let i = 0; i <= 8; i++) { const u = (i / 8 - 0.5) * (cave.w + 2); arch.push([-u, caveRoof(cave, Math.min(Math.abs(u), cave.w / 2)) + 0.5]); }
    const g = new LowPolyBuilder().prismZ([[-cave.w / 2 - 1, -3], [cave.w / 2 + 1, -3], ...arch], -1.5, 1.5, PAL.anthrazit, PAL.schwarz).build();
    const mesh = new THREE.Mesh(g, MAT);
    // (the box's front faces +z: turn that out to sea, 10 m out from the coast line, in front of the cliff's foot)
    mesh.position.set(isl.cx + cave.x + cave.nx * 10, 0, isl.cz + cave.z + cave.nz * 10);
    mesh.rotation.y = Math.atan2(cave.nx, cave.nz);
    mesh.name = 'basalt-cave';
    group.add(mesh);
  }
  return group;
}

/** frees what buildColumns made for one island (the prisms and the material are shared) */
export function disposeColumns(group: THREE.Group) {
  group.traverse(o => {
    if (o instanceof THREE.InstancedMesh) o.dispose();
    else if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
}
