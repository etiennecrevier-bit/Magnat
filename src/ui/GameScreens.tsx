import { useState } from 'react'
import FinancialStatements from './FinancialStatements.tsx'
import Messages from './Messages.tsx'
import { downloadSave } from './saves.ts'
import { gameStore } from './store.ts'
import TodayPanel from './TodayPanel.tsx'

export type Screen = 'today' | 'statements'

const SCREENS: Record<Screen, string> = {
  today: "Aujourd'hui",
  statements: 'États financiers',
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
      {screen === 'today' ? <TodayPanel /> : <FinancialStatements />}
    </main>
  )
}

/** The screens, opening on Aujourd'hui, exporting the app store's game. */
export default function GameScreens({
  autosaveFailed = false,
}: {
  autosaveFailed?: boolean
}) {
  const [screen, setScreen] = useState<Screen>('today')
  return (
    <GameScreensView
      screen={screen}
      onScreenChange={setScreen}
      onExport={() => downloadSave(gameStore.getState().game)}
      autosaveFailed={autosaveFailed}
    />
  )
}
