import { useEffect, useMemo } from 'react'
import pacing from '../content/pacing.json'
import type { Avatar } from '../content/schema.ts'
import type { Cents } from '../engine/money.ts'
import type { Day } from '../engine/types.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance } from '../finance/journal.ts'
import { CashGaugeView } from './CashGauge.tsx'
import { EnergyGaugeView } from './EnergyGauge.tsx'
import EventCard from './EventCard.tsx'
import FinancesPanel from './FinancesPanel.tsx'
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
  /** The owner's energy this morning. */
  energy: number
  /** The owner's avatar, which the energy's word agrees with. */
  avatar: Avatar
  speed: number
  onSpeedChange: (speed: number) => void
  /** Opens the « Gérer le camion » panel. */
  onManage: () => void
  /** Opens the « Vos finances » panel. */
  onFinances: () => void
}

export function TopBarView({
  businessName,
  day,
  cash,
  energy,
  avatar,
  speed,
  onSpeedChange,
  onManage,
  onFinances,
}: TopBarViewProps) {
  return (
    <header className="top-bar">
      <div className="top-bar__title">
        <p className="top-bar__name">{businessName}</p>
        <p className="top-bar__date">{formatGameDate(day)}</p>
      </div>
      <div className="top-bar__gauges">
        <CashGaugeView cash={cash} />
        <EnergyGaugeView energy={energy} avatar={avatar} />
      </div>
      <div className="top-bar__panels">
        <button
          type="button"
          className="top-bar__panel"
          aria-haspopup="dialog"
          onClick={onManage}
        >
          Gérer le camion
        </button>
        <button
          type="button"
          className="top-bar__panel"
          aria-haspopup="dialog"
          onClick={onFinances}
        >
          Vos finances
        </button>
      </div>
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
 * panel open: one it opened, or the event card.
 */
export default function TopBar() {
  const businessName = useGame((state) => state.game.profile.businessName)
  const avatar = useGame((state) => state.game.profile.avatar)
  const day = useGame((state) => state.game.day)
  const journal = useGame((state) => state.game.journal)
  const energy = useGame((state) => state.game.energy)
  const speed = useGame((state) => state.speed)
  const setSpeed = useGame((state) => state.setSpeed)
  const togglePause = useGame((state) => state.togglePause)
  const panel = useGame((state) => state.panel)
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
        energy={energy}
        avatar={avatar}
        speed={speed}
        onSpeedChange={setSpeed}
        onManage={() => openPanel('manage')}
        onFinances={() => openPanel('finances')}
      />
      {panel === 'manage' && <ManagePanel />}
      {panel === 'finances' && <FinancesPanel />}
      {panel === 'event' && <EventCard />}
    </>
  )
}
