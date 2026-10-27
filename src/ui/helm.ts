import { THROTTLE, type CarrierController } from '../game/carrierController';
import { SHIP_NAME } from '../game/names';
import { bearing } from './hud';
import { FleetStatus, ICON, KN, pad3, picto } from './fleetStatus';
import { t, km, num } from '../i18n';
import { uiScale } from './scale';

/** what the helm asks the game to do and to tell */
export interface HelmActions {
  gear(i: number): void;
  clearWaypoint(): void;
  /** a course into the stockpile island's delivery area */
  depot(): void;
  /** the next click on the map sets the ship's waypoint (the map opens if it is closed) */
  plot(): void;
  /** the ship is the unit the next click on the map steers */
  plotting(): boolean;
  progress(): { step: number; total: number } | null;
  /** into the laser turret's camera to fire it by hand, or back to where the player was */
  turret(): void;
  /** the player fires the turret by hand; it is overheated */
  turretState(): { hand: boolean; over: boolean };
}

/** the rudder as a row of nine cells, the diamond where it stands (left = port) */
export function rudderBar(r: number): string {
  const pos = Math.round(4 - r * 4); // 9 cells, left = port
  return Array.from({ length: 9 }, (_, i) => (i === pos ? '◆' : i === 4 ? '┼' : '─')).join('');
}

/**
 * The Stoorworm's helm: a bar across the bottom of the screen, in the same
 * place over the 3D view and the map and whichever unit the player drives,
 * with the speed steps, course, speed and rudder, a button to fire the laser
 * turret by hand, the autopilot's waypoint and a course to the stockpile island. (The tank is in the supply section,
 * the hull in the Stoorworm's block; the bar's edge turns red when either
 * runs low.)
 */
export class HelmBar {
  readonly el: HTMLDivElement;
  private gears: HTMLButtonElement[];
  private f: Record<'lamp' | 'name' | 'course' | 'rudder' | 'speed' | 'wp', HTMLElement>;
  private btn: Record<'plot' | 'clear' | 'turret', HTMLButtonElement>;
  private timer = 0;
  /** the screen height it takes up, with its margin (UI pixels) */
  height = 48;

  constructor(private ship: CarrierController, private fs: FleetStatus, private actions: HelmActions) {
    this.el = document.createElement('div');
    this.el.id = 'helm';
    this.el.className = 'skin';
    this.el.innerHTML = `<div class="hbar">
      <div class="hname">${picto('traeger')}<b>${SHIP_NAME}</b><i class="lamp"></i></div>
      <div class="hgears" title="${t('helm.gearTitle')}"><span class="hl">${t('helm.gear')}</span>${THROTTLE.map((s, i) =>
        `<button data-g="${i}" title="${s.name}">${i === THROTTLE.length - 1 ? t('helm.flank') : s.short}</button>`).join('')}</div>
      <div class="hnav"><span class="hl">${t('helm.course')}</span><b class="hcourse"></b><span class="hrudder" title="${t('hud.rudder')}"></span><b class="hspeed"></b></div>
      <div class="hgun"><span class="hl">${t('helm.gun')}</span>
        <button data-h="turret" title="${t('helm.turretTitle')}">${ICON.centre}<span class="bt">${t('helm.turret')}</span></button></div>
      <div class="hauto" title="${t('helm.autopilot')}"><span class="hl">${t('stat.toWp')}</span><span class="hwp"></span>
        <button data-h="plot" title="${t('helm.plotTitle')}">${ICON.pin}<span class="bt">${t('helm.plot')}</span></button>
        <button data-h="clear" title="${t('map.clearWp')}">${ICON.clear}</button>
        <button data-h="depot" title="${t('map.goTitle')}">${ICON.fuel}<span class="bt">${t('helm.depot')}</span></button></div>
    </div>`;
    document.body.append(this.el);
    const q = (c: string) => this.el.querySelector<HTMLElement>(c)!;
    this.f = {
      lamp: q('.hname .lamp'), name: q('.hname'), course: q('.hcourse'), rudder: q('.hrudder'), speed: q('.hspeed'), wp: q('.hwp'),
    };
    this.btn = { plot: q('[data-h="plot"]') as HTMLButtonElement, clear: q('[data-h="clear"]') as HTMLButtonElement, turret: q('[data-h="turret"]') as HTMLButtonElement };
    this.gears = [...this.el.querySelectorAll<HTMLButtonElement>('[data-g]')];
    this.gears.forEach((b, i) => b.addEventListener('click', () => { this.actions.gear(i); b.blur(); this.refresh(); }));
    this.el.querySelectorAll<HTMLButtonElement>('[data-h]').forEach(b => b.addEventListener('click', () => {
      const h = b.dataset.h;
      if (h === 'plot') this.actions.plot();
      else if (h === 'turret') this.actions.turret();
      else if (h === 'clear') this.actions.clearWaypoint();
      else this.actions.depot();
      b.blur();
      this.refresh();
    }));
    // the console and the map keep clear of it
    new ResizeObserver(() => {
      const shown = this.el.getBoundingClientRect().height;
      if (!shown) return;    // hidden (menu)
      this.height = shown / uiScale() + 8;
      document.documentElement.style.setProperty('--helm', `${this.height}px`);
    }).observe(this.el);
  }

  /** ten times a second is plenty for the figures */
  update(dt: number) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    this.refresh();
  }

  private refresh() {
    const c = this.ship, f = this.f, lamp = this.fs.lamp('traeger', performance.now() / 1000, false);
    if (f.lamp.className !== `lamp ${lamp.cls}`) f.lamp.className = `lamp ${lamp.cls}`;
    // its state (and why the lamp shows what it shows) on hover
    f.name.title = `${this.fs.stateText('traeger')}${lamp.why ? ` · ${lamp.why}` : ''}`;
    this.gears.forEach((b, i) => b.classList.toggle('on', c.throttle === i));
    f.course.textContent = `${pad3(bearing(c.heading))}°`;
    f.rudder.textContent = rudderBar(c.rudder);
    f.speed.innerHTML = `${num(Math.abs(c.speed) * KN)} kn${c.speed < -0.05 ? ` <small>${t('hud.astern')}</small>` : ''}`;
    const wp = c.waypoint, prog = this.actions.progress();
    f.wp.innerHTML = wp
      ? `<b>${km(Math.hypot(wp.x - c.pos.x, wp.y - c.pos.z))}</b>${prog && prog.total > 1 ? ` · <b>${prog.step}/${prog.total}</b>` : ''}`
      : `<span class="off">${t('helm.noWp')}</span>`;
    this.btn.clear.disabled = !wp;
    this.btn.plot.classList.toggle('on', this.actions.plotting());
    const gun = this.actions.turretState();
    this.btn.turret.classList.toggle('on', gun.hand);
    this.btn.turret.classList.toggle('hot', gun.over);
    this.el.classList.toggle('low', c.fuel < 0.15 || c.hp / c.maxHp < 0.25);
  }
}
