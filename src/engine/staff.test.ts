import { describe, expect, it } from 'vitest'
import staffJson from '../content/staff.json'
import {
  candidateIdSchema,
  loadStaffContent,
  staffRoleIdSchema,
  traitIdSchema,
  type CandidateId,
  type StaffContent,
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
  askingWage,
  crewOf,
  hasWarned,
  isAbsent,
  knownTraits,
  payWages,
  quitsOnDay,
  quitting,
  staffMemo,
  staffMorning,
  traitLevel,
  traitValue,
  warnsOnDay,
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
  it.each<
    [
      string,
      readonly Employee[],
      boolean,
      Omit<ReturnType<typeof crewOf>, 'truckers' | 'baker'>,
    ]
  >([
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
    const { truckers, baker, ...rest } = crewOf(staff, away)
    expect(rest).toEqual(crew)
    expect(truckers).toEqual(staff.filter(({ role }) => role === 'camion'))
    expect(baker).toEqual(
      staff.find(({ role }) => role === 'boulanger') ?? null,
    )
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
    // Amélie asks more than the start, so she is underpaid from her first
    // day; Sophie, at 25 $, is not.
    expect(staff).toEqual([
      { ...AMELIE, hiredOnDay: DAY, underpaidSince: DAY },
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
    expect(staff).toEqual([{ ...AMELIE, underpaidSince: DAY }])
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
    expect(staff).toEqual([
      { ...KEVIN, hourlyWage: 1_800 },
      { ...AMELIE, underpaidSince: DAY },
    ])
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

describe('crewOf with absences', () => {
  it('leaves an absent employee’s work undone, even with the owner at work', () => {
    const crew = crewOf([AMELIE, KEVIN, SOPHIE], false, ['kevin', 'sophie'])
    expect(crew).toEqual({
      ownerServes: true,
      atTruck: 1,
      truckers: [AMELIE],
      delivers: null,
      bakes: null,
      baker: null,
    })
    expect(crewOf([AMELIE], true, ['amelie'])).toMatchObject({
      ownerServes: false,
      atTruck: 0,
      truckers: [],
    })
  })

  it('lets another employee in the role do the work', () => {
    const other = employee('maude', 'boulanger')
    const crew = crewOf([SOPHIE, other], false, ['sophie'])
    expect(crew.bakes).toBe('employee')
    expect(crew.baker).toEqual(other)
  })
})

/** The issue's table of strengths and weaknesses (#255). */
const TABLE: Record<CandidateId, [string, string]> = {
  kevin: ['rapidite', 'minutie'],
  nadia: ['rapidite', 'fiabilite'],
  samuel: ['rapidite', 'accueil'],
  isabelle: ['minutie', 'rapidite'],
  thierry: ['minutie', 'fiabilite'],
  mathieu: ['minutie', 'accueil'],
  sophie: ['fiabilite', 'rapidite'],
  jonathan: ['fiabilite', 'minutie'],
  maude: ['fiabilite', 'accueil'],
  amelie: ['accueil', 'rapidite'],
  chloe: ['accueil', 'minutie'],
  olivier: ['accueil', 'fiabilite'],
}

describe('the traits', () => {
  it("gives each candidate the issue's strength and weakness", () => {
    for (const candidate of candidateIdSchema.options) {
      const { strength, weakness } = STAFF.candidates[candidate]
      expect([strength, weakness], candidate).toEqual(TABLE[candidate])
    }
  })

  it('ships the starting values of the issue, acting where it says', () => {
    expect(
      Object.fromEntries(
        traitIdSchema.options.map((id) => {
          const { roles, strong, weak } = STAFF.traits[id]
          return [id, { roles, strong, weak }]
        }),
      ),
    ).toEqual({
      rapidite: { roles: ['camion'], strong: 1.15, weak: 0.85 },
      minutie: { roles: ['camion', 'boulanger'], strong: 0.5, weak: 1.6 },
      fiabilite: {
        roles: ['camion', 'livreur', 'boulanger'],
        strong: 0,
        weak: 0.06,
      },
      accueil: { roles: ['camion'], strong: 1.04, weak: 0.96 },
    })
    expect(STAFF.welcomedSegment).toBe('habitue')
  })

  it.each(
    staffRoleIdSchema.options.flatMap((role) =>
      traitIdSchema.options.map((trait) => [trait, role] as const),
    ),
  )('moves %s as %s only where it acts', (trait, role) => {
    const values = STAFF.traits[trait]
    const acts = values.roles.includes(role)
    for (const candidate of candidateIdSchema.options) {
      const level = traitLevel(candidate, trait)
      expect(traitValue(candidate, trait, role), candidate).toBe(
        acts ? values[level] : values.normal,
      )
    }
  })

  it('reads a strength, a weakness or neither', () => {
    expect(traitLevel('kevin', 'rapidite')).toBe('strong')
    expect(traitLevel('kevin', 'minutie')).toBe('weak')
    expect(traitLevel('kevin', 'accueil')).toBe('normal')
  })
})

describe('askingWage', () => {
  it("asks the role's start, plus the strength's premium, less the weakness's discount", () => {
    for (const candidate of candidateIdSchema.options) {
      const { strength, weakness } = STAFF.candidates[candidate]
      for (const role of staffRoleIdSchema.options) {
        const { min, start, max } = STAFF.roles[role].hourlyWageCents
        const asked =
          start +
          STAFF.traits[strength].askingPremiumCents -
          STAFF.traits[weakness].askingDiscountCents
        // Within the role's wages as shipped, so never clamped.
        expect(asked).toBeGreaterThanOrEqual(min)
        expect(asked).toBeLessThanOrEqual(max)
        expect(askingWage(candidate, role)).toBe(asked)
      }
    }
  })

  it('stays within the role’s wages', () => {
    const steep = (premium: number, discount: number): StaffContent => ({
      ...STAFF,
      traits: {
        ...STAFF.traits,
        rapidite: {
          ...STAFF.traits.rapidite,
          askingPremiumCents: cents(premium),
          askingDiscountCents: cents(discount),
        },
      },
    })
    // Kevin is strong in rapidité, Isabelle weak.
    expect(askingWage('kevin', 'camion', steep(100_000, 0))).toBe(2500)
    expect(askingWage('isabelle', 'camion', steep(0, 100_000))).toBe(1600)
  })
})

describe('knownTraits', () => {
  it('shows the strength at the interview, the weakness from discoveryDays on the job', () => {
    expect(STAFF.discoveryDays).toBe(14)
    expect(knownTraits('kevin', null, 50)).toEqual({
      strength: 'rapidite',
      weakness: null,
    })
    expect(knownTraits('kevin', 10, 10)).toEqual({
      strength: 'rapidite',
      weakness: null,
    })
    expect(knownTraits('kevin', 10, 23)).toEqual({
      strength: 'rapidite',
      weakness: null,
    })
    expect(knownTraits('kevin', 10, 24)).toEqual({
      strength: 'rapidite',
      weakness: 'minutie',
    })
  })

  it('hides it again for someone hired again, from their new start', () => {
    expect(knownTraits('kevin', 100, 110).weakness).toBeNull()
    expect(knownTraits('kevin', 100, 114).weakness).toBe('minutie')
  })
})

describe('isAbsent', () => {
  const days = Array.from({ length: 20_000 }, (_, day) => day)

  it('is the same for a seed, a day and a candidate, and differs between seeds', () => {
    const pattern = (seed: number) =>
      days
        .slice(0, 2000)
        .map((day) => isAbsent(seed, day, hire(employee('nadia', 'camion'))))
    expect(pattern(42)).toEqual(pattern(42))
    expect(pattern(42)).not.toEqual(pattern(43))
  })

  it.each([
    ['sophie', 'strong'],
    ['amelie', 'normal'],
    ['nadia', 'weak'],
  ] as const)(
    'comes close to the fiabilité chance for %s, %s',
    (candidate, level) => {
      const chance = STAFF.traits.fiabilite[level]
      const absent = days.filter((day) =>
        isAbsent(7, day, { candidate, role: 'livreur' }),
      ).length
      expect(absent / days.length).toBeCloseTo(chance, 2)
      if (chance === 0) expect(absent).toBe(0)
    },
  )

  it('draws each candidate apart', () => {
    const one = days.filter((day) =>
      isAbsent(7, day, { candidate: 'nadia', role: 'camion' }),
    )
    const other = days.filter((day) =>
      isAbsent(7, day, { candidate: 'thierry', role: 'camion' }),
    )
    expect(one).not.toEqual(other)
  })
})

describe('the underpaid', () => {
  // Amélie asks 18 $ at the truck, above its start of 17,50 $.
  const ASKING = askingWage('amelie', 'camion')

  it('count from the first morning below the asking wage, and stop counting once paid it', () => {
    expect(ASKING).toBe(1800)
    const first = staffMorning(emptyJournal(), [], [hire(AMELIE)], DAY).staff
    expect(first).toEqual([{ ...AMELIE, hiredOnDay: DAY, underpaidSince: DAY }])
    const later = staffMorning(emptyJournal(), first, [hire(AMELIE)], DAY + 9)
    expect(later.staff).toEqual(first)
    const raised = staffMorning(
      emptyJournal(),
      first,
      [{ ...hire(AMELIE), hourlyWage: ASKING }],
      DAY + 9,
    )
    expect(raised.staff).toEqual([
      { ...AMELIE, hourlyWage: ASKING, hiredOnDay: DAY },
    ])
    const cutAgain = staffMorning(
      emptyJournal(),
      raised.staff,
      [hire(AMELIE)],
      DAY + 20,
    )
    expect(cutAgain.staff[0]?.underpaidSince).toBe(DAY + 20)
  })

  it('warn after underpaidWeeks and quit warningWeeks later', () => {
    const underpaid = { ...AMELIE, underpaidSince: 40 }
    expect([STAFF.underpaidWeeks, STAFF.warningWeeks]).toEqual([8, 1])
    expect(warnsOnDay(underpaid)).toBe(40 + 56)
    expect(quitsOnDay(underpaid)).toBe(40 + 63)
    expect(warnsOnDay(AMELIE)).toBeNull()
    expect(quitsOnDay(AMELIE)).toBeNull()
    expect(hasWarned(underpaid, 95)).toBe(false)
    expect(hasWarned(underpaid, 96)).toBe(true)
    expect(hasWarned(AMELIE, 1000)).toBe(false)
  })

  it('leave on the morning they quit, posting nothing', () => {
    const underpaid = { ...AMELIE, underpaidSince: 40 }
    expect(quitting([underpaid, KEVIN], 102)).toEqual({
      staff: [underpaid, KEVIN],
      quits: [],
    })
    expect(quitting([KEVIN, underpaid], 103)).toEqual({
      staff: [KEVIN],
      quits: ['amelie'],
    })
  })
})
