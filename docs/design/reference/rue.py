"""Street side view with texture and shade. Writes design/project/RueLumiere.dc.html."""
import math
from pathlib import Path
from light import (scope_ids, INK, CREAM, SLATE, SUN, STONE, DEFS, overlays, mix, lit, shd, deep, poly, rect)

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "design" / "project" / "RueLumiere.dc.html"
GROUND = 646  # foot of the facades

o = []
A = o.append


def bez(p0, p1, p2, p3, t):
    u = 1 - t
    return (u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
            u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1])


# ---------- sky and far city ----------
A(rect(0, 0, 1440, 900, "url(#sky)"))


def cloud(cx, cy, s):
    A(f'<g opacity="0.95">')
    A(f'<ellipse cx="{cx+6}" cy="{cy+10*s}" rx="{100*s}" ry="{20*s}" fill="#d9e6ec" filter="url(#soft2)"></ellipse>')
    for dx, dy, r in [(-60, 2, 30), (-20, -14, 40), (30, -6, 34), (70, 6, 24)]:
        A(f'<circle cx="{cx+dx*s}" cy="{cy+dy*s}" r="{r*s}" fill="#fbfdfd"></circle>')
    A(f'<ellipse cx="{cx}" cy="{cy+12*s}" rx="{96*s}" ry="{14*s}" fill="#e3edf1"></ellipse>')
    A('</g>')


cloud(230, 150, 1.0)
cloud(1110, 118, 1.25)
cloud(700, 96, 0.7)

haze = mix("#b9c9d2", SLATE, 0.12)
# Mount Royal and its cross, hazy, behind the roofs
A(f'<path d="M 520 300 C 600 200, 700 168, 790 172 C 880 176, 960 220, 1040 300 Z" fill="{mix(haze, "#9fb79a", 0.35)}" opacity="0.85"></path>')
A(f'<rect x="776" y="128" width="4" height="46" fill="{haze}"></rect><rect x="766" y="140" width="24" height="4" fill="{haze}"></rect>')
for x, w, h in [(560, 46, 120), (612, 30, 150), (650, 54, 104), (880, 40, 132), (928, 58, 96)]:
    A(rect(x, 300 - h, w, h, haze, 'opacity="0.75"'))
    A(rect(x + w * 0.62, 300 - h, w * 0.38, h, SLATE, 'opacity="0.10"'))

# ---------- buildings ----------


def window(x, y, w, h, curtain=None):
    A(rect(x - 7, y - 11, w + 14, 11, STONE))
    A(rect(x - 7, y - 11, w + 14, 2.5, lit(STONE, 0.6)))
    A(rect(x - 3, y, w + 6, h, "#f3e6c8"))
    gx, gy, gw, gh = x + 3, y + 3, w - 6, h - 6
    A(rect(gx, gy, gw, gh, "url(#glass)"))
    if curtain:
        A(poly([(gx, gy), (gx + gw * 0.34, gy), (gx + gw * 0.18, gy + gh * 0.6), (gx, gy + gh * 0.75)], curtain, 'opacity="0.9"'))
    A(poly([(gx + gw * 0.55, gy), (gx + gw * 0.8, gy), (gx + gw * 0.25, gy + gh), (gx, gy + gh)], "#ffffff", 'opacity="0.22"'))
    A(rect(x + w / 2 - 2, y, 4, h, "#f3e6c8"))
    A(rect(x - 3, y + h * 0.45, w + 6, 4, "#f3e6c8"))
    # recess shadow: lintel on top, left jamb on the left (sun from the upper left)
    A(poly([(gx, gy), (gx + gw, gy), (gx + gw, gy + 8), (gx + 7, gy + 8), (gx + 7, gy + gh), (gx, gy + gh)], SLATE, 'opacity="0.38"'))
    A(rect(x - 7, y + h, w + 14, 7, STONE))
    A(rect(x - 7, y + h, w + 14, 2, lit(STONE, 0.6)))
    A(rect(x - 4, y + h + 7, w + 8, 12, "url(#dropDown)", 'opacity="0.7"'))


def balcony(x0, x1, y):
    A(rect(x0, y + 8, x1 - x0, 26, "url(#dropDown)", 'opacity="0.85"'))
    # shadows of the balusters on the wall, offset down and right
    for bx in range(int(x0) + 6, int(x1) - 4, 10):
        A(rect(bx + 7, y - 30, 2, 34, SLATE, 'opacity="0.20"'))
    A(rect(x0 + 7, y - 30, x1 - x0, 3, SLATE, 'opacity="0.20"'))
    for bx in range(int(x0) + 6, int(x1) - 4, 10):
        A(rect(bx, y - 36, 2, 36, INK))
    A(rect(x0, y - 38, x1 - x0, 4, INK))
    A(rect(x0, y - 38, x1 - x0, 1.5, "#6d6058"))
    A(rect(x0 - 4, y, x1 - x0 + 8, 9, "#4b4039"))
    A(rect(x0 - 4, y, x1 - x0 + 8, 2.5, "#8a7a6c"))


