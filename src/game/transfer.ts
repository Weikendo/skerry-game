import * as THREE from 'three';
import { waveHeight } from '../world/ocean';
import type { Archipelago } from '../world/archipelago';
import type { Environment } from '../world/environment';
import type { CarrierController } from './carrierController';
import type { Economy } from './economy';
import { GOOD_LIST, GOODS, type Good, type Stores } from './stores';
import { t, km } from '../i18n';

export type TransferState = 'bereit' | 'hin' | 'angedockt' | 'zurueck';
/** what the drone does, for the ship computer's voice: under way, docked, delivered, the hold full (part goes back),
 *  back and ready, called off; and why a launch by hand was refused (busy, too far, nothing, the network frozen) */
export type TransferEvent = 'start' | 'angedockt' | 'geliefert' | 'voll' | 'bereit' | 'abbruch' | 'unterwegs' | 'zu-weit' | 'nichts' | 'netz';

/** the carrier must be this close to the stockpile island for a transfer */
export const TRANSFER_RANGE = 3500;
const SPEED = 25;          // m/s, faster than the carrier at full speed
const BOW_Z = 108;         // carrier-local docking point ahead of the bow
const DOCK_TIME = 5;

/**
 * The semi-submersible transfer drone (Operations Guide): it loads what the
 * carrier's hold can take from the stockpile island, runs out to the carrier,
 * docks at the bow, unloads and returns submerged.
 */
export class TransferDrone {
  state: TransferState = 'bereit';
  /** launch by itself whenever the carrier is in range and something is waiting */
  auto = true;
  readonly cargo: Partial<Stores> = {};
  readonly pos = new THREE.Vector3();
  heading = 0;
  private home = new THREE.Vector3();
  private dockTimer = 0;
  private aborted = false;
  onEvent?: (e: TransferEvent) => void;

  constructor(readonly model: THREE.Group, private world: Archipelago, private env: Environment,
    private carrier: CarrierController, private economy: Economy, private notify: (msg: string, cls?: string) => void) {
    model.visible = false;
  }

  /** distance from the carrier to the stockpile island */
  get distance(): number {
    return this.world.islands[this.economy.stockpile].distanceTo(this.carrier.pos.x, this.carrier.pos.z);
  }

  get inRange(): boolean {
    return !this.economy.frozen && this.distance < TRANSFER_RANGE;
  }

  /** what the next trip would bring: as much as the hold and the tanks take (the drone itself has no limit) */
  plan(): Partial<Stores> {
    const out: Partial<Stores> = {};
    for (const g of GOOD_LIST) {
      const n = Math.min(this.economy.stockpileGoods[g], Math.floor(GOODS[g].cap - this.carrier.stores[g] + 1e-6));
      if (n > 0) out[g] = n;
    }
    return out;
  }

  /** start a trip; returns a reason if it cannot */
  launch(): string {
    if (this.state !== 'bereit') { this.onEvent?.('unterwegs'); return t('transfer.busy'); }
    if (this.economy.frozen) { this.onEvent?.('netz'); return t('transfer.frozen'); }
    if (!this.inRange) { this.onEvent?.('zu-weit'); return t('transfer.tooFar', { dist: km(this.distance), max: km(TRANSFER_RANGE) }); }
    const load = this.plan();
    if (!Object.keys(load).length) { this.onEvent?.('nichts'); return t('transfer.nothing'); }
    for (const g of Object.keys(load) as Good[]) { this.economy.stockpileGoods[g] -= load[g]!; this.cargo[g] = load[g]; }
    // set off from the island's shore on the side facing the carrier
    const isl = this.world.islands[this.economy.stockpile];
    const dir = new THREE.Vector3(this.carrier.pos.x - isl.cx, 0, this.carrier.pos.z - isl.cz).normalize();
    this.home.set(isl.cx, 0, isl.cz);
    for (let d = 0; d < isl.size; d += 25) {
      this.home.set(isl.cx + dir.x * d, 0, isl.cz + dir.z * d);
      if (this.world.heightAt(this.home.x, this.home.z) < -4) break;
    }
    this.pos.copy(this.home);
    this.state = 'hin';
    this.aborted = false;
    this.model.visible = true;
    this.notify(t('transfer.launched', { cargo: this.describe(load) }));
    this.onEvent?.('start');
    return '';
  }

  /** call the drone back (cargo returns to the stockpile) */
  abort() {
    if (this.state !== 'hin' && this.state !== 'angedockt') return;
    this.aborted = true;
    this.state = 'zurueck';
    this.notify(t('transfer.aborted'), 'bad');
    this.onEvent?.('abbruch');
  }

