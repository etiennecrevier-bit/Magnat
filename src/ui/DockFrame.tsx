import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  backdropPoint,
  drawerEscape,
  nextTab,
  tabId,
  type BackdropPicks,
  type FrameTab,
} from './dockFrame.ts'
import './panel.css'
import './DockFrame.css'

interface FrameHeaderProps<T extends string> {
  /** The id the title takes, which the frame is labelled by. */
  readonly titleId: string
  readonly title: string
  /** Its tabs; with fewer than two, none show. */
  readonly tabs?: readonly FrameTab<T>[]
  readonly tab?: T
  /**
   * Shows `tab`; false when it stays on the one shown, as when a field there
   * holds invalid text.
   */
  readonly onTab?: (tab: T) => boolean | void
  /** The id of the part the tabs show, which they control. */
  readonly bodyId: string
  /** « ✕ »: closes the frame. */
  readonly onDismiss: () => void
}

/**
 * The top of a panel or a drawer: its title, its tabs as pills, the one
 * shown pressed, then « ✕ » at the right. The arrows, Home and End move
 * between the tabs, as a tab list does.
 */
export function FrameHeader<T extends string>({
  titleId,
  title,
  tabs = [],
  tab,
  onTab,
  bodyId,
  onDismiss,
}: FrameHeaderProps<T>) {
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (tab === undefined || onTab === undefined) return
    const to = nextTab(
      tabs.map(({ id }) => id),
      tab,
      event.key,
    )
    if (to === null) return
    event.preventDefault()
    if (onTab(to) === false) return
    document.getElementById(tabId(bodyId, to))?.focus()
  }
  return (
    <div className="dock-frame__header">
      <h2 id={titleId} className="dock-frame__title">
        {title}
      </h2>
      {tabs.length > 1 && (
        <div
          className="dock-frame__tabs"
          role="tablist"
          aria-label={title}
          onKeyDown={onKeyDown}
        >
          {tabs.map(({ id, label }) => {
            const selected = id === tab
            return (
              <button
                key={id}
                id={tabId(bodyId, id)}
                type="button"
                role="tab"
                className={selected ? 'tab on' : 'tab'}
                aria-selected={selected}
                aria-controls={bodyId}
                tabIndex={selected ? 0 : -1}
                onMouseDown={keepFocus}
                onClick={(event) => {
                  if (onTab?.(id) !== false) event.currentTarget.focus()
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}
      <button
        type="button"
        className="dock-frame__close"
        aria-label="Fermer"
        onMouseDown={keepFocus}
        onClick={onDismiss}
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  )
}

/**
 * A press on a tab or on « ✕ » leaves the focus where it is until the
 * click, so a field being typed in commits then, in `onTab` or
 * `onDismiss`, not as the press starts: its message going would shrink the
 * frame, anchored at the bottom, and move the header from under the
 * pointer before the click.
 */
function keepFocus(event: ReactMouseEvent<HTMLButtonElement>) {
  event.preventDefault()
}

interface FrameBodyProps<T extends string> {
  readonly bodyId: string
  readonly tabs: readonly FrameTab<T>[]
  readonly tab?: T
  readonly children: ReactNode
}

/** The part under the header: the tab shown, as its tab panel. */
function FrameBody<T extends string>({
  bodyId,
  tabs,
  tab,
  children,
}: FrameBodyProps<T>) {
  const tabbed = tabs.length > 1 && tab !== undefined
  return (
    <div
      id={bodyId}
      className="dock-frame__body"
      role={tabbed ? 'tabpanel' : undefined}
      aria-labelledby={tabbed ? tabId(bodyId, tab) : undefined}
    >
      {children}
    </div>
  )
}

export interface DockPanelProps<T extends string> {
  readonly dialogRef: RefObject<HTMLDialogElement | null>
  /** The panel's own class, `manage` say, for its styles. */
  readonly className: string
  readonly title: string
  readonly tabs?: readonly FrameTab<T>[]
  readonly tab?: T
  readonly onTab?: (tab: T) => boolean | void
  /** The dialog's `cancel`: Escape is closing it. */
  readonly onCancel?: () => void
  /** The dialog's `close`: the store's `closePanel`. */
  readonly onClose: () => void
  /** « ✕ »: closes the dialog, as the panel's own « Fermer » did. */
  readonly onDismiss: () => void
  /**
   * What gets the presses on the backdrop, with the pointer shown where it
   * is over something there: the city, for « Ville ». None by default.
   */
  readonly backdrop?: BackdropPicks
  /** The dialog's own style, such as the custom properties its CSS reads. */
  readonly style?: CSSProperties
  readonly children: ReactNode
}

/**
 * A panel of the dock, where the player changes a decision: a modal dialog
 * anchored above the dock, which the store keeps the game paused under.
 * The page behind it is out of reach, and « ✕ » or Escape closes it. The
 * caller opens the dialog with `showModal()`, as `useFieldDialog` does.
 * With `backdrop`, a primary press on the backdrop goes to it instead,
 * without moving the focus.
 */
export function DockPanel<T extends string>({
  dialogRef,
  className,
  title,
  tabs = [],
  tab,
  onTab,
  onCancel,
  onClose,
  onDismiss,
  backdrop,
  style,
  children,
}: DockPanelProps<T>) {
  const titleId = useId()
  const bodyId = useId()
  const onBackdrop = (event: ReactPointerEvent<HTMLDialogElement>) => {
    const dialog = event.currentTarget
    return backdropPoint(event, dialog, dialog.getBoundingClientRect())
  }
  return (
    <dialog
      ref={dialogRef}
      className={`panel dock-frame dock-panel ${className}`}
      aria-labelledby={titleId}
      style={style}
      onCancel={onCancel}
      onClose={onClose}
      onPointerDown={
        backdrop &&
        ((event) => {
          if (event.button !== 0 || !event.isPrimary) return
          const point = onBackdrop(event)
          if (point === null) return
          // No mouse events follow, so the focus stays where the press
          // leaves it, as on the card it brings into view.
          event.preventDefault()
          backdrop.at(point)
        })
      }
      onPointerMove={
        backdrop &&
        ((event) => {
          const point = onBackdrop(event)
          event.currentTarget.classList.toggle(
            'dock-panel--pointing',
            point !== null && backdrop.over(point),
          )
        })
      }
    >
      <FrameHeader
        titleId={titleId}
        title={title}
        tabs={tabs}
        tab={tab}
        onTab={onTab}
        bodyId={bodyId}
        onDismiss={onDismiss}
      />
      <FrameBody bodyId={bodyId} tabs={tabs} tab={tab}>
        {children}
      </FrameBody>
    </dialog>
  )
}

export interface DockDrawerProps<T extends string> {
  /** Whether it shows; it stays on the page, hidden, once closed. */
  readonly open: boolean
  /** The drawer's own class, `finances-drawer` say. */
  readonly className: string
  readonly title: string
  readonly tabs: readonly FrameTab<T>[]
  readonly tab: T
  readonly onTab: (tab: T) => void
  /** « ✕ » and Escape. */
  readonly onClose: () => void
  /** Whether a panel is open over it, which then hears Escape instead. */
  readonly panelOpen: () => boolean
  /** Where the focus goes when it closes with the focus in it. */
  readonly returnFocus: () => HTMLElement | null
  readonly children: ReactNode
}

/**
 * A drawer of the dock, which only reads the game: in the panels' place
 * above the dock, but not modal, so the game runs on, Space pauses it and
 * the dock's keys work from inside it. As it opens, the focus goes to its
 * tab or its « ✕ »; as it closes with the focus in it, to `returnFocus()`.
 * Escape closes it, unless a tooltip took the Escape first or a panel is
 * open over it, and goes no further, so the street's customer card stays.
 * It stays on the page once closed, hidden, so its tab keeps what the
 * player picked in it, such as a statement and its period.
 */
export function DockDrawer<T extends string>({
  open,
  className,
  title,
  tabs,
  tab,
  onTab,
  onClose,
  panelOpen,
  returnFocus,
  children,
}: DockDrawerProps<T>) {
  const titleId = useId()
  const bodyId = useId()
  const ref = useRef<HTMLElement>(null)
  // Whether the focus is in the drawer, kept as it moves rather than read
  // once the drawer hides, by which time the browser may have dropped it.
  const focused = useRef(false)
  const wasOpen = useRef(false)

  useLayoutEffect(() => {
    const drawer = ref.current
    if (drawer === null || open === wasOpen.current) return
    wasOpen.current = open
    if (open) {
      drawer
        .querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
        ?.focus()
      if (!drawer.contains(document.activeElement)) {
        drawer.querySelector<HTMLElement>('.dock-frame__close')?.focus()
      }
    } else if (focused.current) {
      focused.current = false
      returnFocus()?.focus()
    }
  }, [open, returnFocus])

  // In the capture phase on the document: after the tooltip's, on the
  // window, which stops the first Escape when it closes, and before the
  // street's, which would close the customer card with the same key.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!drawerEscape(event, panelOpen())) return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, onClose, panelOpen])

  return (
    <section
      ref={ref}
      className={`dock-frame dock-drawer ${className}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      hidden={!open}
      onFocus={() => {
        focused.current = true
      }}
      onBlur={(event) => {
        const next = event.relatedTarget
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
          focused.current = false
        }
      }}
    >
      <FrameHeader
        titleId={titleId}
        title={title}
        tabs={tabs}
        tab={tab}
        onTab={onTab}
        bodyId={bodyId}
        onDismiss={onClose}
      />
      <FrameBody bodyId={bodyId} tabs={tabs} tab={tab}>
        {children}
      </FrameBody>
    </section>
  )
}
