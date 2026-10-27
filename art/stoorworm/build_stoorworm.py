"""
The Stoorworm after the title picture (2026-10-23): a long, slab-sided gunmetal carrier with a chisel bow, a low
angular command bunker on the starboard deck edge, a gun sponson and a lowered loading platform to port, stepped
galleries with rows of lights along the hull, big white numbers on the deck. The ship runs itself: no crew on
deck, the Skuas wait in the hangar and come up on the lift.

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python art/stoorworm/build_stoorworm.py -- [--render] [--no-bake]

Writes art/stoorworm/stoorworm.blend and stoorworm.glb (with --render also renders/), the player's ship in the game. Carrier coordinates as in
src/models/carrier.ts: deck at y = 0, +z forward, x to port, waterline at y = -20, the stern at z = -100.
The game fixes the lift (x ±16.5, z 12…38), the catapult on the centreline (z 44…128), the drone pad (z = -70)
and the stern dock (x ±27, y -26…-11, z -100…-74). The parts it moves:
  radar       pivot on the bunker's mast, turns about y
  turret      pivot on the port sponson, turns about y; its child barrel pivot (0, 2.9, 1.6), elevation about x
  sternDoor   pivot (0, -11, -100.05), rotation x from 0 (closed) to 1.45 (open)
  lift        pivot (0, 0, 25), the Skua lift's platform: position y from 0 (deck) down to -9 (hangar)
  lights (lamps and lit windows), decals* (markings, drawn with a depth offset), glow_* (glow points)
  cam_bridge, cam_stern, cam_outside: the ship's three cameras (custom properties eye and look)
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
from lowpoly import (MB, PAL, apply_modifiers, bake_ambient_occlusion, glow_point, safe_names, shade,  # noqa: E402
                     to_blender, vertex_colour_material)

HERE = os.path.dirname(__file__)
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = 'stoorworm'


def lin(hexs):
    rgb = [int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb)


# blue gunmetal after the title picture (the Gunmetal family of the palette); the ochre trim stays the player's
C = {
    'deck': 'gunmetal', 'deckSeam': 'gunmetalTief', 'deckUnder': 'schwarz', 'deckEdge': 'gunmetal', 'rim': 'gunmetalHell',
    'hull': 'gunmetalHell', 'hullDark': 'gunmetalDunkel', 'band': 'gunmetalTief', 'ledge': 'gunmetalHell', 'ledgeEdge': 'gunmetalDunkel',
    'boot': 'schwarz', 'antifoul': 'gunmetalTief', 'seam': 'gunmetalTief', 'plate': 'gunmetalHell',
    'sup': 'gunmetal', 'supLight': 'gunmetalHell', 'supDark': 'gunmetalDunkel', 'supTop': 'gunmetalDunkel', 'slot': 'gunmetalTief',
    'accent': 'ocker', 'accentDark': 'ockerDunkel', 'hatch': 'schwarz', 'window': 'gunmetalTief', 'windowLit': 'lichtWarm',
    'platform': 'gunmetalTief', 'platformTop': 'gunmetalDunkel', 'rib': 'gunmetalDunkel', 'grille': 'schwarz',
    'radar': 'metallHell', 'radarLight': 'stahlHell', 'radarDark': 'anthrazit',
    'turret': 'glasBlau', 'turretBody': 'metall', 'barrel': 'weiss', 'lift': 'gunmetal', 'liftSeam': 'anthrazit',
    'white': 'stahlHell', 'paint': 'weiss', 'line': 'glasBlau', 'yellow': 'signalGelb', 'dark': 'gunmetalTief', 'black': 'schwarz',
    'dock': 'schwarz', 'dockWall': 'gunmetalTief', 'dockCeiling': 'gunmetalDunkel', 'hullMid': 'gunmetalDunkel', 'hullLow': 'gunmetalDunkel',
    'lightWarm': 'lichtWarm', 'lightWhite': 'lichtWeiss', 'lightRed': 'lichtRot', 'lightGreen': 'lichtGruen', 'lightBlue': 'lichtBlau',
}

# ---------------------------------------------------------------- the frame
HULL_Y = [-1.5, -7, -20, -26]          # under the deck, the knuckle (upper gallery), the waterline, the keel
WATERLINE = -20
DOCK_X, DOCK_TOP, DOCK_FLOOR, DOCK_END = 27, -11, -26, -74
# half widths of the four levels along z; towards the bow every level comes to its point (BOW_TIP)
STATIONS = [(-100, [34, 35.5, 31.5, 26]), (-92, [36, 37.5, 33, 27]), (30, [36, 37.5, 33, 26]),
            (65, [32, 33.5, 28, 20]), (95, [23, 24, 18, 11]), (118, [13, 13.5, 7, 2])]
BOW_TIP = [150, 146, 132, 121]
# the flight deck: nearly the same width from the chamfered stern to z = 75, then a long chisel to the bow
DECK_PTS = [(-100, 34.5), (-95, 39.0), (75, 39.0), (100, 31.0), (125, 18.0), (143, 7.0), (150, 2.5)]
DECK_Z = [z for z, _ in DECK_PTS]
END = DECK_Z[-1]
PAD_Z = -70
# the runway lies a little sunk into the deck (as the numbers on the title picture), behind and ahead of the lift
RUNWAY = {'x': 13.6, 'depth': 0.2, 'bevel': 0.6, 'parts': [(-54.0, 10.0), (40.0, 124.0)]}
LIFT = {'x': 16.5, 'z0': 12, 'z1': 38}
# the Skua lift: a platform inside the hazard border that sinks LIFT_DEPTH into its shaft (LIFT_DEPTH in carrier.ts)
LIFT_BORDER = 0.9
LIFT_DEPTH = 9.0
LIFT_Z = (LIFT['z0'] + LIFT['z1']) / 2
PLATFORM = {'x': LIFT['x'] - LIFT_BORDER, 'z0': LIFT['z0'] + LIFT_BORDER, 'z1': LIFT['z1'] - LIFT_BORDER}
HOLE = (-PLATFORM['x'] - 0.05, PLATFORM['x'] + 0.05, PLATFORM['z0'] - 0.05, PLATFORM['z1'] + 0.05)
# the command bunker on the starboard deck edge (x < 0) and its mast; the gun sponson and loading platform to port
BUNKER_Z = (-65.0, -23.0)
T1, T2 = 7.5, 12.0                     # roof heights of the bunker's two tiers
MAST = (-34.0, -46.0)
GUN = (41.5, -45.0)
LOAD_Z = (-24.0, 4.0)
CAMERAS = {
    # inside the bunker's bridge, looking ahead over the deck, turned a little to port so the runway sits in the middle of
    # the picture (in the game the side columns cover its edges)
    'bridge': {'eye': (-31.5, 10.0, -32.8), 'look': (0.0, 1.0, 300.0)},
    # from the bunker's mast astern, looking down over the stern: the dock, the wake, the Skuas coming in
    'stern': {'eye': (-31.5, 15.8, -58.5), 'look': (4.0, -14.0, -230.0)},
    # outside, high on the port bow, as the title picture shows the ship
    'outside': {'eye': (235.0, 95.0, 105.0), 'look': (0.0, -8.0, 5.0)},
}
GLOWS = []
lerp = lambda a, b, t: a + (b - a) * t


def level_width(l, z):
    if z <= STATIONS[0][0]:
        return STATIONS[0][1][l]
    for (za, wa), (zb, wb) in zip(STATIONS, STATIONS[1:]):
        if z <= zb:
            return lerp(wa[l], wb[l], (z - za) / (zb - za))
    zl, wl = STATIONS[-1]
    return max(0.0, wl[l] * (BOW_TIP[l] - z) / (BOW_TIP[l] - zl))


def hull_width(z, y):
    if y >= HULL_Y[0]:
        return level_width(0, z)
    for l in range(len(HULL_Y) - 1):
        if y >= HULL_Y[l + 1]:
            return lerp(level_width(l, z), level_width(l + 1, z), (HULL_Y[l] - y) / (HULL_Y[l] - HULL_Y[l + 1]))
    return level_width(len(HULL_Y) - 1, z)


def deck_w(z):
    if z <= DECK_PTS[0][0]:
        return DECK_PTS[0][1]
    for (za, wa), (zb, wb) in zip(DECK_PTS, DECK_PTS[1:]):
        if z <= zb:
            return lerp(wa, wb, (z - za) / (zb - za))
    return 0.0


def on_hull(s, y, z, out=0.06):
    return (s * (hull_width(z, y) + out), y, z)


def glow(pos, colour, size):
    GLOWS.append((tuple(pos), colour, size))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene.collection


# ---------------------------------------------------------------- hull
def hull(b: MB, d: MB, L: MB):
    last = STATIONS[-1][0]
    rows = sorted(set([-100 + 12.5 * i for i in range(int((last + 100) / 12.5) + 1)] + [z for z, _ in STATIONS]))
    ring = lambda l: [(z, level_width(l, z)) for z in rows] + [(BOW_TIP[l], 0.0)]
    # under the deck a dark recessed band, then the main side in alternating plates, below the water the antifouling
    band = [(C['band'], C['hullDark']), (C['hull'], shade(C['hull'], 0.93)), (C['antifoul'], C['antifoul'])]
    for l in range(3):
        A, B, ya, yb = ring(l), ring(l + 1), HULL_Y[l], HULL_Y[l + 1]
        for i in range(len(A) - 1):
            for s in (-1, 1):
                b.poly([(s * A[i][1], ya, A[i][0]), (s * B[i][1], yb, B[i][0]), (s * B[i + 1][1], yb, B[i + 1][0]), (s * A[i + 1][1], ya, A[i + 1][0])], band[l][i % 2])
    K = ring(3)
    for i in range(len(K) - 1):
        b.quad((-K[i][1], -26, K[i][0]), (K[i][1], -26, K[i][0]), (K[i + 1][1], -26, K[i + 1][0]), (-K[i + 1][1], -26, K[i + 1][0]), C['antifoul'])

    # the galleries: a broad ledge along the knuckle that runs round the bow (the chisel's layers), a narrower one lower down
    ledge(b, -6.8, 0.8, 1.7, -96.0, 145.0, gaps=[(-40.0, -36.0), (22.0, 26.0)])
    ledge(b, -12.6, 0.6, 1.0, -88.0, 70.0, gaps=[(-20.0, -16.0)])
    ledge(b, -3.6, 0.5, 0.8, 96.0, 147.0)

    for s in (-1, 1):
        # panel seams down the main side, the boot-top along the waterline
        z = -92.0
        while z <= last - 6:
            d.quad(on_hull(s, -7.7, z), on_hull(s, -19.4, z), on_hull(s, -19.4, z + 0.3), on_hull(s, -7.7, z + 0.3), C['seam'])
            z += 12.5
        for i in range(len(rows) - 1):
            za, zb = rows[i] + 0.01, rows[i + 1]
            d.quad(on_hull(s, -18.6, za), on_hull(s, -18.6, zb), on_hull(s, -19.9, zb), on_hull(s, -19.9, za), C['boot'])
        # a row of lit portholes in the dark band under the deck, a few glowing
        z, k = -94.0, 0
        while z < 118:
            if not (-41 < z < -35 or 21 < z < 27):
                L.quad(on_hull(s, -3.9, z, 0.1), on_hull(s, -3.9, z + 0.9, 0.1), on_hull(s, -4.4, z + 0.9, 0.1), on_hull(s, -4.4, z, 0.1), C['lightWarm'])
                if k % 4 == 0:
                    glow(on_hull(s, -4.15, z + 0.45, 0.6), C['lightWarm'], 2.6)
                k += 1
            z += 3.2
        # a second, sparser row on the main side between the bays
        z = -86.0
        while z < 90:
            if not (-64 < z < -46 or 32 < z < 50):
                L.quad(on_hull(s, -10.2, z, 0.1), on_hull(s, -10.2, z + 1.2, 0.1), on_hull(s, -10.8, z + 1.2, 0.1), on_hull(s, -10.8, z, 0.1), C['lightWarm'])
            z += 6.4
        # hangar bays: dark openings in the main side with a lit strip
        for z0, z1 in ((-62.0, -48.0), (34.0, 48.0)):
            d.quad(on_hull(s, -8.6, z0), on_hull(s, -8.6, z1), on_hull(s, -14.4, z1), on_hull(s, -14.4, z0), C['hatch'])
            L.quad(on_hull(s, -9.0, z0 + 0.8, 0.1), on_hull(s, -9.0, z1 - 0.8, 0.1), on_hull(s, -9.6, z1 - 0.8, 0.1), on_hull(s, -9.6, z0 + 0.8, 0.1), C['lightWarm'])
            for k in range(3):
                glow(on_hull(s, -11.5, z0 + (z1 - z0) * (k + 0.5) / 3, 0.8), C['lightWarm'], 5)
        # hawse pipe and anchor on the bow, the ship's number on both bows
        cy, cz = -11.5, 108.0
        pts = [on_hull(s, cy + 1.6 * math.sin(a), cz + 1.9 * math.cos(a), 0.1) for a in [k * math.pi / 5 for k in range(10)]]
        d.poly(pts, C['black'])
        d.poly([on_hull(s, cy - 1.0, cz - 0.9, 0.25), on_hull(s, cy - 1.0, cz + 0.9, 0.25), on_hull(s, cy - 3.4, cz + 0.4, 0.25), on_hull(s, cy - 3.4, cz - 0.4, 0.25)], C['dark'])
        number(d, s, 96.0, -8.4)

    # under the deck's overhang: sloping panels from the deck edge down to the knuckle
    z = -100.0
    while z < END:
        z2 = min(END, z + 5)
        in0, in1, out0, out1 = hull_width(z, -7), hull_width(z2, -7), deck_w(z), deck_w(z2)
        if not (out0 - in0 < 0.3 and out1 - in1 < 0.3):
            for s in (-1, 1):
                q = [(s * in0, -7, z), (s * out0, -1.5, z), (s * out1, -1.5, z2), (s * in1, -7, z2)]
                b.poly(q if s > 0 else list(reversed(q)), C['hullDark'] if int(z) % 10 else C['band'])
        z += 5
    stern(b, d, L)


def ledge(b: MB, y, thick, out, z0, z1, gaps=()):
    """a gallery ledge standing out from the hull at height y; past the bow tip of its level it closes round the stem"""
    tip = BOW_TIP[1] if y <= HULL_Y[1] else lerp(BOW_TIP[0], BOW_TIP[1], (HULL_Y[0] - y) / (HULL_Y[0] - HULL_Y[1]))
    zend = min(z1, tip - 0.6)
    zs = []
    z = z0
    while z < zend:
        zs.append(z)
        z += 4.0
    zs.append(zend)
    runs, cur = [], []
    for z in zs:
        if any(g0 <= z <= g1 for g0, g1 in gaps):
            if cur:
                runs.append(cur)
            cur = []
        else:
            cur.append(z)
    if cur:
        runs.append(cur)
    yb = y - thick
    for run in runs:
        for s in (-1, 1):
            for za, zb in zip(run, run[1:]):
                ia, ib = hull_width(za, y) - 0.05, hull_width(zb, y) - 0.05
                oa, ob = ia + out + 0.05, ib + out + 0.05
                top = [(s * ia, y, za), (s * oa, y, za), (s * ob, y, zb), (s * ib, y, zb)]
                b.poly(top if s > 0 else list(reversed(top)), C['ledge'])
                bot = [(s * ia, yb, za), (s * ib, yb, zb), (s * ob, yb, zb), (s * oa, yb, za)]
                b.poly(bot if s > 0 else list(reversed(bot)), C['ledgeEdge'])
                b.quad((s * oa, yb, za), (s * ob, yb, zb), (s * ob, y, zb), (s * oa, y, za), C['ledgeEdge'])
            # ends of a broken run
            for zz in (run[0], run[-1]):
                if zz == zend:
                    continue
                i, o = hull_width(zz, y) - 0.05, hull_width(zz, y) + out
                b.quad((s * i, yb, zz), (s * o, yb, zz), (s * o, y, zz), (s * i, y, zz), C['ledgeEdge'])
        if run[-1] == zend:
            # round the stem: the two sides meet in a point ahead of it
            i, o, zt = hull_width(zend, y) - 0.05, hull_width(zend, y) + out, zend + out * 1.4
            b.poly([(i, y, zend), (o, y, zend), (0, y, zt), (-o, y, zend), (-i, y, zend)], C['ledge'])
            b.poly([(-i, yb, zend), (-o, yb, zend), (0, yb, zt), (o, yb, zend), (i, yb, zend)], C['ledgeEdge'])
            for s in (-1, 1):
                b.quad((s * o, yb, zend), (0, yb, zt), (0, y, zt), (s * o, y, zend), C['ledgeEdge'])


SEG = {  # seven segments a…g as (x0, y0, x1, y1) in a 1 × 2 glyph, y up
    'a': (0, 1.82, 1, 2), 'b': (0.82, 1, 1, 2), 'c': (0.82, 0, 1, 1), 'd': (0, 0, 1, 0.18), 'e': (0, 0, 0.18, 1), 'f': (0, 1, 0.18, 2), 'g': (0, 0.91, 1, 1.09),
}
DIGITS = {0: 'abcdef', 1: 'bc', 2: 'abged', 7: 'abc'}


def number(d: MB, s: int, z0: float, y0: float):
    """the hull number '07' on a bow (glyphs 2.4 m wide, 4.8 m tall), read from bow to stern on both sides"""
    w, h = 2.4, 2.4
    for i, n in enumerate((0, 7)):
        zc = z0 - s * (i * 3.4)
        for seg in DIGITS[n]:
            x0, y0g, x1, y1g = SEG[seg]
            za, zb = zc - s * (x0 * w), zc - s * (x1 * w)
            ya, yb = y0 + y0g * h - 4.8, y0 + y1g * h - 4.8
            d.poly([on_hull(s, ya, za, 0.12), on_hull(s, ya, zb, 0.12), on_hull(s, yb, zb, 0.12), on_hull(s, yb, za, 0.12)], C['paint'])


def stern(b: MB, d: MB, L: MB):
    """the transom with the dock portal, the dock tunnel, and a shelf standing out over the stern door"""
    z = -100.0
    wy = lambda y: hull_width(z, y)
    b.poly([(-wy(-1.5), -1.5, z), (wy(-1.5), -1.5, z), (wy(-7), -7, z), (wy(DOCK_TOP), DOCK_TOP, z), (-wy(DOCK_TOP), DOCK_TOP, z), (-wy(-7), -7, z)], C['hullDark'])
    for s in (-1, 1):
        b.poly([(s * DOCK_X, DOCK_TOP, z), (s * wy(DOCK_TOP), DOCK_TOP, z), (s * wy(-20), -20, z), (s * wy(-26), -26, z), (s * DOCK_X, -26, z)], C['hullDark'] if s < 0 else C['hull'])
        xa, xb = sorted((s * DOCK_X, s * (DOCK_X + 3.5)))
        b.box((xa, -22, z - 1.2), (xb, DOCK_TOP + 3.5, z + 0.2), {'side': C['hullLow'], 'top': C['hullMid'], 'back': C['hullLow']})
    b.box((-DOCK_X - 3.5, DOCK_TOP, z - 1.6), (DOCK_X + 3.5, DOCK_TOP + 3.5, z + 0.2), {'side': C['hullLow'], 'top': C['hullMid'], 'back': C['hullMid']})
    d.quad((-DOCK_X, DOCK_TOP + 1.6, z - 1.65), (DOCK_X, DOCK_TOP + 1.6, z - 1.65), (DOCK_X, DOCK_TOP + 2.4, z - 1.65), (-DOCK_X, DOCK_TOP + 2.4, z - 1.65), C['accent'])
    for s in (-1, 1):
        x0, x1 = sorted((s * (DOCK_X + 4.2), s * 33))
        b.box((x0, -17.5, z - 0.5), (x1, -13, z + 0.05), {'side': C['dark'], 'back': C['dark']})
        for k in range(2):
            xa = x0 + 0.4 + k * 1.75
            L.quad((xa, -13.9, z - 0.55), (xa + 1.2, -13.9, z - 0.55), (xa + 1.2, -13.5, z - 0.55), (xa, -13.5, z - 0.55), C['lightWarm'])
        glow((s * 31, -13.7, z - 1.2), C['lightWarm'], 7)
    # dock tunnel: walls, ceiling, back wall, frames, lights
    b.quad((-DOCK_X, DOCK_FLOOR, z), (-DOCK_X, DOCK_TOP, z), (-DOCK_X, DOCK_TOP, DOCK_END), (-DOCK_X, DOCK_FLOOR, DOCK_END), C['dockWall'])
    b.quad((DOCK_X, DOCK_FLOOR, z), (DOCK_X, DOCK_FLOOR, DOCK_END), (DOCK_X, DOCK_TOP, DOCK_END), (DOCK_X, DOCK_TOP, z), C['dockWall'])
    b.quad((-DOCK_X, DOCK_TOP, z), (DOCK_X, DOCK_TOP, z), (DOCK_X, DOCK_TOP, DOCK_END), (-DOCK_X, DOCK_TOP, DOCK_END), C['dockCeiling'])
    b.quad((-DOCK_X, DOCK_FLOOR, DOCK_END), (-DOCK_X, DOCK_TOP, DOCK_END), (DOCK_X, DOCK_TOP, DOCK_END), (DOCK_X, DOCK_FLOOR, DOCK_END), C['dock'])
    fz = z + 4
    while fz < DOCK_END:
        for s in (-1, 1):
            xa, xb = sorted((s * DOCK_X, s * (DOCK_X - 0.6)))
            b.box((xa, -19, fz), (xb, DOCK_TOP, fz + 0.5), C['hullLow'])
        b.box((-DOCK_X, DOCK_TOP - 0.6, fz), (DOCK_X, DOCK_TOP, fz + 0.5), C['hullLow'])
        fz += 6
    for i in range(6):
        lz, ly = z + 2 + i * 4, DOCK_TOP - 1.2
        L.box((-DOCK_X + 0.05, ly - 0.3, lz), (-DOCK_X + 0.35, ly + 0.3, lz + 1.2), C['lightWarm'])
        L.box((DOCK_X - 0.35, ly - 0.3, lz), (DOCK_X - 0.05, ly + 0.3, lz + 1.2), C['lightWarm'])
        glow((-DOCK_X + 0.6, ly, lz + 0.6), C['lightWarm'], 5)
        glow((DOCK_X - 0.6, ly, lz + 0.6), C['lightWarm'], 5)
    # four bays, one for each Otter (DOCK_BAYS in src/game/walrus.ts): floating fenders part them, a lamp over each
    for x in (-13.5, 0.0, 13.5):
        b.box((x - 0.4, WATERLINE - 0.6, z + 4), (x + 0.4, WATERLINE + 0.7, DOCK_END - 2), {'side': C['hullLow'], 'top': C['accent']})
    for x in (-20.25, -6.75, 6.75, 20.25):
        L.box((x - 1.5, DOCK_TOP - 0.15, DOCK_END - 4), (x + 1.5, DOCK_TOP - 0.05, DOCK_END - 3), C['lightWhite'])
    # the shelf over the stern door (it swings up underneath), with amber lamps along its edge and struts to the transom
    shelf = [(-30, -100.0), (-28, -105.5), (28, -105.5), (30, -100.0)]
    b.slab(shelf, lambda x, zz: -4.6, lambda x, zz: -5.6, C['ledge'], C['ledgeEdge'], C['ledgeEdge'])
    for x in (-22.0, -8.0, 8.0, 22.0):
        b.beam((x, -5.6, -104.5), (x, -9.0, -100.3), 0.35, C['dark'])
    for x in range(-24, 25, 8):
        L.box((x - 0.6, -5.4, -105.6), (x + 0.6, -5.0, -105.5), C['lightWarm'])
        glow((x, -5.2, -105.9), C['lightWarm'], 3)


# ---------------------------------------------------------------- deck
def around_hole(xa, xb, za, zb, hole=None):
    """the parts of a deck rectangle outside an opening (the lift's by default)"""
    hx0, hx1, hz0, hz1 = hole or HOLE
    if xb <= hx0 or xa >= hx1 or zb <= hz0 or za >= hz1:
        return [(xa, xb, za, zb)]
    out = []
    if za < hz0:
        out.append((xa, xb, za, hz0))
    if zb > hz1:
        out.append((xa, xb, hz1, zb))
    m0, m1 = max(za, hz0), min(zb, hz1)
    if xa < hx0:
        out.append((xa, hx0, m0, m1))
    if xb > hx1:
        out.append((hx1, xb, m0, m1))
    return out


def around_holes(rect, holes):
    rects = [rect]
    for h in holes:
        rects = [piece for r in rects for piece in around_hole(*r, hole=h)]
    return rects


def surface(x, z):
    """the deck's height at (x, z): 0, the runway's floor, or None on its sloping edges"""
    w, e = RUNWAY['x'], RUNWAY['bevel']
    for z0, z1 in RUNWAY['parts']:
        if abs(x) < w and z0 < z < z1:
            return -RUNWAY['depth'] if abs(x) < w - e and z0 + e < z < z1 - e else None
    return 0.0


def deck_plate(b: MB, xa, xb, za, zb, y, colour):
    """a rectangle of the flight deck (top or underside), its sides cut back to the planform"""
    wa, wb = deck_w(za), deck_w(zb)
    ca, cb = max(-wa, min(wa, xa)), max(-wa, min(wa, xb))
    da, db = max(-wb, min(wb, xa)), max(-wb, min(wb, xb))
    if (cb - ca) > 0.05 or (db - da) > 0.05:
        b.quad((ca, y, za), (da, y, zb), (db, y, zb), (cb, y, za), colour)


def runway(b: MB):
    """the runway's floor, a little below the deck in plates like it, and its sloping edges"""
    D, e, w = RUNWAY['depth'], RUNWAY['bevel'], RUNWAY['x']
    for z0, z1 in RUNWAY['parts']:
        zs = sorted(set([z0 + e, z1 - e] + [-100.0 + 10 * i for i in range(26) if z0 + e < -100.0 + 10 * i < z1 - e]))
        for za, zb in zip(zs, zs[1:]):
            for k, (xa, xb) in enumerate(((-(w - e), -10.0), (-10.0, 0.0), (0.0, 10.0), (10.0, w - e))):
                tone = shade(C['deck'], 0.86 + 0.04 * (((k + int((za + 100) / 10)) * 7) % 3 - 1))
                b.quad((xa, -D, za), (xa, -D, zb), (xb, -D, zb), (xb, -D, za), tone)
        slope = shade(C['deck'], 1.05)
        for s in (-1, 1):
            q = [(s * (w - e), -D, z0 + e), (s * w, 0, z0), (s * w, 0, z1), (s * (w - e), -D, z1 - e)]
            b.poly(q if s > 0 else list(reversed(q)), slope)
        b.quad((-w, 0, z0), (w, 0, z0), (w - e, -D, z0 + e), (-(w - e), -D, z0 + e), slope)
        b.quad((-(w - e), -D, z1 - e), (w - e, -D, z1 - e), (w, 0, z1), (-w, 0, z1), slope)


def deck(b: MB, d: MB, L: MB):
    # plates 10 m square in slightly different shades (cut where the outline bends), open over the lift's shaft
    zs = sorted(set([-100.0 + 10 * i for i in range(26)] + DECK_Z))
    for za, zb in zip(zs, zs[1:]):
        x = -40.0
        while x < 40 - 1e-6:
            k = int((x + 40) / 10) + int((za + 100) / 10) * 3
            tone = shade(C['deck'], 0.95 + 0.05 * ((k * 7) % 3 - 1))
            for pa, pb, qa, qb in around_holes((x, x + 10, za, zb), [HOLE] + [(-RUNWAY['x'], RUNWAY['x'], z0, z1) for z0, z1 in RUNWAY['parts']]):
                deck_plate(b, pa, pb, qa, qb, 0, tone)
            for pa, pb, qa, qb in around_hole(x, x + 10, za, zb):
                deck_plate(b, pa, pb, qa, qb, -1.5, C['deckUnder'])
            x += 10
    runway(b)
    # the deck's edge: its face, a light rim along the top
    for (za, wa), (zb, wb) in zip(DECK_PTS, DECK_PTS[1:]):
        for s in (-1, 1):
            q = [(s * wa, -1.5, za), (s * wa, 0, za), (s * wb, 0, zb), (s * wb, -1.5, zb)]
            b.poly(q if s > 0 else list(reversed(q)), C['deckEdge'])
            r = [(s * (wa - 0.7), 0.04, za), (s * (wb - 0.7), 0.04, zb), (s * wb, 0.04, zb), (s * wa, 0.04, za)]
            d.poly(r if s > 0 else list(reversed(r)), C['rim'])
    w0, wt = DECK_PTS[0][1], DECK_PTS[-1][1]
    b.quad((-w0, -1.5, -100), (-w0, 0, -100), (w0, 0, -100), (w0, -1.5, -100), C['deckEdge'])
    d.quad((-w0, 0.04, -100), (-w0, 0.04, -99.3), (w0, 0.04, -99.3), (w0, 0.04, -100), C['rim'])
    b.quad((wt, -1.5, END), (wt, 0, END), (-wt, 0, END), (-wt, -1.5, END), C['deckEdge'])
    markings(d)
    # the catapult: raised tracks with clamps along the centreline, the shuttle at the start
    yr = -RUNWAY['depth']
    for sx in (-1, 1):
        b.box((sx * 3.4 - 0.4, yr, 44), (sx * 3.4 + 0.4, yr + 0.3, 122), {'side': C['dark'], 'top': C['platform']})
        for z in range(50, 122, 8):
            b.box((sx * 3.4 - 0.55, yr, z), (sx * 3.4 + 0.55, yr + 0.38, z + 0.6), C['dark'])
    b.box((-2.6, yr, 46), (2.6, yr + 0.5, 49), {'side': C['yellow'], 'top': C['yellow']})
    # deck edge lights (not where the bunker stands), approach lights at the stern, a red light at the point
    z = -96.0
    while z <= END - 10:
        for s in (-1, 1):
            if deck_w(z) < 5 or (s < 0 and BUNKER_Z[0] - 1 < z < BUNKER_Z[1] + 1) or (s > 0 and -57 < z < -33):
                continue
            x = s * (deck_w(z) - 1.4)
            L.box((x - 0.3, 0, z - 0.3), (x + 0.3, 0.3, z + 0.3), C['lightWhite'])
            glow((x, 0.4, z), C['lightWhite'], 3.5)
        z += 12
    for x in range(-24, 25, 6):
        L.box((x - 0.3, 0, -99.4), (x + 0.3, 0.3, -98.8), C['lightBlue'])
        glow((x, 0.4, -99.1), C['lightBlue'], 4)
    L.box((-0.3, 0, END - 3), (0.3, 0.3, END - 2.4), C['lightRed'])
    glow((0, 0.45, END - 2.7), C['lightRed'], 5)
    # close-in weapons on the bow shoulders and the stern corners
    for x, z in ((-22.0, 106.0), (22.0, 106.0), (-28.0, -93.0), (28.0, -93.0)):
        ciws(b, x, z)


def side_digit(d: MB, n: int, cx: float, cz: float, y: float, w=6.0, h=12.0, t=1.3):
    """a big painted digit, upright for someone looking from port (glyph x runs aft, its y to starboard)"""
    seg = {'a': (0, h - t, w, h), 'b': (w - t, h / 2, w, h), 'c': (w - t, 0, w, h / 2), 'd': (0, 0, w, t), 'e': (0, 0, t, h / 2), 'f': (0, h / 2, t, h), 'g': (0, h / 2 - t / 2, w, h / 2 + t / 2)}
    X = lambda gy: cx + h / 2 - gy
    Z = lambda gx: cz + w / 2 - gx
    for k in DIGITS[n]:
        x0, y0, x1, y1 = seg[k]
        d.quad((X(y0), y, Z(x0)), (X(y0), y, Z(x1)), (X(y1), y, Z(x1)), (X(y1), y, Z(x0)), C['paint'])


def markings(d: MB):
    y, y2 = 0.06, 0.09
    strip = lambda x0, x1, z0, z1, c, yy=y: d.quad((x0, yy, z0), (x0, yy, z1), (x1, yy, z1), (x1, yy, z0), c)
    # the plate seams, a grid of 10 m, on the deck or down on the runway's floor (none over the lift or the sloping edges)
    hx0, hx1, hz0, hz1 = HOLE
    w, e = RUNWAY['x'], RUNWAY['bevel']
    cuts_x = [hx0, hx1, -w, -w + e, w - e, w]
    for i in range(1, 25):
        z = -100.0 + 10 * i
        edge = deck_w(z) - 0.8
        xs = sorted(set([-edge, edge] + [c for c in cuts_x if -edge < c < edge]))
        for xa, xb in zip(xs, xs[1:]):
            yy = surface((xa + xb) / 2, z)
            if yy is not None and not (hx0 < (xa + xb) / 2 < hx1 and hz0 < z < hz1):
                strip(xa, xb, z - 0.07, z + 0.07, C['deckSeam'], yy + 0.03)
    cuts_z = [hz0, hz1] + [c for z0, z1 in RUNWAY['parts'] for c in (z0, z0 + e, z1 - e, z1)]
    for x in (-30.0, -20.0, -10.0, 10.0, 20.0, 30.0):
        zend = max(zz for zz in [-100 + 0.5 * k for k in range(501)] if deck_w(zz) > abs(x) + 0.8)
        zs = sorted(set([-99.0, zend] + [c for c in cuts_z if -99.0 < c < zend]))
        for za, zb in zip(zs, zs[1:]):
            yy = surface(x, (za + zb) / 2)
            if yy is not None and not (hx0 < x < hx1 and hz0 < (za + zb) / 2 < hz1):
                strip(x - 0.07, x + 0.07, za, zb, C['deckSeam'], yy + 0.03)
    yr = -RUNWAY['depth'] + 0.06
    # threshold bars at the after end of the runway (on its floor)
    for k in range(8):
        x = -11.2 + k * 3.2
        strip(x, x + 1.6, -52.0, -45.0, C['paint'], yr)
    # white lines along the runway's edges on the deck, a dashed centreline down on its floor
    for s in (-1, 1):
        for z0, z1 in RUNWAY['parts']:
            xa, xb = sorted((s * (w + 0.15), s * (w + 0.65)))
            strip(xa, xb, z0, z1, C['paint'])
        # thin light blue lines along the catapult, as far as the deck is wide enough
        xa, xb = sorted((s * 15.6, s * 15.85))
        strip(xa, xb, 42.0, 126.0, C['line'])
    z = -52.0
    while z < END - 18:
        if not (LIFT['z0'] - 2 < z + 4.5 and z < LIFT['z1'] + 2) and not (44 <= z <= 128):
            strip(-0.4, 0.4, z, z + 4.5, C['paint'], yr)
        z += 8
    # the ship's number, big on the port side of the forward deck, read from port (as on the title picture)
    side_digit(d, 0, 22.0, 70.0, y2)
    side_digit(d, 7, 22.0, 62.0, y2)
    # the lift's hazard border (its plate is a moving part: lift_parts)
    bd = LIFT_BORDER
    x, k = -LIFT['x'], 0
    while x < LIFT['x'] - 0.01:
        x1 = min(LIFT['x'], x + 1.5)
        c = C['dark'] if k % 2 else C['yellow']
        strip(x, x1, LIFT['z0'], LIFT['z0'] + bd, c)
        strip(x, x1, LIFT['z1'] - bd, LIFT['z1'], c)
        x += 1.5
        k += 1
    z, k = LIFT['z0'] + bd, 0
    while z < LIFT['z1'] - bd - 0.01:
        z1 = min(LIFT['z1'] - bd, z + 1.5)
        c = C['yellow'] if k % 2 else C['dark']
        strip(-LIFT['x'], -LIFT['x'] + bd, z, z1, c)
        strip(LIFT['x'] - bd, LIFT['x'], z, z1, c)
        z += 1.5
        k += 1
    # drone pad: a circle with a cross and an arrow
    cz, r0, r1 = PAD_Z, 12, 13
    for i in range(20):
        a, c2 = i / 20 * 2 * math.pi, (i + 1) / 20 * 2 * math.pi
        d.quad((math.cos(a) * r0, y, cz + math.sin(a) * r0), (math.cos(a) * r1, y, cz + math.sin(a) * r1),
               (math.cos(c2) * r1, y, cz + math.sin(c2) * r1), (math.cos(c2) * r0, y, cz + math.sin(c2) * r0), C['paint'])
    strip(-0.6, 0.6, cz - 7, cz + 7, C['paint'])
    for s in (-1, 1):
        xa, xb = sorted((s * 0.6, s * 7))
        strip(xa, xb, cz - 0.6, cz + 0.6, C['paint'])
    d.poly([(-2.5, y2, cz + 9), (2.5, y2, cz + 9), (0, y2, cz + 11)], C['yellow'])


def ciws(b: MB, x, z, y=0.0):
    """a close-in weapon system: base, white radome, a six-barrel gun"""
    b.cylinder((x, y, z), 2.4, 2.2, 1.2, 10, C['platform'], C['platformTop'])
    b.cylinder((x, y + 1.2, z), 1.9, 1.3, 1.6, 10, C['white'], C['white'])
    b.cone((x, y + 2.8, z), 1.3, 1.0, 10, C['white'])
    b.box((x - 0.5, y + 1.4, z + 1.2), (x + 0.5, y + 2.1, z + 1.8), C['dark'])
    for k in range(6):
        a = k * math.pi / 3
        dx, dy = 0.18 * math.cos(a), 0.18 * math.sin(a)
        b.beam((x + dx, y + 1.75 + dy, z + 1.8), (x + dx, y + 1.75 + dy, z + 3.6), 0.07, C['dark'])


def lift_shaft(b: MB, L: MB):
    """the shaft under the lift's opening: dark walls with lamp strips, the floor the platform rests on in the hangar"""
    x0, x1, z0, z1 = HOLE
    yb = -LIFT_DEPTH - 0.8
    for (ax, az), (bx, bz) in (((x0, z0), (x1, z0)), ((x1, z0), (x1, z1)), ((x1, z1), (x0, z1)), ((x0, z1), (x0, z0))):
        b.quad((ax, yb, az), (bx, yb, bz), (bx, 0, bz), (ax, 0, az), C['deckUnder'])
    b.quad((x0, yb, z0), (x1, yb, z0), (x1, yb, z1), (x0, yb, z1), C['dark'])
    for s in (-1, 1):
        xw = s * (x1 - 0.06)
        for y in (-3.0, -7.0):
            for zz in (LIFT_Z - 6, LIFT_Z + 6):
                L.box((xw - 0.05, y - 0.15, zz - 2), (xw + 0.05, y + 0.15, zz + 2), C['lightWarm'])


def lift_parts():
    """the lift platform round its pivot (the middle of the lift, deck height): a plate with seams and the ship's emblem"""
    plate, paint = MB(), MB()
    hx, hz = PLATFORM['x'], (PLATFORM['z1'] - PLATFORM['z0']) / 2
    plate.box((-hx, -0.8, -hz), (hx, 0, hz), {'side': C['dark'], 'top': C['lift'], 'bottom': C['dark']})
    y, y2 = 0.06, 0.09
    for z in (-4.5, 4.5):
        paint.quad((-hx, y, z - 0.12), (-hx, y, z + 0.12), (hx, y, z + 0.12), (hx, y, z - 0.12), C['liftSeam'])
    # the emblem: white peak, ochre hill, a band of sea
    paint.poly([(-6.5, y2, -6.5), (6.5, y2, -6.5), (0, y2, 7.5)], C['paint'])
    paint.poly([(-8.6, y2 + 0.01, -6.5), (1.0, y2 + 0.01, -6.5), (-3.8, y2 + 0.01, 1.6)], C['accent'])
    paint.quad((-9.5, y2 + 0.02, -8.3), (9.5, y2 + 0.02, -8.3), (9.5, y2 + 0.02, -6.7), (-9.5, y2 + 0.02, -6.7), 'wasserMittel')
    return plate, paint


# ---------------------------------------------------------------- the command bunker (starboard)
def bunker(b: MB, d: MB, L: MB):
    """
    Two angular tiers on the starboard deck edge, their faces sloping in. The upper one is the bridge: its front
    is open between sill and lintel, so the bridge camera inside looks out over the deck between slim mullions.
    On the roof a row of vent blocks, a radome and the mast that carries the rotating radar.
    """
    z0, z1 = BUNKER_Z
    # the sponson it stands on, out past the deck edge
    b.slab([(-39.0, z0 - 1), (-39.0, z1 + 1), (-41.5, z1 + 1), (-44.5, z1 + 4), (-44.5, z0 + 4), (-41.5, z0 - 1)],
           lambda x, z: 0.0, lambda x, z: -5.5, C['supDark'], C['band'], C['hullDark'])
    # tier 1: from the deck to y 6, a chamfered outline whose faces lean in (front most)
    base = [(-21.0, z0 + 3), (-21.0, z1 - 4.5), (-24.5, z1), (-40.5, z1), (-44.0, z1 - 3.5), (-44.0, z0 + 3), (-41.0, z0), (-24.0, z0)]
    top = [(-22.6, z0 + 4.2), (-22.6, z1 - 6.5), (-25.6, z1 - 3.4), (-39.6, z1 - 3.4), (-42.4, z1 - 6.0), (-42.4, z0 + 4.2), (-40.0, z0 + 1.5), (-24.8, z0 + 1.5)]
    cols = [C['supLight'], C['supLight'], C['supLight'], C['sup'], C['supDark'], C['supDark'], C['supDark'], C['sup']]
    b.loft([[(x, 0.0, z) for x, z in base], [(x, T1, z) for x, z in top]], cols, cap1=C['supTop'])
    cx, cz = sum(x for x, _ in base) / 8, sum(z for _, z in base) / 8

    def face(i, t, u, off=0.07):
        """a point on the sloping face i, standing off it outwards (paint flush with a face flickers in the distance)"""
        (x0, z0), (x1, z1) = base[i], base[(i + 1) % 8]
        nx, nz = z1 - z0, -(x1 - x0)
        n = math.hypot(nx, nz)
        nx, nz = nx / n, nz / n
        if ((x0 + x1) / 2 - cx) * nx + ((z0 + z1) / 2 - cz) * nz < 0:
            nx, nz = -nx, -nz
        return (lerp(lerp(x0, x1, u), lerp(top[i][0], top[(i + 1) % 8][0], u), t) + nx * off, T1 * t,
                lerp(lerp(z0, z1, u), lerp(top[i][1], top[(i + 1) % 8][1], u), t) + nz * off)
    # dark window slits along the inboard face and the front, an ochre band under the roof edge, two doors
    for i, n in ((0, 9), (1, 2), (2, 7)):
        for k in range(n):
            ua, ub = (k + 0.2) / n, (k + 0.8) / n
            d.poly([face(i, 0.45, ua), face(i, 0.45, ub), face(i, 0.66, ub), face(i, 0.66, ua)], C['window'])
            if i == 2 or k % 3 == 1:
                L.poly([face(i, 0.5, ua + 0.05 / n, 0.12), face(i, 0.5, ub - 0.05 / n, 0.12), face(i, 0.6, ub - 0.05 / n, 0.12), face(i, 0.6, ua + 0.05 / n, 0.12)], C['windowLit'])
    for i in (0, 1, 2):
        d.poly([face(i, 0.86, 0), face(i, 0.86, 1), face(i, 0.92, 1), face(i, 0.92, 0)], C['accent'])
    for u in (0.2, 0.62):
        d.poly([face(0, 0.0, u), face(0, 0.0, u + 0.05), face(0, 0.36, u + 0.05), face(0, 0.36, u)], C['hatch'])
    glow((-21.0, 0.55 * T1, z1 - 10), C['lightWarm'], 4)
    glow((-30.0, 0.55 * T1, z1 + 0.6), C['lightWarm'], 4)
    bridge_tier(b, d, L)
    roof(b, d, L)


def bridge_tier(b: MB, d: MB, L: MB):
    y0, y1 = T1, T2
    # the front turned square to the bridge camera, which looks a little to port (so the window frame lies level in its picture)
    eye, look = CAMERAS['bridge']['eye'], CAMERAS['bridge']['look']
    skew = math.tan(math.atan2(look[0] - eye[0], look[2] - eye[2]))
    fz = lambda x, z: z - (x + 31.75) * skew
    fi0, fo0, bo0, bi0 = (-24.0, fz(-24.0, -30.0)), (-39.5, fz(-39.5, -30.0)), (-39.5, -57.0), (-24.0, -57.0)
    fi1, fo1, bo1, bi1 = (-25.0, fz(-25.0, -31.2)), (-38.5, fz(-38.5, -31.2)), (-38.5, -56.0), (-25.0, -56.0)
    P = lambda xz, y: (xz[0], y, xz[1])
    b.quad(P(bi0, y0), P(fi0, y0), P(fi1, y1), P(bi1, y1), C['supLight'])
    b.quad(P(fo0, y0), P(bo0, y0), P(bo1, y1), P(fo1, y1), C['supDark'])
    b.quad(P(bo0, y0), P(bi0, y0), P(bi1, y1), P(bo1, y1), C['supDark'])
    b.quad(P(fi1, y1), P(fo1, y1), P(bo1, y1), P(bi1, y1), C['supTop'])

    def front(t, u):
        a = (lerp(fi0[0], fi1[0], t), lerp(fi0[1], fi1[1], t))
        c = (lerp(fo0[0], fo1[0], t), lerp(fo0[1], fo1[1], t))
        return (lerp(a[0], c[0], u), lerp(y0, y1, t), lerp(a[1], c[1], u))
    # the lintel low enough that the bridge camera sees it as a band along the top of its picture
    ts, tl = (9.0 - y0) / (y1 - y0), (10.7 - y0) / (y1 - y0)
    ua, ub = 0.07, 0.93
    b.quad(front(0, 0), front(0, 1), front(ts, 1), front(ts, 0), C['supLight'])
    b.quad(front(tl, 0), front(tl, 1), front(1, 1), front(1, 0), C['supLight'])
    b.quad(front(ts, 0), front(ts, ua), front(tl, ua), front(tl, 0), C['supLight'])
    b.quad(front(ts, ub), front(ts, 1), front(tl, 1), front(tl, ub), C['supLight'])
    # sill and lintel give the opening some depth; no struts across it
    inside = lambda p, dz: (p[0], p[1], p[2] - dz)
    b.quad(front(ts, ua), front(ts, ub), inside(front(ts, ub), 0.6), inside(front(ts, ua), 0.6), C['supDark'])
    b.quad(inside(front(tl, ua), 0.6), inside(front(tl, ub), 0.6), front(tl, ub), front(tl, ua), C['supDark'])
    bridge_interior(b, d, L)
    # the visor over the window, a lamp in the ceiling (seen from outside at night)
    b.quad(front(1, 0), inside(front(1, 0), -1.4), inside(front(1, 1), -1.4), front(1, 1), C['supTop'])
    L.box((-35.0, y1 - 0.12, -38.0), (-28.0, y1 - 0.05, -36.0), C['lightWarm'])
    for u in (0.2, 0.8):
        glow(front(0.6, u), C['lightWarm'], 3)


def bridge_interior(b: MB, d: MB, L: MB):
    """
    What the bridge camera sees of the room at the edges of its picture: below, the far edge of the helm console with
    two engine levers, a compass binnacle and a row of small pilot lamps; above, an overhead rail on brackets with a
    lamp. Built in the camera's own frame (z ahead, x to port), so they sit square in its picture.
    """
    eye, look = CAMERAS['bridge']['eye'], CAMERAS['bridge']['look']
    yaw = math.atan2(look[0] - eye[0], look[2] - eye[2])
    for m in (b, d, L):
        m.push((eye[0], 0.0, eye[2]), ry=yaw)
    # the console: a sloping desk rising towards the window, its far lip a narrow band along the bottom of the picture
    b.xslab([(0.95, T1), (1.7, T1), (1.7, 9.28), (1.6, 9.32), (0.95, 9.12)], 3.0, C['supDark'], C['platform'])
    d.quad((-3.0, 9.335, 1.55), (3.0, 9.335, 1.55), (3.0, 9.3, 1.68), (-3.0, 9.3, 1.68), C['deckEdge'])
    for x in (-1.0, -0.5, 1.0):
        L.box((x - 0.015, 9.335, 1.6), (x + 0.015, 9.35, 1.62), C['lightGreen'] if x < 0 else C['lightWarm'])
    # two small engine levers left of the middle, their handles just above the lip; the compass binnacle to the right
    b.box((0.34, 9.27, 1.44), (0.58, 9.33, 1.56), {'side': C['dark'], 'top': C['platform']})
    for x in (0.39, 0.53):
        b.beam((x, 9.32, 1.48), (x, 9.45, 1.53), 0.02, C['deckEdge'])
        b.box((x - 0.04, 9.445, 1.515), (x + 0.04, 9.47, 1.545), C['black'])
    b.cylinder((-0.5, 9.29, 1.52), 0.06, 0.05, 0.08, 8, C['dark'], C['platform'])
    b.cylinder((-0.5, 9.37, 1.52), 0.05, 0.03, 0.04, 8, C['radarLight'], C['radarLight'])
    # overhead: a box rail across the room on brackets from the ceiling, a conduit under it, a lamp off to the side
    b.box((-3.0, 10.52, 1.36), (3.0, 10.64, 1.5), {'side': C['supDark'], 'bottom': C['sup'], 'top': C['supDark']})
    b.box((-3.0, 10.64, 1.38), (3.0, 10.7, 1.48), C['dark'])
    b.beam((-3.0, 10.44, 1.34), (3.0, 10.44, 1.34), 0.035, C['deckEdge'])
    for x in (-2.4, -0.9, 0.9, 2.4):
        b.beam((x, 10.64, 1.43), (x, T2, 1.43), 0.06, C['deckEdge'])
        b.box((x - 0.05, 10.42, 1.33), (x + 0.05, 10.66, 1.37), C['dark'])
    b.box((2.0, 10.4, 1.38), (2.3, 10.52, 1.48), C['dark'])
    L.box((2.04, 10.39, 1.4), (2.26, 10.4, 1.46), C['lightWarm'])
    for m in (b, d, L):
        m.pop()


def roof(b: MB, d: MB, L: MB):
    y = T2
    # a row of big vent blocks along the inboard edge (as on the title picture), a radome, whip antennas at the back
    for za in (-55.0, -50.0, -45.0, -40.0):
        b.box((-30.2, y, za), (-25.6, y + 2.4, za + 4.2), {'side': C['supDark'], 'top': C['sup']})
        d.quad((-25.52, y + 0.5, za + 0.5), (-25.52, y + 0.5, za + 3.7), (-25.52, y + 1.9, za + 3.7), (-25.52, y + 1.9, za + 0.5), C['grille'])
    radome(b, -36.0, y, -53.0, 1.5)
    for x, z in ((-37.5, -55.0), (-26.5, -55.5)):
        b.beam((x, y, z), (x, y + 6.5, z - 0.6), 0.1, C['dark'])
    # the mast: a tapered post with a yardarm, the radar on top (a moving part), a red light
    mx, mz = MAST
    b.cylinder((mx, y, mz), 1.1, 0.7, 4.0, 6, C['sup'], C['supTop'])
    b.beam((mx - 3.2, y + 3.0, mz), (mx + 3.2, y + 3.0, mz), 0.18, C['dark'])
    for s in (-1, 1):
        L.box((mx + s * 3.2 - 0.15, y + 2.7, mz - 0.15), (mx + s * 3.2 + 0.15, y + 2.95, mz + 0.15), C['lightRed'] if s < 0 else C['lightGreen'])
        glow((mx + s * 3.2, y + 2.8, mz), C['lightRed'] if s < 0 else C['lightGreen'], 2.5)


def radome(b: MB, x, y, z, r):
    b.cylinder((x, y, z), r * 0.8, r * 0.8, 0.8, 10, C['platform'], C['platformTop'])
    b.cylinder((x, y + 0.8, z), r, r * 0.75, r * 0.7, 10, C['white'], C['white'])
    b.cone((x, y + 0.8 + r * 0.7, z), r * 0.75, r * 0.6, 10, C['white'])


# ---------------------------------------------------------------- port side, stern units
def port_side(b: MB, d: MB, L: MB):
    # the gun sponson: a thick box out past the deck edge, the barbette for the twin laser on top
    gx, gz = GUN
    b.slab([(39.0, gz - 11), (41.5, gz - 11), (45.5, gz - 7), (45.5, gz + 7), (41.5, gz + 11), (39.0, gz + 11)],
           lambda x, z: 0.0, lambda x, z: -6.5, C['supDark'], C['band'], C['hullDark'])
    b.cylinder((gx, 0, gz), 3.8, 3.5, 1.0, 8, C['platform'], C['platformTop'], None, math.pi / 8)
    d.poly([(45.58, -1.2, gz - 6), (45.58, -1.2, gz + 6), (45.58, -2.0, gz + 6), (45.58, -2.0, gz - 6)], C['accent'])
    ciws(b, 42.5, gz + 7.5)
    # the loading platform, lowered to the upper gallery: three ACCBs waiting, a rail along its edge, struts under it
    za, zb = LOAD_Z
    yp = -5.2
    b.slab([(37.0, za), (48.0, za + 2), (50.0, za + 5), (50.0, zb - 3), (48.0, zb), (37.0, zb)],
           lambda x, z: yp, lambda x, z: yp - 0.8, C['ledge'], C['band'], C['ledgeEdge'])
    for z in range(int(za) + 3, int(zb) - 2, 4):
        b.beam((49.7, yp, z), (49.7, yp + 1.1, z), 0.1, C['platform'])
    b.beam((49.7, yp + 1.1, za + 5), (49.7, yp + 1.1, zb - 3), 0.1, C['platform'])
    for z in (za + 4, (za + zb) / 2, zb - 4):
        b.beam((47.0, yp - 0.8, z), (36.4, -12.0, z), 0.5, C['dark'])
    for z in (za + 7, (za + zb) / 2, zb - 7):
        b.push((44.0, yp, z))
        deck_accb(b, 0.0, 0.0)
        b.pop()
    stripes_on = [(37.4, za + 0.3), (37.4, zb - 1.3)]
    for x, z in stripes_on:
        d.quad((x, yp + 0.02, z), (x, yp + 0.02, z + 1.0), (49.5, yp + 0.02, z + 1.0), (49.5, yp + 0.02, z), C['yellow'])
    for z in (za + 2, zb - 2):
        L.box((49.6, yp + 1.2, z - 0.2), (49.9, yp + 1.5, z + 0.2), C['lightWarm'])
        glow((49.9, yp + 1.4, z), C['lightWarm'], 3)


def vents(b: MB, d: MB):
    """ribbed exhaust housings on both stern quarters, out past the deck edge (the 'turbines' of the title picture)"""
    for s in (-1, 1):
        x0, x1 = sorted((s * 35.0, s * 44.0))
        xo = s * 44.0
        b.prism([(x0, -88.0), (x1, -88.0), (x1, -72.0), (x0, -72.0)], -9.0, 2.6, C['supDark'], C['sup'], C['band'])
        xa, xb = sorted((xo, xo + s * 0.9))
        b.box((xa, -7.8, -86.5), (xb, 1.4, -73.5), C['grille'])
        z = -86.0
        while z <= -73.5:
            xa, xb = sorted((xo, xo + s * 1.5))
            b.box((xa, -8.4, z), (xb, 2.0, z + 0.45), C['rib'])
            z += 1.25
        # the top: a grille between two rails
        xa, xb = sorted((s * 36.5, s * 42.5))
        d.quad((xa, 2.68, -86.5), (xa, 2.68, -73.5), (xb, 2.68, -73.5), (xb, 2.68, -86.5), C['grille'])


def deck_accb(b: MB, x, z):
    ph = math.pi / 8
    b.cylinder((x, 0.6, z), 1.6, 1.7, 2.6, 8, C['accent'], C['accent'], None, ph)
    b.cylinder((x, 1.5, z), 1.66, 1.66, 0.3, 8, C['accentDark'], C['accentDark'], None, ph)
    b.cylinder((x, 3.2, z), 1.7, 1.7, 0.35, 8, C['dark'], C['dark'], None, ph)
    b.cylinder((x, 3.55, z), 1.7, 1.15, 0.9, 8, 'weiss', C['platformTop'], None, ph)
    b.cone((x, 4.45, z), 1.15, 0.5, 8, C['accent'])
    for i in range(4):
        a = ph + i * math.pi / 2
        cx, czz = math.cos(a), math.sin(a)
        b.beam((x + cx * 1.4, 0.9, z + czz * 1.4), (x + cx * 2.1, 0.05, z + czz * 2.1), 0.14, C['platform'])


# ---------------------------------------------------------------- moving parts
def radar_part() -> MB:
    """a flat phased array on a turning head"""
    b = MB()
    b.cylinder((0, 0, 0), 0.9, 0.9, 1.0, 8, C['dark'], C['platformTop'])
    y = 2.6
    b.box((-0.5, 1.0, -0.5), (0.5, y - 1.2, 0.5), C['dark'])
    pts = [(-5.5, y - 1.3), (5.5, y - 1.3), (6.2, y), (5.5, y + 1.3), (-5.5, y + 1.3), (-6.2, y)]
    b.zprism(pts, -0.35, 0.35, C['radar'], C['radarDark'])
    # the array's face and its dividers stand clear of the housing (flush faces flicker in the distance)
    b.box((-5.3, y - 1.1, 0.35), (5.3, y + 1.1, 0.45), {'side': C['radarDark'], 'front': C['radarLight'], 'back': C['radarDark'], 'top': C['radarDark']})
    for x in (-3.5, 0.0, 3.5):
        b.box((x - 0.06, y - 1.1, 0.45), (x + 0.06, y + 1.1, 0.53), C['radarDark'])
    b.beam((0, y, -0.35), (0, y, -1.6), 0.4, C['dark'])
    return b


def turret_parts():
    h = MB()
    h.cylinder((0, 0, 0), 3.0, 2.6, 1.4, 8, C['platform'], C['platformTop'], None, math.pi / 8)
    h.cylinder((0, 1.25, 0), 2.7, 2.7, 0.2, 8, C['accent'], C['accent'], None, math.pi / 8)
    h.push((0, 1.4, 0))
    h.zprism([(-2.4, 0), (2.4, 0), (2.8, 1.5), (1.6, 2.9), (-1.6, 2.9), (-2.8, 1.5)], -2.8, 2.2, C['turretBody'], 'weiss')
    h.pop()
    h.box((-1.0, 4.3, -2.2), (1.0, 4.9, -0.6), {'side': C['dark'], 'top': C['platform']})
    for s in (-1, 1):
        h.box((s * 2.85 - 0.08, 2.0, -2.0), (s * 2.85 + 0.08, 3.2, 1.2), C['dark'])
    g = MB()
    g.box((-1.6, -0.8, -1.2), (1.6, 0.8, 1.0), {'side': C['dark'], 'top': C['platform']})
    for x in (-0.75, 0.75):
        g.push((x, 0, 1.0), rx=math.pi / 2)
        g.cylinder((0, 0, 0), 0.55, 0.45, 6.2, 8, C['barrel'], C['barrel'])
        for k in range(5):
            g.cylinder((0, 0.4 + k * 0.5, 0), 0.72, 0.72, 0.14, 8, C['platform'], C['platform'], C['platform'])
        g.cylinder((0, 6.2, 0), 0.55, 0.55, 0.5, 8, C['platform'], C['platform'])
        g.cone((0, 6.7, 0), 0.45, 1.0, 8, C['turret'])
        g.pop()
    return h, g


def stern_door() -> MB:
    b = MB()
    h = DOCK_TOP - (WATERLINE - 1.2)
    b.box((-DOCK_X + 0.3, -h, -0.9), (DOCK_X - 0.3, 0, 0), {'side': C['hullMid'], 'front': C['hullLow'], 'back': C['hullMid']})
    x = -DOCK_X + 4.0
    while x < DOCK_X - 2:
        b.box((x, -h + 0.5, -1.25), (x + 0.6, -0.5, -0.9), C['hullLow'])
        x += 7.5
    b.box((-DOCK_X + 0.3, -1.2, -1.3), (DOCK_X - 0.3, -0.6, -0.9), C['accent'])
    return b


# ---------------------------------------------------------------- assembly
def build():
    GLOWS.clear()
    coll = reset()
    body, decals, lights = MB(), MB(), MB()
    hull(body, decals, lights)
    deck(body, decals, lights)
    lift_shaft(body, lights)
    bunker(body, decals, lights)
    port_side(body, decals, lights)
    vents(body, decals)
    o_body = body.build('body', coll, bevel=0.12, smooth_limit=28)
    decals.build('decals', coll, jitter=0.0)
    lights.build('lights', coll, jitter=0)
    for i, (pos, colour, size) in enumerate(GLOWS):
        glow_point(f'glow.{i}', coll, pos, colour, size)
    for name, cam in CAMERAS.items():
        e = bpy.data.objects.new(f'cam.{name}', None)
        e.empty_display_size = 1
        e.location = to_blender(cam['eye'])
        e['eye'] = list(cam['eye'])
        e['look'] = list(cam['look'])
        coll.objects.link(e)

    def pivot(name, pos, parent=None):
        e = bpy.data.objects.new(name, None)
        e.empty_display_size = 2
        e.location = to_blender(pos)
        coll.objects.link(e)
        if parent is not None:
            e.parent = parent
        return e

    parts = [o_body]
    p_radar = pivot('radar', (MAST[0], T2 + 4.0, MAST[1]))
    m = radar_part().build('radar.mesh', coll, bevel=0.05)
    m.parent = p_radar
    parts.append(m)
    p_turret = pivot('turret', (GUN[0], 1.0, GUN[1]))
    h, g = turret_parts()
    m = h.build('turret.mesh', coll, bevel=0.06)
    m.parent = p_turret
    parts.append(m)
    p_barrel = pivot('barrel', (0, 2.9, 1.6), p_turret)
    m = g.build('barrel.mesh', coll, bevel=0.04)
    m.parent = p_barrel
    parts.append(m)
    p_lift = pivot('lift', (0, 0, LIFT_Z))
    plate, paint = lift_parts()
    m = plate.build('lift.mesh', coll, bevel=0.08)
    m.parent = p_lift
    parts.append(m)
    paint.build('decals.lift', coll, jitter=0.0).parent = p_lift
    p_door = pivot('sternDoor', (0, DOCK_TOP, -100.05))
    m = stern_door().build('sternDoor.mesh', coll, bevel=0.1)
    m.parent = p_door
    parts.append(m)

    apply_modifiers(parts)
    body_mat, light_mat = vertex_colour_material('stoorworm'), vertex_colour_material('stoorworm-lights', emission=3.0)
    for o in coll.all_objects:
        if o.type == 'MESH':
            o.data.materials.clear()
            o.data.materials.append(light_mat if o.name.startswith('lights') else body_mat)
    if '--no-bake' not in ARGS:
        # short and light: only corners and seams darken, the plates keep their gunmetal
        bake_ambient_occlusion(parts, strength=0.45, distance=1.5, samples=64)
    return coll


def export():
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, OUT + '.blend'))
    safe_names()
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(HERE, OUT + '.glb'), export_format='GLB', export_yup=True, export_apply=True,
        export_vertex_color='ACTIVE', export_extras=True, export_normals=False, export_materials='EXPORT')


def render():
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    world = scene.world or bpy.data.worlds.new('World')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (*PAL['stahlHell'], 1.0)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.55
    bpy.ops.mesh.primitive_plane_add(size=3000, location=(0, 0, WATERLINE))
    sea = bpy.context.object
    sm = bpy.data.materials.new('sea')
    sm.use_nodes = True
    sm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*PAL['wasserMittel'], 1.0)
    sea.data.materials.append(sm)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.clip_end = 5000
    scene.collection.objects.link(cam)
    scene.camera = cam
    out = os.path.join(HERE, 'renders')
    os.makedirs(out, exist_ok=True)
    views = {'outside': (CAMERAS['outside']['eye'], CAMERAS['outside']['look'], 40), 'bridge': (CAMERAS['bridge']['eye'], CAMERAS['bridge']['look'], 24)}
    for name, (eye, look, lens) in views.items():
        cam.location = to_blender(eye)
        cam.rotation_euler = (to_blender(look) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        cam.data.lens = lens
        scene.render.filepath = os.path.join(out, f'{OUT}-{name}.png')
        bpy.ops.render.render(write_still=True)


build()
export()
if '--render' in ARGS:
    render()
print('STOORWORM DONE')
