// Réal's bubble (#238): where it goes beside the element its step points
// at, the hole in the dim around that element, and the blocks that keep
// every press outside the hole from reaching the game. Pure, so it is
// tested without a DOM; `CoachBubble.tsx` only reads the boxes.

import type { Box, Size } from './tooltip.ts'

/** How the bubble places itself, in CSS pixels. */
export const COACH = {
  /** The bubble's width where the window has room. */
  width: 320,
  /** Space between the target and the bubble. */
  gap: 14,
  /** Space the bubble keeps from the window's edges. */
  margin: 8,
  /** How far the hole reaches past the target. */
  holePadding: 6,
  /** The bubble's corner radius, which the arrow keeps clear of. */
  corner: 16,
  /** How far the arrow sticks out of the bubble. */
  arrow: 10,
  /** Where the bubble with nothing to point at stands from the top. */
  freeTop: 72,
} as const

/** The side of its target the bubble is on; `center` with no target. */
export type BubbleSide = 'right' | 'left' | 'above' | 'below' | 'center'

export interface BubblePlace {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly side: BubbleSide
  /**
   * Where the arrow's centre is along the edge facing the target, from the
   * bubble's top for `right` and `left`, from its left for `above` and
   * `below`; 0 for `center`.
   */
  readonly arrow: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/** The bubble's width in a window of `page`: full width less the margins on a phone. */
export function bubbleWidth(page: Size, phone: boolean): number {
  const room = Math.max(0, page.width - 2 * COACH.margin)
  return phone ? room : Math.min(COACH.width, room)
}

/**
 * Where the bubble of `size` goes beside `target`, in a window of `page`:
 * right of it, else left, else above, else below, always inside the
 * window's margins, with its arrow toward the target's middle. On a phone,
 * below it or above, full width less the margins. With no side free, it
 * goes on the side with the most room, slid inside the window. With no
 * target, it is centred.
 */
export function placeBubble(
  target: Box | null,
  size: Size,
  page: Size,
  phone: boolean,
): BubblePlace {
  const { gap, margin, corner, arrow } = COACH
  const width = Math.min(size.width, Math.max(0, page.width - 2 * margin))
  const height = size.height
  if (target === null) {
    return {
      left: Math.max(margin, (page.width - width) / 2),
      top: Math.max(margin, (page.height - height) / 2),
      width,
      side: 'center',
      arrow: 0,
    }
  }
  const middleX = (target.left + target.right) / 2
  const middleY = (target.top + target.bottom) / 2
  const along = (middle: number, start: number, length: number) =>
    clamp(middle - start, corner + arrow, length - corner - arrow)
  const across = (side: 'above' | 'below', top: number): BubblePlace => {
    const left = clamp(middleX - width / 2, margin, page.width - margin - width)
    return { left, top, width, side, arrow: along(middleX, left, width) }
  }
  const beside = (side: 'right' | 'left', left: number): BubblePlace => {
    const top = clamp(
      middleY - height / 2,
      margin,
      page.height - margin - height,
    )
    return { left, top, width, side, arrow: along(middleY, top, height) }
  }
  const room = {
    right: page.width - margin - (target.right + gap),
    left: target.left - gap - margin,
    above: target.top - gap - margin,
    below: page.height - margin - (target.bottom + gap),
  }
  const place = {
    right: () => beside('right', target.right + gap),
    left: () => beside('left', target.left - gap - width),
    above: () => across('above', target.top - gap - height),
    below: () => across('below', target.bottom + gap),
  }
  // On a phone, below first: it covers what follows the target, not what
  // leads to it, such as an event card's situation above its choices.
  const sides = phone
    ? (['below', 'above'] as const)
    : (['right', 'left', 'above', 'below'] as const)
  const fits = (side: (typeof sides)[number]) =>
    room[side] >= (side === 'right' || side === 'left' ? width : height)
  const free = sides.find(fits)
  if (free !== undefined) return place[free]()
  // No side has room: the roomiest, slid inside the window.
  const roomiest = [...sides].sort((a, b) => room[b] - room[a])[0]!
  const spot = place[roomiest]()
  return {
    ...spot,
    left: clamp(spot.left, margin, page.width - margin - width),
    top: clamp(spot.top, margin, page.height - margin - height),
  }
}

/** The hole around `target`, padded, inside the window. */
export function holeBox(target: Box, page: Size): Box {
  const pad = COACH.holePadding
  return {
    left: Math.max(0, target.left - pad),
    top: Math.max(0, target.top - pad),
    right: Math.min(page.width, target.right + pad),
    bottom: Math.min(page.height, target.bottom + pad),
  }
}

/**
 * The four blocks that cover the window of `page` but `hole`: the band
 * above it, the band below it, and the parts left and right of it between
 * them. Without a hole, one block covers the whole window. Empty blocks
 * stay, at no size, so there are always four.
 */
export function holeBlockers(hole: Box | null, page: Size): readonly Box[] {
  const none: Box = { left: 0, top: 0, right: 0, bottom: 0 }
  if (hole === null) {
    return [
      { left: 0, top: 0, right: page.width, bottom: page.height },
      none,
      none,
      none,
    ]
  }
  return [
    { left: 0, top: 0, right: page.width, bottom: hole.top },
    { left: 0, top: hole.bottom, right: page.width, bottom: page.height },
    { left: 0, top: hole.top, right: hole.left, bottom: hole.bottom },
    { left: hole.right, top: hole.top, right: page.width, bottom: hole.bottom },
  ]
}

/**
 * What of `box` shows through `clips`, the boxes of the ancestors that
 * clip it, such as a panel's body that scrolls, and the window of `page`;
 * null when nothing does.
 */
export function visibleBox(
  box: Box,
  clips: readonly Box[],
  page: Size,
): Box | null {
  let shown: Box = {
    left: Math.max(box.left, 0),
    top: Math.max(box.top, 0),
    right: Math.min(box.right, page.width),
    bottom: Math.min(box.bottom, page.height),
  }
  for (const clip of clips) {
    shown = {
      left: Math.max(shown.left, clip.left),
      top: Math.max(shown.top, clip.top),
      right: Math.min(shown.right, clip.right),
      bottom: Math.min(shown.bottom, clip.bottom),
    }
  }
  return shown.right - shown.left >= 1 && shown.bottom - shown.top >= 1
    ? shown
    : null
}

/** Whether `box` shows whole: `visible` is all of it. */
export function showsWhole(box: Box, visible: Box): boolean {
  return (
    visible.left <= box.left + 0.5 &&
    visible.top <= box.top + 0.5 &&
    visible.right >= box.right - 0.5 &&
    visible.bottom >= box.bottom - 0.5
  )
}

/**
 * The next of `items` from `current` in the Tab order, backward with
 * `back`, around the ends; the first, or the last backward, when `current`
 * is none of them. Null when there are none.
 */
export function cycleFocus<T>(
  items: readonly T[],
  current: T | null,
  back: boolean,
): T | null {
  if (items.length === 0) return null
  const index = current === null ? -1 : items.indexOf(current)
  if (index === -1) return back ? items.at(-1)! : items[0]!
  const step = back ? -1 : 1
  return items[(index + step + items.length) % items.length]!
}
