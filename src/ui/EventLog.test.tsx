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

const ENTRIES = [
  { key: '31-b', day: 31, title: 'B', choice: 'Oui', result: 'Fait.' },
  { key: '0-a', day: 0, title: 'A', choice: 'Non', result: 'Rien.' },
]

/** A closed row of `entry`: its date, title and choice on its button. */
function closedRow(key: string, date: string, title: string, choice: string) {
  const id = `event-log-${key}`
  return (
    `<li class="journal-row"><button type="button" id="${id}-button" class="journal-row__button" aria-expanded="false" aria-controls="${id}-region">` +
    '<span class="journal-row__marker" aria-hidden="true">▸</span>' +
    `<span class="journal-row__line"><span class="journal-row__muted">${date}</span> <span class="journal-row__title">${title}</span> <span class="journal-row__muted">${choice}</span></span>` +
    `</button><div id="${id}-region" class="journal-row__body" role="region" aria-labelledby="${id}-button" hidden=""></div></li>`
  )
}

describe('EventLogView', () => {
  it('lists each event as one line, newest first: its date, title and choice, closed', () => {
    const html = renderToStaticMarkup(<EventLogView entries={ENTRIES} />)
    expect(html).toBe(
      '<section class="event-log"><ol class="journal-rows">' +
        closedRow('31-b', '1er juin, an 1', 'B', 'Oui') +
        closedRow('0-a', '1er mai, an 1', 'A', 'Non') +
        '</ol></section>',
    )
    expect(html).not.toContain('Fait.')
  })

  it('opens an event to what came of it', () => {
    const html = renderToStaticMarkup(
      <EventLogView entries={ENTRIES} openKeys={new Set(['0-a'])} />,
    )
    expect(html).toContain(closedRow('31-b', '1er juin, an 1', 'B', 'Oui'))
    expect(html).toContain(
      'aria-expanded="true" aria-controls="event-log-0-a-region"><span class="journal-row__marker" aria-hidden="true">▾</span>',
    )
    expect(html).toContain(
      '<div id="event-log-0-a-region" class="journal-row__body" role="region" aria-labelledby="event-log-0-a-button"><p class="event-log__result">Rien.</p></div>',
    )
    expect(html).not.toContain('Fait.')
  })

  it('says so when no event came up in a year', () => {
    expect(renderToStaticMarkup(<EventLogView entries={[]} />)).toBe(
      '<section class="event-log"><p>Aucun événement depuis un an.</p></section>',
    )
  })
})

describe('EventLog', () => {
  it("lists the app store's events, closed", () => {
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
      closedRow(
        '3-essai',
        '4 mai, an 1',
        'La carte d&#x27;essai',
        'Ne rien faire',
      ),
    )
  })
})
