import { describe, expect, it } from 'vitest'
import {
  keepRoomAbove,
  keepRoomFor,
  keepRoomOver,
  keepRoomUnder,
  type ObserverLike,
} from './tickerRoom.ts'

/**
 * A bar of `height` whose top is `top` px down the window, which can be
 * resized, and a page that records; `keep` is what is under test.
 */
function setUp(height: number, keep = keepRoomFor, top = 0) {
  const bar = {
    height,
    getBoundingClientRect() {
      return { height: this.height, bottom: top + this.height }
    },
  }
  const style = new Map<string, string>()
  const page = {
    style: {
      setProperty: (name: string, value: string | null) => {
        style.set(name, value ?? '')
      },
      removeProperty: (name: string) => {
        const value = style.get(name) ?? ''
        style.delete(name)
        return value
      },
    },
  }
  const observed: unknown[] = []
  let onResize = () => {}
  let disconnected = false
  const observe = (callback: () => void): ObserverLike => {
    onResize = callback
    return {
      observe: (target) => observed.push(target),
      disconnect: () => {
        disconnected = true
      },
    }
  }
  const stop = keep(bar as unknown as Element, page, observe)
  return {
    bar,
    style,
    observed,
    resize: () => onResize(),
    stop,
    disconnected: () => disconnected,
  }
}

describe('keepRoomFor', () => {
  it('gives the page the height of the bar at once', () => {
    const { bar, style, observed } = setUp(44)
    expect(style.get('--ticker-height')).toBe('44px')
    expect(observed).toEqual([bar])
  })

  it('follows the bar as a long headline wraps onto more lines', () => {
    const { bar, style, resize } = setUp(44)
    bar.height = 133.5
    resize()
    expect(style.get('--ticker-height')).toBe('133.5px')
  })

  it('stops watching and takes the room back when the bar goes', () => {
    const { style, stop, disconnected } = setUp(44)
    stop()
    expect(disconnected()).toBe(true)
    expect(style.has('--ticker-height')).toBe(false)
  })
})

describe('keepRoomUnder', () => {
  it('gives the page where the top bar ends at once', () => {
    const { bar, style, observed } = setUp(64, keepRoomUnder, 14)
    expect(style.get('--top-bar-room')).toBe('78px')
    expect(observed).toEqual([bar])
  })

  it('follows the bar as its cards wrap onto more rows on a phone', () => {
    const { bar, style, resize } = setUp(64, keepRoomUnder, 8)
    bar.height = 255
    resize()
    expect(style.get('--top-bar-room')).toBe('263px')
  })

  it('stops watching and takes the room back when the bar goes', () => {
    const { style, stop, disconnected } = setUp(64, keepRoomUnder, 14)
    stop()
    expect(disconnected()).toBe(true)
    expect(style.has('--top-bar-room')).toBe(false)
  })
})

describe('keepRoomOver', () => {
  it("gives the page the height of the week's card at once", () => {
    const { bar, style, observed } = setUp(212, keepRoomOver, 400)
    expect(style.get('--report-card-height')).toBe('212px')
    expect(observed).toEqual([bar])
  })

  it('follows the card as a long fact wraps onto more lines', () => {
    const { bar, style, resize } = setUp(212, keepRoomOver, 400)
    bar.height = 260
    resize()
    expect(style.get('--report-card-height')).toBe('260px')
  })

  it('stops watching and takes the room back when the card goes', () => {
    const { style, stop, disconnected } = setUp(212, keepRoomOver, 400)
    stop()
    expect(disconnected()).toBe(true)
    expect(style.has('--report-card-height')).toBe(false)
  })
})

describe('keepRoomAbove', () => {
  it('gives the page the height of « Hier » at once', () => {
    const { bar, style, observed } = setUp(111, keepRoomAbove, 700)
    expect(style.get('--yesterday-height')).toBe('111px')
    expect(observed).toEqual([bar])
  })

  it("follows « Hier » as another truck's line comes and as it folds", () => {
    const { bar, style, resize } = setUp(111, keepRoomAbove, 700)
    bar.height = 141.5
    resize()
    expect(style.get('--yesterday-height')).toBe('141.5px')
    bar.height = 44
    resize()
    expect(style.get('--yesterday-height')).toBe('44px')
  })

  it('stops watching and takes the room back when « Hier » goes', () => {
    const { style, stop, disconnected } = setUp(111, keepRoomAbove, 700)
    stop()
    expect(disconnected()).toBe(true)
    expect(style.has('--yesterday-height')).toBe(false)
  })
})
