"""Three interface concepts for Magnat v2, plus the shared Améliorations screen."""
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent / "design" / "project"
SRC = (PROJECT / "RueLumiere.dc.html").read_text()
_i = SRC.index('<svg width="1440"')
_j = SRC.index('</svg>', SRC.index('rl-vignette)"></rect>')) + 6
WORLD = SRC[_i:_j].replace("{{accent}}", "#2e7d4f")

INK, CREAM, MUTED, LINE = "#2b2622", "#fff7e8", "#6b625a", "#e3d6bf"
GREEN, AMBER, RED, BLUE = "#2e7d4f", "#c27a00", "#b3261e", "#2f6fb0"


def world(prefix):
    return WORLD.replace("rl-", prefix + "-")


# ---------- icons (24 x 24, stroke) ----------
IC = {
    "camion": '<path d="M2 6h12v10H2z"/><path d="M14 9h4.5l3.5 3.5V16h-8z"/><circle cx="6" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/>',
    "equipe": '<circle cx="8.5" cy="8" r="3"/><circle cx="16.5" cy="9" r="2.5"/><path d="M2.5 19c.6-3.6 3-5.5 6-5.5s5.4 1.9 6 5.5"/><path d="M15 13.6c2.9-.2 5.4 1.5 6 4.9"/>',
    "ville": '<path d="M3 6l5-2 8 3 5-2v13l-5 2-8-3-5 2z"/><path d="M8 4v13M16 7v13"/>',
    "finances": '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    "ameliorations": '<path d="M12 3l2.6 5.5 6 .7-4.4 4.1 1.2 5.9L12 16.3 6.6 19.2l1.2-5.9L3.4 9.2l6-.7z"/>',
    "journal": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h10M7 17h6"/>',
    "reglages": '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5" stroke-dasharray="3.2 2.4" stroke-width="3"/>',
    "cahier": '<path d="M5 3h11a3 3 0 0 1 3 3v15H8a3 3 0 0 1-3-3z"/><path d="M5 18a3 3 0 0 1 3-3h11"/><path d="M9 7h6M9 10h4"/>',
    "alerte": '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
    "info": '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    "energie": '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    "cadenas": '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
}


def icon(name, size=22, color=INK, sw=2):
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="{color}" '
            f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{IC[name]}</svg>')


# product glyphs, coloured, 40 x 40
CUP = ('<svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><path d="M9 14h20l-2.5 19a3 3 0 0 1-3 2.6h-9a3 3 0 0 1-3-2.6z" fill="#f3e6c8"/>'
       '<path d="M9 14h20l-.6 4.4H9.6z" fill="#8a5a3c"/><rect x="7" y="10" width="24" height="5" rx="2" fill="#5a3a2a"/>'
       '<path d="M19 14h10l-2.5 19a3 3 0 0 1-3 2.6H19z" fill="#34404f" opacity="0.15"/></svg>')
MUG = ('<svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><path d="M30 17h3a4 4 0 0 1 0 8h-3" fill="none" stroke="#b4532f" stroke-width="3"/>'
       '<rect x="8" y="13" width="23" height="21" rx="4" fill="#b4532f"/><ellipse cx="19.5" cy="14" rx="11.5" ry="3" fill="#6b3a24"/>'
       '<path d="M12 9c0-2 2-2 2-4M18 9c0-2 2-2 2-4M24 9c0-2 2-2 2-4" fill="none" stroke="#a7aeb3" stroke-width="1.6" stroke-linecap="round"/>'
       '<rect x="20" y="13" width="11" height="21" rx="4" fill="#34404f" opacity="0.15"/></svg>')
CROISSANT = ('<svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><path d="M5 26c3-12 27-12 30 0-4-3-7-3-9-1-2-4-10-4-12 0-2-2-5-2-9 1z" fill="#d9903a"/>'
             '<path d="M12 18c2 3 2 6 1 8M20 15.5v10M28 18c-2 3-2 6-1 8" stroke="#a8641f" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
             '<path d="M9 21c3-4 9-6 14-5" stroke="#f3c27a" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>')

FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&amp;family=Nunito:wght@500;600;700;800&amp;display=swap">'

