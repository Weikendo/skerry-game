/**
 * A laser with a heat gauge: every shot heats it up, it cools over time and
 * locks out when overheated ("LASER OVERHEATING" in the original).
 */
export class LaserWeapon {
  heat = 0;
  overheated = false;
  private cooldown = 0;

  constructor(private interval: number, private heatPerShot: number, private coolRate = 0.24) {}

  update(dt: number) {
    this.cooldown -= dt;
    this.heat = Math.max(0, this.heat - this.coolRate * dt);
    if (this.overheated && this.heat < 0.35) this.overheated = false;
  }

  ready(): boolean {
    return this.cooldown <= 0 && !this.overheated;
  }

  fired() {
    this.cooldown = this.interval;
    this.heat += this.heatPerShot;
    if (this.heat >= 1) { this.heat = 1; this.overheated = true; }
  }
}
