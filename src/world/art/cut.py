"""Cuts the street's and the truck's art out of the design reference (#198, #199).

Usage: python3 cut.py <reference dir>

The reference dir holds rue.py, light.py, street-target.svg and
ui_concepts.py, from docs/design/reference/ (#197). This script runs rue.py's
drawing one top-level statement at a time, without writing its page, and
files each statement's lines under the piece they draw. Each piece becomes one SVG, in street/ or
truck/ here: the target's own lines, the definitions they use, and a viewBox
on their box in the 1440 x 900 design, so the manifest places it at that box.
The truck's lines are drawn in the target's group, moved to the truck's place.
The « MENU » chalkboard (#208) comes from concept B in ui_concepts.py instead,
in its own box.

Left out: the grain, the mottle, the vignette and the warm glow (atmosphere.ts
draws them over the whole world); the people and the owner, whom the world
draws in code; the truck's name and lettering, which the world writes in the
page's font; and the croissants, which are drawn again on three shelves so the
rack can fill by shelf.

It checks that rue.py still draws the target, that every line the world shows
is in a piece or left out on purpose, and that the street's pieces, in order,
are the target's lines before the people, so nothing is lost or reordered.
Nothing in the build, the tests or the lint runs it; it is kept to cut the art
again. The city's art is cut_city.py's (#209).
"""

import ast
import base64
import math
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FONT = HERE.parent / "fonts" / "fredoka-latin-600-normal.woff2"
GROUND = 646
DESIGN_WIDTH = 1440
INK = "#2b2622"

# Each piece starts at the first top-level statement of rue.py whose source
# starts with its marker, and runs to the next marker's. A piece may come
# back, so its file holds lines drawn apart. A name starting with "-" is left
# out.
PIECES = [
    ("sky", 'A(rect(0, 0, 1440, 900, "url(#sky)"))'),
    ("cloud-1", "cloud(230,"),
    ("cloud-2", "cloud(1110,"),
    ("cloud-3", "cloud(700,"),
    ("far", "haze ="),
    ("triplex-1", "building(0,"),
    ("triplex-2", "building(310,"),
    ("triplex-3", "building(610,"),
    ("triplex-4", "building(940,"),
    ("triplex-5", "building(1240,"),
    ("depanneur", "sx, sy, sw, sh ="),
    ("sidewalk", 'A(rect(0, GROUND, 1440, 56, "url(#sidewalk)"))'),
    ("curb", 'A(rect(0, 700, 1440, 5, "#ece6da"))'),
    ("road", 'A(rect(0, 716, 1440, 184, "url(#asphalt)"))'),
    ("lamp-post", "A(f'<ellipse cx=\"318\""),
    ("tree-1", "tree(92,"),
    ("tree-2", "tree(1256,"),
    ("-people", "person(526,"),
    ("truck-shadow", "A(f'<ellipse cx=\"{T[0]+240}\""),
    ("-group", "A(f'<g transform"),
    ("truck", "body ="),
    ("espresso-machine", "A(f'<rect x=\"36\" y=\"110\""),
    ("croissant-rack", "A(f'<rect x=\"262\" y=\"92\""),
    ("-croissants", "for cx, cy in"),
    ("croissant-rack", "A(f'<rect x=\"262\" y=\"118\""),
    ("-owner", "A(f'<ellipse cx=\"190\" cy=\"102\""),
    ("awning", "A(f'<rect x=\"18\" y=\"62\" width=\"344\" height=\"40\""),
    ("counter", "A(f'<rect x=\"18\" y=\"178\""),
    ("awning", "for k in range(9):"),
    ("truck-sign", "A(f'<rect x=\"50\" y=\"0\""),
    ("-name", "A(f'<text x=\"190\""),
    ("-lettering", "A(f'<text x=\"262\""),
    ("truck", "for wx in (90, 410):"),
    ("-group", "A('</g>')"),
    ("-people", "person(250,"),
    ("-overlays", "A(overlays("),
]

