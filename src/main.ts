import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { Post } from './engine/post';
import { GLOW_VIEW, type GlowPoints } from './engine/glow';
import { Environment, WEATHER_LABELS, weatherAt, weatherName, type WeatherName } from './world/environment';
import { Sky } from './world/sky';
import { SHADOW_LAYER, SLOPE } from './world/terrain';
import { Archipelago } from './world/archipelago';
import { generateWorld, ROLE_ISLAND, ROLE_NAMES, type IslandRole } from './world/worldgen';
import type { Island } from './world/island';
import { Ocean, waveHeight, type SeaStyle } from './world/ocean';
import { Effects } from './world/effects';
import { Vegetation } from './world/vegetation';
import { Clouds } from './world/clouds';
import { Rain } from './world/rain';
import { Wake } from './world/wake';
import { BowCurl, Spray, type Bow } from './world/spray';
import { WakeField } from './world/wakefield';
import { IslandBase } from './world/base';
import { PAL } from './engine/palette';
import { buildCarrier, shipCameras, shipShape } from './models/carrier';
import { buildWalrus, CLEAT_PITCH } from './models/walrus';
import { buildManta, MANTA_GEAR } from './models/manta';
import { buildDrone, DRONE_GIMBAL } from './models/drone';
import { buildMantaGear, buildWalrusGear } from './models/loadout';
import { moveDepot, SupplyScreen } from './ui/supply';
import { buildTransferDrone } from './models/transferDrone';
import { Economy } from './game/economy';
import { TRANSFER_RANGE, TransferDrone } from './game/transfer';
import { CarrierController, SINK_TIME, THROTTLE } from './game/carrierController';
import { TUNING, type Difficulty } from './game/difficulty';
import { PATCH, repairHull } from './game/hullRepair';
import { PointDefence, TURRET } from './game/pointDefence';
import { DecoyLauncher } from './game/decoys';
import { DefenceDrones, ShieldDrone } from './game/defenceDrones';
import { BATTERY, Hammerheads, ObservationDrone } from './game/hammerhead';
import { HAMMERHEAD } from './game/arsenal';
import { ShipTop } from './game/shipTop';
import { Wrecks } from './world/wrecks';
import { CRUISE_STEPS, Walrus, type Obstacle } from './game/walrus';
import { LIFT_SPEED, Manta, MANTA_KEYBOARD, MANTA_KEYS, MIN_SPEED, type Pad } from './game/manta';
import { PAD_TOP } from './models/buildings';
import { Drone, DRONE_PACES, DRONE_RANGE } from './game/drone';
import { UnitPilots } from './game/autopilot';
import { OtterRoutes } from './game/otterRoute';
import { Survey } from './world/survey';
import { WeatherSchedule } from './world/weatherSchedule';
import { linkDistance, setRelays, SIGNAL_LOST, type Side } from './game/telemetry';
import { Input, KEYS, type InputLike } from './game/input';
import { PointerControl } from './game/pointer';
import { Combat, shotReach, shotSpeed, type Target } from './game/combat';
import { MapView, OWNER_NAMES, type EnemyView, type IslandAlarm, type MapActions, type MapCommand } from './ui/map';
import { CameraSystem, type CamGroup } from './game/cameras';
import { SoundEngine, type SoundLevels, type SoundScene } from './audio/sound';
import { Finale } from './ui/finale';
import { ShipVoice, type VoiceLine } from './audio/voice';
import { TitleMusic } from './audio/music';
import { bearing, helpLine, indexOf, kindOf, unitIdOf, unitName, weatherIcon, windShort, type Fleet, type PadHelp, type UnitId, type Units, type Vehicle } from './ui/hud';
import { padGlyphs } from './ui/glyphs';
import { FleetStatus, POINTS } from './ui/fleetStatus';
import { Deck } from './ui/deck';
import { HelmBar } from './ui/helm';
import { CamBar } from './ui/camBar';
import { Strikes } from './game/strikes';
import { uiScale, updateUiScale } from './ui/scale';
import { MonitorWall, type MonitorButton, type MonitorGroup, type MonitorState } from './ui/monitors';
import { HARBINGER_LOAD, otterCargoName, OTTER_CARGO, otterFit, refit, REPAIR_PER_SECOND, SKUA_CARGO, skuaCargoGoods, skuaCargoName, skuaCargoOf, skuaFit, walrusGoods } from './game/arsenal';
import { GOODS, type Good } from './game/stores';
import { Menu, type SettingItem, type SettingTab } from './ui/menu';
import { Intro } from './ui/intro';
import { Tutorial } from './ui/tutorial';
import { Training, type Shot } from './ui/training';
import { findRange, TrainingRange } from './game/trainingRange';
import { requestBoot, SAVE_VERSION, takeBoot, writeSave, type SaveGame } from './game/savegame';
import { SHIP_NAME, GAME_TITLE, START_DATE, ENEMY_SHIP_NAME } from './game/names';
import { EnemyCarrier } from './game/enemyCarrier';
import { combatProbe } from './game/probe';
import { Omega, type OmegaEvent } from './game/omega';
import { enemyTint } from './models/tint';
import { Contact, SIGHT, type Eye } from './game/sighting';
import { t, km, num, pct, lang, locale, setLang } from './i18n';

const t0 = performance.now();

// ---------- renderer, scene, camera ----------
const container = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
container.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xffffff, 1500, 10000);
const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 16000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 8;
controls.maxDistance = 9000;
controls.enabled = false;

const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera;
sc.left = -1300; sc.right = 1300; sc.top = 1300; sc.bottom = -1300; sc.near = 100; sc.far = 8000;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.8;
sun.shadow.camera.layers.enable(SHADOW_LAYER);
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
scene.add(hemi);

// ---------- world ----------
const env = new Environment();
const sky = new Sky();
// the world comes from a seed: ?seed=1234&inseln=32 in the address bar
const query = new URLSearchParams(location.search);
/** the combat test range (`?probe=kampf`, or Einstellungen → Entwickler) */
const PROBE = query.get('probe') === 'kampf';
const worldSeed = Number(query.get('seed') ?? 1988) || 1988;
const worldCount = THREE.MathUtils.clamp(Number(query.get('inseln') ?? 64) || 64, 4, 64);
const world = new Archipelago(generateWorld({ seed: worldSeed, count: worldCount }));
const ocean = new Ocean(world);
const effects = new Effects(world);
const combat = new Combat(world, effects, (x, z) => waveHeight(x, z, env.elapsed, env.w.waves));
// sound: synthesised, heard through the microphone of the active camera
const sound = new SoundEngine();
const music = new TitleMusic(sound);
const voice = new ShipVoice(sound);
// the music on a long voyage: it comes in quietly, once, when the Stoorworm has made way on the open sea a while
// (at half ahead or more, far from land, nothing of the enemy in sight, no fight near), then rests a while
// (`land`, how far from every island counts as open sea, is set with the world below: a share of the islands' spacing)
const VOYAGE = { speed: 12, after: 45, land: 1000, fight: 6000, calmAfterFight: 90, rest: 600, level: 0.55, duck: 0.6 };
/** the title's music: the storm's sea, wind and rain give way to it, down to a sixth (a storm is about 6 dB louder than the music, its quiet opening 13 dB) */
const TITLE_MUSIC = { duck: 0.83 };
const voyage = { on: false, calm: 0, check: 0, lastFight: -Infinity, rested: -Infinity };
/** the victory's film over the sinking Nuckelavee; the music sets in with its big word */
const finale = new Finale();
finale.onWord = (won) => { if (won && !music.busy) void music.play(); };
effects.listener = sound;
// the glowing shots fade with the fog, seen from the camera in use
combat.viewer = { camera, fog: null };
/** when each laser turret last fired (real seconds): shots close together are a burst */
const turretShotAt = new Map<object, number>();
combat.onFire = (o) => {
  // (the guns of the player's islands fire by themselves: only the units' shots count)
  if (o.team === 'spieler' && o.kind !== 'kanone') stats.shots++;
  // the unit in hand fired: a short kick in the pad
  if (o.team === 'spieler' && active === 'walrus' && o.from.distanceTo(walrus.pos) < 20) input.rumble(0.15, 0.35, 45);
  else if (o.team === 'spieler' && active === 'manta' && o.from.distanceTo(manta.pos) < 20) input.rumble(o.kind === 'rakete' ? 0.35 : 0, 0.25, o.kind === 'rakete' ? 120 : 30);
  // a shot of one of the player's units, or any near the Stoorworm, is a fight (no voyage music)
  if (o.team === 'spieler' ? o.kind !== 'kanone' : Math.hypot(o.from.x - carrier.pos.x, o.from.z - carrier.pos.z) < VOYAGE.fight) voyage.lastFight = playStats.time;
  // a laser turret's shot has a sound of its own, quieter within a burst
  if (o.source instanceof PointDefence) {
    const now = performance.now() / 1000, rapid = now - (turretShotAt.get(o.source) ?? -9) < 0.4;
    turretShotAt.set(o.source, now);
    sound.turretShot(o.from, rapid);
  } else if (o.kind === 'laser' || o.kind === 'kanone' || o.kind === 'rakete') sound.shot(o.kind, o.from, o.team === 'spieler', o.heavy);
  else if (o.kind === 'harbinger') sound.shot('rakete', o.from, true, true);
  else if (o.kind === 'hammerhead') sound.hammerhead(o.from);
  else sound.clunk(o.from);
};
const bases = world.islands.map((isl, i) => new IslandBase(isl, isl.owner, effects, 5 + i * 11));
bases.forEach(b => b.register(combat));
// vegetation only exists while an island is detailed (streamed in and out)
const vegetation = new Map<Island, Vegetation>();
/** spots the trees keep clear of besides the bases' buildings (the combat training's tanks) */
const clearings: Obstacle[] = [];
function dropVegetation(isl: Island) {
  const v = vegetation.get(isl);
  if (v) { scene.remove(v.group); v.group.traverse(o => (o as THREE.Mesh).geometry?.dispose()); vegetation.delete(isl); }
}
function plantVegetation(isl: Island) {
  const i = world.islands.indexOf(isl);
  const v = new Vegetation(isl, 3 + i * 13, [...bases[i].obstacles, ...clearings]);
  vegetation.set(isl, v);
  scene.add(v.group);
}
world.onDetail = (isl, ready) => {
  if (ready) { bases[world.islands.indexOf(isl)].reseat(); plantVegetation(isl); } else dropVegetation(isl);
};
const clouds = new Clouds();
const rain = new Rain();
const carrierWake = new Wake({ width0: 22, width1: 80, life: 75, spacing: 9 });
/** the carrier's vehicle bays: 4 Walrus and 4 Manta as in the original (spares wait in the hold) */
const FLEET = 4;
const walrusWakes = Array.from({ length: FLEET }, () => new Wake({ width0: 3, width1: 13, life: 20, spacing: 2.5, maxPoints: 90 }));
// wakes are rendered into a foam texture that the ocean shader reads
const wakeField = new WakeField();
wakeField.add(carrierWake);
walrusWakes.forEach(w => wakeField.add(w));
const enemyWake = new Wake({ width0: 22, width1: 80, life: 75, spacing: 9 });
wakeField.add(enemyWake);
// short white bow splash along the Otter's hull (the carriers have the foam ring and the bow wave sheets instead)
const walrusBows = walrusWakes.map(() => wakeField.addBowWaves(4, 8.5, 12));
/** the enemy's carrier holds 2 Otters and 2 Skuas */
const FOE_FLEET = 3;
const foeWakes = Array.from({ length: FOE_FLEET }, () => new Wake({ width0: 3, width1: 13, life: 20, spacing: 2.5, maxPoints: 90 }));
foeWakes.forEach(w => wakeField.add(w));
const foeBows = foeWakes.map(() => wakeField.addBowWaves(4, 8.5, 12));
// the foam round each hull in the water, the bow wave sheets and the bow spray (Wind Waker)
const OTTER_LINE: [number, number][] = [[0, -8.5], [3.6, -8.5], [4.3, -7.5], [4.3, 4.5], [3, 7.6], [0, 8.6], [-3, 7.6], [-4.3, 4.5], [-4.3, -7.5], [-3.6, -8.5]];
const otterWidth = (z: number) => (z > 4.5 ? 4.3 - (z - 4.5) * 0.3 : 4.3);
/** the Stoorworm's look (Einstellungen → Grafik): the steel tower or the spear; read once at start */
const myShape = shipShape('spieler'), foeShape = shipShape('feind');
const carrierRing = wakeField.addRing(myShape.waterline(), 9), enemyRing = wakeField.addRing(foeShape.waterline(), 9);
const otterRings = new Map<Walrus, ReturnType<WakeField['addRing']>>();
const carrierCurl = new BowCurl(myShape.widthAbove, myShape.stemZ, 75, 7), enemyCurl = new BowCurl(foeShape.widthAbove, foeShape.stemZ, 75, 7);
const otterCurls = new Map<Walrus, BowCurl>();
const spray = new Spray();
const CARRIER_BOW: Bow = { stemZ: myShape.stemZ - 1, halfBeam: 14, scale: 2.2 }, FOE_BOW: Bow = { stemZ: foeShape.stemZ - 1, halfBeam: 14, scale: 2.2 };
const OTTER_BOW: Bow = { stemZ: 8, halfBeam: 4, scale: 0.6 };
ocean.setWake(wakeField.target.texture, wakeField.rect);
const carrierModel = buildCarrier('spieler');
const enemyModel = buildCarrier('feind');
const walrusModels = Array.from({ length: FLEET }, () => buildWalrus());
const mantaModels = Array.from({ length: FLEET }, () => buildManta());
const droneModel = buildDrone();
const foeOtterModels = Array.from({ length: FOE_FLEET }, () => buildWalrus());
const foeSkuaModels = Array.from({ length: FOE_FLEET }, () => buildManta());
scene.add(spray.mesh, carrierCurl.mesh, enemyCurl.mesh);
scene.add(sky.mesh, world.group, ocean.mesh, effects.group, combat.group, clouds.mesh, rain.mesh,
  carrierModel.group, enemyModel.group, ...foeOtterModels.map(m => m.group), ...foeSkuaModels.map(m => m.group), ...walrusModels.map(m => m.group), ...mantaModels.map(m => m.group), droneModel.group, ...bases.map(b => b.group));

const post = new Post(renderer, scene, camera);

// ---------- units ----------
const input = new Input();
// a pad plugged in: its name without the vendor details the browser adds
input.onConnect = (name, standard) => notify(standard ? t('pad.connected', { name: name.replace(/\s*\(.*\)\s*$/, '') }) : t('pad.nonStandard'), standard ? 'good' : 'bad');
// trackpad / mouse: a click into the picture captures the pointer while a game runs and nothing covers the picture
const pointer = new PointerControl(renderer.domElement, () => started && !menu.open && !map.open && !supply.open);
/** keyboard only and without presses: sub-steps while a window keeps the pad out of the game */
const keysHeldOnly: InputLike = { down: (...c) => input.keysOnly.down(...c), hit: () => false, axis: (n, p) => input.keysOnly.axis(n, p) };
/** nothing pressed (while the victory's film runs) */
const NO_INPUT: InputLike = { down: () => false, hit: () => false, axis: () => 0 };
// start off the south coast of the home island (Vulcan), half speed eastwards
const home = world.islands[0];
const carrier = new CarrierController(carrierModel, world, env, {
  x: home.cx - 400, z: home.cz + home.size * 0.5 + 700, heading: Math.PI / 2, throttle: 3,
});
// shared with the Walrus; rebuilt when an island gets a new base
const obstacles = bases.flatMap(b => b.obstacles);
const walruses: Walrus[] = [];
walrusModels.forEach((m, i) => walruses.push(new Walrus(m, world, env, carrier, obstacles, i, walruses)));
carrier.obstacles = obstacles;
// a carrier tank lasts as many island distances as in the original (419 km / 107 km ≈ 3.9); open sea for the voyage
// music begins at 22 % of that distance from every island (about 1 km among 64 islands, where 6 of 10 sea points are
// that far out, but only 15 % beyond the 2.5 km it used to need)
{
  const nn = world.islands.map((a, i) => Math.min(...world.islands.filter((_, j) => j !== i).map(b => Math.hypot(a.cx - b.cx, a.cz - b.cz)))).sort((a, b) => a - b);
  const gap = nn[Math.floor(nn.length / 2)];
  carrier.fuelRange = Math.round(419 / 107 * gap);
  VOYAGE.land = Math.round(gap * 0.22);
}
// ---------- the enemy's carrier: lies off its base at the start ----------
const enemyShip = new CarrierController(enemyModel, world, env, { x: 0, z: 0, heading: 0, throttle: 1 }, { team: 'feind', name: ENEMY_SHIP_NAME });
enemyShip.obstacles = obstacles;
enemyShip.fuelRange = carrier.fuelRange;
const enemy = new EnemyCarrier(enemyShip, world, bases, worldSeed * 7 + 3);
enemy.placeAtHome();
/** what the player knows of it */
const enemyContact = new Contact();
const mantas: Manta[] = [];
mantaModels.forEach((m, i) => mantas.push(new Manta(m, world, env, carrier, i, mantas)));
/** the Walrus and the Manta the player drives (and the HUD, the cameras and the map's monitor show) */
let walrus = walruses[0], manta = mantas[0];
const drone = new Drone(droneModel, world, env, carrier);
const units: Units = { carrier, walrus, manta, drohne: drone };
const fleet: Fleet = { carrier, walruses, mantas, drone };
combat.add(carrier); combat.add(drone); combat.add(enemyShip);
// ---------- the laser turrets: they fight on their own; the Stoorworm's can be taken over through its turret camera ----------
const defence = new PointDefence(carrier, carrierModel.turret, carrierModel.barrel, 'spieler', [carrier, enemyShip]);
const foeDefence = new PointDefence(enemyShip, enemyModel.turret, enemyModel.barrel, 'feind', [carrier, enemyShip]);
// ---------- decoy flares: they launch on their own when an Assassin comes at a ship; the player's also with K ----------
const decoys = new DecoyLauncher(carrier, 'spieler'), foeDecoys = new DecoyLauncher(enemyShip, 'feind');
// ---------- defence drones: balloons in formation round the ship (the player's with L, the enemy's when danger comes) ----------
const shieldGroup = new THREE.Group();
shieldGroup.name = 'defence-drones';
scene.add(shieldGroup);
const shields = new DefenceDrones(carrier, 'spieler', combat, effects, shieldGroup, [carrier, enemyShip]);
const foeShields = new DefenceDrones(enemyShip, 'feind', combat, effects, shieldGroup, [carrier, enemyShip]);
foeShields.auto = true;
/** the turret heads of islands not of `team` within `range` of a point (what its drones stand in front of) */
const gunsAgainst = (team: 'spieler' | 'feind') => (at: THREE.Vector3, range: number) => bases
  .filter(b => b.team !== team && b.team !== 'neutral')
  .flatMap(b => b.buildings.filter(bd => bd.head && bd.alive && Math.hypot(bd.p.x - at.x, bd.p.z - at.z) < range))
  .map(bd => new THREE.Vector3(bd.p.x, bd.p.y + 6.4, bd.p.z));
shields.guns = gunsAgainst('spieler');
foeShields.guns = gunsAgainst('feind');
// ---------- Hammerheads and their observation drones: the player aims through the drone's camera; the enemy fires
// at the Stoorworm by itself when it is near and in sight (not while the guided first game holds it) ----------
const hammer = new Hammerheads(carrier, 'spieler', combat, effects, shieldGroup);
const foeHammer = new Hammerheads(enemyShip, 'feind', combat, effects, shieldGroup);
foeHammer.auto = true;
foeHammer.prey = () => carrier.alive && enemyShip.alive && !omega.holding && enemyShip.pos.distanceTo(carrier.pos) < BATTERY.foeRange
  && foeEyesNow.some(e => Math.hypot(e.x - carrier.pos.x, e.z - carrier.pos.z) <= e.range) ? carrier : null;
// ---------- the enemy's vehicles: the player's models in violet, on the radio link of their own ship ----------
const foeSide = (name: string): Side => ({ team: 'feind', name, link: (x, z) => Math.hypot(x - enemyShip.pos.x, z - enemyShip.pos.z) });
const foeOtters: Walrus[] = [];
foeOtterModels.forEach((m, i) => foeOtters.push(new Walrus(m, world, env, enemyShip, obstacles, i, foeOtters, foeSide(t('foe.otter', { n: i + 1 })))));
const foeSkuas: Manta[] = [];
foeSkuaModels.forEach((m, i) => foeSkuas.push(new Manta(m, world, env, enemyShip, i, foeSkuas, foeSide(t('foe.skua', { n: i + 1 })))));
for (const w of foeOtters) { combat.add(w); w.onSelfDestruct = (at) => effects.explosion(at, 1.4, PAL.feind); }
for (const m of foeSkuas) { combat.add(m); m.onCrash = (at) => effects.explosion(at, 1.2, PAL.feindHell); }
for (const w of [...walruses, ...foeOtters]) {
  otterRings.set(w, wakeField.addRing(OTTER_LINE, 1.3));
  const curl = new BowCurl(otterWidth, 8.6, 9, 1.4);
  otterCurls.set(w, curl);
  scene.add(curl.mesh);
}
/** what hangs on each vehicle, shown on its model */
const gearOf = new Map<Walrus | Manta, (load: never) => void>();
// weapons and cargo show on the models
walruses.forEach(w => gearOf.set(w, buildWalrusGear(w.model) as (load: never) => void));
mantas.forEach(m => gearOf.set(m, buildMantaGear(m.model) as (load: never) => void));
foeOtters.forEach(w => gearOf.set(w, buildWalrusGear(w.model) as (load: never) => void));
foeSkuas.forEach(m => gearOf.set(m, buildMantaGear(m.model) as (load: never) => void));
// the enemy's vehicles (with what they carry) in the enemy's colours
for (const v of [...foeOtters, ...foeSkuas]) enemyTint(v.model.group);
const showGear = (v: Walrus | Manta) => gearOf.get(v)!(v.load as never);
for (const w of walruses) { combat.add(w); w.onSelfDestruct = (at) => effects.explosion(at, 1.4, PAL.ocker); }
for (const m of mantas) { combat.add(m); m.onCrash = (at) => effects.explosion(at, 1.2, PAL.weiss); }
// lost vehicles leave a burning wreck (a Skua falls out of the sky, an Otter sinks or burns out on land)
const wrecks = new Wrecks(world, effects);
scene.add(wrecks.group);
for (const w of walruses) w.onWreck = (m, v) => wrecks.add(m, v, 10, PAL.ocker);
for (const m of mantas) m.onWreck = (g, v) => wrecks.add(g, v, 12, PAL.weiss);
for (const w of foeOtters) w.onWreck = (m, v) => wrecks.add(m, v, 10, PAL.feind);
for (const m of foeSkuas) m.onWreck = (g, v) => wrecks.add(g, v, 12, PAL.feindHell);
drone.onCrash = (at) => effects.explosion(at, 0.5, PAL.ocker);
// the ships' tops (deck, bridge, masts): a Skua that flies into one crashes
// (in the ship's own coordinates: its model rides with the deck about 20 m over the sea)
const shipTops = [
  { ship: carrier, group: carrierModel.group, top: new ShipTop(carrierModel.group), shape: myShape },
  { ship: enemyShip, group: enemyModel.group, top: new ShipTop(enemyModel.group), shape: foeShape },
];
const inShip = (p: THREE.Vector3, ignore: CarrierController | null) => shipTops.some(({ ship, group, top }) => {
  if (ship === ignore) return false;
  const l = ship.worldToLocal(p);
  return p.y - group.position.y - MANTA_GEAR < top.at(l.x, l.z) + 0.5;
});
for (const m of [...mantas, ...foeSkuas]) m.shipContact = inShip;
// an Otter in the water runs into another ship's side (its hull 2 m over the waterline, where the Otter floats)
const inHull = (p: THREE.Vector3, own: CarrierController) => shipTops.some(({ ship, shape }) => {
  if (ship === own) return false;
  const l = ship.worldToLocal(p);
  return l.z > -100 && l.z < shape.bowZ && Math.abs(l.x) < shape.widthAbove(l.z, 2);
});
for (const w of [...walruses, ...foeOtters]) w.shipContact = inHull;
// a Manta with the long-range radio pod relays the link for everyone
// the drone with the long-range radio pod relays the link where it flies
setRelays(() => (drone.relay ? [drone.pos] : []));
// map waypoints for Walrus and Manta (the drone flies its own); Otters find their way round cliffs and over landings
const otterRoutes = new OtterRoutes(world, obstacles);
const pilots = new UnitPilots(carrier, (msg) => notify(msg), otterRoutes);
// what the player has mapped: own islands are known, the rest needs the drone
const survey = new Survey(world.islands);
bases.forEach((b, k) => { if (b.team === 'spieler') survey.revealAll(k); });
let active: Vehicle = 'traeger';
const VEHICLES: Vehicle[] = ['traeger', 'walrus', 'manta', 'drohne'];
const VEHICLE_NAMES: Record<Vehicle, string> = { traeger: SHIP_NAME, walrus: t('type.otter'), manta: t('type.skua'), drohne: t('type.drone') };
/** camera labels start with the vehicle type; the picture-in-picture shows the unit's own name there */
const TYPE_PREFIX = new RegExp(`^(${t('type.otter')}|${t('type.skua')})`);
const VEHICLE_GROUP: Record<Vehicle, CamGroup> = { traeger: 'Träger', walrus: 'Walrus', manta: 'Manta', drohne: 'Drohne' };
const TURRET_CAM = 'traeger-turm';
/** the observation drone's camera: there while the drone hangs under its chute */
const OBS_CAM = 'traeger-beob';

