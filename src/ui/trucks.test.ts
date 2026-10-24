import { describe, expect, it } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { defaultWinterStorage } from '../engine/districts.ts'
import { cents } from '../engine/money.ts'
import { askingWage, isAbsent, quitsOnDay, STAFF } from '../engine/staff.ts'
import { FIRST_TRUCK } from '../engine/trucks.ts'
import type { GameState } from '../engine/types.ts'
import {
  dateDay,
  decided,
  hiring,
  playedTo,
  SECOND,
  withSecondTruck,
} from './fixtures/twoTrucks.ts'
import { staffBoard, todayWork } from './staffBoard.ts'
import {
  closedText,
  seasonChip,
  seasonMonths,
  seasonOf,
  storageDates,
  truckDayOf,
  truckName,
  unstaffedTomorrow,
  wasOpen,
  whoWorksToday,
} from './trucks.ts'

const START = createInitialState(42)
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7]
// A no-break space (U+00A0) goes before a colon.
const S = ' '

/** Who works at each truck of `game` today, first truck first. */
function who(game: GameState): [string, string] {
  const work = todayWork(game)
  return [whoWorksToday(FIRST_TRUCK, work), whoWorksToday(SECOND, work)]
}

/** The second truck open every day, with `changes`, from the next morning on. */
function twoTrucks(...changes: Parameters<typeof decided>[1][]): GameState {
  return tick(
    withSecondTruck(
      START,
      { kind: 'daysOpen', weekdays: EVERY_DAY, truck: SECOND },
      ...changes,
    ),
  )
}

describe('the trucks’ names', () => {
  it('names each truck after its district', () => {
    const game = withSecondTruck(START)
    expect(truckName(game, FIRST_TRUCK)).toBe('Plateau')
    expect(truckName(game, SECOND)).toBe('Vieux-Montréal')
  })
})

describe('whoWorksToday (#265)', () => {
  it('says « vous » where the owner works and the employees’ first names at theirs', () => {
    // Day 1, a Tuesday: Kevin at the Plateau, the owner at Vieux-Montréal.
    const game = twoTrucks(hiring('kevin'), { kind: 'ownerAt', truck: SECOND })
    expect(game.day).toBe(1)
    expect(who(game)).toEqual(['Kevin', 'vous'])
    const both = twoTrucks(hiring('kevin'))
    expect(who(both)).toEqual(['vous et Kevin', 'fermé'])
  })

  it('opens the second truck with the owner alone there, the Plateau closed', () => {
    // The Plateau opens on Mondays only: Tuesday it is closed.
    const game = twoTrucks(
      { kind: 'daysOpen', weekdays: [1] },
      { kind: 'ownerAt', truck: SECOND },
    )
    expect(who(game)).toEqual(['fermé', 'vous'])
    const work = todayWork(game)
    expect(work.opens).toBe(false)
    expect(work.trucks.map(({ opens }) => opens)).toEqual([false, true])
    // The owner still serves, at the truck that opens.
    expect(staffBoard(game).owner.tasks).toEqual(['truck'])
  })

  it('follows each truck’s own days and storage', () => {
    const game = twoTrucks(
      hiring('kevin'),
      { kind: 'assign', candidate: 'kevin', truck: SECOND },
      // Stored over day 1, May 2nd.
      {
        kind: 'storage',
        storage: { from: { month: 5, day: 1 }, to: { month: 5, day: 31 } },
        truck: SECOND,
      },
    )
    expect(who(game)).toEqual(['vous', 'remisé'])
    // Kevin's truck does not open: no « Au camion » for him today.
    const kevin = staffBoard(game).members[0]
    expect(kevin?.tasks).toEqual([])
    expect(staffBoard(game).owner.tasks).toEqual(['truck'])
    // The Plateau closed on Tuesdays leaves the owner nothing to do there.
    const closed = twoTrucks({ kind: 'daysOpen', weekdays: [1] })
    expect(who(closed)).toEqual(['fermé', 'fermé'])
    expect(staffBoard(closed).owner.tasks).toEqual([])
  })

  it('closes a truck whose only employee is absent today', () => {
    const kevin = { candidate: 'kevin', role: 'camion' } as const
    let absentOn = 2
    while (!isAbsent(START.seed, absentOn, kevin)) absentOn += 1
    const game = playedTo(
      twoTrucks(hiring('kevin'), {
        kind: 'assign',
        candidate: 'kevin',
        truck: SECOND,
      }),
      absentOn,
    )
    expect(todayWork(game).absent).toEqual(['kevin'])
    expect(who(game)[1]).toBe('fermé')
    expect(staffBoard(game).members[0]?.tasks).toEqual(['absent'])
  })

  it('closes a truck whose only employee quits this morning', () => {
    const wage = STAFF.roles.camion.hourlyWageCents.min
    expect(askingWage('kevin', 'camion')).toBeGreaterThan(wage)
    const hired = twoTrucks(hiring('kevin', cents(wage)), {
      kind: 'assign',
      candidate: 'kevin',
      truck: SECOND,
    })
    // Kevin starts on the morning of day 1, on the staff from its close.
    const employee = tick(hired).staff[0]
    if (employee === undefined) throw new Error('Kevin works')
    const quits = quitsOnDay(employee)
    if (quits === null) throw new Error('Kevin is underpaid')
    const game = playedTo(hired, quits)
    expect(todayWork(game).quits).toEqual(['kevin'])
    expect(who(game)).toEqual(['vous', 'fermé'])
  })

  it('closes a truck whose district’s street an event closes', () => {
    const game = twoTrucks({ kind: 'ownerAt', truck: SECOND })
    const closed: GameState = {
      ...game,
      events: {
        ...game.events,
        modifiers: [
          {
            event: 'essai',
            change: { kind: 'closed' },
            fromDay: game.day,
            lastDay: game.day,
            district: SECOND,
          },
        ],
      },
    }
    expect(who(closed)).toEqual(['fermé', 'fermé'])
    expect(staffBoard(closed).owner.tasks).toEqual([])
  })
})