def stair(ox, oy, p0, p1, p2, p3):
    P = [(ox + x, oy + y) for x, y in (p0, p1, p2, p3)]
    d = f"M {P[0][0]} {P[0][1]} C {P[1][0]} {P[1][1]}, {P[2][0]} {P[2][1]}, {P[3][0]} {P[3][1]}"
    A(f'<path d="{d}" transform="translate(10 8)" fill="none" stroke="{SLATE}" stroke-width="9" opacity="0.28" filter="url(#soft2)"></path>')
    for i in range(1, 13):
        x, y = bez(*P, i / 13)
        A(rect(x - 12 + 9, y + 6, 24, 4, SLATE, 'opacity="0.18"'))
    rail = f"M {P[0][0]} {P[0][1]-30} C {P[1][0]} {P[1][1]-30}, {P[2][0]} {P[2][1]-30}, {P[3][0]} {P[3][1]-30}"
    for i in range(0, 14, 2):
        x, y = bez(*P, i / 13)
        A(f'<line x1="{x:.1f}" y1="{y:.1f}" x2="{x:.1f}" y2="{y-30:.1f}" stroke="{INK}" stroke-width="2"></line>')
    A(f'<path d="{rail}" fill="none" stroke="{INK}" stroke-width="3"></path>')
    A(f'<path d="{d}" fill="none" stroke="{INK}" stroke-width="7"></path>')
    A(f'<path d="{d}" transform="translate(-1.5 -2)" fill="none" stroke="#6d6058" stroke-width="1.6"></path>')
    for i in range(1, 13):
        x, y = bez(*P, i / 13)
        A(rect(x - 12, y - 2, 24, 5, INK))
        A(rect(x - 12, y - 2, 24, 1.5, "#7b6d62"))


def door(x, y, w, h):
    A(rect(x - 6, y - 8, w + 12, h + 8, STONE))
    A(rect(x - 6, y - 8, w + 12, 2, lit(STONE, 0.6)))
    A(rect(x, y, w, 22, "url(#glassDark)"))
    A(rect(x, y + 24, w, h - 24, "#5a3a2a"))
    A(rect(x, y + 24, w, h - 24, "url(#faceH)"))
    A(rect(x + 8, y + 34, w / 2 - 12, h - 46, "#4a3022"))
    A(rect(x + w / 2 + 4, y + 34, w / 2 - 12, h - 46, "#4a3022"))
    A(poly([(x, y), (x + w, y), (x + w, y + 10), (x + 8, y + 10), (x + 8, y + h), (x, y + h)], SLATE, 'opacity="0.35"'))
    A(rect(x + w - 14, y + h * 0.58, 5, 5, "#e8c56a"))


def building(x, top, w, color, cornice, rows, stairs=(), doors=(), balconies=(), curtains=()):
    h = GROUND - top
    A(rect(x, top, w, h, color))
    A(rect(x, top, w, h, "url(#bricks)"))
    A(rect(x, top, w, h, "url(#brickVar)"))
    A(rect(x, top, w, h, "url(#faceV)"))
    # light falls from the left: the right edge of each facade is a touch darker
    A(rect(x + w - 26, top, 26, h, SLATE, 'opacity="0.10"'))
    # cornice and the shadow it throws on the wall
    A(rect(x, top + 6, w, 30, "url(#dropDown)"))
    A(rect(x - 9, top - 16, w + 18, 24, cornice))
    A(rect(x - 9, top - 16, w + 18, 3, lit(cornice, 0.45)))
    A(rect(x - 9, top + 4, w + 18, 4, deep(cornice, 0.35)))
    for dx in range(int(x) - 4, int(x + w) + 2, 13):
        A(rect(dx, top + 8, 7, 6, deep(cornice, 0.2)))
    A(rect(x - 9, top - 16, 16, 44, deep(cornice, 0.15)))
    A(rect(x + w - 7, top - 16, 16, 44, deep(cornice, 0.3)))
    for i, (wy, xs) in enumerate(rows):
        for j, wx in enumerate(xs):
            window(x + wx, top + wy, 55, 80, curtains[(i + j) % len(curtains)] if curtains and (i + j) % 2 == 0 else None)
    for (bx0, bx1, by) in balconies:
        balcony(x + bx0, x + bx1, top + by)
    for d in doors:
        door(x + d[0], top + d[1], d[2], d[3])
    for s in stairs:
        stair(x, top, *s)
    A(rect(x, GROUND - 46, w, 46, "url(#aoUp)"))


