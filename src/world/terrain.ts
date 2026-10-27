import * as THREE from 'three';

/** Objects on this layer are only drawn by the shadow camera. */
export const SHADOW_LAYER = 1;

/** Gameplay slope classes (degrees). The Walrus climbs up to STEEP. */
export const SLOPE = { BUILD: 6, DRIVE: 20, STEEP: 28 };
export const SLOPE_COS = {
  BUILD: Math.cos(THREE.MathUtils.degToRad(SLOPE.BUILD)),
  DRIVE: Math.cos(THREE.MathUtils.degToRad(SLOPE.DRIVE)),
  STEEP: Math.cos(THREE.MathUtils.degToRad(SLOPE.STEEP)),
};

/** debug colours of the drivability overlay (not part of the design palette) */
export const OVERLAY = {
  build: new THREE.Color('#3fbf5f'), drive: new THREE.Color('#e8d24a'),
  steep: new THREE.Color('#ef8a2e'), blocked: new THREE.Color('#d0342c'),
};

/** Anything vehicles can ask about the ground. */
export interface Ground {
  heightAt(x: number, z: number): number;
  /** 0 flat .. 1 vertical (1 - normal.y) */
  slopeAt(x: number, z: number, d?: number): number;
}

export interface TerrainStats {
  landKm2: number;
  build: number; drive: number; steep: number; blocked: number; // shares of land area, 0..1
}

export function slopeFromHeights(ground: Ground, x: number, z: number, d = 4): number {
  const hx = ground.heightAt(x + d, z) - ground.heightAt(x - d, z);
  const hz = ground.heightAt(x, z + d) - ground.heightAt(x, z - d);
  return 1 - (2 * d) / Math.hypot(hx, hz, 2 * d);
}
