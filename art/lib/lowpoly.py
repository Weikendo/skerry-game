"""
Low-poly building blocks for Skerry's models in Blender (run inside Blender's Python).

Everything is written in GAME coordinates, as in src/models/*.ts: x right, y up, z forward,
metres. `to_blender` turns them into Blender's (x, -z, y), which the glTF exporter (+Y up)
turns back into the game's frame. Colours come from src/engine/palette.ts and are stored per
face corner as linear floats (like LowPolyBuilder), so the game's flat-shaded vertex-colour
material shows them exactly as before.
"""
import math
import os
import re
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))


def _palette():
    src = open(os.path.join(ROOT, 'src', 'engine', 'palette.ts'), encoding='utf-8').read()
    out = {}
    for name, hexcol in re.findall(r"(\w+): '#([0-9a-fA-F]{6})'", src):
        rgb = [int(hexcol[i:i + 2], 16) / 255 for i in (0, 2, 4)]
        out[name] = tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb)
    return out


PAL = _palette()

# `--feind` builds the enemy's version: the player's ochre and signal orange become the enemy's violet,
# as src/models/tint.ts swaps them on the code-built models (here before shading, dirt and baking)
ENEMY = '--feind' in sys.argv
ENEMY_SWAP = {
    'ockerHell': 'feindHell', 'ocker': 'feind', 'ockerDunkel': 'feindDunkel', 'ockerGrau': 'feindGrau',
    'signalOrange': 'feind', 'signalOrangeDunkel': 'feindDunkel', 'rettungsOrange': 'feindHell',
}
if ENEMY:
    PAL.update({a: PAL[b] for a, b in ENEMY_SWAP.items()})


def to_blender(p):
    return Vector((p[0], -p[2], p[1]))


def col(c):
    """a palette name or an (r, g, b) tuple in linear values"""
    return PAL[c] if isinstance(c, str) else tuple(c)


def shade(c, k):
    """a palette colour made lighter (k > 1) or darker (k < 1)"""
    r, g, b = col(c)
    return (min(1, r * k), min(1, g * k), min(1, b * k))


