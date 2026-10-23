import {
  difficultyIdSchema,
  type BakeryPrices,
  type DifficultyId,
  type OvenTerms,
  type StaffContent,
  type StaffRoleId,
} from '../../src/content/schema.ts'
import { BAKERY } from '../../src/engine/bakery.ts'
import { GROCERS } from '../../src/engine/contracts.ts'
import { DIFFICULTIES, FOOD_TRUCK } from '../../src/engine/day.ts'
import { cents } from '../../src/engine/money.ts'
import { STAFF, weeklyWage } from '../../src/engine/staff.ts'
import type { Hire } from '../../src/engine/types.ts'
import { formatDollars } from '../sim/cli.ts'
import {
  AT_TRUCK_HIRE,
  BAKER_HIRE,
  OVENS,
  PRICE_SETS,
  SHIPPED,
  TRUCK_STRATEGIES,
  breakEvenPerOpenDay,
  monthlyBakerWage,
  monthlyBakeryCosts,
  monthlyResult,
  openDaysPerMonth,
  priceSetsFor,
  samePrices,
  savingPerCroissant,
  truckChanges,
  type BakeryCell,
  type BakeryGame,
  type BakeryRun,
} from './bakery.ts'
import { median } from './summary.ts'

// Writes the bakery's balance report, docs/balance/phase-4.md, from what
// `npm run balance -- --bakery` played. No I/O: cli.ts writes the file.

/** A whole `--bakery` run: every difficulty and strategy played. */
export interface BakeryReportRun {
  readonly games: number
  readonly months: number
  /** One run per difficulty and strategy, in any order. */
  readonly runs: readonly BakeryRun[]
}

/** The days a week the truck opens under the starting decisions. */
const DAYS_OPEN = FOOD_TRUCK.startingDecisions.daysOpen.length

/** The croissants a day #157 has the bakery lose under, and win above. */
export const LOSES_UNDER = 80
export const WINS_ABOVE = 150

/**
 * The month #157 has the bakery pay back in at each difficulty, making
 * `WINS_ABOVE` croissants a day with two contracts, at the prices
 * `src/content/difficulty.json` gives that difficulty; within
 * `PAYBACK_SLACK` months either way.
 */
export const PAYBACK_MONTHS: Readonly<Record<DifficultyId, number>> = {
  facile: 4,
  moyen: 6,
  difficile: 9,
}
export const PAYBACK_SLACK = 1

const OVEN_NAMES: Readonly<Record<OvenTerms, string>> = {
  louer: 'leased',
  acheter: 'bought',
}

/** The command that writes the report, with `run`'s options. */
export function bakeryCommand({ games, months }: BakeryReportRun): string {
  return `npm run balance -- --bakery --games ${games} --months ${months}`
}

/** One target of #157, measured. */
export interface BakeryTarget {
  readonly target: string
  readonly measured: string
  readonly met: boolean
}

/**
 * #157's targets against `run`: a croissant made costs less than one
 * bought, at every price set; no game of a truck whose twins sell under
 * `LOSES_UNDER` croissants an open day, at the median, pays back; for each
 * price set, the bakery making `WINS_ABOVE` a day wins in the books with
 * one of its ovens and pays back in most games at every difficulty; and, at
 * each difficulty, the bakery making `WINS_ABOVE` a day with two contracts
 * pays back on `PAYBACK_MONTHS`'s schedule at `difficulties`' prices (see
 * `paybackTarget`). The books count the baker's wages of `staff`.
 */
