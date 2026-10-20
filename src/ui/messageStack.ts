import { createStore, type StoreApi } from 'zustand'
import messageStreet from '../content/messageStreet.json'
import type { PostcardTarget } from '../content/schema.ts'
import type { Day } from '../engine/types.ts'
import { DOCK_ITEMS, isDockItemOpen } from './dock.ts'
import {
  messageIds,
  received,
  startMessages,
  type Message,
} from './messageTriggers.ts'
import { startPostcards } from './postcards.ts'
import type { GameStore } from './store.ts'

// The messages the game sends, held in one place so the stack under the
// top bar and the top bar's chip read the same ones.

export interface MessageStackState {
  /** Newest first, at most `MAX_MESSAGES` and the postcards (see `received`). */
  readonly messages: readonly Message[]
  /**
   * The dock's buttons a postcard pointed at that the player has not
   * opened since, which pulse softly until they do.
   */
  readonly pulsing: readonly PostcardTarget[]
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
  /** Stops the pulse on `target`, as the player opened it. */
  readonly opened: (target: PostcardTarget) => void
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
  return messages.filter(({ day, arrivedOn = day }) => {
    return today < Math.max(arrivedOn, shownAgainOn ?? arrivedOn) + STREET_DAYS
  })
}

export type MessageStack = StoreApi<MessageStackState>

export function createMessageStack(): MessageStack {
  return createStore<MessageStackState>()((set, get) => ({
    messages: [],
    pulsing: [],
    shownAgainOn: null,
    receive: (message) => {
      const target = message.postcard?.target
      const { messages, pulsing } = get()
      set({
        messages: received(messages, message),
        ...(target === undefined || pulsing.includes(target)
          ? {}
          : { pulsing: [...pulsing, target] }),
      })
    },
    dismiss: (id) =>
      set({ messages: get().messages.filter((message) => message.id !== id) }),
    showAgain: (today) => set({ shownAgainOn: today }),
    opened: (target) => {
      const { pulsing } = get()
      if (pulsing.includes(target))
        set({ pulsing: pulsing.filter((item) => item !== target) })
    },
  }))
}

/** The app's stack. Tests build their own with `createMessageStack`. */
export const messageStack = createMessageStack()

// The store and game each stack was last started for.
const startedFor = new WeakMap<
  MessageStack,
  { readonly store: GameStore; readonly game: number }
>()

/**
 * Empties `stack`, then fills it with the messages the game in `store`
 * calls for from now on, and with Réal's postcards (see `startPostcards`),
 * from one run of ids. A postcard's button in the dock pulses until what
 * it opens is open, by a click, a key or a link alike; one already open
 * as the postcard comes does not. Returns what stops it. Started again for
 * each game, so nothing of the last game's messages stays; started again
 * for the same game, as React replays an effect, it keeps them, and the
 * postcards and pulses they hold.
 */
export function startMessageStack(
  store: GameStore,
  stack: MessageStack = messageStack,
): () => void {
  const game = store.getState().gamesStarted
  const last = startedFor.get(stack)
  if (last?.store !== store || last.game !== game) {
    stack.setState({ messages: [], pulsing: [], shownAgainOn: null })
    startedFor.set(stack, { store, game })
  }
  const nextId = messageIds(
    Math.max(-1, ...stack.getState().messages.map(({ id }) => id)) + 1,
  )
  const { receive, opened } = stack.getState()
  const isOpen = (target: PostcardTarget) => {
    const item = DOCK_ITEMS.find(({ id }) => id === target)
    return item !== undefined && isDockItemOpen(item, store.getState())
  }
  const stopMessages = startMessages(
    store,
    receive,
    undefined,
    undefined,
    undefined,
    nextId,
  )
  const stopPostcards = startPostcards(store, ({ id, target, ...card }) => {
    const today = store.getState().game.day
    receive({
      id: nextId(),
      kind: 'postcard',
      ...card,
      ...(today > card.day ? { arrivedOn: today } : {}),
      postcard: { id, target },
    })
    if (isOpen(target)) opened(target)
  })
  const stopPulse = store.subscribe(() => {
    for (const target of stack.getState().pulsing) {
      if (isOpen(target)) opened(target)
    }
  })
  return () => {
    stopMessages()
    stopPostcards()
    stopPulse()
  }
}

/** The id of the message `id` on the page, which its chip focuses. */
export function messageElementId(id: number): string {
  return `message-card-${id}`
}
