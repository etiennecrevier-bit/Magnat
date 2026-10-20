"""Cuts the city's art out of the design reference (#209).

Usage: python3 cut_city.py <reference dir>   (cut.py runs it too)

The reference dir holds iso2.py, light.py and city-target.svg, from
docs/design/reference/ (#197). This script runs iso2.py's drawing one
top-level statement at a time, up to its sorting of the objects, without
writing its page or reading the board it was made for. Each line it draws is
filed under the call that drew it: the sky, the clouds, the island, each
building, the silo, the truck, each tree, lamp, cone and car. Each piece
becomes one SVG in city/ here: the target's own lines, the definitions they
use, and a viewBox on their box in the 1440 x 900 design, where the manifest
draws it (a piece's `art`).

The shadows the objects cast are one piece, the reference's group at its
opacity with its blur, so where two overlap they never darken twice. The
truck's serving hatch (its warm inside) and its awning are pieces of their
own, so who serves stands between them and the awning shows only while the
truck serves. The labels « Parc La Fontaine » and « AV. MONT-ROYAL » are on
the island, in Fredoka 600, which the game ships: the reference writes the
avenue in Nunito 800.

The three grocers' shops, which the reference does not have, are drawn by
iso2.py's own `box()`, as its café, their awning in the grocer's colour.

Left out: the grain, the mottle, the vignette and the warm glow (atmosphere.ts
draws them over the whole world); the three customers and the owner walking
with their shadows, whom the world draws in code; the trip's dashed way, which
the world draws for the day's trip; and the rent building's « À LOUER »
board, which the world draws, as « Fournil » once the bakery runs.

It checks that iso2.py still draws the target, that every line is in a piece
or left out on purpose, that the pieces' lines are the target's, and that the
manifest's boxes rank the objects in the reference's painter's order. It
prints the city's numbers for src/content/assets.json: each piece's box and
art, the doors, the routes, the line, the hatch and the van's stops, from the
reference's grid. Nothing in the build, the tests or the lint runs it; it is
kept to cut the art again.
"""

import ast
import base64
import json
import re
import sys
from pathlib import Path

from cut import FONT, NUMBER, bounds, exact_bounds, scoped, svg

HERE = Path(__file__).resolve().parent
DESIGN_WIDTH = 1440
# The sky's gradient stretches; above the design it keeps its top colour.
SKY_TOP = -2700
SKY_TOP_COLOR = "#a3cde2"
# The target was rendered with the trip's way in player blue.
ACCENT = "#2f6fb0"

# The calls of iso2.py that draw an object, and the tag of each call's lines:
# its name for a box, else the kind and how many of it were drawn so far.
DRAWN = {"box", "silo", "truck", "tree", "lamp", "cone", "car", "person"}

# Statements that set the tag of the ground lines drawn after them.
GROUND = [
    ('G(rect(0, 0, 1440, 900, "url(#sky)"))', "sky"),
    ("for cx, cy, s in", "clouds"),
    ("L0, F0, R0, B0 =", "island"),
]
CLOUD_LINES = 6

# The grocers' shops: iso2.py's café, at a place of its grid, its awning in
# the grocer's colour (the palette's). Each faces the avenue, or for the one
# south of it, the park.
SHOPS = [
    # (id, grocer, gx, gy, w, d, h, wall colour, awning)
    ("depanneur-24-24", "depanneur2424", 4.25, 2.6, 1.45, 1.75, 66, "#b4532f", "#2F6FB0"),
    ("chez-normand", "chezNormand", 10.6, 2.4, 1.1, 1.9, 62, "#c06a43", "#B3261E"),
    ("marche-bio-logique", "marcheBioLogique", 3.7, 7.2, 1.8, 1.5, 50, "#9e4a2c", "#2E7D4F"),
]
CAFE_AWNING = "#2e7d4f"


class Tagged(list):
    """A list that remembers the tag current when each item came."""

    def __init__(self, tag):
        super().__init__()
        self.tag = tag
        self.tags = []

    def append(self, item):
        super().append(item)
        self.tags.append(self.tag[0])


