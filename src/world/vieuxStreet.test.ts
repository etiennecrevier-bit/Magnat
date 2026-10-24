import { Container, Texture, type Filter, type Ticker } from 'pixi.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState, toCalendar } from '../engine/clock.ts'
import { applyDecision, type DecisionChange } from '../engine/decisions.ts'
import { NO_EVENTS } from '../engine/events.ts'
import { next, seedRng } from '../engine/rng.ts'
import { askingWage } from '../engine/staff.ts'
import { FIRST_TRUCK, newTruck, truckDecisionsOf } from '../engine/trucks.ts'
import type { GameState, TruckDecisions } from '../engine/types.ts'
import { createSettingsStore } from '../ui/settings.ts'
import { createGameStore, type GameStore } from '../ui/store.ts'
import { CROWD, crowdFor } from './crowdSettings.ts'
import { ASSETS } from './manifest.ts'
import { createPicker } from './picker.ts'
import { startStreet, type StreetCrowd, type StreetLoaders } from './street.ts'

// The street of the second truck (#264): Vieux-Montréal's, its crowd at
// its truck, who serves behind its counter, its snow and its calèche.

const SECOND = 'vieuxMontreal'
const VIEUX = ASSETS.districtStreets.vieuxMontreal!

/**
 * `state` with Vieux-Montréal's truck as the engine adds it when bought,
 * running as the first truck does but for `own`.
 */
function withVieux(
  state: GameState,
  own: Partial<TruckDecisions> = {},
): GameState {
  const first = truckDecisionsOf(state.decisions, FIRST_TRUCK)
  return {
    ...state,
    trucks: [newTruck(state.seed, { id: SECOND, district: SECOND }, state.day)],
    decisions: {
      ...state.decisions,
      trucks: { [SECOND]: { ...first, ...own } },
    },
  }
}

function decide(state: GameState, ...changes: DecisionChange[]): GameState {
  return changes.reduce((game, change) => applyDecision(game, change), state)
}

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7]

/**
 * A store on the first day of `month` with both trucks open every day and
 * the owner at Vieux-Montréal's, unless `owner` says the first's; with
 * `staff` employees « Au camion » at Vieux-Montréal's.
 */
function storeIn(
  month: number,
  { owner = SECOND, staff = 0 }: { owner?: string; staff?: number } = {},
): GameStore {
  const hires = ['amelie', 'kevin'].slice(0, staff) as ('amelie' | 'kevin')[]
  const start = decide(
    withVieux(createInitialState(42), { daysOpen: EVERY_DAY }),
    { kind: 'daysOpen', weekdays: EVERY_DAY },
    { kind: 'ownerAt', truck: owner },
    ...hires.flatMap((candidate): DecisionChange[] => [
      {
        kind: 'hire',
        role: 'camion',
        candidate,
        hourlyWage: askingWage(candidate, 'camion'),
      },
      { kind: 'assign', candidate, truck: SECOND },
    ]),
  )
  const store = createGameStore(start, NO_EVENTS)
  store.getState().advance(1)
  while (toCalendar(store.getState().game.day).month !== month) {
    store.getState().advance(1)
  }
  return store
}

/** A Pixi app with a real stage, a screen and a ticker the test runs. */
function createFakeApp(width = 1440, height = 900) {
  const frames = new Set<(ticker: Ticker) => void>()
  return {
    stage: new Container(),
    screen: { width, height },
    ticker: {
      add: vi.fn((onFrame: (ticker: Ticker) => void) => frames.add(onFrame)),
      remove: vi.fn((onFrame: (ticker: Ticker) => void) =>
        frames.delete(onFrame),
      ),
    },
    frame(deltaMS = 16) {
      for (const onFrame of frames) onFrame({ deltaMS } as Ticker)
    },
  }
}

