"""
The Stoorworm in its earlier spear design with the dome (dark steel). No longer in the game (since 2026-10-23
the Stoorworm after the title picture, build_stoorworm.py); kept for reference, writes stoorworm_kuppel.*.

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python art/stoorworm/build_stoorworm_kuppel.py -- [--render] [--no-bake]

Writes art/stoorworm/stoorworm.blend and stoorworm.glb (with --render also renders/). The frame is the one
of src/models/carrier.ts for the design 'speer' (carrier coordinates: deck at y = 0, +z forward, x to port,
waterline at y = -20; the flight deck 80 m wide runs out into a point at z = 150), and so is everything the
game relies on: the lift (x ±16.5, z 12…38), the catapult (z 44…128), the drone pad (z = -70), the stern
dock (x ±27, y -26…-11, z -100…-74), the camera masts, the boom and the crane. The parts the game moves:
  radar          pivot (0, 11.2, -34), turns about y
  turret         pivot (-29, 4, -34), turns about y; its child barrel pivot (0, 2.9, 1.6), elevation about x
  sternDoor      pivot (0, -11, -100.05), rotation x from 0 (closed) to 1.45 (open)
  lights (lit windows and lamps), decals (markings, drawn with a depth offset), glow_* (glow points)
  lift           pivot (0, 0, 25), the Skua lift's platform: position y from 0 (deck) down to -9 (hangar)
New: the bridge is a glazed cab on the front of the dome with an open front window, a low console
inside and the camera behind it (cam_bridge: eye and look as custom properties). The ship runs itself:
no crew on deck, the Skuas wait in the hangar and come up on the lift to start.
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


def lin(hexs):
    rgb = [int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb)


# the spear's colours (SPEAR_COL in carrier.ts)
C = {
    'deck': 'anthrazit', 'deckUnder': 'schwarz', 'deckEdge': 'deckDunkel', 'deckDark': 'schwarz',
    'hull': 'metall', 'hullMid': 'deckDunkel', 'hullLow': 'deckDunkel', 'boot': 'schwarz', 'antifoul': 'anthrazit',
    'plate': 'metallHell', 'seam': 'anthrazit',
    'sup': 'deckDunkel', 'supLight': 'metall', 'supTop': 'metallHell', 'supDark': 'anthrazit',
    'accent': 'ocker', 'accentDark': 'ockerDunkel', 'hatch': 'schwarz', 'window': 'fensterBlau', 'windowLit': 'lichtWarm',
    'tower': 'metall', 'towerDark': 'anthrazit', 'platform': 'anthrazit', 'platformTop': 'deckDunkel',
    'radar': 'metallHell', 'radarLight': 'stahlHell', 'radarDark': 'anthrazit',
    'turret': 'glasBlau', 'turretBody': 'metall', 'barrel': 'weiss', 'lift': 'deckDunkel', 'liftSeam': 'anthrazit',
    'white': 'stahlHell', 'paint': 'weiss', 'yellow': 'signalGelb', 'dark': 'anthrazit', 'black': 'schwarz',
    'dock': 'schwarz', 'dockWall': 'anthrazit', 'dockCeiling': 'deckDunkel', 'boat': 'rettungsOrange', 'boatTop': 'signalOrange',
    'lightWarm': 'lichtWarm', 'lightWhite': 'lichtWeiss', 'lightRed': 'lichtRot', 'lightGreen': 'lichtGruen', 'lightBlue': 'lichtBlau',
    'accentLight': 'lichtWarm',
}

# the game's frame (carrier.ts)
HULL_Y = [-1.5, -7, -20, -26]
WATERLINE = -20
DOCK_X, DOCK_TOP, DOCK_FLOOR, DOCK_END = 27, -11, -26, -74
DECK_W = 40
STATIONS = [(-100, [38, 39.5, 34, 30]), (-60, [40, 41.5, 34, 27]), (-20, [40, 41.5, 32, 23]),
            (20, [38.5, 40, 28, 18]), (50, [30, 31.5, 21, 12]), (80, [21, 22.5, 13, 6]), (110, [12, 13.5, 6, 2])]
BOW_TIP = [150, 146, 134, 120]
DECK_Z = [-100, 20, 50, 80, 110, 130, 150]
BAYS = [(-90, -76), (-64, -50), (22, 36), (50, 62)]
RUN_LIGHTS = [(70, 122, -3.0, -2.2), (-96, -82, -3.4, -3.4)]
LIFT = {'x': 16.5, 'z0': 12, 'z1': 38}
# the Skua lift: a platform inside the hazard border that sinks LIFT_DEPTH into its shaft, the hangar below deck
# (the game's LIFT_DEPTH in src/models/carrier.ts)
LIFT_BORDER = 0.9
LIFT_DEPTH = 9.0
LIFT_Z = (LIFT['z0'] + LIFT['z1']) / 2
PLATFORM = {'x': LIFT['x'] - LIFT_BORDER, 'z0': LIFT['z0'] + LIFT_BORDER, 'z1': LIFT['z1'] - LIFT_BORDER}
HOLE = (-PLATFORM['x'] - 0.05, PLATFORM['x'] + 0.05, PLATFORM['z0'] - 0.05, PLATFORM['z1'] + 0.05)
END = DECK_Z[-1]
DOME_Z = -34
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
    return DECK_W if z <= 20 else max(0.0, DECK_W * (150 - z) / 130)


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
    rows = []
    z = -100.0
    while z < last - 1:
        rows.append(z)
        z += 12.5
    rows.append(last)
    ring = lambda l: [(z, level_width(l, z)) for z in rows] + [(BOW_TIP[l], 0.0)]
    band = [(C['hull'], C['plate']), (C['hullMid'], C['hullLow']), (C['antifoul'], C['antifoul'])]
    for l in range(3):
        A, B, ya, yb = ring(l), ring(l + 1), HULL_Y[l], HULL_Y[l + 1]
        for i in range(len(A) - 1):
            for s in (-1, 1):
                b.poly([(s * A[i][1], ya, A[i][0]), (s * B[i][1], yb, B[i][0]), (s * B[i + 1][1], yb, B[i + 1][0]), (s * A[i + 1][1], ya, A[i + 1][0])], band[l][i % 2])
    K = ring(3)
    for i in range(len(K) - 1):
        b.quad((-K[i][1], -26, K[i][0]), (K[i][1], -26, K[i][0]), (K[i + 1][1], -26, K[i + 1][0]), (-K[i + 1][1], -26, K[i + 1][0]), C['antifoul'])

    for s in (-1, 1):
        z = -92.0
        while z <= last - 6:
            d.quad(on_hull(s, -1.7, z), on_hull(s, -6.9, z), on_hull(s, -6.9, z + 0.35), on_hull(s, -1.7, z + 0.35), C['seam'])
            d.quad(on_hull(s, -7.1, z), on_hull(s, -19.4, z), on_hull(s, -19.4, z + 0.35), on_hull(s, -7.1, z + 0.35), C['seam'])
            z += 12.5
        for i in range(len(rows) - 1):
            za, zb = rows[i] + 0.01, rows[i + 1]
            d.quad(on_hull(s, -6.5, za), on_hull(s, -6.5, zb), on_hull(s, -7, zb), on_hull(s, -7, za), C['accent'])
            d.quad(on_hull(s, -18.4, za), on_hull(s, -18.4, zb), on_hull(s, -19.9, zb), on_hull(s, -19.9, za), C['boot'])
        for z0, z1 in BAYS:
            d.quad(on_hull(s, -8.4, z0), on_hull(s, -8.4, z1), on_hull(s, -14.2, z1), on_hull(s, -14.2, z0), C['hatch'])
            L.quad(on_hull(s, -8.8, z0 + 0.8, 0.1), on_hull(s, -8.8, z1 - 0.8, 0.1), on_hull(s, -9.5, z1 - 0.8, 0.1), on_hull(s, -9.5, z0 + 0.8, 0.1), C['lightWarm'])
            for k in range(3):
                glow(on_hull(s, -11.5, z0 + (z1 - z0) * (k + 0.5) / 3, 0.8), C['lightWarm'], 5)
            for zz in (z0 - 0.5, z1):
                d.quad(on_hull(s, -8.2, zz, 0.08), on_hull(s, -8.2, zz + 0.5, 0.08), on_hull(s, -14.4, zz + 0.5, 0.08), on_hull(s, -14.4, zz, 0.08), C['seam'])
        for za, zb, ya, yb in RUN_LIGHTS:
            L.quad(on_hull(s, ya, za, 0.1), on_hull(s, yb, zb, 0.1), on_hull(s, yb - 0.6, zb, 0.1), on_hull(s, ya - 0.6, za, 0.1), C['accentLight'])
            for k in range(5):
                glow(on_hull(s, lerp(ya, yb, k / 4) - 0.3, lerp(za, zb, k / 4), 0.6), C['accentLight'], 3.5)
        # hawse pipe and anchor on the bow flare
        cy, cz = -11.5, 104.0
        pts = [on_hull(s, cy + 1.6 * math.sin(a), cz + 1.9 * math.cos(a), 0.1) for a in [k * math.pi / 5 for k in range(10)]]
        d.poly(pts, C['black'])
        stock = [on_hull(s, cy - 1.0, cz - 0.9, 0.25), on_hull(s, cy - 1.0, cz + 0.9, 0.25), on_hull(s, cy - 3.4, cz + 0.4, 0.25), on_hull(s, cy - 3.4, cz - 0.4, 0.25)]
        d.poly(stock, C['dark'])
        # the ship's number on both bows, in the deck paint
        number(d, s, 92.0, -9.0)

    # transom: above the dock portal the full width, beside it down to the keel
    z = -100.0
    wy = lambda y: hull_width(z, y)
    b.poly([(-wy(-1.5), -1.5, z), (wy(-1.5), -1.5, z), (wy(-7), -7, z), (wy(DOCK_TOP), DOCK_TOP, z), (-wy(DOCK_TOP), DOCK_TOP, z), (-wy(-7), -7, z)], C['hullMid'])
    for s in (-1, 1):
        b.poly([(s * DOCK_X, DOCK_TOP, z), (s * wy(DOCK_TOP), DOCK_TOP, z), (s * wy(-20), -20, z), (s * wy(-26), -26, z), (s * DOCK_X, -26, z)], C['hullMid'] if s < 0 else C['hull'])
        xa, xb = sorted((s * DOCK_X, s * (DOCK_X + 3.5)))
        b.box((xa, -22, z - 1.2), (xb, DOCK_TOP + 3.5, z + 0.2), {'side': C['hullLow'], 'top': C['hullMid'], 'back': C['hullLow']})
    b.box((-DOCK_X - 3.5, DOCK_TOP, z - 1.6), (DOCK_X + 3.5, DOCK_TOP + 3.5, z + 0.2), {'side': C['hullLow'], 'top': C['hullMid'], 'back': C['hullMid']})
    d.quad((-DOCK_X, DOCK_TOP + 1.6, z - 1.65), (DOCK_X, DOCK_TOP + 1.6, z - 1.65), (DOCK_X, DOCK_TOP + 2.4, z - 1.65), (-DOCK_X, DOCK_TOP + 2.4, z - 1.65), C['accent'])
    for s in (-1, 1):
        x0, x1 = sorted((s * (DOCK_X + 4.2), s * 35))
        b.box((x0, -17.5, z - 0.5), (x1, -13, z + 0.05), {'side': C['dark'], 'back': C['dark']})
        for k in range(2):
            xa = x0 + 0.4 + k * 1.75
            L.quad((xa, -13.9, z - 0.55), (xa + 1.2, -13.9, z - 0.55), (xa + 1.2, -13.5, z - 0.55), (xa, -13.5, z - 0.55), C['lightWarm'])
        glow((s * 33, -13.7, z - 1.2), C['lightWarm'], 7)
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
    for x in range(-20, 21, 10):
        L.box((x - 1.5, DOCK_TOP - 0.15, DOCK_END - 4), (x + 1.5, DOCK_TOP - 0.05, DOCK_END - 3), C['lightWhite'])


SEG = {  # seven segments a…g as (x0, y0, x1, y1) in a 1 × 2 glyph, y up
    'a': (0, 1.82, 1, 2), 'b': (0.82, 1, 1, 2), 'c': (0.82, 0, 1, 1), 'd': (0, 0, 1, 0.18), 'e': (0, 0, 0.18, 1), 'f': (0, 1, 0.18, 2), 'g': (0, 0.91, 1, 1.09),
}
DIGITS = {0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 7: 'abc'}


def number(d: MB, s: int, z0: float, y0: float):
    """the hull number '07' on a bow, painted on the flare (glyphs 2.4 m wide, 4.8 m tall)"""
    w, h = 2.4, 2.4
    for i, n in enumerate((0, 7)):
        zc = z0 - s * (i * 3.4)       # read from bow to stern on both sides
        for seg in DIGITS[n]:
            x0, y0g, x1, y1g = SEG[seg]
            za, zb = zc + s * (x0 * w), zc + s * (x1 * w)
            ya, yb = y0 + y0g * h - 4.8, y0 + y1g * h - 4.8
            d.poly([on_hull(s, ya, za, 0.12), on_hull(s, ya, zb, 0.12), on_hull(s, yb, zb, 0.12), on_hull(s, yb, za, 0.12)], C['paint'])


# ---------------------------------------------------------------- deck
def around_hole(xa, xb, za, zb):
    """the parts of a deck rectangle outside the lift's opening"""
    hx0, hx1, hz0, hz1 = HOLE
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