def run_iso2(reference):
    """Runs iso2.py up to its world, but its sorting, and the words, the
    way and the owner it draws over it. Returns its scope, where
    `ground_layer`, `shadow_layer` and `objects` know each item's tag, and
    `calls`, each object's call by its tag."""
    sys.path.insert(0, str(reference))
    source = (reference / "iso2.py").read_text()
    tree = ast.parse(source)
    scope = {"__file__": str(reference / "iso2.py"), "__name__": "iso2"}
    tag = ["preamble"]
    calls = {}

    def tagging(function, kind):
        count = [0]

        def call(*args, **kwargs):
            count[0] += 1
            name = args[0] if kind == "box" else kind if kind in ("silo", "truck") else f"{kind}-{count[0]}"
            calls[name] = (kind, args, kwargs)
            before = tag[0]
            tag[0] = name
            try:
                return function(*args, **kwargs)
            finally:
                tag[0] = before

        return call

    sorted_at = None
    for statement in tree.body:
        text = ast.get_source_segment(source, statement)
        if text.startswith("WORLD ="):
            break
        if text.startswith("objects.sort"):
            sorted_at = statement
            continue
        if sorted_at is not None and not text.startswith(("LABEL =", "PATH =", "AVATAR =")):
            raise SystemExit(f"iso2.py draws more after its sorting: {text[:40]}")
        for marker, name in GROUND:
            if text.startswith(marker):
                tag[0] = name
        exec(compile(ast.Module([statement], []), "iso2.py", "exec"), scope)
        for name in ("ground_layer", "shadow_layer", "objects"):
            if type(scope.get(name)) is list:
                scope[name] = Tagged(tag)
        if isinstance(statement, ast.FunctionDef) and statement.name in DRAWN:
            scope[statement.name] = tagging(scope[statement.name], statement.name)
    if sorted_at is None:
        raise SystemExit("iso2.py no longer sorts its objects")
    scope["calls"] = calls
    scope["tag"] = tag
    return scope


def target_parts(reference):
    """The target's definitions by id, and its world lines before the overlays."""
    text = (reference / "city-target.svg").read_text()
    end_of_defs = text.rindex("</defs>")
    defs = {}
    for match in re.finditer(
        r'<(linearGradient|radialGradient|pattern|filter)\b[^>]*\bid="([\w-]+)".*?</\1>',
        text[:end_of_defs],
        re.S,
    ):
        defs[match.group(2)] = match.group(0)
    lines = text[end_of_defs + 8 : text.rindex("</svg>")].split("\n")
    end = lines.index('<g pointer-events="none">')
    return defs, lines[:end]


def font_style():
    """Fredoka 600 for the island's labels: an image cannot reach the page's fonts."""
    data = base64.b64encode(FONT.read_bytes()).decode("ascii")
    return (
        "<style>@font-face{font-family:Fredoka;font-weight:600;"
        f"src:url(data:font/woff2;base64,{data}) format('woff2')}}</style>\n"
    )


def split(entries):
    """An object's lines: each item of iso2.py may hold several."""
    return [line for entry in entries for line in entry.split("\n")]


def rounded(value):
    return round(value, 1)


