import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../engine/clock.ts'
import EventLog, { EventLogView } from './EventLog.tsx'
import { gameStore, type GameStoreState } from './store.ts'

// A static render reads a Zustand store's initial state, so the connected
// journal reads the app store's current state through this stand-in.
vi.mock('./store.ts', async (importOriginal) => {
  const store = await importOriginal<typeof import('./store.ts')>()
  return {
    ...store,
    useGame: <T,>(selector: (state: GameStoreState) => T): T =>
      selector(store.gameStore.getState()),
  }
})

afterEach(() => {
  gameStore.setState(gameStore.getInitialState(), true)
})

// French puts a no-break space (U+00A0) before a colon.
const S = ' '

describe('EventLogView', () => {
  it('lists each event with its date, the choice made and what came of it', () => {
    const html = renderToStaticMarkup(
      <EventLogView
        entries={[
          { day: 31, title: 'B', choice: 'Oui', result: 'Fait.' },
          { day: 0, title: 'A', choice: 'Non', result: 'Rien.' },
        ]}
      />,
    )
    expect(html).toBe(
      `<section class="event-log"><h1>Journal des événements</h1><ol class="event-log__entries"><li class="event-log__entry"><h2>B</h2><p class="event-log__date">1er juin, an 1</p><p>Choix${S}: Oui</p><p>Fait.</p></li><li class="event-log__entry"><h2>A</h2><p class="event-log__date">1er mai, an 1</p><p>Choix${S}: Non</p><p>Rien.</p></li></ol></section>`,
    )
  })

  it('says so when no event came up in a year', () => {
    expect(renderToStaticMarkup(<EventLogView entries={[]} />)).toBe(
      '<section class="event-log"><h1>Journal des événements</h1><p>Aucun événement depuis un an.</p></section>',
    )
  })
})

describe('EventLog', () => {
  it("lists the app store's events", () => {
    const game = createInitialState(1)
    gameStore.getState().startGame({
      ...game,
      day: 5,
      events: {
        ...game.events,
        history: [
          {
            day: 3,
            event: 'essai',
            followUp: false,
            choice: 'rienFaire',
            outcome: 0,
          },
        ],
      },
    })
    const html = renderToStaticMarkup(<EventLog />)
    expect(html).toContain(
      `<h2>La carte d&#x27;essai</h2><p class="event-log__date">4 mai, an 1</p><p>Choix${S}: Ne rien faire</p>`,
    )
  })
})
