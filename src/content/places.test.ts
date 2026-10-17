import { describe, expect, it } from 'vitest'
import foodTruckJson from './foodtruck.json'
import placesJson from './places.json'
import { loadFoodTruckContent, loadPlacesContent } from './schema.ts'

// « Aller à… » (#164): the places of places.json, and the rules the loader
// holds them to against the truck's opening hours (7 h to 15 h).

type Json = Record<string, unknown>
type Places = Json & typeof placesJson

const OPENS = foodTruckJson.walkIns.opensAtMinute
const CLOSES = foodTruckJson.walkIns.closesAtMinute

/** places.json with `change` made to a copy of it. */
function changed(change: (places: Places) => void): unknown {
  const copy = structuredClone(placesJson) as Places
  change(copy)
  return copy
}

/** places.json with `change` made to a copy of the place `id`. */
function changedPlace(id: string, change: (place: Json) => void): unknown {
  return changed(({ places }) => {
    const place = places.find((candidate) => candidate.id === id)
    if (place === undefined) throw new Error(`No place ${id}`)
    change(place as Json)
  })
}

/** Why `raw` fails to load, against `foodTruck`; fails if it loads. */
function problems(raw: unknown, foodTruck = loadFoodTruckContent()): string {
  try {
    loadPlacesContent(raw, foodTruck)
  } catch (error) {
    return (error as Error).message
  }
  throw new Error('places.json loaded')
}

/** Expects `raw` to fail to load, its message holding `reason`. */
function expectInvalid(raw: unknown, reason: string): void {
  expect(problems(raw)).toContain(reason)
}

describe('places.json', () => {
  it('lists the four places in the order of the panel, each with its effect', () => {
    const content = loadPlacesContent()
    expect(content.leavesAtMinute).toBe(600)
    expect(content.energyCost).toBe(3)
    expect(
      content.places.map((place) => [
        place.id,
        'wholeDay' in place
          ? 'wholeDay'
          : [place.walkMinutes, place.visitMinutes],
        place.effect,
      ]),
    ).toEqual([
      ['caisse', [25, 30], { kind: 'loanAppointment' }],
      ['meunerie', [40, 30], { kind: 'discount', share: 0.05 }],
      ['bureauPermis', 'wholeDay', { kind: 'filing' }],
      ['fournil', [15, 15], { kind: 'none' }],
    ])
  })
})

describe('loadPlacesContent', () => {
  it('rejects a place listed twice, a place missing and an id that is no place', () => {
    expectInvalid(
      changed(({ places }) => {
        places.push(structuredClone(places[0]!))
      }),
      'the place caisse must be listed once, not 2 times',
    )
    expectInvalid(
      changed((places) => {
        places.places = places.places.filter(({ id }) => id !== 'fournil')
      }),
      'the place fournil must be listed once, not 0 times',
    )
    expectInvalid(
      changedPlace('fournil', (place) => {
        place.id = 'banque'
      }),
      '→ at places[3]',
    )
    expectInvalid(
      changed((places) => {
        places.places = []
      }),
      'Too small: expected array to have >=1 items',
    )
  })

  it.each([
    ['walkMinutes', 0],
    ['walkMinutes', -5],
    ['walkMinutes', 12.5],
    ['visitMinutes', 0],
    ['visitMinutes', 7.5],
  ])('rejects %s of %d', (field, minutes) => {
    expectInvalid(
      changedPlace('caisse', (place) => {
        place[field] = minutes
      }),
      '→ at places[0]',
    )
  })

  it('rejects a timed place without its minutes, and a whole day with them', () => {
    expectInvalid(
      changedPlace('caisse', (place) => {
        delete place.visitMinutes
      }),
      '→ at places[0]',
    )
    expectInvalid(
      changedPlace('bureauPermis', (place) => {
        place.walkMinutes = 20
      }),
      'Unrecognized key: "walkMinutes"',
    )
    expectInvalid(
      changedPlace('bureauPermis', (place) => {
        place.wholeDay = false
      }),
      '→ at places[2]',
    )
  })

  it.each([0, 1, -0.05, 1.5])('rejects a discount of share %d', (share) => {
    expectInvalid(
      changedPlace('meunerie', (place) => {
        place.effect = { kind: 'discount', share }
      }),
      '→ at places[1].effect.share',
    )
  })

  it('rejects an effect of no known kind, a stray field and blank French text', () => {
    expectInvalid(
      changedPlace('fournil', (place) => {
        place.effect = { kind: 'gift' }
      }),
      '→ at places[3]',
    )
    expectInvalid(
      changedPlace('fournil', (place) => {
        place.effect = { kind: 'none', share: 0.05 }
      }),
      '→ at places[3]',
    )
    expectInvalid(
      changedPlace('fournil', (place) => {
        place.color = 'rouge'
      }),
      '→ at places[3]',
    )
    expectInvalid(
      changedPlace('fournil', (place) => {
        place.does = 'Voir le fournil '
      }),
      'text starts and ends with a character, not a space',
    )
    expectInvalid(
      changedPlace('fournil', (place) => {
        place.name = ''
      }),
      '→ at places[3]',
    )
  })

  it('rejects an energy cost outside what the owner can have', () => {
    expectInvalid(
      changed((places) => {
        places.energyCost = -1
      }),
      '→ at energyCost',
    )
    expectInvalid(
      changed((places) => {
        places.energyCost = 101
      }),
      '→ at energyCost',
    )
  })

  it('lets the owner leave from the minute the truck opens, not before nor once it closes', () => {
    // From 7 h, the farthest place, the mill, is back at 8 h 50.
    const at = (minute: number) =>
      changed((places) => {
        places.leavesAtMinute = minute
      })
    expect(loadPlacesContent(at(OPENS)).leavesAtMinute).toBe(OPENS)
    expectInvalid(
      at(OPENS - 1),
      `the owner leaves while the truck is open, from minute ${OPENS} to ${CLOSES}`,
    )
    expectInvalid(at(CLOSES), 'the owner leaves while the truck is open')
  })

  it('takes a place the owner is back from right when the truck closes, not a minute later', () => {
    // From 10 h, 2 × 120 minutes on foot and a visit of 60 end at 15 h.
    const lasting = (visitMinutes: number) =>
      changedPlace('meunerie', (place) => {
        place.walkMinutes = 120
        place.visitMinutes = visitMinutes
      })
    const meunerie = loadPlacesContent(lasting(60)).places[1]
    expect(meunerie).toMatchObject({ walkMinutes: 120, visitMinutes: 60 })
    expectInvalid(
      lasting(61),
      `the owner is back from meunerie at minute ${CLOSES + 1}, after the truck closes at ${CLOSES}`,
    )
  })

  it('holds no whole day to the closing time', () => {
    const late = problems(
      changed((places) => {
        places.leavesAtMinute = CLOSES - 1
      }),
    )
    for (const id of ['caisse', 'meunerie', 'fournil']) {
      expect(late).toContain(`the owner is back from ${id} at minute`)
    }
    expect(late).not.toContain('bureauPermis')
  })

  it("checks the minutes against the truck's hours it is given", () => {
    const truck = loadFoodTruckContent()
    // Closing at 11 h 30, the mill (10 h to 11 h 50) is back too late.
    const early = problems(placesJson, {
      ...truck,
      walkIns: { ...truck.walkIns, closesAtMinute: 690 },
    })
    expect(early).toContain(
      'the owner is back from meunerie at minute 710, after the truck closes at 690',
    )
    expect(early).not.toMatch(/caisse|fournil/)
  })
})
