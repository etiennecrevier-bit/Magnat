# Magnat · design reference pack (October 19, 2026)

Reference files for the cards of the « Interface et look v2 » milestone. They come from the design canvas Étienne approved (« La rue · texture et ombre (v1) », « La ville · texture et ombre (v1) », concepts A, B and C, and « Améliorations »). Étienne chose the **hybrid**: A's dock, B's clickable street, C's finance drawer.

**The numbers in these files are the spec.** Read positions, sizes and colours from the SVG or the Python that made it; do not eyeball the PNGs.

## The world
| File | What it is |
| --- | --- |
| `street-target.svg` | The street as it should look, 1440 × 900, the world's design size. Every piece (sky, Mont Royal and its cross, the far city, five triplexes, the dépanneur, sidewalk, curb, road, lamp, trees, truck, people) is plain SVG. |
| `city-target.svg` | The city view (#165), same rules. |
| `light.py` | The light rules as code: `lit()` mixes 22 % sun `#FFF1CF`, `shd()` mixes 36 % slate `#34404F`, `deep()` 55 %; the gradients and filters. `src/world/light.ts` already holds the same maths. |
| `rue.py` | Generates the street: `building(x, top, w, colour, cornice, rows, stairs, doors, balconies, curtains)` gives each triplex; `GROUND = 646` is the foot of the facades; the truck stands at `T = (540, 410)`; `person()` gives a customer's proportions. |
| `iso2.py` | Generates the city view. |
| `RueLumiere.png`, `VilleLumiere.png` | Renders, for a quick look only. |

## The interface
| File | What it is |
| --- | --- |
| `UiA.png` | Concept A: the dock and « Le camion » panel with its tabs, product cards and the price tooltip. |
| `UiB.png` | Concept B: the street's clickable spots and the « Le menu » popover. |
| `UiC.png` | Concept C: the rail and the « Finances » drawer with progressive disclosure. |
| `UiAmeliorations.png` | « Améliorations », the screen that replaces « Le rêve ». |
| `ui_concepts.py` | Generates the four boards: colours, sizes, CSS classes (`.card`, `.chip`, `.tip`, `.tab`, `.stepper`), tooltip contents. |
| `icon-*.svg` | Dock and UI icons, 24 × 24, 2 px stroke, round caps, `currentColor`-ready (replace the stroke colour). |
| `glyph-cup.svg`, `glyph-mug.svg`, `glyph-croissant.svg` | Product glyphs for the product cards, 40 × 40. |
| `upgrade-*.svg` | Illustrations for « Améliorations », 300 × 150: vélo, voiture d'occasion, condo, voiture de luxe, maison, chalet. Names, prices and bonuses on the boards are placeholders; the real ones come from `src/content/dream.json`. |