STREET = [
    "sky", "cloud-1", "cloud-2", "cloud-3", "far",
    "triplex-1", "triplex-2", "triplex-3", "triplex-4", "triplex-5",
    "depanneur", "sidewalk", "curb", "road", "lamp-post", "tree-1", "tree-2",
]
# The truck's shadow on the road, drawn where it falls.
SHADOW = "truck-shadow"
# Drawn in the target's group, moved to T.
TRUCK = ["truck", "espresso-machine", "croissant-rack", "counter", "awning", "truck-sign"]
T = (540, 410)
# The strip of the truck in front of the avatar, under the counter's top to
# the wheel arches, in the group's coordinates: the counter with the body and
# the interior behind it, so it lines up with the truck's file.
COUNTER_STRIP = (18, 178, 362, 228)
# The croissants, three shelves of the reference's croissant, in the group's
# coordinates: the reference's two rows, then its first again under them.
SHELVES = [(280, 110), (304, 110), (328, 110), (292, 136), (316, 136), (280, 162), (304, 162), (328, 162)]
CROISSANT_BOX = (262, 92, 346, 170)

# The ground runs past the design's edges in tiles, one design wide.
TILES = {"sidewalk", "curb", "road"}
# The sky's gradient stretches; above the design it keeps its top colour.
SKY_TOP = -2700
SKY_TOP_COLOR = "#a3cde2"


def run_rue(reference):
    """Runs rue.py up to its page, returning (piece, line) in drawing order."""
    sys.path.insert(0, str(reference))
    source = (reference / "rue.py").read_text()
    tree = ast.parse(source)
    scope = {"__file__": str(reference / "rue.py"), "__name__": "rue"}
    drawn = []
    piece = "preamble"
    statements = {}
    for statement in tree.body:
        text = ast.get_source_segment(source, statement)
        if text.startswith("WORLD ="):
            break
        for name, marker in PIECES:
            if text.startswith(marker):
                piece = name
                statements[marker] = statement
        before = len(scope.get("o", []))
        exec(compile(ast.Module([statement], []), "rue.py", "exec"), scope)
        for line in scope.get("o", [])[before:]:
            drawn.append((piece, line))
    missing = [marker for _, marker in PIECES if marker not in statements]
    if missing:
        raise SystemExit(f"rue.py has no statement starting {missing}")
    return scope, drawn, statements


def scoped(line, ids, prefix="rl"):
    """The line as the target writes it, its ids prefixed `rl-`."""
    for i in sorted(ids, key=len, reverse=True):
        line = line.replace(f"url(#{i})", f"url(#{prefix}-{i})")
    return line


def target_parts(reference):
    """The target's definitions by id, and its world lines before the overlays."""
    text = (reference / "street-target.svg").read_text()
    defs_text = text[text.index("<defs>") + 6 : text.index("</defs>")]
    defs = {}
    for match in re.finditer(
        r'<(linearGradient|radialGradient|pattern|filter)\b[^>]*\bid="([\w-]+)".*?</\1>',
        defs_text,
        re.S,
    ):
        defs[match.group(2)] = match.group(0)
    body = text[text.index("</defs>") + 8 : text.rindex("</svg>")]
    lines = body.split("\n")
    end = lines.index('<g pointer-events="none">')
    return defs, lines[:end]


# ---------- bounds ----------

NUMBER = r"-?\d+(?:\.\d+)?"


def attrs(element):
    return dict(re.findall(r'([\w-]+)="([^"]*)"', element))


