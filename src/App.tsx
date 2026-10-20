import { useEffect, useState } from 'react'
import type { GameState } from './engine/types.ts'
import { startAutosave } from './ui/autosave.ts'
import { openCityLink } from './ui/cityLinks.ts'
import { startGameLoop } from './ui/gameLoop.ts'
import GameScreens from './ui/GameScreens.tsx'
import {
  browserStorage,
  createSaveWriter,
  type SaveWriter,
} from './ui/saves.ts'
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
  // The autosave's writer, for « Refaire la visite » to save the game now.
  const [saveRef] = useState(() => ({ current: null as SaveWriter | null }))

  useEffect(() => {
    if (!playing) return
    return startGameLoop(gameStore)
  }, [playing])

  useEffect(() => {
    if (!playing) return
    const save = createSaveWriter(browserStorage())
    saveRef.current = save
    const stop = startAutosave(gameStore, (game, replaces) =>
      setAutosaveFailed(!save(game, replaces)),
    )
    return () => {
      stop()
      saveRef.current = null
    }
  }, [playing, saveRef])

  const saveGame = () => {
    const save = saveRef.current
    const saved = save !== null && save(gameStore.getState().game)
    setAutosaveFailed(!saved)
    return saved
  }

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
            saveGame={saveGame}
          />
        </>
      ) : (
        <StartScreen onStart={start} />
      )}
    </>
  )
}
