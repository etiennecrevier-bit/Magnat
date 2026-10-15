import type { Visit } from '../engine/types.ts'
import type { CrowdSettings } from './crowdSettings.ts'
import { moodOf, type Mood } from './replay.ts'

// What each customer on the street does, without drawing them: they walk in,
// wait their turn in line, buy or look at the counter, then walk off with
// their mood in a bubble. Pure, so the rules are tested without Pixi.

/**
 * Where a customer is in their visit: walking up to the line, in line,
 * at the counter, then walking off.
 */
export type Phase = 'walkingIn' | 'inLine' | 'atCounter' | 'leaving'

/** The part of the street on screen, from its left edge to its right. */
export interface Span {
  readonly left: number
  readonly right: number
}

/** One customer on the street. */
export interface Customer {
  /** Unique on the street, in the order they came. */
  readonly id: number
  readonly visit: Visit
  /** The face on their bubble as they leave. */
  readonly mood: Mood
  readonly phase: Phase
  /** Where their feet are. */
  readonly x: number
  readonly y: number
  /** Which way they face: 1 to the right, -1 to the left. */
  readonly facing: 1 | -1
  /** How far they have walked, which sets their step. */
  readonly walked: number
  /** Their place in line, 0 at the counter, or -1 once they leave. */
  readonly slot: number
  /** Whether their mood bubble shows. */
  readonly bubble: boolean
}

/**
 * A customer reaching the counter, which the avatar answers: `served` when
 * they buy, `looked` when they buy nothing. Either may have had units
 * botched (`visit.botched`): a customer whose last unit was botched ends up
 * with none, sold out.
 */
export interface AtCounter {
  readonly kind: 'served' | 'looked'
  readonly customer: Customer
}

/** The customers on the street. */
export interface Crowd {
  /** Everyone on the street, in the order they came. */
  readonly customers: readonly Customer[]
  /** Brings `visit` onto the street, just past one of the edges of `span`. */
  spawn: (visit: Visit, span: Span) => Customer
  /**
   * Moves everyone on by `deltaMs` at `pace` (1 is normal, 0 freezes them),
   * with `span` on screen. Returns each customer who reaches the counter now.
   */
  update: (deltaMs: number, pace: number, span: Span) => AtCounter[]
  /** Sends everyone not yet gone away without buying and without a bubble. */
  dismiss: () => void
  /** Takes everyone off the street at once. */
  clear: () => void
}

type Walker = { -readonly [K in keyof Customer]: Customer[K] }

interface Moving extends Walker {
  /** Time left at the counter. */
  counterMs: number
  /** Time left with the bubble showing. */
  bubbleMs: number
  /** The edge they walk off past: -1 the left one, 1 the right one. */
  exitSide: -1 | 1
}

/**
 * The customers' model. The line is first come, first served: the spot at
 * the counter, then one `slotSpacing` further left for each customer ahead.
 * Customers walk in a lane nearer the viewer, so they pass in front of the
 * line, and step into it near their spot. A customer who bought is served
 * for `serveMs`; one who did not looks for `lookMs`. Then they walk off past
 * a random edge, their bubble showing for `bubbleMs`, and are gone once past
 * it. `random` picks the edges.
 */
export function createCrowd(
  settings: CrowdSettings,
  random: () => number,
): Crowd {
  const {
    walkSpeed,
    serveMs,
    lookMs,
    bubbleMs,
    groundY,
    laneOffset,
    mergeDistance,
    counterX,
    slotSpacing,
    edgeMargin,
  } = settings
  const lane = groundY + laneOffset
  let all: Moving[] = []
  let nextId = 0

  const side = (): -1 | 1 => (random() < 0.5 ? -1 : 1)
  const edge = (span: Span, at: -1 | 1) =>
    at < 0 ? span.left - edgeMargin : span.right + edgeMargin

  /** Moves `c` towards `x`, `y` by at most `step`; true once there. */
  const walk = (c: Moving, x: number, y: number, step: number): boolean => {
    const dx = clampTo(x - c.x, step)
    const dy = clampTo(y - c.y, step)
    c.x += dx
    c.y += dy
    c.walked += Math.abs(dx) + Math.abs(dy)
    if (dx !== 0) c.facing = dx > 0 ? 1 : -1
    return c.x === x && c.y === y
  }

  /** Numbers the line from the counter, in the order they came. */
  const reslot = () => {
    let slot = 0
    for (const c of all) {
      if (c.phase === 'leaving') continue
      c.slot = slot
      slot += 1
    }
  }

  const leave = (c: Moving, withBubble: boolean) => {
    c.phase = 'leaving'
    c.slot = -1
    c.counterMs = 0
    c.bubbleMs = withBubble ? bubbleMs : 0
    c.bubble = withBubble
    c.exitSide = side()
  }

  return {
    get customers() {
      return all
    },
    spawn: (visit, span) => {
      const from = side()
      const c: Moving = {
        id: nextId,
        visit,
        mood: moodOf(visit.outcome),
        phase: 'walkingIn',
        x: edge(span, from),
        y: lane,
        facing: from < 0 ? 1 : -1,
        walked: 0,
        slot: all.filter((other) => other.phase !== 'leaving').length,
        bubble: false,
        counterMs: 0,
        bubbleMs: 0,
        exitSide: from,
      }
      nextId += 1
      all.push(c)
      return c
    },
    update: (deltaMs, pace, span) => {
      if (pace <= 0 || deltaMs <= 0) return []
      const dt = deltaMs * pace
      const step = (walkSpeed * dt) / 1000
      const arrived: AtCounter[] = []

      reslot()
      for (const c of all) {
        if (c.phase === 'leaving') continue
        const spot = counterX - c.slot * slotSpacing
        if (c.phase === 'atCounter') {
          c.counterMs -= dt
          if (c.counterMs <= 0) leave(c, true)
          continue
        }
        const y =
          c.phase === 'walkingIn' && Math.abs(spot - c.x) > mergeDistance
            ? lane
            : groundY
        if (!walk(c, spot, y, step)) continue
        if (c.slot > 0) {
          c.phase = 'inLine'
          continue
        }
        c.phase = 'atCounter'
        c.facing = 1
        if (c.visit.outcome === 'bought') {
          c.counterMs = serveMs
          arrived.push({ kind: 'served', customer: c })
        } else {
          c.counterMs = lookMs
          arrived.push({ kind: 'looked', customer: c })
        }
      }

      all = all.filter((c) => {
        if (c.phase !== 'leaving') return true
        c.bubbleMs = Math.max(0, c.bubbleMs - dt)
        c.bubble = c.bubbleMs > 0
        const exit = edge(span, c.exitSide)
        return !walk(c, exit, lane, step)
      })
      reslot()
      return arrived
    },
    dismiss: () => {
      for (const c of all) if (c.phase !== 'leaving') leave(c, false)
    },
    clear: () => {
      all = []
    },
  }
}

/**
 * How high a walker's step lifts them after walking `walked`: up and down
 * once a stride, never below the ground.
 */
export function bobOf(walked: number, bob: CrowdSettings['bob']): number {
  return Math.abs(Math.sin((Math.PI * walked) / bob.stride)) * bob.height
}

/** `value`, held to within `limit` of zero either way. */
function clampTo(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value))
}
