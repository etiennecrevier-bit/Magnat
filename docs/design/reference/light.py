"""Shared colour maths, SVG defs and overlays for the textured, shaded Magnat look."""

INK = "#2b2622"
CREAM = "#fff7e8"
SLATE = "#34404f"   # shadow tint: cool slate, never purple, never pure black
SUN = "#fff1cf"     # light tint: warm morning sun
STONE = "#e9dcc4"


def rgb(h):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]


def hexc(c):
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(v))) for v in c)


def mix(a, b, t):
    ca, cb = rgb(a), rgb(b)
    return hexc([x + (y - x) * t for x, y in zip(ca, cb)])


def lit(c, t=0.22):
    return mix(c, SUN, t)


def shd(c, t=0.36):
    return mix(c, SLATE, t)


def deep(c, t=0.55):
    return mix(c, SLATE, t)


DEFS = f"""<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#a3cde2"></stop><stop offset="0.55" stop-color="#d3e9ef"></stop><stop offset="1" stop-color="#f6e7cf"></stop>
</linearGradient>
<linearGradient id="faceV" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="{SUN}" stop-opacity="0.26"></stop><stop offset="0.5" stop-color="{SUN}" stop-opacity="0"></stop><stop offset="1" stop-color="{SLATE}" stop-opacity="0.30"></stop>
</linearGradient>
<linearGradient id="faceH" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="{SUN}" stop-opacity="0.30"></stop><stop offset="0.45" stop-color="{SUN}" stop-opacity="0"></stop><stop offset="1" stop-color="{SLATE}" stop-opacity="0.38"></stop>
</linearGradient>
<linearGradient id="dropDown" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="{SLATE}" stop-opacity="0.55"></stop><stop offset="1" stop-color="{SLATE}" stop-opacity="0"></stop>
</linearGradient>
<linearGradient id="aoUp" x1="0" y1="1" x2="0" y2="0">
<stop offset="0" stop-color="{SLATE}" stop-opacity="0.50"></stop><stop offset="1" stop-color="{SLATE}" stop-opacity="0"></stop>
</linearGradient>
<linearGradient id="glass" x1="0" y1="0" x2="0.35" y2="1">
<stop offset="0" stop-color="#e6f3f5"></stop><stop offset="0.45" stop-color="#a8cad7"></stop><stop offset="1" stop-color="#6a8ea2"></stop>
</linearGradient>
<linearGradient id="glassDark" x1="0" y1="0" x2="0.35" y2="1">
<stop offset="0" stop-color="#a9c2cc"></stop><stop offset="1" stop-color="#4d6676"></stop>
</linearGradient>
<linearGradient id="warmInside" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#ffe9bd"></stop><stop offset="1" stop-color="#e9b980"></stop>
</linearGradient>
<linearGradient id="chrome" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#dfe6ea"></stop><stop offset="0.45" stop-color="#8d9aa2"></stop><stop offset="1" stop-color="#55626a"></stop>
</linearGradient>
<linearGradient id="asphalt" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#46423f"></stop><stop offset="0.18" stop-color="#5c5752"></stop><stop offset="1" stop-color="#625d57"></stop>
</linearGradient>
<linearGradient id="sidewalk" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#bfb6a8"></stop><stop offset="0.35" stop-color="#ddd5c7"></stop><stop offset="1" stop-color="#e7dfd1"></stop>
</linearGradient>
<radialGradient id="sunGlow" cx="0.08" cy="0.02" r="1.0">
<stop offset="0" stop-color="#fff3d2" stop-opacity="0.75"></stop><stop offset="0.55" stop-color="#fff3d2" stop-opacity="0.12"></stop><stop offset="1" stop-color="#fff3d2" stop-opacity="0"></stop>
</radialGradient>
<radialGradient id="vignette" cx="0.5" cy="0.48" r="0.78">
<stop offset="0.62" stop-color="{INK}" stop-opacity="0"></stop><stop offset="1" stop-color="{INK}" stop-opacity="0.26"></stop>
</radialGradient>
<radialGradient id="roundLit" cx="0.32" cy="0.28" r="0.85">
<stop offset="0" stop-color="{SUN}" stop-opacity="0.45"></stop><stop offset="0.5" stop-color="{SUN}" stop-opacity="0"></stop><stop offset="1" stop-color="{SLATE}" stop-opacity="0.42"></stop>
</radialGradient>
<pattern id="bricks" width="28" height="14" patternUnits="userSpaceOnUse">
<path d="M0 6.6H28M0 13.6H28M7 0V6.6M21 7V13.6" stroke="{INK}" stroke-opacity="0.16" stroke-width="1.2" fill="none"></path>
<rect x="7.7" y="0" width="12.6" height="6" fill="{SUN}" fill-opacity="0.08"></rect>
<rect x="0" y="7.2" width="6.4" height="6" fill="{SLATE}" fill-opacity="0.08"></rect>
</pattern>
<pattern id="brickVar" width="98" height="42" patternUnits="userSpaceOnUse">
<rect x="7.7" y="0.6" width="12.6" height="6" fill="{SUN}" fill-opacity="0.12"></rect>
<rect x="49.7" y="14.6" width="12.6" height="6" fill="{SLATE}" fill-opacity="0.12"></rect>
<rect x="21.7" y="28.6" width="12.6" height="6" fill="{SLATE}" fill-opacity="0.10"></rect>
<rect x="77.7" y="35.6" width="12.6" height="6" fill="{SUN}" fill-opacity="0.12"></rect>
<rect x="63.7" y="7.6" width="12.6" height="6" fill="{SLATE}" fill-opacity="0.08"></rect>
</pattern>
<pattern id="leaves" width="22" height="18" patternUnits="userSpaceOnUse">
<circle cx="4" cy="5" r="2.4" fill="{SLATE}" fill-opacity="0.16"></circle>
<circle cx="15" cy="12" r="2.8" fill="{SLATE}" fill-opacity="0.13"></circle>
<circle cx="12" cy="3" r="1.8" fill="{SUN}" fill-opacity="0.18"></circle>
</pattern>
<filter id="soft2" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2"></feGaussianBlur></filter>
<filter id="soft4" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"></feGaussianBlur></filter>
<filter id="soft8" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="8"></feGaussianBlur></filter>
<filter id="grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" stitchTiles="stitch"></feTurbulence>
<feColorMatrix type="saturate" values="0"></feColorMatrix>
</filter>
<filter id="mottle" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.007 0.011" numOctaves="3" seed="12"></feTurbulence>
<feColorMatrix type="saturate" values="0"></feColorMatrix>
</filter>
</defs>"""


