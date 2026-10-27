import type { Input } from '../game/input';
import {
  deleteSave, exportSave, formatDate, formatPlayTime, importSave, listSaves, readSave, SLOT_NAMES,
  type SaveGame, type SaveMeta, type SlotId,
} from '../game/savegame';
import { SHIP_NAME, ENEMY_SHIP_NAME, GAME_TITLE } from '../game/names';
import { t, locale, lang, type Lang } from '../i18n';
import type { GlyphName } from './glyphs';
import { DIFFICULTIES, type Difficulty } from '../game/difficulty';
import { tutorialDone } from './tutorial';

/** what the menu asks the game to do */
export interface MenuActions {
  /** a game is running (the menu is the pause menu) */
  inGame(): boolean;
  resume(): void;
  /** `tutorial`: with the guided first steps */
  newGame(seed: number, count: number, difficulty: Difficulty, tutorial: boolean): void;
  load(save: SaveGame): void;
  /** returns '' or why it failed */
  save(slot: SlotId, name: string): string;
  settings(show: boolean): void;
  world(): { seed: number; count: number };
  defaultName(): string;
  /** the connected pad's button pictures, for the controls page */
  glyphs(): Record<GlyphName, string>;
  /** leave the running game for the title (it is saved first) */
  toTitle(): void;
  /** close the app (a running game is saved first); null in the browser, where a page cannot close itself */
  quit: (() => void) | null;
  /** roll the intro again (from the title) */
  intro(): void;
  /** play in the other language: it is remembered and the page starts afresh (a running game goes on in it) */
  language(l: Lang): void;
}

type Page = 'main' | 'new' | 'load' | 'save' | 'help' | 'guide' | 'credits' | 'end';

/** how a game ended, for the end screen */
export interface EndInfo {
  won: boolean;
  reason: 'omega' | 'inseln' | 'traeger';
  difficulty: Difficulty;
  /** seconds of play */
  time: number;
  stats: { islandsWon: number; islandsLost: number; kills: number; buildings: number; losses: number; shots: number; hits: number };
  /** after sinking the enemy's ship the player may go on and take the rest */
  goOn: boolean;
}

/** the title picture (its subtitle line is cut off in the CSS); the text logo stands in if it fails to load */
const LOGO = new URL('../assets/skerry-logo.webp', import.meta.url).href;

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function metaLine(m: SaveMeta): string {
  return `<b>${esc(m.name)}</b><small>${t('menu.meta', { date: formatDate(m.savedAt), seed: m.seed, count: m.count, clock: m.clock, owned: m.owned, time: formatPlayTime(m.playTime) })}</small>`;
}

/** the controls page, with the pictures of the connected pad's buttons */
const help = (g: Record<GlyphName, string>) => `
  <div class="cols">
    <div><h3>${t('help.general')}</h3>
      <p>${t('help.general1')}</p>
      <p>${t('help.general2')}</p>
      <p>${t('help.general3')}</p>
      <h3>${t('help.ship', { ship: SHIP_NAME })}</h3><p>${t('help.shipKeys')}</p>
      <h3>${t('type.otter')}</h3><p>${t('help.otterKeys')}</p>
      <h3>${t('type.skua')}</h3><p>${t('help.skuaKeys')}</p>
      <h3>${t('type.drone')}</h3><p>${t('help.droneKeys')}</p>
    </div>
    <div><h3>${t('help.gamepad')}</h3>
      <p>${t('help.pad1', g)}</p>
      <p>${t('help.pad2', g)}</p>
      <p>${t('help.pad3', g)}</p>
      <p>${t('help.pad4', g)}</p>
      <p>${t('help.pad5', g)}</p>
      <h3>${t('help.inMenu')}</h3><p>${t('help.menuKeys', g)}</p>
    </div>
  </div>`;

/** Menü → Anleitung: what the game is about and how to begin (the keys are on the controls page) */
const GUIDE = () => {
  const n = { ship: SHIP_NAME, foe: ENEMY_SHIP_NAME };
  return `
  <div class="cols">
    <div><h3>${t('guide.goal')}</h3><p>${t('guide.goalText', n)}</p>
      <h3>${t('guide.start')}</h3><p>${t('guide.start1', n)}</p><p>${t('guide.start2')}</p><p>${t('guide.start3', n)}</p></div>
    <div><h3>${t('guide.fight')}</h3><p>${t('guide.fightText', n)}</p>
      <h3>${t('guide.repair')}</h3><p>${t('guide.repairText', n)}</p>
      <h3>${t('guide.tips')}</h3><p>${t('guide.tipsText', n)}</p></div>
  </div>`;
};