class MB:
    """A mesh in the making: shared vertices per primitive, one colour per face, a transform stack."""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.cols = []
        self.parts = []
        self.part = 0
        self.stack = [Matrix.Identity(4)]

    def _new_part(self):
        """every primitive is one part: it gets its own slight shade (a hand-painted look)"""
        self.part += 1

    # ---- transforms (game coordinates) ----
    def push(self, t=(0, 0, 0), ry=0.0, s=(1, 1, 1), rx=0.0, rz=0.0):
        m = (Matrix.Translation(Vector(t)) @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rx, 4, 'X')
             @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Diagonal((s[0], s[1], s[2], 1)))
        self.stack.append(self.stack[-1] @ m)

    def pop(self):
        self.stack.pop()

    def _v(self, p):
        q = self.stack[-1] @ Vector((p[0], p[1], p[2], 1))
        self.verts.append((q.x, q.y, q.z))
        return len(self.verts) - 1

    def face_idx(self, idx, c):
        self.faces.append(list(idx))
        self.cols.append(col(c))
        self.parts.append(self.part)

    # ---- primitives ----
    def poly(self, pts, c):
        self._new_part()
        self.face_idx([self._v(p) for p in pts], c)

    def quad(self, a, b, c_, d, c):
        self.poly([a, b, c_, d], c)

    def box(self, a, b, c):
        """axis-aligned box from corner a to corner b; c is a colour or a dict with side/top/bottom/front/back"""
        self._new_part()
        x0, y0, z0 = a
        x1, y1, z1 = b
        cs = c if isinstance(c, dict) else {}
        side = cs.get('side', c if not isinstance(c, dict) else 'metall')
        top, bottom = cs.get('top', side), cs.get('bottom', side)
        front, back = cs.get('front', side), cs.get('back', side)
        v = [self._v(p) for p in [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]]
        self.face_idx([v[0], v[3], v[2], v[1]], back)      # -z
        self.face_idx([v[4], v[5], v[6], v[7]], front)     # +z
        self.face_idx([v[0], v[4], v[7], v[3]], side)      # -x
        self.face_idx([v[1], v[2], v[6], v[5]], side)      # +x
        self.face_idx([v[3], v[7], v[6], v[2]], top)       # +y
        self.face_idx([v[0], v[1], v[5], v[4]], bottom)    # -y

    def prism(self, outline, y0, y1, side, top=None, bottom=None):
        """a vertical prism over an outline of (x, z) points (counter-clockwise seen from above)"""
        self._new_part()
        n = len(outline)
        lo = [self._v((x, y0, z)) for x, z in outline]
        hi = [self._v((x, y1, z)) for x, z in outline]
        sides = side if isinstance(side, list) else [side] * n
        for i in range(n):
            j = (i + 1) % n
            self.face_idx([lo[i], lo[j], hi[j], hi[i]], sides[i])
        self.face_idx(list(reversed(hi)), top or sides[0])
        self.face_idx(lo, bottom or sides[0])

    def cylinder(self, c, r0, r1, h, n, side, top=None, bottom=None, rot=0.0):
        """along +y from c: radius r0 at the bottom, r1 at the top"""
        self._new_part()
        cx, cy, cz = c
        ring = lambda r, y: [self._v((cx + r * math.cos(rot + 2 * math.pi * k / n), y, cz + r * math.sin(rot + 2 * math.pi * k / n))) for k in range(n)]
        lo, hi = ring(r0, cy), ring(r1, cy + h)
        for k in range(n):
            j = (k + 1) % n
            self.face_idx([lo[k], hi[k], hi[j], lo[j]], side)
        if top is not None and r1 > 0:
            self.face_idx(hi, top)
        if bottom is not None and r0 > 0:
            self.face_idx(list(reversed(lo)), bottom)

    def cone(self, c, r, h, n, colour, rot=0.0):
        self._new_part()
        cx, cy, cz = c
        lo = [self._v((cx + r * math.cos(rot + 2 * math.pi * k / n), cy, cz + r * math.sin(rot + 2 * math.pi * k / n))) for k in range(n)]
        tip = self._v((cx, cy + h, cz))
        for k in range(n):
            self.face_idx([lo[k], tip, lo[(k + 1) % n]], colour)
        self.face_idx(list(reversed(lo)), colour)

    def beam(self, a, b, w, colour):
        """a square bar of width w from a to b"""
        self._new_part()
        a, b = Vector(a), Vector(b)
        d = (b - a)
        if d.length < 1e-6:
            return
        d.normalize()
        up = Vector((0, 1, 0)) if abs(d.y) < 0.95 else Vector((1, 0, 0))
        s = d.cross(up).normalized() * (w / 2)
        u = s.cross(d).normalized() * (w / 2)
        corners = [-s - u, s - u, s + u, -s + u]
        lo = [self._v(tuple(a + c)) for c in corners]
        hi = [self._v(tuple(b + c)) for c in corners]
        for i in range(4):
            j = (i + 1) % 4
            self.face_idx([lo[i], lo[j], hi[j], hi[i]], colour)
        self.face_idx(list(reversed(lo)), colour)
        self.face_idx(hi, colour)

    def loft(self, rings, colours, cap0=None, cap1=None):
        """rings of equal length (game points), joined in order; colours per ring segment index k"""
        self._new_part()
        idx = [[self._v(p) for p in r] for r in rings]
        n = len(rings[0])
        for i in range(len(rings) - 1):
            for k in range(n):
                j = (k + 1) % n
                cl = colours(i, k) if callable(colours) else colours[k]
                self.face_idx([idx[i][k], idx[i][j], idx[i + 1][j], idx[i + 1][k]], cl)
        if cap0:
            self.face_idx(list(reversed(idx[0])), cap0)
        if cap1:
            self.face_idx(idx[-1], cap1)

    def slab(self, outline, top, bottom, top_col, bottom_col, edge_col):
        """a flat solid over an outline of (x, z) points (any order, may be concave): its top at y = top(x, z),
        its bottom at y = bottom(x, z); edge_col is a colour or a function of the edge index"""
        self._new_part()
        T = [self._v((x, top(x, z), z)) for x, z in outline]
        B = [self._v((x, bottom(x, z), z)) for x, z in outline]
        n = len(outline)
        self.face_idx(T, top_col)
        self.face_idx(list(reversed(B)), bottom_col)
        for i in range(n):
            j = (i + 1) % n
            self.face_idx([B[i], B[j], T[j], T[i]], edge_col(i) if callable(edge_col) else edge_col)

    def xslab(self, profile, half, side_col, edge_col, x=0.0):
        """a thin plate standing in the y-z plane (fins, rudders): the profile of (z, y) points, half its thickness
        to each side of x"""
        self._new_part()
        L = [self._v((x - half, y, z)) for z, y in profile]
        R = [self._v((x + half, y, z)) for z, y in profile]
        n = len(profile)
        self.face_idx(L, side_col)
        self.face_idx(list(reversed(R)), side_col)
        for i in range(n):
            j = (i + 1) % n
            self.face_idx([L[i], L[j], R[j], R[i]], edge_col(i) if callable(edge_col) else edge_col)

    def zprism(self, profile, z0, z1, side, cap=None):
        """a profile of (x, y) points extruded along z from z0 to z1 (like LowPolyBuilder.prismZ)"""
        self._new_part()
        A = [self._v((x, y, z0)) for x, y in profile]
        B = [self._v((x, y, z1)) for x, y in profile]
        n = len(profile)
        for i in range(n):
            j = (i + 1) % n
            self.face_idx([A[i], A[j], B[j], B[i]], side(i) if callable(side) else side)
        self.face_idx(B, cap or (side if not callable(side) else side(0)))
        self.face_idx(list(reversed(A)), cap or (side if not callable(side) else side(0)))

    def disc(self, c, normal, r, n, colour, rot=0.0):
        """a flat n-gon (markings): centre c, facing along normal ('+x', '-x', '+y')"""
        self._new_part()
        cx, cy, cz = c
        pts = []
        for k in range(n):
            a = rot + 2 * math.pi * k / n
            u, v = r * math.cos(a), r * math.sin(a)
            pts.append({'+y': (cx + u, cy, cz + v), '+x': (cx, cy + u, cz + v), '-x': (cx, cy + u, cz + v)}[normal])
        self.face_idx([self._v(p) for p in pts], colour)

    def bolts(self, pts, axis, r=0.07, h=0.06, colour='metallHell'):
        """small hex bolt heads on a surface; axis: '+x', '-x', '+y', '+z', '-z'"""
        rot = {'+y': (0, 0, 0), '+x': (0, 0, -math.pi / 2), '-x': (0, 0, math.pi / 2), '+z': (0, math.pi / 2, 0), '-z': (0, -math.pi / 2, 0)}[axis]
        for p in pts:
            self.push(p, rx=rot[1], rz=rot[2])
            self.cylinder((0, 0, 0), r, r * 0.85, h, 6, colour, colour)
            self.pop()

    # ---- to Blender ----
    def build(self, name, collection, bevel=0.0, smooth_limit=30.0, jitter=0.035, segments=1, recalc=True):
        """recalc=False keeps the windings as written (loose flat faces, whose recalculated side would be arbitrary)"""
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([tuple(to_blender(v)) for v in self.verts], [], self.faces)
        attr = mesh.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        k = 0
        for f, c, part in zip(mesh.polygons, self.cols, self.parts):
            # a fixed pseudo-random shade per part (the same on every build)
            j = 1 + jitter * (2 * (((part * 2654435761) % 1000) / 1000) - 1)
            for _ in f.loop_indices:
                attr.data[k].color = (min(1, c[0] * j), min(1, c[1] * j), min(1, c[2] * j), 1.0)
                k += 1
        mesh.color_attributes.active_color = attr
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        if recalc:
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(name, mesh)
        collection.objects.link(obj)
        if bevel > 0:
            # the new edge faces get material slot 1, so they can be lit up after applying (edge highlights)
            for slot in ('_face', '_edge'):
                mesh.materials.append(bpy.data.materials.get(slot) or bpy.data.materials.new(slot))
            m = obj.modifiers.new('Bevel', 'BEVEL')
            m.width = bevel
            m.segments = segments
            m.limit_method = 'ANGLE'
            m.angle_limit = math.radians(smooth_limit)
            m.offset_type = 'WIDTH'
            m.use_clamp_overlap = True
            m.material = 1
        for p in mesh.polygons:
            p.use_smooth = False
        return obj


