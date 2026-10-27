import * as THREE from 'three';
import { mulberry32 } from '../engine/lowpoly';
import { smoothstep } from '../engine/noise';
import type { Environment } from './environment';

interface Blob { cluster: number; offset: THREE.Vector3; scale: THREE.Vector3; rotY: number }
interface Cluster { pos: THREE.Vector3; threshold: number; size: number }

const AREA = 12000; // clouds wrap around within this square

export class Clouds {
  readonly mesh: THREE.InstancedMesh;
  private blobs: Blob[] = [];
  private clusters: Cluster[] = [];
  private mat: THREE.MeshLambertMaterial;
  private drift = new THREE.Vector2();
  private tmp = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(count = 90, seed = 9) {
    const rnd = mulberry32(seed);
    for (let c = 0; c < count; c++) {
      const cl: Cluster = {
        pos: new THREE.Vector3((rnd() - 0.5) * AREA, 430 + rnd() * 260, (rnd() - 0.5) * AREA),
        threshold: rnd(),
        size: 0.7 + rnd() * 0.8,
      };
      this.clusters.push(cl);
      const blobs = 5 + Math.floor(rnd() * 8);
      const len = 140 + rnd() * 220;
      for (let k = 0; k < blobs; k++) {
        const along = (k / (blobs - 1) - 0.5) * len;
        const bulge = 1 - Math.abs(along) / len;
        this.blobs.push({
          cluster: c,
          offset: new THREE.Vector3(along, (rnd() - 0.3) * 25 * bulge, (rnd() - 0.5) * 70),
          scale: new THREE.Vector3(40 + rnd() * 45, 18 + bulge * 30 + rnd() * 12, 32 + rnd() * 40),
          rotY: rnd() * Math.PI,
        });
      }
    }
    this.mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.mat, this.blobs.length);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'clouds';
  }

  update(env: Environment, dt: number, focus: THREE.Vector3) {
    const w = env.w;
    this.drift.x += dt * env.windX;
    this.drift.y += dt * env.windZ;
    const cover = Math.min(1, w.cover);
    const lower = w.dark * 170;
    // in a storm the clouds close into one low deck: wider and flatter, so they run together, and lit more like the
    // overcast round them (no dark lumps against a pale sky, which read as floating stones)
    const deck = smoothstep(0.4, 0.8, w.dark);
    const wide = 1 + deck * 1.3, flat = 1 - deck * 0.35;
    this.blobs.forEach((b, i) => {
      const cl = this.clusters[b.cluster];
      const vis = smoothstep(cl.threshold - 0.12, cl.threshold + 0.02, cover);
      const grow = cl.size * (0.6 + w.dark * 1.7) * vis;
      // wrap cluster positions around the focus so clouds never run out
      const wrap = (v: number, f: number) => f + ((((v - f + AREA / 2) % AREA) + AREA) % AREA) - AREA / 2;
      const cx = wrap(cl.pos.x + this.drift.x, focus.x);
      const cz = wrap(cl.pos.z + this.drift.y, focus.z);
      this.p.set(cx + b.offset.x * cl.size, cl.pos.y - lower + b.offset.y * cl.size, cz + b.offset.z * cl.size);
      this.s.copy(b.scale).multiplyScalar(Math.max(grow, 0.0001));
      this.s.x *= wide; this.s.z *= wide; this.s.y *= flat;
      this.q.setFromAxisAngle(this.up, b.rotY);
      this.tmp.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.tmp);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mat.color.copy(env.cloudColor);
    this.mat.emissive.copy(env.horizon).multiplyScalar(0.22 + w.dark * 0.1 + deck * 0.3);
  }
}
