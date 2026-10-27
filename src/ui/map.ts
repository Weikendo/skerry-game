import { PAL } from '../engine/palette';
import type { Archipelago } from '../world/archipelago';
import { TURRET_RANGE, type IslandBase } from '../world/base';
import type { Island, Landing } from '../world/island';
import type { Survey } from '../world/survey';
import type { Team } from '../game/combat';
import { DRONE_RANGE } from '../game/drone';
import { SHALLOW } from '../game/carrierController';
import { ROLE_NAMES } from '../world/worldgen';
import type { Economy, JobView, ShipmentView } from '../game/economy';
import { arrival, cargoColor, cargoText, clock, jobState, jobText } from './network';
import { renderChart } from './islandChart';
import { TRANSFER_RANGE, type TransferDrone } from '../game/transfer';
import { SHIP_NAME } from '../game/names';
import { bearing, fleetIds, kindOf, windEffect, type Fleet, type UnitId, type Vehicle } from './hud';
import { FleetStatus, HEAD_ICON, KN, pad3, picto, POINTS, posText, TopBar, type StatusInfo } from './fleetStatus';
import { t, km, num, pct } from '../i18n';
import { uiScale } from './scale';

// map colours (UI, derived from the palette)
const CHART = '#3d5262';   // unmapped land: only the coastline from the sea charts
export const OWNER_COLORS: Record<Team, string> = { spieler: PAL.ocker, feind: PAL.feindHell, neutral: PAL.stahlHell };
export const OWNER_NAMES: Record<Team, string> = { spieler: t('owner.spieler'), feind: t('owner.feind'), neutral: t('owner.neutral') };
const RADAR_RANGE = 4000;
/** height of the status bar over the map */
const TOP = 38;

/** the stockpile island and everything about refuelling */
const DEPOT = '#5fd6ab';
/** landing places on a cliff coast */
const LANDING = '#ece3c4';

/**
 * Where the ship lies off an island it was sent to: `clear` metres of water deep enough for it all round (its bow
 * reaches 125 m ahead), then `margin` further out (it stops a little past the point, the coast limiter slows it
 * near shallows), out of reach of every enemy gun by `gun`; a berth off the straight line from the ship costs
 * `turn` metres per radian of bearing.
 */
const BERTH = { clear: 200, margin: 260, gun: TURRET_RANGE + 300, step: 20, turn: 400 };
/** the bearings tried, from the island towards the ship and up to 90° either side */
const BERTH_BEARINGS = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6].map(i => i * Math.PI / 12);

/**
 * A berth off island `isl` for the ship coming from (fromX, fromZ): walking out from the island's middle on each
 * bearing to the first point where the water round it is deep enough and no enemy gun reaches it (neighbouring
 * islands and skerries count too), and BERTH.margin beyond; within the transfer drone's range of the island
 * (a course to the stockpile island must end in its delivery area). The nearest wins. The coast, not the island's
 * square, sets the distance: close neighbours often leave only a channel between them.
 */
function berth(world: Archipelago, bases: IslandBase[], isl: Island, fromX: number, fromZ: number): { x: number; z: number } {
  const a0 = Math.atan2(fromX - isl.cx, fromZ - isl.cz);
  const guns = bases.filter(b => b.team === 'feind').flatMap(b => b.buildings.filter(bd => bd.head && bd.alive).map(bd => bd.p));
  const RING = Array.from({ length: 12 }, (_, i) => [Math.sin(i * Math.PI / 6) * BERTH.clear, Math.cos(i * Math.PI / 6) * BERTH.clear]);
  const clear = (x: number, z: number) => world.heightAt(x, z) < SHALLOW && RING.every(([ox, oz]) => world.heightAt(x + ox, z + oz) < SHALLOW)
    && guns.every(g => Math.hypot(g.x - x, g.z - z) > BERTH.gun);
  // cliffs all round: off the landing place nearest the ship, out along its ramp (the Otters go ashore there)
  const landings = [...isl.landings].sort((p, q) => Math.hypot(p.x - fromX, p.z - fromZ) - Math.hypot(q.x - fromX, q.z - fromZ));
  for (const L of landings) {
    for (let r = 0; isl.distanceTo(L.x + L.nx * (r + BERTH.margin), L.z + L.nz * (r + BERTH.margin)) < TRANSFER_RANGE - 300; r += BERTH.step) {
      const x = L.x + L.nx * r, z = L.z + L.nz * r;
      if (clear(x, z) && clear(x + L.nx * BERTH.margin, z + L.nz * BERTH.margin)) return { x: x + L.nx * BERTH.margin, z: z + L.nz * BERTH.margin };
    }
  }
  let best: { x: number; z: number } | null = null, bs = Infinity;
  for (const da of BERTH_BEARINGS) {
    const dx = Math.sin(a0 + da), dz = Math.cos(a0 + da), cost = Math.abs(da) * BERTH.turn;
    for (let r = 0; r + BERTH.margin + cost < bs; r += BERTH.step) {
      const x = isl.cx + dx * r, z = isl.cz + dz * r;
      const bx = x + dx * BERTH.margin, bz = z + dz * BERTH.margin;
      if (isl.distanceTo(bx, bz) > TRANSFER_RANGE - 300) break;
      if (!clear(x, z) || !clear(bx, bz)) continue;
      best = { x: bx, z: bz };
      bs = r + BERTH.margin + cost;
      break;
    }
  }
  // (nothing clear in reach: well out on the straight line, as before)
  return best ?? { x: isl.cx + Math.sin(a0) * (isl.size / 2 + 2500), z: isl.cz + Math.cos(a0) * (isl.size / 2 + 2500) };
}
/** a landing place on the chart: three steps across its ramp, the widest at the coast, narrowing out to sea */
function landingGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, L: Landing, k: number) {
  const ax = L.nx, ay = L.nz, bx = -ay, by = ax;
  ctx.save();
  ctx.lineCap = 'round';
  for (const [w, c] of [[3.6 * k, 'rgba(10, 22, 30, 0.85)'], [1.6 * k, LANDING]] as const) {
    ctx.lineWidth = w; ctx.strokeStyle = c;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const d = (i * 3.2 - 1) * k, half = (5 - i * 1.3) * k;
      ctx.moveTo(x + ax * d - bx * half, y + ay * d - by * half);
      ctx.lineTo(x + ax * d + bx * half, y + ay * d + by * half);
    }
    ctx.stroke();
  }
  ctx.restore();
}
/** eight-point compass direction from (x, z) to (tx, tz); north is −z */
function direction(x: number, z: number, tx: number, tz: number): string {
  const a = (Math.atan2(tx - x, -(tz - z)) * 180 / Math.PI + 360) % 360;
  return POINTS[Math.round(a / 45) % 8];
}

/** the enemy's carrier as far as the player knows: in view, or where it was seen last */
export interface EnemyView {
  name: string;
  visible: boolean;
  x: number; z: number; heading: number;
  /** m/s */
  speed: number;
  /** hull 0..1 (only known while in view) */
  hull: number;
  /** "vor 14 min" */
  age: string;
  /** distance from the Stoorworm (m) */
  dist: number;
}

/** a button on the selected unit's card */
export interface MapCommand { id: string; label: string; on?: boolean; title?: string }

/** what the map asks the game to do */
export interface MapActions {
  /** `append`: add to the unit's route instead of replacing it (Shift+click) */
  waypoint(unit: UnitId, x: number, z: number, append?: boolean): void;
  clearWaypoint(unit: UnitId): void;
  cockpit(unit: UnitId): void;
  active(): UnitId;
  /** the map picked a unit: it becomes the one of its kind the player drives and sees */
  select(unit: UnitId): void;
  /** the unit's orders for its card (launch, stop, land, back to the carrier …) */
  commands(unit: UnitId): MapCommand[];
  command(unit: UnitId, id: string): void;
  /** waypoints queued after the current one (Shift+click) */
  route(unit: UnitId): { x: number; y: number }[];
  /** the points an Otter's autopilot drives through on its way to the current waypoint (round cliffs, over a landing), or null */
  path(unit: UnitId): { x: number; z: number }[] | null;
  /** which waypoint of its route the unit is heading for, and how many there are */
  progress(unit: UnitId): { step: number; total: number } | null;
  /** what the unit is doing on its own (its standing order), for the card */
  order(unit: UnitId): string;
  /** send the transfer drone now (tells why not) */
  launchTransfer(): void;
  /** make island k the stockpile island (tells why not) */
  setDepot(k: number): void;
  /** island k has a camera (radio mast or command centre), and switch the big picture to it */
  hasIslandCam(k: number): boolean;
  islandCam(k: number): void;
  /** the unit (a Skua) attacks the enemy nearest (x, z), within `r` m; tells why not */
  strike(unit: UnitId, x: number, z: number, r: number): void;
  /** the stores and supply screen, on its goods or on its list of the islands */
  supply(): void;
  islandList(): void;
}

/** what happened to one of the player's islands: an Otter attacks, Skuas come in, a building fell, the island fell */
export type IslandAlarm = 'attack' | 'raid' | 'hit' | 'lost';

/**
 * Strategic map (M) in the spirit of the original map screen, plus a small
 * radar for the 3D view. The controls are the console's (deck.ts); the map
 * provides three of its sections: supplies (the ship's tank against the way to
 * the stockpile island, the transfer drone, the stores screen), the islands
 * (the network, attacks, what is made where, the island picked on the map
 * with its orders) and time and weather with the wind rose. A click on the map sets
 * the waypoint of the unit picked for it (the ship's by default), a click on
 * an island picks it, a double click sends the ship there. Islands the drone
 * has not mapped yet only show their coastline. The stockpile island, where
 * the ship takes on fuel, is marked with the transfer drone's delivery area.
 */
