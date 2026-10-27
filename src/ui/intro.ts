import type { Input } from '../game/input';
import { t } from '../i18n';
import { GAME_TITLE } from '../game/names';

const LOGO = new URL('../assets/skerry-logo.webp', import.meta.url).href;
/** seconds a line takes from the bottom edge to the top (time to read it for someone who does not know the text) */
const CROSS = 26;
/** how much of the logo stands in the picture at the start (the rest still below the bottom edge) */
const LOGO_IN = 0.5;
/** no skipping in the first moment (a key still held, a second click from before) */
const GRACE = 800;

/**
 * The intro at every start: the story rolls up the screen over the title
 * (its storm, music and sound go on behind it), then the menu fades in. A
 * click, a key or a pad button skips it; the menu can show it again.
 */
export class Intro {
  active = false;
  private el: HTMLDivElement | null = null;
  private began = 0;
  private done: () => void = () => {};
  // (in the capture phase, so nothing else gets the key or click: not the hidden menu, not the game)
  private onInput = (e: Event) => {
    if (!this.active) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.skip();
  };

  /** roll the story; `done` follows the end or a skip, still inside the click or key that skipped it */
  start(done: () => void) {
    if (this.active) return;
    this.active = true;
    this.began = performance.now();
    this.done = done;
    const el = document.createElement('div');
    el.id = 'intro';
    el.innerHTML = `<div class="view"><div class="crawl">
        <img src="${LOGO}" alt="${GAME_TITLE}" width="1774" height="728">
        <p class="homage">${t('intro.homage')}</p>
        <p>${t('intro.p1')}</p><p>${t('intro.p2')}</p><p>${t('intro.p3')}</p><p>${t('intro.p4')}</p><p>${t('intro.p5')}</p>
        <p class="last">${t('intro.end')}</p>
      </div></div>
      <div class="skip">${t('intro.skip')}</div>`;
    document.body.append(el);
    this.el = el;
    document.body.classList.add('intro');
    const view = el.querySelector<HTMLElement>('.view')!, crawl = el.querySelector<HTMLElement>('.crawl')!;
    // from the logo half in the picture at the bottom edge until the last line has left the top, one screen height per CROSS seconds
    const logo = crawl.querySelector('img')!;
    const h = view.clientHeight, H = crawl.offsetHeight, from = h - logo.offsetHeight * LOGO_IN;
    crawl.style.setProperty('--from', `${from}px`);
    crawl.style.setProperty('--to', `${-H}px`);
    crawl.style.animationDuration = `${((from + H) / h * CROSS).toFixed(1)}s`;
    crawl.addEventListener('animationend', () => this.finish());
    crawl.classList.add('run');
    addEventListener('pointerdown', this.onInput, true);
    addEventListener('keydown', this.onInput, true);
  }

  /** a pad button skips it too (the pad is read in the game's frame) */
  pad(input: Input) {
    if (input.hit('Pad.A', 'Pad.B', 'Pad.X', 'Pad.Y', 'Pad.Start')) this.skip();
  }

  skip() {
    if (this.active && performance.now() - this.began > GRACE) this.finish();
  }

  private finish() {
    if (!this.active) return;
    this.active = false;
    removeEventListener('pointerdown', this.onInput, true);
    removeEventListener('keydown', this.onInput, true);
    document.body.classList.remove('intro');
    const el = this.el;
    el?.classList.add('gone');
    setTimeout(() => el?.remove(), 900);
    this.el = null;
    this.done();
  }
}
