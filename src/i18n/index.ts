import { de } from './de';
import { en } from './en';

/**
 * Every visible text of the game comes from a catalog (German in `de.ts`, the
 * reference; English follows). Texts are whole sentences with named
 * placeholders, so each language can order its words freely:
 *
 *   t('walrus.dockReady')                          plain text
 *   t('map.toDepot', { km: km(d) })                "{km}" is replaced
 *   t('map.links', { n: 2 })                       "{n:Verbindung|Verbindungen}" picks the form for n
 *
 * Numbers passed as placeholders are written in the language's own format
 * (German decimal comma). The language is fixed while the page runs; a
 * change takes effect on the next start.
 */

export type Lang = 'de' | 'en';
type Catalog = typeof de;
export type TextKey = keyof Catalog;

// placeholder names of a text: "{name}" and "{n:one|other}"
type Names<S extends string> = S extends `${string}{${infer P}}${infer R}`
  ? (P extends `${infer N}:${string}` ? N : P) | Names<R> : never;
type SameNames<A extends string, B extends string> = [Names<A>] extends [Names<B>] ? [Names<B>] extends [Names<A>] ? true : false : false;
/**
 * A translation: every key of the German catalog and no other, each with the same placeholder names
 * (a text whose placeholders differ is typed as a message naming the German ones, so the compiler shows them).
 */
type Translation<T extends Record<string, string>> = {
  [K in TextKey]: K extends keyof T ? SameNames<Catalog[K], T[K]> extends true ? T[K] : `placeholders as in de: ${Names<Catalog[K]>}` : string;
} & Record<Exclude<keyof T, TextKey>, never>;

const LANG_KEY = 'skerry-lang';
const catalogs: Record<Lang, Record<TextKey, string>> = { de, en: en satisfies Translation<typeof en> };

/** the chosen language, else the browser's: German for German, English for everything else */
function startLang(): Lang {
  try {
    const s = localStorage.getItem(LANG_KEY);
    if (s === 'de' || s === 'en') return s;
  } catch { /* storage blocked */ }
  return /^de\b/i.test(navigator.language ?? '') ? 'de' : 'en';
}

export const lang: Lang = startLang();
export const locale = lang === 'de' ? 'de-DE' : 'en-GB';

/** remember the language for the next start */
export function setLang(l: Lang) {
  try { localStorage.setItem(LANG_KEY, l); } catch { /* storage blocked */ }
}

type Args<K extends TextKey> = [Names<Catalog[K]>] extends [never] ? [] : [Record<Names<Catalog[K]>, string | number>];

export function t<K extends TextKey>(key: K, ...args: Args<K>): string {
  const text: string = catalogs[lang][key] ?? de[key];
  const p = args[0] as Record<string, string | number> | undefined;
  if (!p) return text;
  return text.replace(/\{(\w+)(?::([^}]*))?\}/g, (_, name: string, forms?: string) => {
    const v = p[name];
    if (forms !== undefined) {
      const [one, other] = forms.split('|');
      return Number(v) === 1 ? one : other ?? one;
    }
    return typeof v === 'number' ? num(v) : String(v);
  });
}

const formats = new Map<number, Intl.NumberFormat>();
/** a number with a fixed count of decimals, in the language's format (no thousands separator) */
export function num(v: number, digits = 0): string {
  let f = formats.get(digits);
  if (!f) {
    f = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
    formats.set(digits, f);
  }
  return f.format(Object.is(v, -0) ? 0 : v);
}

/** metres as kilometres, "18,4 km" */
export const km = (m: number, digits = 1) => `${num(m / 1000, digits)} km`;
/** 0..1 as a whole percentage, "62 %" */
export const pct = (v: number) => t('unit.pct', { v: Math.round(v * 100) });
