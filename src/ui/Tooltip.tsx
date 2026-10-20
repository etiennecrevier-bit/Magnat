import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEventHandler,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactNode,
  type Ref,
  type RefCallback,
} from 'react'
import {
  blurLeaves,
  createTipControl,
  placeTip,
  TIP,
  tipBounds,
  editsText,
  tipScrollTop,
  type TipContent,
} from './tooltip.ts'
import './Tooltip.css'

/**
 * What the anchor spreads on itself: its ref, `aria-describedby` and the
 * events that open and close the tooltip. The anchor keeps its own
 * `onClick`; it must not set any of these again, or the tooltip stops
 * hearing it.
 */
export interface TipAnchorProps {
  readonly ref: RefCallback<HTMLElement>
  readonly 'aria-describedby': string
  readonly onPointerEnter: PointerEventHandler<HTMLElement>
  readonly onPointerLeave: PointerEventHandler<HTMLElement>
  readonly onPointerDown: PointerEventHandler<HTMLElement>
  readonly onPointerUp: PointerEventHandler<HTMLElement>
  readonly onPointerCancel: PointerEventHandler<HTMLElement>
  readonly onFocus: FocusEventHandler<HTMLElement>
  readonly onBlur: FocusEventHandler<HTMLElement>
  readonly onClickCapture: MouseEventHandler<HTMLElement>
  readonly onContextMenu: MouseEventHandler<HTMLElement>
}

/** What the anchor can do with its tooltip beyond its events. */
export interface TipActions {
  /** Opens it at once and keeps it open until Escape, blur or a press elsewhere. */
  readonly open: () => void
}

export interface TooltipProps {
  readonly content: TipContent
  /** Its width when the window has room, in CSS pixels; `TIP.width` by default. */
  readonly width?: number
  /**
   * Draws the anchor, spreading `anchor` on it. The tooltip goes right after
   * it in the page, so the anchor sits where a `div` may.
   */
  readonly children: (anchor: TipAnchorProps, tip: TipActions) => ReactNode
}

/**
 * The game's one tooltip, on its anchor: dark, with a title, an optional
 * text, rows of figures and a hint of what clicking does, and an arrow
 * toward the anchor. It opens on hover after a moment, at once on keyboard
 * focus on the anchor or inside it and on a long press, and closes on
 * leave, blur out of the anchor, Escape or a press elsewhere. It never
 * takes the focus: text taller than the window scrolls by the wheel, or by
 * the arrows, Page Up, Page Down, Home and End on the focused anchor, except
 * in a text field inside it, which keeps those keys. It is a manual
 * popover, so it shows above an open panel while staying in its page.
 */
