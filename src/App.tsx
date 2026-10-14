import { useEffect } from 'react'
import { startGameLoop } from './ui/gameLoop.ts'
import { gameStore } from './ui/store.ts'
import TopBar from './ui/TopBar.tsx'

export default function App() {
  useEffect(() => startGameLoop(gameStore), [])

  return (
    <>
      <TopBar />
      <main>
        <h1>Magnat</h1>
      </main>
    </>
  )
}
