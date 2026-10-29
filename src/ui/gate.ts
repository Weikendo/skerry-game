import { t } from '../i18n';

/**
 * Before the game is built, what the device cannot do. Without WebGL 2 (three.js needs it) the screen would only
 * stay black: a notice says why, and the game stops here. On a device without a mouse or trackpad (a phone, a tablet)
 * it would start but cannot be steered: a notice says what it needs, with "Start anyway" (an iPad with a keyboard and
 * a controller, say; remembered on that device). Imported first by main.ts.
 */
const TOUCH_OK = 'skerry-touch-ok';

function hasWebGL2(): boolean {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

function notice(title: string, text: string, button?: string): HTMLDivElement {
  const el = document.createElement('div');
  el.id = 'gate';
  el.innerHTML = `<div class="panel"><b>${title}</b><p>${text}</p>${button ? `<button>${button}</button>` : ''}</div>`;
  document.body.append(el);
  return el;
}

if (!hasWebGL2()) {
  document.getElementById('presents')?.remove();
  notice(t('gate.webglTitle'), t('gate.webgl'));
  throw new Error('Skerry: kein WebGL 2');
}

// (no fine pointer at all: a touch screen alone)
let touchOk = false;
try { touchOk = !!localStorage.getItem(TOUCH_OK); } catch { /* storage blocked */ }
if (!touchOk && !matchMedia('(any-pointer: fine)').matches) {
  const el = notice(t('gate.touchTitle'), t('gate.touch'), t('gate.anyway'));
  el.querySelector('button')!.addEventListener('click', () => {
    el.remove();
    try { localStorage.setItem(TOUCH_OK, '1'); } catch { /* storage blocked */ }
  });
}
