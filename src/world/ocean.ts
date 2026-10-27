import * as THREE from 'three';
import { PAL } from '../engine/palette';
import type { Environment } from './environment';
import { MAX_ISLANDS, type Archipelago } from './archipelago';
import { DEPTH_MIN, DEPTH_RANGE } from './island';
import { WAKE_RES } from './wakefield';

// Must match the GLSL wave function below (used for buoyancy).
const WAVES: [number, number, number, number][] = [
  // amp, kx, kz, speed
  [0.55, 0.021, 0.013, 0.82],
  [0.35, -0.016, 0.027, 1.07],
  [0.22, 0.043, -0.031, 1.61],
  [0.12, -0.067, -0.052, 2.23],
  [0.09, 0.19, 0.15, 3.1],
  [0.07, -0.23, 0.17, 3.7],
];

export function waveHeight(x: number, z: number, t: number, amp: number): number {
  let h = 0;
  for (const [a, kx, kz, s] of WAVES) h += a * Math.sin(kx * x + kz * z + t * s);
  return h * amp;
}

const GLSL_WAVES = WAVES.map(([a, kx, kz, s]) =>
  `h += ${a.toFixed(3)} * sin(dot(p, vec2(${kx.toFixed(3)}, ${kz.toFixed(3)})) + t * ${s.toFixed(3)});`).join('\n');

// ground height (x) and ice flag (y) from the archipelago depth atlas
const LOOKUP = /* glsl */ `
  uniform sampler2D uDepthTex;
  uniform vec4 uIslandBounds[${MAX_ISLANDS}];
  uniform vec4 uIslandTiles[${MAX_ISLANDS}];
  vec2 groundInfo(vec2 xz) {
    vec2 r = vec2(${DEPTH_MIN.toFixed(1)}, 0.0);
    for (int i = 0; i < ${MAX_ISLANDS}; i++) {
      vec2 duv = (xz - uIslandBounds[i].xy) / uIslandBounds[i].zw;
      if (duv.x > 0.0 && duv.y > 0.0 && duv.x < 1.0 && duv.y < 1.0) {
        vec4 t = texture2D(uDepthTex, uIslandTiles[i].xy + duv * uIslandTiles[i].zw);
        r = vec2(t.r * ${DEPTH_RANGE.toFixed(1)} + ${DEPTH_MIN.toFixed(1)}, t.g);
      }
    }
    return r;
  }`;

/**
 * The two looks of the sea, chosen in the settings. Each has its own grid: cells of constant size near the camera
 * (`cell` metres, `uniform` cells from the centre), growing towards the edge `half` cells out (≈ 21–24 km, beyond
 * the camera's far plane).
 *   mosaik  the title picture's sea: big facets, each with its own shade from navy to turquoise, light towards the horizon
 *   linien  the Wind Waker sea from before: a fine grid, white cell lines wandering over it
 */
export type SeaStyle = 'mosaik' | 'linien';
const GRIDS: Record<SeaStyle, { cell: number; uniform: number; half: number }> = {
  mosaik: { cell: 14, uniform: 90, half: 150 },
  linien: { cell: 6, uniform: 70, half: 150 },
};
const GROWTH = 1.07;

function warp(i: number, cell: number, uniform: number): number {
  const a = Math.abs(i);
  if (a <= uniform) return i * cell;
  const k = a - uniform;
  const extra = cell * (Math.pow(GROWTH, k + 1) - GROWTH) / (GROWTH - 1);
  return Math.sign(i) * (uniform * cell + extra);
}

