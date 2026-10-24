import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cents } from '../engine/money.ts'
import { formatBriefMoney } from './formatMoney.ts'
import type { GameState } from '../engine/types.ts'
import { SHOWN_TRUCK } from '../world/shownTruck.ts'
import { handleFoldKey } from './foldShortcut.ts'
import type { KeyEventLike } from './pauseShortcut.ts'
import { createSettingsStore } from './settings.ts'
import { gameStore, PAUSED, type GameStoreState } from './store.ts'
import Yesterday, { YesterdayView } from './Yesterday.tsx'
import { createInitialState, tick } from '../engine/clock.ts'
import { FIRST_TRUCK } from '../engine/trucks.ts'
import { hiring, SECOND, withSecondTruck } from './fixtures/twoTrucks.ts'
import { todayNumbers as numbersOf, type TodayNumbers } from './todayNumbers.ts'
import { yesterdayCard } from './truckViews.ts'

// A static render reads a Zustand store's initial state, so « Hier » reads
// the app store's current state through this stand-in.
vi.mock('./store.ts', async (importOriginal) => {
  const store = await importOriginal<typeof import('./store.ts')>()
  return {
    ...store,
    useGame: <T,>(selector: (state: GameStoreState) => T): T =>
      selector(store.gameStore.getState()),
  }
})

// Called as a function, « Hier » runs no hook, so it reads the truck shown
// through this stand-in, as the hook would on a render.
vi.mock('./trucks.ts', async (importOriginal) => {
  const trucks = await importOriginal<typeof import('./trucks.ts')>()
  const { SHOWN_TRUCK, shownTruckOf } = await import('../world/shownTruck.ts')
  return {
    ...trucks,
    useShownTruck: (game: GameState) =>
      shownTruckOf(game, SHOWN_TRUCK.getState()),
  }
})

afterEach(() => {
  gameStore.setState(gameStore.getInitialState(), true)
  SHOWN_TRUCK.pick(null)
})

// Every space in an amount is a no-break space (U+00A0).
const S = ' '

const NUMBERS: TodayNumbers = {
  revenue: cents(879_700),
  customersServed: 1_250,
  lostSales: 0,
}

function render(numbers: TodayNumbers | null, folded = false) {
  return renderToStaticMarkup(
    <YesterdayView
      numbers={numbers}
      folded={folded}
      onFoldChange={() => {}}
      onOpen={() => {}}
    />,
  )
}

/** Every element in `node` and its children, in order, `node` included. */
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return (node as ReactNode[]).flatMap(elements)
  if (!isValidElement(node)) return []
  const { children } = node.props as { children?: unknown }
  if (typeof children === 'function') {
    const drawn = (children as (a: object, t: object) => ReactNode)(
      {},
      { open: () => {} },
    )
    return [node, ...elements(drawn)]
  }
  return [node, ...elements(children as ReactNode)]
}

function keyEvent(overrides: Partial<KeyEventLike> = {}) {
  return {
    key: 'r',
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: null,
    preventDefault: vi.fn(),
    ...overrides,
  }
}