export function bakeryTargets(
  run: BakeryReportRun,
  difficulties = DIFFICULTIES,
  staff: StaffContent = STAFF,
): BakeryTarget[] {
  const bought = FOOD_TRUCK.products.croissant.unitCostCents
  const madeCheaper = PRICE_SETS.every(
    ({ prices }) => prices.ingredientCostCents < bought,
  )
  const slow = run.runs.filter(
    ({ twins }) => median(twins.map(soldPerOpenDay)) < LOSES_UNDER,
  )
  const slowGames = slow.flatMap(({ cells }) =>
    cells.flatMap(({ paybacks }) => paybacks),
  )
  const slowPaid = slowGames.filter((month) => month !== null).length
  const mostSold = Math.max(
    ...slow.flatMap(({ twins }) => twins.map(soldPerOpenDay)),
  )
  const volume = run.runs.filter(
    ({ strategy }) => strategy === volumeStrategy(),
  )
  return [
    {
      target: `A croissant made costs less than one bought, ${dollars(bought)}`,
      measured: PRICE_SETS.map(
        ({ name, prices }) => `${name} ${dollars(prices.ingredientCostCents)}`,
      ).join(', '),
      met: madeCheaper,
    },
    {
      target: `Under ${LOSES_UNDER} croissants sold an open day, the bakery never pays back within ${run.months} months`,
      measured:
        slow.length === 0
          ? 'no truck sold under that'
          : `${slowPaid} of ${slowGames.length} games pay back, their twins selling at most ${oneDecimal(mostSold)} an open day`,
      met: slow.length > 0 && slowPaid === 0,
    },
    ...PRICE_SETS.map(({ name, prices }): BakeryTarget => {
      const books = OVENS.map((oven) =>
        monthlyResult(
          prices,
          oven,
          WINS_ABOVE,
          DAYS_OPEN,
          BAKERY,
          FOOD_TRUCK,
          staff,
        ),
      )
      const cells = volume.flatMap(({ difficulty, cells: all }) =>
        all
          .filter(({ set }) => set === name)
          .map((cell) => ({ difficulty, cell })),
      )
      const paid = OVENS.some((oven) =>
        difficultyIdSchema.options.every((difficulty) => {
          const games = cells
            .filter((c) => c.difficulty === difficulty && c.cell.oven === oven)
            .flatMap(({ cell }) => cell.paybacks)
          return (
            games.length > 0 &&
            2 * games.filter((month) => month !== null).length > games.length
          )
        }),
      )
      const payingGames = cells.flatMap(({ cell }) => cell.paybacks)
      return {
        target: `Making ${WINS_ABOVE} croissants a day, the bakery wins at the ${name} prices`,
        measured: `${OVENS.map((oven, index) => `${OVEN_NAMES[oven]} ${signedDollars(books[index] ?? 0)}`).join(', ')} a month in the books; ${payingGames.filter((month) => month !== null).length} of ${payingGames.length} games pay back`,
        met: books.some((result) => result > 0) && paid,
      }
    }),
    ...difficultyIdSchema.options.map((difficulty) =>
      paybackTarget(run, difficulty, difficulties.bakery[difficulty]),
    ),
  ]
}

/**
 * #157's payback at `difficulty`, at `prices`: with either oven, the
 * strategy making `WINS_ABOVE` a day with contracts at those prices has a
 * median payback month within `PAYBACK_SLACK` months of `PAYBACK_MONTHS`,
 * and every one of its games and their twins played the whole run, since a
 * bankruptcy leaves the months after it compared with a frozen Encaisse
 * (see `gamePayback`). Measured shows every price set's median, the
 * bankruptcies of the set at `prices` after them, so the report tells which
 * set would.
 */
export function paybackTarget(
  run: BakeryReportRun,
  difficulty: DifficultyId,
  prices: BakeryPrices,
): BakeryTarget {
  const target = PAYBACK_MONTHS[difficulty]
  const played = run.runs.find(
    (each) =>
      each.difficulty === difficulty && each.strategy === contractStrategy(),
  )
  const cells = played?.cells ?? []
  const twinsEnded = (played?.twins ?? []).filter(isBankrupt).length
  const shipped = cells.filter((cell) => samePrices(cell.prices, prices))
  const set = shipped[0]?.set
  const onTime = shipped.some(({ paybacks, games }) => {
    const months = median(paybacks.map((m) => m ?? Number.POSITIVE_INFINITY))
    return (
      Math.abs(months - target) <= PAYBACK_SLACK &&
      twinsEnded === 0 &&
      !games.some(isBankrupt)
    )
  })
  const ended = shipped.flatMap(({ games }) => games).filter(isBankrupt).length
  const sets = [...new Set(cells.map((cell) => cell.set))]
  return {
    target: `At ${DIFFICULTIES.difficulties[difficulty].name}, making ${WINS_ABOVE} croissants a day with two contracts, the bakery pays back in month ${target} at the prices of \`src/content/difficulty.json\`, ${set ?? 'a set the run did not play'}, every game and twin playing the ${run.months} months`,
    measured: [
      ...sets.map(
        (name) =>
          `${name} ${OVENS.map((oven) => {
            const cell = cells.find((c) => c.set === name && c.oven === oven)
            return `${OVEN_NAMES[oven]} ${cell === undefined ? '-' : medianPayback(cell.paybacks)}`
          }).join(', ')}`,
      ),
      `bankrupt at ${set ?? 'those prices'}: ${ended} games, ${twinsEnded} twins`,
    ].join('; '),
    met: onTime,
  }
}

