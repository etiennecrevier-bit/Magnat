import { describe, expect, it } from 'vitest'
import difficultyJson from './difficulty.json'
import foodTruckJson from './foodtruck.json'
import profileJson from './profile.json'
import {
  dayTypeIdSchema,
  difficultyIdSchema,
  loadCustomerContent,
  loadDifficultyContent,
  loadFoodTruckContent,
  loadProfileContent,
  productIdSchema,
  segmentIdSchema,
} from './schema.ts'
import segmentsJson from './segments.json'

type Json = Record<string, unknown>
type Load = (raw: unknown) => unknown

/**
 * Copies `source` and applies `change` to the object holding the last key of
 * the dotted `path`.
 */
function editedCopy(
  source: unknown,
  path: string,
  change: (parent: Json, key: string) => void,
): unknown {
  const copy = structuredClone(source) as Json
  const keys = path.split('.')
  const key = keys.pop() as string
  const parent = keys.reduce((node, k) => node[k] as Json, copy)
  change(parent, key)
  return copy
}

function withValue(
  path: string,
  value: unknown,
  source: unknown = foodTruckJson,
): unknown {
  return editedCopy(source, path, (parent, key) => {
    parent[key] = value
  })
}

function without(path: string, source: unknown = foodTruckJson): unknown {
  return editedCopy(source, path, (parent, key) => {
    delete parent[key]
  })
}

/** Expects the load to fail and the error to point at exactly `path`. */
function expectRejected(
  raw: unknown,
  path: string,
  load: Load = loadFoodTruckContent,
): void {
  const at = new RegExp(`→ at ${path.replace(/[.[\]]/g, '\\$&')}$`, 'm')
  expect(() => load(raw)).toThrow(at)
}

const WEEKDAY = 'walkIns.dayTypes.semaine'
const START = 'startingDecisions'
const LIMITS = 'decisionLimits'

