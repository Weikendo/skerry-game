// Vorführungen zu docs/look-analyse.md – nur zur Laufzeit, ändert keine Quelldatei.
//
// Benutzung: Spiel im Browser öffnen (Dev-Server, Titelbildschirm), die Konsole öffnen,
// diese Datei vollständig einfügen. Teil 1 baut die Titelbild-Szene bei Broad Law nach
// (startet dabei ein neues Spiel), Teil 2 stellt window.__look bereit, Teil 3 die Messung.
//
//   window.SCENE_TARGET = [-30, -380]; window.SCENE_DIST = 1500;   // vor dem Einfügen setzen
//   __cam(140, 75, 210, 0, -8, -25, 52);                           // Blick wie im Titelbild
//   __look.sea({ gain: 16, chop: 1.1, navy: '#0a2b4d', petrol: '#155f80', teal: '#2a9294', turq: '#72c9b6', refl: '#a8dcd8' });
//   __look.light(); __look.haze({ horizon: '#f3e6c8', sea: '#9dcfcf', mix: 0.7 }, [300, 7000]); __look.sky();
//   __look.islands(); __look.carrier(); __look.otter(); __look.skua(); __look.smoke(); __burnAll();
//   __look.tone('aces', 0.95);  __look.seaOff();  __med('name');  JSON.stringify(__r)
//
// Die Umfärbungen (islands, carrier, otter, skua) ändern Vertexfarben nach HSL-Regeln und sind
// nur Annäherungen an die vorgeschlagenen Palettenwerte. Mit F5 ist alles wieder wie vorher.

