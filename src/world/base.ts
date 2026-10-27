import * as THREE from 'three';
import { LowPolyBuilder, lowPolyMaterial, mulberry32, type V3 } from '../engine/lowpoly';
import { GlowSet, type GlowPoints } from '../engine/glow';
import { PAL } from '../engine/palette';
import {
  ACCENTS, BUILDERS, BUILDINGS, geschuetzturmBase, geschuetzturmHead, plinth, type BuildCtx, type BuildingType,
} from '../models/buildings';
import type { Combat, Target, Team } from '../game/combat';
import type { Effects } from './effects';
import { SLOPE } from './terrain';
import type { Island } from './island';
import type { IslandRole } from './worldgen';
import { buildAccb } from '../models/accb';
import { enemyTint } from '../models/tint';

export interface PlacedBuilding { type: BuildingType; x: number; y: number; z: number; rot: number; r: number }

type Quota = Partial<Record<BuildingType, number>>;
// Buildings per island role and size, after the original quota table, mapped
// onto the remake's buildings: dome 43 →
// kuppel, turret 44 → geschuetzturm, red 45 + blue 46 bunker → bunker, lattice
// mast 48 → funkmast, water tower 49 → lagerhalle, round hangar 50 → hangar,
// factory 51 → fabrik, tank 52 → tanklager. The runway becomes a landing pad
// (the remake's Skua is a VTOL): on the base, resource islands and large defence
// islands, as the manual says, for refuelling away from the ship.
const BASIS: Quota = { hangar: 1, kuppel: 1, geschuetzturm: 2, bunker: 4, funkmast: 1, landeplatz: 1 };
const QUOTA: Record<IslandRole, { klein: Quota; gross: Quota }> = {
  basis: { klein: BASIS, gross: BASIS },
  rohstoff: {
    klein: { geschuetzturm: 1, bunker: 3, funkmast: 1, tanklager: 1, landeplatz: 1 },
    gross: { geschuetzturm: 2, bunker: 3, funkmast: 1, tanklager: 1, lagerhalle: 1, landeplatz: 1 },
  },
  fabrik: {
    klein: { hangar: 1, geschuetzturm: 1, bunker: 3, fabrik: 1 },
    gross: { hangar: 2, geschuetzturm: 2, bunker: 3, fabrik: 1 },
  },
  verteidigung: {
    klein: { kuppel: 1, geschuetzturm: 3, bunker: 6 },
    gross: { kuppel: 1, geschuetzturm: 6, bunker: 9, landeplatz: 1 },
  },
};
// build order = the original priorities (hangar 7, dome 6, bunker 5/3, turret 4, mast/factory/tank 2, water tower 1)
const ORDER: BuildingType[] = ['hangar', 'kuppel', 'bunker', 'geschuetzturm', 'landeplatz', 'funkmast', 'fabrik', 'tanklager', 'lagerhalle'];
// distance from the command centre per type
const RING: Record<BuildingType, [number, number]> = {
  kommandozentrale: [0, 0], funkmast: [60, 160], hangar: [80, 260], fabrik: [80, 300], tanklager: [70, 260],
  lagerhalle: [70, 300], geschuetzturm: [110, 300], bunker: [90, 320], kuppel: [90, 260], landeplatz: [80, 300],
};
/** defences spread out around the base instead of clustering */
const DEFENCE = new Set<BuildingType>(['geschuetzturm', 'bunker']);

/** the build list of an owned island: command centre first, then the quota in priority order */
export function buildList(role: IslandRole, large: boolean): BuildingType[] {
  const q = QUOTA[role][large ? 'gross' : 'klein'];
  return ['kommandozentrale', ...ORDER.flatMap(t => Array<BuildingType>(q[t] ?? 0).fill(t))];
}

// construction after the original:
// every island gets a turn every 5.15 s; a building advances one step per turn for
// 30 building material, the ACCB's command centre four steps for free; at most two sites
const BUILD_STEPS: Record<BuildingType, number> = {
  kommandozentrale: 61, kuppel: 40, geschuetzturm: 28, bunker: 24, funkmast: 80, lagerhalle: 58, hangar: 52, fabrik: 46, tanklager: 48,
  landeplatz: 40,
};
const ISLAND_TICK = 5.15;
const PARALLEL = 2;
const STEP_MATERIAL = 30;
const REFUND_MATERIAL = 20;      // per dismantling step
const KZ_STEPS = 4;
const START_MATERIAL = 5000;     // when the command centre stands
const REPAIR = 100 / 4000;       // share of the hit points per turn, free

