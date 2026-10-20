import { describe, expect, it } from 'vitest'
import { createInitialState, startChallenge, tick } from '../engine/clock.ts'
import { balance } from '../finance/journal.ts'
import { cashAtCloses } from './cashHistory.ts'

/** A seed-42 game played to the morning of `day`. */
function playedTo(day: number) {
  let game = createInitialState(42)
  while (game.day < day) game = tick(game)
  return game
}

describe('cashAtCloses', () => {
  it('gives the encaisse at the close of each of the last 30 days played, oldest first', () => {
    const game = playedTo(60)
    const closes = cashAtCloses(game.journal, 0, 59, 30)
    expect(closes).toHaveLength(30)
    closes.forEach((cash, i) => {
      expect(cash).toBe(balance(game.journal, '1000', { toDay: 30 + i }))
    })
  })

  it('gives only the days played since the game began', () => {
    const game = playedTo(5)
    const closes = cashAtCloses(game.journal, 0, 4, 30)
    expect(closes).toEqual(
      [0, 1, 2, 3, 4].map((day) =>
        balance(game.journal, '1000', { toDay: day }),
      ),
    )
  })

  it('starts on the first day of a Défi', () => {
    let game = startChallenge('travauxSaintDenis', 7)
    const first = game.day
    for (let i = 0; i < 3; i += 1) game = tick(game)
    expect(cashAtCloses(game.journal, first, game.day - 1, 30)).toHaveLength(3)
  })

  it('is empty before the first day is played', () => {
    const game = createInitialState(42)
    expect(cashAtCloses(game.journal, 0, null, 30)).toEqual([])
  })
})
