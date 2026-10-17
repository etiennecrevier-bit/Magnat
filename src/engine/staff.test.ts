import { describe, expect, it } from 'vitest'
import staffJson from '../content/staff.json'
import {
  loadStaffContent,
  type CandidateId,
  type StaffRoleId,
} from '../content/schema.ts'
import {
  emptyJournal,
  entriesOf,
  trialBalance,
  type JournalEntry,
} from '../finance/journal.ts'
import { cents } from './money.ts'
import {
  STAFF,
  STAFF_MEMO,
  crewOf,
  payWages,
  staffMemo,
  staffMorning,
  weeklyWage,
  weeklyWages,
} from './staff.ts'
import type { Employee, Hire } from './types.ts'

const DAY = 30

/** `candidate` as `role`, at `wage` an hour, on staff since `hiredOnDay`. */
function employee(
  candidate: CandidateId,
  role: StaffRoleId,
  wage: number = STAFF.roles[role].hourlyWageCents.start,
  hiredOnDay = 3,
): Employee {
  return { candidate, role, hourlyWage: cents(wage), hiredOnDay }
}

/** `who` as the player wants them: without the day they started. */
function hire({ candidate, role, hourlyWage }: Employee): Hire {
  return { candidate, role, hourlyWage }
}

/** A payment out of Encaisse to 6000 Salaires. */
function wages(memo: string, amount: number, day = DAY): JournalEntry {
  return {
    day,
    memo,
    lines: [
      { account: '6000', debit: cents(amount), credit: cents(0) },
      { account: '1000', debit: cents(0), credit: cents(amount) },
    ],
  }
}

const AMELIE = employee('amelie', 'camion')
const KEVIN = employee('kevin', 'livreur')
const SOPHIE = employee('sophie', 'boulanger')
/** The baker's hours a week, as staff.json ships them. */
const BAKER_HOURS = STAFF.roles.boulanger.hoursPerWeek

describe('the shipped staff', () => {
  it("holds the issue's three roles and wages, a week of training and two of notice", () => {
    expect(STAFF.maxEmployees).toBe(3)
    expect(STAFF.trainingWeeks).toBe(1)
    expect(STAFF.noticeWeeks).toBe(2)
    expect(STAFF.truckSpeed).toBe(0.85)
    expect(
      Object.entries(STAFF.roles).map(([id, role]) => [
        id,
        role.name,
        role.hoursPerWeek,
        role.hourlyWageCents.start,
      ]),
    ).toEqual([
      ['camion', 'Au camion', 35, 1750],
      ['livreur', 'Livreur', 10, 1600],
      ['boulanger', 'Boulanger', 16, 2200],
    ])
    expect(Object.keys(STAFF.candidates)).toHaveLength(12)
  })
})

describe('crewOf', () => {
  it.each<[string, readonly Employee[], boolean, ReturnType<typeof crewOf>]>([
    [
      'the owner alone',
      [],
      false,
      { ownerServes: true, atTruck: 0, delivers: 'owner', bakes: 'owner' },
    ],
    [
      'the owner away, alone',
      [],
      true,
      { ownerServes: false, atTruck: 0, delivers: null, bakes: null },
    ],
    [
      'an employee at the truck',
      [AMELIE],
      false,
      { ownerServes: true, atTruck: 1, delivers: 'owner', bakes: 'owner' },
    ],
    [
      'an employee at the truck, the owner away',
      [AMELIE],
      true,
      { ownerServes: false, atTruck: 1, delivers: null, bakes: null },
    ],
    [
      'a deliverer and a baker',
      [KEVIN, SOPHIE],
      false,
      {
        ownerServes: true,
        atTruck: 0,
        delivers: 'employee',
        bakes: 'employee',
      },
    ],
    [
      'everyone, the owner away',
      [AMELIE, KEVIN, SOPHIE],
      true,
      {
        ownerServes: false,
        atTruck: 1,
        delivers: 'employee',
        bakes: 'employee',
      },
    ],
    [
      'two at the truck',
      [AMELIE, employee('mathieu', 'camion')],
      true,
      { ownerServes: false, atTruck: 2, delivers: null, bakes: null },
    ],
  ])('with %s', (_, staff, away, crew) => {
    expect(crewOf(staff, away)).toEqual(crew)
  })
})

