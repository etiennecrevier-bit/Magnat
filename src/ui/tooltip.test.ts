import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTipControl,
  placeTip,
  TIP,
  tipBounds,
  type Box,
  type TipControl,
} from './tooltip.ts'

const PAGE = { width: 1280, height: 800 }

/** A 40 × 40 anchor whose top left corner is at (`left`, `top`). */
function anchorAt(left: number, top: number): Box {
  return { left, top, right: left + 40, bottom: top + 40 }
}

describe('tipBounds', () => {
  it('takes its width and the window less the margins in height', () => {
    expect(tipBounds(PAGE, TIP)).toEqual({ width: 250, maxHeight: 784 })
    expect(tipBounds(PAGE, TIP, 180).width).toBe(180)
  })

  it('narrows to fit a narrow, short window between its margins', () => {
    expect(tipBounds({ width: 200, height: 90 }, TIP)).toEqual({
      width: 184,
      maxHeight: 74,
    })
    expect(tipBounds({ width: 10, height: 10 }, TIP)).toEqual({
      width: 0,
      maxHeight: 0,
    })
  })
})

describe('placeTip', () => {
  it('goes right of its anchor, centred on its middle, when there is room', () => {
    const place = placeTip(
      anchorAt(100, 300),
      { width: 250, height: 120 },
      PAGE,
      TIP,
    )
    expect(place).toEqual({
      left: 150,
      top: 260,
      width: 250,
      height: 120,
      side: 'right',
      arrow: 60,
    })
  })

  it('goes left of an anchor at the right edge, flush at its full width', () => {
    // A short tooltip is as wide as the others: its right edge meets the gap.
    const place = placeTip(
      anchorAt(1200, 300),
      { width: 250, height: 36 },
      PAGE,
      TIP,
    )
    expect(place.side).toBe('left')
    expect(place.left + place.width).toBe(1200 - TIP.gap)
  })

  it('goes above when neither side has room, centred across and inside', () => {
    const page = { width: 400, height: 800 }
    const place = placeTip(
      anchorAt(180, 500),
      { width: 250, height: 100 },
      page,
      TIP,
    )
    expect(place.side).toBe('above')
    expect(place.left).toBe(75)
    expect(place.top).toBe(500 - TIP.gap - 100)
    expect(place.arrow).toBe(125)
  })

  it('stays inside the window at its top and bottom edges', () => {
    const tip = { width: 250, height: 200 }
    const top = placeTip(anchorAt(100, 0), tip, PAGE, TIP)
    expect(top.top).toBe(TIP.margin)
    const bottom = placeTip(anchorAt(100, 770), tip, PAGE, TIP)
    expect(bottom.top + bottom.height).toBe(PAGE.height - TIP.margin)
  })

  it('stays inside the window above an anchor at its left or right edge', () => {
    const page = { width: 300, height: 800 }
    const tip = { width: 250, height: 80 }
    const left = placeTip(anchorAt(0, 400), tip, page, TIP)
    expect(left.side).toBe('above')
    expect(left.left).toBe(TIP.margin)
    const right = placeTip(anchorAt(260, 400), tip, page, TIP)
    expect(right.left + right.width).toBe(page.width - TIP.margin)
  })

  it('stays inside a window too short for it above its anchor', () => {
    const page = { width: 300, height: 800 }
    const place = placeTip(
      anchorAt(130, 20),
      { width: 250, height: 120 },
      page,
      TIP,
    )
    expect(place.side).toBe('above')
    expect(place.top).toBe(TIP.margin)
  })

  it('in a narrow, short window, fits text wrapped taller than it', () => {
    const page = { width: 220, height: 150 }
    const bounds = tipBounds(page, TIP)
    // Wrapped at the narrowed width, the text grew taller than the window.
    const place = placeTip(
      anchorAt(90, 60),
      { width: bounds.width, height: 400 },
      page,
      TIP,
    )
    expect(place.width).toBe(204)
    expect(place.height).toBe(bounds.maxHeight)
    expect(place.left).toBeGreaterThanOrEqual(TIP.margin)
    expect(place.left + place.width).toBeLessThanOrEqual(
      page.width - TIP.margin,
    )
    expect(place.top).toBe(TIP.margin)
    expect(place.top + place.height).toBe(page.height - TIP.margin)
  })

  it('aims its arrow at the anchor, clear of the rounded corners', () => {
    const clear = TIP.corner + TIP.arrow
    const tip = { width: 250, height: 200 }
    // Slid down to the window's top margin, the anchor is above its middle.
    const high = placeTip(anchorAt(100, 0), tip, PAGE, TIP)
    expect(high.arrow).toBe(clear)
    const mid = placeTip(
      anchorAt(100, 10),
      { width: 250, height: 100 },
      PAGE,
      TIP,
    )
    expect(mid.top).toBe(TIP.margin)
    expect(mid.arrow).toBe(30 - TIP.margin)
    const low = placeTip(anchorAt(100, 790), tip, PAGE, TIP)
    expect(low.arrow).toBe(200 - clear)
    // An edge too short to clear both corners takes the arrow at its middle.
    const short = placeTip(
      anchorAt(100, 300),
      { width: 250, height: 30 },
      PAGE,
      TIP,
    )
    expect(short.arrow).toBe(15)
  })
})