def apply_modifiers(objs, edge_light=1.22):
    """apply the bevels; their edge faces get a lighter shade of their colour (worn, sunlit edges)"""
    for o in objs:
        if not o.modifiers:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        for m in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)
        me = o.data
        c = me.color_attributes['Col']
        for p in me.polygons:
            if p.material_index == 1:
                for li in p.loop_indices:
                    r, g, b, a = c.data[li].color
                    c.data[li].color = (min(1, r * edge_light), min(1, g * edge_light), min(1, b * edge_light), a)
                p.material_index = 0
        me.materials.clear()


def vertex_colour_material(name, emission=0.0):
    """Base colour from the face colours (as the game's material); emission for lights"""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.75
    if emission > 0:
        nt.links.new(vc.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = emission
    return mat


def bake_ambient_occlusion(objs, strength=0.6, distance=1.6, samples=96):
    """darken corners and crevices: Cycles AO into a second colour attribute, multiplied into Col"""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.device = 'CPU'
    if scene.world is None:
        scene.world = bpy.data.worlds.new('World')
    scene.world.light_settings.distance = distance
    scene.render.bake.target = 'VERTEX_COLORS'
    for o in objs:
        ao = o.data.color_attributes.new('AO', 'FLOAT_COLOR', 'CORNER')
        o.data.color_attributes.active_color = ao
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type='AO')
    for o in objs:
        c, ao = o.data.color_attributes['Col'], o.data.color_attributes['AO']
        for i in range(len(c.data)):
            a = ao.data[i].color[0]
            k = 1 - strength + strength * a
            r, g, b, _ = c.data[i].color
            c.data[i].color = (r * k, g * k, b * k, 1.0)
        o.data.color_attributes.remove(ao)
        o.data.color_attributes.active_color = o.data.color_attributes['Col']


