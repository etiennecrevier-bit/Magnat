import { describe, expect, it } from 'vitest'
import { CROWD } from './crowdSettings.ts'
import {
  avatarPose,
  createSpillClock,
  createYawns,
  type Yawns,
} from './fatigue.ts'

const LOOK = CROWD.fatigue
const { reachMs } = CROWD
const { everyMs, jitterMs, lengthMs } = LOOK.yawn

describe('avatarPose', () => {
  it('shows a rested owner as usual', () => {
    expect(avatarPose('rested', reachMs, LOOK)).toEqual({
      reachMs,
      yawns: false,
      slumped: false,
      circles: false,
    })
  })

  it('slows a tired owner down and makes them yawn', () => {
    expect(avatarPose('tired', reachMs, LOOK)).toEqual({
      reachMs: reachMs * LOOK.reachMultiplier.tired,
      yawns: true,
      slumped: false,
      circles: false,
    })
  })

  it('slows an exhausted owner more, slumped, yawning, with dark circles', () => {
    expect(avatarPose('exhausted', reachMs, LOOK)).toEqual({
      reachMs: reachMs * LOOK.reachMultiplier.exhausted,
      yawns: true,
      slumped: true,
      circles: true,
    })
  })
})

/**
 * Runs `yawns` for `ms` in frames of `step`; returns the times at which a
 * yawn starts or stops, from the start.
 */
function flips(yawns: Yawns, ms: number, step = 10): number[] {
  const times: number[] = []
  let was = false
  for (let t = step; t <= ms; t += step) {
    const now = yawns.update(step)
    if (now !== was) times.push(t)
    was = now
  }
  return times
}

/** The time between each flip and the one before, from the start. */
function gaps(times: readonly number[]): number[] {
  return times.map((time, i) => time - (times[i - 1] ?? 0))
}

describe('createYawns', () => {
  it('yawns for lengthMs, everyMs after the last yawn ended, on a middle draw', () => {
    const found = gaps(
      flips(
        createYawns(LOOK.yawn, () => 0.5),
        30_000,
      ),
    )
    expect(found.length).toBeGreaterThanOrEqual(6)
    found.forEach((gap, i) => {
      expect(gap).toBe(i % 2 === 0 ? everyMs : lengthMs)
    })
  })

  it('waits from everyMs − jitterMs to everyMs + jitterMs', () => {
    const [early] = flips(
      createYawns(LOOK.yawn, () => 0),
      30_000,
    )
    expect(early).toBe(everyMs - jitterMs)
    const [late] = flips(
      createYawns(LOOK.yawn, () => 0.999),
      30_000,
      1,
    )
    expect(late).toBeGreaterThan(everyMs + 0.99 * jitterMs)
    expect(late).toBeLessThanOrEqual(everyMs + jitterMs)
  })

  it('goes through a whole wait and yawn in one long frame', () => {
    const yawns = createYawns(LOOK.yawn, () => 0.5)
    expect(yawns.update(everyMs + lengthMs + 1)).toBe(false)
    expect(yawns.update(everyMs - 1)).toBe(true)
  })

  it('stands still on a delta of 0, mid-yawn or not', () => {
    const yawns = createYawns(LOOK.yawn, () => 0.5)
    expect(yawns.update(everyMs + lengthMs / 2)).toBe(true)
    for (let i = 0; i < 1000; i += 1) expect(yawns.update(0)).toBe(true)
    expect(yawns.update(lengthMs / 2 - 1)).toBe(true)
    expect(yawns.update(1)).toBe(false)
    for (let i = 0; i < 1000; i += 1) expect(yawns.update(0)).toBe(false)
    expect(yawns.update(everyMs - 1)).toBe(false)
    expect(yawns.update(1)).toBe(true)
  })

  it('stops a yawn and waits again from the start on reset', () => {
    const yawns = createYawns(LOOK.yawn, () => 0.5)
    expect(yawns.update(everyMs + 10)).toBe(true)
    yawns.reset()
    expect(yawns.update(0)).toBe(false)
    expect(yawns.update(everyMs - 1)).toBe(false)
    expect(yawns.update(1)).toBe(true)
  })
})

describe('createSpillClock', () => {
  const { showMs, fadeMs } = LOOK.spill

  it('shows nothing until a spill', () => {
    expect(createSpillClock(LOOK.spill).update(16)).toBe(0)
  })

  it('shows in full for showMs, then fades out over fadeMs', () => {
    const clock = createSpillClock(LOOK.spill)
    clock.show()
    expect(clock.update(showMs)).toBe(1)
    expect(clock.update(fadeMs / 2)).toBeCloseTo(0.5)
    expect(clock.update(fadeMs / 2)).toBe(0)
  })

  it('freezes on a delta of 0, and shows in full again on a new spill', () => {
    const clock = createSpillClock(LOOK.spill)
    clock.show()
    const fading = clock.update(showMs + fadeMs / 4)
    expect(clock.update(0)).toBe(fading)
    clock.show()
    expect(clock.update(0)).toBe(1)
  })

  it('takes the spill away at once', () => {
    const clock = createSpillClock(LOOK.spill)
    clock.show()
    clock.hide()
    expect(clock.update(0)).toBe(0)
  })
})
