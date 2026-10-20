import { useMemo } from 'react'
import { balance } from '../finance/journal.ts'
import {
  activateDockItem,
  dockBadges,
  dockButtonId,
  dockItems,
  isDockItemOpen,
  type DockBadges,
  type DockItem,
} from './dock.ts'
import { Icon } from './icons.tsx'
import { gameStore, useGame } from './store.ts'
import Tooltip from './Tooltip.tsx'
import './Dock.css'

interface DockViewProps {
  readonly items: readonly DockItem[]
  /** Whether what each button opens is open. */
  readonly isOpen: (item: DockItem) => boolean
  readonly badges: DockBadges
  readonly onActivate: (item: DockItem) => void
}

/**
 * The dock, bottom centre over the street: a square button with an icon and
 * a word under it for each panel and drawer, the open one in ink, a divider
 * before « Journal », and a red count on a button when something waits
 * there. Each button's tooltip names its key.
 */
export function DockView({ items, isOpen, badges, onActivate }: DockViewProps) {
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
              >
                {(anchor) => (
                  <button
                    type="button"
                    id={dockButtonId(item.id)}
                    className={
                      open ? 'dock__button dock__button--open' : 'dock__button'
                    }
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

/** The dock wired to the app store. */
export default function Dock() {
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
      onActivate={(item) => activateDockItem(gameStore, item)}
    />
  )
}
