import { ROLE_NAMES, type IslandRole } from '../world/worldgen';
import type { Good, Stores } from './stores';
import { t } from '../i18n';

/**
 * Weapons and cargo. Hit points and damage follow the original; the fitting
 * is simpler: every vehicle
 * has its weapons built in (the Otter its Avatar laser, the Skua its Quasar
 * laser and an Assassin under each wing, refilled from the hold), and the
 * player only picks what it carries, before it starts.
 */

// ---- hit points and damage (original units) ----
export const HP = { vehicle: 4000, drone: 1200, carrier: 4000 };
/** the hull takes 3/16 of every hit, the rest goes to the (not yet modelled) sections */
export const CARRIER_HULL_SHARE = 3 / 16;
export const DAMAGE = {
  quasar: 256, avatar: 768, assassin: 1024, harbinger: 3072, quaker: 512,
  /**
   * The Hammerhead: the original's carrier missile does 512, half an Assassin, which would make the dearest weapon
   * (7200 raw material) the weakest. It takes the 2560 of the original's other sea-target missile (blue bunkers'):
   * 480 off a carrier's hull, nine hits to sink one, two for a command centre.
   */
  hammerhead: 2560,
  /**
   * The remake's gun turrets fire shells, the original's fire flak missiles
   * (2048). A burst of 3 shells makes half of one, so a Walrus under fire lasts
   * about as long as before the switch to the original's hit points.
   */
  turretShell: 341,
};
/** below this share of its hit points a vehicle leaks fuel (12.5 %) */
export const LEAK_BELOW = 0.125;
/** hangar repair: 400 hit points per 10 s, shared by all vehicles in repair */
export const REPAIR_PER_SECOND = 40;
export const AVATAR_SHOTS = 40;
/** Harbinger: wire-guided, steered by the player through a picture-in-picture view */
export const HARBINGER = { range: 500, speed: 45, turn: 0.9, maxLoad: 4 };
/**
 * Hammerhead sea-target missile, guided through an observation drone: thrown out backwards from the stern at
 * `launch` m/s, after `coast` s it turns towards its target (rad/s, faster while still slow) and speeds up to `speed`;
 * it skims the sea at `cruise` m and crosses land `overLand` m above the ground ahead, diving onto its target in the
 * last `dive` m; its drone keeps it on the target while that is within `reach` of it. On its way in it weaves from
 * side to side (`weave` rad either way, `beat` rad/s, fading out in the dive), so a laser turret leading it in a
 * straight line misses more often: flying straight, the Stoorworm's turret shot down every one.
 */
export const HAMMERHEAD = { launch: 60, coast: 0.9, turn: 1.1, speed: 240, cruise: 20, overLand: 16, dive: 450, reach: 7000, life: 45, weave: 0.12, beat: 2.6 };
/** Quaker cluster bomb: bounces up to 4 times on land, sinks in water */
export const QUAKER = { bounces: 4, radius: 26 };

// ---- payload ----
export type WalrusWeapon = 'avatar' | 'harbinger' | null;
export type WalrusCargo = 'accb' | 'virus' | 'tank' | null;
export interface WalrusLoad {
  weapon: WalrusWeapon;
  /** shots left in the Avatar, missiles left in the Harbinger launcher */
  ammo: number;
  cargo: WalrusCargo;
  /** what the ACCB will build (chosen in the hangar, as in the original) */
  role: Exclude<IslandRole, 'basis'>;
}
export type MantaCentre = 'quasar' | 'quaker' | 'assassin3' | 'funk' | null;
export interface MantaLoad {
  /** Assassins under each wing (0..2), and what hangs in the middle */
  left: number;
  right: number;
  centre: MantaCentre;
}


export const WEAPON_NAMES: Record<Exclude<WalrusWeapon, null>, string> = { avatar: t('gear.avatar'), harbinger: t('gear.harbinger') };
export const CARGO_NAMES: Record<Exclude<WalrusCargo, null>, string> = { accb: t('gear.accb'), virus: t('gear.virus'), tank: t('gear.tank') };
export const CENTRE_NAMES: Record<Exclude<MantaCentre, null>, string> = { quasar: t('gear.quasar'), quaker: t('gear.quaker'), assassin3: t('gear.assassin3'), funk: t('gear.funk') };

export const emptyWalrusLoad = (): WalrusLoad => ({ weapon: null, ammo: 0, cargo: null, role: 'rohstoff' });
export const emptyMantaLoad = (): MantaLoad => ({ left: 0, right: 0, centre: null });