describe('YesterdayView', () => {
  it('shows the last day’s sales, customers served and lost sales on one button', () => {
    expect(render(NUMBERS)).toMatch(
      new RegExp(
        '^<section class="yesterday" aria-label="Hier"><button type="button" class="yesterday__open" data-tuto="yesterday">' +
          '<span class="yesterday__title">Hier</span>' +
          `<span class="yesterday__row"><span>Ventes</span><strong>8${S}797${S}\\$</strong></span>` +
          `<span class="yesterday__row"><span>Clients servis</span><strong>1${S}250</strong></span>` +
          '<span class="yesterday__row"><span>Ventes perdues</span><strong>0</strong></span>' +
          '</button>',
      ),
    )
  })

  it('shows the lost sales in amber, with ⚠︎, when above zero', () => {
    expect(render({ ...NUMBERS, lostSales: 12 })).toContain(
      '<span class="yesterday__row yesterday__row--warn"><span>Ventes perdues</span><strong><span aria-hidden="true">⚠︎ </span>12</strong></span>',
    )
  })

  it('shows dashes before the first day', () => {
    const html = render(null)
    expect(html).toContain('<span>Ventes</span><strong>—</strong>')
    expect(html).toContain('<span>Clients servis</span><strong>—</strong>')
    expect(html).toContain('<span>Ventes perdues</span><strong>—</strong>')
  })

  it('has a corner button that hides it, its tooltip naming R', () => {
    const html = render(NUMBERS)
    expect(html).toMatch(
      /<button type="button" class="yesterday__fold" aria-label="Masquer « Hier »" aria-expanded="true" aria-keyshortcuts="R" aria-describedby="[^"]+">/,
    )
    expect(html).toContain(
      '<p class="tip__title">Masquer « Hier »</p><p class="tip__text">Touche R</p>',
    )
  })

  it('hidden, leaves a pill that shows it again, its tooltip naming R', () => {
    const html = render(NUMBERS, true)
    expect(html).toMatch(
      /^<button type="button" class="yesterday-pill" data-tuto="yesterday.pill" aria-expanded="false" aria-keyshortcuts="R" aria-describedby="[^"]+">Hier<\/button>/,
    )
    expect(html).toContain(
      '<p class="tip__title">Afficher « Hier »</p><p class="tip__text">Touche R</p>',
    )
    expect(html).not.toContain('Ventes')
  })

  it('opens « Camion » on a click, and hides or shows on its buttons', () => {
    const onOpen = vi.fn()
    const onFoldChange = vi.fn()
    const click = (folded: boolean, className: string) => {
      const found = elements(
        YesterdayView({ numbers: NUMBERS, folded, onFoldChange, onOpen }),
      ).find(
        (element) =>
          (element.props as { className?: string }).className === className,
      )
      ;(found?.props as { onClick: () => void }).onClick()
    }
    click(false, 'yesterday__open')
    click(false, 'yesterday__fold')
    click(true, 'yesterday-pill')
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onFoldChange.mock.calls).toEqual([[true], [false]])
  })
})

describe('the note under the numbers (#283)', () => {
  it('shows a fact about the day under its numbers, and nothing without one', () => {
    const html = renderToStaticMarkup(
      <YesterdayView
        numbers={NUMBERS}
        note="Sans Kevin, le camion aurait été fermé"
        folded={false}
        onFoldChange={() => {}}
        onOpen={() => {}}
      />,
    )
    expect(html).toContain(
      '<span class="yesterday__note">Sans Kevin, le camion aurait été fermé</span></button>',
    )
    expect(render(NUMBERS)).not.toContain('yesterday__note')
  })
})

describe('Yesterday', () => {
  it('shows the app store’s last day, dashes before the first', () => {
    const props = { folded: false, onFoldChange: () => {} }
    expect(renderToStaticMarkup(<Yesterday {...props} />)).toContain(
      '<span>Ventes</span><strong>—</strong>',
    )
    gameStore.getState().advance(1)
    expect(renderToStaticMarkup(<Yesterday {...props} />)).not.toContain(
      '<strong>—</strong>',
    )
  })

  it('opens « Camion », paused, on a click', () => {
    const view = Yesterday({ folded: false, onFoldChange: () => {} })
    const open = (view.props as { onOpen: () => void }).onOpen
    open()
    expect(gameStore.getState()).toMatchObject({
      panel: 'manage',
      speed: PAUSED,
    })
  })

  it('opens « Camion » on « Menu », whatever tab it showed last (#227)', () => {
    gameStore.getState().openPanel('manage', 'bakery')
    gameStore.getState().closePanel()
    expect(gameStore.getState().truckTab).toBe('bakery')
    const view = Yesterday({ folded: false, onFoldChange: () => {} })
    const open = (view.props as { onOpen: () => void }).onOpen
    open()
    expect(gameStore.getState()).toMatchObject({
      panel: 'manage',
      truckTab: 'menu',
    })
  })
})

describe('the R key', () => {
  it('hides « Hier » and shows it again, the settings keeping the choice', () => {
    const settings = createSettingsStore(null)
    const toggle = () =>
      settings.getState().setScreensFolded(!settings.getState().screensFolded)
    handleFoldKey(keyEvent(), toggle)
    expect(settings.getState().screensFolded).toBe(true)
    handleFoldKey(keyEvent({ key: 'R' }), toggle)
    expect(settings.getState().screensFolded).toBe(false)
  })
})

