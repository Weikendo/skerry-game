/**
 * Remote control range around the carrier (Operations Guide / EXE: the picture
 * weakens from 3 map cells, the link is lost at 4 cells and the unit destroys
 * itself). The remake's islands are as big as the original's while the sea
 * between them is much smaller, so the range is 4 / 5 km here.
 */
export const SIGNAL_WEAK = 4000;
export const SIGNAL_LOST = 5000;

/** 1 = clear link, 0 = lost */
export function signalAt(distance: number): number {
  const t = Math.min(1, Math.max(0, (distance - SIGNAL_WEAK) / (SIGNAL_LOST - SIGNAL_WEAK)));
  return 1 - t * t * (3 - 2 * t);
}

/** points that relay the link besides the carrier: Mantas with a long-range radio pod */
let relays: () => { x: number; z: number }[] = () => [];
export function setRelays(fn: () => { x: number; z: number }[]) { relays = fn; }

/** distance to the nearest link: the carrier or a relaying Manta (original: whichever is closer) */
export function linkDistance(x: number, z: number, carrier: { x: number; z: number }): number {
  let d = Math.hypot(x - carrier.x, z - carrier.z);
  for (const r of relays()) d = Math.min(d, Math.hypot(x - r.x, z - r.z));
  return d;
}

/** which side a vehicle fights for, its name, and the distance to its radio link (the player's
 *  vehicles count the relaying Mantas, the enemy's only their own carrier) */
export interface Side { team: 'spieler' | 'feind'; name: string; link: (x: number, z: number) => number }