building(0, 240, 300, "#b4532f", "#5a3a2a",
         rows=[(40, [30, 115, 200]), (160, [30, 115, 200])],
         balconies=[(14, 286, 128), (14, 286, 248)],
         doors=[(40, 300, 66, 106)],
         curtains=["#e8a93a", "#c9d7b0"])
building(310, 200, 290, "#9e4a2c", "#3f6b4f",
         rows=[(40, [30, 115, 200]), (160, [30, 115, 200]), (280, [30, 115])],
         balconies=[(14, 276, 128), (14, 276, 248)],
         stairs=[((22, 446), (110, 386), (-6, 336), (80, 252))],
         curtains=["#f3d9a6"])
building(610, 260, 320, "#c06a43", "#5a3a2a",
         rows=[(40, [30, 130, 230])],
         balconies=[(14, 306, 128)],
         curtains=["#b9d4dc"])
building(940, 190, 290, "#8f4f35", "#e2d3b6",
         rows=[(40, [30, 115, 200]), (160, [30, 115, 200])],
         balconies=[(14, 276, 128), (14, 276, 248)],
         curtains=["#e8a93a"])
building(1240, 230, 210, "#b4532f", "#5a3a2a",
         rows=[(40, [30, 115]), (160, [30, 115])],
         balconies=[(14, 200, 128)],
         doors=[(40, 306, 66, 110)],
         curtains=["#c9d7b0", "#f3d9a6"])

# dépanneur shop front on the fourth building
sx, sy, sw, sh = 970, 490, 230, 112
A(rect(sx - 6, sy - 6, sw + 12, sh + 12, STONE))
A(rect(sx, sy, sw, sh, "url(#warmInside)"))
for k in range(4):
    A(rect(sx + 14 + k * 54, sy + 46, 40, 6, "#8a5a3c"))
    for m in range(5):
        A(rect(sx + 16 + k * 54 + m * 8, sy + 32, 6, 14, ["#b3261e", "#2f6fb0", "#e8a93a", "#2e7d4f", "#c9d7b0"][(k + m) % 5]))
A(rect(sx, sy + 70, sw, 42, "#f6ead2"))
A(poly([(sx + sw * 0.5, sy), (sx + sw * 0.7, sy), (sx + sw * 0.4, sy + sh), (sx + sw * 0.2, sy + sh)], "#ffffff", 'opacity="0.25"'))
A(rect(sx, sy, sw, 30, "url(#dropDown)"))
# striped awning
aw_y = 462
for k in range(10):
    c = "#2f6fb0" if k % 2 == 0 else CREAM
    A(poly([(sx - 10 + k * 25, aw_y), (sx - 10 + (k + 1) * 25, aw_y), (sx - 6 + (k + 1) * 25, aw_y + 34), (sx - 6 + k * 25, aw_y + 34)], c))
A(rect(sx - 10, aw_y, 250, 34, "url(#faceV)"))
for k in range(10):
    A(f'<circle cx="{sx + 6.5 + k * 25:.1f}" cy="{aw_y + 34}" r="12.5" fill="{"#2f6fb0" if k % 2 == 0 else CREAM}"></circle>')
A(rect(sx - 10, aw_y + 34, 250, 12, SLATE, 'opacity="0.18"'))
A(f'<text x="{sx + sw / 2}" y="{aw_y + 24}" text-anchor="middle" font-family="Fredoka, sans-serif" font-size="17" font-weight="700" fill="{INK}" letter-spacing="2">DÉPANNEUR</text>')

# ---------- sidewalk, curb and street ----------
A(rect(0, GROUND, 1440, 56, "url(#sidewalk)"))
for k in range(0, 1440, 96):
    A(f'<line x1="{k}" y1="{GROUND}" x2="{k - 14}" y2="{GROUND + 56}" stroke="{SLATE}" stroke-opacity="0.22" stroke-width="1.5"></line>')
A(rect(0, GROUND, 1440, 12, "url(#dropDown)", 'opacity="0.6"'))
A(rect(0, 700, 1440, 5, "#ece6da"))
A(rect(0, 705, 1440, 11, "#a59d91"))
A(rect(0, 705, 1440, 11, SLATE, 'opacity="0.18"'))
A(rect(0, 716, 1440, 184, "url(#asphalt)"))
A(rect(0, 716, 1440, 26, "url(#dropDown)", 'opacity="0.55"'))
for k in range(40, 1440, 240):
    A(rect(k, 806, 120, 8, "#e9e2d0", 'opacity="0.85"'))
    A(rect(k + 70, 806, 18, 8, "#625d57", 'opacity="0.6"'))
