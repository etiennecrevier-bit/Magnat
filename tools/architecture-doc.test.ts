import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  difficultyIdSchema,
  loadCustomerContent,
  loadFoodTruckContent,
} from '../src/content/schema.ts'
import { BAKERY, bakeryMorning, closedBakery } from '../src/engine/bakery.ts'
import { toCalendar } from '../src/engine/calendar.ts'
import { createInitialState, tick } from '../src/engine/clock.ts'
import { deliverContracts, GROCERS } from '../src/engine/contracts.ts'
import { SEGMENTS } from '../src/engine/customers.ts'
import {
  DIFFICULTIES as DIFFICULTY_CONTENT,
  EVENTS,
  FOOD_TRUCK,
  openingJournal,
} from '../src/engine/day.ts'
import { resolveEvent } from '../src/engine/events.ts'
import { PRODUCTS } from '../src/engine/inventory.ts'
import { defaultProfile } from '../src/engine/profile.ts'
import type { GameState } from '../src/engine/types.ts'
import type { AccountCode } from '../src/finance/accounts.ts'
import { emptyJournal, type JournalEntry } from '../src/finance/journal.ts'

// Keeps docs/architecture.md in step with the code it describes: the frozen
// header of src/engine/types.ts, a heading for each type it exports and a
// table row for each field, every repo path the page cites, the entries the
// books open with, the order in which tick() posts a day's entries, and the
// phase-4 rules it states: Max Duvent's price, which accounts only the cards
// post to, and what a grocer's « Refuser » does.

const root = fileURLToPath(new URL('..', import.meta.url))
const DOC = 'docs/architecture.md'
const TYPES = 'src/engine/types.ts'
const FROZEN =
  '// Frozen at the end of phase 1. Changing this file needs a dedicated card.'

const SHAPE = '## The shape of `GameState`'
const ORDER = '## Order of operations in `tick()`'
const GROCER_CONTRACTS = "## The grocers' contracts"
const FINANCING = '## The emergency loan and the share sale'
const ENTRIES = '## How journal entries are created'
const INVESTOR_EVENT = 'offreDuvent'
const SHARE_CAPITAL: AccountCode = '3000'
/** The accounts the page says the game posts to only through the cards. */
const ONLY_THE_CARDS = /posts to ([^.]*?) only through the event cards/
const DIGITS_PER_GROUP = /\B(?=(\d{3})+(?!\d))/g

/** Text in single asterisks, which the page uses for journal memos. */
const ITALIC = /(?<!\*)\*([^*\n]+)\*(?!\*)/g
/** A repo path in a code span, such as `src/engine/day.ts`. */
const REPO_PATH = /`((?:src|tests|tools|docs)\/[^`\s]*)`/g

// Content under which every step of an open day posts its entry every day:
// the truck opens every day and spends on marketing, and each product is
// bought daily, far more than a day's customers want, and spoils at its
// first close. The 1st of the month, payday and the loan's first payment, a
// month in, come within the days played. The seed, the customers and the
// days are fixed, so the run is too.
const CROWD = {
  name: 'Test',
  segmentShares: Object.fromEntries(
    SEGMENTS.map((segment) => [segment, 1 / SEGMENTS.length]),
  ),
  productAppeal: Object.fromEntries(PRODUCTS.map((product) => [product, 1])),
  patienceMultiplier: 1,
  arrivalWeights: [1, 1, 1, 1],
}
const EVERY_ENTRY = loadFoodTruckContent({
  products: Object.fromEntries(
    PRODUCTS.map((product) => [
      product,
      {
        name: product,
        unitCostCents: 100,
        packagingCents: 10,
        shelfLifeDays: 1,
      },
    ]),
  ),
  // The shipped truck, so Moyen's loan pays for part of it.
  truck: FOOD_TRUCK.truck,
  monthlyCostsCents: { permitParkingAndCommissary: 150_000, insurance: 25_000 },
  fuelAndMaintenancePerOpenDayCents: 2_000,
  cardPayments: { share: 0.85, feeRate: 0.025 },
  ownerPayWeekday: 5,
  walkIns: {
    noiseStdDevRatio: 0.1,
    opensAtMinute: 420,
    closesAtMinute: 900,
    arrivalSlotMinutes: 120,
    dayTypes: {
      semaine: { ...CROWD, customers: 50 },
      finDeSemaine: { ...CROWD, customers: 40 },
    },
  },
  service: FOOD_TRUCK.service,
  marketing: FOOD_TRUCK.marketing,
  startingDecisions: {
    pricesCents: Object.fromEntries(PRODUCTS.map((product) => [product, 300])),
    restock: Object.fromEntries(
      PRODUCTS.map((product) => [product, { kind: 'buyDaily', quantity: 500 }]),
    ),
    daysOpen: [1, 2, 3, 4, 5, 6, 7],
    ownerWeeklyPayCents: 70_000,
    marketingDailyCents: 1_000,
  },
  decisionLimits: FOOD_TRUCK.decisionLimits,
})
// Every segment pays 300 ¢ as its reference, so each wants each product with
// a chance of one half.
const EVERY_CUSTOMER = loadCustomerContent({
  segments: Object.fromEntries(
    SEGMENTS.map((segment) => [
      segment,
      {
        name: segment,
        patienceMinutes: 5,
        products: Object.fromEntries(
          PRODUCTS.map((product) => [
            product,
            {
              referencePriceCents: 300,
              purchaseProbability: 0.5,
              sensitivity: 4,
            },
          ]),
        ),
      },
    ]),
  ),
})
const SEED = 42
/** Five weeks from May 1st, so weekdays, weekends and June 1st all play. */
const DAYS = 35
const DIFFICULTIES = difficultyIdSchema.options

const doc = readFileSync(resolve(root, DOC), 'utf8')

/**
 * The lines under the first heading `matches` accepts, up to the next heading
 * of the same level or above; null when no heading matches.
 */
function section(
  markdown: string,
  matches: (heading: string) => boolean,
): string | null {
  const lines = markdown.split('\n')
  const start = lines.findIndex((line) => /^#+ /.test(line) && matches(line))
  if (start === -1) return null
  const level = (lines[start] ?? '').indexOf(' ')
  const end = lines.findIndex(
    (line, index) =>
      index > start && /^#+ /.test(line) && line.indexOf(' ') <= level,
  )
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n')
}

/** Whole dollars as the page writes them: `30 000 $`. */
function dollars(amount: number): string {
  return `${String(amount / 100).replace(DIGITS_PER_GROUP, ' ')} $`
}

/** The page's bullet that starts with `name` in a code span. */
function bullet(markdown: string, name: string): string {
  return (
    markdown.split('\n').find((line) => line.startsWith(`- \`${name}\``)) ?? ''
  )
}