// Shape only, like pacing.test.ts: the values themselves are tunable.
describe('loadFoodTruckContent', () => {
  it('loads the shipped foodtruck.json with every product in each section', () => {
    const content = loadFoodTruckContent()
    const ids = [...productIdSchema.options].sort()
    expect(Object.keys(content.products).sort()).toEqual(ids)
    expect(Object.keys(content.startingDecisions.pricesCents).sort()).toEqual(
      ids,
    )
    expect(Object.keys(content.startingDecisions.restock).sort()).toEqual(ids)
    expect(Object.keys(content.walkIns.dayTypes).sort()).toEqual(
      [...dayTypeIdSchema.options].sort(),
    )
    for (const dayType of Object.values(content.walkIns.dayTypes)) {
      expect(Object.keys(dayType.productAppeal).sort()).toEqual(ids)
      expect(Object.keys(dayType.segmentShares).sort()).toEqual(
        [...segmentIdSchema.options].sort(),
      )
    }
  })

  it('rejects a float price', () => {
    expectRejected(
      withValue(`${START}.pricesCents.cafe`, 2.5),
      `${START}.pricesCents.cafe`,
    )
  })

  it.each([
    `${START}.pricesCents.croissant`,
    `${START}.pricesCents.chocolat`,
    `${START}.ownerWeeklyPayCents`,
    `${START}.marketingDailyCents`,
    `${LIMITS}.priceCents.min`,
    `${LIMITS}.ownerWeeklyPayCents.max`,
    'products.cafe.unitCostCents',
    'products.croissant.unitCostCents',
    'products.chocolat.packagingCents',
    'truck.priceCents',
    'monthlyCostsCents.permitParkingAndCommissary',
    'monthlyCostsCents.insurance',
    'fuelAndMaintenancePerOpenDayCents',
  ])('rejects a float in %s', (path) => {
    expectRejected(withValue(path, 12.5), path)
  })

  it('rejects a negative amount', () => {
    expectRejected(
      withValue('products.cafe.unitCostCents', -40),
      'products.cafe.unitCostCents',
    )
  })

  it.each(['products.croissant', 'products.chocolat'])(
    'rejects a missing product: %s',
    (path) => {
      expectRejected(without(path), path)
    },
  )

  it.each([
    `${START}.pricesCents.chocolat`,
    `${START}.restock.chocolat`,
    `${WEEKDAY}.productAppeal.chocolat`,
    `${WEEKDAY}.segmentShares.chic`,
    'walkIns.dayTypes.finDeSemaine',
  ])('rejects a key missing from its record: %s', (path) => {
    expectRejected(without(path), path)
  })

  it('rejects an unknown product id', () => {
    const muffin = { ...foodTruckJson.products.cafe, name: 'Muffin' }
    const raw = withValue('products.muffin', muffin)
    expectRejected(raw, 'products')
    expect(() => loadFoodTruckContent(raw)).toThrow(
      'Unrecognized key: "muffin"',
    )
  })

  it.each([
    ['walkIns', 'customer'],
    [WEEKDAY, 'patience'],
  ])('rejects a mistyped key in %s', (parent, key) => {
    const raw = withValue(`${parent}.${key}`, 1)
    expectRejected(raw, parent)
    expect(() => loadFoodTruckContent(raw)).toThrow(
      `Unrecognized key: "${key}"`,
    )
  })

  it.each([
    ['products.cafe.basePriceCents', 250],
    ['restockPolicy', foodTruckJson.startingDecisions.restock],
  ])('rejects %s, which the starting decisions replaced', (path, value) => {
    const key = path.split('.').at(-1) ?? ''
    expect(() => loadFoodTruckContent(withValue(path, value))).toThrow(
      `Unrecognized key: "${key}"`,
    )
  })

  it.each([
    ['startingCapitalCents', 1_000_000],
    ['dailyFixedCostsCents', { rentAndPermit: 4500, fuelAndMaintenance: 2000 }],
  ])('rejects %s, which the real costs replaced', (path, value) => {
    expect(() => loadFoodTruckContent(withValue(path, value))).toThrow(
      `Unrecognized key: "${path}"`,
    )
  })

  it.each([
    'products.cafe.packagingCents',
    'truck.usefulLifeMonths',
    'monthlyCostsCents.insurance',
    'fuelAndMaintenancePerOpenDayCents',
    'cardPayments.feeRate',
    'ownerPayWeekday',
  ])('rejects a missing %s', (path) => {
    expectRejected(without(path), path)
  })

  it.each([
    ['cardPayments.share', 1.2],
    ['cardPayments.share', -0.1],
    ['cardPayments.feeRate', 1.5],
    ['cardPayments.feeRate', -0.025],
    ['ownerPayWeekday', 0],
    ['ownerPayWeekday', 8],
    ['ownerPayWeekday', 5.5],
    ['truck.usefulLifeMonths', 0],
    ['truck.usefulLifeMonths', 120.5],
    ['truck.priceCents', -1],
  ])('rejects %s = %d', (path, value) => {
    expectRejected(withValue(path, value), path)
  })

  it('accepts cards at both ends of their range', () => {
    const raw = withValue('cardPayments', { share: 1, feeRate: 0 })
    expect(loadFoodTruckContent(raw).cardPayments).toEqual({
      share: 1,
      feeRate: 0,
    })
  })

  it('rejects the walk-ins of phase 1', () => {
    const raw = withValue('walkIns', {
      weekdayCustomers: 120,
      weekendCustomers: 80,
      noiseStdDevRatio: 0.15,
    })
    expect(() => loadFoodTruckContent(raw)).toThrow(
      /Unrecognized keys: "weekdayCustomers", "weekendCustomers"\n +→ at walkIns$/m,
    )
  })

  it('rejects a shelf life of 0 days', () => {
    expectRejected(
      withValue('products.croissant.shelfLifeDays', 0),
      'products.croissant.shelfLifeDays',
    )
  })

  it.each([
    [`${WEEKDAY}.customers`, -1],
    ['walkIns.dayTypes.finDeSemaine.customers', 90.5],
    [`${START}.restock.croissant.quantity`, -70],
    [`${START}.restock.cafe.upTo`, 300.5],
    [`${LIMITS}.units.max`, -1],
  ])('rejects %s = %d, which is not a count', (path, value) => {
    expectRejected(withValue(path, value), path)
  })

  it('rejects a top-up threshold above its target', () => {
    expectRejected(
      withValue(`${START}.restock.cafe.whenBelow`, 400),
      `${START}.restock.cafe.whenBelow`,
    )
  })

  it('rejects an unknown restock kind', () => {
    expectRejected(
      withValue(`${START}.restock.croissant.kind`, 'buyWeekly'),
      `${START}.restock.croissant.kind`,
    )
  })

  it.each([0, 8, 2.5])('rejects %d as a weekday the truck opens', (day) => {
    expectRejected(
      withValue(`${START}.daysOpen`, [2, day]),
      `${START}.daysOpen[1]`,
    )
  })

  it.each([
    'priceCents',
    'units',
    'ownerWeeklyPayCents',
    'marketingDailyCents',
  ])('rejects a %s limit whose min is above its max', (limit) => {
    expectRejected(
      withValue(`${LIMITS}.${limit}.min`, 300_001),
      `${LIMITS}.${limit}.min`,
    )
  })

  it.each([0, -5, 2.5])('rejects a price step of %d', (step) => {
    expectRejected(
      withValue(`${LIMITS}.priceCents.step`, step),
      `${LIMITS}.priceCents.step`,
    )
  })

  it.each([0, 8, 1.5])('rejects %d as the fewest days open', (days) => {
    expectRejected(
      withValue(`${LIMITS}.minDaysOpen`, days),
      `${LIMITS}.minDaysOpen`,
    )
  })

  it.each([
    ['walkIns.noiseStdDevRatio', -0.1],
    [`${WEEKDAY}.segmentShares.chic`, 1.2],
    [`${WEEKDAY}.segmentShares.chic`, -0.2],
    [`${WEEKDAY}.productAppeal.cafe`, -1],
    [`${WEEKDAY}.patienceMultiplier`, 0],
    [`${WEEKDAY}.patienceMultiplier`, -0.5],
    [`${WEEKDAY}.arrivalWeights.3`, -2],
    ['walkIns.opensAtMinute', -30],
    ['walkIns.opensAtMinute', 420.5],
    ['walkIns.closesAtMinute', 1470],
    ['walkIns.arrivalSlotMinutes', 0],
    ['walkIns.arrivalSlotMinutes', 30.5],
    ['service.baseSeconds', -1],
    ['service.baseSeconds', 40.5],
    ['service.perItemSeconds', -15],
    ['service.perItemSeconds', 7.5],
    ['service.maxAheadInLine', -1],
    ['service.maxAheadInLine', 8.5],
  ])('rejects %s = %d', (path, value) => {
    expectRejected(withValue(path, value), path.replace(/\.(\d+)$/, '[$1]'))
  })

  it('rejects a missing service', () => {
    expectRejected(without('service'), 'service')
  })

  it('rejects an unknown key in the service', () => {
    expectRejected(withValue('service.servers', 2), 'service')
  })

  it('accepts a service that takes no time', () => {
    const service = { baseSeconds: 0, perItemSeconds: 0, maxAheadInLine: 0 }
    expect(loadFoodTruckContent(withValue('service', service)).service).toEqual(
      service,
    )
  })

  it('rejects segment shares that do not sum to 1', () => {
    expectRejected(
      withValue(`${WEEKDAY}.segmentShares`, {
        aubaine: 0.3,
        habitue: 0.5,
        chic: 0.3,
      }),
      `${WEEKDAY}.segmentShares`,
    )
  })

  it('accepts segment shares off 1 by rounding only', () => {
    const shares = { aubaine: 0.7, habitue: 0.2, chic: 0.1 }
    expect(shares.aubaine + shares.habitue + shares.chic).not.toBe(1)
    expect(() =>
      loadFoodTruckContent(withValue(`${WEEKDAY}.segmentShares`, shares)),
    ).not.toThrow()
  })

  it('rejects arrival weights that are all 0', () => {
    expectRejected(
      withValue(
        `${WEEKDAY}.arrivalWeights`,
        foodTruckJson.walkIns.dayTypes.semaine.arrivalWeights.map(() => 0),
      ),
      `${WEEKDAY}.arrivalWeights`,
    )
  })

  it('rejects arrival weights that do not fill the opening hours', () => {
    const weights = foodTruckJson.walkIns.dayTypes.semaine.arrivalWeights
    for (const wrong of [weights.slice(1), [...weights, 1]]) {
      expectRejected(
        withValue(`${WEEKDAY}.arrivalWeights`, wrong),
        `${WEEKDAY}.arrivalWeights`,
      )
    }
  })

  it.each([900, 960])(
    'rejects a closing time of %d, not after opening',
    (opensAtMinute) => {
      expectRejected(
        withValue('walkIns.opensAtMinute', opensAtMinute),
        'walkIns.closesAtMinute',
      )
    },
  )

  it('rejects opening hours that do not divide into slots', () => {
    expectRejected(
      withValue('walkIns.arrivalSlotMinutes', 25),
      'walkIns.arrivalSlotMinutes',
    )
  })

  it('accepts other slots that fill the opening hours', () => {
    const raw = dayTypeIdSchema.options.reduce(
      (source, dayType) =>
        withValue(
          `walkIns.dayTypes.${dayType}.arrivalWeights`,
          [1, 2, 3, 4, 5, 6, 7, 8],
          source,
        ),
      withValue('walkIns.arrivalSlotMinutes', 60),
    )
    expect(loadFoodTruckContent(raw).walkIns.arrivalSlotMinutes).toBe(60)
  })
})