A(f'<ellipse cx="1290" cy="770" rx="34" ry="9" fill="#4a4642"></ellipse><ellipse cx="1290" cy="769" rx="28" ry="6.5" fill="none" stroke="#6b655e" stroke-width="2"></ellipse>')
A(f'<path d="M 120 760 l 30 6 l 22 -3 l 26 9" fill="none" stroke="#3f3b38" stroke-width="2" opacity="0.6"></path>')

# ---------- street lamp ----------
A(f'<ellipse cx="318" cy="{GROUND+8}" rx="26" ry="5" fill="{SLATE}" opacity="0.35" filter="url(#soft2)"></ellipse>')
A(rect(296, 470, 8, 178, "#3a3f44"))
A(rect(296, 470, 3, 178, "#6c747b"))
A(rect(290, 630, 20, 18, "#3a3f44"))
A(f'<path d="M 300 474 C 300 446, 330 440, 342 452" fill="none" stroke="#3a3f44" stroke-width="6"></path>')
A(f'<path d="M 330 452 L 354 452 L 348 470 L 336 470 Z" fill="#3a3f44"></path><ellipse cx="342" cy="471" rx="7" ry="3" fill="#fff1c4"></ellipse>')

# ---------- trees ----------


def tree(cx, base, canopy_y, r, wall_shadow=True):
    if wall_shadow:
        for dx, dy, rr in [(-40, 10, 0.55), (10, -20, 0.6), (50, 16, 0.5), (0, 40, 0.5)]:
            A(f'<circle cx="{cx + dx + 46}" cy="{canopy_y + dy + 34}" r="{r * rr}" fill="{SLATE}" opacity="0.22" filter="url(#soft8)"></circle>')
    A(f'<ellipse cx="{cx}" cy="{base + 4}" rx="34" ry="7" fill="#5b4a3a"></ellipse>')
    A(f'<ellipse cx="{cx + 20}" cy="{base + 6}" rx="52" ry="7" fill="{SLATE}" opacity="0.30" filter="url(#soft2)"></ellipse>')
    A(f'<path d="M {cx-7} {base} L {cx-5} {canopy_y+20} L {cx-24} {canopy_y-10} M {cx+5} {canopy_y+30} L {cx+28} {canopy_y}" stroke="#5a3a2a" stroke-width="7" fill="none" stroke-linecap="round"></path>')
    A(rect(cx - 8, canopy_y + 20, 16, base - canopy_y - 20, "#5a3a2a"))
    A(rect(cx - 8, canopy_y + 20, 6, base - canopy_y - 20, "#7d5a42"))
    lobes = [(-0.55, 0.15, 0.55), (0.0, -0.25, 0.62), (0.55, 0.1, 0.55), (-0.2, 0.35, 0.5), (0.3, 0.38, 0.5)]
    for dx, dy, rr in lobes:
        A(f'<circle cx="{cx + dx * r + 7}" cy="{canopy_y + dy * r + 9}" r="{r * rr}" fill="#3d6a3f"></circle>')
    for dx, dy, rr in lobes:
        A(f'<circle cx="{cx + dx * r}" cy="{canopy_y + dy * r}" r="{r * rr}" fill="#5f9a4a"></circle>')
    for dx, dy, rr in lobes:
        A(f'<circle cx="{cx + dx * r}" cy="{canopy_y + dy * r}" r="{r * rr}" fill="url(#leaves)"></circle>')
    for dx, dy, rr in [(-0.62, 0.02, 0.32), (-0.1, -0.4, 0.36), (0.42, -0.06, 0.26)]:
        A(f'<circle cx="{cx + dx * r}" cy="{canopy_y + dy * r}" r="{r * rr}" fill="#8cc061" opacity="0.85"></circle>')


tree(92, GROUND + 2, 400, 92)
tree(1256, GROUND + 2, 392, 96)

# ---------- people ----------


