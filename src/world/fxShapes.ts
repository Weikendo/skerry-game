import * as THREE from 'three';

/**
 * Low-poly shapes for glowing combat effects, drawn additively: their vertex colours say how bright each part
 * is (black adds nothing), each instance gives the colour. They point along +z.
 */

/** an additive material for these shapes: no depth writes, no fog (the glow fades with distance by its colour) */
export function additiveMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
}

/**
 * A spindle for a shot: a short point ahead (z 0 .. +nose), full width at z = 0, tapering back to a point at
 * z = -1. `tail` is the brightness at the back (0: it fades out, for the glow round a bolt).
 */
export function spindle(sides = 6, nose = 0.06, tail = 0.6): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [];
  const ring = (i: number): [number, number] => [Math.cos(i / sides * Math.PI * 2), Math.sin(i / sides * Math.PI * 2)];
  const v = (x: number, y: number, z: number, c: number) => { pos.push(x, y, z); col.push(c, c, c); };
  for (let i = 0; i < sides; i++) {
    const [ax, ay] = ring(i), [bx, by] = ring(i + 1);
    // nose
    v(0, 0, nose, 1); v(ax, ay, 0, 1); v(bx, by, 0, 1);
    // body back to the tail
    v(ax, ay, 0, 1); v(0, 0, -1, tail); v(bx, by, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/**
 * A star burst for a muzzle flash: a cone of flame forward (+z, length 1) with a flat ring of points round its
 * base, bright in the middle and dark at the tips.
 */
export function star(points = 6): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [];
  const v = (x: number, y: number, z: number, c: number) => { pos.push(x, y, z); col.push(c, c, c); };
  for (let i = 0; i < points; i++) {
    const a0 = i / points * Math.PI * 2, a1 = (i + 0.5) / points * Math.PI * 2, a2 = (i + 1) / points * Math.PI * 2;
    // the forward cone
    v(Math.cos(a0) * 0.22, Math.sin(a0) * 0.22, 0, 1); v(Math.cos(a2) * 0.22, Math.sin(a2) * 0.22, 0, 1); v(0, 0, 1, 0);
    // a point of the ring, sideways
    v(Math.cos(a0) * 0.18, Math.sin(a0) * 0.18, 0.02, 1); v(Math.cos(a1) * 0.55, Math.sin(a1) * 0.55, 0.05, 0); v(Math.cos(a2) * 0.18, Math.sin(a2) * 0.18, 0.02, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** how much of a glow is left at `p` in the fog (1 near, 0 beyond the fog's far end) */
export function fogFade(p: THREE.Vector3, camera: THREE.Camera, fog: THREE.Fog | null): number {
  if (!fog) return 1;
  const d = p.distanceTo(camera.position);
  return 1 - THREE.MathUtils.smoothstep(d, fog.near, fog.far);
}
