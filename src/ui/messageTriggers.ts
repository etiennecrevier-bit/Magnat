import type {
  EnergyContent,
  GrocerContent,
  GrocerId,
  PostcardId,
  PostcardTarget,
} from '../content/schema.ts'
import {
  loadMessages,
  type MessageKind,
  type Messages,
  type OwnWordsKind,
} from '../content/messages.ts'
import { GROCERS } from '../engine/contracts.ts'
import { ENERGY } from '../engine/day.ts'
import { fatigueOf } from '../engine/energy.ts'
import { STAFF, STAFF_MEMO, staffMemo, staffNotices } from '../engine/staff.ts'
import type { Day, GameState } from '../engine/types.ts'
import { entriesSince } from '../finance/journal.ts'
import type { GameStore } from './store.ts'

/** The shipped messages, validated once. */
export const MESSAGES: Messages = loadMessages()

// Days per game week, a calendar fact: day 0 is a Monday, so each game week
// runs from a Monday to a Sunday.
const DAYS_PER_WEEK = 7

/**
 * The most messages kept, Réal's postcards aside: a new one pushes the
 * oldest out.
 */
export const MAX_MESSAGES = 3

/** A message the player receives: one the game calls for, or a postcard. */
export interface Message {
  /** Unique among the messages received since the game screens opened. */
  readonly id: number
  readonly kind: MessageKind | OwnWordsKind | 'postcard'
  /** Who it is from, as the card shows it. */
  readonly from: string
  readonly text: string
  /** The day it is about. */
  readonly day: Day
  /**
   * The day it came, when later than `day`: a postcard about a morning a
   * multi-day advance went through comes as the advance ends.
   */
  readonly arrivedOn?: Day
  /** A postcard's id and the dock's button it points at; absent otherwise. */
  readonly postcard?: {
    readonly id: PostcardId
    readonly target: PostcardTarget
  }
}

/** Something that calls for a message. */
export type Trigger =
  | {
      readonly kind: MessageKind
      /**
       * The day it is about: the rent's, the morning the owner woke up on,
       * the delivery's, or the morning the employee started or left.
       */
      readonly day: Day
      /**
       * Who it is from, when the game names them: « Normand, Épicerie Chez
       * Normand », or the employee. The other kinds' sender is the
       * content's.
       */
      readonly from?: string
    }
  | {
      /** An employee's own words (#255): their warning, or their goodbye. */
      readonly kind: OwnWordsKind
      /** The morning they warned or quit. */
      readonly day: Day
      /** The employee. */
      readonly from: string
      /** Their line, theirs alone. */
      readonly text: string
    }

/** What the messages remember from one game to the next. */
export interface MessageMemory {
  /** The game week the owner last said they were exhausted; null if never. */
  readonly exhaustedWeek: number | null
  /**
   * Whether a decision left the owner exhausted since the last day played,
   * such as an event's choice that costs energy: they did not wake up so.
   */
  readonly exhaustedByDecision: boolean
}

export const NO_MEMORY: MessageMemory = {
  exhaustedWeek: null,
  exhaustedByDecision: false,
}

/**
 * What calls for a message once the game moves on from `previous` to
 * `next`, oldest first. Nothing does unless days were played. Each rent that
 * went unpaid on the days played calls for the landlord's. On those days
 * too, the grocers' and the employees', theirs in their own words from
 * `messages` included (see `contractTriggers`, `staffTriggers` and
 * `ownWordsTriggers`). Waking up exhausted, from a morning that was not
 * (before a decision left the owner exhausted, as
 * `memory.exhaustedByDecision` keeps), calls for the owner's own, once a
 * game week at most: the week of `memory.exhaustedWeek` is skipped. Returns
 * the memory to keep.
 */