def main(reference):
    scope = run_iso2(reference)
    defs, target = target_parts(reference)
    ids = {i.removeprefix("vl-") for i in defs}
    sc = lambda line: scoped(line, ids, "vl")
    filters = {}
    for i, block in defs.items():
        blur = re.search(r'stdDeviation="(' + NUMBER + ')"', block)
        if blur:
            filters[i] = float(blur.group(1))
    iso, up, face_pt, quad = scope["iso"], scope["up"], scope["face_pt"], scope["quad"]
    if (scope["TW"], scope["TH"], scope["OX"], scope["OY"]) != (100, 50, 720, 170):
        raise SystemExit("iso2.py's grid moved: the manifest's boxes assume 100 x 50 from 720, 170")

    ground = list(zip(scope["ground_layer"].tags, scope["ground_layer"]))
    shadow = list(zip(scope["shadow_layer"].tags, scope["shadow_layer"]))
    objects = list(zip(scope["objects"].tags, scope["objects"]))

    # Nothing lost, nothing reordered: iso2.py drew the target's world.
    ordered = sorted(objects, key=lambda o: o[1][0])
    world = (
        [line for _, line in ground]
        + ['<g opacity="0.38" filter="url(#soft2)">']
        + [line for _, line in shadow]
        + ["</g>"]
        + [svg_text for _, (_, svg_text) in ordered]
        + [scope["LABEL"], scope["PATH"], scope["AVATAR"]]
    )
    drawn = sc("\n".join(world)).replace("{{accent}}", ACCENT).split("\n")
    if drawn != target:
        raise SystemExit("iso2.py no longer draws city-target.svg")
    tags = [t for t, _ in ground]
    clouds = tags.count("clouds")
    expected = ["sky"] * tags.count("sky") + ["clouds"] * clouds + ["island"] * tags.count("island")
    if tags != expected or clouds != 3 * CLOUD_LINES:
        raise SystemExit("the ground is no longer the sky, three clouds, then the island")
    people = {t for t, _ in objects if t.startswith("person-")}
    if len(people) != 3 or any(t.startswith("person-") and t not in people for t, _ in shadow):
        raise SystemExit("the reference no longer draws three customers")

    pieces = {}
    pieces["sky"] = [sc(line) for t, line in ground if t == "sky"]
    cloud_lines = [sc(line) for t, line in ground if t == "clouds"]
    for k in range(3):
        pieces[f"cloud-{k + 1}"] = cloud_lines[k * CLOUD_LINES : (k + 1) * CLOUD_LINES]
    label = sc(scope["LABEL"]).replace(
        'font-family="Nunito, sans-serif" font-size="12" font-weight="800"',
        'font-family="Fredoka, sans-serif" font-size="12" font-weight="600"',
    )
    if "Nunito" in label:
        raise SystemExit("the avenue's label is no longer in Nunito 800")
    pieces["island"] = [sc(line) for t, line in ground if t == "island"] + label.split("\n")
    cast = [sc(line) for t, line in shadow if not t.startswith("person-")]
    names = [t for t, _ in objects if not t.startswith("person-")]
    by_tag = {t: split([o[1]]) for t, o in objects}
    for name in names:
        pieces[name] = [sc(line) for line in by_tag[name]]

    # The rent building's board, which the world writes.
    rent = pieces["rent"]
    words = [i for i, line in enumerate(rent) if ">À LOUER</text>" in line]
    if len(words) != 1 or 'fill="#ffffff"' not in rent[words[0] - 2]:
        raise SystemExit("the rent building no longer draws its board, then « À LOUER »")
    pieces["rent"] = rent[: words[0] - 2] + rent[words[0] + 1 :]

    # The truck's hatch and its awning, out of its body.
    truck = pieces["truck"]
    if not ("url(#vl-warmInside)" in truck[4] and "#b3261e" in truck[6] and "url(#vl-faceV)" in truck[13]):
        raise SystemExit("the truck no longer draws its hatch, then its awning, on its body")
    pieces["truck-hatch"] = truck[4:6]
    pieces["truck-awning"] = truck[6:14]
    pieces["truck"] = truck[:4] + truck[14:]

    # The grocers' shops, as the café, recoloured; their shadows join the
    # others'.
    shop_calls = {}
    for shop_id, grocer, gx, gy, w, d, h, wall, awning in SHOPS:
        objects_before = len(scope["objects"])
        shadows_before = len(scope["shadow_layer"])
        scope["tag"][0] = shop_id
        scope["box"](shop_id, gx, gy, w, d, h, wall, "cafe")
        drawn_shop = scope["objects"][objects_before:]
        if len(drawn_shop) != 1:
            raise SystemExit(f"box() drew {shop_id} other than as one object")
        lines = [sc(line) for line in split([drawn_shop[0][1]])]
        if sum(CAFE_AWNING in line for line in lines) != 4:
            raise SystemExit("the café's awning is no longer four stripes of money green")
        pieces[shop_id] = [line.replace(CAFE_AWNING, awning.lower()) for line in lines]
        cast += [sc(line) for line in scope["shadow_layer"][shadows_before:]]
        shop_calls[shop_id] = ("box", (shop_id, gx, gy, w, d, h, wall, "cafe"), {})
    shops = [shop[0] for shop in SHOPS]

    written = {}
    top = f'<rect x="0" y="{SKY_TOP}" width="{DESIGN_WIDTH}" height="{-SKY_TOP}" fill="{SKY_TOP_COLOR}"></rect>'
    view = (0, SKY_TOP, DESIGN_WIDTH, 900 - SKY_TOP)
    written["sky"] = (view, svg([top] + pieces["sky"], defs, view, (8, 1800), stretch=True))
    art = {}
    clouds = [f"cloud-{k + 1}" for k in range(3)]
    for name in ["island"] + clouds + names + ["truck-hatch", "truck-awning"] + shops:
        x0, y0, x1, y1 = bounds(pieces[name], filters)
        view = (x0, y0, x1 - x0, y1 - y0)
        extra = font_style() if name == "island" else ""
        written[name] = (view, svg(pieces[name], defs, view, view[2:], extra))
        art[name] = view
    # The shadows, blurred as one group at its opacity.
    blur = 3 * filters["vl-soft2"]
    x0, y0, x1, y1 = exact_bounds(cast, filters)
    x0, y0, x1, y1 = int(x0 - blur) - 1, int(y0 - blur) - 1, int(x1 + blur) + 2, int(y1 + blur) + 2
    view = (x0, y0, x1 - x0, y1 - y0)
    group = ['<g opacity="0.38" filter="url(#vl-soft2)">'] + cast + ["</g>"]
    written["shadows"] = (view, svg(group, defs, view, view[2:]))
    art["shadows"] = view

    for name, (view, text) in written.items():
        path = HERE / "city" / f"{name}.svg"
        path.parent.mkdir(exist_ok=True)
        path.write_text(text)
        print(f"city/{name}.svg  x {view[0]}  y {view[1]}  width {view[2]}  height {view[3]}  {len(text)} bytes", file=sys.stderr)

    calls = dict(scope["calls"])
    calls.update(shop_calls)
    manifest = layout(scope, calls, names, art)
    check_order(scope, calls, names, manifest)
    print(json.dumps(manifest, ensure_ascii=False))


