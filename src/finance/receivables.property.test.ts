import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { cents } from '../engine/money.ts'
import type { Day } from '../engine/types.ts'
import { emptyJournal, postEntry, type Journal } from './journal.ts'
import { badDebt, collection, creditSale } from './receivables.ts'
import {
  balanceSheet,
  cashFlowStatement,
  incomeStatement,
  type StatementLine,
} from './statements.ts'

// Bounds keep every run small, as in statements.property.test.ts: at most
// MAX_OPERATIONS operations, MAX_GAP days apart, so the checks below that
// walk every day stay cheap. Amounts stay far enough below the safe integer
// range that no total can leave it.
const MAX_OPERATIONS = 30
const MAX_GAP = 3
const MAX_AMOUNT = 10_000_000_000
const NUM_RUNS = 200

const CLIENTS = ['Hôtel du Vieux-Port', 'Épicerie Tremblay', 'Traiteur Côté']

const KINDS = ['sale', 'collection', 'writeOff'] as const
type Kind = (typeof KINDS)[number]

const BUILD = { sale: creditSale, collection, writeOff: badDebt } as const

// A collection or a write-off takes the amount drawn, or what the client
// owes if that is less, so it often settles the whole debt and often only
// part of it.
const operation = fc.record({
  gap: fc.integer({ min: 0, max: MAX_GAP }),
  kind: fc.constantFrom(...KINDS),
  client: fc.constantFrom(...CLIENTS),
  amount: fc.integer({ min: 1, max: MAX_AMOUNT }),
})
const operations = fc.array(operation, { maxLength: MAX_OPERATIONS })

type Operation = typeof operation extends fc.Arbitrary<infer T> ? T : never

interface Posted {
  readonly day: Day
  readonly kind: Kind
  readonly amount: number
  /** What the client owes after this operation. */
  readonly owed: number
}

/**
 * The books, and each operation as posted, by a model of what each client
 * owes kept apart from the journal. A collection or a write-off for a client
 * who owes nothing is skipped.
 */
function toBooks(list: readonly Operation[]): {
  journal: Journal
  posted: Posted[]
} {
  const owed = new Map<string, number>()
  const posted: Posted[] = []
  let journal = emptyJournal()
  let day = 0
  for (const { gap, kind, client, amount } of list) {
    day += gap
    const due = owed.get(client) ?? 0
    if (kind !== 'sale' && due === 0) continue
    const moved = kind === 'sale' ? amount : Math.min(amount, due)
    const left = kind === 'sale' ? due + moved : due - moved
    owed.set(client, left)
    journal = postEntry(journal, BUILD[kind](day, client, cents(moved)))
    posted.push({ day, kind, amount: moved, owed: left })
  }
  return { journal, posted }
}

function total(
  posted: readonly Posted[],
  kind: Kind,
  toDay: Day = Infinity,
): number {
  return posted
    .filter((one) => one.kind === kind && one.day <= toDay)
    .reduce((sum, { amount }) => sum + amount, 0)
}

/** The amount on the row with `label` in one section of a statement. */
function amountIn(lines: readonly StatementLine[], label: string): number {
  const found = lines.filter((line) => line.label === label)
  expect(found).toHaveLength(1)
  return found[0]?.amount ?? NaN
}

describe('receivable properties', () => {
  it('keep the bilan balanced and Comptes clients at what is owed, never below zero, on every day', () => {
    fc.assert(
      fc.property(operations, (list) => {
        const { journal, posted } = toBooks(list)
        const last = posted.at(-1)?.day ?? 0
        for (let atDay = -1; atDay <= last + 1; atDay++) {
          const { assets, totalLiabilitiesAndEquity } = balanceSheet(
            journal,
            atDay,
          )
          expect(assets.total.amount).toBe(totalLiabilitiesAndEquity.amount)
          const receivable = amountIn(assets.current.lines, 'Comptes clients')
          expect(receivable).toBeGreaterThanOrEqual(0)
          expect(receivable).toBe(
            total(posted, 'sale', atDay) -
              total(posted, 'collection', atDay) -
              total(posted, 'writeOff', atDay),
          )
          expect(amountIn(assets.current.lines, 'Encaisse')).toBe(
            total(posted, 'collection', atDay),
          )
        }
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('show the sales, the write-offs and the cash collected over the whole period', () => {
    fc.assert(
      fc.property(operations, (list) => {
        const { journal, posted } = toBooks(list)
        const last = posted.at(-1)?.day ?? 0
        const income = incomeStatement(journal, 0, last)
        expect(income.sales.amount).toBe(total(posted, 'sale'))
        expect(amountIn(income.expenses.lines, 'Créances irrécouvrables')).toBe(
          total(posted, 'writeOff'),
        )
        const cash = cashFlowStatement(journal, 0, last)
        expect(
          amountIn(cash.operating.lines, 'Encaissements des clients'),
        ).toBe(total(posted, 'collection'))
        expect(cash.netChange.amount).toBe(total(posted, 'collection'))
      }),
      { numRuns: NUM_RUNS },
    )
  })
})

// Keeps the generator honest: it must reach the cases the properties rely
// on, or a passing run proves less than it seems.
describe('receivable property generator', () => {
  const posted = fc
    .sample(operations, { numRuns: 500, seed: 42 })
    .flatMap((list) => toBooks(list).posted)
  const settled = posted.filter(({ kind }) => kind !== 'sale')

  it.each(['collection', 'writeOff'] as const)(
    'draws a %s that settles a whole debt and one that leaves some owing',
    (kind) => {
      const ofKind = settled.filter((one) => one.kind === kind)
      expect(ofKind.some(({ owed }) => owed === 0)).toBe(true)
      expect(ofKind.some(({ owed }) => owed > 0)).toBe(true)
    },
  )
})
