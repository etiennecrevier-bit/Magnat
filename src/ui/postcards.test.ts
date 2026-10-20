import { describe, expect, it } from 'vitest'
import { postcardTargetSchema, type PostcardId } from '../content/schema.ts'
import { allowedChoices } from '../engine/challenge.ts'
import {
  createInitialState,
  startChallenge,
  startTutorial,
  tick,
} from '../engine/clock.ts'
import { DEFIS, EVENTS, FOOD_TRUCK } from '../engine/day.ts'
import { applyDecision } from '../engine/decisions.ts'
import { cents } from '../engine/money.ts'
import { deserialize, serialize } from '../engine/save.ts'
import { STAFF } from '../engine/staff.ts'
import { skipTutorial } from '../engine/tutorial.ts'
import type { GameState } from '../engine/types.ts'
import { balance, postEntry } from '../finance/journal.ts'
import { DOCK_ITEMS } from './dock.ts'
import { dreamBoard } from './dreamBoard.ts'
import {
  createMessageStack,
  startMessageStack,
  streetMessages,
} from './messageStack.ts'
import { MAX_MESSAGES } from './messageTriggers.ts'
import {
  POSTCARDS,
  contractOffers,
  duePostcards,
  postcardHolds,
  postcardsEligible,
  startPostcards,
  type Postcard,
} from './postcards.ts'
import {
  createGameStore,
  type GameStore,
  type GameStoreState,
} from './store.ts'

const SEED = 42
const START = createInitialState(SEED)
const ALL = POSTCARDS.items.map(({ id }) => id)
const MONTHLY = { everyWeek: () => false, cadence: () => 'month' as const }

/** `game` with every postcard shown but `left`. */
function onlyLeft(game: GameState, ...left: PostcardId[]): GameState {
  return { ...game, postcardsShown: ALL.filter((id) => !left.includes(id)) }
}

function facts(
  game: GameState,
  monthReport: GameStoreState['monthReport'] = null,
) {
  return { game, monthReport }
}

/** Lets the postcards note what they sent, a microtask on. */
const settle = () => Promise.resolve()

/**
 * `START` with the encaisse below zero on its first three closes, then
 * back above it as a client pays on day 3, with no card on the way.
 */
function dipsBelowZero(): GameState {
  const owed = cents(balance(START.journal, '1000', { toDay: 0 }) + 100_000)
  return {
    ...START,
    journal: postEntry(START.journal, {
      day: 0,
      memo: 'Vente à crédit',
      lines: [
        { account: '1100', debit: owed, credit: cents(0) },
        { account: '1000', debit: cents(0), credit: owed },
      ],
    }),
    receivables: [{ client: 'Client', amount: owed, soldOnDay: 0, dueDay: 3 }],
    // The lender came already this year, so no card stops the days.
    financing: { ...START.financing, lastLoanRequestDay: 0 },
  }
}

/** `game` with both ladders' next rungs bought, so neither sells another. */
function bothRungsBought(game: GameState): GameState {
  const personal = dreamBoard(game).personal.next?.id
  const bought = applyDecision(game, { kind: 'buy', rung: personal! })
  const company = dreamBoard(bought).company.next?.id
  return applyDecision(bought, { kind: 'buy', rung: company! })
}

/**
 * Plays `store` to `day`, as the player would: each event answered with
 * its first choice allowed, each panel closed, a day at a time, the
 * postcards' notes let through. Stops early once the game is over.
 * `onDay` may decide on each morning before it is played.
 */
async function playTo(
  store: GameStore,
  day: number,
  onDay: (state: GameStoreState) => void = () => {},
): Promise<void> {
  for (let steps = 0; store.getState().game.day < day; steps += 1) {
    if (steps > day * 10) throw new Error('the game is stuck')
    const state = store.getState()
    const { game, panel } = state
    if (panel === 'defiEnd' || panel === 'bankruptcy') return
    const pending = game.events.pending
    if (pending !== null) {
      const card = EVENTS.events.find(({ id }) => id === pending.event)
      const allowed = allowedChoices(game, DEFIS)
      const choice = card?.choices.find(
        ({ id }) => allowed === null || allowed.includes(id),
      )
      state.chooseEvent(choice?.id ?? '')
      store.getState().closePanel()
    } else if (panel !== null) {
      state.closePanel()
    } else {
      onDay(state)
      store.getState().advance(1)
    }
    await settle()
  }
}

