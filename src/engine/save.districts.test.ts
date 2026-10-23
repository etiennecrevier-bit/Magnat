import { describe, expect, it } from 'vitest'
import dreamJson from '../content/dream.json'
import { loadDreamContent, type DreamContent } from '../content/schema.ts'
import { withoutLemonade } from './fixtures/lemonade.ts'
import v20Save from './fixtures/v20-two-trucks.json'
import { BAKERY } from './bakery.ts'
import { tick } from './clock.ts'
import { GROCERS } from './contracts.ts'
import { SEGMENTS } from './customers.ts'
import {
  CUSTOMERS,
  DEFIS,
  DIFFICULTIES,
  ENERGY,
  EVENTS,
  FOOD_TRUCK,
  PERSONAL,
} from './day.ts'
import { applyDecision } from './decisions.ts'
import { defaultWinterStorage } from './districts.ts'
import { NO_EVENTS } from './events.ts'
import { FINANCING } from './financing.ts'
import { PERCENTILES } from './percentiles.ts'
import { PLACES } from './places.ts'
import { deserialize, serialize } from './save.ts'
import { STAFF } from './staff.ts'
import type { GameState } from './types.ts'

// A save of two trucks from before the districts (#260): version 20, as
// main wrote it on day 2 of a game seeded 42 whose « Deuxième camion »,
// bought on day 0 at 5 000 $, Kevin runs (see fixtures/). Its last days,
// the game's and the second truck's, count no tourist, as the game had
// none then; it loads with none, plays on and saves again as version 21.

const V20 = JSON.stringify(v20Save)
const SECOND = 'vieuxMontreal'
const NO_VISITS = { visits: 0, buyers: 0, tooExpensive: 0, soldOut: 0 }

/** « Le rêve » as the fixture's game had it: the second truck first, cheap. */
const DREAM: DreamContent = loadDreamContent({
  ...dreamJson,
  company: [
    { ...dreamJson.company[2], priceCents: 500_000 },
    dreamJson.company[0],
    dreamJson.company[1],
  ],
})

function load(text: string): GameState {
  return deserialize(
    text,
    FOOD_TRUCK,
    EVENTS,
    DIFFICULTIES,
    DEFIS,
    BAKERY,
    GROCERS,
    STAFF,
    FINANCING,
    DREAM,
    PLACES,
  )
}

function next(state: GameState): GameState {
  return tick(
    state,
    FOOD_TRUCK,
    CUSTOMERS,
    DIFFICULTIES,
    PERSONAL,
    ENERGY,
    NO_EVENTS,
    DEFIS,
    PERCENTILES,
    BAKERY,
    GROCERS,
    STAFF,
    FINANCING,
    DREAM,
    PLACES,
  )
}

interface SavedDay {
  segments: Record<string, unknown>
  visits: { segment: string }[]
}

describe('a version 20 save of two trucks (#260)', () => {
  const saved = JSON.parse(V20) as {
    saveVersion: number
    lastDay: SavedDay
    trucks: { id: string; lastDay: SavedDay }[]
  }

  it('is one from before the tourists, with a day played at each truck', () => {
    expect(saved.saveVersion).toBe(20)
    const days = [saved.lastDay, ...saved.trucks.map(({ lastDay }) => lastDay)]
    expect(saved.trucks.map(({ id }) => id)).toEqual([SECOND])
    for (const day of days) {
      expect(Object.keys(day.segments)).toEqual(['aubaine', 'habitue', 'chic'])
      expect(day.visits.length).toBeGreaterThan(0)
    }
  })

  it('loads with no tourist on its last days, in the order of the segments, and no truck stored', () => {
    const game = load(V20)
    const days = [game.lastDay, ...(game.trucks ?? []).map((t) => t.lastDay)]
    for (const day of days) {
      expect(Object.keys(day?.segments ?? {})).toEqual(SEGMENTS)
      expect(day?.segments.touriste).toEqual(NO_VISITS)
    }
    expect(game.decisions.storage).toBeUndefined()
    expect(game.decisions.trucks?.[SECOND]?.storage).toBeUndefined()
    // Nor any lemonade (#261): each truck gets a new game's decisions.
    const { pricesCents, restock } = FOOD_TRUCK.startingDecisions
    for (const own of [game.decisions, game.decisions.trucks?.[SECOND]]) {
      expect(own?.prices.limonade).toBe(pricesCents.limonade)
      expect(own?.restock.limonade).toEqual(restock.limonade)
    }
    for (const day of days) expect(day?.sold.limonade).toBe(0)
    // Nothing else moves: saved again, it is the version 20 save with the
    // tourists counted at zero, and the lemonade (#261) at what a save
    // from before it gets (see save.lemonade.test.ts).
    const again = withoutLemonade(JSON.parse(serialize(game)) as typeof saved)
    const tourists = (day: SavedDay) => ({
      ...day,
      segments: { ...day.segments, touriste: NO_VISITS },
    })
    expect(again).toEqual({
      ...saved,
      saveVersion: 21,
      lastDay: tourists(saved.lastDay),
      trucks: saved.trucks.map((truck) => ({
        ...truck,
        lastDay: tourists(truck.lastDay),
      })),
    })
  })

  it('plays on, stores its second truck and saves again as version 21', () => {
    let game = applyDecision(
      load(V20),
      { kind: 'storage', truck: SECOND, storage: defaultWinterStorage() },
      FOOD_TRUCK,
      DEFIS,
      BAKERY,
      STAFF,
      DREAM,
      DIFFICULTIES,
      PLACES,
    )
    for (let day = 0; day < 5; day += 1) game = next(game)
    expect(game.decisions.trucks?.[SECOND]?.storage).toEqual(
      defaultWinterStorage(),
    )
    const text = serialize(game)
    expect(JSON.parse(text)).toMatchObject({ saveVersion: 21 })
    expect(load(text)).toStrictEqual(game)
  })

  it('rejects a tourist on the second truck’s last day while it is version 20', () => {
    const edited = JSON.parse(V20) as typeof saved
    const [truck] = edited.trucks
    if (truck === undefined) throw new Error('A second truck')
    truck.lastDay.segments.touriste = NO_VISITS
    expect(() => load(JSON.stringify(edited))).toThrow(
      /Unrecognized key: "touriste"\n {2}→ at trucks\[0\]\.lastDay\.segments/,
    )
  })
})