// ---- Teil 1: Szene ----
// Injected into the game page (headless): rebuilds the key-art composition near Broad Law.
(() => {
  document.getElementById('boot')?.remove();
  if (!document.getElementById('hideui')) {
    const st = document.createElement('style'); st.id = 'hideui';
    st.textContent = 'body > *:not(#app){display:none!important} #app > *:not(canvas){display:none!important}';
    document.head.appendChild(st);
  }
  const T = window.THREE_ = cc.camera.position.constructor;
  cc.params.zufallsWetter = false; cc.params.hintergrundPause = false;
  const isl = cc.world.islands.find(i => i.name === (window.SCENE_ISLAND || 'Broad Law'));
  const R = isl.size / 2.8;
  // view direction: the sun (17 h, west) stands at the right edge of the picture
  const L = new T(-0.82, 0, 0.57).normalize();
  const left = new T(L.z, 0, -L.x);
  const Lp = L.clone().multiplyScalar(Math.cos(0.44)).addScaledVector(left, Math.sin(0.44)).normalize();
  const dist = window.SCENE_DIST || R * 1.85;
  const tg = window.SCENE_TARGET || [0, 0];
  const P = new T(isl.cx + tg[0] - Lp.x * dist, 0, isl.cz + tg[1] - Lp.z * dist);
  const right = left.clone().negate();
  const f = right.clone().multiplyScalar(-0.65).addScaledVector(L, -0.75).normalize();
  const heading = Math.atan2(f.x, f.z);
  const c = cc.carrier;
  c.pos.copy(P); c.prev.copy(P); c.heading = heading; c.speed = 0; c.waypoint = null;
  c.updateAxes(); c.place(0);
  cc.menu.actions.newGame(1988, 64);
  c.throttle = 2; c.speed = 6;
  cc.env.setWeather('klar', true);
  cc.env.time = window.SCENE_TIME ?? 17.0;
  const port = c.port.clone(), fwd = c.forward.clone();
  const W = (x, y, z) => c.pos.clone().addScaledVector(port, x).addScaledVector(fwd, z).setY(y);
  window.__local = W;
  // Otters on the water, heading for the island
  const otters = [[170, 230], [95, 330], [210, -80], [290, 20]];
  cc.walruses.forEach((w, i) => {
    const [x, z] = otters[i]; const p = W(x, 0, z);
    const s = w.saveState();
    const to = new T(isl.cx, 0, isl.cz).sub(p).normalize();
    Object.assign(s, { state: 'fahren', x: p.x, z: p.z, heading: Math.atan2(to.x, to.z) + (i - 1.5) * 0.25, speed: 7, medium: 'wasser', waypoint: [isl.cx, isl.cz] });
    w.loadState(s);
  });
  // Skuas in the air
  window.__skuas = (list = [[60, 70, 120], [260, 95, 330], [-120, 110, -60], [380, 140, 250]], yawOff = 0) => cc.mantas.forEach((m, i) => {
    if (!list[i]) return;
    const [x, y, z] = list[i]; const p = W(x, y, z);
    const s = m.saveState();
    Object.assign(s, { state: 'flug', x: p.x, y, z: p.z, yaw: heading + yawOff + 0.3 * (i - 1.5), pitch: 0, bank: 0, speed: 45, throttle: 0.4, waypoint: null });
    m.loadState(s);
  });
  window.__skuas();
  // burning enemy buildings on the island
  const base = cc.bases.find(b => b.island === isl);
  const burnt = base ? base.buildings.filter(b => b.alive && b.p.type !== 'kommandozentrale').slice(0, 3) : [];
  burnt.forEach(b => base.destroy(b));
  window.__ocean = () => cc.renderer.properties.get(cc.scene.getObjectByName('ocean').material).uniforms;
  window.__cam = (x, y, z, lx = 0, ly = -6, lz = -10, fov = 45) => {
    cc.setDevCamera(true);
    const e = W(x, y, z), l = W(lx, ly, lz);
    cc.camera.position.copy(e); cc.controls.target.copy(l);
    cc.camera.fov = fov; cc.camera.updateProjectionMatrix(); cc.controls.update();
  };
  return JSON.stringify({ P: [P.x | 0, P.z | 0], heading, ground: isl.heightAt(P.x, P.z), R: R | 0, burnt: burnt.length, base: !!base });
})()
;(() => {
  const T = window.THREE_;
  window.__camW = (e, t, fov = 45) => {
    cc.setDevCamera(true);
    cc.camera.position.set(...e); cc.controls.target.set(...t);
    cc.camera.fov = fov; cc.camera.updateProjectionMatrix(); cc.controls.update();
  };
  // camera relative to a unit: d = [right, up, ahead] metres in its own frame
  window.__camUnit = (u, d, lookUp = 1.5, fov = 40) => {
    const h = u.heading ?? u.yaw;
    const f = new T(Math.sin(h), 0, Math.cos(h)), r = new T(-Math.cos(h), 0, Math.sin(h));
    const e = u.pos.clone().addScaledVector(r, d[0]).addScaledVector(f, d[2]); e.y = u.pos.y + d[1];
    __camW([e.x, e.y, e.z], [u.pos.x, u.pos.y + lookUp, u.pos.z], fov);
  };
  window.__burnAll = () => { const isl = cc.world.islands.find(i => i.name === (window.SCENE_ISLAND || 'Broad Law')); const b = cc.bases.find(b => b.island === isl);
    b.buildings.filter(x => x.alive && x.p.type !== 'kommandozentrale').forEach(x => b.destroy(x)); return b.buildings.length; };
})();
'helpers'

