import { describe, expect, it } from 'vitest'
import { boxCorners, type Vec } from './iso.ts'
import { fitCity, fitScene, fitStreet } from './layout.ts'
import { ASSETS } from './manifest.ts'

// Vitest hands CSS imports to tests empty, `?raw` included, so the test reads
// the stylesheet from disk, as WorldCanvas.test.tsx does.
const NODE_FS: string = 'node:fs'
const { readFileSync } = (await import(/* @vite-ignore */ NODE_FS)) as {
  readFileSync: (path: URL, encoding: 'utf8') => string
}

describe('fitScene', () => {
  it('draws the design at its own size in a view of that size', () => {
    expect(fitScene(1440, 900, 1440, 900)).toEqual({ scale: 1, x: 0, y: 0 })
  })

  it('shrinks the design to a smaller view of the same proportions', () => {
    const fit = fitScene(1280, 800, 1440, 900)
    expect(fit.scale).toBeCloseTo(1280 / 1440)
    expect(fit.x).toBeCloseTo(0)
    expect(fit.y).toBeCloseTo(0)
  })

  it('centres the design across a wider view', () => {
    expect(fitScene(1920, 900, 1440, 900)).toEqual({ scale: 1, x: 240, y: 0 })
  })

  it('stands the design on the bottom of a taller view', () => {
    expect(fitScene(1440, 1200, 1440, 900)).toEqual({
      scale: 1,
      x: 0,
      y: 300,
    })
  })

  it('keeps the proportions in a narrow view', () => {
    const fit = fitScene(720, 900, 1440, 900)
    expect(fit.scale).toBe(0.5)
    expect(fit).toEqual({ scale: 0.5, x: 0, y: 450 })
  })
})

describe('fitStreet', () => {
  const { frame, designSize } = ASSETS
  const { focus } = frame
  const whole = (width: number, height: number) =>
    fitScene(width, height, designSize.width, designSize.height)

  it('narrows to a phone where Dock.css does', () => {
    const css = readFileSync(new URL('../ui/Dock.css', import.meta.url), 'utf8')
    expect(css).toContain(`@media (max-width: ${frame.narrow - 1}px)`)
  })

  it('holds the truck, its line, the chalkboard and the employee in its focus', () => {
    const inside = (
      {
        x,
        y,
        width,
        height,
      }: { x: number; y: number; width: number; height: number },
      id: string,
    ) => {
      expect(x, id).toBeGreaterThanOrEqual(focus.x)
      expect(x + width, id).toBeLessThanOrEqual(focus.x + focus.width)
      expect(y, id).toBeGreaterThanOrEqual(focus.y)
      expect(y + height, id).toBeLessThanOrEqual(focus.y + focus.height)
    }
    for (const id of ['truck', 'chalkboard', 'counter', 'awning']) {
      inside(
        ASSETS.pieces.find((p) => p.id === id)!,
        id,
      )
    }
    for (const id of ['menu', 'stocks', 'owner', 'employee']) {
      inside(
        ASSETS.spots.find((s) => s.id === id)!,
        id,
      )
    }
  })

  for (const [width, height] of [
    [1280, 720],
    [1440, 900],
    [1920, 1080],
    [700, 900],
  ] as const) {
    it(`fits the whole design, on the bottom, at ${width} × ${height}`, () => {
      expect(fitStreet(width, height, ASSETS)).toEqual(whole(width, height))
    })
  }

  for (const [width, height] of [
    [390, 844],
    [320, 568],
    [360, 640],
    [430, 932],
    [699, 900],
  ] as const) {
    it(`shows the focus between the top bar and the dock at ${width} × ${height}`, () => {
      const fit = fitStreet(width, height, ASSETS)
      const x0 = fit.x + focus.x * fit.scale
      const x1 = fit.x + (focus.x + focus.width) * fit.scale
      const y0 = fit.y + focus.y * fit.scale
      const y1 = fit.y + (focus.y + focus.height) * fit.scale
      // Across the window, centred, standing on the dock.
      expect(x0).toBeGreaterThanOrEqual(-0.001)
      expect(x1).toBeLessThanOrEqual(width + 0.001)
      expect(x0).toBeCloseTo(width - x1)
      expect(y0).toBeGreaterThanOrEqual(frame.top - 0.001)
      expect(y1).toBeCloseTo(height - frame.bottom)
      // As large as it allows, and larger than the whole design.
      expect(Math.min(x0, y0 - frame.top)).toBeCloseTo(0)
      expect(fit.scale).toBeGreaterThan(whole(width, height).scale)
    })
  }

  it('fits the whole design when the bars leave no room between them', () => {
    expect(fitStreet(690, 400, ASSETS)).toEqual(whole(690, 400))
  })
})

