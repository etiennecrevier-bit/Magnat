import { useEffect, useMemo, type ReactNode, type Ref } from 'react'
import { useStore } from 'zustand'
import pacing from '../content/pacing.json'
import type { Avatar } from '../content/schema.ts'
import { defiById } from '../engine/challenge.ts'
import { DEFIS } from '../engine/day.ts'
import { titleOf } from '../engine/dream.ts'
import type { Cents } from '../engine/money.ts'
import { netWorth as netWorthOf } from '../engine/netWorth.ts'
import type { Day } from '../engine/types.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance } from '../finance/journal.ts'
import {
  followAlert,
  missedThisWeek,
  topAlerts,
  type AlertId,
  type TopAlert,
} from './alerts.ts'
import { CashChipView } from './CashGauge.tsx'
import { cashAtCloses } from './cashHistory.ts'
import { nextFixedCosts } from './cashLevel.ts'
import { chipLabel, energyFloorLine } from './defis.ts'
import { EnergyGaugeView } from './EnergyGauge.tsx'
import { formatGameDate } from './formatGameDate.ts'
import { Icon } from './icons.tsx'
import { messageStack, type MessageStack } from './messageStack.ts'
import { blockSpaceClick, handlePauseKey } from './pauseShortcut.ts'
import { gameStore, NORMAL_SPEED, PAUSED, useGame } from './store.ts'
import { coachShowing } from './tutorialFlow.ts'
import { tutorialSignals } from './tutorialSignals.ts'
import { keepRoomUnder } from './tickerRoom.ts'
import { todayNumbers, type TodayNumbers } from './todayNumbers.ts'
import { enRouteLine } from './tripBoard.ts'
import { useMediaQuery } from './useMediaQuery.ts'
import './TopBar.css'

function speedLabel(speed: number): string {
  if (speed === PAUSED) return 'Pause'
  if (speed === NORMAL_SPEED) return 'Vitesse normale'
  return `Vitesse ×${speed}`
}

// Pause as two bars, drawn, since not every font has ⏸.
function speedText(speed: number): ReactNode {
  if (speed !== PAUSED) return `×${speed}`
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2" y="1" width="3.5" height="12" rx="1" fill="currentColor" />
      <rect x="8.5" y="1" width="3.5" height="12" rx="1" fill="currentColor" />
    </svg>
  )
}

const CASH = '1000' satisfies AccountCode

/** How many closes the cash chip's sparkline draws. */
export const CASH_HISTORY_DAYS = 30

/** Under this width, a phone's, « Hier » folds into the cash chip's tooltip. */
export const NARROW_QUERY = '(max-width: 699px)'

interface TopBarViewProps {
  /** The business's name, from the player's profile. */
  businessName: string
  day: Day
  /** The encaisse after every entry posted so far. */
  cash: Cents
  /** What the next 1st of the month takes from the encaisse. */
  fixedCosts: Cents
  /** The encaisse at each of the last closes, oldest first. */
  cashHistory?: readonly Cents[]
  /**
   * The last day's numbers in the cash chip's tooltip, as on a phone where
   * « Hier » folds into it; left out, they do not show there.
   */
  yesterday?: TodayNumbers | null
  /** Opens « Finances ». */
  onCash?: () => void
  /** The title the net worth earns of « Améliorations »; null shows none. */
  title?: string | null
  /** The owner's energy this morning. */
  energy: number
  /** The owner's avatar, which the energy's word agrees with. */
  avatar: Avatar
  speed: number
  onSpeedChange: (speed: number) => void
  /** « En route vers la Caisse » on a day with a trip; null shows none. */
  enRoute?: string | null
  /** The chip of the Défi played, « Défi · semaine 2 de 3 »; null if none. */
  defiLabel: string | null
  /**
   * The owner's energy against the Défi's floor, on a line of its own in
   * the chip: « Énergie : 52 (plancher : 33) »; null if the Défi sets none.
   */
  defiEnergy: string | null
  /** Opens the Défi's panel. */
  onDefi: () => void
  /** The chips at the right of the speeds: what waits for the player. */
  alerts?: readonly TopAlert[]
  onAlert?: (id: AlertId) => void
  /** Opens « Réglages ». */
  onSettings: () => void
  /** Takes the bar once it shows, to measure it. */
  barRef?: Ref<HTMLElement>
}

/**
 * The top bar, a few cards over the street. At the left: the business's
 * name, the date and the owner's title of « Améliorations »; the cash chip; the
 * energy. At the right: the street or the city, the speeds, the chips of
 * what waits, then the gear of « Réglages ».
 */
