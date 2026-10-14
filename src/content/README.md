Every tunable number (prices, costs, pacing, demand) lives here as JSON; no magic numbers in engine code.

`assets.json` is the world's asset manifest: where each piece of the street and the truck sits, its colour, and the image that replaces its placeholder (see `src/world/README.md`). `assets.ts` validates it.