  describe(s: Partial<Stores>): string {
    return (Object.keys(s) as Good[]).map(g => GOODS[g].fuel ? t('goods.fuelAmount', { n: Math.round(s[g]!), good: GOODS[g].short }) : t('goods.count', { n: s[g]!, good: GOODS[g].short })).join(', ');
  }

  update(dt: number) {
    if (this.state === 'bereit') {
      // automatic trips (the original only had the manual launch): once a few pieces or a tank's worth wait
      if (this.auto && this.inRange) {
        const p = this.plan();
        const pieces = (Object.keys(p) as Good[]).reduce((a, g) => a + (GOODS[g].fuel ? 0 : p[g]!), 0);
        const fuel = (Object.keys(p) as Good[]).reduce((a, g) => a + (GOODS[g].fuel ? p[g]! : 0), 0);
        if (pieces >= 3 || fuel >= 24 || p.accb || p.walrus || p.manta || p.drohne) this.launch();
      }
      return;
    }
    const bow = this.carrier.localToWorld(0, BOW_Z);
    if (this.state === 'hin') {
      // the carrier left the stockpile's area: the transfer is called off
      if (this.distance > TRANSFER_RANGE * 1.15) { this.abort(); return; }
      if (this.move(bow, SPEED + Math.max(0, this.carrier.speed), dt) < 8) { this.state = 'angedockt'; this.dockTimer = DOCK_TIME; this.onEvent?.('angedockt'); }
    } else if (this.state === 'angedockt') {
      this.pos.copy(bow);
      this.heading = this.carrier.heading + Math.PI;
      this.dockTimer -= dt;
      if (this.dockTimer <= 0) this.unload();
    } else {
      if (this.move(this.home, SPEED, dt) < 10) {
        if (this.aborted) for (const g of Object.keys(this.cargo) as Good[]) this.economy.stockpileGoods[g] += this.cargo[g]!;
        for (const g of Object.keys(this.cargo) as Good[]) delete this.cargo[g];
        this.state = 'bereit';
        this.model.visible = false;
        this.onEvent?.('bereit');
        return;
      }
    }
    this.pose();
  }

  private move(target: THREE.Vector3, speed: number, dt: number): number {
    const d = new THREE.Vector3(target.x - this.pos.x, 0, target.z - this.pos.z);
    const dist = d.length();
    if (dist > 1e-3) {
      this.pos.addScaledVector(d.normalize(), Math.min(dist, speed * dt));
      let dh = Math.atan2(d.x, d.z) - this.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.heading += THREE.MathUtils.clamp(dh, -1.5 * dt, 1.5 * dt);
    }
    return dist;
  }

  private unload() {
    const st = this.carrier.stores;
    let back = false;
    for (const g of Object.keys(this.cargo) as Good[]) {
      const n = Math.min(this.cargo[g]!, Math.max(0, Math.floor(GOODS[g].cap - st[g] + 1e-6)));
      st[g] += n;
      // whatever no longer fits goes back with the drone
      this.economy.stockpileGoods[g] += this.cargo[g]! - n;
      if (this.cargo[g]! - n > 0.5) back = true;
    }
    this.notify(t('transfer.delivered', { cargo: this.describe(this.cargo) }), 'good');
    this.onEvent?.('geliefert');
    if (back) this.onEvent?.('voll');
    for (const g of Object.keys(this.cargo) as Good[]) delete this.cargo[g];
    this.state = 'zurueck';
  }

  private pose() {
    const w = waveHeight(this.pos.x, this.pos.z, this.env.elapsed, this.env.w.waves);
    // on the way back the drone runs submerged, only the hump shows
    const y = this.state === 'zurueck' ? w - 1.7 : w - 0.3;
    this.model.position.set(this.pos.x, y, this.pos.z);
    this.model.rotation.set(0, this.heading, 0);
  }

  // ---- save game ----
  saveState() {
    return {
      state: this.state, auto: this.auto, cargo: { ...this.cargo }, pos: this.pos.toArray(), heading: this.heading,
      home: this.home.toArray(), dockTimer: this.dockTimer, aborted: this.aborted,
    };
  }

  loadState(s: ReturnType<TransferDrone['saveState']>) {
    this.state = s.state; this.auto = s.auto;
    for (const g of Object.keys(this.cargo) as Good[]) delete this.cargo[g];
    Object.assign(this.cargo, s.cargo);
    this.pos.fromArray(s.pos); this.heading = s.heading; this.home.fromArray(s.home);
    this.dockTimer = s.dockTimer; this.aborted = s.aborted;
    this.model.visible = s.state !== 'bereit';
    if (this.model.visible) this.pose();
  }
}
