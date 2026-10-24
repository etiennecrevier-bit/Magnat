import type {
  CompanyRung,
  DreamBonus,
  DreamContent,
  Ladder,
  Rung,
  RungId,
} from '../content/schema.ts'
import { BAKERY } from '../engine/bakery.ts'
import {
  CUSTOMERS,
  DEFIS,
  DIFFICULTIES,
  FOOD_TRUCK,
  PERSONAL,
  truckOnBooks,
} from '../engine/day.ts'
import { applyDecision } from '../engine/decisions.ts'
import {
  DREAM,
  DREAM_MEMO,
  cashNeeded,
  dreamLabel,
  isBought,
  isCompany,
  isPersonal,
  nextRung,
  nextTitle,
  ownedRungs,
  purchaseEntries,
  purchaseOf,
  rungsOf,
  soldBy,
  titleOf,
} from '../engine/dream.ts'
import { DISTRICTS } from '../engine/districts.ts'
import { add, cents, sub, type Cents } from '../engine/money.ts'
import { netWorth } from '../engine/netWorth.ts'
import { STAFF } from '../engine/staff.ts'
import type { GameState } from '../engine/types.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance, entriesOf } from '../finance/journal.ts'
import { formatBriefMoney, formatMoney } from './formatMoney.ts'
import type { TipContent, TipRow } from './tooltip.ts'

// What the « Améliorations » panel shows (#162, #207): the owner's ladder
// and the company's, each rung with where it stands, its bonus in a few
// words and what it gives in plain facts, how close the next rung is, and
// the owner's title. The engine buys (src/engine/dream.ts); this only
// reads the game.

const CASH = '1000' satisfies AccountCode
const EQUIPMENT = '1500' satisfies AccountCode
const ACCUMULATED_DEPRECIATION = '1510' satisfies AccountCode

// French puts a no-break space (U+00A0) before a colon and a percent sign.
const COLON = '\u00a0:'
const PERCENT = '\u00a0%'
const MINUS = '\u2212'

/**
 * Where a rung stands: bought and still owned, bought then sold back by a
 * later rung, the next one of its ladder, after the next one, or shown but
 * not for sale yet.
 */
export type RungStatus = 'owned' | 'sold' | 'next' | 'locked' | 'comingSoon'

/** A fact about a rung: what it changes, and by how much. */
export interface RungFact {
  readonly label: string
  readonly value: string
}

/** A rung, as the panel shows it. */
export interface RungRow {
  readonly id: RungId
  readonly name: string
  /** What buying it costs. */
  readonly price: Cents
  readonly status: RungStatus
  /** Whether the engine buys it this morning. */
  readonly buyable: boolean
  /** What it gives, in a few words on its card; null for nothing yet. */
  readonly chip: string | null
  /** What it gives, and what buying it changes, in plain facts. */
  readonly facts: readonly RungFact[]
  /**
   * What buying it does to the company's books, as the confirmation adds
   * it: the equipment and its depreciation; none for a personal rung.
   */
  readonly books: readonly RungFact[]
  /**
   * A company rung owned: its book value today and its depreciation so far;
   * null otherwise.
   */
  readonly onBooks: {
    readonly bookValue: Cents
    readonly depreciated: Cents
  } | null
  /** The name of the rung it comes after, while it is locked; else null. */
  readonly after: string | null
}

/** One ladder, as the panel shows it. */
export interface LadderRow {
  readonly ladder: Ladder
  /** « Payé par vous » or « Payé par l'entreprise ». */
  readonly payer: string
  /** The cash the ladder is paid from: the owner's own, or Encaisse. */
  readonly cash: Cents
  readonly rungs: readonly RungRow[]
  /** The next rung for sale; null once none is left to buy. */
  readonly next: RungRow | null
  /**
   * The cash the next rung needs on hand: its price, less what the rung it
   * sells brings back (see `cashNeeded`); null when there is no next rung.
   */
  readonly needed: Cents | null
  /**
   * How close the next rung is: the cash on hand over the cash it needs,
   * from 0 to 1; null when there is no next rung.
   */
  readonly progress: number | null
}

/** The owner's title and the next one. */
export interface TitleRow {
  /** The title the owner's net worth earns; null below the first. */
  readonly title: string | null
  /** The next title, with the net worth it needs and how close it is. */
  readonly next: {
    readonly name: string
    readonly netWorth: Cents
    /** The net worth over what the next title needs, from 0 to 1. */
    readonly progress: number
  } | null
}