export default function Tooltip({ content, width, children }: TooltipProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [control] = useState(() => createTipControl(setOpen, setWaiting))
  const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => () => control.dispose(), [control])

  // Placed while open: at its width first, so it is measured at the height
  // its text wraps to there, then beside its anchor, and again whenever the
  // window, a scroll or its own size changes.
  useLayoutEffect(() => {
    const tip = tipRef.current
    const anchor = anchorElement
    if (!open || tip === null || anchor === null) return
    showPopover(tip)
    const place = () => {
      const page = {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      }
      const bounds = tipBounds(page, TIP, width)
      tip.style.width = `${bounds.width}px`
      tip.style.maxHeight = `${bounds.maxHeight}px`
      const spot = placeTip(
        anchor.getBoundingClientRect(),
        { width: bounds.width, height: tip.getBoundingClientRect().height },
        page,
        TIP,
      )
      tip.style.left = `${spot.left}px`
      tip.style.top = `${spot.top}px`
      tip.style.setProperty('--tip-arrow', `${spot.arrow}px`)
      tip.dataset.side = spot.side
    }
    place()
    // New content, or a font loading, changes its height: placed again.
    const resized =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    resized?.observe(tip)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      resized?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      hidePopover(tip)
    }
  }, [open, width, anchorElement])

  // While open or about to open, the first Escape closes only the tooltip,
  // or stops it opening, before a panel or an event card hears it, and a
  // press anywhere else closes it. While open, the scroll keys on the
  // focused anchor scroll text taller than the window, but not in a text
  // field inside it, where they move the caret.
  useEffect(() => {
    if (!open && !waiting) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!control.escape()) return
        event.preventDefault()
        event.stopPropagation()
        return
      }
      const body = bodyRef.current
      const target = event.target
      if (!open || body === null || !(target instanceof Node)) return
      if (!anchorElement?.contains(target)) return
      if (target instanceof HTMLElement && editsText(target)) return
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return
      }
      const to = tipScrollTop(event.key, body)
      if (to === null) return
      body.scrollTop = to
      event.preventDefault()
      event.stopPropagation()
    }
    const onPress = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (anchorElement?.contains(target)) return
      if (tipRef.current?.contains(target)) return
      control.pressOutside()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPress, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPress, true)
    }
  }, [open, waiting, control, anchorElement])

  const anchor: TipAnchorProps = {
    ref: setAnchorElement,
    'aria-describedby': id,
    onPointerEnter: (event) => control.pointerEnter(event.pointerType),
    onPointerLeave: (event) => control.pointerLeave(event.pointerType),
    onPointerDown: (event) => control.pressStart(event.pointerType),
    onPointerUp: () => control.pressEnd(),
    onPointerCancel: () => control.pressEnd(),
    // The focus may land on the anchor or on a control inside it, such as a
    // card's field and steppers; moving between those keeps it open.
    onFocus: (event) => control.focus(isFocusVisible(event.target)),
    onBlur: (event) => {
      if (blurLeaves(event.currentTarget, event.relatedTarget)) control.blur()
    },
    onClickCapture: (event) => {
      if (!control.clickAfterPress()) return
      event.preventDefault()
      event.stopPropagation()
    },
    onContextMenu: (event) => {
      if (control.holding()) event.preventDefault()
    },
  }

  return (
    <>
      {children(anchor, { open: control.open })}
      <div
        ref={tipRef}
        id={id}
        role="tooltip"
        popover="manual"
        className="tip"
        data-open={open ? '' : undefined}
        onPointerEnter={() => control.tipEnter()}
        onPointerLeave={(event) => control.tipLeave(event.pointerType)}
        // A press on the tooltip leaves the focus on the anchor.
        onMouseDown={(event) => event.preventDefault()}
      >
        <TipBody content={content} ref={bodyRef} />
        <span className="tip__arrow" aria-hidden="true" />
      </div>
    </>
  )
}

/**
 * The tooltip's text: title, text, rows and the hint, each when given. Out
 * of the Tab order even when it scrolls, since the browser would otherwise
 * stop on it and blur the anchor.
 */
export function TipBody({
  content,
  ref,
}: {
  readonly content: TipContent
  readonly ref?: Ref<HTMLDivElement>
}) {
  const { title, text, rows, link } = content
  return (
    <div className="tip__body" ref={ref} tabIndex={-1}>
      <p className="tip__title">{title}</p>
      {text !== undefined && <p className="tip__text">{text}</p>}
      {rows !== undefined && rows.length > 0 && (
        <dl className="tip__rows">
          {rows.map((row, index) => (
            <div
              className={
                row.divider ? 'tip__row tip__row--divider' : 'tip__row'
              }
              key={index}
            >
              <dt>{row.label}</dt>
              <dd className={row.warn ? 'tip__value--warn' : undefined}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {link !== undefined && (
        <p className="tip__link">
          {link} <span aria-hidden="true">▸</span>
        </p>
      )}
    </div>
  )
}

/** Whether `element` got the focus from the keyboard, not from a press. */
function isFocusVisible(element: Element): boolean {
  try {
    return element.matches(':focus-visible')
  } catch {
    return true
  }
}

// A manual popover goes on the top layer, above an open modal dialog; a
// browser without popovers still shows it, fixed in the page, by `data-open`.
function showPopover(tip: HTMLElement): void {
  if (typeof tip.showPopover !== 'function') return
  if (!tip.matches(':popover-open')) tip.showPopover()
}

function hidePopover(tip: HTMLElement): void {
  if (typeof tip.hidePopover !== 'function') return
  if (tip.matches(':popover-open')) tip.hidePopover()
}
