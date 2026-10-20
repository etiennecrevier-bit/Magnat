import type {
  CandidateId,
  GrocerContent,
  StaffContent,
  StaffRoleId,
} from '../content/schema.ts'
import {
  BAKED,
  BAKERY,
  isBakeryRunning,
  morningBakery,
} from '../engine/bakery.ts'
import { toCalendar } from '../engine/calendar.ts'
import { GROCERS } from '../engine/contracts.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import { latestDecisions } from '../engine/decisions.ts'
import { startOfDay } from '../engine/effects.ts'
import { onHand, orderSize } from '../engine/inventory.ts'
import { cents, mulInt, type Cents } from '../engine/money.ts'
import { STAFF, crewOf, weeklyWage, type Doer } from '../engine/staff.ts'
import { streetOn } from '../engine/street.ts'
import type { Employee, GameState, Hire } from '../engine/types.ts'
import { formatMoney } from './formatMoney.ts'
import type { StatusLine } from './productFacts.ts'
import type { TipContent } from './tooltip.ts'

// What the « Qui fait quoi » panel shows (#163): the owner and the
// employees, what each does today, and who may be hired. The engine plays
// the day (src/engine/day.ts); today's work is read from its own helpers,
// on the morning as it starts the day.

// A no-break space (U+00A0) goes between a number and its unit.
const NBSP = '\u00a0'

/** A job of the day. */
export type Task = 'truck' | 'deliveries' | 'bakery'

/** The jobs, as the player reads them. */
export const TASK_NAMES: Readonly<Record<Task, string>> = {
  truck: 'Au camion',
  deliveries: 'Livraisons aux épiceries',
  bakery: 'Fournil',
}

/** The job each role does, when there is one to do. */
const ROLE_TASKS: Readonly<Record<StaffRoleId, Task>> = {
  camion: 'truck',
  livreur: 'deliveries',
  boulanger: 'bakery',
}

/** What happens at the business today. */
export interface TodayWork {
  /** Whether the owner is away all day. */
  readonly ownerAway: boolean
  /** Whether the truck opens. */
  readonly opens: boolean
  /** Whether deliveries to the grocers are due. */
  readonly deliveriesDue: boolean
  /** Who makes them, when due; null when nobody does, so they are missed. */
  readonly delivers: Doer
  /** Who bakes, when the bakery makes any croissant; null otherwise. */
  readonly bakes: Doer
}

/**
 * What happens today, on the morning of `game.day`, as `playDay` will play
 * it: the morning started as the engine starts it (see `startOfDay`), on a
 * copy that is never kept, with the effects of earlier choices due today.
 * Who works comes from today's staff and whether the owner is away (see
 * `crewOf`). The truck opens on a day open the street does not close, with
 * someone at it. Deliveries are due on the grocers' delivery weekday, for
 * each contract signed before today. The bakery makes croissants when they
 * come from it, it runs today and someone bakes: those of the deliveries
 * made, then, the truck open and the croissants on sale, the bake rule's
 * with the capacity left.
 */
export function todayWork(
  game: GameState,
  grocers: GrocerContent = GROCERS,
): TodayWork {
  const started = startOfDay(game, FOOD_TRUCK, grocers)
  const { day, decisions } = started
  const { weekday } = toCalendar(day)
  const street = streetOn(started.events.modifiers, day)
  const crew = crewOf(todayStaff(started), started.ownerAway)
  const opens =
    decisions.daysOpen.includes(weekday) &&
    !street.closed &&
    (crew.ownerServes || crew.atTruck > 0)
  const due = started.contracts.running.filter(({ startDay }) => startDay < day)
  const deliveriesDue = weekday === grocers.deliveryWeekday && due.length > 0
  const delivers = deliveriesDue ? crew.delivers : null
  const baking =
    decisions.croissantSource === 'fabriquer' &&
    isBakeryRunning(morningBakery(started.bakery, decisions.bakery, day)) &&
    crew.bakes !== null
  const forDeliveries =
    baking && delivers !== null
      ? Math.min(
          BAKERY.capacityPerDay,
          due.reduce(
            (units, { grocer }) => units + grocers.grocers[grocer].unitsPerWeek,
            0,
          ),
        )
      : 0
  const forTruck =
    baking && opens && !street.unavailable[BAKED]
      ? Math.min(
          orderSize(decisions.bake, onHand(started.inventory, BAKED)),
          BAKERY.capacityPerDay - forDeliveries,
        )
      : 0
  return {
    ownerAway: started.ownerAway,
    opens,
    deliveriesDue,
    delivers,
    bakes: forDeliveries + forTruck > 0 ? crew.bakes : null,
  }
}