export class Ocean {
  /** both seas; only the chosen one is visible */
  readonly mesh = new THREE.Group();
  private readonly seas: Record<SeaStyle, THREE.Mesh>;
  readonly uniforms = {
    uTime: { value: 0 },
    uAmp: { value: 1 },
    uDepthTex: { value: null as THREE.Texture | null },
    uIslandBounds: { value: [] as THREE.Vector4[] },
    uIslandTiles: { value: [] as THREE.Vector4[] },
    uIce: { value: new THREE.Color(PAL.eis) },
    uIceDark: { value: new THREE.Color(PAL.eisDunkel) },
    uShallow: { value: new THREE.Color(PAL.wasserFlach) },
    uMid: { value: new THREE.Color(PAL.wasserMittel) },
    uDeep: { value: new THREE.Color(PAL.wasserTief) },
    uFoam: { value: new THREE.Color(PAL.gischt) },
    uStormCol: { value: new THREE.Color(PAL.wasserSturm) },
    uStormLine: { value: new THREE.Color(PAL.gischtSturm) },
    uStorm: { value: 0 },
    /** weather darkening of the sea, 0..1 */
    uSea: { value: 0 },
    /** Wind Waker cell lines on the open sea, 0 = off */
    uToon: { value: 1 },
    // the mosaic's shades, and the sun's direction over the water (which way the lit facets face)
    uNavy: { value: new THREE.Color(PAL.wasserMarine) },
    uPetrol: { value: new THREE.Color(PAL.wasserPetrol) },
    uTeal: { value: new THREE.Color(PAL.wasserTeal) },
    uTurq: { value: new THREE.Color(PAL.wasserTuerkis) },
    uGlanz: { value: new THREE.Color(PAL.wasserGlanz) },
    uSunXZ: { value: new THREE.Vector2(1, 0) },
    uSeaFar: { value: new THREE.Color() },
    uWakeTex: { value: null as THREE.Texture | null },
    uWakeRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uSeaFogNear: { value: 1000 },
    uSeaFogFar: { value: 10000 },
  };

  constructor(world: Archipelago, style: SeaStyle = 'mosaik') {
    this.uniforms.uDepthTex.value = world.depthTexture;
    this.uniforms.uIslandBounds.value = world.bounds;
    this.uniforms.uIslandTiles.value = world.tiles;
    this.seas = { mosaik: this.build('mosaik'), linien: this.build('linien') };
    this.mesh.add(this.seas.mosaik, this.seas.linien);
    this.mesh.name = 'ocean';
    this.setStyle(style);
  }

  /** show one of the two seas (both are built, so switching costs nothing) */
  setStyle(style: SeaStyle) {
    this.seas.mosaik.visible = style === 'mosaik';
    this.seas.linien.visible = style === 'linien';
  }