def dirt(objs, amount=0.38, top=2.6, colour='erde'):
    """road dirt: colours drift towards a muddy brown the lower they sit (game height y = Blender z, world space)"""
    mud = shade(colour, 0.55)
    for o in objs:
        me, mw = o.data, o.matrix_world
        c = me.color_attributes['Col']
        for poly in me.polygons:
            for li in poly.loop_indices:
                z = (mw @ me.vertices[me.loops[li].vertex_index].co).z
                f = amount * max(0.0, min(1.0, 1 - z / top)) ** 1.5
                r, g, b, a = c.data[li].color
                c.data[li].color = (r + (mud[0] - r) * f, g + (mud[1] - g) * f, b + (mud[2] - b) * f, a)


def stripes(b, origin, u, v, length, width, n, colours=('signalGelb', 'schwarz'), slant=0.6):
    """hazard stripes on a flat surface: a band `length` along u and `width` along v (unit vectors in game
    space) from `origin`, cut into n slanted stripes of alternating colours, square at both ends"""
    o, u, v = Vector(origin), Vector(u), Vector(v)
    step = length / n
    off = min(slant * width, step * 0.9)
    for i in range(n):
        x0, x1 = i * step, (i + 1) * step
        tl = x0 + off if i > 0 else 0.0
        tr = min(x1 + off, length) if i < n - 1 else length
        b.poly([tuple(o + u * x0), tuple(o + u * x1), tuple(o + u * tr + v * width), tuple(o + u * tl + v * width)], colours[i % 2])


def safe_names():
    """three.js drops '.', ':', '/' and brackets from node names when it loads a glTF: use '_' instead"""
    for o in bpy.data.objects:
        o.name = re.sub(r'[.:/\[\]]', '_', o.name)


def glow_point(name, collection, pos, colour, size, parent=None):
    """an empty the game turns into one of its glow sprites (colour and size as custom properties)"""
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.3
    e.location = to_blender(pos)
    e['glow'] = colour
    e['size'] = size
    collection.objects.link(e)
    if parent is not None:
        e.parent = parent
    return e
