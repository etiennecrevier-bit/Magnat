import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { TUTORIAL } from '../engine/tutorial.ts'
import {
  bubbleWidth,
  COACH,
  cycleFocus,
  holeBlockers,
  holeBox,
  placeBubble,
  showsWhole,
  visibleBox,
} from './coachBubble.ts'
import { portraitUrl } from './portraits.ts'
import { Silhouette } from './Silhouette.tsx'
import { gameStore, useGame } from './store.ts'
import type { Box, Size } from './tooltip.ts'
import { NARROW_QUERY } from './TopBar.tsx'
import { stepView, type StepView } from './tutorialFlow.ts'
import { tutorialSignals, type TutorialSignals } from './tutorialSignals.ts'
import { useMediaQuery } from './useMediaQuery.ts'
import './CoachBubble.css'

const { coach } = TUTORIAL

interface CoachBubbleViewProps {
  readonly view: StepView
  /** The URL of Réal's portrait; null shows the silhouette. */
  readonly portrait: string | null
  /** Whether « Passer la visite » asks to confirm. */
  readonly confirming: boolean
  readonly onButton: () => void
  readonly onSkip: () => void
  readonly onConfirmSkip: () => void
  readonly onCancelSkip: () => void
}

/**
 * The bubble's content: Réal's portrait, 64 px and round, his name, what he
 * says, the step's one button if it has one, and the small link « Passer la
 * visite », which asks once to confirm. A dialog that is not modal, named
 * by Réal's name and described by his text.
 */
export function CoachBubbleView({
  view,
  portrait,
  confirming,
  onButton,
  onSkip,
  onConfirmSkip,
  onCancelSkip,
}: CoachBubbleViewProps) {
  const nameId = useId()
  const textId = useId()
  return (
    <section
      className="coach__bubble"
      role="dialog"
      aria-modal="false"
      aria-labelledby={nameId}
      aria-describedby={textId}
    >
      <div className="coach__who">
        {portrait === null ? (
          <Silhouette className="coach__portrait coach__silhouette" size={64} />
        ) : (
          <img
            className="coach__portrait"
            src={portrait}
            alt=""
            width={64}
            height={64}
          />
        )}
        <p id={nameId} className="coach__name">
          {coach.name}
        </p>
      </div>
      <p id={textId} className="coach__text">
        {view.text}
      </p>
      {confirming ? (
        <div className="coach__confirm">
          <p className="coach__confirm-text">{coach.skip.confirm}</p>
          <div className="coach__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={onConfirmSkip}
            >
              {coach.skip.yes}
            </button>
            <button type="button" className="button" onClick={onCancelSkip}>
              {coach.skip.no}
            </button>
          </div>
        </div>
      ) : (
        <div className="coach__actions">
          {view.button !== null && (
            <button
              type="button"
              className="button button--primary"
              onClick={onButton}
            >
              {view.button}
            </button>
          )}
          <button type="button" className="coach__skip" onClick={onSkip}>
            {coach.skip.link}
          </button>
        </div>
      )}
      <span className="coach__arrow" aria-hidden="true" />
    </section>
  )
}

/** The topmost modal dialog open, which makes the rest of the page inert. */
function topModalDialog(): HTMLDialogElement | null {
  const open = [...document.querySelectorAll('dialog[open]')]
  for (const dialog of open.reverse()) {
    try {
      if (dialog.matches(':modal')) return dialog as HTMLDialogElement
    } catch {
      return null
    }
  }
  return null
}

function boxOf(rect: DOMRect): Box {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  }
}

/** The boxes of `element`'s ancestors that clip what overflows them. */
function clipsOf(element: Element): Box[] {
  const clips: Box[] = []
  for (
    let parent = element.parentElement;
    parent !== null && parent !== document.body;
    parent = parent.parentElement
  ) {
    const { overflowX, overflowY } = getComputedStyle(parent)
    if (overflowX !== 'visible' || overflowY !== 'visible') {
      clips.push(boxOf(parent.getBoundingClientRect()))
    }
  }
  return clips
}

/**
 * Whether the middle of `shown` is `element`'s, or one of its own, rather
 * than something covering it, such as a drawer over the dock; true where
 * the browser cannot tell. The bubble's own layer and tooltips do not count.
 */
function reachable(element: Element, shown: Box, layer: Element): boolean {
  if (typeof document.elementsFromPoint !== 'function') return true
  const x = (shown.left + shown.right) / 2
  const y = (shown.top + shown.bottom) / 2
  const top = document
    .elementsFromPoint(x, y)
    .find((hit) => !layer.contains(hit) && hit.closest('.tip') === null)
  return top === undefined || element === top || element.contains(top)
}

interface Target {
  readonly element: HTMLElement
  /** Its `data-tuto`. */
  readonly anchor: string
  readonly box: Box
}

