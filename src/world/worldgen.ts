import { mulberry32 } from '../engine/lowpoly';
import { Noise2D, smoothstep } from '../engine/noise';
import type { BiomeId } from './biomes';
import type { IslandOptions } from './island';
import { t } from '../i18n';

// 64 Scottish hills and mountains (none of the many "Ben"/"Beinn"): the player's base,
// the enemy's base and the hub in the middle first, the rest is shuffled per world.
const BASE_NAME = 'Cairn Gorm', ENEMY_BASE_NAME = 'Schiehallion', HUB_NAME = 'Lochnagar';
const ISLAND_NAMES = [
  'Braeriach', 'Cairn Toul', 'Liathach', 'An Teallach', 'Suilven', 'Stac Pollaidh', 'Quinag', 'Arkle', 'Foinaven', 'Slioch',
  'Canisp', 'Cul Mor', 'Goatfell', 'Merrick', 'Tinto', 'Mount Keen', 'Sgurr Alasdair', 'Sgurr nan Gillean', 'Am Basteir', 'Lurg Mhor',
  'Sgurr na Ciche', 'Gairich', 'Stob Dearg', 'Bidean nam Bian', 'Aonach Eagach', 'Aonach Mor', 'Carn Mor Dearg', 'Sgurr Thuilm',
  'Creag Meagaidh', 'Geal Charn', 'Sgurr Fhuaran', 'The Saddle', 'The Cobbler', 'Cir Mhor', 'Caisteal Abhail', 'Driesh', 'Mayar',
  'Broad Cairn', 'Morven', 'Dumyat', "Arthur's Seat", 'Cairnsmore', 'Criffel', 'Hart Fell', 'White Coomb', 'Broad Law', 'West Lomond',
  'Carn Eige', 'Mam Sodhail', 'Moruisg', 'Binnein Mor', 'Corserine', 'Bynack More', 'Derry Cairngorm', 'Tolmount', 'Glas Maol',
  'Stob Ghabhar', 'Sail Mhor', 'Stob Binnein', 'Cruach Ardrain', 'Conival',
];
export type IslandRole = 'basis' | 'rohstoff' | 'fabrik' | 'verteidigung';
export const ROLE_NAMES: Record<IslandRole, string> = { basis: t('role.basis'), rohstoff: t('role.rohstoff'), fabrik: t('role.fabrik'), verteidigung: t('role.verteidigung') };
/** as a compound: "wird Rohstoffinsel" */
export const ROLE_ISLAND: Record<IslandRole, string> = {
  basis: t('roleIsland.basis'), rohstoff: t('roleIsland.rohstoff'), fabrik: t('roleIsland.fabrik'), verteidigung: t('roleIsland.verteidigung'),
};

export interface WorldPlan {
  seed: number;
  /** side length of the square sea in metres (centred on 0, 0) */
  size: number;
  islands: IslandOptions[];
  /** supply network: island index pairs (planar, connected) */
  links: [number, number][];
  /** how much farther apart the islands lie than in a full world of 64 (1 there; distances of the game scale with it) */
  spread: number;
}

/** average distance between island centres in a full world of 64 islands */
export const BASE_SPACING = 6800;
/**
 * A smaller world spreads its islands wider, so fewer islands mean more open sea, not just a smaller map; but only
 * moderately (with the fourth root), so few islands do not end up lost in an empty ocean: 32 islands lie 1.19 times as
 * far apart, 16 1.41 times, 8 1.68 times.
 */
export const spreadFor = (count: number) => Math.pow(64 / Math.max(4, Math.min(64, count)), 0.25);

export interface WorldOptions {
  seed: number;
  count: number;           // number of islands (max 64)
  spacing?: number;        // average distance between island centres
}

/** islands from this size scale up count as "large" (more buildings, as in the original) */
export const LARGE_R = 900;

/**
 * Random archipelago from a seed, following the rules found in the original:
 * - player base Vulcan in the south-west corner, enemy base Nemesis in the
 *   north-east corner, a big hub (Fulcrum) in the middle;
 * - islands as a loose Poisson-disk scatter, with sparse patches of open sea so
 *   that some islands become outposts;
 * - a supply network: relative neighbourhood graph plus some Gabriel edges,
 *   about 1.33 links per island, never more than 6 per island, no crossings;
 * - strategy-game start: the player owns only the base, the enemy owns its base
 *   and the islands nearest to it in the network (defence at the front towards
 *   the player, factories inside, resources in between), the rest is neutral.
 * Biomes are the remake's own addition and follow latitude.
 */
