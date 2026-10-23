import {
  candidateIdSchema,
  loadStaffContent,
  type CandidateId,
  type StaffContent,
  type StaffRoleId,
  type TraitId,
  type TraitLevel,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { entriesOf, type Journal } from '../finance/journal.ts'
import { add, cents, mulInt, sub, sum, type Cents } from './money.ts'
import { pay } from './posting.ts'
import { keyedDraw } from './rng.ts'
import type { Day, Employee, GameState, Hire } from './types.ts'

// The employees (#158). The player's plan, `Decisions.staff`, hires and
// lets go on the morning it takes effect: a hire costs a week of training
// up front, firing two weeks of notice, and the employee leaves at once.
// Each payday pays everyone on staff a full week. An employee at the truck
// serves beside the owner, a deliverer makes the grocers' deliveries and a
// baker the bakery's croissants, so the owner need not, or may be away.
// Employees never tire, but each has a strength and a weakness (#255): how
// fast they serve, how careful they are, how reliably they come and how
// they welcome the regulars. One paid below the wage they ask for long
// enough warns, then quits. An absence is a keyed draw of the seed (see
// `keyedDraw`), so nothing here moves the game's generator.

/** The shipped employees' content, validated once when the engine loads. */
export const STAFF: StaffContent = loadStaffContent()

const WAGES: AccountCode = '6000'

// A calendar fact, not a tunable.
const DAYS_PER_WEEK = 7

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
  /** How many employees serve at the truck beside the owner. */
  readonly atTruck: number
  /** The employees serving at the truck, in the order of the staff. */
  readonly truckers: readonly Employee[]
  /** Who delivers to the grocers. */
  readonly delivers: Doer
  /** Who bakes at the bakery. */
  readonly bakes: Doer
  /** The employee who bakes, the first baker who came; null when none. */
  readonly baker: Employee | null
}

/**
 * Who does what on a day `staff` works, the owner away all day or not, with
 * the employees of `absent` away that day: the owner serves at the truck
 * unless away, beside each employee at the truck who came; a deliverer
 * delivers and a baker bakes, or else the owner, unless away. Work an
 * absent employee would have done is not done: with every deliverer
 * absent nobody delivers, and with every baker absent nobody bakes, even
 * with the owner at work.
 */
export function crewOf(
  staff: readonly Employee[],
  ownerAway: boolean,
  absent: readonly CandidateId[] = [],
): Crew {
  const owner: Doer = ownerAway ? null : 'owner'
  const came = staff.filter(({ candidate }) => !absent.includes(candidate))
  const doer = (role: StaffRoleId): Doer => {
    if (came.some((hire) => hire.role === role)) return 'employee'
    return staff.some((hire) => hire.role === role) ? null : owner
  }
  const truckers = came.filter(({ role }) => role === AT_TRUCK)
  return {
    ownerServes: !ownerAway,
    atTruck: truckers.length,
    truckers,
    delivers: doer(DELIVERS),
    bakes: doer(BAKES),
    baker: came.find(({ role }) => role === BAKES) ?? null,
  }
}

/** How strong `trait` is in `candidate`: their strength, weakness or neither. */
export function traitLevel(
  candidate: CandidateId,
  trait: TraitId,
  content: StaffContent = STAFF,
): TraitLevel {
  const { strength, weakness } = content.candidates[candidate]
  if (trait === strength) return 'strong'
  return trait === weakness ? 'weak' : 'normal'
}

/**
 * The number `trait` moves for `candidate` working in `role`, at their level
 * in it (see `traitLevel`): the trait's `normal` in a role it does not act
 * in, whatever their level.
 */
export function traitValue(
  candidate: CandidateId,
  trait: TraitId,
  role: StaffRoleId,
  content: StaffContent = STAFF,
): number {
  const values = content.traits[trait]
  if (!values.roles.includes(role)) return values.normal
  return values[traitLevel(candidate, trait, content)]
}

/**
 * What `candidate` asks an hour to work in `role`: the role's starting wage,
 * plus their strength's `askingPremiumCents`, less their weakness's
 * `askingDiscountCents`, within the role's [min, max]. They ask the same
 * premium and discount in every role, where the trait acts or not.
 */
