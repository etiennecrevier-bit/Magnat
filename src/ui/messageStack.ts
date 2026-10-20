import { createStore, type StoreApi } from 'zustand'
import { received, startMessages, type Message } from './messageTriggers.ts'
import type { GameStore } from './store.ts'

// The messages the game sends, held in one place so the stack under the
// top bar and the top bar's chip read the same ones.

export interface MessageStackState {
  /** Newest first, at most `MAX_MESSAGES`. */
  readonly messages: readonly Message[]
  readonly receive: (message: Message) => void
  readonly dismiss: (id: number) => void
}

export type MessageStack = StoreApi<MessageStackState>

export function createMessageStack(): MessageStack {
  return createStore<MessageStackState>()((set, get) => ({
    messages: [],
    receive: (message) => set({ messages: received(get().messages, message) }),
    dismiss: (id) =>
      set({ messages: get().messages.filter((message) => message.id !== id) }),
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
  stack.setState({ messages: [] })
  return startMessages(store, stack.getState().receive)
}

/** The id of the message `id` on the page, which its chip focuses. */
export function messageElementId(id: number): string {
  return `message-card-${id}`
}
