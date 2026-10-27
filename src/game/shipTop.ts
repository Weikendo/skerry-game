import * as THREE from 'three';

/** cell size of the map (m): fine enough for masts and gun turrets, coarse enough to build in a few milliseconds */
const CELL = 3;

/**
 * A ship's top as a coarse height map in its own coordinates (x to port, z forward), built once from its
 * model: the deck, the bridge, masts and guns, whatever the model has. A Skua that flies below it there has
 * flown into the ship. Each triangle raises the cells under its outline to its highest corner, so slopes
 * err on the high side by at most a cell.
 */
export class ShipTop {
  private top: Float32Array;
  private x0 = 0;
  private z0 = 0;
  private nx = 0;
  private nz = 0;

  constructor(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const toShip = root.matrixWorld.clone().invert(), m = new THREE.Matrix4(), v = new THREE.Vector3();
    // every triangle in ship coordinates
    const tris: number[] = [];
    root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      const pos = mesh.geometry.getAttribute('position'), idx = mesh.geometry.index;
      if (!pos) return;
      m.multiplyMatrices(toShip, mesh.matrixWorld);
      const n = idx ? idx.count : pos.count;
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m);
        tris.push(v.x, v.y, v.z);
      }
    });
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < tris.length; i += 3) {
      minX = Math.min(minX, tris[i]); maxX = Math.max(maxX, tris[i]);
      minZ = Math.min(minZ, tris[i + 2]); maxZ = Math.max(maxZ, tris[i + 2]);
    }
    this.x0 = minX; this.z0 = minZ;
    this.nx = Math.max(1, Math.ceil((maxX - minX) / CELL) + 1);
    this.nz = Math.max(1, Math.ceil((maxZ - minZ) / CELL) + 1);
    this.top = new Float32Array(this.nx * this.nz).fill(-Infinity);
    for (let t = 0; t + 8 < tris.length; t += 9) {
      const xs = [tris[t], tris[t + 3], tris[t + 6]], zs = [tris[t + 2], tris[t + 5], tris[t + 8]];
      const y = Math.max(tris[t + 1], tris[t + 4], tris[t + 7]);
      const i0 = Math.floor((Math.min(...xs) - minX) / CELL), i1 = Math.floor((Math.max(...xs) - minX) / CELL);
      const j0 = Math.floor((Math.min(...zs) - minZ) / CELL), j1 = Math.floor((Math.max(...zs) - minZ) / CELL);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * this.nx + i;
        if (y > this.top[k]) this.top[k] = y;
      }
    }
  }

  /** the ship's top at (x, z) in its own coordinates, -Infinity off the ship */
  at(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / CELL), j = Math.floor((z - this.z0) / CELL);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -Infinity;
    return this.top[j * this.nx + i];
  }
}
