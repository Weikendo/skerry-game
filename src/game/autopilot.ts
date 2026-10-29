import * as THREE from 'three';
import { KEYS, type InputLike } from './input';
import type { Walrus } from './walrus';
import { MANTA_KEYS, type Manta } from './manta';
import { THROTTLE, type CarrierController } from './carrierController';
import { SHIP_NAME } from './names';
import type { OtterRoutes, P2 } from './otterRoute';
import { t } from '../i18n';

/** steering commands made up by an autopilot, read by the unit like player input */
export class VirtualInput implements InputLike {
  private axes = new Map<string[], number>();
  set(pos: string[], v: number) { this.axes.set(pos, THREE.MathUtils.clamp(v, -1, 1)); }
  clear() { this.axes.clear(); }
  down() { return false; }
  hit() { return false; }
  axis(_neg: string[], pos: string[]) { return this.axes.get(pos) ?? 0; }
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** an Otter that comes no nearer to the point it steers for in this long (s) is held up */
const STALL = 12;

/**
 * Map waypoints for the Walrus and the Manta. A docked or parked unit is
 * launched first; any stick or key input of the player takes the unit off the
 * autopilot (as with the carrier's rudder).
 */
/** what one unit's autopilot remembers */
interface PilotState {
  input: VirtualInput; stuck: number; orbiting: boolean; home: boolean; slowed: boolean; braking: boolean;
  /** the Skua turning about ("Wenden"): how far it still has to turn (rad), which way (+1: its yaw grows), its yaw a
   *  frame ago, the height it holds, seconds since it began */
  turn: { left: number; dir: number; lastYaw: number; alt: number; age: number } | null;
  /** caught on the carrier's hull: seconds it still backs off */
  unstick: number;
  /** the Otter's way to its waypoint round cliffs and over a landing (null: straight), the waypoint it was planned for, how often it was planned again */
  route: P2[] | null; routeFor: { x: number; y: number } | null; replans: number;
  /** the same for the way home to the stern dock, the point off the stern it leads to, seconds since */
  homeRoute: P2[] | null; homeGoal: P2 | null; homeAge: number;
  /** the point it steers for, the nearest it has come to it, seconds since it last came nearer */
  aim: P2 | null; best: number; since: number;
}

export class UnitPilots {
  private states = new WeakMap<object, PilotState>();
  private st(u: object): PilotState {
    let s = this.states.get(u);
    if (!s) {
      s = { input: new VirtualInput(), stuck: 0, orbiting: false, home: false, slowed: false, braking: false, turn: null, unstick: 0, route: null, routeFor: null, replans: 0, homeRoute: null, homeGoal: null, homeAge: 0, aim: null, best: Infinity, since: 0 };
      this.states.set(u, s);
    }
    return s;
  }

  /** `routes`: ways for Otters round cliff coasts and over landings (without: always straight) */
  constructor(private carrier: CarrierController, private notify: (msg: string) => void, private routes: OtterRoutes | null = null) {}
  /** an Otter's autopilot has brought it to its waypoint (the ship computer says so) */
  onArrived: (w: Walrus) => void = () => {};

  /** the player steers the Walrus by hand */
  walrusManual(input: InputLike): boolean {
    return input.axis(KEYS.back, KEYS.forward) !== 0 || input.axis(KEYS.right, KEYS.left) !== 0;
  }

  mantaManual(input: InputLike): boolean {
    const k = MANTA_KEYS;
    return input.axis(k.noseDown, k.noseUp) !== 0 || input.axis(k.left, k.right) !== 0 ||
      input.axis(k.yawR, k.yawL) !== 0 || input.axis(k.less, k.more) !== 0;
  }

  /** the Walrus drives back into the stern dock (cleared by a waypoint or by hand) */
  isHome(w: Walrus): boolean { return this.st(w).home; }
  setHome(w: Walrus, on: boolean) { const s = this.st(w); s.home = on; s.slowed = false; }

  // (an order of the autopilot ends the cruise control, which would otherwise drive on where it lets go)
  setWalrus(w: Walrus, p: THREE.Vector2 | null) { const s = this.st(w); w.waypoint = p; if (p) w.cruise = 0; s.stuck = 0; s.home = false; s.braking = false; s.routeFor = null; s.replans = 0; }
  homeWalrus(w: Walrus) { const s = this.st(w); w.waypoint = null; w.cruise = 0; s.stuck = 0; s.home = true; s.slowed = false; s.braking = false; s.homeGoal = null; s.replans = 0; }
  /** the points the Otter's autopilot drives through before its waypoint (for the map), or null */
  routeOf(w: Walrus): P2[] | null {
    const s = this.st(w), r = s.home ? s.homeRoute : w.waypoint && s.routeFor ? s.route : null;
    return r && r.length > 1 ? r.slice(0, -1) : null;
  }
  /** map command: autopilot off and brake to a halt */
  stopWalrus(w: Walrus) { const s = this.st(w); w.waypoint = null; w.cruise = 0; s.home = false; s.braking = true; }
  setManta(m: Manta, p: THREE.Vector2 | null) { m.waypoint = p; const s = this.st(m); s.orbiting = false; s.turn = null; }

