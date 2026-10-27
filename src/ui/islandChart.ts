import * as THREE from 'three';
import { hash2 } from '../engine/lowpoly';
import { PAL } from '../engine/palette';
import { colourSeed, type Island } from '../world/island';

/**
 * The map's picture of an island in the look of the 3D world: a jittered
 * triangle grid like the terrain mesh, every facet flat-shaded in its biome
 * colour and lit from the north-west (the usual direction on maps), and the
 * sea around it in toon bands from the beach outwards, as on the 3D ocean.
 */

/** facets across the island (the 3D world's coarse grid is finer; at map scale this reads the same) */
const CELLS = 44;
const JITTER = 0.7;
/** north-west and high: x east, y up, z south */
const LIGHT = new THREE.Vector3(-0.5, 0.8, -0.45).normalize();

const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const; };
/** shallow water bands: [deeper than this (m), colour, alpha] */
const BANDS: [number, readonly [number, number, number], number][] = [
  [-1.2, rgb('#c9f3ea'), 225],          // surf on the beach
  [-6, rgb(PAL.wasserFlach), 175],
  [-14, rgb(PAL.wasserMittel), 120],
  [-26, rgb(PAL.wasserTief), 55],
];

export function renderChart(isl: Island, res = 384): HTMLCanvasElement {
  const size = isl.size, half = size / 2, x0 = isl.cx - half, z0 = isl.cz - half;
  const N = CELLS, N1 = N + 1, cell = size / N;
  // vertices, jittered inside like the terrain mesh
  const px = new Float32Array(N1 * N1), pz = new Float32Array(N1 * N1), py = new Float32Array(N1 * N1);
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const k = j * N1 + i, edge = i === 0 || j === 0 || i === N || j === N;
    px[k] = x0 + i * cell + (edge ? 0 : (hash2(i, j, 11) - 0.5) * cell * JITTER);
    pz[k] = z0 + j * cell + (edge ? 0 : (hash2(i, j, 12) - 0.5) * cell * JITTER);
    py[k] = isl.heightAt(px[k], pz[k]);
  }
  // (a skerry's pools lie in the hollows)
  const hollow = new Float32Array(N1 * N1).map((_, k) => isl.hollowAt(px[k], pz[k]));

  // rasterize the facets into a buffer of facet indices, with one colour per facet
  const facet = new Int32Array(res * res).fill(-1);
  const colours: number[] = [];
  const color = new THREE.Color(), srgb = { r: 0, g: 0, b: 0 };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  const toPx = (x: number) => ((x - x0) / size) * res, toPy = (z: number) => ((z - z0) / size) * res;

  const facetOf = (ka: number, kb: number, kc: number, seed: number) => {
    if (py[ka] < 0 && py[kb] < 0 && py[kc] < 0) return;   // under water: the sea bands show there
    a.set(px[ka], py[ka], pz[ka]); b.set(px[kb], py[kb], pz[kb]); c.set(px[kc], py[kc], pz[kc]);
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
    if (n.y < 0) n.negate();
    const cy = (a.y + b.y + c.y) / 3, lx = (a.x + b.x + c.x) / 3 - isl.cx, lz = (a.z + b.z + c.z) / 3 - isl.cz;
    isl.biome.color(lx, cy, lz, n.y, colourSeed(lx + isl.cx, lz + isl.cz, seed), color, (hollow[ka] + hollow[kb] + hollow[kc]) / 3);
    color.getRGB(srgb, THREE.SRGBColorSpace);
    const light = 0.6 + 0.52 * Math.max(0, n.dot(LIGHT));
    const id = colours.length / 3;
    colours.push(Math.min(255, srgb.r * 255 * light), Math.min(255, srgb.g * 255 * light), Math.min(255, srgb.b * 255 * light));
    // edge functions over the facet's bounding box
    const ax = toPx(a.x), ay = toPy(a.z), bx = toPx(b.x), by = toPy(b.z), cx = toPx(c.x), cz = toPy(c.z);
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(res - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cz))), maxY = Math.min(res - 1, Math.ceil(Math.max(ay, by, cz)));
    const area = (bx - ax) * (cz - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-6) return;
    const s = Math.sign(area);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const qx = x + 0.5, qy = y + 0.5;
      const w0 = ((bx - ax) * (qy - ay) - (by - ay) * (qx - ax)) * s;
      const w1 = ((cx - bx) * (qy - by) - (cz - by) * (qx - bx)) * s;
      const w2 = ((ax - cx) * (qy - cz) - (ay - cz) * (qx - cx)) * s;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) facet[y * res + x] = id;
    }
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k00 = j * N1 + i, k10 = k00 + 1, k01 = k00 + N1, k11 = k01 + 1;
    if (hash2(i, j, 13) < 0.5) { facetOf(k00, k01, k11, hash2(i, j, 14)); facetOf(k00, k11, k10, hash2(i, j, 15)); }
    else { facetOf(k00, k01, k10, hash2(i, j, 14)); facetOf(k10, k01, k11, hash2(i, j, 15)); }
  }

  // land from the facets, the shelf in bands; the coastline follows the true height
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = res;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(res, res), d = img.data;
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const k = y * res + x, o = k * 4;
    const h = isl.heightAt(x0 + ((x + 0.5) / res) * size, z0 + ((y + 0.5) / res) * size);
    const f = facet[k];
    if (h > 0.3 && f >= 0) {
      d[o] = colours[f * 3]; d[o + 1] = colours[f * 3 + 1]; d[o + 2] = colours[f * 3 + 2]; d[o + 3] = 255;
      continue;
    }
    for (const [below, col, alpha] of BANDS) {
      if (h > below) { d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = alpha; break; }
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
