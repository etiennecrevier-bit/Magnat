import type {
  EventContent,
  PostcardId,
  Postcards,
  PostcardTarget,
} from '../content/schema.ts'
import { EVENTS } from '../engine/day.ts'
import { TUTORIAL } from '../engine/tutorial.ts'
import type { Day, GameState } from '../engine/types.ts'
import { bakeryBoard } from './bakeryBoard.ts'
import { dreamBoard } from './dreamBoard.ts'
import { staffBoard } from './staffBoard.ts'
import type { GameStore, GameStoreState } from './store.ts'

// Réal's postcards from Florida (#239): once the tutorial is over or
// skipped, each new thing the game opens to the player is announced once,
// in one sentence, pointing at where it is. They read what the panels
// already read; no rule is decided here.

/** The shipped postcards, from `tutorial.json`. */
export const POSTCARDS: Postcards = TUTORIAL.postcards

/** A postcard as the player receives it. */
export interface Postcard {
  readonly id: PostcardId
  readonly from: string
  readonly text: string
  /** The dock's button it points at. */
  readonly target: PostcardTarget
  /** The morning it came. */
  readonly day: Day
}

/** What the postcards read of the store. */
export type PostcardFacts = Pick<GameStoreState, 'game' | 'monthReport'>

/**
 * Whether `game` gets postcards: never in a Défi, nor while its tutorial
 * is under way; a game without a tutorial gets them from its first day.
 */
export function postcardsEligible(game: GameState): boolean {
  if (game.challenge !== null) return false
  return game.tutorial === undefined || game.tutorial.done
}

/**
 * The event cards in which a grocer offers a contract: those a draw brings
 * for a grocer, the renewals, which only follow a contract, aside.
 */
export function contractOffers(events: EventContent = EVENTS): Set<string> {
  return new Set(
    events.events
      .filter(
        ({ conditions }) =>
          conditions?.grocer !== undefined && conditions.followUpOnly !== true,
      )
      .map(({ id }) => id),
  )
}

/**
 * Whether what postcard `id` announces holds in `facts`, as the panels
 * show it: a grocer's offer waits or came already; « Fournil » takes an
 * opening; « Équipe » may hire someone; « Améliorations » sells its next
 * rung of either ladder this morning; the encaisse closed below zero last
 * night; a « Bilan du mois » came; « Ville » is there, as outside a Défi
 * it always is.
 */
export function postcardHolds(
  id: PostcardId,
  { game, monthReport }: PostcardFacts,
  offers: ReadonlySet<string> = contractOffers(),
): boolean {
  switch (id) {
    case 'contrat': {
      const pending = game.events.pending?.event
      return (
        (pending !== undefined && offers.has(pending)) ||
        game.events.history.some(({ event }) => offers.has(event))
      )
    }
    case 'fournil':
      return bakeryBoard(game).options.some(({ allowed }) => allowed)
    case 'embauche': {
      const staff = staffBoard(game)
      return !staff.full && staff.candidates.length > 0
    }
    case 'amelioration': {
      const { personal, company } = dreamBoard(game)
      return personal.next?.buyable === true || company.next?.buyable === true
    }
    case 'rouge':
      return game.financing.belowZeroSince !== null
    case 'bilanMois':
      return monthReport !== null
    case 'ville':
      return true
  }
}

/**
 * The postcards due in `facts`, in the content's order: what they announce
 * holds, the game gets postcards and they are not in `skip`, nor shown
 * yet. Only those checked cost anything, so `skip` the ones already known.
 */
export function duePostcards(
  facts: PostcardFacts,
  skip: ReadonlySet<PostcardId> = new Set(),
  content: Postcards = POSTCARDS,
  offers: ReadonlySet<string> = contractOffers(),
): PostcardId[] {
  const { game } = facts
  if (!postcardsEligible(game)) return []
  const shown = game.postcardsShown ?? []
  return content.items
    .map(({ id }) => id)
    .filter(
      (id) =>
        !skip.has(id) &&
        !shown.includes(id) &&
        postcardHolds(id, facts, offers),
    )
}

/**
 * Hands `onPostcard` each postcard the game in `store` calls for, once a
 * game, and notes it shown in the game (`markPostcardsShown`) so a save
 * keeps it.
 *
 * It looks at the game as it starts, at each change to the game or the «
 * Bilan du mois », and at each morning `advance` goes through on the way,
 * so a close below zero or a rung within reach that a multi-day advance
 * passes still counts. What it saw due waits in turn: one postcard a game
 * day at most, in the content's order, the others on the mornings after.
 *
 * Inside the store's notification it notes them shown a microtask later,
 * since changing the game there would hand the subscribers after it the
 * same day twice. A game `startGame` plays after it started is not its
 * own: it sends and notes nothing in it, for `startMessageStack` to start
 * again. Returns a function that stops it.
 */
export function startPostcards(
  store: GameStore,
  onPostcard: (postcard: Postcard) => void,
  content: Postcards = POSTCARDS,
  events: EventContent = EVENTS,
): () => void {
  const offers = contractOffers(events)
  // Due on a morning seen, not handed over yet.
  const waiting = new Set<PostcardId>()
  // Handed over, perhaps not noted in the game yet.
  const sent = new Set<PostcardId>()
  let sentOn: Day | null = null
  let stopped = false
  // The game it was started for: one started since is not its own.
  const started = store.getState().gamesStarted
  const own = () => !stopped && store.getState().gamesStarted === started

  const notice = (facts: PostcardFacts) => {
    const skip = new Set([...waiting, ...sent])
    for (const id of duePostcards(facts, skip, content, offers)) waiting.add(id)
  }

  const send = (later: boolean) => {
    const { game } = store.getState()
    if (!own() || !postcardsEligible(game) || sentOn === game.day) return
    const shown = game.postcardsShown ?? []
    const next = content.items.find(
      ({ id }) => waiting.has(id) && !shown.includes(id),
    )
    if (next === undefined) return
    waiting.delete(next.id)
    sent.add(next.id)
    sentOn = game.day
    onPostcard({
      id: next.id,
      from: content.from,
      text: next.text,
      target: next.target,
      day: game.day,
    })
    const mark = () => {
      if (own()) store.getState().markPostcardsShown([next.id])
    }
    if (later) queueMicrotask(mark)
    else mark()
  }

  notice(store.getState())
  send(false)
  const stopMornings = store.getState().watchMornings((morning) => {
    if (own())
      notice({ game: morning, monthReport: store.getState().monthReport })
  })
  const unsubscribe = store.subscribe((state, previous) => {
    if (
      state.game === previous.game &&
      state.monthReport === previous.monthReport
    ) {
      return
    }
    if (!own()) return
    notice(state)
    send(true)
  })
  return () => {
    stopped = true
    stopMornings()
    unsubscribe()
  }
}
