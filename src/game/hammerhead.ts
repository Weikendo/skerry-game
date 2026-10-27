import * as THREE from 'three';
import { PAL } from '../engine/palette';
import { buildObservationDrone, type ObservationDroneModel } from '../models/observationDrone';
import type { Effects } from '../world/effects';
import { HAMMERHEAD } from './arsenal';
import type { CarrierController } from './carrierController';
import type { Combat, SeaGuide, Target, Team } from './combat';
import { t } from '../i18n';

/**
 * The Hammerhead sea-target missiles and their observation drone, as in the original: the drone is shot up over the
 * carrier, comes down slowly under its chute and blows itself up before it reaches the water; while it hangs up
 * there the player aims through its camera, and each Hammerhead (thrown out backwards from the stern) flies low over
 * the sea to the target, kept on it by the drone. Without the drone it flies on to where the target was. The
 * Nuckelavee does the same at the Stoorworm when it is near and in sight, the more often the harder the game.
 */
export const OBSERVER = {
  /** shot up to this height over the sea (m) at this speed (m/s); the chute opens over this long (s); then it sinks
   *  at this rate (m/s) with this share of the wind, and blows itself up this high over the sea (m) */
  height: 600, climb: 110, open: 0.8, sink: 3.5, drift: 0.6, end: 40,
  /** hit points (one laser hit brings it down, a Skua's needs three) and its hit sphere round the open chute (m) */
  hp: 600, radius: 5,
};
export const BATTERY = {
  /** between two Hammerheads (s) */
  reload: 5,
  /** where they leave the ship: the stern (m aft of the middle) */
  stern: 95,
  /** the Nuckelavee: its drone goes up when the Stoorworm is this near and in its sight (m), its first Hammerhead
   *  follows this long after the chute opened (s), the next ones every `every` s (at skill 0 and 1) */
  foeRange: 3800, first: 4, every: [90, 40],
};

export class ObservationDrone implements Target {
  readonly kind = 'einheit' as const;
  readonly maxHp = OBSERVER.hp;
  hp = OBSERVER.hp;
  alive = true;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  /** going up on its motor, or hanging under its chute */
  phase: 'steigen' | 'offen' = 'steigen';
  age = 0;
  /** how far the chute has opened, 0..1 */
  opened = 0;

  constructor(readonly name: string, readonly team: Team, readonly model: ObservationDroneModel, private onDown: (d: ObservationDrone) => void) {}

  spheres(): [number, number, number, number][] {
    return [[this.pos.x, this.pos.y + (this.phase === 'offen' ? 4 : 0), this.pos.z, this.phase === 'offen' ? OBSERVER.radius : 1.5]];
  }
  centre(out: THREE.Vector3) { return out.copy(this.pos); }
  velocity(out: THREE.Vector3) { return out.copy(this.vel); }

  hit(damage: number): boolean {
    if (!this.alive) return false;
    this.hp -= damage;
    if (this.hp > 0) return false;
    this.hp = 0;
    this.alive = false;
    this.onDown(this);
    return true;
  }
}

/** what a battery tells the game: a drone went up, its chute opened, a Hammerhead left, the drone blew itself up */
export type BatteryEvent = 'launch' | 'drone' | 'away' | 'spent';

export class Hammerheads {
  drone: ObservationDrone | null = null;
  /** the enemy's: it starts its drone and fires at `prey` by itself */
  auto = false;
  /** how often it fires on its own, 0..1 (the enemy's comes with the difficulty) */
  skill = 0.65;
  /** for `auto`: the target when near and in sight, otherwise null (set by the game) */
  prey: () => Target | null = () => null;
  onEvent: ((e: BatteryEvent) => void) | null = null;
  private reloadIn = 0;
  private fireIn = 0;
  private v = new THREE.Vector3();

  constructor(private ship: CarrierController, private team: Team, private combat: Combat, private effects: Effects, private group: THREE.Group) {}

  /** the drone hangs up there under its chute and looks round */
  get watching(): boolean { return !!this.drone?.alive && this.drone.phase === 'offen'; }

  /** up with an observation drone; 'up' if one is already there */
  launchDrone(): 'ok' | 'up' | 'empty' {
    if (this.drone?.alive) return 'up';
    if (this.ship.stores.beobachtungsdrohne <= 0) return 'empty';
    this.ship.stores.beobachtungsdrohne--;
    const model = buildObservationDrone(this.team === 'feind' ? 'feind' : 'spieler');
    this.group.add(model.group);
    const d = new ObservationDrone(t(this.team === 'feind' ? 'foe.observer' : 'observer.name'), this.team, model, (x) => this.down(x));
    this.ship.localToWorld(0, -60, d.pos).setY(this.ship.model.group.position.y + 3);
    this.ship.velocity(d.vel).setY(OBSERVER.climb);
    model.chute.scale.setScalar(0.001);
    this.drone = d;
    this.combat.add(d);
    this.onEvent?.('launch');
    return 'ok';
  }