export function triggersBetween(
  previous: GameState,
  next: GameState,
  memory: MessageMemory,
  energy: EnergyContent = ENERGY,
  grocers: GrocerContent = GROCERS,
  messages: Messages = MESSAGES,
): { triggers: Trigger[]; memory: MessageMemory } {
  const exhausted = (state: GameState) =>
    fatigueOf(state.energy, energy) === 'exhausted'
  if (next.day === previous.day) {
    if (exhausted(previous) || !exhausted(next)) return { triggers: [], memory }
    return { triggers: [], memory: { ...memory, exhaustedByDecision: true } }
  }
  if (next.day < previous.day) {
    return { triggers: [], memory: { ...memory, exhaustedByDecision: false } }
  }
  const triggers: Trigger[] = [
    ...next.personal.unpaidRents
      .filter((day) => day >= previous.day)
      .map((day): Trigger => ({ kind: 'landlord', day })),
    ...contractTriggers(previous, next, grocers),
    ...staffTriggers(previous, next),
    ...ownWordsTriggers(previous, next, messages),
  ].sort((a, b) => a.day - b.day)
  const week = Math.floor(next.day / DAYS_PER_WEEK)
  const wokeExhausted =
    (!exhausted(previous) || memory.exhaustedByDecision) && exhausted(next)
  const kept: MessageMemory = { ...memory, exhaustedByDecision: false }
  if (wokeExhausted && memory.exhaustedWeek !== week) {
    triggers.push({ kind: 'exhausted', day: next.day })
    return { triggers, memory: { ...kept, exhaustedWeek: week } }
  }
  return { triggers, memory: kept }
}

/**
 * What the grocers' contracts call for over the days played from
 * `previous` to `next`, in that order: each delivery missed, the grocer's
 * `missedDelivery`, but the one that brings a contract to `maxStrikes`
 * missed, which ends it, their `contractBroken` instead; then each contract
 * of `previous` that ran out, their `contractEnded`, dated its last
 * delivery or miss. One message ends a contract, whichever way. The
 * grocer signs « Normand, Épicerie Chez Normand ».
 */
export function contractTriggers(
  previous: GameState,
  next: GameState,
  grocers: GrocerContent = GROCERS,
): Trigger[] {
  const from = (grocer: GrocerId) => {
    const { owner, name } = grocers.grocers[grocer]
    return `${owner}, ${name}`
  }
  const strikes = new Map<GrocerId, number>(
    previous.contracts.running.map(({ grocer, strikes }) => [grocer, strikes]),
  )
  const broken = new Set<GrocerId>()
  const triggers: Trigger[] = []
  const missed = playedSince(next.contracts.missed, previous.day)
  for (const { day, grocer } of missed) {
    const count = (strikes.get(grocer) ?? 0) + 1
    strikes.set(grocer, count)
    const ends = count >= grocers.maxStrikes
    if (ends) broken.add(grocer)
    triggers.push({
      kind: ends ? 'contractBroken' : 'missedDelivery',
      day,
      from: from(grocer),
    })
  }
  const delivered = playedSince(next.contracts.deliveries, previous.day)
  for (const { grocer, startDay } of previous.contracts.running) {
    const runs = next.contracts.running.some(
      (contract) =>
        contract.grocer === grocer && contract.startDay === startDay,
    )
    if (runs || broken.has(grocer)) continue
    const last = Math.max(
      ...[...delivered, ...missed]
        .filter((done) => done.grocer === grocer)
        .map(({ day }) => day),
      previous.day,
    )
    triggers.push({ kind: 'contractEnded', day: last, from: from(grocer) })
  }
  return triggers
}

/**
 * What the employees call for over the days played from `previous` to
 * `next`, read from the journal as the mornings left it, so someone who
 * leaves and is hired again in between counts both times: each
 * « Formation » paid, the employee's `hired`, and each « Préavis », their
 * `fired`, dated that morning. Cancelling a hire who had not started pays
 * neither, and calls for nothing.
 */
export function staffTriggers(previous: GameState, next: GameState): Trigger[] {
  const training = staffMemo(STAFF_MEMO.training, '')
  const notice = staffMemo(STAFF_MEMO.notice, '')
  const triggers: Trigger[] = []
  for (const { day, memo } of entriesSince(next.journal, previous.day)) {
    if (memo.startsWith(training)) {
      triggers.push({ kind: 'hired', day, from: memo.slice(training.length) })
    } else if (memo.startsWith(notice)) {
      triggers.push({ kind: 'fired', day, from: memo.slice(notice.length) })
    }
  }
  return triggers
}

