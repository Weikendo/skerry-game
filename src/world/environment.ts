import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../engine/noise';
import { PAL } from '../engine/palette';
import { t } from '../i18n';

export type WeatherName = 'klar' | 'bewoelkt' | 'nebel' | 'regen' | 'sturm';

export interface WeatherParams {
  cover: number;     // cloud amount 0..1
  dark: number;      // cloud / light darkening 0..1
  fogNear: number;
  fogFar: number;
  sun: number;       // direct light factor
  waves: number;     // wave amplitude factor
  sea: number;       // 0 bright blue sea .. 1 dark slate storm sea (Wind Waker style)
  rain: number;      // 0..1
  wind: number;      // m/s for clouds and rain slant
}

export const WEATHER: Record<WeatherName, WeatherParams> = {
  klar:     { cover: 0.28, dark: 0.0,  fogNear: 400,  fogFar: 11000, sun: 1.0,  waves: 1.0, sea: 0,    rain: 0, wind: 6 },
  bewoelkt: { cover: 0.75, dark: 0.3,  fogNear: 300,  fogFar: 8000,  sun: 0.5,  waves: 1.6, sea: 0.4,  rain: 0, wind: 10 },
  nebel:    { cover: 0.45, dark: 0.15, fogNear: 40,   fogFar: 1300,  sun: 0.35, waves: 0.6, sea: 0.3,  rain: 0, wind: 2 },
  regen:    { cover: 0.95, dark: 0.65, fogNear: 250,  fogFar: 5800,  sun: 0.24, waves: 1.85, sea: 0.7, rain: 0.52, wind: 11 },
  sturm:    { cover: 1.0,  dark: 0.8,  fogNear: 250,  fogFar: 4200,  sun: 0.18, waves: 3.0, sea: 1,    rain: 0.82, wind: 21 },
};

/**
 * Every spell of weather has its own strength (0 mild .. 1 heavy, rolled by the WeatherSchedule): it moves these
 * values between the two ends, from a drizzle to a downpour, from a gale to a heavy storm. The others stay as in
 * WEATHER, which is the middle.
 */
const RANGE: Partial<Record<WeatherName, Partial<Record<keyof WeatherParams, [number, number]>>>> = {
  klar: { cover: [0.15, 0.4], wind: [3, 9] },
  bewoelkt: { cover: [0.6, 0.9], dark: [0.2, 0.42], wind: [6, 14], waves: [1.3, 1.9] },
  nebel: { fogFar: [1800, 800], fogNear: [60, 25] },
  regen: { rain: [0.3, 0.8], dark: [0.58, 0.72], fogFar: [7500, 4200], sun: [0.28, 0.19], waves: [1.5, 2.2], wind: [7, 15] },
  sturm: { rain: [0.65, 1], dark: [0.68, 0.92], fogFar: [5200, 3000], sun: [0.24, 0.12], waves: [2.6, 3.4], wind: [16, 26] },
};
/** a weather's values at a strength 0..1 */
export function weatherAt(name: WeatherName, strength = 0.5): WeatherParams {
  const p = { ...WEATHER[name] };
  for (const [key, [a, b]] of Object.entries(RANGE[name] ?? {}) as [keyof WeatherParams, [number, number]][]) p[key] = lerp(a, b, strength);
  return p;
}

export const WEATHER_LABELS: Record<string, WeatherName> = {
  [t('weather.klar')]: 'klar', [t('weather.bewoelkt')]: 'bewoelkt', [t('weather.nebel')]: 'nebel', [t('weather.regen')]: 'regen', [t('weather.sturm')]: 'sturm',
};
/** the weather's name with its strength where it shows: light or heavy rain, a heavy storm */
export function weatherName(name: WeatherName, strength = 0.5): string {
  if (name === 'regen' && strength < 0.34) return t('weather.regenLeicht');
  if (name === 'regen' && strength > 0.66) return t('weather.regenStark');
  if (name === 'sturm' && strength > 0.66) return t('weather.sturmSchwer');
  return t(`weather.${name}`);
}

interface SkyKey {
  t: number;
  zenith: string; horizon: string;
  light: string; lightI: number;
  hemiSky: string; hemiGround: string; hemiI: number;
}

