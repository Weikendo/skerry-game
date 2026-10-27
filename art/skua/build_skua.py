"""
The Skua (Skerry's multi-role fighter) built in Blender, after the Otter pilot.

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python art/skua/build_skua.py -- [--render] [--no-bake]

Writes art/skua/skua.blend and art/skua/skua.glb (with --render also art/skua/renders/). The frame
matches src/models/manta.ts in its own units, before the game scales the model by 0.75 and lifts it by
2.4 (the wheels touch y = -2.4): +z forward, span about 24, length about 21. The parts the game moves:
  elevon_L | elevon_R   pivot on the hinge line (z = -6.6), rotation x lifts the trailing edge
  rudder                pivot at z = -7.25, rotation y swings it
  gear_0 (nose), gear_1 (+x), gear_2 (-x)   pivots at the top of the legs, rotation x folds them back
  missile_0 … missile_5 the Assassins in firing order (outer pairs first, +x before -x)
  lights, glow_* (navigation lights), exhaust_* (engine glow: custom property exhaust)
L = +x (port, as in the game).
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
from lowpoly import (ENEMY, MB, PAL, apply_modifiers, bake_ambient_occlusion, glow_point, safe_names, shade,  # noqa: E402
                     stripes, to_blender, vertex_colour_material)

HERE = os.path.dirname(__file__)
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
# the enemy's version (--feind) goes to skua_feind.glb
OUT = 'skua_feind' if ENEMY else 'skua'

COL = {
    'top': 'metallHell', 'topLight': 'stahlHell', 'flank': 'signalOrange', 'flankDark': 'signalOrangeDunkel',
    'belly': 'stahl', 'wing': 'stahlHell', 'wingDark': 'stahl', 'wingUnder': 'metallHell',
    'red': 'signalRot', 'glass': 'glasBlau', 'frame': 'anthrazit', 'engine': 'anthrazit', 'metal': 'metall',
}
C = lambda k: COL[k]

# the game's measures (src/models/manta.ts)
ROOT_LE, CRANK, TIP_LE = (1.7, 5.4), (4.6, -1.0), (12.0, -6.0)
TIP_TE, ROOT_TE = (12.0, -7.3), (1.8, -7.8)
HINGE0, HINGE1, HINGE_Z = 3.5, 10.3, -6.6


def wing_top(x):
    return 0.18 - 0.16 * (abs(x) - 1.7) / 10.3


def wing_bot(x):
    return -0.32 + 0.16 * (abs(x) - 1.7) / 10.3


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene.collection


# ---------------------------------------------------------------- fuselage
SECTIONS = [  # z, half width, top, bottom (the game's, with sections in between for a rounder body)
    (11.6, 0.05, 0.2, -0.1), (10.6, 0.3, 0.38, -0.27), (9.6, 0.5, 0.5, -0.4), (8.4, 0.74, 0.74, -0.57), (7.2, 0.95, 0.95, -0.72),
    (5.9, 1.17, 1.15, -0.85), (4.6, 1.35, 1.3, -0.95), (3.3, 1.5, 1.3, -1.0), (2.0, 1.6, 1.25, -1.05), (0.5, 1.68, 1.18, -1.08),
    (-1.0, 1.75, 1.12, -1.1), (-2.5, 1.78, 1.07, -1.08), (-4.0, 1.8, 1.02, -1.05), (-5.3, 1.77, 0.98, -1.0), (-6.6, 1.72, 0.95, -0.95),
    (-7.6, 1.64, 0.9, -0.9), (-8.6, 1.55, 0.85, -0.85),
]
RING_N = 16


def ring(w, t, bo, z):
    """a rounded-box cross-section (superellipse), widest a little above the middle; points clockwise from the top"""
    pts = []
    for k in range(RING_N):
        a = 2 * math.pi * k / RING_N
        s, c = math.sin(a), math.cos(a)
        x = w * math.copysign(abs(s) ** (2 / 2.8), s)
        y = (t if c >= 0 else -bo) * math.copysign(abs(c) ** (2 / 2.8), c) + 0.1 * t * (1 - abs(c))
        pts.append((x, y, z))
    return pts


def ring_colour(k):
    a = abs(((k / RING_N) * 360 + 180) % 360 - 180)   # 0 at the top, 180 at the belly
    return C('top') if a < 30 else C('topLight') if a < 62 else C('flank') if a < 110 else C('flankDark') if a < 148 else C('belly')


def top_at(z):
    """the fuselage's top line at z (for the canopy, the spine and the fin)"""
    for (za, _, ta, _), (zb, _, tb, _) in zip(SECTIONS, SECTIONS[1:]):
        if zb <= z <= za:
            f = (za - z) / (za - zb)
            return ta + (tb - ta) * f      # the superellipse's top equals t on the centre line
    return SECTIONS[-1][2]


