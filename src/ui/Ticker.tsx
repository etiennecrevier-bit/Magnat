import { useEffect, useState } from 'react'
import { HEADLINES, type Headlines } from './headlines.ts'
import { gameStore } from './store.ts'
import { MS_PER_HEADLINE, startTicker, turnTicker } from './ticker.ts'
import './Ticker.css'

/** The La Presse-Citron bar at the bottom of the street, with a headline. */
export function TickerView({ text }: { text: string }) {
  return (
    <aside className="ticker" aria-label="La Presse-Citron">
      <p className="ticker__paper" aria-hidden="true">
        La Presse-Citron
      </p>
      <p className="ticker__text">{text}</p>
    </aside>
  )
}

interface TickerProps {
  /** Null hides the ticker, as before there is a headline file. */
  headlines?: Headlines | null
  /** Picks the first general headline. */
  random?: () => number
}

/**
 * The ticker of the app store's game: a new headline every
 * `MS_PER_HEADLINE` of real time, paused or not, and at once when a choice
 * queues one, which comes before the general ones (see ticker.ts).
 */
export default function Ticker({
  headlines = HEADLINES,
  random = Math.random,
}: TickerProps) {
  return headlines === null ? null : (
    <RunningTicker headlines={headlines} random={random} />
  )
}

function RunningTicker({
  headlines,
  random,
}: {
  headlines: Headlines
  random: () => number
}) {
  const [ticker, setTicker] = useState(() => {
    const { game } = gameStore.getState()
    return startTicker(game.events.headlines, game.day, headlines, random)
  })

  // Runs again after each turn, so the next one is a whole period later.
  useEffect(() => {
    const turn = () =>
      setTicker((current) =>
        turnTicker(
          current,
          gameStore.getState().game.events.headlines,
          headlines,
        ),
      )
    const timer = window.setTimeout(turn, MS_PER_HEADLINE)
    const unsubscribe = gameStore.subscribe((state, previous) => {
      if (
        state.game.events.headlines.length >
        previous.game.events.headlines.length
      ) {
        turn()
      }
    })
    return () => {
      window.clearTimeout(timer)
      unsubscribe()
    }
  }, [ticker, headlines])

  return ticker.text === null ? null : <TickerView text={ticker.text} />
}
