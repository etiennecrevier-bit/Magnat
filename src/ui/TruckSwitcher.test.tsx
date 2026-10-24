import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { FIRST_TRUCK } from '../engine/trucks.ts'
import type { GameState } from '../engine/types.ts'
import { createShownTruck } from '../world/shownTruck.ts'
import { hiring, SECOND, withSecondTruck } from './fixtures/twoTrucks.ts'
import { createGameStore, gameStore, type GameStoreState } from './store.ts'
import TruckSwitcher, { TruckSwitcherView } from './TruckSwitcher.tsx'
import { forgetPickOnNewGame, truckPills } from './truckViews.ts'

// A static render reads a Zustand store's initial state, so the switcher
// reads the app store's current state through this stand-in.
vi.mock('./store.ts', async (importOriginal) => {
  const store = await importOriginal<typeof import('./store.ts')>()
  return {
    ...store,
    useGame: <T,>(selector: (state: GameStoreState) => T): T =>
      selector(store.gameStore.getState()),
  }
})

afterEach(() => {
  gameStore.setState(gameStore.getInitialState(), true)
})

const START = createInitialState(42)
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7]

/**
 * Day 1, a Tuesday, the second truck open every day: Kevin at the Plateau,
 * the owner at Vieux-Montréal.
 */
function summer(): GameState {
  return tick(
    withSecondTruck(
      START,
      { kind: 'daysOpen', weekdays: EVERY_DAY, truck: SECOND },
      hiring('kevin'),
      { kind: 'ownerAt', truck: SECOND },
    ),
  )
}

/** Every element in `node` and its children, `node` included. */
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return (node as ReactNode[]).flatMap(elements)
  if (!isValidElement(node)) return []
  const { children } = node.props as { children?: ReactNode }
  return [node, ...elements(children)]
}

/** The text of each button in `html`, tags removed. */
function buttons(html: string): string[] {
  return [...html.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)].map(([, text]) =>
    (text ?? '').replace(/<[^>]*>/g, ''),
  )
}

describe('truckPills (#265)', () => {
  it('has none with one truck', () => {
    expect(truckPills(START)).toEqual([])
  })

  it('names each truck and who works there today', () => {
    expect(truckPills(summer())).toEqual([
      { id: FIRST_TRUCK, name: 'Plateau', who: 'Kevin' },
      { id: SECOND, name: 'Vieux-Montréal', who: 'vous' },
    ])
  })

  it('says « fermé » with nobody there and « remisé » while stored', () => {
    const closed = tick(
      withSecondTruck(START, {
        kind: 'daysOpen',
        weekdays: EVERY_DAY,
        truck: SECOND,
      }),
    )
    expect(truckPills(closed).map(({ who }) => who)).toEqual(['vous', 'fermé'])
    const stored = tick(
      withSecondTruck(START, {
        kind: 'storage',
        storage: { from: { month: 5, day: 1 }, to: { month: 5, day: 31 } },
        truck: SECOND,
      }),
    )
    expect(truckPills(stored).map(({ who }) => who)).toEqual(['vous', 'remisé'])
  })
})

describe('TruckSwitcherView (#265)', () => {
  it('shows nothing while there is one truck', () => {
    expect(
      renderToStaticMarkup(
        <TruckSwitcherView pills={[]} shown={FIRST_TRUCK} onPick={() => {}} />,
      ),
    ).toBe('')
  })

  it('shows a pill per truck, the one shown pressed', () => {
    const html = renderToStaticMarkup(
      <TruckSwitcherView
        pills={truckPills(summer())}
        shown={SECOND}
        onPick={() => {}}
      />,
    )
    expect(html).toMatch(
      /^<div class="truck-switcher" role="group" aria-label="Camion affiché">/,
    )
    expect(buttons(html)).toEqual(['Plateau · Kevin', 'Vieux-Montréal · vous'])
    expect(
      [...html.matchAll(/aria-pressed="(\w+)"/g)].map(([, v]) => v),
    ).toEqual(['false', 'true'])
  })

  it('picks the truck pressed', () => {
    const onPick = vi.fn()
    const view = TruckSwitcherView({
      pills: truckPills(summer()),
      shown: SECOND,
      onPick,
    })
    const [plateau] = elements(view).filter((each) => each.type === 'button')
    ;(plateau?.props as { onClick: () => void }).onClick()
    expect(onPick).toHaveBeenCalledWith(FIRST_TRUCK)
  })
})

describe('TruckSwitcher (#265)', () => {
  it('appears once the game has its second truck, and shows the truck picked', () => {
    const shown = createShownTruck()
    expect(renderToStaticMarkup(<TruckSwitcher store={shown} />)).toBe('')
    gameStore.setState({ game: summer() })
    // With none picked, the truck the owner works at.
    const owner = renderToStaticMarkup(<TruckSwitcher store={shown} />)
    expect(owner).toContain('aria-pressed="true">Vieux-Montréal · vous<')
    shown.pick(FIRST_TRUCK)
    const picked = renderToStaticMarkup(<TruckSwitcher store={shown} />)
    expect(picked).toContain('aria-pressed="true">Plateau · Kevin<')
  })

  it('forgets the truck picked when another game starts', () => {
    const store = createGameStore(summer())
    const shown = createShownTruck()
    const stop = forgetPickOnNewGame(store, shown)
    shown.pick(FIRST_TRUCK)
    store.getState().decide({ kind: 'ownerAt', truck: FIRST_TRUCK })
    expect(shown.getState()).toBe(FIRST_TRUCK)
    store.getState().startGame(createInitialState(7))
    expect(shown.getState()).toBeNull()
    stop()
    shown.pick(SECOND)
    store.getState().startGame(createInitialState(8))
    expect(shown.getState()).toBe(SECOND)
  })
})