  /** "Wenden": the Skua turns about in a steep banked turn, to the side it already leans to (else to the left),
   *  holding its height; then it is the player's again (a waypoint it had is dropped) */
  turnManta(m: Manta) {
    const s = this.st(m);
    m.waypoint = null; s.orbiting = false;
    s.turn = { left: Math.PI, dir: m.bank > 0.05 ? -1 : 1, lastYaw: m.yaw, alt: m.pos.y, age: 0 };
  }
  isTurning(m: Manta): boolean { return !!this.st(m).turn; }
  /** the player steers again: the turn is left off (not in its first half second, while keys held before let go) */
  turnManual(m: Manta, input: InputLike): boolean {
    const s = this.st(m);
    if (!s.turn || s.turn.age < 0.5 || !this.mantaManual(input)) return false;
    s.turn = null;
    return true;
  }
  /** the Manta has reached its waypoint and circles it */
  isOrbiting(m: Manta): boolean { return this.st(m).orbiting; }

  walrus(w: Walrus, dt: number): InputLike | null {
    const st = this.st(w);
    if (st.braking) {
      if (w.state !== 'fahren' || Math.abs(w.speed) < 0.3) { st.braking = false; return null; }
      st.input.clear();
      st.input.set(KEYS.forward, -Math.sign(w.speed));
      return st.input;
    }
    if (st.home) return this.walrusDock(w, dt);
    const wp = w.waypoint;
    if (!wp) return null;
    if (w.state === 'dock') { w.toggleLaunch(); return null; }
    if (w.state !== 'fahren') return null;
    // round cliffs and over a landing's ramp, where the way leads onto, off or past an island with cliffs
    if (!st.routeFor || st.routeFor.x !== wp.x || st.routeFor.y !== wp.y) this.plan(w, st, wp.x, wp.y);
    const leg = this.leg(w, st.route);
    let tx = leg?.x ?? wp.x, tz = leg?.z ?? wp.y;
    const dist = Math.hypot(tx - w.pos.x, tz - w.pos.z);
    if (dist < 25 && (!st.route || st.route.length <= 1)) { w.waypoint = null; st.route = null; this.notify(t('pilot.waypointReached', { unit: w.name })); this.onArrived(w); return null; }

    // close to the carrier: drive round the hull instead of into it (out of the stern dock it comes nose first,
    // facing away from the ship, and curves round in open water); caught on the hull, it backs off out- and
    // astern for a moment, then tries again further out
    const c = this.carrier, l = c.worldToLocal(w.pos), g = c.worldToLocal(new THREE.Vector3(tx, 0, tz));
    if (w.blocked && Math.abs(l.x) < 62 && l.z < c.model.stemZ + 16) st.unstick = 3;
    if (st.unstick > 0) {
      st.unstick -= dt;
      const side = (l.x || g.x || 1) > 0 ? 1 : -1, p = c.localToWorld(side * 90, l.z - 40);
      const turn = wrap(Math.atan2(p.x - w.pos.x, p.z - w.pos.z) - w.heading);
      st.input.clear();
      st.input.set(KEYS.forward, -1);
      st.input.set(KEYS.left, -turn * 2.5);   // going astern the rudder works the other way round
      st.stuck = 0; st.aim = null;
      return st.input;
    }
    if (Math.abs(l.x) < 62 && l.z > -200 && l.z < c.model.stemZ + 16 && Math.sign(g.z - l.z) > 0 && Math.abs(g.x) < 60 + Math.abs(g.z - l.z)) {
      const side = (l.x || g.x || 1) > 0 ? 1 : -1;
      const p = c.localToWorld(side * 76, Math.min(l.z + 50, c.model.stemZ + 26));
      tx = p.x; tz = p.z;
      st.aim = null;
    }
    // no nearer for a while (sliding along a building, say): a new way from here (twice), then give up
    else if (this.stalled(w, st, tx, tz, dt)) {
      if (this.routes && st.replans < 2) { st.replans++; this.plan(w, st, wp.x, wp.y); }
      else { w.waypoint = null; st.stuck = 0; st.route = null; this.notify(t('pilot.pathBlocked', { unit: w.name })); return null; }
    }

    const diff = wrap(Math.atan2(tx - w.pos.x, tz - w.pos.z) - w.heading);
    const v = st.input;
    v.clear();
    v.set(KEYS.left, diff * 2.5);
    const aligned = Math.abs(diff) < 0.9;
    v.set(KEYS.forward, aligned ? 1 : w.medium === 'land' ? 0 : 0.6);
    // stuck on a slope or in front of a building: a new way from here (twice), then give up instead of grinding forever
    st.stuck = Math.abs(w.speed) < 0.4 && aligned ? st.stuck + dt : 0;
    if (st.stuck > 3 && this.routes && st.replans < 2) { st.replans++; st.stuck = 0; this.plan(w, st, wp.x, wp.y); }
    if (st.stuck > 5) { w.waypoint = null; st.stuck = 0; st.route = null; this.notify(t('pilot.pathBlocked', { unit: w.name })); return null; }
    return v;
  }

