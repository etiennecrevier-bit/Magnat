import { createStore, type StoreApi } from 'zustand'
import messageStreet from '../content/messageStreet.json'
import type { Day } from '../engine/types.ts'
import { received, startMessages, type Message } from './messageTriggers.ts'
import type { GameStore } from './store.ts'

// The messages the game sends, held in one place so the stack under the
// top bar and the top bar's chip read the same ones.

export interface MessageStackState {
  /** Newest first, at most `MAX_MESSAGES`. */
  readonly messages: readonly Message[]
  /**
   * The day the chip last brought every message back on the street, or
   * `null`: from then, each shows again for `STREET_DAYS` (see
   * `streetMessages`).
   */
  readonly shownAgainOn: Day | null
  readonly receive: (message: Message) => void
  readonly dismiss: (id: number) => void
  /** Brings every message in the stack back on the street from `today`. */
  readonly showAgain: (today: Day) => void
}

/** The game days a message shows on the street from its day. */
export const STREET_DAYS = messageStreet.streetDays

/**
 * The messages the street shows on `today`, newest first: each for
 * `STREET_DAYS` from its day, or from `shownAgainOn` when the chip brought
 * it back since. The others fold into the chip, which still counts them.
 */
export function streetMessages(
  messages: readonly Message[],
  today: Day,
  shownAgainOn: Day | null = null,
): readonly Message[] {
  return messages.filter(
    ({ day }) => today < Math.max(day, shownAgainOn ?? day) + STREET_DAYS,
  )
}

export type MessageStack = StoreApi<MessageStackState>

export function createMessageStack(): MessageStack {
  return createStore<MessageStackState>()((set, get) => ({
    messages: [],
    shownAgainOn: null,
    receive: (message) => set({ messages: received(get().messages, message) }),
    dismiss: (id) =>
      set({ messages: get().messages.filter((message) => message.id !== id) }),
    showAgain: (today) => set({ shownAgainOn: today }),
  }))
}

/** The app's stack. Tests build their own with `createMessageStack`. */
export const messageStack = createMessageStack()

/**
 * Empties `stack`, then fills it with the messages the game in `store`
 * calls for from now on. Returns what stops it. Started again for each
 * game, so nothing of the last game's messages stays.
 */
export function startMessageStack(
  store: GameStore,
  stack: MessageStack = messageStack,
): () => void {
  stack.setState({ messages: [], shownAgainOn: null })
  return startMessages(store, stack.getState().receive)
}

/** The id of the message `id` on the page, which its chip focuses. */
export function messageElementId(id: number): string {
  return `message-card-${id}`
}
