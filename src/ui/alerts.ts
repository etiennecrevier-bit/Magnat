import { flushSync } from 'react-dom'
import { mondayOf } from '../engine/calendar.ts'
import type { GameState } from '../engine/types.ts'
import { openContracts } from './cityLinks.ts'
import type { IconName } from './icons.tsx'
import {
  messageElementId,
  messageStack,
  type MessageStack,
} from './messageStack.ts'
import { gameStore, type GameStore } from './store.ts'

// Days per game week, a calendar fact.
const DAYS_PER_WEEK = 7

/**
 * The grocers' deliveries missed this week, as of the morning of
 * `game.day`: read from the engine's record of misses, so a miss that ended
 * a contract, or missed its last week, counts as well as one that left it
 * running.
 */
export function missedThisWeek({
  day,
  contracts,
}: Pick<GameState, 'day' | 'contracts'>): number {
  const monday = mondayOf(day)
  return contracts.missed.filter(
    (missed) => missed.day >= monday && missed.day < monday + DAYS_PER_WEEK,
  ).length
}

export type AlertId = 'missed' | 'messages'

/** A chip at the top right: an icon and words, never a colour alone. */
export interface TopAlert {
  readonly id: AlertId
  readonly icon: IconName
  readonly label: string
}

/**
 * The chips at the top right, the missed deliveries first: « Livraison
 * manquée » while one was missed this week, « 1 message » while messages
 * wait in the stack; none when nothing waits.
 */
export function topAlerts({
  missed,
  messages,
}: {
  readonly missed: number
  readonly messages: number
}): TopAlert[] {
  const alerts: TopAlert[] = []
  if (missed > 0) {
    alerts.push({
      id: 'missed',
      icon: 'alerte',
      label:
        missed === 1 ? 'Livraison manquée' : `${missed} livraisons manquées`,
    })
  }
  if (messages > 0) {
    alerts.push({
      id: 'messages',
      icon: 'cahier',
      label: messages === 1 ? '1 message' : `${messages} messages`,
    })
  }
  return alerts
}

/**
 * What a chip does: a missed delivery opens the « Contrats » (see
 * `openContracts`); the messages chip brings the messages in `stack` back
 * on the street, those folded into it included, and moves the focus to the
 * newest.
 */
export function followAlert(
  id: AlertId,
  stack: MessageStack = messageStack,
  store: GameStore = gameStore,
  page: Pick<Document, 'getElementById'> = document,
): void {
  if (id === 'missed') {
    openContracts(store)
    return
  }
  const newest = stack.getState().messages[0]
  if (newest === undefined) return
  // Rendered now, so the newest is on the page to take the focus.
  flushSync(() => stack.getState().showAgain(store.getState().game.day))
  page.getElementById(messageElementId(newest.id))?.focus()
}
