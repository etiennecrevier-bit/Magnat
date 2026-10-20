import { describe, expect, it, vi } from 'vitest'
import { createCityPicker, worldPicks } from './cityPicker.ts'
import { saying, type CustomerCard } from './customerCard.ts'
import {
  createPicker,
  isCloseKey,
  listenForPicks,
  NO_MARKS,
  NOBODY_THERE,
  whereLands,
  type KeyLike,
  type OpenCard,
  type PickPage,
  type PickTarget,
  type PointerLike,
  type StreetMarks,
} from './picker.ts'

const CARD: CustomerCard = {
  segment: 'habitue',
  name: 'Habitué',
  mood: 'happy',
  line: "Comme d'habitude.",
}

function open(card = CARD, left = 100): OpenCard {
  return { card, place: { left, bottom: 120, width: 260, side: 'right' } }
}

/** A street that finds a customer wherever `found` says. */
function fakeStreet(found = true) {
  return {
    pickAt: vi.fn<PickTarget['pickAt']>(),
    isOver: () => found,
    pickNext: vi.fn<PickTarget['pickNext']>(() => found),
    unpick: vi.fn<PickTarget['unpick']>(),
    hover: vi.fn<PickTarget['hover']>(),
  } satisfies PickTarget
}

/** The menu's spot outlined, and the legend near the truck. */
const MARKS: StreetMarks = {
  spot: {
    left: 908,
    top: 516,
    width: 89,
    height: 105,
    label: 'Menu',
    detail: 'prix du jour',
    below: false,
  },
  legend: { text: 'Cliquez sur la rue', at: { x: 649, y: 354 } },
}