def deck_plate(b: MB, xa, xb, za, zb, y, colour):
    """a rectangle of the flight deck (top or underside), its sides cut back to the planform"""
    wa, wb = deck_w(za), deck_w(zb)
    ca, cb = max(-wa, min(wa, xa)), max(-wa, min(wa, xb))
    da, db = max(-wb, min(wb, xa)), max(-wb, min(wb, xb))
    if (cb - ca) > 0.05 or (db - da) > 0.05:
        b.quad((ca, y, za), (da, y, zb), (db, y, zb), (cb, y, za), colour)


def deck(b: MB, d: MB, L: MB):
    # deck plates 10 × 10 m following the planform, alternately a shade lighter (the sea-worn plates of a flight deck),
    # open over the lift's shaft
    z = -100.0
    while z < END - 1e-6:
        za, zb = z, min(END, z + 10)
        x = -40.0
        while x < 40 - 1e-6:
            k = int((x + 40) / 10) + int((z + 100) / 10) * 3
            tone = shade('deckDunkel', 0.78 + 0.07 * ((k * 7) % 3 - 1))
            for pa, pb, qa, qb in around_hole(x, x + 10, za, zb):
                deck_plate(b, pa, pb, qa, qb, 0, tone)
                deck_plate(b, pa, pb, qa, qb, -1.5, C['deckUnder'])
            x += 10
        z += 10
    for za, zb in zip(DECK_Z, DECK_Z[1:]):
        wa, wb = deck_w(za), deck_w(zb)
        for s in (-1, 1):
            b.quad((s * wa, -1.5, za), (s * wa, 0, za), (s * wb, 0, zb), (s * wb, -1.5, zb), C['deckEdge'])
    b.quad((-DECK_W, -1.5, -100), (-DECK_W, 0, -100), (DECK_W, 0, -100), (DECK_W, -1.5, -100), C['deckEdge'])
    # flare panels under the overhang
    z = 30.0
    while z < END:
        z2 = min(END, z + 5)
        in0, in1, out0, out1 = hull_width(z, -7), hull_width(z2, -7), deck_w(z), deck_w(z2)
        if not (out0 - in0 < 0.3 and out1 - in1 < 0.3):
            for s in (-1, 1):
                q = [(s * in0, -7, z), (s * out0, -1.5, z), (s * out1, -1.5, z2), (s * in1, -7, z2)]
                b.poly(q if s > 0 else list(reversed(q)), C['hullMid'] if int(z) % 10 else C['hull'])
        z += 5

    y0, y, y2 = 0.03, 0.06, 0.09
    k1 = DECK_Z[1]
    d.quad((-30, y0, -98), (30, y0, -98), (30, y0, -54.5), (-30, y0, -54.5), C['deckDark'])
    d.quad((-4, y0, 40), (4, y0, 40), (4, y0, END - 14), (-4, y0, END - 14), C['deckDark'])
    z = -16.0
    while z < END - 16:
        if not (z + 4.5 > LIFT['z0'] - 1 and z < LIFT['z1'] + 1):
            d.quad((-0.5, y, z), (-0.5, y, z + 4.5), (0.5, y, z + 4.5), (0.5, y, z), C['paint'])
        z += 8
    for s in (-1, 1):
        d.quad((s * 7.6, y, 42), (s * 7.6, y, 112), (s * 8.4, y, 112), (s * 8.4, y, 42), C['dark'])
        for za, zb in ((-96, k1), (k1, END - 22)):
            d.quad((s * (deck_w(za) - 3.4), y, za), (s * (deck_w(zb) - 3.4), y, zb), (s * (deck_w(zb) - 2.6), y, zb), (s * (deck_w(za) - 2.6), y, za), C['yellow'])
        for za, zb in ((-99, k1), (k1, END - 10)):
            d.quad((s * (deck_w(za) - 0.8), y, za), (s * (deck_w(zb) - 0.8), y, zb), (s * (deck_w(zb) - 0.1), y, zb), (s * (deck_w(za) - 0.1), y, za), C['accent'])
        # launch arrows along the lanes, pointing forward
        for za in (58, 84):
            d.poly([(s * 6.5, y, za), (s * 9.5, y, za), (s * 8.0, y, za + 4.5)], C['paint'])
    # the catapult: raised tracks with the shuttle; the lanes numbered 1 and 2
    for sx in (-1, 1):
        b.box((sx * 3.4 - 0.4, 0, 44), (sx * 3.4 + 0.4, 0.35, END - 22), {'side': C['dark'], 'top': C['platform']})
        for z in range(50, int(END - 22), 8):
            b.box((sx * 3.4 - 0.55, 0, z), (sx * 3.4 + 0.55, 0.42, z + 0.6), C['dark'])
    b.box((-2.6, 0, 46), (2.6, 0.55, 49), {'side': C['yellow'], 'top': C['yellow']})
    deck_digit(d, 1, -12, 70, y2)
    deck_digit(d, 2, 12, 70, y2)
    # the hazard border round the lift's opening (the plate itself is a moving part: lift_parts)
    hz = lambda x0, z0, x1, z1, c: d.quad((x0, y, z0), (x0, y, z1), (x1, y, z1), (x1, y, z0), c)
    bd = LIFT_BORDER
    x, k = -LIFT['x'], 0
    while x < LIFT['x'] - 0.01:
        x1 = min(LIFT['x'], x + 1.5)
        c = C['dark'] if k % 2 else C['yellow']
        hz(x, LIFT['z0'], x1, LIFT['z0'] + bd, c)
        hz(x, LIFT['z1'] - bd, x1, LIFT['z1'], c)
        x += 1.5
        k += 1
    z, k = LIFT['z0'] + bd, 0
    while z < LIFT['z1'] - bd - 0.01:
        z1 = min(LIFT['z1'] - bd, z + 1.5)
        c = C['yellow'] if k % 2 else C['dark']
        hz(-LIFT['x'], z, -LIFT['x'] + bd, z1, c)
        hz(LIFT['x'] - bd, z, LIFT['x'], z1, c)
        z += 1.5
        k += 1
    # drone pad circle with a cross
    cz, r0, r1 = -70, 12, 13
    for i in range(20):
        a, c2 = i / 20 * 2 * math.pi, (i + 1) / 20 * 2 * math.pi
        d.quad((math.cos(a) * r0, y, cz + math.sin(a) * r0), (math.cos(a) * r1, y, cz + math.sin(a) * r1),
               (math.cos(c2) * r1, y, cz + math.sin(c2) * r1), (math.cos(c2) * r0, y, cz + math.sin(c2) * r0), C['paint'])
    d.quad((-0.6, y, cz - 7), (0.6, y, cz - 7), (0.6, y, cz + 7), (-0.6, y, cz + 7), C['paint'])
    for s in (-1, 1):
        d.quad((s * 0.6, y, cz - 0.6), (s * 7, y, cz - 0.6), (s * 7, y, cz + 0.6), (s * 0.6, y, cz + 0.6), C['paint'])
    d.poly([(-2.5, y2, cz + 9), (2.5, y2, cz + 9), (0, y2, cz + 11)], C['yellow'])

    # deck edge lights, blue approach lights at the stern, the lip light at the point
    z = -96.0
    while z <= END - 16:
        if deck_w(z) >= 4:
            for s in (-1, 1):
                x = s * (deck_w(z) - 1.4)
                L.box((x - 0.3, 0, z - 0.3), (x + 0.3, 0.35, z + 0.3), C['lightWhite'])
                glow((x, 0.45, z), C['lightWhite'], 3.5)
        z += 12
    for x in range(-24, 25, 6):
        L.box((x - 0.3, 0, -99.4), (x + 0.3, 0.35, -98.8), C['lightBlue'])
        glow((x, 0.45, -99.1), C['lightBlue'], 4)
    L.box((-0.3, 0, END - 4), (0.3, 0.35, END - 3.4), C['lightRed'])
    glow((0, 0.5, END - 3.7), C['lightRed'], 5)
    # safety rails with posts, folding nets along the forward edges
    pts = [-99, -64, -29, 6, 20, 50, 80, 110, 132]
    for s in (-1, 1):
        for za, zb in zip(pts, pts[1:]):
            b.beam((s * (deck_w(za) - 0.1), 1.1, za), (s * (deck_w(zb) - 0.1), 1.1, zb), 0.12, C['platform'])
        z = -99
        while z <= pts[-1]:
            b.beam((s * (deck_w(z) - 0.1), 0, z), (s * (deck_w(z) - 0.1), 1.1, z), 0.12, C['platform'])
            z += 7
    # close-in weapon systems on the deck corners
    for x, z in ((-35, -94), (35, -94), (-24, 62), (24, 62)):
        ciws(b, x, z)
    # whip antennas on brackets along the deck edges, leaning out
    for s in (-1, 1):
        for z in (-40, 2, 44):
            x = s * (deck_w(z) + 0.4)
            b.box((x - 0.5, -1.4, z - 0.5), (x + 0.5, 0.2, z + 0.5), C['dark'])
            b.beam((x, 0.2, z), (x + s * 2.2, 13.5, z), 0.14, C['dark'])
            L.box((x + s * 2.2 - 0.15, 13.5, z - 0.15), (x + s * 2.2 + 0.15, 13.8, z + 0.15), C['lightRed'])
            glow((x + s * 2.2, 13.7, z), C['lightRed'], 2.5)
    # camera masts (bow, stern starboard corner): housings behind the lenses
    for x, z, h, back in ((5, 124, 7.5, 1), (-37, -99, 7, -1)):
        zb = z + back * 1.1
        b.beam((x, 0, zb), (x, h - 0.2, zb), 0.3, C['dark'])
        b.box((x - 0.55, h - 0.5, zb - 0.6), (x + 0.55, h + 0.2, zb + 0.6), {'side': C['dark'], 'front': C['turret'] if back < 0 else C['dark'], 'back': C['turret'] if back > 0 else C['dark']})
    # the boom for the starboard camera, near the stern
    bx0, bx1, bz = -39.5, -62, -86
    for dy, dz in ((6.2, -0.7), (6.2, 0.7), (4.8, 0)):
        b.beam((bx0, dy - 4, bz + dz * 2), (bx1, dy, bz + dz), 0.3, C['platform'])
    for i in range(1, 6):
        t = i / 6
        xa = bx0 + (bx1 - bx0) * t
        b.beam((xa, 2.2 + 4 * t - 0.2, bz - 1.2), (xa, 2.2 + 4 * t, bz + 1.2), 0.12, C['platform'])
    b.box((bx1 - 0.9, 5.1, bz - 0.7), (bx1 + 0.5, 6.4, bz + 0.7), {'side': C['dark'], 'front': C['turret']})
    b.box((bx0 - 0.5, 0, bz - 1.5), (bx0 + 1.8, 2.4, bz + 1.5), {'side': C['platform'], 'top': C['platformTop']})
    # deck crane on the port side behind the dome, with its hook block
    b.cylinder((31, 0, -58), 1.6, 1.4, 1.4, 10, C['platform'], C['platformTop'])
    b.box((29.8, 1.4, -59.2), (32.2, 4.2, -56.8), {'side': C['accent'], 'top': C['accentDark']})
    b.box((30.3, 3.0, -59.25), (31.7, 3.9, -59.15), C['window'])
    b.beam((31, 3.8, -58), (24, 9, -66), 0.45, C['accent'])
    b.beam((31, 4.4, -58), (24.4, 9.3, -65.6), 0.12, C['dark'])
    b.beam((24, 9, -66), (24, 4, -66), 0.06, C['dark'])
    b.box((23.6, 3.4, -66.4), (24.4, 4.0, -65.6), C['yellow'])


