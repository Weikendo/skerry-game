/** the difficulty chosen for a new game (kept in the save) */
export type Difficulty = 'leicht' | 'normal' | 'schwer';
export const DIFFICULTIES: Difficulty[] = ['leicht', 'normal', 'schwer'];

/** what a difficulty sets for the enemy */
export interface Tuning {
  /** how many of its Otters and Skuas it uses (it carries three of each; the rest stay aboard) */
  otters: number;
  skuas: number;
  /** its first attack on an island of the player's, then at most one per pause (s of play) */
  firstAttack: number;
  attackPause: number;
  /** Skua raids on gunless islands of the player's */
  firstRaid: number;
  raidPause: number;
  /** after a run of a Skua at the Stoorworm, the next one */
  huntPause: number;
  /** its weapons' damage (its units, its ship and its islands' guns) */
  damage: number;
  /** how fast its network mines, makes and ships */
  production: number;
  /** how fast the hulls are repaired: the Stoorworm's and its own ship's */
  ownRepair: number;
  foeRepair: number;
  /** how well its ship's laser turret fights, 0..1 (the Stoorworm's own: 0.65) */
  defence: number;
}

/** normal is the game as it was balanced; easy and hard after the original's two kinds of game, a step further apart */
export const TUNING: Record<Difficulty, Tuning> = {
  leicht: { otters: 2, skuas: 1, firstAttack: 900, attackPause: 900, firstRaid: 900, raidPause: 900, huntPause: 480, damage: 0.75, production: 0.75, ownRepair: 1.5, foeRepair: 0.75, defence: 0.35 },
  normal: { otters: 2, skuas: 2, firstAttack: 420, attackPause: 420, firstRaid: 300, raidPause: 300, huntPause: 240, damage: 1, production: 1, ownRepair: 1, foeRepair: 1, defence: 0.65 },
  schwer: { otters: 3, skuas: 3, firstAttack: 300, attackPause: 300, firstRaid: 200, raidPause: 200, huntPause: 150, damage: 1.2, production: 1.3, ownRepair: 1, foeRepair: 1.3, defence: 0.9 },
};
