// The game's one tooltip: what it holds, where it goes and when it opens.
// Pure, so it is tested without a DOM; `Tooltip.tsx` only wires the
// browser's events and boxes to it.

/** How the tooltip times and places itself, in milliseconds and CSS pixels. */
export const TIP = {
  /** A mouse or pen resting on the anchor this long opens it. */
  hoverMs: 300,
  /** A finger held on the anchor this long opens it. */
  longPressMs: 500,
  /** Time the pointer has to cross from the anchor onto the tooltip. */
  leaveGraceMs: 100,
  /** Space between the anchor and the tooltip. */
  gap: 10,
  /** Space the tooltip keeps from the window's edges. */
  margin: 8,
  /** The tooltip's width when the window has room for it. */
  width: 250,
  /** The tooltip's corner radius, which the arrow keeps clear of. */
  corner: 12,
  /** How far the arrow sticks out of the tooltip. */
  arrow: 8,
} as const

export type TipSettings = Omit<
  typeof TIP,
  'hoverMs' | 'longPressMs' | 'leaveGraceMs'
>

/** A label and its value, on one line of the tooltip's grid. */
export interface TipRow {
  readonly label: string
  readonly value: string
  /** Shows the value in amber, as something to look at. */
  readonly warn?: boolean
}

/** What a tooltip says. Every part but the title is optional. */
export interface TipContent {
  /** The first line, in Fredoka. */
  readonly title: string
  readonly text?: string
  readonly rows?: readonly TipRow[]
  /**
   * What clicking the anchor does, in amber with « ▸ » after it. A hint, not
   * a link: the tooltip never takes the focus, so the anchor does it.
   */
  readonly link?: string
}

