"""Renders a test player body from a 3D model as pixel-art source images.

Usage: blender -b -P tools/art3d/render_body.py -- <out-dir>

Builds a kid from scratch (no downloaded meshes): soft metaball limbs with shoulders, biceps,
triceps, elbows, forearms, hands with fingers and a thumb, knees, calves and ankle bones; a jersey
with side panels and trims; shorts with side stripes and hems; crew socks; and sneakers with a
midsole, outsole, toe cap, heel counter, padded collar, tongue, laces and a side stripe. It poses
the kid with a joint hierarchy and renders every pose for three layers - bald (the body), hair, and
cap (with flattened hat hair under it) - at 4x size with no anti-aliasing:
  <pose>_<layer>_id.png     flat colours, one per part (which part each pixel is)
  <pose>_<layer>_tone.png   grey with studio light and cavity (creases darker, ridges lighter)
  <pose>_<layer>_light.png  grey lit by one sun with cast shadows (the main light and shadow shapes)
  <pose>_<layer>_obj.png    a colour per object (where one limb overlaps another)
  <pose>_<layer>_depth.png  distance from the camera, 16-bit (which of two overlapping limbs is in front)
plus poses.json with where the feet, the shooting hand and the face land in each image.
tools/art3d/pixelize.py turns these into the indexed-palette sprite sheet.
"""
import json, math, os, sys
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Euler, Vector

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "/tmp/art3d"
os.makedirs(OUT, exist_ok=True)

# Final sprite frame in art pixels, the supersampling factor, and art pixels per Blender unit.
# 51 px a unit makes the kid ~113 px tall: x4 on the court is ~450 court px, the current players' size.
FRAME_W, FRAME_H, SS, PX_PER_UNIT = 104, 160, 4, 51
# Proportions, fitted to the current players' art with tools/art3d/compare.py.
P = dict(
    elevation=12,  # degrees the camera looks down: the current art is drawn from nearly eye level
    head_long=1.08, head_wide=1.03,  # head stretch (long face and skull) and squeeze
    neck=0.49,  # chest to the base of the head
    shoulder_x=0.24, shoulder_z=0.36,  # narrower, lower (sloping) shoulders
    chest_w=0.205, belly_w=0.19, torso_d=0.13,  # jersey half-widths and depth
    shorts_r=0.085, pelvis_w=0.18,  # slimmer shorts
    shoe=(1.12, 1.14, 1.05),  # sneaker scale
    upper_arm=(0.043, 0.035), forearm=(0.034, 0.026),  # radius at the top and bottom of each
    thigh=(0.066, 0.046), shin=(0.046, 0.032), calf=0.05,
)
ELEVATION = P["elevation"]
CAM_DIST = 10
DEPTH_NEAR, DEPTH_FAR = CAM_DIST - 2, CAM_DIST + 2  # the depth pass maps this range to 0..1

# Flat colours that mark each part in the id pass (pixelize.py matches them back).
PARTS = {
    "skin": (1, 0, 0), "hair": (0, 1, 0), "jersey": (0, 0, 1), "team": (1, 1, 0), "shoes": (1, 0, 1),
    "socks": (0, 1, 1), "ball": (1, 0.5, 0), "line": (0.5, 0, 1), "cap": (0.5, 1, 0.5), "capteam": (1, 0.5, 1),
    "sole": (0, 0.5, 1),
}

scene = bpy.context.scene
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)

mats = {}
for name, col in PARTS.items():
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*col, 1)
    mats[name] = m