# ---------- the manifest's numbers ----------

# What each box of the reference is in the game.
ROLES = {
    "tri1": {"kind": "triplex", "color": "brickRed"},
    "tri2": {"kind": "triplex", "color": "brickDark"},
    "tri3": {"kind": "triplex", "color": "brickLight"},
    "tri4": {"kind": "triplex", "color": "brickDark"},
    "cafe": {"kind": "triplex", "color": "brickLight"},
    "bank": {"kind": "building", "color": "sidewalk", "opens": {"trip": "caisse"}, "place": "caisse"},
    "tri5": {"kind": "triplex", "color": "brickRed"},
    "rent": {"kind": "bakery", "color": "wood", "opens": "fournil", "place": "fournil"},
    "mill": {"kind": "mill", "color": "brickLight", "opens": {"trip": "meunerie"}, "place": "meunerie"},
    "permits": {"kind": "building", "color": "steel", "opens": {"trip": "bureauPermis"}, "place": "bureauPermis"},
    "silo": {"kind": "silo", "color": "steel", "opens": {"trip": "meunerie"}},
    "truck": {"kind": "truck", "color": "mustard", "trim": "dangerRed"},
}
SCENERY_COLORS = {"tree": "foliage", "lamp": "steel", "cone": "coneOrange"}
CAR_COLORS = ["playerBlue", "cream", "foliage"]
# How far out from its wall, in squares, someone stands at a door.
DOORSTEP = 0.05
# How wide a grocer's croissant sign is across its wall.
CONTRACT_SIGN = 18

# How far up each object reaches, from iso2.py's drawings: a box's roof is
# 2 over its walls; a tree's crown, a lamp's head and a cone's tip.
SCENERY = {"tree": (0.2, 57), "lamp": (0.12, 54), "cone": (0.14, 16)}