describe('loadCustomerContent', () => {
  const loadCustomers: Load = loadCustomerContent
  const reject = (raw: unknown, path: string) =>
    expectRejected(raw, path, loadCustomers)
  const withCustomerValue = (path: string, value: unknown) =>
    withValue(path, value, segmentsJson)

  it('loads the shipped segments.json with every product for each segment', () => {
    const { segments } = loadCustomerContent()
    expect(Object.keys(segments).sort()).toEqual(
      [...segmentIdSchema.options].sort(),
    )
    for (const segment of Object.values(segments)) {
      expect(Object.keys(segment.products).sort()).toEqual(
        [...productIdSchema.options].sort(),
      )
    }
    expect(segments.chic.tooCheap).toBeDefined()
  })

  it('names segments.json in its error', () => {
    expect(() => loadCustomerContent({})).toThrow(/^segments\.json is invalid/)
  })

  it('rejects a missing segment', () => {
    reject(without('segments.habitue', segmentsJson), 'segments.habitue')
  })

  it('rejects an unknown segment', () => {
    const raw = withCustomerValue(
      'segments.touriste',
      segmentsJson.segments.habitue,
    )
    reject(raw, 'segments')
    expect(() => loadCustomerContent(raw)).toThrow(
      'Unrecognized key: "touriste"',
    )
  })

  it('rejects a missing product', () => {
    reject(
      without('segments.aubaine.products.chocolat', segmentsJson),
      'segments.aubaine.products.chocolat',
    )
  })

  it('rejects a mistyped key', () => {
    const raw = withCustomerValue('segments.chic.products.cafe.sensitivty', 1)
    reject(raw, 'segments.chic.products.cafe')
    expect(() => loadCustomerContent(raw)).toThrow(
      'Unrecognized key: "sensitivty"',
    )
  })

  it.each([
    ['segments.habitue.products.cafe.referencePriceCents', 0],
    ['segments.habitue.products.cafe.referencePriceCents', -250],
    ['segments.habitue.products.cafe.referencePriceCents', 249.5],
    ['segments.aubaine.products.croissant.purchaseProbability', 1.1],
    ['segments.aubaine.products.croissant.purchaseProbability', -0.1],
    ['segments.chic.products.chocolat.sensitivity', -1],
    ['segments.chic.tooCheap.belowRatio', 0],
    ['segments.chic.tooCheap.belowRatio', 1],
    ['segments.chic.tooCheap.steepness', 0],
    ['segments.chic.tooCheap.steepness', -15],
    ['segments.chic.name', ''],
    ['segments.chic.patienceMinutes', 0],
    ['segments.aubaine.patienceMinutes', -8],
    ['segments.habitue.patienceMinutes', '6'],
  ])('rejects %s = %s', (path, value) => {
    reject(withCustomerValue(path, value), path)
  })

  it('rejects a segment without patienceMinutes', () => {
    reject(
      without('segments.habitue.patienceMinutes', segmentsJson),
      'segments.habitue.patienceMinutes',
    )
  })

  it('accepts a patience in fractions of a minute', () => {
    const raw = withCustomerValue('segments.chic.patienceMinutes', 2.5)
    expect(loadCustomerContent(raw).segments.chic.patienceMinutes).toBe(2.5)
  })

  it('accepts a segment without tooCheap', () => {
    const raw = without('segments.chic.tooCheap', segmentsJson)
    expect(loadCustomerContent(raw).segments.chic.tooCheap).toBeUndefined()
  })
})

