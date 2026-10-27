import * as THREE from 'three';
import { LowPolyBuilder, lowPolyMaterial, mulberry32 } from '../engine/lowpoly';
import { Noise2D } from '../engine/noise';
import { PAL, type PalName } from '../engine/palette';
import type { Species } from './biomes';
import type { Island } from './island';

type Tiers = [PalName, PalName, PalName];

function conifer(tiers: Tiers, under: PalName): THREE.BufferGeometry {
  const b = new LowPolyBuilder();
  b.cylinder([0, -1, 0], 0.7, 0.5, 3.4, 5, PAL.holz, PAL.holz);
  b.cone([0, 1.8, 0], 4.4, 6.2, 6, PAL[tiers[0]], 0.3, PAL[under]);
  b.cone([0, 4.9, 0], 3.5, 5.6, 6, PAL[tiers[1]], 0.9, PAL[under]);
  b.cone([0, 7.9, 0], 2.4, 4.8, 6, PAL[tiers[2]], 0.1, PAL[under]);
  return b.build();
}

function snowPine(): THREE.BufferGeometry {
  const b = new LowPolyBuilder();
  b.cylinder([0, -1, 0], 0.7, 0.5, 3.4, 5, PAL.holz, PAL.holz);
  // dark needles with snow caps on every tier
  for (const [y, r, h, ph] of [[1.8, 4.4, 6.2, 0.3], [4.9, 3.5, 5.6, 0.9], [7.9, 2.4, 4.8, 0.1]] as const) {
    b.cone([0, y, 0], r, h, 6, PAL.gruen5, ph, PAL.gruen5);
    b.cone([0, y + h * 0.45, 0], r * 0.6, h * 0.55, 6, PAL.schnee, ph);
  }
  return b.build();
}

function roundTree(crown: PalName, small: PalName): THREE.BufferGeometry {
  const b = new LowPolyBuilder();
  b.cylinder([0, -1, 0], 0.8, 0.55, 5.5, 5, PAL.holz, PAL.holz);
  b.geometry(new THREE.IcosahedronGeometry(4.2, 0).translate(0, 7.2, 0), PAL[crown]);
  b.geometry(new THREE.IcosahedronGeometry(2.6, 0).rotateY(0.7).translate(2.2, 5.6, 1.2), PAL[small]);
  return b.build();
}

function shrub(a: PalName, c: PalName): THREE.BufferGeometry {
  const b = new LowPolyBuilder();
  b.geometry(new THREE.IcosahedronGeometry(1.6, 0).scale(1, 0.7, 1).translate(0, 0.6, 0), PAL[a]);
  b.geometry(new THREE.IcosahedronGeometry(1.1, 0).scale(1, 0.75, 1).translate(1.2, 0.5, 0.6), PAL[c]);
  return b.build();
}

function rock(color: PalName, seed: number, detail = 0): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.getAttribute('position');
  const rnd = mulberry32(seed);
  const seen = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, 0.75 + rnd() * 0.45);
    const s = seen.get(key)!;
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.65, p.getZ(i) * s);
  }
  return new LowPolyBuilder().geometry(g, PAL[color]).build();
}

/**
 * Rocks in two sizes, from `lo` m to `hi1` (first colour) or `hi2` (second): the big ones get four times the faces,
 * so their facets come out about as big as the small ones' (after the low-poly article: polygon size by object size)
 */
function rocks(c1: PalName, c2: PalName, lo: number, hi1: number, hi2: number): { geo: THREE.BufferGeometry; scale: [number, number] }[] {
  const mid = (lo + hi1) / 2;
  return [
    { geo: rock(c1, 5), scale: [lo, mid] }, { geo: rock(c2, 9), scale: [lo, mid] },
    { geo: rock(c1, 6, 1), scale: [mid, hi1] }, { geo: rock(c2, 10, 1), scale: [mid, hi2] },
  ];
}

