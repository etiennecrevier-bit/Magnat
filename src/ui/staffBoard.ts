import type {
  CandidateId,
  GrocerContent,
  StaffContent,
  StaffRoleId,
  TraitId,
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
import { cents, mulInt, sub, type Cents } from '../engine/money.ts'
import {
  STAFF,
  askingWage,
  crewOf,
  hasWarned,
  isAbsent,
  knownTraits,
  quitting,
  staffMorning,
  weeklyWage,
  type Doer,
} from '../engine/staff.ts'
import { isStored } from '../engine/districts.ts'
import { modifiersAt, streetOn } from '../engine/street.ts'
import {
  FIRST_TRUCK,
  ownerAtOf,
  truckDecisionsOf,
  truckersAt,
  truckIds,
  truckOf,
  trucksOf,
} from '../engine/trucks.ts'
import type {
  Day,
  Employee,
  GameState,
  Hire,
  PersonDay,
  TruckId,
  WorkDay,
  Worker,
} from '../engine/types.ts'
import { formatDayOfMonth, formatShortWeekdayName } from './formatGameDate.ts'
import { formatCount, formatMoney, formatWholeMoney } from './formatMoney.ts'
import type { StatusLine } from './productFacts.ts'
import type { TipContent, TipRow } from './tooltip.ts'
import { discoveryText, traitTip } from './traitText.ts'
import { hasTrucks, truckName, unstaffedTomorrow } from './trucks.ts'

// What the « Qui fait quoi » panel shows (#163): the owner and the
// employees, what each does today, and who may be hired. The engine plays
// the day (src/engine/day.ts); today's work is read from its own helpers,
// on the morning as it starts the day.

// A no-break space (U+00A0) goes between a number and its unit, and before
// a colon.
const NBSP = '\u00a0'
const COLON = `${NBSP}:`

/** A job of the day. */
export type Job = 'truck' | 'deliveries' | 'bakery'

/** What someone does today: a job, or nothing, absent when it was there. */
export type Task = Job | 'absent'

/** The jobs and an absence, as the player reads them. */
export const TASK_NAMES: Readonly<Record<Task, string>> = {
  truck: 'Au camion',
  deliveries: 'Livraisons',
  bakery: 'Fournil',
  absent: 'Absent',
}

/** The job each role does, when there is one to do. */
const ROLE_TASKS: Readonly<Record<StaffRoleId, Job>> = {
  camion: 'truck',
  livreur: 'deliveries',
  boulanger: 'bakery',
}

/** What happens at one truck today (#265). */
export interface TruckToday {
  readonly id: TruckId
  /**
   * Whether it opens today if someone is there: one of its days open,
   * outside the dates it is stored, its street not closed.
   */
  readonly scheduled: boolean
  /** Whether its winter storage covers today. */
  readonly stored: boolean
  /** Whether it opens: scheduled, with the owner or an employee there. */
  readonly opens: boolean
  /** Whether the owner works there today. */
  readonly owner: boolean
  /** The employees « Au camion » at it who came today, in the staff's order. */
  readonly truckers: readonly CandidateId[]
}

/** What happens at the business today. */
export interface TodayWork {
  /** Whether the owner is away all day. */
  readonly ownerAway: boolean
  /** Whether the first truck opens. */
  readonly opens: boolean
  /** Each truck's day, the first one first (#265). */
  readonly trucks: readonly TruckToday[]
  /** Whether deliveries to the grocers are due. */
  readonly deliveriesDue: boolean
  /** Who makes them, when due; null when nobody does, so they are missed. */
  readonly delivers: Doer
  /** Who bakes, when the bakery makes any croissant; null otherwise. */
  readonly bakes: Doer
  /**
   * The staff of the morning as the engine's staff morning leaves it,
   * before anyone quits: each keeping the day they started.
   */
  readonly staff: readonly Employee[]
  /** Those who quit this morning, underpaid (see `quitting`). */
  readonly quits: readonly CandidateId[]
  /** Those of the staff left who are absent today (see `isAbsent`). */
  readonly absent: readonly CandidateId[]
  /**
   * Whether each job has work today, done or not, as the engine counts an
   * absence that missed some: the truck on a day it may open, the
   * deliveries when due, the bakery when it makes croissants for either.
   */
  readonly hadWork: Readonly<Record<Job, boolean>>
}

/**
 * What happens today, on the morning of `game.day`, as `playDay` will play
 * it: the morning started as the engine starts it (see `startOfDay`), on a
 * copy that is never kept, with the effects of earlier choices due today.
 * Who works comes from today's staff, as the engine's staff morning
 * leaves it once the underpaid quit, those absent today and whether the
 * owner is away (see `crewOf`). Each truck opens on one of its days open,
 * outside the dates it is stored, that its district's street does not
 * close, with the owner there or one of its employees « Au camion » who
 * came, as `playDay` opens it. Deliveries are due on the grocers' delivery weekday, for
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
  // The books the staff morning pays from are thrown away.
  const { staff } = staffMorning(
    started.journal,
    started.staff,
    decisions.staff,
    day,
  )
  const left = quitting(staff, day)
  const absent = left.staff
    .filter((employee) => isAbsent(started.seed, day, employee))
    .map(({ candidate }) => candidate)
  const crew = crewOf(left.staff, started.ownerAway, absent)
  const ownerAt = ownerAtOf(decisions)
  const streets = new Map(
    trucksOf(started).map(({ id, district }) => [
      id,
      streetOn(modifiersAt(started.events.modifiers, district), day),
    ]),
  )
  const trucks = trucksOf(started).map(({ id }): TruckToday => {
    const own = truckDecisionsOf(decisions, id)
    const stored = isStored(own.storage, day)
    const scheduled =
      own.daysOpen.includes(weekday) &&
      !stored &&
      streets.get(id)?.closed !== true
    const owner = crew.ownerServes && ownerAt === id
    const truckers = truckersAt(crew.truckers, id).map(
      ({ candidate }) => candidate,
    )
    return {
      id,
      scheduled,
      stored,
      opens: scheduled && (owner || truckers.length > 0),
      owner,
      truckers,
    }
  })
  const [first] = trucks
  if (first === undefined) throw new Error('A game has a first truck')
  const street = streets.get(FIRST_TRUCK)
  const truckDay = first.scheduled
  const opens = first.opens
  const due = started.contracts.running.filter(({ startDay }) => startDay < day)
  const deliveriesDue = weekday === grocers.deliveryWeekday && due.length > 0
  const delivers = deliveriesDue ? crew.delivers : null
  const making =
    decisions.croissantSource === 'fabriquer' &&
    isBakeryRunning(morningBakery(started.bakery, decisions.bakery, day))
  const baking = making && crew.bakes !== null
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
    baking && opens && street?.unavailable[BAKED] !== true
      ? Math.min(
          orderSize(decisions.bake, onHand(started.inventory, BAKED)),
          BAKERY.capacityPerDay - forDeliveries,
        )
      : 0
  return {
    ownerAway: started.ownerAway,
    opens,
    trucks,
    deliveriesDue,
    delivers,
    bakes: forDeliveries + forTruck > 0 ? crew.bakes : null,
    staff,
    quits: left.quits,
    absent,
    hadWork: {
      truck: truckDay,
      deliveries: deliveriesDue,
      bakery: making && (truckDay || deliveriesDue),
    },
  }
}

/**
 * Where an employee stands: at work, starting or leaving tomorrow, or gone
 * this morning, having quit underpaid.
 */
export type MemberStatus =
  'atWork' | 'startsTomorrow' | 'leavesTomorrow' | 'quitsToday'

/** An employee, at work today or tomorrow. */
export interface MemberRow {
  readonly candidate: CandidateId
  readonly name: string
  /** Their portrait's id in staff.json (see portraits.ts). */
  readonly portrait: string
  readonly role: StaffRoleId
  readonly roleName: string
  /** Their hourly wage as the player last left it. */
  readonly hourlyWage: Cents
  /** What that comes to a week. */
  readonly weeklyWage: Cents
  /** What they ask an hour in their role (see `askingWage`). */
  readonly askingWage: Cents
  readonly status: MemberStatus
  /** Their strength, which shows from the interview on. */
  readonly strength: TraitId
  /** Their weakness, null until it shows on the job (see `knownTraits`). */
  readonly weakness: TraitId | null
  /**
   * Whether they warned they will quit, underpaid (see `hasWarned`), and
   * the wage the player last left them is still below what they ask.
   */
  readonly leaving: boolean
  /**
   * What they do today, leaving tomorrow or not, `absent` when their job
   * had work; none for a hire who has not started or one who quit.
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
  /** What they did yesterday, in one line; null if they did not work then. */
  readonly yesterday: string | null
  /** What they did each of the last days, one tooltip row a day. */
  readonly days: readonly TipRow[]
  /**
   * The truck an employee « Au camion » works at as the player last left
   * it (#265); null in another role.
   */
  readonly truck: TruckId | null
}

/** The owner. */
export interface OwnerRow {
  /** What they pay themself a week, as they last left it. */
  readonly weeklyPay: Cents
  /** Whether they are away all day. */
  readonly away: boolean
  /** What they do today. */
  readonly tasks: readonly Task[]
  /** What they did yesterday, in one line; null before the first day. */
  readonly yesterday: string | null
  /** What they did each of the last days, one tooltip row a day. */
  readonly days: readonly TipRow[]
  /** The truck they work at as the player last left it (#265). */
  readonly at: TruckId
}

/** A truck the owner and the employees « Au camion » may work at (#265). */
export interface TruckOption {
  readonly id: TruckId
  /** Its district's name. */
  readonly name: string
}

/** A role the player may hire for. */
export interface RoleOffer {
  readonly role: StaffRoleId
  readonly name: string
  readonly hoursPerWeek: number
}

/** Someone the player may hire, for the role picked. */
export interface CandidateRow {
  readonly candidate: CandidateId
  readonly name: string
  /** Their portrait's id in staff.json (see portraits.ts). */
  readonly portrait: string
  /** Their strength, which shows at the interview. */
  readonly strength: TraitId
  /** What they ask an hour in the role, which hiring them pays. */
  readonly askingWage: Cents
  /** What that comes to a week. */
  readonly weeklyWage: Cents
  /** What their training costs, up front. */
  readonly training: Cents
}

/** The « Qui fait quoi » panel. */
export interface StaffBoard {
  readonly owner: OwnerRow
  /** Today's staff in order, then the hires who start tomorrow. */
  readonly members: readonly MemberRow[]
  readonly roles: readonly RoleOffer[]
  /** The role the candidates are for. */
  readonly role: StaffRoleId
  /**
   * Those neither wanted nor at work today, in the content's order, as they
   * would work in `role`.
   */
  readonly candidates: readonly CandidateRow[]
  /** Whether the staff wanted is at its most. */
  readonly full: boolean
  readonly maxEmployees: number
  /**
   * The trucks to work at, the first one first, once there are two or
   * more (#265); none with one truck, which everybody works at.
   */
  readonly trucks: readonly TruckOption[]
  /** The trucks that close tomorrow with nobody there (see `unstaffedTomorrow`). */
  readonly unstaffed: readonly TruckOption[]
}

/**
 * The « Qui fait quoi » panel for `game` on the morning of `game.day`:
 * today's staff, those leaving or starting tomorrow with the latest
 * decisions, or quitting this morning, what each does today (see
 * `todayWork`), what the player knows of their traits, what firing and
 * hiring cost, and who may be hired for `role`, at what they ask.
 */
export function staffBoard(
  game: GameState,
  role: StaffRoleId = 'camion',
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
  ): MemberRow => {
    const employee = work.staff.find(
      ({ candidate }) => candidate === hire.candidate,
    )
    const hiredOnDay: Day | null =
      status === 'startsTomorrow' ? null : (employee?.hiredOnDay ?? null)
    const asks = askingWage(hire.candidate, hire.role, content)
    const known = knownTraits(hire.candidate, hiredOnDay, game.day, content)
    return {
      candidate: hire.candidate,
      name: content.candidates[hire.candidate].name,
      portrait: content.candidates[hire.candidate].portrait,
      role: hire.role,
      roleName: content.roles[hire.role].name,
      hourlyWage: hire.hourlyWage,
      weeklyWage: weeklyWage(hire, content),
      askingWage: asks,
      status,
      strength: known.strength,
      weakness: known.weakness,
      leaving:
        status === 'atWork' &&
        employee !== undefined &&
        hasWarned(employee, game.day, content) &&
        hire.hourlyWage < asks,
      // What they do today follows today's staff: an assignment the player
      // just changed waits for tomorrow.
      tasks:
        status === 'startsTomorrow' || status === 'quitsToday'
          ? []
          : employeeTasks(employee ?? hire, work),
      fireCost,
      training:
        status === 'startsTomorrow'
          ? mulInt(weeklyWage(hire, content), content.trainingWeeks)
          : null,
      ...workFacts(game, hire.candidate, ROLE_TASKS[hire.role]),
      truck: hire.role === 'camion' ? truckOf(hire) : null,
    }
  }
  const members = [
    ...today.map((hire) => {
      if (work.quits.includes(hire.candidate)) {
        return row(hire, 'quitsToday', null)
      }
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
  const option = (id: TruckId): TruckOption => ({
    id,
    name: truckName(game, id),
  })
  return {
    owner: {
      weeklyPay: latest.ownerWeeklyPay,
      away: work.ownerAway,
      tasks: work.ownerAway ? [] : ownerTasks(work),
      ...workFacts(game, 'owner', null),
      at: ownerAtOf(latest),
    },
    members,
    roles: (Object.keys(content.roles) as StaffRoleId[]).map((role) => {
      const { name, hoursPerWeek } = content.roles[role]
      return { role, name, hoursPerWeek }
    }),
    role,
    candidates: (Object.keys(content.candidates) as CandidateId[])
      .filter((candidate) => !busy.has(candidate))
      .map((candidate) => {
        const hourlyWage = askingWage(candidate, role, content)
        const weekly = weeklyWage({ role, hourlyWage }, content)
        return {
          candidate,
          name: content.candidates[candidate].name,
          portrait: content.candidates[candidate].portrait,
          strength: content.candidates[candidate].strength,
          askingWage: hourlyWage,
          weeklyWage: weekly,
          training: mulInt(weekly, content.trainingWeeks),
        }
      }),
    full: latest.staff.length >= content.maxEmployees,
    maxEmployees: content.maxEmployees,
    trucks: hasTrucks(game) ? truckIds(game).map(option) : [],
    unstaffed: unstaffedTomorrow(game).map(option),
  }
}

/** Today's day of the truck `id`, the first one's for a truck unknown. */
function truckToday(work: TodayWork, id: TruckId): TruckToday | undefined {
  return work.trucks.find((truck) => truck.id === id) ?? work.trucks[0]
}

/**
 * What the employee `hire`, as on today's staff, does today: their role's
 * job, or « Absent » when they are and it had work. An employee « Au
 * camion » works at their own truck, which may not open.
 */
function employeeTasks(hire: Hire, work: TodayWork): Task[] {
  const job = ROLE_TASKS[hire.role]
  if (job === 'truck') {
    const truck = truckToday(work, truckOf(hire))
    if (work.absent.includes(hire.candidate)) {
      return truck?.scheduled === true ? ['absent'] : []
    }
    return truck?.opens === true ? [job] : []
  }
  if (work.absent.includes(hire.candidate)) {
    return work.hadWork[job] ? ['absent'] : []
  }
  return doesTask(job, 'employee', work) ? [job] : []
}

/** What the owner, at work, does today. */
function ownerTasks(work: TodayWork): Job[] {
  return (['truck', 'deliveries', 'bakery'] as const).filter((task) =>
    doesTask(task, 'owner', work),
  )
}

/**
 * Whether `who` does `task` today: the owner serves at the truck they
 * work at when it opens, beside any employee there.
 */
function doesTask(task: Job, who: 'employee' | 'owner', work: TodayWork) {
  switch (task) {
    case 'truck':
      return work.trucks.some(({ owner, opens }) => owner && opens)
    case 'deliveries':
      return work.delivers === who
    case 'bakery':
      return work.bakes === who
  }
}

/** What someone did yesterday and on the last days (#283). */
interface WorkFacts {
  readonly yesterday: string | null
  readonly days: readonly TipRow[]
}

/**
 * What `who` did yesterday, as one line, and each of the days `game`
 * keeps (see `GameState.workDays`), as tooltip rows: in their `task`, or
 * for the owner, null, every job they did. Facts only: what they served,
 * delivered or baked, never what it is worth to the player.
 */
function workFacts(game: GameState, who: Worker, task: Job | null): WorkFacts {
  const history = game.workDays ?? []
  const last = history.at(-1)
  const yesterday =
    last === undefined || last.day !== game.lastDay?.day
      ? null
      : dayText(last, who, task, 'line')
  const days = history.flatMap((day): TipRow[] => {
    const text = dayText(day, who, task, 'row')
    return text === null
      ? []
      : [
          {
            label: `${formatShortWeekdayName(day.day)} ${formatDayOfMonth(day.day)}`,
            value: text,
          },
        ]
  })
  return {
    yesterday: yesterday === null ? null : `Hier${COLON} ${yesterday}`,
    // The days start a part of their own, under a thin line.
    days: days.map((row, index) =>
      index === 0 ? { ...row, divider: true } : row,
    ),
  }
}

/**
 * What `who` did on `day`, in a line or a tooltip row; « Absence » for an
 * employee absent, « En ville » for the owner away all day, null for one
 * not on staff that day.
 */
function dayText(
  day: WorkDay,
  who: Worker,
  task: Job | null,
  form: 'line' | 'row',
): string | null {
  if (who === 'owner' && day.ownerAway)
    return form === 'row' ? 'En ville' : 'en ville'
  if (who !== 'owner' && day.absent.includes(who)) {
    return form === 'row' ? 'Absence' : 'absence'
  }
  const person = day.people.find((one) => one.who === who)
  if (person === undefined) return null
  const tasks: readonly Job[] = task !== null ? [task] : ownerDid(person)
  return tasks.map((each) => taskText(person, each, form)).join(' · ')
}

/** The jobs the owner did: those with anything done, the truck by default. */
function ownerDid(person: PersonDay): Job[] {
  const did = (['truck', 'deliveries', 'bakery'] as const).filter((task) =>
    task === 'truck'
      ? person.customers > 0
      : task === 'deliveries'
        ? person.deliveries > 0
        : person.baked > 0,
  )
  return did.length > 0 ? did : ['truck']
}

/** What `person` did at `task`, as a line says it or a row, shorter. */
function taskText(person: PersonDay, task: Job, form: 'line' | 'row'): string {
  const line = form === 'line'
  switch (task) {
    case 'truck':
      return `${counted(person.customers, line ? 'client servi' : 'client', line ? 'clients servis' : 'clients')} · ${formatWholeMoney(person.sales)}${line ? ' de ventes' : ''}`
    case 'deliveries':
      return `${counted(person.deliveries, 'livraison', 'livraisons')} · ${formatWholeMoney(person.invoiced)}${line ? ' facturés' : ''}`
    case 'bakery': {
      const saved = sub(person.boughtCost, person.bakedCost)
      const than = saved >= 0 ? 'de moins' : 'de plus'
      return `${counted(person.baked, 'croissant', 'croissants')} · ${formatWholeMoney(cents(Math.abs(saved)))} ${than}${line ? " qu'achetés" : ''}`
    }
  }
}

/** `n` and its noun, singular below 2 as French has it. */
function counted(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n < 2 ? one : many}`
}

/**
 * What the owner's tooltip says: their role and their pay, then what they
 * did each of the last days.
 */
export function ownerTip(owner: OwnerRow): TipContent {
  return {
    title: 'Vous',
    rows: [
      { label: 'Rôle', value: 'Propriétaire' },
      { label: 'Salaire par semaine', value: formatMoney(owner.weeklyPay) },
      ...owner.days,
    ],
  }
}

/**
 * What an employee's tooltip says: their role, hours and pay, what they
 * ask, in amber while their wage is below it, what their strength does in
 * their role, and their weakness's, or when it shows; then the training
 * of a hire who has not started and the notice firing one at work costs.
 */
export function memberTip(member: MemberRow, hours: number): TipContent {
  const { name, roleName, weeklyWage, status, training, fireCost } = member
  const rows: TipRow[] = [
    { label: 'Rôle', value: roleName },
    { label: 'Heures par semaine', value: `${hours}${NBSP}h` },
    { label: 'Salaire par semaine', value: formatMoney(weeklyWage) },
    {
      label: 'Demande',
      value: `${formatMoney(member.askingWage)} de l'heure`,
      ...(member.hourlyWage < member.askingWage ? { warn: true } : {}),
    },
    ...traitRows(member.strength, member.weakness, member.role),
  ]
  if (status === 'startsTomorrow' && training !== null) {
    rows.push({ label: 'Formation', value: formatMoney(training) })
  }
  if (status === 'atWork' && fireCost !== null) {
    rows.push({ label: 'Préavis si congédié', value: formatMoney(fireCost) })
  }
  rows.push(...member.days)
  return { title: name, rows }
}