export function askingWage(
  candidate: CandidateId,
  role: StaffRoleId,
  content: StaffContent = STAFF,
): Cents {
  const { strength, weakness } = content.candidates[candidate]
  const { min, start, max } = content.roles[role].hourlyWageCents
  const asked = sub(
    add(start, content.traits[strength].askingPremiumCents),
    content.traits[weakness].askingDiscountCents,
  )
  return cents(Math.min(max, Math.max(min, asked)))
}

/** The traits of a candidate the player knows of. */
export interface KnownTraits {
  readonly strength: TraitId
  /** Null until it shows on the job. */
  readonly weakness: TraitId | null
}

/**
 * What the player knows of `candidate`'s traits on `day`: their strength,
 * which shows at the interview, and their weakness once `discoveryDays`
 * days on the job are behind them, from the morning of `hiredOnDay` +
 * `discoveryDays` on. Never hired, `hiredOnDay` null, they show only their
 * strength; hired again, the weakness hides until they have worked as long
 * again.
 */
export function knownTraits(
  candidate: CandidateId,
  hiredOnDay: Day | null,
  day: Day,
  content: StaffContent = STAFF,
): KnownTraits {
  const { strength, weakness } = content.candidates[candidate]
  const shown = hiredOnDay !== null && day - hiredOnDay >= content.discoveryDays
  return { strength, weakness: shown ? weakness : null }
}

/**
 * Whether someone hired as `hire` is absent on `day` of a game seeded
 * `seed`: a keyed draw of the seed, the day and the candidate (see
 * `keyedDraw`) below their fiabilité in the role (see `traitValue`). The
 * same for a seed, a day and a candidate however the game was played, so
 * it can be read on the morning, and leaves the game's generator as it is.
 */
export function isAbsent(
  seed: number,
  day: Day,
  { candidate, role }: Pick<Hire, 'candidate' | 'role'>,
  content: StaffContent = STAFF,
): boolean {
  const chance = traitValue(candidate, 'fiabilite', role, content)
  const key = candidateIdSchema.options.indexOf(candidate)
  return keyedDraw(seed, [day, key]) < chance
}

/**
 * Who of the staff working the morning of `state.day` is absent that day:
 * those of the decisions in effect that morning, which the morning hires
 * and keeps (see `staffMorning`), a hire on their first day included, in
 * their order. An employee absent on a day their role has no work misses
 * nothing.
 */
export function absentOn(
  state: Pick<GameState, 'seed' | 'day' | 'decisions'>,
  content: StaffContent = STAFF,
): CandidateId[] {
  return state.decisions.staff
    .filter((hire) => isAbsent(state.seed, state.day, hire, content))
    .map(({ candidate }) => candidate)
}

/**
 * What someone in `role` at `hourlyWage` earns a week: the hourly wage ×
 * the role's hours.
 */
export function weeklyWage(
  { role, hourlyWage }: Pick<Hire, 'role' | 'hourlyWage'>,
  content: StaffContent = STAFF,
): Cents {
  return mulInt(hourlyWage, content.roles[role].hoursPerWeek)
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
    const hire = { candidate, role, hourlyWage }
    if (on === undefined) {
      books = pay(
        books,
        day,
        memoFor(STAFF_MEMO.training, hire, content),
        WAGES,
        mulInt(weeklyWage(hire, content), content.trainingWeeks),
      )
    }
    const employee = { ...hire, hiredOnDay: on?.hiredOnDay ?? day }
    if (hourlyWage >= askingWage(candidate, role, content)) return employee
    return { ...employee, underpaidSince: on?.underpaidSince ?? day }
  })
  return { journal: books, staff: next }
}

/**
 * The morning `employee`, paid below their asking wage since
 * `underpaidSince`, warns they will quit: `underpaidWeeks` later. Null when
 * they are not underpaid.
 */
export function warnsOnDay(
  employee: Employee,
  content: StaffContent = STAFF,
): Day | null {
  const { underpaidSince } = employee
  if (underpaidSince === undefined) return null
  return underpaidSince + content.underpaidWeeks * DAYS_PER_WEEK
}

/**
 * The morning `employee` quits, still underpaid: `warningWeeks` after they
 * warn (see `warnsOnDay`). Null when they are not underpaid.
 */