export class MapView {
  open = false;
  /** the wind (m/s, x east, z south) for the compass */
  wind: () => { x: number; z: number } = () => ({ x: 0, z: 0 });
  /** the time and weather section (clock, weather, wind, forecast) */
  info: () => string = () => '';
  /** for the status bar: time, date and weather (with its id for the icon) */
  status: () => StatusInfo = () => ({ time: '', date: '', weather: '', weatherId: 'klar', enemy: { cls: '', text: '' } });
  /** the enemy's carrier, null until it has been seen once */
  enemy: () => EnemyView | null = () => null;
  /** height kept free along the bottom of the screen (the helm bar) */
  bottomInset: () => number = () => 0;
  /** the enemy's Otters and Skuas in sight */
  enemyUnits: () => { kind: 'walrus' | 'manta'; name: string; x: number; z: number; heading: number }[] = () => [];
  /** defence drones round the ships (set by the game) */
  shields: () => { x: number; z: number; foe: boolean }[] = () => [];
  /** the player's Skuas on a strike and their targets (set by the game) */
  strikes: () => { from: { x: number; z: number }; to: { x: number; z: number }; home: boolean }[] = () => [];
  /** the next click picks this Skua's target to attack (the card's "Attack" button), or null */
  strikeFor: UnitId | null = null;
  /** observation drones in the air, and how far the player's guides its Hammerheads (m; set by the game) */
  observers: () => { x: number; z: number; foe: boolean; reach: number }[] = () => [];
  /** the ship's course was set to island k (a double click, "Kurs setzen", the stockpile island) */
  onCourse: (k: number) => void = () => {};
  private overlay: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  /** the radar: drawn while the 3D view is up, shown on the screen of the unit the 3D view shows (see monitors.ts) */
  readonly radar: HTMLCanvasElement;
  private images = new Map<Island, HTMLCanvasElement>();
  private charts = new Map<Island, { canvas: HTMLCanvasElement; version: number }>();
  private bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  private sweep = 0;
  /** view: centre in world metres and zoom (1 = whole archipelago) */
  private view = { x: 0, z: 0, zoom: 1 };
  /** seconds until the islands section's chart is drawn again */
  private chartTimer = 0;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private infoEl: HTMLDivElement;
  private helpEl: HTMLDivElement;
  private sideEl: HTMLDivElement;
  private ids: UnitId[];
  /** the sections the console shows: supplies, the picked island, time and weather */
  readonly panels: { supply: HTMLElement; islands: HTMLElement; weather: HTMLElement };
  /** the weather section's wind rose and the wind's effect on the ship */
  private roseEl: HTMLCanvasElement;
  private windEl: HTMLDivElement;
  private aimEl: HTMLDivElement;
  /** the island picked on the map (-1: the one nearest the ship) and its section */
  private island = -1;
  private islEl!: { box: HTMLElement; net: HTMLElement; alarm: HTMLElement; prod: HTMLElement; name: HTMLElement; where: HTMLElement; info: HTMLElement; chart: HTMLCanvasElement;
    btns: Record<'course' | 'depot' | 'cam', HTMLButtonElement> };
  /** the player's islands under attack lately (set by the game), newest first, `ago` in seconds */
  alarms: () => { island: number; what: IslandAlarm; ago: number }[] = () => [];
  /** the last island click for the ship, to tell a double click */
  private lastPick = { k: -1, at: 0 };
  /** a Shift+click route is being laid for a unit other than the ship */
  private routing = false;
  private panelTimer = 0;
  /** the unit that gets the next waypoint: the ship, unless another unit was picked for the next click */
  selected: UnitId = 'traeger';
  /** the console's columns cover the map at the sides (set by the game) */
  columns: () => { l: number; r: number } = () => ({ l: 0, r: 0 });
  /** pointer position over the map (for the island info), null when outside */
  private hover: { x: number; y: number } | null = null;
  private tipEl: HTMLDivElement;
  private top: TopBar;
  private fs: FleetStatus;
  /** shipment crates drawn this frame (for the pointer) */
  private shipIcons: { x: number; y: number; v: ShipmentView }[] = [];
  /** the stockpile island and the transfer drone (set by the game): where the ship refuels */
  supply: { economy: Economy; transfer: TransferDrone } | null = null;
  private fuelEl!: { box: HTMLElement; pct: HTMLSpanElement; fill: HTMLElement; need: HTMLElement; text: HTMLDivElement; drone: HTMLDivElement };