// ---------- cameras (the player sits on the bridge and watches through these) ----------
const params = {
  zeit: env.time, zeitLaeuft: true, tempo: 1, zeitraffer: 1,
  wetter: t('weather.klar'), einheit: SHIP_NAME, kamera: '', entwickler: false,
  zufallsWetter: true, aufloesung: 'auto', maxAufloesung: '1440p', schatten: 'hoch', bloom: false, meer: 'mosaik' as SeaStyle, befahrbarkeit: false, ton: true, stimme: true,
  bildrate: '60', hintergrundPause: true, leistung: false, seeMusik: true,
};
// 'Auto' never renders more pixels than this, however big the window and the display density:
// flat-shaded low poly gains little above ~1440p, but every pixel costs fill rate
const MAX_PIXELS: Record<string, number> = { '1080p': 1920 * 1080, '1440p': 2560 * 1440, '4K': 3840 * 2160, unbegrenzt: Infinity };
const cams = new CameraSystem(camera, renderer.domElement, () => !params.entwickler && !pointer.locked);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const cg = carrierModel.group, wg = walrus.model.group, mg = manta.model.group;
// the Stoorworm's three cameras (from its model): the bridge, astern from the mast, outside as on the title picture
const SC = shipCameras(), sv = (p: [number, number, number]) => V(p[0], p[1], p[2]);
cams.add({ id: 'traeger-bruecke', label: t('cam.bridgeFwd'), group: 'Träger', anchor: cg, eye: sv(SC.bruecke.eye), look: sv(SC.bruecke.look) });
cams.add({ id: 'traeger-achtern', label: t('cam.shipAft'), group: 'Träger', anchor: cg, eye: sv(SC.achtern.eye), look: sv(SC.achtern.look), fov: 60 });
cams.add({ id: 'traeger-aussen', label: t('cam.shipOutside'), group: 'Träger', anchor: cg, eye: sv(SC.aussen.eye), look: sv(SC.aussen.look), fov: 50 });
// the observation drone's camera (only while it hangs up there): from its lens, round and down, zoom to 8×
const obsLens = new THREE.Vector3();
function syncObserverCam() {
  const there = cams.cams.some(c => c.id === OBS_CAM);
  if (hammer.watching && !there) {
    cams.add({ id: OBS_CAM, label: t('cam.observer'), group: 'Träger', anchor: cg, eye: V(0, 0, 0), look: V(0, 0, 100), fov: 55,
      stabilised: 'yaw', tiltRange: [-1.45, 0.3], tilt0: -0.45, panRange: Infinity, maxZoom: 8,
      eyeAt: () => obsLens.copy(hammer.drone?.pos ?? carrier.pos).setY((hammer.drone?.pos.y ?? 60) - 1.6) });
  } else if (!hammer.watching && there) {
    // it came down or was shot down: a screen on it goes back to the bridge, and so does the player looking through it
    if (monPick.ship === OBS_CAM) monPick.ship = 'traeger-bruecke';
    if (cams.remove(OBS_CAM)) selectCam(DEFAULT_CAM.traeger);
  }
}
// the laser turret's camera above the turret: it turns all the way round, zooms to 8×, and the turret follows where it looks
const turretAt = (cg.updateMatrixWorld(true), cg.worldToLocal(carrierModel.turret.getWorldPosition(V(0, 0, 0))));
cams.add({ id: TURRET_CAM, label: t('cam.shipTurret'), group: 'Träger', anchor: cg, eye: turretAt.clone().add(V(0, 7.2, 0)), look: turretAt.clone().add(V(0, 7.2, 100)),
  fov: 50, stabilised: 'yaw', tiltRange: [-0.1, 1.35], tilt0: 0.06, panRange: Infinity, maxZoom: 8 });
cams.add({ id: 'walrus-mast', label: t('cam.otterMast'), group: 'Walrus', anchor: wg, eye: V(0, 14, -28), look: V(0, 3, 30), stabilised: 'yaw', lag: 4 });
// driver view just in front of the cab windows (the twin laser runs above and behind it)
cams.add({ id: 'walrus-fahrer', label: t('cam.otterDriver'), group: 'Walrus', anchor: wg, eye: V(0, 5.55, 4.45), look: V(0, 4.3, 80), fov: 62 });
cams.add({ id: 'manta-heck', label: t('cam.skuaTail'), group: 'Manta', anchor: mg, eye: V(0, 12, -46), look: V(0, 4, 40), stabilised: 'yawPitch', lag: 3 });
cams.add({ id: 'manta-lift', label: t('cam.skuaLift'), group: 'Manta', anchor: cg, eye: V(16, 15, 62), look: V(0, 3, 22), fov: 58 });
// pilot's eye just above the front of the canopy (inside it the frame would fill the picture)
cams.add({ id: 'manta-cockpit', label: t('cam.skuaCockpit'), group: 'Manta', anchor: mg, eye: V(0, 4.65, 4.9), look: V(0, 3.9, 100), fov: 65, roll: true });
const dg = droneModel.group;
// the drone camera sits in the lens of the stabilised sensor ball under the nose
const droneLens = new THREE.Vector3();
cams.add({ id: 'drohne-kamera', label: t('cam.droneCam'), group: 'Drohne', anchor: dg, eye: V(...DRONE_GIMBAL), look: V(DRONE_GIMBAL[0], DRONE_GIMBAL[1], 100), fov: 70,
  stabilised: 'yaw', tiltRange: [-1.55, 0.12], tilt0: -0.45, eyeAt: () => droneModel.gimbal.localToWorld(droneLens.set(0, 0, 0.62)) });
cams.add({ id: 'drohne-verfolger', label: t('cam.droneChase'), group: 'Drohne', anchor: dg, eye: V(0, 10, -27), look: V(0, 2, 14), stabilised: 'yaw', lag: 3 });
cams.add({ id: 'drohne-deck', label: t('cam.dronePad'), group: 'Drohne', anchor: cg, eye: V(19, 11, -92), look: V(0, 2.5, -70), fov: 60 });
/** fixed cameras on an island's radio mast and command centre */
function addIslandCam(isl: string, bd: { type: string; x: number; y: number; z: number; rot: number }) {
  const mast = bd.type === 'funkmast', id = mast ? 'mast' : 'kz', y = mast ? 47 : 36;
  const anchor = new THREE.Object3D();
  anchor.position.set(bd.x, bd.y, bd.z);
  anchor.rotation.y = bd.rot;
  cams.add({ id: `insel-${isl}-${id}`, label: t('cam.island', { island: isl, building: t(mast ? 'building.funkmast' : 'building.kommandozentrale') }), group: 'Insel', anchor,
    eye: V(0, y, 0), look: V(0, y - 9, 100), fov: 60, survey: mast ? 0.1 : 0.04 });
}
bases.forEach((b, i) => {
  for (const bd of b.placed) if (bd.type === 'funkmast' || bd.type === 'kommandozentrale') addIslandCam(world.islands[i].name, bd);
});
/** the first camera when the big picture switches to a unit: Otter and Skua from the cockpit */
const DEFAULT_CAM: Record<Vehicle, string> = { traeger: 'traeger-bruecke', walrus: 'walrus-fahrer', manta: 'manta-cockpit', drohne: 'drohne-kamera' };
/** the same, but a Skua under deck (in the hangar or on the lift) has nothing to see from its cockpit: the lift camera */
const firstCam = (v: Vehicle) => v === 'manta' && manta.underDeck ? 'manta-lift' : DEFAULT_CAM[v];
let lastMantaCam = 'manta-lift';
function autoMantaCamera() {
  // like a director on the bridge: the lift camera while the Skua is under deck, the cockpit once it stands at the
  // catapult, the lift again when it goes down after landing; unless the pilot chose another camera
  const want = firstCam('manta');
  if (want !== lastMantaCam && (cams.current?.id === 'manta-lift' || cams.current?.id === 'manta-cockpit')) selectCam(want);
  lastMantaCam = want;
}
function selectCam(id: string) {
  cams.select(id);
  params.kamera = cams.current?.label ?? '';
}
selectCam(DEFAULT_CAM.traeger);

/** island cameras, nearest island first */
function nextIslandCam(dir: number) {
  const ref = carrier.pos;
  const list = cams.cams.filter(c => c.group === 'Insel')
    .sort((a, b) => a.anchor.position.distanceTo(ref) - b.anchor.position.distanceTo(ref));
  if (!list.length) return;
  const i = cams.current ? list.indexOf(cams.current) : -1;
  selectCam(list[(i + dir + list.length) % list.length].id);
}

function setVehicle(v: Vehicle) {
  active = v;
  params.einheit = VEHICLE_NAMES[v];
  selectCam(firstCam(v));
}

/** which Walrus / Manta the player drives: the cameras of that kind follow it */
function setCurrent(kind: 'walrus' | 'manta', i: number) {
  if (kind === 'walrus') { walrus = walruses[i]; units.walrus = walrus; } else { manta = mantas[i]; units.manta = manta; }
  const group: CamGroup = kind === 'walrus' ? 'Walrus' : 'Manta', anchor = (kind === 'walrus' ? walrus : manta).model.group;
  for (const c of cams.cams) if (c.group === group && c.anchor !== cg) c.anchor = anchor;
  if (cams.current?.group === group) selectCam(cams.current.id);
  prevState.walrus = walrus.state; prevState.manta = manta.state;
}
/** the unit the player sits in right now */
const activeId = (): UnitId => unitIdOf(active, active === 'walrus' ? walrus.index : active === 'manta' ? manta.index : 0);
/** pick a single unit (map, hangar): it becomes the current one of its kind */
function pickUnit(id: UnitId) {
  const k = kindOf(id);
  if (k === 'walrus' || k === 'manta') setCurrent(k, indexOf(id));
}

// developer camera: orbit around the active unit
const followPoint = new THREE.Vector3(), lastFollow = new THREE.Vector3();
function vehicleAnchor(out: THREE.Vector3): THREE.Vector3 {
  if (active === 'traeger') return out.copy(carrierModel.group.position).setY(carrierModel.group.position.y + 2);
  if (active === 'walrus') return out.copy(walrus.model.group.position).add(V(0, 3, 0));
  if (active === 'drohne') return out.copy(droneModel.group.position).add(V(0, 2.5, 0));
  return out.copy(manta.model.group.position).add(V(0, 2, 0));
}
function setDevCamera(on: boolean) {
  params.entwickler = on;
  controls.enabled = on;
  if (on) {
    vehicleAnchor(followPoint);
    controls.target.copy(followPoint);
    lastFollow.copy(followPoint);
    camera.fov = 55; camera.updateProjectionMatrix();
  } else if (cams.current) selectCam(cams.current.id);
}
function islandOverview() {
  setDevCamera(true);
  const isl = world.nearest(camera.position.x, camera.position.z).island;
  controls.target.set(isl.cx, 40, isl.cz + 100);
  camera.position.set(isl.cx + 1500, 950, isl.cz + 1900);
}
function updateDevCamera() {
  vehicleAnchor(followPoint);
  const delta = followPoint.clone().sub(lastFollow);
  camera.position.add(delta);
  controls.target.add(delta);
  lastFollow.copy(followPoint);
  controls.update();
}

// ---------- lighting from the environment ----------
const focus = new THREE.Vector3();
function updateLighting() {
  if (params.entwickler) focus.copy(controls.target);
  else if (cams.current?.group === 'Insel') focus.copy(cams.current.anchor.position);
  else vehicleAnchor(focus);
  focus.set(Math.round(focus.x / 4) * 4, 0, Math.round(focus.z / 4) * 4);
  sun.position.copy(focus).addScaledVector(env.lightDir, 4000);
  sun.target.position.copy(focus);
  sun.color.copy(env.lightColor);
  sun.intensity = env.lightIntensity;
  hemi.color.copy(env.hemiSky);
  hemi.groundColor.copy(env.hemiGround);
  hemi.intensity = env.hemiIntensity;
  const fog = scene.fog as THREE.Fog;
  // the horizon the camera looks at: warm towards the sun, cool away from it (as the sky paints it), so islands
  // in the haze melt into the sky behind them
  camera.getWorldDirection(fogDir);
  const az = (fogDir.x * env.sunDir.x + fogDir.z * env.sunDir.z) / (Math.hypot(fogDir.x, fogDir.z) * Math.hypot(env.sunDir.x, env.sunDir.z) || 1) * 0.5 + 0.5;
  fog.color.copy(env.horizonCool).lerp(env.fogColor, THREE.MathUtils.smoothstep(az, 0.35, 1));
  // three.js mixes the fog in after the tone mapping, the sky and the sea go through it: so the fog gets the
  // tone-mapped colour, or at dusk and at night islands lost in the haze stand pale against a darker horizon
  neutralToneMap(fog.color, renderer.toneMappingExposure);
  fog.near = env.w.fogNear;
  fog.far = env.w.fogFar;
}

const bufferSize = new THREE.Vector2();
const darkness = () => Math.max(1 - env.dayness(), env.w.dark * 0.6);
// ---------- rain on the window or lens the camera looks through (src/engine/rainGlass.ts) ----------
/** cameras behind glass: the bridge, the Skua's cockpit, the Otter's cab; all others are out in the rain with their lens */
const GLASS_CAMS = new Set(['traeger-bruecke', 'manta-cockpit', 'walrus-fahrer']);
/** the glass's clocks and the airstream over a Skua's canopy, all eased so nothing on the glass jumps */
const wet = { time: 0, run: 0, pace: 1, angle: 0, flow: 0, blow: 0, cx: 0.9, cy: 0.5 };
const camRight = new THREE.Vector3(), glassDown = new THREE.Vector3(), airDir = new THREE.Vector3();
/** true (and the pass set up) while it rains on the camera's window or lens */
function rainOnGlass(dt: number): boolean {
  const id = cams.current?.id, rain = env.w.rain;
  if (params.entwickler || !id || rain < 0.05) return false;
  const u = post.glass.uniforms, aspect = u.uAspect.value, ease = Math.min(1, dt * 3);
  camera.updateMatrixWorld();
  // they run down the glass (a banked cockpit turns where down is), the wind across it pushes them sideways and
  // hurries them along; by their own clock, which never runs back
  glassDown.set(0, -1, 0).transformDirection(camera.matrixWorldInverse);
  camRight.setFromMatrixColumn(camera.matrixWorld, 0);
  const side = (env.windX * camRight.x + env.windZ * camRight.z) / 22;
  wet.angle += (Math.atan2(glassDown.x, -glassDown.y) + THREE.MathUtils.clamp(side * 0.6, -0.5, 0.5) - wet.angle) * ease;
  wet.pace += (1 + Math.abs(side) - wet.pace) * ease;
  wet.time += dt;
  wet.run += dt * wet.pace;
  // on the canopy of a flying Skua the airstream blows them outwards from where it meets the glass: the point the
  // Skua flies towards, on the screen (at its edge when the pilot looks aside), and the faster it flies the faster
  const skua = id === 'manta-cockpit' && manta.state !== 'absturz' ? manta : null;
  wet.flow += ((skua ? THREE.MathUtils.smoothstep(skua.speed, 10, 50) : 0) - wet.flow) * ease;
  if (skua) {
    airDir.copy(skua.forward).transformDirection(camera.matrixWorldInverse);
    const f = 0.5 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), ahead = Math.max(-airDir.z, 0.05);
    const k = Math.min(1, dt * 6);
    wet.cx += (THREE.MathUtils.clamp(aspect * 0.5 + airDir.x / ahead * f, -0.3, aspect + 0.3) - wet.cx) * k;
    wet.cy += (THREE.MathUtils.clamp(0.5 + airDir.y / ahead * f, -0.3, 1.3) - wet.cy) * k;
    // (in log radius per second; a drop must not jump more than about half its cell from one frame to the next)
    wet.blow = (wet.blow + dt * THREE.MathUtils.clamp(0.6 + skua.speed / 100, 0.6, 2.4)) % 1000;
  }
  u.uTime.value = wet.time;
  u.uRun.value = wet.run;
  u.uRain.value = Math.min(1, rain);
  u.uLight.value = 0.3 + 0.7 * (1 - darkness());
  u.uAngle.value = wet.angle;
  u.uFlow.value = wet.flow;
  u.uBlow.value = wet.blow;
  u.uCentre.value.set(wet.cx, wet.cy);
  u.uLens.value = GLASS_CAMS.has(id) && !finale.on ? 0 : 1;
  return true;
}
/** lights: dull by day, glowing at night and in bad weather */
/** height in device pixels of the picture being drawn (light halos are sized by it) */
let viewH = 1;
function nightLights(lights: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>, glow: GlowPoints) {
  const dark = darkness();
  lights.material.color.setScalar(THREE.MathUtils.lerp(0.35, 2.4, dark));
  glow.update(THREE.MathUtils.smoothstep(dark, 0.25, 0.8), camera, viewH, scene.fog as THREE.Fog);
}

/**
 * The Otters' headlights: at night real light on the ground ahead, not only the glowing lamps. Two spotlights (no
 * shadows) go to the two Otters out nearest the camera, the enemy's too; there are always two in the scene, by day
 * dark, so the shaders never have to be rebuilt. They fall off with the distance, not its square (decay 1), and have a
 * wide soft edge: no glaring patch right ahead, and the beam reaches some 150 m.
 */
const HEADLIGHT = { candela: 700, range: 180, angle: 0.42, penumbra: 0.9, reach: 900, from: new THREE.Vector3(0, 3.6, 8.4), at: new THREE.Vector3(0, 0, 40) };
const headlights = [0, 1].map(() => {
  const l = new THREE.SpotLight(0xfff6e8, 0, HEADLIGHT.range, HEADLIGHT.angle, HEADLIGHT.penumbra, 1);
  scene.add(l, l.target);
  return l;
});
function otterHeadlights() {
  const k = THREE.MathUtils.smoothstep(darkness(), 0.25, 0.8);
  const near = k > 0 ? [...walruses, ...foeOtters].filter(w => w.state !== 'dock' && w.state !== 'zerstoert')
    .map(w => ({ w, d: w.pos.distanceTo(camera.position) })).filter(o => o.d < HEADLIGHT.reach).sort((a, b) => a.d - b.d) : [];
  headlights.forEach((l, i) => {
    const o = near[i];
    l.intensity = o ? HEADLIGHT.candela * k : 0;
    if (!o) return;
    const g = o.w.model.group;
    g.updateMatrixWorld();
    l.position.copy(HEADLIGHT.from).applyMatrix4(g.matrixWorld);
    l.target.position.copy(HEADLIGHT.at).applyMatrix4(g.matrixWorld);
  });
}

function baseLights(b: IslandBase) {
  const dark = darkness();
  b.lightMat.color.setScalar(THREE.MathUtils.lerp(0.35, 2.4, dark));
  const k = THREE.MathUtils.smoothstep(dark, 0.25, 0.8);
  for (const bd of b.buildings) if (bd.alive) bd.glow.update(k, camera, viewH, scene.fog as THREE.Fog);
}

// ---------- UI ----------
function setShadows(quality: string) {
  sun.castShadow = quality !== 'aus';
  const size = quality === 'mittel' ? 2048 : 4096;
  if (sun.shadow.mapSize.x !== size) {
    sun.shadow.mapSize.set(size, size);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
}

// ---------- random weather: slow changes, storms short, sunshine long ----------
const fogDir = new THREE.Vector3();
/** three.js' NeutralToneMapping (Khronos PBR Neutral) on a linear colour, in place */
function neutralToneMap(c: THREE.Color, exposure: number): THREE.Color {
  c.multiplyScalar(exposure);
  const x = Math.min(c.r, c.g, c.b), offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  c.r -= offset; c.g -= offset; c.b -= offset;
  const peak = Math.max(c.r, c.g, c.b), start = 0.8 - 0.04;
  if (peak < start) return c;
  const d = 1 - start, newPeak = 1 - d * d / (peak + d - start);
  c.multiplyScalar(newPeak / peak);
  const g = 1 - 1 / (0.15 * (peak - newPeak) + 1);
  return c.lerp(new THREE.Color(newPeak, newPeak, newPeak), g);
}
const WEATHER_NAME = Object.fromEntries(Object.entries(WEATHER_LABELS).map(([label, w]) => [w, label])) as Record<WeatherName, string>;
/** the message when the weather changes: rain and storms by their strength */
function weatherNews(w: WeatherName, s: number): [string, string] {
  if (w === 'regen') return [t(s < 0.34 ? 'weather.news.regenLeicht' : s > 0.66 ? 'weather.news.regenStark' : 'weather.news.regen'), ''];
  if (w === 'sturm') return [t(s > 0.66 ? 'weather.news.sturmSchwer' : 'weather.news.sturm'), 'bad'];
  return [t(`weather.news.${w}`), ''];
}
const weather = new WeatherSchedule(env, (w, s) => { params.wetter = WEATHER_NAME[w]; notify(...weatherNews(w, s)); });

// the developer's panel (Menü → Einstellungen → Spiel → Entwicklerwerkzeuge): time and weather set by hand, unit
// and camera, the test tools and the world; the player's settings are on the menu's own page (settingsTabs)
const gui = new GUI({ title: `${GAME_TITLE} · ${t('set.dev')}` });
const fTime = gui.addFolder(t('gui.timeWeather'));
fTime.add(params, 'zeit', 0, 24, 0.01).name(t('gui.timeOfDay')).listen().onChange((v: number) => { env.time = v; });
fTime.add(params, 'wetter', Object.keys(WEATHER_LABELS)).name(t('gui.weather')).listen()
  .onChange((v: string) => { env.setWeather(WEATHER_LABELS[v] as WeatherName); weather.restart(); });
gui.add(params, 'einheit', Object.values(VEHICLE_NAMES)).name(t('gui.unit')).listen()
  .onChange((v: string) => setVehicle(VEHICLES.find(k => VEHICLE_NAMES[k] === v)!));
gui.add(params, 'kamera', cams.cams.filter(c => c.group !== 'Insel').map(c => c.label)).name(t('gui.camera')).listen()
  .onChange((label: string) => { const c = cams.cams.find(x => x.label === label); if (c) { setDevCamera(false); selectCam(c.id); } });
const fDev = gui.addFolder(t('gui.developer'));
fDev.add(params, 'entwickler').name(t('gui.freeCam')).listen().onChange(setDevCamera);
fDev.add({ insel: islandOverview }, 'insel').name(t('gui.islandOverview'));
// a new page in the test range: the running game is saved first (the test range itself never autosaves)
fDev.add({ probe: () => { autosave(); leaving = true; reloadPage('?probe=kampf'); } }, 'probe').name(t('gui.probe'));
fDev.add(params, 'befahrbarkeit').name(t('gui.drivability')).listen()
  .onChange((v: boolean) => world.setOverlay(v));
const worldParams = { seed: worldSeed, inseln: worldCount };
const fWorld = gui.addFolder(t('gui.world'));
fWorld.add(worldParams, 'seed', 1, 999999, 1).name(t('gui.seed'));
fWorld.add(worldParams, 'inseln', 4, 64, 1).name(t('gui.islands'));
const newWorld = (seed: number) => reloadPage(`?seed=${seed}&inseln=${worldParams.inseln}`);
fWorld.add({ go: () => newWorld(worldParams.seed) }, 'go').name(t('gui.newWorld'));
fWorld.add({ go: () => newWorld(Math.floor(Math.random() * 999998) + 1) }, 'go').name(t('gui.randomWorld'));
fWorld.close();

// ---------- Menü → Einstellungen: the player's settings, kept in this browser (or the app) ----------
const SETTINGS_KEY = 'skerry-settings';
/** what is kept between games (the clock, its tempo, the time warp and the random weather belong to the saved game) */
const KEPT = ['aufloesung', 'maxAufloesung', 'schatten', 'bloom', 'meer', 'bildrate', 'leistung', 'ton', 'stimme', 'seeMusik', 'hintergrundPause'] as const;
function saveSettings() {
  if (PROBE) return;
  const kept = Object.fromEntries(KEPT.map(k => [k, params[k]]));
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ params: kept, levels: sound.levels })); } catch { /* storage blocked */ }
}
/** the kept settings, at the start (missing or broken ones keep their defaults) */
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as { params?: Record<string, unknown>; levels?: Record<string, unknown> };
    const p = params as Record<string, unknown>;
    for (const k of KEPT) if (s.params && typeof s.params[k] === typeof p[k]) p[k] = s.params[k];
    for (const k of Object.keys(sound.levels) as (keyof SoundLevels)[]) {
      const v = s.levels?.[k];
      if (typeof v === 'number' && Number.isFinite(v)) sound.levels[k] = THREE.MathUtils.clamp(v, 0, 1);
    }
  } catch { /* storage blocked or broken: the defaults */ }
  setShadows(params.schatten);
  ocean.setStyle(params.meer);
  sound.enabled = params.ton;
  voice.enabled = params.stimme;
  sound.applyLevels();
  autoRatio = autoCeiling();
  requestResize();
}
/** the resolution changed: the automatic one starts afresh */
function resolutionChanged() { autoRatio = autoCeiling(); autoCooldown = 2; blockedAbove = Infinity; requestResize(); }

function settingsTabs(): SettingTab[] {
  // every change is kept (pad and pointer keep theirs themselves) and a paused picture is drawn again
  const kept = () => { saveSettings(); stillDrawn = false; };
  // (pairs, not an object: an object would put the number-like values first)
  const opts = (o: [string, string][]) => o.map(([value, label]) => ({ value, label }));
  const choice = <K extends 'aufloesung' | 'maxAufloesung' | 'schatten' | 'meer' | 'bildrate'>(key: K, label: string, options: [string, string][], after?: (v: string) => void): SettingItem =>
    ({ id: key, label, kind: 'choice', options: opts(options), get: () => params[key], set: (v) => { (params as Record<string, unknown>)[key] = v; after?.(v); kept(); } });
  const flag = (key: 'bloom' | 'leistung' | 'ton' | 'stimme' | 'seeMusik' | 'hintergrundPause' | 'zeitLaeuft' | 'zufallsWetter', label: string, after?: (v: boolean) => void): SettingItem =>
    ({ id: key, label, kind: 'toggle', get: () => params[key], set: (v) => { params[key] = v; after?.(v); kept(); } });
  const pctOf = (v: number) => `${Math.round(v * 100)} %`;
  const level = (key: keyof SoundLevels, label: string): SettingItem =>
    ({ id: `level-${key}`, label, kind: 'range', min: 0, max: 1, step: 0.05, format: pctOf, get: () => sound.levels[key], set: (v) => { sound.levels[key] = v; sound.applyLevels(); kept(); } });
  const pad = input.settings, ptr = pointer.settings;
  const padFlag = (key: 'invertPitch' | 'invertLook' | 'rumble' | 'aimAssist', label: string): SettingItem =>
    ({ id: `pad-${key}`, label, kind: 'toggle', get: () => pad[key], set: (v) => { pad[key] = v; input.saveSettings(); } });
  const padRange = (key: 'lookSpeed' | 'deadzone' | 'curve' | 'rumbleStrength', label: string, min: number, max: number, step: number, format: (v: number) => string): SettingItem =>
    ({ id: `pad-${key}`, label, kind: 'range', min, max, step, format, get: () => pad[key], set: (v) => { pad[key] = v; input.saveSettings(); } });
  const ptrFlag = (key: 'clickCapture' | 'invertY' | 'invertSwipe', label: string): SettingItem =>
    ({ id: `ptr-${key}`, label, kind: 'toggle', get: () => ptr[key], set: (v) => { ptr[key] = v; pointer.saveSettings(); } });
  const times = (v: number) => `${num(v, 2)}×`;
  return [
    { id: 'bild', label: t('gui.graphics'), sections: [
      { title: t('set.sec.quality'), items: [
        choice('aufloesung', t('gui.resolution'), [['auto', t('gui.auto')], ['50', pct(0.5)], ['75', pct(0.75)], ['100', pct(1)], ['nativ', t('gui.native')]], resolutionChanged),
        choice('maxAufloesung', t('gui.maxResolution'), [['1080p', '1080p'], ['1440p', '1440p'], ['4K', '4K'], ['unbegrenzt', t('gui.unlimited')]], resolutionChanged),
        choice('schatten', t('gui.shadows'), [['hoch', t('gui.high')], ['mittel', t('gui.medium')], ['aus', t('gui.off')]], setShadows),
        flag('bloom', t('set.bloom')),
      ] },
      { title: t('set.sec.view'), items: [
        choice('meer', t('gui.sea'), [['mosaik', t('set.seaMosaic')], ['linien', t('set.seaLines')], ['stufen', t('set.seaSteps')]], (v) => ocean.setStyle(v as SeaStyle)),
        choice('bildrate', t('gui.frameRate'), [['60', '60'], ['30', '30']]),
        flag('leistung', t('gui.perf')),
      ] },
    ], note: t('set.kept') },
    { id: 'ton', label: t('gui.sound'), sections: [
      { title: t('set.sec.volume'), items: [
        level('master', t('gui.master')), level('effects', t('gui.effects')), level('engines', t('gui.engines')),
        level('ambience', t('gui.ambience')), level('music', t('gui.music')), level('voice', t('gui.voice')),
      ] },
      { title: t('set.sec.switches'), items: [
        flag('ton', t('gui.soundOn'), (v) => { sound.enabled = v; sound.applyLevels(); }),
        flag('stimme', t('gui.voiceOn'), (v) => { voice.enabled = v; }),
        flag('seeMusik', t('gui.seaMusic')),
      ] },
    ], note: t('set.kept') },
    { id: 'steuerung', label: t('menu.controls'), sections: [
      { title: t('gui.pointer'), items: [
        ptrFlag('clickCapture', t('gui.ptrCapture')),
        { id: 'ptr-sensitivity', label: t('gui.ptrSensitivity'), kind: 'range', min: 0.3, max: 3, step: 0.05, format: times, get: () => ptr.sensitivity, set: (v) => { ptr.sensitivity = v; pointer.saveSettings(); } },
        ptrFlag('invertY', t('gui.ptrInvertY')), ptrFlag('invertSwipe', t('gui.ptrInvertSwipe')),
      ] },
      { title: t('gui.pad'), items: [
        { id: 'pad-glyphs', label: t('gui.padGlyphs'), kind: 'choice', options: opts([['auto', t('gui.padAuto')], ['playstation', t('gui.padPlaystation')], ['xbox', t('gui.padXbox')]]),
          get: () => pad.glyphs, set: (v) => { pad.glyphs = v as typeof pad.glyphs; input.saveSettings(); } },
        padRange('lookSpeed', t('gui.padLook'), 0.4, 2, 0.05, times), padFlag('invertLook', t('gui.padInvertLook')),
        padRange('deadzone', t('gui.padDeadzone'), 0.05, 0.25, 0.01, pctOf), padRange('curve', t('gui.padCurve'), 0, 1, 0.05, pctOf),
        padFlag('rumble', t('gui.padRumble')), padRange('rumbleStrength', t('gui.padRumbleStrength'), 0, 1, 0.05, pctOf),
        padFlag('aimAssist', t('gui.padAimAssist')),
      ] },
      { title: t('set.sec.allDevices'), items: [padFlag('invertPitch', t('gui.invertPitch'))] },
    ], note: t('set.controlsNote') },
    { id: 'spiel', label: t('set.tab.game'), sections: [
      { title: t('set.sec.time'), items: [
        flag('zeitLaeuft', t('gui.clockRuns')),
        { id: 'tempo', label: t('gui.tempo'), kind: 'range', min: 0.25, max: 60, step: 0.25, format: (v) => num(v, v < 10 ? 2 : 0), get: () => params.tempo, set: (v) => { params.tempo = v; stillDrawn = false; } },
        { id: 'zeitraffer', label: t('gui.timewarp'), kind: 'choice', options: opts([['1', '×1'], ['4', '×4'], ['10', '×10']]), get: () => String(params.zeitraffer), set: (v) => { params.zeitraffer = Number(v); } },
        flag('zufallsWetter', t('gui.randomWeather'), (v) => { weather.enabled = v; weather.restart(); }),
      ] },
      { title: t('set.sec.window'), items: [flag('hintergrundPause', t('gui.bgPause'))] },
    ], note: t('set.gameNote'), dev: true },
  ];
}

