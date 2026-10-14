import { describe, expect, it } from 'vitest'
import { cents, type Cents } from '../engine/money.ts'
import type { Day } from '../engine/types.ts'
import { ACCOUNTS, type AccountCode } from './accounts.ts'
import {
  balance,
  emptyJournal,
  postEntry,
  trialBalance,
  type Journal,
  type JournalEntry,
  type JournalLine,
} from './journal.ts'

const MAX = Number.MAX_SAFE_INTEGER

function dr(account: AccountCode, amount: number): JournalLine {
  return { account, debit: cents(amount), credit: cents(0) }
}

function cr(account: AccountCode, amount: number): JournalLine {
  return { account, debit: cents(0), credit: cents(amount) }
}

/** A line that skips every type check, as untyped data could. */
function raw(account: string, debit: number, credit: number): JournalLine {
  return {
    account: account as AccountCode,
    debit: debit as Cents,
    credit: credit as Cents,
  }
}

/**
 * Lines set by index, as an engine filling slots would: every index left out
 * is a hole, with no cast needed.
 */
function byIndex(...slots: [number, JournalLine][]): JournalLine[] {
  const lines: JournalLine[] = []
  for (const [index, line] of slots) lines[index] = line
  return lines
}

function entry(day: Day, memo: string, ...lines: JournalLine[]): JournalEntry {
  return { day, memo, lines }
}

/** A balanced entry whose memo skips the type check, as untyped data could. */
function withMemo(memo: unknown): JournalEntry {
  return {
    ...entry(5, '', dr('1000', 100), cr('4000', 100)),
    memo,
  } as JournalEntry
}

function post(...entries: JournalEntry[]): Journal {
  return entries.reduce(postEntry, emptyJournal())
}

// A food truck's first days: the owner puts in capital, buys stock on
// credit, sells for cash, throws out spoiled food and depreciates the truck.
const FIRST_DAYS = [
  entry(0, 'Mise de fonds', dr('1000', 500_000), cr('3000', 500_000)),
  entry(1, 'Achat de stocks', dr('1200', 80_000), cr('2000', 80_000)),
  entry(
    2,
    'Ventes du jour',
    dr('1000', 30_000),
    cr('4000', 30_000),
    dr('5000', 12_000),
    cr('1200', 12_000),
  ),
  entry(3, 'Nourriture périmée', dr('5100', 3_000), cr('1200', 3_000)),
  entry(3, 'Amortissement du camion', dr('6400', 1_000), cr('1510', 1_000)),
]

describe('emptyJournal', () => {
  it('has no entries and is frozen', () => {
    const journal = emptyJournal()
    expect(journal.entries).toEqual([])
    expect(Object.isFrozen(journal)).toBe(true)
    expect(Object.isFrozen(journal.entries)).toBe(true)
  })
})