CSS = f"""<style>
body{{margin:0}}
.h1{{font-family:'Fredoka',sans-serif;font-weight:600}}
.chip{{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 14px;border-radius:999px;background:{CREAM};border:2px solid {INK};font-weight:800;font-size:15px;font-variant-numeric:tabular-nums}}
.muted{{color:{MUTED}}}
.btn{{display:inline-flex;align-items:center;justify-content:center;height:40px;min-width:40px;padding:0 12px;border-radius:10px;border:2px solid {INK};background:{CREAM};font:800 15px 'Nunito',sans-serif;color:{INK}}}
.btn.dark{{background:{INK};color:{CREAM}}}
.card{{background:{CREAM};border:3px solid {INK};border-radius:18px;box-shadow:0 6px 0 {INK}}}
.tip{{position:absolute;background:{INK};color:{CREAM};border-radius:12px;padding:10px 12px;font-size:13px;font-weight:700;line-height:1.4;box-shadow:0 8px 24px rgba(0,0,0,.25)}}
.tab{{height:36px;padding:0 14px;border-radius:999px;border:2px solid transparent;display:inline-flex;align-items:center;font-weight:800;font-size:14px;color:{MUTED}}}
.tab.on{{border-color:{INK};color:{INK};background:#fff}}
.stepper{{display:flex;align-items:center;gap:6px}}
.stepper span.val{{min-width:72px;text-align:center;font-family:'Fredoka',sans-serif;font-size:22px;font-weight:600}}
.dot{{width:9px;height:9px;border-radius:5px;display:inline-block}}
</style>"""


def page(title, lang, body, w=1440, h=900):
    return f"""<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
{FONTS}
{CSS}
</helmet>
<div style="position: relative; width: {w}px; height: {h}px; overflow: hidden; background: #cfe8f3; font-family: 'Nunito', sans-serif; color: {INK}">
{body}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":{w},"height":{h}}}}}'>
class Component extends DCLogic {{
  renderVals() {{
    return {{}};
  }}
}}
</script>
</body>
</html>
"""


def sparkline(points, w=70, h=22, color=GREEN):
    mx, mn = max(points), min(points)
    step = w / (len(points) - 1)
    pts = " ".join(f"{i*step:.1f},{h - (p - mn) / (mx - mn or 1) * (h - 4) - 2:.1f}" for i, p in enumerate(points))
    return f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" aria-hidden="true"><polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'


SPARK = sparkline([9.4, 9.1, 9.3, 8.9, 9.6, 9.0, 8.8, 8.79])
ENERGY = (f'<span class="chip" style="gap:6px">{icon("energie", 18, GREEN)}<span style="width:64px;height:8px;border-radius:4px;background:{LINE};display:inline-block">'
          f'<span style="display:block;width:82%;height:8px;border-radius:4px;background:{GREEN}"></span></span></span>')
SPEED = (f'<div style="display:flex;gap:4px;padding:3px;border-radius:12px;background:{CREAM};border:2px solid {INK}">'
         f'<span class="btn" style="border:0;height:32px;background:{AMBER};color:#fff">❚❚</span><span class="btn" style="border:0;height:32px">×1</span>'
         f'<span class="btn dark" style="border:0;height:32px">×3</span><span class="btn" style="border:0;height:32px">×10</span></div>')


def topbar(extra_right=""):
    return f"""<div style="position:absolute;left:16px;top:14px;display:flex;align-items:center;gap:10px">
<div class="card" style="padding:6px 14px;border-radius:14px;box-shadow:0 4px 0 {INK}"><div class="h1" style="font-size:17px;line-height:1.1">Le P'tit Camion</div><div style="font-size:12px;font-weight:800" class="muted">Mardi 9 mai · an 1</div></div>
<span class="chip">Encaisse 8 797 $ {SPARK}</span>
{ENERGY}
</div>
<div style="position:absolute;right:16px;top:14px;display:flex;align-items:center;gap:10px">{extra_right}{SPEED}</div>"""


TICKER = f"""<div style="position:absolute;left:0;bottom:0;width:1440px;height:40px;background:{INK};color:{CREAM};display:flex;align-items:center;gap:12px;padding:0 20px;box-sizing:border-box;font-size:14px;font-weight:700">
<span style="padding:3px 9px;border-radius:6px;background:#e8c547;color:{INK};font-family:'Fredoka',sans-serif;font-size:13px">LA PRESSE-CITRON</span>La Ville installe un parcomètre devant un autre parcomètre.</div>"""


def stepper(val):
    return f'<div class="stepper"><span class="btn" style="height:34px;min-width:34px">−</span><span class="val">{val}</span><span class="btn" style="height:34px;min-width:34px">+</span></div>'


