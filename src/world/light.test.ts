import { describe, expect, it } from 'vitest'
import {
  facadeStops,
  hexToRgb,
  mix,
  rgbToHex,
  roundHalfToEven,
  tonesOf,
} from './light.ts'
import { ASSETS } from './manifest.ts'

const LIGHT = ASSETS.light

describe('the colour maths', () => {
  it('lights brick and asphalt as the rule sheet does', () => {
    expect(tonesOf('#B4532F', LIGHT)).toMatchObject({
      top: '#C47652',
      lit: '#B4532F',
      shade: '#814B3C',
    })
    expect(tonesOf('#5C5752', LIGHT)).toMatchObject({
      top: '#80796E',
      lit: '#5C5752',
      shade: '#4C4E51',
    })
  })

  it('lights the shipped brick and asphalt colours the same way', () => {
    expect(tonesOf(ASSETS.palette.brickRed, LIGHT).top).toBe('#C47652')
    expect(tonesOf(ASSETS.palette.asphalt, LIGHT).shade).toBe('#4C4E51')
  })

  it('rounds a half to the even channel, as the rule sheet does', () => {
    // Brick's red lit from above is 196.5, asphalt's blue 109.5.
    expect(roundHalfToEven(196.5)).toBe(196)
    expect(roundHalfToEven(109.5)).toBe(110)
    expect(roundHalfToEven(196.49999999999997)).toBe(196)
    expect(roundHalfToEven(196.6)).toBe(197)
    expect(roundHalfToEven(196.4)).toBe(196)
  })

  it('gives either colour at the ends of a mix', () => {
    expect(mix('#B4532F', '#FFF1CF', 0)).toBe('#B4532F')
    expect(mix('#B4532F', '#FFF1CF', 1)).toBe('#FFF1CF')
  })

  it('reads and writes #RRGGBB', () => {
    expect(hexToRgb('#B4532F')).toEqual([180, 83, 47])
    expect(rgbToHex([180, 83, 47])).toBe('#B4532F')
    expect(rgbToHex(hexToRgb('#0a0b0c'))).toBe('#0A0B0C')
  })

  it('puts the rim between the top face and the sun', () => {
    const { rim } = tonesOf('#B4532F', LIGHT)
    expect(rim).toBe(mix('#B4532F', LIGHT.sun, LIGHT.topFace.rim.light))
    expect(hexToRgb(rim)[0]).toBeGreaterThan(hexToRgb('#C47652')[0])
  })

  it('grades a lit side from light at the top to slate at the foot', () => {
    expect(facadeStops('#B4532F', LIGHT)).toEqual([
      mix('#B4532F', LIGHT.sun, 0.26),
      '#B4532F',
      mix('#B4532F', LIGHT.slate, 0.3),
    ])
  })
})
