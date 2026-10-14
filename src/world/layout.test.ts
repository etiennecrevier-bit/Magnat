import { describe, expect, it } from 'vitest'
import { fitScene } from './layout.ts'

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
