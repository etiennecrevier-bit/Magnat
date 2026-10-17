import { describe, expect, it } from 'vitest'
import financingJson from '../content/financing.json'
import {
  loadFinancingContent,
  type DifficultyId,
  type EventContent,
  type EventEffect,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import {
  balance,
  emptyJournal,
  entriesOf,
  entriesSince,
  postEntry,
  type Journal,
  type JournalEntry,
} from '../finance/journal.ts'
import { loanSchedule } from '../finance/loan.ts'
import { cashFlowStatement, incomeStatement } from '../finance/statements.ts'
import { monthsSinceStart, toCalendar } from './calendar.ts'
import { createInitialState, startChallenge, tick } from './clock.ts'
import {
  CUSTOMERS,
  DIFFICULTIES,
  ENERGY,
  EVENTS,
  FOOD_TRUCK,
  PERSONAL,
} from './day.ts'
import { applyEffect, untimed } from './effects.ts'
import { NO_EVENTS, resolveEvent } from './events.ts'
import {
  FINANCING,
  FINANCING_MEMO,
  belowZeroSinceOf,
  chargesOn,
  closingFinancing,
  dividendBase,
  financingMemo,
  financingOffer,
  isFinancingMemo,
  isLoanOpen,
  mayLend,
  noFinancing,
  sellShares,
  takeEmergencyLoan,
} from './financing.ts'
import { monthlyFixedCosts } from './fixedCosts.ts'
import { cents, mulRatio } from './money.ts'
import { defaultProfile } from './profile.ts'
import { deserialize, serialize } from './save.ts'
import type {
  Day,
  EmergencyLoan,
  FinancingState,
  GameState,
  ShareSale,
} from './types.ts'

// The emergency loan and the share sale (#159): when the engine brings
// their cards, what accepting posts, the loan's payments, the investor's
// dividends, and what never changes without them.

const CASH: AccountCode = '1000'
const SEED = 42
const LENDER = 'Caisse populaire Saint-Prudent'
const INVESTOR = 'Duvent Capital'

/** The shipped cards with only the financing's two, which no draw brings. */
const CARDS: EventContent = {
  ...EVENTS,
  events: EVENTS.events.filter(
    ({ id }) => id === FINANCING.loanEvent || id === FINANCING.investorEvent,
  ),
}

/** Each card's effect of its kind, as the shipped content writes it. */
function shipped<Kind extends 'emergencyLoan' | 'shareSale'>(
  kind: Kind,
): Extract<EventEffect, { kind: Kind }> {
  for (const { choices } of CARDS.events) {
    for (const { outcomes } of choices) {
      for (const { effects } of outcomes) {
        for (const effect of effects) {
          if (effect.kind === kind) {
            return untimed(effect) as Extract<EventEffect, { kind: Kind }>
          }
        }
      }
    }
  }
  throw new Error(`No ${kind} effect`)
}
const LOAN = shipped('emergencyLoan')
const SHARES = shipped('shareSale')

/** The next morning, the financing's cards in play. */
function next(state: GameState, events: EventContent = CARDS): GameState {
  return tick(
    state,
    FOOD_TRUCK,
    CUSTOMERS,
    DIFFICULTIES,
    PERSONAL,
    ENERGY,
    events,
  )
}

/**
 * `days` days played from `state`, each card waiting answered with
 * `answer`, by default « Refuser ».
 */
function playOn(
  state: GameState,
  days: number,
  answer: (event: string) => string = () => 'refuser',
): GameState {
  let played = state
  for (let day = 0; day < days; day += 1) {
    const { pending } = played.events
    if (pending !== null) {
      played = resolveEvent(played, answer(pending.event), CARDS)
    }
    played = next(played)
  }
  return played
}

/** A bill that leaves Encaisse `short` below zero, before the day plays. */
function bill(state: GameState, short: number): GameState {
  const cash = balance(state.journal, CASH, { toDay: state.day })
  return applyEffect(
    state,
    {
      kind: 'charge',
      amountCents: cents(Math.max(cash, 0) + short),
      description: 'Facture imprévue',
    },
    FOOD_TRUCK,
    'test',
  )
}

const cashOn = (state: GameState, day: Day = state.day) =>
  balance(state.journal, CASH, { toDay: day })

/** The entries of `memo` in `journal`, oldest first. */
function entriesOfMemo(journal: Journal, memo: string): JournalEntry[] {
  return entriesOf(journal).filter((entry) => entry.memo === memo)
}

/** `amount` from `credited` to `debited` on `day`, as one entry. */
function entry(
  day: Day,
  memo: string,
  debited: AccountCode,
  credited: AccountCode,
  amount: number,
): JournalEntry {
  return {
    day,
    memo,
    lines: [
      { account: debited, debit: cents(amount), credit: cents(0) },
      { account: credited, debit: cents(0), credit: cents(amount) },
    ],
  }
}

// The scripted game: seed 42 at Moyen, days 0 to 58 played, then a bill on
// the morning of day 59 leaves Encaisse 3 000 $ below zero, and it closes
// below zero. The morning of day 60, June 30, brings Mme Prudhomme.
const MORNING_59 = playOn(createInitialState(SEED), 59)
const MORNING_60 = next(bill(MORNING_59, 300_000))
const FIXED_COSTS_60 = monthlyFixedCosts(
  60,
  'moyen',
  0,
  FOOD_TRUCK,
  DIFFICULTIES,
  MORNING_60.bakery,
)
const LOANED = resolveEvent(MORNING_60, 'accepter', CARDS)
const [TAKEN] = LOANED.financing.loans as [EmergencyLoan]
/** A year and more later: the morning of day 400. */
const PAID = playOn(LOANED, 340)
/** The same game, the loan refused. */
const REFUSED = playOn(resolveEvent(MORNING_60, 'refuser', CARDS), 340)

describe('the scripted game (#159)', () => {
  it('closes every day above zero up to day 58, then day 59 below zero', () => {
    expect(MORNING_59.financing).toEqual(noFinancing())
    expect(cashOn(MORNING_60, 58)).toBeGreaterThanOrEqual(0)
    expect(cashOn(MORNING_60, 59)).toBeLessThan(0)
    expect(MORNING_60.financing.belowZeroSince).toBe(59)
  })

  it('brings the emergency loan the morning of day 60, as if drawn that morning', () => {
    expect(MORNING_60.day).toBe(60)
    expect(MORNING_60.events.pending).toEqual({
      event: 'pretUrgence',
      followUp: false,
    })
    expect(MORNING_60.events.lastDrawnDay).toBe(60)
    expect(MORNING_60.financing.lastLoanRequestDay).toBe(60)
  })

  it('lends, once accepted, enough to bring Encaisse to a month of fixed costs, then takes the 2 % fee', () => {
    const cash = cashOn(MORNING_60)
    const principal = FIXED_COSTS_60 - cash
    expect(principal).toBeLessThan(1_500_000)
    const fee = mulRatio(cents(principal), 0.02)
    expect(TAKEN).toEqual({
      day: 60,
      lender: LENDER,
      principal,
      annualRateBasisPoints: 1800,
      termMonths: 12,
      fee,
    })
    expect(entriesSince(LOANED.journal, 60)).toEqual([
      entry(60, `Emprunt d'urgence · ${LENDER}`, '1000', '2500', principal),
      entry(60, `Frais de dossier · ${LENDER}`, '6500', '1000', fee),
    ])
    expect(cashOn(LOANED)).toBe(FIXED_COSTS_60 - fee)
    expect(LOANED.events.history.at(-1)).toMatchObject({
      day: 60,
      event: 'pretUrgence',
      choice: 'accepter',
    })
  })

  it('pays it back on the next twelve 1sts, as its loanSchedule() has it, which closes it', () => {
    const { payments } = loanSchedule(TAKEN.principal, 1800, 12)
    const interest = entriesOfMemo(PAID.journal, `Intérêts · ${LENDER}`)
    const principal = entriesOfMemo(PAID.journal, `Remboursement · ${LENDER}`)
    expect(interest).toHaveLength(12)
    expect(principal).toHaveLength(12)
    payments.forEach((payment, index) => {
      const day = interest[index]?.day ?? -1
      expect(toCalendar(day).dayOfMonth).toBe(1)
      expect(monthsSinceStart(day) - monthsSinceStart(60)).toBe(index + 1)
      expect(interest[index]).toEqual(
        entry(day, `Intérêts · ${LENDER}`, '7000', '1000', payment.interest),
      )
      expect(principal[index]).toEqual(
        entry(
          day,
          `Remboursement · ${LENDER}`,
          '2500',
          '1000',
          payment.principal,
        ),
      )
    })
    // The first on July 1st, the day after, the last on June 1st of year 2.
    expect(interest.map(({ day }) => day)).toEqual([
      61, 92, 123, 153, 184, 214, 245, 276, 304, 335, 365, 396,
    ])
    expect(isLoanOpen(TAKEN, 396)).toBe(true)
    expect(isLoanOpen(TAKEN, 397)).toBe(false)
    // Emprunts bancaires holds the startup loan alone again.
    expect(balance(PAID.journal, '2500', { toDay: 399 })).toBe(
      balance(REFUSED.journal, '2500', { toDay: 399 }),
    )
  })

  it('shows the loan in financing, the fee in Autres charges and the interest in Intérêts payés', () => {
    const july = cashFlowStatement(PAID.journal, 60, 61)
    const row = (lines: { label: string; amount: number }[], label: string) =>
      lines.find((line) => line.label === label)?.amount
    const { payments } = loanSchedule(TAKEN.principal, 1800, 12)
    const [first] = payments
    expect(row([...july.financing.lines], 'Emprunts bancaires')).toBe(
      TAKEN.principal - (first?.principal ?? 0) - startupPrincipal(61),
    )
    expect(row([...july.operating.lines], 'Intérêts payés')).toBe(
      -(first?.interest ?? 0) - startupInterest(61),
    )
    const day60 = cashFlowStatement(LOANED.journal, 60, 60)
    expect(row([...day60.operating.lines], 'Autres charges')).toBe(-TAKEN.fee)
  })

  it('saves and loads the game mid-loan, which then plays on the same', () => {
    for (const state of [MORNING_60, LOANED, playOn(LOANED, 100)]) {
      const back = deserialize(serialize(state))
      expect(back).toStrictEqual(state)
      expect(serialize(playOn(back, 20))).toBe(serialize(playOn(state, 20)))
    }
  })

  it('plays the same game twice', () => {
    const again = playOn(
      resolveEvent(
        next(bill(playOn(createInitialState(SEED), 59), 300_000)),
        'accepter',
        CARDS,
      ),
      340,
    )
    expect(serialize(again)).toBe(serialize(PAID))
  })
})

/** The startup loan's principal paid on `day`, a 1st, in the scripted game. */
function startupPrincipal(day: Day): number {
  return paidOn(day, "Remboursement de l'emprunt")
}

/** The startup loan's interest paid on `day`, a 1st, in the scripted game. */
function startupInterest(day: Day): number {
  return paidOn(day, "Intérêts sur l'emprunt")
}

function paidOn(day: Day, memo: string): number {
  return entriesOfMemo(PAID.journal, memo)
    .filter((paid) => paid.day === day)
    .reduce((total, { lines }) => total + (lines[0]?.debit ?? 0), 0)
}

/**
 * The morning of `day` in a game of `difficulty` whose Encaisse closed
 * below zero the day before, with `financing` as it stands otherwise, and
 * no event waiting.
 */
function brokeOn(
  day: Day,
  financing: Partial<FinancingState> = {},
  difficulty: DifficultyId = 'moyen',
): GameState {
  const opened = createInitialState(SEED, FOOD_TRUCK, {
    ...defaultProfile(),
    difficulty,
  })
  return {
    ...opened,
    day,
    financing: { ...noFinancing(), belowZeroSince: day - 1, ...financing },
  }
}

/** A loan of 5 000 $ taken on `day`, on the shipped terms. */
function loanOn(day: Day): EmergencyLoan {
  return {
    day,
    lender: LENDER,
    principal: cents(500_000),
    annualRateBasisPoints: 1800,
    termMonths: 12,
    fee: cents(10_000),
  }
}

/** A round of the shipped shares sold on `day`. */
function saleOn(day: Day, share = 0.2): ShareSale {
  return { day, investor: INVESTOR, amount: cents(2_000_000), share }
}

const pendingOf = (state: GameState) => state.events.pending?.event ?? null

describe('financingOffer', () => {
  it('brings nothing after a close at or above zero', () => {
    const state = brokeOn(100, { belowZeroSince: null })
    expect(financingOffer(state, CARDS)).toBe(state)
  })

  it('brings nothing while an event waits, or once one was chosen that morning', () => {
    const waiting = brokeOn(100)
    const busy: GameState = {
      ...waiting,
      events: {
        ...waiting.events,
        pending: { event: 'essai', followUp: false },
      },
    }
    expect(financingOffer(busy, CARDS)).toBe(busy)
    const chosen: GameState = {
      ...waiting,
      events: {
        ...waiting.events,
        history: [
          {
            day: 100,
            event: 'essai',
            followUp: false,
            choice: 'rienFaire',
            outcome: 0,
          },
        ],
      },
    }
    expect(financingOffer(chosen, CARDS)).toBe(chosen)
  })

  it('brings nothing from content without the cards, such as NO_EVENTS', () => {
    const state = brokeOn(100)
    expect(financingOffer(state, NO_EVENTS)).toBe(state)
    const lenderOnly: EventContent = {
      ...CARDS,
      events: CARDS.events.filter(({ id }) => id === 'pretUrgence'),
    }
    const refusing = brokeOn(500, { loans: [loanOn(400)] })
    expect(pendingOf(financingOffer(refusing, lenderOnly))).toBeNull()
  })

  it('brings Mme Prudhomme once a game year, on its first morning below zero, whatever the player answered', () => {
    const offered = financingOffer(brokeOn(100), CARDS)
    expect(pendingOf(offered)).toBe('pretUrgence')
    expect(offered.financing.lastLoanRequestDay).toBe(100)
    // Day 364 is the last of year 1, day 365 the first of year 2.
    const sameYear = brokeOn(364, { lastLoanRequestDay: 100 })
    expect(financingOffer(sameYear, CARDS)).toBe(sameYear)
    const nextYear = financingOffer(
      brokeOn(365, { lastLoanRequestDay: 100 }),
      CARDS,
    )
    expect(pendingOf(nextYear)).toBe('pretUrgence')
    expect(nextYear.financing.lastLoanRequestDay).toBe(365)
  })

  it('brings Max Duvent in her place while an emergency loan is still open', () => {
    const offered = financingOffer(
      brokeOn(400, { loans: [loanOn(300)], lastLoanRequestDay: 300 }),
      CARDS,
    )
    expect(pendingOf(offered)).toBe('offreDuvent')
    expect(offered.events.lastDrawnDay).toBe(400)
    expect(offered.financing.lastLoanRequestDay).toBe(400)
  })

  it('brings Mme Prudhomme again once the loan is paid back, but at Difficile only Max Duvent', () => {
    const paidBack = { loans: [loanOn(0)], lastLoanRequestDay: 0 }
    expect(pendingOf(financingOffer(brokeOn(400, paidBack), CARDS))).toBe(
      'pretUrgence',
    )
    expect(
      pendingOf(financingOffer(brokeOn(400, paidBack, 'difficile'), CARDS)),
    ).toBe('offreDuvent')
    expect(
      pendingOf(financingOffer(brokeOn(400, {}, 'difficile'), CARDS)),
    ).toBe('pretUrgence')
  })

  it('brings Max Duvent 14 days after the loan if Encaisse is still below zero, and on no other day', () => {
    const after = { loans: [loanOn(100)], lastLoanRequestDay: 100 }
    expect(pendingOf(financingOffer(brokeOn(114, after), CARDS))).toBe(
      'offreDuvent',
    )
    for (const day of [113, 115]) {
      expect(pendingOf(financingOffer(brokeOn(day, after), CARDS))).toBeNull()
    }
    const recovered = brokeOn(114, { ...after, belowZeroSince: null })
    expect(financingOffer(recovered, CARDS)).toBe(recovered)
  })

  it('brings Max Duvent for two rounds at most', () => {
    const sold = { shareSales: [saleOn(50), saleOn(80)] }
    const refusing = brokeOn(400, {
      ...sold,
      loans: [loanOn(300)],
      lastLoanRequestDay: 300,
    })
    const visited = financingOffer(refusing, CARDS)
    expect(pendingOf(visited)).toBeNull()
    // She still came, and refused.
    expect(visited.financing.lastLoanRequestDay).toBe(400)
    const after = brokeOn(114, {
      ...sold,
      loans: [loanOn(100)],
      lastLoanRequestDay: 100,
    })
    expect(financingOffer(after, CARDS)).toBe(after)
  })

  it('follows the rules it is given', () => {
    const rules = loadFinancingContent({
      ...financingJson,
      investorDaysAfterLoan: 7,
      maxShareRounds: 1,
      noSecondLoanAt: ['facile', 'moyen', 'difficile'],
    })
    const after = { loans: [loanOn(100)], lastLoanRequestDay: 100 }
    expect(pendingOf(financingOffer(brokeOn(107, after), CARDS, rules))).toBe(
      'offreDuvent',
    )
    const paidBack = { loans: [loanOn(0)], lastLoanRequestDay: 0 }
    expect(
      pendingOf(financingOffer(brokeOn(400, paidBack), CARDS, rules)),
    ).toBe('offreDuvent')
    expect(
      pendingOf(
        financingOffer(
          brokeOn(400, { ...paidBack, shareSales: [saleOn(50)] }),
          CARDS,
          rules,
        ),
      ),
    ).toBeNull()
  })
})

describe('tick and the financing', () => {
  it('brings no financing card in a Défi, whose medals read the books as they are', () => {
    const defi = startChallenge('semaineDesMilleDollars', SEED)
    const morning = next(bill(defi, 300_000))
    expect(morning.financing.belowZeroSince).toBe(defi.day)
    expect(morning.events.pending).toBeNull()
    expect(morning.financing.lastLoanRequestDay).toBeNull()
  })

  it('brings the financing card before any draw, which waits for a later morning', () => {
    const everything = next(bill(MORNING_59, 300_000), EVENTS)
    expect(pendingOf(everything)).toBe('pretUrgence')
    expect(everything.rngState).toBe(MORNING_60.rngState)
  })

  it('never brings a card with no event content, and keeps the books as without the financing', () => {
    let state = bill(MORNING_59, 300_000)
    for (let day = 0; day < 40; day += 1) state = next(state, NO_EVENTS)
    expect(state.events.history).toEqual([])
    expect(state.financing).toEqual({
      ...noFinancing(),
      belowZeroSince: state.financing.belowZeroSince,
    })
    expect(
      entriesOf(state.journal).some(({ memo }) => isFinancingMemo(memo)),
    ).toBe(false)
  })
})

describe('the closes below zero', () => {
  it('keep the first close below zero while they last, and forget it at a close at or above zero', () => {
    const below = closingFinancing(noFinancing(), 10, cents(-1))
    expect(below.belowZeroSince).toBe(10)
    expect(closingFinancing(below, 11, cents(-500)).belowZeroSince).toBe(10)
    expect(closingFinancing(below, 11, cents(0)).belowZeroSince).toBeNull()
    const untouched = noFinancing()
    expect(closingFinancing(untouched, 11, cents(5))).toBe(untouched)
  })

  it('are what the books give at every close of a game that goes below zero and back', () => {
    let state = MORNING_59
    for (let day = 59; day < 120; day += 1) {
      if (day === 59 || day === 90) state = bill(state, 100_000)
      if (state.events.pending !== null) {
        state = resolveEvent(state, 'refuser', CARDS)
      }
      state = next(state)
      expect(state.financing.belowZeroSince, `day ${day}`).toBe(
        belowZeroSinceOf(state.journal, 0, day),
      )
    }
  })

  it('read the books from the first close, and give null before it', () => {
    const books = [
      entry(0, 'Mise de fonds', '1000', '3000', 1_000),
      entry(2, 'Achat', '1200', '1000', 3_000),
      entry(5, 'Vente', '1000', '4000', 2_500),
    ].reduce((journal, posted) => postEntry(journal, posted), emptyJournal())
    expect(belowZeroSinceOf(books, 0, 1)).toBeNull()
    expect(belowZeroSinceOf(books, 0, 4)).toBe(2)
    expect(belowZeroSinceOf(books, 3, 4)).toBe(3)
    expect(belowZeroSinceOf(books, 0, 5)).toBeNull()
    expect(belowZeroSinceOf(books, 3, 2)).toBeNull()
  })
})

describe('takeEmergencyLoan', () => {
  /** The morning of day 100, with Encaisse at `cash`. */
  function withCash(cash: number, difficulty: DifficultyId = 'moyen') {
    const state = brokeOn(100, {}, difficulty)
    const opening = cashOn(state)
    return {
      ...state,
      journal: postEntry(
        state.journal,
        cash < opening
          ? entry(100, 'Dépense', '6900', '1000', opening - cash)
          : entry(100, 'Vente', '1000', '4000', cash - opening),
      ),
    }
  }
  const fixedOn = (state: GameState) =>
    monthlyFixedCosts(100, state.profile.difficulty, 0, FOOD_TRUCK)

  it('lends 15 000 $ at most, with the fee on that', () => {
    const state = withCash(-2_000_000)
    const taken = takeEmergencyLoan(state, LOAN, FOOD_TRUCK)
    expect(taken.financing.loans).toEqual([
      { ...loanOn(100), principal: 1_500_000, fee: 30_000 },
    ])
    expect(cashOn(taken)).toBe(-2_000_000 + 1_500_000 - 30_000)
  })

  it('lends nothing when Encaisse holds a month of fixed costs already', () => {
    const state = withCash(0)
    const rich = withCash(fixedOn(state))
    expect(takeEmergencyLoan(rich, LOAN, FOOD_TRUCK)).toBe(rich)
  })

  it('lends nothing while an emergency loan is still open, nor twice at Difficile', () => {
    const once = takeEmergencyLoan(withCash(-100_000), LOAN, FOOD_TRUCK)
    expect(once.financing.loans).toHaveLength(1)
    const again = takeEmergencyLoan(
      {
        ...once,
        journal: postEntry(
          once.journal,
          entry(100, 'Dépense', '6900', '1000', 10_000_000),
        ),
      },
      LOAN,
      FOOD_TRUCK,
    )
    expect(again.financing.loans).toHaveLength(1)
    expect(
      entriesOfMemo(again.journal, `Emprunt d'urgence · ${LENDER}`),
    ).toHaveLength(1)
    // Two monthly payments, the last on July 1st, day 61.
    const paidBackLoan = { ...loanOn(0), termMonths: 2 }
    const paidBack = {
      ...withCash(-100_000),
      financing: { ...noFinancing(), loans: [paidBackLoan] },
    }
    expect(mayLend(paidBack)).toBe(true)
    expect(
      takeEmergencyLoan(paidBack, LOAN, FOOD_TRUCK).financing.loans,
    ).toHaveLength(2)
    const difficile = {
      ...withCash(-100_000, 'difficile'),
      financing: { ...noFinancing(), loans: [paidBackLoan] },
    }
    expect(takeEmergencyLoan(difficile, LOAN, FOOD_TRUCK)).toBe(difficile)
  })

  it('counts the bakery in the fixed costs', () => {
    const state = withCash(0)
    const bakery = {
      ...state,
      bakery: {
        openedOnDay: 10,
        oven: 'louer' as const,
        closesAfterDay: null,
        ovenBoughtOnDay: null,
      },
    }
    const withBakery = takeEmergencyLoan(bakery, LOAN, FOOD_TRUCK)
    const without = takeEmergencyLoan(state, LOAN, FOOD_TRUCK)
    expect(withBakery.financing.loans[0]?.principal).toBeGreaterThan(
      without.financing.loans[0]?.principal ?? Infinity,
    )
  })
})

describe('sellShares', () => {
  const state = brokeOn(100)

  it('posts the shares sold to Capital-actions and keeps the sale', () => {
    const sold = sellShares(state, SHARES)
    expect(entriesSince(sold.journal, 100)).toEqual([
      entry(100, `Émission d'actions · ${INVESTOR}`, '1000', '3000', 2_000_000),
    ])
    expect(sold.financing.shareSales).toEqual([saleOn(100)])
  })

  it('sells two rounds at most, however often the effect runs', () => {
    let sold = state
    for (let round = 0; round < 4; round += 1) sold = sellShares(sold, SHARES)
    expect(sold.financing.shareSales).toHaveLength(2)
    expect(
      entriesOfMemo(sold.journal, `Émission d'actions · ${INVESTOR}`),
    ).toHaveLength(2)
    // The game it leaves saves and loads.
    const game = playOn(sellShares(sellShares(MORNING_60, SHARES), SHARES), 1)
    expect(deserialize(serialize(game))).toStrictEqual(game)
  })

  it.each([
    ['facile', 2_000_000],
    ['moyen', 2_200_000],
    ['difficile', 1_700_000],
  ] as const)(
    'takes the price of the card scaled at %s: %i',
    (difficulty, price) => {
      const offered: GameState = {
        ...brokeOn(100, {}, difficulty),
        events: {
          ...brokeOn(100).events,
          pending: { event: 'offreDuvent', followUp: false },
          lastDrawnDay: 100,
        },
      }
      const sold = resolveEvent(offered, 'accepter', CARDS)
      expect(sold.financing.shareSales).toEqual([
        { ...saleOn(100), amount: price },
      ])
    },
  )
})

describe('the dividends', () => {
  // Day 153 is October 1st of year 1, day 245 January 1st of year 2: the
  // fourth quarter runs from day 153 to day 244.
  const OCTOBER_1 = 153
  const JANUARY_1 = 245

  /** Books with `netIncome` earned on day `on`, after a sale on day 100. */
  function booksWith(...earned: [on: Day, netIncome: number][]): Journal {
    const entries = [
      entry(0, 'Mise de fonds', '1000', '3000', 1_000_000),
      entry(100, `Émission d'actions · ${INVESTOR}`, '1000', '3000', 2_000_000),
      ...earned.map(([on, amount]) =>
        amount >= 0
          ? entry(on, 'Ventes', '1000', '4000', amount)
          : entry(on, 'Dépense', '6900', '1000', -amount),
      ),
    ]
    return entries.reduce(
      (journal, posted) => postEntry(journal, posted),
      emptyJournal(),
    )
  }

  /** The dividends `financing` pays on `day`. */
  function paid(journal: Journal, shareSales: ShareSale[], day: Day) {
    return chargesOn(journal, { ...noFinancing(), shareSales }, day)
  }

  const dividend = (day: Day, amount: number) =>
    entry(day, `Dividende · ${INVESTOR}`, '3100', '1000', amount)

  it('pays 800 $ on a quarter with 4 000 $ of net income', () => {
    const journal = booksWith([160, 600_000], [170, -200_000])
    expect(
      incomeStatement(journal, OCTOBER_1, JANUARY_1 - 1).netIncome.amount,
    ).toBe(400_000)
    expect(paid(journal, [saleOn(100)], JANUARY_1)).toEqual([
      dividend(JANUARY_1, 80_000),
    ])
  })

  it('pays nothing on a quarter with a loss, nor on a 1st that starts no quarter', () => {
    const journal = booksWith([160, 100_000], [170, -200_000])
    expect(paid(journal, [saleOn(100)], JANUARY_1)).toEqual([])
    const profit = booksWith([160, 600_000])
    // November 1st, day 184, and the 2nd of January.
    expect(paid(profit, [saleOn(100)], 184)).toEqual([])
    expect(paid(profit, [saleOn(100)], JANUARY_1 + 1)).toEqual([])
  })

  it('pays 40 % after two rounds, in one entry', () => {
    const journal = booksWith([160, 400_000])
    expect(paid(journal, [saleOn(100), saleOn(120)], JANUARY_1)).toEqual([
      dividend(JANUARY_1, 160_000),
    ])
  })

  it('pays nothing on a sale made the morning of the 1st, and leaves the quarter before at 20 % when a second comes then', () => {
    const journal = booksWith([160, 400_000])
    expect(paid(journal, [saleOn(JANUARY_1)], JANUARY_1)).toEqual([])
    expect(paid(journal, [saleOn(100), saleOn(JANUARY_1)], JANUARY_1)).toEqual([
      dividend(JANUARY_1, 80_000),
    ])
    expect(dividendBase(journal, [saleOn(JANUARY_1)], JANUARY_1)).toBe(0)
    expect(
      dividendBase(journal, [saleOn(100), saleOn(JANUARY_1)], JANUARY_1),
    ).toBe(400_000)
  })

  it('counts a first sale made during the quarter from its day only', () => {
    // A profit, then a loss, of 3 000 $ before the sale on day 200, and
    // 1 000 $ after it.
    for (const before of [300_000, -300_000]) {
      const journal = booksWith([160, before], [210, 100_000])
      expect(dividendBase(journal, [saleOn(200)], JANUARY_1)).toBe(100_000)
      expect(paid(journal, [saleOn(200)], JANUARY_1)).toEqual([
        dividend(JANUARY_1, 20_000),
      ])
    }
  })

  it('pays a second round sold during the quarter its 20 % of the whole quarter', () => {
    // 3 000 $ before the second sale on day 200, 1 000 $ after.
    const journal = booksWith([160, 300_000], [210, 100_000])
    expect(paid(journal, [saleOn(100), saleOn(200)], JANUARY_1)).toEqual([
      dividend(JANUARY_1, 160_000),
    ])
  })

  it('pays nothing on a quarter that lost money, even with a profit after a second round sold during it', () => {
    // 2 000 $ lost before the sale on day 200, 1 000 $ earned after.
    const lost = booksWith([170, -200_000], [210, 100_000])
    expect(
      incomeStatement(lost, OCTOBER_1, JANUARY_1 - 1).netIncome.amount,
    ).toBe(-100_000)
    expect(paid(lost, [saleOn(100), saleOn(200)], JANUARY_1)).toEqual([])
    // 500 $ lost before it, so 500 $ over the quarter: 40 % of it, not
    // 20 % of each round's own part.
    const earned = booksWith([170, -50_000], [210, 100_000])
    expect(paid(earned, [saleOn(100), saleOn(200)], JANUARY_1)).toEqual([
      dividend(JANUARY_1, 20_000),
    ])
  })

  it("never pays more than the rounds sold of the quarter's profit", () => {
    const earnings: [on: Day, netIncome: number][][] = [
      [[160, 600_000]],
      [
        [160, -400_000],
        [230, 500_000],
      ],
      [
        [160, 500_000],
        [230, -600_000],
      ],
      [
        [154, 10_001],
        [199, -3],
        [244, 7],
      ],
    ]
    for (const earned of earnings) {
      const journal = booksWith(...earned)
      const { netIncome } = incomeStatement(journal, OCTOBER_1, JANUARY_1 - 1)
      for (const sales of [
        [saleOn(100)],
        [saleOn(100), saleOn(200)],
        [saleOn(100), saleOn(244)],
      ]) {
        const total = paid(journal, sales, JANUARY_1).reduce(
          (sum, { lines }) => sum + (lines[0]?.debit ?? 0),
          0,
        )
        expect(total).toBe(
          sales.length * mulRatio(cents(Math.max(netIncome.amount, 0)), 0.2),
        )
      }
    }
  })

  it('pays each investor apart, in the order of their first sale', () => {
    const journal = booksWith([160, 400_000])
    const other: ShareSale = { ...saleOn(90), investor: 'Banque Essai' }
    expect(paid(journal, [other, saleOn(100)], JANUARY_1)).toEqual([
      entry(JANUARY_1, 'Dividende · Banque Essai', '3100', '1000', 80_000),
      dividend(JANUARY_1, 80_000),
    ])
  })

  it('go out each quarter of a game that sold shares, as « Dividendes versés »', () => {
    const offered: GameState = {
      ...MORNING_60,
      events: {
        ...MORNING_60.events,
        pending: { event: 'offreDuvent', followUp: false },
      },
    }
    const sold = resolveEvent(offered, 'accepter', CARDS)
    expect(sold.financing.shareSales).toEqual([
      { ...saleOn(60), amount: 2_200_000 },
    ])
    const game = playOn(sold, 200)
    const dividends = entriesOfMemo(game.journal, `Dividende · ${INVESTOR}`)
    const expected = [61, OCTOBER_1, JANUARY_1].flatMap((day) => {
      const amount = mulRatio(
        dividendBase(game.journal, [saleOn(60)], day),
        0.2,
      )
      return amount > 0 ? [dividend(day, amount)] : []
    })
    expect(expected.length).toBeGreaterThan(0)
    expect(dividends).toEqual(expected)
    const year = cashFlowStatement(game.journal, 60, 259)
    expect(
      year.financing.lines.find(({ label }) => label === 'Dividendes versés')
        ?.amount,
    ).toBe(
      -expected.reduce((total, { lines }) => total + (lines[0]?.debit ?? 0), 0),
    )
    expect(deserialize(serialize(game))).toStrictEqual(game)
  })

  it('pay nothing on a played quarter that lost money, the second round sold during it after the loss, and the game saves and loads', () => {
    const offered = (state: GameState): GameState => ({
      ...state,
      events: {
        ...state.events,
        pending: { event: 'offreDuvent', followUp: false },
      },
    })
    const first = resolveEvent(offered(MORNING_60), 'accepter', CARDS)
    // A bill of all the encaisse on day 199, then the second round on 200.
    const billed = playOn(bill(playOn(first, 139), 0), 1)
    const second = resolveEvent(offered(billed), 'accepter', CARDS)
    expect(second.financing.shareSales.map(({ day }) => day)).toEqual([60, 200])
    const game = playOn(second, 46)
    // The quarter lost money, though the days after the second round made
    // some: no dividend on January 1st.
    const quarter = (from: Day) =>
      incomeStatement(game.journal, from, JANUARY_1 - 1).netIncome.amount
    expect(quarter(OCTOBER_1)).toBeLessThan(0)
    expect(quarter(200)).toBeGreaterThan(0)
    expect(
      entriesOfMemo(game.journal, `Dividende · ${INVESTOR}`).filter(
        ({ day }) => day === JANUARY_1,
      ),
    ).toEqual([])
    expect(deserialize(serialize(game))).toStrictEqual(game)
  })
})

describe('the memos', () => {
  it('name the lender or the investor', () => {
    expect(financingMemo(FINANCING_MEMO.dividend, INVESTOR)).toBe(
      'Dividende · Duvent Capital',
    )
    expect(isFinancingMemo(`Intérêts · ${LENDER}`)).toBe(true)
    expect(isFinancingMemo("Intérêts sur l'emprunt")).toBe(false)
    expect(isFinancingMemo('Salaire · Amélie Gagnon')).toBe(false)
  })
})

describe('the shipped rules', () => {
  it('are those Étienne decided on October 16, 2026', () => {
    expect(FINANCING).toEqual({
      _note: expect.any(String),
      loanEvent: 'pretUrgence',
      investorEvent: 'offreDuvent',
      appointmentEvent: 'rendezVousCaisse',
      investorDaysAfterLoan: 14,
      maxShareRounds: 2,
      noSecondLoanAt: ['difficile'],
      bankruptcy: {
        months: 6,
        notices: [
          { afterMonths: 1, event: 'premierAvis' },
          { afterMonths: 3, event: 'deuxiemeAvis' },
          { afterMonths: 5, event: 'dernierAvis' },
        ],
      },
    })
    expect(LOAN).toEqual({
      kind: 'emergencyLoan',
      lender: LENDER,
      monthsOfFixedCosts: 1,
      maxCents: 1_500_000,
      annualRateBasisPoints: 1800,
      termMonths: 12,
      feeShare: 0.02,
    })
    expect(SHARES).toEqual({
      kind: 'shareSale',
      investor: INVESTOR,
      amountCents: 2_000_000,
      share: 0.2,
    })
  })
})