def arc_points(x0, y0, rx, ry, phi, large, sweep, x1, y1):
    """The ends of an elliptical arc and its leftmost, rightmost, top and
    bottom points between them (SVG's endpoint to centre conversion)."""
    if rx == 0 or ry == 0:
        return [(x1, y1)]
    rx, ry = abs(rx), abs(ry)
    cos, sin = math.cos(math.radians(phi)), math.sin(math.radians(phi))
    dx, dy = (x0 - x1) / 2, (y0 - y1) / 2
    xp, yp = cos * dx + sin * dy, -sin * dx + cos * dy
    scale = (xp / rx) ** 2 + (yp / ry) ** 2
    if scale > 1:
        rx, ry = rx * math.sqrt(scale), ry * math.sqrt(scale)
    num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp
    den = rx * rx * yp * yp + ry * ry * xp * xp
    k = math.sqrt(max(0.0, num / den)) * (-1 if large == sweep else 1)
    cxp, cyp = k * rx * yp / ry, -k * ry * xp / rx
    cx = cos * cxp - sin * cyp + (x0 + x1) / 2
    cy = sin * cxp + cos * cyp + (y0 + y1) / 2
    angle = lambda ux, uy: math.atan2(uy, ux)
    start = angle((xp - cxp) / rx, (yp - cyp) / ry)
    end = angle((-xp - cxp) / rx, (-yp - cyp) / ry)
    delta = end - start
    if sweep and delta < 0:
        delta += math.tau
    if not sweep and delta > 0:
        delta -= math.tau
    point = lambda t: (
        cx + rx * math.cos(t) * cos - ry * math.sin(t) * sin,
        cy + rx * math.cos(t) * sin + ry * math.sin(t) * cos,
    )
    points = [(x0, y0), (x1, y1)]
    # The extremes of an ellipse turned by phi, each way.
    for t0 in (math.atan2(-ry * sin, rx * cos), math.atan2(ry * cos, rx * sin)):
        for t in (t0, t0 + math.pi):
            # Within the sweep from start, by delta, a turn either way.
            for turn in (-2, -1, 0, 1, 2):
                share = (t + turn * math.tau - start) / delta
                if 0 <= share <= 1:
                    points.append(point(t))
                    break
    return points


def path_points(d):
    """The points and control points of a path of M, L, C, Q and A (and
    their relative l, m, c, q), and Z; arcs by their ends and extremes."""
    unknown = set(re.findall(r"[A-Za-z]", d)) - set("MLCQAlmcqzZ")
    if unknown:
        raise SystemExit(f"path command {sorted(unknown)} not handled: {d}")
    points = []
    x = y = 0.0
    for command, args in re.findall(r"([MLCQAZlmqcz])([^MLCQAZlmqcz]*)", d):
        values = [float(v) for v in re.findall(NUMBER, args)]
        if command == "A":
            for i in range(0, len(values), 7):
                rx, ry, phi, large, sweep, x1, y1 = values[i : i + 7]
                points += arc_points(x, y, rx, ry, phi, int(large), int(sweep), x1, y1)
                x, y = x1, y1
            continue
        pairs = list(zip(values[0::2], values[1::2]))
        if command in "qc":
            # Each curve's points are from where it starts.
            n = 2 if command == "q" else 3
            for i in range(0, len(pairs), n):
                curve = pairs[i : i + n]
                points += [(x + px, y + py) for px, py in curve]
                x, y = x + curve[-1][0], y + curve[-1][1]
            continue
        for px, py in pairs:
            if command in "lm":
                x, y = x + px, y + py
            else:
                x, y = px, py
            points.append((x, y))
    return points


