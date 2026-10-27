import type { Archipelago } from '../world/archipelago';
import type { IslandBase } from '../world/base';
import type { Team } from './combat';
import type { Island } from '../world/island';
import { FUEL_TARGET, GOOD_LIST, GOODS, emptyStores, type Good, type Stores } from './stores';
import { t } from '../i18n';

/** 0 low, 1 medium, 2 high (original priority values) */
export type Priority = 0 | 1 | 2;
export const PRIORITY_NAMES = [t('economy.prioLow'), t('economy.prioMid'), t('economy.prioHigh')];
export interface Order { priority: Priority; target: number }

// All numbers after the original (DOS 1.2):
const TICK = 4;                  // mining, orders, production every 4 s
const MINE_RESOURCE = 100;       // per 4 s and mining building (lattice mast, water tower, tank)
const MINE_FACTORY = 25;         // per 4 s and factory building
const MINE_BASE = 100;           // per 4 s, flat
const PACKET = 200;              // raw material packets of resource islands
const MOVE_PACKET = 250;         // stockpile moves
const MATERIAL_ORDER = { steps: 1, rawPerStep: 100, yields: 255 };
const WEIGHTS = [1, 3, 6];       // lottery weights of the three priority lists
const MAX_STOCK = 999;           // per good on the stockpile
const RIGS = new Set(['funkmast', 'lagerhalle', 'tanklager']);
const FACTORIES = new Set(['hangar', 'fabrik']);
/** network links take their length in seconds; the remake's links are shorter, so metres / 300 */
const METRES_PER_SECOND = 300;

/** raw and material store of an island: 2·((A·B)>>16) in the original (2028–9886), here from the size */
export function islandCapacity(isl: Island): number {
  const R = isl.size / 2.8;
  return Math.round(Math.min(10000, Math.max(2000, 2000 + (R - 700) / 600 * 8000)));
}

type JobKind = { kind: 'good'; good: Good } | { kind: 'material'; island: number };
interface Job { island: number; what: JobKind; stage: 'setup' | 'work' | 'ship'; stepsLeft: number }
interface Shipment {
  kind: 'raw' | 'good' | 'material' | 'move'; good?: Good; count: number; at: number; dest: number; nextAt: number;
  /** where it set off; on the way between islands: the island it left and the link's length (s). Saves before M10 lack them */
  origin?: number; from?: number; leg?: number;
}

/** an order on a factory place, for the map and the supply screen */
export interface JobView {
  island: number; good: Good | null; material: number | null; pieces: number;
  /** 0..1 of the work steps */
  progress: number;
  /** seconds until it leaves the factory (if nothing holds it up) */
  eta: number;
  /** what holds it up: raw material missing on the island, or no free transport */
  waiting: 'raw' | 'transport' | null;
}

/** a shipment on its way, for the map and the supply screen */
export interface ShipmentView {
  kind: Shipment['kind']; good: Good | null; count: number;
  origin: number | null; dest: number;
  /** between `from` and `at` (progress 0..1), or waiting at `at` when `from` is null */
  from: number | null; at: number; progress: number;
  /** seconds until it arrives (NaN without a route) */
  eta: number;
}

/**
 * An island network (the player's, or the enemy's by the same rules), as in the original: every 4 s islands mine
 * into their own store, resource islands send raw material in packets to base
 * and factory islands, free factory places draw orders by lottery (priorities
 * weigh 1 : 3 : 6) and work them step by step from their island's store.
 * Shipments hop island by island along the shortest own route, waiting a
 * link's length at every island. Islands without a route to the base get no
 * orders and no deliveries; without the base nothing new is ordered.
 */
export class Economy {
  /** island index of the stockpile */
  stockpile = 0;
  readonly stockpileGoods: Stores = emptyStores();
  readonly orders: Record<Good, Order>;
  readonly raw: number[];
  linked: boolean[];
  frozen = false;
  jobs: Job[] = [];
  shipments: Shipment[] = [];
  /** what the transfer drone carries right now (counts against the target quantity) */
  droneCargo: () => Partial<Stores> = () => ({});
  stats = { rawRate: 0, rawTotal: 0, factories: 0, busy: 0, roles: { rohstoff: 0, fabrik: 0, verteidigung: 0, basis: 0 }, cut: 0, material: 0 };
  onMessage: ((msg: string, cls?: string) => void) | null = null;
  /** for the ship computer's voice: the network froze (no base left), the stockpile island fell */
  onEvent: ((e: 'frozen' | 'depotLost') => void) | null = null;
  time = 0;
  private acc = 0;
  private second = 0;
  private rr = [0, 0, 0];
  private linkSec: Map<number, number>[];

