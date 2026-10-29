import { lang } from '../i18n';
import type { SoundEngine } from './sound';

/**
 * The Stoorworm's ship computer speaks (docs/bordcomputer-stimme.md): 50 short lines, recorded with ElevenLabs in
 * German and English (src/assets/stimme), on the game's events. The log keeps its messages; the voice adds to them
 * and names no islands or distances. One line at a time: they wait in a short queue, warnings first, the unimportant
 * ones dropped when they had to wait; the same line not again for a while.
 */

export type VoiceLine =
  | 'rakete-anflug' | 'hammerhead-anflug' | 'schiff-beschuss' | 'schiff-schaden' | 'schiff-sinkt' | 'feind-skua'
  | 'feind-luftangriff' | 'insel-angriff' | 'feind-traeger' | 'feind-traeger-weg' | 'feind-accb' | 'feind-beobachter'
  | 'feind-insel' | 'skua-verloren' | 'otter-verloren' | 'drohne-verloren' | 'funk-schwach' | 'funk-weg' | 'treibstoff'
  | 'panzerung' | 'laser-heiss' | 'ziel-zerstoert' | 'skua-abschuss' | 'insel-neutral' | 'feind-zentrale'
  | 'insel-erobert' | 'traeger-treffer' | 'traeger-sinkt' | 'bereit' | 'angriff-start' | 'angriff-heim' | 'reparatur'
  | 'kartiert'
  // the transfer drone and the supply network
  | 'transfer-start' | 'transfer-angedockt' | 'transfer-geliefert' | 'transfer-voll' | 'transfer-abbruch'
  | 'transfer-unterwegs' | 'transfer-zu-weit' | 'transfer-nichts' | 'lager-in-reichweite' | 'lager-ausser-reichweite'
  | 'netz-unterbrochen' | 'lager-verloren'
  // weapons
  | 'ausser-reichweite' | 'zielsonde-bereit'
  // the Otters and the ship's own fuel
  | 'otter-wegpunkt' | 'otter-an-land' | 'treibstoff-schiff';

/** 1: goes before everything waiting; 3: dropped after a short wait */
const PRIO: Record<VoiceLine, 1 | 2 | 3> = {
  'rakete-anflug': 1, 'hammerhead-anflug': 1, 'schiff-beschuss': 1, 'schiff-schaden': 1, 'schiff-sinkt': 1, 'traeger-sinkt': 1,
  'feind-skua': 2, 'feind-luftangriff': 2, 'insel-angriff': 2, 'feind-traeger': 2, 'feind-accb': 2, 'feind-insel': 2,
  'skua-verloren': 2, 'otter-verloren': 2, 'drohne-verloren': 2, 'funk-weg': 2, 'skua-abschuss': 2, 'insel-neutral': 2,
  'feind-zentrale': 2, 'insel-erobert': 2, 'bereit': 2,
  'feind-traeger-weg': 3, 'feind-beobachter': 3, 'funk-schwach': 3, 'treibstoff': 3, 'panzerung': 3, 'laser-heiss': 3,
  'ziel-zerstoert': 3, 'traeger-treffer': 3, 'angriff-start': 3, 'angriff-heim': 3, 'reparatur': 3, 'kartiert': 3,
  'transfer-geliefert': 2, 'transfer-voll': 2, 'transfer-abbruch': 2, 'netz-unterbrochen': 2, 'lager-verloren': 2,
  'transfer-start': 3, 'transfer-angedockt': 3, 'transfer-unterwegs': 3, 'transfer-zu-weit': 3,
  'transfer-nichts': 3, 'lager-in-reichweite': 3, 'lager-ausser-reichweite': 3,
  'zielsonde-bereit': 2, 'ausser-reichweite': 3,
  'treibstoff-schiff': 2, 'otter-wegpunkt': 3, 'otter-an-land': 3,
};
const LINES = Object.keys(PRIO) as VoiceLine[];
/** s before the same line may come again (otherwise AGAIN_DEFAULT) */
const AGAIN: Partial<Record<VoiceLine, number>> = { 'schiff-beschuss': 30, 'feind-skua': 25, 'traeger-treffer': 60, 'ziel-zerstoert': 8, 'laser-heiss': 20, 'ausser-reichweite': 8, 'otter-an-land': 20 };
const AGAIN_DEFAULT = 15;
/** s a line may wait in the queue, by its priority */
const PATIENCE = { 1: 8, 2: 6, 3: 3 };
/** s of quiet after each line */
const GAP = 0.35;
/** lines waiting at most; beyond, the least important (the latest of them) is dropped */
const QUEUE = 4;

const url = (id: VoiceLine) => lang === 'de'
  ? new URL(`../assets/stimme/de/${id}.ogg`, import.meta.url).href
  : new URL(`../assets/stimme/en/${id}.ogg`, import.meta.url).href;

export class ShipVoice {
  /** the player's switch (settings) */
  enabled = true;
  private buffers = new Map<VoiceLine, AudioBuffer>();
  private loading = false;
  /** all files fetched (a line without one is passed over instead of holding up the queue) */
  private loaded = false;
  private queue: { line: VoiceLine; at: number }[] = [];
  private said = new Map<VoiceLine, number>();
  private quietUntil = 0;

  constructor(private sound: SoundEngine) {}

  /** the computer says this line (unless it said it just now, or it is switched off) */
  say(line: VoiceLine) {
    if (!this.enabled) return;
    const now = this.sound.now, was = this.said.get(line);
    if (was !== undefined && now - was < (AGAIN[line] ?? AGAIN_DEFAULT)) return;
    if (this.queue.some(q => q.line === line)) return;
    this.said.set(line, now);
    const at = PRIO[line] === 1 ? this.queue.findIndex(q => PRIO[q.line] > 1) : -1;
    this.queue.splice(at < 0 ? this.queue.length : at, 0, { line, at: now });
    if (this.queue.length > QUEUE) {
      const prios: number[] = this.queue.map(q => PRIO[q.line]);
      this.queue.splice(prios.lastIndexOf(Math.max(...prios)), 1);
    }
  }

  /** every frame: the next line when the last one is through */
  update() {
    if (!this.sound.running) return;
    if (!this.loading) void this.load();
    const now = this.sound.now;
    this.queue = this.queue.filter(q => now - q.at < PATIENCE[PRIO[q.line]]);
    if (!this.enabled) { this.queue.length = 0; return; }
    if (now < this.quietUntil || !this.queue.length) return;
    const buf = this.buffers.get(this.queue[0].line);
    if (!buf) { if (this.loaded) this.queue.shift(); return; }
    this.queue.shift();
    this.quietUntil = now + this.sound.speak(buf) + GAP;
  }

  /** the lines of the game's language, fetched once the sound is on */
  private async load() {
    this.loading = true;
    await Promise.all(LINES.map(async (id) => {
      const buf = await this.sound.decode(url(id));
      if (buf) this.buffers.set(id, buf);
    }));
    this.loaded = true;
  }
}
