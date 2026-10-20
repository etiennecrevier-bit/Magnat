import { monthsSinceStart } from '../engine/calendar.ts'
import { housingLabels } from '../engine/dream.ts'
import { LABELS } from '../engine/personal.ts'
import type { Day, PersonalAccount, PersonalMovement } from '../engine/types.ts'

/** A movement of the owner's personal account, as « Vos finances » lists it. */
export interface MonthMovement extends PersonalMovement {
  /** Whether it is a « Loyer », or a home's payment, that went unpaid. */
  readonly unpaid: boolean
}

/**
 * The movements of `account` in the calendar month of `lastPlayed`, newest
 * first. The account stands as of the close of the last day played, so on
 * the morning of the 1st it still shows the month just ended. Each « Loyer »,
 * or payment of a home of « Améliorations », on one of the account's `unpaidRents`
 * is `unpaid`. Empty before any day
 * is played, when `lastPlayed` is null.
 */
export function monthMovements(
  account: PersonalAccount,
  lastPlayed: Day | null,
): MonthMovement[] {
  if (lastPlayed === null) return []
  const month = monthsSinceStart(lastPlayed)
  const unpaid = new Set(account.unpaidRents)
  const rents = new Set([LABELS.rent, ...housingLabels()])
  return account.movements
    .filter((movement) => monthsSinceStart(movement.day) === month)
    .map((movement) => ({
      ...movement,
      unpaid: rents.has(movement.label) && unpaid.has(movement.day),
    }))
    .reverse()
}
