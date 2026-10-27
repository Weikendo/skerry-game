import type { Archipelago } from '../world/archipelago';
import type { IslandBase } from '../world/base';
import type { CarrierController } from './carrierController';

/** at sea the crew patches the hull once no hit has come for `after` seconds: `perSecond` hit points, up to `upTo` of the whole */
export const PATCH = { after: 60, perSecond: 4, upTo: 0.6 };
/**
 * At a yard (a base or factory island of its own side, the ship stopped within `range` metres of its coast,
 * `after` seconds after the last hit) the hull is mended to the full, `perSecond` hit points, each for
 * `rawPerHp` raw material from that island's store.
 */
export const YARD = { range: 2000, after: 15, perSecond: 13.3, rawPerHp: 0.5 };

/** what the repair does: nothing, patching at sea, mending at a yard, or a yard out of raw material */
export type RepairKind = '' | 'notreparatur' | 'werft' | 'rohstoff';
export interface RepairState {
  kind: RepairKind;
  /** the yard island lain off (-1: none) and its name */
  yard: number;
  island: string;
}

/** the yard the ship lies at: an own base or factory island near enough (the nearest), -1 when none */
export function yardAt(ship: CarrierController, world: Archipelago, bases: IslandBase[]): number {
  let best = -1, bd = YARD.range;
  bases.forEach((b, k) => {
    if (b.team !== ship.team || (b.island.role !== 'basis' && b.island.role !== 'fabrik')) return;
    const d = world.islands[k].distanceTo(ship.pos.x, ship.pos.z);
    if (d < bd) { bd = d; best = k; }
  });
  return best;
}

/**
 * One step of a carrier's hull repair (both sides' by the same rules). `raw` is its island network's raw
 * material per island; `rate` scales the speed (the difficulty).
 */
export function repairHull(ship: CarrierController, dt: number, world: Archipelago, bases: IslandBase[], raw: number[], rate: number): RepairState {
  if (!ship.alive || ship.hp >= ship.maxHp) return { kind: '', yard: -1, island: '' };
  const yard = Math.abs(ship.speed) < 1 ? yardAt(ship, world, bases) : -1, island = yard >= 0 ? world.islands[yard].name : '';
  if (yard >= 0 && ship.sinceHit >= YARD.after) {
    if (raw[yard] <= 0) return { kind: 'rohstoff', yard, island };
    const mend = Math.min(ship.maxHp - ship.hp, YARD.perSecond * rate * dt, raw[yard] / YARD.rawPerHp);
    raw[yard] -= mend * YARD.rawPerHp;
    ship.hp += mend;
    return { kind: 'werft', yard, island };
  }
  if (ship.sinceHit >= PATCH.after && ship.hp < ship.maxHp * PATCH.upTo) {
    ship.hp = Math.min(ship.maxHp * PATCH.upTo, ship.hp + PATCH.perSecond * rate * dt);
    return { kind: 'notreparatur', yard: -1, island: '' };
  }
  return { kind: '', yard, island };
}