describe('unstaffedTomorrow (#265)', () => {
  it('lists the truck the owner leaves with nobody, as the latest decisions have it', () => {
    const game = withSecondTruck(START, {
      kind: 'daysOpen',
      weekdays: EVERY_DAY,
      truck: SECOND,
    })
    // The owner at the Plateau: Vieux-Montréal opens tomorrow with nobody.
    expect(unstaffedTomorrow(game)).toEqual([SECOND])
    const moved = decided(game, { kind: 'ownerAt', truck: SECOND })
    expect(unstaffedTomorrow(moved)).toEqual([FIRST_TRUCK])
    const kevin = decided(moved, hiring('kevin'))
    expect(unstaffedTomorrow(kevin)).toEqual([])
    const assigned = decided(kevin, {
      kind: 'assign',
      candidate: 'kevin',
      truck: SECOND,
    })
    expect(unstaffedTomorrow(assigned)).toEqual([FIRST_TRUCK])
  })

  it('leaves out a truck stored or not open tomorrow, and one-truck games', () => {
    expect(unstaffedTomorrow(START)).toEqual([])
    const stored = withSecondTruck(START, {
      kind: 'storage',
      storage: { from: { month: 5, day: 1 }, to: { month: 5, day: 31 } },
      truck: SECOND,
    })
    expect(unstaffedTomorrow(stored)).toEqual([])
    const closed = withSecondTruck(START, {
      kind: 'daysOpen',
      weekdays: [1],
      truck: SECOND,
    })
    expect(unstaffedTomorrow(closed)).toEqual([])
  })
})

describe('the seasons (#265)', () => {
  it('reads each month’s season from the district’s crowd', () => {
    expect(seasonOf('vieuxMontreal', 7)).toBe('haute')
    expect(seasonOf('vieuxMontreal', 2)).toBe('basse')
    expect(seasonOf('vieuxMontreal', 10)).toBe('normale')
    expect(seasonOf('plateau', 7)).toBe('normale')
  })

  it('gives the months as runs, over the year’s end', () => {
    expect(seasonMonths('vieuxMontreal', 'haute')).toBe('juin à août')
    expect(seasonMonths('vieuxMontreal', 'basse')).toBe('décembre à mars')
    expect(seasonMonths('plateau', 'normale')).toBe("toute l'année")
  })

  it('makes the chip and its tooltip', () => {
    expect(seasonChip('vieuxMontreal', 7)).toEqual({
      season: 'haute',
      label: 'Haute saison',
      tip: {
        title: 'Vieux-Montréal',
        rows: [
          { label: 'Haute saison', value: 'juin à août' },
          { label: 'Basse saison', value: 'décembre à mars' },
        ],
      },
    })
    expect(seasonChip('vieuxMontreal', 2).label).toBe('Basse saison')
    expect(seasonChip('plateau', 2)).toEqual({
      season: 'normale',
      label: 'Saison normale',
      tip: { title: 'Plateau', text: "Saison normale toute l'année" },
    })
  })
})

describe('a truck’s last day (#265)', () => {
  it('reads the first truck’s from the game and the others’ from their own', () => {
    const bought = withSecondTruck(START)
    // A truck just bought has no day yet.
    expect(truckDayOf(bought, SECOND)).toBeNull()
    expect(closedText(bought, SECOND)).toBeNull()
    const played = tick(
      decided(bought, { kind: 'daysOpen', weekdays: EVERY_DAY, truck: SECOND }),
    )
    // Day 0, a Monday: the Plateau closed, Vieux-Montréal open with nobody.
    expect(truckDayOf(played, FIRST_TRUCK)).toBe(played.lastDay)
    expect(truckDayOf(played, SECOND)).toBe(played.trucks?.[0]?.lastDay)
    expect(closedText(played, FIRST_TRUCK)).toBe('Fermé')
    expect(closedText(played, SECOND)).toBe('Fermé')
    const next = tick(played)
    expect(wasOpen(next.lastDay!)).toBe(true)
    expect(closedText(next, FIRST_TRUCK)).toBeNull()
  })

  it('says « Fermé pour l’hiver » for a day the storage covered, the day after its last too', () => {
    // A day Vieux-Montréal was closed, as the engine records it.
    const closedDay = tick(withSecondTruck(START)).trucks?.[0]?.lastDay
    if (closedDay === null || closedDay === undefined) throw new Error('Played')
    expect(closedDay.open).toBe(false)
    const april30 = dateDay(2, 4, 30)
    const stored = withSecondTruck(START, {
      kind: 'storage',
      storage: defaultWinterStorage(),
      truck: SECOND,
    })
    const reported = (day: number): GameState => ({
      ...stored,
      day: april30 + 1,
      decisions: stored.pendingDecisions ?? stored.decisions,
      trucks: stored.trucks?.map((truck) => ({
        ...truck,
        lastDay: { ...closedDay, day },
      })),
    })
    // Reported on April 30th, read on May 1st, when the truck is back.
    expect(closedText(reported(april30), SECOND)).toBe("Fermé pour l'hiver")
    expect(closedText(reported(april30 + 1), SECOND)).toBe('Fermé')
  })

  it('words the storage’s dates', () => {
    expect(storageDates(defaultWinterStorage())).toBe(
      'Du 1er décembre au 30 avril',
    )
    expect(`${S}`).toBe(' ')
  })
})
