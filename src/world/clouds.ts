import * as THREE from 'three';
import { mulberry32 } from '../engine/lowpoly';
import { lerp, smoothstep } from '../engine/noise';
import type { Environment } from './environment';

/**
 * Clouds that never hold a shape: each is a card turning to the camera, its cloud made in the shader from noise that
 * drifts and folds over itself, so it frays at the edges, sheds wisps, is drawn out by the wind and keeps changing
 * (faster in time warp). The light: bright tops, grey undersides that darken where the cloud is thick, and towards
 * the sun a lining along the thin edges (silver by day, golden when it is low). Three layers:
 * - heaps drifting with the wind over the islands, more of them the more cloud there is; under heavy cloud they
 *   become long, low fields;
 * - banks round the horizon that go with the camera like the sky;
 * - under heavy cloud (rain, storm) a ceiling over them: a sheet of the same restless noise, patchy at first, then
 *   closed, dark and cool over a band of light at the horizon.
 */

const AREA = 12000; // the heaps wrap around within this square
/** where a card's cloud has its base (share of the card's height, from below) */
const BASE = 0.12;
/** the banks: how far out round the camera (m), and the ceiling's height over the sea before a storm lowers it */
const BANK_RING = 9000, CEILING_Y = 720;

interface Heap { pos: THREE.Vector3; threshold: number; width: number; seed: number; shade: number }
interface Bank { angle: number; y: number; width: number; flat: number; threshold: number; band: boolean; seed: number; shade: number }
/** a shower: hangs under heap `heap`, shows when there is enough shower weather (above `threshold`) */
interface Shower { heap: number; threshold: number; width: number; seed: number }
/** how many heaps can drop a shower */
const SHOWERS = 24;

/** value noise and fbm with a slight turn per octave (no grid lines), shared by the cards and the ceiling */
const NOISE = /* glsl */ `
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = r * p * 2.02 + 11.7; a *= 0.5; }
    return v;
  }`;