/** Whether `game` ended in bankruptcy before the run's last month. */
export function isBankrupt(game: BakeryGame): boolean {
  return game.endedDay !== null
}

/**
 * The report: how the games were played, #157's targets, the break-even in
 * the books, and each difficulty's payback.
 */
export function formatBakeryReport(run: BakeryReportRun): string {
  const lines = [
    '# Balance report: phase 4',
    '',
    `Generated by \`${bakeryCommand(run)}\`: do not edit by hand, except under the comment at the end that says so. The growth section is \`npm run balance -- --growth\`'s, and this command keeps it. The numbers go stale whenever the engine or the content changes; run the command again then, and commit the file.`,
    '',
    '## What each game plays',
    '',
    `Each difficulty plays seeds 1 to ${run.games} with each truck strategy below. A game opens the bakery on day 0, Monday, May 1st, year 1, with its oven leased or bought, makes its croissants there from that day on, and plays ${run.months} months, to the close of the last day of month ${run.months}. It hires a baker that day (#158), « ${staffRole(BAKER_HIRE.role)} » at ${hourly(BAKER_HIRE)}, the wage they ask (#255), so the owner never bakes: the baker costs a week of training on day 0 and ${dollars(weekly(BAKER_HIRE))} each Friday. Its twin plays the same seed and the same truck, buying its croissants, with no baker: each morning, the bakery makes as many as the twin buys. A strategy with contracts signs them on day 0, game and twin alike, at the terms of \`src/content/grocers.json\`, and renews each one as it ends; each Monday the bakery makes the deliveries' croissants first, within its capacity, those of the grocer who pays more for them first, and the twin buys them. A strategy with an employee at the truck hires one on day 0, game and twin alike, « ${staffRole(AT_TRUCK_HIRE.role)} » at ${hourly(AT_TRUCK_HIRE)}, ${dollars(weekly(AT_TRUCK_HIRE))} a week, who serves beside the owner. No other event card comes up. Every difficulty plays every price set below, whatever \`src/content/difficulty.json\` holds, and, when that file gives it prices off this grid, those too, as « ${SHIPPED} »; the oven and the move are \`src/content/bakery.json\`'s, and the wages \`src/content/staff.json\`'s. The truck opens ${DAYS_OPEN} days a week, as the starting decisions have it, and keeps their other prices and the owner's pay.`,
    '',
    row([
      'Strategy',
      'Croissants a day',
      'Croissant price',
      'Marketing a day',
      'Contracts',
      'Employee at the truck',
    ]),
    row(['---', '---:', '---:', '---:', '---', '---']),
    ...TRUCK_STRATEGIES.map((strategy) => {
      const [price] = truckChanges(strategy)
      return row([
        strategy.name,
        String(strategy.croissantsPerDay),
        price?.kind === 'price' ? dollars(price.price) : '',
        dollars(strategy.marketingDaily),
        strategy.contracts.length === 0
          ? 'none'
          : strategy.contracts
              .map((grocer) => {
                const { name, unitsPerWeek } = GROCERS.grocers[grocer]
                return `${name}, ${unitsPerWeek} a week`
              })
              .join('; '),
        strategy.atTruck ? 'yes' : 'no',
      ])
    }),
    '',
    row(['Prices', 'Ingredients a croissant', 'Rent a month']),
    row(['---', '---:', '---:']),
    ...PRICE_SETS.map(({ name, prices }) =>
      row([
        name,
        dollars(prices.ingredientCostCents),
        dollars(prices.monthlyRentCents),
      ]),
    ),
    ...difficultyIdSchema.options.flatMap((difficulty) =>
      priceSetsFor(difficulty)
        .filter(({ name }) => name === SHIPPED)
        .map(({ name, prices }) =>
          row([
            `${name}, ${DIFFICULTIES.difficulties[difficulty].name}`,
            dollars(prices.ingredientCostCents),
            dollars(prices.monthlyRentCents),
          ]),
        ),
    ),
    '',
    `A game pays back in the first month at whose end its Encaisse is at least its twin's and stays so to month ${run.months}; it never does when it is below then, nor when it or its twin ends in bankruptcy before (#160), since its Encaisse stops there. The gap is the bakery game's Encaisse less its twin's at the end of month ${run.months}. Each column shows the median over the seeds, « Pay back » how many of them do, and « Bankrupt » how many bakery games ended in bankruptcy, their twins' in parentheses.`,
    '',
    '## Targets (#157)',
    '',
    row(['Target', 'Measured', 'Met']),
    row(['---', '---', '---']),
    ...bakeryTargets(run).map(({ target, measured, met }) =>
      row([target, measured, met ? 'yes' : 'no']),
    ),
    '',
    '## Break-even in the books',
    '',
    `From the content alone: what making a croissant saves on buying it at ${dollars(FOOD_TRUCK.products.croissant.unitCostCents)}, against the rent, the oven's lease or month of depreciation (${dollars(BAKERY.oven.priceCents)} over ${BAKERY.oven.usefulLifeMonths} months) and the baker's wages, ${dollars(monthlyBakerWage())} in an average month, the truck open ${DAYS_OPEN} days a week, ${oneDecimal(openDaysPerMonth(DAYS_OPEN))} days in an average month. It leaves out the move, the cash a bought oven takes at once and the baker's week of training, which the games above count.`,
    '',
    row([
      'Prices',
      'Oven',
      'Costs a month',
      'Saving a croissant',
      'Break-even, croissants an open day',
      `Result a month at ${LOSES_UNDER} a day`,
      `At ${WINS_ABOVE} a day`,
    ]),
    row(['---', '---', '---:', '---:', '---:', '---:', '---:']),
    ...PRICE_SETS.flatMap(({ name, prices }) =>
      OVENS.map((oven) =>
        row([
          name,
          OVEN_NAMES[oven],
          dollars(monthlyBakeryCosts(prices, oven)),
          dollars(savingPerCroissant(prices)),
          oneDecimal(breakEvenPerOpenDay(prices, oven, DAYS_OPEN)),
          signedDollars(monthlyResult(prices, oven, LOSES_UNDER, DAYS_OPEN)),
          signedDollars(monthlyResult(prices, oven, WINS_ABOVE, DAYS_OPEN)),
        ]),
      ),
    ),
    '',
    '## Payback by difficulty',
    '',
    "Made, sold and the energy at the close are a game's average over the days the truck opened; the twin's follow in parentheses. Made counts the croissants the bakery made for the deliveries too, and sold only those the truck sold.",
    ...difficultyIdSchema.options.flatMap((difficulty) =>
      difficultySection(run, difficulty),
    ),
  ]
  return `${lines.join('\n')}\n`
}