describe('postEntry', () => {
  it('returns a new journal with the entry and leaves the old one alone', () => {
    const before = emptyJournal()
    const sale = entry(0, 'Vente', dr('1000', 1_250), cr('4000', 1_250))
    const after = postEntry(before, sale)
    expect(after).not.toBe(before)
    expect(after.entries).toEqual([sale])
    expect(before.entries).toEqual([])
  })

  it('keeps entries in posting order, several per day included', () => {
    const journal = post(...FIRST_DAYS)
    expect(journal.entries).toEqual(FIRST_DAYS)
  })

  it('accepts a compound entry with several debits for one credit', () => {
    const payroll = entry(
      4,
      'Paie et essence',
      dr('6000', 40_000),
      dr('6200', 5_500),
      cr('1000', 45_500),
    )
    expect(post(payroll).entries).toEqual([payroll])
  })

  it('accepts the largest safe amount', () => {
    const big = entry(0, 'Mise de fonds', dr('1000', MAX), cr('3000', MAX))
    expect(post(big).entries).toEqual([big])
  })

  describe('rejects', () => {
    const base = post(entry(5, 'Vente', dr('1000', 100), cr('4000', 100)))
    const snapshot = structuredClone(base.entries)

    const cases: { when: string; entry: JournalEntry; error: RegExp }[] = [
      {
        when: 'an entry whose debits do not equal its credits',
        entry: entry(5, 'Vente', dr('1000', 100), cr('4000', 99)),
        error: /debits of 100 do not equal credits of 99/,
      },
      {
        when: 'an entry that only debits',
        entry: entry(5, 'Vente', dr('1000', 100)),
        error: /debits of 100 do not equal credits of 0/,
      },
      {
        when: 'an unknown account',
        entry: entry(5, 'Vente', raw('9999', 100, 0), cr('4000', 100)),
        error: /line 1: unknown account 9999/,
      },
      {
        when: 'a negative debit',
        entry: entry(5, 'Vente', raw('1000', -100, 0), raw('4000', 0, -100)),
        error: /line 1: negative amount -100/,
      },
      {
        when: 'a negative credit',
        entry: entry(5, 'Vente', dr('1000', 100), raw('4000', 0, -100)),
        error: /line 2: negative amount -100/,
      },
      {
        when: 'a fraction of a cent',
        entry: entry(5, 'Vente', raw('1000', 1.5, 0), raw('4000', 0, 1.5)),
        error: /line 1: not a whole number of cents: 1.5/,
      },
      {
        when: 'an amount that is not a number',
        entry: entry(5, 'Vente', raw('1000', NaN, 0), cr('4000', 100)),
        error: /line 1: not a whole number of cents: NaN/,
      },
      {
        when: 'an infinite amount',
        entry: entry(5, 'Vente', raw('1000', 0, Infinity), cr('4000', 100)),
        error: /line 1: not a whole number of cents: Infinity/,
      },
      {
        when: 'an amount past the safe integer range',
        entry: entry(5, 'Vente', raw('1000', MAX + 1, 0), cr('4000', 1)),
        error: /line 1: not a whole number of cents/,
      },
      {
        when: 'a line with both a debit and a credit',
        entry: entry(5, 'Vente', raw('1000', 100, 40), cr('4000', 60)),
        error: /line 1: both a debit and a credit/,
      },
      {
        when: 'a line with no amount',
        entry: entry(
          5,
          'Vente',
          dr('1000', 100),
          raw('1100', 0, 0),
          cr('4000', 100),
        ),
        error: /line 2: no amount/,
      },
      {
        when: 'an entry with no lines',
        entry: entry(5, 'Vente'),
        error: /it has no lines/,
      },
      {
        when: 'a hole between two lines',
        entry: {
          day: 5,
          memo: 'Vente',
          lines: byIndex([0, dr('1000', 100)], [2, cr('4000', 100)]),
        },
        error: /line 2: missing/,
      },
      {
        when: 'a hole before the first line',
        entry: {
          day: 5,
          memo: 'Vente',
          lines: byIndex([1, dr('1000', 100)], [2, cr('4000', 100)]),
        },
        error: /line 1: missing/,
      },
      {
        // Its length is not zero and its holes add up to nothing on each side.
        when: 'an entry whose lines are all holes',
        entry: { day: 5, memo: 'Vente', lines: new Array<JournalLine>(1) },
        error: /line 1: missing/,
      },
      {
        when: 'a null line',
        entry: {
          day: 5,
          memo: 'Vente',
          lines: [dr('1000', 100), null, cr('4000', 100)] as JournalLine[],
        },
        error: /line 2: missing/,
      },
      {
        when: 'an undefined line',
        entry: {
          day: 5,
          memo: 'Vente',
          lines: [dr('1000', 100), undefined, cr('4000', 100)] as JournalLine[],
        },
        error: /line 2: missing/,
      },
      {
        when: 'a day earlier than the last entry',
        entry: entry(4, 'Vente', dr('1000', 100), cr('4000', 100)),
        error: /the last entry is on day 5/,
      },
      ...[-1, 5.5, NaN, Infinity].map((day) => ({
        when: `day ${day}`,
        entry: entry(day, 'Vente', dr('1000', 100), cr('4000', 100)),
        error: /not a game day/,
      })),
      {
        // Unchecked float addition rounds both totals to 2^53, so they would
        // look equal.
        when: 'totals past the safe integer range',
        entry: entry(
          5,
          'Vente',
          dr('1000', MAX),
          dr('1100', 1),
          cr('4000', MAX),
          cr('2000', 2),
        ),
        error: /its total is out of range/,
      },
      // Only a string is safe to store: anything else is either kept by
      // reference, so later changes reach the frozen journal, or is not text.
      ...[
        { kind: 'an object', memo: { text: 'Vente' } },
        { kind: 'an array', memo: ['Vente'] },
        { kind: 'a String object', memo: new String('Vente') },
        { kind: 'a number', memo: 42 },
        { kind: 'a symbol', memo: Symbol('Vente') },
        { kind: 'null', memo: null },
        { kind: 'undefined', memo: undefined },
      ].map(({ kind, memo }) => ({
        when: `a memo that is ${kind}`,
        entry: withMemo(memo),
        error: /memo is not a string/,
      })),
    ]

    it.each(cases)('$when', ({ entry, error }) => {
      expect(() => postEntry(base, entry)).toThrow(error)
      expect(base.entries).toEqual(snapshot)
    })

    it('with a message naming the memo and the day', () => {
      const bad = entry(5, 'Achat de pains', dr('1200', 1), cr('2000', 2))
      expect(() => postEntry(base, bad)).toThrow(
        /^Cannot post "Achat de pains" on day 5: /,
      )
    })
  })

  it('freezes the journal, its entries and their lines', () => {
    const journal = post(...FIRST_DAYS)
    expect(Object.isFrozen(journal)).toBe(true)
    expect(Object.isFrozen(journal.entries)).toBe(true)
    for (const posted of journal.entries) {
      expect(Object.isFrozen(posted)).toBe(true)
      expect(Object.isFrozen(posted.lines)).toBe(true)
      for (const line of posted.lines) expect(Object.isFrozen(line)).toBe(true)
    }
    expect(() => {
      ;(journal.entries as JournalEntry[]).pop()
    }).toThrow(TypeError)
    expect(() => {
      ;(journal.entries[0]?.lines[0] as { debit: number }).debit = 1
    }).toThrow(TypeError)
    expect(journal.entries).toEqual(FIRST_DAYS)
  })

  it('keeps its own copy, so later changes to the entry do not reach it', () => {
    const line: { -readonly [K in keyof JournalLine]: JournalLine[K] } = {
      ...dr('1000', 100),
    }
    const lines = [line, cr('4000', 100)]
    const sale = { day: 0, memo: 'Vente', lines }
    const journal = postEntry(emptyJournal(), sale)

    line.debit = cents(1_000_000)
    lines.push(dr('6300', 5))
    sale.memo = 'Autre chose'
    sale.day = 99

    expect(journal.entries).toEqual([
      entry(0, 'Vente', dr('1000', 100), cr('4000', 100)),
    ])
    expect(Object.isFrozen(sale)).toBe(false)
  })

  it('stores only the known fields, with negative zero as zero', () => {
    const sale = {
      day: 0,
      memo: 'Vente',
      lines: [
        { ...raw('1000', 100, -0), note: 'caisse' },
        raw('4000', -0, 100),
      ],
      extra: true,
    }
    const [posted] = postEntry(emptyJournal(), sale).entries
    expect(Object.keys(posted ?? {})).toEqual(['day', 'memo', 'lines'])
    expect(Object.keys(posted?.lines[0] ?? {})).toEqual([
      'account',
      'debit',
      'credit',
    ])
    expect(Object.is(posted?.lines[0]?.credit, 0)).toBe(true)
    expect(Object.is(posted?.lines[1]?.debit, 0)).toBe(true)
  })
})

