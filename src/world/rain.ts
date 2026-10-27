import * as THREE from 'three';
import { mulberry32 } from '../engine/lowpoly';
import { PAL } from '../engine/palette';
import type { Environment } from './environment';

const BOX = new THREE.Vector3(160, 90, 160);

/** Rain streaks in a box that travels with the camera; animated in the shader. */
export class Rain {
  readonly mesh: THREE.LineSegments;
  private mat: THREE.ShaderMaterial;

  constructor(drops = 9000) {
    const rnd = mulberry32(21);
    const offset = new Float32Array(drops * 2 * 3);
    const end = new Float32Array(drops * 2);
    for (let i = 0; i < drops; i++) {
      const x = rnd() * BOX.x, y = rnd() * BOX.y, z = rnd() * BOX.z;
      for (let k = 0; k < 2; k++) {
        offset.set([x, y, z], (i * 2 + k) * 3);
        end[i * 2 + k] = k;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(offset, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: BOX },
        uWind: { value: new THREE.Vector2() }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(PAL.regen) },
      },
      vertexShader: /* glsl */ `
        attribute float aEnd;
        uniform float uTime; uniform vec3 uCam, uBox; uniform vec2 uWind;
        varying float vEnd;
        void main() {
          vec3 p = position;
          p.y = mod(p.y - uTime * 38.0, uBox.y);
          p.xz = mod(p.xz + uWind * uTime * 0.5 - uCam.xz, uBox.xz);
          vec3 world = uCam + p - uBox * 0.5;
          world.y = uCam.y + p.y - uBox.y * 0.45;
          vec3 dir = normalize(vec3(uWind.x * 0.04, -1.0, uWind.y * 0.04));
          world += dir * aEnd * 1.6;
          vEnd = aEnd;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity; uniform vec3 uColor;
        varying float vEnd;
        void main() { gl_FragColor = vec4(uColor, uOpacity * (0.35 + 0.65 * vEnd)); }`,
    });
    this.mesh = new THREE.LineSegments(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'rain';
  }

  update(env: Environment, camera: THREE.Camera) {
    const u = this.mat.uniforms;
    u.uTime.value = env.elapsed;
    u.uCam.value.copy(camera.position);
    u.uWind.value.set(env.windX, env.windZ);
    u.uOpacity.value = env.w.rain * 0.55;
    u.uColor.value.set(PAL.regen).multiplyScalar(0.4 + 0.6 * env.dayness());
    this.mesh.visible = env.w.rain > 0.02;
  }
}