/**
 * The tooltip rows of someone's traits in `role`: « Force · Rapidité »
 * and what it does, then « Faiblesse · Minutie » and what it does, or, not
 * known yet, « Faiblesse » and when it shows. Words only, never a number.
 */
function traitRows(
  strength: TraitId,
  weakness: TraitId | null,
  role: StaffRoleId,
  content: StaffContent = STAFF,
): TipRow[] {
  return [
    {
      label: `Force · ${content.traits[strength].name}`,
      value: traitTip(strength, 'strong', role, content),
    },
    weakness === null
      ? { label: 'Faiblesse', value: discoveryText(content) }
      : {
          label: `Faiblesse · ${content.traits[weakness].name}`,
          value: traitTip(weakness, 'weak', role, content),
        },
  ]
}

/**
 * An employee's one status line: starting or leaving tomorrow, gone this
 * morning, or thinking of leaving once they warned, underpaid.
 */
export function memberLine({ status, leaving }: MemberRow): StatusLine {
  switch (status) {
    case 'startsTomorrow':
      return { fact: { tone: 'warn', text: 'Commence demain' }, tomorrow: null }
    case 'leavesTomorrow':
      return { fact: { tone: 'off', text: 'Part demain' }, tomorrow: null }
    case 'quitsToday':
      return { fact: { tone: 'bad', text: 'Parti ce matin' }, tomorrow: null }
    case 'atWork':
      return leaving
        ? { fact: { tone: 'warn', text: 'Pense à partir' }, tomorrow: null }
        : { fact: null, tomorrow: null }
  }
}

