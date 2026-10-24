"""Cuts the Vieux-Montréal street's art out of the design reference (#264).

Usage: python3 cut_vieux.py <reference dir>

The reference dir holds vieux.py, rue.py, light.py, vieux-summer-target.svg
and vieux-winter-target.svg, from docs/design/reference/ (#258). This script
runs rue.py's drawing up to its page, as cut.py does, then vieux.py's
`scene()` for each season one statement at a time, without writing its
pages: an `if` runs the branch the season takes, statement by statement, and
the truck's code, which vieux.py runs in one `exec`, runs statement by
statement too. Each statement's lines are filed under the piece they draw.

Each piece becomes one SVG under vieux/ here: the target's own lines, the
definitions they use, and a viewBox on their box in the 1440 x 900 design,
so the manifest places it at that box. A piece both seasons draw alike is
one file, vieux/<piece>.svg; one they draw differently is a file for each,
vieux/summer/<piece>.svg and vieux/winter/<piece>.svg; one only a season
draws (the clouds, the calèche, the cart under its tarp, the snow) is one
file, vieux/<piece>.svg. The truck's are under vieux/truck/: the teal body
and the strip of the counter, cut as cut.py cuts the Plateau's, its shadow,
the lemonade jar, and the shutter and its roof's snow. The truck's other
pieces (the espresso machine, the rack, the croissants, the awning and the
sign's board) are rue.py's lines unchanged, so the manifest places the
Plateau's files 60 to the right; this script checks they still are.

The ground runs past the design's edges in tiles one design wide, and the
sky's gradient stretches, its top colour above the design. The winter's
snow on the sidewalk, the snowbanks and the slush are their own tiles, over
the ground both seasons share; the snowbanks are drawn over the slush, where
the target draws them under it, which no one can see. Under the road, its
cobbles go on below the design, for phones.

Left out: the grain, the mottle, the vignette and the warm glow (atmosphere.ts
draws them over the whole world); the people, the tourists and the owner,
whom the world draws in code; the truck's name and lettering and the stored
truck's « Fermé pour l'hiver » card, which the world writes in the page's
font; and the falling snow, which the world animates.

It checks that vieux.py still draws both targets, that every line the world
shows is in a piece or left out on purpose, and that the truck is drawn in
one group at its place. Nothing in the build, the tests or the lint runs it;
it is kept to cut the art again.
"""

import ast
import sys
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import cut  # noqa: E402  (the Plateau's cutter: its bounds and its writing)

GROUND = 646
DESIGN_WIDTH = 1440
T = (600, 410)
SEASONS = {"summer": "ve", "winter": "vh"}

# Each piece starts at the first statement, of vieux.py's scene() or of the
# truck's code, whose source starts with its marker, and runs to the next
# marker's. A piece may come back, so its file holds lines drawn apart. A
# name starting with "-" is left out.
PIECES = [
    ("-setup", "rue.o.clear()"),
    ("sky", 'A(rect(0, 0, 1440, 900, "url(#skyWinter)"'),
    ("cloud-1", "rue.cloud(260,"),
    ("cloud-2", "rue.cloud(1180,"),
    ("far", "haze ="),
    ("-setup", "def stone_building("),
    ("building-1", "stone_building(0,"),
    ("building-2", "stone_building(310,"),
    ("building-3", "stone_building(580,"),
    ("building-4", "stone_building(920,"),
    ("building-5", "stone_building(1220,"),
    ("sidewalk", 'A(rect(0, GROUND, 1440, 56, "#d6d0c6"))'),
    ("curb", 'A(rect(0, 700, 1440, 6, "#c9c2b6"))'),
    ("road", 'A(rect(0, 716, 1440, 184, "#6a645d"))'),
    ("sidewalk-snow", "A(rect(0, GROUND, 1440, 56, snow"),
    ("snowbanks", "for k in range(0, 1440, 70):"),
    ("road-snow", 'A(rect(0, 716, 1440, 184, "#e3e6e6"'),
    ("lantern", "lx = 320"),
    ("-setup", "src = (TRUCK_SRC"),
    ("-people", "rue.person(586,"),
    # The truck's code, as cut.py files rue.py's.
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
    ("-lettering", "A(f'<text x=\"250\""),
    ("truck", "for wx in (90, 410):"),
    ("-group", "A('</g>')"),
    ("-setup", "T = rue.T"),
    ("lemonade-jar", "jx, jy ="),
    ("shutter", 'A(rect(T[0] + 12, T[1] + 34, 356, 182, "#9aa3a8"))'),
    ("roof-snow", "A(f'<rect x=\"{T[0] - 6}\""),
    ("-stored-sign", "A(f'<rect x=\"{T[0] + 110}\""),
    ("-setup", "cx = 1170"),
    ("cart-shadow", "A(f'<ellipse cx=\"{cx + 70}\""),
    ("cart", "A(rect(cx + 64, 470,"),
    ("cart-tarp", "A(f'<path d=\"M {cx} 664"),
    ("cart-tarp-snow", "A(f'<path d=\"M {cx + 10} 598"),
    ("caleche", "A('<g transform=\"translate(40 744) scale(0.78)\">')"),
    ("-people", "def tourist("),
    ("-snowfall", "import random"),
    ("-overlays", "A(overlays("),
]