# ======================================================================
# Concept A: the dock
# ======================================================================
def dock_button(name, label, on=False):
    bg = INK if on else CREAM
    fg = CREAM if on else INK
    return (f'<div style="display:flex;flex-direction:column;align-items:center;gap:4px;width:84px">'
            f'<div style="width:60px;height:60px;border-radius:18px;background:{bg};border:3px solid {INK};display:flex;align-items:center;justify-content:center;'
            f'box-shadow:0 {"2" if on else "5"}px 0 {INK};transform:translateY({"3" if on else "0"}px)">{icon(name, 28, fg, 2.2)}</div>'
            f'<span style="font-size:12px;font-weight:800">{label}</span></div>')


def product_card(glyph, name, price, sub, tone, hover=False):
    dot = {"ok": GREEN, "warn": AMBER, "bad": RED}[tone]
    ring = f"outline:3px solid {BLUE};outline-offset:3px;" if hover else ""
    return f"""<div style="flex:1;background:#fff;border:2px solid {INK};border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:10px;{ring}">
<div style="display:flex;align-items:center;gap:10px">{glyph}<div class="h1" style="font-size:19px">{name}</div><span style="margin-left:auto">{icon("info", 18, MUTED)}</span></div>
{stepper(price)}
<div style="display:flex;align-items:center;gap:7px;font-size:13px;font-weight:700"><span class="dot" style="background:{dot}"></span><span class="muted">{sub}</span></div>
</div>"""


A_PANEL = f"""<div class="card" style="position:absolute;left:330px;top:300px;width:780px;padding:18px 22px 20px;display:flex;flex-direction:column;gap:14px">
<div style="display:flex;align-items:center;gap:10px">
<div class="h1" style="font-size:24px">Le camion</div>
<div style="display:flex;gap:6px;margin-left:16px"><span class="tab on">Menu</span><span class="tab">Stocks</span><span class="tab">Horaire</span><span class="tab">Salaire et marketing</span></div>
<span class="btn" style="margin-left:auto;height:34px">✕</span>
</div>
<div style="display:flex;gap:14px">
{product_card(CUP, "Café", "3,25 $", "Bien parti hier", "ok")}
{product_card(MUG, "Chocolat", "3,50 $", "Bien parti hier", "ok")}
{product_card(CROISSANT, "Croissant", "3,75 $", "12 l'ont trouvé trop cher", "warn", hover=True)}
</div>
<div style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:800;padding:8px 12px;border-radius:10px;background:#fbefd5">{icon("info", 16, AMBER)}Les changements s'appliquent demain matin.</div>
</div>
<div class="tip" style="left:906px;top:230px;width:250px">
<div class="h1" style="font-size:15px;margin-bottom:4px">Croissant · hier</div>
<div style="display:grid;grid-template-columns:1fr auto;gap:2px 14px;font-variant-numeric:tabular-nums">
<span>Vendus</span><span>70</span><span>Trop cher</span><span style="color:#f3c27a">12</span><span>Rupture</span><span>0</span><span>Coût d'achat</span><span>1,10 $</span><span>Marge par unité</span><span>2,65 $</span></div>
<div style="position:absolute;left:120px;bottom:-8px;width:16px;height:16px;background:{INK};transform:rotate(45deg)"></div>
</div>"""

A_DOCK = f"""<div style="position:absolute;left:50%;transform:translateX(-50%);bottom:54px;display:flex;align-items:flex-end;gap:6px;padding:12px 16px 10px;border-radius:24px;background:rgba(255,247,232,.94);border:3px solid {INK};box-shadow:0 6px 0 {INK}">
{dock_button("camion", "Camion", True)}{dock_button("equipe", "Équipe")}{dock_button("ville", "Ville")}{dock_button("finances", "Finances")}{dock_button("ameliorations", "Améliorations")}
<div style="width:2px;height:58px;background:{LINE};margin:0 6px 20px"></div>{dock_button("journal", "Journal")}{dock_button("reglages", "Réglages")}
</div>"""

A_ALERTS = f"""<div style="position:absolute;right:16px;top:74px;display:flex;flex-direction:column;gap:8px;align-items:flex-end">
<div class="chip" style="height:36px;font-size:14px;background:#fbefd5">{icon("alerte", 18, AMBER)}Croissants : rupture vers 14 h</div>
<div class="chip" style="height:36px;font-size:14px">{icon("cahier", 18, INK)}2 factures cette semaine</div>
</div>"""

BOARD_A = page("Magnat · Concept A : la barre d'outils", "fr",
               f'{world("ua")}{topbar()}{A_ALERTS}{A_PANEL}{A_DOCK}{TICKER}')

