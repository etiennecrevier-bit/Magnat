import type { AvatarFatigue } from '../content/avatarFatigue.ts'
import type { Fatigue } from '../engine/energy.ts'

// How the owner's fatigue shows on the avatar behind the counter, and the
// spill a botched unit leaves: the timings, without drawing anything. Pure,
// so the rules are tested without Pixi.

/** How the avatar looks and moves at one level of fatigue. */
export interface AvatarPose {
  /** How long the arm's reach across the counter takes. */
  readonly reachMs: number
  /** Whether the avatar yawns now and then. */
  readonly yawns: boolean
  /** Whether the upper body sinks and the head sinks and tilts. */
  readonly slumped: boolean
  /** Whether dark circles show under the eyes. */
  readonly circles: boolean
}

/**
 * How an owner at `fatigue` shows: rested as usual, reaching in `reachMs`;
 * tired, reaching slower and yawning; exhausted, reaching slower still,
 * yawning, slumped and with dark circles under the eyes.
 */
export function avatarPose(
  fatigue: Fatigue,
  reachMs: number,
  look: AvatarFatigue,
): AvatarPose {
  switch (fatigue) {
    case 'rested':
      return { reachMs, yawns: false, slumped: false, circles: false }
    case 'tired':
      return {
        reachMs: reachMs * look.reachMultiplier.tired,
        yawns: true,
        slumped: false,
        circles: false,
      }
    case 'exhausted':
      return {
        reachMs: reachMs * look.reachMultiplier.exhausted,
        yawns: true,
        slumped: true,
        circles: true,
      }
  }
}

/** The avatar's yawns, one after the other. */
export interface Yawns {
  /** Moves on by `deltaMs`; returns whether a yawn shows now. */
  update: (deltaMs: number) => boolean
  /** Stops any yawn and waits again from the start before the next. */
  reset: () => void
}

/**
 * Yawns that last `lengthMs` each, the next starting `everyMs`, give or take
 * `jitterMs`, after the last one ended. Time only passes in `update`, so
 * nothing moves on while it is not called; `random` picks each wait.
 */
export function createYawns(
  yawn: AvatarFatigue['yawn'],
  random: () => number,
): Yawns {
  const wait = () => yawn.everyMs + (random() * 2 - 1) * yawn.jitterMs
  let waitMs = wait()
  let yawningMs = 0
  return {
    update: (deltaMs) => {
      // A long frame may end a wait and a yawn, and start the next.
      let leftMs = Math.max(0, deltaMs)
      while (leftMs > 0) {
        if (yawningMs > 0) {
          const spent = Math.min(leftMs, yawningMs)
          yawningMs -= spent
          leftMs -= spent
          if (yawningMs === 0) waitMs = wait()
        } else {
          const spent = Math.min(leftMs, waitMs)
          waitMs -= spent
          leftMs -= spent
          if (waitMs === 0) yawningMs = yawn.lengthMs
        }
      }
      return yawningMs > 0
    },
    reset: () => {
      yawningMs = 0
      waitMs = wait()
    },
  }
}

/** How long a spill on the counter still shows. */
export interface SpillClock {
  /** Shows the spill in full again, for its whole time. */
  show: () => void
  /** Moves on by `deltaMs`; returns its opacity, from 1 down to 0 once gone. */
  update: (deltaMs: number) => number
  /** Takes it away at once. */
  hide: () => void
}

/**
 * A spill shows in full for `showMs`, then fades out over `fadeMs`. Time
 * only passes in `update`.
 */
export function createSpillClock(spill: AvatarFatigue['spill']): SpillClock {
  let leftMs = 0
  const opacity = () => Math.min(1, leftMs / spill.fadeMs)
  return {
    show: () => {
      leftMs = spill.showMs + spill.fadeMs
    },
    update: (deltaMs) => {
      if (deltaMs > 0) leftMs = Math.max(0, leftMs - deltaMs)
      return opacity()
    },
    hide: () => {
      leftMs = 0
    },
  }
}
