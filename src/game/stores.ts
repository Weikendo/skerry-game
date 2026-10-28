import { SHIP_NAME } from './names';
import { t } from '../i18n';
/**
 * Goods of the island network and the carrier's hold, with the original's
 * production table:
 * one order takes (steps + 2) × 4 s, every step costs `rawPerStep` from the
 * factory island's own store and the order yields `pieces`.
 *
 * Fuel counts in the original's display units: a carrier tank holds 256, a
 * vehicle tank 8; one fuel order yields 8. The remake's camera drone is built
 * like the original's remote viewing drone.
 *
 * One change against the original: an order of carrier fuel yields 32. The
 * remake's sea is about 23 times smaller, so a tank lasts 18 km instead of
 * 419 km while production kept the original's times; with 8 the base alone
 * made a fifth of what the ship burns at full speed. 32 lets the base keep up
 * with half speed, and a few conquered islands make fuel plentiful again.
 */
/** carrier fuel per order (original 8, see above) */
const CARRIER_FUEL_ORDER = 32;
export type Good = 'treibstoffTraeger' | 'treibstoffWalrus' | 'treibstoffManta' | 'accb' | 'assassin' | 'harbinger' | 'quaker' | 'quasar' | 'avatar'
  | 'funk' | 'virus' | 'tank' | 'walrus' | 'manta' | 'drohne' | 'taeuschkoerper' | 'abwehrdrohne' | 'hammerhead' | 'beobachtungsdrohne';

export interface GoodDef {
  name: string;
  /** short form for messages */
  short: string;
  unit: string;
  pieces: number;
  steps: number;
  rawPerStep: number;
  /** in the carrier's hold at the start, and the most it takes */
  start: number;
  cap: number;
  fuel?: boolean;
}

/** one tank of the carrier in fuel units; vehicles hold 8 */
export const CARRIER_TANK = 256;
export const VEHICLE_TANK = 8;

export const GOODS: Record<Good, GoodDef> = {
  treibstoffTraeger: { name: t('good.treibstoffTraeger', { ship: SHIP_NAME }), short: t('good.treibstoffTraeger.short'), unit: t('goodUnit.fuel', { tank: 256 }), pieces: CARRIER_FUEL_ORDER, steps: 10, rawPerStep: 100, start: 256, cap: 256, fuel: true },
  treibstoffWalrus: { name: t('good.treibstoffWalrus'), short: t('good.treibstoffWalrus.short'), unit: t('goodUnit.fuel', { tank: 8 }), pieces: 8, steps: 10, rawPerStep: 100, start: 256, cap: 256, fuel: true },
  treibstoffManta: { name: t('good.treibstoffManta'), short: t('good.treibstoffManta.short'), unit: t('goodUnit.fuel', { tank: 8 }), pieces: 8, steps: 10, rawPerStep: 100, start: 256, cap: 256, fuel: true },
  accb: { name: t('good.accb'), short: t('good.accb.short'), unit: t('goodUnit.piece'), pieces: 1, steps: 40, rawPerStep: 150, start: 4, cap: 12 },
  assassin: { name: t('good.assassin'), short: t('good.assassin.short'), unit: t('goodUnit.perOrder', { n: 4 }), pieces: 4, steps: 15, rawPerStep: 100, start: 32, cap: 64 },
  harbinger: { name: t('good.harbinger'), short: t('good.harbinger.short'), unit: t('goodUnit.perOrder', { n: 3 }), pieces: 3, steps: 25, rawPerStep: 100, start: 24, cap: 50 },
  quaker: { name: t('good.quaker'), short: t('good.quaker.short'), unit: t('goodUnit.piece'), pieces: 1, steps: 40, rawPerStep: 150, start: 8, cap: 16 },
  quasar: { name: t('good.quasar'), short: t('good.quasar.short'), unit: t('goodUnit.piece'), pieces: 1, steps: 15, rawPerStep: 100, start: 4, cap: 16 },
  avatar: { name: t('good.avatar'), short: t('good.avatar.short'), unit: t('goodUnit.shots', { n: 40 }), pieces: 1, steps: 15, rawPerStep: 100, start: 4, cap: 16 },
  funk: { name: t('good.funk'), short: t('good.funk.short'), unit: t('goodUnit.perOrder', { n: 2 }), pieces: 2, steps: 15, rawPerStep: 50, start: 2, cap: 4 },
  virus: { name: t('good.virus'), short: t('good.virus.short'), unit: t('goodUnit.perOrder', { n: 2 }), pieces: 2, steps: 20, rawPerStep: 100, start: 8, cap: 16 },
  tank: { name: t('good.tank'), short: t('good.tank.short'), unit: t('goodUnit.piece'), pieces: 1, steps: 10, rawPerStep: 100, start: 4, cap: 12 },
  walrus: { name: t('good.walrus'), short: t('good.walrus.short'), unit: t('goodUnit.piece'), pieces: 1, steps: 30, rawPerStep: 100, start: 4, cap: 4 },
  manta: { name: t('good.manta'), short: t('good.manta.short'), unit: t('goodUnit.piece'), pieces: 1, steps: 30, rawPerStep: 100, start: 4, cap: 4 },
  drohne: { name: t('good.drohne'), short: t('good.drohne.short'), unit: t('goodUnit.perOrder', { n: 2 }), pieces: 2, steps: 15, rawPerStep: 50, start: 4, cap: 8 },
  // the carrier's decoy flares (src/game/decoys.ts)
  taeuschkoerper: { name: t('good.taeuschkoerper'), short: t('good.taeuschkoerper.short'), unit: t('goodUnit.perOrder', { n: 5 }), pieces: 5, steps: 10, rawPerStep: 25, start: 16, cap: 32 },
  // its defence drones (src/game/defenceDrones.ts)
  abwehrdrohne: { name: t('good.abwehrdrohne'), short: t('good.abwehrdrohne.short'), unit: t('goodUnit.perOrder', { n: 2 }), pieces: 2, steps: 10, rawPerStep: 25, start: 12, cap: 24 },
  // its Hammerhead missiles and their observation drones (src/game/hammerhead.ts; the drone has the original's values,
  // which the remake's camera drone above borrowed as well)
  hammerhead: { name: t('good.hammerhead'), short: t('good.hammerhead.short'), unit: t('goodUnit.piece'), pieces: 1, steps: 40, rawPerStep: 180, start: 4, cap: 12 },
  beobachtungsdrohne: { name: t('good.beobachtungsdrohne'), short: t('good.beobachtungsdrohne.short'), unit: t('goodUnit.perOrder', { n: 2 }), pieces: 2, steps: 15, rawPerStep: 50, start: 4, cap: 8 },
};
export const GOOD_LIST = Object.keys(GOODS) as Good[];
/** what the player's network makes and stores: the built-in weapons (Avatar, Quasar) and the retired Harbinger are left out */
export const PLAYER_GOODS = GOOD_LIST.filter(g => g !== 'avatar' && g !== 'quasar');
export const FUELS = GOOD_LIST.filter(g => GOODS[g].fuel);
/** the network keeps two carrier tanks of every fuel in stock (fixed in the original) */
export const FUEL_TARGET = 2 * CARRIER_TANK;

export type Stores = Record<Good, number>;

export function emptyStores(): Stores {
  return Object.fromEntries(GOOD_LIST.map(g => [g, 0])) as Stores;
}

/** the carrier's hold at the start: the original's start column, all fuels full */
export function startStores(): Stores {
  return Object.fromEntries(GOOD_LIST.map(g => [g, GOODS[g].start])) as Stores;
}
