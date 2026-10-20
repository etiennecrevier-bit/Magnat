import { describe, expect, it, vi } from 'vitest'
import { openLater } from './openLater.ts'

/** A schedule the test runs by hand, as the end of the press. */
function byHand() {
  const waiting: (() => void)[] = []
  return {
    schedule: (run: () => void) => {
      waiting.push(run)
    },
    runAll: () => waiting.splice(0).forEach((run) => run()),
  }
}

describe('openLater', () => {
  it('opens the link once the press is over, not during it', () => {
    const open = vi.fn()
    const { schedule, runAll } = byHand()
    const later = openLater({ current: open }, schedule)

    later?.({ dock: 'camion', tab: 'menu' })
    expect(open).not.toHaveBeenCalled()
    runAll()
    expect(open).toHaveBeenCalledExactlyOnceWith({
      dock: 'camion',
      tab: 'menu',
    })
  })

  it('opens nothing while nothing opens links', () => {
    expect(openLater({ current: null })).toBeNull()
  })

  it('opens nothing if play stops before the press is over', () => {
    const open = vi.fn()
    const opener: { current: typeof open | null } = { current: open }
    const { schedule, runAll } = byHand()
    openLater(opener, schedule)?.('trip')

    opener.current = null
    runAll()
    expect(open).not.toHaveBeenCalled()
  })

  it('opens with the opener there by then', () => {
    const first = vi.fn()
    const second = vi.fn()
    const opener = { current: first }
    const { schedule, runAll } = byHand()
    openLater(opener, schedule)?.('trip')

    opener.current = second
    runAll()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledExactlyOnceWith('trip')
  })
})