const cardVertex = /* glsl */ `
  attribute vec3 aPos;
  attribute vec2 aSize;
  attribute float aBand, aSeed, aShade;
  uniform vec3 uSunDir;
  varying vec2 vLocal;
  varying float vBand, vSeed, vShade, vFade, vSun;
  #include <fog_pars_vertex>
  void main() {
    // the card turns round its upright axis to the camera, so its base stays level
    vec3 toCam = cameraPosition - aPos;
    vec3 fwd = normalize(toCam);
    vec2 flat2 = length(toCam.xz) > 1e-3 ? normalize(toCam.xz) : vec2(0.0, 1.0);
    vec3 right = vec3(flat2.y, 0.0, -flat2.x);
    // aPos: the middle of the cloud's base
    vec3 world = aPos + right * position.x * aSize.x + vec3(0.0, (position.y + 0.5 - ${BASE.toFixed(3)}) * aSize.y, 0.0);
    vLocal = uv;
    vBand = aBand; vSeed = aSeed; vShade = aShade;
    // a cloud high overhead or close by fades (one never comes right up to a cloud): from below an upright card would
    // show as a sliver, and close up it would fill the picture
    vFade = (1.0 - smoothstep(0.3, 0.55, -fwd.y)) * smoothstep(700.0, 1500.0, length(toCam));
    // how much the camera looks towards the sun through this cloud
    vSun = max(dot(normalize(world - cameraPosition), uSunDir), 0.0);
    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const cardFragment = /* glsl */ `
  uniform float uTime, uRim;
  uniform vec3 uLit, uShadow, uSunColor;
  varying vec2 vLocal;
  varying float vBand, vSeed, vShade, vFade, vSun;
  #include <fog_pars_fragment>
  ${NOISE}
  void main() {
    // x -1..1 across the card, y 0 at the cloud's base, 1 at the card's top (the card is twice as wide as high)
    vec2 q = vec2(vLocal.x * 2.0 - 1.0, (vLocal.y - ${BASE.toFixed(3)}) / ${(1 - BASE).toFixed(3)});
    bool band = vBand > 0.5;
    // drawn out by the wind (bands more), and the noise folding over itself as it drifts: the shape keeps changing
    vec2 s = vec2(q.x * (band ? 3.2 : 1.7), q.y * (band ? 1.6 : 2.2)) + vSeed;
    vec2 warp = vec2(fbm(s * 0.7 + vec2(uTime * 0.011, 3.1)), fbm(s * 0.7 + vec2(7.4, uTime * 0.009)));
    float n = fbm(s * 1.5 + warp * 2.2 + vec2(uTime * 0.018, 0.0));
    // the envelope: a heap a low, lopsided mound leaning with the wind, a band a long streak tapering at both ends;
    // the noise eats into both
    // (both stay well inside the card, so its edges never cut them)
    float env = band
      ? 1.0 - length(vec2(q.x * 1.35, (q.y - 0.18) * 3.6))
      : 1.0 - length(vec2(q.x * (1.4 + 0.25 * sin(vSeed)) - q.y * 0.25 * sin(vSeed * 1.7), (q.y - 0.25) * 1.8));
    // the base is fairly level but ragged, and shreds hang below it
    float base = smoothstep(-0.12, 0.1, q.y + (n - 0.5) * 0.35);
    // (the noise only works near the envelope, and everything thins out before the card's edges: no straight cuts)
    float edge = (1.0 - smoothstep(0.7, 0.97, abs(q.x))) * (1.0 - smoothstep(0.75, 0.97, q.y));
    float density = (env * 1.05 + (n - 0.52) * 1.8 * smoothstep(-0.35, 0.2, env)) * base * edge;
    float a = smoothstep(0.05, 0.55, density);
    if (a * vFade < 0.01) discard;
    // light from above; thick and low is darker, and the noise gives it lumps and streaks
    float light = 0.35 + 0.55 * smoothstep(-0.1, 0.85, q.y) + (n - 0.5) * 0.7;
    light = clamp(light - smoothstep(0.45, 1.3, density) * 0.3, 0.0, 1.0);
    vec3 col = mix(uShadow, uLit, light * vShade);
    // towards the sun its thin edges glow (a silver, at dusk a golden lining) and the whole cloud warms a little
    float thin = 1.0 - smoothstep(0.05, 0.6, density);
    col += uSunColor * uRim * (thin * pow(vSun, 3.0) * 0.9 + light * pow(vSun, 8.0) * 0.25);
    gl_FragColor = vec4(col, a * vFade);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

// a rain shaft under a cloud: a curtain from its base down to the sea, falling streaks drawn slanting by the wind,
// thickest just under the cloud, its sides ragged and changing
const showerVertex = /* glsl */ `
  attribute vec3 aPos;
  attribute vec2 aSize;
  attribute float aSeed, aShade;
  uniform vec2 uWind;
  varying vec2 vLocal;
  varying float vSeed, vFade, vSlant, vAmount;
  #include <fog_pars_vertex>
  void main() {
    vec3 toCam = cameraPosition - aPos;
    vec2 flat2 = length(toCam.xz) > 1e-3 ? normalize(toCam.xz) : vec2(0.0, 1.0);
    vec3 right = vec3(flat2.y, 0.0, -flat2.x);
    // aPos: the curtain's middle; it reaches from the cloud's base down to below the sea's surface
    vec3 world = aPos + right * position.x * aSize.x + vec3(0.0, position.y * aSize.y, 0.0);
    vLocal = uv;
    vSeed = aSeed; vAmount = aShade;
    // the wind across the view slants the rain (the curtain's foot lies downwind)
    vSlant = clamp(dot(uWind, right.xz) / 40.0, -0.6, 0.6);
    // only far off: close by the rain is the rain round the camera
    vFade = smoothstep(1500.0, 3000.0, length(toCam.xz));
    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const showerFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vLocal;
  varying float vSeed, vFade, vSlant, vAmount;
  #include <fog_pars_fragment>
  ${NOISE}
  void main() {
    // x -1..1 across, y 0 at the foot .. 1 at the cloud
    float y = vLocal.y;
    float x = vLocal.x * 2.0 - 1.0 + vSlant * (1.0 - y);
    // the column wanders and frays at its sides
    float wander = (fbm(vec2(y * 1.8 + vSeed, uTime * 0.01)) - 0.5) * 0.7;
    float body = 1.0 - smoothstep(0.15, 0.95, abs(x - wander));
    // a veil with soft falling streaks
    float streak = fbm(vec2(x * 5.0 + vSeed * 3.0, y * 0.7 + uTime * 0.1));
    // thickest just under the cloud, thinner towards the sea, soft where it meets the cloud
    float a = body * (0.55 + 0.45 * smoothstep(0.3, 0.7, streak)) * (0.5 + 0.5 * smoothstep(0.0, 0.7, y))
      * (1.0 - smoothstep(0.85, 1.0, y)) * vAmount * vFade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

const ceilingVertex = /* glsl */ `
  varying vec2 vXZ;
  #include <fog_pars_vertex>
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vXZ = w.xz;
    vec4 mvPosition = viewMatrix * w;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const ceilingFragment = /* glsl */ `
  uniform vec2 uDrift;
  uniform float uAmount, uTime;
  uniform vec3 uLit, uShadow;
  varying vec2 vXZ;
  #include <fog_pars_fragment>
  ${NOISE}
  void main() {
    // restless masses in the world, drifting with the wind and folding over themselves; the more cloud, the lower the
    // bar they have to clear
    vec2 p = (vXZ - uDrift) / 2400.0;
    vec2 warp = vec2(fbm(p * 0.8 + vec2(uTime * 0.006, 1.3)), fbm(p * 0.8 + vec2(4.7, uTime * 0.005)));
    float d = fbm(p + warp * 1.6);
    float bar = mix(0.7, 0.22, uAmount);
    float a = smoothstep(bar, bar + 0.16, d) * smoothstep(0.0, 0.3, uAmount);
    if (a < 0.01) discard;
    // thicker is darker underneath
    vec3 col = mix(uLit, uShadow, smoothstep(bar + 0.06, bar + 0.3, d));
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

/** a set of cards with their per-card attributes */
function cards(count: number, mat: THREE.ShaderMaterial) {
  const plane = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = plane.index;
  g.setAttribute('position', plane.getAttribute('position'));
  g.setAttribute('uv', plane.getAttribute('uv'));
  const pos = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const size = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2);
  const band = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  const seed = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  const shade = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  pos.setUsage(THREE.DynamicDrawUsage); size.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aPos', pos); g.setAttribute('aSize', size); g.setAttribute('aBand', band);
  g.setAttribute('aSeed', seed); g.setAttribute('aShade', shade);
  g.instanceCount = count;
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  return { mesh, pos, size, band, seed, shade };
}

export class Clouds {
  readonly mesh = new THREE.Group();
  private heaps: Heap[] = [];
  private banks: Bank[] = [];
  private heapCards: ReturnType<typeof cards>;
  private bankCards: ReturnType<typeof cards>;
  private cardMat: THREE.ShaderMaterial;
  private ceilingMat: THREE.ShaderMaterial;
  private ceiling: THREE.Mesh;
  private drift = new THREE.Vector2();
  private fields = false;
  private lit = new THREE.Color();
  private shadow = new THREE.Color();
  private tint = new THREE.Color();
  private cool = new THREE.Color();
  private showers: Shower[] = [];
  private showerCards: ReturnType<typeof cards>;
  private showerMat: THREE.ShaderMaterial;

  constructor(count = 90, seed = 9) {
    const rnd = mulberry32(seed);
    for (let c = 0; c < count; c++) {
      this.heaps.push({
        pos: new THREE.Vector3((rnd() - 0.5) * AREA, 430 + rnd() * 260, (rnd() - 0.5) * AREA),
        threshold: rnd(), width: 700 + rnd() * 900, seed: rnd() * 100, shade: 0.9 + rnd() * 0.1,
      });
    }
    for (let i = 0; i < SHOWERS; i++) {
      this.showers.push({ heap: Math.floor(rnd() * count), threshold: rnd() * 0.85, width: 0.5 + rnd() * 0.4, seed: rnd() * 100 });
    }
    for (let i = 0; i < 16; i++) {
      this.banks.push({
        angle: (i + rnd() * 0.8) / 16 * Math.PI * 2, y: 20 + rnd() * 160, width: 2600 + rnd() * 3200, flat: 0.55 + rnd() * 0.3,
        threshold: rnd() * 0.9, band: rnd() < 0.6, seed: rnd() * 100, shade: 0.88 + rnd() * 0.12,
      });
    }
    this.cardMat = new THREE.ShaderMaterial({
      vertexShader: cardVertex, fragmentShader: cardFragment, transparent: true, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 }, uLit: { value: new THREE.Color() }, uShadow: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uRim: { value: 0 },
      }]),
    });
    this.ceilingMat = new THREE.ShaderMaterial({
      vertexShader: ceilingVertex, fragmentShader: ceilingFragment, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uDrift: { value: new THREE.Vector2() }, uAmount: { value: 0 }, uTime: { value: 0 },
        uLit: { value: new THREE.Color() }, uShadow: { value: new THREE.Color() },
      }]),
    });
    // the ceiling first (it is the highest), then the banks far out, then the heaps
    this.ceiling = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2), this.ceilingMat);
    this.ceiling.frustumCulled = false;
    this.ceiling.renderOrder = 1;
    this.bankCards = cards(this.banks.length, this.cardMat);
    this.bankCards.mesh.renderOrder = 2;
    this.heapCards = cards(this.heaps.length, this.cardMat);
    this.heapCards.mesh.renderOrder = 3;
    // the showers under the heaps (drawn before them)
    this.showerMat = new THREE.ShaderMaterial({
      vertexShader: showerVertex, fragmentShader: showerFragment, transparent: true, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 }, uWind: { value: new THREE.Vector2() }, uColor: { value: new THREE.Color() },
      }]),
    });
    this.showerCards = cards(SHOWERS, this.showerMat);
    this.showerCards.mesh.renderOrder = 2.5;
    this.showers.forEach((s, i) => this.showerCards.seed.setX(i, s.seed));
    this.banks.forEach((b, i) => { this.bankCards.band.setX(i, b.band ? 1 : 0); this.bankCards.seed.setX(i, b.seed); this.bankCards.shade.setX(i, b.shade); });
    this.heaps.forEach((h, i) => { this.heapCards.seed.setX(i, h.seed); this.heapCards.shade.setX(i, h.shade); });
    this.mesh.add(this.ceiling, this.bankCards.mesh, this.showerCards.mesh, this.heapCards.mesh);
    this.mesh.name = 'clouds';
  }

  update(env: Environment, dt: number, focus: THREE.Vector3) {
    const w = env.w;
    this.drift.x += dt * env.windX;
    this.drift.y += dt * env.windZ;
    const cover = Math.min(1, w.cover);
    const lower = w.dark * 170;
    // in a storm the heaps close into one low deck: wider and flatter, so they run together
    const deck = smoothstep(0.4, 0.8, w.dark);
    const wide = 1 + deck * 1.3, flat = 1 - deck * 0.5;
    const wrap = (v: number, f: number) => f + ((((v - f + AREA / 2) % AREA) + AREA) % AREA) - AREA / 2;
    const hc = this.heapCards;
    // (under heavy cloud they are long, low fields instead of heaps)
    const fields = deck > 0.5;
    if (fields !== this.fields) {
      this.fields = fields;
      this.heaps.forEach((_, i) => hc.band.setX(i, fields ? 1 : 0));
      hc.band.needsUpdate = true;
    }
    this.heaps.forEach((h, i) => {
      const vis = smoothstep(h.threshold - 0.12, h.threshold + 0.02, cover);
      const size = h.width * (0.75 + w.dark * 0.8) * vis * wide;
      hc.pos.setXYZ(i, wrap(h.pos.x + this.drift.x, focus.x), h.pos.y - lower, wrap(h.pos.z + this.drift.y, focus.z));
      hc.size.setXY(i, Math.max(size, 0.001), Math.max(size * 0.5 * flat, 0.001));
    });
    hc.pos.needsUpdate = true; hc.size.needsUpdate = true;
    // the banks stand round the camera like the sky
    const bc = this.bankCards;
    this.banks.forEach((b, i) => {
      const vis = smoothstep(b.threshold - 0.15, b.threshold + 0.05, cover);
      bc.pos.setXYZ(i, focus.x + Math.cos(b.angle) * BANK_RING, b.y, focus.z + Math.sin(b.angle) * BANK_RING);
      bc.size.setXY(i, Math.max(b.width * vis, 0.001), Math.max(b.width * 0.5 * b.flat * vis, 0.001));
    });
    bc.pos.needsUpdate = true; bc.size.needsUpdate = true;
    // showers under some of the heaps: with dense cloud a few far off, in rain and storm more and heavier
    const shower = smoothstep(0.72, 0.9, cover) * (0.45 + 0.55 * smoothstep(0.1, 0.6, w.rain));
    const sc = this.showerCards;
    this.showers.forEach((s, i) => {
      const h = this.heaps[s.heap], hv = smoothstep(h.threshold - 0.12, h.threshold + 0.02, cover);
      const on = smoothstep(s.threshold, s.threshold + 0.15, shower) * hv;
      const base = h.pos.y - lower;
      sc.pos.setXYZ(i, wrap(h.pos.x + this.drift.x, focus.x), base / 2 - 15, wrap(h.pos.z + this.drift.y, focus.z));
      sc.size.setXY(i, Math.max(h.width * (0.75 + w.dark * 0.8) * wide * s.width * on, 0.001), base + 30);
      sc.shade.setX(i, on * lerp(0.7, 0.9, w.rain));
    });
    sc.pos.needsUpdate = true; sc.size.needsUpdate = true; sc.shade.needsUpdate = true;
    // the light on them: the sun's colour (warm at dawn and dusk, less of it under heavy cloud), dim at night; the
    // undersides take the sky's colour
    const day = env.dayness();
    this.tint.copy(WHITE).lerp(env.lightColor, 0.6 * (1 - w.dark));
    this.lit.copy(env.cloudColor).multiply(this.tint).multiplyScalar(lerp(0.16, 1, Math.sqrt(day)) * lerp(1, 0.8, w.dark));
    // (under heavy cloud they take the cool grey of the sky overhead, not the warm horizon's colour)
    this.lit.lerp(this.cool.copy(env.zenith).multiplyScalar(1.15), 0.6 * deck);
    this.shadow.copy(this.lit).multiplyScalar(0.62).lerp(env.zenith, 0.22 * (1 - w.dark));
    const u = this.cardMat.uniforms;
    u.uTime.value = env.elapsed;
    // the showers in the grey of the clouds' undersides
    const su = this.showerMat.uniforms;
    su.uTime.value = env.elapsed;
    su.uWind.value.set(env.windX, env.windZ);
    su.uColor.value.copy(this.shadow).multiplyScalar(0.8);
    u.uLit.value.copy(this.lit);
    u.uShadow.value.copy(this.shadow);
    // the linings: only with the sun up and seen, strongest when it is low, faint under heavy cloud
    u.uSunDir.value.copy(env.sunDir);
    u.uSunColor.value.copy(env.lightColor);
    u.uRim.value = env.sunVisible * (1 - 0.8 * w.dark) * lerp(1.3, 0.6, smoothstep(0.05, 0.6, env.sunDir.y));
    // the ceiling: from patchy to closed as the cloud gets heavy and dark, in the cool grey of the sky overhead,
    // darker in its thick parts (over the light band at the horizon)
    const cu = this.ceilingMat.uniforms;
    cu.uAmount.value = smoothstep(0.42, 0.7, w.dark) * smoothstep(0.8, 0.95, cover);
    cu.uTime.value = env.elapsed;
    cu.uDrift.value.copy(this.drift);
    cu.uLit.value.copy(env.zenith);
    cu.uShadow.value.copy(env.zenith).multiplyScalar(0.66);
    this.ceiling.position.set(focus.x, CEILING_Y - lower, focus.z);
    this.ceiling.visible = cu.uAmount.value > 0.01;
  }
}

const WHITE = new THREE.Color(1, 1, 1);