// Hand-tuned keys over the day; the evening is warmer than the morning.
// Ambient (hemi) is kept fairly strong: low-poly scenes look best with soft,
// coloured shadows rather than black ones. By day the light from below is the
// sea's (cool turquoise), as on the title picture, not the brown of the ground.
// Fog starts near (400 m in clear weather) for a soft haze; fogFar stays the
// game's range of sight.
const KEYS: SkyKey[] = [
  // night and twilight in muted blue-greys and a gold low at the horizon, no violet (the user found them kitschy)
  { t: 0,    zenith: '#070b15', horizon: '#161d2b', light: '#8ea6ff', lightI: 0.45, hemiSky: '#323f5e', hemiGround: '#131824', hemiI: 0.9 },
  { t: 4.8,  zenith: '#0e1528', horizon: '#262d3e', light: '#8ea6ff', lightI: 0.4,  hemiSky: '#36425e', hemiGround: '#151a24', hemiI: 0.9 },
  { t: 5.8,  zenith: '#2e4468', horizon: '#d29a78', light: '#ff9a60', lightI: 0.9,  hemiSky: '#7480a0', hemiGround: '#4a3c34', hemiI: 1.1 },
  { t: 7.0,  zenith: '#4a8ad6', horizon: '#f6c9a0', light: '#ffd0a0', lightI: 1.9,  hemiSky: '#a8c6ee', hemiGround: '#6a6050', hemiI: 1.5 },
  { t: 9.5,  zenith: '#3a86e0', horizon: '#bfe0fa', light: '#fff1de', lightI: 2.5,  hemiSky: '#bcdaf8', hemiGround: '#4a7276', hemiI: 1.7 },
  { t: 14.5, zenith: '#3a86e0', horizon: '#c8e4fa', light: '#fff4e4', lightI: 2.5,  hemiSky: '#bcdaf8', hemiGround: '#4a7276', hemiI: 1.7 },
  { t: 17.3, zenith: '#5a8fd0', horizon: '#f7d9b4', light: '#ffd6a0', lightI: 2.5,  hemiSky: '#a9c8ea', hemiGround: '#4c6a68', hemiI: 1.6 },
  { t: 18.6, zenith: '#6f86ab', horizon: '#f2c08e', light: '#ffb070', lightI: 1.6,  hemiSky: '#c4c4c8', hemiGround: '#6a5446', hemiI: 1.45 },
  { t: 19.4, zenith: '#2e4569', horizon: '#d6a072', light: '#f08a58', lightI: 0.7,  hemiSky: '#6f7488', hemiGround: '#33302f', hemiI: 1.1 },
  { t: 20.4, zenith: '#141c2c', horizon: '#2e3444', light: '#8ea6ff', lightI: 0.4,  hemiSky: '#38425e', hemiGround: '#161a24', hemiI: 0.9 },
  { t: 24,   zenith: '#070b15', horizon: '#161d2b', light: '#8ea6ff', lightI: 0.45, hemiSky: '#323f5e', hemiGround: '#131824', hemiI: 0.9 },
];

const KEY_COLORS = KEYS.map(k => ({
  zenith: new THREE.Color(k.zenith), horizon: new THREE.Color(k.horizon), light: new THREE.Color(k.light),
  hemiSky: new THREE.Color(k.hemiSky), hemiGround: new THREE.Color(k.hemiGround),
}));

const LAT = THREE.MathUtils.degToRad(35);
const DECL = THREE.MathUtils.degToRad(14);
// sky tint for overcast weather (atmosphere, not a surface colour)
const STORM_GREY = new THREE.Color('#5d636c');
const CLOUD = new THREE.Color(PAL.wolke), CLOUD_STORM = new THREE.Color(PAL.wolkeSturm);
const DEEP = new THREE.Color(PAL.wasserTief);
const FOG_GREY = new THREE.Color('#b9c0c6');
// the far sea by day: a light turquoise under the haze
const SEA_HAZE = new THREE.Color('#8ccfd6');
// the horizon away from the sun by day: cool and light (look analysis, measure 8)
const HORIZON_COOL = new THREE.Color('#bcdde6');