def empty(name, parent=None, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    scene.collection.objects.link(e)
    e.parent = parent
    e.location = loc
    return e


def mesh(kind, part, parent, loc=(0, 0, 0), scale=(1, 1, 1), rot=(0, 0, 0), bevel=0, **kw):
    add = {"sphere": bpy.ops.mesh.primitive_uv_sphere_add, "cyl": bpy.ops.mesh.primitive_cylinder_add,
           "cone": bpy.ops.mesh.primitive_cone_add, "cube": bpy.ops.mesh.primitive_cube_add,
           "torus": bpy.ops.mesh.primitive_torus_add}[kind]
    if kind == "sphere":
        kw.setdefault("segments", 24)
        kw.setdefault("ring_count", 12)
    if kind in ("cyl", "cone"):
        kw.setdefault("vertices", 20)
    add(**kw)
    o = bpy.context.active_object
    o.data.materials.append(mats[part])
    for p in o.data.polygons:
        p.use_smooth = True
    o.parent = parent
    o.location, o.scale = loc, scale
    o.rotation_euler = [math.radians(a) for a in rot]
    if bevel:
        b = o.modifiers.new("round", "BEVEL")
        b.width, b.segments = bevel, 3
    return o


def ball_(part, parent, loc, size, rot=(0, 0, 0)):
    """An ellipsoid mesh with these half-sizes."""
    return mesh("sphere", part, parent, loc=loc, scale=size, rot=rot, radius=1)


VIS = 0.575  # a lone metaball's surface sits at this fraction of its radius (threshold 0.6, stiffness 2)


def blob(name, part):
    """A metaball object: its elements melt together into one smooth surface, rebuilt from the
    joints for every pose by shape_blobs()."""
    data = bpy.data.metaballs.new(name)
    data.resolution = data.render_resolution = 0.01
    o = bpy.data.objects.new(name, data)
    scene.collection.objects.link(o)
    data.materials.append(mats[part])
    return o


def capsule(o, a, b, r):
    e = o.data.elements.new(type="CAPSULE")
    d = b - a
    e.co, e.radius, e.size_x = (a + b) / 2, r / VIS, max(0.001, d.length / 2)
    e.rotation = Vector((1, 0, 0)).rotation_difference(d.normalized())


def ellipsoid(o, c, size, rot, r=0.1):
    e = o.data.elements.new(type="ELLIPSOID")
    e.co, e.radius, e.rotation = c, r / VIS, rot
    e.size_x, e.size_y, e.size_z = (v / r for v in size)


# ---------- The body (facing -Y, feet on z = 0) ----------
root = empty("root")
pelvis = empty("pelvis", root, (0, 0, 0.84))
joints = {}
for side, x in (("R", -1), ("L", 1)):
    hip = empty("hip" + side, pelvis, (0.095 * x, 0, -0.12))
    knee = empty("knee" + side, hip, (0, 0, -0.32))
    ankle = empty("ankle" + side, knee, (0, 0, -0.3))
    ankle.scale = P["shoe"]
    joints["hip" + side], joints["knee" + side], joints["ankle" + side] = hip, knee, ankle
    # Shorts: a white stripe down the outside of each leg, and a white hem.
    ball_("jersey", hip, ((P["shorts_r"] - 0.005) * x, 0, -0.085), (0.012, 0.035, 0.085))
    mesh("torus", "jersey", hip, loc=(0, 0, -0.17), major_radius=P["shorts_r"] + 0.002, minor_radius=0.012)
    # Crew socks: ribbed top with two team-colour stripes.
    mesh("cyl", "socks", knee, loc=(0, 0, -0.215), radius=0.052, depth=0.17)
    mesh("torus", "socks", knee, loc=(0, 0, -0.13), major_radius=0.052, minor_radius=0.01)
    for z in (-0.155, -0.178):
        mesh("torus", "team", knee, loc=(0, 0, z), major_radius=0.053, minor_radius=0.0065)
    # Sneakers.
    mesh("cube", "sole", ankle, loc=(0, -0.045, -0.072), scale=(0.082, 0.165, 0.024), bevel=0.02)  # midsole
    mesh("cube", "shoes", ankle, loc=(0, -0.045, -0.098), scale=(0.08, 0.162, 0.006), bevel=0.005)  # outsole
    ball_("shoes", ankle, (0, -0.035, -0.025), (0.078, 0.14, 0.062))  # upper
    ball_("shoes", ankle, (0, -0.13, -0.045), (0.072, 0.07, 0.042))  # toe box
    ball_("sole", ankle, (0, -0.17, -0.055), (0.07, 0.045, 0.028))  # rubber toe cap
    ball_("shoes", ankle, (0, 0.07, -0.03), (0.076, 0.055, 0.055))  # heel counter
    mesh("torus", "shoes", ankle, loc=(0, 0.015, 0.03), rot=(-10, 0, 0), major_radius=0.062, minor_radius=0.02)  # padded collar
    mesh("cube", "shoes", ankle, loc=(0, -0.055, 0.045), rot=(-25, 0, 0), scale=(0.035, 0.01, 0.05), bevel=0.008)  # tongue
    for y, z in ((-0.02, 0.05), (-0.055, 0.046), (-0.09, 0.038)):  # laces, sitting on top of the upper
        mesh("cube", "sole", ankle, loc=(0, y, z), rot=(-25, 0, 0), scale=(0.04, 0.01, 0.007))
    for sx in (-1, 1):  # side stripe in the team colour, standing proud of the upper
        ball_("team", ankle, (0.081 * sx, -0.05, -0.03), (0.009, 0.09, 0.022), rot=(18, 0, 0))

chest = empty("chest", pelvis, (0, 0, 0.08))
# Jersey: V-neck trim and side panels in the team colour.
mesh("torus", "team", chest, loc=(0, -0.035, 0.43), rot=(-25, 0, 0), scale=(1, 0.8, 1), major_radius=0.085, minor_radius=0.018)
for x in (-1, 1):
    ball_("team", chest, ((P["chest_w"] - 0.006) * x, 0, 0.2), (0.014, 0.06, 0.17))
neck = empty("neck", chest, (0, 0, P["neck"]))
head = empty("head", neck, (0, 0, 0.04))
HX, HZ = P["head_wide"], P["head_long"]
head.scale = (HX, HX, HZ)  # stretches every head part; metaball sizes are stretched in shape_blobs
for x in (-1, 1):  # ears, tilted back a little, with an inner fold
    ball_("skin", head, (0.215 * x, 0.03, 0.19), (0.03, 0.05, 0.068), rot=(-12, 0, 0))
    ball_("skin", head, (0.232 * x, 0.025, 0.19), (0.01, 0.028, 0.04), rot=(-12, 0, 0))
ball_("skin", head, (0, -0.235, 0.15), (0.018, 0.02, 0.028), rot=(15, 0, 0))  # nose (small: a big one casts a shadow like a moustache)

# Hat hair (worn under the cap): a head-shaped cap with the face cut away, and sideburns.
hair = mesh("sphere", "hair", head, loc=(0, 0.04, 0.27), scale=(0.95, 1.07, 0.98), radius=0.255)
cut = mesh("cube", "hair", head, loc=(0, -0.3, 0.1), rot=(-24, 0, 0), scale=(0.45, 0.2, 0.2))
cut.hide_render = True
cut.display_type = "WIRE"
b = hair.modifiers.new("face", "BOOLEAN")
b.operation, b.object = "DIFFERENCE", cut
sideburns = [ball_("hair", head, (0.2 * x, -0.06, 0.19), (0.03, 0.045, 0.065)) for x in (-1, 1)]
# The full hair: a close-cut shell (a metaball, built in shape_blobs) and flattened pointed locks on
# top of it - a fringe falling over the forehead, tufts on top sweeping forward and out, and a
# tidier back - so the outline is jagged, not a round cloud.
HAIR_CLUMPS = [  # head-local centre, size, tilt (forward, sideways) in degrees
    ((0, 0.05, 0.3), (0.232, 0.255, 0.215), (0, 0)),  # the shell, clear of the face
    ((0, 0.16, 0.2), (0.19, 0.11, 0.15), (20, 0)),  # back, down to the nape
    ((0, -0.13, 0.37), (0.2, 0.085, 0.065), (-10, 0)),  # the bangs over the forehead
    ((-0.2, -0.06, 0.2), (0.03, 0.045, 0.07), (0, 0)), ((0.2, -0.06, 0.2), (0.03, 0.045, 0.07), (0, 0)),  # sideburns
]
LOCKS = [  # head-local base, direction (head-local), base radius, length: tapered tufts grown out of the shell
    # fringe: short points along the lower edge of the bangs
    *[((x, -0.185, 0.335), (x * 0.6, -0.25, -0.95), 0.03, l) for x, l in ((-0.13, 0.05), (-0.06, 0.07), (0.01, 0.055), (0.08, 0.065), (0.14, 0.045))],
    # top front: mostly up, leaning forward and out, uneven lengths
    *[((x, -0.09, 0.47), (x * 2.2, -0.35, 0.85), 0.04, l) for x, l in ((-0.16, 0.12), (-0.08, 0.16), (0.0, 0.13), (0.08, 0.17), (0.16, 0.11))],
    # crown: up and out
    *[((x, 0.05, 0.5), (x * 2.5, 0.15, 0.95), 0.04, l) for x, l in ((-0.13, 0.1), (-0.045, 0.14), (0.045, 0.11), (0.13, 0.12))],
    # back: two rows of points sweeping back and out, so the back of the head isn't a smooth dome
    *[((x, 0.15, 0.46), (x * 2.4, 0.75, -0.35), 0.045, l) for x, l in ((-0.14, 0.12), (-0.05, 0.14), (0.05, 0.13), (0.14, 0.11))],
    *[((x, 0.23, 0.34), (x * 2.0, 0.7, -0.6), 0.042, l) for x, l in ((-0.12, 0.1), (-0.035, 0.12), (0.045, 0.11), (0.13, 0.09))],
    # over the ears
    *[((0.2 * x, y, 0.32), (0.75 * x, 0.1, -0.65), 0.035, 0.08) for x in (-1, 1) for y in (-0.04, 0.06)],
]
spikes = []  # (all hair is in the metaball now)

# The cap (its own layer): crown with a panel seam, peak and button in the team colour.
cap = [
    mesh("sphere", "cap", head, loc=(0, 0.03, 0.33), scale=(1.0, 1.12, 0.84), radius=0.255),
    mesh("cyl", "capteam", head, loc=(0, -0.24, 0.35), rot=(-12, 0, 0), scale=(1.0, 1.3, 1), radius=0.15, depth=0.025),
    mesh("sphere", "capteam", head, loc=(0, 0.025, 0.57), radius=0.03),
    mesh("torus", "capteam", head, loc=(0, 0.03, 0.34), rot=(0, 90, 0), scale=(0.92, 1.12, 1.0), major_radius=0.25, minor_radius=0.006),
]

for side, x in (("R", -1), ("L", 1)):
    sh = empty("shoulder" + side, chest, (P["shoulder_x"] * x, 0, P["shoulder_z"]))
    mesh("torus", "team", sh, loc=(-0.05 * x, 0, -0.01), rot=(0, 90, 0), scale=(1, 0.95, 1.2), major_radius=0.066, minor_radius=0.011)  # armhole trim
    el = empty("elbow" + side, sh, (0, 0, -0.27))
    hand = empty("hand" + side, el, (0, 0, -0.26))
    joints["shoulder" + side], joints["elbow" + side], joints["hand" + side] = sh, el, hand
# A wristband on the shooting arm.
mesh("torus", "team", joints["elbowR"], loc=(0, 0, -0.205), major_radius=0.04, minor_radius=0.017)

# Soft bodies, one metaball object per limb so limbs don't melt into each other.
BLOBS = {k: blob(k, part) for k, part in [
    ("headskin", "skin"), ("armR", "skin"), ("armL", "skin"), ("legR", "skin"), ("legL", "skin"),
    ("shirt", "jersey"), ("shorts", "team"), ("hairclumps", "hair"),
]}


def taper(o, points, radii, steps=4):
    """A smooth tube through these points, its radius changing evenly from one to the next (short
    overlapping capsules, so there are no bulges at the joints)."""
    for (a, ra), (b, rb) in zip(zip(points, radii), zip(points[1:], radii[1:])):
        for i in range(steps):
            t0, t1 = i / steps, (i + 1) / steps
            capsule(o, a.lerp(b, t0), a.lerp(b, t1), ra + (rb - ra) * (t0 + t1) / 2)


def shape_blobs(grip):
    """Rebuilds every metaball from where the joints are in this pose. grip: how far the fingers curl
    (0 open, 1 wrapped round the ball)."""
    for o in BLOBS.values():
        o.data.elements.clear()
    W = lambda j, local=(0, 0, 0): J[j].matrix_world @ Vector(local)
    Q = lambda j: J[j].matrix_world.to_quaternion()
    h = BLOBS["headskin"]
    hs = lambda size: (size[0] * HX, size[1] * HX, size[2] * HZ)
    # A kid's head, not a ball: a cranium longer than it is wide, a flatter face plane, a brow,
    # cheekbones, a jaw that tapers to a small chin, and the back of the skull above the nape.
    ellipsoid(h, W("head", (0, 0.03, 0.27)), hs((0.212, 0.232, 0.215)), Q("head"))  # cranium
    ellipsoid(h, W("head", (0, -0.085, 0.17)), hs((0.18, 0.152, 0.16)), Q("head"))  # face
    ellipsoid(h, W("head", (0, -0.17, 0.255)), hs((0.13, 0.04, 0.026)), Q("head"))  # brow
    for x in (-1, 1):
        ellipsoid(h, W("head", (0.115 * x, -0.13, 0.16)), hs((0.05, 0.04, 0.04)), Q("head"))  # cheekbone
        capsule(h, W("head", (0.14 * x, 0.0, 0.125)), W("head", (0.055 * x, -0.15, 0.05)), 0.038)  # jaw
    ellipsoid(h, W("head", (0, -0.175, 0.045)), hs((0.062, 0.048, 0.045)), Q("head"))  # chin
    ellipsoid(h, W("head", (0, 0.13, 0.19)), hs((0.16, 0.1, 0.14)), Q("head"))  # back of the skull
    capsule(h, W("chest", (0, 0, 0.4)), W("head", (0, 0.02, 0.08)), 0.05)  # neck
    for s, x in (("R", -1), ("L", 1)):
        a = BLOBS["arm" + s]
        S, E, H = W("shoulder" + s), W("elbow" + s), W("hand" + s)
        ellipsoid(a, W("shoulder" + s, (0.006 * x, 0, -0.012)), (0.056, 0.054, 0.06), Q("shoulder" + s))  # rounded shoulder
        wrist = W("elbow" + s, (0, 0, -0.22))
        taper(a, [S, E], P["upper_arm"])
        taper(a, [E, wrist, H], (P["forearm"][0], P["forearm"][1], P["forearm"][1]))
        # Hand: a flat palm, four fingers and a thumb. The palm faces the body (inward = -x for the left).
        px = -x
        q = Q("hand" + s)
        # (a bit big on purpose: hands are only a few pixels across)
        ellipsoid(a, W("hand" + s, (0, 0, -0.06)), (0.03, 0.056, 0.05), q)
        for fy, length in ((-0.03, 0.045), (-0.01, 0.052), (0.011, 0.049), (0.03, 0.04)):
            base = W("hand" + s, (0, fy * 1.2, -0.1))
            tip = W("hand" + s, (px * grip * 0.05, fy * 1.35, -0.1 - 1.2 * length * (1 - 0.5 * grip)))
            capsule(a, base, tip, 0.0145)
        capsule(a, W("hand" + s, (px * 0.018, -0.042, -0.04)), W("hand" + s, (px * (0.025 + 0.025 * grip), -0.075, -0.095)), 0.017)
        l = BLOBS["leg" + s]
        Hp, K, A = W("hip" + s), W("knee" + s), W("ankle" + s)
        calf = W("knee" + s, (0, 0.012, -0.1))
        taper(l, [Hp, K], P["thigh"])
        taper(l, [K, calf, A], (P["shin"][0], P["calf"], P["shin"][1]))
    hc = BLOBS["hairclumps"]
    for c, size, (fwd, side) in HAIR_CLUMPS:
        tilt = Euler((math.radians(fwd), math.radians(side), 0)).to_quaternion()
        ellipsoid(hc, W("head", c), (size[0] * HX, size[1] * HX, size[2] * HZ), Q("head") @ tilt)
    for base, d, r, length in LOCKS:  # each tuft: three capsules getting thinner towards a point
        b, d = Vector(base), Vector(d).normalized()
        for k, (t0, t1, rk) in enumerate(((0, 0.45, 1.0), (0.4, 0.75, 0.6), (0.7, 1.0, 0.25))):
            capsule(hc, W("head", b + d * length * t0), W("head", b + d * length * t1), r * rk)
    t = BLOBS["shirt"]
    ellipsoid(t, W("chest", (0, 0.005, 0.27)), (P["chest_w"], P["torso_d"], 0.19), Q("chest"))
    ellipsoid(t, W("chest", (0, 0, 0.08)), (P["belly_w"], P["torso_d"] - 0.005, 0.17), Q("chest"))
    ellipsoid(t, W("chest", (0.06, -0.12, 0.12)), (0.06, 0.03, 0.08), Q("chest"))  # a fold
    ellipsoid(t, W("pelvis", (0, 0, 0.0)), (P["belly_w"] - 0.003, P["torso_d"] - 0.005, 0.1), Q("pelvis"))  # hem over the shorts
    sh_ = BLOBS["shorts"]
    ellipsoid(sh_, W("pelvis", (0, 0, -0.05)), (P["pelvis_w"], P["torso_d"], 0.13), Q("pelvis"))
    for s in ("R", "L"):
        capsule(sh_, W("hip" + s, (0, 0, -0.02)), W("hip" + s, (0, 0, -0.16)), P["shorts_r"])


ball = empty("ball", root)
mesh("sphere", "ball", ball, radius=0.17, segments=32, ring_count=16)
for rot in ((90, 0, 20), (0, 90, 20), (0, 0, 0)):
    mesh("torus", "line", ball, major_radius=0.171, minor_radius=0.013, rot=rot)

J = {"pelvis": pelvis, "chest": chest, "neck": neck, "head": head, **joints}

# ---------- Poses: joint rotations in degrees, where the root and ball are, and the grip ----------
IDLE = dict(
    facing=-14, root=(0, 0, 0), ball=(0.02, -0.26, 0.8), grip=0.9,
    shoulderR=(-12, -10, 0), elbowR=(-55, 0, 16), shoulderL=(-12, 10, 0), elbowL=(-55, 0, -16),
    hipR=(0, 4, 0), hipL=(0, -4, 0), neck=(-4, 0, 6),
)
POSES = {
    "idle0": IDLE,
    "idle1": {**IDLE, "root": (0, 0, -0.012), "chest": (3, 0, 0), "neck": (-8, 0, 6), "ball": (0.02, -0.26, 0.78)},
    # Release: back to the camera facing the hoop (up-left), in the air, shooting arm up.
    "rel0": dict(
        facing=205, root=(0, 0, 0.1), ball=None, grip=0.25,
        shoulderR=(-160, -30, 0), elbowR=(-30, 0, 0), handR=(-40, 0, 0), shoulderL=(-140, 35, 0), elbowL=(-50, 0, 0),
        hipR=(-10, 0, 0), kneeR=(18, 0, 0), ankleR=(25, 0, 0), hipL=(-4, 0, 0), kneeL=(12, 0, 0), ankleL=(25, 0, 0),
        neck=(12, 0, 0),
    ),
    "rel1": dict(
        facing=205, root=(0, 0, 0), ball=None, grip=0.45,
        shoulderR=(-150, -28, 0), elbowR=(-5, 0, 0), handR=(-75, 0, 0), shoulderL=(-30, -30, 0), elbowL=(-25, 0, 0),
        hipR=(-14, 0, 0), kneeR=(24, 0, 0), hipL=(-6, 0, 0), kneeL=(16, 0, 0),
        pelvis=(0, 0, 0), chest=(-4, 0, 0), neck=(10, 0, 0),
    ),
}

# ---------- Camera and render settings ----------
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = FRAME_H / PX_PER_UNIT
cam_data.clip_end = 50
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
el = math.radians(ELEVATION)
centre = Vector((0, 0, FRAME_H / PX_PER_UNIT * 0.5 - 0.3))
cam.location = centre + Vector((0, -math.cos(el), math.sin(el))) * CAM_DIST
cam.rotation_euler = (math.radians(90 - ELEVATION), 0, 0)
scene.render.resolution_x, scene.render.resolution_y = FRAME_W * SS, FRAME_H * SS
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.display.render_aa = "OFF"
scene.view_settings.look = "None"
sh = scene.display.shading
sh.show_object_outline = False
sh.show_cavity = False
sh.show_specular_highlight = False
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"

# The depth pass: every surface glows with its distance from the camera (EEVEE, one sample, no filter).
depth_mat = bpy.data.materials.new("depth")
depth_mat.use_nodes = True
nt = depth_mat.node_tree
nt.nodes.clear()
camdata = nt.nodes.new("ShaderNodeCameraData")
rng = nt.nodes.new("ShaderNodeMapRange")
rng.inputs["From Min"].default_value, rng.inputs["From Max"].default_value = DEPTH_NEAR, DEPTH_FAR
emit = nt.nodes.new("ShaderNodeEmission")
outn = nt.nodes.new("ShaderNodeOutputMaterial")
nt.links.new(camdata.outputs["View Z Depth"], rng.inputs["Value"])
nt.links.new(rng.outputs["Result"], emit.inputs["Color"])
nt.links.new(emit.outputs["Emission"], outn.inputs["Surface"])


def apply_pose(p):
    for j in J.values():
        j.rotation_euler = (0, 0, 0)
    root.rotation_euler = (0, 0, math.radians(p["facing"]))
    root.location = p["root"]
    for name, rot in p.items():
        if name in J:
            J[name].rotation_euler = [math.radians(a) for a in rot]
    for c in ball.children:
        c.hide_render = p["ball"] is None
    if p["ball"]:
        ball.location = p["ball"]


# The light pass: plain matte grey lit by one sun from the upper left and front, with cast shadows,
# the way a pixel artist lights a sprite (clear light and shadow shapes rather than soft studio light).
light_mat = bpy.data.materials.new("matte")
light_mat.use_nodes = True
bsdf = light_mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.8, 0.8, 0.8, 1)
bsdf.inputs["Roughness"].default_value = 1.0
bsdf.inputs["Specular IOR Level"].default_value = 0.0
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
scene.collection.objects.link(sun)
sun.data.energy = 1.7
sun.data.angle = math.radians(2)
sun.rotation_euler = Vector((0.55, 0.5, -0.67)).to_track_quat("-Z", "Y").to_euler()
world = bpy.data.worlds.new("world")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.1, 0.1, 0.11, 1)
scene.world = world


