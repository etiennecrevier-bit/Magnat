Every tunable number (prices, costs, pacing, demand) lives here as JSON; no magic numbers in engine code.

`assets.json` is the world's asset manifest: where each piece of the street and the truck sits, its colour, and the image that replaces its placeholder (see `src/world/README.md`). `assets.ts` validates it.

`difficulty.json` holds the three ways to start a game (Facile, Moyen, Difficile): the cash in the bank and how the truck comes to the business, as the new game screen shows them. `profile.json` holds the new game screen's defaults (business name, avatar, difficulty) and the longest business name. `schema.ts` validates both.