export class Environment {
  time = 17.0;          // hours (the title in the afternoon light of the title picture; a new game starts at 11, main.ts START_TIME)
  /** days since the campaign began (the date counts on at midnight) */
  day = 0;
  timeSpeed = 0;        // game hours per real second
  weather: WeatherName = 'klar';
  /** how strong the current weather is, 0..1 (see weatherAt) */
  strength = 0.5;
  readonly w: WeatherParams = { ...WEATHER.klar };
  /** where the weather's values ease to */
  private target: WeatherParams = { ...WEATHER.klar };
  elapsed = 0;
  /**
   * Where the wind blows to, as an angle in the x/z plane (0 = east, π/2 = south);
   * its strength is w.wind (m/s). It wanders slowly and turns when the weather changes.
   */
  windAngle = Math.atan2(0.35, 1);
  windTarget = this.windAngle;
  private windWander = 0;
  /** the wind as a vector (m/s, x east, z south) */
  get windX() { return Math.cos(this.windAngle) * this.w.wind; }
  get windZ() { return Math.sin(this.windAngle) * this.w.wind; }

  readonly sunDir = new THREE.Vector3();
  readonly moonDir = new THREE.Vector3();
  readonly lightDir = new THREE.Vector3();
  readonly lightColor = new THREE.Color();
  lightIntensity = 1;
  readonly zenith = new THREE.Color();
  readonly horizon = new THREE.Color();
  readonly hemiSky = new THREE.Color();
  readonly hemiGround = new THREE.Color();
  hemiIntensity = 1;
  readonly fogColor = new THREE.Color();
  /** the horizon on the side away from the sun (the sky turns from it to `horizon` towards the sun) */
  readonly horizonCool = new THREE.Color();
  sunVisible = 1;
  moonVisible = 0;
  stars = 0;
  readonly cloudColor = new THREE.Color();
  /** colour of the open sea towards the horizon (sky dome below the horizon + ocean fog) */
  readonly seaFar = new THREE.Color();
  /** 0 clear .. 1 dense fog: everything dissolves into the fog colour */
  fogAmount = 0;

  /** `seconds`: how long the change takes (by hand quick, natural changes slow) */
  /** `wind`: where the new weather's wind will blow to (from the forecast); a change by hand turns it at random */
  /** `strength`: how strong it is, 0 mild .. 1 heavy */
  setWeather(name: WeatherName, immediate = false, seconds = 6, wind?: number, strength = 0.5) {
    if (wind !== undefined) this.windTarget = wind;
    else if (!immediate && name !== this.weather) this.windTarget = this.windAngle + (Math.random() * 2 - 1) * Math.PI / 2 * (name === 'sturm' ? 1.4 : 1);
    this.weather = name;
    this.strength = strength;
    this.target = weatherAt(name, strength);
    this.blendTau = seconds / 2.4;
    if (immediate) Object.assign(this.w, this.target);
  }
  private blendTau = 2.5;

  update(dt: number) {
    this.elapsed += dt;
    const hours = this.time + dt * this.timeSpeed;
    if (hours >= 24) this.day++;
    this.time = hours % 24;

    // ease weather parameters towards the target
    const target = this.target;
    const k = 1 - Math.exp(-dt / this.blendTau);
    for (const key of Object.keys(target) as (keyof WeatherParams)[]) this.w[key] = lerp(this.w[key], target[key], k);
    // the wind wanders a little every few minutes and eases towards its new direction
    this.windWander += dt;
    if (this.windWander > 240) { this.windWander = 0; this.windTarget += (Math.random() * 2 - 1) * 0.25; }
    const turn = Math.atan2(Math.sin(this.windTarget - this.windAngle), Math.cos(this.windTarget - this.windAngle));
    this.windAngle += turn * (1 - Math.exp(-dt / 60));

    this.computeSun();
    this.computeColors();
  }

