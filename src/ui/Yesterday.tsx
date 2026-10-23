import { FOLD_KEY } from './foldShortcut.ts'
import { formatBriefMoney, formatCount } from './formatMoney.ts'
import { useGame } from './store.ts'
import {
  todayNumbers,
  truckWithout,
  type TodayNumbers,
} from './todayNumbers.ts'
import Tooltip from './Tooltip.tsx'
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
        <span className="yesterday__title">Hier</span>
        <span className="yesterday__row">
          <span>Ventes</span>
          <strong>
            {numbers === null ? NO_NUMBER : formatBriefMoney(numbers.revenue)}
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
            lost > 0 ? 'yesterday__row yesterday__row--warn' : 'yesterday__row'
          }
        >
          <span>Ventes perdues</span>
          <strong>
            {lost > 0 && <span aria-hidden="true">⚠︎ </span>}
            {numbers === null ? NO_NUMBER : formatCount(numbers.lostSales)}
          </strong>
        </span>
        {note !== null && <span className="yesterday__note">{note}</span>}
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

/** « Hier » with the app store's last day; a click opens « Camion » on « Menu ». */
export default function Yesterday(
  props: Omit<YesterdayViewProps, 'numbers' | 'note' | 'onOpen'>,
) {
  const lastDay = useGame((state) => state.game.lastDay)
  const staff = useGame((state) => state.game.staff)
  const openPanel = useGame((state) => state.openPanel)
  return (
    <YesterdayView
      {...props}
      numbers={lastDay === null ? null : todayNumbers(lastDay)}
      note={lastDay === null ? null : truckWithout(lastDay, staff)}
      onOpen={() => openPanel('manage', 'menu')}
    />
  )
}
