# Magnat: game design brief

## Vision
Single-player browser tycoon game in French (Quebec). The player grows a coffee-and-croissant food truck into a business empire. They learn finance and operations without ever being taught: every business concept is a mechanic that can hurt them, never a lesson card. Target player: someone who plays Sim Companies for fun and doesn't know they're learning.

## Core loop: the cash conversion cycle
Cash -> ingredients and stock (paid upfront, perishable) -> production (capacity limits) -> sales (three customer segments) -> cash the same day (walk-ins) or receivables (grocers pay at 60 days, from phase 3) -> cash.
The first "aha" moment: the best sales month ever is the month the player nearly goes bankrupt, because stock was paid upfront and the grocer pays in 60 days.

## Concepts as mechanics
| Concept | Player decides | What bites |
| --- | --- | --- |
| Working capital | Stock levels, sales channels, payment terms | Growth eats cash |
| Price elasticity | Price per product and channel | Segments react differently |
| Customer acquisition cost | Marketing spend per channel | Channels cost different amounts per customer |
| Repeat customers and churn | Quality, price stability, service | Customers leave; one-time customers were expensive |
| Capacity and bottlenecks | Equipment, staff, shifts | The slowest step caps output |
| Inventory and spoilage | Order size and timing | Croissants are worthless by evening |
| Debt and dilution | Borrow or sell shares | Emergency loans are expensive; selling shares is permanent |

Customer segments: bargain hunters, loyal regulars, premium buyers. AI competitors come in v2.

## Rules of the world
- Real time with pause. Speeds: pause, x1, x3, x10. One game day lasts 4 seconds at x1 (tunable).
- No game over. Running out of cash means an emergency loan from the banker (cautious, punishing rate, conditions, never takes shares) or selling shares to the investor (fast, charming, each round costs a bigger slice).
- Score: the player's net worth = their share of the company's value + personal cash.
- Real financial statements with real Quebec French names, never explained. A simplified cash gauge in the top bar.

## Pacing
About 10 hours to become a magnate with four divisions (~2.5 h each): food (truck, bakery, bread plant), then real estate, then a services company, then a consumer brand. v1 is the food division only, as an endless sandbox. First sale within 30 seconds; something new every 5 to 10 minutes; a milestone every 20 to 30 minutes.

## Phases (v1)
0. Foundations: repo, CI, deploy, game clock.
1. Engine and books: daily ticks, double-entry journal, three statements, food truck selling to walk-ins.
2. A playable food truck: prices, segments, elasticity, stock and spoilage, cash gauge, saves, first balance-bot runs.
3. Growth and the cash trap: bakery, grocery contracts at 60 days, capacity, emergency loan and share sale.
4. Customers and marketing: channels with acquisition costs, repeat customers, churn.
5. The plant and polish: production plant, net worth scoreboard, events, polish.
