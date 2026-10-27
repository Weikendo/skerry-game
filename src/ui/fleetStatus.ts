import { PAL } from '../engine/palette';
import type { Economy } from '../game/economy';
import { FUEL_TARGET } from '../game/stores';
import { GAME_TITLE } from '../game/names';
import { indexOf, kindOf, unitName, weatherIcon, type Fleet, type UnitId, type Vehicle } from './hud';
import { t, km, num } from '../i18n';

/**
 * What the map and the console in the 3D view both show about the fleet: the
 * unit pictograms and line icons, each unit's state and status lamp, and the
 * status bar across the top of the screen.
 */

export const UNIT_COLORS: Record<Vehicle, string> = { traeger: PAL.ockerHell, walrus: PAL.signalOrange, manta: PAL.lichtBlau, drohne: PAL.signalGelb };
export const KN = 1.943844, KMH = 3.6;
/** unit pictograms for the buttons (side view, nose right, drawn in the unit's colour) */
const PICTO: Record<Vehicle, string> = {
  traeger: '<svg viewBox="0 0 24 14"><path d="M1 6h16l6 2.5-5.5 3H2.5z"/><rect x="4" y="2" width="4" height="4"/><rect x="9" y="4" width="1.4" height="2"/></svg>',
  walrus: '<svg viewBox="0 0 24 14"><rect x="2" y="5" width="16" height="5.5" rx="1.5"/><rect x="7" y="2.5" width="6" height="3" rx="1"/><rect x="12" y="3.2" width="9" height="1.4"/><rect x="1.5" y="10" width="17" height="3" rx="1.5" opacity=".65"/></svg>',
  manta: '<svg viewBox="0 0 24 14"><path d="M23 7 13 5.6 6 1.5 7.6 6 2.5 6 1 4 1 10 2.5 8 7.6 8 6 12.5 13 8.4z"/></svg>',
  drohne: '<svg viewBox="0 0 24 14"><rect x="7.5" y="5.5" width="9" height="3" rx="1.5"/><rect x="2" y="6.3" width="20" height="1.4"/><rect x="2" y="2" width="6" height="1.4" rx=".7"/><rect x="16" y="2" width="6" height="1.4" rx=".7"/><rect x="4.4" y="2" width="1.2" height="5"/><rect x="18.4" y="2" width="1.2" height="5"/><rect x="11" y="8.5" width="2" height="3" rx="1"/></svg>',
};
export const picto = (k: Vehicle) => `<span class="picto" style="color:${UNIT_COLORS[k]}">${PICTO[k]}</span>`;
/** line icons for the unit's figures, orders and the screens (24×24, drawn as strokes) */
export const ICON: Record<string, string> = {
  speed: '<svg viewBox="0 0 24 24"><path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4.5-5.5"/><path d="M4 17h3M17 17h3"/></svg>',
  course: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 6.5l3 9-3-2-3 2z"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-6-6.2-6-11a6 6 0 0 1 12 0c0 4.8-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>',
  fuel: '<svg viewBox="0 0 24 24"><rect x="4.5" y="4" width="10" height="16" rx="1.5"/><path d="M4.5 10h10M14.5 8l3.5 2.5V17a1.5 1.5 0 0 0 3 0V9l-3-3"/></svg>',
  battery: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="16" height="10" rx="1.5"/><path d="M21 10.5v3M6.5 10v4M10 10v4"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>',
  home: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><path d="M12 7v13M8 11h8M5 14a7 7 0 0 0 14 0"/></svg>',
  clear: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  centre: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></svg>',
  cockpit: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="12" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8.5 7l1.5-3h4l1.5 3"/></svg>',
  launch: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  land: '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  fit: '<svg viewBox="0 0 24 24"><path d="M14.5 4.5a4.5 4.5 0 0 0-5.3 5.9L3.5 16.1l4.4 4.4 5.7-5.7a4.5 4.5 0 0 0 5.9-5.3l-3 3-3.2-.8-.8-3.2z"/></svg>',
  cargo: '<svg viewBox="0 0 24 24"><path d="M3 8l9-4 9 4v8l-9 4-9-4z"/><path d="M3 8l9 4 9-4M12 12v8"/></svg>',
  hold: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M18 3v4h-4"/></svg>',
  bomb: '<svg viewBox="0 0 24 24"><circle cx="11" cy="14" r="6"/><path d="M15.5 9.5l3-3M17.5 3.5h3v3"/></svg>',
  map: '<svg viewBox="0 0 24 24"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',
  tower: '<svg viewBox="0 0 24 24"><path d="M12 9v12M8 21l4-12 4 12M9.5 15.5h5"/><path d="M8.5 5.5a5 5 0 0 1 7 0M6 3a8.5 8.5 0 0 1 12 0"/><circle cx="12" cy="8.5" r="1"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
};
export const CMD_ICON: Record<string, string> = {
  stop: 'stop', home: 'home', clear: 'clear', centre: 'centre', cockpit: 'cockpit', launch: 'launch', land: 'land', fit: 'fit', cargo: 'cargo', hold: 'hold', bomb: 'bomb', pad: 'land',
};
/** filled icons for the section headers */
export const HEAD_ICON = {
  camera: '<svg viewBox="0 0 16 12"><rect x="0" y="1.5" width="10.5" height="9" rx="1.5"/><path d="M11.5 4.5L16 2v8l-4.5-2.5z"/></svg>',
  fleet: '<svg viewBox="0 0 16 12"><rect x="0" y="0" width="7" height="5" rx="1"/><rect x="9" y="0" width="7" height="5" rx="1"/><rect x="0" y="7" width="7" height="5" rx="1"/><rect x="9" y="7" width="7" height="5" rx="1"/></svg>',
  clock: '<svg viewBox="0 0 16 12"><path d="M4 11a4 4 0 0 1 .4-8A5 5 0 0 1 14 5a3 3 0 0 1-.5 6z"/></svg>',
  islands: '<svg viewBox="0 0 16 12"><path d="M0 12c1.5-3.5 4.5-5.5 8-5.5s6.5 2 8 5.5z"/><rect x="7.3" y="0" width="1.4" height="7"/><path d="M8.7 0.3l4 1.4-4 1.4z"/></svg>',
  screens: '<svg viewBox="0 0 16 12"><rect x="0" y="0" width="16" height="9.5" rx="1.2"/><rect x="5" y="10.5" width="6" height="1.5"/></svg>',
};
const LOGO = '<svg viewBox="0 0 24 14"><path d="M0 13 7 3l3 4 4-6 10 12z"/></svg>';
/** meter colour for a share that should be high (tank, armour) */
export const meterColour = (v: number) => (v > 0.35 ? '#5fd6ab' : v > 0.15 ? '#f2c21b' : '#ef5a4a');