  private computeSun() {
    const h = ((this.time - 12) / 24) * Math.PI * 2;
    const east = -Math.cos(DECL) * Math.sin(h);
    const up = Math.sin(DECL) * Math.sin(LAT) + Math.cos(DECL) * Math.cos(LAT) * Math.cos(h);
    const north = Math.sin(DECL) * Math.cos(LAT) - Math.cos(DECL) * Math.sin(LAT) * Math.cos(h);
    this.sunDir.set(east, up, -north).normalize();
    // the moon roughly opposite, a bit higher so the night is not pitch black
    this.moonDir.set(-east * 0.8, Math.max(-up, 0) * 0.9 + 0.35, north * 0.6 + 0.3).normalize();
  }

  private computeColors() {
    const t = this.time;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].t <= t) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const f = smoothstep(0, 1, (t - a.t) / (b.t - a.t));
    const ca = KEY_COLORS[i], cb = KEY_COLORS[i + 1];
    const w = this.w;

    this.zenith.copy(ca.zenith).lerp(cb.zenith, f);
    this.horizon.copy(ca.horizon).lerp(cb.horizon, f);
    this.lightColor.copy(ca.light).lerp(cb.light, f);
    this.hemiSky.copy(ca.hemiSky).lerp(cb.hemiSky, f);
    this.hemiGround.copy(ca.hemiGround).lerp(cb.hemiGround, f);
    const lightI = lerp(a.lightI, b.lightI, f);
    // three.js uses physical light units (Lambert divides by pi), hence the boost
    this.hemiIntensity = lerp(a.hemiI, b.hemiI, f) * 1.7;

    const sunUp = this.sunDir.y;
    this.sunVisible = smoothstep(-0.06, 0.02, sunUp);
    this.moonVisible = 1 - smoothstep(-0.12, 0.0, sunUp);
    // stars only once it is really dark, and fewer of them shine through (a quieter night)
    this.stars = (1 - smoothstep(-0.24, -0.1, sunUp)) * (1 - w.cover * 0.9) * 0.75;
    this.lightDir.copy(this.sunVisible > 0.5 ? this.sunDir : this.moonDir);
    // keep shadows from going absurdly long near the horizon
    if (this.lightDir.y < 0.08) this.lightDir.setY(0.08).normalize();

    // weather: greyer, darker sky and weaker direct light
    const grey = this.dayness();
    const overcast = clamp(w.cover * 0.55 + w.dark * 0.6, 0, 1);
    const stormTint = STORM_GREY.clone().multiplyScalar(lerp(0.25, 1, grey));
    this.zenith.lerp(stormTint, overcast * 0.85);
    this.horizon.lerp(stormTint.clone().lerp(FOG_GREY.clone().multiplyScalar(lerp(0.25, 1, grey)), 0.5), overcast * 0.75);
    this.lightIntensity = lightI * w.sun;
    this.hemiIntensity *= lerp(1, 1.25, overcast);
    this.hemiSky.lerp(this.horizon, overcast * 0.6);

    this.fogColor.copy(this.horizon);
    // away from the sun the horizon is cool: light by day, a dusky blue-grey (the earth's shadow) at dawn and
    // dusk; at night and under cloud it is the same all round
    const twilight = 1 - smoothstep(0.0, 0.3, Math.abs(sunUp + 0.04));
    const coolTone = HORIZON_COOL.clone().lerp(this.zenith.clone().lerp(FOG_GREY.clone().multiplyScalar(0.45), 0.35), 1 - grey);
    this.horizonCool.copy(this.horizon).lerp(coolTone, Math.min(1, grey * grey + twilight * 0.75) * (1 - overcast) * 0.85);
    this.cloudColor.copy(CLOUD).lerp(CLOUD_STORM, w.dark).lerp(this.horizon, 0.15);

    // far sea: by day in clear weather a light turquoise under the haze; at night and in storms the reflected
    // horizon, a bit darker and bluer than the sky
    this.fogAmount = 1 - smoothstep(1500, 7000, w.fogFar);
    this.seaFar.copy(this.horizon).multiplyScalar(0.85)
      .lerp(DEEP.clone().multiplyScalar(lerp(0.12, 0.95, grey)), 0.55)
      .lerp(this.horizon.clone().lerp(SEA_HAZE, 0.75), grey * (1 - w.sea))
      .lerp(this.horizon, this.fogAmount);
  }

  /** 0 at night, 1 in daylight. */
  dayness(): number {
    return smoothstep(-0.12, 0.15, this.sunDir.y);
  }
}
