import type { PadKind } from '../game/input';

/** the pad's buttons as the help texts name them ({rt}, {ls} …), by their place in the standard layout */
export type GlyphName = 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'lt' | 'rt' | 'ls' | 'rs' | 'l3' | 'dpad' | 'start';

const BG = '#1b2530', RIM = '#8fa3b2', INK = '#dfe6ec';
const svg = (w: number, body: string) =>
  `<svg class="pg" width="${w}" height="16" viewBox="0 0 ${w} 16" aria-hidden="true">${body}</svg>`;
const disc = (body: string) => svg(16, `<circle cx="8" cy="8" r="7.3" fill="${BG}" stroke="${RIM}" stroke-width="1"/>${body}`);
const label = (text: string, w: number, rx = 4) => svg(w,
  `<rect x="0.5" y="1" width="${w - 1}" height="14" rx="${rx}" fill="${BG}" stroke="${RIM}" stroke-width="1"/>` +
  `<text x="${w / 2}" y="11.2" text-anchor="middle" font-size="8.5" font-weight="700" font-family="-apple-system, sans-serif" fill="${INK}">${text}</text>`);
const letter = (c: string, color: string) => disc(
  `<text x="8" y="11.4" text-anchor="middle" font-size="9.5" font-weight="800" font-family="-apple-system, sans-serif" fill="${color}">${c}</text>`);
const stick = (c: string) => disc(`<circle cx="8" cy="8" r="4.2" fill="none" stroke="${RIM}" stroke-width="1"/>` +
  `<text x="8" y="10.6" text-anchor="middle" font-size="6.5" font-weight="800" font-family="-apple-system, sans-serif" fill="${INK}">${c}</text>`);
// the D-pad with its up and down arms lit (the speed step)
const dpad = svg(16, `<path d="M6 1.5h4v4.5h4.5v4H10v4.5H6V10H1.5V6H6z" fill="${BG}" stroke="${RIM}" stroke-width="1"/>` +
  `<path d="M8 2.8l1.6 2.2H6.4zM8 13.2l1.6-2.2H6.4z" fill="${INK}"/>`);

const PLAYSTATION: Record<GlyphName, string> = {
  a: disc('<path d="M5 5l6 6M11 5l-6 6" stroke="#8fb8ff" stroke-width="1.6" stroke-linecap="round"/>'),
  b: disc('<circle cx="8" cy="8" r="3.4" fill="none" stroke="#ff7a7a" stroke-width="1.5"/>'),
  x: disc('<rect x="4.9" y="4.9" width="6.2" height="6.2" fill="none" stroke="#f29ad6" stroke-width="1.5"/>'),
  y: disc('<path d="M8 4.2l3.6 6.3H4.4z" fill="none" stroke="#5fd6a8" stroke-width="1.5" stroke-linejoin="round"/>'),
  lb: label('L1', 20), rb: label('R1', 20), lt: label('L2', 20, 6), rt: label('R2', 20, 6),
  ls: stick('L'), rs: stick('R'), l3: label('L3', 20, 7), dpad, start: label('OPTIONS', 46, 7),
};
const XBOX: Record<GlyphName, string> = {
  a: letter('A', '#7ed957'), b: letter('B', '#ff6b6b'), x: letter('X', '#6ab7ff'), y: letter('Y', '#f5d547'),
  lb: label('LB', 20), rb: label('RB', 20), lt: label('LT', 20, 6), rt: label('RT', 20, 6),
  ls: stick('L'), rs: stick('R'), l3: label('LS', 20, 7), dpad, start: label('☰', 20, 7),
};

/** the button pictures of a PlayStation or Xbox pad, to fill the help texts' placeholders */
export function padGlyphs(kind: PadKind): Record<GlyphName, string> {
  return kind === 'playstation' ? PLAYSTATION : XBOX;
}