def element_box(element, filters):
    """The box an element paints, with its stroke and its blur, or None."""
    tag = re.match(r"<(\w+)", element).group(1)
    a = attrs(element)
    num = lambda k, d=0.0: float(a.get(k, d))
    if tag == "rect":
        x0, y0 = num("x"), num("y")
        box = [x0, y0, x0 + num("width"), y0 + num("height")]
    elif tag == "circle":
        cx, cy, r = num("cx"), num("cy"), num("r")
        box = [cx - r, cy - r, cx + r, cy + r]
    elif tag == "ellipse":
        cx, cy, rx, ry = num("cx"), num("cy"), num("rx"), num("ry")
        box = [cx - rx, cy - ry, cx + rx, cy + ry]
    elif tag in ("polygon", "path", "line"):
        if tag == "polygon":
            values = [float(v) for v in re.findall(NUMBER, a["points"])]
            points = list(zip(values[0::2], values[1::2]))
        elif tag == "line":
            points = [(num("x1"), num("y1")), (num("x2"), num("y2"))]
        else:
            points = path_points(a["d"])
        xs, ys = [p[0] for p in points], [p[1] for p in points]
        box = [min(xs), min(ys), max(xs), max(ys)]
    elif tag == "text":
        # Wider than the word drawn: the box only has to hold it.
        size = num("font-size")
        width = len(re.sub("<[^>]+>", "", element)) * size * 0.7
        x0 = num("x") - width / 2
        box = [x0, num("y") - size, x0 + width, num("y") + size * 0.3]
    else:
        return None
    pad = 0.0
    if a.get("stroke", "none") != "none":
        pad += num("stroke-width", 1.0)
    blur = re.search(r"url\(#([\w-]+)\)", a.get("filter", ""))
    if blur:
        pad += 3 * filters[blur.group(1)]
    move = re.search(r"translate\((" + NUMBER + r")[ ,](" + NUMBER + r")\)", a.get("transform", ""))
    dx, dy = (float(move.group(1)), float(move.group(2))) if move else (0.0, 0.0)
    return [box[0] - pad + dx, box[1] - pad + dy, box[2] + pad + dx, box[3] + pad + dy]


def exact_bounds(lines, filters):
    boxes = []
    for line in lines:
        for element in re.findall(r"<(?:rect|circle|ellipse|polygon|path|line|text)\b[^>]*>(?:[^<]*</text>)?", line):
            box = element_box(element, filters)
            if box:
                boxes.append(box)
    return [
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    ]


def bounds(lines, filters):
    x0, y0, x1, y1 = exact_bounds(lines, filters)
    return [math.floor(x0), math.floor(y0), math.ceil(x1), math.ceil(y1)]


def overlaps(line, box, filters):
    x0, y0, x1, y1 = exact_bounds([line], filters)
    return x0 < box[2] and x1 > box[0] and y0 < box[3] and y1 > box[1]


# ---------- writing ----------


def used_defs(lines, defs):
    used = set()
    for line in lines:
        used.update(re.findall(r"url\(#([\w-]+)\)", line))
    return [defs[i] for i in defs if i in used]


def svg(lines, defs, view, size, extra_defs="", stretch=False):
    x0, y0, w, h = view
    width, height = size
    aspect = ' preserveAspectRatio="none"' if stretch else ""
    head = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="{x0} {y0} {w} {h}"{aspect}>'
    )
    blocks = used_defs(lines, defs)
    defs_text = "<defs>\n" + extra_defs + "\n".join(blocks) + "\n</defs>\n" if blocks or extra_defs else ""
    return head + "\n" + defs_text + "\n".join(lines) + "\n</svg>\n"


def in_truck(lines):
    """`lines` in the target's group, which moves them to the truck's place."""
    return [f'<g transform="translate({T[0]},{T[1]})">'] + lines + ["</g>"]


def moved(box):
    """A box in the group's coordinates, in the design's."""
    x0, y0, x1, y1 = box
    return [x0 + T[0], y0 + T[1], x1 + T[0], y1 + T[1]]


def font_style(thicken=True):
    """Fredoka for « DÉPANNEUR »: an image cannot reach the page's fonts.

    The target asks for weight 700, which the game does not ship; its 600
    stands in, a thin ink stroke thickening it unless `thicken` is false.
    """
    data = base64.b64encode(FONT.read_bytes()).decode("ascii")
    stroke = f"text{{stroke:{INK};stroke-width:0.5px}}" if thicken else ""
    return (
        "<style>@font-face{font-family:Fredoka;font-weight:700;"
        f"src:url(data:font/woff2;base64,{data}) format('woff2')}}"
        f"{stroke}</style>\n"
    )


