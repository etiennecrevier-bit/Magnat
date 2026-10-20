import { describe, expect, it, vi } from 'vitest'
import { createCityPicker, worldPicks } from './cityPicker.ts'
import { createPicker } from './picker.ts'

const POINT = { x: 10, y: 20 }

function target(over = true) {
  return { openAt: vi.fn(), isOver: vi.fn(() => over) }
}

describe('createCityPicker', () => {
  it('does nothing before a city holds it', () => {
    const picker = createCityPicker()
    expect(() => picker.at(POINT)).not.toThrow()
    expect(picker.over(POINT)).toBe(false)
  })

  it('hands presses to the city that holds it', () => {
    const picker = createCityPicker()
    const city = target()
    picker.connect(city)
    picker.at(POINT)
    expect(city.openAt).toHaveBeenCalledExactlyOnceWith(POINT)
    expect(picker.over(POINT)).toBe(true)
  })

  it('gives the latest city the presses, and the one before it back when it lets go', () => {
    const picker = createCityPicker()
    const first = target(false)
    const second = target(true)
    picker.connect(first)
    const letGo = picker.connect(second)
    expect(picker.over(POINT)).toBe(true)
    letGo()
    letGo()
    expect(picker.over(POINT)).toBe(false)
    picker.at(POINT)
    expect(first.openAt).toHaveBeenCalledTimes(1)
    expect(second.openAt).not.toHaveBeenCalled()
  })
})

describe('worldPicks', () => {
  it('hands each press to the street and the city, and closes the street’s card', () => {
    const street = createPicker()
    const city = createCityPicker()
    const customers = {
      pickAt: vi.fn(),
      isOver: vi.fn(() => false),
      pickNext: () => false,
      unpick: vi.fn(),
      hover: vi.fn(),
    }
    street.connect(customers)
    const buildings = target(true)
    city.connect(buildings)
    const picks = worldPicks(street, city)

    picks.at(POINT)
    expect(customers.pickAt).toHaveBeenCalledExactlyOnceWith(POINT)
    expect(buildings.openAt).toHaveBeenCalledExactlyOnceWith(POINT)
    expect(picks.over(POINT)).toBe(true)
    picks.close()
    expect(customers.unpick).toHaveBeenCalledTimes(1)
    // Only the street marks the spot under the pointer.
    picks.hover(POINT)
    picks.hover(null)
    expect(customers.hover.mock.calls).toEqual([[POINT], [null]])
  })
})
