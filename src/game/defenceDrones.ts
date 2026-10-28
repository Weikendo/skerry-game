import * as THREE from 'three';
import { lowPolyMaterial } from '../engine/lowpoly';
import { PAL } from '../engine/palette';
import { buildShieldDrone } from '../models/shieldDrone';
import type { Effects } from '../world/effects';
import type { CarrierController } from './carrierController';
import type { Combat, Target, Team } from './combat';
import { t } from '../i18n';

/**
 * A carrier's defence drones, after the original's "passive defence drones": inflatable decoys that follow the
 * ship in a formation and catch the fire meant for it. At most four are out at once; every hit destroys one (but
 * not the other drones' fire); while any is out the ship makes full speed at most; they neither leave nor land
 * while the transfer drone lies at the bow. Here they are balloons hovering high between the ship and what comes
 * at it: island guns and turrets aim at the nearest unit, which is then a drone, and their shots go over the ship;
 * a Skua's lock falls on one rather than on the ship, and Omega's pilots then go for that drone first, missile and
 * all, so each drone swallows a missile before they get through. A missile on its way in is another matter: the
 * drones facing it come down into its path, one behind the other, and the first it meets takes it. (Standing low in
 * every line of fire they did harm: shots that missed a drone flew on into the hull, and drones nearer an island
 * brought more of its guns into reach.) The Stoorworm's go out and in with L and keep their number from
 * the hold; the Nuckelavee's go out by themselves when something comes at it (2 to 4 with the difficulty) and in
 * again after a quiet minute.
 */
export type ShieldPattern = 'feind' | 'rundum' | 'voraus' | 'achteraus' | 'backbord' | 'steuerbord';
export const SHIELD_PATTERNS: ShieldPattern[] = ['feind', 'rundum', 'voraus', 'achteraus', 'backbord', 'steuerbord'];

export const SHIELD = {
  /** out at once (the original's four) */
  max: 4,
  /** how much faster than the ship they fly (m/s) and how hard they change speed (m/s²) */
  speed: 28, accel: 14,
  /** a drone leaves the deck this long after the one before (s) */
  launchEvery: 1.2,
  /** the hit sphere (m) */
  radius: 5.5,
  /** the ship's top speed while any are out (m/s: full speed, no flank speed) */
  shipCap: 20,
  /** 'Zum Feind': the screen stands this far out towards the danger (m), this wide either side (m), at least this high
   *  over the sea and this much above the line of fire (m): a shot aimed at a drone then goes over the hull (whose hit
   *  spheres reach 47 m up) */
  screen: { out: 120, wide: 45, high: 55, above: 30 },
  /** against a missile they stand in its path, the first this far out and the next ones this much farther (m) */
  catch: { out: 85, step: 30 },
  /** dangers are looked for this far from the ship (m), again every SEEK s */
  reach: 2500, seek: 0.25,
  /** the Nuckelavee takes its drones in after this long without danger (s) */
  quiet: 60,
};
/** where each stands in the fixed patterns: the ship's frame (x to port, z forward) and the height above the sea */
const FIXED: Record<Exclude<ShieldPattern, 'feind'>, [number, number, number][]> = {
  rundum: [[95, 70, 55], [-95, 70, 55], [95, -70, 55], [-95, -70, 55]],
  voraus: [[-45, 205, 55], [45, 205, 55], [-95, 165, 60], [95, 165, 60]],
  achteraus: [[-45, -185, 55], [45, -185, 55], [-95, -145, 60], [95, -145, 60]],
  backbord: [[105, 110, 55], [115, 38, 60], [115, -38, 60], [105, -110, 55]],
  steuerbord: [[-105, 110, 55], [-115, 38, 60], [-115, -38, 60], [-105, -110, 55]],
};
/** where they leave the deck and land (ship frame) and how high over it they climb before going out (m) */
const PAD = { x: 0, z: -45, climb: 22 };
/** the height of the hull's middle, where the shots aim (m above the sea) */
const HULL_Y = 9;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class ShieldDrone implements Target {
  readonly kind = 'einheit' as const;
  readonly maxHp = 1;
  hp = 1;
  alive = true;
  /** leaving the deck, out in the formation, or on the way back to land */
  state: 'start' | 'aussen' | 'heim' = 'start';
  /** coming down onto the deck (the last part of the way home) */
  landing = false;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  age = 0;
  yaw = 0;
  /** its place in the formation */
  slot = 0;

  constructor(readonly name: string, readonly team: Team, readonly number: number, readonly mesh: THREE.Mesh, private onBurst: (d: ShieldDrone) => void) {}

  spheres(): [number, number, number, number][] { return [[this.pos.x, this.pos.y, this.pos.z, SHIELD.radius]]; }
  centre(out: THREE.Vector3) { return out.copy(this.pos); }
  velocity(out: THREE.Vector3) { return out.copy(this.vel); }

  /** every hit bursts it, whatever the damage (as in the original) */
  hit(): boolean {
    if (!this.alive) return false;
    this.alive = false;
    this.hp = 0;
    this.onBurst(this);
    return true;
  }
}