export interface Box {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export interface Size {
  readonly width: number
  readonly height: number
}

export type TipSide = 'right' | 'left' | 'above'

export interface TipPlace {
  /** The tooltip's left and top edges in the window, its border box. */
  readonly left: number
  readonly top: number
  readonly width: number
  /** Its height, at most `maxHeight` of `tipBounds()`. */
  readonly height: number
  /** Which side of the anchor it is on; the arrow is on the opposite edge. */
  readonly side: TipSide
  /**
   * Where the arrow's centre is along that edge, from the tooltip's top for
   * `right` and `left`, from its left for `above`.
   */
  readonly arrow: number
}

/**
 * The tooltip's width and the most height it may take in a window of
 * `page`: `settings.width`, narrowed to fit between the margins, and the
 * window's height less the margins. The tooltip takes that width before it
 * is measured, so its height is the one its text wraps to at that width;
 * taller content scrolls inside it.
 */
export function tipBounds(
  page: Size,
  settings: TipSettings,
  width: number = settings.width,
): { readonly width: number; readonly maxHeight: number } {
  const room = (length: number) => Math.max(0, length - 2 * settings.margin)
  return {
    width: Math.min(width, room(page.width)),
    maxHeight: room(page.height),
  }
}

/**
 * Where the tooltip goes beside `anchor`, as the customer card does
 * (`placeCard` in the world): right of it, else left of it, else above it,
 * always inside the window's margins. Beside the anchor it is centred on the
 * anchor's middle and slides up or down to stay inside; above it, centred
 * across and slid sideways. `tip` is the size measured at `tipBounds()`'s
 * width.
 */
export function placeTip(
  anchor: Box,
  tip: Size,
  page: Size,
  settings: TipSettings,
): TipPlace {
  const { gap, margin } = settings
  const { maxHeight } = tipBounds(page, settings)
  const width = Math.max(0, Math.min(tip.width, page.width - 2 * margin))
  const height = Math.max(0, Math.min(tip.height, maxHeight))
  const fits = (left: number) =>
    left >= margin && left + width <= page.width - margin
  const middleY = (anchor.top + anchor.bottom) / 2
  const middleX = (anchor.left + anchor.right) / 2

  const besideLeft = [anchor.right + gap, anchor.left - gap - width].find(fits)
  if (besideLeft !== undefined) {
    const top = clamp(
      middleY - height / 2,
      margin,
      page.height - margin - height,
    )
    return {
      left: besideLeft,
      top,
      width,
      height,
      side: besideLeft > anchor.left ? 'right' : 'left',
      arrow: arrowAt(middleY - top, height, settings),
    }
  }
  const left = clamp(middleX - width / 2, margin, page.width - margin - width)
  const top = clamp(
    anchor.top - gap - height,
    margin,
    page.height - margin - height,
  )
  return {
    left,
    top,
    width,
    height,
    side: 'above',
    arrow: arrowAt(middleX - left, width, settings),
  }
}

/**
 * `toward`, the anchor's middle along an edge of `length`, held off the
 * rounded corners so the arrow always joins the tooltip; the middle of an
 * edge too short for that.
 */
function arrowAt(
  toward: number,
  length: number,
  settings: TipSettings,
): number {
  const clear = settings.corner + settings.arrow
  if (length < 2 * clear) return length / 2
  return clamp(toward, clear, length - clear)
}

/** `value`, held between `min` and `max`; `min` wins if they cross. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** What `createTipControl()` hands back: one call per thing that happens. */
export interface TipControl {
  /** A pointer comes onto the anchor: a mouse or pen starts the hover delay. */
  pointerEnter(pointerType: string): void
  /** A pointer leaves the anchor: it closes after the grace, unless pinned. */
  pointerLeave(pointerType: string): void
  /** The pointer comes onto the tooltip, which keeps it open. */
  tipEnter(): void
  /** The pointer leaves the tooltip: it closes after the grace, unless pinned. */
  tipLeave(pointerType: string): void
  /** The anchor gets the focus; from the keyboard, it opens at once. */
  focus(visible: boolean): void
  /** The anchor loses the focus: it closes. */
  blur(): void
  /** A press on the anchor starts; a finger starts the long press. */
  pressStart(pointerType: string): void
  /** The press ends or is cancelled before the long press opens it. */
  pressEnd(): void
  /** Whether a finger is held on the anchor, as a long press would be. */
  holding(): boolean
  /**
   * Called on the click that follows a press: true once if a long press
   * opened the tooltip, so that click should not do the anchor's action.
   */
  clickAfterPress(): boolean
  /** Escape: closes it, and says whether it was open. */
  escape(): boolean
  /** A press outside both the anchor and the tooltip closes it. */
  pressOutside(): void
  /** Opens it at once and keeps it open until Escape, blur or a press outside. */
  open(): void
  /** Stops the timers still waiting, so nothing opens or closes later. */
  dispose(): void
}

/**
 * The tooltip's opening and closing, timed with `setTimeout` (`TIP`).
 * `onChange` hears each time it opens or closes, never twice the same.
 */
export function createTipControl(
  onChange: (open: boolean) => void,
): TipControl {
  let open = false
  let pinned = false
  let held = false
  let openedByPress = false
  let opening: ReturnType<typeof setTimeout> | null = null
  let closing: ReturnType<typeof setTimeout> | null = null

  const stopOpening = () => {
    if (opening !== null) clearTimeout(opening)
    opening = null
  }
  const stopClosing = () => {
    if (closing !== null) clearTimeout(closing)
    closing = null
  }
  const set = (next: boolean) => {
    stopOpening()
    stopClosing()
    if (!next) pinned = false
    if (next === open) return
    open = next
    onChange(next)
  }
  const openAfter = (ms: number, then?: () => void) => {
    stopClosing()
    if (open || opening !== null) return
    opening = setTimeout(() => {
      opening = null
      then?.()
      set(true)
    }, ms)
  }
  const closeSoon = () => {
    stopOpening()
    if (!open || pinned || closing !== null) return
    closing = setTimeout(() => {
      closing = null
      set(false)
    }, TIP.leaveGraceMs)
  }

  return {
    pointerEnter(pointerType) {
      if (pointerType !== 'touch') openAfter(TIP.hoverMs)
    },
    pointerLeave(pointerType) {
      // A finger leaves the anchor as it lifts, which must not close what a
      // long press opened.
      if (pointerType !== 'touch') closeSoon()
    },
    tipEnter() {
      stopClosing()
    },
    tipLeave(pointerType) {
      if (pointerType !== 'touch') closeSoon()
    },
    focus(visible) {
      if (visible) set(true)
    },
    blur() {
      set(false)
    },
    pressStart(pointerType) {
      openedByPress = false
      held = pointerType === 'touch'
      if (!held) return
      openAfter(TIP.longPressMs, () => {
        openedByPress = true
      })
    },
    pressEnd() {
      held = false
      if (!open) stopOpening()
    },
    holding() {
      return held
    },
    clickAfterPress() {
      const suppress = openedByPress
      openedByPress = false
      return suppress
    },
    escape() {
      const was = open
      set(false)
      return was
    },
    pressOutside() {
      set(false)
    },
    open() {
      set(true)
      pinned = true
    },
    dispose() {
      stopOpening()
      stopClosing()
      held = false
    },
  }
}
