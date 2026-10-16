import { useEffect, useState } from 'react'
import DefiEnd from './DefiEnd.tsx'
import { keepBestMedals } from './defis.ts'
import EventLog from './EventLog.tsx'
import FinancialStatements from './FinancialStatements.tsx'
import Messages from './Messages.tsx'
import { downloadSave } from './saves.ts'
import { settingsStore, type SettingsStore } from './settings.ts'
import { gameStore, useGame } from './store.ts'
import Ticker from './Ticker.tsx'
import TodayPanel from './TodayPanel.tsx'
import WeekReports from './WeekReports.tsx'
import WeekSlideIn from './WeekSlideIn.tsx'

export type Screen = 'today' | 'statements' | 'events' | 'reports'

const SCREENS: Record<Screen, string> = {
  today: "Aujourd'hui",
  statements: 'États financiers',
  events: 'Journal des événements',
  reports: 'Bilans',
}

interface GameScreensViewProps {
  screen: Screen
  onScreenChange: (screen: Screen) => void
  onExport: () => void
  /** Whether the last autosave failed, so the player should export. */
  autosaveFailed: boolean
}

/**
 * The page under the top bar: the messages the game sends, a button per
 * screen and the export button, then that screen.
 */
export function GameScreensView({
  screen,
  onScreenChange,
  onExport,
  autosaveFailed,
}: GameScreensViewProps) {
  return (
    <main>
      {autosaveFailed && (
        <p className="notice" role="status">
          La sauvegarde automatique a échoué. Exportez la sauvegarde pour ne pas
          perdre votre partie.
        </p>
      )}
      <Messages />
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
        <button type="button" className="button" onClick={onExport}>
          Exporter la sauvegarde
        </button>
      </nav>
      {screen === 'today' && <TodayPanel />}
      {screen === 'statements' && <FinancialStatements />}
      {screen === 'events' && <EventLog />}
      {screen === 'reports' && <WeekReports />}
    </main>
  )
}

/**
 * The screens, opening on Aujourd'hui, exporting the app store's game, with
 * the La Presse-Citron ticker along the bottom and the week's card sliding
 * in above it. Once a Défi is over, its end shows over them, whose « Retour
 * au menu » calls `onMenu`. Every medal the game wins is kept in `settings`,
 * a Défi won and then loaded included.
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
  const [screen, setScreen] = useState<Screen>('today')
  const panel = useGame((state) => state.panel)

  useEffect(
    () => keepBestMedals(gameStore, settings.getState().recordMedal),
    [settings],
  )

  return (
    <>
      <GameScreensView
        screen={screen}
        onScreenChange={setScreen}
        onExport={() => downloadSave(gameStore.getState().game)}
        autosaveFailed={autosaveFailed}
      />
      <WeekSlideIn />
      <Ticker />
      {panel === 'defiEnd' && <DefiEnd onMenu={onMenu} />}
    </>
  )
}