  constructor(private world: Archipelago, private bases: IslandBase[], readonly team: Exclude<Team, 'neutral'> = 'spieler') {
    this.raw = world.islands.map(() => 0);
    this.linked = world.islands.map(() => false);
    // the original starts with all target quantities at 0 (only fuel and material are made)
    this.orders = Object.fromEntries(GOOD_LIST.map(g => [g, { priority: GOODS[g].fuel ? 1 : 0, target: GOODS[g].fuel ? FUEL_TARGET : 0 }])) as Record<Good, Order>;
    this.linkSec = world.islands.map(() => new Map());
    for (const [a, b] of world.links) {
      const A = world.islands[a], B = world.islands[b];
      const s = Math.max(4, Math.round(Math.hypot(A.cx - B.cx, A.cz - B.cz) / METRES_PER_SECOND));
      this.linkSec[a].set(b, s); this.linkSec[b].set(a, s);
    }
    for (const b of bases) if (b.team === team) b.material = 5000;
    this.stockpile = Math.max(0, this.base);
    this.refreshNetwork();
  }

  get base(): number {
    return this.bases.findIndex(b => b.team === this.team && b.island.role === 'basis');
  }

  private own(k: number) { return this.bases[k].team === this.team; }

  /** link time in seconds between two linked islands */
  linkTime(a: number, b: number): number { return this.linkSec[a].get(b) ?? Infinity; }