describe('loadDifficultyContent', () => {
  const loadDifficulties: Load = loadDifficultyContent
  const reject = (raw: unknown, path: string) =>
    expectRejected(raw, path, loadDifficulties)
  const withDifficultyValue = (path: string, value: unknown) =>
    withValue(path, value, difficultyJson)

  it('loads the shipped difficulty.json with each difficulty and its kind of truck', () => {
    const { difficulties } = loadDifficultyContent()
    expect(Object.keys(difficulties).sort()).toEqual(
      [...difficultyIdSchema.options].sort(),
    )
    expect(Object.values(difficulties).map(({ truck }) => truck.kind)).toEqual([
      'owned',
      'loan',
      'lease',
    ])
  })

  it('names difficulty.json in its error', () => {
    expect(() => loadDifficultyContent({})).toThrow(
      /^difficulty\.json is invalid/,
    )
  })

  it('rejects a missing difficulty', () => {
    reject(without('difficulties.moyen', difficultyJson), 'difficulties.moyen')
  })

  it('rejects an unknown difficulty', () => {
    const raw = withDifficultyValue(
      'difficulties.extreme',
      difficultyJson.difficulties.difficile,
    )
    reject(raw, 'difficulties')
    expect(() => loadDifficultyContent(raw)).toThrow(
      'Unrecognized key: "extreme"',
    )
  })

  it('rejects a mistyped key', () => {
    const raw = withDifficultyValue('difficulties.facile.startingCash', 1)
    reject(raw, 'difficulties.facile')
    expect(() => loadDifficultyContent(raw)).toThrow(
      'Unrecognized key: "startingCash"',
    )
  })

  it('rejects an unknown kind of truck', () => {
    reject(
      withDifficultyValue('difficulties.difficile.truck.kind', 'rented'),
      'difficulties.difficile.truck.kind',
    )
  })

  it("rejects an amount that belongs to another kind's truck", () => {
    const raw = withDifficultyValue(
      'difficulties.facile.truck.loanCents',
      7_000_000,
    )
    reject(raw, 'difficulties.facile.truck')
  })

  it.each([
    ['difficulties.facile.startingCashCents', 12.5],
    ['difficulties.moyen.truck.loanCents', -1],
    // loanSchedule() takes no loan of nothing; a game without one is Facile.
    ['difficulties.moyen.truck.loanCents', 0],
    ['difficulties.moyen.truck.annualRateBasisPoints', -1],
    ['difficulties.moyen.truck.annualRateBasisPoints', 7.5],
    ['difficulties.moyen.truck.termMonths', 0],
    ['difficulties.moyen.truck.termMonths', 1.5],
    ['difficulties.difficile.truck.monthlyLeaseCents', 1800.5],
    ['difficulties.moyen.name', ''],
  ])('rejects %s = %s', (path, value) => {
    reject(withDifficultyValue(path, value), path)
  })

  it.each([
    'difficulties.moyen.truck.annualRateBasisPoints',
    'difficulties.moyen.truck.termMonths',
  ])('rejects a loan without %s', (path) => {
    reject(without(path, difficultyJson), path)
  })

  it('accepts a loan without interest', () => {
    const raw = withDifficultyValue(
      'difficulties.moyen.truck.annualRateBasisPoints',
      0,
    )
    expect(loadDifficultyContent(raw).difficulties.moyen.truck).toMatchObject({
      kind: 'loan',
      annualRateBasisPoints: 0,
    })
  })
})

