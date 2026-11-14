"""Renders an isometric scene's panels from Blender as data, for iso_bake.py to turn into pixel art.

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/pixelart/iso_blender.py -- SCENE.json OUT_DIR

SCENE.json (see art/iso/trial-corner/scene.json) lists low-poly shapes in game metres (u along the hoop wall,
v out from it, z up; Blender's x, y, z), each with a panel and a material. The camera is orthographic and
pixel-exact: it looks down 30 degrees from the front corner, so the floor's lines are exactly 2:1, and 1 m
along the floor is `artPerM` art pixels across (two across for one down). The back corner of the floor
lands on the pixel corner `origin`.

For each panel it renders, with only that panel's shapes showing (so what's behind a prop is still there),
one sample per pixel at the pixel's middle, no anti-aliasing:
  pos    where each pixel is, in game metres
  nrm    which way the surface faces (a unit vector)
  id     which shape it is (its index in the list, plus one; 0 is empty)
and saves them as OUT_DIR/<panel>.npz (arrays pos, nrm, id, alpha), plus OUT_DIR/camera.json.
A prop's scene ("prop": true) is rendered once per way it can stand (iso_scene.py). Shapes of kind "ball" are
left out: the bake draws them with the game's ball sprite.
"""
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Euler, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from iso_scene import expand_prop  # noqa: E402

ELEVATION = 30.0  # degrees down: tan of the floor lines' slope is sin(30) = 0.5, so 2:1


def args():
    a = sys.argv[sys.argv.index("--") + 1:]
    return Path(a[0]), Path(a[1])


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)


