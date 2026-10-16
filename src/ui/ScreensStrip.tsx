import type { Ref } from 'react'
import { FOLD_KEY } from './foldShortcut.ts'
import { formatMoney } from './formatMoney.ts'
import { useGame } from './store.ts'
import { todayNumbers, type TodayNumbers } from './todayNumbers.ts'

// Each number before the first day is over.
const NO_NUMBER = '—'

interface ScreensStripProps {
  /** The name of the screen open under the strip, « Aujourd'hui » say. */
  screen: string
  /** Unfolds the screens. */
  onUnfold: () => void
  /** The strip itself, so the focus can move to it once it shows. */
  buttonRef?: Ref<HTMLButtonElement>
}

interface ScreensStripViewProps extends ScreensStripProps {
  /** The last day's numbers; null before the first day is over. */
  numbers: TodayNumbers | null
}

/**
 * The screens folded away: one button that unfolds them, with the name of
 * the screen open and the last day's « Chiffre d'affaires », « Clients
 * servis » and « Ventes perdues », the numbers the Aujourd'hui panel shows.
 */
export function ScreensStripView({
  screen,
  numbers,
  onUnfold,
  buttonRef,
}: ScreensStripViewProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className="screens-strip"
      aria-expanded={false}
      aria-keyshortcuts={FOLD_KEY}
      title={`Déplier le panneau (touche ${FOLD_KEY})`}
      onClick={onUnfold}
    >
      <span className="screens-strip__screen">{screen}</span>
      <span className="screens-strip__number">
        Chiffre d'affaires&nbsp;:{' '}
        <strong>
          {numbers === null ? NO_NUMBER : formatMoney(numbers.revenue)}
        </strong>
      </span>
      <span className="screens-strip__number">
        Clients servis&nbsp;:{' '}
        <strong>{numbers?.customersServed ?? NO_NUMBER}</strong>
      </span>
      <span className="screens-strip__number">
        Ventes perdues&nbsp;: <strong>{numbers?.lostSales ?? NO_NUMBER}</strong>
      </span>
      <span className="screens-strip__unfold">
        Déplier<span aria-hidden="true"> ▸</span>
      </span>
    </button>
  )
}

/** The strip with the app store's last day. */
export default function ScreensStrip(props: ScreensStripProps) {
  const lastDay = useGame((state) => state.game.lastDay)
  return (
    <ScreensStripView
      {...props}
      numbers={lastDay === null ? null : todayNumbers(lastDay)}
    />
  )
}
