import { describe, expect, it, vi } from 'vitest'
import type { GrocerId } from '../content/schema.ts'
import {
  createInitialState,
  startChallenge,
  tick,
  toCalendar,
} from '../engine/clock.ts'
import { GROCERS, startContract } from '../engine/contracts.ts'
import type { Day, GameState } from '../engine/types.ts'
import { followAlert, missedThisWeek, topAlerts } from './alerts.ts'
import { createMessageStack, messageElementId } from './messageStack.ts'
import { contractsBoard } from './contractsBoard.ts'
import { createGameStore, PAUSED } from './store.ts'

const START = createInitialState(42)

/** `state` with a contract signed that morning with `grocer`. */
function signed(state: GameState, grocer: GrocerId): GameState {
  return {
    ...state,
    contracts: startContract(state.contracts, state.day, grocer),
  }
}

/** `state` played to the morning of `day`, the owner away on `away`. */
function playedTo(
  state: GameState,
  day: Day,
  away: (day: Day) => boolean = () => false,
): GameState {
  let game = state
  while (game.day < day) game = tick({ ...game, ownerAway: away(game.day) })
  return game
}

// Away on Mondays, the delivery day: nobody makes the delivery.
const MONDAYS_AWAY = (day: Day) => toCalendar(day).weekday === 1

describe('missedThisWeek', () => {
  it('counts an ordinary miss, from the morning after it to the end of its week', () => {
    const before = playedTo(signed(START, 'chezNormand'), 7)
    expect(missedThisWeek(before)).toBe(0)
    const after = playedTo(before, 8, MONDAYS_AWAY)
    expect(after.contracts.running).toHaveLength(1)
    expect(missedThisWeek(after)).toBe(1)
    expect(missedThisWeek(playedTo(after, 13))).toBe(1)
  })

  it('leaves out a miss of an earlier week', () => {
    const after = playedTo(signed(START, 'chezNormand'), 8, MONDAYS_AWAY)
    expect(missedThisWeek(playedTo(after, 14))).toBe(0)
    expect(missedThisWeek(playedTo(after, 16))).toBe(0)
  })

  it('counts the miss that ended the contract, which the « Contrats » board no longer shows', () => {
    const before = playedTo(signed(START, 'chezNormand'), 15, MONDAYS_AWAY)
    const after = playedTo(before, 7 * GROCERS.maxStrikes + 1, MONDAYS_AWAY)
    expect(after.contracts.running).toEqual([])
    expect(
      contractsBoard(after).grocers.every(({ contract }) => contract === null),
    ).toBe(true)
    expect(missedThisWeek(after)).toBe(1)
  })

  it('counts a missed last week, which ended the contract', () => {
    const start = signed(START, 'chezNormand')
    const lastWeek = {
      ...start,
      contracts: {
        ...start.contracts,
        running: start.contracts.running.map((contract) => ({
          ...contract,
          weeksLeft: 1,
        })),
      },
    }
    const after = playedTo(playedTo(lastWeek, 1), 8, MONDAYS_AWAY)
    expect(after.contracts.running).toEqual([])
    expect(missedThisWeek(after)).toBe(1)
  })
})

describe('topAlerts', () => {
  it('has none while nothing waits', () => {
    expect(topAlerts({ missed: 0, messages: 0 })).toEqual([])
  })

  it('puts the missed deliveries first, then the messages, each with an icon and words', () => {
    expect(topAlerts({ missed: 1, messages: 1 })).toEqual([
      { id: 'missed', icon: 'alerte', label: 'Livraison manquée' },
      { id: 'messages', icon: 'cahier', label: '1 message' },
    ])
    expect(topAlerts({ missed: 2, messages: 3 })).toEqual([
      { id: 'missed', icon: 'alerte', label: '2 livraisons manquées' },
      { id: 'messages', icon: 'cahier', label: '3 messages' },
    ])
  })
})

describe('followAlert', () => {
  const page = (focus: () => void) => ({
    getElementById: vi.fn(() => ({ focus }) as unknown as HTMLElement),
  })

  it('opens « Ville » on « Contrats » for a missed delivery, paused', () => {
    const store = createGameStore(START)
    followAlert(
      'missed',
      createMessageStack(),
      store,
      page(() => {}),
    )
    expect(store.getState()).toMatchObject({
      panel: 'trip',
      panelSection: 'contracts',
      speed: PAUSED,
    })
  })

  it('opens « Finances » on « Contrats » in a Défi, without pausing', () => {
    const store = createGameStore(startChallenge('travauxSaintDenis', 42))
    followAlert(
      'missed',
      createMessageStack(),
      store,
      page(() => {}),
    )
    expect(store.getState()).toMatchObject({
      drawer: 'finances',
      drawerTabs: { finances: 'contracts' },
      panel: null,
    })
  })

  it('moves the focus to the newest message', () => {
    const stack = createMessageStack()
    const message = { kind: 'landlord', from: 'X', text: 'Y', day: 0 } as const
    stack.getState().receive({ ...message, id: 1 })
    stack.getState().receive({ ...message, id: 2 })
    const focus = vi.fn()
    const at = page(focus)
    followAlert('messages', stack, createGameStore(START), at)
    expect(at.getElementById).toHaveBeenCalledWith(messageElementId(2))
    expect(focus).toHaveBeenCalledTimes(1)
  })
})