export class DefenceDrones {
  readonly drones: ShieldDrone[] = [];
  pattern: ShieldPattern = 'feind';
  /** wanted out: the ship keeps `count` out and replaces lost ones from its hold */
  out = false;
  /** how many it keeps out (the Stoorworm's four; the enemy's 2 to 4 with the difficulty) */
  count = SHIELD.max;
  /** the enemy's: out by themselves when something comes at the ship, in again after a quiet minute */
  auto = false;
  /** launching and landing wait while this holds (the transfer drone at the bow) */
  blocked: () => boolean = () => false;
  /** the other side's gun turrets within `range` of a point (set by the game) */
  guns: (at: THREE.Vector3, range: number) => THREE.Vector3[] = () => [];
  /** a drone was blown up on the deck, or burst (the game's sounds) */
  onSound: ((e: 'launch' | 'burst', at: THREE.Vector3) => void) | null = null;
  private launchIn = 0;
  private seekIn = 0;
  private quietFor = 0;
  private dangers: { p: THREE.Vector3; missile: boolean }[] = [];
  private geo: THREE.BufferGeometry;
  private mat = lowPolyMaterial();
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private shipVel = new THREE.Vector3();

  /** `ships`: both carriers (no danger aboard the other one, and its own ship is no target of theirs) */
  constructor(private ship: CarrierController, private team: Team, private combat: Combat, private effects: Effects,
    private group: THREE.Group, private ships: Target[]) {
    this.geo = buildShieldDrone(team === 'feind' ? 'feind' : 'spieler');
  }

  /** drones in the air (going out, out or coming home) */
  get flying(): number { return this.drones.length; }
  /** drones out in the formation */
  get standing(): number { return this.drones.filter(d => d.state !== 'heim').length; }

  /** L: out (up to `count`) or all home; why not, if it cannot */
  toggle(): 'out' | 'in' | 'empty' | 'blocked' {
    if (this.out) { this.recall(); return 'in'; }
    if (this.ship.stores.abwehrdrohne <= 0) return 'empty';
    if (this.blocked()) return 'blocked';
    this.out = true;
    return 'out';
  }

  /** the next formation */
  cyclePattern(): ShieldPattern {
    this.pattern = SHIELD_PATTERNS[(SHIELD_PATTERNS.indexOf(this.pattern) + 1) % SHIELD_PATTERNS.length];
    return this.pattern;
  }

  recall() {
    this.out = false;
    for (const d of this.drones) d.state = 'heim';
  }

  update(dt: number) {
    const s = this.ship;
    // a ship gone down takes its drones with it
    if (!s.alive) { for (const d of this.drones) if (d.alive) d.hit(); }
    s.dragLimit = this.drones.length ? SHIELD.shipCap : Infinity;
    s.velocity(this.shipVel);
    if ((this.seekIn -= dt) <= 0) { this.seekIn = SHIELD.seek; this.dangers = s.alive ? this.findDangers() : []; }
    if (this.auto) this.decide(dt);
    // keep the number out: one at a time from the pad
    this.launchIn -= dt;
    if (this.out && s.alive && this.standing < this.count && s.stores.abwehrdrohne > 0 && this.launchIn <= 0 && !this.blocked()) {
      this.launch();
      this.launchIn = SHIELD.launchEvery;
    }
    const standing = this.drones.filter(d => d.state !== 'heim');
    standing.forEach((d, i) => { d.slot = i; });
    for (const d of this.drones) {
      if (!d.alive) continue;
      this.fly(d, this.goal(d, standing.length), dt);
    }
    // burst ones and landed ones leave
    for (let i = this.drones.length - 1; i >= 0; i--) {
      const d = this.drones[i];
      if (d.alive && !(d.landing && d.pos.y < this.deckY() + 3)) continue;
      if (d.alive) s.stores.abwehrdrohne++;
      this.group.remove(d.mesh);
      this.combat.remove(d);
      this.drones.splice(i, 1);
    }
  }