// a focused <select> in the settings panel would eat game keys (typing D jumps to
// "Deck-Kamera" ...): hand the focus back to the game after every change and click
gui.onFinishChange(() => (document.activeElement as HTMLElement | null)?.blur());
gui.onChange(() => { stillDrawn = false; });
renderer.domElement.addEventListener('pointerdown', () => (document.activeElement as HTMLElement | null)?.blur());

const hud = document.getElementById('hud')!;
hud.textContent = t('hud.loading');
document.documentElement.lang = lang;
const help = document.getElementById('help')!;

// ---------- ACCB: found a base on a neutral island ----------
/** an island changed: obstacles for the Walrus, trees cleared from the new sites, old cameras gone */
function refreshIsland(k: number) {
  obstacles.length = 0;
  obstacles.push(...bases.flatMap(b => b.obstacles), ...clearings);
  const isl = world.islands[k];
  if (vegetation.has(isl)) { dropVegetation(isl); plantVegetation(isl); }
  if (cams.remove(`insel-${isl.name}-`)) selectCam(DEFAULT_CAM[active]);
}
/** K: the Walrus uses its cargo (ACCB, virus bomb, fuel pod) */
function useCargo() {
  const w = walrus, cargo = w.load.cargo;
  if (w.state !== 'fahren') { notify(t('cargo.launchFirst', { unit: w.name }), 'bad'); return; }
  if (!cargo) { notify(t('cargo.none', { unit: w.name }), 'bad'); return; }
  if (cargo === 'harbinger') { notify(t('cargo.harbingerKey', { n: w.load.missiles })); return; }
  if (cargo === 'virus') {
    // fired at the opening of an enemy command centre (where the turret aims)
    const from = w.pos.clone().add(V(0, 6, 0));
    const to = w.aimValid ? w.aim.clone() : w.pos.clone().addScaledVector(w.forward, 200).setY(from.y);
    combat.fire({ kind: 'virus', team: 'spieler', from, dir: to.sub(from) });
    w.load.cargo = null;
    notify(t('cargo.virusFired', { unit: w.name }));
    return;
  }
  if (cargo === 'tank') {
    const other = walruses.find(o => o !== w && o.state === 'fahren' && o.fuel < 0.25 && o.pos.distanceTo(w.pos) < 30);
    if (!other) { notify(t('cargo.noTankTarget'), 'bad'); return; }
    other.fuel = 1;
    w.load.cargo = null;
    sound.clunk(w.pos);
    notify(t('cargo.refuelled', { unit: w.name, other: other.name }), 'good');
    return;
  }
  if (w.medium !== 'land') { notify(t('cargo.accbLandOnly'), 'bad'); return; }
  const isl = world.islandAt(w.pos.x, w.pos.z);
  if (!isl) return;
  const k = world.islands.indexOf(isl), base = bases[k];
  if (base.pending) { notify(t('cargo.building', { island: isl.name }), 'bad'); return; }
  if (base.team === 'spieler') { notify(t('cargo.alreadyYours', { island: isl.name }), 'bad'); return; }
  if (base.team !== 'neutral') { notify(t('cargo.enemy', { island: isl.name }), 'bad'); return; }
  const site = base.findSite(w.pos.x, w.pos.z);
  if (!site) { notify(t('cargo.noSite', { deg: SLOPE.BUILD }), 'bad'); return; }
  // what it builds was chosen in the hangar; on the home island every ACCB builds the base again (original: island 0)
  const role: IslandRole = k === 0 ? 'basis' : w.load.role;
  w.load.cargo = null;
  base.found('spieler', role, site);
  survey.revealAll(k);
  refreshIsland(k);
  sound.clunk(w.pos);
  notify(t('cargo.accbPlaced', { island: isl.name, role: ROLE_ISLAND[role] }), 'good');
}

/** a virus bomb in the opening of a finished enemy command centre: the island is the player's at once (DOS 1.2) */
combat.onVirus = (hit, from) => {
  const base = bases.find(b => b.buildings.includes(hit as never));
  const bd = base?.buildings.find(b => b === (hit as never));
  if (!base || !bd || bd.p.type !== 'kommandozentrale') { notify(t('virus.noEffect'), 'bad'); return; }
  const isl = base.island;
  if (base.team === 'spieler') { notify(t('cargo.alreadyYours', { island: isl.name })); return; }
  if (base.team !== 'feind' || !bd.alive) { notify(t('virus.notReady'), 'bad'); return; }
  const face = V(Math.sin(bd.p.rot), 0, Math.cos(bd.p.rot)), came = V(from.x, 0, from.z).normalize();
  if (face.angleTo(came) > THREE.MathUtils.degToRad(55)) { notify(t('virus.shield'), 'bad'); return; }
  const k = bases.indexOf(base), st = base.saveState();
  st.team = 'spieler'; st.formerTeam = 'feind';
  base.loadState(st);
  survey.revealAll(k);
  refreshIsland(k);
  bases[k].buildings.forEach(b => { if (b.alive && (b.p.type === 'funkmast' || b.p.type === 'kommandozentrale')) addIslandCam(isl.name, b.p); });
  stats.islandsWon++;
  notify(t('virus.captured', { island: isl.name }), 'good');
  voice.say('insel-erobert');
};