# ======================================================================
# Concept B: the street is the menu
# ======================================================================
CHALK = f"""<svg width="90" height="110" viewBox="0 0 90 110" style="position:absolute;left:1028px;top:586px" aria-hidden="true">
<ellipse cx="50" cy="104" rx="38" ry="5" fill="#34404f" opacity=".35"/>
<path d="M14 104L30 8h30l16 96" fill="none" stroke="#5a3a2a" stroke-width="6" stroke-linecap="round"/>
<rect x="20" y="16" width="50" height="62" rx="4" fill="#2f3a33" stroke="#5a3a2a" stroke-width="4"/>
<rect x="44" y="16" width="26" height="62" fill="#34404f" opacity=".25"/>
<text x="45" y="32" text-anchor="middle" font-family="Fredoka" font-size="9" fill="#fff7e8">MENU</text>
<path d="M27 42h22M27 52h18M27 62h20" stroke="#fff7e8" stroke-width="2" opacity=".8"/><path d="M55 42h8M55 52h8M55 62h8" stroke="#f3c27a" stroke-width="2"/>
</svg>"""


def hotspot(x, y, w, h, label, sub, active=False, below=False):
    col = BLUE if active else CREAM
    style = f"border:3px {'solid' if active else 'dashed'} {col};"
    return (f'<div style="position:absolute;left:{x}px;top:{y}px;width:{w}px;height:{h}px;border-radius:16px;{style}"></div>'
            + ("" if active else f'<div class="chip" style="position:absolute;left:{x}px;top:{y + h + 8 if below else y - 44}px;height:34px;font-size:13px;white-space:nowrap">{label}<span class="muted">{sub}</span></div>'))


B_POP = f"""<div class="card" style="position:absolute;left:1078px;top:330px;width:340px;padding:14px 16px;display:flex;flex-direction:column;gap:10px">
<div style="display:flex;align-items:center"><div class="h1" style="font-size:20px">Le menu</div><span class="btn" style="margin-left:auto;height:30px;min-width:30px">✕</span></div>
<div style="display:flex;align-items:center;gap:8px">{CUP}<span style="font-weight:800;width:70px">Café</span><span class="btn" style="height:30px;min-width:30px">−</span><span class="h1" style="font-size:18px;width:78px;white-space:nowrap;text-align:center">3,25 $</span><span class="btn" style="height:30px;min-width:30px">+</span></div>
<div style="display:flex;align-items:center;gap:8px">{MUG}<span style="font-weight:800;width:70px">Chocolat</span><span class="btn" style="height:30px;min-width:30px">−</span><span class="h1" style="font-size:18px;width:78px;white-space:nowrap;text-align:center">3,50 $</span><span class="btn" style="height:30px;min-width:30px">+</span></div>
<div style="display:flex;align-items:center;gap:8px">{CROISSANT}<span style="font-weight:800;width:70px">Croissant <span class="dot" style="background:{AMBER}"></span></span><span class="btn" style="height:30px;min-width:30px">−</span><span class="h1" style="font-size:18px;width:78px;white-space:nowrap;text-align:center">3,75 $</span><span class="btn" style="height:30px;min-width:30px">+</span></div>
<div style="font-size:12px;font-weight:800" class="muted">Demain matin · survolez un prix pour hier</div>
<div style="position:absolute;left:-12px;top:290px;width:20px;height:20px;background:{CREAM};border-left:3px solid {INK};border-bottom:3px solid {INK};transform:rotate(45deg)"></div>
</div>"""

B_RIGHT = (f'<span class="btn" style="height:42px;gap:6px">{icon("cahier", 20)}Cahier</span>'
           f'<span class="btn" style="height:42px;gap:6px">{icon("ameliorations", 20)}Améliorations</span>'
           f'<span class="btn" style="height:42px">{icon("reglages", 20)}</span>')

B_HINTS = (hotspot(800, 488, 98, 100, "Commandes", " · 70 croissants/jour")
           + hotspot(1022, 580, 100, 118, "", "", active=True)
           + hotspot(694, 500, 76, 100, "Vous", " · horaire, salaire", below=True)
           + hotspot(640, 140, 300, 110, "La ville", " · banque, meunerie, fournil"))

B_LEGEND = f"""<div class="card" style="position:absolute;left:16px;top:84px;width:300px;padding:12px 14px;border-radius:14px;box-shadow:0 4px 0 {INK};font-size:13px;font-weight:700;line-height:1.45">
<div class="h1" style="font-size:16px;margin-bottom:4px">Cliquez sur la rue</div>
L'ardoise : vos prix · Le présentoir : vos commandes · Vous : horaire et salaire · L'horizon : la ville · Le cahier : vos chiffres.<br><span class="muted">Ce rappel disparaît après la première semaine.</span></div>"""