def box_of(gx, gy, w, d, h):
    """A box of the grid as the manifest gives it (see assets.json's _note)."""
    depth = 50 * w
    width = 50 * (w + d)
    x = 720 + 50 * (gx - gy - d)
    foot = 170 + 25 * (gx + w + gy + d)
    height = h + width / 2
    return {
        "x": rounded(x),
        "y": rounded(foot - height),
        "width": rounded(width),
        "height": rounded(height),
        "depth": rounded(depth),
    }


def grid_box(kind, args, kwargs):
    """The grid box (gx, gy, w, d, h) an object of iso2.py stands in."""
    if kind == "box":
        _, gx, gy, w, d, h = args[:6]
        return gx, gy, w, d, h + 2
    if kind == "silo":
        gx, gy, w, d, h = args
        return gx, gy, w, d, h
    if kind == "truck":
        gx, gy = args
        return gx, gy, 1.32, 0.62, 34
    if kind == "car":
        gx, gy = args[:2]
        along = args[3] if len(args) > 3 else kwargs.get("along", "gx")
        return (gx, gy, 0.8, 0.36, 20) if along == "gx" else (gx, gy, 0.36, 0.8, 20)
    gx, gy = args[:2]
    size = args[2] if len(args) > 2 else kwargs.get("size", 1.0)
    side, h = SCENERY[kind]
    h = h * (size if kind == "tree" else 1)
    return gx - side / 2, gy - side / 2, side, side, h


def point(p):
    return [rounded(p[0]), rounded(p[1])]


def wall_rect(a, b, f0, f1, z0, z1):
    """A piece on the lit wall from `a` to `b`, `f0` to `f1` across and `z0`
    to `z1` up: the top of its left edge, how wide across, how tall."""
    x, y = a[0] + (b[0] - a[0]) * f0, a[1] + (b[1] - a[1]) * f0 - z1
    return {"x": rounded(x), "y": rounded(y), "width": rounded((b[0] - a[0]) * (f1 - f0)), "height": rounded(z1 - z0)}


