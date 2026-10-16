import {
  loadStaffContent,
  type StaffContent,
  type StaffRoleId,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import type { Journal } from '../finance/journal.ts'
import { mulInt, sum, type Cents } from './money.ts'
import { pay } from './posting.ts'
import type { Day, Employee, Hire } from './types.ts'

// The employees (#158). The player's plan, `Decisions.staff`, hires and
// lets go on the morning it takes effect: a hire costs a week of training
// up front, firing two weeks of notice, and the employee leaves at once.
// Each payday pays everyone on staff a full week. An employee at the truck
// serves beside the owner, a deliverer makes the grocers' deliveries and a
// baker the bakery's croissants, so the owner need not, or may be away.
// Employees never tire: their traits wait for phase 5. Nothing here draws
// from the generator.

/** The shipped employees' content, validated once when the engine loads. */
export const STAFF: StaffContent = loadStaffContent()

const WAGES: AccountCode = '6000'

/** The roles the engine gives work to, by their id in the content. */
const AT_TRUCK: StaffRoleId = 'camion'
const DELIVERS: StaffRoleId = 'livreur'
const BAKES: StaffRoleId = 'boulanger'

/**
 * The memos of the employees' entries, as the player reads them, each
 * followed by the employee's name (see `staffMemo`).
 */
export const STAFF_MEMO = {
  training: 'Formation',
  notice: 'Préavis',
  wage: 'Salaire',
} as const

/** The memo of `what` for the employee `name`: « Salaire · Amélie Gagnon ». */
export function staffMemo(what: string, name: string): string {
  return `${what} · ${name}`
}

/**
 * Who does a job on a business day: an employee, the owner, or nobody, when
 * no employee does it and the owner is away.
 */
export type Doer = 'employee' | 'owner' | null

/** Who does what on a business day. */
export interface Crew {
  /** Whether the owner serves at the truck: whenever they are not away. */
  readonly ownerServes: boolean
  /** The employees serving at the truck beside the owner. */
  readonly atTruck: number
  /** Who delivers to the grocers. */
  readonly delivers: Doer
  /** Who bakes at the bakery. */
  readonly bakes: Doer
}

/**
 * Who does what on a day `staff` works, the owner away all day or not: the
 * owner serves at the truck unless away, beside each employee at the truck;
 * a deliverer delivers and a baker bakes, or else the owner, unless away.
 */
export function crewOf(staff: readonly Employee[], ownerAway: boolean): Crew {
  const owner: Doer = ownerAway ? null : 'owner'
  const has = (role: StaffRoleId) => staff.some((hire) => hire.role === role)
  return {
    ownerServes: !ownerAway,
    atTruck: staff.filter(({ role }) => role === AT_TRUCK).length,
    delivers: has(DELIVERS) ? 'employee' : owner,
    bakes: has(BAKES) ? 'employee' : owner,
  }
}

/** What `hire` earns a week: their hourly wage × their role's hours. */
export function weeklyWage(hire: Hire, content: StaffContent = STAFF): Cents {
  return mulInt(hire.hourlyWage, content.roles[hire.role].hoursPerWeek)
}

/** What `staff` earns a week, together. */
export function weeklyWages(
  staff: readonly Hire[],
  content: StaffContent = STAFF,
): Cents {
  return sum(staff.map((hire) => weeklyWage(hire, content)))
}

/** The books and the staff after the staff's part of a morning. */
export interface StaffMorning {
  readonly journal: Journal
  readonly staff: readonly Employee[]
}

/**
 * The staff's part of the start of business day `day`, open or closed, with
 * `plan` the employees the player wants. Each employee no longer in it
 * leaves at once with their notice, « Préavis · <nom> »: `noticeWeeks` of
 * their weekly wage. Then each one in it not on staff starts that day, after
 * a week of training paid up front, « Formation · <nom> »: `trainingWeeks`
 * of the weekly wage the plan gives. Those who stay take the plan's wage.
 * Every entry is Dr 6000 Salaires / Cr 1000 Encaisse, dated `day`. The staff
 * comes out in the plan's order. Returns the new books and staff; never
 * mutates its arguments. Throws an Error if the plan gives someone on staff
 * another role, which `applyDecision()` never lets happen.
 */
export function staffMorning(
  journal: Journal,
  staff: readonly Employee[],
  plan: readonly Hire[],
  day: Day,
  content: StaffContent = STAFF,
): StaffMorning {
  if (staff.length === 0 && plan.length === 0) return { journal, staff }
  let books = journal
  for (const employee of staff) {
    const kept = plan.find(({ candidate }) => candidate === employee.candidate)
    if (kept === undefined) {
      books = pay(
        books,
        day,
        memoFor(STAFF_MEMO.notice, employee, content),
        WAGES,
        mulInt(weeklyWage(employee, content), content.noticeWeeks),
      )
    } else if (kept.role !== employee.role) {
      throw new Error(
        `Day ${day}: ${employee.candidate} works as ${employee.role}, not ${kept.role}`,
      )
    }
  }
  const next = plan.map(({ candidate, role, hourlyWage }): Employee => {
    const on = staff.find((employee) => employee.candidate === candidate)
    if (on !== undefined) {
      return { candidate, role, hourlyWage, hiredOnDay: on.hiredOnDay }
    }
    const hire = { candidate, role, hourlyWage }
    books = pay(
      books,
      day,
      memoFor(STAFF_MEMO.training, hire, content),
      WAGES,
      mulInt(weeklyWage(hire, content), content.trainingWeeks),
    )
    return { ...hire, hiredOnDay: day }
  })
  return { journal: books, staff: next }
}

/**
 * Pays each employee of `staff` a full week, « Salaire · <nom> »: their
 * hourly wage × their role's hours, Dr 6000 Salaires / Cr 1000 Encaisse,
 * dated `day`, in the order of `staff`.
 */
export function payWages(
  journal: Journal,
  staff: readonly Employee[],
  day: Day,
  content: StaffContent = STAFF,
): Journal {
  return staff.reduce(
    (books, employee) =>
      pay(
        books,
        day,
        memoFor(STAFF_MEMO.wage, employee, content),
        WAGES,
        weeklyWage(employee, content),
      ),
    journal,
  )
}

function memoFor(what: string, hire: Hire, content: StaffContent): string {
  return staffMemo(what, content.candidates[hire.candidate].name)
}