describe('balance', () => {
  const journal = post(...FIRST_DAYS)

  it.each([
    { account: '1000', name: 'Encaisse', expected: 530_000 },
    { account: '1200', name: 'Stocks', expected: 65_000 },
    { account: '1510', name: 'Amortissement cumulé', expected: 1_000 },
    { account: '2000', name: 'Comptes fournisseurs', expected: 80_000 },
    { account: '3000', name: 'Capital-actions', expected: 500_000 },
    { account: '4000', name: 'Ventes', expected: 30_000 },
    {
      account: '5000',
      name: 'Coût des marchandises vendues',
      expected: 12_000,
    },
    { account: '6000', name: 'Salaires', expected: 0 },
  ] as const)(
    'is positive on the normal side: $name',
    ({ account, expected }) => {
      expect(balance(journal, account, { toDay: 3 })).toBe(expected)
    },
  )

  it('only counts entries up to and including toDay', () => {
    expect(balance(journal, '1000', { toDay: 0 })).toBe(500_000)
    expect(balance(journal, '1000', { toDay: 1 })).toBe(500_000)
    expect(balance(journal, '1000', { toDay: 2 })).toBe(530_000)
    expect(balance(journal, '1200', { toDay: 2 })).toBe(68_000)
    expect(balance(journal, '4000', { toDay: 1 })).toBe(0)
    expect(balance(journal, '1000', { toDay: 1_000 })).toBe(530_000)
  })

  it('is zero before the first entry, negative days included', () => {
    const later = post(entry(10, 'Vente', dr('1000', 100), cr('4000', 100)))
    expect(balance(later, '1000', { toDay: 9 })).toBe(0)
    expect(balance(journal, '1000', { toDay: -1 })).toBe(0)
    expect(balance(emptyJournal(), '1000', { toDay: 0 })).toBe(0)
  })

  it('goes negative when an account is on its other side', () => {
    const overdrawn = post(entry(0, 'Paie', dr('6000', 100), cr('1000', 100)))
    expect(balance(overdrawn, '1000', { toDay: 0 })).toBe(-100)
  })

  it.each([1.5, NaN, Infinity, -Infinity, MAX + 1])(
    'rejects toDay %s',
    (toDay) => {
      expect(() => balance(journal, '1000', { toDay })).toThrow(RangeError)
    },
  )

  it('throws when a balance leaves the safe integer range', () => {
    const rich = post(
      entry(0, 'Mise de fonds', dr('1000', MAX), cr('3000', MAX)),
      entry(1, 'Emprunt', dr('1000', 1), cr('2500', 1)),
    )
    expect(balance(rich, '1000', { toDay: 0 })).toBe(MAX)
    expect(() => balance(rich, '1000', { toDay: 1 })).toThrow(RangeError)
  })
})

