import { useEffect, useState } from 'react'
import type { GameState } from './engine/types.ts'
import { startAutosave } from './ui/autosave.ts'
import { startGameLoop } from './ui/gameLoop.ts'
import GameScreens from './ui/GameScreens.tsx'
import { browserStorage, createSaveWriter } from './ui/saves.ts'
import StartScreen from './ui/StartScreen.tsx'
import { gameStore } from './ui/store.ts'
import TopBar from './ui/TopBar.tsx'
import WorldCanvas from './world/WorldCanvas.tsx'

/**
 * The world, with the start screen over it until a game starts, then the top
 * bar and the screens. Time runs, and the game saves, only once it has.
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
    return startAutosave(gameStore, (game) => setAutosaveFailed(!save(game)))
  }, [playing])

  const start = (game: GameState) => {
    gameStore.getState().startGame(game)
    setPlaying(true)
  }

  return (
    <>
      <WorldCanvas />
      {playing ? (
        <>
          <TopBar />
          <GameScreens autosaveFailed={autosaveFailed} />
        </>
      ) : (
        <StartScreen onStart={start} />
      )}
    </>
  )
}