export function TopBarView({
  businessName,
  day,
  cash,
  fixedCosts,
  cashHistory = [],
  yesterday,
  onCash = () => {},
  title = null,
  energy,
  avatar,
  speed,
  onSpeedChange,
  enRoute = null,
  defiLabel,
  defiEnergy,
  onDefi,
  alerts = [],
  onAlert = () => {},
  onSettings,
  barRef,
}: TopBarViewProps) {
  return (
    <header ref={barRef} className="top-bar">
      <div className="top-bar__left">
        <div className="top-bar__title">
          <p className="top-bar__name">{businessName}</p>
          <p className="top-bar__date">{formatGameDate(day)}</p>
          {title !== null && <p className="top-bar__owner">{title}</p>}
          {enRoute !== null && <p className="top-bar__en-route">{enRoute}</p>}
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
        <CashChipView
          cash={cash}
          fixedCosts={fixedCosts}
          history={cashHistory}
          yesterday={yesterday}
          onOpen={onCash}
        />
        <div className="top-bar__energy">
          <Icon name="energie" size={18} />
          <EnergyGaugeView energy={energy} avatar={avatar} />
        </div>
      </div>
      <div className="top-bar__right">
        <div
          className="top-bar__speeds"
          role="group"
          aria-label="Vitesse du jeu"
        >
          {pacing.speeds.map((option) => (
            <button
              key={option}
              type="button"
              className={
                option === PAUSED
                  ? 'top-bar__speed top-bar__speed--pause'
                  : 'top-bar__speed'
              }
              aria-label={speedLabel(option)}
              aria-pressed={option === speed}
              data-tuto={`speed.${option}`}
              onClick={() => onSpeedChange(option)}
            >
              {speedText(option)}
            </button>
          ))}
        </div>
        {alerts.length > 0 && (
          <ul className="top-bar__alerts" aria-label="Alertes">
            {alerts.map(({ id, icon, label }) => (
              <li key={id}>
                <button
                  type="button"
                  className={`top-bar__alert top-bar__alert--${id}`}
                  onClick={() => onAlert(id)}
                >
                  <Icon name={icon} size={18} />
                  {label}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="top-bar__settings"
          aria-label="Réglages"
          aria-haspopup="dialog"
          title="Réglages"
          onClick={onSettings}
        >
          <Icon name="reglages" size={22} strokeWidth={2.2} />
        </button>
      </div>
    </header>
  )
}

/**
 * Keeps room on the page under the bar while it shows, for the messages and
 * the dock's panels (see tickerRoom.ts).
 */
function keepRoom(bar: HTMLElement | null) {
  return bar === null ? undefined : keepRoomUnder(bar, document.body)
}

/**
 * The top bar wired to the app store, with the Space shortcut. In a Défi,
 * the chip under the date opens the Défi's panel. The chips at the right
 * read the grocers' missed deliveries and the messages in `stack`.
 */
export default function TopBar({
  stack = messageStack,
}: {
  stack?: MessageStack
}) {
  const messages = useStore(stack, (state) => state.messages.length)
  const businessName = useGame((state) => state.game.profile.businessName)
  const avatar = useGame((state) => state.game.profile.avatar)
  const difficulty = useGame((state) => state.game.profile.difficulty)
  const day = useGame((state) => state.game.day)
  const journal = useGame((state) => state.game.journal)
  const financing = useGame((state) => state.game.financing)
  const personal = useGame((state) => state.game.personal)
  const weekHistory = useGame((state) => state.game.weekHistory)
  const energy = useGame((state) => state.game.energy)
  const challenge = useGame((state) => state.game.challenge)
  const bakery = useGame((state) => state.game.bakery)
  const dream = useGame((state) => state.game.dream)
  const town = useGame((state) => state.game.town)
  const events = useGame((state) => state.game.events)
  const contracts = useGame((state) => state.game.contracts)
  const lastDay = useGame((state) => state.game.lastDay)
  const speed = useGame((state) => state.speed)
  const setSpeed = useGame((state) => state.setSpeed)
  const togglePause = useGame((state) => state.togglePause)
  const openPanel = useGame((state) => state.openPanel)
  const openDrawer = useGame((state) => state.openDrawer)
  const narrow = useMediaQuery(NARROW_QUERY)

  useEffect(() => {
    // Réal's bubble waits for its own gesture: Space does not pause then.
    const onKeyDown = (event: KeyboardEvent) => {
      if (coachShowing(gameStore.getState())) return
      handlePauseKey(event, togglePause)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', blockSpaceClick)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', blockSpaceClick)
    }
  }, [togglePause])

  // A Défi's truck came on its first day, from which its loan counts.
  const firstDay = challenge?.startDay ?? 0
  const lastPlayed = lastDay?.day ?? null
  // The books only change when a day is played, not on every frame.
  const cash = useMemo(
    () => balance(journal, CASH, { toDay: day }),
    [journal, day],
  )
  const history = useMemo(
    () => cashAtCloses(journal, firstDay, lastPlayed, CASH_HISTORY_DAYS),
    [journal, firstDay, lastPlayed],
  )
  const title = useMemo(() => {
    if (challenge !== null) return null
    const game = { day, journal, financing, personal, dream, weekHistory }
    return titleOf(netWorthOf(game))?.name ?? null
  }, [challenge, day, journal, financing, personal, dream, weekHistory])
  const fixedCosts = useMemo(
    () => nextFixedCosts({ day, difficulty, firstDay, bakery, dream }),
    [day, difficulty, firstDay, bakery, dream],
  )
  const defi = challenge === null ? null : defiById(DEFIS, challenge.id)
  const defiLabel =
    challenge === null || defi === null ? null : chipLabel(challenge, defi, day)
  const defiEnergy = defi === null ? null : energyFloorLine(energy, defi)
  const alerts = topAlerts({
    missed: missedThisWeek({ day, contracts }),
    messages,
  })

  return (
    <TopBarView
      businessName={businessName}
      day={day}
      cash={cash}
      fixedCosts={fixedCosts}
      cashHistory={history}
      yesterday={
        narrow ? (lastDay === null ? null : todayNumbers(lastDay)) : undefined
      }
      onCash={() => openDrawer('finances', 'company')}
      title={title}
      energy={energy}
      avatar={avatar}
      speed={speed}
      onSpeedChange={(next) => {
        tutorialSignals.emit({ kind: 'speed', speed: next })
        setSpeed(next)
      }}
      enRoute={enRouteLine({ day, events, town })}
      defiLabel={defiLabel}
      defiEnergy={defiEnergy}
      onDefi={() => openPanel('defi')}
      alerts={alerts}
      onAlert={(id) => followAlert(id, stack)}
      onSettings={() => openPanel('settings')}
      barRef={keepRoom}
    />
  )
}
