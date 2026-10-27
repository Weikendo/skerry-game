import * as THREE from 'three';
import type { Archipelago } from '../world/archipelago';
import type { IslandBase } from '../world/base';
import type { UnitPilots } from './autopilot';
import type { CarrierController } from './carrierController';
import type { Manta } from './manta';
import type { Walrus } from './walrus';

/** what the test range moves about */
export interface ProbeGame {
  world: Archipelago;
  bases: IslandBase[];
  carrier: CarrierController;
  otter: Walrus;
  skua: Manta;
  enemyShip: CarrierController;
  foeOtter: Walrus;
  pilots: UnitPilots;
}

/** deep enough for both ships (their keels reach 26 m) */
const DEEP = -30;
/** the island guns' reach (base.ts TURRET_RANGE) */
const GUN_RANGE = 950;

/**
 * Test range for the combat milestone (`?probe=kampf`): a new game that starts right in front of the enemy
 * island with the most guns. The Stoorworm lies stopped out of their reach, Otter 1 swims before the beach,
 * Skua 1 circles over the Stoorworm (until it is flown by hand), an enemy Otter stands on the shore, and the
 * Nuckelavee waits off to the side, close enough that Omega sends its Skuas after the Stoorworm. Returns the
 * island's name, or null without one.
 */
export function combatProbe(g: ProbeGame): string | null {
  const guns = (b: IslandBase) => b.buildings.filter(x => x.head && x.alive);
  const pick = g.bases.filter(b => b.team === 'feind').sort((a, b) => guns(b).length - guns(a).length)[0];
  if (!pick) return null;
  const isl = pick.island, h = (x: number, z: number) => g.world.heightAt(x, z);
  const nearestGun = (p: { x: number; z: number }) => Math.min(Infinity, ...guns(pick).map(b => Math.hypot(b.p.x - p.x, b.p.z - p.z)));
  const deep = (x: number, z: number) => h(x, z) < DEEP;

  // the side with open sea: the coast nearest the centre with nothing but deep water 3.5 km beyond it and to the side
  let best: { ang: number; coast: number } | null = null;
  for (let k = 0; k < 32; k++) {
    const ang = k / 32 * Math.PI * 2, dx = Math.sin(ang), dz = Math.cos(ang);
    let coast = 0;
    while (coast < 6000 && !deep(isl.cx + dx * coast, isl.cz + dz * coast)) coast += 40;
    if (coast >= 6000) continue;
    let open = true;
    for (let s = 0; s <= 3500 && open; s += 100) {
      const x = isl.cx + dx * (coast + s), z = isl.cz + dz * (coast + s);
      open = deep(x, z) && deep(x + dz * s, z - dx * s);
    }
    if (open && (!best || coast < best.coast)) best = { ang, coast };
  }
  if (!best) return null;
  const dx = Math.sin(best.ang), dz = Math.cos(best.ang);
  // a point `out` metres beyond the deep-water line and `side` metres to its right
  const at = (out: number, side = 0) => ({ x: isl.cx + dx * (best!.coast + out) + dz * side, z: isl.cz + dz * (best!.coast + out) - dx * side });
  // the first point out from the coast that far from every gun
  const clear = (gap: number, side = 0) => {
    let out = 0;
    while (out < 4000 && nearestGun(at(out, side)) < gap) out += 25;
    return at(out, side);
  };
  const toIsland = Math.atan2(-dx, -dz);

  // the Skua circles the ship at about 1.1 km, so the ship lies that much further out
  const ship = clear(GUN_RANGE + 1500);
  g.carrier.loadState({ ...g.carrier.saveState(), x: ship.x, z: ship.z, heading: toIsland, speed: 0, throttle: 1, waypoint: null });

  const otter = clear(GUN_RANGE + 200, -150);
  g.otter.loadState({ ...g.otter.saveState(), state: 'fahren', x: otter.x, z: otter.z, heading: toIsland, speed: 0, medium: 'wasser', waypoint: null });

  const skua = clear(GUN_RANGE + 600, 250);
  g.skua.loadState({ ...g.skua.saveState(), state: 'flug', x: skua.x, y: 220, z: skua.z, yaw: toIsland, pitch: 0, bank: 0, speed: 90, throttle: 0.35, pad: null, waypoint: null });
  g.pilots.setManta(g.skua, new THREE.Vector2(ship.x, ship.z));

  // to the right if the sea is deep there, else to the left
  const side = deep(ship.x + dz * 3200, ship.z - dx * 3200) ? 3200 : -3200;
  const foe = { x: ship.x + dz * side, z: ship.z - dx * side };
  g.enemyShip.loadState({ ...g.enemyShip.saveState(), x: foe.x, z: foe.z, heading: best.ang + Math.PI / 2, speed: 0, throttle: 1, waypoint: null });

  // the enemy Otter: on land a little inside the coast, off to the left of the approach
  for (let back = 150; back < best.coast; back += 30) {
    const p = at(-back, -350);
    if (h(p.x, p.z) > 2) {
      g.foeOtter.loadState({ ...g.foeOtter.saveState(), state: 'fahren', x: p.x, z: p.z, heading: best.ang, speed: 0, medium: 'land', waypoint: null });
      break;
    }
  }
  return isl.name;
}