def deck_digit(d: MB, n: int, cx: float, cz: float, y: float):
    """a painted digit on the deck, upright when seen from the bridge (as carrier.ts digit())"""
    w, h, t = 3.2, 6, 0.7
    seg = {'a': (0, h - t, w, h), 'b': (w - t, h / 2, w, h), 'c': (w - t, 0, w, h / 2), 'd': (0, 0, w, t), 'e': (0, 0, t, h / 2), 'f': (0, h / 2, t, h), 'g': (0, h / 2 - t / 2, w, h / 2 + t / 2)}
    on = {1: 'bc', 2: 'abged'}
    X = lambda gx: cx + w / 2 - gx
    Z = lambda gz: cz - h / 2 + gz
    for k in on[n]:
        x0, z0, x1, z1 = seg[k]
        d.quad((X(x0), y, Z(z0)), (X(x1), y, Z(z0)), (X(x1), y, Z(z1)), (X(x0), y, Z(z1)), C['paint'])


def ciws(b: MB, x, z):
    """a close-in weapon system: base, white radome, a six-barrel gun"""
    b.cylinder((x, 0, z), 2.4, 2.2, 1.2, 10, C['platform'], C['platformTop'])
    b.cylinder((x, 1.2, z), 1.9, 1.3, 1.6, 10, C['white'], C['white'])
    b.cone((x, 2.8, z), 1.3, 1.0, 10, C['white'])
    b.box((x - 0.5, 1.4, z + 1.2), (x + 0.5, 2.1, z + 1.8), C['dark'])
    for k in range(6):
        a = k * math.pi / 3
        dx, dy = 0.18 * math.cos(a), 0.18 * math.sin(a)
        b.beam((x + dx, 1.75 + dy, z + 1.8), (x + dx, 1.75 + dy, z + 3.6), 0.07, C['dark'])
    for s in (-1, 1):
        b.beam((x + s * 2.3, 1.2, z - 2.3), (x + s * 2.3, 1.2, z + 2.3), 0.07, C['platform'])


