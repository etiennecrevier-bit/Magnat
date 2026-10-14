import { useEffect } from 'react'
import { startGameLoop } from './ui/gameLoop.ts'
import GameScreens from './ui/GameScreens.tsx'
import { gameStore } from './ui/store.ts'
import TopBar from './ui/TopBar.tsx'

export default function App() {
  useEffect(() => startGameLoop(gameStore), [])

  return (
    <>
      <TopBar />
      <GameScreens />
    </>
  )
}
