import { useEffect, useState } from 'react'
import type { GameState } from './engine/types.ts'
import { startAutosave } from './ui/autosave.ts'
import { openCityLink } from './ui/cityLinks.ts'
import { startGameLoop } from './ui/gameLoop.ts'
import GameScreens from './ui/GameScreens.tsx'
import { browserStorage, createSaveWriter } from './ui/saves.ts'
import StartScreen from './ui/StartScreen.tsx'
import { gameStore } from './ui/store.ts'
import TopBar from './ui/TopBar.tsx'
import WorldCanvas from './world/WorldCanvas.tsx'

/**
 * The world, with the start screen over it until a game starts, then the top
 * bar and the screens. Time runs, and the game saves, only once it has, and
 * only then do the city's buildings open the panels.
 */
export default function App() {
  const [playing, setPlaying] = useState(false)
  const [autosaveFailed, setAutosaveFailed] = useState(false)

  useEffect(() => {
    if (!playing) return
    return startGameLoop(gameStore)
  }, [playing])

  useEffect(() => {
    if (!playing) return
    const save = createSaveWriter(browserStorage())
    return startAutosave(gameStore, (game, replaces) =>
      setAutosaveFailed(!save(game, replaces)),
    )
  }, [playing])

  const start = (game: GameState) => {
    gameStore.getState().startGame(game)
    setPlaying(true)
  }

  return (
    <>
      <WorldCanvas onOpen={playing ? openCityLink : null} />
      {playing ? (
        <>
          <TopBar />
          <GameScreens
            autosaveFailed={autosaveFailed}
            onMenu={() => setPlaying(false)}
          />
        </>
      ) : (
        <StartScreen onStart={start} />
      )}
    </>
  )
}