# ---------------------------------------------------------------- dome command, bridge, mast
DOME_T = [(0, 3.6, 17, 15.5), (3.6, 7, 14.5, 11.5), (7, 9.6, 10.5, 6.5), (9.6, 10.6, 6, 3.2)]
PH, N = math.pi / 12, 12
BRIDGE = {'x': 4.6, 'z0': -27.0, 'z1': -22.4, 'y0': 7.0, 'y1': 9.95}


def r_at(t, yy):
    return lerp(t[2], t[3], (yy - t[0]) / (t[1] - t[0]))


def dome_command(b: MB, d: MB, L: MB):
    cz = DOME_Z
    cols = [C['sup'], C['supLight'], C['sup'], C['supTop']]
    for i, (y0, y1, r0, r1) in enumerate(DOME_T):
        b.cylinder((0, y0, cz), r0, r1, y1 - y0, N, cols[i], C['supTop'], None, PH)

    def band(t, ya, yb, lit):
        for k in range(N):
            a0 = PH + k * 2 * math.pi / N
            a1 = a0 + 2 * math.pi / N
            mid = (a0 + a1) / 2
            if abs(math.sin(mid) - 1) < 0.04 and t is DOME_T[2]:
                continue                     # the forward facet is the bridge cab's
            ra, rb = r_at(t, ya) + 0.06, r_at(t, yb) + 0.06
            pa = lambda a, r, yy: (math.cos(a) * r, yy, cz + math.sin(a) * r)
            aa, ab = lerp(a0, a1, 0.12), lerp(a0, a1, 0.88)
            on = lit(mid)
            (L if on else d).quad(pa(aa, ra, ya), pa(ab, ra, ya), pa(ab, rb, yb), pa(aa, rb, yb), C['windowLit'] if on else C['window'])
            if on:
                glow(pa(mid, (ra + rb) / 2 + 0.6, (ya + yb) / 2), C['lightWarm'], 5)
            # a sun visor over each window of the bridge band
            if t is DOME_T[2]:
                rv = r_at(t, yb + 0.15) + 0.5
                b.quad(pa(aa, r_at(t, yb + 0.15), yb + 0.15), pa(ab, r_at(t, yb + 0.15), yb + 0.15), pa(ab, rv, yb + 0.05), pa(aa, rv, yb + 0.05), C['supDark'])
    band(DOME_T[0], 1.4, 2.4, lambda m: round(m * 10) % 2 == 0)
    band(DOME_T[2], 7.6, 8.8, lambda m: math.sin(m) > 0.2 or math.sin(m) < -0.6)
    # ribs over the dome (clear of the bridge ahead and the windows astern)
    for k in range(6):
        a = k * math.pi / 3
        c, sn = math.cos(a), math.sin(a)
        pts = [(17.6, 0.2), (16, 3.6), (12, 7), (7, 9.6), (3.8, 10.6)]
        for (r0, y0), (r1, y1) in zip(pts, pts[1:]):
            b.beam((c * r0, y0, cz + sn * r0), (c * r1, y1, cz + sn * r1), 0.9, C['towerDark'])
    # railings round the ledges
    for (y0, y1, r0, r1), rr in ((DOME_T[0], 15.3), (DOME_T[1], 11.3)):
        for k in range(N):
            a0 = PH + k * 2 * math.pi / N
            a1 = a0 + 2 * math.pi / N
            if abs(math.sin((a0 + a1) / 2) - 1) < 0.04 and y1 == 7:
                continue
            p0 = (math.cos(a0) * rr, y1 + 1.0, cz + math.sin(a0) * rr)
            p1 = (math.cos(a1) * rr, y1 + 1.0, cz + math.sin(a1) * rr)
            b.beam(p0, p1, 0.08, C['platform'])
            b.beam((p0[0], y1, p0[2]), p0, 0.08, C['platform'])
    # small domes on the first ledge, antennas on the third step, the sensor ring and the mast camera on top
    for a in (math.pi / 4, 3 * math.pi / 4, -math.pi / 4, -3 * math.pi / 4):
        radome(b, math.cos(a) * 15, 3.6, cz + math.sin(a) * 15, 0.9)
    for a, h in ((0.4, 5), (2.7, 6), (-1.2, 4)):
        x, z = math.cos(a) * 8, cz + math.sin(a) * 8
        b.beam((x, 9.6, z), (x, 9.6 + h, z), 0.12, C['dark'])
        for f in (0.45, 0.75):
            b.beam((x - 0.6, 9.6 + h * f, z), (x + 0.6, 9.6 + h * f, z), 0.06, C['dark'])
        L.box((x - 0.2, 9.6 + h, z - 0.2), (x + 0.2, 10 + h, z + 0.2), C['lightRed'])
        glow((x, 9.8 + h, z), C['lightRed'], 2.5)
    b.cylinder((0, 10.6, cz), 3.2, 2.6, 0.8, 10, C['platform'], C['platformTop'])
    b.beam((1.8, 10.6, cz + 1), (1.8, 13, cz + 1), 0.2, C['dark'])
    b.box((1.3, 13, cz + 0.4), (2.3, 13.8, cz + 1.6), {'side': C['dark'], 'front': C['turret']})
    # side blocks: angular prisms with vents; the starboard one carries the turret's barbette
    for s in (-1, 1):
        prof = [(25, 0), (33, 0), (33, 2.2), (31.5, 3.5), (25.8, 3.5), (25, 2.8)]
        p = prof if s > 0 else [(-x, y) for x, y in reversed(prof)]
        b.zprism(p, -44, -24, C['sup'], C['supTop'])
        if s < 0:
            for i in range(3):
                b.box((s * 30.8 - 0.4, 3.5, -42 + i * 2.2), (s * 30.8 + 0.4, 3.9, -40.8 + i * 2.2), C['dark'])
        d.quad((s * 25.03, 2.2, -43), (s * 25.03, 2.2, -25), (s * 25.03, 2.6, -25), (s * 25.03, 2.6, -43), C['accent'])
        ciws_small(b, s * 30.2, 3.5, -25.6)
    b.cylinder((-29, 3.5, -34), 3.2, 3.0, 0.5, 8, C['platform'], C['platformTop'], None, math.pi / 8)
    # port block: the flight control cab looking over the deck, two radomes, a mast
    flight_control(b, d, L)
    radome(b, 30.6, 3.5, -41.5, 1.1)
    b.beam((30.8, 3.5, -40.0), (30.8, 11, -40.0), 0.18, C['dark'])
    b.beam((30.0, 9.8, -40.0), (31.6, 9.8, -40.0), 0.08, C['dark'])
    # starboard block: a searchlight and the ammunition hatch behind the turret
    b.cylinder((-31.2, 3.5, -27.5), 0.4, 0.4, 0.9, 6, C['dark'], C['dark'])
    b.push((-31.2, 4.6, -27.5), rx=-math.pi / 2)
    b.cylinder((0, -0.4, 0), 0.6, 0.65, 0.8, 10, C['dark'], None, C['dark'])
    b.pop()
    L.push((-31.2, 4.6, -27.08), rx=-math.pi / 2)
    L.cylinder((0, 0, 0), 0.55, 0.55, 0.02, 10, C['lightWhite'], C['lightWhite'])
    L.pop()
    b.box((-28.0, 3.5, -40.5), (-26.0, 3.7, -38.5), C['hatch'])