/** The postcards `store` sends from now on, by id with their day. */
function record(store: GameStore) {
  const sent: Postcard[] = []
  const stop = startPostcards(store, (postcard) => sent.push(postcard))
  return { sent, stop }
}

describe('postcardsEligible', () => {
  it('gives postcards to a game without a tutorial from its first day', () => {
    expect(postcardsEligible(START)).toBe(true)
  })

  it('gives none while the tutorial is under way, then gives them, skipped or done', () => {
    const tutorial = startTutorial()
    expect(postcardsEligible(tutorial)).toBe(false)
    expect(postcardsEligible(skipTutorial(tutorial))).toBe(true)
    expect(
      postcardsEligible({
        ...tutorial,
        tutorial: { ...tutorial.tutorial!, step: null, done: true },
      }),
    ).toBe(true)
  })

  it('gives none in a Défi', () => {
    for (const { id } of DEFIS.defis) {
      expect(postcardsEligible(startChallenge(id, SEED)), id).toBe(false)
    }
  })
})

describe('the postcards’ targets', () => {
  it('are the dock’s buttons', () => {
    expect(postcardTargetSchema.options).toEqual(DOCK_ITEMS.map(({ id }) => id))
  })
})

describe('postcardHolds', () => {
  const offers = contractOffers()

  it('knows the grocers’ offers from the event cards, the renewals aside', () => {
    expect([...offers].sort()).toEqual([
      'contratBioLogique',
      'contratDepanneur',
      'contratNormand',
    ])
  })

  it('contrat: once a grocer’s offer waits, or came already', () => {
    const waiting = (event: string): GameState => ({
      ...START,
      events: { ...START.events, pending: { event, followUp: false } },
    })
    expect(postcardHolds('contrat', facts(START))).toBe(false)
    expect(postcardHolds('contrat', facts(waiting('contratBioLogique')))).toBe(
      true,
    )
    expect(
      postcardHolds('contrat', facts(waiting('renouvellementNormand'))),
    ).toBe(false)
    const came: GameState = {
      ...START,
      events: {
        ...START.events,
        history: [
          {
            day: 40,
            event: 'contratNormand',
            followUp: false,
            choice: 'non',
            outcome: 0,
          },
        ],
      },
    }
    expect(postcardHolds('contrat', facts(came))).toBe(true)
  })

  it('fournil: while « Fournil » takes an opening', () => {
    expect(postcardHolds('fournil', facts(START))).toBe(true)
    const planned = applyDecision(START, { kind: 'openBakery', oven: 'louer' })
    expect(postcardHolds('fournil', facts(planned))).toBe(false)
  })

  it('embauche: while « Équipe » may hire someone', () => {
    expect(postcardHolds('embauche', facts(START))).toBe(true)
    let full = START
    for (const candidate of Object.keys(STAFF.candidates).slice(
      0,
      STAFF.maxEmployees,
    )) {
      full = applyDecision(full, {
        kind: 'hire',
        role: 'camion',
        candidate: candidate as never,
      })
    }
    expect(postcardHolds('embauche', facts(full))).toBe(false)
  })

  it('amelioration: while either ladder sells its next rung this morning', () => {
    expect(postcardHolds('amelioration', facts(START))).toBe(true)
    expect(postcardHolds('amelioration', facts(bothRungsBought(START)))).toBe(
      false,
    )
  })

  it('rouge: once the encaisse closed below zero', () => {
    expect(postcardHolds('rouge', facts(START))).toBe(false)
    expect(postcardHolds('rouge', facts(tick(dipsBelowZero())))).toBe(true)
  })

  it('bilanMois: once a « Bilan du mois » came', () => {
    expect(postcardHolds('bilanMois', facts(START))).toBe(false)
    const month = {} as NonNullable<GameStoreState['monthReport']>
    expect(postcardHolds('bilanMois', facts(START, month))).toBe(true)
  })

  it('ville: always, outside a Défi', () => {
    expect(postcardHolds('ville', facts(START))).toBe(true)
  })
})

describe('duePostcards', () => {
  it('lists what holds, in the content’s order, the shown ones left out', () => {
    expect(duePostcards(facts(START))).toEqual([
      'amelioration',
      'ville',
      'embauche',
      'fournil',
    ])
    expect(
      duePostcards(facts({ ...START, postcardsShown: ['ville', 'fournil'] })),
    ).toEqual(['amelioration', 'embauche'])
    expect(duePostcards(facts(START), new Set(['amelioration']))).toEqual([
      'ville',
      'embauche',
      'fournil',
    ])
  })

  it('lists none in a Défi, nor while the tutorial is under way', () => {
    expect(
      duePostcards(facts(startChallenge('payeDans60Jours', SEED))),
    ).toEqual([])
    expect(duePostcards(facts(startTutorial()))).toEqual([])
  })
})