STREET = [
    "sky", "cloud-1", "cloud-2", "far",
    "building-1", "building-2", "building-3", "building-4", "building-5",
    "sidewalk", "curb", "road", "sidewalk-snow", "snowbanks", "road-snow",
    "lantern", "cart-shadow", "cart", "cart-tarp", "cart-tarp-snow",
]
# Drawn in the truck's group, moved to T, and written here.
TRUCK = ["truck", "counter"]
# Drawn in the truck's group as rue.py draws them: the Plateau's files serve.
SHARED_TRUCK = ["espresso-machine", "croissant-rack", "awning", "truck-sign"]
# Drawn on the street, near the truck.
NEAR_TRUCK = ["truck-shadow", "lemonade-jar", "shutter", "roof-snow"]
CALECHE = "caleche"
CALECHE_MOVE = (40, 744, 0.78)
# The tiles of the ground, one design wide, and where each runs.
TILES = {
    "sidewalk": (646, 702),
    "curb": (700, 716),
    "road": (716, 900),
    "sidewalk-snow": (646, 702),
    "snowbanks": (694, 722),
    "road-snow": (716, 900),
}
# The pieces whose words are written in Fredoka, embedded.
WRITTEN = {"building-1", "building-2", "building-4", "building-5", "cart"}
# The sky's gradient stretches; above the design it keeps its top colour.
SKY_TOP = -2700
SKY_TOP_COLOR = {"summer": "#a3cde2", "winter": "#b9c4cc"}
# Under the road, below the design: its cobbles, for phones.
BELOW = 360
COUNTER_STRIP = cut.COUNTER_STRIP


def path_points(d):
    """The points and control points of a path, for its box: cut.py's, with
    every command the Vieux draws with (H, V, T and the relative ones);
    arcs by their ends and extremes."""
    import re

    points = []
    x = y = 0.0
    start = (0.0, 0.0)
    last_control = None
    sizes = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2, "A": 7, "Z": 0}
    for command, args in re.findall(r"([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)", d):
        values = [float(v) for v in re.findall(cut.NUMBER, args)]
        upper = command.upper()
        relative = command != upper
        n = sizes[upper]
        if upper == "Z":
            x, y = start
            points.append((x, y))
            last_control = None
            continue
        for i in range(0, len(values), n):
            v = values[i : i + n]
            ox, oy = (x, y) if relative else (0.0, 0.0)
            control = None
            if upper == "H":
                x = v[0] + (x if relative else 0.0)
                points.append((x, y))
            elif upper == "V":
                y = v[0] + (y if relative else 0.0)
                points.append((x, y))
            elif upper == "A":
                rx, ry, phi, large, sweep, x1, y1 = v
                x1, y1 = x1 + ox, y1 + oy
                points += cut.arc_points(x, y, rx, ry, phi, int(large), int(sweep), x1, y1)
                x, y = x1, y1
            elif upper == "T":
                cx, cy = (2 * x - last_control[0], 2 * y - last_control[1]) if last_control else (x, y)
                points.append((cx, cy))
                control = (cx, cy)
                x, y = v[0] + ox, v[1] + oy
                points.append((x, y))
            else:
                pairs = [(v[k] + ox, v[k + 1] + oy) for k in range(0, n, 2)]
                points += pairs
                if upper in "QC":
                    control = pairs[-2]
                x, y = pairs[-1]
                if upper == "M" and i == 0:
                    start = (x, y)
            last_control = control
    return points