describe('fitCity', () => {
  const { city } = ASSETS
  const { frame } = city
  /** Where « Ville » ends across, as TripPanel.css places it. */
  const panelEnd = (width: number) =>
    frame.panel.left +
    Math.min(frame.panel.width, frame.panel.share * width - frame.panel.inset)

  it('reads the panel where TripPanel.css puts it', () => {
    const css = readFileSync(
      new URL('../ui/TripPanel.css', import.meta.url),
      'utf8',
    )
    const rule =
      /\.panel\.dock-frame\.trip \{\s*left: 1rem;\s*width: min\((\d+)px, calc\((\d+)% - 2rem\)\);/
    const [, width, percent] = css.match(rule) ?? []
    expect(frame.panel).toEqual({
      left: 16,
      width: Number(width),
      share: Number(percent) / 100,
      inset: 32,
    })
    expect(css).toContain(`@media (max-width: ${frame.narrow - 1}px)`)
  })

  it('holds every piece of the island, the line and the ways in its frame, but the shadows falling off it', () => {
    const { island } = frame
    const inside = ([x, y]: readonly number[], id: string) => {
      expect(x, id).toBeGreaterThanOrEqual(island.x)
      expect(x, id).toBeLessThanOrEqual(island.x + island.width)
      expect(y, id).toBeGreaterThanOrEqual(island.y)
      expect(y, id).toBeLessThanOrEqual(island.y + island.height)
    }
    for (const p of city.pieces) {
      if (p.layer === 'sky') continue
      const { x, y, width, height } = p.art ?? p
      if (p.kind === 'shadows') continue
      if (p.id === 'island') {
        // Its drop shadow may go under the dock.
        inside([x + width / 2, island.y + island.height], p.id)
        continue
      }
      inside([x, y], p.id)
      inside([x + width, y + height], p.id)
    }
    const { first, step, max } = city.truck.line
    inside(
      [first[0] + step[0] * (max - 1), first[1] + step[1] * (max - 1)],
      'line',
    )
    for (const [id, route] of Object.entries(city.routes)) {
      for (const point of route) inside(point, id)
    }
  })

  for (const [width, height] of [
    [1280, 720],
    [1440, 900],
    [1920, 1080],
    [2560, 1080],
  ] as const) {
    it(`leaves the whole island in sight beside « Ville » at ${width} × ${height}`, () => {
      const fit = fitCity(width, height, city)
      const { island } = frame
      const page = (x: number, y: number): Vec => [
        fit.x + x * fit.scale,
        fit.y + y * fit.scale,
      ]
      const [x0, y0] = page(island.x, island.y)
      const [x1, y1] = page(island.x + island.width, island.y + island.height)
      // The room right of the panel, between the bars, and what is left of
      // it across and down.
      const room = {
        left: panelEnd(width) + frame.gap,
        right: width - frame.gap,
        top: frame.top,
        bottom: height - frame.bottom,
      }
      const across = room.right - room.left - (x1 - x0)
      const down = room.bottom - room.top - (y1 - y0)
      // Centred there, as large as it allows.
      expect(x0 - room.left).toBeCloseTo(across / 2)
      expect(y0 - room.top).toBeCloseTo(down / 2)
      expect(Math.min(across, down)).toBeCloseTo(0)
      expect(Math.min(across, down)).toBeGreaterThanOrEqual(-0.001)
      // Every building that opens something, then, right of the panel.
      for (const p of city.pieces.filter((p) => p.opens !== undefined)) {
        const { left } = boxCorners(p)
        expect(page(...left)[0]!, p.id).toBeGreaterThan(panelEnd(width))
      }
    })
  }

  it('shows the city at 1440 × 900 at least half as big as the design', () => {
    expect(fitCity(1440, 900, city).scale).toBeGreaterThan(0.65)
    expect(fitCity(1280, 720, city).scale).toBeGreaterThan(0.5)
  })

  it('fits the whole design on a phone, where the panel comes down from the top', () => {
    expect(fitCity(390, 844, city)).toEqual(fitScene(390, 844, 1440, 900))
    expect(fitCity(699, 900, city)).toEqual(fitScene(699, 900, 1440, 900))
  })

  it('fits the whole design when the bars leave no room between them', () => {
    expect(fitCity(1280, 250, city)).toEqual(fitScene(1280, 250, 1440, 900))
  })
})
