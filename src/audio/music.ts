import type { SoundEngine } from './sound';

const TRACK = new URL('../assets/The_Iron_Monolith.mp3', import.meta.url).href;
/** the track is mastered loud (about -13 LUFS): this brings it down to the level the game's sound was balanced for */
const GAIN = 0.4;
/** seconds to fade in and out (unless a cue says otherwise) */
const FADE_IN = 2.5, FADE_OUT = 3;

/** how the music comes in: how loud (share of the music level), looped or once, how slowly, and how far
 *  the game's sea and weather give way to it while it plays (0: not at all, 0.8: down to a fifth) */
export interface MusicCue { level?: number; loop?: boolean; fadeIn?: number; duck?: number }

/**
 * The music: an audio element of its own beside the synthesised sound (which
 * falls silent with the pause menu), faded in and out, and as loud as the
 * music level times the master level (silent with the sound off). It plays
 * looped under the title and the victory, and once, quieter, on a long
 * voyage. Browsers start it only after a click or key; `play` says whether
 * it may.
 */
export class TitleMusic {
  private el = new Audio(TRACK);
  /** how loud it should sound (0 to fade out) */
  private target = 0;
  private vol = 0;
  private playing = false;
  private fadeIn = FADE_IN;
  private fadeOut = FADE_OUT;
  /** the level of the last cue: fades are timed for the way between it and silence */
  private peak = 1;
  /** the last cue's duck */
  private depth = 0;

  constructor(private sound: SoundEngine) {
    this.el.loop = true;
    this.el.preload = 'auto';
    this.el.volume = 0;
    // no music from a background tab
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.el.pause();
      else if (this.playing) void this.el.play().catch(() => {});
    });
    // played once to the end: silent and back at the start
    this.el.addEventListener('ended', () => this.rest());
    // Safari lets a page start a sound element on its own only once it has played in a click or key press (Chrome
    // after any one): on the first, unless it plays already, it starts muted and stops again, so the voyage's and the
    // victory's music may start later by themselves (they stayed silent in Safari)
    const prime = () => {
      removeEventListener('pointerdown', prime, true);
      removeEventListener('keydown', prime, true);
      if (this.playing) return;
      this.el.muted = true;
      // (the boot's own press may start the title music in the same moment: play() sets the target before it waits)
      this.el.play()
        .then(() => { if (!this.playing && this.target <= 0) { this.el.pause(); this.el.currentTime = 0; } })
        .catch(() => {})
        .finally(() => { this.el.muted = false; });
    };
    addEventListener('pointerdown', prime, true);
    addEventListener('keydown', prime, true);
  }

  /** whether it sounds (or still fades out) */
  get busy() { return this.playing; }

  /** how loud the game's sea and weather may be beside it now (1: as set); it gives way at once and comes back with the fade-out */
  get duck(): number {
    const s = this.sound, level = s.enabled ? s.levels.master * s.levels.music : 0;
    if (!this.playing || level <= 0) return 1;
    const presence = this.target > 0 ? 1 : Math.min(1, this.vol / Math.max(1e-3, this.peak * level));
    return 1 - this.depth * presence;
  }

  /** start (fading in); false while the browser waits for a click or key */
  async play(cue: MusicCue = {}): Promise<boolean> {
    this.target = this.peak = cue.level ?? 1;
    this.fadeIn = cue.fadeIn ?? FADE_IN;
    this.depth = cue.duck ?? 0;
    this.el.loop = cue.loop ?? true;
    if (this.playing) return true;
    try {
      await this.el.play();
      this.playing = true;
      return true;
    } catch {
      return false;
    }
  }

  /** fade out (over `seconds`), then stop */
  stop(seconds = FADE_OUT) {
    this.target = 0;
    this.fadeOut = seconds;
  }

  update(dt: number) {
    if (!this.playing) return;
    const s = this.sound, level = s.enabled ? s.levels.master * s.levels.music : 0, want = this.target * level;
    // a fade takes its time however loud the music is set (with the sound switched off it goes quickly)
    const span = s.enabled ? Math.max(this.peak * level, 0.05) : 1;
    const rate = dt * span / (want > this.vol ? this.fadeIn : this.fadeOut);
    this.vol += Math.max(-rate, Math.min(rate, want - this.vol));
    this.el.volume = Math.max(0, Math.min(1, this.vol * GAIN));
    if (this.target === 0 && this.vol <= 0.001) this.rest();
  }

  private rest() {
    this.el.pause();
    this.el.currentTime = 0;
    this.el.volume = this.vol = this.target = 0;
    this.playing = false;
  }
}