cut.path_points = path_points


def run_rue(reference):
    """rue.py as a module, its drawing run up to its page."""
    rue = types.ModuleType("rue")
    rue.__file__ = str(reference / "rue.py")
    source = (reference / "rue.py").read_text()
    for statement in ast.parse(source).body:
        if ast.get_source_segment(source, statement).startswith("WORLD ="):
            break
        exec(compile(ast.Module([statement], []), "rue.py", "exec"), rue.__dict__)
    return rue


def run_vieux(reference, season):
    """vieux.py's scene for `season`, returning (piece, line) in drawing order
    and the markers met."""
    sys.path.insert(0, str(reference))
    rue = run_rue(reference)
    sys.modules["rue"] = rue
    # vieux.py's interface layer is not drawn: its module is never used.
    sys.modules["ui_concepts"] = types.ModuleType("ui_concepts")
    source = (reference / "vieux.py").read_text()
    scope = {"__file__": str(reference / "vieux.py"), "__name__": "vieux"}
    scene = None
    for statement in ast.parse(source).body:
        if isinstance(statement, ast.For):
            break
        if isinstance(statement, ast.FunctionDef) and statement.name == "scene":
            scene = statement
            continue
        exec(compile(ast.Module([statement], []), "vieux.py", "exec"), scope)
    if scene is None:
        raise SystemExit("vieux.py has no scene()")
    scope["winter"] = season == "winter"

    drawn = []
    met = set()
    state = {"piece": "preamble"}

    def run(statements, text, names):
        for statement in statements:
            segment = ast.get_source_segment(text, statement)
            for name, marker in PIECES:
                # The calèche's group closes as the truck's does.
                closes = name == "-group" and state["piece"] == CALECHE
                if segment.startswith(marker) and not closes:
                    state["piece"] = name
                    met.add(marker)
            if isinstance(statement, ast.If):
                test = eval(compile(ast.Expression(statement.test), "vieux.py", "eval"), names)
                run(statement.body if test else statement.orelse, text, names)
                continue
            if isinstance(statement, ast.Return):
                continue
            if segment.startswith("exec(src"):
                truck = names["src"]
                run(ast.parse(truck).body, truck, rue.__dict__)
                continue
            before = len(rue.o)
            exec(compile(ast.Module([statement], []), "vieux.py", "exec"), names)
            for line in rue.o[before:]:
                drawn.append((state["piece"], line))

    run(scene.body, source, scope)
    sys.path.remove(str(reference))
    return rue, drawn, met


def target_parts(reference, season):
    """The target's definitions by id, unprefixed, and its world lines before
    the overlays."""
    text = (reference / f"vieux-{season}-target.svg").read_text()
    prefix = SEASONS[season] + "-"
    defs = {}
    for block in text.split("<defs>")[1:]:
        found, _ = cut_defs(block[: block.index("</defs>")])
        defs.update(found)
    body = text[text.rindex("</defs>") + len("</defs>") : text.rindex("</svg>")]
    lines = body.lstrip("\n").split("\n")
    end = lines.index('<g pointer-events="none">')
    ids = {i.removeprefix(prefix) for i in defs}
    return defs, ids, lines[:end]


def cut_defs(text):
    import re

    defs = {}
    for match in re.finditer(
        r'<(linearGradient|radialGradient|pattern|filter)\b[^>]*\bid="([\w-]+)".*?</\1>',
        text,
        re.S,
    ):
        defs[match.group(2)] = match.group(0)
    return defs, None


