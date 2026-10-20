import type { TutorialContent, TutorialGesture } from '../content/schema.ts'
import { latestDecisions } from '../engine/decisions.ts'
import { PRODUCTS } from '../engine/inventory.ts'
import { TUTORIAL, tutorialFacts, tutorialStepOf } from '../engine/tutorial.ts'
import type { GameState } from '../engine/types.ts'
import {
  NORMAL_SPEED,
  PAUSED,
  type GameStore,
  type GameStoreState,
} from './store.ts'
import type { TutorialSignal, TutorialSignals } from './tutorialSignals.ts'

// The tutorial's flow in the interface (#238): which step Réal shows, and
// the gestures that complete it, read from the store and from the signals
// of tooltips and speed buttons. The engine keeps the steps in order; this
// only tells it, through the store, that the gesture was seen.

/** What the bubble shows for the step due, its fallback in place. */
export interface StepView {
  readonly id: string
  /** What completes it: `next` when its fallback shows. */
  readonly gesture: TutorialGesture
  readonly text: string
  /** The bubble's one button; null when the gesture is elsewhere. */
  readonly button: string | null
  /** What it points at, by `data-tuto`, the first the player reaches winning. */
  readonly anchors: readonly string[]
  /** The anchors whose tooltip opening completes it. */
  readonly tipAnchors: readonly string[]
  /**
   * Whether what it points at is only shown: a step whose gesture is the
   * bubble's button keeps it out of reach, so a press there opens nothing
   * that would cover the next step's target.
   */
  readonly showOnly: boolean
}

/**
 * The step `game`'s tutorial asks for this morning, as the bubble shows it;
 * null when none is due. A step whose `fallback` points at a fact that did
 * not happen the day before, as `tutorialFacts` tells, shows the fallback
 * and its button instead, which completes it.
 */
export function stepView(
  game: Pick<GameState, 'day' | 'tutorial' | 'lastDay'>,
  tutorial: TutorialContent = TUTORIAL,
): StepView | null {
  const step = tutorialStepOf(game, tutorial)
  if (step === null) return null
  const { fallback } = step
  if (fallback !== undefined && !tutorialFacts(game)[fallback.fact]) {
    return {
      id: step.id,
      gesture: 'next',
      text: fallback.text,
      button: fallback.button,
      anchors: step.anchors,
      tipAnchors: [],
      showOnly: true,
    }
  }
  return {
    id: step.id,
    gesture: step.gesture,
    text: step.text,
    button: step.button ?? null,
    anchors: step.anchors,
    tipAnchors: step.tipAnchors ?? [],
    showOnly: step.gesture === 'next',
  }
}

/** Whether the bubble shows: a step of the tutorial is due. */
export function coachShowing(state: Pick<GameStoreState, 'game'>): boolean {
  return state.game.challenge === null && stepView(state.game) !== null
}

/** The part of the store's state the gestures read. */
export type GestureState = Pick<
  GameStoreState,
  'game' | 'panel' | 'panelSection' | 'drawer' | 'speed'
>

/** Whether any price waiting for tomorrow changed from `before` to `after`. */
function priceChanged(before: GameState, after: GameState): boolean {
  const was = latestDecisions(before).prices
  const is = latestDecisions(after).prices
  return PRODUCTS.some((product) => was[product] !== is[product])
}

/** Whether a field of the croissant's restock rule went up. */
function croissantRaised(before: GameState, after: GameState): boolean {
  const was = latestDecisions(before).restock.croissant as unknown as Record<
    string,
    unknown
  >
  const is = latestDecisions(after).restock.croissant as unknown as Record<
    string,
    unknown
  >
  if (was.kind !== is.kind) return false
  return Object.keys(is).some(
    (field) =>
      typeof is[field] === 'number' &&
      typeof was[field] === 'number' &&
      is[field] > was[field],
  )
}

/**
 * Whether the store going from `before` to `after` shows `gesture` made:
 * « Camion » or « Finances » opened, a price changed, the croissant rule
 * raised, a speed picked, a choice made on the event card, or « Hier »
 * clicked, which opens « Camion » on « Menu ». The gestures of a button or
 * a tooltip are not the store's (see `signalDone`).
 */
