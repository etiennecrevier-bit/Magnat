import type { OvenTerms } from '../content/schema.ts'
import type { Cents } from '../engine/money.ts'
import type { BakeryBoard, BakeryStatus } from './bakeryBoard.ts'
import { formatDayAndMonth } from './formatGameDate.ts'
import { formatCount, formatMoney } from './formatMoney.ts'
import type { StatusFact, StatusLine } from './productFacts.ts'
import type { TipContent, TipRow } from './tooltip.ts'

// What the « Fournil » tab says (#203): one status line under its title and
// under its source, the rest in the tooltips of its two « (i) ».

// French puts a no-break space (U+00A0) before a colon.
const COLON = ' :'

export const OVEN_NAMES: Readonly<Record<OvenTerms, string>> = {
  louer: 'four loué',
  acheter: 'four acheté',
}

function perMonth(amount: Cents): string {
  return `${formatMoney(amount)} par mois`
}

/** Where the bakery stands today: « Ouvert depuis le 3 juin · four loué ». */
function todayFact(status: BakeryStatus): StatusFact {
  switch (status.kind) {
    case 'closed':
      return { tone: 'off', text: 'Fermé' }
    case 'open':
      return {
        tone: 'ok',
        text: `Ouvert depuis le ${formatDayAndMonth(status.since)} · ${OVEN_NAMES[status.oven]}`,
      }
    case 'notice':
      return {
        tone: 'warn',
        text: `En préavis${COLON} dernier jour le ${formatDayAndMonth(status.lastDay)}`,
      }
  }
}

/** Where it will stand tomorrow, after « Demain : ». */
function tomorrowText(status: BakeryStatus): string {
  switch (status.kind) {
    case 'closed':
      return 'fermé'
    case 'open':
      return `ouvert · ${OVEN_NAMES[status.oven]}`
    case 'notice':
      return `en préavis, dernier jour le ${formatDayAndMonth(status.lastDay)}`
  }
}

/** The bakery's status line: today, then tomorrow when the plan changes it. */
export function bakeryLine(board: BakeryBoard): StatusLine {
  return {
    fact: todayFact(board.today),
    tomorrow:
      board.tomorrow === null
        ? null
        : `Demain${COLON} ${tomorrowText(board.tomorrow)}`,
  }
}

/** The source's status line: that the croissants are bought anyway. */
export function sourceLine(board: BakeryBoard): StatusLine {
  return {
    fact: board.boughtAnyway
      ? {
          tone: 'warn',
          text: 'Sans fournil ouvert, les croissants sont achetés.',
        }
      : null,
    tomorrow: null,
  }
}

/**
 * The tooltip beside opening and closing: the notice closing now would
 * give, then what a bakery costs and makes.
 */
export function bakeryCostsTip(board: BakeryBoard): TipContent {
  return {
    title: 'Ce que coûte le fournil',
    ...(board.closingLastDay === null
      ? {}
      : {
          text: `Fermer donne un préavis${COLON} dernier jour le ${formatDayAndMonth(board.closingLastDay)}.`,
        }),
    rows: [
      { label: 'Déménagement', value: formatMoney(board.movingCost) },
      { label: 'Loyer', value: perMonth(board.monthlyRent) },
      { label: 'Four loué', value: perMonth(board.monthlyLease) },
      {
        label: 'Four acheté',
        value: board.ownsOven ? 'déjà à vous' : formatMoney(board.ovenPrice),
      },
      {
        label: 'Capacité',
        value: `${formatCount(board.capacity)} croissants par jour`,
      },
    ],
  }
}

/**
 * The tooltip beside the source: the unit cost of a croissant bought and
 * made, then, under a thin line, the bakery's fixed costs a month: the
 * planned one's, or each opening's when none is planned. Never a break-even
 * figure.
 */
export function unitCostTip(board: BakeryBoard): TipContent {
  const fixed: { label: string; amount: Cents }[] =
    board.fixedCosts !== null
      ? [{ label: 'Frais fixes du fournil', amount: board.fixedCosts }]
      : board.options.flatMap(({ oven, fixedCosts }) =>
          fixedCosts === null
            ? []
            : [
                {
                  label: `Frais fixes, ${OVEN_NAMES[oven]}`,
                  amount: fixedCosts,
                },
              ],
        )
  return {
    title: "Coût d'un croissant",
    rows: [
      { label: 'Acheté', value: formatMoney(board.boughtUnitCost) },
      { label: 'Fabriqué', value: formatMoney(board.madeUnitCost) },
      ...fixed.map(({ label, amount }, index): TipRow => ({
        label,
        value: perMonth(amount),
        ...(index === 0 ? { divider: true } : {}),
      })),
    ],
  }
}