def ciws_small(b: MB, x, y, z):
    b.cylinder((x, y, z), 1.1, 1.0, 0.6, 8, C['platform'], C['platformTop'])
    b.cylinder((x, y + 0.6, z), 0.9, 0.6, 0.9, 8, C['white'], C['white'])
    b.cone((x, y + 1.5, z), 0.6, 0.5, 8, C['white'])
    b.beam((x, y + 1.0, z + 0.7), (x, y + 1.0, z + 2.0), 0.12, C['dark'])


def flight_control(b: MB, d: MB, L: MB):
    """a small glazed cab on the port block, its slanted windows looking inboard over the deck"""
    x0, x1, z0, z1, y0, y1 = 25.6, 29.4, -38.5, -30.0, 3.5, 6.6
    b.box((x0 + 0.4, y0, z0), (x1, y0 + 1.4, z1), {'side': C['sup'], 'top': C['supTop']})
    # the glass room: inboard and forward faces slanted out
    lo = [(x0 + 0.4, z0), (x1, z0), (x1, z1), (x0 + 0.4, z1)]
    hi = [(x0 - 0.3, z0 - 0.2), (x1, z0 - 0.2), (x1, z1 + 0.5), (x0 - 0.3, z1 + 0.5)]
    ya, yb = y0 + 1.4, y1
    rl = [(x, ya, z) for x, z in lo]
    rh = [(x, yb, z) for x, z in hi]
    b.loft([rl, rh], [C['window'], C['supDark'], C['window'], C['window']], cap1=C['supTop'])
    for (x, z) in ((x0 - 0.3, z0 - 0.2), (x0 - 0.3, z1 + 0.5), (x0 - 0.3, (z0 + z1) / 2)):
        b.beam((x + 0.7, ya, z), (x, yb, z), 0.12, C['supDark'])
    b.box((x0 - 0.6, yb, z0 - 0.5), (x1 + 0.2, yb + 0.25, z1 + 0.8), C['supTop'])
    for k in range(4):
        z = lerp(z0 + 0.6, z1 - 0.2, k / 3)
        L.quad((x0 + 0.05, ya + 0.3, z - 0.5), (x0 + 0.05, ya + 0.3, z + 0.5), (x0 - 0.2, yb - 0.4, z + 0.5), (x0 - 0.2, yb - 0.4, z - 0.5), C['windowLit'])
    glow((x0 - 0.8, (ya + yb) / 2, (z0 + z1) / 2), C['lightWarm'], 4)
    b.beam((x1 - 0.8, yb + 0.25, z0 + 1.2), (x1 - 0.8, yb + 3.5, z0 + 1.2), 0.1, C['dark'])