describe('trialBalance', () => {
  function row(account: AccountCode, debit = 0, credit = 0) {
    return { account, debit, credit }
  }

  it('lists every account in chart order with both columns equal', () => {
    expect(trialBalance(post(...FIRST_DAYS), 3)).toEqual({
      lines: [
        row('1000', 530_000),
        row('1100'),
        row('1200', 65_000),
        row('1500'),
        row('1510', 0, 1_000),
        row('2000', 0, 80_000),
        row('2500'),
        row('3000', 0, 500_000),
        row('3100'),
        row('4000', 0, 30_000),
        row('5000', 12_000),
        row('5100', 3_000),
        row('6000'),
        row('6100'),
        row('6200'),
        row('6300'),
        row('6400', 1_000),
        row('7000'),
      ],
      totalDebit: 611_000,
      totalCredit: 611_000,
    })
  })

  it('only counts entries up to and including toDay', () => {
    const { lines, totalDebit, totalCredit } = trialBalance(
      post(...FIRST_DAYS),
      1,
    )
    expect(lines.filter(({ debit, credit }) => debit + credit > 0)).toEqual([
      row('1000', 500_000),
      row('1200', 80_000),
      row('2000', 0, 80_000),
      row('3000', 0, 500_000),
    ])
    expect([totalDebit, totalCredit]).toEqual([580_000, 580_000])
  })

  it('is all zeros for an empty journal or a day before the first entry', () => {
    const zeros = {
      lines: ACCOUNTS.map(({ code }) => row(code)),
      totalDebit: 0,
      totalCredit: 0,
    }
    expect(trialBalance(emptyJournal(), 0)).toEqual(zeros)
    expect(trialBalance(post(...FIRST_DAYS), -1)).toEqual(zeros)
  })

  it('puts an overdrawn Encaisse in the credit column', () => {
    const overdrawn = post(entry(0, 'Paie', dr('6000', 100), cr('1000', 100)))
    const { lines } = trialBalance(overdrawn, 0)
    expect(lines.find(({ account }) => account === '1000')).toEqual(
      row('1000', 0, 100),
    )
    expect(lines.find(({ account }) => account === '6000')).toEqual(
      row('6000', 100),
    )
  })

  it('is frozen', () => {
    const result = trialBalance(post(...FIRST_DAYS), 3)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.lines)).toBe(true)
    for (const line of result.lines) expect(Object.isFrozen(line)).toBe(true)
  })

  it.each([1.5, NaN, Infinity])('rejects toDay %s', (toDay) => {
    expect(() => trialBalance(emptyJournal(), toDay)).toThrow(RangeError)
  })

  it('throws when a column total leaves the safe integer range', () => {
    // Each balance is in range, but the debit column adds up to MAX + 1.
    const rich = post(
      entry(0, 'Mise de fonds', dr('1000', MAX), cr('3000', MAX)),
      entry(0, 'Emprunt', dr('1200', 1), cr('2500', 1)),
    )
    expect(balance(rich, '1000', { toDay: 0 })).toBe(MAX)
    expect(balance(rich, '1200', { toDay: 0 })).toBe(1)
    expect(() => trialBalance(rich, 0)).toThrow(RangeError)
  })

  it('throws when a balance leaves the safe integer range', () => {
    const rich = post(
      entry(0, 'Mise de fonds', dr('1000', MAX), cr('3000', MAX)),
      entry(1, 'Emprunt', dr('1000', 1), cr('2500', 1)),
    )
    expect(() => trialBalance(rich, 1)).toThrow(RangeError)
  })
})