  /** a Hammerhead at `target` (or at `point`); why not, if it cannot */
  fire(point: THREE.Vector3, target: Target | null): 'ok' | 'noDrone' | 'empty' | 'reload' | 'far' {
    if (!this.watching) return 'noDrone';
    if (this.ship.stores.hammerhead <= 0) return 'empty';
    if (this.reloadIn > 0) return 'reload';
    if (this.drone!.pos.distanceTo(point) > HAMMERHEAD.reach) return 'far';
    const s = this.ship;
    s.stores.hammerhead--;
    this.reloadIn = BATTERY.reload;
    const from = s.localToWorld(0, -BATTERY.stern, new THREE.Vector3()).setY(s.model.group.position.y + 4);
    const dir = s.forward.clone().negate().setY(0.6).normalize();
    const sea: SeaGuide = { point: point.clone(), target, eye: this.drone, age: 0 };
    this.combat.fire({ kind: 'hammerhead', team: this.team, from, dir, inherit: s.velocity(new THREE.Vector3()), target: target ?? undefined, sea, source: this });
    this.onEvent?.('away');
    return 'ok';
  }

  /** the time until the next Hammerhead can leave (s) */
  get reloading(): number { return Math.max(0, this.reloadIn); }

  update(dt: number) {
    this.reloadIn -= dt;
    const d = this.drone;
    if (d?.alive) this.fly(d, dt);
    if (d && !d.alive) {
      this.group.remove(d.model.group);
      this.combat.remove(d);
      this.drone = null;
    }
    if (this.auto) this.decide(dt);
  }

  // ---- inside ----
  /** up on its motor with a trail of smoke, then the chute opens and it sinks and drifts; low over the sea it ends */
  private fly(d: ObservationDrone, dt: number) {
    d.age += dt;
    const m = d.model;
    if (d.phase === 'steigen') {
      const k = Math.exp(-1.5 * dt);
      d.vel.x *= k; d.vel.z *= k;
      d.pos.addScaledVector(d.vel, dt);
      this.effects.trail(d.pos);
      this.effects.halo(d.pos, new THREE.Color(PAL.lavaHell).multiplyScalar(1.6), 4);
      if (d.pos.y >= OBSERVER.height) {
        d.phase = 'offen';
        d.vel.y = 0;
        this.fireIn = BATTERY.first;
        this.onEvent?.('drone');
      }
    } else {
      d.opened = Math.min(1, d.opened + dt / OBSERVER.open);
      const w = this.combat.wind, k = 1 - Math.exp(-0.5 * dt);
      d.vel.x += (w.x * OBSERVER.drift - d.vel.x) * k;
      d.vel.z += (w.z * OBSERVER.drift - d.vel.z) * k;
      d.vel.y = -OBSERVER.sink;
      d.pos.addScaledVector(d.vel, dt);
      // a white light flashes on the pod
      if (d.age % 1.2 < 0.12) this.effects.halo(this.v.copy(d.pos).setY(d.pos.y + 1), new THREE.Color(PAL.lichtWeiss).multiplyScalar(2), 2.5);
      if (d.pos.y < OBSERVER.end) {
        // it blows itself up before it reaches the water
        d.alive = false;
        this.effects.explosion(d.pos, 0.5, this.team === 'feind' ? PAL.feindHell : PAL.rettungsOrange);
        this.onEvent?.('spent');
      }
    }
    m.group.position.copy(d.pos);
    m.group.rotation.y += dt * 0.2;
    m.chute.scale.setScalar(d.phase === 'steigen' ? 0.001 : 0.15 + 0.85 * d.opened);
  }

  /** shot down: it bursts */
  private down(d: ObservationDrone) {
    this.effects.explosion(d.pos, 0.6, this.team === 'feind' ? PAL.feindHell : PAL.rettungsOrange);
  }

  /** the enemy's: its drone up when the Stoorworm comes near and into sight, then a Hammerhead now and then */
  private decide(dt: number) {
    const prey = this.prey();
    if (!prey || !this.ship.alive) return;
    if (!this.drone) {
      if (this.ship.stores.hammerhead > 0) this.launchDrone();
      return;
    }
    if (!this.watching || (this.fireIn -= dt) > 0) return;
    if (this.fire(prey.centre(this.v).clone(), prey) === 'ok') this.fireIn = THREE.MathUtils.lerp(BATTERY.every[0], BATTERY.every[1], this.skill);
    else this.fireIn = 2;
  }
}