def radome(b: MB, x, y, z, r):
    b.cylinder((x, y, z), r * 0.8, r * 0.8, 0.8, 10, C['platform'], C['platformTop'])
    b.cylinder((x, y + 0.8, z), r, r * 0.75, r * 0.7, 10, C['white'], C['white'])
    b.cone((x, y + 0.8 + r * 0.7, z), r * 0.75, r * 0.6, 10, C['white'])


def bridge(b: MB, d: MB, L: MB):
    """
    The bridge: a glazed cab on the front of the dome's third step, floor on the second step's roof.
    Its front window is open (frames only), so the bridge camera inside looks out over the deck past
    a low console; the sides are glazed; a visor shades the front.
    """
    x, z0, z1, y0, y1 = BRIDGE['x'], BRIDGE['z0'], BRIDGE['z1'], BRIDGE['y0'], BRIDGE['y1']
    sill, top = 7.75, 9.45
    # floor, roof with a visor reaching forward, the back wall against the dome
    b.box((-x, y0 - 0.2, z0), (x, y0, z1), C['supDark'])
    b.box((-x - 0.3, y1, z0), (x + 0.3, y1 + 0.35, z1 + 1.1), {'side': C['sup'], 'top': C['supTop']})
    b.quad((-x, y0, z0), (x, y0, z0), (x, y1, z0), (-x, y1, z0), C['supDark'])
    # front: the wall under the sill, the band over the window, corner posts and two mullions
    b.box((-x, y0, z1 - 0.3), (x, sill, z1), {'side': C['sup'], 'top': C['supTop'], 'front': C['sup']})
    b.box((-x, top, z1 - 0.3), (x, y1, z1), {'side': C['sup'], 'front': C['sup']})
    for xx in (-x, x):
        b.box((xx - 0.25, sill, z1 - 0.3), (xx + 0.25, top, z1), C['supDark'])
    # (the mullions sit close to the middle: in the game the side columns cover the edges of the view)
    for xx in (-1.0, 1.0):
        d.box((xx - 0.025, sill, z1 - 0.12), (xx + 0.025, top, z1 - 0.06), C['sup'])
    # wipers parked along the sill, clear of the helmsman's view
    for xx in (-2.9, 2.9):
        b.beam((xx - 0.6, sill + 0.04, z1 - 0.1), (xx + 0.6, sill + 0.04, z1 - 0.1), 0.035, C['black'])
    # sides: glazed above a wall, framed
    for s in (-1, 1):
        xs = s * x
        b.quad((xs, y0, z0), (xs, y0, z1), (xs, sill, z1), (xs, sill, z0), C['sup'])
        b.quad((xs, top, z0), (xs, top, z1), (xs, y1, z1), (xs, y1, z0), C['sup'])
        d.quad((xs + s * 0.02, sill, z0 + 0.3), (xs + s * 0.02, sill, z1 - 0.3), (xs + s * 0.02, top, z1 - 0.3), (xs + s * 0.02, top, z0 + 0.3), C['window'])
        b.beam((xs + s * 0.04, sill, (z0 + z1) / 2), (xs + s * 0.04, top, (z0 + z1) / 2), 0.12, C['supDark'])
    # the console inside along the window: a sloping desk, two chairs behind
    cz0, cz1 = z1 - 1.25, z1 - 0.32
    b.zprism([(-3.6, y0), (3.6, y0), (3.6, 7.42), (-3.6, 7.42)], cz0, cz1, C['dark'], C['dark'])
    desk = [(-3.6, 7.42, cz0), (3.6, 7.42, cz0), (3.6, 7.62, cz1), (-3.6, 7.62, cz1)]
    b.poly(desk, C['black'])
    for xx in (-1.6, 1.6):
        b.box((xx - 0.35, y0, z0 + 0.9), (xx + 0.35, y0 + 1.1, z0 + 1.6), C['dark'])
        b.box((xx - 0.35, y0 + 1.1, z0 + 0.8), (xx + 0.35, y0 + 1.9, z0 + 0.95), C['dark'])
    # lit ceiling lamps (seen from outside at night); warm glows at the window corners, outside the helmsman's view
    L.box((-2.0, y1 - 0.08, z0 + 1.6), (2.0, y1 - 0.02, z0 + 2.0), C['lightWarm'])
    for s in (-1, 1):
        glow((s * (x - 0.4), 8.9, z1 + 0.5), C['lightWarm'], 3)
    # the window band of the dome continues as dark glass beside the cab
    d.quad((-x - 0.3, sill, z0 - 0.01), (x + 0.3, sill, z0 - 0.01), (x + 0.3, top, z0 - 0.01), (-x - 0.3, top, z0 - 0.01), C['black'])


