import * as THREE from 'three';
import type { Environment } from './environment';

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // keep the dome on the far plane
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uZenith, uHorizon, uHorizonCool, uSunDir, uSunColor, uMoonDir, uSeaFar;
  uniform float uSunVis, uMoonVis, uStars, uCover, uFog;
  varying vec3 vDir;

  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float g = pow(smoothstep(-0.03, 0.65, h), 0.55);
    // the horizon is warm towards the sun and cool away from it
    float az = dot(normalize(d.xz + 1e-5), normalize(uSunDir.xz + 1e-5)) * 0.5 + 0.5;
    vec3 hz = mix(uHorizonCool, uHorizon, smoothstep(0.35, 1.0, az));
    vec3 col = mix(hz, uZenith, g);

    float s = max(dot(d, uSunDir), 0.0);
    float clear = 1.0 - uCover * 0.85;
    // a broad glow round the sun and a tight one at it
    col += uSunColor * (pow(s, 3.0) * 0.45 + pow(s, 48.0) * 0.45) * uSunVis * clear;
    float disc = smoothstep(0.99935, 0.99965, s);
    col = mix(col, uSunColor * 1.6 + 0.4, disc * uSunVis * clear);

    float m = max(dot(d, uMoonDir), 0.0);
    float moon = smoothstep(0.99955, 0.9998, m);
    col = mix(col, vec3(0.92, 0.94, 1.0), moon * uMoonVis * clear);
    col += vec3(0.25, 0.3, 0.45) * pow(m, 32.0) * 0.25 * uMoonVis * clear;

    if (uStars > 0.0 && h > 0.0) {
      vec3 cell = floor(d * 380.0);
      float r = hash(cell);
      float star = step(0.9975, r) * (0.5 + 0.5 * hash(cell + 7.0));
      col += vec3(star) * uStars * smoothstep(0.0, 0.25, h);
    }
    // below the horizon the dome shows the open sea, so the ocean seems endless
    if (h < 0.0) {
      vec3 sea = uSeaFar;
      vec3 r = vec3(d.x, -d.y, d.z);
      float gl = max(dot(r, uSunDir), 0.0);
      sea += uSunColor * (pow(gl, 400.0) * 1.1 + pow(gl, 40.0) * 0.1) * uSunVis * clear;
      col = mix(col, sea, smoothstep(0.0, -0.0007, h));
    }
    // dense fog: the sky dissolves into the fog colour
    col = mix(col, uHorizon, uFog * (1.0 - 0.35 * smoothstep(0.2, 1.0, h)));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Sky {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader, fragmentShader,
      uniforms: {
        uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uHorizonCool: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() },
        uMoonDir: { value: new THREE.Vector3() },
        uSunVis: { value: 1 }, uMoonVis: { value: 0 }, uStars: { value: 0 }, uCover: { value: 0 }, uFog: { value: 0 },
        uSeaFar: { value: new THREE.Color() },
      },
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  update(env: Environment, camera: THREE.Camera) {
    const u = this.mat.uniforms;
    u.uZenith.value.copy(env.zenith);
    u.uHorizon.value.copy(env.horizon);
    u.uHorizonCool.value.copy(env.horizonCool);
    u.uSunDir.value.copy(env.sunDir);
    u.uSunColor.value.copy(env.lightColor);
    u.uMoonDir.value.copy(env.moonDir);
    u.uSunVis.value = env.sunVisible;
    u.uMoonVis.value = env.moonVisible;
    u.uStars.value = env.stars;
    u.uCover.value = env.w.cover * 0.7 + env.w.dark * 0.3;
    u.uFog.value = env.fogAmount;
    u.uSeaFar.value.copy(env.seaFar);
    this.mesh.position.copy(camera.position);
  }
}
