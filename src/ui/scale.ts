/**
 * The interface's scale. It is laid out for 1920×1080 logical pixels (CSS px
 * after the system's scaling); above that it grows with the window (factor
 * min(width/1920, height/1080), e.g. 1.33 at 2560×1440) so bars and text keep
 * their size on big monitors. Below it does not shrink: it gets more compact
 * instead (see the media queries in index.html). The CSS applies the factor
 * with `zoom: var(--ui)` to every panel; the 3D picture and the map's canvas
 * keep their full resolution (the map draws in UI pixels at that scale).
 */
let factor = 1;

export const uiScale = () => factor;

export function updateUiScale(): number {
  factor = Math.max(1, Math.min(innerWidth / 1920, innerHeight / 1080));
  document.documentElement.style.setProperty('--ui', factor.toFixed(4));
  return factor;
}

updateUiScale();
addEventListener('resize', updateUiScale);
