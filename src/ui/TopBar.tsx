import { useEffect, useMemo } from 'react'
import pacing from '../content/pacing.json'
import type { Cents } from '../engine/money.ts'
import type { Day } from '../engine/types.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance } from '../finance/journal.ts'
import { CashGaugeView } from './CashGauge.tsx'
import { formatGameDate } from './formatGameDate.ts'
import ManagePanel from './ManagePanel.tsx'
import { blockSpaceClick, handlePauseKey } from './pauseShortcut.ts'
import { NORMAL_SPEED, PAUSED, useGame } from './store.ts'
import './TopBar.css'

function speedLabel(speed: number): string {
  if (speed === PAUSED) return 'Pause'
  if (speed === NORMAL_SPEED) return 'Vitesse normale'
  return `Vitesse ×${speed}`
}

// U+FE0E asks for the text form of ⏸ rather than a colour emoji.
function speedText(speed: number): string {
  return speed === PAUSED ? '⏸︎' : `×${speed}`
}

const CASH = '1000' satisfies AccountCode

interface TopBarViewProps {
  /** The business's name, from the player's profile. */
  businessName: string
  day: Day
  /** The encaisse after every entry posted so far. */
  cash: Cents
  speed: number
  onSpeedChange: (speed: number) => void
  /** Opens the « Gérer le camion » panel. */
  onManage: () => void
}

export function TopBarView({
  businessName,
  day,
  cash,
  speed,
  onSpeedChange,
  onManage,
}: TopBarViewProps) {
  return (
    <header className="top-bar">
      <div className="top-bar__title">
        <p className="top-bar__name">{businessName}</p>
        <p className="top-bar__date">{formatGameDate(day)}</p>
      </div>
      <CashGaugeView cash={cash} />
      <button
        type="button"
        className="top-bar__manage"
        aria-haspopup="dialog"
        onClick={onManage}
      >
        Gérer le camion
      </button>
      <div className="top-bar__speeds" role="group" aria-label="Vitesse du jeu">
        {pacing.speeds.map((option) => (
          <button
            key={option}
            type="button"
            className="top-bar__speed"
            aria-label={speedLabel(option)}
            aria-pressed={option === speed}
            onClick={() => onSpeedChange(option)}
          >
            {speedText(option)}
          </button>
        ))}
      </div>
    </header>
  )
}

/**
 * The top bar wired to the app store, with the Space shortcut, and the
 * « Gérer le camion » panel while it is open.
 */
export default function TopBar() {
  const businessName = useGame((state) => state.game.profile.businessName)
  const day = useGame((state) => state.game.day)
  const journal = useGame((state) => state.game.journal)
  const speed = useGame((state) => state.speed)
  const setSpeed = useGame((state) => state.setSpeed)
  const togglePause = useGame((state) => state.togglePause)
  const panelOpen = useGame((state) => state.resumeSpeed !== null)
  const openPanel = useGame((state) => state.openPanel)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) =>
      handlePauseKey(event, togglePause)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', blockSpaceClick)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', blockSpaceClick)
    }
  }, [togglePause])

  // The books only change when a day is played, not on every frame.
  const cash = useMemo(
    () => balance(journal, CASH, { toDay: day }),
    [journal, day],
  )

  return (
    <>
      <TopBarView
        businessName={businessName}
        day={day}
        cash={cash}
        speed={speed}
        onSpeedChange={setSpeed}
        onManage={openPanel}
      />
      {panelOpen && <ManagePanel />}
    </>
  )
}