/** `state` with `event` waiting for the player's choice. */
function waiting(state: GameState, event: string): GameState {
  return {
    ...state,
    events: { ...state.events, pending: { event, followUp: false } },
  }
}

/** The accounts `entries` post to. */
function accountsOf(entries: readonly JournalEntry[]): Set<AccountCode> {
  return new Set(entries.flatMap(({ lines }) => lines.map((l) => l.account)))
}

function italics(markdown: string): string[] {
  return [...markdown.matchAll(ITALIC)].map(([, text]) => text ?? '')
}

interface ExportedType {
  name: string
  /** Field names, for an interface; empty for a type alias. */
  fields: string[]
}

/** Every exported declaration of types.ts, or null where one is not a type. */
function exportedTypes(): (ExportedType | null)[] {
  const file = resolve(root, TYPES)
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
  )
  return source.statements
    .filter(
      (statement) =>
        ts.canHaveModifiers(statement) &&
        (ts.getModifiers(statement) ?? []).some(
          ({ kind }) => kind === ts.SyntaxKind.ExportKeyword,
        ),
    )
    .map((statement) => {
      if (ts.isTypeAliasDeclaration(statement)) {
        return { name: statement.name.text, fields: [] }
      }
      if (ts.isInterfaceDeclaration(statement)) {
        return {
          name: statement.name.text,
          fields: statement.members.map(
            (member) => member.name?.getText(source) ?? '',
          ),
        }
      }
      return null
    })
}

describe(TYPES, () => {
  it('starts with the frozen header', () => {
    const [first] = readFileSync(resolve(root, TYPES), 'utf8').split('\n')
    expect(first).toBe(FROZEN)
  })

  it('exports types only', () => {
    const types = exportedTypes()
    expect(types.length).toBeGreaterThan(0)
    expect(types).not.toContain(null)
  })
})

