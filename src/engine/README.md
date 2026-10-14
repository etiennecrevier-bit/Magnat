Pure, deterministic TypeScript game logic: randomness comes only from the seeded RNG in `rng.ts` and game time advances only through `tick()`; it never imports React, the DOM or anything from `src/ui/`.

`types.ts` is the contract the engine, the books, the UI and the tools share. It is frozen at the end of phase 1: changing it needs a dedicated card. `docs/architecture.md` describes the state, the order of a day and how the books are written.