export function quitsOnDay(
  employee: Employee,
  content: StaffContent = STAFF,
): Day | null {
  const warns = warnsOnDay(employee, content)
  return warns === null ? null : warns + content.warningWeeks * DAYS_PER_WEEK
}

/** Whether `employee` has warned they will quit by the morning of `day`. */
export function hasWarned(
  employee: Employee,
  day: Day,
  content: StaffContent = STAFF,
): boolean {
  const warns = warnsOnDay(employee, content)
  return warns !== null && day >= warns
}

/** The staff once the underpaid leave on a morning, and who left. */
export interface Quitting {
  readonly staff: readonly Employee[]
  /** Those who quit, in the order of the staff. */
  readonly quits: readonly CandidateId[]
}

/**
 * The staff of the morning of `day`, as `staffMorning` leaves it, once each
 * employee whose `quitsOnDay` it is leaves, still underpaid. A quit pays no
 * notice and posts nothing. Never mutates `staff`.
 */
export function quitting(
  staff: readonly Employee[],
  day: Day,
  content: StaffContent = STAFF,
): Quitting {
  const quits = staff
    .filter((employee) => quitsOnDay(employee, content) === day)
    .map(({ candidate }) => candidate)
  if (quits.length === 0) return { staff, quits }
  return {
    staff: staff.filter(({ candidate }) => !quits.includes(candidate)),
    quits,
  }
}

/** Something an employee tells the player in their own words (#255). */
export interface StaffNotice {
  /** `underpaid`, the warning, or `quit`. */
  readonly kind: 'underpaid' | 'quit'
  readonly candidate: CandidateId
  /** The morning they warned or quit. */
  readonly day: Day
}

/**
 * What the employees tell the player as the game moves on from `previous`
 * to `next`, the days from `previous.day` to `next.day` played in between,
 * oldest first: each warning, on the morning an employee still underpaid
 * warns (see `warnsOnDay`), from the one after `previous.day` to
 * `next.day`, but not once the player pays them their asking wage from
 * `next.day` on; and each quit of an employee of `previous.staff` who
 * left, underpaid, on a day played, with the warning before it when that
 * came after `previous.day` too. An employee let go first, with their
 * notice, has nothing to say. Nothing when no day was played.
 */
export function staffNotices(
  previous: GameState,
  next: GameState,
  content: StaffContent = STAFF,
): StaffNotice[] {
  if (next.day <= previous.day) return []
  const notices: StaffNotice[] = []
  const warning = (employee: Employee) => {
    const day = warnsOnDay(employee, content)
    if (day !== null && day > previous.day && day <= next.day) {
      notices.push({ kind: 'underpaid', candidate: employee.candidate, day })
    }
  }
  for (const employee of previous.staff) {
    const { candidate, hiredOnDay } = employee
    const day = quitsOnDay(employee, content)
    if (day === null || day < previous.day || day >= next.day) continue
    const stays = next.staff.some(
      (other) => other.candidate === candidate && other.hiredOnDay <= day,
    )
    if (
      stays ||
      noticeGiven(next.journal, employee, previous.day, day, content)
    ) {
      continue
    }
    if (hiredOnDay <= day) {
      warning(employee)
      notices.push({ kind: 'quit', candidate, day })
    }
  }
  const raised = (next.pendingDecisions ?? next.decisions).staff
  for (const employee of next.staff) {
    const plan = raised.find(
      ({ candidate }) => candidate === employee.candidate,
    )
    if (
      plan !== undefined &&
      plan.hourlyWage >= askingWage(plan.candidate, plan.role, content)
    ) {
      continue
    }
    warning(employee)
  }
  return notices.sort((a, b) => a.day - b.day)
}

/**
 * Whether `employee` was let go with their notice, « Préavis · <nom> »,
 * on a morning from `from` to `to`.
 */
function noticeGiven(
  journal: Journal,
  employee: Employee,
  from: Day,
  to: Day,
  content: StaffContent,
): boolean {
  const memo = memoFor(STAFF_MEMO.notice, employee, content)
  const entries = entriesOf(journal)
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry === undefined || entry.day < from) break
    if (entry.day <= to && entry.memo === memo) return true
  }
  return false
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
