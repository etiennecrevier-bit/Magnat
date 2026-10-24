import { Texture } from 'pixi.js'
import { describe, expect, it } from 'vitest'
import {
  createCaleche,
  createCalecheClock,
  type CalecheSettings,
} from './caleche.ts'
import { ASSETS } from './manifest.ts'

const CALECHE: CalecheSettings = ASSETS.districtStreets.vieuxMontreal!.caleche
const SPAN = { left: -100, right: 1540 }

/** A `random` that always gives `value`. */
const always = (value: number) => () => value

describe("the calèche's clock (#264)", () => {
  it('waits, then crosses from the right edge to past the left one, at its speed', () => {
    const clock = createCalecheClock(CALECHE, always(0.5))
    // It first comes half of `everyMs` in.
    expect(clock.step(CALECHE.everyMs / 2 - 1, SPAN)).toBeNull()
    expect(clock.step(1, SPAN)).toBe(SPAN.right)
    expect(clock.step(1000, SPAN)).toBeCloseTo(SPAN.right - CALECHE.speed)
    const crossingMs =
      ((SPAN.right - SPAN.left + CALECHE.width) / CALECHE.speed) * 1000
    expect(clock.step(crossingMs, SPAN)).toBeNull()
  })

  it('comes again `everyMs` later, give or take `jitterMs`', () => {
    for (const draw of [0, 1]) {
      const clock = createCalecheClock(CALECHE, always(draw))
      // It comes within `everyMs` of the start.
      expect(clock.step(CALECHE.everyMs, SPAN)).toBe(SPAN.right)
      // Gone past the left edge.
      clock.step(1e7, SPAN)
      const gap = CALECHE.everyMs + (draw * 2 - 1) * CALECHE.jitterMs
      expect(clock.step(gap - 1, SPAN)).toBeNull()
      expect(clock.step(1, SPAN)).toBe(SPAN.right)
    }
  })

  it('stands still without time', () => {
    const clock = createCalecheClock(CALECHE, always(0))
    expect(clock.step(1, SPAN)).toBe(SPAN.right)
    expect(clock.step(0, SPAN)).toBe(SPAN.right)
  })
})

describe('the calèche (#264)', () => {
  it('crosses in summer only, at its height and size', () => {
    const caleche = createCaleche(CALECHE, Texture.WHITE, always(0))
    caleche.frame(16, SPAN)
    expect(caleche.root.visible).toBe(false)
    caleche.show(true)
    caleche.frame(16, SPAN)
    expect(caleche.root.visible).toBe(true)
    expect(caleche.root.y).toBe(CALECHE.y)
    expect(caleche.root.children[0]?.width).toBe(CALECHE.width)
    caleche.show(false)
    expect(caleche.root.visible).toBe(false)
    caleche.frame(16, SPAN)
    expect(caleche.root.visible).toBe(false)
    caleche.destroy()
  })

  it('never crosses without its image', () => {
    const caleche = createCaleche(CALECHE, undefined, always(0))
    caleche.show(true)
    for (let i = 0; i < 100; i += 1) caleche.frame(1000, SPAN)
    expect(caleche.root.visible).toBe(false)
  })
})
