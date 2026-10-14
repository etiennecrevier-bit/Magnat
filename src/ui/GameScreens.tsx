import { useState } from 'react'
import FinancialStatements from './FinancialStatements.tsx'
import TodayPanel from './TodayPanel.tsx'

export type Screen = 'today' | 'statements'

const SCREENS: Record<Screen, string> = {
  today: "Aujourd'hui",
  statements: 'États financiers',
}

interface GameScreensViewProps {
  screen: Screen
  onScreenChange: (screen: Screen) => void
}

/** The page under the top bar: a button per screen, then that screen. */
export function GameScreensView({
  screen,
  onScreenChange,
}: GameScreensViewProps) {
  return (
    <main>
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
      {screen === 'today' ? <TodayPanel /> : <FinancialStatements />}
    </main>
  )
}

/** The screens, opening on Aujourd'hui. */
export default function GameScreens() {
  const [screen, setScreen] = useState<Screen>('today')
  return <GameScreensView screen={screen} onScreenChange={setScreen} />
}
