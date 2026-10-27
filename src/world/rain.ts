import * as THREE from 'three';
import { mulberry32 } from '../engine/lowpoly';
import { PAL } from '../engine/palette';
import type { Environment } from './environment';

/** the two layers: close streaks round the camera, and further out longer, fainter ones so the rain shows over the
 *  sea and in front of the ship (the far layer leaves the close range to the near one) */
const LAYERS = [
  { box: new THREE.Vector3(160, 90, 160), drops: 9000, len: 1.6, width: 1.5, alpha: 0.6, far: 0 },
  { box: new THREE.Vector3(900, 300, 900), drops: 16000, len: 4.5, width: 1.1, alpha: 0.4, far: 1 },
];

/**
 * Rain streaks in boxes that travel with the camera; animated in the shader. The drops stay where they are in the
 * world while the camera moves through them, and each streak lies along the way it moves as the camera sees it: from
 * a fast aircraft the rain comes at it from where it flies to. The streaks are thin bands a fixed number of pixels
 * wide (plain lines are one device pixel, too fine to see on a sharp screen).
 */
export class Rain {
  readonly mesh = new THREE.Group();
  private mats: THREE.ShaderMaterial[] = [];

  constructor() {
    const rnd = mulberry32(21);
    for (const layer of LAYERS) {
      const n = layer.drops;
      const offset = new Float32Array(n * 4 * 3), end = new Float32Array(n * 4), side = new Float32Array(n * 4);
      const index = new Uint32Array(n * 6);
      for (let i = 0; i < n; i++) {
        const x = rnd() * layer.box.x, y = rnd() * layer.box.y, z = rnd() * layer.box.z;
        for (let k = 0; k < 4; k++) {
          offset.set([x, y, z], (i * 4 + k) * 3);
          end[i * 4 + k] = k >> 1;
          side[i * 4 + k] = k & 1 ? 1 : -1;
        }
        index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(offset, 3));
      g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
      g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
      g.setIndex(new THREE.BufferAttribute(index, 1));
      const mat = new THREE.ShaderMaterial({
        // (the bands are built on the screen and may face either way)
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: layer.box },
          uWind: { value: new THREE.Vector2() }, uVel: { value: new THREE.Vector3() }, uOpacity: { value: 0 },
          uColor: { value: new THREE.Color(PAL.regen) }, uLen: { value: layer.len }, uFar: { value: layer.far },
          uWidth: { value: layer.width }, uPx: { value: new THREE.Vector2(1e-3, 1e-3) },
        },
        vertexShader: /* glsl */ `
          attribute float aEnd, aSide;
          uniform float uTime, uLen, uFar, uWidth; uniform vec3 uCam, uBox, uVel; uniform vec2 uWind, uPx;
          varying float vEnd, vSide, vFade;
          void main() {
            vec3 p = position;
            p.y = mod(p.y - uTime * 38.0 - uCam.y, uBox.y);
            p.xz = mod(p.xz + uWind * uTime * 0.5 - uCam.xz, uBox.xz);
            vec3 world = uCam + p - uBox * 0.5;
            world.y = uCam.y + p.y - uBox.y * 0.45;
            // the streak: down the wind to a camera standing still, longer and turned towards a moving one
            vec3 still = vec3(uWind.x * 0.04, -1.0, uWind.y * 0.04) * 38.0, seen = still - uVel;
            vec3 along = normalize(seen) * uLen * clamp(length(seen) / length(still), 1.0, 5.0);
            vec4 a = projectionMatrix * viewMatrix * vec4(world, 1.0);
            vec4 b = projectionMatrix * viewMatrix * vec4(world + along, 1.0);
            vEnd = aEnd; vSide = aSide;
            vFade = uFar > 0.5 ? smoothstep(60.0, 110.0, distance(world, uCam)) : 1.0;
            // (a streak reaching behind the camera is left out)
            if (a.w < 0.5 || b.w < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
            // widen it on the screen, uWidth pixels across and half that past each end (so one coming
            // head-on still shows as a dot)
            vec2 d = (b.xy / b.w - a.xy / a.w) / uPx;
            vec2 t = length(d) > 1e-3 ? normalize(d) : vec2(0.0, 1.0);
            vec4 c = aEnd > 0.5 ? b : a;
            c.xy += (vec2(-t.y, t.x) * aSide + t * (aEnd * 2.0 - 1.0)) * uPx * uWidth * 0.5 * c.w;
            gl_Position = c;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uOpacity; uniform vec3 uColor;
          varying float vEnd, vSide, vFade;
          void main() { gl_FragColor = vec4(uColor, uOpacity * (0.35 + 0.65 * vEnd) * (1.0 - vSide * vSide) * vFade); }`,
      });
      const m = new THREE.Mesh(g, mat);
      m.frustumCulled = false;
      this.mesh.add(m);
      this.mats.push(mat);
    }
    this.mesh.name = 'rain';
  }

  /** the camera's velocity through the rain, eased (a cut to another camera is no speed) */
  private camVel = new THREE.Vector3();
  private lastCam = new THREE.Vector3();
  private lastT = -1;

  /** `buffer`: the drawing buffer's size, `ratio` its device pixels per CSS pixel (the streaks' width) */
  update(env: Environment, camera: THREE.Camera, buffer: THREE.Vector2, ratio: number) {
    const dt = env.elapsed - this.lastT;
    if (this.lastT >= 0 && dt > 0) {
      const v = this.lastCam.sub(camera.position).divideScalar(-dt);
      if (v.length() < 400) this.camVel.lerp(v, Math.min(1, dt * 8));
    }
    this.lastT = env.elapsed;
    this.lastCam.copy(camera.position);
    this.mats.forEach((mat, i) => {
      const u = mat.uniforms;
      u.uVel.value.copy(this.camVel);
      u.uTime.value = env.elapsed;
      u.uCam.value.copy(camera.position);
      u.uWind.value.set(env.windX, env.windZ);
      u.uOpacity.value = env.w.rain * LAYERS[i].alpha;
      u.uColor.value.set(PAL.regen).multiplyScalar(0.4 + 0.6 * env.dayness());
      u.uPx.value.set(2 / Math.max(1, buffer.x), 2 / Math.max(1, buffer.y));
      u.uWidth.value = LAYERS[i].width * ratio;
    });
    this.mesh.visible = env.w.rain > 0.02;
  }
}
