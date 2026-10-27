import * as THREE from 'three';

/**
 * Rain on the window the camera looks through (bridge, cockpit, cab): a full-screen pass over the rendered
 * scene. Small drops sit on the glass, appear and dry again; bigger ones run down in streaks and leave a trail
 * of droplets. Each drop is a little lens: it shows the picture behind it shifted and softened, with a glint on
 * its upper edge and a darker rim. `uRain` (0..1) sets how many there are, `uAngle` which way they run (0 =
 * straight down; tilted by the wind, upwards on a fast aircraft's canopy) and `uSpeed` how fast.
 */
export const RainGlassShader = {
  name: 'RainGlassShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uRain: { value: 0 },
    uAngle: { value: 0 },
    uSpeed: { value: 1 },
    uAspect: { value: 16 / 9 },
    uLight: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uRain, uAngle, uSpeed, uAspect, uLight;
    varying vec2 vUv;

    float hash(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }

    // small drops on the glass: per cell one that comes and dries; xy = where in the drop (-1..1), z = cover
    vec3 dots(vec2 st, float cells, float t) {
      vec2 g = st * cells, id = floor(g), f = fract(g) - 0.5;
      float n = hash(id);
      vec2 c = (vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5) * 0.6;
      float life = fract(t * 0.07 + n * 9.0);
      float r = mix(0.1, 0.24, hash(id + 1.7)) * smoothstep(0.0, 0.04, life) * smoothstep(1.0, 0.7, life);
      vec2 d = f - c;
      float m = smoothstep(r, r * 0.7, length(d)) * step(n, uRain * 0.85);
      return vec3(d / max(r, 1e-3), m);
    }

    // drops running down in columns, each with a trail of droplets above it
    vec3 runners(vec2 st, float cols, float t, float seed) {
      float col = floor(st.x * cols), n = hash(vec2(col, seed));
      if (n > uRain * 0.75) return vec3(0.0);
      float x = fract(st.x * cols) - 0.5;
      // the head slides down at its own pace, stopping now and then (water on glass gathers, then runs)
      float pace = (0.04 + n * 0.08) * uSpeed;
      float tt = t * pace + n * 13.0;
      float y = 1.15 - fract(tt) * 1.5 - 0.06 * sin(tt * 40.0) * (1.0 - uSpeed * 0.3);
      float wob = sin(st.y * 23.0 + n * 6.3) * 0.1 + sin(st.y * 51.0 + n) * 0.04;
      vec2 d = vec2(x - wob, (st.y - y) * cols * 0.55);
      float head = smoothstep(0.26, 0.18, length(d * vec2(1.0, 1.25)));
      // the trail: a thin wet streak above the head and droplets left in it
      float above = st.y - y;
      float trail = smoothstep(0.06, 0.0, abs(d.x)) * step(0.0, above) * smoothstep(0.35, 0.0, above) * 0.5;
      float drip = fract(above * cols * 1.6);
      vec2 dd = vec2(d.x, (drip - 0.5) * 0.9);
      float bead = smoothstep(0.1, 0.06, length(dd)) * step(0.0, above) * smoothstep(0.3, 0.02, above) * step(0.45, hash(vec2(col, floor(above * cols * 1.6))));
      float m = max(head, max(trail, bead));
      vec2 nrm = head > 0.0 ? d / 0.26 : dd / 0.1;
      return vec3(nrm, m);
    }

    void main() {
      vec2 st = vec2(vUv.x * uAspect, vUv.y);
      // turn the glass so the drops run along uAngle
      float ca = cos(uAngle), sa = sin(uAngle);
      vec2 rs = mat2(ca, -sa, sa, ca) * (st - vec2(uAspect * 0.5, 0.5)) + vec2(uAspect * 0.5, 0.5);
      vec3 a = dots(st, 22.0, uTime);
      vec3 b = dots(st + 7.3, 41.0, uTime * 1.3);
      vec3 r1 = runners(rs, 14.0, uTime, 1.0);
      vec3 r2 = runners(rs + vec2(0.37, 0.0), 9.0, uTime * 0.8, 2.0);
      // the strongest drop here
      vec3 d = a;
      if (b.z * 0.7 > d.z) d = vec3(b.xy, b.z * 0.7);
      if (r1.z > d.z) d = r1;
      if (r2.z > d.z) d = r2;
      float m = d.z;
      // a lens: the picture behind it shifted against its slope and softened
      vec2 off = -d.xy * m * vec2(0.012 / uAspect, 0.016);
      vec4 col = texture2D(tDiffuse, vUv + off);
      if (m > 0.01) {
        vec2 px = vec2(0.003 / uAspect, 0.003) * m;
        col = (col * 2.0 + texture2D(tDiffuse, vUv + off + px) + texture2D(tDiffuse, vUv + off - px)
          + texture2D(tDiffuse, vUv + off + vec2(px.x, -px.y)) + texture2D(tDiffuse, vUv + off + vec2(-px.x, px.y))) / 6.0;
        // a darker rim and a glint where its top catches the light
        float edge = smoothstep(0.55, 1.0, length(d.xy));
        col.rgb *= 1.0 - 0.28 * edge * m;
        float glint = pow(max(0.0, dot(normalize(d.xy + 1e-4), normalize(vec2(-0.4, 0.75)))), 10.0) * smoothstep(0.3, 0.8, length(d.xy));
        col.rgb += vec3(0.9, 0.95, 1.0) * glint * m * 0.35 * uLight;
      }
      gl_FragColor = col;
    }`,
};
