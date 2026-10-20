import { useCallback, useEffect, useRef, type Ref } from 'react'
import { useStore } from 'zustand'
import BankruptcyEnd from './BankruptcyEnd.tsx'
import ContractsScreen from './ContractsScreen.tsx'
import DefiEnd from './DefiEnd.tsx'
import { keepBestMedals } from './defis.ts'
import EventLog from './EventLog.tsx'
import FinancialStatements from './FinancialStatements.tsx'
import { FOLD_KEY, handleFoldKey, losesFocusOnFold } from './foldShortcut.ts'
import Messages from './Messages.tsx'
import ScreensStrip from './ScreensStrip.tsx'
import { settingsStore, type SettingsStore } from './settings.ts'
import { gameStore, useGame, type Screen } from './store.ts'
import Ticker from './Ticker.tsx'
import TodayPanel from './TodayPanel.tsx'
import WeekReports from './WeekReports.tsx'
import WeekSlideIn from './WeekSlideIn.tsx'
import './GameScreens.css'

export type { Screen }

const SCREENS: Record<Screen, string> = {
  today: "Aujourd'hui",
  statements: 'États financiers',
  events: 'Journal des événements',
  reports: 'Bilans',
  contracts: 'Contrats',
}

interface GameScreensViewProps {
  screen: Screen
  onScreenChange: (screen: Screen) => void
  /** Whether the last autosave failed, so the player should export. */
  autosaveFailed: boolean
  /** Whether the screens are folded down to a strip. */
  folded: boolean
  /** Folds the screens (true) or unfolds them (false). */
  onFoldChange: (folded: boolean) => void
  /** The button that folds or unfolds them, whichever shows. */
  foldButtonRef?: Ref<HTMLButtonElement>
}

/**
 * The page under the top bar: the messages the game sends, a button per
 * screen, then that screen with « Replier » beside its title. Folded, a strip
 * with the screen's name and the last day's numbers takes the place of the
 * buttons and the screen, and unfolds them.
 */
export function GameScreensView({
  screen,
  onScreenChange,
  autosaveFailed,
  folded,
  onFoldChange,
  foldButtonRef,
}: GameScreensViewProps) {
  return (
    <main className={folded ? 'screens--folded' : undefined}>
      {autosaveFailed && (
        <p className="notice" role="status">
          La sauvegarde automatique a échoué. Exportez la partie dans les
          Réglages pour ne pas la perdre.
        </p>
      )}
      <Messages />
      {folded ? (
        <ScreensStrip
          screen={SCREENS[screen]}
          onUnfold={() => onFoldChange(false)}
          buttonRef={foldButtonRef}
        />
      ) : (
        <nav className="screen-nav" aria-label="Écrans">
          <div className="toggle-group">
            {(Object.keys(SCREENS) as Screen[]).map((option) => (
              <button
                key={option}
                type="button"
                className="toggle"
                aria-pressed={option === screen}
                onClick={() => onScreenChange(option)}
              >
                {SCREENS[option]}
              </button>
            ))}
          </div>
        </nav>
      )}
      {/* Hidden rather than gone while folded, so the screen keeps what the
          player picked in it, such as a statement and its period. */}
      <div className="screens__screen" hidden={folded}>
        {!folded && (
          <button
            ref={foldButtonRef}
            type="button"
            className="button screens__fold"
            aria-expanded={true}
            aria-keyshortcuts={FOLD_KEY}
            title={`Replier le panneau (touche ${FOLD_KEY})`}
            onClick={() => onFoldChange(true)}
          >
            Replier
          </button>
        )}
        {screen === 'today' && <TodayPanel />}
        {screen === 'statements' && <FinancialStatements />}
        {screen === 'events' && <EventLog />}
        {screen === 'reports' && <WeekReports />}
        {screen === 'contracts' && <ContractsScreen />}
      </div>
    </main>
  )
}

/**
 * The screens, opening on Aujourd'hui, with the La Presse-Citron ticker along
 * the bottom and the week's card sliding in above it. Once a Défi is over,
 * its end shows over them, and once a game went bankrupt, its « Faillite »,
 * each with a « Retour au menu » that calls `onMenu`. Every
 * medal the game wins is kept in `settings`, a Défi won and then loaded
 * included, and so is whether the screens are folded, which R also toggles.
 * A game started in their place, such as one imported, gets new screens and
 * a new ticker, so nothing of the last game's messages or headlines stays.
 */
export default function GameScreens({
  autosaveFailed = false,
  onMenu,
  settings = settingsStore,
}: {
  autosaveFailed?: boolean
  onMenu: () => void
  settings?: SettingsStore
}) {
  const screen = useGame((state) => state.screen)
  const showScreen = useGame((state) => state.showScreen)
  const folded = useStore(settings, (state) => state.screensFolded)
  const panel = useGame((state) => state.panel)
  const gamesStarted = useGame((state) => state.gamesStarted)
  const foldButtonRef = useRef<HTMLButtonElement>(null)
  const focusFoldButton = useRef(false)

  useEffect(
    () => keepBestMedals(gameStore, settings.getState().recordMedal),
    [settings],
  )

  // When what had the focus goes away with the fold, the button that takes
  // its place, the strip or « Replier », gets it.
  const fold = useCallback(
    (next: boolean) => {
      focusFoldButton.current = losesFocusOnFold(document.activeElement)
      settings.getState().setScreensFolded(next)
    },
    [settings],
  )

  useEffect(() => {
    if (!focusFoldButton.current) return
    focusFoldButton.current = false
    foldButtonRef.current?.focus()
  }, [folded])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) =>
      handleFoldKey(event, () => fold(!settings.getState().screensFolded))
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fold, settings])

  return (
    <>
      <GameScreensView
        key={`screens-${gamesStarted}`}
        screen={screen}
        onScreenChange={showScreen}
        autosaveFailed={autosaveFailed}
        folded={folded}
        onFoldChange={fold}
        foldButtonRef={foldButtonRef}
      />
      <WeekSlideIn />
      <Ticker key={`ticker-${gamesStarted}`} />
      {panel === 'defiEnd' && <DefiEnd onMenu={onMenu} />}
      {panel === 'bankruptcy' && <BankruptcyEnd onMenu={onMenu} />}
    </>
  )
}
