import { describe, expect, it, vi } from 'vitest'
import {
  createCityPicker,
  worldPickChanges,
  worldPicks,
  type CityTarget,
} from './cityPicker.ts'
import { createPicker } from './picker.ts'

const POINT = { x: 10, y: 20 }

function target(over = true) {
  return {
    openAt: vi.fn(),
    isOver: vi.fn(() => over),
    hoverAt: vi.fn<CityTarget['hoverAt']>(() => false),
  }
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

  it('tells the city where the pointer is, and that it is gone when another city takes over or it lets go', () => {
    const picker = createCityPicker()
    const first = target()
    const second = target()
    const letFirstGo = picker.connect(first)
    picker.hover(POINT)
    picker.hover(null)
    expect(first.hoverAt.mock.calls).toEqual([[POINT], [null]])
    // A city that stops holding the picker names nothing any more.
    const letSecondGo = picker.connect(second)
    expect(first.hoverAt.mock.calls.at(-1)).toEqual([null])
    picker.hover(POINT)
    expect(second.hoverAt.mock.calls).toEqual([[POINT]])
    expect(first.hoverAt).toHaveBeenCalledTimes(3)
    letSecondGo()
    expect(second.hoverAt.mock.calls.at(-1)).toEqual([null])
    // Letting go while another holds it leaves that one be.
    const third = target()
    picker.connect(third)
    letFirstGo()
    expect(third.hoverAt).not.toHaveBeenCalled()
    expect(() => picker.hover(null)).not.toThrow()
  })

  it('tells its listeners each time the pointer changes what the city draws, and only then', () => {
    const picker = createCityPicker()
    const heard = vi.fn()
    const stop = picker.subscribe(heard)
    picker.hover(POINT)
    expect(heard).not.toHaveBeenCalled()
    const city = target()
    // The city names a building, then the same one again, then takes it down.
    city.hoverAt
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
    const letGo = picker.connect(city)
    picker.hover(POINT)
    expect(heard).toHaveBeenCalledTimes(1)
    picker.hover(POINT)
    expect(heard).toHaveBeenCalledTimes(1)
    picker.hover(null)
    expect(heard).toHaveBeenCalledTimes(2)
    // A city that lets go with a name up takes it down: that is heard too.
    city.hoverAt.mockReturnValueOnce(true)
    letGo()
    expect(heard).toHaveBeenCalledTimes(3)
    const other = target()
    other.hoverAt.mockReturnValue(true)
    picker.connect(other)
    stop()
    picker.hover(POINT)
    expect(heard).toHaveBeenCalledTimes(3)
  })
})

describe('worldPickChanges', () => {
  it('hears the street’s picker and the city’s, until it stops', () => {
    const street = createPicker()
    const city = createCityPicker()
    const buildings = target()
    buildings.hoverAt.mockReturnValue(true)
    city.connect(buildings)
    const heard = vi.fn()
    const stop = worldPickChanges(street, city)(heard)
    city.hover(POINT)
    expect(heard).toHaveBeenCalledTimes(1)
    // On an empty street, asking for a card says nobody is there.
    street.next()
    expect(heard).toHaveBeenCalledTimes(2)
    stop()
    city.hover(POINT)
    street.close()
    expect(heard).toHaveBeenCalledTimes(2)
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
    // Both hear where the pointer is: the street marks its spot, the city
    // names its building.
    picks.hover(POINT)
    picks.hover(null)
    expect(customers.hover.mock.calls).toEqual([[POINT], [null]])
    expect(buildings.hoverAt.mock.calls).toEqual([[POINT], [null]])
  })
})