describe('createPicker', () => {
  it('does nothing before a street connects, and is not live', () => {
    const picker = createPicker()
    picker.at({ x: 1, y: 2 })
    picker.close()
    expect(picker.over({ x: 1, y: 2 })).toBe(false)
    expect(picker.view()).toEqual({
      live: false,
      open: null,
      said: '',
      marks: NO_MARKS,
    })
  })

  it('is live while a street holds it', () => {
    const picker = createPicker()
    const listener = vi.fn()
    picker.subscribe(listener)
    const connection = picker.connect(fakeStreet())
    expect(picker.view().live).toBe(true)
    expect(listener).toHaveBeenCalledOnce()

    connection.disconnect()
    expect(picker.view().live).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('hands presses and keys to the street that holds it', () => {
    const picker = createPicker()
    const street = fakeStreet()
    picker.connect(street)

    picker.at({ x: 10, y: 20 })
    picker.next()
    picker.close()

    expect(street.pickAt).toHaveBeenCalledExactlyOnceWith({ x: 10, y: 20 })
    expect(street.pickNext).toHaveBeenCalledOnce()
    expect(street.unpick).toHaveBeenCalledOnce()
    expect(picker.over({ x: 0, y: 0 })).toBe(true)
  })

  it('shows the card the street opens, reads it out once, and follows it', () => {
    const picker = createPicker()
    const connection = picker.connect(fakeStreet())
    const listener = vi.fn()
    picker.subscribe(listener)

    connection.show(open())
    expect(picker.view()).toEqual({
      live: true,
      open: open(),
      said: saying(CARD),
      marks: NO_MARKS,
    })
    expect(listener).toHaveBeenCalledTimes(1)

    // The same place again changes nothing; a new place moves the card.
    connection.show(open(CARD, 100))
    expect(listener).toHaveBeenCalledTimes(1)
    connection.show(open(CARD, 140))
    expect(picker.view().open?.place.left).toBe(140)
    expect(picker.view().said).toBe(saying(CARD))
    expect(listener).toHaveBeenCalledTimes(2)

    connection.show(null)
    expect(picker.view()).toEqual({
      live: true,
      open: null,
      said: '',
      marks: NO_MARKS,
    })
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('says no one is there when the street finds no one, or is gone', () => {
    const picker = createPicker()
    picker.next()
    expect(picker.view()).toEqual({
      live: false,
      open: null,
      said: NOBODY_THERE,
      marks: NO_MARKS,
    })

    picker.close()
    picker.connect(fakeStreet(false))
    picker.next()
    expect(picker.view()).toEqual({
      live: true,
      open: null,
      said: NOBODY_THERE,
      marks: NO_MARKS,
    })
  })

  it('stops forwarding once the street disconnects, and closes its card', () => {
    const picker = createPicker()
    const street = fakeStreet()
    const connection = picker.connect(street)
    connection.show(open())

    connection.disconnect()
    connection.disconnect()
    picker.at({ x: 1, y: 1 })
    connection.show(open())

    expect(street.pickAt).not.toHaveBeenCalled()
    expect(picker.view()).toEqual({
      live: false,
      open: null,
      said: '',
      marks: NO_MARKS,
    })
  })

  it('keeps the newer street when an older one stops late', () => {
    // React StrictMode in development starts the world twice: the first
    // street can stop after the second has connected.
    const picker = createPicker()
    const a = fakeStreet()
    const b = fakeStreet()
    const fromA = picker.connect(a)
    const fromB = picker.connect(b)
    fromB.show(open())

    fromA.show(null)
    fromA.disconnect()

    picker.at({ x: 5, y: 5 })
    expect(b.pickAt).toHaveBeenCalledOnce()
    expect(a.pickAt).not.toHaveBeenCalled()
    expect(picker.view().open).toEqual(open())

    fromB.show(open(CARD, 160))
    expect(picker.view().open?.place.left).toBe(160)
  })

  it('hands where the pointer is to the street that holds it', () => {
    const picker = createPicker()
    const older = fakeStreet()
    const newer = fakeStreet()
    picker.connect(older)
    picker.connect(newer)

    picker.hover({ x: 3, y: 4 })
    picker.hover(null)

    expect(newer.hover.mock.calls).toEqual([[{ x: 3, y: 4 }], [null]])
    expect(older.hover).not.toHaveBeenCalled()
  })

  it("shows the street's marks once, and clears them when the street goes", () => {
    const picker = createPicker()
    const connection = picker.connect(fakeStreet())
    const listener = vi.fn()
    picker.subscribe(listener)

    connection.mark(MARKS)
    expect(picker.view().marks).toEqual(MARKS)
    expect(listener).toHaveBeenCalledOnce()

    // Equal marks, made anew each frame, change nothing.
    connection.mark(structuredClone(MARKS))
    expect(listener).toHaveBeenCalledOnce()
    // Closing the card keeps them.
    picker.close()
    expect(picker.view().marks).toEqual(MARKS)

    connection.mark({ ...MARKS, spot: null })
    expect(picker.view().marks).toEqual({ ...MARKS, spot: null })
    expect(listener).toHaveBeenCalledTimes(2)

    connection.mark({ spot: null, legend: null })
    expect(picker.view().marks).toBe(NO_MARKS)
    connection.mark(MARKS)
    connection.disconnect()
    expect(picker.view().marks).toBe(NO_MARKS)
  })

  it('ignores the marks of a street that no longer holds it', () => {
    const picker = createPicker()
    const fromOlder = picker.connect(fakeStreet())
    fromOlder.mark(MARKS)
    const fromNewer = picker.connect(fakeStreet())
    expect(picker.view().marks).toBe(NO_MARKS)

    fromOlder.mark(MARKS)
    expect(picker.view().marks).toBe(NO_MARKS)
    fromNewer.disconnect()
    fromOlder.mark(MARKS)
    expect(picker.view().marks).toEqual(MARKS)
  })

  it('goes back to the older street when one that started late stops', () => {
    const picker = createPicker()
    const b = fakeStreet()
    const late = fakeStreet()
    const fromB = picker.connect(b)
    const fromLate = picker.connect(late)

    fromLate.disconnect()
    picker.at({ x: 5, y: 5 })
    fromB.show(open())

    expect(b.pickAt).toHaveBeenCalledOnce()
    expect(late.pickAt).not.toHaveBeenCalled()
    expect(picker.view().open).toEqual(open())
  })
})

/**
 * A fake page node: `contains` holds for itself and its descendants, and
 * `closest` matches the selectors listed in `matches` up its ancestors.
 */
interface FakeNode {
  nodeType: number
  tagName: string
  isContentEditable: boolean
  parent: FakeNode | null
  matches: string[]
  contains: (other: unknown) => boolean
  closest: (selectors: string) => FakeNode | null
}

function node(
  tagName: string,
  parent: FakeNode | null = null,
  matches: string[] = [],
): FakeNode {
  const self: FakeNode = {
    nodeType: 1,
    tagName,
    isContentEditable: false,
    parent,
    matches,
    contains: (other) => {
      for (let n = other as FakeNode | null; n; n = n.parent) {
        if (n === self) return true
      }
      return false
    },
    closest: (selectors) => {
      const wanted = selectors.split(',').map((s) => s.trim())
      for (let n: FakeNode | null = self; n; n = n.parent) {
        if (n.matches.some((m) => wanted.includes(m))) return n
      }
      return null
    },
  }
  return self
}

/** The app's page: the world layer, its canvas, a panel, a dialog, the controls. */
function fakeDom() {
  const html = node('HTML')
  const body = node('BODY', html)
  const root = node('DIV', body)
  const world = node('DIV', root)
  const canvas = node('CANVAS', world)
  const main = node('MAIN', root)
  const panelButton = node('BUTTON', main)
  const field = node('INPUT', main)
  const dialog = node('DIALOG', root, ['dialog'])
  const dialogButton = node('BUTTON', dialog)
  const picker = node('DIV', root, ['[data-world-control]'])
  const pickerButton = node('BUTTON', picker)
  const card = node('DIV', root, ['[data-world-control]'])
  return {
    ...{ html, body, root, world, canvas, main, panelButton, field },
    ...{ dialog, dialogButton, picker, pickerButton, card },
  }
}

describe('whereLands', () => {
  const dom = fakeDom()

  it('lands on the street on the canvas, or on what holds the world layer', () => {
    for (const target of [
      dom.canvas,
      dom.world,
      dom.root,
      dom.body,
      dom.html,
    ]) {
      expect(whereLands(target, dom.world)).toBe('street')
    }
  })

  it('lands on the page on a panel, its buttons or a dialog', () => {
    for (const target of [dom.main, dom.panelButton, dom.dialogButton]) {
      expect(whereLands(target, dom.world)).toBe('page')
    }
  })

  it("lands on a control on the world's button or on the card", () => {
    for (const target of [dom.pickerButton, dom.card]) {
      expect(whereLands(target, dom.world)).toBe('control')
    }
  })

  it('lands on the page on something that is not a page node', () => {
    expect(whereLands(null, dom.world)).toBe('page')
    expect(whereLands({}, dom.world)).toBe('page')
  })
})

function keyEvent(overrides: Partial<KeyLike> = {}): KeyLike {
  return {
    key: 'Escape',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: null,
    ...overrides,
  }
}

describe('isCloseKey', () => {
  const dom = fakeDom()

  it('closes on Escape, wherever the focus is on the page', () => {
    for (const target of [null, dom.body, dom.panelButton, dom.pickerButton]) {
      expect(isCloseKey(keyEvent({ target }))).toBe(true)
    }
  })

  it('leaves other keys, and Escape with a modifier', () => {
    expect(isCloseKey(keyEvent({ key: 'Enter' }))).toBe(false)
    expect(isCloseKey(keyEvent({ key: ' ' }))).toBe(false)
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
      expect(isCloseKey(keyEvent({ [modifier]: true }))).toBe(false)
    }
  })

  it('leaves Escape to a text field and to an open dialog', () => {
    expect(isCloseKey(keyEvent({ target: dom.field }))).toBe(false)
    expect(isCloseKey(keyEvent({ target: dom.dialogButton }))).toBe(false)
    expect(isCloseKey(keyEvent({ target: dom.dialog }))).toBe(false)
    const editable = { ...node('DIV', dom.main), isContentEditable: true }
    expect(isCloseKey(keyEvent({ target: editable }))).toBe(false)
  })
})

/** A page whose listeners the test fires. */
function fakePage() {
  const listeners = new Map<string, Set<(event: never) => void>>()
  const page = {
    addEventListener: (type: string, listener: (event: never) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(listener)
    },
    removeEventListener: (type: string, listener: (event: never) => void) => {
      listeners.get(type)?.delete(listener)
    },
  }
  return {
    page: page as PickPage,
    fire(type: string, event: PointerLike | KeyLike) {
      for (const listener of listeners.get(type) ?? []) {
        ;(listener as (event: PointerLike | KeyLike) => void)(event)
      }
    },
    count: () =>
      [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  }
}

function press(target: unknown, overrides: Partial<PointerLike> = {}) {
  return {
    button: 0,
    isPrimary: true,
    clientX: 30,
    clientY: 40,
    target,
    ...overrides,
  }
}

describe('listenForPicks', () => {
  function setUp(found = true) {
    const dom = fakeDom()
    const { page, fire, count } = fakePage()
    const picker = createPicker()
    const street = fakeStreet(found)
    picker.connect(street)
    const onPointing = vi.fn()
    const stop = listenForPicks(page, dom.world, picker, onPointing)
    return { dom, fire, count, street, onPointing, stop }
  }

  it('hands a press on the world to the city too, and points over its buildings', () => {
    const dom = fakeDom()
    const { page, fire } = fakePage()
    const city = createCityPicker()
    const buildings = { openAt: vi.fn(), isOver: vi.fn(() => true) }
    city.connect(buildings)
    const onPointing = vi.fn()
    listenForPicks(
      page,
      dom.world,
      worldPicks(createPicker(), city),
      onPointing,
    )
    fire('pointerdown', press(dom.canvas, { clientX: 70, clientY: 80 }))
    fire('pointerdown', press(dom.panelButton))
    expect(buildings.openAt.mock.calls).toEqual([[{ x: 70, y: 80 }]])
    fire('pointermove', press(dom.canvas))
    expect(onPointing).toHaveBeenLastCalledWith(true)
  })

  it('picks where the player presses the street', () => {
    const { dom, fire, street } = setUp()
    fire('pointerdown', press(dom.body))
    fire('pointerdown', press(dom.canvas, { clientX: 70, clientY: 80 }))
    expect(street.pickAt.mock.calls).toEqual([
      [{ x: 30, y: 40 }],
      [{ x: 70, y: 80 }],
    ])
    expect(street.unpick).not.toHaveBeenCalled()
  })

  it('closes the card on a press anywhere else on the page', () => {
    const { dom, fire, street } = setUp()
    fire('pointerdown', press(dom.panelButton))
    fire('pointerdown', press(dom.dialog))
    expect(street.unpick).toHaveBeenCalledTimes(2)
    expect(street.pickAt).not.toHaveBeenCalled()
  })

  it("does neither on the world's own controls, nor for another button", () => {
    const { dom, fire, street } = setUp()
    fire('pointerdown', press(dom.card))
    fire('pointerdown', press(dom.pickerButton))
    fire('pointerdown', press(dom.body, { button: 2 }))
    fire('pointerdown', press(dom.body, { isPrimary: false }))
    expect(street.pickAt).not.toHaveBeenCalled()
    expect(street.unpick).not.toHaveBeenCalled()
  })

  it('closes the card on Escape, unless a field or a dialog has it', () => {
    const { dom, fire, street } = setUp()
    fire('keydown', keyEvent({ target: dom.body }))
    fire('keydown', keyEvent({ target: dom.field }))
    fire('keydown', keyEvent({ target: dom.dialogButton }))
    fire('keydown', keyEvent({ key: 'a', target: dom.body }))
    expect(street.unpick).toHaveBeenCalledOnce()
  })

  it('points over a customer on the street, and nowhere else', () => {
    const over = setUp(true)
    over.fire('pointermove', press(over.dom.body))
    over.fire('pointermove', press(over.dom.main))
    expect(over.onPointing.mock.calls).toEqual([[true], [false]])

    const empty = setUp(false)
    empty.fire('pointermove', press(empty.dom.canvas))
    expect(empty.onPointing.mock.calls).toEqual([[false]])
  })

  it('tells the street where the pointer is on it, and null elsewhere', () => {
    const { dom, fire, street } = setUp()
    fire('pointermove', press(dom.canvas, { clientX: 70, clientY: 80 }))
    fire('pointermove', press(dom.body))
    fire('pointermove', press(dom.main))
    fire('pointermove', press(dom.card))
    expect(street.hover.mock.calls).toEqual([
      [{ x: 70, y: 80 }],
      [{ x: 30, y: 40 }],
      [null],
      [null],
    ])
  })

  it('tells the street the pointer left once it leaves the window', () => {
    const { dom, fire, street, onPointing } = setUp()
    fire('pointermove', press(dom.canvas))
    // Out of one element into another: still on the page.
    fire('pointerout', press(dom.canvas, { relatedTarget: dom.main }))
    expect(street.hover).toHaveBeenCalledOnce()

    fire('pointerout', press(dom.canvas, { relatedTarget: null }))
    expect(street.hover).toHaveBeenLastCalledWith(null)
    expect(onPointing).toHaveBeenLastCalledWith(false)
  })

  it('stops listening, and stops pointing', () => {
    const { dom, fire, count, street, onPointing, stop } = setUp()
    expect(count()).toBe(4)
    stop()
    expect(count()).toBe(0)
    expect(onPointing).toHaveBeenLastCalledWith(false)
    expect(street.hover).toHaveBeenLastCalledWith(null)
    street.hover.mockClear()
    fire('pointermove', press(dom.canvas))
    expect(street.hover).not.toHaveBeenCalled()
    fire('pointerdown', press(dom.body))
    expect(street.pickAt).not.toHaveBeenCalled()
  })
})
