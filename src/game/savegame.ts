import type { Difficulty } from './difficulty';
import { t, locale } from '../i18n';
/**
 * Save games: one automatic slot and five manual slots in the browser's local
 * storage (per address: 127.0.0.1 and localhost keep separate saves), plus
 * export and import as a JSON file. The world itself is not stored, it is
 * generated again from its seed; a save holds everything that changed.
 */

/** 2: four Walrus and four Manta with their fittings (milestone 9) */
export const SAVE_VERSION = 2;
export type SlotId = 'auto' | '1' | '2' | '3' | '4' | '5';
export const SLOTS: SlotId[] = ['auto', '1', '2', '3', '4', '5'];
export const MANUAL_SLOTS: SlotId[] = ['1', '2', '3', '4', '5'];
export const SLOT_NAMES: Record<SlotId, string> = {
  auto: t('save.slotAuto'), 1: t('save.slot', { n: 1 }), 2: t('save.slot', { n: 2 }), 3: t('save.slot', { n: 3 }), 4: t('save.slot', { n: 4 }), 5: t('save.slot', { n: 5 }),
};

export interface SaveMeta {
  name: string;
  savedAt: number;     // Date.now()
  seed: number;
  count: number;       // islands
  clock: string;       // game time of day, "14:32"
  playTime: number;    // seconds played
  owned: number;       // islands held by the player
}

export interface SaveGame {
  version: number;
  meta: SaveMeta;
  /** the game's own state (main.ts collects and applies it) */
  data: unknown;
}

const key = (slot: SlotId) => `cc-save-${slot}`;

function valid(s: unknown): s is SaveGame {
  const g = s as SaveGame;
  return !!g && typeof g === 'object' && g.version === SAVE_VERSION && !!g.meta && typeof g.meta.seed === 'number' && !!g.data;
}

export function readSave(slot: SlotId): SaveGame | null {
  try {
    const raw = localStorage.getItem(key(slot));
    if (!raw) return null;
    const s = JSON.parse(raw);
    return valid(s) ? s : null;
  } catch { return null; }
}

/** returns '' or the reason it failed (storage full or blocked) */
export function writeSave(slot: SlotId, save: SaveGame): string {
  try {
    localStorage.setItem(key(slot), JSON.stringify(save));
    return '';
  } catch (e) {
    return (e as Error).name === 'QuotaExceededError' ? t('save.full') : t('save.blocked');
  }
}

export function deleteSave(slot: SlotId) {
  try { localStorage.removeItem(key(slot)); } catch { /* storage blocked */ }
}

export function listSaves(): { slot: SlotId; meta: SaveMeta | null }[] {
  return SLOTS.map(slot => ({ slot, meta: readSave(slot)?.meta ?? null }));
}

/** a download of the save as a file */
export function exportSave(save: SaveGame) {
  const blob = new Blob([JSON.stringify(save)], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date(save.meta.savedAt);
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  a.href = URL.createObjectURL(blob);
  a.download = `skerry-${save.meta.seed}-${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importSave(file: File): Promise<SaveGame> {
  const s = JSON.parse(await file.text());
  if (!valid(s)) throw new Error(t('save.invalid'));
  return s;
}

// ---- hand-over across a page reload (a different world needs a fresh start) ----
// (`quiet`: the game goes on after a change of language, without the "loaded" note and its name in the old language;
// `tutorial`: the new game starts with the guided first steps; `training`: the combat training)
type Boot = { kind: 'start'; difficulty?: Difficulty; tutorial?: boolean } | { kind: 'load'; save: SaveGame; quiet?: boolean } | { kind: 'training' };
const BOOT = 'cc-boot';

export function requestBoot(boot: Boot) {
  try { sessionStorage.setItem(BOOT, JSON.stringify(boot)); } catch { /* storage blocked */ }
}

export function takeBoot(): Boot | null {
  try {
    const raw = sessionStorage.getItem(BOOT);
    sessionStorage.removeItem(BOOT);
    return raw ? JSON.parse(raw) as Boot : null;
  } catch { return null; }
}

export function formatDate(time: number): string {
  const d = new Date(time);
  return `${d.toLocaleDateString(locale)} ${d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`;
}

export function formatPlayTime(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? t('save.playTimeH', { h, m }) : t('save.playTimeM', { m });
}