  constructor(private world: Archipelago, private bases: IslandBase[], private fleet: Fleet, private survey: Survey, private actions: MapActions, fs: FleetStatus) {
    this.ids = fleetIds(fleet);
    this.fs = fs;
    const m = 1600;
    this.bounds = {
      minX: Math.min(...world.islands.map(i => i.cx - i.size / 2)) - m, maxX: Math.max(...world.islands.map(i => i.cx + i.size / 2)) + m,
      minZ: Math.min(...world.islands.map(i => i.cz - i.size / 2)) - m, maxZ: Math.max(...world.islands.map(i => i.cz + i.size / 2)) + m,
    };

    this.overlay = document.createElement('div');
    this.overlay.id = 'map';
    this.overlay.className = 'skin';
    this.overlay.innerHTML = `<canvas></canvas>
      <div class="maphelp"></div>
      <div class="isltip" hidden></div>
      <div class="mapaim" hidden></div>
      <div class="mapbtns"><button data-z="in">+</button><button data-z="out">−</button><button data-z="sel">${t('map.zoomSel')}</button><button data-z="all">${t('map.zoomAll')}</button></div>`;
    // the supply, island and weather sections sit in the console's columns, over the 3D view as well
    this.sideEl = document.createElement('div');
    this.sideEl.innerHTML = `<section class="sec mapfuel" data-sec="ship">
        <header>${picto('traeger')}<b>${t('sec.supply')}</b><span class="grow"></span><button class="fold" data-fold="ship" title="${t('sec.fold')}">▴</button></header>
        <div class="sbody">
          <div class="fgauge"><span>${t('map.fuel')}</span><div class="fbar"><i class="ffill"></i><i class="fneed" title="${t('map.needTitle', { ship: SHIP_NAME })}"></i></div><span class="fpct"></span></div>
          <div class="ftext"></div>
          <div class="fdrone"></div>
          <div class="fbtns"><button data-f="launch" title="${t('map.launchDroneTitle')}">${t('map.launchDrone')}</button><button data-f="show" title="${t('map.showTitle')}">${t('map.show')}</button><button data-f="supply" title="${t('map.supplyTitle')}">${t('map.supplyBtn')}</button></div>
        </div>
      </section>
      <section class="sec islands" data-sec="islands">
        <header>${HEAD_ICON.islands}<b>${t('sec.islands')}</b><span class="grow"></span><button data-i="list" title="${t('isl.listTitle')}">${t('isl.list')}</button>` +
          `<button class="fold" data-fold="islands" title="${t('sec.fold')}">▴</button></header>
        <div class="sbody">
          <div class="inet"></div>
          <div class="ialarm"></div>
          <div class="iprod"></div>
          <canvas class="ichart" title="${t('isl.chartTitle')}"></canvas>
          <div class="islpanel">
            <div class="ihead"><button class="iname" title="${t('isl.showTitle')}"></button><span class="iwhere"></span></div>
            <div class="iinfo"></div>
            <div class="ibtns"><button data-i="course"></button><button data-i="depot"></button><button data-i="cam"></button></div>
          </div>
        </div>
      </section>
      <section class="sec" data-sec="wx">
        <header>${HEAD_ICON.clock}<b>${t('sec.weather')}</b><span class="grow"></span><button class="fold" data-fold="wx" title="${t('sec.fold')}">▴</button></header>
        <div class="sbody cwx"><canvas class="wrose"></canvas><div class="mapinfo"></div><div class="weff"></div></div>
      </section>`;
    const [supply, islands, weather] = [...this.sideEl.children] as HTMLElement[];
    this.panels = { supply, islands, weather };
    this.roseEl = weather.querySelector('canvas')!;
    this.windEl = weather.querySelector('.weff')!;
    this.canvas = this.overlay.querySelector('canvas')!;
    this.infoEl = this.sideEl.querySelector('.mapinfo')!;
    this.helpEl = this.overlay.querySelector('.maphelp')!;
    this.tipEl = this.overlay.querySelector('.isltip')!;
    this.aimEl = this.overlay.querySelector('.mapaim')!;
    this.top = new TopBar('<i class="tsep"></i><span class="tsector"></span><i class="tsep"></i><span class="tpos"></span><span class="tptr"></span>');
    this.overlay.insertBefore(this.top.el, this.helpEl);
    document.body.append(this.overlay);
    this.radar = document.createElement('canvas');
    this.radar.className = 'radar';
    this.buildSide();
    this.resetView();
    this.canvas.addEventListener('pointerdown', (e) => { this.drag = { x: e.clientX, y: e.clientY, moved: false }; });
    this.canvas.addEventListener('pointerleave', () => { this.hover = null; });
    this.canvas.addEventListener('pointermove', (e) => {
      this.hover = { x: e.offsetX / uiScale(), y: e.offsetY / uiScale() };
      if (!this.drag || !(e.buttons & 1)) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
      if (this.drag.moved) {
        const { s } = this.scale(this.cw(), this.ch()), k = uiScale();
        this.view.x -= dx / k / s; this.view.z -= dy / k / s;
        this.drag.x = e.clientX; this.drag.y = e.clientY;
      }
    });
    this.canvas.addEventListener('click', (e) => {
      const moved = this.drag?.moved;
      this.drag = null;
      if (moved) return;
      this.clickAt(e.offsetX / uiScale(), e.offsetY / uiScale(), e.shiftKey);
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomAt(e.offsetX / uiScale(), e.offsetY / uiScale(), Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    this.overlay.querySelectorAll<HTMLButtonElement>('.mapbtns button').forEach(btn => btn.addEventListener('click', () => {
      const cx = this.centreX(), cy = this.centreY();
      if (btn.dataset.z === 'in') this.zoomAt(cx, cy, 1.6);
      else if (btn.dataset.z === 'out') this.zoomAt(cx, cy, 1 / 1.6);
      else if (btn.dataset.z === 'sel') this.centreOn(this.selected);
      else this.resetView();
      btn.blur();
    }));
    // right-click: an island is picked (whoever the next click is for), on open water the target's waypoint goes
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const k = this.islandAt(e.offsetX / uiScale(), e.offsetY / uiScale());
      if (k >= 0) this.pickIsland(k);
      else this.actions.clearWaypoint(this.selected);
    });

    addEventListener('keyup', (e) => { if (e.key === 'Shift') this.routeDone(); });
  }

  // ---------- the sections for the console: supply, island, weather ----------
  private buildSide() {
    const q = (c: string) => this.sideEl.querySelector<HTMLDivElement>(c)!;
    // the ship and weather sections fold away (remembered in the browser)
    let folded: string[] = [];
    try { folded = JSON.parse(localStorage.getItem('skerry-map-folded') ?? '[]'); } catch { /* storage blocked */ }
    this.sideEl.querySelectorAll<HTMLElement>('[data-sec]').forEach(sec => sec.classList.toggle('folded', folded.includes(sec.dataset.sec!)));
    this.sideEl.querySelectorAll<HTMLButtonElement>('button.fold').forEach(b => b.addEventListener('click', () => {
      const sec = b.closest<HTMLElement>('[data-sec]')!;
      sec.classList.toggle('folded');
      // (the sections live in the console by now: ask them, not their first container)
      const now = [this.panels.supply, this.panels.islands, this.panels.weather].filter(x => x.classList.contains('folded')).map(x => x.dataset.sec!);
      try { localStorage.setItem('skerry-map-folded', JSON.stringify(now)); } catch { /* storage blocked */ }
      b.blur();
    }));
    const isl = this.panels.islands, iq = (c: string) => isl.querySelector<HTMLButtonElement>(c)!;
    this.islEl = {
      box: iq('.islpanel'), net: iq('.inet'), alarm: iq('.ialarm'), prod: iq('.iprod'), name: iq('.iname'), where: iq('.iwhere'), info: iq('.iinfo'),
      chart: isl.querySelector<HTMLCanvasElement>('canvas.ichart')!,
      btns: { course: iq('[data-i="course"]'), depot: iq('[data-i="depot"]'), cam: iq('[data-i="cam"]') },
    };
    // an island named under attacks or production: the section shows it (and the map, if open)
    isl.addEventListener('click', (e) => {
      const line = (e.target as HTMLElement).closest<HTMLElement>('[data-k]');
      if (!line) return;
      const k = Number(line.dataset.k);
      this.pickIsland(k);
      if (this.open) this.centreOnIsland(k);
    });
    // the island's chart: a click shows the island on the map (opening it)
    this.islEl.chart.addEventListener('click', () => {
      if (!this.open) this.toggle();
      this.centreOnIsland(this.islandShown());
    });
    this.islEl.name.addEventListener('click', () => {
      if (this.open) this.centreOnIsland(this.islandShown());
      this.islEl.name.blur();
    });
    isl.querySelectorAll<HTMLButtonElement>('[data-i]').forEach(b => b.addEventListener('click', () => {
      const k = this.islandShown(), id = b.dataset.i;
      if (id === 'course') this.courseTo(k);
      else if (id === 'depot') this.actions.setDepot(k);
      else if (id === 'cam') this.actions.islandCam(k);
      else this.actions.islandList();
      b.blur();
      this.updateIsland();
    }));
    const box = q('.mapfuel');
    this.fuelEl = {
      box, pct: box.querySelector('.fpct')!, fill: box.querySelector('.ffill')!, need: box.querySelector('.fneed')!,
      text: box.querySelector('.ftext')!, drone: box.querySelector('.fdrone')!,
    };
    box.querySelectorAll<HTMLButtonElement>('[data-f]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.f === 'launch') this.actions.launchTransfer();
      else if (b.dataset.f === 'supply') this.actions.supply();
      else this.showDepot();
      b.blur();
    }));
  }

  // ---------- the ship's tank and the stockpile island ----------
  private updateFuel() {
    const c = this.fleet.carrier, f = this.fuelEl, fuel = c.fuel, sup = this.supply;
    const col = fuel > 0.35 ? PAL.ockerHell : fuel > 0.15 ? PAL.rettungsOrange : '#ef5a4a';
    f.pct.textContent = pct(fuel);
    f.pct.style.color = col;
    f.fill.style.width = `${(fuel * 100).toFixed(1)}%`;
    f.fill.style.background = col;
    f.box.classList.toggle('low', fuel < 0.15);
    // per metre the ship burns the same at any speed up to full; flank speed and the wind change that
    const reach = fuel * c.fuelRange / (c.speedBurn * c.windFactor), wind = windEffect(c.windFactor);
    const range = fuel > 0 ? t('map.range', { dist: km(reach) }) + (wind ? ` · ${wind}` : '') : `<span class="warn">${t('map.tankEmpty')}</span>`;
    if (!sup) { f.text.innerHTML = range; f.drone.textContent = ''; f.need.style.display = 'none'; return; }
    const { economy: e, transfer: drone } = sup, isl = this.world.islands[e.stockpile];
    const dist = drone.distance, need = Math.max(0, dist - TRANSFER_RANGE);
    // what the way there costs: the wind on that course (the speed as now)
    const toD = Math.hypot(isl.cx - c.pos.x, isl.cz - c.pos.z) || 1;
    const burnThere = c.speedBurn * c.windFactorFor((isl.cx - c.pos.x) / toD, (isl.cz - c.pos.z) / toD);
    const reachThere = fuel * c.fuelRange / burnThere;
    const where = drone.inRange ? t('map.inArea') : `${km(dist)} ${direction(c.pos.x, c.pos.z, isl.cx, isl.cz)}`;
    const short = !drone.inRange && fuel > 0 && reachThere < need;
    f.text.innerHTML = (short ? `<span class="warn">${t('map.rangeShort', { dist: km(reachThere), missing: km(need - reachThere) })}</span>` : range) +
      ` · ${t('map.depotShort', { island: isl.name, where })}`;
    f.need.style.display = drone.inRange ? 'none' : '';
    f.need.style.left = `${Math.min(100, need * burnThere / c.fuelRange * 100).toFixed(1)}%`;
    f.drone.textContent = e.frozen ? t('map.frozen')
      : drone.state !== 'bereit' ? t('map.droneState', { state: t(`transfer.state.${drone.state}`) })
        : drone.inRange ? (drone.auto ? t('map.droneReadyAuto') : t('map.droneReadyManual'))
          : t('map.toAreaShort', { dist: km(need) });
  }

  /** a waypoint in open water inside the stockpile island's delivery area, on the side facing the ship */
  courseToDepot() {
    if (this.supply) this.courseTo(this.supply.economy.stockpile);
  }

  /** the ship's waypoint at a berth off island k, on the side facing the ship as far as the coast allows (see berth) */
  courseTo(k: number) {
    const c = this.fleet.carrier, isl = this.world.islands[k];
    const p = berth(this.world, this.bases, isl, c.pos.x, c.pos.z);
    this.actions.waypoint('traeger', p.x, p.z);
    this.onCourse(k);
  }

  private showDepot() {
    if (!this.supply) return;
    const isl = this.world.islands[this.supply.economy.stockpile], h = this.ch();
    const s1 = this.scale(this.cw(), h).s / this.view.zoom;
    this.view.x = isl.cx; this.view.z = isl.cz;
    this.view.zoom = Math.max(1, h * 0.8 / ((isl.size + 2 * TRANSFER_RANGE) * s1));
  }

  /** the stockpile island: a fuel badge, the delivery area and the transfer drone */
  private drawDepot(ctx: CanvasRenderingContext2D, X: (x: number) => number, Y: (z: number) => number, s: number) {
    const { economy: e, transfer: drone } = this.supply!, isl = this.world.islands[e.stockpile], c = this.fleet.carrier;
    const R = TRANSFER_RANGE, half = isl.size / 2, inRange = drone.inRange;
    ctx.save();
    // the delivery area: everything within 3.5 km of the island's square
    ctx.beginPath();
    ctx.roundRect(X(isl.cx - half - R), Y(isl.cz - half - R), (isl.size + 2 * R) * s, (isl.size + 2 * R) * s, R * s);
    ctx.fillStyle = inRange ? 'rgba(95, 214, 171, 0.10)' : 'rgba(95, 214, 171, 0.04)';
    ctx.fill();
    ctx.setLineDash(inRange ? [] : [8, 6]);
    ctx.lineWidth = inRange ? 2 : 1.5;
    ctx.strokeStyle = 'rgba(95, 214, 171, 0.8)';
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '600 11px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = DEPOT;
    ctx.fillText(t('map.areaLabel', { range: km(R) }).toUpperCase(), X(isl.cx), Y(isl.cz - half - R) + 14);
    // low on fuel and out of range: a line pointing the way
    if (!inRange && c.fuel < 0.35) {
      ctx.setLineDash([2, 6]);
      ctx.strokeStyle = 'rgba(95, 214, 171, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(X(c.pos.x), Y(c.pos.z)); ctx.lineTo(X(isl.cx), Y(isl.cz)); ctx.stroke();
      ctx.setLineDash([]);
    }
    // badge with a fuel drop above the island, on top of everything on it
    const bx = X(isl.cx), by = Y(isl.cz - isl.size * 0.36) - 12;
    ctx.lineWidth = 2;
    ctx.fillStyle = '#0b1a26';
    ctx.strokeStyle = DEPOT;
    ctx.beginPath(); ctx.arc(bx, by, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = DEPOT;
    ctx.beginPath();
    ctx.moveTo(bx, by - 7);
    ctx.bezierCurveTo(bx + 1.5, by - 3.5, bx + 4.5, by - 0.5, bx + 4.5, by + 2);
    ctx.arc(bx, by + 2, 4.5, 0, Math.PI);
    ctx.bezierCurveTo(bx - 4.5, by - 0.5, bx - 1.5, by - 3.5, bx, by - 7);
    ctx.fill();
    if (s > 0.018) {   // zoomed in: spell it out next to the badge (the overview is crowded with names)
      ctx.font = '700 11px -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#0b1a26';
      const badge = t('map.depotBadge').toUpperCase();
      ctx.strokeText(badge, bx + 15, by + 4);
      ctx.fillText(badge, bx + 15, by + 4);
    }
    // the transfer drone on its way
    if (drone.state !== 'bereit') {
      const x = X(drone.pos.x), y = Y(drone.pos.z);
      ctx.fillStyle = DEPOT;
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f2e6c8';
      ctx.font = '11px -apple-system, sans-serif';
      ctx.fillText(t('map.transferDrone'), x + 8, y + 4);
    }
    ctx.restore();
  }

  /** while the map is open: the status bar, the help line, the label at the pointer */
  private updateSide() {
    this.updateTop();
    const c = this.columns(), btns = this.overlay.querySelector<HTMLElement>('.mapbtns')!;
    btns.style.right = `${c.r + 2}px`;
    btns.style.bottom = this.helpEl.style.bottom = `${this.bottom() + 2}px`;
    // the help line between the left column and the zoom buttons
    this.helpEl.style.left = `${c.l}px`; this.helpEl.style.right = `${c.r + this.size(btns).w + 12}px`;
    // a narrow map leaves out the click hint (the label at the pointer says what a click does)
    const wide = this.cw() - c.l - c.r > 820;
    this.helpEl.innerHTML = t('map.help') + (wide ? ` · ${t('map.clickHint')}` : '');
    this.updateAim();
  }

  /** the console's sections, in both views a few times a second */
  private updatePanels(dt: number) {
    this.panelTimer -= dt;
    if (this.panelTimer > 0) return;
    this.panelTimer = 0.1;
    this.updateFuel();
    const info = this.info();
    if (this.infoEl.innerHTML !== info) this.infoEl.innerHTML = info;
    this.updateWind();
    this.updateIslands();
    this.chartTimer -= 0.1;
    if (this.chartTimer <= 0) { this.chartTimer = 0.25; this.drawIslandChart(); }
  }

  /** the weather's wind rose with the wind arrow, and what the wind does to the ship */
  private updateWind() {
    const cv = this.roseEl, k = uiScale(), dpr = Math.min(devicePixelRatio, 2), shown = cv.getBoundingClientRect().width;
    if (!shown) return;
    if (cv.width !== Math.round(shown * dpr)) cv.width = cv.height = Math.round(shown * dpr);
    const ctx = cv.getContext('2d')!, w = shown / k, wind = this.wind();
    ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
    ctx.clearRect(0, 0, w, w);
    this.compass(ctx, w / 2, w / 2, w / 2 - 15, wind);
    const c = this.fleet.carrier, effect = windEffect(c.windFactor);
    const html = `${SHIP_NAME}: <b>${effect || t('wind.noEffect')}</b>`;
    if (this.windEl.innerHTML !== html) this.windEl.innerHTML = html;
  }

  // ---------- the islands: the network, attacks, production, and the picked island ----------
  private updateIslands() {
    const E = this.islEl, e = this.supply?.economy, set = (el: HTMLElement, html: string) => { if (el.innerHTML !== html) el.innerHTML = html; };
    const isles = this.world.islands, name = (k: number) => `<b data-k="${k}">${isles[k].name}</b>`;
    if (e) {
      // the network: how many islands and what they do
      const own = isles.filter((_, k) => this.bases[k]?.team === 'spieler').length, r = e.stats.roles;
      const growing = this.bases.filter(b => b.team === 'spieler' && (b.pending || b.construction)).length;
      set(E.net, t('isl.net', { n: own, raw: r.rohstoff, factory: r.fabrik, defence: r.verteidigung }) +
        (growing ? ` · ${t('isl.netGrowing', { n: growing })}` : '') + (e.stats.cut ? ` · <span class="warn">${t('supply.cut', { n: e.stats.cut })}</span>` : ''));
      // what is made where, the first to be done first
      const jobs = e.jobViews().sort((a, b) => a.eta - b.eta);
      // (up to four; lower windows show fewer, see index.html)
      set(E.prod, jobs.length ? jobs.slice(0, 4).map(j => `<div>${name(j.island)}: ${jobText(j, this.world)} <small>${jobState(j)}</small></div>`).join('') : `<div>${t('map.noJobs')}</div>`);
    }
    // attacks on the player's islands lately, the newest first
    const alarms = this.alarms();
    set(E.alarm, alarms.slice(0, 3).map(a => `<div>⚠ ${name(a.island)}: ${t(`isl.alarm.${a.what}`)} <small>${t('isl.ago', { time: clock(a.ago) })}</small></div>`).join(''));
    this.updateIsland();
  }

  // ---------- the picked island: what is known of it and what can be done there ----------
  /** the island the section shows: the picked one, else the one nearest the ship */
  private islandShown(): number {
    if (this.island >= 0) return this.island;
    const c = this.fleet.carrier;
    return this.world.islands.indexOf(this.world.nearest(c.pos.x, c.pos.z).island);
  }

  /** a click on an island: the section shows it (and lights up a moment) */
  pickIsland(k: number) {
    this.island = k;
    const box = this.islEl.box;
    box.classList.remove('flash');
    void box.offsetWidth;   // (restarts the animation)
    box.classList.add('flash');
    this.updateIsland();
  }

  /**
   * The picked (or nearest) island in the islands section's spare room: its chart as far as it is mapped, the
   * buildings seen there in their owner's colour (the command centre bigger, sites outlined, ruins crossed), the
   * reach of enemy guns, the units nearby and a scale. Drawn four times a second; hidden when there is no room.
   */
  private drawIslandChart() {
    const cv = this.islEl.chart, k = uiScale(), w = cv.clientWidth, h = cv.clientHeight;
    if (w < 40 || h < 50) { cv.style.visibility = 'hidden'; return; }
    cv.style.visibility = '';
    const dpr = Math.min(devicePixelRatio, 2) * k;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b1a26';
    ctx.fillRect(0, 0, w, h);
    const i = this.islandShown(), isl = this.world.islands[i], base = this.bases[i];
    const team = base?.team ?? 'neutral', s = Math.min(w, h) / isl.size;
    const X = (x: number) => w / 2 + (x - isl.cx) * s, Y = (z: number) => h / 2 + (z - isl.cz) * s;
    ctx.drawImage(this.chartOf(isl, i), X(isl.cx - isl.size / 2), Y(isl.cz - isl.size / 2), isl.size * s, isl.size * s);
    const seen = (x: number, z: number) => team === 'spieler' || this.survey.seen(i, x, z);
    for (const b of base?.buildings ?? []) {
      if (!b.head || !b.alive || team !== 'feind' || !seen(b.p.x, b.p.z)) continue;
      // (a defence island has six: faint, so the island stays readable under them)
      ctx.fillStyle = 'rgba(239, 90, 74, 0.025)';
      ctx.strokeStyle = 'rgba(239, 90, 74, 0.38)';
      ctx.beginPath(); ctx.arc(X(b.p.x), Y(b.p.z), 950 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    for (const L of this.landingsKnown(i)) landingGlyph(ctx, X(L.x), Y(L.z), L, 1);
    const col = OWNER_COLORS[base?.pending?.team ?? team];
    for (const b of base?.buildings ?? []) {
      if (!seen(b.p.x, b.p.z)) continue;
      const x = X(b.p.x), y = Y(b.p.z), r = Math.max(3, b.p.r * s), cc = b.p.type === 'kommandozentrale';
      ctx.lineWidth = 1.4;
      if (!b.alive && !b.underConstruction) {
        ctx.strokeStyle = '#8a96a3';
        ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke();
      } else if (b.underConstruction) {
        ctx.strokeStyle = col; ctx.setLineDash([2, 2]);
        ctx.strokeRect(x - r, y - r, r * 2, r * 2); ctx.setLineDash([]);
      } else if (b.p.type === 'landeplatz') {
        ctx.strokeStyle = '#8fe9ff';
        ctx.beginPath(); ctx.arc(x, y, Math.max(4, r), 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.fillStyle = col; ctx.fillRect(x - r, y - r, r * 2, r * 2);
        if (b.head) { ctx.fillStyle = '#0b1a26'; ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.fill(); }
        if (cc) { ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.stroke(); }
      }
    }
    ctx.lineWidth = 1;
    // units on and around it
    const inView = (x: number, z: number) => X(x) > -8 && X(x) < w + 8 && Y(z) > -8 && Y(z) < h + 8;
    for (const u of this.ids) {
      const p = this.fs.unitPos(u);
      if (p.visible && inView(p.x, p.z)) this.icon(ctx, X(p.x), Y(p.z), p.heading, u === 'traeger' ? 7 : 5, undefined, this.fs.color(u));
    }
    for (const u of this.enemyUnits()) if (inView(u.x, u.z)) this.icon(ctx, X(u.x), Y(u.z), u.heading, 5, undefined, OWNER_COLORS.feind);
    const e = this.enemy();
    if (e?.visible && inView(e.x, e.z)) this.icon(ctx, X(e.x), Y(e.z), e.heading, 7, undefined, OWNER_COLORS.feind, true);
    // north and a scale
    ctx.fillStyle = '#8fa3b2'; ctx.font = '600 10px -apple-system, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText('N ▲', w - 5, 12);
    const len = [100, 250, 500, 1000].find(m => m * s > 36) ?? 1000;
    ctx.strokeStyle = '#b8c4cf'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(6, h - 6); ctx.lineTo(6 + len * s, h - 6); ctx.stroke();
    ctx.textAlign = 'left'; ctx.fillText(len >= 1000 ? km(len, 0) : `${len} m`, 6, h - 10);
    ctx.lineWidth = 1;
  }

  private updateIsland() {
    const k = this.islandShown(), isl = this.world.islands[k], E = this.islEl, c = this.fleet.carrier;
    const teams = this.world.islands.map(i => this.baseOf(i)?.team ?? 'neutral'), e = this.supply?.economy;
    const own = teams[k] === 'spieler', depot = e?.stockpile === k, linked = !!e?.linked[k], cam = this.actions.hasIslandCam(k);
    if (E.name.textContent !== isl.name) E.name.textContent = isl.name;
    const dist = Math.hypot(isl.cx - c.pos.x, isl.cz - c.pos.z);
    const where = `${this.island < 0 ? `${t('isl.nearest')} · ` : ''}${km(dist)} ${direction(c.pos.x, c.pos.z, isl.cx, isl.cz)}`;
    if (E.where.textContent !== where) E.where.textContent = where;
    const info = this.islandLines(k, teams);
    if (E.info.innerHTML !== info) E.info.innerHTML = info;
    const btn = (b: HTMLButtonElement, label: string, title: string, off: boolean) => {
      if (b.textContent !== label) b.textContent = label;
      b.title = title;
      b.disabled = off;
    };
    btn(E.btns.course, t('isl.b.course'), t('isl.course', { ship: SHIP_NAME }), false);
    btn(E.btns.depot, t(depot ? 'isl.b.isDepot' : 'isl.b.depot'), depot ? t('isl.isDepot') : !own ? t('isl.notOwn') : !linked ? t('isl.cut') : t('isl.depot'), depot || !own || !linked);
    btn(E.btns.cam, t('isl.b.cam'), cam ? t('isl.camTitle') : t('isl.noCam'), !cam);
  }

  /** at the pointer (or the gamepad's cross) who the next click is for, or the island it opens */
  private updateAim() {
    const pos = this.hover;
    if (!pos) { this.aimEl.hidden = true; return; }
    const u = this.strikeFor ?? this.selected, k = this.islandAt(pos.x, pos.y);
    const text = this.strikeFor ? t('map.aimStrike', { unit: this.fs.name(u) })
      : u === 'traeger' && k >= 0 ? t('map.aimIsland', { island: this.world.islands[k].name })
      : t('map.aimFor', { unit: u === 'drohne' ? t('drone.short') : this.fs.name(u) });
    const html = `${picto(kindOf(u))}${text}`;
    if (this.aimEl.innerHTML !== html) this.aimEl.innerHTML = html;
    this.aimEl.style.setProperty('--uc', this.fs.color(u));
    this.aimEl.style.left = `${pos.x + 16}px`;
    this.aimEl.style.top = `${pos.y - 30}px`;
    this.aimEl.hidden = false;
  }

  /**
   * A click on the map. With the ship as the target a click on an island picks
   * it for the console's island section (the ship cannot go ashore), a second
   * click on it right after sends the ship there; otherwise the target's
   * waypoint is set there, and for another unit the next click is the ship's
   * again (a Shift+click route keeps the unit until Shift is let go).
   */
  private clickAt(px: number, py: number, append: boolean) {
    if (this.strikeFor) {
      // the target for a Skua's attack: the enemy nearest the click, within about 26 pixels
      const u = this.strikeFor, p = this.toWorld(px, py), q = this.toWorld(px + 26, py);
      this.strikeFor = null;
      this.actions.strike(u, p.x, p.z, Math.max(150, Math.hypot(q.x - p.x, q.z - p.z)));
      this.select('traeger');
      return;
    }
    const k = this.islandAt(px, py);
    if (k >= 0 && this.selected === 'traeger' && !append) {
      const now = performance.now(), again = this.lastPick.k === k && now - this.lastPick.at < 450;
      this.lastPick = { k, at: again ? 0 : now };
      if (again) this.courseTo(k); else this.pickIsland(k);
      return;
    }
    const p = this.toWorld(px, py);
    this.actions.waypoint(this.selected, p.x, p.z, append);
    if (this.selected === 'traeger') return;
    if (append) this.routing = true; else this.select('traeger');
  }

  /** Shift let go after a route for a unit: the next click is the ship's again */
  private routeDone() {
    if (!this.routing) return;
    this.routing = false;
    if (this.open && this.selected !== 'traeger') this.select('traeger');
  }

  /** the island under a screen point, -1 for open water */
  private islandAt(px: number, py: number): number {
    const p = this.toWorld(px, py), { island, distance } = this.world.nearest(p.x, p.z);
    return distance < island.size * 0.42 ? this.world.islands.indexOf(island) : -1;
  }

  select(u: UnitId) {
    this.selected = u;
    this.actions.select(u);
  }

  /** the map shows island k in the middle */
  centreOnIsland(k: number) {
    const c = this.world.islands[k];
    this.view.x = c.cx; this.view.z = c.cz;
    this.view.zoom = Math.max(this.view.zoom, 4);
  }

  centreOn(u: UnitId) {
    const p = this.fs.unitPos(u);
    this.view.x = p.x; this.view.z = p.z;
    this.view.zoom = Math.max(this.view.zoom, 4);
  }

  /** the status bar: where the selected unit is, its radio link, supplies, the ship's tank, weather and time */
  private updateTop() {
    const u = this.selected, p = this.fs.unitPos(u), T = this.top;
    T.field('tsector').textContent = t('top.sector', { island: this.world.nearest(p.x, p.z).island.name });
    T.field('tpos').textContent = posText(p.x, p.z);
    const cur = this.hover ? this.toWorld(this.hover.x, this.hover.y) : null;
    T.field('tptr').textContent = cur ? t('top.pointer', { pos: posText(cur.x, cur.z) }) : '';
    T.update(this.fs, u, this.supply?.economy, this.status());
  }


  toggle() {
    this.open = !this.open;
    this.overlay.style.display = this.open ? 'block' : 'none';
    // the settings panel would cover the unit list
    document.body.classList.toggle('map-open', this.open);
    // the next click is the ship's, unless another unit is picked first
    this.selected = 'traeger';
    this.routing = false;
    this.strikeFor = null;
    this.panelTimer = 0;
  }

  /** small top-down picture of an island: biome colour, shallows */
  /** the island's relief picture, made the first time it is needed (a few ms each) */
  private image(isl: Island): HTMLCanvasElement {
    let c = this.images.get(isl);
    if (!c) { c = renderChart(isl); this.images.set(isl, c); }
    return c;
  }

  /** the island as the player knows it: chart silhouette, mapped parts in full colour */
  private chartOf(isl: Island, k: number): HTMLCanvasElement {
    const version = this.survey.version[k];
    let entry = this.charts.get(isl);
    if (entry && entry.version === version) return entry.canvas;
    const full = this.image(isl);
    if (this.survey.progress(k) >= 0.999) {
      this.charts.set(isl, { canvas: full, version });
      return full;
    }
    const canvas = entry && entry.canvas !== full ? entry.canvas : document.createElement('canvas');
    canvas.width = canvas.height = full.width;
    const ctx = canvas.getContext('2d')!;
    // silhouette
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(full, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = CHART;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // mapped cells in colour (soft edges from the upscaled mask)
    const R = this.survey.res;
    const mask = document.createElement('canvas');
    mask.width = mask.height = R;
    const mctx = mask.getContext('2d')!, md = mctx.createImageData(R, R), m = this.survey.mask(k);
    for (let i = 0; i < R * R; i++) md.data[i * 4 + 3] = m[i] ? 255 : 0;
    mctx.putImageData(md, 0, 0);
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = full.width;
    const tctx = tmp.getContext('2d')!;
    tctx.drawImage(full, 0, 0);
    tctx.globalCompositeOperation = 'destination-in';
    tctx.imageSmoothingEnabled = true;
    tctx.drawImage(mask, 0, 0, full.width, full.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(tmp, 0, 0);
    entry = { canvas, version };
    this.charts.set(isl, entry);
    return canvas;
  }

  private resetView() {
    const b = this.bounds;
    this.view = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, zoom: 1 };
  }

  /** zoom by `factor`, keeping the world point under the cursor in place */
  private zoomAt(px: number, py: number, factor: number) {
    const before = this.toWorld(px, py);
    this.view.zoom = Math.min(40, Math.max(0.7, this.view.zoom * factor));
    const after = this.toWorld(px, py);
    this.view.x += before.x - after.x;
    this.view.z += before.z - after.z;
  }

  /** the console's columns and the helm bar along the bottom cover the map: keep them free */
  /** the canvas in UI pixels (the map is drawn and pointed at in these; the interface's scale grows them on big screens) */
  private cw(): number { return this.canvas.clientWidth / uiScale(); }
  private ch(): number { return this.canvas.clientHeight / uiScale(); }
  /** a zoomed element's size in UI pixels */
  private size(el: HTMLElement): { w: number; h: number } {
    const r = el.getBoundingClientRect(), k = uiScale();
    return { w: r.width / k, h: r.height / k };
  }

  /** what covers the map along the bottom: the helm bar */
  private bottom(): number { return this.bottomInset(); }

  private insets(_w: number): { l: number; r: number; t: number; b: number } {
    const c = this.columns();
    return { l: c.l, r: c.r, t: TOP, b: this.bottom() };
  }

  /** screen y of the view centre (the middle between the status bar and the helm) */
  private centreY(): number {
    const h = this.ch(), b = this.bottom();
    return TOP + (h - TOP - b) / 2;
  }

  /** screen x of the view centre (the middle of the free area) */
  private centreX(): number {
    const w = this.cw(), { l, r } = this.insets(w);
    return l + (w - l - r) / 2;
  }

  /** pixels per metre and the screen position of the view centre */
  private scale(w: number, h: number) {
    const b = this.bounds, { l, r, t: top, b: bottom } = this.insets(w), hh = Math.max(80, h - top - bottom), ww = Math.max(80, w - l - r);
    const s = Math.min(ww / (b.maxX - b.minX), hh / (b.maxZ - b.minZ)) * this.view.zoom;
    return { s, ox: l + ww / 2 - this.view.x * s, oy: top + hh / 2 - this.view.z * s };
  }

  private toWorld(px: number, py: number) {
    const { s, ox, oy } = this.scale(this.cw(), this.ch());
    return { x: (px - ox) / s, z: (py - oy) / s };
  }

  update(dt: number, focus: { x: number; z: number; heading: number }) {
    this.sweep = (this.sweep + dt * 1.6) % (Math.PI * 2);
    if (!this.open) this.drawRadar(focus);
    this.updatePanels(dt);
    if (this.open) { this.drawMap(); this.updateSide(); }
    else this.warmCharts();
  }

  /** while the map is closed, make the island pictures one at a time (~4 ms each) so opening it does not stall */
  private warmCharts() {
    if (this.images.size >= this.world.islands.length) return;
    const t0 = performance.now();
    for (const isl of this.world.islands) {
      if (this.images.has(isl)) continue;
      this.image(isl);
      if (performance.now() - t0 > 3) break;
    }
  }

  private baseOf(isl: Island): IslandBase | undefined {
    return this.bases.find(b => b.island === isl);
  }

  /** owner and role are only known for own islands or once the drone has mapped half the island */
  private knows(k: number): boolean {
    return this.survey.known(k) || this.bases[k]?.team === 'spieler';
  }

  private drawMap() {
    const cv = this.canvas, dpr = Math.min(devicePixelRatio, 2), k = uiScale();
    const w = cv.clientWidth / k, h = cv.clientHeight / k;
    if (cv.width !== Math.round(cv.clientWidth * dpr) || cv.height !== Math.round(cv.clientHeight * dpr)) { cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr); }
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
    ctx.fillStyle = '#071620';
    ctx.fillRect(0, 0, w, h);
    const { s, ox, oy } = this.scale(w, h);
    const X = (x: number) => ox + x * s, Y = (z: number) => oy + z * s;

    // grid: 1 km lines (100 m when zoomed in far), every 5th line brighter
    const tl = this.toWorld(0, 0), br = this.toWorld(w, h);
    const step = s > 0.6 ? 100 : 1000;
    ctx.lineWidth = 1;
    for (let gx = Math.ceil(tl.x / step) * step; gx < br.x; gx += step) {
      ctx.strokeStyle = Math.round(gx / step) % 5 === 0 ? 'rgba(80, 220, 255, 0.15)' : 'rgba(80, 220, 255, 0.06)';
      ctx.beginPath(); ctx.moveTo(X(gx), 0); ctx.lineTo(X(gx), h); ctx.stroke();
    }
    for (let gz = Math.ceil(tl.z / step) * step; gz < br.z; gz += step) {
      ctx.strokeStyle = Math.round(gz / step) % 5 === 0 ? 'rgba(80, 220, 255, 0.15)' : 'rgba(80, 220, 255, 0.06)';
      ctx.beginPath(); ctx.moveTo(0, Y(gz)); ctx.lineTo(w, Y(gz)); ctx.stroke();
    }

    // supply network: a link carries supplies only between islands of the same owner
    const isles = this.world.islands;
    const teams = isles.map(isl => this.baseOf(isl)?.team ?? 'neutral');
    const known = isles.map((_, k) => this.knows(k));
    const hovered = this.hoveredIsland();
    for (const [a, b] of this.world.links) {
      const open = known[a] && known[b] && teams[a] === teams[b] && teams[a] !== 'neutral';
      const hi = hovered !== null && (isles[a] === hovered || isles[b] === hovered);
      ctx.strokeStyle = open ? OWNER_COLORS[teams[a]] : hi ? '#7fa6b8' : '#2f5b70';
      ctx.globalAlpha = open ? 0.75 : 1;
      ctx.lineWidth = open ? 2.5 : hi ? 1.8 : 1.2;
      ctx.setLineDash(open ? [] : [5, 5]);
      ctx.beginPath(); ctx.moveTo(X(isles[a].cx), Y(isles[a].cz)); ctx.lineTo(X(isles[b].cx), Y(isles[b].cz)); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.lineWidth = 1;

    const alarmed = new Set(this.alarms().map(a => a.island)), beat = 0.5 + 0.5 * Math.sin(performance.now() / 180);
    isles.forEach((isl, k) => {
      const base = this.baseOf(isl);
      const team: Team = base?.team ?? 'neutral';
      const knowsOwner = known[k];
      if (isl === hovered) {
        ctx.strokeStyle = '#e8eef3';
        ctx.beginPath(); ctx.arc(X(isl.cx), Y(isl.cz), isl.size * 0.42 * s + 4, 0, Math.PI * 2); ctx.stroke();
      }
      // under attack lately: a red ring that pulses
      if (alarmed.has(k)) {
        ctx.strokeStyle = `rgba(239, 90, 74, ${(0.55 + 0.45 * beat).toFixed(2)})`; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(X(isl.cx), Y(isl.cz), isl.size * 0.42 * s + 12, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1;
      }
      // the island picked for the console's section
      if (k === this.island) {
        ctx.strokeStyle = '#f2c46a'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.arc(X(isl.cx), Y(isl.cz), isl.size * 0.42 * s + 8, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]); ctx.lineWidth = 1;
      }
      ctx.drawImage(this.chartOf(isl, k), X(isl.cx - isl.size / 2), Y(isl.cz - isl.size / 2), isl.size * s, isl.size * s);
      const seen = (x: number, z: number) => team === 'spieler' || this.survey.seen(k, x, z);
      // landing places on a cliff coast, once the drone or the ship has seen them
      for (const L of this.landingsKnown(k)) landingGlyph(ctx, X(L.x), Y(L.z), L, Math.min(1.4, Math.max(0.55, s * 90)));
      // enemy gun ranges and buildings, as far as they have been seen
      for (const b of base?.buildings ?? []) {
        if (b.head && b.alive && team === 'feind' && seen(b.p.x, b.p.z)) {
          ctx.fillStyle = 'rgba(239, 90, 74, 0.06)';
          ctx.strokeStyle = 'rgba(239, 90, 74, 0.55)';
          ctx.beginPath(); ctx.arc(X(b.p.x), Y(b.p.z), 950 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
      for (const b of base?.buildings ?? []) {
        if (!seen(b.p.x, b.p.z)) continue;
        const x = X(b.p.x), y = Y(b.p.z);
        if (b.alive && b.p.type === 'landeplatz' && team === 'spieler' && s > 0.012) {
          ctx.strokeStyle = '#8fe9ff'; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x - 2.2, y - 2.6); ctx.lineTo(x - 2.2, y + 2.6); ctx.moveTo(x + 2.2, y - 2.6); ctx.lineTo(x + 2.2, y + 2.6);
          ctx.moveTo(x - 2.2, y); ctx.lineTo(x + 2.2, y); ctx.stroke(); ctx.lineWidth = 1;
        } else if (b.alive) { ctx.fillStyle = OWNER_COLORS[team]; ctx.fillRect(x - 2.5, y - 2.5, 5, 5); }
        else if (b.underConstruction) { ctx.strokeStyle = OWNER_COLORS[base!.pending?.team ?? team]; ctx.strokeRect(x - 2.5, y - 2.5, 5, 5); }
        else { ctx.strokeStyle = '#8a96a3'; ctx.beginPath(); ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 3, y + 3); ctx.moveTo(x + 3, y - 3); ctx.lineTo(x - 3, y + 3); ctx.stroke(); }
      }
      // overview: names only (64 islands get crowded), details once zoomed in
      const detail = s > 0.018 || isl === hovered;
      ctx.fillStyle = knowsOwner ? OWNER_COLORS[team] : '#8fa3b2';
      ctx.font = detail ? '600 13px -apple-system, sans-serif' : '600 11px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      const ly = Y(isl.cz + isl.size * 0.36) + (detail ? 0 : -2);
      ctx.fillText(isl.name.toUpperCase(), X(isl.cx), ly);
      if (!detail) return;
      ctx.font = '11px -apple-system, sans-serif';
      ctx.fillStyle = '#b8c4cf';
      const mapped = this.survey.progress(k);
      const build = base?.construction;
      if (build && knowsOwner) {
        const role = base!.pending?.role ?? isl.role;
        ctx.fillText(t('map.isl.building', { biome: isl.biomeName, pct: pct(build.total) }) + (role ? ` · ${ROLE_NAMES[role]}` : ''), X(isl.cx), ly + 14);
        return;
      }
      ctx.fillText(knowsOwner
        ? `${isl.biomeName} · ${OWNER_NAMES[team]}${team !== 'neutral' && isl.role ? ` · ${ROLE_NAMES[isl.role]}` : ''}`
        : mapped >= 0.005 ? t('map.isl.mapped', { pct: pct(mapped) }) : t('map.isl.unexplored'), X(isl.cx), ly + 14);
    });

    if (this.supply) { this.drawDepot(ctx, X, Y, s); this.drawNetwork(ctx, X, Y, s); }

    // units, their waypoints, the drone's radio range
    const { carrier, drone: drohne } = this.fleet;
    // radio range of the remote units (Otter, Skua, drone) around the ship: a cyan glow ring
    if (this.selected !== 'traeger' || drohne.flying) {
      ctx.save();
      ctx.shadowColor = 'rgba(80, 220, 255, 0.9)';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = 'rgba(80, 220, 255, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([10, 7]);
      ctx.beginPath(); ctx.arc(X(carrier.pos.x), Y(carrier.pos.z), DRONE_RANGE * s, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    // routes: a dashed line through the waypoints, a node at each, numbered for the selected unit
    for (const u of this.ids) {
      const wp = this.fs.waypointOf(u);
      if (!wp) continue;
      const p = this.fs.unitPos(u), pts = [wp, ...this.actions.route(u)], sel = u === this.selected, col = this.fs.color(u);
      ctx.save();
      ctx.globalAlpha = sel ? 1 : 0.65;
      ctx.strokeStyle = col;
      ctx.lineWidth = sel ? 2 : 1.2;
      ctx.setLineDash([7, 6]);
      ctx.beginPath(); ctx.moveTo(X(p.x), Y(p.z));
      for (const q of this.actions.path(u) ?? []) ctx.lineTo(X(q.x), Y(q.z));
      for (const q of pts) ctx.lineTo(X(q.x), Y(q.y));
      ctx.stroke();
      ctx.setLineDash([]);
      pts.forEach((q, i) => {
        const x = X(q.x), y = Y(q.y), last = i === pts.length - 1;
        ctx.fillStyle = '#0b1a26';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, last ? 6.5 : 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (last) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill(); }
        if (sel && pts.length > 1) {
          ctx.font = '700 11px -apple-system, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillStyle = col;
          ctx.fillText(String(i + 1), x + 7, y - 6);
        }
      });
      ctx.restore();
    }
    // the Skuas' strikes: a red line from each to its target, the target ringed (fainter on the way home)
    for (const st of this.strikes()) {
      ctx.save();
      ctx.globalAlpha = st.home ? 0.35 : 0.9;
      ctx.strokeStyle = '#ef5a4a'; ctx.lineWidth = 1.6; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(X(st.from.x), Y(st.from.z)); ctx.lineTo(X(st.to.x), Y(st.to.z)); ctx.stroke();
      ctx.setLineDash([]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X(st.to.x), Y(st.to.z), 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X(st.to.x) - 13, Y(st.to.z)); ctx.lineTo(X(st.to.x) + 13, Y(st.to.z));
      ctx.moveTo(X(st.to.x), Y(st.to.z) - 13); ctx.lineTo(X(st.to.x), Y(st.to.z) + 13); ctx.stroke();
      ctx.restore();
    }
    // defence drones: small dots in their ship's colour, under the silhouettes
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#111';
    for (const d of this.shields()) {
      ctx.fillStyle = d.foe ? OWNER_COLORS.feind : this.fs.color('traeger');
      ctx.beginPath(); ctx.arc(X(d.x), Y(d.z), 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    // observation drones: a diamond, the player's with the dashed ring its Hammerheads can be guided in
    for (const o of this.observers()) {
      const x = X(o.x), y = Y(o.z), col = o.foe ? OWNER_COLORS.feind : this.fs.color('traeger');
      if (o.reach > 0) {
        ctx.save();
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.55;
        ctx.beginPath(); ctx.arc(x, y, Math.abs(X(o.x + o.reach) - x), 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = col;
      ctx.strokeStyle = '#111';
      ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 4, y); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // units: silhouettes in their colour inside a glow ring; the selected one sends out pulses
    const pulse = (performance.now() / 1000) % 1;
    for (const u of this.ids) {
      const p = this.fs.unitPos(u);
      if (!p.visible) continue;
      this.unitGlyph(ctx, kindOf(u), X(p.x), Y(p.z), p.heading, this.fs.color(u), u === this.selected, pulse, u === 'drohne' ? t('drone.short') : this.fs.name(u));
    }
    for (const u of this.enemyUnits()) this.unitGlyph(ctx, u.kind, X(u.x), Y(u.z), u.heading, OWNER_COLORS.feind, false, pulse, u.name);
    const enemyAt = this.drawEnemy(ctx, X, Y, pulse);
    ctx.textAlign = 'left';
    this.frame(ctx, w, h);
    const R = this.columns().r;
    this.scaleBar(ctx, w - R - 250, h - 74 - this.bottom(), s);
    // the enemy ship or the island under the pointer: its information next to it
    const onEnemy = enemyAt && this.hover && Math.hypot(enemyAt.x - this.hover.x, enemyAt.y - this.hover.y) < 18;
    if ((onEnemy || hovered) && this.hover) {
      this.tipEl.innerHTML = onEnemy ? this.enemyInfo(enemyAt.e) : this.islandInfo(hovered!, teams).replace(/^<hr>/, '');
      this.tipEl.hidden = false;
      const { w: tw, h: th } = this.size(this.tipEl);
      const x = this.hover.x + 18 + tw > w - R - 8 ? this.hover.x - 18 - tw : this.hover.x + 18;
      this.tipEl.style.left = `${Math.max(this.columns().l + 4, x)}px`;
      this.tipEl.style.top = `${Math.min(h - th - 8 - this.bottom(), Math.max(TOP + 6, this.hover.y + 14))}px`;
    } else this.tipEl.hidden = true;
  }

  /** the enemy's carrier: in view a live glyph, otherwise a faded one where it was seen last; its screen position for the pointer */
  private drawEnemy(ctx: CanvasRenderingContext2D, X: (x: number) => number, Y: (z: number) => number, pulse: number): { x: number; y: number; e: EnemyView } | null {
    const e = this.enemy();
    if (!e) return null;
    const x = X(e.x), y = Y(e.z), col = OWNER_COLORS.feind;
    if (e.visible) {
      this.unitGlyph(ctx, 'traeger', x, y, e.heading, col, false, pulse, e.name);
      // a warning ring that keeps pulsing while it is in view
      ctx.save();
      ctx.strokeStyle = '#ef5a4a';
      ctx.globalAlpha = 0.7 * (1 - pulse);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 21 + pulse * 18, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    } else {
      ctx.save();
      ctx.globalAlpha = 0.45;
      this.unitGlyph(ctx, 'traeger', x, y, e.heading, col, false, 0, `${e.name}?`);
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.8;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(x, y, 24, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '600 11px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = col;
      ctx.fillText(t('enemy.seen', { ago: e.age }).toUpperCase(), x, y + 37);
      ctx.restore();
    }
    return { x, y, e };
  }

  private enemyInfo(e: EnemyView): string {
    const course = `${pad3(bearing(e.heading))}°`, kn = num(Math.abs(e.speed) * KN);
    return `<div class="big" style="color:${OWNER_COLORS.feind}">${e.name}</div><div>${t('enemy.what')}</div>` +
      (e.visible
        ? `<div>${t('enemy.inView', { dist: km(e.dist), ship: SHIP_NAME, kn, course })}</div><div>${t('stat.hull')} <b>${pct(e.hull)}</b></div>`
        : `<div>${t('enemy.lastLine', { ago: e.age, kn, course })}</div>`);
  }

  private hoveredIsland(): Island | null {
    if (!this.hover) return null;
    const p = this.toWorld(this.hover.x, this.hover.y);
    const { island, distance } = this.world.nearest(p.x, p.z);
    return distance < island.size * 0.42 ? island : null;
  }

  /** like the original ISLAND INFORMATION screen: owner, role, links, route to the base */
  private islandInfo(isl: Island, teams: Team[]): string {
    const i = this.world.islands.indexOf(isl), team = teams[i];
    const links = this.world.links.filter(([a, b]) => a === i || b === i).length;
    const linkText = t('map.info.links', { n: links });
    const mapped = pct(this.survey.progress(i));
    const size = isl.large ? t('map.info.large') : t('map.info.small');
    if (!this.knows(i)) {
      return `<hr><div class="big">${isl.name}</div>` +
        `<div>${t('map.info.unknown', { size, pct: mapped })}</div>` + this.landingInfo(i) +
        `<div>${t('map.info.flyOver')}</div><div>${linkText}</div>`;
    }
    let route = t('map.info.unoccupied');
    if (team !== 'neutral') {
      const home = team === 'spieler' ? 0 : 1;
      const h = this.world.hopsFrom(home, (a, b) => teams[a] === team && teams[b] === team)[i];
      route = i === home ? t('map.info.isBase') : h === Infinity ? t('map.info.cutOff') : t('map.info.hops', { n: h });
    }
    const b = this.baseOf(isl), alive = b ? b.buildings.filter(x => x.alive && (team === 'spieler' || this.survey.seen(i, x.p.x, x.p.z))).length : 0;
    return `<hr><div class="big">${isl.name}</div>` +
      `<div>${isl.biomeName} · ${size} · <span style="color:${OWNER_COLORS[team]}">${OWNER_NAMES[team]}</span>` +
      `${team !== 'neutral' && isl.role ? ` · ${ROLE_NAMES[isl.role]}` : ''}</div>` +
      `<div>${linkText} · ${route}</div>` + this.landingInfo(i) +
      `<div>${alive ? `${t('map.info.seen', { n: alive })} · ` : ''}${t('map.isl.mapped', { pct: mapped })}</div>` + this.depotInfo(i) + this.networkInfo(i);
  }

  /** the landing places of island k the player knows of: all on an own island, else those the drone has charted */
  landingsKnown(k: number): Landing[] {
    const isl = this.world.islands[k];
    if (!isl.landings.length) return [];
    const own = this.bases[k]?.team === 'spieler';
    return isl.landings.filter(L => own || this.survey.seen(k, L.x, L.z));
  }

  /** a cliff coast: how many landing places are known (one line, or nothing for an island without cliffs or not yet known) */
  private landingInfo(k: number): string {
    if (!this.world.islands[k].landings.length) return '';
    const n = this.landingsKnown(k).length;
    if (n) return `<div>${t('map.info.landings', { n })}</div>`;
    return this.knows(k) ? `<div>${t('map.info.noLanding')}</div>` : '';
  }

  /** the console's island section: what it is and whose, the stockpile, its orders and deliveries (the pointer's label has more) */
  private islandLines(i: number, teams: Team[]): string {
    const isl = this.world.islands[i], team = teams[i], b = this.bases[i], build = b?.construction;
    const size = isl.large ? t('map.info.large') : t('map.info.small'), mapped = pct(this.survey.progress(i));
    if (!this.knows(i)) return `<div>${t('map.info.unknown', { size, pct: mapped })}</div>${this.landingInfo(i)}<div>${t('map.info.flyOver')}</div>`;
    return `<div>${isl.biomeName} · ${size} · <span style="color:${OWNER_COLORS[team]}">${OWNER_NAMES[team]}</span>` +
      `${team !== 'neutral' && isl.role ? ` · ${ROLE_NAMES[isl.role]}` : ''}</div>` + this.landingInfo(i) +
      (b?.pending ? `<div>${t('isl.founding')}</div>` : build ? `<div>${t('isl.building', { pct: pct(build.total) })}</div>` : '') +
      this.depotInfo(i) + this.networkInfo(i) + (this.survey.progress(i) < 0.999 ? `<div>${t('map.isl.mapped', { pct: mapped })}</div>` : '');
  }

  /** the island's orders and what is on its way to it */
  private networkInfo(i: number): string {
    const e = this.supply?.economy;
    if (!e || !this.knows(i)) return '';
    const list = (items: string[]) => (items.length > 3 ? [...items.slice(0, 3), t('net.info.more', { n: items.length - 3 })] : items).join(' · ');
    const jobs = e.jobViews().filter(j => j.island === i).map(j => `${jobText(j, this.world)} – ${jobState(j)}`);
    const incoming = e.shipmentViews().filter(v => v.dest === i && (v.from !== null || v.at !== i))
      .sort((a, b) => a.eta - b.eta).map(v => `${cargoText(v)} (${arrival(v)})`);
    return (jobs.length ? `<div>${t('net.info.jobs', { list: list(jobs) })}</div>` : '') +
      (incoming.length ? `<div>${t('net.info.incoming', { list: list(incoming) })}</div>` : '');
  }

  /** factories at work (a gear by the island) and shipments moving along the links (small crates) */
  private drawNetwork(ctx: CanvasRenderingContext2D, X: (x: number) => number, Y: (z: number) => number, s: number) {
    const e = this.supply!.economy, isles = this.world.islands;
    const label = (text: string, x: number, y: number) => {
      ctx.font = '600 11px -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#0b1a26';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = '#f2e6c8';
      ctx.fillText(text, x, y);
    };
    ctx.save();
    const jobs = new Map<number, JobView[]>();
    for (const j of e.jobViews()) { const l = jobs.get(j.island); if (l) l.push(j); else jobs.set(j.island, [j]); }
    for (const [k, js] of jobs) {
      const isl = isles[k], x = X(isl.cx + isl.size * 0.36) + 6, y = Y(isl.cz - isl.size * 0.36) - 6;
      this.gear(ctx, x, y, js.every(j => j.waiting) ? '#8fa3b2' : PAL.ockerHell);
      if (s > 0.018) {
        const first = [...js].sort((a, b) => Number(!!a.waiting) - Number(!!b.waiting) || a.eta - b.eta)[0];
        label(`${jobText(first, this.world)} · ${jobState(first)}${js.length > 1 ? ` (+${js.length - 1})` : ''}`, x + 11, y + 4);
      } else if (js.length > 1) label(`${js.length}`, x + 9, y + 4);
    }
    this.shipIcons = [];
    for (const v of e.shipmentViews()) {
      if (v.from === null) continue;
      const a = isles[v.from], b = isles[v.at];
      const x = X(a.cx + (b.cx - a.cx) * v.progress), y = Y(a.cz + (b.cz - a.cz) * v.progress);
      this.crate(ctx, x, y, Math.atan2(Y(b.cz) - Y(a.cz), X(b.cx) - X(a.cx)), cargoColor(v));
      this.shipIcons.push({ x, y, v });
    }
    // what they carry: all of them when zoomed in far, otherwise the one under the pointer
    const hov = this.hover;
    const near = hov ? this.shipIcons.find(i => Math.hypot(i.x - hov.x, i.y - hov.y) < 10) : undefined;
    for (const i of s > 0.06 ? this.shipIcons : near ? [near] : []) {
      label(t('net.label', { cargo: cargoText(i.v), dest: isles[i.v.dest].name, time: arrival(i.v) }), i.x + 9, i.y - 7);
    }
    ctx.restore();
  }

  /** a small gear: an island's factory places are working */
  private gear(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
    ctx.fillStyle = color;
    ctx.strokeStyle = '#0b1a26';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, r = i % 2 ? 4.6 : 6.8;
      const a0 = a - Math.PI / 16, a1 = a + Math.PI / 16;
      ctx.lineTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
      ctx.lineTo(x + Math.cos(a1) * r, y + Math.sin(a1) * r);
    }
    ctx.closePath();
    ctx.stroke(); ctx.fill();
    ctx.fillStyle = '#0b1a26';
    ctx.beginPath(); ctx.arc(x, y, 1.9, 0, Math.PI * 2); ctx.fill();
  }

  /** a transport drone's crate along its link, in the colour of what it carries */
  private crate(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.strokeStyle = '#0b1a26';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(-5, -3.5, 10, 7, 1.5); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-1.5, -3.5); ctx.lineTo(-1.5, 3.5); ctx.stroke();
    ctx.restore();
  }

  private depotInfo(i: number): string {
    const e = this.supply?.economy;
    if (!e || e.stockpile !== i) return '';
    const g = e.stockpileGoods, n = (v: number) => Math.round(v);
    return `<div style="color:${DEPOT}">${t('map.info.depot', { ship: SHIP_NAME, fuelShip: n(g.treibstoffTraeger), fuelO: n(g.treibstoffWalrus), fuelS: n(g.treibstoffManta) })}</div>`;
  }

  /** the map as a table display: cyan light along the edges of the free area, amber brackets in its corners */
  private frame(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const { l, r, b } = this.insets(w), x0 = Math.max(6, l - 8), y0 = TOP + 4, x1 = r ? w - r + 8 : w - 6, y1 = h - 6 - b, G = 46;
    const glow = (x: number, y: number, ww: number, hh: number, gx0: number, gy0: number, gx1: number, gy1: number) => {
      const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
      g.addColorStop(0, 'rgba(80, 220, 255, 0.11)');
      g.addColorStop(1, 'rgba(80, 220, 255, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, ww, hh);
    };
    glow(x0, y0, x1 - x0, G, 0, y0, 0, y0 + G);
    glow(x0, y1 - G, x1 - x0, G, 0, y1, 0, y1 - G);
    glow(x1 - G, y0, G, y1 - y0, x1, 0, x1 - G, 0);
    glow(x0, y0, G, y1 - y0, x0, 0, x0 + G, 0);
    ctx.strokeStyle = 'rgba(80, 220, 255, 0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
    ctx.strokeStyle = '#c79b38';
    ctx.lineWidth = 2;
    const L = 28;
    for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x + dx * L, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * L); ctx.stroke();
    }
    // another unit than the ship gets the next click: the frame glows in its colour, a tag says whose click it is
    if (this.selected !== 'traeger') {
      const col = this.fs.color(this.selected), name = this.selected === 'drohne' ? t('drone.short') : this.fs.name(this.selected);
      ctx.save();
      ctx.strokeStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 16;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.6 + 0.3 * Math.sin(performance.now() / 260);
      ctx.beginPath(); ctx.roundRect(x0 + 3, y0 + 3, x1 - x0 - 6, y1 - y0 - 6, 6); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      const tag = t('map.targetTag', { unit: name }).toUpperCase();
      ctx.font = '700 12px -apple-system, sans-serif';
      const tw = ctx.measureText(tag).width + 22, tx = (x0 + x1) / 2 - tw / 2;
      ctx.fillStyle = 'rgba(8, 18, 26, 0.92)';
      ctx.beginPath(); ctx.roundRect(tx, y0 + 8, tw, 22, 4); ctx.fill();
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.textAlign = 'center';
      ctx.fillText(tag, tx + tw / 2, y0 + 23);
      ctx.restore();
    }
  }

  /** compass rose: north is up (−z), east right (+x) */
  private compass(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, wind: { x: number; z: number }) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(8, 24, 32, 0.75)';
    ctx.strokeStyle = 'rgba(80, 220, 255, 0.8)';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, l = i % 4 === 0 ? 9 : i % 2 === 0 ? 6 : 3;
      ctx.beginPath(); ctx.moveTo(Math.sin(a) * r, -Math.cos(a) * r); ctx.lineTo(Math.sin(a) * (r - l), -Math.cos(a) * (r - l)); ctx.stroke();
    }
    // the wind: a light arrow across the rose the way it blows, thicker the stronger it is
    const ms = Math.hypot(wind.x, wind.z);
    if (ms > 0.5) {
      const ux = wind.x / ms, uy = wind.z / ms, L = r - 8, head = 9;
      ctx.save();
      ctx.strokeStyle = ctx.fillStyle = 'rgba(143, 233, 255, 0.8)';
      ctx.shadowColor = 'rgba(80, 220, 255, 0.9)';
      ctx.shadowBlur = 6;
      ctx.lineWidth = 2 + 3 * Math.min(1, ms / 22);
      ctx.beginPath(); ctx.moveTo(-ux * L, -uy * L); ctx.lineTo(ux * (L - head), uy * (L - head)); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ux * L, uy * L);
      ctx.lineTo(ux * (L - head) - uy * 6, uy * (L - head) + ux * 6);
      ctx.lineTo(ux * (L - head) + uy * 6, uy * (L - head) - ux * 6);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.font = '700 11px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f2e6c8';
    ctx.fillText(POINTS[0], 0, -r - 5);
    ctx.fillText(POINTS[4], 0, r + 13);
    ctx.fillText(POINTS[2], r + 9, 4);
    ctx.fillText(POINTS[6], -r - 10, 4);
    ctx.restore();
  }

  private scaleBar(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    const options = [100, 250, 500, 1000, 2000, 5000];
    const len = options.find(m => m * s > 70) ?? 5000;
    ctx.strokeStyle = '#f2e6c8';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len * s, y); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5); ctx.moveTo(x + len * s, y - 5); ctx.lineTo(x + len * s, y + 5); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = '#f2e6c8';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(len >= 1000 ? km(len, 0) : `${len} m`, x, y - 9);
  }

  /** arrow pointing along the heading (north = up) */
  /** a unit seen from above (nose down in its own frame, turned to its heading) in a glow ring */
  private unitGlyph(ctx: CanvasRenderingContext2D, k: Vehicle, x: number, y: number, heading: number, color: string, selected: boolean, pulse: number, label: string) {
    // the small units are drawn a quarter larger than their outlines so they read next to the ship
    const scale = k === 'traeger' ? 1 : 1.25, size = k === 'traeger' ? 16 : k === 'manta' ? 11 : 9;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = selected ? 12 : 6;
    ctx.strokeStyle = color;
    ctx.globalAlpha = selected ? 0.95 : 0.5;
    ctx.lineWidth = selected ? 2 : 1.2;
    ctx.beginPath(); ctx.arc(x, y, size + 5, 0, Math.PI * 2); ctx.stroke();
    if (selected) {
      ctx.globalAlpha = 0.6 * (1 - pulse);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, size + 5 + pulse * 14, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-heading);
    ctx.scale(scale, scale);
    ctx.fillStyle = color;
    ctx.strokeStyle = '#0b1a26';
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    const shade = 'rgba(11, 26, 38, 0.5)';
    const poly = (pts: number[]) => { ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.closePath(); };
    if (k === 'traeger') {
      // hull with the tapering bow, the bridge tower aft, the runway's centre line
      poly([-5, -16, 5, -16, 5, 6, 2.6, 13, 0, 16, -2.6, 13, -5, 6]);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = shade;
      ctx.fillRect(-2.2, -12, 4.4, 6);
      ctx.strokeStyle = shade;
      ctx.lineWidth = 1;
      ctx.setLineDash([2.5, 2.5]);
      ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(0, 12); ctx.stroke();
    } else if (k === 'walrus') {
      // body between two tracks, turret with the barrel forward
      ctx.beginPath(); ctx.roundRect(-3.4, -7, 6.8, 14, 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = shade;
      ctx.fillRect(-4.8, -7, 1.6, 14);
      ctx.fillRect(3.2, -7, 1.6, 14);
      ctx.beginPath(); ctx.arc(0, -0.5, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#0b1a26';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 6.5); ctx.stroke();
    } else if (k === 'manta') {
      // delta wing with the tail
      poly([0, 9, 2, 3, 8, -4, 8, -6, 2, -4.5, 1.6, -8, -1.6, -8, -2, -4.5, -8, -6, -8, -4, -2, 3]);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = shade;
      ctx.beginPath(); ctx.ellipse(0, 3.2, 0.9, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      // quadplane: wing bar, four rotors
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-4.5, -4.5); ctx.lineTo(4.5, 4.5); ctx.moveTo(-4.5, 4.5); ctx.lineTo(4.5, -4.5); ctx.stroke();
      ctx.strokeStyle = '#0b1a26';
      ctx.lineWidth = 1.2;
      ctx.fillRect(-6.5, -0.9, 13, 1.8);
      for (const [rx, ry] of [[-4.5, -4.5], [4.5, -4.5], [-4.5, 4.5], [4.5, 4.5]]) {
        ctx.fillStyle = shade;
        ctx.beginPath(); ctx.arc(rx, ry, 2.3, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = color;
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.strokeStyle = '#0b1a26';
      ctx.beginPath(); ctx.ellipse(0, 0, 1.7, 4.4, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();

    ctx.font = '600 11px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#0b1a26';
    ctx.strokeText(label, x + size + 9, y + 4);
    ctx.fillStyle = '#f2e6c8';
    ctx.fillText(label, x + size + 9, y + 4);
  }

  private icon(ctx: CanvasRenderingContext2D, x: number, y: number, heading: number, size: number, label?: string, color: string = PAL.ockerHell, ring = false) {
    const dx = Math.sin(heading), dy = Math.cos(heading);
    if (ring) {
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.arc(x, y, size + 6, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.strokeStyle = '#111';
    ctx.beginPath();
    ctx.moveTo(x + dx * size, y + dy * size);
    ctx.lineTo(x - dx * size * 0.6 + dy * size * 0.55, y - dy * size * 0.6 - dx * size * 0.55);
    ctx.lineTo(x - dx * size * 0.6 - dy * size * 0.55, y - dy * size * 0.6 + dx * size * 0.55);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    if (label) {
      ctx.fillStyle = '#f2e6c8';
      ctx.font = '11px -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(label, x + size + 3, y + 4);
    }
  }

  private drawRadar(focus: { x: number; z: number; heading: number }) {
    const cv = this.radar, dpr = Math.min(devicePixelRatio, 2), k = uiScale();
    if (!cv.isConnected) return;
    // (square, as big as the screen is high)
    const shown = cv.getBoundingClientRect().height || 120 * k, w = shown / k;
    if (cv.width !== Math.round(shown * dpr)) { cv.width = cv.height = Math.round(shown * dpr); }
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
    const r = w / 2, s = r / RADAR_RANGE;
    ctx.clearRect(0, 0, w, w);
    ctx.save();
    ctx.beginPath(); ctx.arc(r, r, r - 1, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgba(8, 24, 32, 0.78)';
    ctx.fillRect(0, 0, w, w);
    const X = (x: number) => r + (x - focus.x) * s, Y = (z: number) => r + (z - focus.z) * s;
    for (const isl of this.world.islands) {
      const sz = isl.size * s;
      if (Math.abs(isl.cx - focus.x) > RADAR_RANGE + isl.size || Math.abs(isl.cz - focus.z) > RADAR_RANGE + isl.size) continue;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(this.image(isl), X(isl.cx - isl.size / 2), Y(isl.cz - isl.size / 2), sz, sz);
      ctx.globalAlpha = 1;
      const base = this.baseOf(isl);
      for (const b of base?.buildings ?? []) {
        if (!b.alive) continue;
        ctx.fillStyle = OWNER_COLORS[base!.team];
        ctx.fillRect(X(b.p.x) - 1.5, Y(b.p.z) - 1.5, 3, 3);
      }
    }
    // range rings and sweep
    ctx.strokeStyle = 'rgba(63, 174, 138, 0.35)';
    for (let k = 1; k <= 4; k++) { ctx.beginPath(); ctx.arc(r, r, k * 1000 * s, 0, Math.PI * 2); ctx.stroke(); }
    const g = ctx.createConicGradient(this.sweep - Math.PI / 2, r, r);
    g.addColorStop(0, 'rgba(63, 174, 138, 0.0)');
    g.addColorStop(0.9, 'rgba(63, 174, 138, 0.0)');
    g.addColorStop(1, 'rgba(63, 174, 138, 0.28)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
    for (const u of this.ids) {
      const p = this.fs.unitPos(u);
      if (p.visible) this.icon(ctx, X(p.x), Y(p.z), p.heading, u === 'traeger' ? 6 : 4, undefined, this.fs.color(u));
    }
    const e = this.enemy();
    if (e?.visible) this.icon(ctx, X(e.x), Y(e.z), e.heading, 6, undefined, OWNER_COLORS.feind, true);
    for (const u of this.enemyUnits()) this.icon(ctx, X(u.x), Y(u.z), u.heading, 4, undefined, OWNER_COLORS.feind);
    ctx.restore();
    ctx.strokeStyle = 'rgba(63, 174, 138, 0.8)';
    ctx.beginPath(); ctx.arc(r, r, r - 1, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#8fd8bf';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.fillText('N', r - 3, 11);
    ctx.fillText('4 km', 6, w - 6);
  }
}