/**
 * The first of `anchors` the player can reach: on the page and shown, in
 * the topmost modal dialog when one is open, and not covered. One clipped
 * by what scrolls around it is brought into view once, then measured at
 * what shows of it.
 */
function findTarget(
  anchors: readonly string[],
  layer: Element,
  page: Size,
  scrolled: WeakSet<Element>,
): Target | null {
  const modal = topModalDialog()
  for (const anchor of anchors) {
    const found = document.querySelectorAll<HTMLElement>(
      `[data-tuto="${anchor}"]`,
    )
    for (const element of found) {
      if (modal !== null && !modal.contains(element)) continue
      if (element.closest('[hidden]') !== null) continue
      if (element.getClientRects().length === 0) continue
      const box = boxOf(element.getBoundingClientRect())
      const shown = visibleBox(box, clipsOf(element), page)
      if (
        !scrolled.has(element) &&
        (shown === null || !showsWhole(box, shown))
      ) {
        scrolled.add(element)
        element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
        return findTarget(anchors, layer, page, scrolled)
      }
      if (shown === null || !reachable(element, shown, layer)) continue
      return { element, anchor, box: shown }
    }
  }
  return null
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** What takes the Tab key in `element`, itself first if it does. */
function focusables(element: Element): HTMLElement[] {
  const inside = [...element.querySelectorAll<HTMLElement>(FOCUSABLE)]
  return element instanceof HTMLElement && element.matches(FOCUSABLE)
    ? [element, ...inside]
    : inside
}

// A manual popover goes on the top layer, above the panels; a browser
// without popovers still shows it, fixed in the page, by its class.
function showLayer(layer: HTMLElement): void {
  if (typeof layer.showPopover !== 'function') return
  if (layer.matches(':popover-open')) layer.hidePopover()
  layer.showPopover()
}

function place(element: HTMLElement | null, box: Box): void {
  if (element === null) return
  element.style.left = `${box.left}px`
  element.style.top = `${box.top}px`
  element.style.width = `${Math.max(0, box.right - box.left)}px`
  element.style.height = `${Math.max(0, box.bottom - box.top)}px`
}

/**
 * Lays out the layer of `view` each frame: the hole around the target the
 * player can reach, the four blocks around it, and the bubble beside it.
 * With no anchor, the hole closes to nothing at the middle, dimming the
 * whole window, and the bubble is centred. With anchors but none in
 * reach, as when something the player opened covers it, nothing dims or
 * blocks, and the bubble waits at the top, so the player can always close
 * what covers it. A step whose gesture is the bubble's button only shows
 * its target: a block covers the hole too. Returns the target found last.
 */
function useLayout(
  view: StepView,
  layerRef: RefObject<HTMLDivElement | null>,
  holeRef: RefObject<HTMLDivElement | null>,
  blockRefs: RefObject<(HTMLDivElement | null)[]>,
  bubbleRef: RefObject<HTMLDivElement | null>,
  phone: boolean,
  onContainer: (container: Element) => void,
): RefObject<Target | null> {
  const target = useRef<Target | null>(null)
  useEffect(() => {
    const scrolled = new WeakSet<Element>()
    let frame = 0
    const layout = () => {
      frame = window.requestAnimationFrame(layout)
      const layer = layerRef.current
      const hole = holeRef.current
      const bubble = bubbleRef.current
      if (layer === null || hole === null || bubble === null) return
      onContainer(topModalDialog() ?? document.body)
      const page = {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      }
      const centred = view.anchors.length === 0
      const found = centred
        ? null
        : findTarget(view.anchors, layer, page, scrolled)
      target.current = found
      const width = bubbleWidth(page, phone)
      bubble.style.width = `${width}px`
      const size = { width, height: bubble.getBoundingClientRect().height }
      const free = !centred && found === null
      layer.toggleAttribute('data-dim', !free)
      let shown: Box | null = null
      if (found !== null) shown = holeBox(found.box, page)
      const middle = { left: page.width / 2, top: page.height / 2 }
      place(
        hole,
        shown ?? {
          left: middle.left,
          top: middle.top,
          right: middle.left,
          bottom: middle.top,
        },
      )
      const blocks = free
        ? holeBlockers(null, { width: 0, height: 0 })
        : holeBlockers(view.showOnly ? null : shown, page)
      blocks.forEach((box, index) =>
        place(blockRefs.current[index] ?? null, box),
      )
      const spot = free
        ? {
            left: Math.max(COACH.margin, (page.width - width) / 2),
            top: COACH.freeTop,
            width,
            side: 'center' as const,
            arrow: 0,
          }
        : placeBubble(found?.box ?? null, size, page, phone)
      bubble.style.left = `${spot.left}px`
      bubble.style.top = `${spot.top}px`
      bubble.style.setProperty('--coach-arrow', `${spot.arrow}px`)
      bubble.dataset.side = spot.side
    }
    layout()
    return () => window.cancelAnimationFrame(frame)
  }, [view, layerRef, holeRef, blockRefs, bubbleRef, phone, onContainer])
  return target
}

/**
 * The keys while the bubble shows: Tab cycles between the target and the
 * bubble's link and button; Escape does nothing, the step waiting for its
 * gesture, but backs out of « Passer la visite » asking to confirm. A press
 * on a target whose tooltip completes the step opens that tooltip, as a
 * tap on a phone does not.
 */
function useKeysAndPresses(
  view: StepView,
  target: RefObject<Target | null>,
  bubbleRef: RefObject<HTMLDivElement | null>,
  confirming: boolean,
  onCancelSkip: () => void,
  signals: Pick<TutorialSignals, 'openTip'>,
) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (confirming) onCancelSkip()
        return
      }
      if (event.key !== 'Tab') return
      const bubble = bubbleRef.current
      const found = target.current
      const items = [
        ...(found === null || view.showOnly ? [] : focusables(found.element)),
        ...(bubble === null ? [] : focusables(bubble)),
      ]
      const active =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      const next = cycleFocus(items, active, event.shiftKey)
      if (next === null) return
      event.preventDefault()
      next.focus()
    }
    const onClick = (event: MouseEvent) => {
      const found = target.current
      if (found === null || !view.tipAnchors.includes(found.anchor)) return
      if (!(event.target instanceof Node)) return
      if (!found.element.contains(event.target)) return
      if (!signals.openTip(found.anchor)) return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('click', onClick, true)
    }
  }, [view, target, bubbleRef, confirming, onCancelSkip, signals])
}