function difficultySection(
  run: BakeryReportRun,
  difficulty: DifficultyId,
): string[] {
  const runs = TRUCK_STRATEGIES.flatMap(({ name }) =>
    run.runs.filter(
      (each) => each.difficulty === difficulty && each.strategy === name,
    ),
  )
  return [
    '',
    `### ${DIFFICULTIES.difficulties[difficulty].name}`,
    '',
    row([
      'Strategy',
      'Prices',
      'Oven',
      'Made',
      'Sold',
      'Energy',
      'Pay back',
      'Payback month',
      `Gap, month ${run.months}`,
      'Bankrupt',
    ]),
    row([
      '---',
      '---',
      '---',
      '---:',
      '---:',
      '---:',
      '---:',
      '---:',
      '---:',
      '---:',
    ]),
    ...runs.flatMap(({ strategy, twins, cells }) =>
      cells.map((cell) => cellRow(strategy, twins, cell)),
    ),
  ]
}

function cellRow(
  strategy: string,
  twins: readonly BakeryGame[],
  { set, oven, games, paybacks }: BakeryCell,
): string {
  const paid = paybacks.filter((month) => month !== null).length
  const gaps = games.map(
    (game, index) =>
      (game.cashAtMonthEnds.at(-1) ?? 0) -
      (twins[index]?.cashAtMonthEnds.at(-1) ?? 0),
  )
  const sold = `${oneDecimal(median(games.map(soldPerOpenDay)))} (${oneDecimal(median(twins.map(soldPerOpenDay)))})`
  const energy = `${oneDecimal(median(games.map(energyPerOpenDay)))} (${oneDecimal(median(twins.map(energyPerOpenDay)))})`
  return row([
    strategy,
    set,
    OVEN_NAMES[oven],
    oneDecimal(median(games.map(madePerOpenDay))),
    sold,
    energy,
    `${paid} of ${paybacks.length}`,
    medianPayback(paybacks),
    signedDollars(median(gaps)),
    `${games.filter(isBankrupt).length} (${twins.filter(isBankrupt).length})`,
  ])
}