  // ---- save game: how many stand out (they come back in their formation) ----
  saveState() {
    return { out: this.out, pattern: this.pattern, n: this.drones.filter(d => d.alive && d.state !== 'heim').length };
  }

  loadState(s: ReturnType<DefenceDrones['saveState']> | undefined) {
    for (const d of this.drones) { this.group.remove(d.mesh); this.combat.remove(d); }
    this.drones.length = 0;
    this.out = s?.out ?? false;
    this.pattern = s?.pattern ?? 'feind';
    this.dangers = [];
    // (those out were taken from the hold when they left; the save's hold already lacks them)
    for (let i = 0; i < (s?.n ?? 0); i++) {
      const d = this.spawn();
      d.state = 'aussen';
      d.age = 2;
      this.slotPos(i, s!.n, d.pos);
      this.ship.velocity(d.vel);
    }
  }

  // ---- inside ----
  private deckY(): number { return this.ship.model.group.position.y; }

  private spawn(): ShieldDrone {
    const used = new Set(this.drones.map(d => d.number));
    let n = 1;
    while (used.has(n)) n++;
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.castShadow = true;
    mesh.name = 'defence-drone';
    this.group.add(mesh);
    const d = new ShieldDrone(t(this.team === 'feind' ? 'foe.shield' : 'shield.name', { n }), this.team, n, mesh, (x) => this.burst(x));
    d.yaw = this.ship.heading;
    this.drones.push(d);
    this.combat.add(d);
    return d;
  }

  private launch() {
    const s = this.ship;
    s.stores.abwehrdrohne--;
    const d = this.spawn();
    s.localToWorld(PAD.x, PAD.z, d.pos).setY(this.deckY() + 2);
    d.vel.copy(this.shipVel);
    this.onSound?.('launch', d.pos);
  }

  /** it bursts: a puff of fire and its skin flying off (with a bang and a flapping of its own, not an explosion's) */
  private burst(d: ShieldDrone) {
    this.effects.explosion(d.pos, 0.45, this.team === 'feind' ? PAL.feindHell : PAL.weiss, true);
    this.onSound?.('burst', d.pos);
  }

  /** where a drone is heading now */
  private goal(d: ShieldDrone, standing: number): THREE.Vector3 {
    const s = this.ship, pad = s.localToWorld(PAD.x, PAD.z, this.v3);
    if (d.state === 'start') {
      pad.y = this.deckY() + PAD.climb;
      if (d.pos.distanceTo(pad) < 5) d.state = 'aussen';
      return pad;
    }
    if (d.state === 'heim') {
      // over the pad first, then down onto the deck (not while the transfer drone lies at the bow)
      pad.y = this.deckY() + PAD.climb;
      if (!d.landing && d.pos.distanceTo(pad) < 6 && !this.blocked()) d.landing = true;
      if (d.landing) pad.y = this.deckY() + 1;
      return pad;
    }
    return this.slotPos(d.slot, standing, this.v3);
  }

  /**
   * A drone's place. In 'Zum Feind' the two nearest dangers share the drones: against a gun, a turret or an aircraft
   * a line of them high across its line of fire, against a missile one behind the other in its path. Otherwise the
   * fixed pattern.
   */
  private slotPos(i: number, n: number, out: THREE.Vector3): THREE.Vector3 {
    const s = this.ship;
    if (this.pattern !== 'feind' || !this.dangers.length) {
      const p = FIXED[this.pattern === 'feind' ? 'rundum' : this.pattern][i % 4];
      return s.localToWorld(p[0], p[1], out).setY(p[2]);
    }
    const two = this.dangers.length > 1 && n > 1;
    const D = this.dangers[two ? i % 2 : 0], T = D.p;
    const per = two ? Math.ceil(n / 2) : n, j = two ? Math.floor(i / 2) : i;
    const dx = T.x - s.pos.x, dz = T.z - s.pos.z, dist = Math.hypot(dx, dz) || 1, ux = dx / dist, uz = dz / dist;
    if (D.missile) {
      const along = Math.min(SHIELD.catch.out + j * SHIELD.catch.step, dist * 0.8);
      return out.set(s.pos.x + ux * along, Math.max(8, HULL_Y + (T.y - HULL_Y) * along / dist), s.pos.z + uz * along);
    }
    const across = per > 1 ? (j / (per - 1) - 0.5) * 2 * SHIELD.screen.wide : 0;
    const along = Math.min(SHIELD.screen.out, dist * 0.5);
    const lineY = HULL_Y + (T.y - HULL_Y) * along / dist;
    return out.set(s.pos.x + ux * along - uz * across, THREE.MathUtils.clamp(lineY + SHIELD.screen.above, SHIELD.screen.high, 100), s.pos.z + uz * along + ux * across);
  }