/** geometry variants per species kind, chosen by biome */
function variants(kind: Species['kind'], biome: string): { geo: THREE.BufferGeometry; scale: [number, number] }[] {
  switch (kind) {
    case 'nadelbaum': return [
      { geo: conifer(['gruen4', 'gruen3', 'gruen2'], 'gruen5'), scale: [0.75, 1.35] },
      { geo: conifer(['gruen5', 'gruen4', 'gruen3'], 'gruen5'), scale: [0.75, 1.35] }];
    case 'laubbaum': return [
      { geo: roundTree('gruen2', 'gruen1'), scale: [0.75, 1.3] },
      { geo: roundTree('gruen3', 'gruen2'), scale: [0.75, 1.3] }];
    case 'busch': return biome === 'schaere' || biome === 'basalt'
      ? [{ geo: shrub('heide', 'moos'), scale: [0.35, 0.8] }, { geo: shrub('moos', 'gruen4'), scale: [0.35, 0.8] }]
      : [{ geo: shrub('gruen3', 'gruen2'), scale: [0.6, 1.5] }, { geo: shrub('gruen4', 'gruen3'), scale: [0.6, 1.5] }];
    case 'fels': return biome === 'basalt' ? rocks('basalt', 'basaltHell', 1.5, 5, 4.5)
      : biome === 'schaere' ? rocks('schaerenFels', 'flechte', 1.5, 6, 5)
        : rocks('fels2', 'fels3', 2, 7, 6);
    case 'schneetanne': return [{ geo: snowPine(), scale: [0.75, 1.35] }];
  }
}

export class Vegetation {
  readonly group = new THREE.Group();
  count = 0;

  /** keepClear: circles (e.g. building sites) where nothing may grow */
  constructor(island: Island, seed = 3, keepClear: { x: number; z: number; r: number }[] = []) {
    const rnd = mulberry32(seed);
    const n = new Noise2D(seed + 11);
    const mat = lowPolyMaterial({ side: THREE.FrontSide });
    const half = island.size / 2 - 50;
    const q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

    for (const sp of island.biome.species) {
      const vars = variants(sp.kind, island.biome.id);
      const items: THREE.Matrix4[][] = vars.map(() => []);
      let placed = 0;
      for (let tries = 0; tries < sp.count * 25 && placed < sp.count; tries++) {
        const x = island.cx + (rnd() * 2 - 1) * half, z = island.cz + (rnd() * 2 - 1) * half;
        const h = island.heightAt(x, z);
        if (h < sp.minH || h > sp.maxH) continue;
        // groves: cluster by a noise field, the stronger the clump the tighter
        if (sp.clump > 0 && n.fbm(x * 0.006, z * 0.006, 2) < sp.clump * 0.5 - 0.15 + (rnd() - 0.5) * 0.2) continue;
        if (island.slopeAt(x, z) > sp.maxSlope) continue;
        if (keepClear.some(c => Math.hypot(x - c.x, z - c.z) < c.r + 12) || island.biome.covered(x - island.cx, z - island.cz)) continue;
        const v = Math.floor(rnd() * vars.length);
        const [s0, s1] = vars[v].scale;
        const scale = s0 + rnd() * (s1 - s0);
        const isRock = sp.kind === 'fels';
        q.setFromAxisAngle(up, rnd() * Math.PI * 2);
        s.set(scale, scale * (isRock ? 1 : 0.9 + rnd() * 0.3), scale);
        t.set(x, h - (isRock ? scale * 0.3 : 0.3), z);
        items[v].push(new THREE.Matrix4().compose(t, q, s));
        placed++;
      }
      vars.forEach((va, k) => {
        if (!items[k].length) return;
        const mesh = new THREE.InstancedMesh(va.geo, mat, items[k].length);
        items[k].forEach((m, j) => mesh.setMatrixAt(j, m));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        this.group.add(mesh);
      });
      this.count += placed;
    }
    this.group.name = `vegetation-${island.name}`;
  }
}