BOARD_B = page("Magnat · Concept B : la rue est le menu", "fr",
               f'{world("ub")}{CHALK}{B_HINTS}{topbar(B_RIGHT)}{B_LEGEND}{B_POP}{TICKER}')

# ======================================================================
# Concept C: the rail and the drawer
# ======================================================================
def rail_button(name, on=False, badge=None):
    b = f'<span style="position:absolute;right:4px;top:4px;min-width:18px;height:18px;border-radius:9px;background:{RED};color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center">{badge}</span>' if badge else ""
    return (f'<div style="position:relative;width:52px;height:52px;border-radius:14px;display:flex;align-items:center;justify-content:center;'
            f'background:{CREAM if on else "transparent"}">{icon(name, 26, INK if on else CREAM, 2.2)}{b}</div>')


C_RAIL = f"""<div style="position:absolute;left:0;top:0;width:72px;height:860px;background:{INK};display:flex;flex-direction:column;align-items:center;gap:10px;padding-top:14px;box-sizing:border-box">
<div class="h1" style="color:{CREAM};font-size:22px;margin-bottom:8px">M</div>
{rail_button("camion")}{rail_button("equipe")}{rail_button("finances", True, 2)}{rail_button("ville")}{rail_button("ameliorations")}{rail_button("journal")}
<div style="margin-top:auto;margin-bottom:16px">{rail_button("reglages")}</div></div>"""


def kpi(label, value, delta, tone, extra=""):
    col = {"ok": GREEN, "bad": RED, "neutral": INK}[tone]
    return (f'<div style="flex:1;background:#fff;border:2px solid {INK};border-radius:14px;padding:10px 12px;{extra}">'
            f'<div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.5px" class="muted">{label}</div>'
            f'<div class="h1" style="font-size:24px;font-variant-numeric:tabular-nums">{value}</div>'
            f'<div style="font-size:12px;font-weight:800;color:{col}">{delta}</div></div>')


def chart30():
    import math
    sales = [300 + 120 * math.sin(i / 2.3) + (180 if i % 7 in (5, 6) else 0) for i in range(30)]
    cash = [s * 0.82 for s in sales]
    sales[18] += 750
    cash[18] *= 0.9
    w, h = 360, 110
    mx = max(sales)

    def line(vals, color, dash=""):
        pts = " ".join(f"{i * w / 29:.1f},{h - v / mx * (h - 10):.1f}" for i, v in enumerate(vals))
        return f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2.4" {dash} stroke-linejoin="round"/>'
    return (f'<svg width="{w}" height="{h + 18}" viewBox="0 0 {w} {h + 18}" aria-hidden="true">'
            f'<line x1="0" y1="{h}" x2="{w}" y2="{h}" stroke="{LINE}" stroke-width="2"/>'
            + line(sales, AMBER) + line(cash, GREEN, 'stroke-dasharray="5 4"')
            + f'<text x="0" y="{h + 15}" font-size="11" font-family="Nunito" font-weight="800" fill="{MUTED}">9 avril</text>'
            f'<text x="{w}" y="{h + 15}" text-anchor="end" font-size="11" font-family="Nunito" font-weight="800" fill="{MUTED}">9 mai</text></svg>')


def accordion(title, open_=False):
    return (f'<div style="display:flex;align-items:center;gap:8px;padding:10px 4px;border-top:2px solid {LINE};font-weight:800">'
            f'<span style="width:14px">{"▾" if open_ else "▸"}</span>{title}<span class="muted" style="margin-left:auto;font-size:12px">Détail complet</span></div>')