  /** fly towards `goal`: with the ship, closing the gap at most SHIELD.speed faster, turning its nose into its way */
  private fly(d: ShieldDrone, goal: THREE.Vector3, dt: number) {
    const want = this.v1.subVectors(goal, d.pos).multiplyScalar(0.9);
    if (want.length() > SHIELD.speed) want.setLength(SHIELD.speed);
    want.add(this.shipVel);
    const dv = this.v2.subVectors(want, d.vel), max = SHIELD.accel * dt;
    if (dv.length() > max) dv.setLength(max);
    d.vel.add(dv);
    d.pos.addScaledVector(d.vel, dt);
    d.pos.y = Math.max(d.pos.y, d.landing ? this.deckY() : 6);
    d.age += dt;
    const hv = Math.hypot(d.vel.x, d.vel.z);
    d.yaw += wrap((hv > 3 ? Math.atan2(d.vel.x, d.vel.z) : this.ship.heading) - d.yaw) * Math.min(1, dt * 1.5);
    // the mesh: blown up over its first second and a half, bobbing a little, nose up when it climbs
    const m = d.mesh;
    m.scale.setScalar(Math.min(1, 0.3 + 0.7 * d.age / 1.5));
    m.position.copy(d.pos);
    m.position.y += Math.sin(d.age * 1.4 + d.number) * 0.5;
    m.rotation.set(-THREE.MathUtils.clamp((d.vel.y - this.shipVel.y) * 0.02, -0.3, 0.3), d.yaw, 0, 'YXZ');
    // a red light on its back flashes now and then
    if (d.age % 1.4 < 0.15) this.effects.halo(this.v1.copy(m.position).setY(m.position.y + 2.4), new THREE.Color(PAL.lichtRot).multiplyScalar(2), 1.8);
  }

  /** what comes at the ship, nearest (and most pressing) first: missiles on their way in, aircraft and vehicles of
   *  the other side, its island guns in reach, the other ship close by */
  private findDangers(): { p: THREE.Vector3; missile: boolean }[] {
    const s = this.ship, list: { p: THREE.Vector3; w: number; missile: boolean }[] = [];
    for (const m of this.combat.incoming(this.team, s.pos, 1500)) {
      if ((m.kind === 'rakete' || m.kind === 'hammerhead') && !m.lure && m.vel.dot(this.v1.subVectors(s.pos, m.pos)) > 0) list.push({ p: m.pos.clone(), w: m.pos.distanceTo(s.pos) * 0.5, missile: true });
    }
    for (const tg of this.combat.targets) {
      if (!tg.alive || tg.dummy || tg.kind !== 'einheit' || tg.team === this.team || tg.team === 'neutral' || tg instanceof ShieldDrone) continue;
      const c = tg.centre(new THREE.Vector3()), d = c.distanceTo(s.pos);
      if (d > SHIELD.reach) continue;
      if (this.ships.includes(tg)) { if (d < 1600) list.push({ p: c, w: d, missile: false }); continue; }
      // aboard the other ship it is no danger
      if (c.y < 30 && this.ships.some(o => o.team !== this.team && Math.hypot(o.centre(this.v1).x - c.x, this.v1.z - c.z) < 110)) continue;
      list.push({ p: c, w: c.y > 25 ? d : d * 1.3, missile: false });
    }
    for (const g of this.guns(s.pos, 1300)) list.push({ p: g, w: g.distanceTo(s.pos) * 0.9, missile: false });
    return list.sort((a, b) => a.w - b.w).slice(0, 2);
  }

  /** the enemy's: out when danger comes, in again after a quiet minute */
  private decide(dt: number) {
    if (this.dangers.length) {
      this.quietFor = 0;
      if (!this.out && this.ship.stores.abwehrdrohne > 0) this.out = true;
    } else if (this.out && (this.quietFor += dt) > SHIELD.quiet) this.recall();
  }
}