function createLoaders(): StreetLoaders {
  return {
    loadFont: vi.fn(async () => undefined),
    loadTexture: vi.fn(async () => Texture.WHITE),
    measureWidth: () => 100,
    makeFilters: (wanted) =>
      [{ ...wanted, destroy: () => {} }] as unknown as Filter[],
  }
}

/** A `random` the test can replay: the engine's generator from `seed`. */
function seeded(seed: number): () => number {
  let state = seedRng(seed)
  return () => {
    const [value, after] = next(state)
    state = after
    return value
  }
}

const CROWD_OF_TEST: StreetCrowd = { settings: CROWD, random: seeded(7) }

/** Vieux-Montréal's street, or the first truck's, on `store`. */
async function vieuxStreet(
  store: GameStore,
  truck = SECOND,
  settings = createSettingsStore(null),
) {
  const app = createFakeApp()
  const stop = await startStreet(
    app,
    store,
    createLoaders(),
    ASSETS,
    CROWD_OF_TEST,
    createPicker(),
    settings,
    () => null,
    truck,
  )
  const find = (label: string | RegExp) => {
    const found = app.stage.getChildByLabel(label, true)
    if (found === null) throw new Error(`No ${label}`)
    return found
  }
  return { app, stop, find, settings }
}

describe('crowdFor', () => {
  it('moves the line, the avatar, the spill and the tally with the truck, and stands the employee at its own place', () => {
    const crowd = crowdFor(CROWD, VIEUX)
    expect(crowd.counterX).toBe(CROWD.counterX + 60)
    expect(crowd.avatar.x).toBe(CROWD.avatar.x + 60)
    expect(crowd.fatigue.spill.x).toBe(CROWD.fatigue.spill.x + 60)
    expect(crowd.tally.x).toBe(CROWD.tally.x + 60)
    expect(crowd.employee.x).toBe(VIEUX.employeeX)
    // Everything else is the Plateau's.
    expect(crowd.groundY).toBe(CROWD.groundY)
    expect(crowd.employee.feetY).toBe(CROWD.employee.feetY)
    expect(crowd.speeds).toBe(CROWD.speeds)
  })

  it("is the Plateau's crowd itself on the Plateau", () => {
    expect(crowdFor(CROWD, null)).toBe(CROWD)
  })

  it('keeps the spill on the counter, near where the avatar reaches', () => {
    const crowd = crowdFor(CROWD, VIEUX)
    const counter = VIEUX.pieces.find(({ id }) => id === 'counter')!
    const { x, width } = crowd.fatigue.spill
    expect(x - width / 2).toBeGreaterThan(counter.x)
    expect(x + width / 2).toBeLessThan(counter.x + counter.width)
    expect(Math.abs(x - crowd.avatar.x)).toBeLessThan(80)
  })
})

