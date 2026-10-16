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

// Cash balances as close to the edge of the safe integer range as a journal
// can take them without leaving it, so that working a balance back from a
// later one goes past the edge unless it retraces the entries' running
// balances. Each entry moves the cash to one level after another.
const EDGE = Number.MAX_SAFE_INTEGER
const level = fc.oneof(
  fc.constantFrom(-EDGE, -EDGE + 1, -1, 0, 1, EDGE - 1, EDGE),
  fc.integer({ min: -EDGE, max: EDGE }),
)
const swing = fc.record({
  gap: fc.integer({ min: 0, max: MAX_GAP }),
  levels: fc.array(level, { minLength: 1, maxLength: MAX_MOVEMENTS }),
})
const swings = fc.array(swing, { maxLength: MAX_ENTRIES })

type Swing = typeof swing extends fc.Arbitrary<infer T> ? T : never

/**
 * Entries that move the cash to each level in turn, through zero when the
 * step is too large for one line, with the capital lines after the cash
 * ones so its balance takes the same path, negated. A move that would take
 * an entry's debits past the safe integer range goes in another entry on
 * the same day. A swing that leaves the cash where it is posts nothing.
 */
function toSwings(list: readonly Swing[]): JournalEntry[] {
  let day = 0
  let cash = 0
  const entries: JournalEntry[] = []
  let moves: number[] = []
  let debits = 0
  function close(): void {
    if (moves.length === 0) return
    const lines = [
      ...moves.map((move) => line('1000', move)),
      ...moves.map((move) => line('3000', -move)),
    ]
    entries.push({ day, memo: `Écriture ${entries.length + 1}`, lines })
    moves = []
    debits = 0
  }
  for (const { gap, levels } of list) {
    day += gap
    for (const target of levels) {
      if (target === cash) continue
      const steps =
        Math.abs(target - cash) <= EDGE ? [target - cash] : [-cash, target]
      for (const move of steps) {
        if (debits + Math.abs(move) > EDGE) close()
        moves.push(move)
        debits += Math.abs(move)
      }
      cash = target
    }
    close()
  }
  return entries
}

/** A debit of `net` to the account, or a credit when it is negative. */
function line(account: AccountCode, net: number): JournalLine {
  return net > 0
    ? { account, debit: cents(net), credit: cents(0) }
    : { account, debit: cents(0), credit: cents(-net) }
}

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

  it('gives every balance a plain sum gives, near the edge of the safe integer range', () => {
    fc.assert(
      fc.property(swings, (list) => {
        const entries = toSwings(list)
        const journal = entries.reduce(postEntry, emptyJournal())
        for (let toDay = -1; toDay <= lastDay(entries) + 1; toDay += 1) {
          let cash = 0
          for (const { day, lines } of entries) {
            if (day > toDay) break
            for (const { account, debit, credit } of lines) {
              if (account === '1000') cash += debit - credit
            }
          }
          expect(balance(journal, '1000', { toDay })).toBe(cash)
          expect(balance(journal, '3000', { toDay })).toBe(cash)
        }
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('keeps each journal its own entries when an earlier one is posted to again', () => {
    fc.assert(
      fc.property(drafts, drafts, fc.nat(), (list, other, pick) => {
        const entries = toEntries(list)
        const journals = entries.reduce(
          (made, posted) => [
            ...made,
            postEntry(made.at(-1) ?? emptyJournal(), posted),
          ],
          [emptyJournal()],
        )
        const at = pick % journals.length
        const from = journals[at] ?? emptyJournal()
        const added = toEntries(other, lastDay(entries.slice(0, at)))
        const branch = added.reduce(postEntry, from)

        const kept = entries.slice(0, at)
        expect(branch.entries).toEqual([...kept, ...added])
        journals.forEach((journal, count) => {
          expect(journal.entries).toEqual(entries.slice(0, count))
        })
        for (const code of CODES) {
          const sum = (posted: readonly JournalEntry[]) =>
            posted
              .flatMap(({ lines }) => lines)
              .filter(({ account }) => account === code)
              .reduce((net, { debit, credit }) => net + debit - credit, 0)
          const toDay = lastDay(added) + lastDay(entries)
          const sign = getAccount(code).normalBalance === 'debit' ? 1 : -1
          expect(balance(branch, code, { toDay })).toBe(
            sign * sum([...kept, ...added]) + 0,
          )
          expect(balance(journals.at(-1) ?? from, code, { toDay })).toBe(
            sign * sum(entries) + 0,
          )
        }
      }),
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

  it('take the cash to both edges of the safe integer range, within an entry too', () => {
    const samples = fc.sample(swings, { numRuns: 500, seed: 42 })
    const reached = new Set<number>()
    let movedTwice = false
    for (const list of samples) {
      let cash = 0
      for (const { lines } of toSwings(list)) {
        const moves = lines.filter(({ account }) => account === '1000')
        if (moves.length > 1) movedTwice = true
        for (const { debit, credit } of moves) {
          cash += debit - credit
          reached.add(cash)
        }
      }
    }
    expect(reached.has(EDGE)).toBe(true)
    expect(reached.has(-EDGE)).toBe(true)
    expect(movedTwice).toBe(true)
  })
})
