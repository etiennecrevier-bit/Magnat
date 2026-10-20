import type { Cents } from '../engine/money.ts'
import type { Day, PersonalAccount } from '../engine/types.ts'
import type { IconName } from './icons.tsx'
import { isEditable, isInside, type KeyEventLike } from './pauseShortcut.ts'
import { monthMovements } from './personalFinances.ts'
import type { Drawer, GameStore, GameStoreState, Panel } from './store.ts'

// The dock (#202): what each of its buttons opens, its key, which ones a
// Défi hides and the counts on them.

export type DockItemId =
  | 'camion'
  | 'equipe'
  | 'ville'
  | 'finances'
  | 'ameliorations'
  | 'journal'
  | 'reglages'

/** What a button opens: a panel, which pauses, or a drawer, which does not. */
export type DockTarget =
  | {
      readonly kind: 'panel'
      readonly panel: Extract<
        Panel,
        'manage' | 'staff' | 'trip' | 'dream' | 'settings'
      >
    }
  | { readonly kind: 'drawer'; readonly drawer: Drawer }

export interface DockItem {
  readonly id: DockItemId
  /** The word under the icon. */
  readonly label: string
  readonly icon: IconName
  /** The key that opens it, in upper case; null for none. */
  readonly key: string | null
  readonly target: DockTarget
  /** Whether a divider comes before it. */
  readonly divided: boolean
  /** Whether a Défi hides it, as it hid « Le rêve » and « Aller à… ». */
  readonly hiddenInChallenge: boolean
}

const panel = (to: Extract<DockTarget, { kind: 'panel' }>['panel']) =>
  ({ kind: 'panel', panel: to }) as const
const drawer = (to: Drawer) => ({ kind: 'drawer', drawer: to }) as const

/** Every button, in the dock's order. */
export const DOCK_ITEMS: readonly DockItem[] = [
  {
    id: 'camion',
    label: 'Camion',
    icon: 'camion',
    key: 'C',
    target: panel('manage'),
    divided: false,
    hiddenInChallenge: false,
  },
  {
    id: 'equipe',
    label: 'Équipe',
    icon: 'equipe',
    key: 'E',
    target: panel('staff'),
    divided: false,
    hiddenInChallenge: false,
  },
  {
    id: 'ville',
    label: 'Ville',
    icon: 'ville',
    key: 'V',
    target: panel('trip'),
    divided: false,
    hiddenInChallenge: true,
  },
  {
    id: 'finances',
    label: 'Finances',
    icon: 'finances',
    key: 'F',
    target: drawer('finances'),
    divided: false,
    hiddenInChallenge: false,
  },
  {
    id: 'ameliorations',
    label: 'Améliorations',
    icon: 'ameliorations',
    key: 'A',
    target: panel('dream'),
    divided: false,
    hiddenInChallenge: true,
  },
  {
    id: 'journal',
    label: 'Journal',
    icon: 'journal',
    key: 'J',
    target: drawer('journal'),
    divided: true,
    hiddenInChallenge: false,
  },
  {
    id: 'reglages',
    label: 'Réglages',
    icon: 'reglages',
    key: null,
    target: panel('settings'),
    divided: false,
    hiddenInChallenge: false,
  },
]

/** The id of the dock's button `id`, where a closing drawer sends the focus. */
export function dockButtonId(id: DockItemId): string {
  return `dock-${id}`
}

/** The buttons the dock shows: all but « Ville » and « Améliorations » in a Défi. */
export function dockItems(inChallenge: boolean): readonly DockItem[] {
  return inChallenge
    ? DOCK_ITEMS.filter(({ hiddenInChallenge }) => !hiddenInChallenge)
    : DOCK_ITEMS
}

/** Whether what `item` opens is open. */
export function isDockItemOpen(
  item: DockItem,
  { panel: open, drawer: drawerOpen }: Pick<GameStoreState, 'panel' | 'drawer'>,
): boolean {
  const { target } = item
  return target.kind === 'panel'
    ? open === target.panel
    : drawerOpen === target.drawer
}

/**
 * What a press on `item` does: opens its panel, which pauses, or its
 * drawer, which does not, or closes its drawer if it is open. Nothing while
 * a panel is open, as the panel keeps the game paused until it closes.
 */
export function activateDockItem(store: GameStore, item: DockItem): void {
  const state = store.getState()
  if (state.resumeSpeed !== null) return
  const { target } = item
  if (target.kind === 'panel') {
    state.openPanel(target.panel)
  } else if (state.drawer === target.drawer) {
    state.closeDrawer()
  } else {
    state.openDrawer(target.drawer)
  }
}

/** The counts the dock shows on its buttons; a button left out shows none. */
export type DockBadges = Partial<Record<DockItemId, number>>

/** What the dock's counts read. */
export interface BadgeFacts {
  /** The reports that only slid in since the player last opened one. */
  readonly unreadReports: number
  /** The encaisse now. */
  readonly cash: Cents
  /** The owner's personal account. */
  readonly personal: PersonalAccount
  /** The last day played; null before the first. */
  readonly lastPlayed: Day | null
}

/**
 * The counts on the dock: on « Journal » the reports not opened; on «
 * Finances » the owner's movements left unpaid in the month « Vos finances
 * » shows, and one more while the encaisse is below zero.
 */
export function dockBadges({
  unreadReports,
  cash,
  personal,
  lastPlayed,
}: BadgeFacts): DockBadges {
  const unpaid = monthMovements(personal, lastPlayed).filter(
    ({ unpaid: isUnpaid }) => isUnpaid,
  ).length
  const finances = unpaid + (cash < 0 ? 1 : 0)
  const badges: { -readonly [K in DockItemId]?: number } = {}
  if (unreadReports > 0) badges.journal = unreadReports
  if (finances > 0) badges.finances = finances
  return badges
}

/**
 * The button the key of `event` opens among `items`: C, E, V, F, A or J,
 * in either case, without a modifier, outside a text field and outside a
 * dialog element, as the panels and the event card are; null otherwise.
 */
export function dockKeyItem(
  event: KeyEventLike,
  items: readonly DockItem[],
): DockItem | null {
  if (
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    isEditable(event.target) ||
    isInside(event.target, 'dialog')
  ) {
    return null
  }
  const key = event.key.toUpperCase()
  return items.find((item) => item.key === key) ?? null
}

/**
 * `keydown` handler: the dock's keys (see `dockKeyItem`) do what a press on
 * their button does, with `activate`. Held down, a key does not again.
 */
export function handleDockKey(
  event: KeyEventLike,
  items: readonly DockItem[],
  activate: (item: DockItem) => void,
): void {
  const item = dockKeyItem(event, items)
  if (item === null) return
  event.preventDefault()
  if (!event.repeat) activate(item)
}