bases.forEach((b, k) => {
  b.onBuilt = (bd) => {
    const isl = world.islands[k];
    if (bd.p.type === 'kommandozentrale' || bd.p.type === 'funkmast') addIslandCam(isl.name, bd.p);
    if (bd.p.type === 'kommandozentrale' && b.team === 'spieler') {
      stats.islandsWon++;
      survey.revealAll(k);
      notify(t('base.ccBuilt', { island: isl.name, what: isl.role ? ROLE_ISLAND[isl.role] : t('base.island') }), 'good');
      voice.say('insel-erobert');
    } else if (!b.construction && b.team === 'spieler') notify(t('base.done', { island: isl.name }), 'good');
    // the enemy's new island: news only if the player knows the island or watches it
    if (bd.p.type === 'kommandozentrale' && b.team === 'feind' && (survey.known(k) || playerSees(isl.cx, isl.cz, isl.size / 2))) {
      notify(t('foe.islandTaken', { island: isl.name }), 'bad');
      voice.say('feind-insel');
    }
  };
});
// ---------- economy: mining, factories, stockpile, transfer drone ----------
const economy = new Economy(world, bases);
// ---------- landing pads: the Skua refuels on own islands from the network's Skua fuel ----------
function pads(): Pad[] {
  return bases.flatMap((b, k) => b.pads.map(p => ({ x: p.x, y: p.y + PAD_TOP, z: p.z, rot: p.rot, island: k, name: world.islands[k].name })));
}
/** the nearest pad the Skua can reach without losing the radio link (the ship or a relaying Skua) */
function nearestPad(x: number, z: number): Pad | null {
  let best: Pad | null = null, bd = Infinity;
  for (const p of pads()) {
    if (linkDistance(p.x, p.z, carrier.pos) > SIGNAL_LOST * 0.95) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
for (const m of mantas) {
  m.padFuel = (pad, units) => {
    if (!economy.linked[pad.island]) return 0;
    const got = Math.min(units, economy.stockpileGoods.treibstoffManta);
    economy.stockpileGoods.treibstoffManta -= got;
    return got;
  };
}
economy.onMessage = (msg, cls) => notify(msg, cls);
economy.onEvent = (e) => voice.say(e === 'frozen' ? 'netz-unterbrochen' : 'lager-verloren');
// ---------- the enemy: its own network by the same rules, its strategy (Omega) ----------
const foeEconomy = new Economy(world, bases, 'feind');
const foePilots = new UnitPilots(enemyShip, () => {}, otterRoutes);
/** what the enemy sees this frame (worked out once per frame for its strategy) */
let foeEyesNow: Eye[] = [];
const omega = new Omega({ helm: enemy, otters: foeOtters, skuas: foeSkuas, pilots: foePilots, economy: foeEconomy, combat }, world, bases, {
  foes: () => [carrier, ...walruses.filter(w => w.state === 'fahren'), ...mantas.filter(m => airborne(m) || m.state === 'pad'), ...(drone.flying ? [drone] : [])],
  prey: () => carrier,
  sees: (x, z) => foeEyesNow.some(e => Math.hypot(e.x - x, e.z - z) <= e.range),
  found: (k) => refreshIsland(k),
  event: omegaEvent,
});
const transferModel = buildTransferDrone();
scene.add(transferModel);
const transfer = new TransferDrone(transferModel, world, env, carrier, economy, (msg, cls) => notify(msg, cls));
transfer.onEvent = (e) => voice.say(e === 'netz' ? 'netz-unterbrochen' : `transfer-${e}`);
/** the stockpile island in transfer range last frame (null: not known yet, nothing is said) */
let depotNear: boolean | null = null;
/** the ship computer says when the stockpile island comes into transfer range or goes out of it (300 m of slack) */
function depotRange() {
  const near = transfer.distance < TRANSFER_RANGE + (depotNear ? 300 : 0);
  if (depotNear !== null && near !== depotNear && !economy.frozen) voice.say(near ? 'lager-in-reichweite' : 'lager-ausser-reichweite');
  depotNear = near;
}
// (while the transfer drone lies at the bow no defence drone leaves or lands, as in the original)
shields.blocked = () => transfer.state === 'angedockt';
economy.droneCargo = () => transfer.cargo;
const supply = new SupplyScreen(world, bases, economy, transfer, carrier, (msg, cls) => notify(msg, cls));

/** N: the sound on or off (also while the end's film runs) */
function toggleSound() { params.ton = !params.ton; sound.enabled = params.ton; sound.applyLevels(); saveSettings(); }
function handleKeys(dt: number) {
  // the pad only drives the units: an open window (the stores) keeps it out of the game; on the open map it
  // drives on while the mouse sets waypoints
  const pad = !supply.open;
  // Esc closes what is open, the topmost first (supply and hangar open on top of the map),
  // otherwise it (like P and the pad's Start) opens the menu and pauses
  // (the Esc that lets a captured pointer go must not also open the menu)
  if (input.hit('Escape') && performance.now() - pointer.releasedAt > 400) {
    if (pointer.locked) pointer.release();
    else if (supply.open) supply.toggle();
    else if (map.open) map.toggle();
    else { pause(); return; }
  }
  // Tab: the next Walrus or Manta
  if (input.hit('Tab') && (active === 'walrus' || active === 'manta')) {
    const n = active === 'walrus' ? (walrus.index + 1) % walruses.length : (manta.index + 1) % mantas.length;
    setCurrent(active, n);
    notify(`${(active === 'walrus' ? walrus : manta).name}`);
  }
  if (input.hit('KeyP', 'Pad.Start')) { pause(); return; }
  if (input.hit('KeyT')) params.zeitLaeuft = !params.zeitLaeuft;
  if (input.hit('KeyZ')) params.zeitraffer = params.zeitraffer === 1 ? 4 : params.zeitraffer === 4 ? 10 : 1;
  const shift = input.down('ShiftLeft', 'ShiftRight') ? -1 : 1;
  const camStep = input.hit('KeyC') ? shift : pad && input.hit('Pad.Y') ? 1 : 0;
  if (camStep) nextCamera(camStep);
  const islandStep = input.hit('KeyI') ? shift : 0;
  if (islandStep) { setDevCamera(false); nextIslandCam(islandStep); }
  if (input.hit('KeyO')) setDevCamera(!params.entwickler);
  if (input.hit('KeyV')) setVehicle(VEHICLES[(VEHICLES.indexOf(active) + 1) % VEHICLES.length]);
  if (active === 'walrus' && (input.hit('KeyK') || (pad && input.hit('Pad.X')))) useCargo();
  if (active === 'traeger' && (input.hit('KeyK') || (pad && input.hit('Pad.X')))) launchDecoys();
  if (active === 'traeger' && (input.hit('KeyX', 'Ptr.Second') || (pad && input.hit('Pad.A')))) hammerAction();
  if (active === 'manta' && (input.hit('KeyK') || (pad && input.hit('Pad.X')))) manta.dropBomb(combat);
  if (active === 'manta' && (input.hit('KeyU') || (pad && input.hit('Pad.RS')))) turnSkua(manta);
  if (input.hit('KeyL') || (pad && input.hit('Pad.B'))) {
    if (active === 'walrus') walrus.toggleLaunch();
    else if (active === 'manta') manta.toggleLaunch();
    else if (active === 'drohne') drone.toggleLaunch();
    else toggleShields();
  }
  // (the ship shifts its gears itself, in its update)
  if (pad && active !== 'traeger') speedStep(input.hit(...KEYS.faster) ? 1 : input.hit(...KEYS.slower) ? -1 : 0);
  if (pad && input.hit('Pad.LS')) cams.resetHead();
  // camera head: right stick (the Skua and the drone fly with it), drone gimbal on PageUp/Down and LB/RB
  if (pad && !params.entwickler && active !== 'manta' && active !== 'drohne') {
    const look = input.look(dt);
    // the light aim assist: over an enemy (or close by) the camera turns at half speed, it never follows by itself
    const slow = input.settings.aimAssist && (active === 'walrus' || turretInHand() || obsInHand()) && aimTarget ? 0.5 : 1;
    cams.look(-look.x * 1.8 * slow * dt, look.y * 1.3 * slow * dt);
  }
  // LT pulls the camera in as far as it is pulled: the Otter's aim mode (up to 3×), the drone's zoom (up to 6×), the
  // laser turret's (up to 8×); let go, the zoom from before comes back
  const zoomTo = !pad || params.entwickler ? 0 : cams.current?.id === 'drohne-kamera' ? 6 : turretInHand() || obsInHand() ? 8
    : active === 'walrus' && walrus.state === 'fahren' && cams.current?.group === 'Walrus' ? 3 : 0;
  const lt = zoomTo ? Math.max(input.value('Pad.LT'), active === 'walrus' && input.down('Ptr.Second') ? 1 : 0) : 0;
  if (lt > 0.02) { padZoomFrom ??= cams.zoomLevel; cams.zoomLevel = Math.max(padZoomFrom, 1 + (zoomTo - 1) * lt); }
  else if (padZoomFrom !== null) { cams.zoomLevel = padZoomFrom; padZoomFrom = null; }
  if (cams.current?.id === 'drohne-kamera') {
    cams.look(0, input.axis(['PageDown', ...(pad ? ['Pad.LB'] : [])], ['PageUp', ...(pad ? ['Pad.RB'] : [])]) * 1.0 * dt);
  }
  if (input.hit('KeyM')) { map.toggle(); sound.blip(); }
  if (input.hit('KeyG')) { supply.toggle(); sound.blip(); }
  if (input.hit('KeyN')) toggleSound();
  if (input.hit('KeyB')) {
    params.befahrbarkeit = !params.befahrbarkeit;
    world.setOverlay(params.befahrbarkeit);
  }
  // H: everything off but the picture (for screenshots)
  if (input.hit('KeyH')) document.body.classList.toggle('ui-hidden');
}
/** the drone camera's zoom before LT pulled it in (null: LT is let go) */
let padZoomFrom: number | null = null;
/** the Skua's thrust steps on the D-pad */
const THRUST_STEPS = [0, 0.25, 0.5, 0.75, 1];
const CRUISE_KEYS = { '-1': 'pad.cruiseBack', '0': 'pad.cruiseOff', '0.25': 'pad.cruise1', '0.5': 'pad.cruise2', '0.75': 'pad.cruise3', '1': 'pad.cruise4' } as const;
/** the Otter's cruise control as shown ("Tempomat ½") */
const cruiseName = (c: number) => t(CRUISE_KEYS[String(c) as keyof typeof CRUISE_KEYS]);
const PACE_KEYS = ['pad.pace0', 'pad.pace1', 'pad.pace2'] as const;
/** the pad's button pictures for the help line, with the speed steps as they are set now */
const padHelp = (): PadHelp => ({ ...padGlyphs(input.padKind), cruise: cruiseName(walrus.cruise), pace: t(PACE_KEYS[DRONE_PACES.indexOf(drone.pace)]) });

// ---------- trackpad / mouse with a captured pointer (src/game/pointer.ts) ----------
const vstick = document.getElementById('vstick')!, vstickDot = vstick.firstElementChild as HTMLElement;
/** whole speed steps from swiping still to hand out (one per frame, with a frame between, so each is a press) */
let pointerSteps = 0, pointerGap = false;
function pointerFrame(dt: number) {
  if (pointer.locked && (menu.open || map.open || supply.open)) pointer.release();
  const p = pointer.frame(dt), on = pointer.locked;
  input.feed('Ptr.Fire', on && p.fire ? 1 : 0);
  input.feed('Ptr.Second', on && p.second ? 1 : 0);
  // the finger flies the Skua like a stick (a dot round the crosshair shows it), and turns the others' cameras
  const flying = on && active === 'manta' && manta.state === 'flug';
  const sx = flying ? pointer.stick.x : 0, sy = flying ? pointer.stick.y : 0;
  input.feed('Ptr.X-', Math.max(0, -sx)); input.feed('Ptr.X+', Math.max(0, sx));
  input.feed('Ptr.Y-', Math.max(0, -sy)); input.feed('Ptr.Y+', Math.max(0, sy));
  vstick.style.display = flying && !params.entwickler ? 'block' : 'none';
  vstickDot.style.transform = `translate(${(sx * 38).toFixed(1)}px, ${(sy * 38).toFixed(1)}px)`;
  if (on && !flying && !params.entwickler) cams.look(-p.look.x * 0.0025, -p.look.y * 0.0025);
  if (on && p.zoom !== 1) cams.zoomBy(p.zoom);
  // swiping: the Skua's thrust straight, otherwise speed steps (the ship's gear, the cruise control, the drone's pace)
  if (flying && p.thrust) {
    manta.throttle = THREE.MathUtils.clamp(manta.throttle + p.thrust, 0, 1);
    if (manta.waypoint) pilots.setManta(manta, null);
  } else if (on) pointerSteps += p.steps;
  const step = pointerGap ? 0 : Math.sign(pointerSteps);
  pointerSteps -= step;
  pointerGap = step !== 0;
  input.feed('Ptr.Faster', step > 0 ? 1 : 0);
  input.feed('Ptr.Slower', step < 0 ? 1 : 0);
}
/** the help line while the pointer is captured */
function pointerHelp(): string {
  const common = t('ptr.common');
  if (active === 'traeger') return `${t(turretInHand() ? 'ptr.turret' : obsInHand() ? 'ptr.observer' : 'ptr.ship')} · ${common}`;
  if (active === 'drohne') return `${t('ptr.drone')} · ${common}`;
  if (active === 'walrus') return `${walrus.state === 'fahren' ? t('ptr.otter', { cruise: cruiseName(walrus.cruise) }) : t('ptr.aboard')} · ${common}`;
  return `${manta.state === 'flug' ? t('ptr.skua') : t('ptr.aboard')} · ${common}`;
}

/** the player's Skua with climb and dive turned round, if so set (every device: keys, pad, trackpad) */
function skuaInput(inp: InputLike): InputLike {
  if (!input.settings.invertPitch) return inp;
  const turned = (n: string[], p: string[]) => (n === MANTA_KEYS.noseDown && p === MANTA_KEYS.noseUp) || (n === MANTA_KEYBOARD.noseDown && p === MANTA_KEYBOARD.noseUp);
  return {
    down: (...c) => inp.down(...c),
    hit: (...c) => inp.hit(...c),
    axis: (n, p) => (turned(n, p) ? inp.axis(p, n) : inp.axis(n, p)),
  };
}

/** the D-pad's speed step for the unit in hand: the Otter's cruise control, the Skua's thrust, the drone's pace */
function speedStep(step: number) {
  if (!step) return;
  if (active === 'walrus' && walrus.state === 'fahren') {
    const i = CRUISE_STEPS.indexOf(walrus.cruise);
    walrus.cruise = CRUISE_STEPS[THREE.MathUtils.clamp(i + step, 0, CRUISE_STEPS.length - 1)];
    // the cruise control is driving by hand: the autopilot lets go
    if (walrus.waypoint || pilots.isHome(walrus)) pilots.setWalrus(walrus, null);
    notify(cruiseName(walrus.cruise));
  } else if (active === 'manta' && manta.state === 'flug') {
    const next = step > 0 ? THRUST_STEPS.find(v => v > manta.throttle + 0.01) : [...THRUST_STEPS].reverse().find(v => v < manta.throttle - 0.01);
    if (next === undefined) return;
    manta.throttle = next;
    if (manta.waypoint) pilots.setManta(manta, null);
    notify(t('pad.thrust', { pct: pct(next) }));
  } else if (active === 'drohne') {
    const i = THREE.MathUtils.clamp(DRONE_PACES.indexOf(drone.pace) + step, 0, DRONE_PACES.length - 1);
    drone.pace = DRONE_PACES[i];
    notify(t(PACE_KEYS[i]));
  }
}

/** C and the console: the unit's next camera */
function nextCamera(step: number) {
  setDevCamera(false);
  cams.cycle(VEHICLE_GROUP[active], step);
  params.kamera = cams.current?.label ?? '';
}

// 'Auto' steps the render scale between 0.75 and native to hold ~60 fps
const NATIVE = Math.min(window.devicePixelRatio || 1, 3);
let autoRatio = NATIVE;
let autoCooldown = 2;
const FIXED_RATIOS: Record<string, number> = { 50: 0.5, 75: 0.75, 100: 1, nativ: NATIVE };
function autoCeiling(): number {
  const cap = Math.sqrt((MAX_PIXELS[params.maxAufloesung] ?? Infinity) / Math.max(1, container.clientWidth * container.clientHeight));
  return Math.max(0.75, Math.min(NATIVE, cap));
}
function pixelRatio(): number {
  return params.aufloesung === 'auto' ? Math.min(autoRatio, autoCeiling()) : FIXED_RATIOS[params.aufloesung] ?? NATIVE;
}
// a scale that turned out too slow is not tried again for a while (no see-sawing up and down)
let blockedAbove = Infinity, blockTimer = 0;
function adaptResolution(measuredFps: number, dt: number) {
  autoCooldown -= dt;
  blockTimer -= dt;
  if (blockTimer <= 0) blockedAbove = Infinity;
  if (params.aufloesung !== 'auto' || autoCooldown > 0) return;
  const top = autoCeiling();
  autoRatio = Math.min(autoRatio, top);
  const next = Math.min(autoRatio + 0.25, top);
  if (measuredFps < 50 && autoRatio > 0.75) {
    blockedAbove = autoRatio - 0.01; blockTimer = 90;
    autoRatio = Math.max(0.75, autoRatio - 0.25); autoCooldown = 6; requestResize();
  } else if (measuredFps > 58 && next > autoRatio + 0.01 && next <= blockedAbove) {
    autoRatio = next; autoCooldown = 5; requestResize();
  }
}
// Bloom is optional eye candy; the light halos (GlowPoints) cover the night look cheaply.
const bloomWanted = () => params.bloom && darkness() > 0.35;

function resize() {
  updateUiScale();
  const w = container.clientWidth, h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post.setSize(w, h, pixelRatio());
}
// Resizing clears the canvas. Done after this frame's render, the browser would show
// that empty (black) buffer for one frame, so size changes wait for the next frame start.
let resizePending = false;
function requestResize() { resizePending = true; }
new ResizeObserver(requestResize).observe(container);

// ---------- loop ----------
const clock = new THREE.Clock();
let fpsFrames = 0, fpsTime = 0, fps = 0;
const STEP = 1 / 30;
resize();

renderer.info.autoReset = false;
// ---------- weapons: aiming, crosshair, messages ----------
function cockpit(u: UnitId) {
  if (map.open) map.toggle();
  setDevCamera(false);
  pickUnit(u);
  setVehicle(kindOf(u));
  selectCam(firstCam(kindOf(u)));
}
const unitOf = (u: UnitId) => kindOf(u) === 'walrus' ? walruses[indexOf(u)] : kindOf(u) === 'manta' ? mantas[indexOf(u)] : null;
// ---------- routes: more waypoints after the current one (Shift+click on the map) ----------
const routes = new Map<UnitId, THREE.Vector2[]>();
/** each routed unit's current waypoint, to tell "arrived" from "given up" once it is gone */
const routeLast = new Map<UnitId, THREE.Vector2>();
/** how close counts as arrived: the ship stops a little short, the Skua circles at about 1.1 km */
const ARRIVED: Record<Vehicle, number> = { traeger: 1200, walrus: 80, manta: 1600, drohne: 150 };
function currentWaypoint(u: UnitId): THREE.Vector2 | null {
  const k = kindOf(u);
  return k === 'traeger' ? carrier.waypoint : k === 'walrus' ? walruses[indexOf(u)].waypoint : k === 'manta' ? mantas[indexOf(u)].waypoint : drone.waypoint;
}
function unitXZ(u: UnitId): THREE.Vector3 {
  const k = kindOf(u);
  return k === 'traeger' ? carrier.pos : k === 'walrus' ? walruses[indexOf(u)].pos : k === 'manta' ? mantas[indexOf(u)].pos : drone.pos;
}
/** the remote units must stay within radio range of the ship or of the drone with the radio pod (which itself has
 *  none to keep); '' when fine */
function outOfRange(u: UnitId, p: THREE.Vector2): string {
  const k = kindOf(u), d = Math.hypot(p.x - carrier.pos.x, p.y - carrier.pos.z);
  if ((k === 'walrus' || k === 'manta') && linkDistance(p.x, p.y, carrier.pos) > SIGNAL_LOST) return t('order.wpOutOfRange', { unit: unitName(fleet, u), dist: km(SIGNAL_LOST, 0), ship: SHIP_NAME });
  if (k === 'drohne' && !drone.pod && d > DRONE_RANGE) return t('order.droneOutOfRange', { unit: t('drone.short'), dist: km(DRONE_RANGE, 0) });
  return '';
}
/** give the unit `p` as its current waypoint; false when it cannot take it (told why) */
function applyWaypoint(u: UnitId, p: THREE.Vector2, next = 0): boolean {
  const k = kindOf(u), name = k === 'drohne' ? t('drone.short') : unitName(fleet, u);
  const said = (key: 'order.wpSet' | 'order.wpSetLaunch' | 'order.wpSetCatapult' | 'order.wpSetStart') =>
    notify(next ? t('order.wpNext', { unit: name, n: next }) : t(key, { unit: name }));
  if (k === 'traeger') {
    carrier.setWaypoint(p.x, p.y, next > 0);
    if (next) notify(t('order.wpNext', { unit: SHIP_NAME, n: next }));
    return true;
  }
  const why = outOfRange(u, p);
  if (why) { notify(why, 'bad'); return false; }
  if (k === 'walrus') {
    const w = walruses[indexOf(u)];
    if (w.state === 'zerstoert') { notify(t('order.noSpare', { unit: name }), 'bad'); return false; }
    pilots.setWalrus(w, p);
    said(w.state === 'dock' ? 'order.wpSetLaunch' : 'order.wpSet');
  } else if (k === 'manta') {
    const m = mantas[indexOf(u)];
    if (m.state === 'absturz' || m.state === 'landung' || m.state === 'padland') { notify(t(m.state === 'absturz' ? 'order.noSpare' : 'order.landing', { unit: name }), 'bad'); return false; }
    pilots.setManta(m, p);
    said(m.state === 'deck' ? 'order.wpSetCatapult' : 'order.wpSet');
  } else {
    if (drone.state === 'zerstoert' || drone.state === 'rueckkehr') { notify(t(drone.state === 'rueckkehr' ? 'order.returning' : 'order.noSpare', { unit: t('drone.short') }), 'bad'); return false; }
    drone.waypoint = p;
    said(drone.state === 'deck' ? 'order.wpSetStart' : 'order.wpSet');
  }
  return true;
}
/** once a frame: a unit at its waypoint takes the next one of its route; a route given up (cleared, steered by hand, lost) is dropped */
function advanceRoutes() {
  for (const [u, q] of routes) {
    const k = kindOf(u), wp = currentWaypoint(u);
    if (wp) routeLast.set(u, wp.clone());
    const circling = k === 'manta' && !!wp && pilots.isOrbiting(mantas[indexOf(u)]);
    if (wp && !circling) continue;
    const last = routeLast.get(u), at = unitXZ(u);
    const arrived = !!last && Math.hypot(at.x - last.x, at.z - last.y) < ARRIVED[k];
    const n = (routeDone.get(u) ?? 1) + 1;
    if (arrived && q.length && applyWaypoint(u, q.shift()!, n)) {
      routeDone.set(u, n);
      routeLast.set(u, currentWaypoint(u)!.clone());
      if (!q.length) { routes.delete(u); routeDone.delete(u); }
    } else { routes.delete(u); routeLast.delete(u); routeDone.delete(u); }
  }
  carrier.passThrough = (routes.get('traeger')?.length ?? 0) > 0;
}
/** how many waypoints of the route the unit has taken (for "weiter zu Wegpunkt n") */
const routeDone = new Map<UnitId, number>();
function dropRoute(u: UnitId) { routes.delete(u); routeLast.delete(u); routeDone.delete(u); }

/** what a unit is doing on its own, for the map's unit card */
function unitOrder(u: UnitId): string {
  const k = kindOf(u), route = (routes.get(u)?.length ?? 0) > 0;
  if (k === 'traeger') return carrier.waypoint ? t(route ? 'order.s.route' : 'order.s.toWp') : carrier.throttleName;
  if (k === 'walrus') {
    const w = walruses[indexOf(u)];
    if (w.state !== 'fahren') return t('order.s.none');
    return pilots.isHome(w) ? t('order.s.home') : w.waypoint ? t(route ? 'order.s.route' : 'order.s.toWp') : w.cruise ? cruiseName(w.cruise) : t('order.s.manual');
  }
  if (k === 'manta') {
    const m = mantas[indexOf(u)];
    if (m.state === 'landung' || m.state === 'padland') return t('order.s.approach');
    if (m.state === 'pad') return t('order.s.pad');
    if (m.state === 'padstart') return t('order.s.padStart');
    if (strikes.active(m) && strikes.stage(m) !== 'heim') return t('order.s.strike', { target: strikes.target(m)!.name });
    if (strikes.stage(m) === 'heim') return t('order.s.strikeHome');
    if (m.state !== 'flug') return t('order.s.none');
    return m.waypoint ? (pilots.isOrbiting(m) ? t('order.s.circle') : t(route ? 'order.s.route' : 'order.s.fly')) : t('order.s.manual');
  }
  if (drone.state === 'rueckkehr') return t('order.s.return');
  if (!drone.flying) return t('order.s.none');
  return drone.waypoint ? t(route ? 'order.s.route' : 'order.s.fly') : t('order.s.hover');
}

const mapActions: MapActions = {
  waypoint(u, x, z, append = false) {
    const p = new THREE.Vector2(x, z);
    if (append && currentWaypoint(u)) {
      const why = outOfRange(u, p);
      if (why) { notify(why, 'bad'); return; }
      const q = routes.get(u) ?? [];
      q.push(p);
      routes.set(u, q);
      notify(t('order.wpAdded', { unit: kindOf(u) === 'drohne' ? t('drone.short') : unitName(fleet, u), n: (routeDone.get(u) ?? 1) + q.length }));
      carrier.passThrough = (routes.get('traeger')?.length ?? 0) > 0;
      return;
    }
    dropRoute(u);
    applyWaypoint(u, p);
  },
  route: (u) => routes.get(u) ?? [],
  path: (u) => kindOf(u) === 'walrus' ? pilots.routeOf(walruses[indexOf(u)]) : null,
  progress(u) {
    if (!currentWaypoint(u)) return null;
    const done = routeDone.get(u) ?? 1;
    return { step: done, total: done + (routes.get(u)?.length ?? 0) };
  },
  order: unitOrder,
  launchTransfer() { const why = transfer.launch(); if (why) notify(why, 'bad'); },
  clearWaypoint(u) {
    dropRoute(u);
    const k = kindOf(u), v = unitOf(u);
    if (k === 'traeger') { if (carrier.waypoint) { carrier.waypoint = null; notify(t('order.wpCleared', { unit: SHIP_NAME })); } return; }
    if (k === 'walrus') pilots.setWalrus(v as Walrus, null);
    else if (k === 'manta') pilots.setManta(v as Manta, null);
    else drone.waypoint = null;
    notify(t('order.wpCleared', { unit: unitName(fleet, u) }));
  },
  cockpit,
  active: activeId,
  select: pickUnit,
  commands: mapCommands,
  command: mapCommand,
  setDepot: (k) => moveDepot(economy, world, k, notify),
  hasIslandCam: (k) => cams.cams.some(c => c.id.startsWith(`insel-${world.islands[k].name}-`)),
  islandCam(k) {
    const cam = cams.cams.find(c => c.id.startsWith(`insel-${world.islands[k].name}-`));
    if (!cam) return;
    if (map.open) map.toggle();
    setDevCamera(false);
    selectCam(cam.id);
  },
  supply() { if (!supply.open) { supply.toggle(); sound.blip(); } },
  islandList() { supply.showIslands(); sound.blip(); },
  strike(u, x, z, r) {
    if (kindOf(u) !== 'manta') return;
    const tg = strikeTargetAt(x, z, r);
    if (!tg) { notify(t('strike.noTarget'), 'bad'); return; }
    orderStrike(mantas[indexOf(u)], tg);
  },
};

/** the orders a unit can take from the map, depending on what it is doing */
function mapCommands(u: UnitId): MapCommand[] {
  const k = kindOf(u);
  // the ship's speed steps are on the helm bar, always at hand; here its decoys and its defence drones
  if (k === 'traeger') return [
    { id: 'decoy', label: t('cmd.decoy'), title: t('cmd.decoyTitle') },
    { id: 'shields', label: t(shields.out ? 'cmd.shieldsIn' : 'cmd.shieldsOut'), title: t('cmd.shieldsTitle', { ship: SHIP_NAME }), on: shields.out },
    { id: 'pattern', label: t('cmd.pattern', { name: t(`shield.pattern.${shields.pattern}`) }), title: t('cmd.patternTitle') },
    { id: 'hammer', label: t('cmd.hammer'), title: t('cmd.hammerTitle'), on: hammer.watching },
  ];
  if (k === 'walrus') {
    const w = walruses[indexOf(u)];
    if (w.state === 'dock') return [{ id: 'launch', label: t('cmd.launch') }, loadCommand(u)];
    if (w.state !== 'fahren') return [];
    const c: MapCommand[] = [{ id: 'stop', label: t('cmd.stop') }, { id: 'home', label: t('cmd.home'), on: pilots.isHome(w) }];
    if (w.load.cargo === 'accb' && w.medium === 'land') c.push({ id: 'cargo', label: t('cmd.accb') });
    if (w.load.cargo === 'tank') c.push({ id: 'cargo', label: t('cmd.tank') });
    return c;
  }
  if (k === 'manta') {
    const m = mantas[indexOf(u)];
    if (m.state === 'deck') return [{ id: 'launch', label: t('cmd.start') }, loadCommand(u), strikeCommand(m)];
    if (m.state === 'flug') {
      const c: MapCommand[] = [{ id: 'hold', label: t('cmd.orbit'), title: t('cmd.orbitTitle') }, { id: 'land', label: t('cmd.land'), title: t('cmd.landTitle') }];
      if (m.load.centre === 'quaker') c.push({ id: 'bomb', label: t('cmd.quaker') });
      const pad = nearestPad(m.pos.x, m.pos.z);
      if (pad) c.push({ id: 'pad', label: t('cmd.pad'), title: t('cmd.padTitle', { island: pad.name }) });
      c.push(strikeCommand(m));
      return c;
    }
    if (m.state === 'pad') return [{ id: 'launch', label: t('cmd.start') }, strikeCommand(m)];
    return [];
  }
  if (drone.state === 'deck') return [{ id: 'launch', label: t('cmd.start') }, loadCommand(u)];
  if (drone.state === 'flug') return [{ id: 'hold', label: t('cmd.hover') }, { id: 'home', label: t('cmd.home') }];
  if (drone.state === 'rueckkehr') return [{ id: 'hold', label: t('cmd.cancelReturn') }];
  return [];
}
/** the Skua card's attack button: picks a target (the map's next click, or the lock in the cockpit), or calls the strike off */
const strikeCommand = (m: Manta): MapCommand => strikes.active(m)
  ? { id: 'strike', label: t('cmd.strikeOff'), title: t('cmd.strikeOffTitle'), on: true }
  : { id: 'strike', label: t('cmd.strike'), title: t('cmd.strikeTitle') };
/** the card's cargo button: what the unit takes along (the weapons are built in); a press steps on */
function loadCommand(u: UnitId): MapCommand {
  const k = kindOf(u), v = unitOf(u)!;
  const what = k === 'walrus' ? otterCargoName((v as Walrus).fit.cargo, (v as Walrus).fit.role)
    : k === 'drohne' ? (drone.pod ? GOODS.funk.name : t('load.none')) : skuaCargoName(skuaCargoOf((v as Manta).fit));
  return { id: 'load', label: t('cmd.load'), title: t('cmd.loadTitle', { what }) };
}
/** the next cargo the hold has (aboard the goods are swapped at once) */
function nextLoad(u: UnitId) {
  const st = carrier.stores, names = (g: Good) => GOODS[g].short, name = unitName(fleet, u);
  if (kindOf(u) === 'walrus') {
    const w = walruses[indexOf(u)], i = OTTER_CARGO.findIndex(o => o.cargo === w.fit.cargo && (o.cargo !== 'accb' || o.role === w.fit.role));
    for (let k = 1; k <= OTTER_CARGO.length; k++) {
      const o = OTTER_CARGO[(i + k) % OTTER_CARGO.length], next = otterFit(o.cargo, o.role);
      // (a Harbinger launcher takes what the hold has, up to four: docking fills it up later)
      if (o.cargo === 'harbinger') {
        next.missiles = Math.min(HARBINGER_LOAD, st.harbinger + (w.load.cargo === 'harbinger' ? w.load.missiles : 0));
        if (!next.missiles) continue;
      }
      if (refit(st, walrusGoods(w.load), walrusGoods(next), names)) continue;   // not in the hold: the next one
      w.fit = next;
      w.load = { ...w.load, cargo: next.cargo, role: next.role, missiles: next.missiles };
      showGear(w);
      notify(t('order.load', { unit: name, what: otterCargoName(next.cargo, next.role) }));
      return;
    }
  } else if (kindOf(u) === 'drohne') {
    // the drone: with or without the long-range radio pod
    const pod = !drone.pod;
    if (refit(st, drone.pod ? { funk: 1 } : {}, pod ? { funk: 1 } : {}, names)) { notify(t('order.noPod'), 'bad'); return; }
    drone.pod = pod;
    notify(t('order.load', { unit: name, what: pod ? GOODS.funk.name : t('load.none') }));
  } else {
    const m = mantas[indexOf(u)], i = SKUA_CARGO.indexOf(skuaCargoOf(m.fit));
    for (let k = 1; k <= SKUA_CARGO.length; k++) {
      // (four missiles: one more under each wing; back to one each, the second ones go back into the hold)
      const c = SKUA_CARGO[(i + k) % SKUA_CARGO.length], wing = (n: number) => c === 'raketen' ? Math.min(2, n + 1) : Math.min(1, n);
      const next = { left: wing(m.load.left), right: wing(m.load.right), centre: c === 'raketen' ? null : c };
      if (refit(st, skuaCargoGoods(m.load), skuaCargoGoods(next), names)) continue;
      m.fit = skuaFit(c);
      m.load = next;
      showGear(m);
      notify(t('order.load', { unit: name, what: skuaCargoName(c) }));
      return;
    }
  }
}
function mapCommand(u: UnitId, id: string) {
  const k = kindOf(u), name = unitName(fleet, u);
  if (k === 'traeger') {
    if (id === 'decoy') launchDecoys();
    else if (id === 'shields') toggleShields();
    else if (id === 'pattern') notify(t('shield.patternSet', { name: t(`shield.pattern.${shields.cyclePattern()}`) }));
    else if (id === 'hammer') hammerAction();
    return;
  }
  if (id === 'load') { nextLoad(u); return; }
  if (k === 'walrus') {
    const w = walruses[indexOf(u)];
    if (id === 'launch') { w.toggleLaunch(); notify(t('order.launching', { unit: name })); }
    else if (id === 'stop') { pilots.stopWalrus(w); notify(t('order.stop', { unit: name })); }
    else if (id === 'home') { pilots.homeWalrus(w); notify(t('order.home', { unit: name })); }
    else if (id === 'cargo') { pickUnit(u); useCargo(); }
  } else if (k === 'manta') {
    const m = mantas[indexOf(u)];
    if (id === 'hold') { pilots.setManta(m, new THREE.Vector2(m.pos.x, m.pos.z)); notify(t('order.orbitHere', { unit: name })); return; }
    if (id === 'bomb') { m.dropBomb(combat); return; }
    if (id === 'pad') { const pad = nearestPad(m.pos.x, m.pos.z); pilots.setManta(m, null); if (pad) m.landOnPad(pad); return; }
    if (id === 'strike') {
      if (strikes.active(m)) { strikes.recall(m); notify(t('strike.recall', { unit: name })); voice.say('angriff-heim'); return; }
      // in its cockpit with a missile lock on an enemy: that one; otherwise the map's next click picks it
      if (!map.open && m === manta && active === 'manta' && m.lock && m.lock.team === 'feind') { orderStrike(m, m.lock); return; }
      if (!map.open) { map.toggle(); sound.blip(); }
      map.select(u);
      map.strikeFor = u;
      notify(t('strike.pick', { unit: name }));
      return;
    }
    pilots.setManta(m, null);
    m.toggleLaunch();   // on the lift: catapult start; in the air: landing approach
  } else {
    if (id === 'launch') drone.toggleLaunch(); else if (id === 'hold') drone.hold(); else if (id === 'home') drone.recall();
  }
}
/** "Wenden" (the camera bar's button, U, the pad's right stick pressed): a Skua in the air turns about (an auto-attack is called off) */
function turnSkua(m: Manta) {
  if (m.state !== 'flug') return;
  if (strikes.active(m)) strikes.drop(m);
  pilots.turnManta(m);
  notify(t('order.turn', { unit: m.name }));
}
const fleetStatus = new FleetStatus(fleet);
const map = new MapView(world, bases, fleet, survey, mapActions, fleetStatus);
map.supply = { economy, transfer };
map.wind = () => ({ x: env.windX, z: env.windZ });
// observation drones: the player's with its reach, the enemy's while its ship is in sight
map.observers = () => [
  ...(hammer.drone ? [{ x: hammer.drone.pos.x, z: hammer.drone.pos.z, foe: false, reach: hammer.watching ? HAMMERHEAD.reach : 0 }] : []),
  ...(foeHammer.drone && enemyContact.visible ? [{ x: foeHammer.drone.pos.x, z: foeHammer.drone.pos.z, foe: true, reach: 0 }] : []),
];
// ---------- the Skuas' own strikes (the card's "Attack": the map's next click picks the target) ----------
const strikes = new Strikes(carrier, pilots, combat, (x, z) => {
  const ds = Math.hypot(x - carrier.pos.x, z - carrier.pos.z), dd = drone.relay ? Math.hypot(x - drone.pos.x, z - drone.pos.z) : Infinity;
  return dd < ds ? { at: drone.pos, dist: dd } : { at: carrier.pos, dist: ds };
});
map.strikes = () => strikes.lines();
/** the enemy a map click means for a strike: its carrier or a unit in sight, or a building on an island seen, nearest (x, z) within r */
function strikeTargetAt(x: number, z: number, r: number): Target | null {
  const cands: Target[] = [];
  if (enemyContact.visible && enemyShip.alive) cands.push(enemyShip);
  for (const [v, c] of foeContacts) if (c.visible && foeOut(v) && v.alive) cands.push(v);
  bases.forEach((b, k) => { if (b.team === 'feind') for (const bd of b.buildings) if (bd.alive && survey.seen(k, bd.p.x, bd.p.z)) cands.push(bd); });
  let best: Target | null = null, bd = r;
  const c = new THREE.Vector3();
  for (const tg of cands) { const d = Math.hypot(tg.centre(c).x - x, c.z - z); if (d < bd) { bd = d; best = tg; } }
  return best;
}
function orderStrike(m: Manta, tg: Target) {
  const why = strikes.order(m, tg);
  if (why) { notify(why, 'bad'); return; }
  notify(t('strike.go', { unit: m.name, target: tg.name }), 'good');
  sound.blip('good');
  voice.say('angriff-start');
}
// the defence drones round the ships: the player's always, the enemy's while its ship is in sight
map.shields = () => [
  ...shields.drones.filter(d => d.alive).map(d => ({ x: d.pos.x, z: d.pos.z, foe: false })),
  ...(enemyContact.visible ? foeShields.drones.filter(d => d.alive).map(d => ({ x: d.pos.x, z: d.pos.z, foe: true })) : []),
];
const clockText = () => { const hh = Math.floor(env.time), mm = Math.floor((env.time - hh) * 60); return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; };
/** the campaign date: the first day plus the midnights since */
const dateText = () => {
  const d = new Date(START_DATE[0], START_DATE[1], START_DATE[2] + env.day);
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
};
/** the game clock `sec` simulation seconds from now */
const clockAt = (sec: number) => {
  const h = (env.time + sec * params.tempo / 60) % 24, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};
// ---------- the enemy in sight: radar, island masts, the eyes of the units ----------
/** game time in hours since the first day's midnight */
const gameHours = () => env.day * 24 + env.time;
/** a Skua in the air (taking off and landing count) */
const airborne = (m: Manta) => m.state === 'flug' || m.state === 'landung' || m.state === 'padland' || m.state === 'padstart';
/** everything of a side that can spot the other's units, with its range (fog and night shorten the eyes, not the radar) */
function eyesOf(team: 'spieler' | 'feind'): Eye[] {
  const mine = team === 'spieler';
  const ship = mine ? carrier : enemyShip, otters = mine ? walruses : foeOtters, skuas = mine ? mantas : foeSkuas;
  const out: Eye[] = [{ x: ship.pos.x, z: ship.pos.z, range: SIGHT.shipRadar }];
  const eye = (r: number) => Math.min(r, env.w.fogFar) * (1 - 0.4 * darkness());
  for (const w of otters) if (w.state === 'fahren') out.push({ x: w.pos.x, z: w.pos.z, range: eye(SIGHT.otter) });
  for (const m of skuas) {
    const up = airborne(m);
    if (up || m.state === 'pad') out.push({ x: m.pos.x, z: m.pos.z, range: eye(up ? SIGHT.skua : SIGHT.otter) });
  }
  if (mine && drone.flying) out.push({ x: drone.pos.x, z: drone.pos.z, range: eye(SIGHT.drone) });
  for (const b of bases) {
    if (b.team !== team) continue;
    for (const bd of b.buildings) if (bd.alive && (bd.p.type === 'funkmast' || bd.p.type === 'kommandozentrale')) out.push({ x: bd.p.x, z: bd.p.z, range: SIGHT.islandRadar });
  }
  return out;
}
/** something of the player's sees (x, z), or a circle of radius r around it */
function playerSees(x: number, z: number, r = 0): boolean {
  return eyesOf('spieler').some(e => Math.hypot(e.x - x, e.z - z) <= e.range + r);
}
/** compass point from the Stoorworm towards (x, z) */
const pointTo = (x: number, z: number) => POINTS[Math.round(bearing(Math.atan2(x - carrier.pos.x, z - carrier.pos.z)) / 45) % 8];
/** what the player knows of the enemy's vehicles: only those in sight show (no last positions) */
const foeContacts = new Map<Walrus | Manta, Contact>([...foeOtters, ...foeSkuas].map(v => [v, new Contact()]));
const foeOut = (v: Walrus | Manta) => (v instanceof Walrus ? v.state === 'fahren' : airborne(v) || v.state === 'pad');
function updateSighting(dt: number) {
  const s = enemyShip, mine = eyesOf('spieler'), hours = gameHours();
  const ev = enemyContact.update(dt, mine, { x: s.pos.x, z: s.pos.z, heading: s.heading, speed: s.speed }, hours);
  const dist = (x: number, z: number) => km(Math.hypot(x - carrier.pos.x, z - carrier.pos.z));
  if (ev === 'sighted') { notify(t('enemy.sighted', { ship: ENEMY_SHIP_NAME, dist: dist(s.pos.x, s.pos.z), dir: pointTo(s.pos.x, s.pos.z) }), 'bad'); voice.say('feind-traeger'); }
  else if (ev === 'lost') { notify(t('enemy.lost', { ship: ENEMY_SHIP_NAME })); voice.say('feind-traeger-weg'); }
  // its vehicles: a message the first time one comes into view on a sortie
  for (const [v, c] of foeContacts) {
    if (!foeOut(v)) { c.visible = false; announced.delete(v); continue; }
    const heading = v instanceof Walrus ? v.heading : v.yaw;
    if (c.update(dt, mine, { x: v.pos.x, z: v.pos.z, heading, speed: v.speed }, hours) !== 'sighted' || announced.has(v)) continue;
    announced.add(v);
    if (v instanceof Manta) { notify(t('foe.skuaSighted', { dist: dist(v.pos.x, v.pos.z), dir: pointTo(v.pos.x, v.pos.z) }), 'bad'); voice.say('feind-skua'); }
    else {
      // on or just off an island it is named, out at sea the way from the ship
      const near = world.nearest(v.pos.x, v.pos.z), isl = near.island.distanceTo(v.pos.x, v.pos.z) < 1500 ? near.island : null;
      notify(isl ? t('foe.otterSighted', { island: isl.name }) : t('foe.otterSightedSea', { dist: dist(v.pos.x, v.pos.z), dir: pointTo(v.pos.x, v.pos.z) }), 'bad');
    }
  }
  // the Stoorworm under fire (at most every 20 s)
  if (carrier.hp < shipHp - 0.5 && env.elapsed - shipHitSaid > 20) { shipHitSaid = env.elapsed; notify(t('foe.shipHit', { ship: SHIP_NAME }), 'bad'); voice.say('schiff-beschuss'); }
  // and badly damaged (said again once it has been repaired above half)
  const low = carrier.maxHp * 0.3;
  if (carrier.hp < low && shipHp >= low && carrier.alive) voice.say('schiff-schaden');
  shipHp = carrier.hp;
}
let shipHp = carrier.hp, shipHitSaid = -99;
/** enemy vehicles reported on their current sortie */
const announced = new Set<Walrus | Manta>();
/** what the enemy's strategy does that the player hears of */
function omegaEvent(e: OmegaEvent) {
  if (e.kind === 'accb') {
    const isl = world.islands[e.island];
    if (playerSees(isl.cx, isl.cz, isl.size / 2)) { notify(t('foe.accb', { island: isl.name }), 'bad'); voice.say('feind-accb'); }
  } else if (e.kind === 'attack') { notify(t('foe.attack', { island: world.islands[e.island].name }), 'bad'); islandAlarm(e.island, 'attack'); voice.say('insel-angriff'); }
  // the island's own radar sees the Skuas coming
  else if (e.kind === 'raid') { notify(t('foe.raid', { island: world.islands[e.island].name }), 'bad'); islandAlarm(e.island, 'raid'); voice.say('feind-luftangriff'); }
}
/** radio reconnaissance (at the start, and in a game where the enemy was never seen): where its ship was heard of last */
function radioIntel() {
  const s = enemyShip, near = world.nearest(s.pos.x, s.pos.z).island;
  enemyContact.last = { x: s.pos.x, z: s.pos.z, heading: s.heading, speed: s.speed, hours: gameHours() };
  notify(t('enemy.intel', { ship: ENEMY_SHIP_NAME, island: near.name, dir: pointTo(s.pos.x, s.pos.z) }), 'bad');
}
/** "vor 14 min" for a game time in hours */
function agoText(hours: number): string {
  const min = Math.max(0, (gameHours() - hours) * 60);
  return min < 1 ? t('enemy.ago.now') : min < 120 ? t('enemy.ago.min', { n: Math.round(min) }) : t('enemy.ago.h', { n: Math.round(min / 60) });
}
/** the status bar's enemy field: in view red with distance and direction, otherwise when it was seen last */
function enemyStatus(): { cls: string; text: string } {
  const c = enemyContact, s = enemyShip;
  if (s.hp <= 0) return { cls: 'ok', text: t('enemy.sunk', { ship: ENEMY_SHIP_NAME }) };
  if (c.visible) return { cls: 'bad', text: t('enemy.near', { ship: ENEMY_SHIP_NAME, dist: km(Math.hypot(s.pos.x - carrier.pos.x, s.pos.z - carrier.pos.z)), dir: pointTo(s.pos.x, s.pos.z) }) };
  if (c.last) return { cls: 'warn', text: t('enemy.lastSeen', { ago: agoText(c.last.hours) }) };
  return { cls: '', text: t('enemy.unknown') };
}
map.status = () => ({ time: clockText(), date: dateText(), weather: weatherName(env.weather, env.strength), weatherId: env.weather, enemy: enemyStatus() });
map.enemyUnits = () => [...foeContacts].filter(([v, c]) => c.visible && foeOut(v)).map(([v]) => (v instanceof Walrus
  ? { kind: 'walrus' as const, name: v.name, x: v.pos.x, z: v.pos.z, heading: v.heading }
  : { kind: 'manta' as const, name: v.name, x: v.pos.x, z: v.pos.z, heading: v.yaw }));
map.enemy = (): EnemyView | null => {
  const c = enemyContact, s = enemyShip, at = c.visible ? { x: s.pos.x, z: s.pos.z, heading: s.heading, speed: s.speed } : c.last;
  // (gone under: off the map and the radar)
  if (!at || s.sunk) return null;
  return {
    name: ENEMY_SHIP_NAME, visible: c.visible, x: at.x, z: at.z, heading: at.heading, speed: at.speed, hull: s.hp / s.maxHp,
    age: c.last ? agoText(c.last.hours) : '', dist: Math.hypot(at.x - carrier.pos.x, at.z - carrier.pos.z),
  };
};
/** time and weather on the map: clock, date, weather, wind, visibility, sea, and the forecast of the next two changes */
map.info = () => {
  const w = env.w, sea = w.waves < 0.8 ? t('wx.sea.calm') : w.waves < 1.3 ? t('wx.sea.slight') : w.waves < 2.2 ? t('wx.sea.moderate') : t('wx.sea.rough');
  const note = !params.zeitLaeuft ? t('wx.stopped') : params.zeitraffer > 1 ? t('info.timewarp', { n: params.zeitraffer }) : '';
  const forecast = !weather.enabled ? t('wx.none') : weather.plan.slice(0, 2).map(f => t('wx.item', {
    when: params.zeitLaeuft ? t('wx.at', { time: clockAt(f.in) }) : t('wx.in', { min: Math.max(1, Math.round(f.in / 60)) }),
    weather: weatherName(f.weather, f.strength), wind: windShort(f.wind, weatherAt(f.weather, f.strength).wind),
  })).join(' · ');
  // the wind over the next 24 game hours: six slots of 4 hours from the next full hour, each with its strongest wind
  const perHour = 60 / params.tempo, next = Math.ceil(env.time + 1e-6), slots: string[] = [];
  for (let i = 0; i < 6; i++) {
    const hours = next - env.time + i * 4, at = weather.strongest(Math.max(0, hours - (i ? 0 : next - env.time)) * perHour, (hours + 4) * perHour, (x, s) => weatherAt(x, s).wind);
    const ms = weatherAt(at.weather, at.strength).wind, deg = Math.atan2(Math.cos(at.wind), -Math.sin(at.wind)) * 180 / Math.PI;
    const label = params.zeitLaeuft ? `${String((next + i * 4) % 24).padStart(2, '0')}:00` : t('wx.slotIn', { h: Math.round(hours) });
    const level = ms < 4 ? 'calm' : ms < 9 ? 'light' : ms < 15 ? 'fresh' : 'storm';
    slots.push(`<div class="ws ${level}" title="${windShort(at.wind, ms)} · ${weatherName(at.weather, at.strength)}"><small>${label}</small>` +
      `<span><svg viewBox="0 0 14 14" style="transform:rotate(${deg.toFixed(0)}deg)"><path d="M7 1.5 11 9H8v3.5H6V9H3z"/></svg><b>${num(ms * 1.943844)}</b></span></div>`);
  }
  return `<div class="wxnow"><b class="wxclock">${clockText()}</b>${note ? `<small>${note}</small>` : ''}<span>${weatherIcon(env.weather)}<b>${weatherName(env.weather, env.strength)}</b></span>` +
    `<span>${t('wx.wind')} <b>${windShort(env.windAngle, w.wind)}</b></span><span>${t('wx.visibility')} <b>${km(w.fogFar, w.fogFar < 3000 ? 1 : 0)}</b></span>` +
    `<span>${t('wx.sea')} <b>${sea}</b></span></div>` +
    `<div class="wxfc"><span>${t('wx.forecast')}</span>${forecast}</div>` +
    `<div class="wxwind"><span>${t('wx.windDay')}</span>${slots.join('')}</div>`;
};
// ---------- the Stoorworm's helm: across the bottom, over the 3D view and the map alike ----------
const helm = new HelmBar(carrier, fleetStatus, {
  gear(n) { carrier.setThrottle(n); notify(t('order.shipStep', { ship: SHIP_NAME, step: THROTTLE[n].name })); },
  clearWaypoint: () => mapActions.clearWaypoint('traeger'),
  depot: () => map.courseToDepot(),
  plot() {
    if (!map.open) { map.toggle(); sound.blip(); }
    map.select('traeger');
  },
  plotting: () => map.open && map.selected === 'traeger',
  progress: () => mapActions.progress('traeger'),
  turret() {
    if (turretInHand()) {
      // back to the unit and the camera the player came from
      const back = turretBack;
      turretBack = null;
      if (back && back.v !== 'traeger') setVehicle(back.v);
      selectCam(back && cams.cams.some(c => c.id === back.cam) ? back.cam : DEFAULT_CAM.traeger);
    } else {
      if (!carrier.alive) return;
      turretBack = { v: active, cam: cams.current?.id ?? DEFAULT_CAM.traeger };
      if (map.open) map.toggle();
      if (active !== 'traeger') setVehicle('traeger');
      selectCam(TURRET_CAM);
    }
    sound.blip();
  },
  turretState: () => ({ hand: turretInHand(), over: defence.laser.overheated }),
});
/** where the turret button came from (it goes back there) */
let turretBack: { v: Vehicle; cam: string } | null = null;
// ---------- the camera bar over the Stoorworm's: trackpad switch, cameras, zoom, straight ahead ----------
const camBar = new CamBar({
  togglePointer: () => { if (pointer.locked) pointer.release(); else pointer.capture(); },
  pointerLocked: () => pointer.locked,
  camera: (step) => nextCamera(step),
  cameraName: () => cams.current?.label ?? '',
  zoom: (f) => cams.zoomBy(f),
  zoomLevel: () => ({ now: cams.zoomLevel, max: cams.current?.maxZoom ?? 6 }),
  ahead: () => cams.resetHead(),
  turnState: () => active === 'manta' && manta.state === 'flug' ? pilots.isTurning(manta) : null,
  turn: () => turnSkua(manta),
});
map.bottomInset = () => helm.height;
// ---------- the console: the same two columns over the 3D view and the map ----------
const deck = new Deck(fleetStatus, {
  observer: () => hammer.drone ? t('deck.observer', { h: num(Math.round(hammer.drone.pos.y)), n: carrier.stores.hammerhead }) : '',
  shields: () => shields.flying
    ? t('deck.shields', { n: shields.standing, pattern: t(`shield.pattern.${shields.pattern}`), hold: carrier.stores.abwehrdrohne }) : '',
  turret: () => {
    const over = defence.laser.overheated, hand = turretInHand();
    const line = over ? t('deck.turret.over') : hand ? t('deck.turret.hand')
      : defence.missile ? t('deck.turret.missile') : defence.unit ? t('deck.turret.unit', { target: defence.unit.name }) : '';
    return { line, heat: defence.laser.heat, over };
  },
  active: activeId,
  blockUnit: monUnit,
  target: () => (map.open ? map.selected : null),
  topUnit: () => (map.open ? map.selected : activeId()),
  mapOpen: () => map.open,
  aim(u) {
    if (!map.open) { map.toggle(); sound.blip(); }
    map.select(u);
  },
  centre: (u) => map.centreOn(u),
  cockpit,
  commands: mapCommands,
  command: mapCommand,
  clearWaypoint: (u) => mapActions.clearWaypoint(u),
  order: unitOrder,
  progress: (u) => mapActions.progress(u),
  camera: () => (params.entwickler ? t('cam.dev') : cams.current?.label ?? '—'),
  island(x, z) {
    const near = world.nearest(x, z);
    return `${near.island.name} <small>${t('deck.island', { dist: km(near.distance), what: nearTeam(near.island) })}</small>`;
  },
  extra: (u) => (kindOf(u) === 'walrus' ? cargoHint(walruses[indexOf(u)]) : kindOf(u) === 'drohne' ? mappingText : ''),
  flag: () => (!params.zeitLaeuft ? t('wx.stopped') : params.zeitraffer > 1 ? t('info.timewarp', { n: params.zeitraffer }) : ''),
  status: () => map.status(),
});
deck.economy = economy;
// the map's supply, islands and weather sections sit in the console's columns; the map keeps clear of both columns
deck.mount(map.panels.supply, map.panels.islands, map.panels.weather);
// ---------- the player's islands under attack: the islands section, the list and the map show them for three minutes ----------
const islandAlarms = new Map<number, { what: IslandAlarm; at: number }>();
const ALARM_SHOWN = 180;
function islandAlarm(k: number, what: IslandAlarm) { islandAlarms.set(k, { what, at: env.elapsed }); }
const recentAlarms = () => [...islandAlarms].filter(([, a]) => env.elapsed - a.at < ALARM_SHOWN).sort((a, b) => b[1].at - a[1].at)
  .map(([island, a]) => ({ island, what: a.what, ago: env.elapsed - a.at }));
map.alarms = recentAlarms;
supply.alarms = recentAlarms;
// an island picked in the list: the islands section shows it, and the map
supply.pickIsland = (k) => {
  if (!map.open) map.toggle();
  map.pickIsland(k);
  map.centreOnIsland(k);
};
map.columns = () => {
  // in UI pixels (screen pixels over the interface's scale); a hidden console, e.g. under the menu, covers nothing
  const L = deck.left.getBoundingClientRect(), R = deck.right.getBoundingClientRect(), k = uiScale();
  return { l: L.width ? L.right / k + 12 : 0, r: R.width ? (innerWidth - R.left) / k + 12 : 0 };
};
// ---------- the guided first game: a card with the next step, the button it means lit up; the enemy keeps still meanwhile ----------
const tutorial = new Tutorial({
  world, bases, carrier, walruses, mantas, input,
  pointerLocked: () => pointer.locked,
  mapOpen: () => map.open,
  supplyOpen: () => supply.open,
  active: () => active,
  driving: () => (active === 'walrus' ? walrus : active === 'manta' ? manta : null),
  timewarp: () => params.zeitraffer,
  setTimewarp: (n) => { params.zeitraffer = n; },
  showIsland(k) { map.pickIsland(k); if (map.open) map.centreOnIsland(k); },
  holdEnemy: (on) => omega.setHold(on),
  notify,
  blip: () => sound.blip('good'),
});
map.onCourse = (k) => tutorial.plotted(k);
// ---------- the combat training (Hauptmenü → Kampftraining): dummies off a quiet island, no enemy, nothing saved ----------
let inTraining = false;
let range: TrainingRange | null = null;
/** the foam round the target ship's hull, as round the real ones */
let rangeRing: ReturnType<WakeField['addRing']> | null = null;
const training = new Training({
  carrier, walruses, mantas, input,
  pointerLocked: () => pointer.locked,
  active: () => active,
  driving: () => (active === 'walrus' ? walrus : active === 'manta' ? manta : null),
  turretInHand: () => turretInHand(),
  observer: () => (!hammer.drone ? 'none' : hammer.watching ? 'ready' : 'climbing'),
  obsInHand: () => obsInHand(),
  targets: () => ({
    ship: range ? range.ship.centre(new THREE.Vector3()) : carrier.pos.clone(),
    shipUp: !range || range.ship.alive,
    beach: range ? range.beach : carrier.pos.clone(),
    island: range ? world.islands[range.spot.island].name : '',
  }),
  blip: () => sound.blip('good'),
  restart: () => { leaving = true; requestBoot({ kind: 'training' }); reloadPage(`?seed=${worldSeed}&inseln=${worldCount}`); },
  leave: () => { leaving = true; reloadPage(`?seed=${worldSeed}&inseln=${worldCount}`); },
});
/** what of the player's hit a dummy (null: something the training does not ask for) */
function shotOf(e: { kind: string; source?: object }): Shot | null {
  if (e.source === defence) return 'turret';
  if (e.kind === 'hammerhead') return 'hammer';
  if (e.kind === 'harbinger') return 'harbinger';
  if (e.source instanceof Manta) return e.kind === 'rakete' ? 'skuaMissile' : e.kind === 'laser' ? 'skuaLaser' : null;
  if (e.source instanceof Walrus && e.kind === 'laser') return 'otterLaser';
  return null;
}

const crosshair = document.getElementById('crosshair')!;
const lockBox = document.getElementById('lock')!;
const hitMark = document.getElementById('hitmark')!, leadMark = document.getElementById('lead')!;
const targetInfo = document.getElementById('tinfo')!, incoming = document.getElementById('incoming')!;
combat.onHit = (e) => {
  if (e.team === 'spieler' && e.kind !== 'kanone' && e.target.team === 'feind') stats.hits++;
  if (range && e.team === 'spieler' && range.isTarget(e.target)) { const s = shotOf(e); if (s) training.hit(s, e.killed); }
  if (e.team === 'spieler' && e.target === enemyShip && !e.killed) voice.say('traeger-treffer');
  // a hit of the unit in hand: the crosshair flashes (red when it destroyed the target)
  const mine = active === 'walrus' ? walrus : active === 'manta' ? manta : turretInHand() ? defence : obsInHand() ? hammer : null;
  if (mine && e.source === mine) {
    sound.hitConfirm(e.killed);
    hitMark.className = '';
    void hitMark.offsetWidth;  // restart the fade
    hitMark.className = e.killed ? 'kill' : 'on';
  }
  // the unit in hand is hit: a red arc at the edge of the crosshair points to where the shot came from
  const hand = active === 'walrus' ? walrus : active === 'manta' ? manta : active === 'drohne' ? drone : carrier;
  if (e.target === hand) {
    const from = e.dir.clone().negate().applyQuaternion(camera.quaternion.clone().invert());
    const arc = document.createElement('div');
    arc.className = 'arc';
    arc.style.transform = `rotate(${THREE.MathUtils.radToDeg(Math.atan2(from.x, from.y)).toFixed(0)}deg)`;
    incoming.appendChild(arc);
    while (incoming.children.length > 6) incoming.firstElementChild!.remove();
    setTimeout(() => arc.remove(), 1300);
  }
};
/** K, □ or the Stoorworm block's button: a salvo of decoys (or why not) */
function launchDecoys() {
  const r = decoys.fire(combat);
  if (r === 'empty') notify(t('decoy.none'), 'bad');
  else if (r === 'reload') notify(t('decoy.reload'));
  else if (r > 0) notify(t('decoy.away', { n: carrier.stores.taeuschkoerper }));
}
combat.onDecoy = (at) => sound.decoy(at);
/** X, Pad A, a two-finger click or the block's button: up with an observation drone, to its camera, or (there) fire */
function hammerAction() {
  if (!hammer.drone) {
    const r = hammer.launchDrone();
    notify(t(r === 'empty' ? 'observer.none' : 'observer.launch'), r === 'empty' ? 'bad' : '');
  } else if (!hammer.watching) notify(t('observer.climbing'));
  else if (!obsInHand()) {
    if (active !== 'traeger') setVehicle('traeger');
    setDevCamera(false);
    selectCam(OBS_CAM);
  } else fireHammer();
}
/** a Hammerhead at what is in the observation drone's crosshair (or why not) */
function fireHammer() {
  const r = hammer.fire(hammerAim.point, hammerAim.target);
  if (r === 'empty') notify(t('hammer.none'), 'bad');
  else if (r === 'reload') notify(t('hammer.reload'));
  else if (r === 'far') notify(t('hammer.far', { km: km(hammer.drone!.pos.distanceTo(hammerAim.point)) }), 'bad');
  else if (r === 'noDrone') notify(t('hammer.noDrone'));
}
hammer.onEvent = (e) => {
  if (e === 'launch') sound.observerLaunch(hammer.drone!.pos);
  else if (e === 'drone') {
    sound.chute(hammer.drone!.pos);
    voice.say('zielsonde-bereit');
    // at the Stoorworm's controls the view switches to the pod's camera by itself (from the map as well); in an Otter,
    // a Skua or the stores it waits for X
    if (active === 'traeger' && !supply.open) {
      if (map.open) map.toggle();
      setDevCamera(false);
      syncObserverCam();
      selectCam(OBS_CAM);
      notify(t('observer.ready'), 'good');
    } else notify(t('observer.readyAway', { ship: SHIP_NAME }), 'good');
  }
  else if (e === 'spent') notify(t('observer.spent'));
  else if (e === 'away') notify(t('hammer.away', { n: carrier.stores.hammerhead }));
};
foeHammer.onEvent = (e) => {
  if (e === 'launch') sound.observerLaunch(foeHammer.drone!.pos);
  else if (e === 'drone') { sound.chute(foeHammer.drone!.pos); notify(t('observer.foeUp'), 'bad'); voice.say('feind-beobachter'); }
  else if (e === 'away') { notify(t('hammer.incoming'), 'bad'); voice.say('hammerhead-anflug'); }
};
shields.onSound = foeShields.onSound = (e, at) => { if (e === 'launch') sound.shieldLaunch(at); else sound.shieldBurst(at); };
/** L, ○ or the Stoorworm block's button: the defence drones out or in (or why not) */
function toggleShields() {
  const r = shields.toggle();
  notify(t(r === 'out' ? 'shield.out' : r === 'in' ? 'shield.in' : r === 'empty' ? 'shield.none' : 'shield.blocked'), r === 'empty' || r === 'blocked' ? 'bad' : '');
}
// a missile follows a decoy: the player's lured an enemy one away, or the enemy's one of the player's
combat.onLure = (team) => notify(t(team === 'spieler' ? 'decoy.lured' : 'decoy.foeLured'), team === 'spieler' ? 'good' : '');
// a laser turret shot a missile down: the Stoorworm's says so, and so does the enemy's when it was one of the player's
combat.onIntercept = (_at, team) => notify(t(team === 'spieler' ? 'turret.intercepted' : 'turret.foeIntercepted'), team === 'spieler' ? 'good' : '');
const messages = document.getElementById('messages')!;
function notify(text: string, cls = '') {
  const d = document.createElement('div');
  d.textContent = text;
  if (cls) d.className = cls;
  messages.prepend(d);
  sound.blip(cls === 'good' ? 'good' : cls === 'bad' ? 'bad' : 'info');
  setTimeout(() => d.remove(), 4500);
  while (messages.children.length > 5) messages.lastChild?.remove();
}
combat.onKill = ({ target, by }) => {
  // an observation drone shot down: said, but no loss and no kill in the tally
  if (target instanceof ObservationDrone) {
    notify(t('observer.down', { unit: target.name }), target.team === 'spieler' ? 'bad' : 'good');
    return;
  }
  // a defence drone burst (it did its job): said, but no loss and no kill in the tally
  if (target instanceof ShieldDrone) {
    if (target.team === 'spieler' || by === 'spieler') notify(t('shield.lost', { unit: target.name }), target.team === 'spieler' ? '' : 'good');
    return;
  }
  // a carrier's hull gave out: it goes down (and the game may end)
  if (target === enemyShip || target === carrier) { shipLost(target as CarrierController); return; }
  // the training's target ship: it goes down the same way, and a new one drops anchor after it
  if (range && target === range.ship) {
    goingDown.set(range.ship, { next: 0, fires: false, splash: false, told: false });
    effects.explosion(range.ship.centre(new THREE.Vector3()), 3, PAL.feind);
    notify(t('train.shipSunk'), 'good');
    voice.say('ziel-zerstoert');
    return;
  }
  if (target.kind === 'einheit') {
    const foe = target.team === 'feind';
    effects.explosion(target.centre(new THREE.Vector3()), 1.4, foe ? PAL.feind : PAL.ocker);
    if (foe) { if (by === 'spieler') { stats.kills++; notify(t('kill.enemyUnit', { unit: target.name }), 'good'); voice.say(target instanceof Manta ? 'skua-abschuss' : 'ziel-zerstoert'); } }
    else {
      stats.losses++; notify(t('kill.unitLost', { unit: target.name }), 'bad');
      const line: VoiceLine | null = target instanceof Manta ? 'skua-verloren' : target instanceof Walrus ? 'otter-verloren' : target instanceof Drone ? 'drohne-verloren' : null;
      if (line) voice.say(line);
    }
    return;
  }
  if (by === 'spieler') stats.buildings++;
  const base = bases.find(b => b.buildings.includes(target as never));
  // one of the player's islands hit
  if (base && by !== 'spieler' && (base.team === 'spieler' || base.formerTeam === 'spieler')) {
    const lost = (target as { p?: { type: string } }).p?.type === 'kommandozentrale';
    islandAlarm(world.islands.indexOf(base.island), lost ? 'lost' : 'hit');
  }
  // the enemy's doing far from the player's eyes is not reported
  const near = !base || base.team === 'spieler' || by === 'spieler' || playerSees(base.island.cx, base.island.cz, base.island.size / 2);
  if (near) notify(base ? t('kill.destroyedAt', { target: target.name, island: base.island.name }) : t('kill.destroyed', { target: target.name }), by === 'spieler' ? 'good' : 'bad');
  const centre = (target as { p?: { type: string } }).p?.type === 'kommandozentrale';
  if (by === 'spieler' && !centre) voice.say('ziel-zerstoert');
  if (base && centre) {
    if (by === 'spieler') { notify(t('kill.neutralised', { island: base.island.name }), 'good'); voice.say('feind-zentrale'); voice.say('insel-neutral'); }
    else if (base.formerTeam === 'spieler') { stats.islandsLost++; notify(t('kill.islandLost', { island: base.island.name }), 'bad'); }
  }
};

/** the Walrus turret aims where its camera looks (screen centre) */
const camDir = new THREE.Vector3();
/** the enemy under the Otter's crosshair or within 1.5° of it: the target info, the lead and the aim friction */
let aimTarget: Target | null = null;
/** where the turret camera looks: the Stoorworm's laser turret follows it */
const turretAim = new THREE.Vector3();
/** the player has the laser turret in hand: on the ship, through the turret camera */
const turretInHand = () => active === 'traeger' && !params.entwickler && cams.current?.id === TURRET_CAM && carrier.alive;
/** the player aims Hammerheads: on the ship, through the observation drone's camera */
const obsInHand = () => active === 'traeger' && !params.entwickler && cams.current?.id === OBS_CAM && hammer.watching;
/** what is in the observation drone's crosshair: the point, the enemy there (if any), within the drone's reach */
const hammerAim = { point: new THREE.Vector3(), target: null as Target | null, reach: false };
function updateAim() {
  defence.aim = null;
  if (obsInHand()) {
    camera.getWorldDirection(camDir);
    const hit = combat.raycast(camera.position, camDir, 9000, hammer.drone ?? undefined);
    hammerAim.point.copy(hit.point);
    hammerAim.target = hit.target && hit.target.team === 'feind' ? hit.target : combat.findTarget(camera.position, camDir, 'spieler', 9000, 1.5);
    if (hammerAim.target) hammerAim.target.centre(hammerAim.point);
    hammerAim.reach = hammer.drone!.pos.distanceTo(hammerAim.point) <= HAMMERHEAD.reach;
    aimTarget = hammerAim.target;
    return;
  }
  if (turretInHand()) {
    camera.getWorldDirection(camDir);
    const hit = combat.raycast(camera.position, camDir, 2500, carrier);
    defence.aim = turretAim.copy(hit.point);
    aimTarget = hit.target && hit.target.team === 'feind' ? hit.target : combat.findTarget(camera.position, camDir, 'spieler', 2500, 1.5);
    return;
  }
  const viaCam = !params.entwickler && cams.current?.group === 'Walrus';
  walrus.aimValid = viaCam && walrus.state === 'fahren';
  aimTarget = null;
  if (!walrus.aimValid) return;
  camera.getWorldDirection(camDir);
  const hit = combat.raycast(camera.position, camDir, 2500, walrus);
  walrus.aim.copy(hit.point);
  aimTarget = hit.target && hit.target.team === 'feind' ? hit.target : combat.findTarget(camera.position, camDir, 'spieler', 2500, 1.5);
}

/** the target under the crosshair of the laser turret or the Otter lies beyond the laser's reach (the bolts are spent
 *  before; the target is shown out to 2.5 km) */
const farFrom = new THREE.Vector3(), farTo = new THREE.Vector3();
function laserFar(): boolean {
  if (!aimTarget?.alive) return false;
  const from = turretInHand() ? defence.muzzle(farFrom) : active === 'walrus' && walrus.aimValid ? walrus.pos : null;
  return !!from && aimTarget.centre(farTo).distanceTo(from) > shotReach('laser');
}

const ndc = new THREE.Vector3();
/** put a marker on the screen where `p` is; false (and hidden) when it is behind the camera or off the picture */
function mark(el: HTMLElement, p: THREE.Vector3): boolean {
  ndc.copy(p).project(camera);
  const on = ndc.z < 1 && Math.abs(ndc.x) < 1.05 && Math.abs(ndc.y) < 1.05;
  el.style.display = on ? 'block' : 'none';
  if (on) { el.style.left = `${(ndc.x * 0.5 + 0.5) * container.clientWidth}px`; el.style.top = `${(-ndc.y * 0.5 + 0.5) * container.clientHeight}px`; }
  return on;
}
const barrelTip = new THREE.Vector3(), aheadV = new THREE.Vector3(), shooterV = new THREE.Vector3();
/** where to aim at a moving target so a shot of `speed` from `from` (moving with `vel`) meets it; null if it hardly moves */
function leadPoint(tg: Target, from: THREE.Vector3, vel: THREE.Vector3, speed: number, out: THREE.Vector3): THREE.Vector3 | null {
  if (!tg.velocity) return null;
  const v = tg.velocity(aheadV).sub(vel);
  if (v.lengthSq() < 9) return null;
  const c = tg.centre(new THREE.Vector3());
  let time = c.distanceTo(from) / speed;
  for (let i = 0; i < 3; i++) time = out.copy(c).addScaledVector(v, time).distanceTo(from) / speed;
  return out.copy(c).addScaledVector(v, time);
}
function updateCrosshair() {
  const unitCam = !params.entwickler && cams.current?.group === VEHICLE_GROUP[active];
  const turret = turretInHand(), obs = obsInHand();
  const armed = (active === 'walrus' && walrus.state === 'fahren') || (active === 'manta' && manta.state === 'flug') || turret || obs;  // the drone is unarmed
  const show = unitCam && armed && !map.open;
  crosshair.style.display = show ? 'block' : 'none';
  // the laser's heat: yellow from 70 %, red with a note while it is locked out; finer in the aim mode
  const laser = active === 'manta' ? manta.laser : turret ? defence.laser : walrus.laser;
  // (through the observation drone: red with a note while the point is beyond its reach)
  // (red as well while the target under it lies beyond the laser's reach: the target line below says so)
  const far = show && !obs && (turret || active === 'walrus') && laserFar();
  crosshair.classList.toggle('over', show && (obs ? !hammerAim.reach : laser.overheated || far));
  crosshair.classList.toggle('hot', show && !obs && !laser.overheated && laser.heat > 0.7);
  crosshair.dataset.over = obs ? t('hammer.farShort') : laser.overheated ? t('aim.overheated') : '';
  crosshair.classList.toggle('zoom', show && (active === 'walrus' || turret || obs) && cams.zoomLevel > 1.05);
  // the Otter's (or the ship's) turret is still coming round to the crosshair: it holds fire, the crosshair is pale
  crosshair.classList.toggle('turn', show && ((active === 'walrus' && walrus.aimValid && !walrus.onTarget) || (turret && !defence.onTarget)));
  const muzzle = turret ? defence.muzzle(barrelTip) : active === 'walrus' ? walrus.model.parts.barrel.localToWorld(barrelTip.set(0, 0, 5)) : manta.pos;
  // the target: the Otter's (and the turret's) under its crosshair (name and armour below it), the Skua's lock (on its frame); where to lead it
  const target = !show ? null : active === 'walrus' || turret || obs ? aimTarget : manta.lock;
  if (target && target.alive) {
    targetInfo.style.display = active === 'walrus' || turret || obs ? 'block' : 'none';
    targetInfo.firstElementChild!.textContent = `${target.name} · ${pct(target.hp / target.maxHp)}` +
      (far ? ` · ${t('aim.outOfRange', { km: km(target.centre(farTo).distanceTo(muzzle)) })}` : '');
    targetInfo.classList.toggle('far', far);
    (targetInfo.querySelector('b') as HTMLElement).style.width = `${Math.round(100 * target.hp / target.maxHp)}%`;
    if (turret) carrier.velocity(shooterV); else if (active === 'walrus') shooterV.set(0, 0, 0); else manta.velocity(shooterV);
    // (a Hammerhead needs no lead: its drone keeps it on the target)
    const lead = obs ? null : leadPoint(target, muzzle, shooterV, shotSpeed('laser'), aheadV.clone());
    if (lead) mark(leadMark, lead); else leadMark.style.display = 'none';
  } else { targetInfo.style.display = 'none'; leadMark.style.display = 'none'; }
  const lock = active === 'manta' ? manta.lock : null;
  if (lock && !map.open) {
    lock.centre(ndc).project(camera);
    if (ndc.z < 1 && Math.abs(ndc.x) < 1.1 && Math.abs(ndc.y) < 1.1) {
      lockBox.style.display = 'block';
      lockBox.style.left = `${(ndc.x * 0.5 + 0.5) * container.clientWidth}px`;
      lockBox.style.top = `${(-ndc.y * 0.5 + 0.5) * container.clientHeight}px`;
      lockBox.textContent = `${lock.name} · ${pct(lock.hp / lock.maxHp)}`;
      return;
    }
  }
  lockBox.style.display = 'none';
}

// ---------- sound per frame: listener, engines, ambience, unit events ----------
const prevState = { walrus: walrus.state as string, manta: manta.state as string, wMsg: '', mMsg: '', wHot: false, mHot: false, tHot: false, cam: '', inbound: 0 };
/**
 * The computer's warnings for the vehicle in hand while it is out: fuel (the drone's battery), armour, a weak and a
 * lost signal, each once until it has recovered a little. Taking over a vehicle that is already short says nothing.
 */
const handWarn = { unit: null as object | null, fuel: false, hp: false, weak: false, lost: false };
function handWarnings(hand: object) {
  const out = hand === walrus ? walrus.state === 'fahren' : hand === manta ? manta.state === 'flug' : hand === drone ? drone.flying : false;
  const v = hand === walrus ? { fuel: walrus.fuel, hp: walrus.hp / walrus.maxHp, signal: walrus.signal }
    : hand === manta ? { fuel: manta.fuel, hp: manta.hp / manta.maxHp, signal: manta.signal }
    : hand === drone ? { fuel: drone.battery, hp: drone.hp / drone.maxHp, signal: drone.signal } : null;
  const w = handWarn, fresh = w.unit !== hand;
  w.unit = hand;
  if (!out || !v) { w.fuel = w.hp = w.weak = w.lost = false; return; }
  const flag = (was: boolean, on: boolean, off: boolean, line: VoiceLine) => {
    if (!was && on && !fresh) voice.say(line);
    return was ? !off : on;
  };
  w.fuel = flag(w.fuel, v.fuel < 0.2, v.fuel > 0.3, 'treibstoff');
  w.hp = flag(w.hp, v.hp < 0.3, v.hp > 0.45, 'panzerung');
  w.lost = flag(w.lost, v.signal <= 0.02, v.signal > 0.2, 'funk-weg');
  w.weak = flag(w.weak, v.signal < 0.4 && !w.lost, v.signal > 0.55, 'funk-schwach');
}
// ---------- pad rumble (Einstellungen → Controller) for the unit in hand ----------
const feel = { unit: '', hp: 0, blocked: false, lock: null as unknown, warn: 0 };
function padRumble(dt: number) {
  const u = active === 'walrus' ? walrus : active === 'manta' ? manta : active === 'drohne' ? drone : carrier;
  const id = active === 'walrus' ? walrus.name : active === 'manta' ? manta.name : active;
  if (id !== feel.unit) { feel.unit = id; feel.hp = u.hp; }
  // hit
  if (u.hp < feel.hp - 0.5) input.rumble(0.9, 0.6, 160);
  feel.hp = u.hp;
  // the Otter ran into something it cannot cross
  const blocked = active === 'walrus' && walrus.blocked;
  if (blocked && !feel.blocked) input.rumble(0.5, 0, 80);
  feel.blocked = blocked;
  // the Skua locks on to a new target
  const lock = active === 'manta' ? manta.lock : null;
  if (lock && lock !== feel.lock) input.rumble(0.25, 0, 40);
  feel.lock = lock;
  // stall or a nearly empty tank: a soft pulse
  const warn = active === 'manta' && manta.state === 'flug' && (manta.speed < MIN_SPEED || manta.fuel < 0.15);
  feel.warn = warn ? feel.warn - dt : 0;
  if (warn && feel.warn <= 0) { input.rumble(0, 0.3, 120); feel.warn = 0.8; }
}

/**
 * Each view has its own soundscape (audio/sound.ts): the map and the supply screen are the operations room deep in the
 * ship, the bridge has its windows, the ship's other cameras are out on deck, the spotter pod hangs high in the wind;
 * the Skua's cockpit and the Otter's cab hear the outside through their glass, every other camera as it is
 */
function soundScene(): SoundScene {
  if (!started || params.entwickler || finale.on) return 'aussen';
  if (map.open || supply.open) return 'karte';
  const c = cams.current;
  if (c?.id === 'traeger-bruecke') return 'bruecke';
  if (c?.id === OBS_CAM) return 'sonde';
  if (c?.id === 'manta-cockpit' || c?.id === 'walrus-fahrer') return 'kabine';
  // the ship's other cameras, and the Skua's lift and the drone's pad on its deck
  return c?.anchor === cg ? 'deck' : 'aussen';
}
/** the ear in the operations room: under the map the player sits in the ship, not at the covered picture's camera */
const shipEar = new THREE.PerspectiveCamera();

function updateSound(dt: number) {
  const scene = soundScene();
  sound.scene(scene);
  const ear = scene === 'karte' && cams.placeRigid('traeger-bruecke', shipEar) ? shipEar : camera;
  // through the spotter pod the sound comes with its picture: a Hammerhead's blast at the strike, not 3 s after (and
  // so in the victory's film, whose cameras are hundreds of metres off)
  sound.listener(ear, scene === 'sonde' || finale.on);
  const toCarrier = ear.position.distanceTo(carrier.pos);
  // in the Skua's cockpit or the Otter's cab its own engine is loud
  const cabId = scene === 'kabine' ? cams.current?.id : undefined;
  const cab = cabId === 'manta-cockpit' ? 'manta' : cabId === 'walrus-fahrer' ? 'walrus' : null;
  sound.enginesUpdate({
    cab,
    carrierSpeed: Math.min(1, Math.abs(carrier.speed) / 20) + Math.max(0, Math.abs(carrier.speed) - 20) / 40,
    carrierNear: THREE.MathUtils.clamp(1 - (toCarrier - 150) / 1400, 0, 1),
    walrus: { on: walrus.state !== 'dock' && walrus.state !== 'zerstoert', rpm: Math.min(1, Math.abs(walrus.speed) / 12), pos: walrus.pos },
    manta: { on: manta.state === 'start' || manta.state === 'flug' || manta.state === 'landung' || manta.state === 'padland' || manta.state === 'padstart', thrust: manta.throttle, pos: manta.pos },
    drohne: { on: drone.flying, rpm: Math.min(1, Math.hypot(drone.vel.x, drone.vel.z) / 24 + Math.max(0, drone.vel.y) / 7), pos: drone.pos },
  });
  const seaLevel = Math.max(0, world.heightAt(ear.position.x, ear.position.z));
  sound.ambience(dt, env.w.waves, env.w.wind, env.w.rain, ear.position.y - seaLevel, env.w.dark);
  // bangs echo off the islands near the camera; the nearest fire crackles
  sound.space(1 - THREE.MathUtils.clamp(world.nearest(ear.position.x, ear.position.z).distance / 1500, 0, 1));
  const burning = effects.nearestFire(ear.position);
  sound.fireAt(burning?.pos ?? null, burning?.size ?? 0);
  // the carrier defences: the turret's servos through its camera, the nearest defence drone's propeller, the
  // nearest Hammerhead's motor (higher while it comes closer)
  sound.servo(!params.entwickler && active === 'traeger' && cams.current?.id === TURRET_CAM ? Math.min(1, defence.slew / TURRET.yawRate) : 0);
  let hum: THREE.Vector3 | null = null, humD = 250;
  for (const d of [...shields.drones, ...foeShields.drones]) {
    const dd = d.alive ? d.pos.distanceTo(ear.position) : Infinity;
    if (dd < humD) { humD = dd; hum = d.pos; }
  }
  sound.shieldHum(hum);
  const hh = combat.nearestMissile(ear.position, 2500, 'hammerhead');
  sound.missileRoar(hh?.pos ?? null, hh ? hh.vel.dot(aheadV.subVectors(ear.position, hh.pos).normalize()) : 0);
  // an enemy Skua has locked on to the unit in hand, or its missiles fly at it: warning beeps
  const hand = active === 'walrus' ? walrus : active === 'manta' ? manta : active === 'drohne' ? drone : carrier;
  const inbound = combat.missilesAt(hand);
  sound.lockWarning(dt, foeSkuas.some(m => m.state === 'flug' && m.lock === hand), inbound);
  if (inbound && !prevState.inbound) voice.say('rakete-anflug');
  prevState.inbound = inbound;
  handWarnings(hand);
  if (started) voice.update();
  // unit events
  if (manta.state !== prevState.manta) {
    if (manta.state === 'start') { sound.catapult(manta.pos); if (active === 'manta') input.rumble(0.5, 0.4, 250); }
    if (manta.state === 'deck' && prevState.manta === 'landung') { sound.clunk(manta.pos); if (active === 'manta') input.rumble(0.4, 0.3, 200); }
    prevState.manta = manta.state;
  }
  if (walrus.state !== prevState.walrus) {
    if (walrus.state === 'aussetzen' || walrus.state === 'dock') { sound.clunk(walrus.pos); if (active === 'walrus') input.rumble(0.4, 0.3, 200); }
    prevState.walrus = walrus.state;
  }
  if (walrus.message && walrus.message !== prevState.wMsg && active === 'walrus') sound.blip();
  if (manta.message && manta.message !== prevState.mMsg && active === 'manta') sound.blip();
  prevState.wMsg = walrus.message; prevState.mMsg = manta.message;
  if ((walrus.laser.overheated && !prevState.wHot && active === 'walrus') || (manta.laser.overheated && !prevState.mHot && active === 'manta')
    || (defence.laser.overheated && !prevState.tHot && turretInHand())) { sound.overheat(); input.rumble(0, 0.5, 600); voice.say('laser-heiss'); }
  prevState.wHot = walrus.laser.overheated; prevState.mHot = manta.laser.overheated; prevState.tHot = defence.laser.overheated;
  const camId = cams.current?.id ?? '';
  if (camId !== prevState.cam && prevState.cam) sound.blip();
  prevState.cam = camId;
}

// ---------- carrier: rotating radar, stern door opens while a Walrus is out ----------
let doorOpen = 0;
function animateCarrier(dt: number) {
  carrierModel.radar.rotation.y += dt * 1.1;
  const want = walruses.some(w => w.state !== 'dock' && w.state !== 'zerstoert') ? 1 : 0;
  doorOpen += THREE.MathUtils.clamp(want - doorOpen, -dt / 2.5, dt / 1.2);
  carrierModel.sternDoor.rotation.x = THREE.MathUtils.smoothstep(doorOpen, 0, 1) * 1.45;
  // the lift carries the Skua riding it and comes back up flush with the deck when it is free
  const lift = carrierModel.lift;
  if (lift) {
    const rider = mantas.find(m => m.liftY !== null);
    lift.position.y = rider ? rider.liftY! : Math.min(0, lift.position.y + dt * LIFT_SPEED);
  }
}

// ---------- Walrus: tracks and wheels roll with the speed (turning on the spot runs them in opposite directions) ----------
const tracks = new Map([...walruses, ...foeOtters].map(w => [w, { prevHeading: w.heading, phase: { 1: 0, [-1]: 0 } as Record<number, number> }]));
function animateWalrus(w: Walrus, dt: number) {
  if (dt <= 0) return;
  const t = tracks.get(w)!, model = w.model;
  let dh = w.heading - t.prevHeading;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  t.prevHeading = w.heading;
  const moving = w.state === 'fahren';
  const v = moving ? w.speed : 0, turn = moving ? dh / dt * 3.7 : 0;
  // port (+x) is the outer track in a right turn (heading decreasing)
  const vel: Record<number, number> = { 1: v - turn, [-1]: v + turn };
  for (const s of [1, -1]) t.phase[s] = (t.phase[s] + vel[s] * dt) % 1000;
  for (const wh of model.parts.wheels) wh.mesh.rotation.x += vel[wh.side] * dt / wh.r;
  const mod = (a: number) => ((a % CLEAT_PITCH) + CLEAT_PITCH) % CLEAT_PITCH - CLEAT_PITCH / 2;
  for (const c of model.parts.cleats) { c.top.position.z = mod(t.phase[c.side]); c.bottom.position.z = mod(-t.phase[c.side]); }
}

// ---------- Manta: control surfaces, gear, what hangs under it ----------
const gearOut = new Map([...mantas, ...foeSkuas].map(m => [m, 1]));
function animateManta(m: Manta, dt: number) {
  const p = m.model.parts, c = m.ctl, flying = m.state === 'flug';
  const k = Math.min(1, dt * 6);
  const pitch = flying ? c.pitch : 0, roll = flying ? c.roll : 0, yaw = flying ? c.yaw : 0;
  // elevons: together for pitch, opposite for roll; rudder for yaw
  p.elevons[0].rotation.x += (pitch * 0.3 - roll * 0.35 - p.elevons[0].rotation.x) * k;
  p.elevons[1].rotation.x += (pitch * 0.3 + roll * 0.35 - p.elevons[1].rotation.x) * k;
  p.rudder.rotation.y += (-yaw * 0.4 - p.rudder.rotation.y) * k;
  // gear: down on deck, on the landing approach and close to the ground
  const down = m.state === 'deck' || m.state === 'start' || m.state === 'pad' || m.state === 'padstart' || ((m.state === 'landung' || m.state === 'padland') && m.landPhase >= 1) || (flying && m.altitude < 25);
  const out = gearOut.get(m)! + ((down ? 1 : 0) - gearOut.get(m)!) * Math.min(1, dt * 1.2);
  gearOut.set(m, out);
  for (const leg of p.gear) leg.rotation.x = -(1 - out) * 1.55;
  showGear(m);
}

/**
 * Who is visible aboard: the stern dock shows every Walrus in its own bay; the
 * Mantas wait below deck and show only once the lift brings them up.
 */
function hangarVisibility() {
  aboard(walruses, mantas);
  aboard(foeOtters, foeSkuas);
  // the vehicles the difficulty leaves aboard, and all aboard a sunk enemy, are not seen
  foeOtters.forEach((w, i) => { if (i >= omega.tune.otters || (enemyShip.hp <= 0 && w.state === 'dock')) w.model.group.visible = false; });
  foeSkuas.forEach((m, i) => { if (i >= omega.tune.skuas || (enemyShip.hp <= 0 && m.state === 'deck')) m.model.group.visible = false; });
}
function aboard(otters: Walrus[], skuas: Manta[]) {
  for (const w of otters) {
    w.model.group.visible = w.state !== 'zerstoert';
    showGear(w);
  }
  for (const m of skuas) {
    if (m.belowDeck) m.model.group.visible = false;
    else if (m.state !== 'absturz') m.model.group.visible = true;
  }
}

/** the hangar repairs: 400 hit points per 10 s, shared by all vehicles under repair */
function hangarRepair(dt: number) {
  const inRepair = [...walruses.filter(w => w.state === 'dock'), ...mantas.filter(m => m.state === 'deck')].filter(v => v.hp < v.maxHp);
  for (const v of inRepair) v.hp = Math.min(v.maxHp, v.hp + REPAIR_PER_SECOND / inRepair.length * dt);
}

// ---------- the carriers' hulls: patched at sea, mended at a yard; smoke from a badly damaged one ----------
/** where on deck a damaged hull smokes (local x, z): one spot under half the hull, two under 40 %, three under a quarter */
const SMOKE_SPOTS: [number, number][] = [[9, 28], [-13, -48], [4, 72]];
const smokeDue = new Map<CarrierController, number>();
/** the Stoorworm's last time mending at a yard (a yard short of raw material reads as one at work for a while), and what was said */
const yardNews = { mended: -99, stay: false, noRaw: false };
function repairShips(dt: number) {
  const tune = TUNING[game.difficulty], was = carrier.repair.kind;
  const now = repairHull(carrier, dt, world, bases, economy.raw, tune.ownRepair);
  enemyShip.repair = repairHull(enemyShip, dt, world, bases, foeEconomy.raw, tune.foeRepair);
  // the news: into the yard, out of raw material there (once a stay), the work done
  const atYard = now.kind === 'werft' || now.kind === 'rohstoff';
  if (now.kind === 'werft') yardNews.mended = env.elapsed;
  const noRaw = now.kind === 'rohstoff' && (!yardNews.stay || env.elapsed - yardNews.mended > 5);
  if (atYard && !yardNews.stay && !noRaw) notify(t('repair.yard', { ship: SHIP_NAME, island: now.island }), 'good');
  if (noRaw && !yardNews.noRaw) { yardNews.noRaw = true; notify(t('repair.noRaw', { island: now.island }), 'bad'); }
  if (!atYard) yardNews.noRaw = false;
  yardNews.stay = atYard;
  if (now.kind !== was) {
    if (now.kind === 'notreparatur') notify(t('repair.patch', { pct: pct(PATCH.upTo) }));
    else if (was === 'werft' && carrier.hp >= carrier.maxHp) { notify(t('repair.done', { ship: SHIP_NAME }), 'good'); voice.say('reparatur'); }
    else if (was === 'notreparatur' && now.kind === '' && carrier.hp >= carrier.maxHp * PATCH.upTo - 0.5) notify(t('repair.patched', { pct: pct(PATCH.upTo) }));
  }
  carrier.repair = now.kind === 'rohstoff' && env.elapsed - yardNews.mended < 5 ? { ...now, kind: 'werft' } : now;
  // smoke from the deck of a hull under half (only near enough to be seen)
  for (const ship of [carrier, enemyShip]) {
    const share = ship.hp / ship.maxHp;
    if (!ship.alive || share >= 0.5 || dt <= 0 || Math.hypot(ship.pos.x - camera.position.x, ship.pos.z - camera.position.z) > 9000) continue;
    const due = (smokeDue.get(ship) ?? 0) - dt;
    if (due > 0) { smokeDue.set(ship, due); continue; }
    smokeDue.set(ship, 0.3 + Math.random() * 0.15);
    const spots = share < 0.25 ? 3 : share < 0.4 ? 2 : 1;
    for (const [x, z] of SMOKE_SPOTS.slice(0, spots)) effects.smokePuff(ship.localToWorld(x, z).setY(ship.model.group.position.y + 13), 7 + (0.5 - share) * 10);
  }
}

// ---------- drone: gimbal, radio static, mapping ----------
const staticEl = document.getElementById('static')!;
let staticUrl = '';
{
  // a small tile of noise for the radio static overlay
  const c = document.createElement('canvas'); c.width = c.height = 96;
  const g = c.getContext('2d')!, img = g.createImageData(96, 96);
  for (let i = 0; i < 96 * 96; i++) { const v = Math.random() * 255; img.data.set([v, v, v, 255], i * 4); }
  g.putImageData(img, 0, 0);
  staticUrl = c.toDataURL();
  staticEl.style.backgroundImage = `url(${staticUrl})`;
}

// ---------- the console's monitors: three screens (the ship, the Otters, the Skuas and the drone), switched underneath ----------
/** the chase cameras the Otter, Skua and drone screens show */
const MON_CAM = { walrus: 'walrus-mast', manta: 'manta-heck', drohne: 'drohne-kamera' } as const;
/** screens that get a new picture per frame: on the map two (each every other frame), beside the big 3D picture one */
const MON_PER_FRAME = { map: 2, view: 1 };
/** what each screen is switched to: a ship camera, Otter / Skua number (-1: the first one out), the drone on the Skuas' screen */
const monPick = { ship: 'traeger-bruecke', otter: -1, skua: -1, drone: false };
const MON_TITLE: Record<MonitorGroup, string> = { ship: SHIP_NAME, otter: t('type.otter'), skua: `${t('type.skua')} / ${t('drone.short')}` };
const wall = new MonitorWall(deck.slots, {
  // on the map a click picks the unit for the next click there, in the 3D view it goes into that picture
  // (the radar's screen opens the map)
  pick(g) {
    if (!map.open) {
      if (monitorState(g).radar) { map.toggle(); sound.blip(); } else this.full(g);
      return;
    }
    const u = monUnit(g);
    map.select(u); map.centreOn(u);
  },
  full(g) {
    // an Otter or a Skua goes big from its cockpit; the ship's screen keeps the camera it shows
    const id = monCamId(g);
    cockpit(monUnit(g));
    setDevCamera(false);
    if (g === 'ship') selectCam(id);
  },
  button(g, id) {
    if (g === 'ship') {
      // (beside the radar the arrows step the big picture's camera instead)
      if (monitorState('ship').radar) { nextCamera(id === 'prev' ? -1 : 1); return; }
      const list = cams.cams.filter(c => c.group === 'Träger'), i = list.findIndex(c => c.id === monPick.ship);
      monPick.ship = list[(i + (id === 'prev' ? -1 : 1) + list.length) % list.length].id;
    } else if (g === 'otter') monPick.otter = Number(id);
    else if (id === 'drone') monPick.drone = true;
    else { monPick.drone = false; monPick.skua = Number(id); }
  },
  title: (g) => t('mon.title', { unit: MON_TITLE[g] }),
}, staticUrl);
wall.radar = map.radar;
let monLive: { g: MonitorGroup; x: number; y: number; w: number; h: number }[] = [];
const monCam = new THREE.PerspectiveCamera(55, 1.6, camera.near, camera.far);
/** screens whose canvas holds a picture (one that was dark gets a new one first) */
const monDrawn = new Set<MonitorGroup>();
/** the big picture's view distance (a monitor's view picks the islands' meshes with it) */
let worldFar = 14000;
let monNext = 0;
const otterOut = (w: Walrus) => w.state !== 'dock' && w.state !== 'zerstoert';
const skuaOut = (m: Manta) => m.state !== 'deck' && m.state !== 'absturz';
/** the Otter / Skua a screen shows: the picked one, else the first one out */
const monIndex = (g: 'otter' | 'skua') => {
  const pick = g === 'otter' ? monPick.otter : monPick.skua;
  if (pick >= 0) return pick;
  const i = g === 'otter' ? walruses.findIndex(otterOut) : mantas.findIndex(skuaOut);
  return Math.max(0, i);
};
/** the unit a screen shows */
function monUnit(g: MonitorGroup): UnitId {
  if (g === 'ship') return 'traeger';
  if (g === 'otter') return unitIdOf('walrus', monIndex('otter'));
  return monPick.drone ? 'drohne' : unitIdOf('manta', monIndex('skua'));
}
function monCamId(g: MonitorGroup): string {
  return g === 'ship' ? monPick.ship : g === 'otter' ? MON_CAM.walrus : monPick.drone ? MON_CAM.drohne : MON_CAM.manta;
}
/** a camera's name, with the unit's own name for an Otter's or Skua's ("Otter 2 – Mast") */
const camLabel = (id: string, name?: string) => (cams.cams.find(c => c.id === id)?.label ?? '').replace(TYPE_PREFIX, name ?? '$1');
/** what a screen shows: its unit's camera while the unit is out, otherwise why not; in the 3D view the radar on the screen of the unit in the big picture */
function monitorState(g: MonitorGroup): MonitorState {
  const noise = (sig: number) => THREE.MathUtils.clamp((0.85 - sig) * 1.1, 0, 0.85);
  // (the radar goes on the screen that would show the big picture again: its unit through one of its cameras)
  const cur = cams.current, u = monUnit(g);
  const radar = !map.open && !params.entwickler && !!cur && u === activeId() && cur.group === VEHICLE_GROUP[kindOf(u)];
  if (g === 'ship') return { live: true, text: '', noise: 0, label: camLabel(monPick.ship), kind: 'traeger', radar };
  if (g === 'otter') {
    const w = walruses[monIndex('otter')];
    return { live: otterOut(w), text: t(w.state === 'zerstoert' ? 'mon.lost' : 'mon.aboard'), noise: noise(w.signal), label: camLabel(MON_CAM.walrus, w.name), kind: 'walrus', radar };
  }
  if (!monPick.drone) {
    const m = mantas[monIndex('skua')];
    return { live: skuaOut(m), text: t(m.state === 'absturz' ? 'mon.lost' : 'mon.aboard'), noise: noise(m.signal), label: camLabel(MON_CAM.manta, m.name), kind: 'manta', radar };
  }
  const out = drone.state !== 'deck' && drone.state !== 'zerstoert';
  return { live: out, text: t(drone.state === 'zerstoert' ? 'mon.lost' : 'mon.aboard'), noise: out ? noise(drone.signal) : 0, label: t('drone.short'), kind: 'drohne', radar };
}
/** the unit the player drives shows on its group's screen (Tab, V or a unit's cockpit button switch it) */
let monFollow = '';
function followActive() {
  const u = activeId();
  if (u === monFollow) return;
  monFollow = u;
  const k = kindOf(u);
  if (k === 'walrus') monPick.otter = indexOf(u);
  else if (k === 'manta') { monPick.skua = indexOf(u); monPick.drone = false; }
  else if (k === 'drohne') monPick.drone = true;
}
/** the switch row under a screen (the drone is the Skuas' fifth) */
function monitorButtons(g: MonitorGroup): MonitorButton[] {
  const now = performance.now() / 1000, lamp = (u: UnitId) => fleetStatus.lamp(u, now, false).cls;
  if (g === 'ship') return [{ id: 'prev', text: '◀', title: t('mon.prevCam') }, { id: 'next', text: '▶', title: t('mon.nextCam') }];
  const kind = g === 'otter' ? 'walrus' : 'manta', n = g === 'otter' ? walruses.length : mantas.length, i = monIndex(g);
  const units = Array.from({ length: n }, (_, k) => ({ id: String(k), text: String(k + 1), on: k === i && !(g === 'skua' && monPick.drone), lamp: lamp(unitIdOf(kind, k)) }));
  return g === 'otter' ? units : [...units, { id: 'drone', text: t('drone.short'), on: monPick.drone, lamp: lamp('drohne') }];
}
/** where a screen looks from (bases near it are shown) */
const monPos = (g: MonitorGroup) => fleetStatus.unitPos(monUnit(g));
/**
 * The monitors' pictures: a few screens a frame (in turn) are rendered into
 * their own rectangle of the 3D canvas (with its antialiasing, tone mapping
 * and colours) and copied from there onto the screen's canvas, which sits on
 * top of the console and keeps the picture until the next turn. (Seen through
 * the console's tinted panels, the 3D canvas itself would only show dimly.)
 */
function renderMonitors() {
  for (const g of monDrawn) if (!monLive.some(m => m.g === g)) monDrawn.delete(g);
  if (!monLive.length) return;
  const pr = renderer.getPixelRatio(), H = container.clientHeight, src = renderer.domElement;
  // screens without a picture first, then in turn
  const order = [...monLive.filter(m => !monDrawn.has(m.g)), ...monLive.slice(monNext), ...monLive.slice(0, monNext)];
  const done = new Set<MonitorGroup>(), per = map.open ? MON_PER_FRAME.map : MON_PER_FRAME.view;
  renderer.setScissorTest(true);
  for (const m of order) {
    if (done.size >= per || done.has(m.g)) continue;
    done.add(m.g);
    const id = monCamId(m.g);
    const placed = m.g === 'otter' ? cams.placeRigidOn(id, walruses[monIndex('otter')].model.group, monCam)
      : m.g === 'skua' && !monPick.drone ? cams.placeRigidOn(id, mantas[monIndex('skua')].model.group, monCam) : cams.placeRigid(id, monCam);
    if (!placed) continue;
    monCam.aspect = m.w / m.h;
    monCam.updateProjectionMatrix();
    // the sky dome, the sea and the islands' near or far meshes follow the camera they are seen from;
    // the light halos are sized for the big picture: scale them to this screen's height and field of view
    sky.update(env, monCam);
    ocean.update(env, monCam, m.h * pr);
    world.viewFrom(monCam.position.x, monCam.position.z, worldFar);
    GLOW_VIEW.value = (m.h / H) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(monCam.fov) / 2);
    // (in the screen's own place: on the map that part of the canvas is hidden anyway, in the 3D view the screen covers it)
    const y = H - m.y - m.h;
    renderer.setViewport(m.x, y, m.w, m.h);
    renderer.setScissor(m.x, y, m.w, m.h);
    renderer.render(scene, monCam);
    const pic = wall.picture(m.g), W = Math.max(8, Math.round(m.w * pr)), Hh = Math.max(8, Math.round(m.h * pr));
    if (pic.width !== W || pic.height !== Hh) { pic.width = W; pic.height = Hh; }
    pic.getContext('2d')!.drawImage(src, m.x * pr, m.y * pr, m.w * pr, m.h * pr, 0, 0, W, Hh);
    monDrawn.add(m.g);
  }
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, container.clientWidth, H);
  monNext = (monNext + per) % monLive.length;
  GLOW_VIEW.value = 1;
  sky.update(env, camera);
  ocean.update(env, camera, renderer.getDrawingBufferSize(bufferSize).y);
  world.viewFrom(camera.position.x, camera.position.z, worldFar);
}
let surveyTimer = 0;
let mappingText = '';
const rayDir = new THREE.Vector3();
function updateDroneCamera(dt: number) {
  const onDrone = !params.entwickler && cams.current?.id === 'drohne-kamera';
  if (onDrone) { drone.gimbalPan = cams.head.pan; drone.gimbalTilt = cams.head.tilt; }
  // weak radio link: the picture of the unit's own cameras breaks up
  const group = params.entwickler ? null : cams.current?.group;
  const sig = group === 'Drohne' && drone.flying ? drone.signal
    : group === 'Walrus' && walrus.state === 'fahren' ? walrus.signal
      : group === 'Manta' && (manta.state === 'flug' || manta.state === 'landung' || manta.state === 'pad' || manta.state === 'padland' || manta.state === 'padstart') ? manta.signal : 1;
  const noise = THREE.MathUtils.clamp((0.85 - sig) * 1.1, 0, 0.85);
  staticEl.style.opacity = noise.toFixed(2);
  if (noise > 0) staticEl.style.backgroundPosition = `${Math.random() * 96}px ${Math.random() * 96}px`;
  // the camera charts what it sees: footprint on the ground grows with distance and field of view
  surveyTimer -= dt;
  if (surveyTimer > 0) return;
  surveyTimer = 0.25;
  // (a landing place goes on the map once the drone has charted it: the ship's own sight no longer charts it, the
  // map showed ramps on islands not yet charted)
  mappingText = '';
  if (!drone.alive || drone.signal < 0.05) return;
  // a 3×3 grid of rays across the picture approximates the ground the camera sees
  const zoom = onDrone ? cams.head.zoom : 1;
  const half = { h: THREE.MathUtils.degToRad(32) / zoom, v: THREE.MathUtils.degToRad(24) / zoom };
  const reach = Math.min(1600, env.w.fogFar * 0.8);
  let centre: THREE.Vector3 | null = null;
  for (const a of [0, -0.8, 0.8]) for (const b of [0, -0.8, 0.8]) {
    const yaw = drone.yaw + drone.gimbalPan + a * half.h, tilt = drone.gimbalTilt + b * half.v;
    rayDir.set(Math.sin(yaw) * Math.cos(tilt), Math.sin(tilt), Math.cos(yaw) * Math.cos(tilt));
    if (rayDir.y > -0.05) continue;
    const hit = combat.raycast(drone.pos, rayDir, reach, drone);
    const dist = hit.point.distanceTo(drone.pos);
    if (dist >= reach - 1) continue;
    survey.reveal(hit.point.x, hit.point.z, THREE.MathUtils.clamp(dist * Math.tan(half.h * 0.45), 15, 320));
    if (a === 0 && b === 0) centre = hit.point;
  }
  if (!centre) return;
  const isl = world.islandAt(centre.x, centre.z);
  if (isl) {
    const k = world.islands.indexOf(isl), was = survey.known(k);
    mappingText = t('survey.mapping', { island: isl.name, pct: pct(survey.progress(k)) });
    if (!was && survey.known(k)) { voice.say('kartiert'); notify(t('survey.done', { island: isl.name, what: OWNER_NAMES[bases[k].team] + (bases[k].team !== 'neutral' && isl.role ? ` · ${ROLE_NAMES[isl.role]}` : '') }), 'good'); }
  }
}