/**
 * The layer of one step: the dim with its hole, the blocks around the
 * hole and the bubble, a manual popover on the top layer, so it shows over
 * the panels and the event card. While a modal dialog is open, it goes
 * inside that dialog, outside which the page is inert, and shows again
 * there, on top.
 */
function CoachLayer({
  view,
  signals,
}: {
  readonly view: StepView
  readonly signals: TutorialSignals
}) {
  const [container, setContainer] = useState<Element>(() => document.body)
  const [confirming, setConfirming] = useState(false)
  const phone = useMediaQuery(NARROW_QUERY)
  const layerRef = useRef<HTMLDivElement>(null)
  const holeRef = useRef<HTMLDivElement>(null)
  const blockRefs = useRef<(HTMLDivElement | null)[]>([])
  const bubbleRef = useRef<HTMLDivElement>(null)
  const onContainer = useMemo(
    () => (next: Element) =>
      setContainer((current) => (current === next ? current : next)),
    [],
  )
  const onCancelSkip = useMemo(() => () => setConfirming(false), [])

  useLayoutEffect(() => {
    const layer = layerRef.current
    if (layer !== null) showLayer(layer)
  }, [container])

  const target = useLayout(
    view,
    layerRef,
    holeRef,
    blockRefs,
    bubbleRef,
    phone,
    onContainer,
  )
  useKeysAndPresses(view, target, bubbleRef, confirming, onCancelSkip, signals)

  const { completeTutorialStep, skipTour } = gameStore.getState()
  return createPortal(
    <div ref={layerRef} className="coach" popover="manual" data-coach="">
      <div ref={holeRef} className="coach__hole" aria-hidden="true" />
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          ref={(element) => {
            blockRefs.current[index] = element
          }}
          className="coach__block"
          aria-hidden="true"
        />
      ))}
      <div ref={bubbleRef} className="coach__spot">
        <CoachBubbleView
          view={view}
          portrait={portraitUrl(coach.character)}
          confirming={confirming}
          onButton={() => completeTutorialStep(view.id)}
          onSkip={() => setConfirming(true)}
          onConfirmSkip={() => skipTour()}
          onCancelSkip={onCancelSkip}
        />
      </div>
    </div>,
    container,
  )
}

/**
 * Réal's bubble while a step of the tutorial is due, never in a Défi, over
 * everything else, with what he says read out as each step comes.
 */
export default function CoachBubble({
  signals = tutorialSignals,
}: {
  signals?: TutorialSignals
}) {
  const game = useGame((state) => state.game)
  const view = useMemo(
    () => (game.challenge === null ? stepView(game) : null),
    [game],
  )
  // Kept on the page for the whole tour, so each step's text is read out
  // as it comes, even where the bubble's layer is new.
  const touring =
    game.challenge === null &&
    game.tutorial !== undefined &&
    !game.tutorial.done
  if (!touring) return null
  return (
    <>
      <p className="visually-hidden" aria-live="polite">
        {view === null ? '' : `${coach.name}\u00a0: ${view.text}`}
      </p>
      {view !== null && (
        <CoachLayer key={view.id} view={view} signals={signals} />
      )}
    </>
  )
}
