import { SLOPE } from '../world/terrain';
import type { CarrierController } from '../game/carrierController';
import type { Walrus } from '../game/walrus';
import type { Manta } from '../game/manta';
import type { Drone } from '../game/drone';
import { SHIP_NAME } from '../game/names';
import type { GlyphName } from './glyphs';
import { t, num, pct } from '../i18n';

export type Vehicle = 'traeger' | 'walrus' | 'manta' | 'drohne';
/** the units currently picked for each kind (the HUD shows the active one) */
export interface Units { carrier: CarrierController; walrus: Walrus; manta: Manta; drohne: Drone }
/** every unit of the carrier: 4 Walrus and 4 Manta as in the original */
export interface Fleet { carrier: CarrierController; walruses: Walrus[]; mantas: Manta[]; drone: Drone }
/** a single unit: 'traeger', 'drohne', 'walrus0' … 'walrus3', 'manta0' … 'manta3' */
export type UnitId = string;
export const kindOf = (id: UnitId): Vehicle => (id.startsWith('walrus') ? 'walrus' : id.startsWith('manta') ? 'manta' : id) as Vehicle;
export const indexOf = (id: UnitId): number => Number(id.replace(/\D/g, '')) || 0;
export const unitIdOf = (kind: Vehicle, i: number): UnitId => (kind === 'walrus' || kind === 'manta' ? `${kind}${i}` : kind);
export function fleetIds(f: Fleet): UnitId[] {
  return ['traeger', 'drohne', ...f.walruses.map((_, i) => `walrus${i}`), ...f.mantas.map((_, i) => `manta${i}`)];
}
export function unitName(f: Fleet, id: UnitId): string {
  const k = kindOf(id), i = indexOf(id);
  return k === 'traeger' ? SHIP_NAME : k === 'drohne' ? t('drone.name') : k === 'walrus' ? f.walruses[i].name : f.mantas[i].name;
}

const KN = 1.943844, DEG = 180 / Math.PI;

/** compass bearing in degrees (0 = north = -z, 90 = east = +x) */
export function bearing(heading: number): number {
  const deg = Math.atan2(Math.sin(heading), -Math.cos(heading)) * DEG;
  return (deg + 360) % 360;
}

export function slopeClass(deg: number): { name: string; color: string } {
  if (deg <= SLOPE.BUILD) return { name: t('slope.build'), color: '#3fbf5f' };
  if (deg <= SLOPE.DRIVE) return { name: t('slope.drive'), color: '#e8d24a' };
  if (deg <= SLOPE.STEEP) return { name: t('slope.steep'), color: '#ef8a2e' };
  return { name: t('slope.blocked'), color: '#d0342c' };
}


/** Beaufort: upper limits of the forces 0 … 11 in m/s */
const BEAUFORT = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
/** "Wind 19 kn aus NW · Bft 5" for a wind vector (m/s, x east, z south) */
export function windText(x: number, z: number): string {
  const ms = Math.hypot(x, z);
  if (ms < 0.5) return t('wind.calm');
  const points = t('compass.points').split(',');
  const from = points[Math.round(bearing(Math.atan2(-x, -z)) / 45) % 8];
  const bft = BEAUFORT.findIndex(v => ms < v);
  return t('wind.label', { kn: num(ms * KN), from, bft: bft < 0 ? 12 : bft });
}
/** a small weather symbol (sun, cloud, fog, storm) for the map */
export function weatherIcon(id: string): string {
  const cloud = '<path d="M4.5 11a3.5 3.5 0 0 1 .3-7A4.5 4.5 0 0 1 13.5 5a3 3 0 0 1-.3 6z"/>';
  const body = id === 'klar' ? '<circle cx="9" cy="6" r="3.3"/><path d="M9 0v1.6M9 10.4V12M3 6H1.4M16.6 6H15M4.8 1.8l1.1 1.1M12.1 9.1l1.1 1.1M4.8 10.2l1.1-1.1M12.1 2.9l1.1-1.1" stroke="currentColor" stroke-width="1.2" fill="none"/>'
    : id === 'nebel' ? '<rect x="1" y="2" width="16" height="1.6" rx=".8"/><rect x="3" y="5.2" width="14" height="1.6" rx=".8"/><rect x="1" y="8.4" width="13" height="1.6" rx=".8"/>'
      : id === 'sturm' ? cloud + '<path d="M9.5 7.5 7.5 11h2l-1 3 3.5-4.5h-2l1-2z" fill="#f2c21b"/>' : cloud;
  return `<svg class="wxi" viewBox="0 0 18 13">${body}</svg>`;
}

