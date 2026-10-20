import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  blurLeaves,
  createTipControl,
  editsText,
  placeTip,
  TIP,
  tipBounds,
  tipScrollTop,
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

  it('goes above a button in a row, clear of its neighbours, when asked to', () => {
    // The dock at 1440 × 900 (#226): « Camion », « Équipe » and « Ville »,
    // 84 px wide and 6 px apart. Beside « Camion », its 160 px tooltip lay
    // over the next two buttons and took the click meant for « Équipe ».
    const page = { width: 1440, height: 900 }
    const button = (left: number): Box => ({
      left,
      top: 750,
      right: left + 84,
      bottom: 828,
    })
    const [camion, equipe, ville] = [button(401), button(491), button(581)]
    const place = placeTip(
      camion,
      { width: 160, height: 63 },
      page,
      TIP,
      'above',
    )
    expect(place.side).toBe('above')
    expect(place.top + place.height).toBe(camion.top - TIP.gap)
    const tip: Box = {
      left: place.left,
      top: place.top,
      right: place.left + place.width,
      bottom: place.top + place.height,
    }
    const overlaps = (a: Box, b: Box) =>
      a.left < b.right &&
      b.left < a.right &&
      a.top < b.bottom &&
      b.top < a.bottom
    expect(overlaps(tip, equipe)).toBe(false)
    expect(overlaps(tip, ville)).toBe(false)
  })
})

describe('editsText', () => {
  it('keeps the keys in a text field or an editable part', () => {
    expect(editsText({ tagName: 'INPUT' })).toBe(true)
    expect(editsText({ tagName: 'textarea' })).toBe(true)
    expect(editsText({ tagName: 'SELECT' })).toBe(true)
    expect(editsText({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })

  it('leaves them to the tooltip on a button or the anchor itself', () => {
    expect(editsText({ tagName: 'BUTTON' })).toBe(false)
    expect(editsText({ tagName: 'DIV', isContentEditable: false })).toBe(false)
    expect(editsText({ tagName: 'SPAN' })).toBe(false)
  })
})

describe('blurLeaves', () => {
  // A card holding a field and a stepper.
  const inside = new Set(['card', 'field', 'stepper'])
  const card = { contains: (other: string) => inside.has(other) }

  it('keeps the tooltip while the focus moves inside the anchor', () => {
    expect(blurLeaves(card, 'stepper')).toBe(false)
    expect(blurLeaves(card, 'field')).toBe(false)
  })

  it('closes it once the focus leaves the anchor or the page', () => {
    expect(blurLeaves(card, 'tab')).toBe(true)
    expect(blurLeaves(card, null)).toBe(true)
  })
})

describe('tipScrollTop', () => {
  // 114 px of text showing out of 400, scrolled 100 px down.
  const VIEW = { scrollTop: 100, clientHeight: 114, scrollHeight: 400 }

  it('scrolls a line on the arrows, a page less a line on Page Up and Down', () => {
    expect(tipScrollTop('ArrowDown', VIEW)).toBe(140)
    expect(tipScrollTop('ArrowUp', VIEW)).toBe(60)
    expect(tipScrollTop('PageDown', VIEW)).toBe(174)
    expect(tipScrollTop('PageUp', VIEW)).toBe(26)
  })

  it('goes to the top on Home and the bottom on End', () => {
    expect(tipScrollTop('Home', VIEW)).toBe(0)
    expect(tipScrollTop('End', VIEW)).toBe(286)
  })

  it('scrolls at least a line a page in a very short tooltip', () => {
    const short = { scrollTop: 0, clientHeight: 30, scrollHeight: 400 }
    expect(tipScrollTop('PageDown', short)).toBe(TIP.scrollLine)
  })

  it('stops at either end, then leaves the key to the anchor', () => {
    expect(tipScrollTop('ArrowUp', { ...VIEW, scrollTop: 20 })).toBe(0)
    expect(tipScrollTop('ArrowDown', { ...VIEW, scrollTop: 270 })).toBe(286)
    expect(tipScrollTop('ArrowUp', { ...VIEW, scrollTop: 0 })).toBeNull()
    expect(tipScrollTop('Home', { ...VIEW, scrollTop: 0 })).toBeNull()
    expect(tipScrollTop('End', { ...VIEW, scrollTop: 286 })).toBeNull()
  })

  it('leaves every key to the anchor when the text fits, and other keys always', () => {
    const fits = { scrollTop: 0, clientHeight: 114, scrollHeight: 114 }
    expect(tipScrollTop('ArrowDown', fits)).toBeNull()
    expect(tipScrollTop('End', fits)).toBeNull()
    expect(tipScrollTop('Enter', VIEW)).toBeNull()
    expect(tipScrollTop(' ', VIEW)).toBeNull()
    expect(tipScrollTop('ArrowLeft', VIEW)).toBeNull()
  })
})

describe('createTipControl', () => {
  let changes: boolean[]
  let waits: boolean[]
  let control: TipControl
  const isOpen = () => changes.at(-1) ?? false

  beforeEach(() => {
    vi.useFakeTimers()
    changes = []
    waits = []
    control = createTipControl(
      (open) => changes.push(open),
      (waiting) => waits.push(waiting),
    )
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

  it('says when an opening starts waiting and when it stops, opened or cancelled', () => {
    control.pointerEnter('mouse')
    control.pointerEnter('mouse')
    expect(waits).toEqual([true])
    vi.advanceTimersByTime(300)
    expect(waits).toEqual([true, false])
    expect(changes).toEqual([true])
    control.escape()
    // Escape while it waits: it stops waiting and never opens.
    control.pointerEnter('mouse')
    expect(control.escape()).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(waits).toEqual([true, false, true, false])
    expect(changes).toEqual([true, false])
    // A long press waits the same way; lifting the finger stops it.
    control.pressStart('touch')
    control.pressEnd()
    expect(waits).toEqual([true, false, true, false, true, false])
    // Opening at once or on keyboard focus never waits.
    control.open()
    control.blur()
    control.focus(true)
    expect(waits).toHaveLength(6)
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
    expect(waits).toEqual([true])
  })
})
