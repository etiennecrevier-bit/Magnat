"""Angled city view with texture and shade. Writes design/project/VilleLumiere.dc.html."""
import math
import re
from pathlib import Path
from light import (scope_ids, INK, CREAM, SLATE, SUN, STONE, DEFS, overlays, mix, lit, shd, deep, poly, rect)

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent / "design" / "project"
OUT = PROJECT / "VilleLumiere.dc.html"

TW, TH, OX, OY = 100, 50, 720, 170
SHX, SHY = 0.70, 0.19   # cast shadow offset per pixel of height: sun from the upper left


def iso(gx, gy):
    return (OX + (gx - gy) * TW / 2, OY + (gx + gy) * TH / 2)


def up(p, h):
    return (p[0], p[1] - h)


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def hull(points):
    pts = sorted(set((round(x, 2), round(y, 2)) for x, y in points))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def P(points, fill, extra=""):
    return poly(points, fill, extra)


EXTRA_DEFS = f"""<defs>
<pattern id="bricksL" width="14" height="8" patternUnits="userSpaceOnUse" patternTransform="skewY(26.565)">
<path d="M0 3.6H14M0 7.6H14M3.5 0V3.6M10.5 4V7.6" stroke="{INK}" stroke-opacity="0.16" stroke-width="0.9" fill="none"></path>
</pattern>
<pattern id="bricksR" width="14" height="8" patternUnits="userSpaceOnUse" patternTransform="skewY(-26.565)">
<path d="M0 3.6H14M0 7.6H14M3.5 0V3.6M10.5 4V7.6" stroke="{INK}" stroke-opacity="0.20" stroke-width="0.9" fill="none"></path>
</pattern>
<pattern id="tiles" width="25" height="25" patternUnits="userSpaceOnUse" patternTransform="matrix(1 0.5 -1 0.5 0 0)">
<path d="M0 0H25M0 0V25" stroke="{SLATE}" stroke-opacity="0.10" stroke-width="1.2" fill="none"></path>
</pattern>
<pattern id="gravel" width="18" height="12" patternUnits="userSpaceOnUse">
<circle cx="2" cy="3" r="0.9" fill="{SLATE}" fill-opacity="0.25"></circle>
<circle cx="9" cy="8" r="1.1" fill="{SLATE}" fill-opacity="0.2"></circle>
<circle cx="14" cy="2" r="0.8" fill="#ffffff" fill-opacity="0.35"></circle>
<circle cx="6" cy="10" r="0.7" fill="#ffffff" fill-opacity="0.3"></circle>
</pattern>
<pattern id="grass" width="16" height="10" patternUnits="userSpaceOnUse">
<circle cx="3" cy="3" r="1.6" fill="{SLATE}" fill-opacity="0.14"></circle>
<circle cx="11" cy="7" r="1.8" fill="{SUN}" fill-opacity="0.20"></circle>
<path d="M7 9l1-3l1 3" stroke="#4f8a3e" stroke-width="0.9" fill="none" opacity="0.6"></path>
</pattern>
<linearGradient id="water" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#9cc8d4"></stop><stop offset="1" stop-color="#5a8ea3"></stop>
</linearGradient>
<linearGradient id="cyl" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="{mix("#d8d0c2", SUN, 0.35)}"></stop><stop offset="0.35" stop-color="#d8d0c2"></stop><stop offset="1" stop-color="{shd("#d8d0c2", 0.5)}"></stop>
</linearGradient>
<linearGradient id="slabL" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#a7865f"></stop><stop offset="1" stop-color="#7d6248"></stop>
</linearGradient>
<linearGradient id="slabR" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="{shd("#a7865f", 0.42)}"></stop><stop offset="1" stop-color="{shd("#7d6248", 0.45)}"></stop>
</linearGradient>
</defs>"""

ground_layer = []   # drawn first
shadow_layer = []   # cast shadows, drawn as one group so overlaps never double up
objects = []        # (sort key, svg) painter's order

G = ground_layer.append
S = shadow_layer.append

# ---------- sky ----------
G(rect(0, 0, 1440, 900, "url(#sky)"))
for cx, cy, s in [(230, 190, 1.0), (1230, 200, 1.15), (980, 120, 0.6)]:
    G(f'<ellipse cx="{cx+6}" cy="{cy+10*s}" rx="{100*s}" ry="{18*s}" fill="#d9e6ec" filter="url(#soft2)"></ellipse>')
    for dx, dy, r in [(-60, 2, 28), (-20, -12, 38), (30, -6, 32), (70, 6, 22)]:
        G(f'<circle cx="{cx+dx*s}" cy="{cy+dy*s}" r="{r*s}" fill="#fbfdfd"></circle>')
    G(f'<ellipse cx="{cx}" cy="{cy+12*s}" rx="{94*s}" ry="{13*s}" fill="#e3edf1"></ellipse>')

# ---------- the island: a cut-open block of the Plateau ----------
L0, F0, R0, B0 = iso(0, 12), iso(12, 12), iso(12, 0), iso(0, 0)
DEPTH = 34
G(f'<ellipse cx="720" cy="{F0[1]+48}" rx="560" ry="34" fill="{SLATE}" opacity="0.22" filter="url(#soft8)"></ellipse>')
G(P([L0, F0, up(F0, -DEPTH), up(L0, -DEPTH)], "url(#slabL)"))
G(P([F0, R0, up(R0, -DEPTH), up(F0, -DEPTH)], "url(#slabR)"))
G(P([L0, F0, up(F0, -7), up(L0, -7)], "#d6ccbb"))
G(P([F0, R0, up(R0, -7), up(F0, -7)], shd("#d6ccbb", 0.4)))
# a few stones and a pipe in the cut
for gx, dz in [(1.5, 18), (3.2, 26), (5.1, 15), (8.6, 22), (10.4, 16)]:
    p = iso(gx, 12) if gx < 6 else iso(12, 12 - (gx - 6) * 2)
    G(f'<ellipse cx="{p[0]:.1f}" cy="{p[1]+dz:.1f}" rx="5" ry="3" fill="{deep("#a7865f", 0.3)}"></ellipse>')