describe('loadProfileContent', () => {
  const loadProfile: Load = loadProfileContent
  const reject = (raw: unknown, path: string) =>
    expectRejected(raw, path, loadProfile)
  const withProfileValue = (path: string, value: unknown) =>
    withValue(path, value, profileJson)

  it('loads the shipped profile.json', () => {
    const content = loadProfileContent()
    expect(content.businessNameMaxLength).toBeGreaterThan(0)
    expect(difficultyIdSchema.options).toContain(
      content.defaultProfile.difficulty,
    )
  })

  it('names profile.json in its error', () => {
    expect(() => loadProfileContent({})).toThrow(/^profile\.json is invalid/)
  })

  it.each([
    ['businessNameMaxLength', 0],
    ['businessNameMaxLength', 30.5],
    ['defaultProfile.businessName', ''],
    ['defaultProfile.avatar', 'robot'],
    ['defaultProfile.difficulty', 'extreme'],
  ])('rejects %s = %s', (path, value) => {
    reject(withProfileValue(path, value), path)
  })

  it('rejects a missing default', () => {
    reject(
      without('defaultProfile.avatar', profileJson),
      'defaultProfile.avatar',
    )
  })

  it('rejects a mistyped key', () => {
    const raw = withProfileValue('defaultProfile.name', 'Chez Nous')
    reject(raw, 'defaultProfile')
    expect(() => loadProfileContent(raw)).toThrow('Unrecognized key: "name"')
  })
})