/** N, NE, E … in the language's letters */
export const POINTS = t('compass.points').split(',');
export const pad3 = (n: number) => String(Math.round(n) % 360).padStart(3, '0');
/** "12,3 km W · 4,5 km N" from the archipelago's middle */
export function posText(x: number, z: number): string {
  return `${km(Math.abs(x))} ${x < 0 ? POINTS[6] : POINTS[2]} · ${km(Math.abs(z))} ${z > 0 ? POINTS[4] : POINTS[0]}`;
}

export type Lamp = { cls: string; why: string };

/** the fleet's units as the screens describe them */
export class FleetStatus {
  /** hit points seen last time and until when a unit's lamp flashes after a hit */
  private lastHp = new Map<UnitId, number>();
  private hitUntil = new Map<UnitId, number>();

  constructor(private fleet: Fleet) {}

  unit(u: UnitId) {
    const k = kindOf(u), i = indexOf(u), f = this.fleet;
    return { k, c: f.carrier, w: f.walruses[i], m: f.mantas[i], d: f.drone };
  }
  name(u: UnitId): string { return unitName(this.fleet, u); }
  color(u: UnitId): string { return UNIT_COLORS[kindOf(u)]; }

  /** away from the ship (and on its own radio link) */
  isOut(u: UnitId): boolean {
    const { k, w, m, d } = this.unit(u);
    return k === 'walrus' ? w.state === 'fahren' : k === 'manta' ? m.state !== 'deck' && m.state !== 'start' && m.state !== 'absturz' : k === 'drohne' ? d.flying : false;
  }