describe(DOC, () => {
  const shape = section(doc, (heading) => heading === SHAPE) ?? ''
  const order = section(doc, (heading) => heading === ORDER) ?? ''

  it('has the sections the checks below read', () => {
    expect(shape).not.toBe('')
    expect(order).not.toBe('')
  })

  describe.each(exportedTypes().filter((type) => type !== null))(
    'on $name',
    ({ name, fields }) => {
      const part = () =>
        section(
          shape,
          (heading) =>
            heading.startsWith('### ') && heading.includes(`\`${name}\``),
        )

      it('has a heading under the shape of GameState', () => {
        expect(part()).not.toBeNull()
      })

      it.each(fields)('has a table row for %s', (field) => {
        expect(part()).toMatch(new RegExp(`^\\| \`${field}\` \\|`, 'm'))
      })
    },
  )

  it.each(DIFFICULTIES)('names the entries a %s game opens with', (level) => {
    const memos = openingJournal(level).entries.map(({ memo }) => memo)
    expect(memos.length).toBeGreaterThan(0)
    expect(italics(shape)).toEqual(expect.arrayContaining(memos))
  })

  it('cites only paths that exist', () => {
    const paths = [...doc.matchAll(REPO_PATH)].map(([, path]) => path ?? '')
    expect(paths.length).toBeGreaterThan(0)
    expect(paths.filter((path) => !existsSync(resolve(root, path)))).toEqual([])
  })

  it("lists each day's entries in the order tick() posts them", () => {
    const documented = italics(order)
    expect(documented.length).toBeGreaterThan(0)
    expect(new Set(documented).size).toBe(documented.length)

    const posted = new Set<string>()
    for (const level of DIFFICULTIES) {
      let state = createInitialState(SEED, EVERY_ENTRY, {
        ...defaultProfile(),
        difficulty: level,
      })
      for (let day = 0; day < DAYS; day += 1) {
        const before = state.journal.entries.length
        state = tick(state, EVERY_ENTRY, EVERY_CUSTOMER)
        const memos = state.journal.entries
          .slice(before)
          .map(({ memo }) => memo)
        // The day's memos, each found later in the list than the one before.
        const places = memos.map((memo) => documented.indexOf(memo))
        expect(
          places.every((place, i) => place > (places[i - 1] ?? -1)),
          `day ${day} of a ${level} game: ${memos.join(', ')}`,
        ).toBe(true)
        for (const memo of memos) posted.add(memo)
      }
    }
    expect([...posted].sort()).toEqual([...documented].sort())
  })

  it('names the price Max Duvent pays at each difficulty', () => {
    const shareSale = bullet(
      section(doc, (heading) => heading === FINANCING) ?? '',
      'shareSale',
    )
    const prices = DIFFICULTIES.map((level) => {
      const state = waiting(
        createInitialState(SEED, FOOD_TRUCK, {
          ...defaultProfile(),
          difficulty: level,
        }),
        INVESTOR_EVENT,
      )
      const sold = resolveEvent(state, 'accepter')
      const raised = sold.journal.entries
        .slice(state.journal.entries.length)
        .flatMap(({ lines }) => lines)
        .filter(({ account }) => account === SHARE_CAPITAL)
        .reduce((sum, { credit }) => sum + credit, 0)
      expect(raised).toBeGreaterThan(0)
      return `${dollars(raised)} at ${DIFFICULTY_CONTENT.difficulties[level].name}`
    })
    expect(prices.filter((price) => !shareSale.includes(price))).toEqual([])
  })

  it('says only the cards post to an account only when no other entry does', () => {
    const claim = (section(doc, (heading) => heading === ENTRIES) ?? '').match(
      ONLY_THE_CARDS,
    )
    const onlyTheCards = new Set(claim?.[1]?.match(/\d{4}/g) ?? [])

    // A grocer's weekly delivery and the bakery's opening, neither a card.
    const signed = resolveEvent(
      waiting(createInitialState(SEED), 'contratNormand'),
      'accepter',
    )
    let monday = signed.day + 1
    while (toCalendar(monday).weekday !== GROCERS.deliveryWeekday) monday += 1
    const prices = DIFFICULTY_CONTENT.bakery[signed.profile.difficulty]
    const delivered = deliverContracts(
      { ...signed, day: monday },
      false,
      true,
      prices,
      FOOD_TRUCK,
      BAKERY,
    ).state
    expect(delivered.journal.entries.length).toBeGreaterThan(
      signed.journal.entries.length,
    )
    const opened = bakeryMorning(
      emptyJournal(),
      closedBakery(),
      { oven: 'louer' },
      monday,
      prices,
    ).journal
    const posted = accountsOf([
      ...delivered.journal.entries.slice(signed.journal.entries.length),
      ...opened.entries,
    ])
    expect([...posted].filter((account) => onlyTheCards.has(account))).toEqual(
      [],
    )
  })

  it.each(
    EVENTS.events.filter(({ conditions }) => conditions?.grocer !== undefined),
  )("says what $id's « Refuser » does", ({ choices }) => {
    const refuse = choices.find(({ id }) => id === 'refuser')
    const effects = refuse?.outcomes.flatMap((outcome) => outcome.effects)
    expect(effects).toEqual([
      expect.objectContaining({ kind: 'energy', difficulties: ['difficile'] }),
    ])
    const said =
      (section(doc, (heading) => heading === GROCER_CONTRACTS) ?? '').match(
        /« Refuser » ([^.]*)/,
      )?.[1] ?? ''
    expect(said).toMatch(/energy/)
    expect(said).toMatch(/Difficile/)
  })
})