C_DRAWER = f"""<div style="position:absolute;left:72px;top:0;width:430px;height:860px;background:{CREAM};border-right:3px solid {INK};box-shadow:8px 0 24px rgba(0,0,0,.18);padding:18px 20px;box-sizing:border-box;display:flex;flex-direction:column;gap:14px">
<div style="display:flex;align-items:center"><div class="h1" style="font-size:26px">Finances</div><span class="btn" style="margin-left:auto;height:34px">⇤</span></div>
<div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.6px" class="muted">En un coup d'œil</div>
<div style="display:flex;gap:10px">{kpi("Encaisse", "8 797 $", "▼ 318 $ cette semaine", "bad")}{kpi("Ce mois-ci", "(1 765 $)", "Perte · 9 jours", "bad", f"outline:3px solid {BLUE};outline-offset:2px;")}</div>
<div style="display:flex;gap:10px">{kpi("Valeur nette", "24 885 $", "▲ 0,4 %", "ok")}{kpi("À recevoir", "750 $", "Lacasse · 8 août", "neutral")}</div>
<div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;margin-top:4px" class="muted">30 derniers jours</div>
<div style="background:#fff;border:2px solid {INK};border-radius:14px;padding:10px 12px">
<div style="display:flex;gap:14px;font-size:12px;font-weight:800;margin-bottom:4px"><span style="color:{AMBER}">━ Ventes</span><span style="color:{GREEN}">┅ Argent reçu</span></div>{chart30()}</div>
<div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;margin-top:4px" class="muted">À surveiller</div>
<div style="display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:700">
<div style="display:flex;gap:8px;align-items:center">{icon("alerte", 18, AMBER)}Assurance et permis : 1 750 $ le 1er juin</div>
<div style="display:flex;gap:8px;align-items:center">{icon("alerte", 18, AMBER)}143 $ de stock jeté ce mois-ci</div></div>
<div style="margin-top:auto">{accordion("Bilan")}{accordion("État des résultats")}{accordion("Flux de trésorerie")}{accordion("Grand livre")}</div>
</div>
<div class="tip" style="left:518px;top:176px;width:250px">
<div class="h1" style="font-size:15px;margin-bottom:4px">Ce mois-ci, du 1er au 9 mai</div>
<div style="display:grid;grid-template-columns:1fr auto;gap:2px 14px;font-variant-numeric:tabular-nums">
<span>Ventes</span><span>2 282 $</span><span>Charges</span><span>3 556 $</span><span>Plus grosse charge</span><span>Loyer et permis</span></div>
<div style="margin-top:6px;color:#f3c27a">Ouvrir l'état des résultats ▸</div>
<div style="position:absolute;left:-8px;top:60px;width:16px;height:16px;background:{INK};transform:rotate(45deg)"></div></div>
<div class="tip" style="left:82px;top:170px;width:84px;text-align:center;display:none"></div>"""

C_TOP = f"""<div style="position:absolute;right:16px;top:14px;display:flex;align-items:center;gap:10px">
<span class="chip">Encaisse 8 797 $ {SPARK}</span>{ENERGY}{SPEED}</div>"""

BOARD_C = page("Magnat · Concept C : le rail et le tiroir", "fr",
               f'{world("uc")}{C_RAIL}{C_DRAWER}{C_TOP}{TICKER}')

# ======================================================================
# Améliorations (shared): illustrated cards
# ======================================================================
SKY = '<defs><linearGradient id="{p}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe0ee"/><stop offset="1" stop-color="#f6e7cf"/></linearGradient></defs><rect width="300" height="150" fill="url(#{p}s)"/>'
GROUND = '<rect y="118" width="300" height="32" fill="#d8cdb8"/><rect y="118" width="300" height="5" fill="#34404f" opacity=".12"/>'


def wheel(x, y, r):
    return f'<circle cx="{x}" cy="{y}" r="{r}" fill="#2b2622"/><circle cx="{x}" cy="{y}" r="{r*0.45}" fill="#a7aeb3"/>'