/** what the Walrus panel says about its cargo */
function cargoHint(w: Walrus): string {
  const c = w.load.cargo;
  if (!c) return t('cargo.hintNone');
  if (c === 'virus') return t('cargo.hintVirus');
  if (c === 'tank') return t('cargo.hintTank');
  if (c === 'harbinger') return t('cargo.hintHarbinger', { n: w.load.missiles });
  const isl = w.medium === 'land' ? world.islandAt(w.pos.x, w.pos.z) : null;
  const free = isl && bases[world.islands.indexOf(isl)].team === 'neutral' && !bases[world.islands.indexOf(isl)].pending;
  return t('cargo.hintAccb', { role: ROLE_NAMES[w.load.role] }) + (free ? ` · ${t('cargo.hintDrop')}` : '');
}

/** owner of an island for the console (with its role while it is held), as far as it has been mapped */
function nearTeam(isl: Island): string {
  const k = world.islands.indexOf(isl), team = bases[k].team;
  if (team !== 'spieler' && !survey.known(k)) return t('near.unknown', { pct: pct(survey.progress(k)) });
  return team !== 'neutral' && isl.role ? `${OWNER_NAMES[team]} · ${ROLE_NAMES[isl.role]}` : OWNER_NAMES[team];
}

/** gameplay for one frame: sub-stepped units, islands, combat, economy, wakes */
function simulate(dt: number): number {
  // time warp: the simulation runs in fixed-size sub-steps, presses fire once
  const simDt = dt * params.zeitraffer;
  const steps = Math.max(1, Math.ceil(simDt / STEP));
  const h = simDt / steps;
  // game time: 1 game minute per real second by default (a day lasts 24 minutes)
  env.timeSpeed = params.zeitLaeuft ? params.tempo / 60 : 0;
  updateAim();
  // no shooting with the map or a window open, nor while the victory's film runs
  const armed = !map.open && !supply.open && !finale.on;
  const trigger = armed && input.down(...KEYS.fire);
  const fired = armed && input.hit(...KEYS.fire);
  const missile = armed && input.hit(...KEYS.missile);
  const harb = armed && input.hit(...KEYS.harbinger);
  // a shot at a target the laser does not reach: the computer says so
  if (fired && laserFar()) voice.say('ausser-reichweite');
  // an Assassin without a lock: a double tick (the message says why)
  if (missile && active === 'manta' && manta.state === 'flug' && !manta.lock && manta.missiles > 0) {
    input.rumble(0.3, 0, 40);
    setTimeout(() => input.rumble(0.3, 0, 40), 110);
  }
  // while a Harbinger flies, the Walrus' controls steer it
  const guiding = active === 'walrus' && !!walrus.guided && !walrus.guided.done;
  combat.wind.set(env.windX, 0, env.windZ);
  for (let i = 0; i < steps; i++) {
    // with a window open (the stores) only the keyboard drives
    const inp: InputLike = finale.on ? NO_INPUT : supply.open ? (i === 0 ? input.keysOnly : keysHeldOnly) : i === 0 ? input : input.heldOnly;
    env.update(h);
    carrier.update(h, active === 'traeger' ? inp : null);
    enemyShip.update(h, null);
    for (const w of foeOtters) w.update(h, foePilots.walrus(w, h));
    for (const m of foeSkuas) m.update(h, omega.stick(m) ?? foePilots.manta(m, h));
    // waypoint autopilots; steering by hand switches them off
    const wIn = active === 'walrus' && !guiding ? inp : null, mIn = active === 'manta' ? skuaInput(inp) : null;
    if (wIn && (walrus.waypoint || pilots.isHome(walrus)) && pilots.walrusManual(wIn)) { pilots.setWalrus(walrus, null); notify(t('pilot.offUnit', { unit: walrus.name })); }
    if (mIn && strikes.active(manta) && pilots.mantaManual(mIn)) { strikes.drop(manta); notify(t('strike.off', { unit: manta.name })); }
    if (mIn && manta.waypoint && pilots.mantaManual(mIn)) { pilots.setManta(manta, null); notify(t('pilot.offUnit', { unit: manta.name })); }
    if (mIn && pilots.turnManual(manta, mIn)) notify(t('pilot.offUnit', { unit: manta.name }));
    if (guiding) {
      walrus.guided!.steer.yaw = inp.axis(KEYS.right, KEYS.left);
      walrus.guided!.steer.pitch = inp.axis(KEYS.forward, KEYS.back);
    }
    for (const w of walruses) w.update(h, pilots.walrus(w, h) ?? (w === walrus ? wIn : null));
    for (const m of mantas) m.update(h, strikes.stick(m) ?? pilots.manta(m, h) ?? (m === manta ? mIn : null));
    drone.update(h, active === 'drohne' ? inp : null);
    for (const w of walruses) {
      const mine = w === walrus && active === 'walrus';
      w.shoot(h, mine && trigger && !guiding, combat, mine && fired && i === 0, mine && harb && i === 0);
    }
    for (const m of mantas) {
      const mine = m === manta && active === 'manta', f = strikes.fire(m);
      m.shoot(h, (mine && trigger) || f.trigger, ((mine && missile) || f.missile) && i === 0, combat);
    }
    for (const w of foeOtters) w.shoot(h, omega.fire(w).trigger, combat);
    for (const m of foeSkuas) { const f = omega.fire(m); m.shoot(h, f.trigger, f.missile && i === 0, combat); }
    for (const b of bases) b.update(h, combat);
    defence.update(h, combat, !!defence.aim && trigger);
    foeDefence.skill = omega.tune.defence;
    foeDefence.update(h, combat, false);
    if (decoys.update(h, combat)) notify(t('decoy.away', { n: carrier.stores.taeuschkoerper }));
    foeDecoys.skill = omega.tune.defence;
    foeDecoys.update(h, combat);
    shields.update(h);
    // (the enemy keeps 2, 3 or 4 out with the difficulty)
    foeShields.count = omega.tune.defence < 0.5 ? 2 : omega.tune.defence < 0.8 ? 3 : 4;
    foeShields.update(h);
    if (obsInHand() && fired && i === 0) fireHammer();
    hammer.update(h);
    foeHammer.skill = omega.tune.defence;
    foeHammer.update(h);
    combat.update(h);
  }
  advanceRoutes();
  syncObserverCam();
  foeEyesNow = eyesOf('feind');
  // (a sunk enemy has no strategy left)
  if (enemyShip.hp > 0) omega.update(simDt);
  strikes.update(simDt);
  for (const n of strikes.notices.splice(0)) { notify(n.text); if (n.home) voice.say('angriff-heim'); }
  updateEnd(simDt);
  updateSighting(simDt);
  voyageMusic(dt);
  if (params.zeitLaeuft) params.zeit = env.time;
  if (carrier.autopilotMessage) { notify(carrier.autopilotMessage); carrier.autopilotMessage = ''; }
  if (drone.notice) { notify(drone.notice, drone.state === 'zerstoert' ? 'bad' : ''); drone.notice = ''; }
  for (const m of mantas) if (m.notice) { notify(m.notice, 'bad'); m.notice = ''; }
  for (const w of walruses) if (w.notice) { notify(w.notice, w.notice === t('otter.linkLost') || w.notice === t('otter.accbLost', { unit: w.name }) ? 'bad' : ''); w.notice = ''; }
  hangarRepair(simDt);
  repairShips(simDt);
  economy.update(simDt);
  weather.horizon = 24 * 60 / params.tempo + 60;
  weather.update(simDt);
  transfer.update(simDt);
  depotRange();
  supply.update(dt);
  tutorial.update(dt);
  training.update(dt);
  if (range) {
    const back = range.update(dt, env);
    if (back.tanks) notify(t('train.raised'));
    if (back.ship) { goingDown.delete(range.ship); notify(t('train.shipBack')); }
  }
  updateWakes(simDt);
  playStats.time += dt;
  if (playStats.time - playStats.lastAuto > AUTOSAVE_EVERY) autosave();
  return simDt;
}

