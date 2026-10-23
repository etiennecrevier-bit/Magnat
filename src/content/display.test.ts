import { describe, expect, it } from 'vitest'
import { DISPLAY, loadDisplay } from './display.ts'
import displayJson from './display.json'

describe('display.json', () => {
  it('offers 30 and 60 frames a second, 30 by default, at 2× at most and 1.5× with the simple effects', () => {
    expect(DISPLAY).toMatchObject({
      frameRates: [30, 60],
      defaultFrameRate: 30,
      maxResolution: 2,
      simpleResolution: 1.5,
    })
  })

  it.each([
    [
      'a default rate not offered',
      { defaultFrameRate: 45 },
      'defaultFrameRate',
    ],
    ['rates going down', { frameRates: [60, 30] }, 'frameRates'],
    [
      'a simple resolution above the most',
      { simpleResolution: 3 },
      'simpleResolution',
    ],
    ['a resolution below 1', { maxResolution: 0.5 }, 'maxResolution'],
    ['an unknown key', { fps: 30 }, 'fps'],
  ])('rejects %s', (_, change, field) => {
    expect(() => loadDisplay({ ...displayJson, ...change })).toThrow(field)
  })
})
