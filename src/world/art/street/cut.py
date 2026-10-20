"""Cuts the street's art out of the design reference (#198).

Usage: python3 cut.py <reference dir>

The reference dir holds rue.py, light.py and street-target.svg, from
docs/design/reference/ (#197). This script runs rue.py's drawing one top-level
statement at a time, without writing its page, and files each statement's
lines under the piece they draw. Each piece becomes one SVG here: the target's
own lines, the definitions they use, and a viewBox on their box in the
1440 x 900 design, so the manifest places it at that box. The grain, the
mottle, the vignette and the warm glow are left out (atmosphere.ts draws
them over the whole world), and so are the people and the truck, which the
world draws in code.

It checks that the pieces' lines, in order, are the target's world lines
before the people, so nothing is lost or reordered. Nothing in the build, the
tests or the lint runs it; it is kept to cut the art again.
"""

import ast
import base64
import math
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FONT = HERE.parent.parent / "fonts" / "fredoka-latin-600-normal.woff2"
GROUND = 646
DESIGN_WIDTH = 1440
INK = "#2b2622"

# Each piece starts at the first top-level statement of rue.py whose source
# starts with its marker, and runs to the next piece's; None leaves the rest
# out (the people and the truck, then the overlays).
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
    (None, "person(526,"),
]

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
    markers = dict((marker, name) for name, marker in PIECES)
    for statement in tree.body:
        text = ast.get_source_segment(source, statement)
        if text.startswith("WORLD ="):
            break
        for marker, name in markers.items():
            if text.startswith(marker):
                piece = name
        before = len(scope.get("o", []))
        exec(compile(ast.Module([statement], []), "rue.py", "exec"), scope)
        for line in scope.get("o", [])[before:]:
            drawn.append((piece, line))
    return scope, drawn


def scoped(line, ids):
    """The line as the target writes it, its ids prefixed `rl-`."""
    for i in sorted(ids, key=len, reverse=True):
        line = line.replace(f"url(#{i})", f"url(#rl-{i})")
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


def path_points(d):
    """The points and control points of a path of M, L, C, l and Z."""
    points = []
    x = y = 0.0
    for command, args in re.findall(r"([MLCZlmz])([^MLCZlmz]*)", d):
        values = [float(v) for v in re.findall(NUMBER, args)]
        pairs = list(zip(values[0::2], values[1::2]))
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


def bounds(lines, filters):
    boxes = []
    for line in lines:
        for element in re.findall(r"<(?:rect|circle|ellipse|polygon|path|line|text)\b[^>]*>(?:[^<]*</text>)?", line):
            box = element_box(element, filters)
            if box:
                boxes.append(box)
    return [
        math.floor(min(b[0] for b in boxes)),
        math.floor(min(b[1] for b in boxes)),
        math.ceil(max(b[2] for b in boxes)),
        math.ceil(max(b[3] for b in boxes)),
    ]


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


def font_style():
    """Fredoka for « DÉPANNEUR »: an image cannot reach the page's fonts.

    The target asks for weight 700, which the game does not ship; its 600
    stands in, a thin ink stroke thickening it.
    """
    data = base64.b64encode(FONT.read_bytes()).decode("ascii")
    return (
        "<style>@font-face{font-family:Fredoka;font-weight:700;"
        f"src:url(data:font/woff2;base64,{data}) format('woff2')}}"
        f"text{{stroke:{INK};stroke-width:0.5px}}</style>\n"
    )


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


def main(reference):
    scope, drawn = run_rue(reference)
    defs, target = target_parts(reference)
    ids = {i.removeprefix("rl-") for i in defs}
    filters = {}
    for i, block in defs.items():
        blur = re.search(r'stdDeviation="(' + NUMBER + ')"', block)
        if blur:
            filters[i] = float(blur.group(1))

    pieces = {}
    for name, line in drawn:
        if name is None:
            continue
        if name == "preamble":
            raise SystemExit(f"rue.py drew before the sky: {line}")
        pieces.setdefault(name, []).append(scoped(line, ids))

    # Nothing lost, nothing reordered: rue.py drew the target's world, and
    # the pieces' lines in order are its lines before the people.
    # The target was rendered with the selection ring in player blue.
    world = "\n".join(scoped(line, ids) for _, line in drawn)
    world = world.replace("{{accent}}", "#2f6fb0").split("\n")
    if world[: len(target) + 1] != target + ['<g pointer-events="none">']:
        raise SystemExit("rue.py no longer draws street-target.svg")
    cut = [line for name, _ in PIECES if name for line in pieces[name]]
    if cut != target[: len(cut)]:
        raise SystemExit("the pieces do not keep the target's lines in order")

    written = {}
    for name, lines in pieces.items():
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
        written[name] = (view, text)

    mirror = mirrored_triplex(scope, ids)
    x0, y0, x1, _ = bounds(mirror, filters)
    view = (x0, y0, x1 - x0, GROUND - y0)
    written["triplex-1-mirrored"] = (view, svg(mirror, defs, view, view[2:]))

    for name, (view, text) in written.items():
        (HERE / f"{name}.svg").write_text(text)
        print(f"{name}.svg  x {view[0]}  y {view[1]}  width {view[2]}  height {view[3]}  {len(text)} bytes")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]).resolve())