def blurs(defs):
    import re

    filters = {}
    for i, block in defs.items():
        blur = re.search(r'stdDeviation="(' + cut.NUMBER + ')"', block)
        if blur:
            filters[i] = float(blur.group(1))
    return filters


def in_truck(lines):
    return [f'<g transform="translate({T[0]},{T[1]})">'] + lines + ["</g>"]


def moved(box):
    x0, y0, x1, y1 = box
    return [x0 + T[0], y0 + T[1], x1 + T[0], y1 + T[1]]


def cut_season(reference, season):
    """Every piece's lines for `season`, scoped as its target writes them,
    once the drawing is checked against the target."""
    rue, drawn, met = run_vieux(reference, season)
    defs, ids, target = target_parts(reference, season)
    prefix = SEASONS[season]
    scoped = lambda line: cut.scoped(line, ids, prefix)
    pieces = {}
    for name, line in drawn:
        if name == "preamble":
            raise SystemExit(f"vieux.py drew before the sky: {line}")
        pieces.setdefault(name, []).append(scoped(line))
    world = "\n".join(scoped(line) for _, line in drawn).split("\n")
    if world[: len(target) + 1] != target + ['<g pointer-events="none">']:
        raise SystemExit(f"vieux.py no longer draws vieux-{season}-target.svg")
    known = set(STREET) | set(TRUCK) | set(SHARED_TRUCK) | set(NEAR_TRUCK) | {CALECHE}
    for name in pieces:
        if name not in known and not name.startswith("-"):
            raise SystemExit(f"vieux.py drew a piece no file holds: {name}")
    if pieces["-group"] != [f'<g transform="translate({T[0]},{T[1]})">', "</g>"]:
        raise SystemExit(f"the {season} truck is no longer drawn in one group at T")
    return rue, defs, blurs(defs), pieces, drawn, met, scoped


def check_shared(reference, pieces):
    """The truck's pieces the Plateau's files serve are rue.py's lines."""
    plateau, plateau_drawn, _ = cut.run_rue(reference)[:3]
    defs, _ = cut.target_parts(reference)
    ids = {i.removeprefix("rl-") for i in defs}
    theirs = {}
    for name, line in plateau_drawn:
        theirs.setdefault(name, []).append(cut.scoped(line, ids))
    for name in SHARED_TRUCK:
        ours = [line.replace("url(#ve-", "url(#rl-") for line in pieces[name]]
        if ours != theirs[name]:
            raise SystemExit(f"the truck's {name} is no longer the Plateau's")


def tile(lines, name):
    """A tile of the ground, as the Plateau's are."""
    y0, y1 = TILES[name]
    return (0, y0, DESIGN_WIDTH, y1 - y0)