def fuselage(b: MB, lights: MB):
    rings = [ring(w, t, bo, z) for z, w, t, bo in SECTIONS]
    b.loft(rings, lambda i, k: C('red') if i < 2 else ring_colour(k), cap0=C('red'), cap1=C('engine'))
    # red spine stripe from behind the canopy to the fin, a dorsal intake, panel lines on the flanks
    for (za, _, ta, _), (zb, _, tb, _) in zip(SECTIONS, SECTIONS[1:]):
        if zb >= 1.6 or za <= -6.2:
            continue
        z0, z1 = min(za, 1.6), max(zb, -6.2)
        y0, y1 = top_at(z0) + 0.012, top_at(z1) + 0.012
        b.quad((-0.17, y0, z0), (0.17, y0, z0), (0.17, y1, z1), (-0.17, y1, z1), C('red'))
    b.box((-0.45, 1.05, -1.6), (0.45, 1.42, 0.4), {'side': C('topLight'), 'top': C('top'), 'front': 'schwarz'})
    b.box((-0.36, 1.08, 0.4), (0.36, 1.36, 0.46), C('frame'))
    for s in (-1, 1):
        for z in (-0.4, -3.3, -6.0):
            b.beam((s * 1.79, -0.55, z), (s * 1.79, 0.6, z), 0.04, C('flankDark'))
        # ventral fins under the tail, canted out
        b.push((s * 0.9, -0.92, -6.2), rz=-s * 0.5)
        b.xslab([(0.6, 0.0), (-1.6, 0.0), (-2.0, -0.75), (-1.0, -0.75)], 0.05, C('belly'), C('wingDark'))
        b.pop()
    # dark anti-glare panel on the nose, in front of the windscreen
    zs = [9.4, 8.4, 7.6, 6.85]
    for za, zb in zip(zs, zs[1:]):
        wa, wb = 0.12 + (9.4 - za) * 0.09, 0.12 + (9.4 - zb) * 0.09
        b.quad((-wa, top_at(za) + 0.012, za), (wa, top_at(za) + 0.012, za), (wb, top_at(zb) + 0.012, zb), (-wb, top_at(zb) + 0.012, zb), C('frame'))
    # pitot tube
    b.beam((0, 0.05, 11.5), (0, 0.05, 13.0), 0.06, C('metal'))
    # anti-collision beacon on the spine
    b.box((-0.16, top_at(1.0), 0.75), (0.16, top_at(1.0) + 0.12, 1.15), C('frame'))
    lights.box((-0.12, top_at(1.0) + 0.12, 0.8), (0.12, top_at(1.0) + 0.3, 1.1), 'lichtRot')


def canopy(b: MB):
    """a bubble canopy over the cockpit: rings across it from the windscreen to the back, glass with a frame"""
    stations = [(6.8, 0.15, 0.02), (5.9, 0.62, 0.42), (4.9, 0.8, 0.78), (3.9, 0.84, 0.86), (2.9, 0.82, 0.76), (2.0, 0.72, 0.55), (1.4, 0.5, 0.25)]
    arcs = []
    for z, hw, h in stations:
        base = top_at(z) - 0.05
        arc = []
        for k in range(9):
            a = math.pi * k / 8                       # from the right sill over the top to the left sill
            arc.append((-hw * math.cos(a), base + h * math.sin(a), z))
        arcs.append(arc)
    b.loft(arcs, [C('glass')] * 9)
    # the closing faces front and back, and the frame: windscreen arch, a bow over the middle, the sills
    b.poly(arcs[0], C('glass'))
    b.poly(list(reversed(arcs[-1])), C('frame'))
    for i in (1, 4):
        for k in range(8):
            b.beam(arcs[i][k], arcs[i][k + 1], 0.07, C('frame'))
    for side in (0, 8):
        for i in range(len(arcs) - 1):
            b.beam(arcs[i][side], arcs[i + 1][side], 0.08, C('frame'))
    # the centre line of the windscreen
    b.beam(arcs[0][4], arcs[1][4], 0.05, C('frame'))


