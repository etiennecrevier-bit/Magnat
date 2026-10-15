import { describe, expect, it } from 'vitest'
import { PORTRAIT_URLS, portraitUrl } from './portraits.ts'

describe('portraitUrl', () => {
  it("finds a character's portrait by its id", () => {
    const urls = new Map([['gilles', '/assets/gilles-abc.png']])
    expect(portraitUrl('gilles', urls)).toBe('/assets/gilles-abc.png')
  })

  it('finds none for a character with no file', () => {
    expect(portraitUrl('personne', new Map())).toBeNull()
  })

  it('names the shipped portraits by character id', () => {
    for (const id of PORTRAIT_URLS.keys()) {
      expect(id).toMatch(/^[a-z][A-Za-z0-9]*$/)
    }
  })
})
