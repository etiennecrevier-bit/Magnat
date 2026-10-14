/** Game day index; day 0 is the first day of the game. */
export type Day = number

export interface GameState {
  day: Day
  /** The seed the game started from, kept so the game can be replayed. */
  seed: number
  /** The seeded generator's state (see rng.ts); a save restores it as is. */
  rngState: number
}