/**
 * What the employees say in their own words over the days played from
 * `previous` to `next` (#255): each warning of an employee still underpaid,
 * their `underpaid` line, and each quit, their `quit` line, dated that
 * morning and signed with their name (see `staffNotices`).
 */
export function ownWordsTriggers(
  previous: GameState,
  next: GameState,
  messages: Messages = MESSAGES,
): Trigger[] {
  return staffNotices(previous, next).map(({ kind, candidate, day }) => ({
    kind,
    day,
    from: STAFF.candidates[candidate].name,
    text: messages[kind][candidate],
  }))
}

/**
 * The items of `list`, kept by day, from `day` on: read from the end, so a
 * long game's history costs no more than its last days.
 */
function playedSince<T extends { readonly day: Day }>(
  list: readonly T[],
  day: Day,
): readonly T[] {
  let from = list.length
  while (from > 0 && (list[from - 1]?.day ?? day) >= day) from -= 1
  return list.slice(from)
}

/**
 * Who sends the messages of `kind` when the game does not name them: the
 * content's sender. Throws a RangeError for a kind the game always names.
 */
function senderOf(messages: Messages, kind: MessageKind): string {
  const sender = messages[kind]
  if ('from' in sender) return sender.from
  throw new RangeError(`The game names who sends ${kind}`)
}

/**
 * One of `lines`, picked with `random`, other than `avoid` when there is
 * another to pick.
 */
export function pickLine(
  lines: readonly string[],
  random: () => number,
  avoid: string | null,
): string {
  const others = lines.filter((line) => line !== avoid)
  const from = others.length > 0 ? others : lines
  const line =
    from[Math.min(from.length - 1, Math.floor(random() * from.length))]
  if (line === undefined) throw new RangeError('No line to pick')
  return line
}

/**
 * The messages kept once `message` comes in on top of `messages`, newest
 * first: at most `MAX_MESSAGES` the game called for, and every postcard,
 * which stays until the player puts it away, so none is lost unseen.
 */
export function received(
  messages: readonly Message[],
  message: Message,
): Message[] {
  let others = 0
  return [message, ...messages].filter(({ kind }) => {
    if (kind === 'postcard') return true
    others += 1
    return others <= MAX_MESSAGES
  })
}

/** Hands out message ids, from `from` (0) up. */
export function messageIds(from = 0): () => number {
  let next = from
  return () => {
    const id = next
    next += 1
    return id
  }
}

/**
 * Hands `onMessage` a message each time the game in `store` calls for one
 * (see `triggersBetween`), from the sender the game names or else the
 * content's, with a line of its kind picked with `random`, never the last
 * one of that kind shown, or else the employee's own words, and an id from
 * `nextId`, which other senders may share. Returns a function that stops
 * it.
 */
export function startMessages(
  store: GameStore,
  onMessage: (message: Message) => void,
  random: () => number = Math.random,
  messages: Messages = MESSAGES,
  energy: EnergyContent = ENERGY,
  nextId: () => number = messageIds(),
): () => void {
  let memory = NO_MEMORY
  const lastLine: Partial<Record<MessageKind, string>> = {}
  return store.subscribe((state, previous) => {
    if (state.game === previous.game) return
    const found = triggersBetween(
      previous.game,
      state.game,
      memory,
      energy,
      GROCERS,
      messages,
    )
    memory = found.memory
    for (const trigger of found.triggers) {
      if ('text' in trigger) {
        onMessage({ id: nextId(), ...trigger })
        continue
      }
      const { kind, day, from = senderOf(messages, kind) } = trigger
      const { lines } = messages[kind]
      const text = pickLine(lines, random, lastLine[kind] ?? null)
      lastLine[kind] = text
      onMessage({ id: nextId(), kind, from, text, day })
    }
  })
}
