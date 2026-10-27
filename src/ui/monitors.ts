import { UNIT_COLORS, picto } from './fleetStatus';
import type { Vehicle } from './hud';
import { t } from '../i18n';

/** the three screens: the ship, the Otters, the Skuas (and the drone) */
export type MonitorGroup = 'ship' | 'otter' | 'skua';
export const MONITOR_GROUPS: MonitorGroup[] = ['ship', 'otter', 'skua'];

/** what a monitor shows this frame */
export interface MonitorState {
  /** its picture is on; otherwise `text` says why not (aboard, lost) */
  live: boolean;
  text: string;
  /** radio static over the picture 0..1 */
  noise: number;
  /** what it shows, in its header (the camera's name) */
  label: string;
  /** the kind whose pictogram and colour the header carries */
  kind: Vehicle;
  /** the radar instead of a picture (in the 3D view, the screen of the unit the big picture shows) */
  radar?: boolean;
}

/** a button in the switch row under a monitor */
export interface MonitorButton { id: string; text: string; on?: boolean; lamp?: string; title?: string }

interface Tile { g: MonitorGroup; el: HTMLElement; frame: HTMLElement; pic: HTMLCanvasElement; text: HTMLElement; noise: HTMLElement; head: HTMLElement; row: HTMLElement; headKey: string; rowKey: string }

/**
 * The console's monitors: one screen at the top of each unit block (see
 * deck.ts), the same in the 3D view and on the map. A row under each switches
 * what it shows (the ship's cameras, Otter 1–4, Skua 1–4 or the drone), its
 * last button (⛶) goes into that picture full screen. A
 * unit that is out shows its camera (the game renders it and copies it onto
 * the screen's own canvas, on top of the console's tinted panels), one aboard
 * or lost has a dark screen saying so. In the 3D view the screen of the unit the big picture shows has
 * the radar instead. A click on the picture is the game's (see main.ts), a
 * double click goes into the picture full screen.
 */
export class MonitorWall {
  private tiles: Tile[] = [];
  /** the radar canvas, moved into the screen that shows it */
  radar: HTMLCanvasElement | null = null;

  constructor(slots: Record<MonitorGroup, HTMLElement>,
    actions: { pick(g: MonitorGroup): void; full(g: MonitorGroup): void; button(g: MonitorGroup, id: string): void; title(g: MonitorGroup): string }, staticUrl: string) {
    for (const g of MONITOR_GROUPS) {
      const el = document.createElement('div');
      el.className = 'montile';
      el.innerHTML = `<div class="mframe" title="${actions.title(g)}"><canvas class="mpic"></canvas><div class="mnoise"></div><div class="mtext"></div><div class="mlabel"></div></div><div class="mrow"></div>`;
      const frame = el.querySelector<HTMLElement>('.mframe')!, noise = el.querySelector<HTMLElement>('.mnoise')!, row = el.querySelector<HTMLElement>('.mrow')!;
      noise.style.backgroundImage = `url(${staticUrl})`;
      frame.addEventListener('click', () => actions.pick(g));
      frame.addEventListener('dblclick', () => actions.full(g));
      row.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-b]');
        if (!b) return;
        if (b.dataset.b === 'full') actions.full(g); else actions.button(g, b.dataset.b!);
        b.blur();
      });
      slots[g].append(el);
      this.tiles.push({ g, el, frame, pic: el.querySelector('canvas')!, text: el.querySelector('.mtext')!, noise, head: el.querySelector('.mlabel')!, row, headKey: '', rowKey: '' });
    }
  }

  /** the canvas a screen's picture goes on */
  picture(g: MonitorGroup): HTMLCanvasElement { return this.tiles.find(x => x.g === g)!.pic; }

  /** states, switch rows and the highlighted screen; returns the live screens' rectangles (CSS pixels) */
  update(state: (g: MonitorGroup) => MonitorState, buttons: (g: MonitorGroup) => MonitorButton[], selected: MonitorGroup | null, lamp: (g: MonitorGroup) => string):
    { g: MonitorGroup; x: number; y: number; w: number; h: number }[] {
    const live: { g: MonitorGroup; x: number; y: number; w: number; h: number }[] = [];
    let radarAt: HTMLElement | null = null;
    for (const tile of this.tiles) {
      const s = state(tile.g), radar = !!s.radar && !!this.radar;
      tile.el.classList.toggle('live', s.live && !radar);
      tile.el.classList.toggle('radar', radar);
      tile.el.classList.toggle('sel', tile.g === selected);
      tile.el.style.setProperty('--uc', UNIT_COLORS[s.kind]);
      const label = radar ? t('map.radarTitle') : s.label;
      const head = `${radar ? '' : picto(s.kind)}<b>${label}</b><i class="lamp ${lamp(tile.g)}"></i>`;
      if (tile.headKey !== head) { tile.head.innerHTML = head; tile.headKey = head; }
      const text = s.live || radar ? '' : s.text;
      if (tile.text.textContent !== text) tile.text.textContent = text;
      tile.noise.style.opacity = radar ? '0' : s.noise.toFixed(2);
      if (s.noise > 0 && !radar) tile.noise.style.backgroundPosition = `${Math.random() * 96}px ${Math.random() * 96}px`;
      const bs = buttons(tile.g), rowKey = JSON.stringify(bs);
      if (tile.rowKey !== rowKey) {
        tile.rowKey = rowKey;
        tile.row.innerHTML = bs.map(b => `<button data-b="${b.id}" class="${b.on ? 'on' : ''}"${b.title ? ` title="${b.title}"` : ''}>${b.text}${b.lamp ? `<i class="lamp ${b.lamp}"></i>` : ''}</button>`).join('') +
          `<button data-b="full" class="mfull" title="${t('mon.fullTitle')}">⛶</button>`;
      }
      if (radar) radarAt = tile.frame;
      else if (s.live) {
        const r = tile.frame.getBoundingClientRect();
        if (r.width && r.height) live.push({ g: tile.g, x: r.left, y: r.top, w: r.width, h: r.height });
      }
    }
    // the radar goes where it is wanted (behind the screen's label), or out of the page
    if (this.radar) {
      if (radarAt && this.radar.parentElement !== radarAt) radarAt.prepend(this.radar);
      else if (!radarAt && this.radar.isConnected) this.radar.remove();
    }
    return live;
  }
}