  /** short state for the unit buttons */
  shortState(u: UnitId): string {
    const { k, c, w, m, d } = this.unit(u);
    if (k === 'traeger') return `${num(Math.abs(c.speed) * KN)} kn`;
    if (k === 'walrus') return ({ dock: t('map.s.dock'), aussetzen: t('map.s.launching'), andocken: t('map.s.docking'), zerstoert: t('map.s.destroyed') } as Record<string, string>)[w.state]
      ?? (w.medium === 'land' ? t('map.s.land') : t('map.s.water'));
    if (k === 'manta') return ({ deck: t('map.s.hangar'), start: t('map.s.start'), landung: t('map.s.landing'), absturz: t('map.s.lost'), pad: t('map.s.pad'), padland: t('map.s.landing'), padstart: t('map.s.start') } as Record<string, string>)[m.state] ?? `${num(m.altitude)} m`;
    return ({ deck: t('map.s.pad'), start: t('map.s.start'), rueckkehr: t('map.s.return'), zerstoert: t('map.s.lost') } as Record<string, string>)[d.state] ?? `${num(d.altitude)} m`;
  }

  /** the unit's state in words for the cards */
  stateText(u: UnitId): string {
    const { k, c, m, d } = this.unit(u);
    if (k === 'traeger') return c.grounded ? t('lamp.aground') : Math.abs(c.speed) > 0.3 ? t('st.underway') : t('st.stopped');
    if (k === 'manta' && (m.state === 'flug' || m.state === 'landung' || m.state === 'padland' || m.state === 'padstart')) return t('st.flying', { alt: num(m.altitude) });
    if (k === 'manta' && m.state === 'pad' && m.pad) return `${t('map.s.pad')} ${m.pad.name}`;
    if (k === 'drohne' && d.flying) return t('st.flying', { alt: num(d.altitude) });
    return this.shortState(u);
  }

  /** the status lamp: green fine (dim aboard), yellow short of something, red bad, flashing red after a hit;
   *  `track` notes the hit points to spot the next hit */
  lamp(u: UnitId, now: number, track = true): Lamp {
    const { k, c, w, m, d } = this.unit(u);
    const v = k === 'traeger' ? c : k === 'walrus' ? w : k === 'manta' ? m : d;
    const prev = this.lastHp.get(u);
    if (track) {
      this.lastHp.set(u, v.hp);
      if (prev !== undefined && v.hp < prev - 0.5) this.hitUntil.set(u, now + 2.5);
    }
    if ((k === 'walrus' && w.state === 'zerstoert') || (k === 'manta' && m.state === 'absturz') || (k === 'drohne' && d.state === 'zerstoert')) {
      return { cls: 'off', why: t('lamp.lost') };
    }
    if ((this.hitUntil.get(u) ?? 0) > now) return { cls: 'hit', why: t('lamp.hit') };
    const out = k === 'traeger' || (k === 'walrus' ? w.state === 'fahren' : k === 'manta' ? m.state === 'flug' || m.state === 'landung' || m.state === 'padland' || m.state === 'padstart' : d.flying);
    const bad: string[] = [], warn: string[] = [];
    const check = (val: number, lo: number, hi: number, why: string) => { if (val < lo) bad.push(why); else if (val < hi) warn.push(why); };
    check(v.hp / v.maxHp, 0.3, 0.6, t('lamp.lowArmour'));
    if (k === 'traeger') { check(c.fuel, 0.15, 0.35, t('lamp.lowFuel')); if (c.grounded) warn.push(t('lamp.aground')); }
    else if (out) {
      if (k === 'drohne') check(d.battery, 0.25, 0.5, t('lamp.lowBattery')); else check(k === 'walrus' ? w.fuel : m.fuel, 0.15, 0.35, t('lamp.lowFuel'));
      check(k === 'walrus' ? w.signal : k === 'manta' ? m.signal : d.signal, 0.25, 0.6, t('lamp.weakSignal'));
    } else if (v.hp < v.maxHp) warn.push(t('lamp.repair'));
    if (bad.length) return { cls: 'bad', why: [...bad, ...warn].join(' · ') };
    if (warn.length) return { cls: 'warn', why: warn.join(' · ') };
    return out ? { cls: 'ok', why: t('lamp.ok') } : { cls: 'idle', why: t('lamp.aboard') };
  }

