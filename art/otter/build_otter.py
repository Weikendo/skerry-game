"""
The Otter (Skerry's amphibious assault vehicle) built in Blender: the pilot for better models.

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python art/otter/build_otter.py -- [--render] [--no-bake]

Writes art/otter/otter.blend and art/otter/otter.glb, with --render also preview pictures in
art/otter/renders/. The frame matches src/models/walrus.ts (origin: middle of the track bottoms,
+z forward, length about 18.5 m, deck at 4.3 m), and so do the parts the game moves:
  turret (yaw)  >  barrel (elevation, pivot)  >  recoil (the twin laser, slides back)
  wheel_<side>_<n> (custom property r: radius), cleats_top|bottom_<side> (track links, slide along z)
  lights (emissive), glow_* empties (custom properties glow: colour name, size)
side L = +x (port, as the game's side 1), R = -x.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
from lowpoly import (ENEMY, MB, PAL, apply_modifiers, bake_ambient_occlusion, dirt, glow_point, safe_names, shade,  # noqa: E402
                     stripes, to_blender, vertex_colour_material)

HERE = os.path.dirname(__file__)
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
# the enemy's version (--feind) goes to otter_feind.glb
OUT = 'otter_feind' if ENEMY else 'otter'

# the game's measures (src/models/walrus.ts)
DECK = 4.3
RISER = 1.25
TURRET_Z = -2.6
TRACK_X0, TRACK_X1 = 3.0, 4.5
CLEAT_PITCH = 1.0


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene.collection


# ---------------------------------------------------------------- hull
def hull(b: MB):
    # sections: z, half width, bottom, deck (as the game's model), plus a raised splash board at the bow
    S = [(-8.3, 3.8, 1.5, 3.6), (-7.2, 4.15, 0.95, 4.15), (-2.5, 4.3, 0.85, DECK), (3.0, 4.3, 0.85, DECK),
         (6.0, 3.9, 1.05, 3.95), (8.2, 2.6, 1.6, 3.05), (9.5, 1.0, 2.0, 2.45)]

    def ring(hw, yb, yt, z):
        h = yt - yb
        chamfer = yt - min(0.5, h * 0.22)
        side = max(yb + min(0.35, h * 0.3), yt - 1.4)
        inset = min(0.65, hw * 0.3)
        pts = [(-(hw - inset), yt), (hw - inset, yt), (hw, chamfer), (hw, side), (hw * 0.8, yb), (-hw * 0.8, yb), (-hw, side), (-hw, chamfer)]
        return [(x, y, z) for x, y in pts]

    bands = ['ocker', 'ockerDunkel', 'stahl', 'metall', 'anthrazit', 'metall', 'stahl', 'ockerDunkel']
    rings = [ring(hw, yb, yt, z) for z, hw, yb, yt in S]
    b.loft(rings, lambda i, k: 'ockerHell' if (i >= len(S) - 3 and k == 0) else bands[k], cap0='stahl', cap1='ockerHell')

    # deck plates (slightly raised, bolted) and the engine deck with its grille
    for z0, z1 in [(-2.6, 0.6), (-6.9, -3.3)]:
        b.box((-2.95, DECK, z0), (2.95, DECK + 0.06, z1), {'side': 'ockerDunkel', 'top': 'ockerGrau'})
        b.bolts([(x, DECK + 0.06, z) for x in (-2.75, 2.75) for z in (z0 + 0.2, (z0 + z1) / 2, z1 - 0.2)], '+y')
    # engine grille: slats over a dark well on the rear plate
    b.box((-1.7, DECK + 0.06, -6.6), (1.7, DECK + 0.08, -4.75), 'schwarz')
    for k in range(7):
        z = -6.5 + k * 0.26
        b.box((-1.65, DECK + 0.08, z), (1.65, DECK + 0.2, z + 0.1), 'metall')
    # round crew hatch beside the turret, with hinge and handle
    b.cylinder((2.4, DECK + 0.06, 0.05), 0.48, 0.45, 0.14, 10, 'ockerDunkel', 'ocker')
    b.box((2.2, DECK + 0.2, -0.47), (2.6, DECK + 0.28, -0.39), 'metall')
    b.beam((2.15, DECK + 0.27, 0.3), (2.65, DECK + 0.27, 0.3), 0.06, 'metallHell')

    # plate seams and bolts along the steel band of the hull sides
    for s in (-1, 1):
        for z, hw in ((-5.6, 4.19), (-2.0, 4.3), (1.5, 4.3), (4.6, 4.1)):
            b.beam((s * (hw + 0.025), 2.92, z), (s * (hw + 0.025), 3.78, z), 0.06, 'metall')
            b.bolts([(s * (hw + 0.02), y, z + dz) for y in (3.05, 3.65) for dz in (-0.18, 0.18)], '+x' if s > 0 else '-x', r=0.05, h=0.04)
    # stowage boxes over the rear tracks, with latches
    for s in (-1, 1):
        x0, x1 = sorted((s * 3.05, s * 4.0))
        b.box((x0, DECK, -4.5), (x1, DECK + 0.62, -2.3), {'side': 'ockerDunkel', 'top': 'ocker'})
        for z in (-4.0, -3.0):
            xa, xb = sorted((s * 4.0 - s * 0.02, s * 4.0 + s * 0.06))
            b.box((xa, DECK + 0.25, z), (xb, DECK + 0.42, z + 0.25), 'metallHell')
        # grab rails along the deck edge, on posts
        b.beam((s * 3.55, DECK + 0.4, -1.8), (s * 3.55, DECK + 0.4, 0.8), 0.08, 'metallHell')
        for z in (-1.8, -0.5, 0.8):
            b.beam((s * 3.55, DECK, z), (s * 3.55, DECK + 0.4, z), 0.08, 'metall')
        # tow eyes, front and back
        b.box((s * 1.6 - 0.25, 2.15, 9.05), (s * 1.6 + 0.25, 2.65, 9.45), 'anthrazit')
        b.cylinder((s * 1.6, 2.4, 9.5), 0.2, 0.2, 0.1, 6, 'metallHell', 'metall')
        b.box((s * 1.9 - 0.25, 1.9, -8.6), (s * 1.9 + 0.25, 2.4, -8.25), 'anthrazit')

    # splash board (trim vane) hinged at the bow and folded back onto the glacis, with stiffening ribs
    b.push((0, 2.62, 9.3), rx=0.433)
    b.prism([(-0.9, 0.0), (0.9, 0.0), (1.7, -1.3), (-1.7, -1.3)], -0.06, 0.06, 'ockerDunkel', 'ockerHell', 'ockerDunkel')
    for x in (-1.0, 0.0, 1.0):
        b.box((x - 0.06, 0.06, -0.85), (x + 0.06, 0.15, -0.15), 'ocker')
    stripes(b, (-1.5, 0.065, -1.24), (1, 0, 0), (0, 0, 1), 3.0, 0.3, 10)
    b.pop()

    # water jets at the stern with louvres, exhaust stacks with caps
    for x in (-1.6, 1.6):
        b.push((x, 1.6, -8.25), rx=-math.pi / 2)
        b.cylinder((0, 0, 0), 0.62, 0.55, 0.55, 10, 'metall', None, None)
        b.cylinder((0, 0.55, 0), 0.5, 0.5, 0.02, 10, 'schwarz', 'schwarz')
        b.pop()
        for k in (-1, 0, 1):
            b.box((x - 0.5, 1.6 + k * 0.24 - 0.03, -8.85), (x + 0.5, 1.6 + k * 0.24 + 0.03, -8.78), 'anthrazit')
    # two mufflers lying across the rear deck, under perforated heat shields, with up-turned outlets
    for z in (-7.45, -6.75):
        y = DECK + 0.42
        b.push((-3.1, y, z), rz=math.pi / 2)
        b.cylinder((0, -0.8, 0), 0.28, 0.28, 1.6, 10, 'metall', 'metallHell', 'metallHell')
        b.pop()
        for k in range(-2, 3):
            a = k * 0.42
            dy, dz = 0.36 * math.cos(a), 0.36 * math.sin(a)
            b.beam((-3.85, y + dy, z + dz), (-2.35, y + dy, z + dz), 0.07, 'metallHell')
        for x in (-3.6, -2.6):
            b.box((x - 0.08, DECK, z - 0.2), (x + 0.08, y - 0.2, z + 0.2), 'anthrazit')
        b.beam((-2.3, y, z), (-2.05, y + 0.35, z), 0.16, 'anthrazit')
        b.beam((-2.05, y + 0.35, z), (-2.05, y + 0.95, z), 0.16, 'anthrazit')
        b.cylinder((-2.05, y + 0.95, z), 0.11, 0.13, 0.12, 6, 'schwarz', 'schwarz')
    # hazard band across the stern, under the rear light
    stripes(b, (-1.6, 2.92, -8.315), (1, 0, 0), (0, 1, 0), 3.2, 0.22, 12)
    # emblem on both hull sides (the island of the logo: white peak, ochre hill, a band of sea)
    for s in (-1, 1):
        x, z = s * 4.335, 3.05
        b.poly([(x, 3.02, z - 0.48), (x, 3.02, z + 0.48), (x, 3.68, z)], 'weiss')
        b.poly([(x + s * 0.004, 3.02, z - 0.62), (x + s * 0.004, 3.02, z + 0.02), (x + s * 0.004, 3.4, z - 0.3)], 'ocker')
        b.poly([(x + s * 0.008, 2.95, z - 0.7), (x + s * 0.008, 2.95, z + 0.6), (x + s * 0.008, 3.04, z + 0.6), (x + s * 0.008, 3.04, z - 0.7)], 'wasserMittel')
    # fenders over the track fronts, with mud flaps
    ang = math.atan2(0.5, 1.4)
    for s in (-1, 1):
        xm = s * (TRACK_X0 + TRACK_X1) / 2
        b.push((xm, 2.62, 7.55), rx=ang)
        b.box((-0.9, -0.05, -0.75), (0.9, 0.05, 0.75), {'side': 'metall', 'top': 'ockerDunkel'})
        b.bolts([(x, 0.05, z) for x in (-0.7, 0.7) for z in (-0.55, 0.55)], '+y', r=0.05, h=0.04)
        b.pop()
        b.box((xm - 0.85, 1.75, 8.24), (xm + 0.85, 2.38, 8.3), 'schwarz')
    # stern ladder rungs
    for k in range(3):
        y = 1.95 + k * 0.45
        b.beam((0.85, y, -8.42), (1.35, y, -8.42), 0.07, 'metallHell')
    # turret ring on its riser (more facets than before), with a bolt circle
    b.cylinder((0, DECK, TURRET_Z), 1.95, 1.75, RISER, 16, 'stahl', 'metall', None, math.pi / 16)
    b.cylinder((0, DECK + RISER - 0.22, TURRET_Z), 1.82, 1.82, 0.12, 16, 'ocker', 'ocker', None, math.pi / 16)
    b.bolts([(1.7 * math.cos(a), DECK + RISER - 0.1, TURRET_Z + 1.7 * math.sin(a)) for a in [k * math.pi / 6 for k in range(12)]], '+y', r=0.06, h=0.05)


# ---------------------------------------------------------------- tracks
def tracks(b: MB):
    prof = [(-8.0, 1.25), (-7.6, 0.45), (-6.8, 0.05), (6.8, 0.05), (7.6, 0.45), (8.0, 1.25), (7.6, 2.05), (6.8, 2.45), (-6.8, 2.45), (-7.6, 2.05)]
    for s in (-1, 1):
        x0, x1 = s * TRACK_X0, s * TRACK_X1
        # the track band (dark) around the profile, inner and outer walls
        ring_in = [(x0, y, z) for z, y in prof]
        ring_out = [(x1, y, z) for z, y in prof]
        b.loft([ring_in, ring_out], ['anthrazit'] * len(prof))
        b.poly([(x0 + s * 0.02, y, z) for z, y in prof], 'schwarz')
        b.poly(list(reversed([(x1 - s * 0.02, y, z) for z, y in prof])), 'schwarz')
        # side skirt over the upper run: plates with bolts and a top lip
        sx = s * (TRACK_X1 + 0.08)
        skirt = [(-7.2, 1.45), (7.2, 1.45), (7.9, 2.25), (7.4, 2.7), (-7.4, 2.7), (-7.9, 2.25)]
        b.loft([[(sx, y, z) for z, y in skirt], [(sx + s * 0.12, y, z) for z, y in skirt]], ['metall'] * len(skirt),
               cap0='metall', cap1='metall')
        b.quad((sx, 2.7, -7.4), (sx, 2.7, 7.4), (s * TRACK_X0, 2.78, 7.4), (s * TRACK_X0, 2.78, -7.4), 'metallHell')
        for z in (-4.4, 0, 4.4):
            b.box((min(sx, sx + s * 0.2), 1.6, z - 0.95), (max(sx, sx + s * 0.2), 2.55, z + 0.95), 'stahl')
            b.bolts([(sx + s * 0.2, y, z + dz) for y in (1.75, 2.4) for dz in (-0.75, 0.75)], '+x' if s > 0 else '-x', r=0.06, h=0.05)
        # return rollers under the upper run
        for z in (-3.3, 0.0, 3.3):
            b.push((s * (TRACK_X0 + TRACK_X1) / 2, 2.2, z), rz=math.pi / 2)
            b.cylinder((0, -0.6, 0), 0.22, 0.22, 1.2, 8, 'metall', 'metallHell', 'metallHell')
            b.pop()


def wheel(kind: str) -> MB:
    """a road wheel (tyre and hub with bolts), the toothed sprocket or the spoked idler; axis along x, outer side +x"""
    b = MB()
    r = 0.72 if kind == 'road' else 0.85
    b.push(rz=-math.pi / 2)      # cylinder +y becomes +x
    if kind == 'sprocket':
        n = 12
        pts = []
        for k in range(n * 2):
            a = math.pi * k / n
            rr = r if k % 2 == 0 else r * 0.82
            pts.append((rr * math.cos(a), rr * math.sin(a)))
        b.prism([(x, z) for x, z in pts], -0.25, 0.25, 'metall', 'metallHell', 'metallHell')
        b.cylinder((0, 0.25, 0), r * 0.45, r * 0.4, 0.14, 8, 'anthrazit', 'metall')
    else:
        b.cylinder((0, -0.25, 0), r, r, 0.5, 12, 'schwarz', 'anthrazit', 'anthrazit')           # rubber tyre
        b.cylinder((0, 0.25, 0), r * 0.68, r * 0.62, 0.08, 10, 'metallHell', 'metallHell')        # rim
        b.cylinder((0, 0.33, 0), r * 0.3, r * 0.26, 0.12, 6, 'metall', 'metall')                  # hub cap
        for k in range(6):
            a = k * math.pi / 3
            b.box((r * 0.45 * math.cos(a) - 0.05, 0.33, r * 0.45 * math.sin(a) - 0.05), (r * 0.45 * math.cos(a) + 0.05, 0.38, r * 0.45 * math.sin(a) + 0.05), 'anthrazit')
        if kind == 'idler':
            for k in range(5):
                a = k * 2 * math.pi / 5
                b.beam((0, 0.3, 0), (r * 0.6 * math.cos(a), 0.3, r * 0.6 * math.sin(a)), 0.1, 'metall')
    b.pop()
    return b


def cleats(y0: float, y1: float, side: int, top: bool) -> MB:
    """the links of one track run: a plate, a grouser on the outside of the run and a guide horn on the inside"""
    b = MB()
    xa, xb = sorted((side * TRACK_X0, side * TRACK_X1))
    hx = side * (TRACK_X0 + 0.35)
    z = -6.5
    while z <= 6.5 + 1e-6:
        b.box((xa, y0, z - 0.2), (xb, y1, z + 0.2), 'schwarz')
        gy0, gy1 = (y1, y1 + 0.06) if top else (y0 - 0.06, y0)
        b.box((xa + 0.15, gy0, z - 0.06), (xb - 0.15, gy1, z + 0.06), 'anthrazit')
        hy0, hy1 = (y0 - 0.14, y0) if top else (y1, y1 + 0.14)
        b.box((hx - 0.08, hy0, z - 0.12), (hx + 0.08, hy1, z + 0.12), 'metall')
        z += CLEAT_PITCH
    return b


# ---------------------------------------------------------------- cab
def cab(b: MB, lights: MB, glows: list):
    y0, y1 = DECK, 6.1
    bl = [(-2.6, y0, 1.0), (2.6, y0, 1.0), (2.6, y0, 5.0), (-2.6, y0, 5.0)]
    tl = [(-2.15, y1, 1.35), (2.15, y1, 1.35), (2.15, y1, 3.7), (-2.15, y1, 3.7)]
    b.loft([bl, tl], ['ockerDunkel', 'ocker', 'ockerHell', 'ocker'], cap1='ockerGrau')

    def along(u, x, out=0.04):
        z = 5.0 + (3.7 - 5.0) * u
        y = y0 + (y1 - y0) * u
        hw = 2.6 + (2.15 - 2.6) * u
        return (x * hw, y + out * 0.7, z + out)

    # three windscreen panes with frames and wipers
    for x0, x1 in [(-0.9, -0.35), (-0.3, 0.3), (0.35, 0.9)]:
        b.quad(along(0.45, x0), along(0.45, x1), along(0.88, x1), along(0.88, x0), 'fensterBlau')
        b.beam(along(0.45, x0, 0.06), along(0.88, x0, 0.06), 0.07, 'anthrazit')
        b.beam(along(0.45, x1, 0.06), along(0.88, x1, 0.06), 0.07, 'anthrazit')
        b.beam(along(0.5, (x0 + x1) / 2, 0.09), along(0.78, (x0 + x1) / 2 + 0.06, 0.09), 0.035, 'schwarz')
    b.beam(along(0.43, -0.93, 0.06), along(0.43, 0.93, 0.06), 0.09, 'anthrazit')
    b.beam(along(0.9, -0.93, 0.06), along(0.9, 0.93, 0.06), 0.09, 'anthrazit')
    # side vision blocks with armoured lids
    for s in (-1, 1):
        b.quad((s * 2.43, 5.3, 1.6), (s * 2.43, 5.3, 3.8), (s * 2.36, 5.62, 3.6), (s * 2.36, 5.62, 1.7), 'fensterBlau')
        b.box((min(s * 2.35, s * 2.55), 5.62, 1.55), (max(s * 2.35, s * 2.55), 5.7, 3.85), 'ockerDunkel')
        # mirrors on arms at the front corners
        b.beam((s * 2.4, 5.0, 4.5), (s * 2.95, 5.45, 4.85), 0.06, 'anthrazit')
        b.box((s * 2.95 - 0.12, 5.3, 4.75), (s * 2.95 + 0.12, 5.75, 4.95), {'side': 'anthrazit', 'front': 'anthrazit', 'back': 'glasBlau'})
    # roof: hatch with handle, periscopes, spotlight, sensor mast, rails
    b.cylinder((-0.9, y1, 2.3), 0.55, 0.52, 0.18, 10, 'metall', 'stahl')
    b.beam((-1.2, y1 + 0.26, 2.3), (-0.6, y1 + 0.26, 2.3), 0.06, 'metallHell')
    for x in (0.2, 0.8):
        b.box((x - 0.18, y1, 3.25), (x + 0.18, y1 + 0.32, 3.55), {'side': 'anthrazit', 'front': 'glasBlau'})
    b.beam((1.3, y1, 2.0), (1.3, y1 + 1.0, 2.0), 0.12, 'anthrazit')
    b.box((1.05, y1 + 1.0, 1.75), (1.55, y1 + 1.35, 2.25), {'side': 'anthrazit', 'front': 'glasBlau'})
    b.push((1.75, y1, 3.2))
    b.cylinder((0, 0, 0), 0.12, 0.12, 0.3, 6, 'anthrazit', 'anthrazit')
    b.push((0, 0.45, 0), rx=-math.pi / 2)
    b.cylinder((0, -0.2, 0), 0.22, 0.24, 0.4, 8, 'anthrazit', None, 'anthrazit')
    b.pop()
    b.pop()
    lights.push((1.75, y1 + 0.45, 3.42), rx=-math.pi / 2)
    lights.cylinder((0, 0, 0), 0.2, 0.2, 0.02, 8, 'lichtWarm', 'lichtWarm')
    lights.pop()
    # light bar across the front of the roof: four lamps on two posts
    for x in (-1.5, 1.5):
        b.beam((x, y1, 3.55), (x, y1 + 0.42, 3.55), 0.08, 'anthrazit')
    b.beam((-1.7, y1 + 0.42, 3.55), (1.7, y1 + 0.42, 3.55), 0.1, 'anthrazit')
    for x in (-1.2, -0.4, 0.4, 1.2):
        b.box((x - 0.24, y1 + 0.47, 3.45), (x + 0.24, y1 + 0.75, 3.7), 'anthrazit')
        lights.box((x - 0.18, y1 + 0.51, 3.7), (x + 0.18, y1 + 0.71, 3.73), 'lichtWarm')
        glows.append(((x, y1 + 0.61, 3.85), 'lichtWarm', 1.6))
    for s in (-1, 1):
        b.beam((s * 2.0, y1 + 0.2, 1.5), (s * 2.0, y1 + 0.2, 3.5), 0.06, 'metallHell')
        for z in (1.5, 3.5):
            b.beam((s * 2.0, y1, z), (s * 2.0, y1 + 0.2, z), 0.06, 'metall')
    # head lights in armoured housings with guard bars, rear light, antenna with a red tip
    for s in (-1, 1):
        x = s * 2.2
        b.box((x - 0.55, 2.85, 7.75), (x + 0.55, 3.55, 8.3), 'anthrazit')
        lights.box((x - 0.4, 2.98, 8.3), (x + 0.4, 3.42, 8.36), 'lichtWeiss')
        for k in (-0.25, 0.0, 0.25):
            b.beam((x + k, 2.85, 8.55), (x + k, 3.55, 8.55), 0.05, 'metallHell')
        b.beam((x - 0.5, 3.6, 8.3), (x + 0.5, 3.6, 8.55), 0.05, 'metallHell')
        glows.append(((x, 3.2, 8.7), 'lichtWeiss', 5))
    for s in (-1, 1):
        xm = s * (TRACK_X0 + TRACK_X1) / 2
        lights.box((xm - 0.12, 2.42, 8.32), (xm + 0.12, 2.56, 8.36), 'lichtWarm')
        glows.append(((xm, 2.49, 8.5), 'lichtWarm', 1.4))
    lights.box((-0.55, 3.4, -8.36), (0.55, 3.72, -8.3), 'lichtRot')
    glows.append(((0, 3.55, -8.5), 'lichtRot', 3))
    b.cylinder((-3.3, DECK, -5.3), 0.18, 0.14, 0.3, 8, 'metall', 'anthrazit')
    b.cylinder((-3.3, DECK + 0.3, -5.3), 0.07, 0.035, 4.2, 5, 'anthrazit')
    lights.box((-3.42, DECK + 4.4, -5.42), (-3.18, DECK + 4.65, -5.18), 'lichtRot')
    glows.append(((-3.3, DECK + 4.55, -5.3), 'lichtRot', 2.5))


# ---------------------------------------------------------------- turret and laser
def turret_body(lights: MB, glows: list) -> MB:
    b = MB()
    b.cylinder((0, 0, 0), 2.15, 2.05, 0.45, 16, 'metall', 'metallHell', None, math.pi / 16)
    lo, mid, hi = 0.45, 1.2, 1.8
    B = [(-1.8, lo, -1.95), (1.8, lo, -1.95), (1.8, lo, 1.4), (0.95, lo, 2.25), (-0.95, lo, 2.25), (-1.8, lo, 1.4)]
    M = [(-1.7, mid, -1.85), (1.7, mid, -1.85), (1.7, mid, 1.25), (0.85, mid, 2.0), (-0.85, mid, 2.0), (-1.7, mid, 1.25)]
    T = [(-1.25, hi, -1.55), (1.25, hi, -1.55), (1.25, hi, 0.9), (0.62, hi, 1.4), (-0.62, hi, 1.4), (-1.25, hi, 0.9)]
    cols = ['stahl', 'stahl', 'stahlHell', 'stahlHell', 'stahlHell', 'stahl']
    b.loft([B, M, T], lambda i, k: shade(cols[k], 0.92) if i == 0 else cols[k], cap1='stahlHell')
    # ochre band around the back, hatch, sensor block, antenna
    b.quad((-1.72, mid - 0.25, -1.88), (1.72, mid - 0.25, -1.88), (1.72, mid - 0.05, -1.86), (-1.72, mid - 0.05, -1.86), 'ocker')
    b.cylinder((-0.45, hi, -0.55), 0.5, 0.48, 0.14, 10, 'metall', 'stahl')
    b.beam((-0.75, hi + 0.2, -0.55), (-0.15, hi + 0.2, -0.55), 0.06, 'metallHell')
    b.box((0.35, hi, -1.0), (1.1, hi + 0.55, -0.1), {'side': 'anthrazit', 'front': 'glasBlau', 'top': 'metall'})
    b.box((0.45, hi + 0.12, -0.12), (1.0, hi + 0.42, -0.06), 'glasBlau')
    b.cylinder((-0.95, hi, -1.15), 0.12, 0.1, 0.18, 6, 'metall', 'anthrazit')
    b.cylinder((-0.95, hi + 0.18, -1.15), 0.05, 0.025, 1.7, 5, 'anthrazit')
    # add-on armour blocks on both sides, bolted
    for s in (-1, 1):
        b.push((s * 1.86, 0.48, -0.85), ry=s * 0.06)
        xa, xb = sorted((0, s * 0.24))
        b.box((xa, 0, -0.75), (xb, 0.8, 0.75), {'side': 'stahl', 'top': 'stahlHell'})
        b.bolts([(s * 0.24, y, z) for y in (0.2, 0.6) for z in (-0.55, 0.0, 0.55)], '+x' if s > 0 else '-x', r=0.05, h=0.04)
        b.pop()
    # sensor mast with a small dish, a green status light on the sensor block
    b.cylinder((1.05, hi, -1.3), 0.14, 0.12, 0.15, 6, 'metall', 'anthrazit')
    b.cylinder((1.05, hi + 0.15, -1.3), 0.06, 0.05, 0.85, 5, 'anthrazit')
    b.push((1.05, hi + 1.0, -1.3), rx=-0.9)
    b.cone((0, 0, 0), 0.4, 0.14, 10, 'weiss')
    b.cylinder((0, 0.02, 0), 0.05, 0.03, 0.35, 4, 'anthrazit')
    b.pop()
    lights.box((0.85, hi + 0.55, -0.55), (0.98, hi + 0.6, -0.42), 'lichtGruen')
    glows.append(((0.92, hi + 0.62, -0.48), 'lichtGruen', 1.0))
    # stowage bin on the back, smoke dischargers on both cheeks
    b.box((-1.5, 0.6, -2.55), (1.5, 1.3, -1.92), {'side': 'ockerDunkel', 'top': 'ocker'})
    b.beam((-1.4, 1.36, -2.5), (1.4, 1.36, -2.5), 0.06, 'metall')
    for s in (-1, 1):
        for k in range(3):
            b.push((s * 1.75, 0.95 + k * 0.2, 0.6), ry=s * 0.5, rx=-0.6)
            b.cylinder((0, 0, 0), 0.11, 0.11, 0.55, 6, 'anthrazit', 'schwarz')
            b.pop()
    return b


def laser() -> MB:
    """the twin Avatar laser: housing with vents, two emitter tubes with fins, rings and lenses; muzzle near z = 5"""
    g = MB()
    g.box((-0.8, -0.45, -0.65), (0.8, 0.45, 0.95), {'side': 'anthrazit', 'top': 'metall', 'front': 'metall'})
    for k in range(5):
        z = -0.45 + k * 0.28
        for s in (-1, 1):
            g.box((s * 0.8 - 0.03, -0.3, z), (s * 0.8 + 0.03, 0.3, z + 0.12), 'schwarz')
    g.beam((0, 0.45, -0.4), (0, 0.6, 0.8), 0.18, 'metall')
    for x in (-0.38, 0.38):
        g.push((x, 0, 0.95), rx=math.pi / 2)     # +y of the cylinder becomes +z
        g.cylinder((0, 0, 0), 0.25, 0.21, 3.6, 8, 'weiss', 'weiss')
        for k in range(7):
            g.cylinder((0, 0.2 + k * 0.26, 0), 0.38, 0.38, 0.08, 8, 'metall', 'metall', 'metall')
        g.cylinder((0, 3.5, 0), 0.29, 0.29, 0.4, 8, 'metall', 'metallHell')
        g.cylinder((0, 3.9, 0), 0.24, 0.24, 0.06, 8, 'anthrazit', 'anthrazit')
        g.cone((0, 3.96, 0), 0.22, 0.3, 8, 'glasBlau')
        g.pop()
    # power conduits from the housing along the tubes
    for x in (-0.65, 0.65):
        g.beam((x, -0.2, 0.9), (x * 0.75, -0.2, 2.6), 0.08, 'schwarz')
    return g


# ---------------------------------------------------------------- assembly
def build():
    coll = reset()
    body, lights = MB(), MB()
    glows = []
    hull(body)
    tracks(body)
    cab(body, lights, glows)
    o_body = body.build('body', coll, bevel=0.07)

    t_lights, t_glows = MB(), []
    o_turret = turret_body(t_lights, t_glows).build('turret', coll, bevel=0.05)
    o_turret.location = to_blender((0, DECK + RISER, TURRET_Z))
    o_tlights = t_lights.build('lights.turret', coll, jitter=0)
    o_tlights.parent = o_turret
    for i, (pos, colour, size) in enumerate(t_glows):
        glow_point(f'glow.turret.{i}', coll, pos, colour, size, parent=o_turret)
    barrel = bpy.data.objects.new('barrel', None)
    barrel.empty_display_size = 0.5
    coll.objects.link(barrel)
    barrel.parent = o_turret
    barrel.location = to_blender((0, 1.1, 1.5))
    o_recoil = laser().build('recoil', coll, bevel=0.03)
    o_recoil.parent = barrel

    wheels = []
    for kind, r in (('road', 0.72), ('sprocket', 0.85), ('idler', 0.85)):
        wheels.append((kind, r, wheel(kind).build(f'wheelmesh.{kind}', coll, bevel=0.03)))
    apply_modifiers([o for _, _, o in wheels])       # before the wheels share their mesh
    proto = {k: (r, o) for k, r, o in wheels}
    parts = [o_body, o_turret, o_recoil]
    for side, s in (('L', 1), ('R', -1)):
        x = s * (TRACK_X1 - 0.3)
        spots = [('road', 0.78, z) for z in (-5.5, -3.3, -1.1, 1.1, 3.3, 5.5)] + [('sprocket', 1.25, 7.05), ('idler', 1.25, -7.05)]
        for n, (kind, y, z) in enumerate(spots):
            r, src = proto[kind]
            o = bpy.data.objects.new(f'wheel.{side}.{n}', src.data)
            o['r'] = r
            o['side'] = s
            o.location = to_blender((x, y, z))
            if s < 0:
                o.rotation_euler = (0, 0, math.pi)       # hub outward on the starboard side too
            coll.objects.link(o)
        top = cleats(2.45, 2.6, s, True).build(f'cleats.top.{side}', coll)
        bottom = cleats(-0.1, 0.05, s, False).build(f'cleats.bottom.{side}', coll)
        top['side'] = bottom['side'] = s
        parts += [top, bottom]
    for _, _, o in wheels:       # the prototypes wait under the floor (they are left out of the export)
        o.location = (0, 0, -50)

    o_lights = lights.build('lights', coll, jitter=0)
    for i, (pos, colour, size) in enumerate(glows):
        glow_point(f'glow.{i}', coll, pos, colour, size)

    apply_modifiers(parts)
    body_mat, light_mat = vertex_colour_material('otter'), vertex_colour_material('otter-lights', emission=3.0)
    for o in coll.all_objects:
        if o.type == 'MESH':
            o.data.materials.clear()
            o.data.materials.append(light_mat if o.name.startswith('lights') else body_mat)
    if '--no-bake' not in ARGS:
        bake_ambient_occlusion([o for o in parts if not o.name.startswith('wheelmesh')] + [o for _, _, o in wheels])
    # road dirt from the tracks up (the wheel prototypes for a moment where the wheels are)
    for _, _, o in wheels:
        o.location = to_blender((0, 0.9, 0))
    bpy.context.view_layer.update()
    dirt([o for o in parts if o.name == 'body' or o.name.startswith('cleats')] + [o for _, _, o in wheels])
    for _, _, o in wheels:
        o.location = (0, 0, -50)
    return coll


def export():
    if not ENEMY:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'otter.blend'))
    # the wheel prototypes are only shared mesh data: leave their objects out of the file
    for o in list(bpy.data.objects):
        if o.name.startswith('wheelmesh.'):
            bpy.data.objects.remove(o)
    safe_names()
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(HERE, OUT + '.glb'), export_format='GLB', export_yup=True, export_apply=True,
        export_vertex_color='ACTIVE', export_extras=True, export_normals=False, export_materials='EXPORT')


def render():
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    scene.render.film_transparent = False
    world = scene.world or bpy.data.worlds.new('World')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (*PAL['stahlHell'], 1.0)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.55
    # a floor, a sun from the front left and a soft fill
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.02))
    floor = bpy.context.object
    fm = bpy.data.materials.new('floor')
    fm.use_nodes = True
    fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*PAL['sandHell'], 1.0)
    floor.data.materials.append(fm)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.2
    sun.data.angle = math.radians(4)
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    scene.collection.objects.link(sun)
    fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill', 'SUN'))
    fill.data.energy = 0.8
    fill.rotation_euler = (math.radians(60), 0, math.radians(150))
    scene.collection.objects.link(fill)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.lens = 50
    out = os.path.join(HERE, 'renders')
    os.makedirs(out, exist_ok=True)
    target = to_blender((0, 2.6, 0))
    views = {'front': (24, 30, 12), 'rear': (-22, -28, 13), 'side': (34, 0, 5), 'top': (12, 14, 26), 'detail': (10, 13, 9)}
    for name, (gx, gz, gy) in views.items():
        cam.location = to_blender((gx, gy, gz))
        aim = target if name != 'detail' else to_blender((0, 4.5, 2.0))
        d = (aim - cam.location)
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(out, f'otter-{name}.png')
        bpy.ops.render.render(write_still=True)


build()
export()
if '--render' in ARGS:
    render()
print('OTTER DONE')