/** What the « Améliorations » panel shows. */
export interface DreamBoard {
  readonly personal: LadderRow
  readonly company: LadderRow
  readonly netWorth: Cents
  readonly titles: TitleRow
}

/** The board of `game` on its morning, with `content` as its ladders. */
export function dreamBoard(
  game: GameState,
  content: DreamContent = DREAM,
): DreamBoard {
  const worth = netWorth(game, content)
  return {
    personal: ladderRow(game, 'personal', game.personal.cash, content),
    company: ladderRow(
      game,
      'company',
      balance(game.journal, CASH, { toDay: game.day }),
      content,
    ),
    netWorth: worth,
    titles: titleRow(worth, content),
  }
}

function ladderRow(
  game: GameState,
  ladder: Ladder,
  cash: Cents,
  content: DreamContent,
): LadderRow {
  const owned = new Set(ownedRungs(game.dream, content).map(({ id }) => id))
  const coming = nextRung(game.dream, ladder, content)
  const ladderRungs = rungsOf(ladder, content)
  const rungs = ladderRungs.map((rung, index): RungRow => {
    const status = statusOf(game, rung, owned, coming)
    const before = ladderRungs[index - 1]
    return {
      id: rung.id,
      name: rung.name,
      price: rung.priceCents,
      status,
      // Only the next rung may be for sale, so only it asks the engine.
      buyable: status === 'next' && buys(game, rung.id, content),
      chip: bonusChip(rung, content),
      facts: rungFacts(game, rung, content),
      books: status === 'next' ? booksFacts(game, rung) : [],
      onBooks: status === 'owned' ? onBooksOf(game, rung) : null,
      after: status === 'locked' && before !== undefined ? before.name : null,
    }
  })
  const next = rungs.find(({ status }) => status === 'next') ?? null
  const needed =
    coming === null || next === null ? null : cashNeeded(coming, content)
  return {
    ladder,
    payer:
      ladder === 'personal'
        ? "Payé par vous · ne touche pas l'entreprise"
        : "Payé par l'entreprise",
    cash,
    rungs,
    next,
    needed,
    progress: needed === null ? null : share(cash, needed),
  }
}

function statusOf(
  game: GameState,
  rung: Rung,
  owned: ReadonlySet<RungId>,
  coming: Rung | null,
): RungStatus {
  if (isBought(game.dream, rung.id)) {
    return owned.has(rung.id) ? 'owned' : 'sold'
  }
  if (rung.comingSoon === true) return 'comingSoon'
  return coming?.id === rung.id ? 'next' : 'locked'
}

/**
 * Whether the engine buys the rung `id` of `content` on `game`'s morning:
 * `applyDecision` makes the purchase without a RangeError. Nothing is kept.
 */
export function buys(
  game: GameState,
  id: RungId,
  content: DreamContent = DREAM,
): boolean {
  try {
    applyDecision(
      game,
      { kind: 'buy', rung: id },
      FOOD_TRUCK,
      DEFIS,
      BAKERY,
      STAFF,
      content,
    )
    return true
  } catch (error) {
    if (error instanceof RangeError) return false
    throw error
  }
}

/** `part` over `whole`, from 0 to 1; 1 when nothing is needed. */
function share(part: number, whole: number): number {
  if (whole <= 0) return 1
  return Math.min(1, Math.max(0, part / whole))
}

function titleRow(worth: Cents, content: DreamContent): TitleRow {
  const next = nextTitle(worth, content)
  return {
    title: titleOf(worth, content)?.name ?? null,
    next:
      next === null
        ? null
        : {
            name: next.name,
            netWorth: next.netWorthCents,
            progress: share(worth, next.netWorthCents),
          },
  }
}

/**
 * What `rung` gives and what buying it changes, in plain facts with the
 * content's numbers: each bonus, then the home's payment and what it
 * replaces, the rung it sells back, and the old truck taken back.
 */
