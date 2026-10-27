import type { Economy } from '../game/economy';
import type { CarrierController } from '../game/carrierController';
import type { Walrus } from '../game/walrus';
import type { Manta } from '../game/manta';
import type { Drone } from '../game/drone';
import { AVATAR_SHOTS, skuaCargoOf } from '../game/arsenal';
import { SHIP_NAME } from '../game/names';
import { bearing, kindOf, slopeClass, type UnitId } from './hud';
import { FleetStatus, ICON, KMH, KN, meterColour, pad3, picto, TopBar, UNIT_COLORS, type StatusInfo } from './fleetStatus';
import type { MapCommand } from './map';
import { MONITOR_GROUPS, type MonitorGroup } from './monitors';
import { t, km, num, pct } from '../i18n';
import { PATCH } from '../game/hullRepair';

/** what the console asks the game to do and to tell */
export interface DeckActions {
  /** the unit the player drives */
  active(): UnitId;
  /** the unit a block is about: the ship, the Otter, Skua or drone on its screen */
  blockUnit(g: MonitorGroup): UnitId;
  /** the unit the next click on the map steers (null in the 3D view) */
  target(): UnitId | null;
  /** the unit the status bar is about: in the 3D view the one the player drives, on the map the one the next click steers */
  topUnit(): UnitId;
  mapOpen(): boolean;
  /** the next click on the map sets this unit's waypoint (the 3D view opens the map for it) */
  aim(u: UnitId): void;
  /** the map shows the unit in the middle */
  centre(u: UnitId): void;
  /** straight into the unit's cockpit (or driver's / bridge camera) */
  cockpit(u: UnitId): void;
  commands(u: UnitId): MapCommand[];
  command(u: UnitId, id: string): void;
  clearWaypoint(u: UnitId): void;
  order(u: UnitId): string;
  progress(u: UnitId): { step: number; total: number } | null;
  /** the camera in view */
  camera(): string;
  /** the nearest island, how far and what is known of it (HTML) */
  island(x: number, z: number): string;
  /** the unit's extra line: the Otter's cargo, what the drone is charting */
  extra(u: UnitId): string;
  /** time warp or a stopped clock, '' when the clock runs normally */
  flag(): string;
  /** the Stoorworm's laser turret: what it does now ('' at rest), its heat */
  turret(): { line: string; heat: number; over: boolean };
  /** the Stoorworm's defence drones: how many are out, their pattern and the hold ('' with none out) */
  shields(): string;
  /** its observation drone: how high, and the Hammerheads aboard ('' with none up) */
  observer(): string;
  status(): StatusInfo;
}

/** a meter: label, fill 0..1, the figure beside it */
interface Gauge { label: string; v: number; text: string; col: string; title?: string }

interface Block {
  g: MonitorGroup; el: HTMLElement; shown: UnitId; cmdKey: string;
  head: HTMLElement; state: HTMLElement; order: HTMLElement; readout: HTMLElement; detail: HTMLElement; gauges: HTMLElement; cmds: HTMLElement; centre: HTMLElement;
}

const CYAN = '#8fe9ff';
/** each block carries its units' colour */
const BLOCK_COLOR: Record<MonitorGroup, string> = { ship: UNIT_COLORS.traeger, otter: UNIT_COLORS.walrus, skua: UNIT_COLORS.manta };

const warn = (text: string) => `<span class="warn">${text}</span>`;
/** sets HTML only when it changed (the figures refresh ten times a second) */
const set = (el: HTMLElement, html: string) => { if (el.innerHTML !== html) el.innerHTML = html; };
/** seconds a changed freight line stays lit */
const FREIGHT_FLASH = 1.4;

/**
 * The console: the same two columns over the 3D view and over the map, only
 * the picture in the middle changes. Each unit group has a block of its own,
 * headed by its monitor (see monitors.ts), with its readout, meters and orders
 * underneath. Left: the Stoorworm, supplies (fuel, transfer drone, stores)
 * and the islands (network, attacks, production, the island picked on the
 * map; both from the map). Right: the Otters, the Skuas with the drone, time
 * and weather (from the map). The status bar runs along the top (the map has
 * its own), the Stoorworm's helm along the bottom. The other screens are
 * keys: M map, G stores, C camera, I island cameras, Esc menu.
 */
