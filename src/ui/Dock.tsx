import { useMemo } from 'react'
import { useStore } from 'zustand'
import { balance } from '../finance/journal.ts'
import {
  activateDockItem,
  dockBadges,
  dockButtonId,
  dockItems,
  isDockItemOpen,
  type DockBadges,
  type DockItem,
  type DockItemId,
} from './dock.ts'
import { Icon } from './icons.tsx'
import { messageStack, type MessageStack } from './messageStack.ts'
import { gameStore, useGame } from './store.ts'
import Tooltip from './Tooltip.tsx'
import './Dock.css'

interface DockViewProps {
  readonly items: readonly DockItem[]
  /** Whether what each button opens is open. */
  readonly isOpen: (item: DockItem) => boolean
  readonly badges: DockBadges
  /** The buttons a postcard of Réal's points at, which pulse; none by default. */
  readonly pulses?: readonly DockItemId[]
  readonly onActivate: (item: DockItem) => void
}

/**
 * The dock, bottom centre over the street: a square button with an icon and
 * a word under it for each panel and drawer, the open one in ink, a divider
 * before « Journal », a red count on a button when something waits
 * there, and a soft pulse on one a postcard points at. Each button's
 * tooltip names its key.
 */
export function DockView({
  items,
  isOpen,
  badges,
  pulses = [],
  onActivate,
}: DockViewProps) {
  return (
    <nav className="dock" aria-label="Panneaux">
      <ul className="dock__items">
        {items.map((item) => {
          const open = isOpen(item)
          const count = badges[item.id] ?? 0
          return (
            <li
              key={item.id}
              className={
                item.divided ? 'dock__item dock__item--divided' : 'dock__item'
              }
            >
              <Tooltip
                content={{
                  title: item.label,
                  ...(item.key === null ? {} : { text: `Touche ${item.key}` }),
                }}
                width={160}
                prefer="above"
              >
                {(anchor) => (
                  <button
                    type="button"
                    id={dockButtonId(item.id)}
                    data-tuto={`dock.${item.id}`}
                    className={[
                      'dock__button',
                      ...(open ? ['dock__button--open'] : []),
                      ...(pulses.includes(item.id)
                        ? ['dock__button--pulse']
                        : []),
                    ].join(' ')}
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    aria-keyshortcuts={item.key ?? undefined}
                    {...anchor}
                    onClick={() => onActivate(item)}
                  >
                    <span className="dock__tile">
                      <Icon name={item.icon} size={28} strokeWidth={2.2} />
                      {count > 0 && (
                        <span className="dock__badge">
                          {count}
                          <span className="visually-hidden"> en attente</span>
                        </span>
                      )}
                    </span>
                    <span className="dock__label">{item.label}</span>
                  </button>
                )}
              </Tooltip>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

// The encaisse is account 1000 (src/finance/accounts.ts).
const CASH = '1000'

/**
 * The dock wired to the app store, its buttons pulsing as the postcards in
 * `stack` ask (see `startMessageStack`, which stops each pulse).
 */
export default function Dock({
  stack = messageStack,
}: {
  stack?: MessageStack
}) {
  const pulses = useStore(stack, (state) => state.pulsing)
  const challenge = useGame((state) => state.game.challenge)
  const panel = useGame((state) => state.panel)
  const drawer = useGame((state) => state.drawer)
  const unreadReports = useGame((state) => state.unreadReports)
  const journal = useGame((state) => state.game.journal)
  const day = useGame((state) => state.game.day)
  const personal = useGame((state) => state.game.personal)
  const lastPlayed = useGame((state) => state.game.lastDay?.day ?? null)
  const items = dockItems(challenge !== null)
  const badges = useMemo(
    () =>
      dockBadges({
        unreadReports,
        cash: balance(journal, CASH, { toDay: day }),
        personal,
        lastPlayed,
      }),
    [unreadReports, journal, day, personal, lastPlayed],
  )
  return (
    <DockView
      items={items}
      isOpen={(item) => isDockItemOpen(item, { panel, drawer })}
      badges={badges}
      pulses={pulses}
      onActivate={(item) => activateDockItem(gameStore, item)}
    />
  )
}