def render(path, kind):
    s = scene.render.image_settings
    if kind == "light":
        scene.render.engine = "BLENDER_EEVEE"
        scene.eevee.taa_render_samples = 1
        scene.render.filter_size = 0
        scene.view_settings.view_transform = "Standard"
        scene.view_layers[0].material_override = light_mat
        s.color_mode, s.color_depth = "RGBA", "8"
    elif kind == "depth":
        scene.render.engine = "BLENDER_EEVEE"
        scene.eevee.taa_render_samples = 1
        scene.render.filter_size = 0
        scene.view_settings.view_transform = "Raw"
        scene.view_layers[0].material_override = depth_mat
        s.color_mode, s.color_depth = "BW", "16"
    else:
        s.color_mode = "RGBA"
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.view_settings.view_transform = "Standard"
        scene.view_layers[0].material_override = None
        s.color_depth = "8"
        sh.light = "STUDIO" if kind == "tone" else "FLAT"
        sh.color_type = {"id": "MATERIAL", "tone": "SINGLE", "obj": "RANDOM"}[kind]
        sh.single_color = (0.8, 0.8, 0.8)
        sh.show_shadows = kind == "tone"
        sh.shadow_intensity = 0.6
        # Cavity: creases go darker and ridges lighter (between fingers, shoe panels, sock ribs, folds).
        sh.show_cavity = kind == "tone"
        sh.cavity_type = "BOTH"
        sh.curvature_ridge_factor, sh.curvature_valley_factor = 1.5, 2.0
        sh.cavity_ridge_factor, sh.cavity_valley_factor = 1.0, 1.5
        scene.display.matcap_ssao_distance = 0.08
        scene.display.matcap_ssao_attenuation = 1.0
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