export class Deck {
  private el: HTMLDivElement;
  private top: TopBar;
  private blocks: Block[] = [];
  /** the two columns (the map keeps clear of them) */
  readonly left: HTMLElement;
  readonly right: HTMLElement;
  /** where each block's monitor goes */
  readonly slots = {} as Record<MonitorGroup, HTMLElement>;
  private timer = 0;
  economy?: Economy;
  /** each unit's freight as last shown, and since when (a change lights the line up for a moment) */
  private freightSeen = new Map<UnitId, { key: string; at: number }>();

  constructor(private fs: FleetStatus, private actions: DeckActions) {
    this.el = document.createElement('div');
    this.el.id = 'deck';
    this.el.className = 'skin';
    this.top = new TopBar('<i class="tsep"></i><span class="tcam"></span><span class="tflag"></span>');
    const block = (g: MonitorGroup) => `<section class="sec ublock" data-g="${g}" style="--uc:${BLOCK_COLOR[g]}">
        <header><span class="uhead"></span><span class="grow"></span>` +
          `<button class="hbtn" data-h="centre" title="${t('map.centre')}">${ICON.centre}</button><button class="hbtn" data-h="cockpit" title="${t('map.cockpit')}">${ICON.cockpit}</button></header>
        <div class="mslot"></div>
        <div class="cline"><span class="cstate"></span><span class="corder"></span></div>
        <div class="cbody"><div class="readout"></div><div class="cdetail"></div><div class="gauges"></div></div>
        <div class="ucmds"></div>
      </section>`;
    this.el.innerHTML = `<div class="ccol cleft">${block('ship')}</div><div class="ccol cright">${block('otter')}${block('skua')}</div>`;
    this.el.prepend(this.top.el);
    document.body.append(this.el);
    this.left = this.el.querySelector('.cleft')!;
    this.right = this.el.querySelector('.cright')!;

    for (const g of MONITOR_GROUPS) {
      const el = this.el.querySelector<HTMLElement>(`.ublock[data-g="${g}"]`)!, q = (c: string) => el.querySelector<HTMLElement>(c)!;
      const b: Block = {
        g, el, shown: '', cmdKey: '', head: q('.uhead'), state: q('.cstate'), order: q('.corder'), readout: q('.readout'),
        detail: q('.cdetail'), gauges: q('.gauges'), cmds: q('.ucmds'), centre: q('[data-h="centre"]'),
      };
      this.blocks.push(b);
      this.slots[g] = q('.mslot');
      b.cmds.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-cmd]');
        if (!btn) return;
        const u = this.actions.blockUnit(g), id = btn.dataset.cmd!;
        if (id === 'clear') this.actions.clearWaypoint(u);
        else if (id === 'aim') this.actions.aim(u);
        else this.actions.command(u, id);
        btn.blur();
        b.cmdKey = '';
        this.refresh();
      });
      el.querySelectorAll<HTMLButtonElement>('header [data-h]').forEach(btn => btn.addEventListener('click', () => {
        const u = this.actions.blockUnit(g);
        if (btn.dataset.h === 'centre') this.actions.centre(u); else this.actions.cockpit(u);
        btn.blur();
      }));
    }
  }

  /** the map's sections: supplies and the islands under the Stoorworm, the weather under the Skuas */
  mount(supply: HTMLElement, islands: HTMLElement, weather: HTMLElement) {
    this.left.append(supply, islands);
    this.right.append(weather);
  }

  /** ten times a second is plenty for the figures */
  update(dt: number) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    this.refresh();
  }

  private refresh() {
    const now = performance.now() / 1000, map = this.actions.mapOpen();
    const T = this.top, flag = this.actions.flag();
    T.field('tcam').innerHTML = `${t('deck.camera')} <b>${this.actions.camera()}</b>`;
    T.field('tflag').innerHTML = flag ? `<i class="tsep"></i><b class="tv">${flag}</b>` : '';
    T.update(this.fs, this.actions.topUnit(), this.economy, this.actions.status());
    for (const b of this.blocks) this.updateBlock(b, now, map);
  }

  private updateBlock(B: Block, now: number, map: boolean) {
    const u = this.actions.blockUnit(B.g), k = kindOf(u), p = this.fs.unitPos(u), wp = this.fs.waypointOf(u);
    const target = this.actions.target();
    B.el.classList.toggle('sel', target === u && u !== 'traeger');
    B.centre.style.display = map ? '' : 'none';
    // the header: the unit's name, a ◆ while the player drives it
    const name = `${picto(k)}<b>${B.g === 'ship' ? SHIP_NAME : k === 'drohne' ? t('drone.short') : this.fs.name(u)}</b>`;
    set(B.head, name + (u === this.actions.active() ? `<i class="drive" title="${t('deck.driving')}">◆</i>` : ''));
    if (u !== B.shown) { B.shown = u; B.cmdKey = ''; }
    const lamp = this.fs.lamp(u, now, false);
    set(B.state, `<i class="lamp ${lamp.cls}"></i>${this.fs.stateText(u)}`);
    const prog = this.actions.progress(u), order = this.actions.order(u);
    set(B.order, (order !== t('order.s.none') ? `${t('stat.order')} <b>${order}</b>` : '') +
      (prog && prog.total > 1 ? ` · ${t('stat.waypoint')} <b>${prog.step}/${prog.total}</b>` : '') +
      (wp ? ` · ${t('stat.toWp')} <b>${km(Math.hypot(wp.x - p.x, wp.y - p.z))}</b>` : ''));
    B.order.title = B.order.textContent ?? '';
    const { lines, gauges, speed } = this.describe(u);
    // course and speed; the ship's with the island nearby (its position is in the status bar; a long island line reads in full on hover)
    const isl = B.g === 'ship' ? this.actions.island(p.x, p.z) : '';
    set(B.readout, `<div><span>${t('deck.ro.course')}</span><b>${pad3(bearing(p.heading))}°</b><span>${t('deck.ro.speed')}</span><b>${speed}</b></div>` +
      (isl ? `<div><span>${t('deck.ro.island')}</span><b title="${isl.replace(/<[^>]+>/g, '')}">${isl}</b></div>` : ''));
    // a line cut short at the edge reads in full on hover
    set(B.detail, lines.slice(0, 3).map(l => `<div title="${l.replace(/<[^>]+>/g, '')}">${l}</div>`).join(''));
    set(B.gauges, gauges.map(g => `<div class="g" title="${g.title ?? g.label}"><span>${g.label}</span><b style="color:${g.col}">${g.text}</b>` +
      `<i><u style="width:${(Math.max(0, Math.min(1, g.v)) * 100).toFixed(0)}%;background:${g.col}"></u></i></div>`).join(''));
    const cmds: MapCommand[] = [...this.actions.commands(u)];
    // (the ship's waypoint is set and cleared on the helm bar)
    if (k !== 'traeger') {
      cmds.push({ id: 'aim', label: t('cmd.aim'), on: target === u, title: t('cmd.aimTitle') });
      if (wp) cmds.push({ id: 'clear', label: '✕', title: t('map.clearWp') });
    }
    const key = cmds.map(c => `${c.id}:${c.label}:${c.on ? 1 : 0}`).join('|');
    if (key !== B.cmdKey) {
      B.cmdKey = key;
      // (a label cut short reads in full on hover)
      const btn = (c: MapCommand) => `<button data-cmd="${c.id}"${c.on ? ' class="on"' : ''} title="${c.title ?? c.label}">${c.label}</button>`;
      B.cmds.innerHTML = cmds.map(btn).join('');
    }
  }

  /** the unit's lines (warnings first), its meters and its speed */
  private describe(u: UnitId): { lines: string[]; gauges: Gauge[]; speed: string } {
    const { k, c, w, m, d } = this.fs.unit(u);
    if (k === 'traeger') return this.carrier(c);
    if (k === 'walrus') return this.otter(u, w, this.actions.extra(u));
    if (k === 'manta') return this.skua(u, m);
    return this.drone(u, d, this.actions.extra(u));
  }

  private gauge(label: string, v: number, col = meterColour(v), text = num(Math.max(0, v) * 100), title?: string): Gauge {
    return { label, v, text, col, title };
  }
  private armour(v: { hp: number; maxHp: number }, hull = false): Gauge {
    return this.gauge(t(hull ? 'deck.g.hull' : 'deck.g.armour'), v.hp / v.maxHp, undefined, undefined, `${t(hull ? 'stat.hull' : 'stat.armour')} ${pct(v.hp / v.maxHp)}`);
  }
  private radio(sig: number): Gauge {
    return this.gauge(t('deck.g.radio'), sig, sig > 0.6 ? CYAN : sig > 0.25 ? '#f2c21b' : '#ef5a4a', undefined, `${t('stat.radio')} ${pct(sig)}`);
  }
  private heat(h: number, over: boolean): Gauge {
    return this.gauge(t('deck.g.heat'), h, over ? '#ef5a4a' : h > 0.7 ? '#f2c21b' : CYAN, undefined, over ? t('hud.overheated') : t('hud.heat', { pct: pct(h) }));
  }

  /** (the speed step, the rudder and the speed are on the helm bar, the wind in the weather, the tank in the supply section) */
  private carrier(c: CarrierController) {
    const lines: string[] = [];
    if (c.grounded) lines.push(warn(t('hud.aground')));
    else if (c.dragged) lines.push(t('deck.shieldCap', { kn: num(c.speedLimit * KN) }));
    else if (c.limited) lines.push(warn(t('hud.coast', { kn: num(c.speedLimit * KN) })));
    if (c.fuel <= 0) lines.push(warn(t('hud.fuelEmpty'))); else if (c.fuel < 0.2) lines.push(warn(t('hud.fuelLow')));
    // the hull's repair: at a yard, patched at sea, or where the rest can be mended
    const r = c.repair;
    if (r.kind === 'werft') lines.push(t('deck.repair.yard', { island: r.island }));
    else if (r.kind === 'rohstoff') lines.push(warn(t('deck.repair.noRaw', { island: r.island })));
    else if (r.kind === 'notreparatur') lines.push(t('deck.repair.patch', { pct: pct(PATCH.upTo) }));
    else if (c.alive && c.hp < c.maxHp - 0.5) lines.push(t('deck.repair.hint'));
    const tu = this.actions.turret();
    if (tu.line) lines.push(tu.over ? warn(tu.line) : tu.line);
    const sh = this.actions.shields(), ob = this.actions.observer();
    if (sh) lines.push(sh);
    if (ob) lines.push(ob);
    const st = c.stores;
    lines.push(t('deck.hold', { accb: st.accb, missiles: st.assassin, decoys: st.taeuschkoerper }), t('deck.spare', { otter: st.walrus, skua: st.manta, drone: st.drohne }));
    return { lines, speed: `${num(Math.abs(c.speed) * KN)} kn`, gauges: [this.armour(c, true), this.heat(tu.heat, tu.over)] };
  }

  /** (its state is on the block's first line; on land the slope is added) */
  /** the freight part of a line, lit up for a moment after it changed (each press on "Fracht" steps it on) */
  private freight(u: UnitId, key: string, html: string): string {
    const now = performance.now() / 1000, seen = this.freightSeen.get(u);
    if (!seen || seen.key !== key) this.freightSeen.set(u, { key, at: seen ? now : -99 });
    const age = now - this.freightSeen.get(u)!.at;
    return age < FREIGHT_FLASH ? `<span class="flash" style="animation-delay:-${age.toFixed(2)}s">${html}</span>` : html;
  }

  private otter(u: UnitId, w: Walrus, cargo: string) {
    const lines: string[] = [], out = w.state === 'fahren', l = w.load;
    if (w.message) lines.push(warn(w.message));
    if (w.state === 'dock' && w.hp < w.maxHp) lines.push(t('hud.repairing'));
    else if (out && w.medium === 'land') {
      const cls = slopeClass(w.slopeDeg);
      lines.push(`${t('hud.onLand')} · ${t('hud.slope', { deg: num(w.slopeDeg) })} <span style="color:${cls.color}">■ ${cls.name}</span>`);
    }
    // (the ammunition and the heat are meters)
    if (l.weapon === 'avatar' && w.laser.overheated) lines.push(warn(t('hud.overheated')));
    else if (l.weapon === 'harbinger' && w.guided) lines.push(`<b style="color:#f2c46a">${t('hud.harbingerFlying', { m: Math.round(w.guided.travelled) })}</b>`);
    else if (!l.weapon) lines.push(t('hud.unarmed'));
    lines.push(this.freight(u, `${l.cargo}:${l.role}`, cargo));
    const gauges = [this.gauge(t('deck.g.fuel'), w.fuel, undefined, undefined, `${t('stat.fuel')} ${pct(w.fuel)}`), this.armour(w)];
    if (l.weapon === 'avatar') gauges.push(this.gauge(t('deck.g.ammo'), l.ammo / AVATAR_SHOTS, CYAN, String(l.ammo)), this.heat(w.laser.heat, w.laser.overheated));
    else if (l.weapon === 'harbinger') gauges.push(this.gauge(t('deck.g.ammo'), l.ammo / Math.max(1, w.fit.ammo), CYAN, String(l.ammo)));
    if (out) gauges.push(this.radio(w.signal));
    const speed = !out ? '–' : w.medium === 'land' ? `${num(Math.abs(w.speed) * KMH)} km/h` : `${num(Math.abs(w.speed) * KN, 1)} kn`;
    return { lines, gauges, speed };
  }

  /** (its state and height are on the block's first line, its attitude in the cockpit) */
  private skua(u: UnitId, m: Manta) {
    const flying = m.state === 'flug' || m.state === 'landung' || m.state === 'padland' || m.state === 'padstart';
    const lines: string[] = [];
    if (m.message) lines.push(warn(m.message));
    if (m.state === 'deck' && m.hp < m.maxHp) lines.push(t('hud.repairing'));
    if (!m.armed) lines.push(t('hud.noQuasar'));
    const c = skuaCargoOf(m.fit);
    const freight = t('hud.freight', { what: c === 'quaker' ? t('hud.quakerKey') : c === 'raketen' ? t('load.missiles4') : t('load.none') });
    lines.push(`${t('hud.missiles')} ${m.maxMissiles ? '▲'.repeat(m.missiles) + '△'.repeat(m.maxMissiles - m.missiles) : '–'} · ${this.freight(u, String(c), freight)}` +
      (m.lock ? ` · <b style="color:#ef6a4a">${t('hud.target', { target: m.lock.name })}</b>` : ''));
    const gauges = [this.gauge(t('deck.g.fuel'), m.fuel, undefined, undefined, `${t('stat.fuel')} ${pct(m.fuel)}`), this.armour(m)];
    if (flying) gauges.push(this.gauge(t('deck.g.thrust'), m.throttle, CYAN, undefined, `${t('hud.thrust')} ${pct(m.throttle)}`));
    if (m.armed) gauges.push(this.heat(m.laser.heat, m.laser.overheated));
    if (flying || m.state === 'pad') gauges.push(this.radio(m.signal));
    return { lines, gauges, speed: flying || m.state === 'start' ? `${num(m.speed * KMH)} km/h` : '–' };
  }

  /** (its state is on the block's first line) */
  private drone(u: UnitId, d: Drone, mapping: string) {
    const lines: string[] = [];
    if (d.message) lines.push(warn(d.message));
    lines.push(this.freight(u, String(d.pod), t('hud.freight', { what: d.pod ? t('hud.funkRelay') : t('load.none') })));
    if (d.flying) lines.push(`${t('hud.altitude', { alt: num(d.altitude) })} · ${t('hud.radioDist', { dist: km(d.range) })} · ${t('hud.camera', { deg: num(-d.gimbalTilt * 180 / Math.PI) })}`);
    if (mapping) lines.push(mapping);
    const gauges = [this.gauge(t('deck.g.battery'), d.battery, d.battery > 0.5 ? '#5fd6ab' : d.battery > 0.25 ? '#f2c21b' : '#ef5a4a', undefined, `${t('stat.battery')} ${pct(d.battery)}`), this.armour(d)];
    if (d.flying) gauges.push(this.radio(d.signal));
    return { lines, gauges, speed: d.flying ? `${num(Math.hypot(d.vel.x, d.vel.z) * KMH)} km/h` : '–' };
  }
}
