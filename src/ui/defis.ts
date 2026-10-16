import type {
  DecisionKind,
  Defi,
  DefiCondition,
  DefiGoal,
  DefiMetric,
  Medal,
} from '../content/schema.ts'
import {
  failedCondition,
  metricValue,
  startDayOf,
} from '../engine/challenge.ts'
import { EVENTS } from '../engine/day.ts'
import { cents } from '../engine/money.ts'
import type {
  ChallengeProgress,
  ChallengeState,
  Day,
  GameState,
} from '../engine/types.ts'
import { formatDayAndMonth, formatWeekdayName } from './formatGameDate.ts'
import { formatBriefMoney } from './formatMoney.ts'
import type { GameStore } from './store.ts'

// The Défis as the player reads them: the engine plays them and judges
// them (src/engine/challenge.ts); this only words and formats what it
// keeps, from the content's Défis (src/content/defis.json).

// French puts a no-break space (U+00A0) before a colon and a percent sign,
// and inside its quotation marks.
const NO_BREAK_SPACE = ' '
const COLON = `${NO_BREAK_SPACE}:`
const OPEN_QUOTE = `«${NO_BREAK_SPACE}`
const CLOSE_QUOTE = `${NO_BREAK_SPACE}»`
const DIGITS_PER_GROUP = /\B(?=(\d{3})+(?!\d))/g
// Calendar facts: a Défi counts its weeks from its first day.
const DAYS_PER_WEEK = 7
// A share is shown to a tenth of a percent.
const TENTHS_PER_WHOLE = 1000
const TENTHS_PER_PERCENT = 10

/** The medals' names, as the player reads them on their own. */
export const MEDAL_NAMES: Readonly<Record<Medal, string>> = {
  or: 'Or',
  argent: 'Argent',
  bronze: 'Bronze',
}

/** A medal won, as the end screen announces it. */
export const MEDAL_TITLES: Readonly<Record<Medal, string>> = {
  or: "Médaille d'or",
  argent: "Médaille d'argent",
  bronze: 'Médaille de bronze',
}

/** What each measure of a Défi is called. */
export const METRIC_LABELS: Readonly<Record<DefiMetric, string>> = {
  lowestCash: 'Encaisse la plus basse',
  netIncome: 'Bénéfice net',
  sales: 'Ventes',
  customersServed: 'Clients servis',
  spoilageRate: 'Marchandise jetée',
  lowestEnergy: 'Énergie la plus basse',
}

const GOAL_LINES: Readonly<Record<DefiMetric, string>> = {
  lowestCash:
    'Gardez votre encaisse la plus haute possible, même à son plus bas.',
  netIncome: 'Faites le plus gros bénéfice net possible.',
  sales: 'Vendez le plus possible.',
  customersServed: 'Servez le plus de clients possible.',
  spoilageRate: 'Jetez le moins de marchandise possible.',
  lowestEnergy:
    'Gardez votre énergie la plus haute possible, même à son plus bas.',
}

const LOCK_REASONS: Readonly<Record<DecisionKind, string>> = {
  price: 'Le Défi fixe les prix.',
  restock: 'Le Défi fixe les commandes.',
  daysOpen: "Le Défi fixe l'horaire.",
  ownerWeeklyPay: 'Le Défi fixe votre salaire.',
  marketingDaily: 'Le Défi fixe le budget de marketing.',
}

/** Why a choice of an event card the Défi forces cannot be made. */
export const FORCED_CHOICE_REASON = 'Le Défi impose un autre choix.'

/** The measure each kind of condition watches. */
const CONDITION_METRICS: Readonly<Record<DefiCondition['kind'], DefiMetric>> = {
  minCash: 'lowestCash',
  minEnergy: 'lowestEnergy',
  maxSpoilageRate: 'spoilageRate',
}

/** Whether `game` is a Défi that is over, réussi or échoué. */
export function isChallengeOver({ challenge }: GameState): boolean {
  return challenge !== null && challenge.status !== 'enCours'
}

/** How long a Défi lasts: « 1 semaine », « 3 semaines » or « 64 jours ». */
export function lengthText(days: number): string {
  if (days % DAYS_PER_WEEK !== 0) return `${days} jours`
  const weeks = days / DAYS_PER_WEEK
  return weeks === 1 ? '1 semaine' : `${weeks} semaines`
}

/**
 * The week of the Défi the morning of `day` falls in, counting from its
 * first day, and how many weeks it has, the last one maybe short. Past its
 * last day, as on the morning after, it stays in its last week.
 */
export function defiWeek(
  challenge: Pick<ChallengeState, 'startDay'>,
  defi: Pick<Defi, 'lengthDays'>,
  day: Day,
): { week: number; weeks: number } {
  const weeks = Math.ceil(defi.lengthDays / DAYS_PER_WEEK)
  const week = Math.floor((day - challenge.startDay) / DAYS_PER_WEEK) + 1
  return { week: Math.min(Math.max(week, 1), weeks), weeks }
}

