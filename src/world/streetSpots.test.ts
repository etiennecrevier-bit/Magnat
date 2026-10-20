import { describe, expect, it } from 'vitest'
import type { Spot } from '../content/assets.ts'
import { DOCK_ITEMS } from '../ui/dock.ts'
import { ASSETS } from './manifest.ts'
import {
  designPoint,
  legendShows,
  pagePoint,
  sameMark,
  spotAt,
  spotMark,
  spotsShown,
} from './streetSpots.ts'
import type { TruckView } from './truckView.ts'

const OPEN: Pick<TruckView, 'open' | 'modifiers'> = {
  open: true,
  modifiers: [],
}
const CLOSED: Pick<TruckView, 'open' | 'modifiers'> = {
  open: false,
  modifiers: [],
}

function spot(id: string): Spot {
  const found = ASSETS.spots.find((s) => s.id === id)
  if (found === undefined) throw new Error(`No spot ${id}`)
  return found
}

const ids = (spots: readonly Spot[]) => spots.map(({ id }) => id)

describe('the spots of the street', () => {
  it('are the chalkboard, the rack, the owner and the far city, from the manifest', () => {
    expect(
      ASSETS.spots.map(({ id, opens, label, detail }) => ({
        id,
        opens,
        text: `${label} · ${detail}`,
      })),
    ).toEqual([
      {
        id: 'menu',
        opens: { dock: 'camion', tab: 'menu' },
        text: 'Menu · prix du jour',
      },
      {
        id: 'stocks',
        opens: { dock: 'camion', tab: 'stocks' },
        text: 'Stocks · commandes du matin',
      },
      {
        id: 'owner',
        opens: { dock: 'camion', tab: 'schedule' },
        text: 'Vous · horaire, salaire',
      },
      {
        id: 'city',
        opens: { dock: 'ville' },
        text: 'La ville · banque, meunerie, fournil',
      },
    ])
  })

  it('open dock buttons the dock has', () => {
    const dock = DOCK_ITEMS.map(({ id }) => id)
    for (const { opens } of ASSETS.spots) expect(dock).toContain(opens.dock)
  })

  it('show every one on an open day', () => {
    expect(ids(spotsShown(ASSETS, OPEN, false))).toEqual([
      'menu',
      'stocks',
      'owner',
      'city',
    ])
  })

  it('lose the chalkboard and the owner on a closed day, as their art goes', () => {
    expect(ids(spotsShown(ASSETS, CLOSED, false))).toEqual(['stocks', 'city'])
  })

  it('lose the far city in a Défi, which hides « Ville »', () => {
    expect(ids(spotsShown(ASSETS, OPEN, true))).toEqual([
      'menu',
      'stocks',
      'owner',
    ])
  })

  it("follow their piece's own days", () => {
    const manifest = {
      pieces: ASSETS.pieces.map((piece) =>
        piece.id === 'croissant-rack'
          ? { ...piece, shows: 'closed' as const }
          : piece,
      ),
      spots: ASSETS.spots,
    }
    expect(ids(spotsShown(manifest, OPEN, false))).not.toContain('stocks')
    expect(ids(spotsShown(manifest, CLOSED, false))).toContain('stocks')
  })
})

describe('spotAt', () => {
  const spots = spotsShown(ASSETS, OPEN, false)

  it('finds each spot in its manifest box, edges included', () => {
    for (const s of ASSETS.spots) {
      const corners = [
        { x: s.x, y: s.y },
        { x: s.x + s.width, y: s.y + s.height },
        { x: s.x + s.width / 2, y: s.y + s.height / 2 },
      ]
      for (const point of corners) expect(spotAt(spots, point)).toBe(s)
    }
  })

  it('finds none beside a box, nor where a spot is not shown', () => {
    const menu = spot('menu')
    expect(spotAt(spots, { x: menu.x - 1, y: menu.y })).toBeNull()
    expect(spotAt(spots, { x: menu.x, y: menu.y + menu.height + 1 })).toBeNull()
    expect(spotAt(spots, { x: 5, y: 5 })).toBeNull()
    const closed = spotsShown(ASSETS, CLOSED, false)
    expect(spotAt(closed, { x: menu.x + 1, y: menu.y + 1 })).toBeNull()
  })

  it('finds the spot listed last where two overlap', () => {
    const under = { ...spot('menu'), id: 'under' }
    const over = { ...spot('menu'), id: 'over' }
    expect(spotAt([under, over], { x: under.x, y: under.y })).toBe(over)
  })
})

describe('the page and the design', () => {
  const fit = { scale: 0.5, x: 40, y: 10 }

  it('map points both ways through the scale and the offset', () => {
    expect(pagePoint({ x: 100, y: 200 }, fit)).toEqual({ x: 90, y: 110 })
    expect(designPoint({ x: 90, y: 110 }, fit)).toEqual({ x: 100, y: 200 })
  })

  it('outline a spot where it is drawn, its label over it or under it', () => {
    expect(spotMark(spot('menu'), fit)).toEqual({
      left: 40 + 1022 / 2,
      top: 10 + 580 / 2,
      width: 50,
      height: 59,
      label: 'Menu',
      detail: 'prix du jour',
      below: false,
    })
    expect(spotMark(spot('owner'), fit).below).toBe(true)
  })

  it('tell two marks apart by any of their parts', () => {
    const mark = spotMark(spot('menu'), fit)
    expect(sameMark(mark, { ...mark })).toBe(true)
    expect(sameMark(null, null)).toBe(true)
    expect(sameMark(mark, null)).toBe(false)
    expect(sameMark(mark, { ...mark, left: mark.left + 1 })).toBe(false)
    expect(sameMark(mark, { ...mark, below: true })).toBe(false)
  })
})

describe('legendShows', () => {
  const days = ASSETS.streetLegend.days

  it('shows for the first three days of the first game', () => {
    expect(days).toBe(3)
    for (const day of [0, 1, 2]) {
      expect(legendShows({ day, seed: 42 }, { seed: 42 }, days)).toBe(true)
    }
    expect(legendShows({ day: 3, seed: 42 }, { seed: 42 }, days)).toBe(false)
  })

  it('never shows in another game, nor once done or before a game takes it', () => {
    expect(legendShows({ day: 0, seed: 7 }, { seed: 42 }, days)).toBe(false)
    expect(legendShows({ day: 0, seed: 42 }, 'done', days)).toBe(false)
    expect(legendShows({ day: 0, seed: 42 }, 'unseen', days)).toBe(false)
  })
})