// ---- Teil 2: Look ----
// Runtime-only demos of the proposed look changes (nothing in src/ is touched).
;(() => {
  const T = cc.camera.position.constructor;            // Vector3
  const Color = cc.env.horizon.constructor;
  const V2 = cc.camera.getWorldDirection(new T()).constructor; // placeholder
  const ocean = cc.scene.getObjectByName('ocean');
  const L = window.__look = {};
  const H = new Color(), hsl = {};

  // ---- environment overrides applied after every env.update ----
  const ov = L.ov = {};
  if (!cc.env.__origUpdate) {
    cc.env.__origUpdate = cc.env.update;
    cc.env.update = function (dt) {
      cc.env.__origUpdate.call(this, dt);
      if (ov.fog) { this.w.fogNear = ov.fog[0]; this.w.fogFar = ov.fog[1]; }
      if (ov.light) {
        this.lightColor.lerp(new Color(ov.light.color), ov.light.mix ?? 1);
        this.lightIntensity *= ov.light.k ?? 1;
        this.hemiSky.lerp(new Color(ov.light.sky), ov.light.mix ?? 1);
        this.hemiGround.lerp(new Color(ov.light.ground), ov.light.mix ?? 1);
        this.hemiIntensity *= ov.light.hk ?? 1;
      }
      if (ov.haze) {
        this.horizon.lerp(new Color(ov.haze.horizon), ov.haze.mix ?? 1);
        this.fogColor.copy(this.horizon);
        this.seaFar.copy(new Color(ov.haze.sea));
      }
    };
  }

  // ---- tone mapping ----
  L.tone = (mode, exposure = 1) => {
    cc.renderer.toneMapping = { neutral: 7, aces: 4, agx: 6 }[mode];
    cc.renderer.toneMappingExposure = exposure;
    cc.scene.traverse(o => { const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach(x => x.needsUpdate = true); });
  };
  L.light = (o = { color: '#ffd9a8', k: 1.15, sky: '#9cc8f0', ground: '#2f6670', hk: 1.0 }) => { ov.light = o; };
  L.haze = (o = { horizon: '#f3e6c8', sea: '#9dcfcf', mix: 0.7 }, fog = [500, 9000]) => { ov.haze = o; ov.fog = fog; };

  // ---- sea: coarser facets, facet chop, mosaic colouring, no cell lines ----
  L.sea = (o = {}) => {
    const C = o.cell ?? 14, U = o.uniform ?? 40, HALF = o.half ?? 110, G = 1.07;
    const warp = (i) => { const a = Math.abs(i); if (a <= U) return i * C; const k = a - U; return Math.sign(i) * (U * C + C * (Math.pow(G, k + 1) - G) / (G - 1)); };
    const n = HALF * 2, pos = new Float32Array((n + 1) * (n + 1) * 3);
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const k = (j * (n + 1) + i) * 3; pos[k] = warp(i - HALF); pos[k + 1] = 0; pos[k + 2] = warp(j - HALF); }
    const idx = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      if ((i + j) % 2) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
    }
    if (!L.origGeo) L.origGeo = ocean.geometry;
    const g = ocean.geometry.clone(); g.setAttribute('position', new ocean.geometry.attributes.position.constructor(pos, 3)); g.setIndex(idx);
    ocean.geometry = g;
    const mat = ocean.material;
    const orig = mat.__orig ?? (mat.__orig = mat.onBeforeCompile);
    const U2 = L.seaU = {
      uMosaic: { value: o.mosaic ?? 1 }, uFacetAmp: { value: o.chop ?? 0.9 }, uGain: { value: o.gain ?? 9 },
      uSunXZ: { value: new T() },
      uNavy: { value: new Color(o.navy ?? '#0b3150') }, uPetrol: { value: new Color(o.petrol ?? '#16607a') },
      uTeal: { value: new Color(o.teal ?? '#2a8f8c') }, uTurq: { value: new Color(o.turq ?? '#62c3b4') },
      uRefl: { value: new Color(o.refl ?? '#a6dad6') },
    };
    mat.onBeforeCompile = (shader, r) => {
      orig(shader, r);
      Object.assign(shader.uniforms, U2);
      shader.vertexShader = shader.vertexShader
        .replace('uniform float uTime, uAmp, uStorm;', 'uniform float uTime, uAmp, uStorm, uFacetAmp;')
        .replace('smoothstep(252.0, 399.0, camDist)', `smoothstep(${(U * C * 0.6).toFixed(1)}, ${(U * C * 0.95).toFixed(1)}, camDist)`)
        .replace('floor(wp0.xz / 6.0 + 0.5)', `floor(wp0.xz / ${C.toFixed(1)} + 0.5)`)
        .replace('* 4.20 * near', `* ${(C * 0.7).toFixed(2)} * near`)
        .replace('transformed.y += frozen * 0.35;', `transformed.y += frozen * 0.35;
          float fchop = (1.0 - smoothstep(1500.0, 4000.0, camDist)) * (1.0 - frozen);
          transformed.y += (hash12(cellId + 5.0) - 0.5) * uFacetAmp * fchop * (0.65 + 0.35 * sin(uTime * 0.6 + hash12(cellId + 9.0) * 6.283));
          vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('uniform float uSeaFogNear, uSeaFogFar;', `uniform float uSeaFogNear, uSeaFogFar, uMosaic, uGain;
          uniform vec3 uSunXZ, uNavy, uPetrol, uTeal, uTurq, uRefl;`)
        .replace('diffuseColor.rgb = mix(water, uFoam,', `
          {
            vec3 fn = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
            if (fn.y < 0.0) fn = -fn;
            vec3 Vd = normalize(cameraPosition - vWorld);
            // facet tilt towards the sun, strongly exaggerated: each triangle gets its own shade
            float tilt = clamp(dot(fn.xz, normalize(uSunXZ.xz)) * uGain + (fn.x * 0.7 - fn.z * 0.5) * uGain * 0.6, -1.0, 1.0);
            vec3 m = mix(uNavy, uPetrol, smoothstep(-0.9, 0.0, tilt));
            m = mix(m, uTeal, smoothstep(0.0, 0.7, tilt));
            m = mix(m, uTurq, smoothstep(0.65, 1.0, tilt) * 0.8);
            // looking down: dark navy; towards the horizon: lighter, reflecting the sky (Fresnel)
            float fres = pow(1.0 - clamp(dot(fn, Vd), 0.0, 1.0), 2.5);
            m = mix(m, mix(uTeal, uRefl, 0.55), fres * 0.75);
            float open = smoothstep(2.5, 14.0, depth) * (1.0 - step(0.5, gi.y));
            water = mix(water, m, open * uMosaic);
          }
          diffuseColor.rgb = mix(water, uFoam,`);
    };
    mat.customProgramCacheKey = () => 'lowpoly-ocean-demo-' + C;
    mat.needsUpdate = true;
    const s = cc.env.sunDir; U2.uSunXZ.value.set(s.x, 0, s.z);
    L.toon(o.toon ?? 0);
  };
  L.seaOff = () => { const mat = ocean.material; if (!L.origGeo) return; ocean.geometry = L.origGeo; mat.onBeforeCompile = mat.__orig; mat.customProgramCacheKey = () => 'lowpoly-ocean'; mat.needsUpdate = true; L.toon(1); };
  L.toon = (v) => { const u = cc.renderer.properties.get(ocean.material).uniforms; if (u?.uToon) u.uToon.value = v; else setTimeout(() => L.toon(v), 100); };

  // ---- recolour vertex colours (islands, vegetation, models) ----
  const recolor = (root, fn) => root.traverse(o => {
    const a = o.geometry?.attributes?.color; if (!a) return;
    if (!a.__orig) { a.__orig = new Float32Array(a.count * 3); for (let i = 0; i < a.count; i++) { a.__orig[i * 3] = a.getX(i); a.__orig[i * 3 + 1] = a.getY(i); a.__orig[i * 3 + 2] = a.getZ(i); } }
    for (let i = 0; i < a.count; i++) {
      H.setRGB(a.__orig[i * 3], a.__orig[i * 3 + 1], a.__orig[i * 3 + 2]);
      H.getHSL(hsl, 'srgb');
      const r = fn(hsl.h * 360, hsl.s, hsl.l);
      if (r) { H.setHSL(r[0] / 360, r[1], r[2], 'srgb'); a.setXYZ(i, H.r, H.g, H.b); }
    }
    a.needsUpdate = true;
  });
  L.recolor = recolor;
  L.islands = () => {
    const f = (h, s, l) => {
      if (h > 70 && h < 150 && s > 0.25) return [h * 0.55 + 38, s * 0.55, l * 0.92];      // lime green -> olive / sage
      if ((h < 40 || h > 330) && s < 0.35 && l < 0.7) return [205, 0.13, Math.min(0.85, l * 1.12)]; // brown rock -> slate
      if (h >= 25 && h < 50 && s < 0.6 && l > 0.6) return [h + 3, s * 0.7, l];             // sand a little paler
      return null;
    };
    recolor(cc.world.group, f);
    for (const v of cc.vegetation.values()) recolor(v.group, f);
  };
  L.otter = () => {
    for (const w of [...cc.walruses]) recolor(w.model.group, (h, s, l) => {
      if (h >= 28 && h <= 55 && s > 0.35) return [h + 24, Math.min(1, s * 1.05), l * 1.04];     // ochre -> chartreuse
      if (h > 200 && h < 290 && s < 0.35) return [212, s * 0.6, l];                         // lilac grey -> steel
      return null;
    });
  };
  L.carrier = (k = 1.55) => {
    recolor(cc.carrier.model.group, (h, s, l) => {
      if (s < 0.4 && l < 0.5) return [212, Math.max(0.14, s * 0.8), Math.min(0.62, l * k)];      // anthracite -> gunmetal
      if (h > 200 && h < 290 && s < 0.35) return [212, s * 0.6, l];
      return null;
    });
  };
  L.skua = () => {
    for (const m of cc.mantas) recolor(m.model.group, (h, s, l) => {
      if (h > 200 && h < 290 && s < 0.35) return [212, s * 0.5, l * 0.85];
      if ((h < 30 || h > 340) && s > 0.5) return [212, 0.1, 0.42];                           // orange / red -> gunmetal
      return null;
    });
  };
  // ---- bigger, darker smoke over burning ruins ----
  L.smoke = (k = 3.2) => {
    const e = cc.effects;
    if (e.__origPuff) return;
    e.__origPuff = e.smokePuff;
    e.smokePuff = function (p, size, dark = true) {
      const n = this.particles.length;
      e.__origPuff.call(this, p, dark ? size * k : size, dark);
      const q = this.particles[n];
      if (q && dark) { q.color.set('#2a2b30'); q.life *= 2.2; q.vel.y *= 1.6; }
    };
  };
  return 'look ready';
})()
;(() => {
  const Color = cc.env.horizon.constructor;
  const L = window.__look;
  // sky: cooler horizon away from the sun, wider warm glow towards it
  L.sky = (cool = '#bcdde6', glow = 0.45) => {
    const sky = cc.scene.children.find(o => o.material?.uniforms?.uZenith);
    const m = sky.material;
    if (!m.__origFrag) m.__origFrag = m.fragmentShader;
    m.uniforms.uHzCool = { value: new Color(cool) };
    m.uniforms.uGlow = { value: glow };
    m.fragmentShader = m.__origFrag
      .replace('uniform float uSunVis,', 'uniform vec3 uHzCool; uniform float uGlow; uniform float uSunVis,')
      .replace('vec3 col = mix(uHorizon, uZenith, g);', `
        float az = dot(normalize(d.xz + 1e-5), normalize(uSunDir.xz + 1e-5)) * 0.5 + 0.5;
        vec3 hz = mix(uHzCool, uHorizon, smoothstep(0.35, 1.0, az));
        vec3 col = mix(hz, uZenith, g);`)
      .replace('pow(s, 6.0) * 0.28', 'pow(s, 3.0) * uGlow');
    m.needsUpdate = true;
  };
  return 'sky ready';
})()

// ---- Teil 3: Messung ----
;(() => {
  const gl = cc.renderer.getContext(), px = new Uint8Array(4);
  window.__bench = (n = 120) => {
    for (let i = 0; i < 10; i++) cc.step(performance.now(), 1 / 60);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) { cc.step(performance.now(), 1 / 60); if (i % 4 === 3) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ms = (performance.now() - t0) / n;
    return { ms: +ms.toFixed(2), calls: cc.renderer.info.render.calls, tris: Math.round(cc.renderer.info.render.triangles / 1000) + 'k' };
  };
  window.__med = (name, n = 90) => { const r = [0, 1, 2].map(() => __bench(n)); r.sort((a, b) => a.ms - b.ms); (window.__r ||= []).push([name, r[1].ms, r[0].ms, r[2].ms, r[1].calls, r[1].tris]); return name; };
  const origRender = cc.post.render.bind(cc.post);
  window.__forcePost = (mode) => { // null: as the game does, 'grade': render target + output pass, 'bloom': with bloom
    if (!mode) { cc.post.render = origRender; return; }
    cc.post.bloom.enabled = mode === 'bloom';
    cc.post.render = () => origRender(true);
  };
  window.__res = (pr) => { cc.params.aufloesung = String(pr * 100); cc.post.setSize(innerWidth, innerHeight, pr); cc.camera.aspect = innerWidth / innerHeight; cc.camera.updateProjectionMatrix(); };
  return 'bench ready';
})()