/** What the top bar's chip reads: « Défi · semaine 2 de 3 ». */
export function chipLabel(
  challenge: Pick<ChallengeState, 'startDay'>,
  defi: Pick<Defi, 'lengthDays'>,
  day: Day,
): string {
  const { week, weeks } = defiWeek(challenge, defi, day)
  return `Défi · semaine ${week} de ${weeks}`
}

/**
 * The owner's `energy` against the floor the Défi sets, both rounded down
 * as the floor reads them: « 52 (plancher : 33) »; null for a Défi with no
 * floor. The energy gauge shows only « Fatigué » and « Épuisé », so a floor
 * between them needs its number.
 */
export function energyFloorText(
  energy: number,
  defi: Pick<Defi, 'conditions'>,
): string | null {
  const floor = defi.conditions.find(
    (condition): condition is Extract<DefiCondition, { kind: 'minEnergy' }> =>
      condition.kind === 'minEnergy',
  )
  if (floor === undefined) return null
  return `${formatMetric('lowestEnergy', energy)} (plancher${COLON} ${formatMetric('lowestEnergy', floor.amount)})`
}

/**
 * The line for the owner's energy against the floor, in the Défi's chip
 * and panel: « Énergie : 52 (plancher : 33) »; null for a Défi with no
 * floor.
 */
export function energyFloorLine(
  energy: number,
  defi: Pick<Defi, 'conditions'>,
): string | null {
  const text = energyFloorText(energy, defi)
  return text === null ? null : `Énergie${COLON} ${text}`
}

/** A count with its thousands apart: « 1 150 ». */
function formatCount(count: number): string {
  return String(count).replace(DIGITS_PER_GROUP, NO_BREAK_SPACE)
}

/** A share in tenths of a percent: « 3 % », « 3,1 % ». */
function formatTenths(tenths: number): string {
  const whole = Math.floor(tenths / TENTHS_PER_PERCENT)
  const tenth = tenths % TENTHS_PER_PERCENT
  const text = tenth === 0 ? String(whole) : `${whole},${tenth}`
  return `${text}${NO_BREAK_SPACE}%`
}

/**
 * `value`, as `metric` measures it, the way the player reads it: money in
 * fr-CA, a count, a whole energy, rounded down so it never reads as a
 * threshold it is under, or a share to a tenth of a percent.
 */
export function formatMetric(metric: DefiMetric, value: number): string {
  switch (metric) {
    case 'lowestCash':
    case 'netIncome':
    case 'sales':
      return formatBriefMoney(cents(value))
    case 'customersServed':
      return formatCount(value)
    case 'spoilageRate':
      return formatTenths(Math.round(value * TENTHS_PER_WHOLE))
    case 'lowestEnergy':
      return String(Math.floor(value))
  }
}

/**
 * What `metric` reads in `progress`, formatted. The share of goods thrown
 * out rounds up from the units, so 3,04 % never reads as 3 % under a limit
 * of 3 %.
 */
export function progressValue(
  progress: ChallengeProgress,
  metric: DefiMetric,
): string {
  if (metric !== 'spoilageRate') {
    return formatMetric(metric, metricValue(progress, metric))
  }
  const { unitsSold, unitsSpoiled } = progress
  const total = unitsSold + unitsSpoiled
  return formatTenths(
    total === 0 ? 0 : Math.ceil((unitsSpoiled * TENTHS_PER_WHOLE) / total),
  )
}

/** What the Défi asks for, in a sentence. */
export function goalLine(goal: DefiGoal): string {
  return GOAL_LINES[goal.metric]
}

/**
 * A medal's threshold: « 1 000 $ ou plus », « 3 % ou moins », and for a
 * bénéfice net of 0 or below, « aucune perte » and « perte limitée à
 * 1 450 $ », since limiting the loss is then the goal. `afterVerb` words
 * these after « Le bronze demandait »: « de terminer sans perte », « une
 * perte limitée à 1 450 $ ».
 */
function thresholdText(
  goal: DefiGoal,
  medal: Medal,
  afterVerb = false,
): string {
  const threshold = goal.medals[medal]
  if (goal.metric === 'netIncome' && threshold <= 0) {
    if (threshold === 0) {
      return afterVerb ? 'de terminer sans perte' : 'aucune perte'
    }
    const loss = `perte limitée à ${formatBriefMoney(cents(-threshold))}`
    return afterVerb ? `une ${loss}` : loss
  }
  const more = goal.metric === 'spoilageRate' ? 'ou moins' : 'ou plus'
  return `${formatMetric(goal.metric, threshold)} ${more}`
}

/** What each medal needs, the best first: « Or : 1 000 $ ou plus ». */
export function thresholdLines(goal: DefiGoal): string[] {
  return (Object.keys(MEDAL_NAMES) as Medal[]).map(
    (medal) => `${MEDAL_NAMES[medal]}${COLON} ${thresholdText(goal, medal)}`,
  )
}