describe('createTipControl', () => {
  let changes: boolean[]
  let control: TipControl
  const isOpen = () => changes.at(-1) ?? false

  beforeEach(() => {
    vi.useFakeTimers()
    changes = []
    control = createTipControl((open) => changes.push(open))
  })

  afterEach(() => {
    control.dispose()
    vi.useRealTimers()
  })

  it('opens 300 ms after a mouse comes onto the anchor', () => {
    control.pointerEnter('mouse')
    vi.advanceTimersByTime(299)
    expect(isOpen()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(changes).toEqual([true])
  })

  it('does not open when the mouse leaves before 300 ms', () => {
    control.pointerEnter('mouse')
    vi.advanceTimersByTime(200)
    control.pointerLeave('mouse')
    vi.advanceTimersByTime(1000)
    expect(changes).toEqual([])
  })

  it('does not open on a touch coming onto the anchor', () => {
    control.pointerEnter('touch')
    vi.advanceTimersByTime(1000)
    expect(changes).toEqual([])
  })

  it('closes after the grace once the mouse leaves', () => {
    control.pointerEnter('mouse')
    vi.advanceTimersByTime(300)
    control.pointerLeave('mouse')
    vi.advanceTimersByTime(TIP.leaveGraceMs - 1)
    expect(isOpen()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(changes).toEqual([true, false])
  })

  it('stays open while the mouse crosses onto the tooltip, closes when it leaves', () => {
    control.pointerEnter('mouse')
    vi.advanceTimersByTime(300)
    control.pointerLeave('mouse')
    vi.advanceTimersByTime(50)
    control.tipEnter()
    vi.advanceTimersByTime(1000)
    expect(isOpen()).toBe(true)
    control.tipLeave('mouse')
    vi.advanceTimersByTime(TIP.leaveGraceMs)
    expect(changes).toEqual([true, false])
  })

  it('stays open when the mouse comes back onto the anchor in the grace', () => {
    control.pointerEnter('mouse')
    vi.advanceTimersByTime(300)
    control.pointerLeave('mouse')
    control.pointerEnter('mouse')
    vi.advanceTimersByTime(1000)
    expect(changes).toEqual([true])
  })

  it('opens at once on keyboard focus, not on focus from a press', () => {
    control.focus(false)
    expect(changes).toEqual([])
    control.focus(true)
    expect(changes).toEqual([true])
  })

  it('closes on blur, and cancels an open still waiting', () => {
    control.focus(true)
    control.blur()
    expect(changes).toEqual([true, false])
    control.pointerEnter('mouse')
    control.blur()
    vi.advanceTimersByTime(1000)
    expect(changes).toEqual([true, false])
  })

  it('opens on a long press of 500 ms on touch', () => {
    control.pressStart('touch')
    expect(control.holding()).toBe(true)
    vi.advanceTimersByTime(499)
    expect(isOpen()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(changes).toEqual([true])
    // The finger lifts and leaves the anchor: it stays open.
    control.pressEnd()
    control.pointerLeave('touch')
    vi.advanceTimersByTime(1000)
    expect(changes).toEqual([true])
    expect(control.holding()).toBe(false)
  })

  it('does not open when the finger lifts or the press is cancelled before 500 ms', () => {
    control.pressStart('touch')
    vi.advanceTimersByTime(400)
    control.pressEnd()
    vi.advanceTimersByTime(1000)
    control.pressStart('touch')
    vi.advanceTimersByTime(100)
    control.pressEnd()
    vi.advanceTimersByTime(1000)
    expect(changes).toEqual([])
  })

  it('does not start a long press for a mouse', () => {
    control.pressStart('mouse')
    expect(control.holding()).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(changes).toEqual([])
  })

  it('stops the click after a long press, once, and lets an ordinary click through', () => {
    control.pressStart('touch')
    control.pressEnd()
    expect(control.clickAfterPress()).toBe(false)

    control.pressStart('touch')
    vi.advanceTimersByTime(500)
    control.pressEnd()
    expect(control.clickAfterPress()).toBe(true)
    expect(control.clickAfterPress()).toBe(false)

    // A long press with no click after it does not stop the next tap's.
    control.pressOutside()
    control.pressStart('touch')
    vi.advanceTimersByTime(500)
    control.pressStart('touch')
    control.pressEnd()
    expect(control.clickAfterPress()).toBe(false)
  })

  it('closes on Escape and says whether it was open', () => {
    expect(control.escape()).toBe(false)
    control.focus(true)
    expect(control.escape()).toBe(true)
    expect(changes).toEqual([true, false])
    expect(control.escape()).toBe(false)
  })

  it('cancels an open still waiting on Escape or a press outside', () => {
    control.pointerEnter('mouse')
    expect(control.escape()).toBe(false)
    control.pressStart('touch')
    control.pressOutside()
    vi.advanceTimersByTime(1000)
    expect(changes).toEqual([])
  })

  it('closes on a press outside', () => {
    control.pressStart('touch')
    vi.advanceTimersByTime(500)
    control.pressOutside()
    expect(changes).toEqual([true, false])
  })

  it('opens at once and stays open on leave until Escape, blur or a press outside', () => {
    control.open()
    expect(changes).toEqual([true])
    control.pointerLeave('mouse')
    control.tipLeave('mouse')
    vi.advanceTimersByTime(1000)
    expect(changes).toEqual([true])
    // Keyboard focus then Enter: it stays open.
    control.focus(true)
    control.open()
    expect(changes).toEqual([true])
    control.blur()
    expect(changes).toEqual([true, false])
    // Once closed, leaving closes it again as usual.
    control.pointerEnter('mouse')
    vi.advanceTimersByTime(300)
    control.pointerLeave('mouse')
    vi.advanceTimersByTime(TIP.leaveGraceMs)
    expect(changes).toEqual([true, false, true, false])
  })

  it('cancels a close still waiting when opened at once', () => {
    control.pointerEnter('mouse')
    vi.advanceTimersByTime(300)
    control.pointerLeave('mouse')
    control.open()
    vi.advanceTimersByTime(1000)
    expect(changes).toEqual([true])
  })

  it('never tells the same state twice', () => {
    control.focus(true)
    control.focus(true)
    control.pointerEnter('mouse')
    vi.advanceTimersByTime(1000)
    control.blur()
    control.pressOutside()
    expect(changes).toEqual([true, false])
  })

  it('tells nothing more once disposed', () => {
    control.pointerEnter('mouse')
    control.dispose()
    vi.advanceTimersByTime(1000)
    control.focus(true)
    control.pointerLeave('mouse')
    control.dispose()
    vi.advanceTimersByTime(1000)
    expect(changes).toEqual([true])
  })
})
