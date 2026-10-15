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
import { createInitialState, tick } from '../src/engine/clock.ts'
import { SEGMENTS } from '../src/engine/customers.ts'
import { FOOD_TRUCK, openingJournal } from '../src/engine/day.ts'
import { PRODUCTS } from '../src/engine/inventory.ts'
import { defaultProfile } from '../src/engine/profile.ts'

// Keeps docs/architecture.md in step with the code it describes: the frozen
// header of src/engine/types.ts, a heading for each type it exports and a
// table row for each field, every repo path the page cites, the entries the
// books open with, and the order in which tick() posts a day's entries.

const root = fileURLToPath(new URL('..', import.meta.url))
const DOC = 'docs/architecture.md'
const TYPES = 'src/engine/types.ts'
const FROZEN =
  '// Frozen at the end of phase 1. Changing this file needs a dedicated card.'

const SHAPE = '## The shape of `GameState`'
const ORDER = '## Order of operations in `tick()`'

/** Text in single asterisks, which the page uses for journal memos. */
const ITALIC = /(?<!\*)\*([^*\n]+)\*(?!\*)/g
/** A repo path in a code span, such as `src/engine/day.ts`. */
const REPO_PATH = /`((?:src|tests|tools|docs)\/[^`\s]*)`/g

// Content under which every step of an open day posts its entry every day:
// the truck opens every day, and each product is bought daily, far more than
// a day's customers want, and spoils at its first close. The 1st of the
// month, payday and the loan's first payment, a month in, come within the
// days played. The seed, the customers and the days are fixed, so the run is
// too.
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
  startingDecisions: {
    pricesCents: Object.fromEntries(PRODUCTS.map((product) => [product, 300])),
    restock: Object.fromEntries(
      PRODUCTS.map((product) => [product, { kind: 'buyDaily', quantity: 500 }]),
    ),
    daysOpen: [1, 2, 3, 4, 5, 6, 7],
    ownerWeeklyPayCents: 70_000,
    marketingDailyCents: 0,
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
})