export function rungFacts(
  game: GameState,
  rung: Rung,
  content: DreamContent = DREAM,
): RungFact[] {
  const facts = rung.bonuses.map(bonusFact)
  if (isPersonal(rung) && rung.housing !== undefined) {
    const { label, monthlyCents } = rung.housing
    facts.push({ label, value: `${formatMoney(monthlyCents)} par mois` })
    const before = replacedHousing(rung, content)
    facts.push({
      label: 'Remplace',
      value: `${before.label} (${formatMoney(before.monthlyCents)} par mois)`,
    })
  }
  const sold = soldBy(rung, content)
  if (sold !== null) {
    facts.push({
      label: 'Revend',
      value: `${sold.name} (${formatMoney(sold.priceCents)})`,
    })
  }
  if (isCompany(rung) && rung.addsTruck !== undefined) {
    facts.push({ label: 'Ouvre', value: districtName(rung.addsTruck.district) })
  }
  if (isCompany(rung)) facts.push(...truckFacts(game, rung))
  return facts
}

/** The name of the district `district`: « Vieux-Montréal ». */
function districtName(district: keyof typeof DISTRICTS.districts): string {
  return DISTRICTS.districts[district].name
}

/**
 * What buying the company rung `rung` on `game`'s morning posts, read from
 * the very entries the engine posts (see `purchaseEntries`): the equipment
 * it adds to the bilan, its depreciation each month, as `depreciate` takes
 * it, and the old truck's price leaving the bilan when it replaces it. None
 * for a personal rung.
 */
export function booksFacts(game: GameState, rung: Rung): RungFact[] {
  if (!isCompany(rung)) return []
  const truck = truckOnBooks(game.journal, game.day, game.profile.difficulty)
  const entries = purchaseEntries(rung, game.day, truck)
  const memo = dreamLabel(DREAM_MEMO.bought, rung.name)
  const linesOf = (wanted: string) =>
    entries
      .filter((entry) => entry.memo === wanted)
      .flatMap(({ lines }) => lines)
      .filter(({ account }) => account === EQUIPMENT)
  const added = linesOf(memo).reduce(
    (total, { debit }) => add(total, debit),
    cents(0),
  )
  const retired = linesOf(DREAM_MEMO.truckSold).reduce(
    (total, { credit }) => add(total, credit),
    cents(0),
  )
  const { usefulLifeMonths } = rung
  const monthly = cents((added - (added % usefulLifeMonths)) / usefulLifeMonths)
  const facts: RungFact[] = [
    { label: 'Équipement au bilan', value: `+${formatBriefMoney(added)}` },
    {
      label: 'Amortissement',
      value: `${formatBriefMoney(monthly)} par mois pendant ${usefulLifeMonths} mois`,
    },
  ]
  if (retired > 0) {
    facts.push({
      label: 'Ancien camion retiré',
      value: `${MINUS}${formatBriefMoney(retired)}`,
    })
  }
  return facts
}

/**
 * The company rung `rung` as the books carry it at `game`'s morning: what
 * it cost less the « Amortissement · {name} » posted so far, and that
 * depreciation; null for a personal rung or one not bought.
 */
export function onBooksOf(
  game: GameState,
  rung: Rung,
): { bookValue: Cents; depreciated: Cents } | null {
  const purchase = purchaseOf(game.dream, rung.id)
  if (!isCompany(rung) || purchase === undefined) return null
  const memo = dreamLabel(DREAM_MEMO.depreciation, rung.name)
  let depreciated = cents(0)
  for (const entry of entriesOf(game.journal)) {
    if (entry.day > game.day) break
    if (entry.memo !== memo) continue
    for (const { account, credit } of entry.lines) {
      if (account === ACCUMULATED_DEPRECIATION) {
        depreciated = add(depreciated, credit)
      }
    }
  }
  return { bookValue: sub(purchase.cost, depreciated), depreciated }
}

/** A fact as one line: « label : value ». */
export function factLine({ label, value }: RungFact): string {
  return `${label}${COLON} ${value}`
}

/**
 * What a home replaces: the housing of the rung it sells back, or the
 * rent.
 */
function replacedHousing(
  rung: Rung,
  content: DreamContent,
): { label: string; monthlyCents: Cents; rent: boolean } {
  const sold = soldBy(rung, content)
  return sold !== null && isPersonal(sold) && sold.housing !== undefined
    ? { ...sold.housing, rent: false }
    : { label: 'Loyer', monthlyCents: PERSONAL.rentCents, rent: true }
}