/**
 * How many weeks of paid training a hire costs, as a candidate's card
 * says it: « 1 semaine payée », or « aucune » with none.
 */
export function trainingText(content: StaffContent = STAFF): string {
  const weeks = content.trainingWeeks
  if (weeks === 0) return 'aucune'
  const plural = weeks > 1 ? 's' : ''
  return `${weeks}${NBSP}semaine${plural} payée${plural}`
}

/**
 * What a candidate's tooltip says, for `role`: its hours, what they ask an
 * hour and a week, what their training costs, what their strength does
 * there, and when their weakness shows.
 */
export function candidateTip(
  row: CandidateRow,
  role: StaffRoleId,
  content: StaffContent = STAFF,
): TipContent {
  return {
    title: row.name,
    rows: [
      { label: 'Rôle', value: content.roles[role].name },
      {
        label: 'Heures par semaine',
        value: `${content.roles[role].hoursPerWeek}${NBSP}h`,
      },
      { label: 'Demande', value: `${formatMoney(row.askingWage)} de l'heure` },
      { label: 'Salaire par semaine', value: formatMoney(row.weeklyWage) },
      { label: 'Formation', value: formatMoney(row.training) },
      ...traitRows(row.strength, null, role, content),
    ],
  }
}

/**
 * What a role's tooltip says: its hours. Each candidate asks their own
 * wage, so the pay and the training are on the candidates' cards.
 */
export function roleTip(offer: RoleOffer): TipContent {
  return {
    title: offer.name,
    rows: [
      { label: 'Heures par semaine', value: `${offer.hoursPerWeek}${NBSP}h` },
      { label: 'Salaire et formation', value: 'Selon la candidature' },
    ],
  }
}