def intakes(b: MB):
    for s in (-1, 1):
        x0, x1 = sorted((s * 1.45, s * 2.4))
        # raked intake box: its mouth slopes back towards the bottom, a dark duct inside, a splitter plate inboard
        outline = [(-0.95, 3.4), (0.1, 3.85), (0.1, 0.6), (-0.95, 0.6)]
        L = [(x0, y, z) for y, z in outline]
        R = [(x1, y, z) for y, z in outline]
        b.loft([L, R], [C('frame'), C('topLight'), C('flankDark'), C('belly')], cap0=C('flankDark'), cap1=C('flankDark'))
        b.quad((x0 + 0.08, -0.85, 3.43), (x1 - 0.08, -0.85, 3.43), (x1 - 0.08, 0.02, 3.8), (x0 + 0.08, 0.02, 3.8), 'schwarz')
        sx = s * 1.4
        b.box((min(sx, sx - s * 0.05), -0.9, 2.0), (max(sx, sx - s * 0.05), 0.08, 4.0), C('metal'))
        # warning chevrons by the lip
        xo = s * 2.405
        stripes(b, (xo, -0.7, 2.6), (0, 0, 1), (0, 1, 0), 0.9, 0.18, 4, colours=(C('red'), 'weiss'))


# ---------------------------------------------------------------- wings, fin
def wing(b: MB, s: int):
    sx = lambda pts: [(s * x, z) for x, z in pts]
    h0, h1 = (HINGE0, HINGE_Z), (HINGE1, HINGE_Z)
    te0, te1 = (HINGE0, -7.7), (HINGE1, -7.35)
    top = lambda x, z: wing_top(x)
    bot = lambda x, z: wing_bot(x)
    # the fixed wing around the elevon notch, and the red tip
    main = [ROOT_LE, CRANK, (11.0, -5.33), h1, h0, te0, ROOT_TE]
    tip = [(11.0, -5.33), TIP_LE, TIP_TE, te1, h1]
    for outline, ct, cb in ((main, C('wing'), C('wingUnder')), (tip, C('red'), C('red'))):
        pts = sx(outline) if s > 0 else list(reversed(sx(outline)))
        b.slab(pts, top, bot, ct, cb, C('wingDark') if ct != C('red') else C('red'))
    # leading-edge slat line and a wing fence
    a, c = CRANK, (11.0, -5.33)
    ya, yc = wing_top(a[0]) + 0.012, wing_top(c[0]) + 0.012
    pa, pc = (s * a[0], ya, a[1] - 0.4), (s * c[0], yc, c[1] - 0.32)
    b.poly([pa, pc, (pc[0], yc, pc[2] - 0.08), (pa[0], ya, pa[2] - 0.08)], C('wingDark'))
    # the hinge gap in front of the elevon
    h0y, h1y = wing_top(HINGE0) + 0.012, wing_top(HINGE1) + 0.012
    b.poly([(s * HINGE0, h0y, HINGE_Z + 0.08), (s * HINGE1, h1y, HINGE_Z + 0.08), (s * HINGE1, h1y, HINGE_Z + 0.02), (s * HINGE0, h0y, HINGE_Z + 0.02)], C('frame'))
    xf = 7.0
    zle = CRANK[1] + (xf - CRANK[0]) / (TIP_LE[0] - CRANK[0]) * (TIP_LE[1] - CRANK[1])
    # a low fence over the front half of the chord
    yf = wing_top(xf)
    b.xslab([(zle + 0.15, yf), (zle - 2.2, yf), (zle - 2.2, yf + 0.08), (zle - 0.6, yf + 0.18)], 0.03, C('wingDark'), C('wingDark'), x=s * xf)
    # walkway lines on the wing root and the roundel on the outer panel
    for zz in (0.6, -4.4):
        b.quad((s * 2.0, wing_top(2.0) + 0.012, zz), (s * 3.4, wing_top(3.4) + 0.012, zz), (s * 3.4, wing_top(3.4) + 0.012, zz - 0.08), (s * 2.0, wing_top(2.0) + 0.012, zz - 0.08), C('frame'))
    xr, zr = 9.0, -5.35
    y = wing_top(xr) + 0.014
    b.disc((s * xr, y, zr), '+y', 0.85, 14, 'wasserMittel')
    b.disc((s * xr, y + 0.004, zr), '+y', 0.7, 14, 'weiss')
    b.poly([(s * (xr - 0.48), y + 0.008, zr - 0.26), (s * (xr + 0.48), y + 0.008, zr - 0.26), (s * xr, y + 0.008, zr + 0.48)], 'ocker')
    # wingtip light housing
    b.box((s * 12.0 - 0.12, -0.2, -7.0), (s * 12.0 + 0.12, 0.12, -6.3), C('red'))
    # leading-edge root extension (strake) along the forward fuselage
    strake = [(0.95, 8.8), (1.75, 5.6), (1.7, 5.0), (1.0, 5.0)]
    pts = sx(strake) if s > 0 else list(reversed(sx(strake)))
    b.slab(pts, lambda x, z: 0.2, lambda x, z: 0.02, C('topLight'), C('belly'), C('wingDark'))