describe("startStreet at Vieux-Montréal's truck (#264)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("draws Vieux-Montréal's street, its board naming its corner", async () => {
    const { find, app } = await vieuxStreet(storeIn(7))
    expect(find('building-1-summer').visible).toBe(true)
    expect(app.stage.getChildByLabel('triplex-1', true)).toBeNull()
    const name = find('truck-sign').getChildByLabel('name') as {
      text: string
    } | null
    expect(name?.text).toBe("Le P'tit Camion · Vieux-Port")
    expect(find('awning').visible).toBe(true)
    expect(find('cart').visible).toBe(true)
  })

  it("draws the Plateau's street for the first truck, and for a truck the game lacks", async () => {
    const store = storeIn(7)
    for (const truck of [FIRST_TRUCK, 'nowhere']) {
      const { app, find } = await vieuxStreet(store, truck)
      expect(find('triplex-1').visible).toBe(true)
      expect(app.stage.getChildByLabel('building-1-summer', true)).toBeNull()
      expect(app.stage.getChildByLabel('snow', true)).toBeNull()
      expect(app.stage.getChildByLabel('caleche', true)).toBeNull()
    }
  })

  it('stands the avatar behind its counter, the spill on it and the tally over it, moved with the truck', async () => {
    const { find } = await vieuxStreet(storeIn(7))
    const avatar = find(/^avatar:/)
    expect(avatar.visible).toBe(true)
    expect(avatar.x).toBe(CROWD.avatar.x + 60)
    expect(find('spill').x).toBe(CROWD.fatigue.spill.x + 60)
    expect(find('tally').x).toBe(CROWD.tally.x + 60)
  })

  it('puts an employee behind the counter while the owner works at the other truck', async () => {
    const { app, find } = await vieuxStreet(
      storeIn(7, { owner: FIRST_TRUCK, staff: 1 }),
    )
    const server = find('server')
    expect(server.visible).toBe(true)
    expect(server.x).toBe(CROWD.avatar.x + 60)
    expect(app.stage.getChildByLabel(/^avatar:/, true)).toBeNull()
    // The one employee serves behind the counter: none on the sidewalk.
    expect(find('employee').visible).toBe(false)
  })

  it('stands the second employee on the sidewalk, between the truck and the cart', async () => {
    const { find } = await vieuxStreet(
      storeIn(7, { owner: FIRST_TRUCK, staff: 2 }),
    )
    expect(find('server').visible).toBe(true)
    const employee = find('employee')
    expect(employee.visible).toBe(true)
    expect(employee.x).toBe(VIEUX.employeeX)
  })

  it('stands its employee on the sidewalk beside the owner', async () => {
    const { find } = await vieuxStreet(storeIn(7, { staff: 1 }))
    expect(find(/^avatar:/).visible).toBe(true)
    expect(find('employee').visible).toBe(true)
  })

  it('lets the snow fall over the people in winter, with the full visual effects only', async () => {
    const { find, app, settings } = await vieuxStreet(storeIn(2))
    const snow = find('snow')
    expect(snow.visible).toBe(true)
    const street = find('street')
    const at = (label: string) => street.getChildIndex(find(label))
    expect(at('snow')).toBeGreaterThan(at('customers'))
    expect(find('building-1-winter').visible).toBe(true)
    expect(find('cart-tarp').visible).toBe(true)
    settings.getState().setVisualEffects('simple')
    expect(snow.visible).toBe(false)
    settings.getState().setVisualEffects('full')
    expect(snow.visible).toBe(true)
    app.frame(16)
  })

  it('shows no snow in summer, and lets a calèche cross in front of the people', async () => {
    const { find, app } = await vieuxStreet(storeIn(7))
    expect(find('snow').visible).toBe(false)
    const caleche = find('caleche')
    const street = find('street')
    expect(street.getChildIndex(caleche)).toBeGreaterThan(
      street.getChildIndex(find('customers')),
    )
    const xs: number[] = []
    for (let t = 0; t < VIEUX.caleche.everyMs + 30_000; t += 100) {
      app.frame(100)
      if (caleche.visible) xs.push(caleche.x)
    }
    expect(xs.length).toBeGreaterThan(10)
    // Right to left.
    expect(xs[1]!).toBeLessThan(xs[0]!)
    expect(caleche.y).toBe(VIEUX.caleche.y)
  })

  it('shows the stored truck shut for the winter, coming back in May', async () => {
    const store = storeIn(11)
    const { game } = store.getState()
    store.setState({
      game: decide(game, {
        kind: 'storage',
        storage: { from: { month: 12, day: 1 }, to: { month: 4, day: 30 } },
        truck: SECOND,
      }),
    })
    while (toCalendar(store.getState().game.day).month !== 1) {
      store.getState().advance(1)
    }
    const { find } = await vieuxStreet(store)
    expect(find('shutter').visible).toBe(true)
    expect(find('stored-sign').visible).toBe(true)
    expect(find(/^avatar:/).visible).toBe(false)
    const lines = find('stored-sign')
      .children[0]!.getChildrenByLabel('line')
      .map((line) => (line as unknown as { text: string }).text)
    expect(lines).toEqual(["Fermé pour l'hiver", 'De retour en mai'])
  })
})