describe('« Hier » with two trucks (#265)', () => {
  const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7]

  /** Day 2's morning: Kevin at the Plateau, the owner at Vieux-Montréal. */
  function bothOpen(): GameState {
    return tick(
      tick(
        withSecondTruck(
          createInitialState(42),
          { kind: 'daysOpen', weekdays: EVERY_DAY },
          { kind: 'daysOpen', weekdays: EVERY_DAY, truck: SECOND },
          hiring('kevin'),
          { kind: 'ownerAt', truck: SECOND },
        ),
      ),
    )
  }

  it('shows the truck shown, then each other truck’s sales', () => {
    const game = bothOpen()
    const second = game.trucks?.[0]?.lastDay
    if (second === null || second === undefined) throw new Error('Played')
    const card = yesterdayCard(game, SECOND)
    expect(card).toMatchObject({
      title: 'Hier · Vieux-Montréal',
      numbers: numbersOf(second),
      closed: null,
      note: null,
    })
    expect(card.others).toEqual([
      {
        id: FIRST_TRUCK,
        name: 'Plateau',
        value: formatBriefMoney(game.lastDay?.revenue ?? cents(0)),
      },
    ])
    expect(yesterdayCard(game, FIRST_TRUCK)).toMatchObject({
      title: 'Hier · Plateau',
      numbers: numbersOf(game.lastDay!),
      others: [
        {
          id: SECOND,
          name: 'Vieux-Montréal',
          value: formatBriefMoney(second.revenue),
        },
      ],
    })
    const html = renderToStaticMarkup(
      <YesterdayView
        {...card}
        folded={false}
        onFoldChange={() => {}}
        onOpen={() => {}}
      />,
    )
    expect(html).toContain(
      '<span class="yesterday__title">Hier · Vieux-Montréal</span>',
    )
    expect(html).toContain(
      `<span class="yesterday__row yesterday__row--other yesterday__row--divider"><span>Plateau</span><strong>${formatBriefMoney(game.lastDay?.revenue ?? cents(0))}</strong></span>`,
    )
  })

  it('says « Fermé pour l’hiver » for a truck stored, « fermé » for the other line', () => {
    const stored = tick(
      tick(
        withSecondTruck(createInitialState(42), {
          kind: 'storage',
          storage: { from: { month: 5, day: 1 }, to: { month: 5, day: 31 } },
          truck: SECOND,
        }),
      ),
    )
    const card = yesterdayCard(stored, SECOND)
    expect(card.closed).toBe("Fermé pour l'hiver")
    const html = renderToStaticMarkup(
      <YesterdayView
        {...card}
        folded={false}
        onFoldChange={() => {}}
        onOpen={() => {}}
      />,
    )
    expect(html).toContain(
      '<span class="yesterday__closed">Fermé pour l&#x27;hiver</span>',
    )
    expect(html).not.toContain('Clients servis')
    expect(yesterdayCard(stored, FIRST_TRUCK).others).toEqual([
      { id: SECOND, name: 'Vieux-Montréal', value: 'fermé' },
    ])
  })

  it('shows dashes for a truck just bought, and stays as it was with one truck', () => {
    const played = tick(tick(createInitialState(42)))
    const bought = withSecondTruck(played)
    expect(yesterdayCard(bought, SECOND)).toMatchObject({
      numbers: null,
      closed: null,
    })
    expect(yesterdayCard(bought, FIRST_TRUCK).others).toEqual([
      { id: SECOND, name: 'Vieux-Montréal', value: '—' },
    ])
    expect(yesterdayCard(played, FIRST_TRUCK)).toEqual({
      numbers: numbersOf(played.lastDay!),
      note: null,
      title: 'Hier',
      closed: null,
      others: [],
    })
  })

  it('follows the truck picked', () => {
    gameStore.setState({ game: bothOpen() })
    const html = () =>
      renderToStaticMarkup(<Yesterday folded={false} onFoldChange={() => {}} />)
    expect(html()).toContain('Hier · Vieux-Montréal')
    SHOWN_TRUCK.pick(FIRST_TRUCK)
    expect(html()).toContain('Hier · Plateau')
  })
})