export function generateWorld(o: WorldOptions): WorldPlan {
  const rnd = mulberry32(o.seed * 9301 + 49297);
  const count = Math.max(4, Math.min(64, Math.round(o.count)));
  const spread = o.spacing ? o.spacing / BASE_SPACING : spreadFor(count);
  const spacing = BASE_SPACING * spread;
  const size = Math.sqrt(count) * spacing;
  const half = size / 2, margin = 3000, field = half - margin;
  type Spot = { x: number; z: number; R: number };
  const spots: Spot[] = [];
  // terrain tiles are 2.8 R wide and must never overlap; groups may sit fairly close
  const clearance = (a: Spot, x: number, z: number, R: number) => Math.hypot(a.x - x, a.z - z) - (a.R + R) * 1.45 - 700;
  // ... and the square tiles must not touch either (diagonal neighbours)
  const tilesApart = (a: Spot, x: number, z: number, R: number) => Math.max(Math.abs(a.x - x), Math.abs(a.z - z)) > (a.R + R) * 1.4 + 200;
  const free = (x: number, z: number, R: number) => spots.every(s => clearance(s, x, z, R) > 0 && tilesApart(s, x, z, R));

  // the two bases in opposite corners (both of maximum size), the hub in the middle
  spots.push({ x: -field * 0.92, z: field * 0.92, R: 1200 });
  spots.push({ x: field * 0.92, z: -field * 0.92, R: 1200 });
  if (count >= 6) spots.push({ x: 0, z: 0, R: 1200 });

  // density mask: dense groups and empty stretches of sea
  const density = new Noise2D(o.seed + 17);
  const accept = (x: number, z: number) => {
    const d = 0.5 + 0.5 * density.fbm(x / (size * 0.3), z / (size * 0.3), 3);
    return 0.01 + 0.99 * smoothstep(0.44, 0.6, d);
  };
  // about 2/3 large islands as in the original
  const radius = () => 700 + Math.pow(rnd(), 0.9) * 600;
  // a few far outposts (4 of 64 in the original: Splinter, Bountybar, Medusa, Isolus)
  const outposts = count >= 12 ? Math.round(count / 16) : 0;
  let tries = 0;
  const maxTries = count * 800;
  while (spots.length < count - outposts && tries++ < maxTries) {
    const R = radius();
    const x = (rnd() * 2 - 1) * field, z = (rnd() * 2 - 1) * field;
    if (!free(x, z, R)) continue;
    // the mask relaxes slowly so the requested count is always reached
    if (rnd() > Math.pow(accept(x, z), 1 - tries / maxTries)) continue;
    spots.push({ x, z, R });
  }
  // outposts: the candidate farthest from everything, in the empty sea
  while (spots.length < count) {
    const R = radius();
    let best: Spot | null = null, bestGap = 0;
    for (let k = 0; k < 64; k++) {
      const x = (rnd() * 2 - 1) * field, z = (rnd() * 2 - 1) * field;
      if (!free(x, z, R)) continue;
      const gap = Math.min(...spots.map(s => clearance(s, x, z, R)));
      if (gap > bestGap) { bestGap = gap; best = { x, z, R }; }
    }
    if (!best) break;
    spots.push(best);
  }

  const links = supplyNetwork(spots);
  const n = spots.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of links) { adj[a].push(b); adj[b].push(a); }
  const hopsFromPlayer = hops(adj, 0), hopsFromEnemy = hops(adj, 1);

  // enemy start: its base plus the network-nearest islands (7 of 64 in the original)
  const enemyExtra = Math.max(2, Math.round(n / 8) - 1);
  const dist = (i: number, j: number) => Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z);
  const near = [...Array(n).keys()].filter(i => i > 1)
    .sort((a, b) => hopsFromEnemy[a] - hopsFromEnemy[b] || dist(a, 1) - dist(b, 1))
    .slice(0, enemyExtra);
  // front line first (closest to the player in the network)
  near.sort((a, b) => hopsFromPlayer[a] - hopsFromPlayer[b] || dist(a, 0) - dist(b, 0));
  const nDef = Math.round(near.length * 2 / 7), nFab = Math.round(near.length * 3 / 7);
  const role = new Map<number, IslandRole>([[0, 'basis'], [1, 'basis']]);
  near.forEach((i, k) => role.set(i, k < nDef ? 'verteidigung' : k >= near.length - nFab ? 'fabrik' : 'rohstoff'));

  // names: fixed ones for the two bases and the hub, the rest shuffled
  const pool = [...ISLAND_NAMES];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const nameOf = (i: number) => i === 0 ? BASE_NAME : i === 1 ? ENEMY_BASE_NAME : i === 2 && count >= 6 ? HUB_NAME : pool[(i - 3 + pool.length) % pool.length];

  const islands: IslandOptions[] = spots.map((s, i) => {
    const lat = (s.z + half) / size;              // 0 north .. 1 south
    let biome: BiomeId = pickBiome(lat, rnd);
    if (i === 0) biome = 'grasland';
    if (i === 1 && biome === 'basalt') biome = 'berge';
    const owner: IslandOptions['owner'] = i === 0 ? 'spieler' : role.has(i) ? 'feind' : 'neutral';
    return {
      name: nameOf(i), biome, seed: Math.floor(rnd() * 1e6) + i,
      x: Math.round(s.x), z: Math.round(s.z), R: Math.round(s.R), owner, role: role.get(i) ?? null,
    };
  });
  return { seed: o.seed, size, islands, links, spread };
}