  private build(style: SeaStyle): THREE.Mesh {
    const { cell: CELL, uniform: UNIFORM, half: HALF } = GRIDS[style];
    const mosaic = style === 'mosaik';
    const n = HALF * 2;
    const pos = new Float32Array((n + 1) * (n + 1) * 3);
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const k = (j * (n + 1) + i) * 3;
      pos[k] = warp(i - HALF, CELL, UNIFORM); pos[k + 1] = 0; pos[k + 2] = warp(j - HALF, CELL, UNIFORM);
    }
    const idx: number[] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      if ((i + j) % 2) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);

    // the mosaic's sun path is narrower and more golden
    const mat = new THREE.MeshPhongMaterial({
      color: 0xffffff, flatShading: true, shininess: mosaic ? 70 : 40, specular: new THREE.Color(mosaic ? '#8a7a5a' : '#4f6670'),
      fog: false, // own fog towards the far-sea colour, see below
    });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', /* glsl */ `#include <common>
          uniform float uTime, uAmp, uStorm;
          varying vec3 vWorld;
          ${LOOKUP}
          float hash12(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
          float waveH(vec2 p, float t) { float h = 0.0; ${GLSL_WAVES} return h; }
          // short choppy sea, only in bad weather (visual only, not used for buoyancy)
          float chop(vec2 p, float t) {
            return 0.55 * sin(dot(p, vec2(0.31, 0.22)) + t * 4.1) + 0.45 * sin(dot(p, vec2(-0.27, 0.36)) + t * 4.7)
                 + 0.35 * sin(dot(p, vec2(0.45, -0.38)) + t * 5.9);
          }`)
        .replace('#include <begin_vertex>', /* glsl */ `
          vec3 transformed = vec3(position);
          vec4 wp0 = modelMatrix * vec4(position, 1.0);
          float camDist = length(wp0.xz - cameraPosition.xz);
          // irregular facets near the camera; grid points sit on world multiples of the cell
          float near = 1.0 - smoothstep(${(UNIFORM * CELL * 0.6).toFixed(1)}, ${(UNIFORM * CELL * 0.95).toFixed(1)}, camDist);
          vec2 cellId = floor(wp0.xz / ${CELL.toFixed(1)} + 0.5);
          vec2 jit = (vec2(hash12(cellId), hash12(cellId + 17.0)) - 0.5) * ${(CELL * 0.7).toFixed(2)} * near;
          transformed.xz += jit;
          vec2 p = wp0.xz + jit;
          float fade = 1.0 - smoothstep(2500.0, 7000.0, camDist);
          float frozen = step(0.5, groundInfo(p).y); // no waves under the ice
          transformed.y += waveH(p, uTime) * uAmp * mix(0.25, 1.0, fade) * (1.0 - frozen);
          transformed.y += chop(p, uTime) * uStorm * 1.1 * near * (1.0 - frozen);
          transformed.y += frozen * 0.35;
          ${mosaic ? `
          // the mosaic: each grid point a fixed bit up or down, so the big facets tilt every way and ride the swell
          // together; only where the grid points sit on whole cells of the world (near), so nothing jumps when the
          // grid follows the camera (visual only: waveHeight() for buoyancy and hits stays, at most 0.55 m off)
          // (in a storm the facets pitch harder)
          transformed.y += (hash12(cellId + 5.0) - 0.5) * (1.1 + 1.4 * uStorm) * near * (1.0 - frozen);` : ''}
          vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', /* glsl */ `#include <common>
          uniform float uTime, uStorm, uSea, uToon;
          uniform vec3 uShallow, uMid, uDeep, uFoam, uStormCol, uStormLine, uSeaFar, uIce, uIceDark;
          uniform vec3 uNavy, uPetrol, uTeal, uTurq, uGlanz;
          uniform vec2 uSunXZ;
          vec2 hash22(vec2 p) {
            p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
            return fract(sin(p) * 43758.5453);
          }
          // Worley F2 - F1 with slowly wandering feature points: 0 on the cell borders
          float cellEdge(vec2 p, float t) {
            vec2 i = floor(p), f = fract(p);
            float d1 = 8.0, d2 = 8.0;
            for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
              vec2 g = vec2(float(x), float(y));
              vec2 o = hash22(i + g);
              o = 0.5 + 0.42 * sin(t * (0.12 + 0.2 * o.yx) + 6.2831 * o);
              float d = length(g + o - f);
              if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
            }
            return d2 - d1;
          }
          // 1 below the edge, anti-aliased over one pixel
          float below(float v, float edge) { float w = max(fwidth(v), 1e-4); return 1.0 - smoothstep(edge - w, edge + w, v); }
          // box-filtered coverage of the band [lo, hi] for a value v whose pixel footprint is w:
          // a stroke thinner than a pixel gets fainter instead of breaking up into dots
          float band(float v, float lo, float hi, float w) {
            w = max(w, 1e-5);
            return clamp((min(v + 0.5 * w, hi) - max(v - 0.5 * w, lo)) / w, 0.0, 1.0);
          }
          ${LOOKUP}
          uniform float uSeaFogNear, uSeaFogFar;
          uniform sampler2D uWakeTex;
          uniform vec4 uWakeRect;
          varying vec3 vWorld;`)
        .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
          vec2 gi = groundInfo(vWorld.xz);
          float ground = gi.x;
          float depth = vWorld.y - ground;
          float camD = length(vWorld - cameraPosition);
          vec3 water = mix(uShallow, uMid, smoothstep(0.5, 9.0, depth));
          water = mix(water, uDeep, smoothstep(9.0, 38.0, depth));
          ${mosaic ? `
          // the mosaic: on open water each facet takes its shade from how it faces the sun (navy away from it,
          // turquoise towards it), and lightens towards the horizon (Fresnel); shallows keep their colours
          vec3 fn = normalize(cross(dFdx(vWorld), dFdy(vWorld))); if (fn.y < 0.0) fn = -fn;
          float tilt = clamp(dot(fn.xz, normalize(uSunXZ)) * 9.0 + (fn.x * 0.7 - fn.z * 0.5) * 6.0, -1.0, 1.0);
          vec3 m = mix(uNavy, uPetrol, smoothstep(-0.9, 0.0, tilt));
          m = mix(m, uTeal, smoothstep(0.0, 0.7, tilt));
          m = mix(m, uTurq, smoothstep(0.65, 1.0, tilt) * 0.8);
          float fres = pow(1.0 - clamp(dot(fn, normalize(cameraPosition - vWorld)), 0.0, 1.0), 2.5);
          m = mix(m, mix(uTeal, uGlanz, 0.55), fres * 0.75);
          float openSea = smoothstep(2.5, 14.0, depth) * (1.0 - step(0.5, gi.y));
          water = mix(water, m, openSea);
          // the shallows keep their colours, but in facets too: each a shade lighter or darker by its tilt
          water *= mix(1.0, 0.88 + 0.24 * (tilt * 0.5 + 0.5), (1.0 - smoothstep(2.5, 14.0, depth)) * (1.0 - step(0.5, gi.y)));` : ''}
          // bad weather turns the sea dark slate and the white lines grey (Wind Waker)${mosaic ? `; the mosaic keeps its
          // facets in it, each slate a shade darker or lighter by its tilt, and flecks of foam on the steep ones` : ''}
          ${mosaic ? `water = mix(water, uStormCol * mix(0.55, 1.5, clamp(tilt * 2.2, -1.0, 1.0) * 0.5 + 0.5), uSea * 0.85 * openSea);
          water = mix(water, uStormCol, uSea * 0.85 * (1.0 - openSea));` : 'water = mix(water, uStormCol, uSea * 0.85);'}
          vec3 lineCol = mix(uFoam, uStormLine, uSea * 0.75);
          ${mosaic ? `// (a whole facet foams: its flat normal is the same all over it, rounded so that pixel noise does not
          // change its pick)
          float fleck = step(0.82, fract(sin(dot(floor(fn.xz * 14.0 + 0.5), vec2(41.3, 289.1))) * 45758.5453))
            * smoothstep(0.35, 0.85, tilt) * smoothstep(0.45, 0.9, uSea) * openSea;
          water = mix(water, mix(uFoam, uStormLine, 0.35), fleck * 0.6);` : ''}
          // surf: a crisp white band on the beach
          float foamBand = 1.6 + 0.6 * sin(uTime * 1.3 + vWorld.x * 0.05 + vWorld.z * 0.04);
          float foam = below(depth, foamBand);
          // white caps on the crests, only in rough weather
          float crest = (1.0 - below(vWorld.y / (1.3 + uStorm * 2.6), 0.97)) * smoothstep(0.35, 0.8, uSea);
          float lines = 0.0;
          ${mosaic ? '' : `
          // wandering cell lines on the open sea; they break up here and there like drawn strokes
          vec2 q = vWorld.xz / 46.0 + uTime * vec2(0.010, 0.006);
          // a smooth domain warp bends the straight Voronoi borders into rounded strokes
          q += 0.42 * vec2(sin(q.y * 0.9 + uTime * 0.3 + sin(q.x * 0.7)), sin(q.x * 0.8 - uTime * 0.25 + sin(q.y * 0.6)));
          float e = cellEdge(q, uTime);
          float lw = 0.052 * smoothstep(-0.8, 0.4, sin(q.x * 2.3 + q.y * 1.9 + uTime * 0.4));
          // pixel footprint from the smooth cell coordinates (not from e, whose kink on the
          // border hides it), along the longer axis so grazing views are filtered too
          float qpx = max(length(dFdx(q)), length(dFdy(q)));
          lines = band(e, -lw, lw, 2.0 * qpx * 1.3);
          // cells only a few pixels wide turn into noise: fade the pattern out
          lines *= (1.0 - smoothstep(0.04, 0.1, qpx)) * (1.0 - smoothstep(1100.0, 1900.0, camD));
          lines *= uToon * smoothstep(0.8, 3.0, depth) * (1.0 - step(0.5, gi.y));`}
          // wakes: crisp outline of the wake field, lighter water inside, white churn where fresh
          vec2 wuv = (vWorld.xz - uWakeRect.xy) / uWakeRect.zw;
          float wakeFoam = 0.0;
          if (wuv.x > 0.0 && wuv.y > 0.0 && wuv.x < 1.0 && wuv.y < 1.0) {
            vec2 uv = vec2(wuv.x, 1.0 - wuv.y);
            const float tx = 1.0 / ${WAKE_RES.toFixed(1)};
            // four bilinear taps around the point: a slightly blurred field whose contours have
            // no kinks at the texel borders, and its gradient from the same taps
            const float h = 0.75 * tx;
            float s00 = texture2D(uWakeTex, uv + vec2(-h, -h)).r, s10 = texture2D(uWakeTex, uv + vec2(h, -h)).r;
            float s01 = texture2D(uWakeTex, uv + vec2(-h, h)).r, s11 = texture2D(uWakeTex, uv + vec2(h, h)).r;
            float wk = 0.25 * (s00 + s10 + s01 + s11);
            vec2 dw = vec2(s10 + s11 - s00 - s01, s01 + s11 - s00 - s10) * 0.5;
            float grad = length(dw) / (2.0 * h * uWakeRect.z) + 1e-4;              // per metre
            // the outline wobbles a little, like a drawn stroke
            float wob = 0.03 * sin(vWorld.x * 0.045 + vWorld.z * 0.038 + uTime * 0.7);
            float dist = (wk - 0.16 - wob) / grad;                                // metres inside the outline
            // metres per pixel along the longer screen axis: the filter width for the strokes
            float mpx = max(length(dFdx(vWorld.xz)), length(dFdy(vWorld.xz))) * 1.3;
            float inside = band(dist, 0.0, 1e5, mpx);
            float rim = band(dist, 0.0, 2.4, mpx);
            // a thin inner line that closes into a loop before the wake ends
            float dist2 = (wk - 0.46 + wob) / grad;
            rim = max(rim, band(dist2, -0.55, 0.55, mpx));
            vec3 churn = mix(mix(uMid, uShallow, 0.15), mix(uStormCol, uStormLine, 0.4), uSea);
            water = mix(water, churn, inside * 0.55);
            wakeFoam = max(rim, 1.0 - below(wk, 0.74));
            lines *= 1.0 - inside;
          }
          diffuseColor.rgb = mix(water, uFoam, clamp(max(foam, max(crest, wakeFoam)), 0.0, 1.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, lineCol, lines * (1.0 - foam));
          // frozen lagoons: faceted ice, one shade per triangle-sized cell
          float iceShade = fract(sin(dot(floor(vWorld.xz / 9.0), vec2(12.9898, 78.233))) * 43758.5453);
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(uIce, uIceDark, step(0.6, iceShade)), step(0.5, gi.y));`)
        .replace('#include <opaque_fragment>', /* glsl */ `#include <opaque_fragment>
          // fade into the far-sea colour the sky dome paints below the horizon
          float seaFog = smoothstep(uSeaFogNear, uSeaFogFar, length(vWorld - cameraPosition));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uSeaFar, seaFog);`);
    };
    mat.customProgramCacheKey = () => `lowpoly-ocean-${style}`;

    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.name = `ocean-${style}`;
    mesh.userData.cell = CELL;
    return mesh;
  }

  setWake(tex: THREE.Texture, rect: THREE.Vector4) {
    this.uniforms.uWakeTex.value = tex;
    this.uniforms.uWakeRect.value = rect;
  }

  update(env: Environment, camera: THREE.Camera) {
    this.uniforms.uTime.value = env.elapsed;
    this.uniforms.uAmp.value = env.w.waves;
    this.uniforms.uStorm.value = THREE.MathUtils.clamp((env.w.waves - 1) / 2.1, 0, 1);
    this.uniforms.uSea.value = env.w.sea;
    this.uniforms.uSunXZ.value.set(env.sunDir.x, env.sunDir.z);
    // the same far-sea colour the sky dome shows below the horizon (it mixes in the fog once more)
    this.uniforms.uSeaFar.value.copy(env.seaFar).lerp(env.horizon, env.fogAmount);
    // the mesh reaches ~21 km (clipped at 16 km); it must be fully far-sea coloured well before that
    this.uniforms.uSeaFogFar.value = Math.min(env.w.fogFar * 1.15, 10500);
    this.uniforms.uSeaFogNear.value = Math.min(env.w.fogNear, this.uniforms.uSeaFogFar.value * 0.5);
    // follow the camera in whole cells so the wave pattern stays fixed in the world; the mosaic in pairs of cells,
    // so every quad keeps the diagonal it is split along (its facets would flip otherwise)
    for (const m of [this.seas.mosaik, this.seas.linien]) {
      const c = (m.userData.cell as number) * (m === this.seas.mosaik ? 2 : 1);
      m.position.set(Math.round(camera.position.x / c) * c, 0, Math.round(camera.position.z / c) * c);
    }
  }
}
