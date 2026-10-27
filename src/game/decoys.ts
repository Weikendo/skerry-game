import * as THREE from 'three';
import type { CarrierController } from './carrierController';
import type { Combat, Team } from './combat';

/**
 * A carrier's decoy launchers, as in the original: flares that lure heat-seeking missiles away, drift with the
 * wind and need a moment to reload. Here they also fire on their own when an Assassin comes at the ship (the
 * enemy's the earlier and the more the harder the game); the player launches them by hand with K. Each salvo is
 * two decoys from the hold (the enemy's one on easy, three on hard), thrown out towards the missile (or one to each
 * side), from the deck edge. Each decoy lures a missile that sees it with DECOY.lure (0.4): two lure about three in
 * five, alone they spare the hull about half the missiles, with the laser turret about four in five.
 */
export const LAUNCHER = {
  /** decoys per salvo below skill 0.5, up to 0.8 and above (the Stoorworm's 0.65: two) */
  salvo: [1, 2, 3], reload: 6,
  /** thrown out (m/s) and up (m/s), spread round the bearing (rad between the two) */
  out: 40, up: 32, spread: 0.6,
  /** on its own it fires when an Assassin coming closer is this near (m), at skill 0 and 1 */
  launchAt: [500, 1300],
  /** the deck edges, out from the middle (m) */
  edge: 32,
};
/** on its own it looks for missiles this often (s) */
const SEEK = 0.25;

export class DecoyLauncher {
  /** how early it fires on its own, 0..1 (the enemy's comes with the difficulty) */
  skill = 0.65;
  private reload = 0;
  private seek = 0;
  private tmp = new THREE.Vector3();

  constructor(private ship: CarrierController, private team: Team) {}

  get ready(): boolean { return this.reload <= 0; }

  /** on its own: a salvo when an Assassin comes at the ship; returns how many it threw */
  update(dt: number, combat: Combat): number {
    this.reload -= dt;
    if (!this.ship.alive || this.reload > 0 || this.ship.stores.taeuschkoerper <= 0 || (this.seek -= dt) > 0) return 0;
    this.seek = SEEK;
    const range = THREE.MathUtils.lerp(LAUNCHER.launchAt[0], LAUNCHER.launchAt[1], this.skill);
    const threat = combat.incoming(this.team, this.ship.pos, range)
      .find(m => m.kind === 'rakete' && !m.lure && m.vel.dot(this.tmp.subVectors(this.ship.pos, m.pos)) > 0);
    return threat ? this.launch(combat, threat.pos) : 0;
  }

  /** by hand (K): a salvo towards the nearest missile coming in, or one to each side; 'reload' or 'empty' if not */
  fire(combat: Combat): number | 'reload' | 'empty' {
    if (!this.ship.alive) return 0;
    if (this.ship.stores.taeuschkoerper <= 0) return 'empty';
    if (this.reload > 0) return 'reload';
    const near = combat.incoming(this.team, this.ship.pos, 2500).filter(m => m.kind === 'rakete' && !m.lure)
      .sort((a, b) => a.pos.distanceToSquared(this.ship.pos) - b.pos.distanceToSquared(this.ship.pos))[0];
    return this.launch(combat, near?.pos ?? null);
  }

  private launch(combat: Combat, toward: THREE.Vector3 | null): number {
    const s = this.ship, n = Math.min(LAUNCHER.salvo[this.skill < 0.5 ? 0 : this.skill < 0.8 ? 1 : 2], s.stores.taeuschkoerper);
    const deck = s.model.group.position.y + 3, shipVel = s.velocity(new THREE.Vector3());
    const bearing = toward ? Math.atan2(toward.x - s.pos.x, toward.z - s.pos.z) : 0;
    for (let i = 0; i < n; i++) {
      // towards the missile, fanned out a little; with none in sight one to port, one to starboard
      const a = toward ? bearing + (i - (n - 1) / 2) * LAUNCHER.spread : Math.atan2(s.port.x, s.port.z) + (i % 2) * Math.PI;
      const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      const side = Math.sign(dir.dot(s.port)) || 1;
      const from = s.localToWorld(side * LAUNCHER.edge, -10).setY(deck);
      combat.launchDecoy(this.team, from, dir.multiplyScalar(LAUNCHER.out).setY(LAUNCHER.up).add(shipVel));
    }
    s.stores.taeuschkoerper -= n;
    this.reload = LAUNCHER.reload;
    return n;
  }
}
