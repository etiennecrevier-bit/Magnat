"""Vieux-Montréal street, summer and winter, with the second truck. Writes VieuxEte.dc.html and VieuxHiver.dc.html."""
import io
import contextlib
from pathlib import Path
from light import INK, CREAM, SLATE, SUN, STONE, DEFS, overlays, mix, lit, shd, deep, poly, rect, scope_ids

with contextlib.redirect_stdout(io.StringIO()):
    import rue  # noqa: E402  (re-writes RueLumiere, harmlessly; we borrow its people, windows and truck)
    import ui_concepts as ui  # noqa: E402

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent / "design" / "project"
GROUND = rue.GROUND
TRUCK_SRC = rue.Path(rue.__file__).read_text()
TRUCK_SRC = TRUCK_SRC[TRUCK_SRC.index("# shadow under and to the right of the truck"):TRUCK_SRC.index('person(250, "#7a8f3c"')]

EXTRA_DEFS = f"""<defs>
<pattern id="stones" width="56" height="26" patternUnits="userSpaceOnUse">
<path d="M0 12.5H56M0 25.5H56M18 0V12.5M46 0V12.5M4 13V25.5M32 13V25.5" stroke="{INK}" stroke-opacity="0.14" stroke-width="1.3" fill="none"></path>
<rect x="19" y="1" width="26" height="11" fill="{SUN}" fill-opacity="0.10"></rect>
<rect x="5" y="14" width="26" height="11" fill="{SLATE}" fill-opacity="0.07"></rect>
</pattern>
<pattern id="cobbles" width="34" height="16" patternUnits="userSpaceOnUse">
<rect x="1" y="1" width="15" height="6" rx="3" fill="#7d766e"></rect><rect x="18" y="1" width="15" height="6" rx="3" fill="#6f6862"></rect>
<rect x="-7" y="9" width="15" height="6" rx="3" fill="#6f6862"></rect><rect x="10" y="9" width="15" height="6" rx="3" fill="#837b72"></rect><rect x="27" y="9" width="15" height="6" rx="3" fill="#756e67"></rect>
<rect x="2" y="1.5" width="10" height="1.6" rx="0.8" fill="{SUN}" fill-opacity="0.25"></rect><rect x="11" y="9.5" width="10" height="1.6" rx="0.8" fill="{SUN}" fill-opacity="0.22"></rect>
</pattern>
<pattern id="granite" width="120" height="58" patternUnits="userSpaceOnUse">
<path d="M0 57.5H120M60 0V58" stroke="{SLATE}" stroke-opacity="0.18" stroke-width="1.4"></path>
</pattern>
<linearGradient id="skyWinter" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#b9c4cc"></stop><stop offset="0.6" stop-color="#d9dee1"></stop><stop offset="1" stop-color="#eef0ef"></stop>
</linearGradient>
<linearGradient id="copper" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="#8fbca8"></stop><stop offset="0.5" stop-color="#6f9c8a"></stop><stop offset="1" stop-color="#4f7a6b"></stop>
</linearGradient>
</defs>"""