/** A condition, as the briefing states it. */
export function conditionLine(condition: DefiCondition): string {
  switch (condition.kind) {
    case 'minCash':
      return `L'encaisse ne doit jamais passer sous ${formatBriefMoney(condition.amountCents)}.`
    case 'minEnergy':
      return `Votre énergie ne doit jamais tomber sous ${formatMetric('lowestEnergy', condition.amount)}.`
    case 'maxSpoilageRate':
      return `Pas plus de ${formatMetric('spoilageRate', condition.rate)} de la marchandise ne doit finir aux poubelles.`
  }
}

/** A condition broken, as the end screen tells it. */
function brokenLine(condition: DefiCondition): string {
  switch (condition.kind) {
    case 'minCash':
      return `L'encaisse est passée sous ${formatBriefMoney(condition.amountCents)}.`
    case 'minEnergy':
      return `Votre énergie est tombée sous ${formatMetric('lowestEnergy', condition.amount)}.`
    case 'maxSpoilageRate':
      return `Plus de ${formatMetric('spoilageRate', condition.rate)} de la marchandise a fini aux poubelles.`
  }
}

/**
 * Why a Défi « échoué » failed: the condition it broke, or, with none
 * broken, the goal short of bronze.
 */
export function failureLine(progress: ChallengeProgress, defi: Defi): string {
  const broken = failedCondition(progress, defi)
  if (broken !== null) return brokenLine(broken)
  const { goal } = defi
  return (
    `${METRIC_LABELS[goal.metric]}${COLON} ${progressValue(progress, goal.metric)}. ` +
    `Le bronze demandait ${thresholdText(goal, 'bronze', true)}.`
  )
}

/** Why the controls of a locked kind of decision do nothing. */
export function lockReason(kind: DecisionKind): string {
  return LOCK_REASONS[kind]
}

/**
 * What the Défi takes out of the player's hands: one line per kind of
 * decision it locks, then one per event card it forces, with its date and
 * the choices allowed. Empty when it locks nothing.
 */
export function lockedLines(defi: Defi): string[] {
  const startDay = startDayOf(defi)
  const events = defi.events.map(({ day, event, choices }) => {
    const card = EVENTS.events.find(({ id }) => id === event)
    const date = `Le ${formatWeekdayName(startDay + day)} ${formatDayAndMonth(startDay + day)}`
    const labels = choices.map(
      (choice) =>
        card?.choices.find(({ id }) => id === choice)?.label ?? choice,
    )
    const title = `${OPEN_QUOTE}${card?.title ?? event}${CLOSE_QUOTE}`
    return `${date}${COLON} ${title}, choix imposé${COLON} ${labels.join(', ')}.`
  })
  return [...defi.locked.map(lockReason), ...events]
}

/** The goal's measure, then each condition's, each once. */
function watchedMetrics(defi: Defi): DefiMetric[] {
  const metrics = [
    defi.goal.metric,
    ...defi.conditions.map(({ kind }) => CONDITION_METRICS[kind]),
  ]
  return metrics.filter((metric, index) => metrics.indexOf(metric) === index)
}

/** One line per measure the Défi watches: « Encaisse la plus basse : 1 870 $ ». */
export function progressLines(
  progress: ChallengeProgress,
  defi: Defi,
): string[] {
  return watchedMetrics(defi).map(
    (metric) =>
      `${METRIC_LABELS[metric]}${COLON} ${progressValue(progress, metric)}`,
  )
}

/**
 * The key numbers of a Défi over: the measures it watched, then the ventes,
 * the bénéfice net, the lowest encaisse and the customers served, each
 * once, and the days played.
 */
export function endFigures(progress: ChallengeProgress, defi: Defi): string[] {
  const metrics = [
    ...watchedMetrics(defi),
    'sales',
    'netIncome',
    'lowestCash',
    'customersServed',
  ] as const
  const lines = metrics
    .filter((metric, index) => metrics.indexOf(metric) === index)
    .map(
      (metric) =>
        `${METRIC_LABELS[metric]}${COLON} ${progressValue(progress, metric)}`,
    )
  return [
    ...lines,
    `Jours joués${COLON} ${progress.daysPlayed} sur ${defi.lengthDays}`,
  ]
}

/**
 * Hands each medal won in the game `store` plays to `record`, with its
 * Défi's id: the one the game holds now, as a Défi won and then loaded,
 * and every one it wins from then on. `record` may get the same medal
 * more than once. Returns a function that stops it.
 */
export function keepBestMedals(
  store: GameStore,
  record: (defiId: string, medal: Medal) => void,
): () => void {
  const keep = ({ challenge }: GameState) => {
    if (challenge !== null && challenge.medal !== null) {
      record(challenge.id, challenge.medal)
    }
  }
  keep(store.getState().game)
  return store.subscribe((state, previous) => {
    if (state.game !== previous.game) keep(state.game)
  })
}