def overlays(w=1440, h=900, grain="{{grain}}"):
    """Light, painted unevenness, film grain and vignette, in that order, over the world only."""
    return f"""<g pointer-events="none">
<rect x="0" y="0" width="{w}" height="{h}" fill="url(#sunGlow)" style="mix-blend-mode: soft-light"></rect>
<rect x="0" y="0" width="{w}" height="{h}" filter="url(#mottle)" opacity="0.30" style="mix-blend-mode: soft-light"></rect>
<rect x="0" y="0" width="{w}" height="{h}" filter="url(#grain)" opacity="{grain}" style="mix-blend-mode: overlay"></rect>
<rect x="0" y="0" width="{w}" height="{h}" fill="url(#vignette)"></rect>
</g>"""


def poly(points, fill, extra=""):
    pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in points)
    return f'<polygon points="{pts}" fill="{fill}"{(" " + extra) if extra else ""}></polygon>'


def rect(x, y, w, h, fill, extra=""):
    return f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" fill="{fill}"{(" " + extra) if extra else ""}></rect>'


def scope_ids(page, prefix):
    """Prefix every SVG id and url(#id) so boards never share ids on the canvas."""
    import re
    ids = set(re.findall(r'\bid="([A-Za-z][\w-]*)"', page))
    for i in sorted(ids, key=len, reverse=True):
        page = page.replace(f'id="{i}"', f'id="{prefix}-{i}"').replace(f'url(#{i})', f'url(#{prefix}-{i})')
    return page