def person(x, shirt, skin, hair, hair_kind="cap", walking=False, cup=False, select=False):
    y = 590
    A(f'<ellipse cx="{x + 4}" cy="{y + 101}" rx="22" ry="5" fill="{SLATE}" opacity="0.45" filter="url(#soft2)"></ellipse>')
    A(f'<ellipse cx="{x + 26}" cy="{y + 99}" rx="30" ry="4" fill="{SLATE}" opacity="0.20" filter="url(#soft2)"></ellipse>')
    if select:
        A(f'<ellipse cx="{x}" cy="{y + 102}" rx="34" ry="8" fill="none" stroke="{{{{accent}}}}" stroke-width="4"></ellipse>')
    pants = "#3b3a44"
    if walking:
        A(f'<rect x="{x-10}" y="{y+64}" width="10" height="36" rx="3" fill="{pants}" transform="rotate(12 {x-5} {y+64})"></rect>')
        A(f'<rect x="{x+2}" y="{y+64}" width="10" height="36" rx="3" fill="{shd(pants)}" transform="rotate(-12 {x+7} {y+64})"></rect>')
    else:
        A(f'<rect x="{x-12}" y="{y+64}" width="10" height="36" rx="3" fill="{pants}"></rect>')
        A(f'<rect x="{x+2}" y="{y+64}" width="10" height="36" rx="3" fill="{shd(pants)}"></rect>')
    # back arm (in shade), body, front arm: two hands, always
    A(f'<rect x="{x+13}" y="{y+22}" width="9" height="36" rx="4.5" fill="{shd(shirt, 0.45)}"></rect>')
    A(f'<circle cx="{x+17.5}" cy="{y+60}" r="5" fill="{shd(skin, 0.4)}"></circle>')
    A(f'<rect x="{x-18}" y="{y+18}" width="36" height="52" rx="14" fill="{shirt}"></rect>')
    A(f'<rect x="{x-18}" y="{y+18}" width="36" height="52" rx="14" fill="url(#faceH)"></rect>')
    if cup:
        A(f'<path d="M {x-14} {y+26} L {x-24} {y+42} L {x-14} {y+50}" stroke="{lit(shirt, 0.15)}" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>')
        A(f'<rect x="{x-21}" y="{y+38}" width="13" height="16" rx="3" fill="#ffffff"></rect><rect x="{x-21}" y="{y+42}" width="13" height="4" fill="#c97b2c"></rect>')
        A(f'<circle cx="{x-12}" cy="{y+50}" r="5" fill="{skin}"></circle>')
    else:
        A(f'<rect x="{x-21}" y="{y+22}" width="9" height="36" rx="4.5" fill="{lit(shirt, 0.12)}"></rect>')
        A(f'<circle cx="{x-16.5}" cy="{y+60}" r="5" fill="{skin}"></circle>')
    A(f'<circle cx="{x}" cy="{y}" r="16" fill="{skin}"></circle>')
    A(f'<circle cx="{x}" cy="{y}" r="16" fill="url(#roundLit)"></circle>')
    if hair_kind == "cap":
        A(f'<rect x="{x-16}" y="{y-16}" width="32" height="8" rx="4" fill="{hair}"></rect><rect x="{x-16}" y="{y-16}" width="14" height="3" rx="1.5" fill="{lit(hair, 0.4)}"></rect>')
    else:
        A(f'<ellipse cx="{x}" cy="{y-11}" rx="17" ry="8.5" fill="{hair}"></ellipse>')
        A(f'<path d="M {x-12} {y-14} Q {x-4} {y-20} {x+4} {y-17}" stroke="{lit(hair, 0.45)}" stroke-width="2.5" fill="none" stroke-linecap="round"></path>')


# ---------- food truck ----------
T = (540, 410)


def tr(x, y):
    return T[0] + x, T[1] + y


# the customer at the counter stands on the sidewalk, behind the truck
person(526, "#3f7f8f", "#f0c4a0", "#7a4b2a", "hair")

# shadow under and to the right of the truck
A(f'<ellipse cx="{T[0]+240}" cy="{T[1]+305}" rx="250" ry="12" fill="{SLATE}" opacity="0.55" filter="url(#soft4)"></ellipse>')
A(poly([tr(10, 300), tr(486, 300), tr(560, 318), tr(80, 318)], SLATE, 'opacity="0.22" filter="url(#soft4)"'))
A(f'<g transform="translate({T[0]},{T[1]})">')
body = "#e8a93a"
A(f'<rect x="0" y="40" width="380" height="232" rx="16" fill="{body}"></rect>')
A(f'<rect x="376" y="100" width="100" height="172" rx="16" fill="{body}"></rect>')
A(f'<rect x="0" y="40" width="380" height="232" rx="16" fill="url(#faceV)"></rect>')
A(f'<rect x="376" y="100" width="100" height="172" rx="16" fill="url(#faceV)"></rect>')
A(f'<rect x="376" y="100" width="100" height="172" rx="16" fill="{SLATE}" opacity="0.10"></rect>')
A(f'<rect x="0" y="40" width="476" height="232" rx="16" fill="url(#faceH)" opacity="0.55"></rect>')
A(f'<rect x="250" y="214" width="2" height="18" fill="{deep(body, 0.3)}"></rect>')
for rx in range(30, 360, 40):
    A(f'<circle cx="{rx}" cy="226" r="2" fill="{deep(body, 0.25)}"></circle><circle cx="{rx-0.6}" cy="225.4" r="0.9" fill="{SUN}" opacity="0.8"></circle>')