describe('startPostcards', () => {
  it('sends all that is due as it starts, the game paused, and notes it at once', () => {
    const store = createGameStore(START)
    store.getState().setSpeed(0)
    const { sent, stop } = record(store)
    expect(sent[0]).toEqual({
      id: 'amelioration',
      from: 'Réal, Fort Lauderdale',
      text: "T'as de quoi te gâter un peu. Regarde Améliorations.",
      target: 'ameliorations',
      day: 0,
    })
    const opened = ['amelioration', 'ville', 'embauche', 'fournil']
    expect(sent.map(({ id, day }) => [id, day])).toEqual(
      opened.map((id) => [id, 0]),
    )
    expect(store.getState().game.postcardsShown).toEqual(opened)
    stop()
  })

  it('sends the offer of a game loaded with it waiting, while paused', () => {
    const loaded = onlyLeft(
      {
        ...START,
        day: 40,
        events: {
          ...START.events,
          pending: { event: 'contratNormand', followUp: false },
        },
      },
      'contrat',
    )
    const store = createGameStore(loaded)
    const { sent, stop } = record(store)
    expect(store.getState().panel).toBe('event')
    expect(sent.map(({ id, day }) => [id, day])).toEqual([['contrat', 40]])
    stop()
  })

  it('loses none to a reload once what it announced stopped holding', () => {
    // What opens from the first day is sent and noted then: a bakery
    // opened that morning, then a reload, leaves « fournil » shown.
    const store = createGameStore(START)
    const { sent, stop } = record(store)
    store.getState().decide({ kind: 'openBakery', oven: 'louer' })
    stop()
    const loaded = deserialize(serialize(store.getState().game))
    expect(postcardHolds('fournil', facts(loaded))).toBe(false)
    expect(loaded.postcardsShown).toEqual(sent.map(({ id }) => id))
    expect(loaded.postcardsShown).toContain('fournil')
  })

  it('loses none to a reload after an advance it went through and out of', async () => {
    const store = createGameStore(onlyLeft(dipsBelowZero(), 'rouge'))
    const { sent, stop } = record(store)
    store.getState().advance(5)
    await settle()
    stop()
    expect(sent.map(({ id }) => id)).toEqual(['rouge'])
    const loaded = deserialize(serialize(store.getState().game))
    expect(loaded.postcardsShown).toContain('rouge')
    const again = record(createGameStore(loaded))
    expect(again.sent).toEqual([])
    again.stop()
  })

  it('sends a rung within reach the same morning, as cash comes in', async () => {
    const out = onlyLeft(bothRungsBought(START), 'amelioration')
    const store = createGameStore(out)
    const { sent, stop } = record(store)
    expect(sent).toEqual([])
    const richer = postEntry(out.journal, {
      day: 0,
      memo: 'Mise de fonds',
      lines: [
        { account: '1000', debit: cents(10_000_000), credit: cents(0) },
        { account: '3000', debit: cents(0), credit: cents(10_000_000) },
      ],
    })
    store.setState({ game: { ...out, journal: richer } })
    expect(sent.map(({ id, day }) => [id, day])).toEqual([['amelioration', 0]])
    await settle()
    expect(store.getState().game.postcardsShown).toContain('amelioration')
    stop()
  })

  it('sends a close below zero that a multi-day advance went through and out of', async () => {
    const store = createGameStore(onlyLeft(dipsBelowZero(), 'rouge'))
    const { sent, stop } = record(store)
    store.getState().advance(5)
    const { game } = store.getState()
    expect(game.day).toBe(5)
    expect(game.financing.belowZeroSince).toBeNull()
    // Dated on the first morning below zero, not the advance's last.
    expect(sent.map(({ id, day }) => [id, day])).toEqual([['rouge', 1]])
    await settle()
    expect(game.postcardsShown).not.toContain('rouge')
    expect(store.getState().game.postcardsShown).toContain('rouge')
    stop()
  })

  it('sends nothing twice when started again before it noted what it sent', async () => {
    const store = createGameStore(onlyLeft(startTutorial(), 'ville'))
    const first = record(store)
    store.getState().skipTour()
    first.stop()
    // Not noted in the game yet, the store's notification barely over.
    expect(store.getState().game.postcardsShown).not.toContain('ville')
    const second = record(store)
    await settle()
    expect(first.sent.map(({ id }) => id)).toEqual(['ville'])
    expect(second.sent).toEqual([])
    expect(store.getState().game.postcardsShown).toContain('ville')
    second.stop()
  })

  it('sends none during the tutorial, then what is due the morning it is skipped', async () => {
    const store = createGameStore(startTutorial())
    const { sent, stop } = record(store)
    expect(sent).toEqual([])
    store.getState().skipTour()
    const ids = sent.map(({ id }) => id)
    expect(ids).toContain('ville')
    expect(new Set(sent.map(({ day }) => day))).toEqual(
      new Set([store.getState().game.day]),
    )
    await settle()
    expect(store.getState().game.postcardsShown).toEqual(ids)
    stop()
  })

  it('sends and notes nothing in a game started after it', async () => {
    const store = createGameStore(START)
    const { sent, stop } = record(store)
    store.getState().advance(1)
    const before = sent.map(({ id }) => id)
    expect(before).toHaveLength(4)
    const other = createInitialState(7)
    store.getState().startGame(other)
    await settle()
    store.getState().advance(1)
    await settle()
    expect(sent.map(({ id }) => id)).toEqual(before)
    expect(store.getState().game.postcardsShown).toBeUndefined()
    stop()
  })

  it('sends nothing once stopped', () => {
    const store = createGameStore(START)
    const { sent, stop } = record(store)
    stop()
    store.getState().advance(1)
    expect(sent).toHaveLength(4)
  })
})