  /** shortest own-network travel times (seconds) from `from` */
  private times(from: number): number[] {
    const n = this.world.islands.length, d = new Array(n).fill(Infinity), done = new Array(n).fill(false);
    d[from] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && d[i] < Infinity && (u < 0 || d[i] < d[u])) u = i;
      if (u < 0) break;
      done[u] = true;
      for (const [v, s] of this.linkSec[u]) if (this.own(v) && d[u] + s < d[v]) d[v] = d[u] + s;
    }
    return d;
  }

  private refreshNetwork() {
    const b = this.base, was = this.frozen;
    this.frozen = b < 0;
    if (this.frozen && !was) this.onEvent?.('frozen');
    const times = b < 0 ? null : this.times(b);
    this.linked = this.world.islands.map((_, k) => !!times && this.own(k) && times[k] < Infinity);
    this.bases.forEach((base, k) => { if (base.team === this.team) base.linked = this.linked[k]; });
    // a stockpile that fell: its goods are gone, and the original clears all orders too
    if (!this.own(this.stockpile)) {
      const name = this.world.islands[this.stockpile].name;
      for (const g of GOOD_LIST) this.stockpileGoods[g] = 0;
      for (const g of GOOD_LIST) if (!GOODS[g].fuel) this.orders[g] = { priority: 0, target: 0 };
      this.stockpile = Math.max(0, b);
      this.onMessage?.(t('economy.depotLost', { island: name }), 'bad');
      this.onEvent?.('depotLost');
    }
  }

  /** islands that can become the stockpile */
  get stockpileChoices(): number[] {
    return this.linked.map((l, k) => l ? k : -1).filter(k => k >= 0);
  }

  get moving(): boolean { return this.shipments.some(s => s.kind === 'move'); }

  /** a new stockpile: the old stock travels there over the network in packets of 250 */
  setStockpile(k: number): string {
    if (!this.linked[k] || k === this.stockpile) return t('economy.cannotDepot');
    if (this.moving) return t('economy.depotMoving');
    for (const g of GOOD_LIST) {
      let n = this.stockpileGoods[g];
      while (n > 0) {
        const c = Math.min(n, MOVE_PACKET);
        this.shipments.push({ kind: 'move', good: g, count: c, at: this.stockpile, dest: k, nextAt: this.time, origin: this.stockpile });
        n -= c;
      }
      this.stockpileGoods[g] = 0;
    }
    this.stockpile = k;
    return '';
  }

  /** counted against the target quantity: stockpile, drone, shipments, orders (not the carrier's hold) */
  have(g: Good): number {
    return this.stockpileGoods[g] + (this.droneCargo()[g] ?? 0) + this.inTransit(g) +
      this.jobs.reduce((a, j) => a + (j.what.kind === 'good' && j.what.good === g ? GOODS[g].pieces : 0), 0);
  }

  private count(k: number, set: Set<string>): number {
    return this.bases[k].buildings.filter(b => b.alive && set.has(b.p.type)).length;
  }

  /** factory places: round hangars and factories (the base has its hangar) */
  private places(k: number): number {
    const role = this.bases[k].island.role;
    return this.own(k) && (role === 'fabrik' || role === 'basis') ? this.count(k, FACTORIES) : 0;
  }

  private mining(k: number): number {
    const base = this.bases[k], role = base.island.role;
    if (!this.own(k) || !base.commandCentre?.alive) return 0;
    if (role === 'basis') return MINE_BASE;
    if (role === 'rohstoff') return MINE_RESOURCE * this.count(k, RIGS);
    if (role === 'fabrik') return MINE_FACTORY * this.count(k, FACTORIES);
    return 0;
  }

  update(dt: number) {
    this.acc += dt;
    while (this.acc >= 1) {
      this.acc -= 1;
      this.time += 1;
      this.transport();
      if (++this.second >= TICK) { this.second = 0; this.tick(); }
    }
  }

  // ---------- every second: shipments hop along the network ----------
  private transport() {
    const keep: Shipment[] = [];
    for (const s of this.shipments) {
      if (this.time < s.nextAt) { keep.push(s); continue; }
      if (!this.own(s.at)) { this.lost(s); continue; }
      if (s.at === s.dest) { if (!this.deliver(s)) { s.nextAt = this.time + 1; keep.push(s); } continue; }
      const t = this.times(s.dest);
      let next = -1;
      for (const [v, sec] of this.linkSec[s.at]) if (this.own(v) && t[v] < Infinity && t[v] + sec === t[s.at]) { next = v; break; }
      if (next < 0) {
        // no route: raw material is unloaded where it is, everything else is lost
        if (s.kind === 'raw') this.raw[s.at] = Math.min(islandCapacity(this.world.islands[s.at]), this.raw[s.at] + s.count);
        else this.lost(s);
        continue;
      }
      // travel as long as the link is (the shipment counts as at the next island already)
      s.leg = this.linkTime(s.at, next);
      s.nextAt = this.time + s.leg;
      s.from = s.at;
      s.at = next;
      keep.push(s);
    }
    this.shipments = keep;
  }

  private deliver(s: Shipment): boolean {
    const isl = this.world.islands[s.dest];
    if (s.kind === 'raw') {
      const cap = islandCapacity(isl);
      if (this.raw[s.dest] >= cap) return false;
      this.raw[s.dest] = Math.min(cap, this.raw[s.dest] + s.count);
    } else if (s.kind === 'material') {
      this.bases[s.dest].material += s.count;
    } else if (s.dest === this.stockpile) {
      this.stockpileGoods[s.good!] = Math.min(MAX_STOCK, this.stockpileGoods[s.good!] + s.count);
      if (s.kind === 'good' && !GOODS[s.good!].fuel) this.onMessage?.(t('economy.arrived', { n: s.count, good: GOODS[s.good!].short, island: isl.name }));
    } else this.lost(s);
    return true;
  }

  private lost(s: Shipment) {
    if (s.kind === 'good' || s.kind === 'move') this.onMessage?.(t('economy.shipmentLost', { n: s.count, good: GOODS[s.good!].short }), 'bad');
  }

  // ---------- every 4 s: mining, raw distribution, production, orders ----------
  private tick() {
    this.refreshNetwork();
    const islands = this.world.islands, n = islands.length;
    let rawRate = 0;
    for (let k = 0; k < n; k++) {
      const m = this.mining(k);
      if (!m) continue;
      this.raw[k] = Math.min(islandCapacity(islands[k]), this.raw[k] + m);
      if (this.linked[k]) rawRate += m / TICK;
    }
    this.distributeRaw();
    this.produce();
    this.assign();

    const roles = { rohstoff: 0, fabrik: 0, verteidigung: 0, basis: 0 };
    islands.forEach((isl, k) => { if (this.linked[k] && isl.role) roles[isl.role]++; });
    let factories = 0;
    for (let k = 0; k < n; k++) if (this.linked[k]) factories += this.places(k);
    this.stats = {
      rawRate, rawTotal: this.raw.reduce((a, v, k) => a + (this.own(k) ? v : 0), 0), factories,
      busy: this.jobs.length, roles, cut: this.bases.filter((b, k) => b.team === this.team && !this.linked[k]).length,
      material: this.shipments.filter(s => s.kind === 'material').length,
    };
  }

  private distributeRaw() {
    const islands = this.world.islands, n = islands.length;
    const incoming = new Array(n).fill(0);
    for (const s of this.shipments) if (s.kind === 'raw') incoming[s.dest] += s.count;
    // requests: base and factory islands below capacity, once per factory building; nearly empty ones first
    let req: number[] = [];
    const low: number[] = [];
    for (let k = 0; k < n; k++) {
      const role = islands[k].role;
      if (!this.linked[k] || (role !== 'basis' && role !== 'fabrik')) continue;
      const cap = islandCapacity(islands[k]);
      if (this.raw[k] + incoming[k] >= cap) continue;
      const times = Math.max(1, this.count(k, FACTORIES));
      for (let i = 0; i < times; i++) (this.raw[k] < cap / 4 ? low : req).push(k);
    }
    if (low.length) req = low;
    if (!req.length) return;
    const sources = [...Array(n).keys()].filter(k => this.linked[k] && islands[k].role === 'rohstoff');
    let inFlight = this.shipments.filter(s => s.kind === 'raw').length;
    const limit = 2 * sources.length;
    for (const k of sources) {
      while (this.raw[k] >= PACKET && inFlight < limit) {
        const dest = req[Math.floor(Math.random() * req.length)];
        this.raw[k] -= PACKET;
        this.shipments.push({ kind: 'raw', count: PACKET, at: k, dest, nextAt: this.time, origin: k });
        inFlight++;
      }
    }
  }

  private produce() {
    const islands = this.world.islands;
    const producers = islands.filter((isl, k) => this.own(k) && (isl.role === 'basis' || isl.role === 'fabrik')).length;
    let goodsInFlight = this.shipments.filter(s => s.kind !== 'raw').length;
    const keep: Job[] = [];
    for (const j of this.jobs) {
      // a factory that was lost takes its order with it
      if (!this.own(j.island)) continue;
      if (j.stage === 'setup') { j.stage = 'work'; keep.push(j); continue; }
      if (j.stage === 'work') {
        const per = j.what.kind === 'good' ? GOODS[j.what.good].rawPerStep : MATERIAL_ORDER.rawPerStep;
        if (this.raw[j.island] >= per) {
          this.raw[j.island] -= per;
          if (--j.stepsLeft <= 0) j.stage = 'ship';
        }
        keep.push(j);
        continue;
      }
      // ship (at most 2 shipments per base and factory island on the way)
      if (goodsInFlight >= 2 * producers) { keep.push(j); continue; }
      if (j.what.kind === 'good') {
        this.shipments.push({ kind: 'good', good: j.what.good, count: GOODS[j.what.good].pieces, at: j.island, dest: this.stockpile, nextAt: this.time, origin: j.island });
      } else {
        this.shipments.push({ kind: 'material', count: MATERIAL_ORDER.yields, at: j.island, dest: j.what.island, nextAt: this.time, origin: j.island });
      }
      goodsInFlight++;
    }
    this.jobs = keep;
  }

  /** free factory places draw orders: three lists (low, medium, high) weighted 1 : 3 : 6 */
  private assign() {
    if (this.frozen) return;
    const islands = this.world.islands, n = islands.length;
    const lists: JobKind[][] = [[], [], []];
    for (const g of GOOD_LIST) {
      const o = this.orders[g];
      if (o.target > 0 && this.have(g) < o.target) lists[o.priority].push({ kind: 'good', good: g });
    }
    // building material for own islands below capacity (medium when under half full)
    const ordered = new Set<number>();
    for (const j of this.jobs) if (j.what.kind === 'material') ordered.add(j.what.island);
    for (const s of this.shipments) if (s.kind === 'material') ordered.add(s.dest);
    for (let k = 0; k < n; k++) {
      if (!this.linked[k] || ordered.has(k)) continue;
      const cap = islandCapacity(islands[k]), m = this.bases[k].material;
      if (m < cap) lists[m < cap / 2 ? 1 : 0].push({ kind: 'material', island: k });
    }
    for (const l of lists) l.sort(() => Math.random() - 0.5);
    for (let k = 0; k < n; k++) {
      if (!this.linked[k]) continue;
      let free = this.places(k) - this.jobs.filter(j => j.island === k).length;
      while (free > 0) {
        const w = lists.map((l, p) => l.length * WEIGHTS[p]), total = w[0] + w[1] + w[2];
        if (!total) return;
        let r = Math.random() * total, p = 0;
        while (r >= w[p]) { r -= w[p]; p++; }
        const list = lists[p];
        const what = list[this.rr[p]++ % list.length];
        const steps = what.kind === 'good' ? GOODS[what.good].steps : MATERIAL_ORDER.steps;
        this.jobs.push({ island: k, what, stage: 'setup', stepsLeft: steps });
        free--;
        // a filled order leaves the list
        if (what.kind === 'material' || this.have(what.good) >= this.orders[what.good].target) list.splice(list.indexOf(what), 1);
      }
    }
  }

  /** for the supply screen */
  inTransit(g: Good): number {
    return this.shipments.reduce((a, s) => a + (s.good === g && (s.kind === 'good' || s.kind === 'move') ? s.count : 0), 0);
  }

  /** orders on the factory places with their progress and the time left */
  jobViews(): JobView[] {
    const islands = this.world.islands;
    const producers = islands.filter((isl, k) => this.own(k) && (isl.role === 'basis' || isl.role === 'fabrik')).length;
    const transportFull = this.shipments.filter(s => s.kind !== 'raw').length >= 2 * producers;
    const toTick = TICK - this.second - this.acc;   // seconds until the next 4 s tick
    // raw material each island can spend at the next tick, handed out in the order the jobs are worked
    const budget = islands.map((_, k) => this.raw[k] + this.mining(k));
    return this.jobs.map(j => {
      const good = j.what.kind === 'good' ? j.what.good : null;
      const steps = good ? GOODS[good].steps : MATERIAL_ORDER.steps;
      const per = good ? GOODS[good].rawPerStep : MATERIAL_ORDER.rawPerStep;
      const ticks = j.stage === 'setup' ? steps + 2 : j.stage === 'work' ? j.stepsLeft + 1 : 1;
      let waiting: JobView['waiting'] = null;
      if (j.stage === 'work') { if (budget[j.island] >= per) budget[j.island] -= per; else waiting = 'raw'; }
      if (j.stage === 'ship' && transportFull) waiting = 'transport';
      return {
        island: j.island, good, material: j.what.kind === 'material' ? j.what.island : null,
        pieces: good ? GOODS[good].pieces : MATERIAL_ORDER.yields,
        progress: j.stage === 'setup' ? 0 : j.stage === 'work' ? 1 - j.stepsLeft / steps : 1,
        eta: Math.max(0, toTick + (ticks - 1) * TICK), waiting,
      };
    });
  }

  /** shipments with their position on the network and the time until they arrive */
  shipmentViews(): ShipmentView[] {
    const now = this.time + this.acc, routes = new Map<number, number[]>();
    const timesTo = (d: number) => { let r = routes.get(d); if (!r) { r = this.times(d); routes.set(d, r); } return r; };
    return this.shipments.map(s => {
      const wait = Math.max(0, s.nextAt - now);
      const moving = s.from !== undefined && !!s.leg && wait > 0;
      const rest = s.at === s.dest ? 0 : timesTo(s.dest)[s.at];
      return {
        kind: s.kind, good: s.good ?? null, count: s.count, origin: s.origin ?? null, dest: s.dest,
        from: moving ? s.from! : null, at: s.at, progress: moving ? 1 - wait / s.leg! : 0,
        eta: isFinite(rest) ? wait + rest : NaN,
      };
    });
  }

  inProduction(g: Good): { orders: number; progress: number } {
    const js = this.jobs.filter(j => j.what.kind === 'good' && j.what.good === g);
    const total = GOODS[g].steps;
    return { orders: js.length, progress: js.length ? Math.max(...js.map(j => 1 - j.stepsLeft / total)) : 0 };
  }

  // ---- save game ----
  saveState() {
    return {
      stockpile: this.stockpile, stockpileGoods: { ...this.stockpileGoods }, orders: structuredClone(this.orders), raw: [...this.raw],
      jobs: structuredClone(this.jobs), shipments: structuredClone(this.shipments),
      time: this.time, acc: this.acc, second: this.second, rr: [...this.rr],
    };
  }

  /** after the bases: the network is worked out again from the islands' owners */
  loadState(s: ReturnType<Economy['saveState']>) {
    this.stockpile = s.stockpile;
    Object.assign(this.stockpileGoods, s.stockpileGoods);
    for (const g of GOOD_LIST) if (s.orders[g]) this.orders[g] = { ...s.orders[g] };
    s.raw.forEach((v, k) => { if (k < this.raw.length) this.raw[k] = v; });
    this.jobs = structuredClone(s.jobs); this.shipments = structuredClone(s.shipments);
    this.time = s.time; this.acc = s.acc; this.second = s.second; this.rr = [...s.rr];
    this.refreshNetwork();
  }
}
