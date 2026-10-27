import * as THREE from 'three';
import { PAL } from '../engine/palette';
import type { Effects } from './effects';
import type { Ground } from './terrain';

/** what a wreck does: falls burning out of the sky, sinks, or lies burning on land */
type Mode = 'faellt' | 'sinkt' | 'liegt';
interface Wreck { obj: THREE.Object3D; vel: THREE.Vector3; spin: THREE.Vector3; mode: Mode; t: number; smoke: number; size: number; color: THREE.ColorRepresentation }

const MAX = 12;
/** a wreck on land burns this long (s) and is gone after LIE */
const BURN = 25, LIE = 45;
/** a wreck in the water smokes this long (s) while it goes down */
const SMOKE_AFLOAT = 8;
/** charred: the model's own colours, darkened */
const CHARRED = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0x3c3a38, flatShading: true });

/**
 * Wrecks of destroyed vehicles: a charred copy of the model (sharing its geometry) where it died. A Skua shot
 * out of the sky falls trailing fire and smoke and blows up where it lands, or splashes into the sea; an Otter
 * sinks burning in the water or burns out on land.
 */
export class Wrecks {
  readonly group = new THREE.Group();
  private list: Wreck[] = [];

  constructor(private ground: Ground, private effects: Effects) {
    this.group.name = 'wrecks';
  }

  /**
   * A vehicle is lost: `model` is its group as it stands (copied before the game hides it), `vel` how it was
   * moving, `size` about how big it is (m), `color` its debris.
   */
  add(model: THREE.Object3D, vel: THREE.Vector3, size: number, color: THREE.ColorRepresentation) {
    model.updateMatrixWorld(true);
    const obj = model.clone(true);
    model.matrixWorld.decompose(obj.position, obj.quaternion, obj.scale);
    obj.visible = true;
    obj.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        // the lamps go dark, the rest is charred
        if (o.name.startsWith('lights')) o.visible = false;
        else { m.material = CHARRED; m.castShadow = true; }
      } else if ((o as THREE.Points).isPoints) o.visible = false;
    });
    const p = obj.position, surface = Math.max(this.ground.heightAt(p.x, p.z), 0);
    const mode: Mode = p.y > surface + 4 ? 'faellt' : this.ground.heightAt(p.x, p.z) < 0 ? 'sinkt' : 'liegt';
    const r = () => Math.random() - 0.5;
    const w: Wreck = { obj, vel: vel.clone(), spin: new THREE.Vector3(r() * 2.4, r() * 1.2, r() * 3), mode, t: 0, smoke: 0, size, color };
    if (mode !== 'faellt') w.vel.set(0, 0, 0);
    if (mode === 'liegt') this.effects.burn(p, size * 0.35, BURN);
    if (this.list.length >= MAX) this.drop(this.list[0]);
    this.list.push(w);
    this.group.add(obj);
  }

  private drop(w: Wreck) {
    this.group.remove(w.obj);
    this.list.splice(this.list.indexOf(w), 1);
  }

  update(dt: number) {
    for (const w of [...this.list]) {
      w.t += dt;
      const p = w.obj.position;
      if (w.mode === 'faellt') {
        // ballistic, tumbling, a trail of fire and black smoke
        w.vel.y -= 9.81 * dt;
        w.vel.multiplyScalar(Math.exp(-dt * 0.15));
        p.addScaledVector(w.vel, dt);
        w.obj.rotateX(w.spin.x * dt); w.obj.rotateY(w.spin.y * dt); w.obj.rotateZ(w.spin.z * dt);
        w.smoke += dt;
        while (w.smoke > 0.04) { w.smoke -= 0.04; this.effects.smokeTrail(p, w.size * 0.45); }
        this.effects.halo(p, new THREE.Color(PAL.lava).multiplyScalar(1.6), w.size * 1.2);
        const g = this.ground.heightAt(p.x, p.z);
        if (p.y <= Math.max(g, 0)) {
          if (g < 0) { this.effects.splash(p, 1.2); w.mode = 'sinkt'; w.vel.set(w.vel.x * 0.05, 0, w.vel.z * 0.05); p.y = 0; w.t = 0; }
          else { p.y = g; this.effects.explosion(p, 1, w.color); this.effects.clatter(p); this.effects.burn(p, w.size * 0.35, BURN); w.mode = 'liegt'; w.t = 0; }
        }
      } else if (w.mode === 'sinkt') {
        // a moment afloat and smoking, then down by the stern, tilting, until it is gone
        p.addScaledVector(w.vel, dt);
        if (w.t > 1.2) { p.y -= Math.min(2.5, 0.4 + (w.t - 1.2) * 0.5) * dt; w.obj.rotateX(-0.12 * dt); w.obj.rotateZ(0.05 * dt); }
        // smoke goes up from where it lies in the water for the first seconds
        w.smoke += dt;
        while (w.smoke > 0.2) { w.smoke -= 0.2; if (w.t < SMOKE_AFLOAT) this.effects.smokePuff(new THREE.Vector3(p.x, 1.5, p.z), w.size * 0.3); }
        if (p.y < -w.size * 2 - 10) this.drop(w);
      } else {
        // burnt out at last, it settles into the ground and goes
        if (w.t > LIE - 4) p.y -= 1.2 * dt;
        if (w.t > LIE) this.drop(w);
      }
    }
  }
}