ART = {
    "velo": lambda p: SKY.format(p=p) + GROUND + '<ellipse cx="152" cy="122" rx="70" ry="5" fill="#34404f" opacity=".3"/>'
    + '<circle cx="105" cy="98" r="24" fill="none" stroke="#2b2622" stroke-width="5"/><circle cx="195" cy="98" r="24" fill="none" stroke="#2b2622" stroke-width="5"/>'
    + '<path d="M105 98l30-38h44l16 38M135 60l14 38h46M150 52h-18M179 60l-6-14h14" fill="none" stroke="#2e7d4f" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>'
    + '<rect x="140" y="70" width="26" height="14" rx="3" fill="#2b2622"/><rect x="143" y="73" width="8" height="8" fill="#e8c547"/>',
    "occasion": lambda p: SKY.format(p=p) + GROUND + '<ellipse cx="150" cy="122" rx="95" ry="6" fill="#34404f" opacity=".3"/>'
    + '<path d="M60 108V82l22-24h92l30 24h20a8 8 0 0 1 8 8v18z" fill="#3f7f8f"/><path d="M90 62h40v22H72zM138 62h34l22 22h-56z" fill="#bfe0ee"/>'
    + '<path d="M60 96h172v12H60z" fill="#34404f" opacity=".25"/><rect x="196" y="88" width="14" height="6" rx="2" fill="#fff1c4"/>'
    + wheel(100, 110, 15) + wheel(196, 110, 15),
    "condo": lambda p: SKY.format(p=p) + GROUND
    + '<rect x="90" y="18" width="120" height="102" fill="#b4532f"/><rect x="170" y="18" width="40" height="102" fill="#34404f" opacity=".18"/>'
    + '<rect x="84" y="12" width="132" height="10" fill="#3f6b4f"/>'
    + "".join(f'<rect x="{x}" y="{y}" width="20" height="24" fill="#bfe0ee" stroke="#f3e6c8" stroke-width="3"/>' for x in (104, 140, 176) for y in (32, 70))
    + '<path d="M96 64h108M96 102h108" stroke="#2b2622" stroke-width="3"/><path d="M120 120c0-20 24-26 24-46" fill="none" stroke="#2b2622" stroke-width="3"/>',
    "luxe": lambda p: SKY.format(p=p) + GROUND + '<ellipse cx="150" cy="122" rx="110" ry="6" fill="#34404f" opacity=".35"/>'
    + '<path d="M40 108v-14c0-6 4-10 10-11l36-6 32-18h66l40 20 24 4c6 1 10 6 10 12v13z" fill="#1f3a5f"/>'
    + '<path d="M124 64h56l30 16h-98z" fill="#bfe0ee"/><path d="M50 84h210" stroke="#fff" stroke-width="2" opacity=".5"/>'
    + '<rect x="244" y="88" width="14" height="5" rx="2" fill="#fff1c4"/>' + wheel(88, 110, 15) + wheel(220, 110, 15),
    "maison": lambda p: SKY.format(p=p) + GROUND + '<rect x="40" y="80" width="30" height="40" fill="#5f9a4a" rx="12"/>'
    + '<rect x="80" y="54" width="150" height="66" fill="#c9c2b6"/><path d="M70 58l85-40 85 40z" fill="#5a4d44"/><path d="M155 18l85 40h-85z" fill="#34404f" opacity=".2"/>'
    + '<rect x="100" y="70" width="24" height="28" fill="#bfe0ee" stroke="#fff7e8" stroke-width="3"/><rect x="186" y="70" width="24" height="28" fill="#bfe0ee" stroke="#fff7e8" stroke-width="3"/>'
    + '<rect x="142" y="80" width="26" height="40" fill="#5a3a2a"/><rect x="150" y="54" width="80" height="66" fill="#34404f" opacity=".12"/>',
    "chalet": lambda p: SKY.format(p=p) + '<rect y="100" width="300" height="50" fill="#5e93a9"/><path d="M0 100h300" stroke="#fff" stroke-width="2" opacity=".5"/>'
    + '<rect y="96" width="300" height="8" fill="#8dbd68"/>'
    + "".join(f'<path d="M{x} 98l14-44 14 44z" fill="#3d6a3f"/>' for x in (8, 32, 238, 262))
    + '<path d="M100 98l50-70 50 70z" fill="#9e6b43"/><path d="M150 28l50 70h-50z" fill="#34404f" opacity=".2"/>'
    + '<path d="M126 98l24-34 24 34z" fill="#bfe0ee"/><path d="M150 64v34M133 88h34" stroke="#9e6b43" stroke-width="3"/>'
    + '<rect x="196" y="40" width="10" height="24" fill="#5a4d44"/><path d="M200 34c4-6 10-6 12-12" stroke="#d8d0c2" stroke-width="4" fill="none" stroke-linecap="round"/>',
}

CARDS = [
    ("velo", "Vélo électrique", "1 500 $", "−30 % de trajet", "buy", None),
    ("occasion", "Voiture d'occasion", "8 000 $", "−50 % de trajet", "progress", (1650, 8000)),
    ("condo", "Condo sur le Plateau", "40 000 $", "Loyer remplacé", "progress", (1650, 40000)),
    ("luxe", "Voiture de luxe", "45 000 $", "+5 % de clients chics", "locked", "Après la voiture d'occasion"),
    ("maison", "Maison à Outremont", "150 000 $", "Hypothèque, plus de loyer", "locked", "Après le condo"),
    ("chalet", "Chalet dans les Laurentides", "90 000 $", "+15 d'énergie par congé", "locked", "Après le condo"),
]