/** Where an employee stands. */
export type MemberStatus = 'atWork' | 'startsTomorrow' | 'leavesTomorrow'

/** An employee, at work today or tomorrow. */
export interface MemberRow {
  readonly candidate: CandidateId
  readonly name: string
  readonly role: StaffRoleId
  readonly roleName: string
  /** Their hourly wage as the player last left it. */
  readonly hourlyWage: Cents
  /** What that comes to a week. */
  readonly weeklyWage: Cents
  readonly status: MemberStatus
  /**
   * What they do today, leaving tomorrow or not; none for a hire who has
   * not started.
   */
  readonly tasks: readonly Task[]
  /**
   * What letting them go costs: their notice, at today's wage, for one at
   * work today; nothing for a hire who has not started; null for one who
   * leaves tomorrow already.
   */
  readonly fireCost: Cents | null
  /** What their training costs, for a hire who has not started; else null. */
  readonly training: Cents | null
}

/** The owner. */
export interface OwnerRow {
  /** What they pay themself a week, as they last left it. */
  readonly weeklyPay: Cents
  /** Whether they are away all day. */
  readonly away: boolean
  /** What they do today. */
  readonly tasks: readonly Task[]
}

/** A role the player may hire for. */
export interface RoleOffer {
  readonly role: StaffRoleId
  readonly name: string
  readonly hoursPerWeek: number
  /** The hourly wage a hire starts at. */
  readonly hourlyWage: Cents
  readonly weeklyWage: Cents
  /** What training a hire costs, up front. */
  readonly training: Cents
}

/** Someone the player may hire. */
export interface CandidateRow {
  readonly candidate: CandidateId
  readonly name: string
}

/** The « Qui fait quoi » panel. */
export interface StaffBoard {
  readonly owner: OwnerRow
  /** Today's staff in order, then the hires who start tomorrow. */
  readonly members: readonly MemberRow[]
  readonly roles: readonly RoleOffer[]
  /** Those neither wanted nor at work today, in the content's order. */
  readonly candidates: readonly CandidateRow[]
  /** Whether the staff wanted is at its most. */
  readonly full: boolean
  readonly maxEmployees: number
}

/**
 * The « Qui fait quoi » panel for `game` on the morning of `game.day`:
 * today's staff, those leaving or starting tomorrow with the latest
 * decisions, what each does today (see `todayWork`), what firing and
 * hiring cost, and who may be hired.
 */
export function staffBoard(
  game: GameState,
  content: StaffContent = STAFF,
): StaffBoard {
  const work = todayWork(game)
  const today = game.decisions.staff
  const latest = latestDecisions(game)
  const wanted = (candidate: CandidateId) =>
    latest.staff.find((hire) => hire.candidate === candidate)
  const row = (
    hire: Hire,
    status: MemberStatus,
    fireCost: Cents | null,
  ): MemberRow => ({
    candidate: hire.candidate,
    name: content.candidates[hire.candidate].name,
    role: hire.role,
    roleName: content.roles[hire.role].name,
    hourlyWage: hire.hourlyWage,
    weeklyWage: weeklyWage(hire, content),
    status,
    tasks: status === 'startsTomorrow' ? [] : employeeTasks(hire.role, work),
    fireCost,
    training:
      status === 'startsTomorrow'
        ? mulInt(weeklyWage(hire, content), content.trainingWeeks)
        : null,
  })
  const members = [
    ...today.map((hire) => {
      const kept = wanted(hire.candidate)
      return kept === undefined
        ? row(hire, 'leavesTomorrow', null)
        : row(
            kept,
            'atWork',
            mulInt(weeklyWage(hire, content), content.noticeWeeks),
          )
    }),
    ...latest.staff
      .filter(
        ({ candidate }) => !today.some((hire) => hire.candidate === candidate),
      )
      .map((hire) => row(hire, 'startsTomorrow', cents(0))),
  ]
  const busy = new Set(members.map(({ candidate }) => candidate))
  return {
    owner: {
      weeklyPay: latest.ownerWeeklyPay,
      away: work.ownerAway,
      tasks: work.ownerAway ? [] : ownerTasks(work),
    },
    members,
    roles: (Object.keys(content.roles) as StaffRoleId[]).map((role) => {
      const { name, hoursPerWeek, hourlyWageCents } = content.roles[role]
      const weekly = weeklyWage(
        { role, hourlyWage: cents(hourlyWageCents.start) },
        content,
      )
      return {
        role,
        name,
        hoursPerWeek,
        hourlyWage: cents(hourlyWageCents.start),
        weeklyWage: weekly,
        training: mulInt(weekly, content.trainingWeeks),
      }
    }),
    candidates: (Object.keys(content.candidates) as CandidateId[])
      .filter((candidate) => !busy.has(candidate))
      .map((candidate) => ({
        candidate,
        name: content.candidates[candidate].name,
      })),
    full: latest.staff.length >= content.maxEmployees,
    maxEmployees: content.maxEmployees,
  }
}