def lattice_mast(b: MB, L: MB):
    """a tall lattice mast on the port deck behind the dome: platforms, a yardarm with radomes, a lamp on top"""
    x0, z0 = 22.0, -51.5
    legs = [(-1.4, -1.4), (1.4, -1.4), (1.4, 1.4), (-1.4, 1.4)]
    top = 24.0
    taper = lambda y: 1 - 0.55 * y / top
    for lx, lz in legs:
        b.beam((x0 + lx, 0, z0 + lz), (x0 + lx * taper(top), top, z0 + lz * taper(top)), 0.18, C['tower'])
    y = 0.0
    while y < top - 1:
        y1 = y + 3.0
        for i in range(4):
            ax, az = legs[i]
            bx, bz = legs[(i + 1) % 4]
            b.beam((x0 + ax * taper(y), y, z0 + az * taper(y)), (x0 + bx * taper(y1), y1, z0 + bz * taper(y1)), 0.08, C['towerDark'])
            b.beam((x0 + ax * taper(y1), y1, z0 + az * taper(y1)), (x0 + bx * taper(y1), y1, z0 + bz * taper(y1)), 0.08, C['towerDark'])
        y = y1
    for yy in (10.0, 18.0):
        r = 2.4 * taper(yy)
        b.box((x0 - r, yy, z0 - r), (x0 + r, yy + 0.2, z0 + r), C['platform'])
    b.beam((x0 - 5, 18.6, z0), (x0 + 5, 18.6, z0), 0.16, C['tower'])
    for s in (-1, 1):
        radome(b, x0 + s * 4.6, 18.6, z0, 0.55)
    b.cylinder((x0, top, z0), 0.6, 0.5, 0.5, 8, C['platform'], C['platformTop'])
    b.beam((x0, top + 0.5, z0), (x0, top + 4.5, z0), 0.1, C['dark'])
    L.box((x0 - 0.2, top + 4.5, z0 - 0.2), (x0 + 0.2, top + 4.9, z0 + 0.2), C['lightRed'])
    glow((x0, top + 4.7, z0), C['lightRed'], 3)
    L.box((x0 - 0.25, 10.25, z0 + 1.2), (x0 + 0.25, 10.5, z0 + 1.4), C['lightWhite'])
    glow((x0, 10.4, z0 + 1.6), C['lightWhite'], 3)