/** breadth-first hop counts from one island (Infinity = not reachable) */
export function hops(adj: number[][], from: number): number[] {
  const h = adj.map(() => Infinity);
  h[from] = 0;
  const queue = [from];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    for (const j of adj[i]) if (h[j] === Infinity) { h[j] = h[i] + 1; queue.push(j); }
  }
  return h;
}

/**
 * Relative neighbourhood graph (connected, contains the minimum spanning tree)
 * plus the shortest extra Gabriel edges up to about 1.33 links per island. Both
 * are subgraphs of the Delaunay triangulation, so no two links cross.
 */
function supplyNetwork(p: { x: number; z: number }[]): [number, number][] {
  const n = p.length;
  const D = (i: number, j: number) => Math.hypot(p[i].x - p[j].x, p[i].z - p[j].z);
  const rng: [number, number][] = [], extra: [number, number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const dij = D(i, j), mx = (p[i].x + p[j].x) / 2, mz = (p[i].z + p[j].z) / 2;
    let isRng = true, isGabriel = true;
    for (let k = 0; k < n && (isRng || isGabriel); k++) {
      if (k === i || k === j) continue;
      if (Math.max(D(i, k), D(j, k)) < dij) isRng = false;
      if (Math.hypot(p[k].x - mx, p[k].z - mz) < dij / 2) isGabriel = false;
    }
    if (isRng) rng.push([i, j]);
    else if (isGabriel) extra.push([i, j, dij]);
  }
  const deg = new Array(n).fill(0);
  const links: [number, number][] = [];
  for (const [i, j] of rng) { links.push([i, j]); deg[i]++; deg[j]++; }
  const target = Math.round(n * 1.33);
  extra.sort((a, b) => a[2] - b[2]);
  for (const [i, j] of extra) {
    if (links.length >= target) break;
    if (deg[i] >= 6 || deg[j] >= 6) continue;
    links.push([i, j]); deg[i]++; deg[j]++;
  }
  return links;
}

function pickBiome(lat: number, rnd: () => number): BiomeId {
  const w: [BiomeId, number][] = [
    ['schnee', Math.max(0, 0.35 - lat) * 9],
    ['berge', 1.1 - Math.abs(lat - 0.35) * 0.8],
    ['grasland', Math.max(0.15, 1.6 - Math.abs(lat - 0.6) * 3)],
    ['schaere', Math.max(0, lat - 0.5) * 5],
    ['basalt', 0.35 + Math.max(0, lat - 0.6) * 1.5],
  ];
  const total = w.reduce((a, [, v]) => a + Math.max(0, v), 0);
  let r = rnd() * total;
  for (const [id, v] of w) { r -= Math.max(0, v); if (r <= 0) return id; }
  return 'grasland';
}