export function gestureDone(
  gesture: TutorialGesture,
  before: GestureState,
  after: GestureState,
): boolean {
  switch (gesture) {
    case 'openTruck':
      return before.panel !== 'manage' && after.panel === 'manage'
    case 'finances':
      return before.drawer !== 'finances' && after.drawer === 'finances'
    case 'priceChange':
    case 'priceOrOk':
      return priceChanged(before.game, after.game)
    case 'restockRaise':
      return croissantRaised(before.game, after.game)
    case 'speed1':
      return before.speed !== NORMAL_SPEED && after.speed === NORMAL_SPEED
    case 'speed3':
      return before.speed !== 3 && after.speed === 3
    case 'pause':
      return before.speed !== PAUSED && after.speed === PAUSED
    case 'choice':
      return (
        before.game.events.pending !== null &&
        after.game.events.pending === null
      )
    case 'readYesterday':
      return (
        before.panel !== 'manage' &&
        after.panel === 'manage' &&
        after.panelSection === 'menu'
      )
    case 'next':
    case 'tooltip':
      return false
  }
}

/**
 * Whether the store already shows `gesture` made as its step comes, so the
 * player is not asked for what is in front of them: « Camion » or
 * « Finances » open.
 */
export function gestureShown(
  gesture: TutorialGesture,
  state: GestureState,
): boolean {
  if (gesture === 'openTruck') return state.panel === 'manage'
  if (gesture === 'finances') return state.drawer === 'finances'
  return false
}

/**
 * Whether `signal` completes `step`: a tooltip of its `tipAnchors` opened,
 * or the speed button its gesture asks for pressed, even on the speed
 * already picked.
 */
export function signalDone(step: StepView, signal: TutorialSignal): boolean {
  if (signal.kind === 'tooltip') return step.tipAnchors.includes(signal.anchor)
  switch (step.gesture) {
    case 'speed1':
      return signal.speed === NORMAL_SPEED
    case 'speed3':
      return signal.speed === 3
    case 'pause':
      return signal.speed === PAUSED
    default:
      return false
  }
}

/** The timers the watcher needs, injectable so tests can fake them. */
export interface TimerHost {
  setTimeout: (callback: () => void, ms: number) => number
  clearTimeout: (handle: number) => void
}

const windowTimers: TimerHost = {
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle),
}

/**
 * Watches `store` and `signals` for the gesture of the step due, and marks
 * it done through `completeTutorialStep` (see `gestureDone`, `gestureShown`
 * and `signalDone`). After the pause, the game goes on at normal speed by
 * itself `resumeMs` later, unless the player picked a speed first, a panel
 * opened, or another game started. Returns the function that stops, which
 * also cancels that.
 */
export function watchTutorial(
  store: GameStore,
  signals: Pick<TutorialSignals, 'listen'>,
  resumeMs: number = TUTORIAL.coach.resumeAfterPauseMs,
  timers: TimerHost = windowTimers,
): () => void {
  let resume: number | null = null
  const cancel = () => {
    if (resume === null) return
    timers.clearTimeout(resume)
    resume = null
  }
  const complete = (step: StepView) => {
    const pause = step.gesture === 'pause'
    store.getState().completeTutorialStep(step.id, !pause)
    if (!pause || stepView(store.getState().game) !== null) return
    cancel()
    const { gamesStarted } = store.getState()
    resume = timers.setTimeout(() => {
      resume = null
      const state = store.getState()
      if (
        state.gamesStarted === gamesStarted &&
        state.speed === PAUSED &&
        state.resumeSpeed === null &&
        stepView(state.game) === null
      ) {
        state.setSpeed(NORMAL_SPEED)
      }
    }, resumeMs)
  }
  const shown = (state: GameStoreState) => {
    const step = stepView(state.game)
    if (step !== null && gestureShown(step.gesture, state)) complete(step)
  }
  shown(store.getState())
  const stopStore = store.subscribe((state, previous) => {
    if (state.gamesStarted !== previous.gamesStarted) cancel()
    // The step due before the change, so a gesture that completes one
    // never counts for the next.
    const step = stepView(previous.game)
    if (
      step !== null &&
      state.gamesStarted === previous.gamesStarted &&
      stepView(state.game)?.id === step.id &&
      gestureDone(step.gesture, previous, state)
    ) {
      complete(step)
    }
    const next = stepView(store.getState().game)
    if (next !== null && next.id !== stepView(previous.game)?.id) {
      shown(store.getState())
    }
  })
  const stopSignals = signals.listen((signal) => {
    const step = stepView(store.getState().game)
    if (step !== null && signalDone(step, signal)) complete(step)
  })
  return () => {
    stopStore()
    stopSignals()
    cancel()
  }
}