# ---------------------------------------------------------------- deck life
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


def deck_life(b: MB):
    # the ship runs itself and keeps its Skuas in the hangar: on deck stand only ACCBs waiting to be loaded
    for x, z in ((31.5, -12), (31.5, -6.5), (27.5, -9.3)):
        deck_accb(b, x, z)


def lifeboats(b: MB):
    """orange lifeboats in davits under the deck edge, two a side"""
    for s in (-1, 1):
        for z in (-30.0, -8.0):
            xb = s * 43.2
            b.push((xb, -4.6, z))
            b.zprism([(-1.3, 0.0), (1.3, 0.0), (1.6, 1.0), (1.2, 1.8), (-1.2, 1.8), (-1.6, 1.0)], -4.0, 4.0, C['boat'], C['boatTop'])
            b.zprism([(-1.1, 1.8), (1.1, 1.8), (0.8, 2.5), (-0.8, 2.5)], -3.0, 2.8, C['boatTop'], C['boatTop'])
            b.pop()
            for dz in (-3.0, 3.0):
                b.beam((s * 39.5, 0, z + dz), (s * 43.2, 0.6, z + dz), 0.22, C['platform'])
                b.beam((s * 43.2, 0.6, z + dz), (s * 43.2, -2.0, z + dz), 0.05, C['dark'])


# ---------------------------------------------------------------- moving parts
def radar_part() -> MB:
    b = MB()
    b.cylinder((0, 0, 0), 0.6, 0.6, 3, 8, C['dark'], C['dark'])
    b.cylinder((0, 2.8, 0), 1.2, 1.0, 0.6, 8, C['platform'], C['platformTop'])
    y = 3.6
    pts = [(8.5, y, 0), (4.2, y + 1.6, -0.35), (0, y + 2.2, -0.6), (-4.2, y + 1.6, -0.35), (-8.5, y, 0), (-4.2, y - 1.6, -0.35), (0, y - 2.2, -0.6), (4.2, y - 1.6, -0.35)]
    back, front = (0, y, -4.2), (0, y, 0.8)
    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        b.poly([pts[i], pts[j], back], C['radar'] if i % 2 else C['radarLight'])
        b.poly([pts[j], pts[i], front], C['radarDark'] if i % 2 else C['radar'])
    for s in (-1, 1):
        b.beam((0, y, -1.5), (s * 6, y, -0.4), 0.12, C['dark'])
        b.beam((0, y - 1.0, -1.2), (s * 5, y - 0.6, -0.5), 0.08, C['dark'])
    b.beam((0, y - 0.3, 0.8), (0, y - 0.3, 3.0), 0.14, C['dark'])
    b.box((-0.5, y - 0.4, 2.8), (0.5, y + 0.4, 3.6), 'weiss')
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
CAMERAS = {
    # the new bridge camera inside the cab (the old one stood just outside the dome at (0, 8.4, -25))
    'bridge': {'eye': (0.0, 8.6, -24.8), 'look': (0.0, 1.0, 300.0)},
}


def build():
    GLOWS.clear()
    coll = reset()
    body, decals, lights = MB(), MB(), MB()
    hull(body, decals, lights)
    deck(body, decals, lights)
    lift_shaft(body, lights)
    deck_life(body)
    dome_command(body, decals, lights)
    bridge(body, decals, lights)
    lattice_mast(body, lights)
    lifeboats(body)
    o_body = body.build('body', coll, bevel=0.12, smooth_limit=28)
    o_decals = decals.build('decals', coll, jitter=0.0)
    o_lights = lights.build('lights', coll, jitter=0)
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
    p_radar = pivot('radar', (0, 11.2, DOME_Z))
    m = radar_part().build('radar.mesh', coll, bevel=0.05)
    m.parent = p_radar
    parts.append(m)
    p_turret = pivot('turret', (-29, 4, DOME_Z))
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
        bake_ambient_occlusion(parts, strength=0.55, distance=4.0, samples=64)
    return coll


def export():
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'stoorworm_kuppel.blend'))
    safe_names()
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(HERE, 'stoorworm_kuppel.glb'), export_format='GLB', export_yup=True, export_apply=True,
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
    for name, (eye, look, lens) in {'front': ((220, 120, 330), (0, 0, 10), 50), 'bridge': (CAMERAS['bridge']['eye'], CAMERAS['bridge']['look'], 24)}.items():
        cam.location = to_blender(eye)
        cam.rotation_euler = (to_blender(look) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        cam.data.lens = lens
        scene.render.filepath = os.path.join(out, f'stoorworm-{name}.png')
        bpy.ops.render.render(write_still=True)


build()
export()
if '--render' in ARGS:
    render()
print('STOORWORM DONE')