const MAX_RISE = Math.tan(THREE.MathUtils.degToRad(SLOPE.BUILD));
export const TURRET_RANGE = 950;

/** one structure: its own meshes so it can be destroyed on its own */
export class Building implements Target {
  readonly kind = 'gebaeude' as const;
  readonly name: string;
  readonly maxHp: number;
  hp: number;
  /** false once destroyed (the ruin stays) */
  intact = true;
  /** construction 0..1 (the start bases are complete) */
  progress = 1;
  /** being taken down after the command centre fell */
  dismantling = false;
  /** build steps of this type, and how many are done */
  readonly steps: number;
  stepsDone = 0;
  /** wireframe (plus a faint ghost of the body) while under construction, as in the original */
  wire: THREE.Group | null = null;
  readonly group = new THREE.Group();
  head: THREE.Object3D | null = null;  // gun turret
  cooldown = 0;
  burst = 0;
  private worldHits: [number, number, number, number][];

  constructor(readonly base: IslandBase, readonly p: PlacedBuilding, readonly body: THREE.Mesh, readonly lights: THREE.Mesh, readonly glow: GlowPoints) {
    const def = BUILDINGS[p.type];
    this.name = def.name;
    this.steps = BUILD_STEPS[p.type];
    this.stepsDone = this.steps;
    this.maxHp = this.hp = def.hp;
    this.group.add(body, lights, glow);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot), new THREE.Vector3(1, 1, 1));
    this.worldHits = def.hits.map(([x, y, z, r]) => {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(m);
      return [v.x, v.y, v.z, r];
    });
  }

  get team(): Team { return this.base.team; }
  /** standing and finished: can be hit, shoots, shows lights */
  get alive(): boolean { return this.intact && this.progress >= 1; }
  get underConstruction(): boolean { return this.intact && this.progress < 1; }
  shiftHits(dy: number) { for (const h of this.worldHits) h[1] += dy; }
  spheres() { return this.worldHits; }
  centre(out: THREE.Vector3) { return out.set(this.p.x, this.p.y + BUILDINGS[this.p.type].height * 0.4, this.p.z); }

  hit(damage: number): boolean {
    if (!this.alive) return false;
    this.hp -= damage;
    if (this.hp > 0) return false;
    this.hp = 0;
    this.base.destroy(this);
    return true;
  }
}

/**
 * An island base: finds flat sites (≤ SLOPE.BUILD under the whole footprint),
 * sets the buildings on foundations; gun turrets of an enemy base shoot at
 * player units in range. Losing the command centre neutralises the island.
 */
export class IslandBase {
  readonly group = new THREE.Group();
  readonly placed: PlacedBuilding[] = [];
  readonly buildings: Building[] = [];
  /** shared by all lights of this base (night factor goes into its colour) */
  readonly lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  team: Team;
  /** called when a building is finished (new island cameras, messages) */
  onBuilt: ((b: Building) => void) | null = null;
  /** owner-to-be while an ACCB builds the command centre */
  pending: { team: Team; role: IslandRole } | null = null;
  /** connected to its owner's base (deliveries and orders only; building and repairs go on without) */
  linked = true;
  /** building material on the island (30 per build step) */
  material = 0;
  private tickAcc = Math.random() * ISLAND_TICK;
  /** a building was taken down after the command centre fell (its material goes back to the network) */
  onDismantled: ((b: Building, formerTeam: Team) => void) | null = null;
  /** who held the island before its command centre fell */
  formerTeam: Team = 'neutral';
  private rnd: () => number;
  private ruinMat = lowPolyMaterial({ side: THREE.FrontSide });
  private mat = lowPolyMaterial();
  private headGeo = geschuetzturmHead();
  // blueprint look for buildings under construction: bright lines and a faint ghost
  private static wireMat = new THREE.LineBasicMaterial({ color: PAL.lichtBlau });
  private static ghostMat = new THREE.MeshBasicMaterial({ color: PAL.lichtBlau, transparent: true, opacity: 0.16, depthWrite: false });
  private capsule: THREE.Object3D | null = null;
  private combat: Combat | null = null;