/** "19 kn aus NW" for a wind blowing towards `angle` (x/z plane) at `ms` m/s */
export function windShort(angle: number, ms: number): string {
  if (ms < 0.5) return t('wind.calm');
  const points = t('compass.points').split(',');
  const from = points[Math.round(bearing(Math.atan2(-Math.cos(angle), -Math.sin(angle))) / 45) % 8];
  return t('wx.windShort', { kn: num(ms * KN), from });
}

/** a fuel factor as a change, "+18 %" or "−18 %" */
export const fuelChange = (f: number) => `${f >= 1 ? '+' : '−'}${pct(Math.abs(f - 1))}`;
/** "Gegenwind +18 %", or '' when the wind hardly matters (from the side, or calm) */
export function windEffect(f: number): string {
  if (Math.abs(f - 1) < 0.03) return '';
  return t('wind.effect', { kind: f > 1 ? t('wind.head') : t('wind.tail'), change: fuelChange(f) });
}
/**
 * The keys of the unit in view, over the console. `pad`: the pad is in hand, so its buttons instead, as pictures,
 * with what the speed step is set to now. `capture`: a click into the picture captures the pointer.
 */
export function helpLine(active: Vehicle, u: Units, pad?: PadHelp | null, capture = false, cam: ShipCam = ''): string {
  if (pad) return padLine(active, u, pad, cam);
  // a click into the picture captures the pointer (trackpad / mouse steering), otherwise dragging turns the camera
  const common = t(capture ? 'keys.commonCapture' : 'keys.common');
  if (active === 'traeger') return `${t(cam === 'turret' ? 'keys.turret' : cam === 'observer' ? 'keys.observer' : 'keys.ship')} · ${common}`;
  if (active === 'walrus') {
    if (u.walrus.state !== 'fahren') return `${t('keys.otterAboard')} · ${common}`;
    if (u.walrus.guided) return `${t('keys.harbinger')} · ${common}`;
    return `${t('keys.otter')} · ${common}`;
  }
  if (active === 'drohne') {
    if (!u.drohne.flying) return `${t('keys.droneDeck')} · ${common}`;
    return `${t('keys.drone')} · ${common}`;
  }
  if (u.manta.state === 'flug') return `${t('keys.skua')} · ${common}`;
  if (u.manta.state === 'pad') return `${t('keys.skuaPad')} · ${common}`;
  return `${t('keys.skuaDeck')} · ${common}`;
}

/** the pad's button pictures and the current speed steps (cruise control, drone pace) as text */
export type PadHelp = Record<GlyphName, string> & { cruise: string; pace: string };

/** the ship's cameras with keys of their own: the laser turret's, the observation drone's */
export type ShipCam = '' | 'turret' | 'observer';

function padLine(active: Vehicle, u: Units, g: PadHelp, cam: ShipCam): string {
  const common = t('pad.common', g);
  if (active === 'traeger') return `${t(cam === 'turret' ? 'pad.turret' : cam === 'observer' ? 'pad.observer' : 'pad.ship', g)} · ${common}`;
  if (active === 'walrus') {
    if (u.walrus.state !== 'fahren') return `${t('pad.otterAboard', g)} · ${common}`;
    if (u.walrus.guided) return `${t('pad.harbinger', g)} · ${common}`;
    return `${t('pad.otter', g)} · ${common}`;
  }
  if (active === 'drohne') return `${t(u.drohne.flying ? 'pad.drone' : 'pad.droneDeck', g)} · ${common}`;
  if (u.manta.state === 'flug') return `${t('pad.skua', g)} · ${common}`;
  if (u.manta.state === 'pad') return `${t('pad.skuaPad', g)} · ${common}`;
  return `${t('pad.skuaDeck', g)} · ${common}`;
}
