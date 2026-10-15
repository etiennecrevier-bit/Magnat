import type { Day, Headline } from '../engine/types.ts'
import type { Headlines } from './headlines.ts'

/**
 * How long each La Presse-Citron headline shows, in real milliseconds: the
 * 20 s of #94. It sits with the UI, as src/content/ belongs to P3-05 (#93)
 * for now; the content may take it over.
 */
export const MS_PER_HEADLINE = 20_000

/** Where the ticker is. */
export interface TickerState {
  /**
   * How many of the headlines events queued are behind it: shown, skipped
   * or queued before it started.
   */
  readonly seen: number
  /** The index of the next general headline. */
  readonly nextGeneral: number
  /** The headline showing; null when there is none to show. */
  readonly text: string | null
}

/**
 * The ticker as it starts on `today`, showing its first headline: one
 * events queued that day, which comes first, or the general headline
 * `random` picks. The headlines queued before `today` count as shown.
 */
export function startTicker(
  queued: readonly Headline[],
  today: Day,
  headlines: Headlines,
  random: () => number = Math.random,
): TickerState {
  const { length } = headlines.general
  const first = Math.min(length - 1, Math.floor(random() * length))
  return turnTicker(
    {
      seen: queued.filter(({ day }) => day < today).length,
      nextGeneral: Math.max(0, first),
      text: null,
    },
    queued,
    headlines,
  )
}

/**
 * The ticker's next headline: the oldest one events queued that it has not
 * shown, then the general ones in turn, back to the first after the last.
 * A queued headline with no text in `headlines` is skipped.
 */
export function turnTicker(
  state: TickerState,
  queued: readonly Headline[],
  headlines: Headlines,
): TickerState {
  // A shorter list is another game's: what it holds counts as shown.
  let seen = Math.min(state.seen, queued.length)
  while (seen < queued.length) {
    const id = queued[seen]?.id
    seen += 1
    const text = id === undefined ? undefined : headlines.events.get(id)
    if (text !== undefined) return { ...state, seen, text }
  }
  const { general } = headlines
  const index = state.nextGeneral % general.length
  const text = general[index]
  if (text === undefined) return { ...state, seen }
  return { seen, nextGeneral: (index + 1) % general.length, text }
}