describe('the wages', () => {
  it("are the hourly wage × the role's hours, in whole cents", () => {
    expect(weeklyWage(AMELIE)).toBe(1750 * 35)
    expect(weeklyWage(KEVIN)).toBe(1600 * 10)
    expect(weeklyWage(SOPHIE)).toBe(2200 * BAKER_HOURS)
    expect(weeklyWages([AMELIE, KEVIN, SOPHIE])).toBe(
      61_250 + 16_000 + 2200 * BAKER_HOURS,
    )
    expect(weeklyWages([])).toBe(0)
  })

  it('pay each employee a full week, in the order of the staff, balanced', () => {
    const journal = payWages(emptyJournal(), [KEVIN, AMELIE], DAY)
    expect(entriesOf(journal)).toEqual([
      wages('Salaire · Kevin Bouchard', 16_000),
      wages('Salaire · Amélie Gagnon', 61_250),
    ])
    const { totalDebit, totalCredit } = trialBalance(journal, DAY)
    expect(totalDebit).toBe(totalCredit)
    expect(payWages(emptyJournal(), [], DAY)).toEqual(emptyJournal())
  })

  it('name the employee after the memo', () => {
    expect(staffMemo(STAFF_MEMO.notice, 'Chloé Morin')).toBe(
      'Préavis · Chloé Morin',
    )
  })
})

describe('staffMorning', () => {
  it('changes nothing with nobody on staff or wanted', () => {
    const journal = emptyJournal()
    const morning = staffMorning(journal, [], [], DAY)
    expect(morning.journal).toBe(journal)
    expect(morning.staff).toEqual([])
  })

  it('hires those wanted after a week of training at the wage they get, from that day', () => {
    const plan = [hire(AMELIE), { ...hire(SOPHIE), hourlyWage: cents(2_500) }]
    const { journal, staff } = staffMorning(emptyJournal(), [], plan, DAY)
    expect(staff).toEqual([
      { ...AMELIE, hiredOnDay: DAY },
      { ...SOPHIE, hourlyWage: 2_500, hiredOnDay: DAY },
    ])
    expect(entriesOf(journal)).toEqual([
      wages('Formation · Amélie Gagnon', 1750 * 35),
      wages('Formation · Sophie Roy', 2500 * BAKER_HOURS),
    ])
  })

  it('lets go at once, with two weeks of notice at the wage they had, those no longer wanted', () => {
    const raised = { ...KEVIN, hourlyWage: cents(2_000) }
    const { journal, staff } = staffMorning(
      emptyJournal(),
      [AMELIE, raised],
      [hire(AMELIE)],
      DAY,
    )
    expect(staff).toEqual([AMELIE])
    expect(entriesOf(journal)).toEqual([
      wages('Préavis · Kevin Bouchard', 2_000 * 10 * 2),
    ])
  })

  it('keeps those who stay with the day they started, at the wage the plan gives, in its order', () => {
    const { journal, staff } = staffMorning(
      emptyJournal(),
      [AMELIE, KEVIN],
      [{ ...hire(KEVIN), hourlyWage: cents(1_800) }, hire(AMELIE)],
      DAY,
    )
    expect(staff).toEqual([{ ...KEVIN, hourlyWage: 1_800 }, AMELIE])
    expect(entriesOf(journal)).toEqual([])
  })

  it('lets go before it hires, each entry balanced', () => {
    const { journal } = staffMorning(
      emptyJournal(),
      [AMELIE],
      [hire(employee('kevin', 'livreur'))],
      DAY,
    )
    expect(entriesOf(journal).map(({ memo }) => memo)).toEqual([
      'Préavis · Amélie Gagnon',
      'Formation · Kevin Bouchard',
    ])
    const { totalDebit, totalCredit } = trialBalance(journal, DAY)
    expect(totalDebit).toBe(totalCredit)
    expect(totalDebit).toBe(1750 * 35 * 2 + 1600 * 10)
  })

  it('takes the weeks of training and notice from the content', () => {
    const content = loadStaffContent({
      ...staffJson,
      trainingWeeks: 0,
      noticeWeeks: 3,
    })
    const { journal } = staffMorning(
      emptyJournal(),
      [AMELIE],
      [hire(KEVIN)],
      DAY,
      content,
    )
    expect(entriesOf(journal)).toEqual([
      wages('Préavis · Amélie Gagnon', 1750 * 35 * 3),
    ])
  })

  it('throws when the plan gives someone on staff another role', () => {
    expect(() =>
      staffMorning(
        emptyJournal(),
        [AMELIE],
        [{ ...hire(AMELIE), role: 'livreur', hourlyWage: cents(1_600) }],
        DAY,
      ),
    ).toThrow('amelie works as camion, not livreur')
  })

  it('never mutates its arguments', () => {
    const staff = Object.freeze([Object.freeze({ ...AMELIE })])
    const plan = Object.freeze([Object.freeze(hire(KEVIN))])
    staffMorning(emptyJournal(), staff, plan, DAY)
    expect(staff).toEqual([AMELIE])
    expect(plan).toEqual([hire(KEVIN)])
  })
})