/** once a second: whether the Stoorworm is on a quiet voyage, and the music that goes with it */
function voyageMusic(dt: number) {
  voyage.check -= dt;
  if (voyage.check > 0) return;
  voyage.check = 1;
  const x = carrier.pos.x, z = carrier.pos.z;
  const fight = playStats.time - voyage.lastFight < VOYAGE.calmAfterFight || enemyContact.visible || [...foeContacts.values()].some(c => c.visible);
  const calm = params.seeMusik && !PROBE && game.over !== 'niederlage' && carrier.alive && carrier.speed >= VOYAGE.speed && !fight &&
    world.islands.every(i => i.distanceTo(x, z) > VOYAGE.land);
  voyage.calm = calm ? voyage.calm + 1 : 0;
  if (voyage.on && (!calm || !music.busy)) {
    // a fight or the enemy cuts it short; slowing down or land ahead lets it fade; or it has played to the end
    voyage.on = false;
    voyage.rested = playStats.time;
    music.stop(fight ? 1.5 : 6);
  } else if (!voyage.on && voyage.calm >= VOYAGE.after && playStats.time - voyage.rested > VOYAGE.rest) {
    voyage.on = true;
    void music.play({ level: VOYAGE.level, loop: false, fadeIn: 12, duck: VOYAGE.duck });
  }
}