meta = {"frame": [FRAME_W, FRAME_H], "ss": SS, "parts": PARTS, "depth": [DEPTH_NEAR, DEPTH_FAR], "poses": {}}
for name, pose in POSES.items():
    apply_pose(pose)
    bpy.context.view_layer.update()
    shape_blobs(pose["grip"])
    # Three layers: the body with no hair, the hair, and the cap (with the hat hair under it).
    for variant in ("bald", "hair", "cap"):
        for c in cap:
            c.hide_render = variant != "cap"
        for c in (*spikes, BLOBS["hairclumps"]):  # the full hair
            c.hide_render = variant != "hair"
        for c in (hair, *sideburns):  # hat hair, flattened under the cap
            c.hide_render = variant != "cap"
        for kind in ("id", "tone", "light", "obj", "depth"):
            render(os.path.join(OUT, f"{name}_{variant}_{kind}.png"), kind)
    o = world_to_camera_view(scene, cam, Vector((0, 0, 0)))
    meta["poses"][name] = {"feet": [o.x * FRAME_W, (1 - o.y) * FRAME_H]}
    # where the ball leaves the hand (top of the shooting hand), for releaseOffset
    hp = world_to_camera_view(scene, cam, J["handR"].matrix_world @ Vector((0, 0, -0.08)))
    meta["poses"][name]["hand"] = [hp.x * FRAME_W, (1 - hp.y) * FRAME_H]
    # Where the face is and which way it looks, for the face pixelize.py paints on.
    fp = world_to_camera_view(scene, cam, J["head"].matrix_world @ Vector((0, -0.24, 0.2)))
    fwd = J["head"].matrix_world.to_quaternion() @ Vector((0, -1, 0))
    meta["poses"][name]["face"] = [fp.x * FRAME_W, (1 - fp.y) * FRAME_H]
    meta["poses"][name]["facing"] = -fwd.y  # towards the camera: 1 straight on, below 0 turned away
    meta["poses"][name]["yaw"] = fwd.x  # below 0: looking to the left of the screen

with open(os.path.join(OUT, "poses.json"), "w") as f:
    json.dump(meta, f, indent=1)
print("rendered", len(POSES), "poses to", OUT)