pa, pb = iso(12, 4.2), iso(12, 3.6)
G(f'<ellipse cx="{(pa[0]+pb[0])/2:.1f}" cy="{(pa[1]+pb[1])/2+19:.1f}" rx="13" ry="10" fill="#6c747b"></ellipse><ellipse cx="{(pa[0]+pb[0])/2:.1f}" cy="{(pa[1]+pb[1])/2+19:.1f}" rx="8" ry="6" fill="#3a3f44"></ellipse>')

# ground top: sidewalks everywhere, with tile joints
G(P([B0, R0, F0, L0], "#e3dbcc"))
G(P([B0, R0, F0, L0], "url(#tiles)"))
G(f'<line x1="{L0[0]}" y1="{L0[1]}" x2="{F0[0]}" y2="{F0[1]}" stroke="{lit("#e3dbcc", 0.6)}" stroke-width="2"></line>')

# park with Parc La Fontaine's pond
park = [iso(0.4, 8.9), iso(5.6, 8.9), iso(5.6, 11.6), iso(0.4, 11.6)]
G(P(park, "#8dbd68"))
G(P(park, "url(#grass)"))
G(f'<path d="M {iso(0.4,10.9)[0]:.1f} {iso(0.4,10.9)[1]:.1f} C {iso(2,10.9)[0]:.1f} {iso(2,11.3)[1]:.1f}, {iso(3.6,9.2)[0]:.1f} {iso(3.6,9.2)[1]:.1f}, {iso(5.6,9.6)[0]:.1f} {iso(5.6,9.6)[1]:.1f}" stroke="#e7d7b4" stroke-width="9" fill="none" stroke-linecap="round"></path>')
pc = iso(2.8, 10.2)
G(f'<ellipse cx="{pc[0]:.1f}" cy="{pc[1]+2:.1f}" rx="50" ry="25" fill="#cbbfa8"></ellipse>')
G(f'<ellipse cx="{pc[0]:.1f}" cy="{pc[1]+3:.1f}" rx="44" ry="21" fill="url(#water)"></ellipse>')
G(f'<ellipse cx="{pc[0]:.1f}" cy="{pc[1]-6:.1f}" rx="40" ry="12" fill="{SLATE}" opacity="0.18"></ellipse>')
G(f'<path d="M {pc[0]-22:.1f} {pc[1]+8:.1f} q 14 -6 30 -2" stroke="#ffffff" stroke-width="2.5" opacity="0.7" fill="none" stroke-linecap="round"></path>')

# roads, sunk a little below the sidewalk: curb faces show on the far edges
road_h = [iso(0, 5), iso(12, 5), iso(12, 6), iso(0, 6)]
road_v = [iso(6, 0), iso(7, 0), iso(7, 12), iso(6, 12)]
for road in (road_h, road_v):
    G(P(road, "#5c5752"))