// ---- what the player picks: the cargo (the weapons are built in) ----
type Role = Exclude<IslandRole, 'basis'>;
/** the Otter with its built-in Avatar and the given cargo */
export const otterFit = (cargo: WalrusCargo = null, role: Role = 'rohstoff'): WalrusLoad => ({ weapon: 'avatar', ammo: AVATAR_SHOTS, cargo, role });
/** what the player picks for a Skua: nothing, the Quaker bomb, or a second Assassin under each wing (the radio pod
 *  is the drone's now) */
export type SkuaCargo = 'raketen' | 'quaker' | null;
/** the Skua with its built-in Quasar, an Assassin under each wing and the given cargo (with 'raketen' two under each wing) */
export const skuaFit = (cargo: SkuaCargo = null): MantaLoad => cargo === 'raketen' ? { left: 2, right: 2, centre: null } : { left: 1, right: 1, centre: cargo };
/** the cargo a Skua's fitting stands for */
export const skuaCargoOf = (fit: MantaLoad): SkuaCargo => fit.left > 1 || fit.right > 1 ? 'raketen' : fit.centre === 'quaker' ? 'quaker' : null;
/** the Otter's cargo choices in the order the card steps through them */
export const OTTER_CARGO: { cargo: WalrusCargo; role: Role }[] = [
  { cargo: null, role: 'rohstoff' }, { cargo: 'accb', role: 'rohstoff' }, { cargo: 'accb', role: 'fabrik' }, { cargo: 'accb', role: 'verteidigung' },
  { cargo: 'virus', role: 'rohstoff' }, { cargo: 'tank', role: 'rohstoff' },
];
/** the Skua's cargo choices in the order the card steps through them (testers asked for four missiles) */
export const SKUA_CARGO: SkuaCargo[] = [null, 'raketen', 'quaker'];
/** what an Otter carries, for cards and messages */
export function otterCargoName(cargo: WalrusCargo, role: Role): string {
  return cargo === 'accb' ? t('load.accbRole', { role: ROLE_NAMES[role] }) : cargo ? CARGO_NAMES[cargo] : t('load.none');
}
/** a Skua's cargo, for cards and messages */
export function skuaCargoName(cargo: SkuaCargo): string {
  return cargo === 'raketen' ? t('load.missiles4') : cargo ? CENTRE_NAMES[cargo] : t('load.none');
}
/** the goods a Skua's cargo takes from the hold: the bomb, or the Assassins beyond one under each wing */
export function skuaCargoGoods(l: MantaLoad): Partial<Record<Good, number>> {
  const g: Partial<Record<Good, number>> = {}, extra = Math.max(0, l.left - 1) + Math.max(0, l.right - 1);
  if (extra) g.assassin = extra;
  if (l.centre === 'quaker') g.quaker = 1;
  return g;
}
/** saves from before the simple fitting: the Quasar and the Assassin rack are no cargo any more, the Harbinger is gone */
export function normaliseOtter(l: WalrusLoad, fit: boolean): WalrusLoad {
  return { ...l, weapon: 'avatar', ammo: fit ? AVATAR_SHOTS : l.weapon === 'avatar' ? l.ammo : 0 };
}
export function normaliseSkua(l: MantaLoad, fit: boolean): MantaLoad {
  // (a radio pod from an older save is dropped: it is the drone's now)
  const centre = l.centre === 'quaker' ? l.centre : null;
  return fit ? skuaFit(skuaCargoOf(l)) : { left: Math.min(2, l.left), right: Math.min(2, l.right), centre };
}

export const mantaAssassins = (l: MantaLoad) => l.left + l.right + (l.centre === 'assassin3' ? 3 : 0);

/** goods a fitting takes from the hold (the built-in weapons take nothing) */
export function walrusGoods(l: WalrusLoad): Partial<Record<Good, number>> {
  const g: Partial<Record<Good, number>> = {};
  if (l.cargo === 'accb') g.accb = 1;
  if (l.cargo === 'virus') g.virus = 1;
  if (l.cargo === 'tank') g.tank = 1;
  return g;
}

/**
 * Swap the goods of fitting `from` for those of `to` in the hold. Returns what
 * was missing (nothing changes then), or '' when the swap was made.
 */
export function refit(stores: Stores, from: Partial<Record<Good, number>>, to: Partial<Record<Good, number>>, names: (g: Good) => string): string {
  const goods = new Set([...Object.keys(from), ...Object.keys(to)] as Good[]);
  const missing: string[] = [];
  for (const g of goods) {
    const need = (to[g] ?? 0) - (from[g] ?? 0);
    if (need > 0 && stores[g] < need) missing.push(t('gear.missingItem', { good: names(g), n: stores[g] }));
  }
  if (missing.length) return t('gear.notEnough', { list: missing.join(', ') });
  for (const g of goods) stores[g] -= (to[g] ?? 0) - (from[g] ?? 0);
  return '';
}