A(f'<rect x="6" y="44" width="368" height="5" rx="2.5" fill="{SUN}" opacity="0.7"></rect>')
A(f'<rect x="0" y="232" width="476" height="40" fill="{deep(body, 0.25)}"></rect>')
A(f'<rect x="0" y="232" width="476" height="3" fill="{lit(body, 0.4)}"></rect>')
A(f'<rect x="400" y="114" width="60" height="58" rx="8" fill="url(#glass)"></rect>')
A(poly([(428, 114), (446, 114), (418, 172), (402, 172)], "#ffffff", 'opacity="0.35"'))
A(f'<rect x="466" y="200" width="12" height="16" rx="3" fill="#fff1c4"></rect>')
# serving window: warm interior
A(f'<rect x="18" y="62" width="344" height="150" rx="8" fill="url(#warmInside)"></rect>')
A(f'<rect x="30" y="82" width="320" height="6" fill="#b88a5e"></rect>')
A(f'<rect x="36" y="110" width="74" height="58" rx="6" fill="url(#chrome)"></rect>')
A(f'<rect x="40" y="114" width="4" height="50" rx="2" fill="#ffffff" opacity="0.7"></rect>')
A(f'<rect x="56" y="168" width="10" height="10" fill="{INK}"></rect><rect x="80" y="168" width="10" height="10" fill="{INK}"></rect>')
A(f'<rect x="262" y="92" width="84" height="80" rx="4" fill="#f2dcb3"></rect>')
for cx, cy in [(280, 110), (304, 110), (328, 110), (292, 136), (316, 136)]:
    A(f'<ellipse cx="{cx}" cy="{cy}" rx="10.5" ry="6.5" fill="#c97b2c"></ellipse><ellipse cx="{cx-3}" cy="{cy-2.5}" rx="5" ry="2.2" fill="#f1b56a"></ellipse>')
A(f'<rect x="262" y="118" width="84" height="3" fill="{INK}" opacity="0.6"></rect><rect x="262" y="144" width="84" height="3" fill="{INK}" opacity="0.6"></rect>')
A(poly([(300, 92), (322, 92), (290, 172), (270, 172)], "#ffffff", 'opacity="0.35"'))
# owner, lit from the left
A(f'<ellipse cx="190" cy="102" rx="21" ry="11" fill="#3b2a20"></ellipse>')
A(f'<circle cx="190" cy="118" r="20" fill="#f0c4a0"></circle>')
A(f'<circle cx="190" cy="118" r="20" fill="url(#roundLit)"></circle>')
A(f'<path d="M 172 106 C 178 96, 198 94, 208 104" stroke="#6b4a36" stroke-width="3" fill="none"></path>')
A(f'<circle cx="183" cy="117" r="2.2" fill="{INK}"></circle><circle cx="197" cy="117" r="2.2" fill="{INK}"></circle>')
A(f'<path d="M 184 126 Q 190 131 196 126" stroke="{INK}" stroke-width="2" fill="none"></path>')
A(f'<rect x="166" y="138" width="48" height="40" rx="12" fill="#2f6fb0"></rect>')
A(f'<rect x="176" y="146" width="28" height="32" fill="{CREAM}"></rect>')
A(f'<rect x="166" y="138" width="48" height="40" rx="12" fill="url(#faceH)"></rect>')
A(f'<rect x="206" y="146" width="46" height="10" rx="5" fill="#f0c4a0"></rect>')
A(f'<rect x="246" y="134" width="16" height="16" rx="3" fill="#ffffff"></rect><rect x="254" y="134" width="8" height="16" rx="2" fill="{SLATE}" opacity="0.18"></rect>')
# awning shadow over the interior
A(f'<rect x="18" y="62" width="344" height="40" fill="url(#dropDown)"></rect>')
A(f'<rect x="18" y="178" width="344" height="22" fill="#8a5a3c"></rect>')
A(f'<rect x="18" y="178" width="344" height="4" fill="#b58059"></rect>')
A(f'<rect x="18" y="200" width="344" height="14" fill="url(#dropDown)"></rect>')
# scalloped awning
for k in range(9):
    c = "#b3261e" if k % 2 == 0 else CREAM
    x0 = 12 + k * 39.5
    A(poly([(x0 + 4, 34), (x0 + 43.5, 34), (x0 + 39.5, 62), (x0, 62)], c))
    A(f'<circle cx="{x0 + 19.75:.1f}" cy="62" r="19.75" fill="{c}"></circle>')