def upgrade_card(i, key, name, price, bonus, state, extra, hover=False):
    art = f'<svg width="300" height="150" viewBox="0 0 300 150" aria-hidden="true" style="display:block">{ART[key]("ug" + str(i))}</svg>'
    shade = "" if state != "locked" else '<div style="position:absolute;inset:0;background:rgba(255,247,232,.55)"></div>'
    lock = "" if state != "locked" else f'<div style="position:absolute;right:10px;top:10px;width:34px;height:34px;border-radius:17px;background:{INK};display:flex;align-items:center;justify-content:center">{icon("cadenas", 18, CREAM)}</div>'
    if state == "buy":
        foot = f'<span class="btn dark" style="height:36px">Acheter</span>'
    elif state == "progress":
        have, need = extra
        foot = (f'<div style="flex:1;display:flex;flex-direction:column;gap:4px"><div style="height:8px;border-radius:4px;background:{LINE}">'
                f'<div style="width:{have / need * 100:.0f}%;height:8px;border-radius:4px;background:{GREEN}"></div></div>'
                f'<span style="font-size:12px;font-weight:800" class="muted">{have:,} $ sur {need:,} $</span></div>').replace(",", " ")
    else:
        foot = f'<span style="font-size:12px;font-weight:800" class="muted">{extra}</span>'
    ring = f"outline:3px solid {BLUE};outline-offset:3px;" if hover else ""
    return f"""<div style="width:300px;background:#fff;border:3px solid {INK};border-radius:16px;overflow:hidden;box-shadow:0 5px 0 {INK};{ring}">
<div style="position:relative">{art}{shade}{lock}</div>
<div style="padding:10px 12px 12px;display:flex;flex-direction:column;gap:6px">
<div style="display:flex;align-items:baseline;gap:8px"><div class="h1" style="font-size:17px">{name}</div><div class="h1" style="margin-left:auto;font-size:16px;white-space:nowrap;font-variant-numeric:tabular-nums">{price}</div></div>
<div style="display:flex;align-items:center;gap:10px"><span style="padding:3px 9px;border-radius:999px;background:#e3efe5;color:{GREEN};font-size:12px;font-weight:800">{bonus}</span></div>
<div style="display:flex;align-items:center;gap:8px;min-height:36px">{foot}</div></div></div>"""


GRID = "".join(upgrade_card(i, *c, hover=(c[0] == "condo")) for i, c in enumerate(CARDS))

U_MODAL = f"""<div style="position:absolute;inset:0;background:rgba(43,38,34,.45)"></div>
<div class="card" style="position:absolute;left:200px;top:70px;width:1040px;height:740px;padding:22px 30px;box-sizing:border-box;display:flex;flex-direction:column;gap:14px">
<div style="display:flex;align-items:center;gap:14px">
<div class="h1" style="font-size:28px">Améliorations</div>
<div style="display:flex;gap:6px;margin-left:10px"><span class="tab on">Vie personnelle</span><span class="tab">Entreprise</span></div>
<span class="btn" style="margin-left:auto;height:36px">✕</span></div>
<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:14px;background:{INK};color:{CREAM}">
{icon("ameliorations", 22, "#e8c547")}<span class="h1" style="font-size:17px">Prochain titre : Débrouillard</span>
<div style="flex:1;height:10px;border-radius:5px;background:#4a423c"><div style="width:99%;height:10px;border-radius:5px;background:#e8c547"></div></div>
<span style="font-weight:800;font-variant-numeric:tabular-nums">24 885 $ / 25 000 $</span></div>
<div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:20px 26px;justify-items:center">{GRID}</div>
</div>
<div class="tip" style="left:1086px;top:262px;width:240px">
<div class="h1" style="font-size:15px;margin-bottom:4px">Condo sur le Plateau</div>
40 000 $ de mise de fonds, payés de votre poche.<br>Hypothèque : 1 100 $ par mois au lieu d'un loyer de 1 300 $.<br><span style="color:#f3c27a">Il vous manque 38 350 $.</span>
<div style="position:absolute;left:-8px;top:40px;width:16px;height:16px;background:{INK};transform:rotate(45deg)"></div></div>"""

BOARD_U = page("Magnat · Améliorations (commun aux trois concepts)", "fr",
               f'{world("uu")}{U_MODAL}')

for name, html in (("UiA.dc.html", BOARD_A), ("UiB.dc.html", BOARD_B), ("UiC.dc.html", BOARD_C), ("UiAmeliorations.dc.html", BOARD_U)):
    (PROJECT / name).write_text(html)
    print(name, len(html))
