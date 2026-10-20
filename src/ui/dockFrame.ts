import { useEffect, type RefObject } from 'react'
import type { Ladder } from '../content/schema.ts'
import type { CityTab, FinancesTab, JournalTab, TruckTab } from './store.ts'
import { isInside } from './pauseShortcut.ts'

// The frame of the dock's panels and drawers (DockFrame.tsx): its tabs, its
// Escape, and the tabs of each panel and drawer with some.

/** A tab of a panel or a drawer: its id and the word on its pill. */
export interface FrameTab<T extends string> {
  readonly id: T
  readonly label: string
}

/** The id of the pill of `tab` in the frame whose part is `bodyId`. */
export function tabId(bodyId: string, tab: string): string {
  return `${bodyId}-tab-${tab}`
}

/**
 * The tabs of « Le camion »: what it sells and at what price, how much it
 * orders, when it opens, the owner's pay and the marketing, and the bakery.
 */
export const TRUCK_TABS: readonly FrameTab<TruckTab>[] = [
  { id: 'menu', label: 'Menu' },
  { id: 'stocks', label: 'Stocks' },
  { id: 'schedule', label: 'Horaire' },
  { id: 'payMarketing', label: 'Salaire et marketing' },
  { id: 'bakery', label: 'Fournil' },
]

/** The tabs of « Ville »: where the owner goes, and whom they deliver to. */
export const CITY_TABS: readonly FrameTab<CityTab>[] = [
  { id: 'trip', label: 'Aller à…' },
  { id: 'contracts', label: 'Contrats' },
]

/**
 * The tabs of « Finances »: the company's money and the owner's own; in a
 * Défi, where « Ville » is hidden, « Contrats » too, so the grocers'
 * numbers stay one click away.
 */
export function financesTabs(
  inChallenge: boolean,
): readonly FrameTab<FinancesTab>[] {
  const tabs: FrameTab<FinancesTab>[] = [
    { id: 'company', label: 'Entreprise' },
    { id: 'personal', label: 'Personnel' },
  ]
  if (inChallenge) tabs.push({ id: 'contracts', label: 'Contrats' })
  return tabs
}

/** The tabs of « Améliorations »: the owner's ladder and the company's. */
export const DREAM_TABS: readonly FrameTab<Ladder>[] = [
  { id: 'personal', label: 'Vie personnelle' },
  { id: 'company', label: 'Entreprise' },
]

export const JOURNAL_TABS: readonly FrameTab<JournalTab>[] = [
  { id: 'events', label: 'Événements' },
  { id: 'reports', label: 'Bilans' },
]

/**
 * Opens `dialogRef`'s dialog as a modal once it is on the page, for a panel
 * without decision fields (see `useFieldDialog` for those).
 */
export function useModal(dialogRef: RefObject<HTMLDialogElement | null>) {
  useEffect(() => {
    const dialog = dialogRef.current
    // StrictMode runs this twice; the second time, the dialog is open.
    if (dialog !== null && !dialog.open) dialog.showModal()
  }, [dialogRef])
}

/**
 * The tab the key `key` moves to from `current` in a tab list: the next or
 * the one before with the arrows, going round, the first with Home and the
 * last with End; null for any other key.
 */
export function nextTab<T>(
  tabs: readonly T[],
  current: T,
  key: string,
): T | null {
  const at = tabs.indexOf(current)
  if (at < 0 || tabs.length === 0) return null
  switch (key) {
    case 'ArrowRight':
      return tabs[(at + 1) % tabs.length] ?? null
    case 'ArrowLeft':
      return tabs[(at - 1 + tabs.length) % tabs.length] ?? null
    case 'Home':
      return tabs[0] ?? null
    case 'End':
      return tabs[tabs.length - 1] ?? null
    default:
      return null
  }
}

/** A point on the page, in CSS pixels from the window's top left. */
export interface PagePoint {
  readonly x: number
  readonly y: number
}

/**
 * What a panel's backdrop hands its presses to, as « Ville » hands them to
 * the city drawn behind it: `at` for a press, `over` for whether the
 * pointer shows over what is there.
 */
export interface BackdropPicks {
  readonly at: (point: PagePoint) => void
  readonly over: (point: PagePoint) => boolean
}

/** The parts of a PointerEvent `backdropPoint` reads. */
export interface PointerLike {
  readonly target: unknown
  readonly clientX: number
  readonly clientY: number
}

/** The box of an element on the page, as `getBoundingClientRect` gives it. */
export interface PageBox {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/**
 * Where `event` lands on the backdrop of the modal `dialog`: the point,
 * when it lands on the dialog itself, as the browser reports a press on
 * the backdrop, and outside `box`, the dialog's own box; null when it
 * lands in the dialog.
 */
export function backdropPoint(
  event: PointerLike,
  dialog: unknown,
  box: PageBox,
): PagePoint | null {
  if (event.target !== dialog) return null
  const x = event.clientX
  const y = event.clientY
  const inside =
    x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
  return inside ? null : { x, y }
}

/** The parts of a KeyboardEvent the drawer's Escape reads. */
export interface EscapeLike {
  readonly key: string
  readonly defaultPrevented: boolean
  readonly target: unknown
}

/**
 * Whether `event` is an Escape the open drawer should close on: not one a
 * tooltip already took, nor one for a panel open over it (`panelOpen`) or
 * inside any dialog element, such as the event card, which closes itself.
 */
export function drawerEscape(event: EscapeLike, panelOpen: boolean): boolean {
  return (
    event.key === 'Escape' &&
    !event.defaultPrevented &&
    !panelOpen &&
    !isInside(event.target, 'dialog')
  )
}