A(f'<rect x="12" y="34" width="356" height="30" fill="url(#faceV)"></rect>')
A(f'<rect x="12" y="34" width="356" height="3" fill="{SUN}" opacity="0.6"></rect>')
A(f'<rect x="50" y="0" width="280" height="40" rx="10" fill="{INK}"></rect>')
A(f'<rect x="56" y="3" width="268" height="3" rx="1.5" fill="#5d534b"></rect>')
A(f'<text x="190" y="28" text-anchor="middle" fill="{CREAM}" font-family="Fredoka, sans-serif" font-size="22" font-weight="600">Le P\'tit Camion</text>')
A(f'<text x="262" y="257" text-anchor="middle" fill="{INK}" font-family="Fredoka, sans-serif" font-size="20" font-weight="600">CAFÉ · CROISSANTS</text>')
for wx in (90, 410):
    A(f'<path d="M {wx-44} 272 A 44 44 0 0 1 {wx+44} 272 Z" fill="{deep(body, 0.6)}"></path>')
    A(f'<circle cx="{wx}" cy="272" r="34" fill="#2b2622"></circle>')
    A(f'<circle cx="{wx}" cy="272" r="26" fill="#3a3430"></circle>')
    A(f'<circle cx="{wx}" cy="272" r="14" fill="url(#chrome)"></circle>')
    A(f'<path d="M {wx-27} {262} A 29 29 0 0 1 {wx-6} {244}" stroke="#7d746c" stroke-width="3" fill="none" stroke-linecap="round"></path>')
A('</g>')

person(250, "#7a8f3c", "#d9a37c", "#4a5a2a", "cap")
person(380, "#6b4a8c", "#f3d2b5", "#c9a24a", "hair")
person(460, "#c0573a", "#8d5a3b", INK, "hair", select=True)
person(1110, "#d08a2e", "#f3d2b5", "#5a3a2a", "hair", walking=True, cup=True)
person(1340, "#4a6fa5", "#c98e66", INK, "cap")

A(overlays(grain="0.42"))

WORLD = "\n".join(o)

