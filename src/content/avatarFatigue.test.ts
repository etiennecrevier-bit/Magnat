import { describe, expect, it } from 'vitest'
import avatarFatigueJson from './avatarFatigue.json'
import { loadAvatarFatigue } from './avatarFatigue.ts'

/** A deep copy of the shipped file to break, one field at a time. */
function shipped() {
  // Its groups as plain records; the tests leave the one plain string alone.
  return structuredClone(avatarFatigueJson) as unknown as Record<
    string,
    Record<string, unknown>
  >
}

describe('avatarFatigue.json', () => {
  it('loads', () => {
    const look = loadAvatarFatigue()
    expect(look.reachMultiplier.exhausted).toBeGreaterThanOrEqual(
      look.reachMultiplier.tired,
    )
    expect(look.yawn.lengthMs).toBeLessThan(
      look.yawn.everyMs - look.yawn.jitterMs,
    )
  })
})

describe('loadAvatarFatigue', () => {
  it('rejects a reach faster than the rested one', () => {
    const raw = shipped()
    raw.reachMultiplier!.tired = 0.5
    expect(() => loadAvatarFatigue(raw)).toThrow(/reachMultiplier/)
  })

  it('rejects a yawn jitter as long as the wait', () => {
    const raw = shipped()
    raw.yawn!.jitterMs = raw.yawn!.everyMs
    expect(() => loadAvatarFatigue(raw)).toThrow(/jitterMs/)
  })

  it('rejects a colour that is not #RRGGBB', () => {
    const raw = shipped()
    raw.spill!.color = 'brown'
    expect(() => loadAvatarFatigue(raw)).toThrow(/spill/)
  })

  it('rejects a spill that never fades', () => {
    const raw = shipped()
    raw.spill!.fadeMs = 0
    expect(() => loadAvatarFatigue(raw)).toThrow(/fadeMs/)
  })

  it('rejects an unknown key', () => {
    const raw = shipped()
    raw.slump!.shoulders = 2
    expect(() => loadAvatarFatigue(raw)).toThrow()
  })
})
