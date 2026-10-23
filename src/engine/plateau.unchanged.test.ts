import { describe, expect, it } from 'vitest'
import type { DifficultyId } from '../content/schema.ts'
import { entriesOf } from '../finance/journal.ts'
import { BAKERY } from './bakery.ts'
import { createInitialState, tick } from './clock.ts'
import { GROCERS } from './contracts.ts'
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
import { NO_EVENTS, resolveEvent } from './events.ts'
import { PERCENTILES } from './percentiles.ts'
import { defaultProfile } from './profile.ts'
import type { GameState } from './types.ts'

// The Plateau as it played before the districts (#260): one truck, seeded
// 42, played 100 days into August at each difficulty, with the event cards
// and with marketing. Its fingerprint, the books, the generator and each
// day's visits and segments, was taken on main before the districts came,
// so moving the Plateau's crowd to districts.json and adding the tourists
// must leave every draw and every entry as it was. The segments are read
// for those the game had then.

const DAYS = 100
const OLD_SEGMENTS = ['aubaine', 'habitue', 'chic'] as const

/** A 32-bit FNV-1a hash of `text`, as 8 hex digits. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** What each close of `days` games leaves, as text. */
function fingerprint(game: GameState, withEvents: boolean): string {
  const days: string[] = []
  let state = game
  for (let day = 0; day < DAYS; day += 1) {
    state = tick(
      state,
      FOOD_TRUCK,
      CUSTOMERS,
      DIFFICULTIES,
      PERSONAL,
      ENERGY,
      withEvents ? EVENTS : NO_EVENTS,
      DEFIS,
      PERCENTILES,
      BAKERY,
      GROCERS,
    )
    const { pending } = state.events
    if (pending !== null) {
      const choice = EVENTS.events.find(({ id }) => id === pending.event)
        ?.choices[0]?.id
      if (choice === undefined) throw new Error(`No choice: ${pending.event}`)
      state = resolveEvent(state, choice)
    }
    const last = state.lastDay
    days.push(
      JSON.stringify({
        rng: state.rngState,
        visits: last?.visits,
        segments: OLD_SEGMENTS.map((id) => last?.segments[id]),
        sold: last?.sold,
      }),
    )
  }
  return fnv1a(
    JSON.stringify([days, entriesOf(state.journal), state.inventory]),
  )
}

function game(difficulty: DifficultyId): GameState {
  return createInitialState(42, FOOD_TRUCK, {
    ...defaultProfile(),
    difficulty,
  })
}

describe('the Plateau after the districts (#260)', () => {
  it('plays every difficulty exactly as before', () => {
    expect({
      facile: fingerprint(game('facile'), false),
      moyen: fingerprint(game('moyen'), false),
      difficile: fingerprint(game('difficile'), false),
    }).toEqual({
      facile: 'a79a0606',
      moyen: 'ffadb5cd',
      difficile: '87438442',
    })
  })

  it('plays the event cards and marketing exactly as before', () => {
    const marketing = applyDecision(game('moyen'), {
      kind: 'marketingDaily',
      budget: 2_000 as never,
    })
    expect({
      events: fingerprint(game('moyen'), true),
      marketing: fingerprint(marketing, false),
    }).toEqual({ events: 'a00c58b6', marketing: 'e62fba6f' })
  })
})