function updateWakes(simDt: number) {
  const now = env.elapsed;
  for (const [ship, ring, curl, bow] of [[carrier, carrierRing, carrierCurl, CARRIER_BOW], [enemyShip, enemyRing, enemyCurl, FOE_BOW]] as const) {
    ring.update(ship.pos, ship.forward, ship.speed, now);
    curl.update(ship.pos, ship.forward, Math.max(0, ship.speed), env);
    spray.emit(ship, simDt, ship.pos, ship.forward, Math.max(0, ship.speed), bow, env);
  }
  for (const w of [...walruses, ...foeOtters]) {
    const afloat = w.state === 'fahren' && w.medium === 'wasser';
    otterRings.get(w)!.update(w.pos, w.forward, w.speed, now, afloat);
    otterCurls.get(w)!.update(w.pos, w.forward, Math.max(0, w.speed), env, afloat);
    if (afloat) spray.emit(w, simDt, w.pos, w.forward, Math.max(0, w.speed), OTTER_BOW, env);
  }
  if (range && rangeRing) rangeRing.update(range.ship.pos, range.ship.forward, 0, now, range.ship.alive);
  spray.update(simDt, env);
  carrierWake.update(simDt, carrier.localToWorld(0, -100), carrier.forward, carrier.speed, true, env);
  enemyWake.update(simDt, enemyShip.localToWorld(0, -100), enemyShip.forward, enemyShip.speed, true, env);
  for (const w of walruses) {
    const afloat = w.state === 'fahren' && w.medium === 'wasser';
    walrusWakes[w.index].update(simDt, w.stern, w.forward, w.speed, afloat, env);
    walrusBows[w.index].update(w.pos, w.forward, afloat ? w.speed : 0);
  }
  for (const w of foeOtters) {
    const afloat = w.state === 'fahren' && w.medium === 'wasser';
    foeWakes[w.index].update(simDt, w.stern, w.forward, w.speed, afloat, env);
    foeBows[w.index].update(w.pos, w.forward, afloat ? w.speed : 0);
  }
}

/** title screen: the sea and the ship move, nothing else happens */
let orbit = 0.6;
function idle(dt: number) {
  env.timeSpeed = 0;
  env.update(dt);
  carrier.update(dt, null);
  enemyShip.update(dt, null);
  defence.rest(dt); foeDefence.rest(dt);
  for (const w of [...walruses, ...foeOtters]) w.update(dt, null);
  for (const m of foeSkuas) m.update(dt, null);
  for (const m of mantas) m.update(dt, null);
  drone.update(dt, null);
  updateWakes(dt);
}

// ---------- a small picture of its own over the 3D view (the Harbinger's nose camera) ----------
const pipSaved = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 55, aspect: 1 };
let pipLive = false;
function renderPip(r: { x: number; y: number; w: number; h: number }) {
  if (pipLive) {
    const H = container.clientHeight, y = H - r.y - r.h;
    renderer.setScissorTest(true);
    renderer.setViewport(r.x, y, r.w, r.h);
    renderer.setScissor(r.x, y, r.w, r.h);
    renderer.render(scene, camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, container.clientWidth, H);
  }
  camera.position.copy(pipSaved.pos); camera.quaternion.copy(pipSaved.quat);
  camera.fov = pipSaved.fov; camera.aspect = pipSaved.aspect;
  camera.updateProjectionMatrix();
}

// ---------- Harbinger: the missile's nose camera in a small picture while the player steers it ----------
const guideEl = document.getElementById('guide')!;
const guideLabel = guideEl.querySelector('.glabel')!;
function renderGuideInset() {
  const g = active === 'walrus' && !params.entwickler ? walrus.guided : null;
  guideEl.style.display = g && !g.done ? 'block' : 'none';
  if (!g || g.done) return;
  const r = guideEl.getBoundingClientRect();
  guideLabel.textContent = t('guide.label', { m: Math.round(g.travelled) });
  pipSaved.pos.copy(camera.position); pipSaved.quat.copy(camera.quaternion); pipSaved.fov = camera.fov; pipSaved.aspect = camera.aspect;
  camera.position.copy(g.pos).addScaledVector(g.dir, 4.5);   // just ahead of the nose cone
  camera.lookAt(camera.position.clone().add(g.dir));
  camera.fov = 50; camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
  pipLive = true;
  renderPip({ x: r.left, y: r.top, w: r.width, h: r.height });
}

/** cameras, lights, sky, streaming, rendering, HUD */
function present(dt: number, simDt: number) {
  autoMantaCamera();
  for (const m of [...mantas, ...foeSkuas]) animateManta(m, simDt);
  for (const w of [...walruses, ...foeOtters]) animateWalrus(w, simDt);
  animateCarrier(simDt);
  hangarVisibility();
  if (params.entwickler) updateDevCamera();
  else cams.update(dt);
  // the console's monitors: where their live screens are this frame
  followActive();
  if (started && !menu.open && !finale.on) {
    const sel = kindOf(map.selected), selG: MonitorGroup = sel === 'traeger' ? 'ship' : sel === 'walrus' ? 'otter' : 'skua';
    monLive = wall.update(monitorState, monitorButtons, map.open && map.selected !== 'traeger' ? selG : null,
      (g) => fleetStatus.lamp(monUnit(g), performance.now() / 1000, false).cls);
  } else monLive = [];
  viewH = renderer.getDrawingBufferSize(bufferSize).y;
  if (!started) {
    // title screen: a slow flight around the carrier, close and low enough for the ship to carry the picture,
    // far enough out for the whole hull (the stern is at -100)
    orbit += dt * 0.035;
    if (camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix(); }
    const len = carrierModel.stemZ + 100, mid = (carrierModel.stemZ - 100) / 2, f = carrier.forward;
    const cx = carrier.pos.x + f.x * mid, cz = carrier.pos.z + f.z * mid, R = len * 1.3;
    const ex = cx + Math.cos(orbit) * R, ez = cz + Math.sin(orbit) * R;
    camera.position.set(ex, len * 0.32, ez);
    // aim left of the ship's middle so it stands at about 67 % of the width, beside the menu on the left
    const fx = cx - ex, fz = cz - ez, d = Math.hypot(fx, fz);
    const off = R * 0.34 * Math.tan(THREE.MathUtils.degToRad(27.5)) * camera.aspect;
    camera.lookAt(cx + (fz / d) * off, 14, cz - (fx / d) * off);
  }
  finale.update(dt, camera);
  updateDroneCamera(dt);
  updateLighting();
  sky.update(env, camera);
  // terrain streaming and LOD (camera plus all units count as points of interest)
  const farLimit = Math.min(14000, env.w.fogFar + 3000);
  // (the enemy's Otters too: on a coarse grid a landing's ramp blurs into the cliffs beside it)
  const out = [...[...walruses, ...foeOtters].filter(w => w.state === 'fahren').map(w => w.pos), ...mantas.filter(m => m.alive).map(m => m.pos)];
  world.update(camera.position, [carrier.pos, ...out, drone.pos, ...monLive.map(m => monPos(m.g))], farLimit);
  worldFar = farLimit;
  // bases show near the camera and near every unit on the monitor wall
  const viewers = [camera.position, ...monLive.map(m => monPos(m.g))];
  for (const b of bases) b.group.visible = viewers.some(p => b.island.distanceTo(p.x, p.z) < Math.min(7000, farLimit));
  ocean.update(env, camera, renderer.getDrawingBufferSize(bufferSize).y);
  clouds.update(env, simDt, focus);
  rain.update(env, camera, renderer.getDrawingBufferSize(bufferSize), renderer.getPixelRatio());
  nightLights(carrierModel.lights, carrierModel.glow);
  nightLights(enemyModel.lights, enemyModel.glow);
  for (const w of [...walruses, ...foeOtters]) nightLights(w.model.lights, w.model.glow);
  otterHeadlights();
  for (const m of [...mantas, ...foeSkuas]) nightLights(m.model.lights, m.model.glow);
  nightLights(droneModel.lights, droneModel.glow);
  for (const b of bases) baseLights(b);
  const vh = viewH;
  for (const m of [...mantas, ...foeSkuas]) m.model.exhaust.update(m.exhaust, camera, vh, scene.fog as THREE.Fog);
  wrecks.update(simDt);
  effects.update(simDt, env.windX, env.windZ, camera, vh, scene.fog as THREE.Fog);
  if (combat.viewer) combat.viewer.fog = scene.fog as THREE.Fog;
  wakeField.render(renderer, camera.position);
  // with the map open the monitors are the only 3D pictures (the map covers the big one), otherwise they go over it
  if (map.open) renderMonitors();
  else { post.render(bloomWanted(), rainOnGlass(simDt)); renderMonitors(); renderGuideInset(); }
  updateSound(simDt);
  padRumble(dt);
  updateCrosshair();
  const fu = active === 'traeger' ? { x: carrier.pos.x, z: carrier.pos.z, heading: carrier.heading }
    : active === 'walrus' && walrus.state === 'fahren' ? { x: walrus.pos.x, z: walrus.pos.z, heading: walrus.heading }
      : active === 'manta' && manta.alive ? { x: manta.pos.x, z: manta.pos.z, heading: manta.yaw }
        : active === 'drohne' && drone.flying ? { x: drone.pos.x, z: drone.pos.z, heading: drone.yaw }
          : { x: carrier.pos.x, z: carrier.pos.z, heading: carrier.heading };
  map.update(dt, fu);
  deck.update(dt);
  helm.update(dt);
  camBar.update(dt);
}