  /** where the unit is (aboard: where the ship is) */
  unitPos(u: UnitId): { x: number; z: number; heading: number; visible: boolean } {
    const { k, c, w, m, d } = this.unit(u);
    if (k === 'walrus' && w.state === 'fahren') return { x: w.pos.x, z: w.pos.z, heading: w.heading, visible: true };
    if (k === 'manta' && m.state !== 'deck' && m.state !== 'start' && m.state !== 'absturz') return { x: m.pos.x, z: m.pos.z, heading: m.yaw, visible: true };
    if (k === 'drohne' && d.flying) return { x: d.pos.x, z: d.pos.z, heading: d.yaw, visible: true };
    return { x: c.pos.x, z: c.pos.z, heading: c.heading, visible: k === 'traeger' };
  }

  waypointOf(u: UnitId): { x: number; y: number } | null {
    const { k, c, w, m, d } = this.unit(u);
    return k === 'traeger' ? c.waypoint : k === 'walrus' ? w.waypoint : k === 'manta' ? m.waypoint : d.waypoint;
  }

  /** the unit's radio link to the ship: lamp class and word */
  funk(u: UnitId): [string, string] {
    const { k, w, m, d } = this.unit(u);
    if (k === 'traeger') return ['ok', t('top.funkShip')];
    if (!this.isOut(u)) return ['ok', t('top.funkAboard')];
    const sig = k === 'walrus' ? w.signal : k === 'manta' ? m.signal : d.signal;
    return sig > 0.6 ? ['ok', t('top.funkGood')] : sig > 0.25 ? ['warn', t('top.funkWeak')] : ['bad', t('top.funkLost')];
  }
}

/** time, date and weather (with its id for the icon) and the enemy's carrier (lamp class, words) for the status bar */
export interface StatusInfo { time: string; date: string; weather: string; weatherId: string; enemy: { cls: string; text: string } }

/**
 * The status bar across the top: the operation and what the screen adds on the
 * left (sector and position on the map, the camera in the 3D view), then the
 * radio link of the unit in view, supplies, the ship's tank, weather and time.
 */
export class TopBar {
  readonly el: HTMLDivElement;
  private f: Record<'enemy' | 'funk' | 'supply' | 'wx' | 'clock', HTMLElement>;

  /** `left`: the screen's own fields after the operation's name */
  constructor(left: string) {
    this.el = document.createElement('div');
    this.el.className = 'maptop';
    this.el.innerHTML = `<div class="tl"><span class="tlogo">${LOGO}${t('top.operation', { title: GAME_TITLE })}</span>${left}</div>
      <div class="tr"><span class="tenemy"></span><i class="tsep"></i><span class="tfunk"></span><i class="tsep"></i><span class="tsupply"></span><i class="tsep"></i><span class="twx"></span><i class="tsep"></i><span class="tclock"></span></div>`;
    const q = (c: string) => this.el.querySelector<HTMLElement>(c)!;
    this.f = { enemy: q('.tenemy'), funk: q('.tfunk'), supply: q('.tsupply'), wx: q('.twx'), clock: q('.tclock') };
  }

  /** a field of the left part, by its class */
  field(cls: string): HTMLElement { return this.el.querySelector<HTMLElement>(`.tl .${cls}`)!; }

  update(fs: FleetStatus, u: UnitId, economy: Economy | undefined, st: StatusInfo) {
    const funk = fs.funk(u), F = this.f;
    F.enemy.innerHTML = `${t('top.enemy')}<i class="tdot ${st.enemy.cls}"></i><b>${st.enemy.text}</b>`;
    F.funk.innerHTML = `${t('top.funk')}<i class="tdot ${funk[0]}"></i><b>${funk[1]}</b>`;
    const stock = economy ? Math.round(economy.stockpileGoods.treibstoffTraeger) : 0;
    F.supply.innerHTML = `${t('top.supply')} <b class="tv">${stock} / ${FUEL_TARGET}</b>`;
    F.wx.innerHTML = `${t('top.weather')} ${weatherIcon(st.weatherId)}<b>${st.weather}</b>`;
    F.clock.innerHTML = `<b>${st.time}</b><small>${st.date}</small>`;
  }
}
