import { useEffect, useMemo } from 'react'
import pacing from '../content/pacing.json'
import type { Avatar } from '../content/schema.ts'
import { defiById } from '../engine/challenge.ts'
import { DEFIS } from '../engine/day.ts'
import type { Cents } from '../engine/money.ts'
import type { Day } from '../engine/types.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance } from '../finance/journal.ts'
import { CashGaugeView } from './CashGauge.tsx'
import { monthlyFixedCosts } from './cashLevel.ts'
import DefiPanel from './DefiPanel.tsx'
import { chipLabel, energyFloorLine } from './defis.ts'
import { EnergyGaugeView } from './EnergyGauge.tsx'
import EventCard from './EventCard.tsx'
import FinancesPanel from './FinancesPanel.tsx'
import { formatGameDate } from './formatGameDate.ts'
import ManagePanel from './ManagePanel.tsx'
import { blockSpaceClick, handlePauseKey } from './pauseShortcut.ts'
import { NORMAL_SPEED, PAUSED, useGame } from './store.ts'
import WeeklyReportPanel from './WeeklyReport.tsx'
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
  /** What the next 1st of the month takes from the encaisse. */
  fixedCosts: Cents
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
  /** The chip of the Défi played, « Défi · semaine 2 de 3 »; null if none. */
  defiLabel: string | null
  /**
   * The owner's energy against the Défi's floor, on a line of its own in
   * the chip: « Énergie : 52 (plancher : 33) »; null if the Défi sets none.
   */
  defiEnergy: string | null
  /** Opens the Défi's panel. */
  onDefi: () => void
}

export function TopBarView({
  businessName,
  day,
  cash,
  fixedCosts,
  energy,
  avatar,
  speed,
  onSpeedChange,
  onManage,
  onFinances,
  defiLabel,
  defiEnergy,
  onDefi,
}: TopBarViewProps) {
  return (
    <header className="top-bar">
      <div className="top-bar__title">
        <p className="top-bar__name">{businessName}</p>
        <p className="top-bar__date">{formatGameDate(day)}</p>
        {defiLabel !== null && (
          <button
            type="button"
            className={
              defiEnergy === null
                ? 'top-bar__defi'
                : 'top-bar__defi top-bar__defi--energy'
            }
            aria-haspopup="dialog"
            onClick={onDefi}
          >
            {defiLabel}
            {defiEnergy !== null && (
              <>
                {' '}
                <span className="top-bar__defi-energy">{defiEnergy}</span>
              </>
            )}
          </button>
        )}
      </div>
      <div className="top-bar__gauges">
        <CashGaugeView cash={cash} fixedCosts={fixedCosts} />
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
 * panel open: one it opened, the event card or the weekly report. In a
 * Défi, the chip under the date opens the Défi's panel.
 */
export default function TopBar() {
  const businessName = useGame((state) => state.game.profile.businessName)
  const avatar = useGame((state) => state.game.profile.avatar)
  const difficulty = useGame((state) => state.game.profile.difficulty)
  const day = useGame((state) => state.game.day)
  const journal = useGame((state) => state.game.journal)
  const energy = useGame((state) => state.game.energy)
  const challenge = useGame((state) => state.game.challenge)
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
  // A Défi's truck came on its first day, from which its loan counts.
  const firstDay = challenge?.startDay ?? 0
  const fixedCosts = useMemo(
    () => monthlyFixedCosts(day, difficulty, firstDay),
    [day, difficulty, firstDay],
  )
  const defi = challenge === null ? null : defiById(DEFIS, challenge.id)
  const defiLabel =
    challenge === null || defi === null ? null : chipLabel(challenge, defi, day)
  const defiEnergy = defi === null ? null : energyFloorLine(energy, defi)

  return (
    <>
      <TopBarView
        businessName={businessName}
        day={day}
        cash={cash}
        fixedCosts={fixedCosts}
        energy={energy}
        avatar={avatar}
        speed={speed}
        onSpeedChange={setSpeed}
        onManage={() => openPanel('manage')}
        onFinances={() => openPanel('finances')}
        defiLabel={defiLabel}
        defiEnergy={defiEnergy}
        onDefi={() => openPanel('defi')}
      />
      {panel === 'manage' && <ManagePanel />}
      {panel === 'finances' && <FinancesPanel />}
      {panel === 'defi' && <DefiPanel />}
      {panel === 'event' && <EventCard />}
      {panel === 'report' && <WeeklyReportPanel />}
    </>
  )
}