/** the language the switch under the main menu offers (its button is labelled in that language) */
const OTHER_LANG: Lang = lang === 'de' ? 'en' : 'de';

/** the version and the day of the build, under the main menu (testers name it with what they report) */
const VERSION = () => t('menu.version', {
  v: __APP_VERSION__,
  date: new Date(__BUILD_DATE__).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }),
}) + (__BUILD_ID__ ? ` · ${__BUILD_ID__}` : '');

/** Menü → Mitwirkende: who made what, the sources of the sounds and the software (with their licenses) */
const CREDITS = `
  <p class="byline">${t('credits.byline')}</p>
  <p class="origin">${t('credits.origin')}</p>
  <div class="cols">
    <div><h3>${t('credits.team')}</h3><p>${t('credits.teamText')}</p>
      <h3>${t('credits.art')}</h3><p>${t('credits.artText')}</p></div>
    <div><h3>${t('credits.sounds')}</h3><p>${t('credits.soundsText')}</p>
      <h3>${t('credits.software')}</h3><p>${t('credits.softwareText')}</p></div>
  </div>
  <p class="legal">${t('credits.trademark')}</p>`;

/**
 * Title and pause menu: continue, new game (seed and island count), save and
 * load (slots, file export/import), settings and the controls. Mouse,
 * keyboard (arrows, Enter, Esc) and gamepad (D-pad/stick, A, B) work alike.
 */
export class Menu {
  /** the difficulty picked for a new game */
  private difficulty: Difficulty = 'normal';
  private end: EndInfo | null = null;
  open = false;
  private el: HTMLDivElement;
  private bodyEl: HTMLDivElement;
  private tagEl: HTMLDivElement;
  private noteEl: HTMLDivElement;
  private page: Page = 'main';
  private file: HTMLInputElement;
  private settingsOn = false;
  private armed = '';          // a button that needs a second press (overwrite, delete, new game)
  private repeat = 0;