def fin(b: MB):
    prof = [(-1.8, 1.0), (-6.3, 4.7), (-7.25, 4.7), (-7.25, 1.0)]
    b.xslab(prof, 0.15, C('top'), C('topLight'))
    b.box((-0.19, 4.42, -7.32), (0.19, 4.78, -6.15), C('red'))
    # the tail camera in a pod on top, looking forward over the Skua (the game looks out of it: 'manta-leitwerk')
    b.box((-0.15, 4.78, -6.95), (0.15, 5.02, -6.05), {'side': C('frame'), 'front': C('glass'), 'top': C('frame')})
    # emblem on both sides (white peak, ochre hill, a band of sea), an antenna on the leading edge
    for s in (-1, 1):
        x = s * 0.155
        b.poly([(x, 2.55, -5.9), (x, 2.55, -4.7), (x, 3.45, -5.3)], 'weiss')
        b.poly([(x + s * 0.004, 2.55, -6.05), (x + s * 0.004, 2.55, -5.25), (x + s * 0.004, 3.05, -5.65)], 'ocker')
        b.poly([(x + s * 0.008, 2.42, -6.15), (x + s * 0.008, 2.42, -4.6), (x + s * 0.008, 2.55, -4.6), (x + s * 0.008, 2.55, -6.15)], 'wasserMittel')
    b.beam((0, 3.6, -4.95), (0, 4.0, -4.55), 0.05, C('frame'))


def rudder() -> MB:
    b = MB()
    b.xslab([(0.0, 1.05), (0.0, 4.4), (-1.15, 4.4), (-1.55, 1.0)], 0.12, C('top'), C('topLight'))
    return b


def elevon(s: int) -> MB:
    """origin on the hinge line, trailing edge at -z"""
    b = MB()
    xs, lens = (HINGE0, HINGE1), (7.7 + HINGE_Z, 7.35 + HINGE_Z)
    outline = [(xs[0], 0.0), (xs[1], 0.0), (xs[1], -lens[1]), (xs[0], -lens[0])]
    pts = [(s * x, z) for x, z in outline]
    if s < 0:
        pts.reverse()
    top = lambda x, z: wing_top(x) * (1 - 0.7 * (-z) / max(lens))
    bot = lambda x, z: wing_bot(x) * (1 - 0.7 * (-z) / max(lens))
    b.slab(pts, top, bot, C('wingDark'), C('wingUnder'), C('wingDark'))
    return b


def nozzles(b: MB, lights: MB):
    for x in (-0.75, 0.75):
        b.push((x, -0.05, -8.5), rx=-math.pi / 2)        # cylinder axis along -z
        b.cylinder((0, 0, 0), 0.66, 0.66, 0.25, 16, C('metal'), None, C('engine'))
        # petals: a ring of alternating radii, narrowing to the exit
        n = 16
        for k in range(n):
            a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
            r0, r1 = 0.64, 0.5
            col = C('metal') if k % 2 else 'metallHell'
            b.quad((r0 * math.cos(a0), 0.25, r0 * math.sin(a0)), (r0 * math.cos(a1), 0.25, r0 * math.sin(a1)),
                   (r1 * math.cos(a1), 1.15, r1 * math.sin(a1)), (r1 * math.cos(a0), 1.15, r1 * math.sin(a0)), col)
        b.cylinder((0, 1.15, 0), 0.5, 0.42, 0.06, 16, 'schwarz', 'schwarz')
        b.pop()
        lights.push((x, -0.05, -9.62), rx=-math.pi / 2)
        lights.cylinder((0, 0, 0), 0.3, 0.3, 0.02, 12, 'lava', 'lava')
        lights.pop()