UI = """
<header style="position: absolute; left: 0; top: 0; width: 1440px; height: 68px; box-sizing: border-box; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; gap: 24px; background: #fff7e8; border-bottom: 3px solid #2b2622">
<div style="display: flex; align-items: baseline; gap: 14px">
<div style="font-family: 'Fredoka', sans-serif; font-size: 30px; font-weight: 700; letter-spacing: 0.5px">Magnat</div>
<div style="font-size: 13px; color: #5b534c; font-weight: 700">Camion de rue · Plateau-Mont-Royal</div>
</div>
<div style="display: flex; align-items: center; gap: 12px">
<div style="font-family: 'Fredoka', sans-serif; font-size: 18px; font-weight: 600; padding: 8px 14px; border-radius: 999px; border: 2px solid #2b2622">Mardi 13 juin · an 1</div>
<div style="display: flex; gap: 4px; padding: 3px; border-radius: 12px; border: 2px solid #2b2622">
<button aria-label="Pause" style="width: 44px; height: 38px; border: 0; border-radius: 9px; background: transparent; display: flex; align-items: center; justify-content: center; cursor: pointer"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" rx="1" fill="#2b2622"></rect><rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="#2b2622"></rect></svg></button>
<button aria-label="Vitesse normale" style="width: 44px; height: 38px; border: 0; border-radius: 9px; background: #2b2622; color: #fff7e8; font: 800 15px 'Nunito', sans-serif; cursor: pointer">×1</button>
<button aria-label="Vitesse ×3" style="width: 44px; height: 38px; border: 0; border-radius: 9px; background: transparent; color: #2b2622; font: 800 15px 'Nunito', sans-serif; cursor: pointer">×3</button>
<button aria-label="Vitesse ×10" style="width: 44px; height: 38px; border: 0; border-radius: 9px; background: transparent; color: #2b2622; font: 800 15px 'Nunito', sans-serif; cursor: pointer">×10</button>
</div>
</div>
<div style="display: flex; align-items: center; gap: 14px">
<div style="display: flex; flex-direction: column; gap: 4px; padding: 6px 14px; border-radius: 12px; border: 2px solid #2b2622; background: #ffffff">
<div style="display: flex; align-items: baseline; gap: 8px"><span style="font-size: 12px; font-weight: 800; color: #5b534c; text-transform: uppercase; letter-spacing: 0.6px">Encaisse</span><span style="font-family: 'Fredoka', sans-serif; font-size: 20px; font-weight: 600; color: {{accent}}; font-variant-numeric: tabular-nums">8 412,50 $</span></div>
<div style="width: 150px; height: 6px; border-radius: 3px; background: #e9dcc4"><div style="width: 70%; height: 6px; border-radius: 3px; background: {{accent}}"></div></div>
</div>
<div style="display: flex; flex-direction: column; gap: 4px; padding: 6px 14px; border-radius: 12px; border: 2px solid #2b2622; background: #ffffff">
<div style="display: flex; align-items: baseline; gap: 8px"><span style="font-size: 12px; font-weight: 800; color: #5b534c; text-transform: uppercase; letter-spacing: 0.6px">Énergie</span><span style="font-family: 'Fredoka', sans-serif; font-size: 18px; font-weight: 600">Reposé</span></div>
<div style="width: 110px; height: 6px; border-radius: 3px; background: #e9dcc4"><div style="width: 82%; height: 6px; border-radius: 3px; background: #2b2622"></div></div>
</div>
<a href="Tableau.dc.html" style="display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 16px; border-radius: 12px; background: #2b2622; color: #fff7e8; text-decoration: none; font: 800 15px 'Nunito', sans-serif"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="#fff7e8" stroke-width="2"><rect x="2" y="2" width="6" height="6" rx="1.5"></rect><rect x="10" y="2" width="6" height="6" rx="1.5"></rect><rect x="2" y="10" width="6" height="6" rx="1.5"></rect><rect x="10" y="10" width="6" height="6" rx="1.5"></rect></svg>Tableau de bord</a>
</div>
</header>

<div style="position: absolute; left: 556px; top: 370px; display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; background: #fff7e8; border: 2px solid #2b2622; box-shadow: 0 3px 0 #2b2622; font-size: 14px; font-weight: 800">Café · 186 portions</div>
<div style="position: absolute; left: 884px; top: 372px; display: flex; flex-direction: column; gap: 2px; padding: 6px 12px; border-radius: 14px; background: #fff7e8; border: 2px solid #2b2622; box-shadow: 0 3px 0 #2b2622">
<div style="display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 800"><span style="width: 10px; height: 10px; border-radius: 5px; background: #c27a00"></span>Croissants · 12</div>
<div style="font-size: 12px; font-weight: 700; color: #8a4f00">Rupture vers 14 h</div>
</div>

<div style="position: absolute; left: 330px; top: 462px; width: 230px; box-sizing: border-box; padding: 10px 12px; border-radius: 14px; background: #ffffff; border: 2px solid #2b2622; font-size: 13px; font-weight: 700; line-height: 1.35">Mélanie G. · habituée<br><span style="font-weight: 600; font-style: italic">« Votre croissant d'hier m'a fait réfléchir à ma vie. Dans le bon sens. »</span></div>

<a href="VilleLumiere.dc.html" style="position: absolute; left: 24px; top: 786px; display: inline-flex; align-items: center; gap: 8px; height: 48px; padding: 0 18px; border-radius: 12px; background: #fff7e8; border: 2px solid #2b2622; box-shadow: 0 4px 0 #2b2622; color: #2b2622; text-decoration: none; font: 800 15px 'Nunito', sans-serif"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="#2b2622" stroke-width="2" stroke-linejoin="round"><path d="M2 4l4.5-2 5 2 4.5-2v12l-4.5 2-5-2L2 16z"></path><path d="M6.5 2v12M11.5 4v12"></path></svg>Voir la ville</a>
<div style="position: absolute; left: 1140px; top: 714px; width: 270px; box-sizing: border-box; padding: 14px 16px; border-radius: 14px; background: #fff7e8; border: 2px solid #2b2622; box-shadow: 0 4px 0 #2b2622; display: flex; flex-direction: column; gap: 6px; font-variant-numeric: tabular-nums">
<div style="font-family: 'Fredoka', sans-serif; font-size: 17px; font-weight: 600">Aujourd'hui</div>
<div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: 700"><span>Ventes</span><span>412,25 $</span></div>
<div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: 700"><span>Clients servis</span><span>87</span></div>
<div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: 700; color: #8a4f00"><span>Ventes perdues</span><span>9</span></div>
</div>

<div style="position: absolute; left: 0; top: 852px; width: 1440px; height: 48px; box-sizing: border-box; padding: 0 24px; display: flex; align-items: center; gap: 14px; background: #2b2622; color: #fff7e8">
<span style="padding: 4px 10px; border-radius: 6px; background: #e8c547; color: #2b2622; font-family: 'Fredoka', sans-serif; font-size: 14px; font-weight: 700; letter-spacing: 0.5px">LA PRESSE-CITRON</span>
<span style="font-size: 15px; font-weight: 700; flex: 1">Météo : soleil du matin sur le Plateau. Les ombres seront livrées à droite, comme d'habitude.</span>
<span style="font-size: 12px; font-weight: 700; color: #e9dcc4">Illustrations provisoires</span>
</div>
"""

PAGE = f"""<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Magnat · La rue (texture et ombre)</title>
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
<div style="position: relative; width: 1440px; height: 900px; overflow: hidden; background: #cfe8f3; font-family: 'Nunito', sans-serif; color: #2b2622">
<svg width="1440" height="900" viewBox="0 0 1440 900" aria-hidden="true" style="position: absolute; left: 0; top: 0">
{DEFS}
{WORLD}
</svg>
{UI}
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

OUT.write_text(scope_ids(PAGE, "rl"))
print(OUT, len(PAGE))