def chalkboard(reference):
    """The « MENU » chalkboard of concept B (#208), from ui_concepts.py.

    The reference draws it in its own box, at its left and top on the page;
    its lines move there, so its viewBox is its box in the design, as the
    other pieces' are. It keeps its ground shadow. Its chalk is cream on the
    board, so the font is not thickened in ink. Returns its box and its SVG.
    """
    source = (reference / "ui_concepts.py").read_text()
    found = re.search(r'^CHALK = f"""(<svg .*?</svg>)"""', source, re.S | re.M)
    if found is None:
        raise SystemExit("ui_concepts.py no longer draws CHALK")
    head, *lines = found.group(1).split("\n")
    box = re.search(
        r'width="(\d+)" height="(\d+)" viewBox="0 0 \1 \2" '
        r'style="position:absolute;left:(\d+)px;top:(\d+)px"',
        head,
    )
    if box is None or lines[-1] != "</svg>":
        raise SystemExit("CHALK is no longer one <svg> placed on the page")
    width, height, left, top = (int(n) for n in box.groups())
    view = (left, top, width, height)
    moved_lines = [f'<g transform="translate({left},{top})">'] + lines[:-1] + ["</g>"]
    text = svg(moved_lines, {}, view, (width, height), font_style(thicken=False))
    return view, text


def mirrored_triplex(scope, ids):
    """The first triplex with its windows and door mirrored, still lit from
    the left, drawn where it stands: left of the first, 10 apart as the
    target's are."""
    scope["o"].clear()
    w = 300
    flip = lambda xs: [w - x - 55 for x in xs]
    scope["building"](
        -w - 10, 240, w, "#b4532f", "#5a3a2a",
        rows=[(40, flip([30, 115, 200])), (160, flip([30, 115, 200]))],
        balconies=[(14, 286, 128), (14, 286, 248)],
        doors=[(w - 40 - 66, 300, 66, 106)],
        curtains=["#e8a93a", "#c9d7b0"],
    )
    return [scoped(line, ids) for line in scope["o"]]


def croissants(scope, statements, ids):
    """The reference's croissant loop, run again over SHELVES."""
    loop = statements["for cx, cy in"]
    again = ast.For(
        target=loop.target,
        iter=ast.parse(repr(SHELVES), mode="eval").body,
        body=loop.body,
        orelse=[],
    )
    scope["o"].clear()
    exec(compile(ast.fix_missing_locations(ast.Module([again], [])), "rue.py", "exec"), scope)
    return [scoped(line, ids) for line in scope["o"]]


