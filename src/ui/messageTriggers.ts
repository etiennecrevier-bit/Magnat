import type { EnergyContent } from '../content/schema.ts'
import {
  loadMessages,
  type MessageKind,
  type Messages,
} from '../content/messages.ts'
import { ENERGY } from '../engine/day.ts'
import { fatigueOf } from '../engine/energy.ts'
import type { Day, GameState } from '../engine/types.ts'
import type { GameStore } from './store.ts'

/** The shipped messages, validated once. */
export const MESSAGES: Messages = loadMessages()

// Days per game week, a calendar fact: day 0 is a Monday, so each game week
// runs from a Monday to a Sunday.
const DAYS_PER_WEEK = 7

/** The most messages kept: a new one pushes the oldest out. */
export const MAX_MESSAGES = 3

/** A message the player receives. */
export interface Message {
  /** Unique among the messages received since the game screens opened. */
  readonly id: number
  readonly kind: MessageKind
  /** Who it is from, as the card shows it. */
  readonly from: string
  readonly text: string
  /** The day it is about. */
  readonly day: Day
}

/** Something that calls for a message. */
export interface Trigger {
  readonly kind: MessageKind
  /** The day it is about: the rent's, or the morning the owner woke up on. */
  readonly day: Day
}

/** What the messages remember from one game to the next. */
export interface MessageMemory {
  /** The game week the owner last said they were exhausted; null if never. */
  readonly exhaustedWeek: number | null
}

export const NO_MEMORY: MessageMemory = { exhaustedWeek: null }

/**
 * What calls for a message once the game moves on from `previous` to
 * `next`, oldest first. Nothing does unless days were played. Each rent that
 * went unpaid on the days played calls for the landlord's. Waking up
 * exhausted, from a morning that was not, calls for the owner's own, once a
 * game week at most: the week of `memory.exhaustedWeek` is skipped. Returns
 * the memory to keep.
 */
export function triggersBetween(
  previous: GameState,
  next: GameState,
  memory: MessageMemory,
  energy: EnergyContent = ENERGY,
): { triggers: Trigger[]; memory: MessageMemory } {
  if (next.day <= previous.day) return { triggers: [], memory }
  const triggers: Trigger[] = next.personal.unpaidRents
    .filter((day) => day >= previous.day)
    .map((day) => ({ kind: 'landlord', day }))
  const week = Math.floor(next.day / DAYS_PER_WEEK)
  const wokeExhausted =
    fatigueOf(previous.energy, energy) !== 'exhausted' &&
    fatigueOf(next.energy, energy) === 'exhausted'
  if (wokeExhausted && memory.exhaustedWeek !== week) {
    triggers.push({ kind: 'exhausted', day: next.day })
    return { triggers, memory: { exhaustedWeek: week } }
  }
  return { triggers, memory }
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
 * first: at most `MAX_MESSAGES`.
 */
export function received(
  messages: readonly Message[],
  message: Message,
): Message[] {
  return [message, ...messages].slice(0, MAX_MESSAGES)
}

/**
 * Hands `onMessage` a message each time the game in `store` calls for one
 * (see `triggersBetween`), with a line of its kind picked with `random`,
 * never the last one of that kind shown. Returns a function that stops it.
 */
export function startMessages(
  store: GameStore,
  onMessage: (message: Message) => void,
  random: () => number = Math.random,
  messages: Messages = MESSAGES,
  energy: EnergyContent = ENERGY,
): () => void {
  let memory = NO_MEMORY
  let nextId = 0
  const lastLine: Partial<Record<MessageKind, string>> = {}
  return store.subscribe((state, previous) => {
    if (state.game === previous.game) return
    const found = triggersBetween(previous.game, state.game, memory, energy)
    memory = found.memory
    for (const { kind, day } of found.triggers) {
      const { from, lines } = messages[kind]
      const text = pickLine(lines, random, lastLine[kind] ?? null)
      lastLine[kind] = text
      onMessage({ id: nextId, kind, from, text, day })
      nextId += 1
    }
  })
}
