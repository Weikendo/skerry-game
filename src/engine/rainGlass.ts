import * as THREE from 'three';

/**
 * Rain on the window the camera looks through (bridge, cockpit, cab): a full-screen pass over the rendered
 * scene. Small drops sit on the glass, appear and dry again; bigger ones run down in streaks and leave droplets
 * behind. On the canopy of a flying Skua the airstream takes over: it blows the drops outwards in all directions
 * from where it meets the glass, the further out the faster, in long streaks. Each drop is a little lens: it shows
 * the picture behind it shifted and softened, with a glint on its upper edge and a darker rim.
 * `uRain` (0..1) sets how many there are, `uAngle` which way they run down (0 = straight down, turned by the wind
 * and a banked cockpit), `uRun` is the glass's clock for them (it runs faster in a strong wind, never back), `uFlow`
 * (0..1) how much the airstream has taken over, `uBlow` how far it has carried them (in log radius) and `uCentre`
 * where it meets the glass (x 0..aspect, y 0..1).
 */
export const RainGlassShader = {
  name: 'RainGlassShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uRun: { value: 0 },
    uRain: { value: 0 },
    uAngle: { value: 0 },
    uAspect: { value: 16 / 9 },
    uLight: { value: 1 },
    uFlow: { value: 0 },
    uBlow: { value: 0 },
    uCentre: { value: new THREE.Vector2(16 / 18, 0.5) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uRun, uRain, uAngle, uAspect, uLight, uFlow, uBlow;
    uniform vec2 uCentre;
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

    // drops running down in columns, each leaving droplets behind; they go by the glass's clock, so never back up
    vec3 runners(vec2 st, float cols, float run, float seed) {
      float col = floor(st.x * cols), n = hash(vec2(col, seed));
      if (n > uRain * 0.75) return vec3(0.0);
      float x = fract(st.x * cols) - 0.5;
      // the head slides down at its own pace, stopping now and then (water on glass gathers, then runs)
      float tt = run * (0.04 + n * 0.08) + n * 13.0;
      float g = tt * 7.0;
      float way = mix(tt, (floor(g) + smoothstep(0.2, 0.7, fract(g))) / 7.0, 0.6);
      float y = 1.15 - fract(way) * 1.5;
      float wob = sin(st.y * 23.0 + n * 6.3) * 0.1 + sin(st.y * 51.0 + n) * 0.04;
      vec2 d = vec2(x - wob, (st.y - y) * cols * 0.55);
      float head = smoothstep(0.26, 0.18, length(d * vec2(1.0, 1.25)));
      // the trail: a thin wet streak above the head and droplets left in it, staying where they were left
      float above = st.y - y;
      float trail = smoothstep(0.06, 0.0, abs(d.x)) * step(0.0, above) * smoothstep(0.35, 0.0, above) * 0.5;
      float row = st.y * cols * 1.6;
      vec2 dd = vec2(d.x, (fract(row) - 0.5) * 0.9);
      float bead = smoothstep(0.1, 0.06, length(dd)) * step(0.0, above) * smoothstep(0.3, 0.02, above)
        * step(0.45, hash(vec2(col + floor(way) * 31.0, floor(row))));
      float m = max(head, max(trail, bead));
      vec2 nrm = head > 0.0 ? d / 0.26 : dd / 0.1;
      return vec3(nrm, m);
    }

    // drops the airstream blows outwards from uCentre: in cells of equal angle and equal log radius, which widen
    // outwards, so a drop carried at a steady pace through them speeds up the further out it gets
    vec3 blown(vec2 st, float spokes, float pace, float seed) {
      vec2 p = st - uCentre;
      float r = max(length(p), 1e-4);
      vec2 ro = p / r;
      float k = spokes / 6.2832;
      float a = atan(p.y, p.x) * k;
      float spoke = floor(a), n = hash(vec2(spoke, seed));
      float u = (log(r) - uBlow * pace) * k + n * 17.0;
      vec2 id = vec2(floor(u), spoke);
      if (hash(id * 0.731 + seed) > uRain * 0.5) return vec3(0.0);
      float cell = r / k;
      // the drop sits in the outer part of its cell, its streak reaching back towards the centre
      vec2 c = vec2(mix(0.05, 0.3, hash(id + 2.3)), (hash(id + 5.1) - 0.5) * 0.5);
      // where in the drop, on the screen: x outwards, y across
      vec2 l = (vec2(fract(u), fract(a)) - 0.5 - c) * cell;
      float R = min(0.01, cell * 0.16) * mix(0.6, 1.3, hash(id + 9.1));
      // a head drawn out by the wind and a streak behind it, thinning out back to the cell's inner edge
      vec2 h = vec2(l.x / 1.4, l.y);
      float head = smoothstep(R, R * 0.6, length(h));
      float along = clamp(-l.x / ((0.5 + c.x) * cell * 0.95), 0.0, 1.0);
      float w = R * mix(0.55, 0.15, along);
      float tail = smoothstep(w, w * 0.3, abs(l.y)) * step(l.x, 0.0) * (1.0 - along) * 0.85;
      // calm where the air meets the glass
      float m = max(head, tail) * smoothstep(0.03, 0.12, r);
      vec2 nl = head >= tail ? h / R : vec2(0.0, l.y / w);
      return vec3(nl.x * ro + nl.y * vec2(-ro.y, ro.x), m);
    }

    void main() {
      vec2 st = vec2(vUv.x * uAspect, vUv.y);
      // turn the glass so the drops run along uAngle
      float ca = cos(uAngle), sa = sin(uAngle);
      vec2 rs = mat2(ca, -sa, sa, ca) * (st - vec2(uAspect * 0.5, 0.5)) + vec2(uAspect * 0.5, 0.5);
      // in the airstream few drops stay put
      float sit = mix(1.0, 0.5, uFlow);
      vec3 a = dots(st, 22.0, uTime);
      vec3 b = dots(st + 7.3, 41.0, uTime * 1.3);
      // the strongest drop here (sheen: one the airstream drew out into a streak)
      vec3 d = vec3(a.xy, a.z * sit);
      float sheen = 0.0;
      if (b.z * 0.7 * sit > d.z) d = vec3(b.xy, b.z * 0.7 * sit);
      if (uFlow < 1.0) {
        vec3 r1 = runners(rs, 14.0, uRun, 1.0);
        vec3 r2 = runners(rs + vec2(0.37, 0.0), 9.0, uRun * 0.8, 2.0);
        r1.z *= 1.0 - uFlow; r2.z *= 1.0 - uFlow;
        if (r1.z > d.z) d = r1;
        if (r2.z > d.z) d = r2;
      }
      if (uFlow > 0.0) {
        vec3 b1 = blown(st, 64.0, 1.0, 3.0);
        vec3 b2 = blown(st, 110.0, 0.6, 4.0);
        b1.z *= uFlow; b2.z *= uFlow * 0.8;
        if (b1.z > d.z) { d = b1; sheen = 1.0; }
        if (b2.z > d.z) { d = b2; sheen = 1.0; }
      }
      float m = d.z;
      // a lens: the picture behind it shifted against its slope and softened (a thin streak bends it more)
      vec2 off = -d.xy * m * vec2(0.012 / uAspect, 0.016) * (1.0 + sheen);
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
        // water whipped along the glass catches the light of the sky
        col.rgb += vec3(0.85, 0.9, 1.0) * m * sheen * (1.0 - 0.5 * edge) * 0.12 * (0.4 + 0.6 * uLight);
      }
      gl_FragColor = col;
    }`,
};
