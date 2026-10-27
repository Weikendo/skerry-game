import { ICON } from './fleetStatus';
import { t, num } from '../i18n';
import { uiScale } from './scale';

/** what the camera bar asks the game to do and to tell */
export interface CamBarActions {
  /** trackpad and mouse take the camera and the aim (the pointer is captured), or let them go */
  togglePointer(): void;
  pointerLocked(): boolean;
  /** the current unit's previous or next camera, and the name of the one shown */
  camera(step: number): void;
  cameraName(): string;
  zoom(factor: number): void;
  zoomLevel(): { now: number; max: number };
  /** the camera head straight ahead again */
  ahead(): void;
}

/** a trackpad (with its two buttons) for the pointer button */
const TRACKPAD = '<svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M3.5 15h17M12 15v5"/><circle cx="12" cy="9.5" r="1.4"/></svg>';
/** how much one press of + or − zooms */
const ZOOM_STEP = 1.4;

/**
 * Camera controls at the bottom of the 3D view, over the Stoorworm's bar (testers found the click into the picture
 * that captures the pointer confusing): a switch for the trackpad and mouse that lights up while they steer the
 * camera and the aim (Esc lets them go), the current unit's cameras, zoom and a button to look straight ahead again.
 * Hidden over the map, in the menu and with H.
 */
export class CamBar {
  readonly el: HTMLDivElement;
  private ptr: HTMLButtonElement;
  private name: HTMLElement;
  private zoomTxt: HTMLElement;
  private zoomBtn: Record<'in' | 'out', HTMLButtonElement>;
  private timer = 0;

  constructor(private actions: CamBarActions) {
    this.el = document.createElement('div');
    this.el.id = 'cambar';
    this.el.innerHTML = `
      <button data-c="ptr" class="ptr" title="${t('cambar.ptrTitle')}">${TRACKPAD}<span class="bt">${t('cambar.ptr')}</span></button>
      <span class="sep"></span>
      <span class="cl">${t('cambar.cam')}</span>
      <button data-c="prev" title="${t('cambar.prev')}">◀</button><b class="cname"></b><button data-c="next" title="${t('cambar.next')}">▶</button>
      <span class="sep"></span>
      <button data-c="out" title="${t('cambar.zoomOut')}">−</button><b class="czoom"></b><button data-c="in" title="${t('cambar.zoomIn')}">+</button>
      <span class="sep"></span>
      <button data-c="ahead" title="${t('cambar.aheadTitle')}">${ICON.centre}<span class="bt">${t('cambar.ahead')}</span></button>`;
    document.body.append(this.el);
    const q = <T extends HTMLElement>(s: string) => this.el.querySelector<T>(s)!;
    this.ptr = q('[data-c="ptr"]');
    this.name = q('.cname');
    this.zoomTxt = q('.czoom');
    this.zoomBtn = { in: q('[data-c="in"]'), out: q('[data-c="out"]') };
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-c]');
      if (!b) return;
      const c = b.dataset.c, a = this.actions;
      if (c === 'ptr') a.togglePointer();
      else if (c === 'prev' || c === 'next') a.camera(c === 'prev' ? -1 : 1);
      else if (c === 'in' || c === 'out') a.zoom(c === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP);
      else a.ahead();
      b.blur();
      this.refresh();
    });
    // the help line sits on top of it
    new ResizeObserver(() => {
      const h = this.el.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--cambar', `${h ? h / uiScale() + 6 : 0}px`);
    }).observe(this.el);
  }

  /** a few times a second is plenty */
  update(dt: number) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.15;
    this.refresh();
  }

  private refresh() {
    const a = this.actions, on = a.pointerLocked(), z = a.zoomLevel();
    this.ptr.classList.toggle('on', on);
    this.ptr.querySelector('.bt')!.textContent = on ? t('cambar.ptrOn') : t('cambar.ptr');
    this.name.textContent = a.cameraName();
    this.zoomTxt.textContent = `${num(z.now, 1)}×`;
    this.zoomBtn.in.disabled = z.now >= z.max - 0.01;
    this.zoomBtn.out.disabled = z.now <= 1.01;
  }
}
