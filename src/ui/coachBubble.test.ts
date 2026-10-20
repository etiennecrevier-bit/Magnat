import { describe, expect, it } from 'vitest'
import {
  bubbleWidth,
  COACH,
  cycleFocus,
  holeBlockers,
  holeBox,
  placeBubble,
  showsWhole,
  visibleBox,
} from './coachBubble.ts'
import type { Box } from './tooltip.ts'

const PAGE = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }
const SIZE = { width: COACH.width, height: 160 }

const box = (
  left: number,
  top: number,
  width: number,
  height: number,
): Box => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
})

/** Whether `place` of `size` stays inside the margins of `page`. */
function inside(
  place: { left: number; top: number; width: number },
  height: number,
  page: { width: number; height: number },
) {
  return (
    place.left >= COACH.margin &&
    place.top >= COACH.margin &&
    place.left + place.width <= page.width - COACH.margin &&
    place.top + height <= page.height - COACH.margin
  )
}

describe('placeBubble', () => {
  it('goes right of its target when there is room, its arrow at the target’s middle', () => {
    const target = box(100, 400, 60, 40)
    const place = placeBubble(target, SIZE, PAGE, false)
    expect(place.side).toBe('right')
    expect(place.left).toBe(target.right + COACH.gap)
    expect(place.top + place.arrow).toBe(420)
    expect(inside(place, SIZE.height, PAGE)).toBe(true)
  })

  it('goes left when the right has no room, then above, then below', () => {
    const right = placeBubble(box(1300, 400, 60, 40), SIZE, PAGE, false)
    expect(right.side).toBe('left')
    expect(right.left + right.width).toBe(1300 - COACH.gap)

    // A target as wide as the window: no room either side.
    const wide = { ...SIZE }
    const low = placeBubble(box(0, 700, 1440, 40), wide, PAGE, false)
    expect(low.side).toBe('above')
    expect(low.top + SIZE.height).toBe(700 - COACH.gap)

    const high = placeBubble(box(0, 20, 1440, 40), wide, PAGE, false)
    expect(high.side).toBe('below')
    expect(high.top).toBe(60 + COACH.gap)
  })

  it('stays inside the window, sliding along its side, near an edge', () => {
    const place = placeBubble(box(100, 870, 60, 24), SIZE, PAGE, false)
    expect(place.side).toBe('right')
    expect(inside(place, SIZE.height, PAGE)).toBe(true)
    // The arrow still points into the target, clear of the corner.
    expect(place.arrow).toBeLessThanOrEqual(
      SIZE.height - COACH.corner - COACH.arrow,
    )
  })

  it('with no side free, takes the roomiest and slides inside the window', () => {
    const place = placeBubble(box(0, 0, 1440, 900), SIZE, PAGE, false)
    expect(inside(place, SIZE.height, PAGE)).toBe(true)
  })

  it('centres the bubble with no target', () => {
    const place = placeBubble(null, SIZE, PAGE, false)
    expect(place).toMatchObject({
      side: 'center',
      left: (1440 - COACH.width) / 2,
      top: (900 - 160) / 2,
    })
  })

  it('on a phone, goes below its target or above, full width less 16 px', () => {
    const width = bubbleWidth(PHONE, true)
    expect(width).toBe(390 - 16)
    const size = { width, height: 150 }
    const dock = placeBubble(box(20, 760, 60, 60), size, PHONE, true)
    expect(dock).toMatchObject({ side: 'above', left: 8, width: 374 })
    expect(dock.top + 150).toBe(760 - COACH.gap)
    expect(dock.left + dock.arrow).toBe(50)
    const bar = placeBubble(box(200, 10, 60, 40), size, PHONE, true)
    expect(bar).toMatchObject({ side: 'below', top: 50 + COACH.gap })
    // Room both ways: below, so what leads to the target shows.
    const choices = placeBubble(box(16, 340, 358, 210), size, PHONE, true)
    expect(choices).toMatchObject({ side: 'below', top: 550 + COACH.gap })
  })

  it('keeps its width on a wide window, and narrows on a narrow one', () => {
    expect(bubbleWidth(PAGE, false)).toBe(COACH.width)
    expect(bubbleWidth({ width: 300, height: 600 }, false)).toBe(284)
  })
})

describe('holeBox and holeBlockers', () => {
  it('pads the hole around its target, inside the window', () => {
    expect(holeBox(box(100, 100, 50, 20), PAGE)).toEqual(box(94, 94, 62, 32))
    expect(holeBox(box(0, 0, 50, 20), PAGE)).toEqual(box(0, 0, 56, 26))
  })

  /** Whether some block covers the point. */
  const blocked = (blocks: readonly Box[], x: number, y: number) =>
    blocks.some(
      (block) =>
        x >= block.left &&
        x < block.right &&
        y >= block.top &&
        y < block.bottom,
    )

  it('cover every point of the window but the hole, so the target is the only thing to click', () => {
    const hole = box(600, 400, 120, 48)
    const blocks = holeBlockers(hole, PAGE)
    expect(blocks).toHaveLength(4)
    for (let x = 0; x < PAGE.width; x += 20) {
      for (let y = 0; y < PAGE.height; y += 20) {
        const inHole =
          x >= hole.left && x < hole.right && y >= hole.top && y < hole.bottom
        expect(blocked(blocks, x, y), `${x},${y}`).toBe(!inHole)
      }
    }
  })

  it('cover the whole window without a hole', () => {
    const blocks = holeBlockers(null, PAGE)
    expect(blocked(blocks, 0, 0)).toBe(true)
    expect(blocked(blocks, 1439, 899)).toBe(true)
    expect(blocked(blocks, 720, 450)).toBe(true)
  })
})

describe('visibleBox', () => {
  it('cuts a target to what shows through what scrolls around it', () => {
    const body = box(0, 100, 400, 300)
    const target = box(20, 350, 100, 100)
    const shown = visibleBox(target, [body], PAGE)
    expect(shown).toEqual(box(20, 350, 100, 50))
    expect(showsWhole(target, shown!)).toBe(false)
    expect(showsWhole(target, visibleBox(target, [], PAGE)!)).toBe(true)
  })

  it('is null for a target scrolled out of view, or off the window', () => {
    expect(
      visibleBox(box(20, 500, 100, 40), [box(0, 100, 400, 300)], PAGE),
    ).toBe(null)
    expect(visibleBox(box(-200, 20, 100, 40), [], PAGE)).toBeNull()
  })
})

describe('cycleFocus', () => {
  it('goes round the target and the bubble’s controls, both ways', () => {
    const items = ['stepper', 'skip']
    expect(cycleFocus(items, 'stepper', false)).toBe('skip')
    expect(cycleFocus(items, 'skip', false)).toBe('stepper')
    expect(cycleFocus(items, 'stepper', true)).toBe('skip')
    expect(cycleFocus(items, 'elsewhere', false)).toBe('stepper')
    expect(cycleFocus(items, null, true)).toBe('skip')
    expect(cycleFocus([], null, false)).toBeNull()
  })
})