def pylons(b: MB):
    for s in (-1, 1):
        for x in (4.2, 6.2, 8.2):
            y = wing_bot(x)
            b.xslab([(-0.75, y + 0.02), (-2.5, y + 0.02), (-2.3, y - 0.14), (-0.95, y - 0.14)], 0.07, C('metal'), C('metal'), x=s * x)


def gear_leg(top: float, wheels: int) -> MB:
    """a leg pivoting at its top (origin), folding back into the belly"""
    b = MB()
    ln = top + 2.4
    foot = -ln + 0.45
    b.cylinder((0, -0.5, 0), 0.14, 0.14, 0.5, 8, C('metal'), C('metal'), C('metal'))
    b.cylinder((0, foot + 0.15, 0), 0.1, 0.1, -foot - 0.55, 8, 'metallHell', None, None)
    b.beam((0, -0.35, 0.12), (0, foot + 0.55, 0.32), 0.06, C('metal'))
    b.beam((0, foot + 0.55, 0.32), (0, foot + 0.25, 0.12), 0.06, C('metal'))
    b.box((-0.22, -0.5, -0.12), (0.22, 0, 0.12), C('metal'))
    b.beam((-0.4, foot, 0), (0.4, foot, 0), 0.08, C('metal'))
    for i in range(wheels):
        wx = (0.28 if i else -0.28) if wheels > 1 else 0.0
        b.push((wx, foot, 0), rz=math.pi / 2)            # wheel axis along x
        b.cylinder((0, -0.12, 0), 0.45, 0.45, 0.24, 12, 'schwarz', 'anthrazit', 'anthrazit')
        b.cylinder((0, 0.12, 0), 0.22, 0.2, 0.05, 8, 'metallHell', 'metallHell')
        b.cylinder((0, -0.17, 0), 0.2, 0.22, 0.05, 8, 'metallHell', None, 'metallHell')
        b.pop()
    # gear door on the leg
    b.quad((0.35, -0.2, 0.6), (0.35, -0.2, -0.6), (0.35, -ln * 0.6, -0.6), (0.35, -ln * 0.6, 0.6), C('belly'))
    b.quad((0.37, -0.2, 0.6), (0.37, -ln * 0.6, 0.6), (0.37, -ln * 0.6, -0.6), (0.37, -0.2, -0.6), C('belly'))
    return b


def missile() -> MB:
    """the Assassin on its launch rail; origin on the pylon, body hanging below, nose at +z"""
    b = MB()
    b.box((-0.05, -0.12, -0.9), (0.05, 0.0, 0.7), C('metal'))
    b.push((0, -0.3, 0), rx=math.pi / 2)                  # +y of the cylinders becomes +z
    b.cylinder((0, -1.25, 0), 0.17, 0.17, 2.2, 8, 'weiss', 'anthrazit', 'anthrazit')
    b.cylinder((0, -0.3, 0), 0.175, 0.175, 0.18, 8, C('frame'), None, None)
    b.cylinder((0, 0.6, 0), 0.175, 0.175, 0.1, 8, 'signalGelb', None, None)
    b.cone((0, 0.95, 0), 0.17, 0.45, 8, C('red'))
    b.cone((0, 1.32, 0), 0.07, 0.1, 6, C('glass'))
    for i in range(4):
        a = i * math.pi / 2 + math.pi / 4
        ca, sa = math.cos(a), math.sin(a)
        b.poly([(ca * 0.16, -1.25, sa * 0.16), (ca * 0.5, -1.25, sa * 0.5), (ca * 0.5, -1.0, sa * 0.5), (ca * 0.16, -0.65, sa * 0.16)], C('red'))
        b.poly([(ca * 0.16, 0.2, sa * 0.16), (ca * 0.3, 0.3, sa * 0.3), (ca * 0.3, 0.45, sa * 0.3), (ca * 0.16, 0.55, sa * 0.16)], 'weiss')
    b.pop()
    return b