/** What a truck that replaces the old one changes. */
function truckFacts(game: GameState, rung: CompanyRung): RungFact[] {
  if (rung.replacesTruck !== true) return []
  const { truck } = DIFFICULTIES.difficulties[game.profile.difficulty]
  if (truck.kind === 'lease') {
    return [
      {
        label: 'Fin de la location du camion',
        value: `${formatMoney(truck.monthlyLeaseCents)} par mois`,
      },
    ]
  }
  const books = truckOnBooks(game.journal, game.day, game.profile.difficulty)
  return books === null
    ? []
    : [
        {
          label: "L'ancien camion repris à sa valeur comptable",
          value: formatMoney(books.bookValue),
        },
      ]
}

/** A bonus, as a plain fact. */
export function bonusFact(bonus: DreamBonus): RungFact {
  switch (bonus.kind) {
    case 'travelTime':
      return {
        label: 'Déplacements en ville',
        value: `${percent(bonus.factor)} de temps`,
      }
    case 'serviceTime':
      return {
        label: 'Service au comptoir',
        value: `${percent(bonus.factor)} de temps`,
      }
    case 'line':
      return {
        label: "File d'attente",
        value: `${percent(bonus.factor)} de clients`,
      }
    case 'stock':
      return { label: 'Stock par produit', value: percent(bonus.factor) }
    case 'walkIns':
      return {
        label: CUSTOMERS.segments[bonus.segment].name,
        value: `${percent(bonus.factor)} de passants`,
      }
    case 'closedDayRecovery':
      return { label: 'Jour de congé', value: `+${bonus.extra} d'énergie` }
  }
}

/**
 * What `rung` gives, in a few words on its card: the district a truck it
 * adds opens (#265), its first bonus, or what a home replaces; null when
 * it gives nothing yet.
 */
export function bonusChip(
  rung: Rung,
  content: DreamContent = DREAM,
): string | null {
  if (isCompany(rung) && rung.addsTruck !== undefined) {
    return `Ouvre le ${districtName(rung.addsTruck.district)}`
  }
  const [bonus] = rung.bonuses
  if (bonus !== undefined) return chipOf(bonus)
  if (isPersonal(rung) && rung.housing !== undefined) {
    return replacedHousing(rung, content).rent
      ? 'Loyer remplacé'
      : 'Hypothèque remplacée'
  }
  return null
}

function chipOf(bonus: DreamBonus): string {
  switch (bonus.kind) {
    case 'travelTime':
      return `${percent(bonus.factor)} de trajet`
    case 'serviceTime':
      return `${percent(bonus.factor)} de service`
    case 'line':
      return `${percent(bonus.factor)} de file`
    case 'stock':
      return `${percent(bonus.factor)} de stock`
    case 'walkIns':
      return `${percent(bonus.factor)} de ${CUSTOMERS.segments[bonus.segment].name.toLowerCase()}`
    case 'closedDayRecovery':
      return `+${bonus.extra} d'énergie par congé`
  }
}

/** A factor as a change in percent: 0.7 is « −30 % », 1.5 « +50 % ». */
function percent(factor: number): string {
  const change = Math.round((factor - 1) * 100)
  return `${change < 0 ? '−' : '+'}${Math.abs(change)}${PERCENT}`
}

/** What the rung `id` costs and who pays, as the confirmation reads it. */
export function priceLine(row: LadderRow, rung: RungRow): string {
  return `${formatMoney(rung.price)}, ${row.payer.toLowerCase()}`
}

/**
 * The tooltip of `rung`'s card: its name, its price and who pays, its
 * facts, and on the next rung, the cash still missing in amber.
 */
export function rungTip(row: LadderRow, rung: RungRow): TipContent {
  const rows: TipRow[] = rung.facts.map(({ label, value }) => ({
    label,
    value,
  }))
  if (rung.onBooks !== null) {
    rows.push(
      {
        label: 'Valeur aux livres',
        value: formatMoney(rung.onBooks.bookValue),
        divider: true,
      },
      {
        label: 'Amortissement à ce jour',
        value: formatMoney(rung.onBooks.depreciated),
      },
    )
  }
  const { cash, needed } = row
  if (rung.status === 'next' && needed !== null && cash < needed) {
    rows.push({
      label: 'Il vous manque',
      value: formatMoney(sub(needed, cash)),
      warn: true,
    })
  }
  return { title: rung.name, text: priceLine(row, rung), rows }
}