def scene(winter):
    rue.o.clear()
    A = rue.A
    snow = "#f7f9fa"

    # ---------- sky and the far city ----------
    A(rect(0, 0, 1440, 900, "url(#skyWinter)" if winter else "url(#sky)"))
    if not winter:
        rue.cloud(260, 120, 0.9)
        rue.cloud(1180, 96, 1.15)
    haze = mix("#b9c9d2", SLATE, 0.14) if not winter else mix("#c4cbd0", SLATE, 0.10)
    # Notre-Dame's twin towers, hazy, behind the roofs
    for tx in (560, 668):
        A(rect(tx, 92, 62, 210, haze, 'opacity="0.85"'))
        A(rect(tx + 38, 92, 24, 210, SLATE, 'opacity="0.10"'))
        A(poly([(tx - 4, 92), (tx + 66, 92), (tx + 56, 72), (tx + 6, 72)], haze, 'opacity="0.85"'))
        for k in range(3):
            A(f'<path d="M {tx + 10 + k * 16} 150 l 6 -16 l 6 16 z" fill="{SLATE}" opacity="0.10"></path>')
    A(rect(616, 170, 56, 132, haze, 'opacity="0.8"'))
    A(poly([(612, 170), (676, 170), (644, 128)], haze, 'opacity="0.8"'))
    # Marché Bonsecours's dome, to the right
    A(f'<path d="M 1010 240 C 1010 196, 1080 196, 1080 240 Z" fill="{mix(haze, "#cfd6d8", 0.4)}" opacity="0.9"></path>')
    A(rect(1004, 240, 82, 64, haze, 'opacity="0.85"'))
    A(rect(1042, 176, 6, 24, haze))

    # ---------- stone buildings ----------
    def stone_building(x, top, w, color, shop=None, dormers=0, arch_rows=3, cols=3):
        h = GROUND - top
        A(rect(x, top, w, h, color))
        A(rect(x, top, w, h, "url(#stones)"))
        A(rect(x, top, w, h, "url(#faceV)"))
        A(rect(x + w - 24, top, 24, h, SLATE, 'opacity="0.10"'))
        # copper mansard roof with dormers
        if dormers:
            A(poly([(x - 6, top - 14), (x + w + 6, top - 14), (x + w - 18, top - 74), (x + 18, top - 74)], "url(#copper)"))
            A(poly([(x + w - 60, top - 14), (x + w + 6, top - 14), (x + w - 18, top - 74), (x + w - 40, top - 74)], SLATE, 'opacity="0.18"'))
            if winter:
                A(poly([(x + 14, top - 70), (x + w - 14, top - 70), (x + w - 22, top - 78), (x + 22, top - 78)], snow))
            step = (w - 40) / dormers
            for k in range(dormers):
                dx = x + 20 + k * step + step / 2 - 18
                A(rect(dx, top - 62, 36, 40, mix(color, SUN, 0.1)))
                A(poly([(dx - 4, top - 62), (dx + 40, top - 62), (dx + 18, top - 80)], deep(color, 0.3)))
                A(rect(dx + 7, top - 54, 22, 28, "url(#glass)"))
                if winter:
                    A(poly([(dx - 6, top - 62), (dx + 42, top - 62), (dx + 18, top - 84)], snow, 'opacity="0.95"'))
        # cornice with dentils, and its shadow
        A(rect(x, top + 6, w, 30, "url(#dropDown)"))
        A(rect(x - 8, top - 14, w + 16, 22, mix(color, "#ffffff", 0.25)))
        A(rect(x - 8, top - 14, w + 16, 3, lit(color, 0.6)))
        for dx in range(int(x) - 4, int(x + w) + 2, 11):
            A(rect(dx, top + 8, 6, 5, deep(color, 0.25)))
        if winter:
            A(f'<rect x="{x - 10}" y="{top - 22}" width="{w + 20}" height="10" rx="5" fill="{snow}"></rect>')
        # tall arched windows
        gap = w / cols
        limit = (GROUND - 170) if shop else (GROUND - 60)
        for r in range(arch_rows + 2):
            wy = top + 40 + r * 110
            if wy + 100 > limit:
                break
            for c in range(cols):
                wx = x + c * gap + gap / 2 - 26
                A(f'<path d="M {wx - 6} {wy + 90} V {wy + 22} A 32 32 0 0 1 {wx + 58} {wy + 22} V {wy + 90} Z" fill="{mix(color, "#ffffff", 0.3)}"></path>')
                A(f'<path d="M {wx} {wy + 86} V {wy + 24} A 26 26 0 0 1 {wx + 52} {wy + 24} V {wy + 86} Z" fill="url(#glass)"></path>')
                A(f'<path d="M {wx} {wy + 86} V {wy + 24} A 26 26 0 0 1 {wx + 8} {wy + 6} V {wy + 86} Z" fill="{SLATE}" opacity="0.35"></path>')
                A(rect(wx + 24, wy, 4, 86, mix(color, "#ffffff", 0.3)))
                A(poly([(wx + 30, wy + 4), (wx + 44, wy + 10), (wx + 14, wy + 86), (wx, wy + 86)], "#ffffff", 'opacity="0.18"'))
                A(rect(wx - 8, wy + 90, 68, 7, mix(color, "#ffffff", 0.35)))
                if winter:
                    A(f'<rect x="{wx - 8}" y="{wy + 86}" width="68" height="5" rx="2.5" fill="{snow}"></rect>')
                A(rect(wx - 6, wy + 97, 64, 10, "url(#dropDown)", 'opacity="0.6"'))
        # shop front at street level
        if shop:
            name, awning, lit_inside = shop
            sx, sy, sw = x + 18, GROUND - 120, w - 36
            A(rect(sx - 6, sy - 6, sw + 12, 126, deep(color, 0.15)))
            A(rect(sx, sy, sw, 114, "url(#warmInside)" if lit_inside else "url(#glassDark)"))
            A(poly([(sx + sw * 0.5, sy), (sx + sw * 0.66, sy), (sx + sw * 0.4, sy + 114), (sx + sw * 0.24, sy + 114)], "#ffffff", 'opacity="0.22"'))
            ay = sy - 40
            n = int(sw // 26) + 1
            for k in range(n):
                c = awning if k % 2 == 0 else CREAM
                A(poly([(sx - 8 + k * 26, ay), (sx - 8 + (k + 1) * 26, ay), (sx - 4 + (k + 1) * 26, ay + 30), (sx - 4 + k * 26, ay + 30)], c))
            A(rect(sx - 8, ay, n * 26, 30, "url(#faceV)"))
            A(rect(sx - 8, ay + 30, n * 26, 12, SLATE, 'opacity="0.18"'))
            if winter:
                A(f'<rect x="{sx - 10}" y="{ay - 6}" width="{n * 26 + 4}" height="9" rx="4.5" fill="{snow}"></rect>')
            A(f'<text x="{sx + sw / 2}" y="{ay + 21}" text-anchor="middle" font-family="Fredoka, sans-serif" font-size="15" font-weight="700" fill="{INK}" letter-spacing="2">{name}</text>')
        A(rect(x, GROUND - 46, w, 46, "url(#aoUp)"))

    stone_building(0, 210, 300, "#b9b0a1", shop=("CRÊPERIE", "#b3261e", not winter), dormers=3, arch_rows=3)
    stone_building(310, 170, 260, "#a79e90", shop=("SOUVENIRS", "#2f6fb0", True), dormers=0, arch_rows=3, cols=3)
    stone_building(580, 240, 330, "#c6bdad", shop=None, dormers=4, arch_rows=3, cols=4)
    stone_building(920, 190, 290, "#ada392", shop=("GALERIE", "#2e7d4f", not winter), dormers=3, arch_rows=3)
    stone_building(1220, 230, 230, "#bdb4a5", shop=("CAFÉ-BISTRO", "#c27a00", True), dormers=2, arch_rows=3, cols=2)

    # ---------- sidewalk (granite) and cobbled street ----------
    A(rect(0, GROUND, 1440, 56, "#d6d0c6"))
    A(rect(0, GROUND, 1440, 56, "url(#granite)"))
    A(rect(0, GROUND, 1440, 12, "url(#dropDown)", 'opacity="0.55"'))
    A(rect(0, 700, 1440, 6, "#c9c2b6"))
    A(rect(0, 706, 1440, 10, "#8f887d"))
    A(rect(0, 716, 1440, 184, "#6a645d"))
    A(rect(0, 716, 1440, 184, "url(#cobbles)"))
    A(rect(0, 716, 1440, 30, "url(#dropDown)", 'opacity="0.5"'))
    if winter:
        A(rect(0, GROUND, 1440, 56, snow, 'opacity="0.78"'))
        for k in range(0, 1440, 70):
            A(f'<ellipse cx="{k + 30}" cy="{708}" rx="{48 + (k * 7) % 20}" ry="14" fill="{snow}"></ellipse>')
        A(rect(0, 716, 1440, 184, "#e3e6e6", 'opacity="0.55"'))
        for k in range(60, 1440, 180):
            A(f'<path d="M {k} 790 q 40 -6 80 0 t 80 0" stroke="#9aa0a3" stroke-width="5" fill="none" opacity="0.35"></path>')

    # ---------- lamp (old-style lantern) ----------
    lx = 320
    A(f'<ellipse cx="{lx}" cy="{GROUND + 8}" rx="24" ry="5" fill="{SLATE}" opacity="0.35" filter="url(#soft2)"></ellipse>')
    A(rect(lx - 4, 470, 8, 178, "#2f3337"))
    A(rect(lx - 4, 470, 3, 178, "#5d656b"))
    A(poly([(lx - 18, 440), (lx + 18, 440), (lx + 12, 474), (lx - 12, 474)], "#2f3337"))
    A(rect(lx - 10, 446, 20, 24, "#fff1c4" if winter else "#f2e7c9"))
    A(poly([(lx - 22, 440), (lx + 22, 440), (lx, 424)], "#2f3337"))
    if winter:
        A(f'<ellipse cx="{lx}" cy="426" rx="14" ry="4" fill="{snow}"></ellipse>')

    # ---------- the second truck ----------
    src = (TRUCK_SRC
           .replace('body = "#e8a93a"', 'body = "#3f8f8a"')
           .replace("Le P\\'tit Camion", "Le P\\'tit Camion · Vieux-Port")
           .replace('font-size="22" font-weight="600">Le P', 'font-size="18" font-weight="600">Le P')
           .replace('x="262" y="257" text-anchor="middle" fill="{INK}" font-family="Fredoka, sans-serif" font-size="20" font-weight="600">CAFÉ · CROISSANTS',
                    'x="250" y="256" text-anchor="middle" fill="{INK}" font-family="Fredoka, sans-serif" font-size="14" font-weight="600">CAFÉ · CROISSANTS · LIMONADE' if not winter else
                    'x="250" y="257" text-anchor="middle" fill="{INK}" font-family="Fredoka, sans-serif" font-size="20" font-weight="600">CAFÉ · CROISSANTS'))
    rue.T = (600, 410)
    rue.person(586, "#c0573a", "#f3d2b5", "#c9a24a", "hair") if not winter else None
    exec(src, rue.__dict__)
    T = rue.T
    if not winter:
        # lemonade jar on the counter
        jx, jy = T[0] + 118, T[1] + 128
        A(rect(jx, jy, 34, 46, "#f4e27a", 'rx="6" opacity="0.92"'))
        A(rect(jx, jy, 34, 12, "#ffffff", 'rx="6" opacity="0.45"'))
        A(rect(jx + 22, jy, 12, 46, SLATE, 'rx="6" opacity="0.15"'))
        for k in range(3):
            A(f'<circle cx="{jx + 9 + k * 9}" cy="{jy + 26 + (k % 2) * 8}" r="3.6" fill="#f2c94c" stroke="#e6b422" stroke-width="1"></circle>')
        A(rect(jx + 13, jy + 46, 8, 6, "#9aa3a8"))
    else:
        # stored for the winter: a rolled shutter and snow on the roof
        A(rect(T[0] + 12, T[1] + 34, 356, 182, "#9aa3a8"))
        for k in range(0, 182, 9):
            A(rect(T[0] + 12, T[1] + 34 + k, 356, 2, "#7e878c"))
        A(rect(T[0] + 12, T[1] + 34, 356, 182, "url(#faceV)"))
        A(f'<rect x="{T[0] - 6}" y="{T[1] + 28}" width="394" height="14" rx="7" fill="{snow}"></rect>')
        A(f'<rect x="{T[0] + 370}" y="{T[1] + 92}" width="110" height="12" rx="6" fill="{snow}"></rect>')
        A(f'<rect x="{T[0] + 110}" y="{T[1] + 100}" width="160" height="74" rx="8" fill="{CREAM}" stroke="{INK}" stroke-width="3"></rect>')
        A(f'<text x="{T[0] + 190}" y="{T[1] + 130}" text-anchor="middle" font-family="Fredoka, sans-serif" font-size="17" font-weight="700" fill="{INK}">Fermé pour l\'hiver</text>')
        A(f'<text x="{T[0] + 190}" y="{T[1] + 156}" text-anchor="middle" font-family="Nunito, sans-serif" font-size="14" font-weight="800" fill="{INK}">De retour en mai</text>')

    # ---------- the rival: an ice-cream cart (summer) or a covered cart (winter) ----------
    cx = 1170
    A(f'<ellipse cx="{cx + 70}" cy="{GROUND + 40}" rx="90" ry="8" fill="{SLATE}" opacity="0.35" filter="url(#soft4)"></ellipse>')
    if not winter:
        A(rect(cx + 64, 470, 5, 120, "#5a4d44"))
        for k in range(8):
            c = "#e97aa0" if k % 2 == 0 else CREAM
            A(poly([(cx + 66, 452), (cx - 20 + k * 22, 500), (cx + 2 + k * 22, 500)], c))
        A(f'<path d="M {cx - 20} 500 Q {cx + 66} 520 {cx + 156} 500" fill="none" stroke="{SLATE}" stroke-width="4" opacity="0.2"></path>')
        A(rect(cx, 590, 140, 74, "#f6d6e1", 'rx="10"'))
        A(rect(cx, 590, 140, 74, "url(#faceH)", 'rx="10"'))
        A(f'<text x="{cx + 70}" y="634" text-anchor="middle" font-family="Fredoka, sans-serif" font-size="17" font-weight="700" fill="#a3365c">GLACES</text>')
        for wx in (cx + 26, cx + 114):
            A(f'<circle cx="{wx}" cy="672" r="16" fill="{INK}"></circle><circle cx="{wx}" cy="672" r="6" fill="#a7aeb3"></circle>')
    else:
        A(f'<path d="M {cx} 664 V 600 Q {cx + 70} 560 {cx + 140} 600 V 664 Z" fill="#6c7a84"></path>')
        A(f'<path d="M {cx + 10} 598 Q {cx + 70} 562 {cx + 132} 598" stroke="{snow}" stroke-width="12" fill="none" stroke-linecap="round"></path>')

    # ---------- the calèche (summer) ----------
    if not winter:
        A('<g transform="translate(40 744) scale(0.78)">')
        hx, hy = 40, 60
        A(f'<ellipse cx="{hx + 190}" cy="{hy + 70}" rx="240" ry="12" fill="{SLATE}" opacity="0.45" filter="url(#soft4)"></ellipse>')
        # carriage
        A(f'<path d="M {hx + 200} {hy + 30} h 150 q 22 0 22 -22 v -46 h -36 v 24 h -120 z" fill="{INK}"></path>')
        A(rect(hx + 240, hy - 30, 90, 30, "#b3261e", 'rx="6"'))
        A(f'<path d="M {hx + 300} {hy - 60} q 50 -10 70 22 h -70 z" fill="#3b3430"></path>')
        for wx, r in ((hx + 230, 30), (hx + 340, 38)):
            A(f'<circle cx="{wx}" cy="{hy + 42}" r="{r}" fill="none" stroke="{INK}" stroke-width="6"></circle>')
            for a in range(0, 180, 30):
                A(f'<line x1="{wx}" y1="{hy + 42}" x2="{wx + r * __import__("math").cos(a * 3.1416 / 180):.1f}" y2="{hy + 42 + r * __import__("math").sin(a * 3.1416 / 180):.1f}" stroke="{INK}" stroke-width="2"></line>')
                A(f'<line x1="{wx}" y1="{hy + 42}" x2="{wx - r * __import__("math").cos(a * 3.1416 / 180):.1f}" y2="{hy + 42 - r * __import__("math").sin(a * 3.1416 / 180):.1f}" stroke="{INK}" stroke-width="2"></line>')
        # driver in a top hat
        A(f'<rect x="{hx + 250}" y="{hy - 64}" width="26" height="36" rx="10" fill="#2f6f5a"></rect>')
        A(f'<circle cx="{hx + 263}" cy="{hy - 76}" r="11" fill="#e9b894"></circle>')
        A(rect(hx + 252, hy - 100, 22, 18, INK))
        A(rect(hx + 248, hy - 84, 30, 4, INK))
        # shafts and horse
        A(f'<line x1="{hx + 210}" y1="{hy + 8}" x2="{hx + 110}" y2="{hy - 4}" stroke="#5a3a2a" stroke-width="5"></line>')
        horse = "#8a5a3c"
        A(f'<ellipse cx="{hx + 90}" cy="{hy - 6}" rx="70" ry="30" fill="{horse}"></ellipse>')
        A(f'<ellipse cx="{hx + 90}" cy="{hy - 6}" rx="70" ry="30" fill="url(#faceV)"></ellipse>')
        A(f'<path d="M {hx + 34} {hy - 20} L {hx + 6} {hy - 72} L {hx + 30} {hy - 80} L {hx + 56} {hy - 26} Z" fill="{horse}"></path>')
        A(f'<path d="M {hx + 6} {hy - 72} l -26 10 l 4 14 l 30 -6 z" fill="{horse}"></path>')
        A(f'<path d="M {hx + 12} {hy - 80} q 18 6 40 52" stroke="#3b2a20" stroke-width="8" fill="none" stroke-linecap="round"></path>')
        A(f'<circle cx="{hx - 2}" cy="{hy - 66}" r="2.4" fill="{INK}"></circle>')
        for lxp, ph in ((hx + 40, 0), (hx + 58, 1), (hx + 122, 0), (hx + 140, 1)):
            col = horse if ph == 0 else shd(horse, 0.35)
            A(rect(lxp, hy + 14, 10, 52, col, 'rx="4"'))
            A(rect(lxp - 1, hy + 62, 12, 8, "#3b2a20"))
        A(f'<path d="M {hx + 158} {hy - 14} q 18 10 10 40" stroke="#3b2a20" stroke-width="7" fill="none" stroke-linecap="round"></path>')
        A(f'<path d="M {hx + 40} {hy - 34} h 80 v 16 h -80 z" fill="#b3261e" opacity="0.85"></path>')
        A('</g>')

    # ---------- people ----------
    def tourist(x, shirt, skin, hair, hat=None, camera=False, map_=False, kind="hair", walking=False):
        rue.person(x, shirt, skin, hair, kind, walking=walking)
        y = 590
        if hat:
            A(f'<ellipse cx="{x}" cy="{y - 10}" rx="26" ry="6" fill="{hat}"></ellipse><rect x="{x - 14}" y="{y - 24}" width="28" height="14" rx="6" fill="{hat}"></rect><rect x="{x - 14}" y="{y - 14}" width="28" height="3" fill="#b3261e"></rect>')
        if camera:
            A(f'<path d="M {x - 12} {y + 18} L {x - 2} {y + 40} L {x + 12} {y + 18}" stroke="{INK}" stroke-width="1.6" fill="none"></path>')
            A(rect(x - 10, y + 36, 18, 12, INK, 'rx="2"'))
            A(f'<circle cx="{x - 1}" cy="{y + 42}" r="3.4" fill="#a7aeb3"></circle>')
        if map_:
            A(poly([(x - 34, y + 30), (x - 8, y + 26), (x - 8, y + 50), (x - 34, y + 54)], "#f3e6c8"))
            A(f'<path d="M {x - 25} {y + 29} v 24 M {x - 16} {y + 27} v 24" stroke="#c9b79a" stroke-width="1.4"></path>')

    def bundled(x, coat, skin, tuque, walking=False):
        rue.person(x, coat, skin, tuque, "cap", walking=walking)
        y = 590
        A(f'<path d="M {x - 16} {y - 6} Q {x} {y - 34} {x + 16} {y - 6} Z" fill="{tuque}"></path><circle cx="{x}" cy="{y - 30}" r="5" fill="{CREAM}"></circle>')
        A(rect(x - 16, y + 12, 32, 9, "#e8c547", 'rx="4"'))
        A(rect(x - 20, y + 60, 40, 14, coat, 'rx="6"'))

    if not winter:
        tourist(200, "#e8a93a", "#f3d2b5", "#7a4b2a", hat="#f3e6c8", camera=True)
        tourist(420, "#6b4a8c", "#c98e66", INK, map_=True)
        tourist(500, "#2f6fb0", "#f0c4a0", "#c9a24a", hat="#2b2622")
        tourist(1060, "#d16b5a", "#8d5a3b", INK, camera=True, walking=True)
        tourist(1370, "#7a8f3c", "#f3d2b5", "#5a3a2a", hat="#f3e6c8", map_=True)
    else:
        bundled(250, "#5b3f3a", "#f0c4a0", "#b3261e", walking=True)
        bundled(1340, "#2f4a63", "#c98e66", "#2e7d4f")

    if winter:
        import random
        rnd = random.Random(7)
        for _ in range(170):
            x, y, r = rnd.uniform(0, 1440), rnd.uniform(0, 860), rnd.uniform(1.2, 3.4)
            A(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="#ffffff" opacity="{rnd.uniform(0.55, 0.95):.2f}"></circle>')

    A(overlays(grain="0.38"))
    return "\n".join(rue.o)


def ui_layer(winter):
    I = ui.icon
    date = "Mardi 6 février · an 3" if winter else "Samedi 15 juillet · an 2"
    season = (f'<span class="chip" style="background:#e6edf2">❄ Basse saison</span>' if winter
              else f'<span class="chip" style="background:#fbefd5">☀ Haute saison</span>')
    switch = f"""<div style="position:absolute;left:16px;top:78px;display:flex;gap:6px;padding:4px;border-radius:14px;background:{CREAM};border:2px solid {INK}">
<span class="tab">Plateau · Kevin</span><span class="tab on">Vieux-Montréal · {"remisé" if winter else "vous"}</span></div>"""
    top = f"""<div style="position:absolute;left:16px;top:14px;display:flex;align-items:center;gap:10px">
<div class="card" style="padding:6px 14px;border-radius:14px;box-shadow:0 4px 0 {INK}"><div class="h1" style="font-size:17px;line-height:1.1">Le P'tit Camion</div><div style="font-size:12px;font-weight:800" class="muted">{date}</div></div>
<span class="chip">Encaisse {"3 140 $" if winter else "41 870 $"} {ui.sparkline([9, 12, 15, 22, 30, 38, 41.9] if not winter else [41, 33, 26, 18, 12, 7, 3.1], color=ui.GREEN if not winter else ui.AMBER)}</span>
{ui.ENERGY}{season}
</div>
<div style="position:absolute;right:16px;top:14px;display:flex;align-items:center;gap:10px">{ui.SPEED}</div>"""
    if winter:
        alert = f"""<div style="position:absolute;right:16px;top:74px;display:flex;flex-direction:column;gap:8px;align-items:flex-end">
<div class="chip" style="height:36px;font-size:14px;background:#fbefd5">{I("alerte", 18, ui.AMBER)}Permis du Vieux-Montréal : 4 800 $ le 1er avril</div>
<div class="chip" style="height:36px;font-size:14px">{I("camion", 18, INK)}Camion remisé · assurance 180 $ par mois</div></div>"""
        hier = f"""<div class="card" style="position:absolute;right:16px;bottom:62px;width:250px;padding:12px 14px;font-variant-numeric:tabular-nums">
<div class="h1" style="font-size:16px">Hier · Vieux-Montréal</div><div style="font-weight:800;margin-top:4px" class="muted">Fermé pour l'hiver</div>
<div style="display:flex;justify-content:space-between;font-weight:700;margin-top:6px"><span>Plateau</span><span>318 $</span></div></div>"""
        tick = "Le Vieux-Montréal compte plus de calèches que de touristes ce matin."
    else:
        alert = f"""<div style="position:absolute;right:16px;top:74px;display:flex;flex-direction:column;gap:8px;align-items:flex-end">
<div class="chip" style="height:36px;font-size:14px;background:#fbefd5">{I("alerte", 18, ui.AMBER)}Limonade : rupture vers 15 h</div></div>"""
        hier = f"""<div class="card" style="position:absolute;right:16px;bottom:62px;width:250px;padding:12px 14px;font-variant-numeric:tabular-nums">
<div class="h1" style="font-size:16px">Hier · Vieux-Montréal</div>
<div style="display:flex;justify-content:space-between;font-weight:700;margin-top:4px"><span>Ventes</span><span>1 284 $</span></div>
<div style="display:flex;justify-content:space-between;font-weight:700"><span>Clients servis</span><span>241</span></div>
<div style="display:flex;justify-content:space-between;font-weight:700;color:#8a4f00"><span>Ventes perdues</span><span>31</span></div>
<div style="display:flex;justify-content:space-between;font-weight:700;margin-top:4px;border-top:1px solid {ui.LINE};padding-top:4px" class="muted"><span>Plateau</span><span>402 $</span></div></div>"""
        tick = "Un touriste demande où est le Vieux-Montréal. Il est dedans."
    ticker = ui.TICKER.replace("La Ville installe un parcomètre devant un autre parcomètre.", tick)
    return top + switch + alert + hier + ui.A_DOCK.replace(ui.dock_button("camion", "Camion", True), ui.dock_button("camion", "Camion")) + ticker


for winter, name, title, prefix in ((False, "VieuxEte", "Magnat · Vieux-Montréal, l'été", "ve"),
                                    (True, "VieuxHiver", "Magnat · Vieux-Montréal, l'hiver", "vh")):
    world = (f'<svg width="1440" height="900" viewBox="0 0 1440 900" aria-hidden="true" style="position:absolute;left:0;top:0">'
             f'{DEFS}{EXTRA_DEFS}{scene(winter)}</svg>')
    page = ui.page(title, "fr", world + ui_layer(winter))
    (PROJECT / f"{name}.dc.html").write_text(scope_ids(page, prefix))
    print(name, len(page))