# ---------------------------------------------------------------- assembly
def build():
    coll = reset()
    body, lights = MB(), MB()
    fuselage(body, lights)
    canopy(body)
    intakes(body)
    wing(body, 1)
    wing(body, -1)
    fin(body)
    nozzles(body, lights)
    pylons(body)
    o_body = body.build('body', coll, bevel=0.04, segments=2)

    # navigation lights: red port (+x), green starboard, white tail
    lights.box((11.95, -0.15, -6.9), (12.15, 0.1, -6.4), 'lichtRot')
    lights.box((-12.15, -0.15, -6.9), (-11.95, 0.1, -6.4), 'lichtGruen')
    lights.box((-0.12, 4.78, -7.1), (0.12, 4.98, -6.8), 'lichtWeiss')
    o_lights = lights.build('lights', coll, jitter=0)
    for i, (pos, colour, size) in enumerate([((12.2, 0, -6.6), 'lichtRot', 3), ((-12.2, 0, -6.6), 'lichtGruen', 3),
                                              ((0, 5.0, -6.95), 'lichtWeiss', 2.5), ((0, top_at(1.0) + 0.35, 0.95), 'lichtRot', 2)]):
        glow_point(f'glow.{i}', coll, pos, colour, size)
    for i, (pos, colour, size) in enumerate([((0.75, -0.05, -9.8), 'lichtBlau', 5.5), ((-0.75, -0.05, -9.8), 'lichtBlau', 5.5), ((0, -0.05, -11.2), 'lavaHell', 4)]):
        e = glow_point(f'exhaust.{i}', coll, pos, colour, size)
        e['exhaust'] = 1

    def pivot(name, pos):
        e = bpy.data.objects.new(name, None)
        e.empty_display_size = 0.4
        e.location = to_blender(pos)
        coll.objects.link(e)
        return e

    parts = [o_body]
    for side, s in (('L', 1), ('R', -1)):
        p = pivot(f'elevon.{side}', (0, 0, HINGE_Z))
        m = elevon(s).build(f'elevon.{side}.mesh', coll, bevel=0.02)
        m.parent = p
        parts.append(m)
    p = pivot('rudder', (0, 0, -7.25))
    m = rudder().build('rudder.mesh', coll, bevel=0.03)
    m.parent = p
    parts.append(m)
    for i, (x, z, top, wheels) in enumerate(((0.0, 6.6, -0.6, 1), (2.5, -3.2, -0.75, 2), (-2.5, -3.2, -0.75, 2))):
        p = pivot(f'gear.{i}', (x, top, z))
        m = gear_leg(top, wheels).build(f'gear.{i}.mesh', coll, bevel=0.015)
        m.parent = p
        parts.append(m)
    proto = missile().build('missilemesh', coll, bevel=0.015)
    apply_modifiers([proto])
    n = 0
    for x in (8.2, 6.2, 4.2):
        for s in (1, -1):
            o = bpy.data.objects.new(f'missile.{n}', proto.data)
            o.location = to_blender((s * x, wing_bot(x) - 0.14, -1.7))
            coll.objects.link(o)
            n += 1
    proto.location = (0, 0, -50)

    apply_modifiers(parts)
    body_mat, light_mat = vertex_colour_material('skua'), vertex_colour_material('skua-lights', emission=3.0)
    for o in coll.all_objects:
        if o.type == 'MESH':
            o.data.materials.clear()
            o.data.materials.append(light_mat if o.name.startswith('lights') else body_mat)
    if '--no-bake' not in ARGS:
        bake_ambient_occlusion(parts + [proto], strength=0.5, distance=1.2)
    return coll


def export():
    if not ENEMY:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'skua.blend'))
    for o in list(bpy.data.objects):
        if o.name == 'missilemesh':
            bpy.data.objects.remove(o)
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
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -2.42))
    floor = bpy.context.object
    fm = bpy.data.materials.new('floor')
    fm.use_nodes = True
    fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*PAL['deck'], 1.0)
    floor.data.materials.append(fm)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    out = os.path.join(HERE, 'renders')
    os.makedirs(out, exist_ok=True)
    target = to_blender((0, 0.5, 0))
    for name, (gx, gy, gz) in {'front': (20, 9, 26), 'rear': (-18, 10, -26), 'top': (8, 30, 6)}.items():
        cam.location = to_blender((gx, gy, gz))
        cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(out, f'skua-{name}.png')
        bpy.ops.render.render(write_still=True)


build()
export()
if '--render' in ARGS:
    render()
print('SKUA DONE')