/** What an employee in `role` does today. */
function employeeTasks(role: StaffRoleId, work: TodayWork): Task[] {
  const task = ROLE_TASKS[role]
  return doesTask(task, 'employee', work) ? [task] : []
}

/** What the owner, at work, does today. */
function ownerTasks(work: TodayWork): Task[] {
  return (['truck', 'deliveries', 'bakery'] as const).filter((task) =>
    doesTask(task, 'owner', work),
  )
}

/**
 * Whether `who` does `task` today: the owner always serves at an open
 * truck, beside any employee there.
 */
function doesTask(task: Task, who: 'employee' | 'owner', work: TodayWork) {
  switch (task) {
    case 'truck':
      return work.opens
    case 'deliveries':
      return work.delivers === who
    case 'bakery':
      return work.bakes === who
  }
}

/**
 * The employees at work on the morning of `started.day`, as the engine's
 * staff morning leaves them: today's plan, each keeping the day they
 * started.
 */
function todayStaff(started: GameState): Employee[] {
  return started.decisions.staff.map((hire) => ({
    ...hire,
    hiredOnDay:
      started.staff.find(({ candidate }) => candidate === hire.candidate)
        ?.hiredOnDay ?? started.day,
  }))
}

/** What the owner's tooltip says: their role and their pay. */
export function ownerTip(owner: OwnerRow): TipContent {
  return {
    title: 'Vous',
    rows: [
      { label: 'Rôle', value: 'Propriétaire' },
      { label: 'Salaire par semaine', value: formatMoney(owner.weeklyPay) },
    ],
  }
}

/**
 * What an employee's tooltip says: their role, hours and pay, the training
 * of a hire who has not started and the notice firing one at work costs.
 */
export function memberTip(member: MemberRow, hours: number): TipContent {
  const { name, roleName, weeklyWage, status, training, fireCost } = member
  const rows = [
    { label: 'Rôle', value: roleName },
    { label: 'Heures par semaine', value: `${hours}${NBSP}h` },
    { label: 'Salaire par semaine', value: formatMoney(weeklyWage) },
  ]
  if (status === 'startsTomorrow' && training !== null) {
    rows.push({ label: 'Formation', value: formatMoney(training) })
  }
  if (status === 'atWork' && fireCost !== null) {
    rows.push({ label: 'Préavis si congédié', value: formatMoney(fireCost) })
  }
  return { title: name, rows }
}

/** An employee's one status line: starting or leaving tomorrow, if so. */
export function memberLine({ status }: MemberRow): StatusLine {
  switch (status) {
    case 'startsTomorrow':
      return { fact: { tone: 'warn', text: 'Commence demain' }, tomorrow: null }
    case 'leavesTomorrow':
      return { fact: { tone: 'off', text: 'Part demain' }, tomorrow: null }
    case 'atWork':
      return { fact: null, tomorrow: null }
  }
}

/** What a role's tooltip says: its hours, its wage and the training. */
export function roleTip(offer: RoleOffer): TipContent {
  return {
    title: offer.name,
    rows: [
      { label: 'Heures par semaine', value: `${offer.hoursPerWeek}${NBSP}h` },
      { label: 'Salaire horaire', value: formatMoney(offer.hourlyWage) },
      { label: 'Salaire par semaine', value: formatMoney(offer.weeklyWage) },
      { label: 'Formation', value: formatMoney(offer.training) },
    ],
  }
}
