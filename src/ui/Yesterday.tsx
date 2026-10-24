import { FOLD_KEY } from './foldShortcut.ts'
import { formatBriefMoney, formatCount } from './formatMoney.ts'
import { useGame } from './store.ts'
import type { TodayNumbers } from './todayNumbers.ts'
import Tooltip from './Tooltip.tsx'
import { useShownTruck } from './trucks.ts'
import { yesterdayCard, type OtherTruckLine } from './truckViews.ts'
import './Yesterday.css'

// Each number before the first day is over.
const NO_NUMBER = '—'

interface YesterdayViewProps {
  /** The last day's numbers; null before the first day is over. */
  numbers: TodayNumbers | null
  /**
   * A fact about the last day, under its numbers: who kept the truck open
   * with the owner away (see `truckWithout`); null on any other day.
   */
  note?: string | null
  /** Its title: « Hier », or « Hier · Vieux-Montréal » with two trucks. */
  title?: string
  /**
   * Why the truck shown sold nothing, in place of its numbers: « Fermé
   * pour l'hiver » or « Fermé »; null when it opened (see `closedText`).
   */
  closed?: string | null
  /** One line per other truck, under a thin line: its sales, or « fermé ». */
  others?: readonly OtherTruckLine[]
  /** Whether the card is hidden, down to its « Hier » pill. */
  folded: boolean
  /** Hides the card (true) or shows it again (false). */
  onFoldChange: (folded: boolean) => void
  /** Opens « Camion ». */
  onOpen: () => void
}

/**
 * « Hier », the small card at the bottom right: the last day's « Ventes »,
 * « Clients servis » and « Ventes perdues », those in amber with ⚠︎ when
 * above zero, and a fact about the day when there is one (`note`). A click opens « Camion »; its corner button, or R, hides it
 * down to an « Hier » pill that shows it again.
 */
export function YesterdayView({
  numbers,
  note = null,
  title = 'Hier',
  closed = null,
  others = [],
  folded,
  onFoldChange,
  onOpen,
}: YesterdayViewProps) {
  if (folded) {
    return (
      <Tooltip
        content={{ title: 'Afficher « Hier »', text: `Touche ${FOLD_KEY}` }}
        width={180}
      >
        {(anchor) => (
          <button
            type="button"
            className="yesterday-pill"
            data-tuto="yesterday.pill"
            aria-expanded={false}
            aria-keyshortcuts={FOLD_KEY}
            {...anchor}
            onClick={() => onFoldChange(false)}
          >
            Hier
          </button>
        )}
      </Tooltip>
    )
  }
  const lost = numbers?.lostSales ?? 0
  return (
    <section className="yesterday" aria-label="Hier">
      <button
        type="button"
        className="yesterday__open"
        data-tuto="yesterday"
        onClick={onOpen}
      >
        <span className="yesterday__title">{title}</span>
        {closed !== null ? (
          <span className="yesterday__closed">{closed}</span>
        ) : (
          <>
            <span className="yesterday__row">
              <span>Ventes</span>
              <strong>
                {numbers === null
                  ? NO_NUMBER
                  : formatBriefMoney(numbers.revenue)}
              </strong>
            </span>
            <span className="yesterday__row">
              <span>Clients servis</span>
              <strong>
                {numbers === null
                  ? NO_NUMBER
                  : formatCount(numbers.customersServed)}
              </strong>
            </span>
            <span
              className={
                lost > 0
                  ? 'yesterday__row yesterday__row--warn'
                  : 'yesterday__row'
              }
            >
              <span>Ventes perdues</span>
              <strong>
                {lost > 0 && <span aria-hidden="true">⚠︎ </span>}
                {numbers === null ? NO_NUMBER : formatCount(numbers.lostSales)}
              </strong>
            </span>
          </>
        )}
        {note !== null && <span className="yesterday__note">{note}</span>}
        {others.map(({ id, name, value }, index) => (
          <span
            key={id}
            className={
              index === 0
                ? 'yesterday__row yesterday__row--other yesterday__row--divider'
                : 'yesterday__row yesterday__row--other'
            }
          >
            <span>{name}</span>
            <strong>{value}</strong>
          </span>
        ))}
      </button>
      <Tooltip
        content={{ title: 'Masquer « Hier »', text: `Touche ${FOLD_KEY}` }}
        width={180}
      >
        {(anchor) => (
          <button
            type="button"
            className="yesterday__fold"
            aria-label="Masquer « Hier »"
            aria-expanded={true}
            aria-keyshortcuts={FOLD_KEY}
            {...anchor}
            onClick={() => onFoldChange(true)}
          >
            <span aria-hidden="true">–</span>
          </button>
        )}
      </Tooltip>
    </section>
  )
}

/**
 * « Hier » with the app store's game and the truck shown; a click opens
 * « Camion » on « Menu ».
 */
export default function Yesterday(
  props: Omit<
    YesterdayViewProps,
    'numbers' | 'note' | 'title' | 'closed' | 'others' | 'onOpen'
  >,
) {
  const game = useGame((state) => state.game)
  const shown = useShownTruck(game)
  const openPanel = useGame((state) => state.openPanel)
  const card = yesterdayCard(game, shown)
  return (
    <YesterdayView
      {...props}
      {...card}
      onOpen={() => openPanel('manage', 'menu')}
    />
  )
}
