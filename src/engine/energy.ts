import type { EnergyContent } from '../content/schema.ts'

// The owner's energy. Working wears them out, a busy day more than a quiet
// one, and nights and days off bring them back. A tired owner serves slower
// and botches more of what they make. Nothing here draws from the generator.

/**
 * The top of the owner's energy, where a game starts: a scale, not a
 * tunable. Energy runs from 0 to this.
 */
export const FULL_ENERGY = 100

/**
 * How worn out the owner is: « Reposé » (`rested`), « Fatigué » (`tired`)
 * or « Épuisé » (`exhausted`).
 */
export type Fatigue = 'rested' | 'tired' | 'exhausted'

/** How fatigue changes the owner's work at the counter. */
export interface FatigueEffects {
  /** How much longer serving a customer takes: 0.2 is 20 % longer. */
  readonly serviceTimeIncrease: number
  /** The share of the units made that are botched and made again. */
  readonly botchedShare: number
}

const RESTED: FatigueEffects = { serviceTimeIncrease: 0, botchedShare: 0 }

/** What a day did to the owner, as `energyAtClose` reads it. */
export interface Workday {
  /** Whether the truck opened. */
  readonly open: boolean
  /** The customers who reached the counter. */
  readonly customersServed: number
  /** Whether it was payday with the owner's personal cash below zero. */
  readonly stressed: boolean
}

/**
 * How worn out an owner with `energy` is: exhausted below
 * `exhausted.below`, tired below `tired.below`, rested otherwise.
 */
export function fatigueOf(energy: number, content: EnergyContent): Fatigue {
  if (energy < content.exhausted.below) return 'exhausted'
  if (energy < content.tired.below) return 'tired'
  return 'rested'
}

/** How an owner with `energy` works: as usual when rested. */
export function effectsOf(
  energy: number,
  content: EnergyContent,
): FatigueEffects {
  const fatigue = fatigueOf(energy, content)
  if (fatigue === 'rested') return RESTED
  const { serviceTimeIncrease, botchedShare } = content[fatigue]
  return { serviceTimeIncrease, botchedShare }
}

/**
 * The owner's energy at the close of a day they started with `energy`. A
 * day the truck opens costs `openDayCost`, plus `costPerCustomerServed` for
 * each customer served; a day it is closed gives `closedDayRecovery` back.
 * Then, on a payday in debt, the stress takes `debtStress`. Each change
 * stops at 0 and at `FULL_ENERGY`.
 */
export function energyAtClose(
  energy: number,
  { open, customersServed, stressed }: Workday,
  content: EnergyContent,
): number {
  let level = open
    ? within(
        energy -
          (content.openDayCost +
            content.costPerCustomerServed * customersServed),
      )
    : within(energy + content.closedDayRecovery)
  if (stressed) level = within(level - content.debtStress)
  return level
}

/** The owner's energy the morning after a close at `energy`. */
export function nightRest(energy: number, content: EnergyContent): number {
  return within(energy + content.nightRecovery)
}

function within(energy: number): number {
  return Math.min(FULL_ENERGY, Math.max(0, energy))
}
