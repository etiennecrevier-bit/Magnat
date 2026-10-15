Every tunable number (prices, costs, pacing, demand) lives here as JSON; no magic numbers in engine code.

`assets.json` is the world's asset manifest: where each piece of the street and the truck sits, its colour, and the image that replaces its placeholder (see `src/world/README.md`). `assets.ts` validates it.

`foodtruck.json` holds the truck's numbers: the products (unit cost, packaging, shelf life), the truck's price and useful life, the monthly costs (permit, parking and commissary; insurance), the fuel per open day, the card payments (the share of sales paid by card and the fee), payday, the walk-ins, and the player's starting decisions and their limits.

`difficulty.json` holds the three ways to start a game (Facile, Moyen, Difficile): the cash in the bank once the truck is settled, and how the truck comes to the business. Facile owns it; Moyen buys it with a startup loan, whose yearly rate is in basis points (800 is 8 %) and whose term is in months; Difficile leases it by the month. The engine opens the books and charges the truck from these. `profile.json` holds the new game screen's defaults (business name, avatar, difficulty) and the longest business name. `schema.ts` validates all three.

`cashGauge.json` sets when the top bar's cash reads low: below this many months of what every truck pays monthly.