  constructor(private actions: MenuActions) {
    this.el = document.createElement('div');
    this.el.id = 'menu';
    // the console's look: a metal tile with cut corners and gold strokes, like the blocks beside the map
    this.el.className = 'skin';
    // the logo stands free above the panel, on the picture
    this.el.innerHTML = `<img class="logoimg" src="${LOGO}" alt="${GAME_TITLE}">
      <div class="logo" hidden>${GAME_TITLE.toUpperCase()}</div>
      <div class="panel sec">
        <div class="tag"></div>
        <div class="body"></div>
        <div class="note"></div>
      </div>`;
    document.body.append(this.el);
    const logo = this.el.querySelector<HTMLImageElement>('.logoimg')!;
    logo.addEventListener('error', () => { logo.remove(); this.el.querySelector<HTMLElement>('.logo')!.hidden = false; });
    this.bodyEl = this.el.querySelector('.body')!;
    this.tagEl = this.el.querySelector('.tag')!;
    this.noteEl = this.el.querySelector('.note')!;
    this.file = document.createElement('input');
    this.file.type = 'file';
    this.file.accept = '.json,application/json';
    this.file.addEventListener('change', async () => {
      const f = this.file.files?.[0];
      this.file.value = '';
      if (!f) return;
      try { this.actions.load(await importSave(f)); } catch (e) { this.note((e as Error).message, true); }
    });
    this.el.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (el) this.act(el.dataset.act!, el.dataset.slot as SlotId | undefined, el);
    });
    this.el.addEventListener('input', (e) => {
      const r = e.target as HTMLInputElement;
      if (r.name === 'count') this.el.querySelector('.count')!.textContent = r.value;
    });
  }

  show(page: Page = 'main') {
    this.open = true;
    this.el.style.display = 'flex';
    document.body.classList.add('in-menu');
    this.render(page);
  }

  /** the end screen (null: the last one again) */
  showEnd(e: EndInfo | null) {
    if (e) this.end = e;
    this.show('end');
  }

  hide() {
    this.open = false;
    this.el.style.display = 'none';
    document.body.classList.remove('in-menu');
    this.setSettings(false);
  }

  private note(text: string, bad = false) {
    this.noteEl.textContent = text;
    this.noteEl.className = `note${bad ? ' bad' : ''}`;
  }

  private setSettings(on: boolean) {
    this.settingsOn = on;
    this.actions.settings(on);
  }

  private render(page: Page) {
    this.page = page;
    this.armed = '';
    this.note('');
    const inGame = this.actions.inGame();
    this.tagEl.textContent = inGame && page !== 'end' ? t('menu.pause') : '';
    let html = '';
    if (page === 'main') {
      const auto = readSave('auto');
      html = inGame
        ? `<button data-act="resume" class="big">${t('menu.resume')}</button>
           <button data-act="page" data-slot="save">${t('menu.save')}</button>
           <button data-act="page" data-slot="load">${t('menu.load')}</button>
           <button data-act="page" data-slot="new">${t('menu.newGame')}</button>`
        : (auto ? `<button data-act="continue" class="big">${t('menu.resume')}<small>${esc(auto.meta.name)} · ${formatDate(auto.meta.savedAt)}</small></button>` : '') +
          `<button data-act="page" data-slot="new"${auto ? '' : ' class="big"'}>${t('menu.newGame')}</button>
           <button data-act="page" data-slot="load">${t('menu.loadGame')}</button>`;
      html += `<button data-act="settings">${this.settingsOn ? t('menu.settingsHide') : t('menu.settings')}</button>
               <button data-act="page" data-slot="guide">${t('menu.guide')}</button>
               <button data-act="page" data-slot="help">${t('menu.controls')}</button>`;
      if (inGame) html += `<button data-act="title">${t('menu.toTitle')}</button>`;
      if (this.actions.quit) html += `<button data-act="quit">${t('menu.quit')}</button>`;
      if (!inGame) html += `<button data-act="intro" class="small">${t('menu.intro')}</button>`;
      html += `<button data-act="page" data-slot="credits" class="small">${t('menu.credits')}</button>` +
        `<button data-act="lang" class="small" lang="${OTHER_LANG}" title="${t('menu.langTitle')}">${t('menu.lang')}</button><div class="ver">${VERSION()}</div>`;
    } else if (page === 'new') {
      const w = this.actions.world();
      html = `<div class="h">${t('menu.hNew')}</div>
        <label>${t('menu.seed')} <input name="seed" type="number" min="1" max="999999" value="${w.seed}"></label>
        <button data-act="random" class="small">${t('menu.randomSeed')}</button>
        <label>${t('menu.islands')} <span class="count">${w.count}</span><input name="count" type="range" min="4" max="64" step="1" value="${w.count}"></label>
        <label>${t('menu.difficulty')}</label>
        <div class="diffs">${DIFFICULTIES.map(d => `<button data-act="diff" data-slot="${d}" class="small${d === this.difficulty ? ' on' : ''}">${t(`diff.${d}`)}</button>`).join('')}</div>
        <div class="hint diffhint">${t(`diff.${this.difficulty}.hint`)}</div>
        <label class="check"><input name="tutorial" type="checkbox"${tutorialDone() ? '' : ' checked'}> ${t('menu.tutorial')}</label>
        <div class="hint">${t('menu.tutorialHint')}</div>
        <div class="hint">${t('menu.newHint')}</div>
        <button data-act="start" class="big">${t('menu.start')}</button>
        <button data-act="page" data-slot="main">${t('menu.back')}</button>`;
    } else if (page === 'load' || page === 'save') {
      const saving = page === 'save';
      html = `<div class="h">${saving ? t('menu.hSave') : t('menu.hLoad')}</div>`;
      if (saving) html += `<label>${t('menu.name')} <input name="name" type="text" maxlength="40" value="${esc(this.actions.defaultName())}"></label>`;
      html += '<div class="slots">';
      for (const { slot, meta } of listSaves()) {
        if (saving && slot === 'auto') continue;
        const btns = saving
          ? `<button data-act="save" data-slot="${slot}">${meta ? t('menu.overwrite') : t('menu.save')}</button>`
          : meta ? `<button data-act="load" data-slot="${slot}">${t('menu.load')}</button><button data-act="export" data-slot="${slot}" class="small">${t('menu.file')}</button>` +
            `<button data-act="delete" data-slot="${slot}" class="small">${t('menu.delete')}</button>` : '';
        html += `<div class="slot"><div class="sname">${SLOT_NAMES[slot]}</div><div class="smeta">${meta ? metaLine(meta) : `<span class="empty">${t('menu.empty')}</span>`}</div><div class="sbtns">${btns}</div></div>`;
      }
      html += '</div>';
      if (!saving) html += `<button data-act="import" class="small">${t('menu.openFile')}</button>`;
      html += `<div class="hint">${t('menu.saveHint')}</div>
        <button data-act="page" data-slot="main">${t('menu.back')}</button>`;
    } else if (page === 'end' && this.end) {
      const e = this.end, st = e.stats;
      const row = (label: string, value: string) => `<div class="trow"><span>${label}</span><b>${value}</b></div>`;
      html = `<div class="endtitle ${e.won ? 'won' : 'lost'}">${t(e.won ? 'end.won' : 'end.lost')}</div>
        <p class="byline">${t(e.won ? (e.reason === 'omega' ? 'end.w.omega' : 'end.w.inseln') : e.reason === 'traeger' ? 'end.l.traeger' : 'end.l.inseln')}</p>
        <div class="tally">
          ${row(t('end.time'), formatPlayTime(e.time))}${row(t('menu.difficulty'), t(`diff.${e.difficulty}`))}
          ${row(t('end.islands'), t('end.islandsVal', { won: st.islandsWon, lost: st.islandsLost }))}
          ${row(t('end.kills'), String(st.kills))}${row(t('end.buildings'), String(st.buildings))}${row(t('end.losses'), String(st.losses))}
          ${row(t('end.hits'), t('end.hitsVal', { hits: st.hits, shots: st.shots, pct: st.shots ? Math.round(100 * st.hits / st.shots) : 0 }))}
        </div>
        ${e.goOn ? `<button data-act="resume" class="big">${t('end.goOn')}</button>` : ''}
        <button data-act="page" data-slot="new"${e.goOn ? '' : ' class="big"'}>${t('menu.newGame')}</button>
        <button data-act="title">${t('menu.toTitle')}</button>`;
    } else if (page === 'credits') {
      html = `<div class="h">${t('menu.hCredits')}</div>${CREDITS}
        <button data-act="licenses" class="small">${t('credits.licenses')}</button><pre class="lic" hidden></pre>
        <div class="ver">${VERSION()}</div>
        <button data-act="page" data-slot="main">${t('menu.back')}</button>`;
    } else if (page === 'guide') {
      html = `<div class="h">${t('menu.hGuide')}</div>${GUIDE()}
        <button data-act="page" data-slot="help" class="small">${t('menu.controls')}</button>
        <button data-act="page" data-slot="main">${t('menu.back')}</button>`;
    } else {
      html = `<div class="h">${t('menu.hControls')}</div>${help(this.actions.glyphs())}<button data-act="page" data-slot="main">${t('menu.back')}</button>`;
    }
    this.bodyEl.innerHTML = html;
    this.el.querySelector('.panel')!.classList.toggle('wide', page === 'help' || page === 'guide' || page === 'load' || page === 'save' || page === 'credits');
    this.focusables()[0]?.focus();
  }

  /** the license texts of the software in the game (public/lizenzen.txt), under the credits */
  private async showLicenses(btn: HTMLElement) {
    const pre = this.el.querySelector<HTMLElement>('pre.lic');
    if (!pre) return;
    if (!pre.hidden) { pre.hidden = true; btn.textContent = t('credits.licenses'); return; }
    if (!pre.textContent) {
      try { pre.textContent = await (await fetch(new URL('lizenzen.txt', document.baseURI))).text(); } catch { pre.textContent = '–'; }
    }
    pre.hidden = false;
    btn.textContent = t('credits.licensesHide');
  }

  /** a second press confirms (overwriting, deleting, ending the running game) */
  private confirm(id: string, btn: HTMLElement, text: string): boolean {
    if (this.armed === id) { this.armed = ''; return true; }
    this.armed = id;
    btn.textContent = text;
    btn.classList.add('arm');
    return false;
  }

  private act(act: string, slot: SlotId | undefined, btn: HTMLElement) {
    if (act === 'page') { this.render(slot as unknown as Page); return; }
    if (act === 'licenses') { void this.showLicenses(btn); return; }
    if (act === 'diff') {
      this.difficulty = slot as unknown as Difficulty;
      this.el.querySelectorAll<HTMLElement>('.diffs button').forEach(b => b.classList.toggle('on', b.dataset.slot === this.difficulty));
      this.el.querySelector<HTMLElement>('.diffhint')!.textContent = t(`diff.${this.difficulty}.hint`);
      return;
    }
    if (act === 'title') { this.actions.toTitle(); return; }
    if (act === 'quit') { this.actions.quit?.(); return; }
    if (act === 'intro') { this.actions.intro(); return; }
    if (act === 'lang') { this.actions.language(OTHER_LANG); return; }
    if (act === 'resume') { this.actions.resume(); return; }
    if (act === 'continue') { const s = readSave('auto'); if (s) this.actions.load(s); return; }
    if (act === 'settings') { this.setSettings(!this.settingsOn); btn.textContent = this.settingsOn ? t('menu.settingsHide') : t('menu.settings'); return; }
    if (act === 'random') { (this.el.querySelector('input[name=seed]') as HTMLInputElement).value = String(1 + Math.floor(Math.random() * 999998)); return; }
    if (act === 'start') {
      if (this.actions.inGame() && !this.confirm('start', btn, t('menu.confirmEnd'))) return;
      const seed = Math.round(Number((this.el.querySelector('input[name=seed]') as HTMLInputElement).value)) || 1988;
      const count = Number((this.el.querySelector('input[name=count]') as HTMLInputElement).value) || 64;
      const tutorial = (this.el.querySelector('input[name=tutorial]') as HTMLInputElement).checked;
      this.actions.newGame(Math.min(999999, Math.max(1, seed)), Math.min(64, Math.max(4, count)), this.difficulty, tutorial);
      return;
    }
    if (!slot) { if (act === 'import') this.file.click(); return; }
    if (act === 'save') {
      if (readSave(slot) && !this.confirm(`save${slot}`, btn, t('menu.confirmOverwrite'))) return;
      const name = (this.el.querySelector('input[name=name]') as HTMLInputElement).value.trim() || this.actions.defaultName();
      const why = this.actions.save(slot, name);
      this.render('save');
      this.note(why || t('menu.saved', { slot: SLOT_NAMES[slot] }), !!why);
    } else if (act === 'load') {
      const s = readSave(slot);
      if (s) this.actions.load(s); else this.note(t('menu.unreadable'), true);
    } else if (act === 'export') {
      const s = readSave(slot);
      if (s) exportSave(s);
    } else if (act === 'delete') {
      if (!this.confirm(`del${slot}`, btn, t('menu.confirmDelete'))) return;
      deleteSave(slot);
      this.render('load');
      this.note(t('menu.deleted', { slot: SLOT_NAMES[slot] }));
    }
  }

  private focusables(): HTMLElement[] {
    return [...this.bodyEl.querySelectorAll<HTMLElement>('button, input')];
  }

  /** arrows / D-pad / stick move the focus, A presses, B or Esc goes back */
  pad(input: Input, dt: number) {
    if (!this.open) return;
    const list = this.focusables();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const stick = input.axis(['Pad.LY-'], ['Pad.LY+']);
    this.repeat -= dt;
    let step = 0;
    if (input.hit('ArrowDown', 'Pad.Down')) step = 1;
    else if (input.hit('ArrowUp', 'Pad.Up')) step = -1;
    else if (Math.abs(stick) > 0.6 && this.repeat <= 0) { step = Math.sign(stick); this.repeat = 0.22; }
    if (Math.abs(stick) < 0.3) this.repeat = 0;
    if (step && list.length) list[(i + step + list.length) % list.length].focus();
    const cur = document.activeElement as HTMLInputElement | null;
    if (cur?.type === 'range') {
      const d = input.hit('ArrowRight', 'Pad.Right') ? 1 : input.hit('ArrowLeft', 'Pad.Left') ? -1 : 0;
      if (d) { cur.value = String(Number(cur.value) + d); cur.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    if (input.hit('Pad.A') && cur && list.includes(cur)) cur.click();
    if (input.hit('KeyP', 'Pad.Start') && this.actions.inGame()) { this.actions.resume(); return; }
    if (input.hit('Pad.B', 'Escape')) {
      if (this.page !== 'main') this.render('main');
      else if (this.actions.inGame()) this.actions.resume();
    }
  }
}

