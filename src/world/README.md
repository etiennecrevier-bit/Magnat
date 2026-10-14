The world draws the game state; it never changes it. It reads `GameState` and the last day's visits, and reports player clicks to the UI layer, which calls the engine.

- It may import the types, the engine, finance and content functions that only read, and the UI store (`useGame`, `gameStore.getState()`) to read the game. It never imports the functions that change the game (`postEntry`, `applyDecision`, `tick`, `playDay`, and the others `eslint.config.js` lists) and never calls the store's `advance` or `setState`. Its tests may, to build their fixtures.
- Engine, finance and content never import anything from here.
- Randomness and the browser are allowed here, since nothing the world does reaches the engine: a customer's walk can wobble without changing the game.
- `WorldCanvas.tsx` mounts the Pixi application in a fixed layer behind the React panels, sized to the window.