def layout(scope, calls, names, art):
    iso = scope["iso"]

    def lit_wall(name):
        """The lit wall of box `name`: its two corners on the ground, and how
        many window slots iso2.py puts across it."""
        _, gx, gy, w, d = calls[name][1][:5]
        return iso(gx, gy + d), iso(gx + w, gy + d), max(1, int(w * 2)), (gx, gy, w, d)

    def door(name):
        """The sidewalk at the door iso2.py draws in the first slot: a step
        out from the middle of its foot, so who stands there is in front of
        the wall."""
        gx, gy = door_grid(name)
        return iso(gx, gy + DOORSTEP)

    def door_grid(name):
        a, b, n, (gx, gy, w, d) = lit_wall(name)
        return gx + w * (0.22 / n + 0.72 / n) / 2, gy + d

    pieces = [
        {"id": "sky", "kind": "backdrop", "layer": "sky", "x": -DESIGN_WIDTH, "y": SKY_TOP, "width": 3 * DESIGN_WIDTH,
         "height": 900 - SKY_TOP, "color": "sky", "image": "city/sky.svg"},
    ]
    for k in range(3):
        x, y, w, h = art[f"cloud-{k + 1}"]
        pieces.append({"id": f"cloud-{k + 1}", "kind": "backdrop", "layer": "sky", "x": x, "y": y, "width": w,
                       "height": h, "color": "cream", "image": f"city/cloud-{k + 1}.svg"})
    island = box_of(0, 0, 12, 12, 0)
    pieces.append({"id": "island", "kind": "backdrop", "layer": "ground", **island, "art": rect(art["island"]),
                   "color": "sidewalk", "image": "city/island.svg"})
    x, y, w, h = art["shadows"]
    pieces.append({"id": "shadows", "kind": "shadows", "layer": "ground", "x": x, "y": y, "width": w, "height": h,
                   "color": "steel", "image": "city/shadows.svg"})

    def standing(name, role):
        kind, args, kwargs = calls[name]
        piece = {"id": name, **{"kind": role["kind"]}, "layer": "block", **box_of(*grid_box(kind, args, kwargs)),
                 "art": rect(art[name]), "color": role["color"]}
        for key in ("trim", "opens", "place", "grocer"):
            if key in role:
                piece[key] = role[key]
        piece["image"] = f"city/{name}.svg"
        return piece

    block = []
    cars = 0
    for name in names:
        kind = calls[name][0]
        if kind in ("box", "silo", "truck"):
            block.append(standing(name, ROLES[name]))
        elif kind == "car":
            block.append(standing(name, {"kind": "scenery", "color": CAR_COLORS[cars]}))
            cars += 1
        else:
            block.append(standing(name, {"kind": "scenery", "color": SCENERY_COLORS[kind]}))
        if name == "truck":
            block += truck_walls(scope, calls, art)
        if name == "rent":
            block += rent_walls(scope, calls)
    for shop_id, grocer, *_ in SHOPS:
        block.append(standing(shop_id, {"kind": "grocer", "color": "brickRed", "opens": "contracts", "grocer": grocer}))
        a, b, n, _ = lit_wall(shop_id)
        # The croissant sign over the awning, at the right of the wall.
        across = CONTRACT_SIGN / (b[0] - a[0])
        block.append({"id": f"{shop_id}-contract", "kind": "contractSign", "layer": "block", "on": shop_id,
                      **wall_rect(a, b, 0.86 - across, 0.86, 38, 54), "color": "mustard",
                      "shows": {"contract": grocer}})
    pieces += block

    # Who stands where, on the grid's sidewalks and crosswalks.
    g = lambda gx, gy: point(iso(gx, gy))
    gx0, gy0, w0, d0 = calls["truck"][1][0], calls["truck"][1][1], 1.0, 0.62
    hatch_a, hatch_b = iso(gx0, gy0 + d0), iso(gx0 + w0, gy0 + d0)
    window_foot = scope["face_pt"](hatch_a, hatch_b, 0.3, 12)
    step = ((hatch_b[0] - hatch_a[0]) * 0.2, (hatch_b[1] - hatch_a[1]) * 0.2)
    counter = g(3.7, 4.9)
    # The reference's way to the Caisse, from (720, 410) to (860, 480), then
    # to the door: its dot, at (927, 446), is not at the bank's door.
    if scope["PATH"].split('points="')[1].split('"')[0] != "720,410 860,480 927,446":
        raise SystemExit("the reference's way to the Caisse moved")
    east = [g(4.8, 4.8)]
    south = [g(5.7, 4.9), g(5.7, 6.2), g(7.45, 6.35)]
    routes = {
        "caisse": [counter, *east, [860, 480], point(door("bank"))],
        "meunerie": [counter, *east, *south, g(7.45, 8.7), g(door_grid("mill")[0], 8.7), point(door("mill"))],
        "bureauPermis": [counter, *east, *south, g(7.45, 11.6), g(door_grid("permits")[0], 11.6),
                         point(door("permits"))],
        "fournil": [counter, g(5.7, 4.9), g(5.7, 6.15), g(0.55, 6.15), g(0.55, 8.5), g(door_grid("rent")[0], 8.5),
                    point(door("rent"))],
    }
    # The van keeps to the avenue's south lane, east of the truck.
    lane = 5.72
    stops = {}
    for shop_id, grocer, gx, gy, w, d, *_ in SHOPS:
        stops[grocer] = g(min(max(gx + w / 2, 4.6), 11.4), lane)
    park = g(4.15, lane)
    people = {
        "truck": {
            "counter": counter,
            "window": {"first": point((window_foot[0], window_foot[1] + 40)), "step": point(step)},
            "line": {"first": [680, 380], "step": [20, 10], "max": 6, "minutes": 20},
        },
        "routes": routes,
        "deliveries": {
            "from": {"bakery": [park], "truck": [park]},
            "deliverers": {"first": {"bakery": g(3.3, 6.2), "truck": g(4.5, 6.2)}, "step": [12.5, 6.25]},
            "stops": stops,
        },
        "bakers": {"first": g(1.35, 8.5), "step": [12.5, 6.25]},
        "van": box_of(0, 0, 0.8, 0.36, 20),
    }
    return {"pieces": pieces, **people}


