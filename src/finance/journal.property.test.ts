import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { cents } from '../engine/money.ts'
import { ACCOUNTS, getAccount, type AccountCode } from './accounts.ts'
import {
  balance,
  emptyJournal,
  postEntry,
  trialBalance,
  type JournalEntry,
  type JournalLine,
} from './journal.ts'

// Bounds keep every run small: at most MAX_ENTRIES entries, MAX_GAP days
// apart, so the checks below that walk every day stay cheap. Amounts stay far
// enough below the safe integer range that no total can leave it.
const MAX_ENTRIES = 30
const MAX_GAP = 3
const MAX_MOVEMENTS = 5
const MAX_AMOUNT = 10_000_000_000
const NUM_RUNS = 200

const CODES = ACCOUNTS.map(({ code }) => code)

// An entry is a list of movements, each debiting one account and crediting
// another (possibly the same one) by the same amount, so it balances by
// construction. Days only go up, by gaps of zero or more.
const movement = fc.record({
  debit: fc.constantFrom(...CODES),
  credit: fc.constantFrom(...CODES),
  amount: fc.integer({ min: 1, max: MAX_AMOUNT }),
})
const draft = fc.record({
  gap: fc.integer({ min: 0, max: MAX_GAP }),
  movements: fc.array(movement, { minLength: 1, maxLength: MAX_MOVEMENTS }),
})
const drafts = fc.array(draft, { maxLength: MAX_ENTRIES })

type Draft = typeof draft extends fc.Arbitrary<infer T> ? T : never

function toEntries(list: readonly Draft[], startDay = 0): JournalEntry[] {
  let day = startDay
  return list.map(({ gap, movements }, index) => {
    day += gap
    const lines = movements.flatMap(({ debit, credit, amount }) => [
      { account: debit, debit: cents(amount), credit: cents(0) },
      { account: credit, debit: cents(0), credit: cents(amount) },
    ])
    return { day, memo: `Écriture ${index + 1}`, lines }
  })
}

function lastDay(entries: readonly JournalEntry[]): number {
  return entries.at(-1)?.day ?? 0
}

describe('journal properties', () => {
  it('keeps the trial balance at zero after any balanced entries', () => {
    fc.assert(
      fc.property(drafts, (list) => {
        const entries = toEntries(list)
        const journal = entries.reduce(postEntry, emptyJournal())
        expect(journal.entries).toEqual(entries)
        for (let day = -1; day <= lastDay(entries) + 1; day += 1) {
          const { totalDebit, totalCredit } = trialBalance(journal, day)
          expect(totalDebit).toBe(totalCredit)
        }
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('gives every account the balance a plain sum of its lines gives', () => {
    fc.assert(
      fc.property(
        drafts,
        fc.integer({ min: -1, max: MAX_ENTRIES * MAX_GAP + 1 }),
        (list, toDay) => {
          const entries = toEntries(list)
          const journal = entries.reduce(postEntry, emptyJournal())
          for (const code of CODES) {
            let net = 0
            for (const { day, lines } of entries) {
              if (day > toDay) continue
              for (const { account, debit, credit } of lines) {
                if (account === code) net += debit - credit
              }
            }
            const expected =
              getAccount(code).normalBalance === 'debit' ? net : 0 - net
            expect(balance(journal, code, { toDay })).toBe(expected)
          }
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it('rejects a balanced entry with any amount added to one line', () => {
    fc.assert(
      fc.property(
        drafts,
        draft,
        fc.nat(),
        fc.integer({ min: 1, max: MAX_AMOUNT }),
        (list, extra, pick, delta) => {
          const entries = toEntries(list)
          const journal = entries.reduce(postEntry, emptyJournal())
          const [balanced] = toEntries([extra], lastDay(entries))
          if (balanced === undefined) throw new Error('no entry drafted')

          const index = pick % balanced.lines.length
          const lines = balanced.lines.map((line, i): JournalLine => {
            if (i !== index) return line
            return line.debit > 0
              ? { ...line, debit: cents(line.debit + delta) }
              : { ...line, credit: cents(line.credit + delta) }
          })

          expect(() => postEntry(journal, { ...balanced, lines })).toThrow(
            /do not equal/,
          )
          expect(journal.entries).toEqual(entries)
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })
})

// Keeps the generators honest: they must reach the edge cases the properties
// rely on, or a passing run proves less than it seems.
describe('journal property generators', () => {
  it('draw empty sequences, same-day entries and every account', () => {
    const samples = fc.sample(drafts, { numRuns: 500, seed: 42 })
    expect(samples.some((list) => list.length === 0)).toBe(true)
    expect(
      samples.some((list) => list.slice(1).some(({ gap }) => gap === 0)),
    ).toBe(true)
    const seen = new Set<AccountCode>()
    for (const list of samples) {
      for (const { movements } of list) {
        for (const { debit, credit } of movements) seen.add(debit).add(credit)
      }
    }
    expect([...seen].sort()).toEqual([...CODES].sort())
  })
})