describe('a seeded 2-year game (#239)', () => {
  /** Croissants, café and chocolat at the lowest price from day 120 on. */
  const cheap = (state: GameStoreState) => {
    if (state.game.day !== 120) return
    for (const product of ['cafe', 'chocolat', 'croissant'] as const) {
      state.decide({
        kind: 'price',
        product,
        price: cents(FOOD_TRUCK.decisionLimits.priceCents.min),
      })
    }
  }

  /** The mornings each fact first held, as the store published them. */
  function watch(store: GameStore) {
    const first: { offer?: number; red?: number; month?: number } = {}
    store.subscribe(({ game, monthReport, reportShown }) => {
      const pending = game.events.pending?.event
      if (pending !== undefined && contractOffers().has(pending)) {
        first.offer ??= game.day
      }
      if (game.financing.belowZeroSince !== null) first.red ??= game.day
      if (monthReport !== null && reportShown === 'month') {
        first.month ??= game.day
      }
    })
    return first
  }

  it('sends each postcard once, on its morning, and none twice after a reload', async () => {
    const store = createGameStore(START, EVENTS, MONTHLY)
    const first = watch(store)
    const before = record(store)
    await playTo(store, 60, cheap)
    before.stop()

    // Reloaded on day 60, with a store and postcards started anew.
    const loaded = deserialize(serialize(store.getState().game))
    expect(loaded.postcardsShown).toEqual(before.sent.map(({ id }) => id))
    const again = createGameStore(loaded, EVENTS, MONTHLY)
    const later = watch(again)
    const after = record(again)
    await playTo(again, 730, cheap)
    after.stop()

    const sent = [...before.sent, ...after.sent]
    const day = Object.fromEntries(sent.map(({ id, day }) => [id, day]))
    expect(sent.map(({ id }) => id).sort()).toEqual([...ALL].sort())
    // What the game opens from its first day, on that day.
    expect([day.amelioration, day.ville, day.embauche, day.fournil]).toEqual([
      0, 0, 0, 0,
    ])
    expect(first.month).toBeDefined()
    expect(day.bilanMois).toBe(first.month)
    expect(later.offer).toBeDefined()
    expect(day.contrat).toBe(later.offer)
    expect(later.red).toBeDefined()
    expect(day.rouge).toBe(later.red)
    expect(again.getState().game.postcardsShown).toHaveLength(ALL.length)
  }, 60_000)

  it('sends no « Bilan du mois » with the weekly report, then one with the first month’s', async () => {
    let cadence: 'week' | 'month' = 'week'
    const store = createGameStore(START, EVENTS, {
      everyWeek: () => false,
      cadence: () => cadence,
    })
    const { sent, stop } = record(store)
    await playTo(store, 100)
    expect(sent.map(({ id }) => id)).not.toContain('bilanMois')
    cadence = 'month'
    const first = watch(store)
    await playTo(store, 160)
    stop()
    expect(sent.filter(({ id }) => id === 'bilanMois')).toEqual([
      expect.objectContaining({ day: first.month }),
    ])
  }, 60_000)

  it('sends none in any Défi', async () => {
    for (const { id } of DEFIS.defis) {
      const store = createGameStore(startChallenge(id, SEED), EVENTS, MONTHLY)
      const { sent, stop } = record(store)
      await playTo(store, 400)
      stop()
      expect(sent, id).toEqual([])
      expect(store.getState().game.postcardsShown, id).toBeUndefined()
    }
  }, 60_000)
})

