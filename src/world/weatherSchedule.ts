import type { Environment, WeatherName } from './environment';

// how long a weather stays, in simulation seconds (at 1 game minute per second: game hours)
const STAY: Record<WeatherName, [number, number]> = {
  klar: [480, 900], bewoelkt: [300, 600], nebel: [180, 420], sturm: [120, 300],
};
// what may follow (weights); storms grow out of clouds and blow over into clouds
const NEXT: Record<WeatherName, [WeatherName, number][]> = {
  klar: [['bewoelkt', 0.65], ['nebel', 0.2], ['klar', 0.15]],
  bewoelkt: [['klar', 0.45], ['sturm', 0.3], ['nebel', 0.15], ['bewoelkt', 0.1]],
  nebel: [['klar', 0.55], ['bewoelkt', 0.45]],
  sturm: [['bewoelkt', 0.75], ['klar', 0.25]],
};
/** seconds for a natural weather change to blend in */
const BLEND = 90;

/** a weather change that is coming: what, in how many simulation seconds, and where the wind will blow to */
export interface Forecast { weather: WeatherName; in: number; wind: number }

/**
 * Random weather that changes slowly: sunshine lasts longest, storms are short,
 * fog is likelier in the early morning. The next changes are planned ahead,
 * with the wind each front brings, so the game can forecast them. Picking a
 * weather by hand keeps it for that weather's usual time and plans anew.
 */
export class WeatherSchedule {
  enabled = true;
  /** the next changes, soonest first (always at least two while random weather is on) */
  plan: Forecast[] = [];
  /** how long the current weather stays before the first planned change */
  private left: number;
  /** how far ahead (simulation seconds) the plan reaches: the game sets it to 24 game hours */
  horizon = 1440;

  constructor(private env: Environment, private onChange: (w: WeatherName) => void) {
    this.left = this.duration(env.weather);
    this.extend();
  }

  private duration(w: WeatherName): number {
    const [a, b] = STAY[w];
    return a + Math.random() * (b - a);
  }

  /** plan until two changes are known */
  private extend() {
    while (this.plan.length < 2 || (this.plan[this.plan.length - 1].in < this.horizon && this.plan.length < 40)) {
      const last = this.plan[this.plan.length - 1];
      let from = last?.weather ?? this.env.weather;
      let at = last ? last.in + this.duration(last.weather) : this.left;
      const wind = last?.wind ?? this.env.windTarget;
      // a weather may follow itself: then it simply lasts longer
      for (let guard = 0; guard < 20; guard++) {
        const hour = (this.env.time + at * (this.env.timeSpeed || 1 / 60)) % 24, morning = hour > 4.5 && hour < 9;
        const options = NEXT[from].map(([w, p]) => [w, w === 'nebel' && morning ? p * 3 : p] as [WeatherName, number]);
        let r = Math.random() * options.reduce((a, [, p]) => a + p, 0);
        let next = options[0][0];
        for (const [w, p] of options) { r -= p; if (r <= 0) { next = w; break; } }
        if (next !== from) { from = next; break; }
        at += this.duration(from);
      }
      // a front brings a new wind: up to a quarter turn, in a storm more
      const turn = (Math.random() * 2 - 1) * Math.PI / 2 * (from === 'sturm' ? 1.4 : 1);
      this.plan.push({ weather: from, in: at, wind: wind + turn });
    }
  }

  /** the player chose a weather: it stays its usual time, then the schedule plans anew */
  restart() {
    this.left = this.duration(this.env.weather);
    this.plan = [];
    this.extend();
  }

  get remaining(): number { return this.plan[0]?.in ?? this.left; }

  /** of all weathers planned between `from` and `to` seconds from now, the one with the strongest wind */
  strongest(from: number, to: number, wind: (w: WeatherName) => number): { weather: WeatherName; wind: number } {
    let best = this.at(from);
    if (!this.enabled) return best;
    for (const f of this.plan) {
      if (f.in <= from) continue;
      if (f.in >= to) break;
      if (wind(f.weather) > wind(best.weather)) best = { weather: f.weather, wind: f.wind };
    }
    return best;
  }

  /** the weather and where its wind blows to `seconds` from now (as planned) */
  at(seconds: number): { weather: WeatherName; wind: number } {
    let weather = this.env.weather, wind = this.env.windTarget;
    if (!this.enabled) return { weather, wind };
    this.extend();
    for (const f of this.plan) {
      if (f.in > seconds) break;
      weather = f.weather; wind = f.wind;
    }
    return { weather, wind };
  }

  update(dt: number) {
    if (!this.enabled) return;
    for (const f of this.plan) f.in -= dt;
    const next = this.plan[0];
    if (!next || next.in > 0) return;
    this.plan.shift();
    this.env.setWeather(next.weather, false, BLEND, next.wind);
    this.onChange(next.weather);
    this.left = 0;
    this.extend();
  }

  // ---- save game ----
  saveState() { return { left: this.left, enabled: this.enabled, plan: this.plan.map(f => ({ ...f })) }; }
  loadState(s: ReturnType<WeatherSchedule['saveState']>) {
    this.left = s.left; this.enabled = s.enabled;
    this.plan = s.plan ? s.plan.map(f => ({ ...f })) : [];
    if (!this.plan.length) this.extend();
  }
}