let lastFrameT = 0, stillDrawn = false;
function frame(now: number) {
  requestAnimationFrame(frame);
  step(now);
}
/** one frame; `fixedDt` lets tests advance the game without waiting */
function step(now: number, fixedDt?: number) {
  // optional frame cap (battery); the title screen always runs at 30 fps
  const cap = menu.open && !started ? 30 : Number(params.bildrate);
  if (fixedDt === undefined && cap < 60 && lastFrameT && now - lastFrameT < 1000 / cap - 3) return;
  lastFrameT = now;
  const dt = fixedDt ?? Math.min(clock.getDelta(), 0.1);
  renderer.info.reset();
  if (resizePending) { resizePending = false; resize(); stillDrawn = false; }
  input.pollGamepad();
  music.update(dt);
  sound.duck(music.duck);
  if (menu.open) {
    if (intro.active) intro.pad(input); else menu.pad(input, dt);
    input.endFrame();
    if (!started) { idle(dt); present(dt, dt); }
    // paused: one still picture, then the GPU rests (redrawn when a setting changes)
    else if (!stillDrawn) { env.update(0); present(0, 0); stillDrawn = true; }
    return;
  }
  // (back in the game after the end screen: its own cameras again)
  finale.release();
  // while the victory's film runs the player only watches: a click, a key or a pad button goes on
  if (finale.on) { if (input.hit('Pad.A', 'Pad.B', 'Pad.X', 'Pad.Y', 'Pad.Start')) finale.next(); if (input.hit('KeyN')) toggleSound(); }
  else { pointerFrame(dt); handleKeys(dt); }
  if (menu.open) { input.endFrame(); return; }
  const simDt = simulate(dt);
  input.endFrame();
  present(dt, simDt);

  fpsFrames++; fpsTime += dt;
  if (fpsTime > 1) {
    fps = fpsFrames / fpsTime;
    adaptResolution(fps * 60 / Number(params.bildrate), fpsTime);
    fpsFrames = 0; fpsTime = 0;
    // performance (developer settings) and the drivability figures (B) in a box under the status bar
    const perf = params.leistung || params.befahrbarkeit;
    document.body.classList.toggle('perf', perf);
    const size = renderer.getDrawingBufferSize(bufferSize);
    const near = world.nearest(focus.x, focus.z);
    const st = near.island.stats ?? { landKm2: 0, build: 0, drive: 0, steep: 0, blocked: 0 };
    if (perf) hud.innerHTML = t('top.perf', { fps: num(fps), w: size.x, h: size.y, ratio: num(pixelRatio(), 2), tri: num(renderer.info.render.triangles / 1000) }) +
      (params.befahrbarkeit ? `<br>${near.island.name} ${num(st.landKm2, 2)} km²: ` +
        `<span style="color:#3fbf5f">■</span> ${t('top.limit', { name: t('slope.build'), deg: SLOPE.BUILD, pct: pct(st.build) })} · ` +
        `<span style="color:#e8d24a">■</span> ${t('top.limit', { name: t('slope.drive'), deg: SLOPE.DRIVE, pct: pct(st.drive) })} · ` +
        `<span style="color:#ef8a2e">■</span> ${t('top.limit', { name: t('slope.steep'), deg: SLOPE.STEEP, pct: pct(st.steep) })} · ` +
        `<span style="color:#d0342c">■</span> ${t('slope.blocked')} ${pct(st.blocked)}` : '');
    help.innerHTML = pointer.locked ? pointerHelp() : helpLine(active, units, input.lastDevice === 'pad' && input.padName ? padHelp() : null, pointer.settings.clickCapture, turretInHand() ? 'turret' : obsInHand() ? 'observer' : '');
  }
}

// ---------- save games, title and pause menu ----------
const AUTOSAVE_EVERY = 180;   // seconds of play
const playStats = { time: 0, lastAuto: 0 };

// ---------- the game's course: difficulty, what was done, how it ends ----------
/** the difficulty; the enemy's carrier gone; won or lost (after a win by sinking it the game goes on) */
const game = { difficulty: 'normal' as Difficulty, omegaSunk: false, over: '' as '' | 'sieg' | 'niederlage' };
/** the tally for the end screen */
const NO_STATS = { islandsWon: 0, islandsLost: 0, kills: 0, buildings: 0, losses: 0, shots: 0, hits: 0 };
const stats = { ...NO_STATS };
function setDifficulty(d: Difficulty, fresh: boolean) {
  game.difficulty = d;
  omega.setDifficulty(d, fresh);
  combat.foeDamage = TUNING[d].damage;
}

/** a carrier's hull gave out: it burns and goes down; the enemy's vehicles out lose their ship */
/** what goes down: a carrier, or the training's target ship */
type Sinking = Pick<CarrierController, 'sinking' | 'localToWorld' | 'centre'> & { model: { group: THREE.Object3D } };
const goingDown = new Map<Sinking, { next: number; fires: boolean; splash: boolean; told: boolean }>();
function shipLost(ship: CarrierController) {
  goingDown.set(ship, { next: 0, fires: false, splash: false, told: false });
  const p = ship.centre(new THREE.Vector3());
  effects.explosion(p, 3, ship === carrier ? PAL.ocker : PAL.feind);
  if (ship === enemyShip) { notify(t('end.foeSinking', { ship: ENEMY_SHIP_NAME }), 'good'); voice.say('traeger-sinkt'); }
  else { notify(t('end.shipSinking', { ship: SHIP_NAME }), 'bad'); voice.say('schiff-sinkt'); }
  // a carrier is hit for good: the victory (the enemy's) or the defeat (the player's own), as a film of it going
  // down, then the end screen. (The player's going down takes over from a victory's film still running, and comes
  // as a film after a victory played on too)
  if (!started || game.over === 'niederlage') return;
  if (ship === enemyShip && !game.omegaSunk && !goingDown.has(carrier)) startFinale(enemyShip, true);
  if (ship === carrier) startFinale(carrier, false);
}
/**
 * The end's film (src/ui/finale.ts): cameras round the sinking carrier, the console out of the way, a big "Victory"
 * or "Defeat" after a few seconds; the end screen follows on a click
 */
function startFinale(ship: CarrierController, won: boolean) {
  if (won) game.omegaSunk = true;
  voyage.on = false;
  // a defeat is silent (the voyage's music fades out)
  if (!won) music.stop(1.5);
  if (map.open) map.toggle();
  if (supply.open) supply.toggle();
  pointer.release();
  finale.start({
    localToWorld: (x, z) => ship.localToWorld(x, z),
    get deck() { return ship.model.group.position.y; },
    ground: (x, z) => world.heightAt(x, z),
  }, won, () => endGame(won, won ? 'omega' : 'traeger'));
}
let endCheck = 0;
/** each frame: explosions and fires on a sinking ship; once a second whether the game is won or lost */
function updateEnd(dt: number) {
  for (const [ship, s] of goingDown) {
    const k = ship.sinking;
    // blasts along the deck for the first quarter, fires on it, a great splash when it goes under
    s.next -= dt;
    if (k < SINK_TIME * 0.3 && s.next <= 0) {
      s.next = 0.5 + Math.random() * 0.9;
      const at = ship.localToWorld((Math.random() - 0.5) * 50, (Math.random() - 0.5) * 180);
      effects.explosion(at.setY(ship.model.group.position.y + 4), 1.5 + Math.random() * 1.5, ship === carrier ? PAL.ocker : PAL.feind);
    }
    if (!s.fires) {
      s.fires = true;
      for (const z of [-60, 0, 55]) effects.burn(ship.localToWorld((Math.random() - 0.5) * 30, z).setY(4), 14, SINK_TIME * 0.6);
    }
    if (!s.splash && k > SINK_TIME * 0.6) { s.splash = true; effects.splash(ship.centre(new THREE.Vector3()).setY(0), 4); }
    // the enemy's vehicles out lose their ship a little after it is hit for good (their radio goes dead)
    if (ship === enemyShip && !s.told && k > 3) {
      s.told = true;
      for (const w of foeOtters) if (w.state === 'fahren') w.hit(w.hp);
      for (const m of foeSkuas) if (m.state === 'flug' || m.state === 'landung') m.hit(m.hp);
    }
  }
  endCheck -= dt;
  if (endCheck > 0 || game.over === 'niederlage') return;
  endCheck = 1;
  const ds = goingDown.get(carrier), de = goingDown.get(enemyShip);
  // (the defeat's film ends the game itself, on a click)
  if (ds && carrier.sinking > 8 && !finale.on) return endGame(false, 'traeger');
  if (bases.every(b => b.team === 'feind')) return endGame(false, 'inseln');
  if (game.over) return;
  // (with the Stoorworm going down as well, the defeat stands: its film ends the game)
  if (!game.omegaSunk && de && !ds && enemyShip.sinking > 10) { game.omegaSunk = true; return endGame(true, 'omega'); }
  if (bases.every(b => b.team === 'spieler')) return endGame(true, 'inseln');
}
/** the game is won or lost: the end screen with the tally (after sinking the enemy's ship the player may go on) */
function endGame(won: boolean, reason: 'omega' | 'inseln' | 'traeger') {
  // (a defeat while the victory's film still ran ends it)
  finale.stop();
  game.over = won ? 'sieg' : 'niederlage';
  if (won) autosave();
  // the music sounds for a victory (the voyage's gives way to it; the film started it already), a defeat is silent
  voyage.on = false;
  if (won && !music.busy) void music.play();
  else music.stop(1.5);
  if (map.open) map.toggle();
  pointer.release();
  sound.setPaused(true);
  stillDrawn = false;
  menu.showEnd({ won, reason, difficulty: game.difficulty, time: playStats.time, stats: { ...stats }, goOn: won && reason === 'omega' });
}
let started = false, leaving = false;
const ownedIslands = () => bases.filter(b => b.team === 'spieler').length;

function collectState() {
  return {
    env: { time: env.time, day: env.day, elapsed: env.elapsed, weather: env.weather, strength: env.strength, windAngle: env.windAngle, windTarget: env.windTarget },
    params: { zeitLaeuft: params.zeitLaeuft, tempo: params.tempo, zeitraffer: params.zeitraffer, zufallsWetter: params.zufallsWetter },
    weather: weather.saveState(),
    active, camera: cams.current?.id ?? '', current: { walrus: walrus.index, manta: manta.index },
    home: walruses.map(w => pilots.isHome(w)),
    carrier: carrier.saveState(), walruses: walruses.map(w => w.saveState()), mantas: mantas.map(m => m.saveState()), drone: drone.saveState(),
    bases: bases.map(b => b.saveState()), economy: economy.saveState(), transfer: transfer.saveState(), survey: survey.saveState(),
    routes: [...routes].map(([u, q]) => [u, q.map(v => [v.x, v.y])] as [UnitId, [number, number][]]),
    game: { ...game }, stats: { ...stats },
    // the guided first game's step (null: none running); Weiterspielen goes on with it
    tutorial: tutorial.saveState(),
    shields: shields.saveState(),
    enemy: {
      ...enemy.saveState(), contact: enemyContact.saveState(),
      otters: foeOtters.map(w => w.saveState()), skuas: foeSkuas.map(m => m.saveState()), economy: foeEconomy.saveState(), omega: omega.saveState(),
      shields: foeShields.saveState(),
    },
  };
}
type GameState = ReturnType<typeof collectState>;

function makeSave(name: string): SaveGame {
  return {
    version: SAVE_VERSION,
    meta: { name, savedAt: Date.now(), seed: worldSeed, count: worldCount, clock: clockText(), playTime: playStats.time, owned: ownedIslands() },
    data: collectState(),
  };
}

/** a save of this world, applied before the first frame (or on the title screen) */
function applyState(save: SaveGame) {
  const s = save.data as GameState;
  env.time = s.env.time; env.day = s.env.day ?? 0; env.elapsed = s.env.elapsed; env.setWeather(s.env.weather, true, 6, undefined, s.env.strength ?? 0.5);
  if (s.env.windAngle !== undefined) { env.windAngle = s.env.windAngle; env.windTarget = s.env.windTarget; }
  // the clock runs after loading too (T stops it for the session; saves from before it ran by default kept it stopped)
  Object.assign(params, s.params, { zeitLaeuft: true });
  params.zeit = env.time; params.wetter = WEATHER_NAME[s.env.weather];
  weather.loadState(s.weather);
  weather.enabled = params.zufallsWetter;
  carrier.loadState(s.carrier);
  s.bases.forEach((b, k) => bases[k]?.loadState(b));
  economy.loadState(s.economy);
  survey.loadState(s.survey);
  s.walruses.forEach((w, i) => walruses[i]?.loadState(w));
  s.mantas.forEach((m, i) => mantas[i]?.loadState(m));
  drone.loadState(s.drone);
  transfer.loadState(s.transfer);
  walruses.forEach((w, i) => { if (s.home[i]) pilots.homeWalrus(w); });
  // islands won before the landing pads existed get theirs now (built like any new building)
  bases.forEach((b, k) => { if (b.retrofit()) refreshIsland(k); });
  // the enemy's carrier (saves before M10 have none: it starts off its base)
  // (saves of stage 1 have the ship but not its vehicles, network or strategy: those start fresh)
  if (s.enemy) {
    enemy.loadState(s.enemy); enemyContact.loadState(s.enemy.contact);
    s.enemy.otters?.forEach((w, i) => foeOtters[i]?.loadState(w));
    s.enemy.skuas?.forEach((m, i) => foeSkuas[i]?.loadState(m));
    if (s.enemy.economy) foeEconomy.loadState(s.enemy.economy);
    if (s.enemy.omega) omega.loadState(s.enemy.omega);
  } else { enemy.placeAtHome(); enemyContact.loadState({ visible: false, last: null }); }
  // the defence drones out come back in their formation (saves from before them: none out)
  shields.loadState(s.shields);
  foeShields.loadState(s.enemy?.shields);
  routes.clear(); routeLast.clear(); routeDone.clear();
  for (const [u, q] of s.routes ?? []) routes.set(u, q.map(([x, z]) => new THREE.Vector2(x, z)));
  // islands: obstacles, cameras on the masts and command centres that stand, trees
  obstacles.length = 0;
  obstacles.push(...bases.flatMap(b => b.obstacles));
  cams.remove('insel-');
  bases.forEach((b, i) => { for (const bd of b.buildings) if (bd.alive && (bd.p.type === 'funkmast' || bd.p.type === 'kommandozentrale')) addIslandCam(world.islands[i].name, bd.p); });
  for (const isl of [...vegetation.keys()]) { dropVegetation(isl); plantVegetation(isl); }
  for (const w of [...walruses, ...foeOtters]) tracks.get(w)!.prevHeading = w.heading;
  doorOpen = walruses.some(w => w.state !== 'dock' && w.state !== 'zerstoert') ? 1 : 0;
  setCurrent('walrus', s.current.walrus);
  setCurrent('manta', s.current.manta);
  playStats.time = playStats.lastAuto = save.meta.playTime;
  // (saves from before the difficulty were normal)
  Object.assign(game, { difficulty: 'normal', omegaSunk: false, over: '' }, s.game ?? {});
  Object.assign(stats, NO_STATS, s.stats ?? {});
  setDifficulty(game.difficulty, false);
  // (saves from before the tutorial have none)
  tutorial.loadState(s.tutorial ?? null);
  goingDown.clear();
  setVehicle(s.active);
  if (s.camera && cams.cams.some(c => c.id === s.camera)) selectCam(s.camera);
}

function autosave() {
  // the test range never overwrites the real game's autosave, a lost game neither, nor the end's film (the outcome is
  // decided then but not yet the game's: a save then came back with the ship sunk and no end screen ever)
  if (!started || PROBE || inTraining || finale.on || game.over === 'niederlage') return;
  playStats.lastAuto = playStats.time;
  const why = writeSave('auto', makeSave(defaultSaveName()));
  if (why) notify(t('save.autoFailed', { why }), 'bad');
}
const defaultSaveName = () => t('save.defaultName', { seed: worldSeed, n: ownedIslands(), clock: clockText() });

/** the hour a new game begins */
const START_TIME = 11;
function startGame(fresh: boolean, difficulty: Difficulty = 'normal', withTutorial = false) {
  started = true;
  voice.say('bereit');
  depotNear = null;
  if (fresh) {
    Object.assign(game, { difficulty, omegaSunk: false, over: '' });
    Object.assign(stats, NO_STATS);
    setDifficulty(difficulty, true);
    if (withTutorial) tutorial.start(); else tutorial.stop();
  }
  music.stop();
  // a new game always starts in heavy rain, as the North Atlantic greets you (the title's storm eases into it at once; a
  // loaded game brings its own weather)
  if (fresh) { env.setWeather('regen', true, 6, undefined, 0.85); params.wetter = WEATHER_NAME.regen; weather.restart(); }
  // a new game starts late in the morning, so there is a day ahead before it gets dark (the title stays at 17:00)
  if (fresh) { carrier.throttle = 3; setVehicle('traeger'); playStats.time = playStats.lastAuto = 0; env.time = params.zeit = START_TIME; }
  if ((fresh || !enemyContact.last) && !inTraining) radioIntel();
  menu.hide();
  sound.setPaused(false);
  clock.getDelta();
}
/**
 * Hauptmenü → Kampftraining: a new game off a quiet island with the dummies (src/game/trainingRange.ts) and the card
 * that leads through it (src/ui/training.ts); the enemy keeps still, the weather stays clear, nothing is saved
 */
function startTraining() {
  // (no quiet island for it in this world: a plain new game, with the enemy and the weather as always)
  const spot = findRange(world, bases, enemyShip.pos);
  if (!spot) { startGame(true); notify(t('train.none'), 'bad'); return; }
  inTraining = true;
  startGame(true);
  omega.setHold(true);
  env.setWeather('klar', true); params.wetter = WEATHER_NAME.klar; weather.enabled = false;
  range = new TrainingRange(spot, world, combat);
  scene.add(range.group);
  rangeRing = wakeField.addRing(foeShape.waterline(), 9);
  clearings.push(...range.obstacles);
  obstacles.push(...range.obstacles);
  const isl = world.islands[spot.island];
  if (vegetation.has(isl)) { dropVegetation(isl); plantVegetation(isl); }
  const c = spot.carrier;
  carrier.loadState({ ...carrier.saveState(), x: c.x, z: c.z, heading: c.heading, speed: 0, throttle: 1, waypoint: null });
  // every Otter with a Harbinger launcher, every Skua with four Assassins
  for (const w of walruses) { w.fit = otterFit('harbinger', 'rohstoff'); w.load = { ...w.fit }; showGear(w); }
  for (const m of mantas) { m.fit = skuaFit('raketen'); m.load = { ...m.fit }; showGear(m); }
  training.start();
  notify(t('train.ready', { island: isl.name }), 'good');
}
function pause() {
  if (!started || menu.open) return;
  if (map.open) map.toggle();
  if (playStats.time - playStats.lastAuto > 20) autosave();
  menu.show('main');
  sound.setPaused(true);
  stillDrawn = false;
}
function resumeGame() {
  // a lost game does not go on
  if (game.over === 'niederlage') { menu.showEnd(null); return; }
  // the victory's music ends with the end screen (a voyage's goes on after a pause)
  if (!voyage.on) music.stop();
  menu.hide();
  sound.setPaused(false);
  clock.getDelta();
}
/** another world (or a clean start) needs a fresh page */
function reloadInto(seed: number, count: number) {
  leaving = true;
  reloadPage(`?seed=${seed}&inseln=${count}`);
}
/** the game loads its own page anew: it says so first, so the new page skips the "Weikendo presents" splash (index.html) */
function reloadPage(search: string) {
  try { sessionStorage.setItem('skerry-reload', '1'); } catch { /* storage blocked: the splash shows */ }
  location.search = search;
}

const menu = new Menu({
  inGame: () => started,
  resume: resumeGame,
  newGame: (seed, count, difficulty, withTutorial) => {
    if (!started && seed === worldSeed && count === worldCount) { startGame(true, difficulty, withTutorial); return; }
    requestBoot({ kind: 'start', difficulty, tutorial: withTutorial });
    reloadInto(seed, count);
  },
  load: (save) => {
    if (!started && save.meta.seed === worldSeed && save.meta.count === worldCount) {
      applyState(save); startGame(false); notify(t('save.loaded', { name: save.meta.name }), 'good'); return;
    }
    requestBoot({ kind: 'load', save });
    reloadInto(save.meta.seed, save.meta.count);
  },
  save: (slot, name) => (inTraining ? t('train.noSave') : finale.on ? t('finale.noSave') : writeSave(slot, makeSave(name))),
  training: () => inTraining,
  // the training starts afresh in the same world (a running game is saved first)
  startTraining: () => {
    if (!started) { startTraining(); return; }
    autosave();
    leaving = true;
    requestBoot({ kind: 'training' });
    reloadPage(`?seed=${worldSeed}&inseln=${worldCount}`);
  },
  settingsTabs,
  devPanel: (show) => { document.body.classList.toggle('menu-settings', show); if (show) gui.open(); },
  world: () => ({ seed: worldSeed, count: worldCount }),
  defaultName: defaultSaveName,
  glyphs: () => padGlyphs(input.padKind),
  // back to the title: the game is saved and the page starts afresh in the same world (no boot order: the title)
  toTitle: () => { autosave(); leaving = true; reloadPage(`?seed=${worldSeed}&inseln=${worldCount}`); },
  // the app may close its window (it quits with it); a browser page may not
  quit: location.protocol === 'app:' ? () => { autosave(); leaving = true; window.close(); } : null,
  intro: () => startIntro(),
  // the other language: remembered, then the page starts afresh in it; a running game is saved and goes straight on
  language: (l) => {
    setLang(l);
    // (not in the middle of the end's film: that state is no game to go on with; the last autosave stays)
    if (inTraining) requestBoot({ kind: 'training' });
    else if (started && !PROBE && !finale.on && game.over !== 'niederlage') { autosave(); requestBoot({ kind: 'load', save: makeSave(defaultSaveName()), quiet: true }); }
    leaving = true;
    reloadPage(PROBE ? location.search : `?seed=${worldSeed}&inseln=${worldCount}`);
  },
});

// the intro: at every start it rolls over the title before the menu shows (the menu stays open, hidden, so the title goes on);
// not after the game's own reloads (another world, back to the title), which go straight to the menu
const intro = new Intro();
const RELOADED = document.documentElement.classList.contains('reload');
function startIntro() {
  if (started || PROBE || intro.active) return;
  // (the skipping click or key may be the first one: it also lets the synthesised sound start)
  intro.start(() => { sound.unlock(); menu.show('main'); });
}

// pause when the window goes to the background; save when the page is left
addEventListener('blur', () => { if (params.hintergrundPause) pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && params.hintergrundPause) pause(); });
addEventListener('pagehide', () => { if (!leaving) autosave(); });
// Enter catches the pointer for the camera and the aim, as the Trackpad button does (Esc lets it go). It is done in
// the key's own event, which browsers count as a gesture (Esc does not), and it must not click a button that has
// the focus (Hammerhead, say); in the menu and in text fields Enter stays theirs
addEventListener('keydown', (e) => {
  if ((e.code !== 'Enter' && e.code !== 'NumpadEnter') || !started || menu.open || intro.active) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
  if (!pointer.locked && (map.open || supply.open)) return;
  e.preventDefault();
  if (pointer.locked) pointer.release(); else pointer.capture();
});

loadSettings();

{
  const boot = takeBoot();
  if (boot?.kind === 'load' && boot.save.meta.seed === worldSeed && boot.save.meta.count === worldCount) {
    applyState(boot.save);
    startGame(false);
    if (!boot.quiet) notify(t('save.loaded', { name: boot.save.meta.name }), 'good');
  } else if (boot?.kind === 'start') startGame(true, boot.difficulty, boot.tutorial);
  else if (boot?.kind === 'training') startTraining();
  else if (PROBE) {
    // the combat test range: straight into a fight off an enemy island, clear weather that stays
    startGame(true);
    const island = combatProbe({ world, bases, carrier, otter: walruses[0], skua: mantas[0], enemyShip, foeOtter: foeOtters[0], pilots });
    env.setWeather('klar', true); params.wetter = WEATHER_NAME.klar; params.zufallsWetter = weather.enabled = false;
    params.leistung = true;
    setCurrent('walrus', 0); setVehicle('walrus');
    notify(island ? t('probe.ready', { island }) : t('probe.none'), island ? 'good' : 'bad');
  } else {
    // title screen: the ship lies still in a storm, with rain and a heavy sea, until the game starts
    carrier.throttle = 1; carrier.speed = 0;
    env.setWeather('sturm', true, 6, undefined, 0.7); params.wetter = WEATHER_NAME.sturm;
    menu.show('main');
  }
}
requestAnimationFrame(frame);
// the black loading screen fades once the splash is over and the first frame stands, into the game or into the
// title with its intro and music; browsers allow music only after a click or key, so if it may not start yet the
// screen waits for one (which only starts the sound and does not reach the menu)
/** how long the "Weikendo presents" splash in index.html lasts (its CSS animations end at 3.6 s) */
const SPLASH_MS = 3600;
requestAnimationFrame(() => requestAnimationFrame(() => {
  const boot = document.getElementById('boot');
  if (!boot) return;
  // the loading screen waits for the splash
  const splash = document.getElementById('presents') ? SPLASH_MS : 0;
  if (splash) setTimeout(() => document.getElementById('presents')?.remove(), SPLASH_MS);
  // the music begins as the splash's letters fade (where it may start by itself, as in the app)
  let musicOn: Promise<boolean> = Promise.resolve(false);
  setTimeout(() => { if (!started) musicOn = music.play(TITLE_MUSIC); }, Math.max(0, (splash ? SPLASH_MS - 600 : 0) - performance.now()));
  const fade = () => {
    // into the intro the whole scene fades up slowly out of the black, with the story rolling in from below
    const toIntro = !started && !RELOADED;
    boot.classList.toggle('slow', toIntro);
    boot.classList.add('gone');
    setTimeout(() => boot.remove(), toIntro ? 3100 : 1000);
    if (toIntro) startIntro();
  };
  setTimeout(async () => {
    // (where music may start by itself, as in the app, the sea and weather start with it)
    if (started) { sound.unlock(); fade(); return; }
    if (await musicOn || await music.play(TITLE_MUSIC)) { sound.unlock(); fade(); return; }
    boot.querySelector('b')!.textContent = t('boot.press');
    boot.classList.add('wait');
    const go = (e: Event) => {
      e.stopImmediatePropagation();
      e.preventDefault();
      removeEventListener('pointerdown', go, true);
      removeEventListener('keydown', go, true);
      sound.unlock();
      if (!started) void music.play(TITLE_MUSIC);
      fade();
    };
    addEventListener('pointerdown', go, true);
    addEventListener('keydown', go, true);
  }, Math.max(0, splash - performance.now()));
}));

// debugging / screenshots from the console
Object.assign(window, {
  cc: {
    env, params, setVehicle, selectCam, setDevCamera, islandOverview, setShadows, resize, camera, controls, cams,
    scene, renderer, post, world, bases, carrier, walruses, mantas, fleet, setCurrent, useCargo, drone, pilots, survey, economy, transfer, supply, weather, input, combat, effects, map, vegetation, sound,
    menu, collectState, applyState, makeSave, pause, autosave, playStats, step, enemy, enemyShip, enemyContact,
    omega, foeOtters, foeSkuas, defence, foeDefence, decoys, foeDecoys, shields, foeShields, hammer, foeHammer, hammerAim, foeEconomy, foePilots, foeContacts, music, ocean, shipTops, pointer, wrecks, intro, startIntro, tutorial, strikes, voice, headlights,
    training, trainingRange: () => range,
  },
});
console.info(`Welt ${worldSeed} mit ${world.islands.length} Inseln erzeugt in ${(performance.now() - t0).toFixed(0)} ms · ` +
  world.islands.map((isl, i) => `${isl.name} (${isl.biomeName}, ${isl.owner}): ${bases[i].buildings.length} Gebäude`).join(' · '));