  /** it has come no nearer to (x, z) for some time (true once, then the clock starts again) */
  private stalled(w: Walrus, st: PilotState, x: number, z: number, dt: number): boolean {
    if (!st.aim || st.aim.x !== x || st.aim.z !== z) { st.aim = { x, z }; st.best = Infinity; st.since = 0; }
    const d = Math.hypot(x - w.pos.x, z - w.pos.z);
    if (d < st.best - 3) { st.best = d; st.since = 0; return false; }
    st.since += dt;
    if (st.since < STALL) return false;
    st.since = 0; st.best = d;
    return true;
  }

  /** plan the Otter's way to (x, z) from where it is */
  private plan(w: Walrus, st: PilotState, x: number, z: number) {
    st.routeFor = { x, y: z };
    const had = !!st.route;
    st.route = this.routes?.plan({ x: w.pos.x, z: w.pos.z }, { x, z }) ?? null;
    if (st.route && !had && !st.replans && this.routes) {
      const ashore = this.routes.ashore({ x: w.pos.x, z: w.pos.z }) || this.routes.ashore({ x, z });
      this.notify(t(ashore ? 'pilot.viaLanding' : 'pilot.roundCliffs', { unit: w.name }));
    }
  }

  /** the next point of a way (passing those already reached), or null for none */
  private leg(w: Walrus, route: P2[] | null): P2 | null {
    if (!route?.length) return null;
    while (route.length > 1 && Math.hypot(route[0].x - w.pos.x, route[0].z - w.pos.z) < 15) route.shift();
    return route[0];
  }

  /**
   * Back into the stern dock: round the hull to a point behind the stern, then
   * straight in along the line of its own bay. The ship stops for it (on a waypoint
   * route it goes to "Langsam"); the player may speed it up again by hand.
   */
  private walrusDock(w: Walrus, dt: number): InputLike | null {
    const st = this.st(w);
    if (w.state === 'dock') { st.home = false; this.notify(t('pilot.docked', { unit: w.name })); return null; }
    if (w.state !== 'fahren') return null;
    const c = this.carrier, l = c.worldToLocal(w.pos);
    // the Walrus makes 8 m/s in the water: the ship waits for it (on a route it only slows down)
    if (!st.slowed && c.speed > (c.waypoint ? 6.5 : 0.5)) {
      st.slowed = true;
      c.setThrottle(c.waypoint ? 2 : 1);
      this.notify(c.waypoint ? t('pilot.shipSlows', { ship: SHIP_NAME, step: THROTTLE[2].name, unit: w.name }) : t('pilot.shipStops', { ship: SHIP_NAME, unit: w.name }));
    }
    // first off an island with cliffs (or round one in the way) to a point off the stern; planned again as the ship moves on
    if (this.routes) {
      st.homeAge += dt;
      const goal = c.localToWorld(0, -170);
      if (!st.homeGoal || (st.homeAge > 5 && Math.hypot(goal.x - st.homeGoal.x, goal.z - st.homeGoal.z) > 250)) {
        st.homeGoal = { x: goal.x, z: goal.z }; st.homeAge = 0;
        st.homeRoute = this.routes.plan({ x: w.pos.x, z: w.pos.z }, st.homeGoal);
      }
      // (once afloat with no cliff between it and the ship, the usual way into the dock below)
      if (st.homeRoute && w.medium === 'wasser' && this.routes.clearWay({ x: w.pos.x, z: w.pos.z }, { x: c.pos.x, z: c.pos.z })) st.homeRoute = null;
      const leg = this.leg(w, st.homeRoute);
      if (leg && st.homeRoute!.length > 1) {
        if (this.stalled(w, st, leg.x, leg.z, dt)) {
          if (st.replans >= 2) { st.home = false; st.homeRoute = null; this.notify(t('pilot.homeBlocked', { unit: w.name })); return null; }
          st.replans++; st.homeGoal = null;
        }
        return this.steer(w, st, leg.x, leg.z, dt);
      }
      st.homeRoute = null;
    }
    let tx: number, tz: number;
    if (Math.abs(l.x - w.dockX) < 6 && l.z < -96 && l.z > -200) { tx = w.dockX; tz = -90; }
    // (ahead of the bow first out to the side, or it would run into the stem)
    else if (l.z > -150 && Math.abs(l.x) < 75) { tx = Math.sign(l.x || 1) * 80; tz = l.z > c.model.stemZ ? l.z : Math.max(-165, l.z - 70); }
    else { tx = w.dockX; tz = -150; }
    const p = c.localToWorld(tx, tz);
    return this.steer(w, st, p.x, p.z, dt);
  }

