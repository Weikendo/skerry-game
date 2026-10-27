/**
 * Who sees what. The player only knows where an enemy unit is while something
 * of the player's sees it: the ship's radar, an island's radio mast or command
 * centre (also radar), and the eyes of the Otter, the Skua and the drone, which
 * fog and night shorten. Once out of sight, the last position stays on the map.
 */

/** sighting ranges in metres */
export const SIGHT = {
  /** the ship's radar, in any weather */
  shipRadar: 6000,
  /** radar on an island's radio mast or command centre */
  islandRadar: 5000,
  /** by eye: the Otter low on the water, the drone, the Skua at height */
  otter: 3000, drone: 5000, skua: 6000,
};
/** seconds out of every sight before a contact counts as lost (no flicker at the edge) */
const LOSE_AFTER = 6;

/** an observer: where it is and how far it sees */
export interface Eye { x: number; z: number; range: number }

/** where a contact was seen last; `hours` is the game time then (day × 24 + clock) */
export interface LastSeen { x: number; z: number; heading: number; speed: number; hours: number }

/** what the player knows about one enemy unit */
export class Contact {
  visible = false;
  /** null until it was seen once */
  last: LastSeen | null = null;
  private unseen = 0;

  /** 'sighted' when it comes into view, 'lost' when it has been out of view a moment */
  update(dt: number, eyes: Eye[], at: { x: number; z: number; heading: number; speed: number }, hours: number): 'sighted' | 'lost' | null {
    const seen = eyes.some(e => Math.hypot(e.x - at.x, e.z - at.z) <= e.range);
    if (seen) {
      this.unseen = 0;
      this.last = { x: at.x, z: at.z, heading: at.heading, speed: at.speed, hours };
      if (!this.visible) { this.visible = true; return 'sighted'; }
      return null;
    }
    if (!this.visible) return null;
    this.unseen += dt;
    if (this.unseen < LOSE_AFTER) {
      // still counted as in view: keep the picture current
      this.last = { x: at.x, z: at.z, heading: at.heading, speed: at.speed, hours };
      return null;
    }
    this.visible = false;
    return 'lost';
  }

  saveState() {
    return { visible: this.visible, last: this.last };
  }

  loadState(s: ReturnType<Contact['saveState']>) {
    this.visible = s.visible;
    this.last = s.last;
    this.unseen = 0;
  }
}
