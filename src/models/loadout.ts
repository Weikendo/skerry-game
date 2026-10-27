import * as THREE from 'three';
import { LowPolyBuilder, lowPolyMaterial } from '../engine/lowpoly';
import { PAL } from '../engine/palette';
import type { MantaLoad, WalrusLoad } from '../game/arsenal';
import { buildAccb } from './accb';
import type { WalrusModel } from './walrus';
import type { MantaModel } from './manta';

const mat = lowPolyMaterial();
const mesh = (b: LowPolyBuilder) => { const m = new THREE.Mesh(b.build(), mat); m.castShadow = true; return m; };

/** a slim missile along +z (Harbinger: grey body, red tip) */
function rocket(len: number, r: number, body: string, tip: string): LowPolyBuilder {
  const b = new LowPolyBuilder();
  b.pushTRS([0, 0, 0], 0, [1, 1, 1], Math.PI / 2);
  b.cylinder([0, 0, 0], r, r, len, 6, body, body);
  b.cone([0, len, 0], r, r * 3, 6, tip);
  b.pop();
  return b;
}

/**
 * What a Walrus carries, visible on the model: the Avatar's twin barrels or a
 * Harbinger launcher on the turret, and the cargo (ACCB, virus bomb, fuel pod)
 * on the rear deck.
 */
export function buildWalrusGear(model: WalrusModel): (load: WalrusLoad) => void {
  // Harbinger: a four-tube launcher in the barrel cradle (it elevates with the aim)
  const launcher = new THREE.Group();
  const lb = new LowPolyBuilder();
  lb.box([-0.78, -0.5, -0.7], [0.78, 0.5, 2.3], { side: PAL.metall, top: PAL.metallHell, front: PAL.anthrazit });
  lb.box([-0.8, 0.12, -0.4], [0.8, 0.26, 1.9], PAL.ocker);
  launcher.add(mesh(lb));
  const rockets: THREE.Object3D[] = [];
  const rg = rocket(1.6, 0.17, PAL.stahlHell, PAL.signalRot);
  for (const [x, y] of [[-0.36, 0.22], [0.36, 0.22], [-0.36, -0.22], [0.36, -0.22]]) {
    const r = mesh(rg);
    r.position.set(x, y, 1.2);
    launcher.add(r);
    rockets.push(r);
  }
  model.parts.barrel.add(launcher);

  // cargo on the rear deck
  const accb = buildAccb();
  accb.scale.setScalar(0.5);
  accb.position.set(1.9, 4.42, -6.6);
  const vb = new LowPolyBuilder();
  vb.box([-0.55, 0, -0.9], [0.55, 0.35, 0.9], PAL.anthrazit);
  vb.pushTRS([0, 0.9, 0], 0, [1, 1, 1], Math.PI / 2);
  vb.cylinder([0, -1.1, 0], 0.5, 0.5, 2.0, 8, PAL.gruen3, PAL.gruen5);
  vb.cone([0, 0.9, 0], 0.5, 0.6, 8, PAL.gruen5);
  vb.pop();
  vb.box([-0.52, 0.55, -0.2], [0.52, 1.25, 0.05], PAL.signalGelb);
  const virus = mesh(vb);
  virus.position.set(1.9, 4.3, -6.6);
  const tb = new LowPolyBuilder();
  tb.box([-0.7, 0, -1.2], [0.7, 0.3, 1.2], PAL.anthrazit);
  tb.pushTRS([0, 1.0, 0], 0, [1, 1, 1], Math.PI / 2);
  tb.cylinder([0, -1.4, 0], 0.8, 0.8, 2.8, 8, PAL.ockerHell, PAL.ocker);
  tb.pop();
  tb.box([-0.82, 0.85, -0.6], [0.82, 1.15, -0.4], PAL.anthrazit);
  tb.box([-0.82, 0.85, 0.4], [0.82, 1.15, 0.6], PAL.anthrazit);
  const tank = mesh(tb);
  tank.position.set(1.9, 4.3, -6.6);
  model.group.add(accb, virus, tank);

  return (l: WalrusLoad) => {
    model.parts.recoil.visible = l.weapon === 'avatar';
    launcher.visible = l.weapon === 'harbinger';
    rockets.forEach((r, i) => { r.visible = i < l.ammo; });
    accb.visible = l.cargo === 'accb';
    virus.visible = l.cargo === 'virus';
    tank.visible = l.cargo === 'tank';
  };
}

/**
 * What a Manta carries: up to two Assassins under each wing (the inner
 * pylons) and one item in the middle under the fuselage.
 */
export function buildMantaGear(model: MantaModel): (load: MantaLoad) => void {
  const m = model.parts.missiles;
  const inner = m[0].parent!;
  // pylons: 0/1 outer (unused), 2/3 middle, 4/5 inner; even = port (left), odd = starboard
  const centre = new THREE.Group();
  const q = new LowPolyBuilder();
  q.box([-0.38, -1.6, -1.2], [0.38, -1.05, 2.6], { side: PAL.anthrazit, top: PAL.metall });
  q.pushTRS([0, -1.35, 2.6], 0, [1, 1, 1], Math.PI / 2);
  q.cylinder([0, 0, 0], 0.13, 0.11, 2.2, 6, PAL.metall, PAL.anthrazit);
  q.pop();
  const quasar = mesh(q);
  const k = new LowPolyBuilder();
  k.box([-0.12, -1.3, -0.4], [0.12, -1.05, 0.4], PAL.metall);
  k.pushTRS([0, -1.75, -1.4], 0, [1, 1, 1], Math.PI / 2);
  k.cylinder([0, 0, 0], 0.48, 0.48, 2.4, 8, PAL.signalGelb, PAL.ockerDunkel);
  k.cone([0, 2.4, 0], 0.48, 0.55, 8, PAL.ockerDunkel);
  k.pop();
  for (const [x, y] of [[0.62, 0], [-0.62, 0], [0, 0.62]]) k.box([x - 0.04, -1.75 + y - 0.3, -1.6], [x + 0.04, -1.75 + y + 0.3, -1.0], PAL.anthrazit);
  const quaker = mesh(k);
  const f = new LowPolyBuilder();
  f.box([-0.1, -1.25, -0.5], [0.1, -1.05, 0.5], PAL.metall);
  f.pushTRS([0, -1.6, -1.6], 0, [1, 1, 1], Math.PI / 2);
  f.cylinder([0, 0, 0], 0.4, 0.4, 3.2, 8, PAL.weiss, PAL.weiss);
  f.cone([0, 3.2, 0], 0.4, 0.5, 8, PAL.stahlHell);
  f.pop();
  f.beam([0, -2.0, -0.8], [0, -2.9, -1.3], 0.05, PAL.anthrazit);
  const funk = mesh(f);
  const rack = new THREE.Group();
  for (const x of [-0.5, 0, 0.5]) {
    const r = new THREE.Mesh((m[0] as THREE.Mesh).geometry, mat);
    r.position.set(x, -1.12, -1.4);
    rack.add(r);
  }
  centre.add(quasar, quaker, funk, rack);
  inner.add(centre);

  return (l: MantaLoad) => {
    m[0].visible = m[1].visible = false;
    m[4].visible = l.left >= 1; m[2].visible = l.left >= 2;
    m[5].visible = l.right >= 1; m[3].visible = l.right >= 2;
    // the built-in Quasar shows as its pod while nothing else hangs in the middle
    quasar.visible = !l.centre || l.centre === 'quasar';
    quaker.visible = l.centre === 'quaker';
    funk.visible = l.centre === 'funk';
    rack.visible = l.centre === 'assassin3';
  };
}
