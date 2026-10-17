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
  cashNeeded,
  isBought,
  isCompany,
  isPersonal,
  nextRung,
  nextTitle,
  ownedRungs,
  rungsOf,
  soldBy,
  titleOf,
} from '../engine/dream.ts'
import type { Cents } from '../engine/money.ts'
import { netWorth } from '../engine/netWorth.ts'
import { STAFF } from '../engine/staff.ts'
import type { GameState } from '../engine/types.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance } from '../finance/journal.ts'
import { formatMoney } from './formatMoney.ts'

// What the « Le rêve » panel shows (#162): the owner's ladder and the
// company's, each rung with where it stands and what it gives in plain
// facts, how close the next rung is, and the owner's title. The engine
// buys (src/engine/dream.ts); this only reads the game.

const CASH = '1000' satisfies AccountCode

// French puts a no-break space (U+00A0) before a colon and a percent sign.
const COLON = '\u00a0:'
const PERCENT = '\u00a0%'

/**
 * Where a rung stands: bought and still owned, bought then sold back by a
 * later rung, the next one of its ladder, after the next one, or shown but
 * not for sale yet.
 */
export type RungStatus = 'owned' | 'sold' | 'next' | 'locked' | 'comingSoon'

/** A rung, as the panel shows it. */
export interface RungRow {
  readonly id: RungId
  readonly name: string
  /** What buying it costs. */
  readonly price: Cents
  readonly status: RungStatus
  /** Whether the engine buys it this morning. */
  readonly buyable: boolean
  /** What it gives, and what buying it changes, in plain facts. */
  readonly lines: readonly string[]
}

/** One ladder, as the panel shows it. */
export interface LadderRow {
  readonly ladder: Ladder
  /** « Personnel » or « Entreprise ». */
  readonly title: string
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

/** What the « Le rêve » panel shows. */
export interface DreamBoard {
  readonly personal: LadderRow
  readonly company: LadderRow
  readonly netWorth: Cents
  readonly titles: TitleRow
}

/** The board of `game` on its morning, with `content` as « Le rêve ». */
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
  const rungs = rungsOf(ladder, content).map((rung): RungRow => {
    const status = statusOf(game, rung, owned, coming)
    return {
      id: rung.id,
      name: rung.name,
      price: rung.priceCents,
      status,
      // Only the next rung may be for sale, so only it asks the engine.
      buyable: status === 'next' && buys(game, rung.id, content),
      lines: rungLines(game, rung, content),
    }
  })
  const next = rungs.find(({ status }) => status === 'next') ?? null
  const needed =
    coming === null || next === null ? null : cashNeeded(coming, content)
  return {
    ladder,
    title: ladder === 'personal' ? 'Personnel' : 'Entreprise',
    payer: ladder === 'personal' ? 'Payé par vous' : "Payé par l'entreprise",
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
export function rungLines(
  game: GameState,
  rung: Rung,
  content: DreamContent = DREAM,
): string[] {
  const lines = rung.bonuses.map(bonusLine)
  if (isPersonal(rung) && rung.housing !== undefined) {
    const { label, monthlyCents } = rung.housing
    lines.push(`${label}${COLON} ${formatMoney(monthlyCents)} par mois`)
    const sold = soldBy(rung, content)
    const before =
      sold !== null && isPersonal(sold) && sold.housing !== undefined
        ? sold.housing
        : { label: 'Loyer', monthlyCents: PERSONAL.rentCents }
    lines.push(
      `Remplace${COLON} ${before.label} (${formatMoney(before.monthlyCents)} par mois)`,
    )
  }
  const sold = soldBy(rung, content)
  if (sold !== null) {
    lines.push(`Revend${COLON} ${sold.name} (${formatMoney(sold.priceCents)})`)
  }
  if (isCompany(rung)) lines.push(...truckLines(game, rung))
  return lines
}

/** What a truck that replaces the old one changes. */
function truckLines(game: GameState, rung: CompanyRung): string[] {
  if (rung.replacesTruck !== true) return []
  const { truck } = DIFFICULTIES.difficulties[game.profile.difficulty]
  if (truck.kind === 'lease') {
    return [
      `Fin de la location du camion${COLON} ${formatMoney(truck.monthlyLeaseCents)} par mois`,
    ]
  }
  const books = truckOnBooks(game.journal, game.day, game.profile.difficulty)
  return books === null
    ? []
    : [
        `L'ancien camion repris à sa valeur comptable${COLON} ${formatMoney(books.bookValue)}`,
      ]
}

/** A bonus, as a plain fact. */
export function bonusLine(bonus: DreamBonus): string {
  switch (bonus.kind) {
    case 'travelTime':
      return `Déplacements en ville${COLON} ${percent(bonus.factor)} de temps`
    case 'serviceTime':
      return `Service au comptoir${COLON} ${percent(bonus.factor)} de temps`
    case 'line':
      return `File d'attente${COLON} ${percent(bonus.factor)} de clients`
    case 'stock':
      return `Stock par produit${COLON} ${percent(bonus.factor)}`
    case 'walkIns':
      return `${CUSTOMERS.segments[bonus.segment].name}${COLON} ${percent(bonus.factor)} de passants`
    case 'closedDayRecovery':
      return `Jour de congé${COLON} +${bonus.extra} d'énergie`
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