def rect(view):
    x, y, w, h = view
    return {"x": x, "y": y, "width": w, "height": h}


def truck_walls(scope, calls, art):
    """The hatch, its awning and its shutter, on the truck's body."""
    iso = scope["iso"]
    gx, gy = calls["truck"][1]
    a, b = iso(gx, gy + 0.62), iso(gx + 1.0, gy + 0.62)
    window = wall_rect(a, b, 0.1, 0.9, 12, 28)
    awning = wall_rect(a, b, 0.06, 0.94, 18, 30)
    return [
        {"id": "truck-hatch", "kind": "hatch", "layer": "block", "on": "truck", **window,
         "art": rect(art["truck-hatch"]), "color": "lamplight", "image": "city/truck-hatch.svg",
         "shows": "truckOpen"},
        {"id": "truck-awning", "kind": "awning", "layer": "block", "on": "truck", **awning,
         "art": rect(art["truck-awning"]), "color": "dangerRed", "image": "city/truck-awning.svg",
         "shows": "truckOpen"},
        {"id": "truck-shutter", "kind": "shutter", "layer": "block", "on": "truck", **window, "color": "steel",
         "shows": "truckClosed"},
    ]


def rent_walls(scope, calls):
    """The rent building's lit windows and its board, on its lit wall."""
    iso = scope["iso"]
    _, gx, gy, w, d, h = calls["rent"][1][:6]
    a, b = iso(gx, gy + d), iso(gx + w, gy + d)
    n = max(1, int(w * 2))
    walls = []
    # The panes iso2.py glazes, but the door in the first slot.
    for i in range(1, n):
        f0, f1 = (i + 0.22) / n, (i + 0.72) / n
        walls.append({"id": f"bakery-lamplight-{i}", "kind": "windows", "layer": "block", "on": "rent",
                      **wall_rect(a, b, f0 + 0.03 / n * 2, f1 - 0.03 / n * 2, 12, 28), "color": "lamplight",
                      "shows": "bakeryRuns"})
    board = wall_rect(a, b, 0.55, 0.85, 14, 30)
    walls.append({"id": "bakery-for-rent", "kind": "sign", "layer": "block", "on": "rent", **board, "color": "white",
                  "trim": "dangerRed", "text": "À louer", "shows": "bakeryForRent"})
    walls.append({"id": "bakery-sign", "kind": "sign", "layer": "block", "on": "rent", **board, "color": "white",
                  "trim": "ink", "text": "Fournil", "shows": "bakeryRuns"})
    return walls


def check_order(scope, calls, names, manifest):
    """The manifest's boxes, by the middle of their footprint as the world
    ranks them, keep the reference's painter's order where they overlap."""
    boxes = {p["id"]: p for p in manifest["pieces"] if p.get("layer") == "block" and "on" not in p}

    def middle(p):
        left = p["y"] + p["height"] - p["depth"] / 2
        right = p["y"] + p["height"] - (p["width"] - p["depth"]) / 2
        return (left + right) / 2

    keys = {}
    for t, (key, _) in zip(scope["objects"].tags, scope["objects"]):
        keys.setdefault(t, key)

    def overlap(a, b):
        a, b = boxes[a]["art"], boxes[b]["art"]
        return (a["x"] < b["x"] + b["width"] and b["x"] < a["x"] + a["width"]
                and a["y"] < b["y"] + b["height"] and b["y"] < a["y"] + a["height"])

    # Only the order of what overlaps on screen shows.
    for i, a in enumerate(names):
        for b in names[i + 1 :]:
            if overlap(a, b) and (keys[a] < keys[b]) != (middle(boxes[a]) < middle(boxes[b])):
                raise SystemExit(f"{a} and {b} no longer rank as the reference draws them")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]).resolve())