  constructor(readonly island: Island, team: Team, private effects: Effects, seed = 5) {
    this.team = team;
    this.rnd = mulberry32(seed);
    this.group.name = `base-${island.name}`;
    if (team === 'neutral') return; // uninhabited, as in the original
    this.plan(island.role ?? 'basis');
    for (const p of this.placed) this.instantiate(p, team, false);
  }

  private instantiate(p: PlacedBuilding, team: Team, underConstruction: boolean): Building {
    const def = BUILDINGS[p.type], accent = ACCENTS[team];
    const body = new LowPolyBuilder(), lightsB = new LowPolyBuilder(), glows = new GlowSet();
    const ctx: BuildCtx = { b: body, lights: lightsB, accent, glow: (q: V3, color: string, size: number) => glows.add(q, color, size) };
    // deep foundation: the base is planned on the coarse grid and re-seated on the fine one later
    plinth(body, def, p.y - this.minHeight(p) + 4.5);
    if (p.type === 'geschuetzturm') geschuetzturmBase(ctx); else BUILDERS[p.type](ctx);
    const mesh = new THREE.Mesh(body.build(), this.mat);
    mesh.castShadow = mesh.receiveShadow = true;
    const lights = new THREE.Mesh(lightsB.build(), this.lightMat);
    const b = new Building(this, p, mesh, lights, glows.build());
    b.group.position.set(p.x, p.y, p.z);
    b.group.rotation.y = p.rot;
    if (p.type === 'geschuetzturm') {
      const head = new THREE.Mesh(this.headGeo, this.mat);
      head.position.set(0, 4.8, 0);
      head.castShadow = true;
      b.group.add(head);
      b.head = head;
      b.cooldown = this.rnd() * 2;
    }
    if (underConstruction) {
      this.makeWire(b);
      b.progress = 0;
      b.stepsDone = 0;
      b.wire!.scale.y = 0.04;
      this.showSolid(b, false);
    }
    this.buildings.push(b);
    this.group.add(b.group);
    return b;
  }

  private makeWire(b: Building) {
    b.wire = new THREE.Group();
    b.wire.add(new THREE.LineSegments(new THREE.EdgesGeometry(b.body.geometry, 25), IslandBase.wireMat),
      new THREE.Mesh(b.body.geometry, IslandBase.ghostMat));
    b.group.add(b.wire);
  }

  private showSolid(b: Building, on: boolean) {
    b.body.visible = b.lights.visible = b.glow.visible = on;
    if (b.head) b.head.visible = on;
  }

  /** a free flat spot for a command centre near (x, z) but not under the Walrus there, or null */
  findSite(x: number, z: number, radius = 220, keepClear = 50): { x: number; z: number } | null {
    const r = BUILDINGS.kommandozentrale.radius, step = 12;
    let best: { x: number; z: number; d: number } | null = null;
    for (let dz = -radius; dz <= radius; dz += step) for (let dx = -radius; dx <= radius; dx += step) {
      const d = Math.hypot(dx, dz);
      if (d > radius || d < keepClear || (best && d >= best.d)) continue;
      const h = this.island.heightAt(x + dx, z + dz);
      if (h < 5 || h > 80 || !this.site(x + dx, z + dz, r)) continue;
      best = { x: x + dx, z: z + dz, d };
    }
    return best;
  }

