import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { lowPolyMaterial } from '../engine/lowpoly';
import { GlowPoints, GlowSet } from '../engine/glow';
import { PAL, type PalName } from '../engine/palette';

/**
 * The models built in Blender (art/<model>/*.glb, see art/README.md). They load once, before the game
 * builds its scene (this module awaits them at the top level), and every use takes its own copy that
 * shares the geometry. A copy is dressed like the code-built models: the game's flat vertex-colour
 * material, unlit lamps, decals with a depth offset, glow points from the empties. When a file is
 * missing, the game keeps the code-built model.
 */
const FILES = {
  otter: new URL('../../art/otter/otter.glb', import.meta.url).href,
  otterFeind: new URL('../../art/otter/otter_feind.glb', import.meta.url).href,
  skua: new URL('../../art/skua/skua.glb', import.meta.url).href,
  skuaFeind: new URL('../../art/skua/skua_feind.glb', import.meta.url).href,
  stoorworm: new URL('../../art/stoorworm/stoorworm.glb', import.meta.url).href,
};
type Key = keyof typeof FILES;

async function load(): Promise<Partial<Record<Key, THREE.Group>>> {
  const loader = new GLTFLoader();
  const out: Partial<Record<Key, THREE.Group>> = {};
  await Promise.all((Object.keys(FILES) as Key[]).map(async k => {
    try { out[k] = (await loader.loadAsync(FILES[k])).scene; }
    catch (e) { console.warn(`Modell ${k} nicht geladen, das im Code gebaute bleibt`, e); }
  }));
  return out;
}
// `?modelle=code` keeps the code-built models (to compare looks and frame rates)
const SCENES = new URLSearchParams(location.search).get('modelle') === 'code' ? {} : await load();

/**
 * The player's geometry → the same part in the enemy's colours (built with `--feind`). enemyTint swaps
 * these in, since its exact colour swap can't find the palette in shaded, dirtied and baked colours.
 */
export const ENEMY_GEOMETRY = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
function pairEnemy(own?: THREE.Group, foe?: THREE.Group) {
  if (!own || !foe) return;
  const theirs = new Map<string, THREE.BufferGeometry>();
  foe.traverse(o => { if ((o as THREE.Mesh).isMesh) theirs.set(o.name, (o as THREE.Mesh).geometry); });
  own.traverse(o => {
    const g = theirs.get(o.name);
    if ((o as THREE.Mesh).isMesh && g) ENEMY_GEOMETRY.set((o as THREE.Mesh).geometry, g);
  });
}
pairEnemy(SCENES.otter, SCENES.otterFeind);
pairEnemy(SCENES.skua, SCENES.skuaFeind);

// shared by every copy: night lights scale the lamps' colour the same for all models
const MAT = {
  body: lowPolyMaterial(),
  decals: lowPolyMaterial({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  // both sides: lamp panels are single faces whose winding Blender may turn
  lights: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
};

export interface GlbModel {
  root: THREE.Group;
  /** the main lamp mesh (all lamp meshes share its material) */
  lights: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** glow points; those on moving parts are linked to it */
  glow: GlowPoints;
  /** engine flames (empties marked `exhaust`), if the model has any */
  exhaust: GlowPoints | null;
}

/** a dressed copy of a model, or null when its file did not load */
export function glbModel(key: 'otter' | 'skua' | 'stoorworm'): GlbModel | null {
  const src = SCENES[key];
  if (!src) return null;
  const root = src.clone(true);
  const glows = new Map<THREE.Object3D, GlowSet>(), exhaust = new Map<THREE.Object3D, GlowSet>();
  const empties: THREE.Object3D[] = [];
  let lights: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const lamp = o.name.startsWith('lights'), decal = o.name.startsWith('decals');
      m.material = lamp ? MAT.lights : decal ? MAT.decals : MAT.body;
      m.castShadow = !lamp && !decal;
      m.receiveShadow = !lamp;
      if (o.name === 'lights') lights = m as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    } else if (o.userData.glow && o.parent) {
      const sets = o.userData.exhaust ? exhaust : glows;
      if (!sets.has(o.parent)) sets.set(o.parent, new GlowSet());
      sets.get(o.parent)!.add([o.position.x, o.position.y, o.position.z], PAL[o.userData.glow as PalName], o.userData.size);
      empties.push(o);
    }
  });
  for (const e of empties) e.removeFromParent();
  return {
    root,
    lights: lights ?? new THREE.Mesh(new THREE.BufferGeometry(), MAT.lights),
    glow: gather(glows),
    exhaust: exhaust.size ? gather(exhaust) : null,
  };
}

/** one GlowPoints per parent, so the halos move with turrets and the like; the first one updates the rest */
function gather(sets: Map<THREE.Object3D, GlowSet>): GlowPoints {
  let main: GlowPoints | null = null;
  for (const [parent, set] of sets) {
    const g = set.build();
    parent.add(g);
    if (main) main.linked.push(g); else main = g;
  }
  return main ?? new GlowSet().build();
}

/** a camera the model marks with an empty (custom properties `eye` and `look`, carrier coordinates) */
export function glbCamera(key: 'stoorworm', name: string): { eye: [number, number, number]; look: [number, number, number] } | null {
  const o = SCENES[key]?.getObjectByName(name);
  return o?.userData.eye && o.userData.look ? { eye: o.userData.eye, look: o.userData.look } : null;
}

/** triangles of a model, for the performance display */
export function triangleCount(root: THREE.Object3D): number {
  let n = 0;
  root.traverse(o => {
    const g = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh).geometry : null;
    if (g) n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return n;
}
