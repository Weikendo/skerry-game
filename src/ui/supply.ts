import type { Archipelago } from '../world/archipelago';
import type { IslandBase } from '../world/base';
import { ROLE_NAMES } from '../world/worldgen';
import type { CarrierController } from '../game/carrierController';
import { PRIORITY_NAMES, type Economy, type Priority } from '../game/economy';
import { TRANSFER_RANGE, type TransferDrone } from '../game/transfer';
import { FUEL_TARGET, GOOD_LIST, GOODS, PLAYER_GOODS, type Good } from '../game/stores';
import { SHIP_NAME } from '../game/names';
import { arrival, cargoColor, cargoText, clock, jobState, jobText } from './network';
import type { IslandAlarm } from './map';
import { t, km, num, pct } from '../i18n';
import { uiScale } from './scale';

const STATE_NAMES = {
  bereit: t('transfer.state.bereit'), hin: t('transfer.state.hin'), angedockt: t('transfer.state.angedockt'), zurueck: t('transfer.state.zurueck'),
};
const fmt = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? num(Math.round(v)) : num(v, 1));
type PlayerGood = (typeof PLAYER_GOODS)[number];
/** the goods by who uses them (every one of PLAYER_GOODS, once) */
const GROUPS: { title: string; goods: PlayerGood[] }[] = [
  { title: t('supply.grp.fuel'), goods: ['treibstoffTraeger', 'treibstoffWalrus', 'treibstoffManta'] },
  { title: t('supply.grp.otter'), goods: ['accb', 'virus', 'tank'] },
  { title: t('supply.grp.skua'), goods: ['assassin', 'quaker'] },
  { title: t('supply.grp.drone'), goods: ['funk'] },
  { title: t('supply.grp.ship', { ship: SHIP_NAME }), goods: ['taeuschkoerper', 'abwehrdrohne', 'hammerhead', 'beobachtungsdrohne'] },
  { title: t('supply.grp.spare'), goods: ['walrus', 'manta', 'drohne'] },
];
const COLUMNS = ['colGood', 'colPrio', 'colTarget', 'colShip', 'colDepot', 'colTransit', 'colBuilding'] as const;

/** make island k the stockpile island and say so (or why not): from the supply screen and the island menu on the map */
export function moveDepot(economy: Economy, world: Archipelago, k: number, notify: (msg: string, cls?: string) => void) {
  const moving = GOOD_LIST.some(g => economy.stockpileGoods[g] > 0);
  const why = economy.setStockpile(k);
  if (why) notify(why, 'bad');
  else notify(t(moving ? 'supply.newDepotMoving' : 'supply.newDepot', { island: world.islands[k].name }));
}

/**
 * Stores and supply (G), after the Operations Guide: network status, stockpile
 * island, transfer drone, and per good (grouped by who uses it) the supply
 * priority and the quantity the network keeps in stock. Pointing at a good, a
 * column or a control shows what it is for. A second page lists what is made
 * and shipped, a third the player's islands (the console's islands section
 * opens it).
 */
export class SupplyScreen {
  open = false;
  private el: HTMLDivElement;
  private rows = new Map<Good, { prio: HTMLButtonElement; target: HTMLSpanElement; cells: HTMLTableCellElement[] }>();
  private status: HTMLDivElement;
  private select: HTMLSelectElement;
  private auto: HTMLInputElement;
  private choices = '';
  private refreshIn = 0;

  /** the player's islands under attack lately, and an island picked in the list (set by the game) */
  alarms: () => { island: number; what: IslandAlarm; ago: number }[] = () => [];
  pickIsland: (k: number) => void = () => {};