/**
 * The median payback month, « never » when it falls on a game that never
 * pays back. Throws a RangeError on no games.
 */
export function medianPayback(paybacks: readonly (number | null)[]): string {
  const months = median(
    paybacks.map((month) => month ?? Number.POSITIVE_INFINITY),
  )
  return Number.isFinite(months) ? oneDecimal(months) : 'never'
}

/**
 * The strategy that makes `WINS_ABOVE` croissants a day, with no contract
 * and the owner alone at the truck.
 */
function volumeStrategy(): string | undefined {
  return TRUCK_STRATEGIES.find(
    ({ croissantsPerDay, contracts, atTruck }) =>
      croissantsPerDay === WINS_ABOVE && contracts.length === 0 && !atTruck,
  )?.name
}

/**
 * The strategy that makes `WINS_ABOVE` croissants a day with contracts and
 * the owner alone at the truck, as #157 has it.
 */
function contractStrategy(): string | undefined {
  return TRUCK_STRATEGIES.find(
    ({ croissantsPerDay, contracts, atTruck }) =>
      croissantsPerDay === WINS_ABOVE && contracts.length > 0 && !atTruck,
  )?.name
}

/** The role's name, as the player reads it. */
function staffRole(role: StaffRoleId): string {
  return STAFF.roles[role].name
}

/** The hire's wage an hour and their role's hours: `$22.50 an hour, 16 h a week`. */
function hourly({ role, hourlyWage }: StaffHire): string {
  const { hoursPerWeek } = STAFF.roles[role]
  return `${dollars(hourlyWage)} an hour, ${hoursPerWeek} h a week`
}

/** The hire's weekly wage. */
function weekly(hire: StaffHire): number {
  return weeklyWage(hire)
}

/** A hire of the tools, with the wage they get. */
type StaffHire = Pick<Hire, 'role' | 'hourlyWage'>

export function soldPerOpenDay(game: BakeryGame): number {
  return game.openDays === 0 ? 0 : game.croissantsSold / game.openDays
}

export function madePerOpenDay(game: BakeryGame): number {
  return game.openDays === 0 ? 0 : game.croissantsMade / game.openDays
}

export function energyPerOpenDay(game: BakeryGame): number {
  return game.openDays === 0 ? 0 : game.energyAtOpenCloses / game.openDays
}

function oneDecimal(value: number): string {
  return value.toFixed(1)
}

/** `$1,234.56`, from cents, rounded to the cent. */
function dollars(amount: number): string {
  return formatDollars(cents(Math.round(amount)))
}

/** `+$1,234.56` or `-$1,234.56`, from cents, rounded to the cent. */
function signedDollars(amount: number): string {
  const rounded = Math.round(amount)
  return rounded > 0 ? `+${dollars(rounded)}` : dollars(rounded)
}

function row(values: readonly string[]): string {
  return `| ${values.join(' | ')} |`
}