  /** towards (x, z) on the way home; stuck on land too long, it gives up */
  private steer(w: Walrus, st: PilotState, x: number, z: number, dt: number): InputLike | null {
    const diff = wrap(Math.atan2(x - w.pos.x, z - w.pos.z) - w.heading);
    const v = st.input;
    v.clear();
    v.set(KEYS.left, diff * 2.5);
    const aligned = Math.abs(diff) < 0.9;
    v.set(KEYS.forward, aligned ? 1 : w.medium === 'land' ? 0 : 0.6);
    // (at sea only on a way round cliffs: by the ship it may just wait for the dock)
    st.stuck = Math.abs(w.speed) < 0.4 && aligned && (w.medium === 'land' || !!st.homeRoute) ? st.stuck + dt : 0;
    if (st.stuck > 3 && st.homeRoute && st.replans < 2) { st.replans++; st.stuck = 0; st.homeGoal = null; }
    if (st.stuck > 6) { st.home = false; st.stuck = 0; st.homeRoute = null; this.notify(t('pilot.homeBlocked', { unit: w.name })); return null; }
    return v;
  }

  manta(m: Manta, dt: number): InputLike | null {
    const st = this.st(m);
    if (st.turn) return this.turnAbout(m, st, dt);
    const wp = m.waypoint;
    if (!wp) return null;
    if (m.state === 'deck' || m.state === 'pad') { m.toggleLaunch(); return null; }
    if (m.state !== 'flug') return null;
    const dx = wp.x - m.pos.x, dz = wp.y - m.pos.z, dist = Math.hypot(dx, dz);
    // fly to the point, then orbit it anticlockwise at about R (slower in the circle so the turn fits)
    const R = 1100;
    const desired = Math.atan2(dx, dz) + Math.PI / 2 * (1 + THREE.MathUtils.clamp((R - dist) / R, -1, 1));
    if (dist < R * 1.3 && !st.orbiting) { st.orbiting = true; this.notify(t('pilot.orbiting', { unit: m.name })); }
    const diff = wrap(desired - m.yaw);
    const k = MANTA_KEYS, v = st.input;
    v.clear();
    const wantBank = THREE.MathUtils.clamp(-diff * 1.4, -0.95, 0.95);
    v.set(k.right, (wantBank - m.bank) * 2.5);
    const ground = m.pos.y - m.altitude;
    const wantAlt = Math.max(ground + 180, 260);
    const climb = THREE.MathUtils.clamp((wantAlt - m.pos.y) * 0.004, -0.22, 0.3);
    v.set(k.noseUp, (climb + (1 - Math.cos(m.bank)) * 0.5 - m.pitch) * 3);
    v.set(k.more, ((dist < R * 2 ? 0.4 : 0.62) - m.throttle) * 4);
    void dt;
    return v;
  }

  /** one step of "Wenden": banked up to 75° (some 12 s for the half circle at cruising speed), easing off towards the
   *  end; the nose holds the height (never lower than 80 m over the ground), pulled against the sinking of a banked
   *  wing (manta.ts fly: the nose is the climb); the thrust stays as it was */
  private turnAbout(m: Manta, st: PilotState, dt: number): InputLike | null {
    const tn = st.turn!;
    if (m.state !== 'flug') { st.turn = null; return null; }
    tn.age += dt;
    tn.left -= wrap(m.yaw - tn.lastYaw) * tn.dir;
    tn.lastYaw = m.yaw;
    // (the last few degrees come as the wings roll level)
    if (tn.left < 0.12) { st.turn = null; this.notify(t('pilot.turned', { unit: m.name })); return null; }
    const k = MANTA_KEYS, v = st.input;
    v.clear();
    const wantBank = -tn.dir * Math.min(1.3, 0.3 + tn.left * 2.6);
    v.set(k.right, (wantBank - m.bank) * 2.5);
    const ground = m.pos.y - m.altitude;
    const climb = THREE.MathUtils.clamp((Math.max(tn.alt, ground + 80) - m.pos.y) * 0.006, -0.12, 0.2);
    v.set(k.noseUp, (climb - m.pitch) * 3 + (1 - Math.cos(m.bank)) * 0.34);
    return v;
  }
}