G(P([iso(0, 5), iso(12, 5), up(iso(12, 5), -5), up(iso(0, 5), -5)], "#cfc6b6"))
G(P([iso(6, 0), iso(6, 12), up(iso(6, 12), -5), up(iso(6, 0), -5)], shd("#cfc6b6", 0.45)))
G(P([up(iso(0, 5), -5), up(iso(12, 5), -5), up(iso(12, 5), -12), up(iso(0, 5), -12)], SLATE, 'opacity="0.16"'))
G(P([up(iso(6, 0), -5), up(iso(6, 12), -5), lerp(up(iso(6, 12), -5), up(iso(7, 12), -5), 0.12), lerp(up(iso(6, 0), -5), up(iso(7, 0), -5), 0.12)], SLATE, 'opacity="0.16"'))
G(P(road_h[:2] + [iso(12, 5), iso(0, 5)], "none"))
for a, b in [(iso(0, 6), iso(12, 6)), (iso(7, 0), iso(7, 12))]:
    G(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="#f0e9dc" stroke-width="2"></line>')
# re-cover the intersection so the curb lines stop at the corners
G(P([iso(6, 5), iso(7, 5), iso(7, 6), iso(6, 6)], "#5c5752"))
for g in [0.5, 1.5, 2.5, 3.5, 4.5, 8.0, 9.0, 10.0, 11.0]:
    a, b = iso(g - 0.2, 5.5), iso(g + 0.2, 5.5)
    G(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="#e9e2d0" stroke-width="3" opacity="0.85"></line>')
    a, b = iso(6.5, g - 0.2), iso(6.5, g + 0.2)
    G(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="#e9e2d0" stroke-width="3" opacity="0.85"></line>')
# crosswalks
for k in range(5):
    y0 = 5.08 + k * 0.18
    for x0 in (5.5, 7.1):
        G(P([iso(x0, y0), iso(x0 + 0.4, y0), iso(x0 + 0.4, y0 + 0.1), iso(x0, y0 + 0.1)], "#f1ece0", 'opacity="0.9"'))
    x1 = 6.08 + k * 0.18
    for y1 in (4.5, 6.1):
        G(P([iso(x1, y1), iso(x1 + 0.1, y1), iso(x1 + 0.1, y1 + 0.4), iso(x1, y1 + 0.4)], "#f1ece0", 'opacity="0.9"'))
# a manhole
mh = iso(9.2, 5.6)
G(f'<ellipse cx="{mh[0]:.1f}" cy="{mh[1]:.1f}" rx="13" ry="6.5" fill="#4a4642"></ellipse><ellipse cx="{mh[0]:.1f}" cy="{mh[1]-0.5:.1f}" rx="10" ry="4.8" fill="none" stroke="#6b655e" stroke-width="1.5"></ellipse>')


# ---------- buildings ----------

def face_pt(a, b, f, z):
    p = lerp(a, b, f)
    return (p[0], p[1] - z)


def quad(a, b, f0, f1, z0, z1):
    return [face_pt(a, b, f0, z0), face_pt(a, b, f1, z0), face_pt(a, b, f1, z1), face_pt(a, b, f0, z1)]


def cast_box(gx, gy, w, d, h):
    base = [iso(gx, gy), iso(gx + w, gy), iso(gx + w, gy + d), iso(gx, gy + d)]
    top = [(x + SHX * h, y + SHY * h) for x, y in base]
    S(P(hull(base + top), SLATE))


def mini_box(add, gx, gy, w, d, z, h, col):
    A_, B_, C_, D_ = [up(iso(*q), z) for q in ((gx, gy), (gx + w, gy), (gx + w, gy + d), (gx, gy + d))]
    add(P([D_, C_, up(C_, h), up(D_, h)], col))
    add(P([C_, B_, up(B_, h), up(C_, h)], shd(col, 0.42)))
    add(P([up(A_, h), up(B_, h), up(C_, h), up(D_, h)], lit(col, 0.3)))
    # tiny shadow on the roof, to the right
    add(P([C_, B_, (B_[0] + SHX * h, B_[1] + SHY * h), (C_[0] + SHX * h, C_[1] + SHY * h)], SLATE, 'opacity="0.25"'))
    return A_, B_, C_, D_


def roof_details(add, name, gx, gy, w, d, h):
    if name in ("tri1", "tri3", "tri4", "tri5", "rent", "cafe"):
        mini_box(add, gx + w * 0.25, gy + d * 0.55, 0.28, 0.28, h, 6, "#9a9087")
    if name == "tri2":
        q = [up(iso(*c), h) for c in ((gx + 0.35, gy + 0.6), (gx + 1.35, gy + 0.6), (gx + 1.35, gy + 1.45), (gx + 0.35, gy + 1.45))]
        add(P(q, "#b98a5e"))
        for k in range(1, 8):
            a, b = lerp(q[0], q[3], k / 8), lerp(q[1], q[2], k / 8)
            add(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="{deep("#b98a5e", 0.3)}" stroke-width="1"></line>')
        for (px, py) in ((0.5, 0.75), (1.2, 1.3)):
            c = up(iso(gx + px, gy + py), h)
            add(f'<ellipse cx="{c[0]+2:.1f}" cy="{c[1]+2:.1f}" rx="7" ry="3.5" fill="{SLATE}" opacity="0.3"></ellipse><circle cx="{c[0]:.1f}" cy="{c[1]-6:.1f}" r="7" fill="#5f9a4a"></circle><circle cx="{c[0]-2:.1f}" cy="{c[1]-8:.1f}" r="3.5" fill="#8cc061"></circle><rect x="{c[0]-4:.1f}" y="{c[1]-2:.1f}" width="8" height="5" fill="#b4532f"></rect>')
        for (px, py) in ((0.8, 0.9), (1.0, 1.0)):
            mini_box(add, gx + px, gy + py, 0.12, 0.12, h, 5, "#e2d3b6")
    if name == "bank":
        for i in range(3):
            for j in range(2):
                x0, y0 = gx + 0.45 + i * 0.7, gy + 0.6 + j * 0.8
                q = [up(iso(*c), h + 3) for c in ((x0, y0), (x0 + 0.45, y0), (x0 + 0.45, y0 + 0.5), (x0, y0 + 0.5))]
                add(P(q, "url(#glass)"))
                add(P([q[0], q[1], lerp(q[1], q[2], 0.25), lerp(q[0], q[3], 0.25)], "#ffffff", 'opacity="0.35"'))
        add(f'<line x1="{up(iso(gx+1.4, gy+1.3), h)[0]:.1f}" y1="{up(iso(gx+1.4, gy+1.3), h)[1]:.1f}" x2="{up(iso(gx+1.4, gy+1.3), h)[0]:.1f}" y2="{up(iso(gx+1.4, gy+1.3), h)[1]-34:.1f}" stroke="#3a3f44" stroke-width="2"></line>')
        f = up(iso(gx + 1.4, gy + 1.3), h + 34)
        add(f'<path d="M {f[0]:.1f} {f[1]:.1f} l 16 3 l -2 5 l 2 5 l -16 -3 z" fill="#2e7d4f"></path>')
    if name == "permits":
        for (px, py) in ((0.5, 0.5), (1.2, 0.5), (1.9, 0.5)):
            A_, B_, C_, D_ = mini_box(add, gx + px, gy + py, 0.42, 0.36, h, 10, "#a7aeb3")
            c = up(iso(gx + px + 0.21, gy + py + 0.18), h + 10)
            add(f'<ellipse cx="{c[0]:.1f}" cy="{c[1]:.1f}" rx="11" ry="5.5" fill="#6c747b"></ellipse><ellipse cx="{c[0]:.1f}" cy="{c[1]:.1f}" rx="7" ry="3.5" fill="#3a3f44"></ellipse>')
    if name == "mill":
        for (px, py) in ((0.6, 0.5), (1.4, 0.5), (2.2, 0.5)):
            mini_box(add, gx + px, gy + py, 0.3, 0.9, h, 8, "#8d7258")


def box(name, gx, gy, w, d, h, col, kind="triplex", cornice="#5a3a2a"):
    A_, B_, C_, D_ = iso(gx, gy), iso(gx + w, gy), iso(gx + w, gy + d), iso(gx, gy + d)
    cast_box(gx, gy, w, d, h)
    s = [f'<g data-name="{name}">']
    add = s.append
    left = [D_, C_, up(C_, h), up(D_, h)]
    right = [C_, B_, up(B_, h), up(C_, h)]
    topf = [up(A_, h), up(B_, h), up(C_, h), up(D_, h)]
    lcol, rcol = col, shd(col, 0.40)
    add(P(left, lcol))
    add(P(right, rcol))
    if kind in ("triplex", "cafe", "rent", "mill"):
        add(P(left, "url(#bricksL)"))
        add(P(right, "url(#bricksR)"))
    add(P(left, "url(#faceV)"))
    add(P(right, "url(#faceV)", 'opacity="0.7"'))
    # windows on both faces
    if kind not in ("silo", "truck"):
        rows = max(1, int((h - 18) // 32))
        for face, (a, b), glass, frame in (("L", (D_, C_), "url(#glass)", "#f3e6c8"),
                                           ("R", (C_, B_), "url(#glassDark)", shd("#f3e6c8", 0.45))):
            span = w if face == "L" else d
            n = max(1, int(span * 2))
            for r in range(rows):
                z0 = 10 + r * 32
                for i in range(n):
                    f0, f1 = (i + 0.22) / n, (i + 0.72) / n
                    if face == "L" and r == 0 and i == 0 and kind in ("bank", "rent", "cafe", "mill", "permits", "triplex"):
                        add(P(quad(a, b, f0 - 0.02, f1 + 0.02, -1, 31), deep(STONE, 0.1) if face == "L" else STONE))
                        add(P(quad(a, b, f0, f1, 0, 28), "#5a3a2a"))
                        add(P(quad(a, b, f0, f0 + (f1 - f0) * 0.3, 0, 28), SLATE, 'opacity="0.35"'))
                        continue
                    if kind == "permits":
                        continue
                    if kind == "bank" and r == 0:
                        continue
                    add(P(quad(a, b, f0 - 0.015, f1 + 0.015, z0 + 20, z0 + 24), STONE if face == "L" else shd(STONE, 0.45)))
                    add(P(quad(a, b, f0, f1, z0, z0 + 20), frame))
                    add(P(quad(a, b, f0 + 0.03 / n * 2, f1 - 0.03 / n * 2, z0 + 2, z0 + 18), glass))
                    add(P(quad(a, b, f0 + 0.03 / n * 2, f1 - 0.03 / n * 2, z0 + 14, z0 + 18), SLATE, 'opacity="0.35"'))
                    if face == "L":
                        add(P([face_pt(a, b, f0 + (f1 - f0) * 0.5, z0 + 18), face_pt(a, b, f0 + (f1 - f0) * 0.75, z0 + 18),
                               face_pt(a, b, f0 + (f1 - f0) * 0.35, z0 + 2), face_pt(a, b, f0 + (f1 - f0) * 0.1, z0 + 2)], "#ffffff", 'opacity="0.28"'))
            if kind == "permits":
                for r in range(rows):
                    z0 = 10 + r * 32
                    add(P(quad(a, b, 0.04, 0.96, z0, z0 + 18), glass))
                    add(P(quad(a, b, 0.04, 0.96, z0 + 14, z0 + 18), SLATE, 'opacity="0.3"'))
                    for k in range(1, int(span * 4)):
                        add(P(quad(a, b, k / (span * 4) - 0.004, k / (span * 4) + 0.004, z0, z0 + 18), frame))
    # balconies and an outdoor staircase on the triplexes
    if kind == "triplex":
        for r in range(1, max(1, int((h - 18) // 32))):
            z = 7 + r * 32
            base0, base1 = face_pt(D_, C_, 0.04, z), face_pt(D_, C_, 0.96, z)
            out = (-7, 3.5)
            o0, o1 = (base0[0] + out[0], base0[1] + out[1]), (base1[0] + out[0], base1[1] + out[1])
            add(P(quad(D_, C_, 0.04, 0.96, z - 9, z), SLATE, 'opacity="0.22"'))
            add(P([base0, base1, o1, o0], "#5a4d44"))
            add(P([o0, o1, (o1[0], o1[1] + 2.5), (o0[0], o0[1] + 2.5)], "#3a322d"))
            add(f'<line x1="{o0[0]:.1f}" y1="{o0[1]-13:.1f}" x2="{o1[0]:.1f}" y2="{o1[1]-13:.1f}" stroke="{INK}" stroke-width="1.8"></line>')
            steps = 14
            for k in range(steps + 1):
                q = lerp(o0, o1, k / steps)
                add(f'<line x1="{q[0]:.1f}" y1="{q[1]:.1f}" x2="{q[0]:.1f}" y2="{q[1]-13:.1f}" stroke="{INK}" stroke-width="1"></line>')
        if h >= 80:
            g0 = face_pt(D_, C_, 0.96, 0)
            g1 = face_pt(D_, C_, 0.66, 39)
            out = (-9, 4.5)
            g0, g1 = (g0[0] + out[0], g0[1] + out[1]), (g1[0] + out[0], g1[1] + out[1])
            S(f'<line x1="{g0[0]:.1f}" y1="{g0[1]:.1f}" x2="{g1[0]+SHX*39:.1f}" y2="{g1[1]+39+SHY*39:.1f}" stroke="{SLATE}" stroke-width="4"></line>')
            add(f'<line x1="{g0[0]:.1f}" y1="{g0[1]:.1f}" x2="{g1[0]:.1f}" y2="{g1[1]:.1f}" stroke="{INK}" stroke-width="3.2"></line>')
            add(f'<line x1="{g0[0]:.1f}" y1="{g0[1]-12:.1f}" x2="{g1[0]:.1f}" y2="{g1[1]-12:.1f}" stroke="{INK}" stroke-width="1.5"></line>')
            for k in range(1, 9):
                q = lerp(g0, g1, k / 9)
                add(f'<line x1="{q[0]-4:.1f}" y1="{q[1]+1:.1f}" x2="{q[0]+4:.1f}" y2="{q[1]-1:.1f}" stroke="{INK}" stroke-width="2"></line>')
    if kind == "bank":
        for k in range(5):
            f = 0.12 + k * 0.19
            add(P(quad(D_, C_, f, f + 0.05, 6, 52), lit(col, 0.45)))
            add(P(quad(D_, C_, f + 0.035, f + 0.05, 6, 52), SLATE, 'opacity="0.22"'))
            if k < 4:
                add(P(quad(D_, C_, f + 0.07, f + 0.17, 10, 46), "url(#glassDark)"))
        add(P(quad(D_, C_, 0.04, 0.96, 52, 60), lit(col, 0.35)))
        add(P(quad(D_, C_, 0.04, 0.96, 46, 52), SLATE, 'opacity="0.25"'))
        add(P(quad(D_, C_, 0.06, 0.94, 0, 6), lit(col, 0.2)))
    if kind == "mill":
        add(P(quad(D_, C_, 0.62, 0.9, 0, 40), "#7d6248"))
        for k in range(6):
            add(P(quad(D_, C_, 0.62, 0.9, 3 + k * 6.5, 4.5 + k * 6.5), lit("#7d6248", 0.3)))
        add(P(quad(D_, C_, 0.62, 0.9, 34, 40), SLATE, 'opacity="0.3"'))
    if kind == "cafe":
        aw0, aw1 = face_pt(D_, C_, 0.08, 34), face_pt(D_, C_, 0.92, 34)
        out = (-10, 5)
        n = 8
        for k in range(n):
            p0, p1 = lerp(aw0, aw1, k / n), lerp(aw0, aw1, (k + 1) / n)
            c = "#2e7d4f" if k % 2 == 0 else CREAM
            add(P([p0, p1, (p1[0] + out[0], p1[1] + out[1] + 10), (p0[0] + out[0], p0[1] + out[1] + 10)], c))
        add(P([aw0, aw1, (aw1[0] + out[0], aw1[1] + out[1] + 10), (aw0[0] + out[0], aw0[1] + out[1] + 10)], "url(#faceV)"))
    if kind == "rent":
        q = quad(D_, C_, 0.55, 0.85, 14, 30)
        add(P(q, "#ffffff"))
        add(P(quad(D_, C_, 0.55, 0.85, 14, 17), SLATE, 'opacity="0.2"'))
        cx, cy = (q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2
        add(f'<text x="0" y="0" transform="matrix(1 0.5 0 1 {cx:.1f} {cy+4:.1f})" text-anchor="middle" font-family="Fredoka, sans-serif" font-size="10" font-weight="700" fill="#b3261e">À LOUER</text>')
    # cornice and the shadow it throws
    if kind not in ("silo", "truck"):
        add(P(quad(D_, C_, 0, 1, h - 16, h - 8), SLATE, 'opacity="0.22"'))
        add(P(quad(C_, B_, 0, 1, h - 16, h - 8), SLATE, 'opacity="0.18"'))
        add(P(quad(D_, C_, -0.01, 1.0, h - 8, h + 2), cornice))
        add(P(quad(C_, B_, 0, 1.01, h - 8, h + 2), shd(cornice, 0.45)))
        add(P(quad(D_, C_, -0.01, 1.0, h, h + 2), lit(cornice, 0.35)))
    # roof with parapet and an inset gravel deck
    add(P([up(A_, h + 2), up(B_, h + 2), up(C_, h + 2), up(D_, h + 2)], lit(cornice if kind not in ("silo", "truck") else col, 0.25)))
    if kind not in ("truck",):
        inset = 0.12
        ia, ib, ic, idd = iso(gx + inset, gy + inset), iso(gx + w - inset, gy + inset), iso(gx + w - inset, gy + d - inset), iso(gx + inset, gy + d - inset)
        roofc = "#bdb4a7" if kind != "bank" else lit(col, 0.2)
        add(P([up(ia, h), up(ib, h), up(ic, h), up(idd, h)], roofc))
        add(P([up(ia, h), up(ib, h), up(lerp(ib, ic, 0.12), h), up(lerp(ia, idd, 0.12), h)], SLATE, 'opacity="0.25"'))
        add(P([up(ia, h), up(lerp(ia, ib, 0.1), h), up(lerp(idd, ic, 0.1), h), up(idd, h)], SLATE, 'opacity="0.2"'))
        add(P([up(ia, h), up(ib, h), up(ic, h), up(idd, h)], "url(#gravel)"))
        roof_details(add, name, gx, gy, w, d, h)
        if kind in ("triplex", "rent", "cafe"):
            cx, cy = iso(gx + w * 0.7, gy + d * 0.3)
            add(P([(cx - 6, cy - h - 3), (cx, cy - h - 6), (cx, cy - h - 18), (cx - 6, cy - h - 15)], lit("#8a8178", 0.1)))
            add(P([(cx, cy - h - 6), (cx + 6, cy - h - 3), (cx + 6, cy - h - 15), (cx, cy - h - 18)], shd("#8a8178", 0.4)))
            add(P([(cx - 6, cy - h - 15), (cx, cy - h - 18), (cx + 6, cy - h - 15), (cx, cy - h - 12)], lit("#8a8178", 0.35)))
    # rim light on the lit edges, contact shadow at the foot
    add(f'<line x1="{up(D_, h+2)[0]:.1f}" y1="{up(D_, h+2)[1]:.1f}" x2="{up(C_, h+2)[0]:.1f}" y2="{up(C_, h+2)[1]:.1f}" stroke="{SUN}" stroke-width="1.5" opacity="0.8"></line>')
    add(f'<line x1="{C_[0]:.1f}" y1="{C_[1]:.1f}" x2="{up(C_, h)[0]:.1f}" y2="{up(C_, h)[1]:.1f}" stroke="{SUN}" stroke-width="1.2" opacity="0.45"></line>')
    add(P([D_, C_, up(C_, 7), up(D_, 7)], SLATE, 'opacity="0.18"'))
    s.append("</g>")
    objects.append(((gx + w / 2) + (gy + d / 2), "\n".join(s)))


def silo(gx, gy, w, d, h):
    c = iso(gx + w / 2, gy + d / 2)
    r = w / 2
    rx, ry = r * 70.7, r * 35.35
    S(f'<path d="M {c[0]-rx:.1f} {c[1]:.1f} L {c[0]-rx+SHX*h:.1f} {c[1]+SHY*h:.1f} A {rx:.1f} {ry:.1f} 0 0 0 {c[0]+rx+SHX*h:.1f} {c[1]+SHY*h:.1f} L {c[0]+rx:.1f} {c[1]:.1f} A {rx:.1f} {ry:.1f} 0 0 1 {c[0]-rx:.1f} {c[1]:.1f} Z" fill="{SLATE}"></path>')
    s = []
    s.append(f'<path d="M {c[0]-rx:.1f} {c[1]-h:.1f} L {c[0]-rx:.1f} {c[1]:.1f} A {rx:.1f} {ry:.1f} 0 0 0 {c[0]+rx:.1f} {c[1]:.1f} L {c[0]+rx:.1f} {c[1]-h:.1f} Z" fill="url(#cyl)"></path>')
    for k in range(1, 6):
        yy = c[1] - h * k / 6
        s.append(f'<path d="M {c[0]-rx:.1f} {yy:.1f} A {rx:.1f} {ry:.1f} 0 0 0 {c[0]+rx:.1f} {yy:.1f}" fill="none" stroke="{SLATE}" stroke-opacity="0.22" stroke-width="1.5"></path>')
    s.append(f'<ellipse cx="{c[0]:.1f}" cy="{c[1]-h:.1f}" rx="{rx:.1f}" ry="{ry:.1f}" fill="{lit("#d8d0c2", 0.3)}"></ellipse>')
    s.append(f'<path d="M {c[0]-rx:.1f} {c[1]-h:.1f} Q {c[0]:.1f} {c[1]-h-34:.1f} {c[0]+rx:.1f} {c[1]-h:.1f} A {rx:.1f} {ry:.1f} 0 0 1 {c[0]-rx:.1f} {c[1]-h:.1f} Z" fill="{lit("#b4532f", 0.1)}"></path>')
    s.append(f'<path d="M {c[0]:.1f} {c[1]-h-17:.1f} Q {c[0]+rx*0.6:.1f} {c[1]-h-10:.1f} {c[0]+rx:.1f} {c[1]-h:.1f} A {rx:.1f} {ry:.1f} 0 0 1 {c[0]:.1f} {c[1]-h+ry:.1f} Z" fill="{SLATE}" opacity="0.3"></path>')
    s.append(f'<path d="M {c[0]-rx+5:.1f} {c[1]-h+10:.1f} L {c[0]-rx+5:.1f} {c[1]-8:.1f}" stroke="#ffffff" stroke-width="2.5" opacity="0.45"></path>')
    objects.append(((gx + w / 2) + (gy + d / 2), "\n".join(s)))


def truck(gx, gy):
    # body and cab as two boxes, serving hatch and awning on the lit side
    s = []
    for (x0, w, h, col) in [(gx, 1.0, 34, "#e8a93a"), (gx + 1.0, 0.32, 26, "#e8a93a")]:
        d = 0.62
        A_, B_, C_, D_ = iso(x0, gy), iso(x0 + w, gy), iso(x0 + w, gy + d), iso(x0, gy + d)
        cast_box(x0, gy, w, d, h + 6)
        s.append(P([D_, C_, up(C_, h), up(D_, h)], up_col := col))
        s.append(P([D_, C_, up(C_, h), up(D_, h)], "url(#faceV)"))
        s.append(P([C_, B_, up(B_, h), up(C_, h)], shd(col, 0.4)))
        s.append(P([up(A_, h), up(B_, h), up(C_, h), up(D_, h)], lit(col, 0.3)))
        if w == 1.0:
            s.append(P(quad(D_, C_, 0.1, 0.9, 12, 28), "url(#warmInside)"))
            s.append(P(quad(D_, C_, 0.1, 0.9, 24, 28), SLATE, 'opacity="0.35"'))
            a0, a1 = face_pt(D_, C_, 0.06, 30), face_pt(D_, C_, 0.94, 30)
            for k in range(7):
                p0, p1 = lerp(a0, a1, k / 7), lerp(a0, a1, (k + 1) / 7)
                s.append(P([p0, p1, (p1[0] - 9, p1[1] + 12), (p0[0] - 9, p0[1] + 12)], "#b3261e" if k % 2 == 0 else CREAM))
            s.append(P([a0, a1, (a1[0] - 9, a1[1] + 12), (a0[0] - 9, a0[1] + 12)], "url(#faceV)"))
            s.append(P(quad(A_, B_, 0.15, 0.85, h, h + 7), INK))
        else:
            s.append(P(quad(C_, B_, 0.15, 0.85, 12, 22), "url(#glass)"))
            s.append(P(quad(D_, C_, 0.2, 0.8, 12, 22), "url(#glass)"))
    for f in (0.2, 0.85):
        p = iso(gx + f * 1.32, gy + 0.62)
        s.append(f'<ellipse cx="{p[0]:.1f}" cy="{p[1]-3:.1f}" rx="6" ry="7" fill="{INK}"></ellipse><ellipse cx="{p[0]-1:.1f}" cy="{p[1]-3:.1f}" rx="2.5" ry="3" fill="#a7aeb3"></ellipse>')
    objects.append((gx + 0.66 + gy + 0.31, "\n".join(s)))


def tree(gx, gy, size=1.0):
    b = iso(gx, gy)
    hc = 40 * size
    S(f'<ellipse cx="{b[0]+SHX*hc:.1f}" cy="{b[1]+SHY*hc:.1f}" rx="{20*size:.1f}" ry="{10*size:.1f}" fill="{SLATE}"></ellipse>')
    S(f'<line x1="{b[0]:.1f}" y1="{b[1]:.1f}" x2="{b[0]+SHX*hc*0.6:.1f}" y2="{b[1]+SHY*hc*0.6:.1f}" stroke="{SLATE}" stroke-width="4"></line>')
    s = [f'<ellipse cx="{b[0]:.1f}" cy="{b[1]:.1f}" rx="6" ry="3" fill="{SLATE}" opacity="0.4"></ellipse>',
         rect(b[0] - 2.5, b[1] - 24 * size, 5, 24 * size, "#5a3a2a"), rect(b[0] - 2.5, b[1] - 24 * size, 2, 24 * size, "#7d5a42")]
    cy = b[1] - 36 * size
    lobes = [(-9, 4, 12), (0, -6, 15), (10, 3, 12), (2, 8, 11)]
    for dx, dy, r in lobes:
        s.append(f'<circle cx="{b[0]+dx*size+3:.1f}" cy="{cy+dy*size+4:.1f}" r="{r*size:.1f}" fill="#3d6a3f"></circle>')
    for dx, dy, r in lobes:
        s.append(f'<circle cx="{b[0]+dx*size:.1f}" cy="{cy+dy*size:.1f}" r="{r*size:.1f}" fill="#5f9a4a"></circle>')
        s.append(f'<circle cx="{b[0]+dx*size:.1f}" cy="{cy+dy*size:.1f}" r="{r*size:.1f}" fill="url(#leaves)"></circle>')
    for dx, dy, r in [(-11, 0, 6), (-2, -11, 7)]:
        s.append(f'<circle cx="{b[0]+dx*size:.1f}" cy="{cy+dy*size:.1f}" r="{r*size:.1f}" fill="#8cc061" opacity="0.85"></circle>')
    objects.append((gx + gy, "\n".join(s)))


def lamp(gx, gy):
    b = iso(gx, gy)
    S(f'<line x1="{b[0]:.1f}" y1="{b[1]:.1f}" x2="{b[0]+SHX*46:.1f}" y2="{b[1]+SHY*46:.1f}" stroke="{SLATE}" stroke-width="3"></line>')
    s = (f'<rect x="{b[0]-1.5:.1f}" y="{b[1]-46:.1f}" width="3" height="46" fill="#3a3f44"></rect>'
         f'<rect x="{b[0]-1.5:.1f}" y="{b[1]-46:.1f}" width="1.2" height="46" fill="#7d868d"></rect>'
         f'<path d="M {b[0]:.1f} {b[1]-44:.1f} q 0 -8 9 -8" stroke="#3a3f44" stroke-width="2.5" fill="none"></path>'
         f'<rect x="{b[0]+6:.1f}" y="{b[1]-54:.1f}" width="9" height="5" rx="2" fill="#3a3f44"></rect>'
         f'<ellipse cx="{b[0]+10.5:.1f}" cy="{b[1]-48.5:.1f}" rx="3.5" ry="1.5" fill="#fff1c4"></ellipse>')
    objects.append((gx + gy, s))


def cone(gx, gy):
    b = iso(gx, gy)
    S(f'<line x1="{b[0]:.1f}" y1="{b[1]:.1f}" x2="{b[0]+SHX*14:.1f}" y2="{b[1]+SHY*14:.1f}" stroke="{SLATE}" stroke-width="5" stroke-linecap="round"></line>')
    s = (f'<polygon points="{b[0]-6:.1f},{b[1]:.1f} {b[0]:.1f},{b[1]+3:.1f} {b[0]+6:.1f},{b[1]:.1f} {b[0]:.1f},{b[1]-3:.1f}" fill="#3a3430"></polygon>'
         f'<polygon points="{b[0]-4.5:.1f},{b[1]-1:.1f} {b[0]:.1f},{b[1]-16:.1f} {b[0]:.1f},{b[1]+1.5:.1f}" fill="#f08a2c"></polygon>'
         f'<polygon points="{b[0]:.1f},{b[1]+1.5:.1f} {b[0]:.1f},{b[1]-16:.1f} {b[0]+4.5:.1f},{b[1]-1:.1f}" fill="{shd("#f08a2c", 0.4)}"></polygon>'
         f'<polygon points="{b[0]-3.2:.1f},{b[1]-6:.1f} {b[0]+3.2:.1f},{b[1]-6:.1f} {b[0]+2.4:.1f},{b[1]-9:.1f} {b[0]-2.4:.1f},{b[1]-9:.1f}" fill="#fff7e8"></polygon>')
    objects.append((gx + gy, s))


def car(gx, gy, col, along="gx"):
    s = []
    if along == "gx":
        parts = [(gx, gy, 0.8, 0.36, 11, col), (gx + 0.18, gy + 0.03, 0.42, 0.3, 9, col)]
    else:
        parts = [(gx, gy, 0.36, 0.8, 11, col), (gx + 0.03, gy + 0.2, 0.3, 0.42, 9, col)]
    z = 0
    for i, (x0, y0, w, d, h, c) in enumerate(parts):
        A_, B_, C_, D_ = iso(x0, y0), iso(x0 + w, y0), iso(x0 + w, y0 + d), iso(x0, y0 + d)
        if i == 0:
            cast_box(x0, y0, w, d, 20)
        A_, B_, C_, D_ = up(A_, z), up(B_, z), up(C_, z), up(D_, z)
        s.append(P([D_, C_, up(C_, h), up(D_, h)], c))
        s.append(P([C_, B_, up(B_, h), up(C_, h)], shd(c, 0.42)))
        s.append(P([up(A_, h), up(B_, h), up(C_, h), up(D_, h)], lit(c, 0.3)))
        if i == 1:
            s.append(P(quad(D_, C_, 0.08, 0.92, 2, 8), "url(#glass)"))
            s.append(P(quad(C_, B_, 0.1, 0.9, 2, 8), "url(#glassDark)"))
        z += h
    for f in (0.2, 0.8):
        p = iso(gx + (f * 0.8 if along == "gx" else 0.36), gy + (0.36 if along == "gx" else f * 0.8))
        s.append(f'<ellipse cx="{p[0]:.1f}" cy="{p[1]-2:.1f}" rx="4" ry="4.5" fill="{INK}"></ellipse>')
    objects.append(((gx + gy) + 0.6, "\n".join(s)))


def person(x, y, shirt, skin, hair, key, walking=False, scale=0.45):
    S(f'<ellipse cx="{x+12:.1f}" cy="{y+100*scale+3:.1f}" rx="13" ry="3.5" fill="{SLATE}"></ellipse>')
    s = [f'<ellipse cx="{x:.1f}" cy="{y+100*scale:.1f}" rx="9" ry="3" fill="{SLATE}" opacity="0.45"></ellipse>',
         f'<g transform="translate({x},{y}) scale({scale})">']
    if walking:
        s.append(f'<rect x="-10" y="64" width="10" height="36" rx="3" fill="#3b3a44" transform="rotate(12 -5 64)"></rect><rect x="2" y="64" width="10" height="36" rx="3" fill="{shd("#3b3a44")}" transform="rotate(-12 7 64)"></rect>')
    else:
        s.append(f'<rect x="-12" y="64" width="10" height="36" rx="3" fill="#3b3a44"></rect><rect x="2" y="64" width="10" height="36" rx="3" fill="{shd("#3b3a44")}"></rect>')
    s.append(f'<rect x="13" y="22" width="9" height="36" rx="4.5" fill="{shd(shirt, 0.45)}"></rect>')
    s.append(f'<rect x="-18" y="18" width="36" height="52" rx="14" fill="{shirt}"></rect><rect x="-18" y="18" width="36" height="52" rx="14" fill="url(#faceH)"></rect>')
    s.append(f'<rect x="-21" y="22" width="9" height="36" rx="4.5" fill="{lit(shirt, 0.12)}"></rect>')
    s.append(f'<circle cx="0" cy="0" r="16" fill="{skin}"></circle><circle cx="0" cy="0" r="16" fill="url(#roundLit)"></circle>')
    s.append(f'<ellipse cx="0" cy="-11" rx="17" ry="8.5" fill="{hair}"></ellipse>')
    s.append('</g>')
    objects.append((key, "\n".join(s)))


boxes = [
    ("tri1", 0.4, 0.4, 1.7, 1.8, 95, "#b4532f", "triplex", "#5a3a2a"),
    ("tri2", 2.3, 0.4, 1.7, 1.8, 115, "#9e4a2c", "triplex", "#3f6b4f"),
    ("tri3", 4.2, 0.4, 1.5, 1.8, 85, "#c06a43", "triplex", "#5a3a2a"),
    ("tri4", 0.4, 2.6, 1.6, 1.8, 75, "#8f4f35", "triplex", "#e2d3b6"),
    ("cafe", 2.2, 2.6, 1.8, 1.8, 70, "#c06a43", "cafe", "#5a3a2a"),
    ("bank", 7.5, 0.8, 2.8, 2.6, 135, "#d6cfc2", "bank", "#b9b0a1"),
    ("tri5", 10.6, 0.5, 1.1, 1.6, 75, "#b4532f", "triplex", "#3f6b4f"),
    ("rent", 0.8, 6.6, 2.4, 1.7, 70, "#d9b48f", "rent", "#8a6f55"),
    ("mill", 7.6, 6.6, 3.0, 1.9, 80, "#a78a6a", "mill", "#6f5a48"),
    ("permits", 8.0, 9.4, 2.8, 2.0, 100, "#9fb3c8", "permits", "#7c8fa3"),
]
for b in boxes:
    box(*b)
silo(10.9, 6.8, 0.8, 0.8, 160)
truck(2.3, 5.12)
for t in [(1.0, 9.4), (1.2, 11.0), (4.4, 9.4), (4.9, 10.8), (3.8, 11.2), (0.9, 10.2), (2.0, 11.4)]:
    tree(*t)
for t in [(0.9, 4.72), (4.9, 4.72), (3.9, 6.3), (5.2, 6.3), (7.3, 4.3), (7.3, 8.9), (11.2, 4.72)]:
    tree(*t, size=0.85)
for l in [(5.85, 4.75), (7.15, 6.25), (11.8, 4.75), (5.85, 8.4)]:
    lamp(*l)
for c in [(6.15, 1.6), (6.15, 2.1), (6.15, 2.6), (6.15, 3.1), (6.35, 3.4)]:
    cone(*c)
car(8.0, 5.1, "#3f7f8f")
car(9.3, 5.1, "#e2d3b6")
car(6.6, 8.6, "#7a8f3c", along="gy")
# customers in line and the player walking to the bank
person(680, 335, "#7a8f3c", "#d9a37c", "#4a5a2a", 3.9 + 4.6)
person(700, 345, "#6b4a8c", "#f3d2b5", "#c9a24a", 4.1 + 4.65)
person(720, 355, "#c0573a", "#8d5a3b", INK, 4.3 + 4.7)

objects.sort(key=lambda o: o[0])

LABEL = (f'<text x="300" y="566" text-anchor="middle" font-family="Fredoka, sans-serif" font-size="15" font-weight="600" fill="{INK}">Parc La Fontaine</text>'
         f'<text x="1025" y="597" text-anchor="middle" font-family="Nunito, sans-serif" font-size="12" font-weight="800" fill="#e9e2d0" letter-spacing="1" transform="rotate(26.57 1025 597)">AV. MONT-ROYAL</text>')
PATH = """<polyline points="720,410 860,480 927,446" fill="none" stroke="{{accent}}" stroke-width="3.5" stroke-dasharray="7 7" stroke-linecap="round" stroke-linejoin="round"></polyline>
<circle cx="927" cy="446" r="6" fill="{{accent}}"></circle>
<ellipse cx="800" cy="451" rx="15" ry="5" fill="none" stroke="{{accent}}" stroke-width="3"></ellipse>"""
AVATAR = f"""<ellipse cx="812" cy="452" rx="13" ry="3.5" fill="{SLATE}" opacity="0.3"></ellipse>
<g transform="translate(800,405) scale(0.45)">
<rect x="-10" y="64" width="10" height="36" rx="3" fill="#3b3a44" transform="rotate(12 -5 64)"></rect>
<rect x="2" y="64" width="10" height="36" rx="3" fill="{shd("#3b3a44")}" transform="rotate(-12 7 64)"></rect>
<rect x="13" y="22" width="9" height="36" rx="4.5" fill="{shd("#2f6fb0", 0.45)}"></rect>
<rect x="-18" y="18" width="36" height="52" rx="14" fill="#2f6fb0"></rect><rect x="-18" y="18" width="36" height="52" rx="14" fill="url(#faceH)"></rect>
<rect x="-21" y="22" width="9" height="36" rx="4.5" fill="{lit("#2f6fb0", 0.12)}"></rect>
<circle cx="0" cy="0" r="16" fill="#f0c4a0"></circle><circle cx="0" cy="0" r="16" fill="url(#roundLit)"></circle>
<ellipse cx="0" cy="-10" rx="17" ry="9" fill="#3b2a20"></ellipse>
</g>"""

WORLD = "\n".join(ground_layer) + f'\n<g opacity="0.38" filter="url(#soft2)">\n' + "\n".join(shadow_layer) + "\n</g>\n" + \
    "\n".join(o[1] for o in objects) + "\n" + LABEL + "\n" + PATH + "\n" + AVATAR + "\n" + overlays(grain="0.40")

# reuse the interface of the original city board, with links to the new boards
src = (PROJECT / "Ville.dc.html").read_text()
ui = src[src.index("<header"):src.index("</x-dc>")]
ui = ui[:ui.rindex("</div>")]  # drop the closing tag of the board container
ui = ui.replace('href="Main.dc.html"', 'href="RueLumiere.dc.html"')
ui = ui.replace("La Caisse populaire Saint-Prudent rappelle qu'elle prête à tout le monde. Surtout à ceux qui n'en ont pas besoin.",
                "Chantier sur Saint-Denis : la Ville ajoute 400 cônes orange. « Ils font partie du paysage », assure un porte-parole.")

PAGE = f"""<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Magnat · La ville (texture et ombre)</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&amp;family=Nunito:wght@500;700;800&amp;display=swap">
<style>
body{{margin:0}}
a{{color:#2b2622}}a:hover{{color:#000000}}
</style>
</helmet>
<div style="position: relative; width: 1440px; height: 900px; overflow: hidden; background: #dcecf0; font-family: 'Nunito', sans-serif; color: #2b2622">
<svg width="1440" height="900" viewBox="0 0 1440 900" aria-hidden="true" style="position: absolute; left: 0; top: 0">
{DEFS}
{EXTRA_DEFS}
{WORLD}
</svg>
{ui}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"accent":{{"editor":"color","default":"#2e7d4f","options":["#2e7d4f","#2f6fb0","#b4532f"]}},"$preview":{{"width":1440,"height":900}}}}'>
class Component extends DCLogic {{
  renderVals() {{
    return {{ accent: this.props.accent ?? '#2e7d4f' }};
  }}
}}
</script>
</body>
</html>
"""
OUT.write_text(scope_ids(PAGE, "vl"))
print(OUT, len(PAGE))