describe('the message stack’s postcards', () => {
  it('keeps every postcard past the most messages, each with its own id', async () => {
    const store = createGameStore(START)
    const stack = createMessageStack()
    const stop = startMessageStack(store, stack)
    // Four postcards as it starts, and a rent unpaid each morning.
    for (let day = 1; day <= 4; day += 1) {
      const { game } = store.getState()
      store.setState({
        game: {
          ...game,
          day,
          personal: {
            ...game.personal,
            unpaidRents: [...game.personal.unpaidRents, day - 1],
          },
        },
      })
      await settle()
    }
    const { messages } = stack.getState()
    const kinds = messages.map(({ kind }) => kind)
    expect(kinds.filter((kind) => kind === 'postcard')).toHaveLength(4)
    expect(kinds.filter((kind) => kind === 'landlord')).toHaveLength(
      MAX_MESSAGES,
    )
    const ids = messages.map(({ id }) => id)
    expect(new Set(ids).size).toBe(ids.length)
    const postcard = messages.find(({ kind }) => kind === 'postcard')!
    stack.getState().dismiss(postcard.id)
    expect(stack.getState().messages).toHaveLength(messages.length - 1)
    expect(stack.getState().messages.map(({ id }) => id)).not.toContain(
      postcard.id,
    )
    stop()
  })

  it('pulses the button a postcard points at until it opens, by any way', () => {
    const store = createGameStore(START)
    const stack = createMessageStack()
    store.setState({ game: onlyLeft(START, 'amelioration') })
    const stop = startMessageStack(store, stack)
    expect(stack.getState().messages[0]?.postcard).toEqual({
      id: 'amelioration',
      target: 'ameliorations',
    })
    expect(stack.getState().pulsing).toEqual(['ameliorations'])
    store.getState().openPanel('dream')
    expect(stack.getState().pulsing).toEqual([])
    stop()
  })

  it('shows a postcard dated on a morning an advance went through as it ends', () => {
    const store = createGameStore(onlyLeft(dipsBelowZero(), 'rouge'))
    const stack = createMessageStack()
    const stop = startMessageStack(store, stack)
    store.getState().advance(5)
    const [card] = stack.getState().messages
    expect(card).toMatchObject({ kind: 'postcard', day: 1, arrivedOn: 5 })
    expect(streetMessages(stack.getState().messages, 5)).toEqual([card])
    stop()
  })

  it('keeps its postcards when started again for the same game, as React replays an effect', () => {
    const store = createGameStore(START)
    const stack = createMessageStack()
    startMessageStack(store, stack)()
    const stop = startMessageStack(store, stack)
    const { messages, pulsing } = stack.getState()
    expect(messages.map(({ postcard }) => postcard?.id).sort()).toEqual(
      [...(store.getState().game.postcardsShown ?? [])].sort(),
    )
    expect(messages).toHaveLength(4)
    expect(pulsing).toHaveLength(4)
    // A message sent since takes an id of its own.
    const { game } = store.getState()
    store.setState({
      game: {
        ...game,
        day: 1,
        personal: { ...game.personal, unpaidRents: [0] },
      },
    })
    const ids = stack.getState().messages.map(({ id }) => id)
    expect(ids).toHaveLength(5)
    expect(new Set(ids).size).toBe(5)
    stop()
    // A new game starts the stack empty.
    store.getState().startGame(onlyLeft(createInitialState(7)))
    const next = startMessageStack(store, stack)
    expect(stack.getState().messages).toEqual([])
    expect(stack.getState().pulsing).toEqual([])
    next()
  })

  it('does not pulse a button already open as the postcard comes', () => {
    const store = createGameStore(onlyLeft(START, 'ville'))
    store.getState().openPanel('trip')
    const stack = createMessageStack()
    const stop = startMessageStack(store, stack)
    expect(stack.getState().messages.map(({ kind }) => kind)).toEqual([
      'postcard',
    ])
    expect(stack.getState().pulsing).toEqual([])
    stop()
  })
})
