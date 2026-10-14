import { useEffect } from 'react'
import pacing from '../content/pacing.json'
import type { Day } from '../engine/types.ts'
import { formatGameDate } from './formatGameDate.ts'
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

interface TopBarViewProps {
  day: Day
  speed: number
  onSpeedChange: (speed: number) => void
}

export function TopBarView({ day, speed, onSpeedChange }: TopBarViewProps) {
  return (
    <header className="top-bar">
      <p className="top-bar__date">{formatGameDate(day)}</p>
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

/** The top bar wired to the app store, with the Space shortcut. */
export default function TopBar() {
  const day = useGame((state) => state.game.day)
  const speed = useGame((state) => state.speed)
  const setSpeed = useGame((state) => state.setSpeed)
  const togglePause = useGame((state) => state.togglePause)

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

  return <TopBarView day={day} speed={speed} onSpeedChange={setSpeed} />
}