  /**
   * An ACCB has landed at `at`: clear what is left of a former base and start a
   * new one there. The command centre is built first; when it stands the island
   * belongs to `team`, then the other buildings follow, two at a time.
   */
  found(team: Team, role: IslandRole, at: { x: number; z: number }) {
    for (const b of this.buildings) this.combat?.remove(b);
    this.group.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) { if (o.geometry !== this.headGeo) o.geometry.dispose(); } });
    this.group.clear();
    this.buildings.length = 0;
    this.placed.length = 0;
    this.team = 'neutral';
    this.pending = { team, role };
    this.island.role = role;
    this.plan(role, at);
    for (const p of this.placed) {
      const b = this.instantiate(p, team, true);
      this.combat?.add(b);
    }
    // the capsule stands where the command centre grows
    const kz = this.placed[0];
    this.capsule = buildAccb();
    if (team === 'feind') enemyTint(this.capsule);
    this.capsule.position.set(kz.x + 12, kz.y, kz.z + 12);
    this.group.add(this.capsule);
  }

  /** 0..1 over the whole base, and the command centre on its own */
  get construction(): { total: number; kz: number } | null {
    if (!this.buildings.some(b => b.underConstruction && !b.dismantling)) return null;
    const sum = this.buildings.reduce((a, b) => a + (b.intact && !b.dismantling ? b.stepsDone : b.steps), 0);
    return { total: sum / this.buildings.reduce((a, b) => a + b.steps, 0), kz: this.buildings[0]?.progress ?? 1 };
  }

  /** the island's turn: build, dismantle, repair */
  private islandTick() {
    const kz = this.buildings[0];
    if (kz) {
      if (kz.underConstruction && !kz.dismantling) this.advance(kz, KZ_STEPS);
      else {
        for (const b of this.buildings.filter(x => x.underConstruction && !x.dismantling).slice(0, PARALLEL)) {
          if (this.material < STEP_MATERIAL) break;   // waits for material from the network
          this.material -= STEP_MATERIAL;
          this.advance(b, 1);
        }
      }
    }
    for (const b of this.buildings) {
      if (!b.dismantling) continue;
      b.stepsDone--;
      b.progress = b.stepsDone / b.steps;
      this.material += REFUND_MATERIAL;
      if (b.stepsDone > 0) continue;
      b.dismantling = false;
      b.intact = false;
      b.group.visible = false;
      this.onDismantled?.(b, this.formerTeam);
    }
    if (this.team !== 'neutral') for (const b of this.buildings) if (b.alive && b.hp < b.maxHp) b.hp = Math.min(b.maxHp, b.hp + b.maxHp * REPAIR);
  }

  private advance(b: Building, steps: number) {
    b.stepsDone = Math.min(b.steps, b.stepsDone + steps);
    b.progress = b.stepsDone / b.steps;
    if (b.progress >= 1) this.complete(b);
  }

  private complete(b: Building) {
    if (b.wire) { b.group.remove(b.wire); (b.wire.children[0] as THREE.LineSegments).geometry.dispose(); b.wire = null; }
    this.showSolid(b, true);
    this.effects.flash(new THREE.Vector3(b.p.x, b.p.y + 4, b.p.z), new THREE.Color(PAL.lichtWarm), 14, 0.4);
    if (b === this.buildings[0] && this.pending) {
      // the command centre stands: the island changes hands and gets its first building material
      this.team = this.pending.team;
      this.pending = null;
      this.material = START_MATERIAL;
      if (this.capsule) { this.group.remove(this.capsule); this.capsule = null; }
    }
    this.onBuilt?.(b);
  }

  /** wireframes grow and shrink smoothly between the turns */
  private animateWires(dt: number) {
    for (const b of this.buildings) {
      if (!b.wire) continue;
      const want = Math.max(0.04, b.progress);
      b.wire.scale.y += (want - b.wire.scale.y) * Math.min(1, dt * 1.5);
    }
  }

  /** after the island's fine terrain arrived: move every building onto the exact ground height */
  reseat() {
    for (const b of this.buildings) {
      let hi = -Infinity;
      for (const [x, z] of this.samples(b.p.x, b.p.z, b.p.r)) hi = Math.max(hi, this.island.heightAt(x, z));
      const dy = hi + 0.1 - b.p.y;
      if (Math.abs(dy) < 0.05) continue;
      b.p.y += dy;
      b.group.position.y = b.p.y;
      b.shiftHits(dy);
    }
  }

  /** hide far bases (their turrets keep working) */
  updateVisibility(camX: number, camZ: number, limit: number) {
    this.group.visible = this.island.distanceTo(camX, camZ) < limit;
  }

  register(combat: Combat) {
    this.combat = combat;
    for (const b of this.buildings) combat.add(b);
  }

  /** circles for vehicle collisions and for keeping trees away */
  get obstacles(): { x: number; z: number; r: number }[] {
    return this.placed.map(b => ({ x: b.x, z: b.z, r: b.r }));
  }

  get commandCentre(): Building | undefined {
    return this.buildings.find(b => b.p.type === 'kommandozentrale');
  }

  destroy(b: Building) {
    b.intact = false;
    const def = BUILDINGS[b.p.type];
    for (const c of b.group.children) c.visible = false;
    b.group.add(this.ruin(b));
    const centre = new THREE.Vector3(b.p.x, b.p.y + def.height * 0.3, b.p.z);
    const big = b.p.type === 'tanklager' ? 4 : b.p.type === 'geschuetzturm' || b.p.type === 'funkmast' || b.p.type === 'bunker' ? 2 : 3;
    this.effects.explosion(centre, big, PAL.metall);
    this.effects.burn(new THREE.Vector3(b.p.x, b.p.y + 2, b.p.z), def.radius * 0.35, 40);
    if (b.p.type === 'kommandozentrale') {
      // the island falls; its other buildings are taken down (Operations Guide)
      this.formerTeam = this.team;
      this.team = 'neutral';
      for (const o of this.buildings) if (o !== b && o.intact && !o.dismantling) this.startDismantle(o);
    }
  }

  private startDismantle(b: Building) {
    b.dismantling = true;
    if (!b.wire) this.makeWire(b);
    b.wire!.scale.y = Math.max(0.04, b.progress);
    this.showSolid(b, false);
  }


  /** low-poly rubble on the foundation */
  private ruin(b: Building): THREE.Mesh {
    const def = BUILDINGS[b.p.type];
    const r = def.radius * 0.7, lb = new LowPolyBuilder();
    const cols = [PAL.deckDunkel, PAL.anthrazit, PAL.metall, PAL.fels4, PAL.basalt];
    for (let i = 0; i < 26; i++) {
      const a = this.rnd() * Math.PI * 2, d = Math.sqrt(this.rnd()) * r, s = 1 + this.rnd() * def.height * 0.12;
      lb.pushTRS([Math.cos(a) * d, s * 0.3, Math.sin(a) * d], this.rnd() * 3, [s, s * (0.4 + this.rnd() * 0.6), s * (0.6 + this.rnd())], this.rnd() * 0.6, this.rnd() * 0.6);
      lb.box([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5], cols[i % cols.length]);
      lb.pop();
    }
    const mesh = new THREE.Mesh(lb.build(), this.ruinMat);
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }

  private samples(x: number, z: number, r: number): [number, number][] {
    const pts: [number, number][] = [[x, z]];
    for (const f of [0.5, 1]) for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      pts.push([x + Math.cos(a) * r * f, z + Math.sin(a) * r * f]);
    }
    return pts;
  }

  private minHeight(p: PlacedBuilding): number {
    return Math.min(...this.samples(p.x, p.z, p.r).map(([x, z]) => this.island.heightAt(x, z)));
  }

  /** null if the footprint is not buildable, otherwise the foundation height */
  private site(x: number, z: number, r: number): { top: number; spread: number } | null {
    let lo = Infinity, hi = -Infinity;
    for (const [sx, sz] of this.samples(x, z, r)) {
      const h = this.island.heightAt(sx, sz);
      if (h < 3.5) return null;
      const ny = 1 - this.island.slopeAt(sx, sz);
      if (Math.acos(Math.min(1, ny)) > THREE.MathUtils.degToRad(SLOPE.BUILD)) return null;
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    if (hi - lo > 2 * r * MAX_RISE * 0.8) return null;
    return { top: hi + 0.1, spread: hi - lo };
  }

  /** `only`: plan just these types around the standing command centre (see retrofit) */
  private plan(role: IslandRole, aim?: { x: number; z: number }, only?: BuildingType[]) {
    const T = this.island, grid = 24, half = T.size / 2 - 60, rnd = this.rnd;
    const cand: { x: number; z: number }[] = [];
    for (let z = -half; z <= half; z += grid) for (let x = -half; x <= half; x += grid) {
      const h = T.heightAt(T.cx + x, T.cz + z);
      if (h > 5 && h < 80) cand.push({ x: T.cx + x, z: T.cz + z });
    }
    // aim the command centre at the middle of the buildable land (or where the ACCB landed)
    let ox = 0, oz = 0, n = 0;
    if (!aim) for (const c of cand) if (this.site(c.x, c.z, 14)) { ox += c.x - T.cx; oz += c.z - T.cz; n++; }
    const cx = aim ? aim.x : T.cx + (n ? ox / n : 0), cz = aim ? aim.z : T.cz + (n ? oz / n : 0);

    for (const type of only ?? buildList(role, T.large)) {
      const r = BUILDINGS[type].radius, [min, max] = RING[type];
      const cc = this.placed[0];
      const defence = DEFENCE.has(type) ? this.placed.filter(o => DEFENCE.has(o.type)) : [];
      let best: { x: number; z: number; y: number; score: number } | null = null;
      for (const c of cand) {
        const d = cc ? Math.hypot(c.x - cc.x, c.z - cc.z) : Math.hypot(c.x - cx, c.z - cz);
        if (cc && (d < min || d > max)) continue;
        if (this.placed.some(o => Math.hypot(c.x - o.x, c.z - o.z) < o.r + r + 18)) continue;
        const s = this.site(c.x, c.z, r);
        if (!s) continue;
        let score = cc ? d * 0.4 + rnd() * 70 + s.spread * 6 : d + s.spread * 20;
        if (defence.length) score -= Math.min(260, Math.min(...defence.map(o => Math.hypot(c.x - o.x, c.z - o.z)))) * 0.8;
        if (!best || score < best.score) best = { x: c.x, z: c.z, y: s.top, score };
      }
      if (!best) continue;
      const rot = cc ? Math.atan2(cc.x - best.x, cc.z - best.z) : 0;
      this.placed.push({ type, x: best.x, y: best.y, z: best.z, rot, r });
    }
  }

  /**
   * An own island built before the landing pad existed (an older save) gets its
   * pad now, as a new construction site near the command centre. True if one was added.
   */
  retrofit(): boolean {
    const role = this.island.role;
    if (this.team !== 'spieler' || this.pending || !role || !this.buildings[0]?.alive) return false;
    const want = buildList(role, this.island.large).filter(t => t === 'landeplatz').length;
    const have = this.placed.filter(p => p.type === 'landeplatz').length;
    if (have >= want) return false;
    const before = this.placed.length;
    this.plan(role, undefined, Array<BuildingType>(want - have).fill('landeplatz'));
    for (const p of this.placed.slice(before)) this.combat?.add(this.instantiate(p, this.team, true));
    return this.placed.length > before;
  }

  /** the island's landing pads that stand (where a Skua can set down) */
  get pads(): PlacedBuilding[] {
    return this.team === 'spieler' ? this.buildings.filter(b => b.alive && b.p.type === 'landeplatz').map(b => b.p) : [];
  }

  /** turret heads: track and shoot enemy units of this base's team */
  update(dt: number, combat: Combat) {
    this.tickAcc += dt;
    while (this.tickAcc >= ISLAND_TICK) { this.tickAcc -= ISLAND_TICK; this.islandTick(); }
    this.animateWires(dt);
    if (this.team === 'neutral' || !this.buildings.length) return;
    const centre = new THREE.Vector3(this.island.cx, 0, this.island.cz);
    if (!combat.nearestEnemy(centre, this.team, this.island.size / 2 + TURRET_RANGE + 200, 'einheit')) return;
    const tmp = new THREE.Vector3(), vel = new THREE.Vector3(), muzzle = new THREE.Vector3();
    for (const b of this.buildings) {
      if (!b.head || !b.alive) continue;
      const pos = new THREE.Vector3(b.p.x, b.p.y + 6.4, b.p.z);
      const enemy = combat.nearestEnemy(pos, this.team, TURRET_RANGE, 'einheit');
      let wantYaw: number;
      let aim: THREE.Vector3 | null = null;
      if (enemy) {
        // lead the target: where will it be when the shell arrives?
        enemy.centre(tmp);
        const dist = tmp.distanceTo(pos);
        if (enemy.velocity) tmp.addScaledVector(enemy.velocity(vel), dist / 380);
        aim = tmp.clone();
        wantYaw = Math.atan2(aim.x - pos.x, aim.z - pos.z) - b.p.rot;
      } else wantYaw = b.head.rotation.y + dt * 0.25;
      let d = wantYaw - b.head.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      b.head.rotation.y += THREE.MathUtils.clamp(d, -dt * 1.1, dt * 1.1);

      b.cooldown -= dt;
      if (aim && Math.abs(d) < 0.08 && b.cooldown <= 0) {
        b.burst = b.burst > 0 ? b.burst - 1 : 2;
        b.cooldown = b.burst > 0 ? 0.18 : 1.7;
        const dir = aim.clone().sub(pos).normalize();
        // a little spread so the player can dodge at range
        dir.x += (this.rnd() - 0.5) * 0.03; dir.y += (this.rnd() - 0.5) * 0.02; dir.z += (this.rnd() - 0.5) * 0.03;
        muzzle.copy(pos).addScaledVector(dir, 7);
        combat.fire({ kind: 'kanone', team: this.team, from: muzzle, dir });
      }
    }
  }

  // ---- save game ----
  saveState() {
    return {
      team: this.team, role: this.island.role, pending: this.pending ? { ...this.pending } : null, material: this.material,
      formerTeam: this.formerTeam, tickAcc: this.tickAcc, placed: this.placed.map(p => ({ ...p })),
      // a dismantled building is gone, a destroyed one leaves its ruin
      buildings: this.buildings.map(b => ({ intact: b.intact, gone: !b.intact && !b.group.visible, stepsDone: b.stepsDone, hp: b.hp, dismantling: b.dismantling })),
    };
  }

  loadState(s: ReturnType<IslandBase['saveState']>) {
    this.material = s.material; this.formerTeam = s.formerTeam; this.tickAcc = s.tickAcc;
    const untouched = !s.pending && s.team === this.team && s.placed.length === this.placed.length &&
      s.placed.every((p, i) => p.type === this.placed[i].type && Math.abs(p.x - this.placed[i].x) < 0.5 && Math.abs(p.z - this.placed[i].z) < 0.5) &&
      s.buildings.every((b, i) => b.intact && !b.dismantling && b.stepsDone >= this.buildings[i].steps);
    if (untouched) { s.buildings.forEach((b, i) => { this.buildings[i].hp = b.hp; }); return; }
    // rebuild the base as it was saved
    for (const b of this.buildings) this.combat?.remove(b);
    this.group.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) { if (o.geometry !== this.headGeo) o.geometry.dispose(); } });
    this.group.clear();
    this.buildings.length = 0;
    this.placed.length = 0;
    this.capsule = null;
    this.team = s.team;
    this.island.role = s.role;
    this.pending = s.pending ? { ...s.pending } : null;
    const accent: Team = s.pending?.team ?? (s.team !== 'neutral' ? s.team : s.formerTeam);
    s.placed.forEach((p, i) => {
      this.placed.push({ ...p });
      const st = s.buildings[i], b = this.instantiate(this.placed[i], accent, false);
      b.hp = st.hp;
      b.stepsDone = st.stepsDone;
      b.progress = st.stepsDone / b.steps;
      if (!st.intact) {
        b.intact = false;
        if (st.gone) b.group.visible = false;
        else { for (const c of b.group.children) c.visible = false; b.group.add(this.ruin(b)); }
      } else if (st.dismantling) this.startDismantle(b);
      else if (b.progress < 1) {
        this.makeWire(b);
        b.wire!.scale.y = Math.max(0.04, b.progress);
        this.showSolid(b, false);
      }
      this.combat?.add(b);
    });
    if (this.pending && this.placed.length) {
      const kz = this.placed[0];
      this.capsule = buildAccb();
      if (this.pending.team === 'feind') enemyTint(this.capsule);
      this.capsule.position.set(kz.x + 12, kz.y, kz.z + 12);
      this.group.add(this.capsule);
    }
  }
}
