The world draws the game state; it never changes it. It reads `GameState` and the last day's visits, and reports player clicks to the UI layer, which calls the engine.

- It may import the types, the engine, finance and content functions that only read, and the UI store (`useGame`, `gameStore.getState()`) to read the game. It never imports the functions that change the game (`postEntry`, `applyDecision`, `tick`, `playDay`, and the others `eslint.config.js` lists) and never calls the store's `advance` or `setState`. Its tests may, to build their fixtures.
- Engine, finance and content never import anything from here.
- Randomness and the browser are allowed here, since nothing the world does reaches the engine: a customer's walk can wobble without changing the game.
- `WorldCanvas.tsx` mounts the Pixi application in a fixed layer behind the React panels, sized to the window.

## The street

`WorldCanvas.tsx` starts the street with `startStreet` (`street.ts`), which loads the title font and the art, builds the scene (`scene.ts`), fits it to the window (`layout.ts`) and redraws it each time the store's game changes.

- **The manifest** is `src/content/assets.json`: every piece's id, layer, position and size in the 1440 × 900 design, its colour, and optionally an image. Layers are drawn back to front in the order listed, and pieces in each layer in the order listed. Without an image, a piece is drawn as its kind's placeholder from `placeholders.ts`: simple shapes in the palette's colours with dark outlines.
- **Real art** replaces a placeholder without code: put the file under `src/world/art/` (PNG, JPEG, WebP, AVIF or SVG) and set the piece's `image` to its path there, such as `"image": "truck.png"` or `"image": "truck/body.png"`. `art.ts` collects every file in that folder when Vite builds, and the image is stretched to the piece's size. A missing file or one that fails to load warns in the console and keeps the placeholder. `art/dummy.png` is a test image that proves the path from the folder to the screen; no piece uses it.
- **Open or closed** follows the day in the top bar (`game.day`), as `tick()` will play it: with that day's decisions, not those waiting for the next morning. A piece with `"shows": "open"` (the awning, the steam) or `"shows": "closed"` (the rolled awning, the « Fermé » sign) only shows on those days.
- **The croissant rack** shows the croissants the truck opens with that morning: those on hand plus the morning restock, or only those on hand on a closed day. Croissants keep one day, so none are on hand between days. `fill.capacity` croissants fill the rack, shown in `fill.steps` shelves; any croissant shows a shelf (`rackFill` in `truckView.ts`). The restock rule repeats the engine's, which the world may not call; `truckView.test.ts` holds the two together.
- **The sign** reads `"Le P'tit Camion"` in Fredoka SemiBold (`fonts/`, SIL Open Font License), shrunk to fit, until the player names their business.
- **Scaling** keeps the design's proportions: as large as the window allows, centred across and standing on the bottom edge. A taller window shows more sky; a wider one shows more of the rooftops, sidewalk and street, which run past the design's edges.