def mesh_object(name, verts, faces, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata([Vector(v) for v in verts], [], faces)
    me.update()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def make_shape(s, i):
    name = f"{i:03d}-{s.get('name', s['shape'])}"
    if s["shape"] == "poly":  # a flat polygon, points in order
        ob = mesh_object(name, s["points"], [list(range(len(s["points"])))])
    elif s["shape"] == "box":
        (x0, y0, z0), (x1, y1, z1) = s["min"], s["max"]
        v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        if s.get("rot"):  # a turned prop (iso_scene.py rot-<deg>): about its foot
            c, sn = math.cos(math.radians(s["rot"])), math.sin(math.radians(s["rot"]))
            v = [(x * c - y * sn, x * sn + y * c, z) for x, y, z in v]
        f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        ob = mesh_object(name, v, f)
    elif s["shape"] == "sphere":
        cx, cy, cz = s["centre"]
        r = s["r"]
        seg, rings = s.get("segments", 12), s.get("rings", 8)
        v = [(cx, cy, cz - r)]
        for j in range(1, rings):
            t = math.pi * j / rings - math.pi / 2
            for k in range(seg):
                p = 2 * math.pi * k / seg
                v.append((cx + r * math.cos(t) * math.cos(p), cy + r * math.cos(t) * math.sin(p), cz + r * math.sin(t)))
        v.append((cx, cy, cz + r))
        f = []
        for k in range(seg):
            f.append((0, 1 + (k + 1) % seg, 1 + k))
        for j in range(rings - 2):
            a, b = 1 + j * seg, 1 + (j + 1) * seg
            for k in range(seg):
                f.append((a + k, a + (k + 1) % seg, b + (k + 1) % seg, b + k))
        top = len(v) - 1
        last = 1 + (rings - 2) * seg
        for k in range(seg):
            f.append((last + k, last + (k + 1) % seg, top))
        ob = mesh_object(name, v, f, smooth=True)
    elif s["shape"] in ("ring", "net"):
        # ring: a rim, a short upright band (r_out, r_in, h). net: an open cone hanging from r at z down `drop` to
        # r_bottom. Both round a centre, over the angles `arc` (degrees from +u towards +v; default all the way)
        cx, cy, cz = s["centre"]
        a0, a1 = s.get("arc", [0, 360])
        seg = s.get("segments", 32)
        n = max(2, int(round(seg * (a1 - a0) / 360)) + 1)
        angs = [math.radians(a0 + (a1 - a0) * j / (n - 1)) for j in range(n)]
        closed = (a1 - a0) >= 360
        if closed:
            angs = angs[:-1]
            n -= 1
        if s["shape"] == "ring":
            ro, ri, hh = s["r_out"], s["r_in"], s["h"]
            rings = [(ro, cz), (ro, cz + hh), (ri, cz + hh), (ri, cz)]
        else:
            rings = [(s["r"], cz), (s["r_bottom"], cz - s["drop"])]
        # `axis` (ring only): the way the band points. "z" lies flat (a rim); "y" or "x" stands it up facing out from
        # the hoop wall or the side wall (a clock: r_in 0 fills its face)
        ax = s.get("axis", "z")

        def at(r, z, a):
            p, q, h = r * math.cos(a), r * math.sin(a), z - cz
            return {"z": (cx + p, cy + q, cz + h), "y": (cx + p, cy + h, cz + q), "x": (cx + h, cy + p, cz + q)}[ax]
        v = [at(r, z, a) for r, z in rings for a in angs]
        f = []
        nr = len(rings)
        loops = nr if s["shape"] == "ring" else nr - 1
        for j in range(loops):
            jb = (j + 1) % nr
            for k in range(n if closed else n - 1):
                k2 = (k + 1) % n
                f.append((j * n + k, j * n + k2, jb * n + k2, jb * n + k))
        ob = mesh_object(name, v, f, smooth=ax == "z")  # standing up (a clock face) it's flat, so its face reads flat
    else:
        raise ValueError(s["shape"])
    ob.pass_index = i + 1
    return ob


def emission_material(kind):
    m = bpy.data.materials.new(f"pass-{kind}")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    if kind == "id":
        info = nt.nodes.new("ShaderNodeObjectInfo")
        nt.links.new(info.outputs["Object Index"], em.inputs["Color"])
    else:
        # emission can't go below zero, so positions are stored plus 100 and normals as n / 2 + 0.5
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        ma = nt.nodes.new("ShaderNodeVectorMath")
        ma.operation = "MULTIPLY_ADD"
        nt.links.new(geo.outputs["Position" if kind == "pos" else "Normal"], ma.inputs[0])
        ma.inputs[1].default_value = (1, 1, 1) if kind == "pos" else (0.5, 0.5, 0.5)
        ma.inputs[2].default_value = (100, 100, 100) if kind == "pos" else (0.5, 0.5, 0.5)
        nt.links.new(ma.outputs[0], em.inputs["Color"])
    return m


def setup_camera(scene, sc):
    cw, ch = sc["canvas"]
    ox, oy = sc["origin"]
    s = sc["artPerM"] / math.cos(math.radians(45))  # art px per metre across the screen
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = max(cw, ch) / s
    cam_data.clip_start = 0.01
    cam_data.clip_end = 1000
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    rot = Euler((math.radians(90 - ELEVATION), 0, math.radians(135)), "XYZ")
    cam.rotation_euler = rot
    m = rot.to_matrix()
    right, up, back = m.col[0], m.col[1], m.col[2]
    # the world origin must land on pixel corner (ox, oy); the view's middle is pixel corner (cw/2, ch/2)
    target = Vector((0, 0, 0)) + right * ((cw / 2 - ox) / s) - up * ((ch / 2 - oy) / s)
    cam.location = target + back * 50
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = cw, ch
    scene.render.resolution_percentage = 100
    return {"artPerMAcross": s, "upArtPerM": s * math.cos(math.radians(ELEVATION)), "elevation": ELEVATION}


def render_pass(scene, mat, path):
    for ob in scene.objects:
        if ob.type == "MESH":
            ob.data.materials.clear()
            ob.data.materials.append(mat)
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(str(path))
    a = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)[::-1]
    bpy.data.images.remove(img)
    return a


def main():
    scene_path, out = args()
    out.mkdir(parents=True, exist_ok=True)
    sc = expand_prop(json.loads(scene_path.read_text()))
    clear()
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.cycles.use_denoising = False
    scene.cycles.filter_width = 0.01  # one sample at the middle of each pixel: no anti-aliasing
    scene.cycles.max_bounces = 0
    scene.cycles.device = "CPU"
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_depth = "32"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("w")
    cam = setup_camera(scene, sc)
    # balls are drawn by the bake with the game's own ball sprite, so Blender leaves them out
    objs = [make_shape(s, i) if s["shape"] != "ball" else None for i, s in enumerate(sc["shapes"])]
    mats = {k: emission_material(k) for k in ("pos", "nrm", "id")}
    for panel in sc["panels"]:
        for ob, s in zip(objs, sc["shapes"]):
            if ob is not None:
                ob.hide_render = s["panel"] != panel
        res = {k: render_pass(scene, mats[k], out / f"{panel}-{k}.exr") for k in mats}
        np.savez_compressed(out / f"{panel}.npz", pos=res["pos"][..., :3] - 100, nrm=res["nrm"][..., :3] * 2 - 1,
                            id=np.rint(res["id"][..., 0]).astype(np.int32), alpha=res["pos"][..., 3])
        for k in mats:
            (out / f"{panel}-{k}.exr").unlink()
    (out / "camera.json").write_text(json.dumps(cam))


main()