def main(reference):
    scope, drawn, statements = run_rue(reference)
    defs, target = target_parts(reference)
    ids = {i.removeprefix("rl-") for i in defs}
    filters = {}
    for i, block in defs.items():
        blur = re.search(r'stdDeviation="(' + NUMBER + ')"', block)
        if blur:
            filters[i] = float(blur.group(1))

    pieces = {}
    for name, line in drawn:
        if name == "preamble":
            raise SystemExit(f"rue.py drew before the sky: {line}")
        pieces.setdefault(name, []).append(scoped(line, ids))

    # Nothing lost, nothing reordered: rue.py drew the target's world, and
    # the street's pieces in order are its lines before the people.
    # The target was rendered with the selection ring in player blue.
    world = "\n".join(scoped(line, ids) for _, line in drawn)
    world = world.replace("{{accent}}", "#2f6fb0").split("\n")
    if world[: len(target) + 1] != target + ['<g pointer-events="none">']:
        raise SystemExit("rue.py no longer draws street-target.svg")
    files = set(STREET) | set(TRUCK) | {SHADOW}
    for name in pieces:
        if name not in files and not name.startswith("-"):
            raise SystemExit(f"rue.py drew a piece no file holds: {name}")
    for name in files:
        if not pieces.get(name):
            raise SystemExit(f"rue.py drew nothing for {name}")
    cut = [line for name in STREET for line in pieces[name]]
    if cut != target[: len(cut)]:
        raise SystemExit("the pieces do not keep the target's lines in order")
    if pieces["-group"] != [f'<g transform="translate({T[0]},{T[1]})">', "</g>"]:
        raise SystemExit("the truck is no longer drawn in one group at T")

    written = {}
    for name in STREET:
        lines = pieces[name]
        x0, y0, x1, y1 = bounds(lines, filters)
        extra = ""
        if name.startswith("triplex"):
            # The sidewalk covers whatever reaches below the facades' foot.
            y1 = GROUND
        if name in TILES:
            x0, x1 = 0, DESIGN_WIDTH
            y0, y1 = {"sidewalk": (646, 702), "curb": (700, 716), "road": (716, 900)}[name]
            if name == "sidewalk":
                # The joint crossing the left edge, again at the right one.
                lines = lines + [
                    l.replace('x1="0"', f'x1="{DESIGN_WIDTH}"').replace('x2="-14"', f'x2="{DESIGN_WIDTH - 14}"')
                    for l in lines
                    if l.startswith('<line x1="0"')
                ]
        if name == "depanneur":
            extra = font_style()
        if name == "sky":
            top = f'<rect x="0" y="{SKY_TOP}" width="{DESIGN_WIDTH}" height="{-SKY_TOP}" fill="{SKY_TOP_COLOR}"></rect>'
            view = (0, SKY_TOP, DESIGN_WIDTH, 900 - SKY_TOP)
            text = svg([top] + lines, defs, view, (8, 1800), stretch=True)
        else:
            view = (x0, y0, x1 - x0, y1 - y0)
            text = svg(lines, defs, view, (x1 - x0, y1 - y0), extra)
        written[f"street/{name}"] = (view, text)

    mirror = mirrored_triplex(scope, ids)
    x0, y0, x1, _ = bounds(mirror, filters)
    view = (x0, y0, x1 - x0, GROUND - y0)
    written["street/triplex-1-mirrored"] = (view, svg(mirror, defs, view, view[2:]))

    x0, y0, x1, y1 = bounds(pieces[SHADOW], filters)
    view = (x0, y0, x1 - x0, y1 - y0)
    written[f"truck/{SHADOW}"] = (view, svg(pieces[SHADOW], defs, view, view[2:]))

    # The counter's strip: the truck's lines under it that reach into it,
    # then the counter, cropped to it.
    first = drawn.index(next(d for d in drawn if d[0] == "counter"))
    behind = [scoped(line, ids) for name, line in drawn[:first] if name == "truck"]
    strip = [line for line in behind if overlaps(line, COUNTER_STRIP, filters)]
    truck_lines = dict(pieces)
    truck_lines["counter"] = strip + pieces["counter"]
    for name in TRUCK:
        lines = truck_lines[name]
        box = COUNTER_STRIP if name == "counter" else bounds(lines, filters)
        x0, y0, x1, y1 = moved(box)
        view = (x0, y0, x1 - x0, y1 - y0)
        written[f"truck/{name}"] = (view, svg(in_truck(lines), defs, view, view[2:]))

    shelves = croissants(scope, statements, ids)
    x0, y0, x1, y1 = moved(CROISSANT_BOX)
    cx0, cy0, cx1, cy1 = exact_bounds(shelves, filters)
    if cx0 < CROISSANT_BOX[0] or cy0 < CROISSANT_BOX[1] or cx1 > CROISSANT_BOX[2] or cy1 > CROISSANT_BOX[3]:
        raise SystemExit("a croissant is off the rack")
    view = (x0, y0, x1 - x0, y1 - y0)
    written["truck/croissants"] = (view, svg(in_truck(shelves), defs, view, view[2:]))

    written["street/chalkboard"] = chalkboard(reference)

    for name, (view, text) in written.items():
        path = HERE / f"{name}.svg"
        path.parent.mkdir(exist_ok=True)
        path.write_text(text)
        print(f"{name}.svg  x {view[0]}  y {view[1]}  width {view[2]}  height {view[3]}  {len(text)} bytes")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]).resolve())