def main(reference):
    seasons = {season: cut_season(reference, season) for season in SEASONS}
    met = set.union(*(seasons[season][5] for season in SEASONS))
    missing = [marker for _, marker in PIECES if marker not in met]
    if missing:
        raise SystemExit(f"vieux.py has no statement starting {missing}")
    check_shared(reference, seasons["summer"][3])

    written = {}

    def write(path, lines, defs, filters, view=None, extra="", size=None, stretch=False):
        if view is None:
            x0, y0, x1, y1 = cut.bounds(lines, filters)
            view = (x0, y0, x1 - x0, y1 - y0)
        text = cut.svg(lines, defs, view, size or view[2:], extra, stretch)
        written[path] = (view, text)

    def piece_lines(name):
        """Each season's lines for `name`, when it draws it."""
        return {
            season: seasons[season][3][name]
            for season in SEASONS
            if seasons[season][3].get(name)
        }

    def folder(name, drawn):
        """vieux/<name> for a piece drawn alike, or by one season; else one
        file per season."""
        if len(drawn) == 2:
            summer, winter = drawn["summer"], drawn["winter"]
            unprefixed = lambda lines: [l.replace("url(#ve-", "url(#").replace("url(#vh-", "url(#") for l in lines]
            if unprefixed(summer) == unprefixed(winter):
                return {"summer": f"vieux/{name}"}
            return {season: f"vieux/{season}/{name}" for season in drawn}
        return {season: f"vieux/{name}" for season in drawn}

    for name in STREET + [CALECHE] + NEAR_TRUCK:
        drawn = piece_lines(name)
        if not drawn:
            raise SystemExit(f"vieux.py drew nothing for {name}")
        for season, path in folder(name, drawn).items():
            _, defs, filters, *_ = seasons[season]
            lines = drawn[season]
            extra = cut.font_style() if name in WRITTEN else ""
            if name == "sky":
                top = f'<rect x="0" y="{SKY_TOP}" width="{DESIGN_WIDTH}" height="{-SKY_TOP}" fill="{SKY_TOP_COLOR[season]}"></rect>'
                view = (0, SKY_TOP, DESIGN_WIDTH, 900 - SKY_TOP)
                write(path, [top] + lines, defs, filters, view, size=(8, 1800), stretch=True)
            elif name in TILES:
                write(path, lines, defs, filters, tile(lines, name), extra)
            elif name == CALECHE:
                # Its lines in their group, moved and scaled where drawn.
                inner = lines[1:-1]
                dx, dy, s = CALECHE_MOVE
                x0, y0, x1, y1 = cut.exact_bounds(inner, filters)
                box = [dx + s * x0, dy + s * y0, dx + s * x1, dy + s * y1]
                import math

                box = [math.floor(box[0]), math.floor(box[1]), math.ceil(box[2]), math.ceil(box[3])]
                view = (box[0], box[1], box[2] - box[0], box[3] - box[1])
                write(path, lines, defs, filters, view)
            elif name.startswith("building"):
                x0, y0, x1, _ = cut.bounds(lines, filters)
                # The sidewalk covers whatever reaches below the facades' foot.
                write(path, lines, defs, filters, (x0, y0, x1 - x0, GROUND - y0), extra)
            else:
                write(path, lines, defs, filters, None, extra)

    # The road's cobbles below the design.
    _, defs, filters, pieces, *_ = seasons["summer"]
    below = [
        f'<rect x="0" y="900" width="{DESIGN_WIDTH}" height="{BELOW}" fill="#6a645d"></rect>',
        f'<rect x="0" y="900" width="{DESIGN_WIDTH}" height="{BELOW}" fill="url(#ve-cobbles)"></rect>',
    ]
    write("vieux/road-below", below, defs, filters, (0, 900, DESIGN_WIDTH, BELOW))

    # The truck: its body, and the counter's strip as cut.py cuts it.
    drawn = seasons["summer"][4]
    for season in SEASONS:
        other = seasons[season][3]
        for name in TRUCK + SHARED_TRUCK:
            if [l.replace("url(#vh-", "url(#ve-") for l in other[name]] != pieces[name]:
                raise SystemExit(f"the truck's {name} differs between the seasons")
    first = drawn.index(next(d for d in drawn if d[0] == "counter"))
    scoped = seasons["summer"][6]
    behind = [scoped(line) for name, line in drawn[:first] if name == "truck"]
    strip = [line for line in behind if cut.overlaps(line, COUNTER_STRIP, filters)]
    truck_lines = {"truck": pieces["truck"], "counter": strip + pieces["counter"]}
    for name in TRUCK:
        lines = truck_lines[name]
        box = COUNTER_STRIP if name == "counter" else cut.bounds(lines, filters)
        x0, y0, x1, y1 = moved(box)
        view = (x0, y0, x1 - x0, y1 - y0)
        write(f"vieux/truck/{name}", in_truck(lines), defs, filters, view)

    # The pieces near the truck go with it.
    for name in NEAR_TRUCK:
        for path in [p for p in list(written) if p == f"vieux/{name}"]:
            written[f"vieux/truck/{name}"] = written.pop(path)

    for name, (view, text) in written.items():
        path = HERE / f"{name}.svg"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        print(f"{name}.svg  x {view[0]}  y {view[1]}  width {view[2]}  height {view[3]}  {len(text)} bytes")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]).resolve())