  constructor(private world: Archipelago, private bases: IslandBase[], private economy: Economy, private transfer: TransferDrone, private carrier: CarrierController,
    private notify: (msg: string, cls?: string) => void) {
    this.el = document.createElement('div');
    this.el.id = 'supply';
    this.el.innerHTML = `<div class="panel">
      <div class="title">${t('supply.title')} <button class="close" data-act="close">×</button></div>
      <div class="tabs"><button data-act="tab" data-tab="stores" data-tip="${t('supply.tip.tabStores')}">${t('supply.tabStores')}</button><button data-act="tab" data-tab="network" data-tip="${t('supply.tip.tabNetwork')}">${t('supply.tabNetwork')}</button>` +
        `<button data-act="tab" data-tab="islands" data-tip="${t('supply.tip.tabIslands')}">${t('supply.tabIslands')}</button></div>
      <div class="tab-network" hidden></div>
      <div class="tab-islands" hidden></div>
      <div class="tab-stores">
      <div class="status"></div>
      <div class="line"><span data-tip="${t('supply.depotHint')}">${t('supply.depot')} <select></select></span>
        <button data-act="launch" data-tip="${t('supply.tip.launch', { range: km(TRANSFER_RANGE) })}">${t('supply.launch')}</button>
        <label data-tip="${t('supply.tip.auto')}"><input type="checkbox" checked> ${t('supply.auto')}</label></div>
      <table><thead><tr>${COLUMNS.map(k => `<th data-tip="${t(`supply.tip.${k}`, { ship: SHIP_NAME })}">${t(`supply.${k}`)}</th>`).join('')}</tr></thead><tbody></tbody></table>
      <div class="hint">${t('supply.hint')}</div>
      </div>
      <div class="stip" hidden></div>
    </div>`;
    document.body.append(this.el);
    this.status = this.el.querySelector('.status')!;
    this.select = this.el.querySelector('select')!;
    this.auto = this.el.querySelector('input[type=checkbox]')!;
    const tbody = this.el.querySelector('tbody')!;
    for (const grp of GROUPS) {
      const head = document.createElement('tr');
      head.className = 'grp';
      head.innerHTML = `<td colspan="${COLUMNS.length}">${grp.title}</td>`;
      tbody.append(head);
      for (const g of grp.goods) this.addRow(tbody, g);
    }
    // what a good, a column or a control is for, next to the pointer
    const tip = this.el.querySelector<HTMLDivElement>('.stip')!;
    this.el.addEventListener('mousemove', (e) => {
      const src = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (!src) { tip.hidden = true; return; }
      if (tip.innerHTML !== src.dataset.tip) tip.innerHTML = src.dataset.tip!;
      tip.hidden = false;
      // (the screen is zoomed with the interface: its fixed positions are in UI pixels)
      const k = uiScale(), r = tip.getBoundingClientRect();
      const x = e.clientX + 16 + r.width > innerWidth - 8 ? e.clientX - 16 - r.width : e.clientX + 16;
      const y = Math.min(innerHeight - r.height - 8, e.clientY + 18);
      tip.style.left = `${Math.max(8, x) / k}px`;
      tip.style.top = `${Math.max(8, y) / k}px`;
    });
    this.el.addEventListener('mouseleave', () => { tip.hidden = true; });
    this.el.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!el) return;
      const g = el.dataset.good as Good | undefined, o = g ? this.economy.orders[g] : null;
      if (el.dataset.act === 'close') this.toggle();
      else if (el.dataset.act === 'tab') this.tab = el.dataset.tab as SupplyScreen['tab'];
      else if (el.dataset.act === 'island') { this.toggle(); this.pickIsland(Number(el.dataset.k)); return; }
      else if (el.dataset.act === 'launch') { const why = this.transfer.launch(); if (why) this.notify(why, 'bad'); }
      else if (o && el.dataset.act === 'prio') o.priority = ((o.priority + 1) % 3) as Priority;
      else if (o && el.dataset.act === 'minus') o.target = Math.max(0, o.target - GOODS[g!].pieces * ((e as MouseEvent).shiftKey ? 5 : 1));
      else if (o && el.dataset.act === 'plus') o.target = Math.min(999, o.target + GOODS[g!].pieces * ((e as MouseEvent).shiftKey ? 5 : 1));
      (el as HTMLButtonElement).blur?.();
      this.refresh();
    });
    this.select.addEventListener('change', () => {
      moveDepot(this.economy, this.world, Number(this.select.value), this.notify);
      this.choices = '';
      this.select.blur();
      this.refresh();
    });
    this.auto.addEventListener('change', () => { this.transfer.auto = this.auto.checked; this.auto.blur(); });
  }

  /** a good's row: name (pointing at the row says what it is for), priority, target, then the counts */
  private addRow(tbody: HTMLElement, g: PlayerGood) {
    const tr = document.createElement('tr');
    tr.dataset.tip = `<b>${GOODS[g].name}</b><br>${t(`supply.tip.${g}`, { ship: SHIP_NAME, range: km(TRANSFER_RANGE) })}`;
    tr.innerHTML = `<td>${GOODS[g].name}<small>${GOODS[g].unit}</small></td>` +
      `<td><button class="prio" data-act="prio" data-good="${g}"></button></td>` +
      (GOODS[g].fuel ? `<td class="qty"><span>${t('supply.twoTanks')}</span></td>`
        : `<td class="qty"><button data-act="minus" data-good="${g}">−</button><span></span><button data-act="plus" data-good="${g}">+</button></td>`) +
      '<td></td><td></td><td></td><td></td>';
    tbody.append(tr);
    const cells = [...tr.querySelectorAll('td')].slice(3) as HTMLTableCellElement[];
    this.rows.set(g, { prio: tr.querySelector('.prio')!, target: tr.querySelector('.qty span')!, cells });
  }

  /** every order on a factory place and every shipment, with the time left */
  private networkPage(): string {
    const e = this.economy, isl = this.world.islands;
    const name = (k: number | null) => (k === null ? '–' : isl[k].name);
    const head = (keys: ('colIsland' | 'colOrder' | 'colProgress' | 'colState' | 'colCargo' | 'colRoute' | 'colWhere' | 'colArrives')[]) =>
      `<tr>${keys.map(k => `<th>${t(`supply.${k}`)}</th>`).join('')}</tr>`;
    const jobs = e.jobViews().sort((a, b) => a.island - b.island || a.eta - b.eta);
    let html = `<div class="nethead">${t('supply.jobsHead', { busy: jobs.length, total: e.stats.factories })}</div>`;
    html += jobs.length ? `<table><thead>${head(['colIsland', 'colOrder', 'colProgress', 'colState'])}</thead><tbody>` + jobs.map(j =>
      `<tr><td>${name(j.island)}</td><td>${jobText(j, this.world)}</td>` +
      `<td><span class="pbar"><i style="width:${Math.round(j.progress * 100)}%"></i></span> ${pct(j.progress)}</td>` +
      `<td${j.waiting ? ' class="warn"' : ''}>${jobState(j)}</td></tr>`).join('') + '</tbody></table>'
      : `<div class="hint">${t('supply.noJobs')}</div>`;
    const ships = e.shipmentViews().sort((a, b) => (isNaN(a.eta) ? 1e9 : a.eta) - (isNaN(b.eta) ? 1e9 : b.eta));
    html += `<div class="nethead">${t('supply.shipHead', { n: ships.length })}</div>`;
    html += ships.length ? `<table><thead>${head(['colCargo', 'colRoute', 'colWhere', 'colArrives'])}</thead><tbody>` + ships.map(v =>
      `<tr><td><span class="crate" style="background:${cargoColor(v)}"></span>${cargoText(v)}</td><td>${name(v.origin)} → ${name(v.dest)}</td>` +
      `<td>${v.from !== null ? t('net.between', { a: name(v.from), b: name(v.at) }) : t('net.at', { island: name(v.at) })}</td>` +
      `<td>${arrival(v)}</td></tr>`).join('') + '</tbody></table>'
      : `<div class="hint">${t('supply.noShipments')}</div>`;
    return html + `<div class="hint">${t('supply.networkHint')}</div>`;
  }

  toggle() {
    this.open = !this.open;
    this.el.style.display = this.open ? 'flex' : 'none';
    document.body.classList.toggle('modal-open', this.open);
    if (this.open) this.refresh();
  }

  update(dt: number) {
    if (!this.open) return;
    this.refreshIn -= dt;
    if (this.refreshIn <= 0) this.refresh();
  }

  /** which page shows: the goods table, the factories at work and the shipments under way, or the player's islands */
  tab: 'stores' | 'network' | 'islands' = 'stores';

  /** open on the list of the player's islands */
  showIslands() {
    this.tab = 'islands';
    if (!this.open) this.toggle(); else this.refresh();
  }

  /** the player's islands: role, buildings, raw material, orders, link and what happened lately; a click shows one on the map */
  private islandsPage(): string {
    const e = this.economy, isl = this.world.islands, alarms = this.alarms(), jobs = e.jobViews();
    const own = isl.map((_, k) => k).filter(k => this.bases[k]?.team === 'spieler' || this.bases[k]?.pending?.team === 'spieler')
      .sort((a, b) => (a === e.base ? -1 : b === e.base ? 1 : isl[a].name.localeCompare(isl[b].name)));
    const rows = own.map(k => {
      const b = this.bases[k], role = b.pending?.role ?? isl[k].role, build = b.construction, alarm = alarms.find(a => a.island === k);
      const standing = b.buildings.filter(x => x.alive).length;
      const orders = jobs.filter(j => j.island === k).map(j => `${jobText(j, this.world)} <small>${jobState(j)}</small>`).join('<br>') || '–';
      const link = !e.linked[k] ? `<span class="warn">${t('supply.isl.cut')}</span>` : k === e.stockpile ? t('supply.isl.depot') : t('supply.isl.linked');
      return `<tr class="pick" data-act="island" data-k="${k}"><td><b>${isl[k].name}</b></td>` +
        `<td>${role ? ROLE_NAMES[role] : '–'}${build ? `<small>${t('isl.building', { pct: pct(build.total) })}</small>` : ''}</td>` +
        `<td>${standing} / ${b.buildings.length}</td><td>${fmt(e.raw[k])}</td><td>${orders}</td><td>${link}</td>` +
        `<td>${alarm ? `<span class="warn">⚠ ${t(`isl.alarm.${alarm.what}`)}</span><small>${t('isl.ago', { time: clock(alarm.ago) })}</small>` : t('supply.isl.quiet')}</td></tr>`;
    }).join('');
    const cols = ['colIsland', 'colRole', 'colBuildings', 'colRaw', 'colOrders', 'colLink', 'colAlarm'] as const;
    return `<div class="nethead">${t('supply.isl.head', { n: own.length })}</div>` +
      `<table><thead><tr>${cols.map(c => `<th data-tip="${t(`supply.tip.isl.${c}`)}">${t(`supply.isl.${c}`)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>` +
      `<div class="hint">${t('supply.isl.hint')}</div>`;
  }

  private refresh() {
    this.refreshIn = 0.3;
    this.el.querySelectorAll<HTMLButtonElement>('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === this.tab));
    (this.el.querySelector('.tab-stores') as HTMLElement).hidden = this.tab !== 'stores';
    const net = this.el.querySelector('.tab-network') as HTMLElement, isles = this.el.querySelector('.tab-islands') as HTMLElement;
    net.hidden = this.tab !== 'network';
    isles.hidden = this.tab !== 'islands';
    if (this.tab === 'network') { net.innerHTML = this.networkPage(); return; }
    if (this.tab === 'islands') { const html = this.islandsPage(); if (isles.innerHTML !== html) isles.innerHTML = html; return; }
    const e = this.economy, st = e.stats, isl = this.world.islands;
    const linked = e.linked.filter(Boolean).length;
    const drone = this.transfer;
    const range = drone.inRange ? t('supply.inRange', { dist: km(drone.distance) }) : t('supply.outOfRange', { dist: km(drone.distance), max: km(TRANSFER_RANGE) });
    this.status.innerHTML = e.frozen
      ? `<div class="warn">${t('supply.frozen')}</div>`
      : `<div>${t('supply.network', { n: linked, base: isl[e.base].name, raw: st.roles.rohstoff, factory: st.roles.fabrik, defence: st.roles.verteidigung })}` +
        (st.cut ? ` · <span class="warn">${t('supply.cut', { n: st.cut })}</span>` : '') + '</div>' +
        `<div>${t('supply.raw', { raw: Math.round(st.rawTotal), rate: fmt(st.rawRate * 60), busy: st.busy, total: st.factories })}` +
        (st.material ? ` · ${t('supply.material', { n: st.material })}` : '') + '</div>' +
        `<div>${t('supply.drone', { state: STATE_NAMES[drone.state], range })}</div>` +
        `<div>${t('supply.tank', { ship: SHIP_NAME, pct: pct(this.carrier.fuel) })}</div>`;
    const choices = e.stockpileChoices.join(',') + '|' + e.stockpile;
    if (choices !== this.choices) {
      this.choices = choices;
      this.select.innerHTML = e.stockpileChoices.map(k => `<option value="${k}"${k === e.stockpile ? ' selected' : ''}>${isl[k].name}</option>`).join('');
    }
    for (const g of PLAYER_GOODS) {
      const r = this.rows.get(g)!, o = e.orders[g];
      r.prio.textContent = PRIORITY_NAMES[o.priority];
      r.prio.className = `prio p${o.priority}`;
      if (r.target) r.target.textContent = GOODS[g].fuel ? t('supply.fuelTarget', { n: FUEL_TARGET }) : String(o.target);
      const transit = e.inTransit(g), prod = e.inProduction(g);
      const vals = [fmt(this.carrier.stores[g]) + ` / ${GOODS[g].cap}`, fmt(e.stockpileGoods[g]), transit ? fmt(transit) : '–',
        prod.orders ? `${prod.orders} (${pct(prod.progress)})` : '–'];
      vals.forEach((v, i) => { r.cells[i].textContent = v; });
    }
  }
}
