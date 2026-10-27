import { PAL } from '../engine/palette';
import type { Archipelago } from '../world/archipelago';
import type { JobView, ShipmentView } from '../game/economy';
import { GOODS } from '../game/stores';
import { t } from '../i18n';

/**
 * Wording and colours for the island network's work, shared by the map and
 * the supply screen: what an order makes, what a shipment carries, how long
 * it still takes.
 */

/** seconds as m:ss */
export function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function cargoText(v: Pick<ShipmentView, 'kind' | 'good' | 'count'>): string {
  if (v.kind === 'raw') return t('net.raw', { n: v.count });
  if (v.kind === 'material') return t('net.material', { n: v.count });
  const g = GOODS[v.good!];
  const cargo = g.fuel ? t('goods.fuelAmount', { n: Math.round(v.count), good: g.short }) : t('goods.count', { n: v.count, good: g.short });
  return v.kind === 'move' ? t('net.move', { cargo }) : cargo;
}

export function jobText(j: JobView, world: Archipelago): string {
  if (j.material !== null) return t('net.materialFor', { island: world.islands[j.material].name });
  const g = GOODS[j.good!];
  return g.fuel ? t('goods.fuelAmount', { n: j.pieces, good: g.short }) : t('goods.count', { n: j.pieces, good: g.short });
}

export function jobState(j: JobView): string {
  return j.waiting === 'raw' ? t('net.waitRaw') : j.waiting === 'transport' ? t('net.waitTransport') : t('net.done', { time: clock(j.eta) });
}

export function arrival(v: ShipmentView): string {
  if (isNaN(v.eta)) return t('net.noRoute');
  return v.from === null && v.at === v.dest ? t('net.unloading') : clock(v.eta);
}

/** raw material brown, building material ochre, fuel green (like the stockpile), other goods white */
export function cargoColor(v: Pick<ShipmentView, 'kind' | 'good'>): string {
  if (v.kind === 'raw') return PAL.erde;
  if (v.kind === 'material') return PAL.ocker;
  return v.good && GOODS[v.good].fuel ? '#5fd6ab' : PAL.weiss;
}
