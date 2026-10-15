import type { ColorName } from '../content/assets.ts'
import type { CustomerLines } from '../content/lines.ts'
import type { SegmentId } from '../content/schema.ts'
import type { Visit } from '../engine/types.ts'
import type { Span } from './crowd.ts'
import type { CrowdSettings } from './crowdSettings.ts'
import { moodOf, type Mood } from './replay.ts'

// The card a customer shows when the player picks them, and which customer a
// press or a key picks. Pure, so the rules are tested without Pixi or a page.

/** What a customer's card says. */
export interface CustomerCard {
  readonly segment: SegmentId
  /** The segment's name for one customer: « Habitué ». */
  readonly name: string
  readonly mood: Mood
  /** What they say, from `lines.fr.json`. */
  readonly line: string
}

/** How each mood reads on the card. Nouns, so they fit any customer. */
export const MOOD_WORDS: Readonly<Record<Mood, string>> = {
  happy: 'Satisfaction',
  annoyed: 'Agacement',
  sad: 'Déception',
  neutral: 'Indifférence',
}

/** The palette colour of each mood, as on the bubble's face. */
export const MOOD_COLORS: Readonly<Record<Mood, ColorName>> = {
  happy: 'moneyGreen',
  annoyed: 'warningAmber',
  sad: 'playerBlue',
  neutral: 'ink',
}

/**
 * The card of the customer who made `visit`: their segment's name, their
 * mood and one of the lines for their segment and how the visit ended,
 * picked with `random`.
 */
export function cardOf(
  visit: Visit,
  lines: CustomerLines,
  random: () => number,
): CustomerCard {
  const segment = lines.segments[visit.segment]
  const choices = segment.lines[visit.outcome]
  const at = Math.min(choices.length - 1, Math.floor(random() * choices.length))
  return {
    segment: visit.segment,
    name: segment.name,
    mood: moodOf(visit.outcome),
    line: choices[at] as string,
  }
}

/** A line between French guillemets, kept on them by no-break spaces. */
export function quoted(line: string): string {
  return `«\u00a0${line}\u00a0»`
}

/**
 * The card in one sentence, for the status line that screen readers read
 * out: Habitué, satisfaction : « … ».
 */
export function saying(card: CustomerCard): string {
  const mood = MOOD_WORDS[card.mood].toLocaleLowerCase('fr-CA')
  return `${card.name}, ${mood}\u00a0: ${quoted(card.line)}`
}

/** A point on the page, in CSS pixels from its top-left corner. */
export interface Point {
  readonly x: number
  readonly y: number
}

/** A rectangle on the page, in CSS pixels. */
export interface Box {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** A customer the player can pick, where they are drawn on the page. */
export interface Target {
  readonly id: number
  readonly box: Box
  /** How near the viewer they stand: the nearer one is drawn on top. */
  readonly depth: number
}

/**
 * The customer drawn at `point`, give or take `margin`, since they move
 * while the player aims. Where customers overlap, the one drawn on top: the
 * nearest the viewer, then the latest to come. Null when no one is there.
 */
export function customerAt(
  point: Point,
  targets: readonly Target[],
  margin: number,
): number | null {
  let found: Target | null = null
  for (const target of targets) {
    const { left, top, right, bottom } = target.box
    const hit =
      point.x >= left - margin &&
      point.x <= right + margin &&
      point.y >= top - margin &&
      point.y <= bottom + margin
    if (!hit) continue
    if (
      found === null ||
      target.depth > found.depth ||
      (target.depth === found.depth && target.id > found.id)
    ) {
      found = target
    }
  }
  return found?.id ?? null
}

/**
 * The customer after `currentId`, in the order they came, among those
 * standing within `span`; back to the first after the last. Null when no
 * one stands within it.
 */
export function nextOnScreen(
  customers: readonly { readonly id: number; readonly x: number }[],
  currentId: number | null,
  span: Span,
): number | null {
  const shown = customers.filter((c) => c.x >= span.left && c.x <= span.right)
  if (shown.length === 0) return null
  const after =
    currentId === null ? undefined : shown.find((c) => c.id > currentId)
  return (after ?? shown[0])!.id
}

/** Where the card sits on the page, in CSS pixels, and on which side. */
export interface CardPlace {
  readonly left: number
  readonly bottom: number
  readonly width: number
  readonly side: 'right' | 'left' | 'above'
}

/**
 * Places the card beside the customer drawn in `box`, on a page of `page`'s
 * size: to their right, its foot level with theirs, or else to their left,
 * or else above their head when neither side has room. It always stays
 * `margin` inside the page, and narrows to fit a narrow one. Its height
 * follows its text, so it is placed by its foot and grows upwards.
 */
export function placeCard(
  box: Box,
  page: { readonly width: number; readonly height: number },
  settings: CrowdSettings['card'],
): CardPlace {
  const { gap, margin } = settings
  const width = Math.max(0, Math.min(settings.width, page.width - 2 * margin))
  const fits = (left: number) =>
    left >= margin && left + width <= page.width - margin
  const right = box.right + gap
  const left = box.left - gap - width
  if (fits(right) || fits(left)) {
    return {
      left: fits(right) ? right : left,
      bottom: clamp(page.height - box.bottom, margin, page.height - margin),
      width,
      side: fits(right) ? 'right' : 'left',
    }
  }
  const centre = (box.left + box.right) / 2
  return {
    left: clamp(centre - width / 2, margin, page.width - margin - width),
    bottom: clamp(page.height - box.top + gap, margin, page.height - margin),
    width,
    side: 'above',
  }
}

/** `value`, held between `min` and `max`; `min` wins if they cross. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
