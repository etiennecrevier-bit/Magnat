import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { EVENTS } from '../engine/day.ts'
import type { DecisionChange } from '../engine/decisions.ts'
import { resolveEvent } from '../engine/events.ts'
import { goTo } from '../engine/places.ts'
import type { GameState } from '../engine/types.ts'
import { gameStore, type GameStoreState } from './store.ts'
import { placeTip, tripBoard, type PlaceRow } from './tripBoard.ts'
import TripPanel, { PlaceCard, TripPanelView } from './TripPanel.tsx'

// A static render reads a Zustand store's initial state, so the connected
// panel reads the app store's current state through this stand-in.
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

// Every space before a colon, a percent sign or a unit is a no-break space
// (U+00A0).
const S = ' '

/** Day 1, a Tuesday the truck opens, before it is played. */
const TUESDAY = tick(createInitialState(42))

function render(game = TUESDAY) {
  return renderToStaticMarkup(
    <TripPanelView board={tripBoard(game)} onChange={() => {}} />,
  )
}

/** Each place's row, its tooltip left out, and its text apart by « | ». */
function rows(html: string): string[] {
  return [
    ...html.matchAll(
      /<div class="trip__place[^"]*"[^>]*>(.*?)<\/button><\/div>/g,
    ),
  ].map(([, inner]) =>
    (inner ?? '').replace(/<\/(h3|span|p)>/g, '|').replace(/<[^>]*>/g, ''),
  )
}

/** What `PlaceCard` draws inside its tooltip's anchor. */
function placeCard(
  row: PlaceRow,
  onChange: (change: DecisionChange) => void,
): ReactNode {
  const tooltip = elements(PlaceCard({ row, onChange })).find(
    (element) =>
      typeof (element.props as { children?: unknown }).children === 'function',
  )
  if (tooltip === undefined) throw new Error('No tooltip')
  const draw = (tooltip.props as { children: (anchor: object) => ReactNode })
    .children
  return draw({ 'aria-describedby': 'tip' })
}

/** Every element in `node` and its children, in order, `node` included. */
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return (node as ReactNode[]).flatMap(elements)
  if (!isValidElement(node)) return []
  const { children } = node.props as { children?: ReactNode }
  return [node, ...elements(children)]
}

/** The button of `node` that reads `text`. */
function button(node: ReactNode, text: string) {
  const found = elements(node).find(
    (element) =>
      element.type === 'button' &&
      (element.props as { children?: ReactNode }).children === text,
  )
  if (found === undefined) throw new Error(`No button ${text}`)
  return found.props as { onClick: () => void; disabled?: boolean }
}

function rowOf(game: GameState, index: number): PlaceRow {
  const row = tripBoard(game).rows[index]
  if (row === undefined) throw new Error(`No row ${index}`)
  return row
}

describe('TripPanelView', () => {
  it('is a list of the places, one row each, with no title of its own', () => {
    const html = render()
    expect(html).toMatch(
      /^<ul class="trip__places"><li><div class="trip__place" tabindex="0" aria-describedby="[^"]+"/,
    )
    expect(rows(html)).toHaveLength(4)
  })

  it('shows each place with its trip’s time and « Fermé pendant ce temps » when nobody else serves', () => {
    const html = render()
    expect(rows(html)[1]).toBe(
      `La meunerie|Trajet${S}: 40${S}min · visite${S}: 30${S}min||Fermé pendant ce temps|Y aller`,
    )
    expect(html).toContain(
      `<p id="trip-meunerie-status" class="status-line"><span class="status-line__dot status-line__dot--warn" aria-hidden="true"></span>Fermé pendant ce temps</p></div><button type="button" class="button button--primary" aria-label="Y aller${S}: La meunerie" aria-describedby="trip-meunerie-status `,
    )
    expect(rows(html)[2]).toBe(
      `Le Bureau des permis et des formulaires|Toute la journée||Rien à déposer|Y aller`,
    )
    expect(rows(html)[3]).toBe(
      `Le fournil|Trajet${S}: 15${S}min · visite${S}: 15${S}min||Fermé pendant ce temps|Y aller`,
    )
  })

  it('puts what the owner does there, what it gives and the times in each place’s tooltip', () => {
    const [, meunerie, permits] = tripBoard(TUESDAY).rows
    expect(placeTip(meunerie!)).toEqual({
      title: 'La meunerie',
      text: 'Négocier le prix des marchandises',
      rows: [
        {
          label: 'Ce que ça donne',
          value: `−5${S}% sur le prochain achat de marchandises`,
        },
        { label: 'Horaire', value: `Départ 10${S}h · retour 11${S}h${S}50` },
      ],
    })
    expect(placeTip(permits!).rows).toEqual([])
    expect(render()).toContain('<p class="tip__title">La meunerie</p>')
  })

  it('disables « Y aller » with the reason as the status line when the owner cannot go', () => {
    const html = render()
    expect(html).toContain(
      `<p id="trip-caisse-refusal" class="status-line"><span class="status-line__dot status-line__dot--off" aria-hidden="true"></span>Votre encaisse suffit</p></div><button type="button" class="button button--primary" aria-label="Y aller${S}: La Caisse populaire" aria-describedby="trip-caisse-refusal `,
    )
    expect(html).toMatch(
      /aria-label="Y aller\u00a0: La Caisse populaire" aria-describedby="[^"]+" disabled="">Y aller<\/button>/,
    )
    expect(rows(html)[0]).toBe(
      `La Caisse populaire|Trajet${S}: 25${S}min · visite${S}: 30${S}min||Votre encaisse suffit|Y aller`,
    )
  })

  it('lets a row take the focus only when its button cannot, for its tooltip', () => {
    const anchors = [
      ...render().matchAll(/<div class="trip__place"([^>]*)>/g),
    ].map(([, attributes]) => (attributes ?? '').includes('tabindex="0"'))
    expect(anchors).toEqual([true, false, true, false])
  })

  it("marks the day's trip with « Aujourd'hui », which « Annuler » drops", () => {
    const html = render(goTo(TUESDAY, 'fournil'))
    expect(html).toContain(
      `<div class="trip__place trip__place--chosen" aria-describedby=`,
    )
    expect(html).toContain(
      `<h3 class="trip__name">Le fournil</h3><span class="chip">Aujourd&#x27;hui</span>`,
    )
    expect(html).toMatch(
      new RegExp(
        `aria-label="Annuler${S}: Le fournil" aria-describedby="[^"]+">Annuler</button>`,
      ),
    )
  })

  it('disables « Annuler » with the reason for a trip a card booked', () => {
    const booked = tick(
      resolveEvent(
        {
          ...TUESDAY,
          events: {
            ...TUESDAY.events,
            pending: { event: 'conesOrange', followUp: false },
          },
        },
        'changerDeCoin',
        EVENTS,
      ),
    )
    const html = render(booked)
    expect(html).toContain(
      `Déplacement obligatoire</p></div><button type="button" class="button" aria-label="Annuler${S}: Le Bureau des permis et des formulaires" aria-describedby="trip-bureauPermis-refusal `,
    )
    expect(html).toMatch(/disabled="">Annuler<\/button>/)
  })

  it('reports where the owner goes, or that they stay', () => {
    const onChange = vi.fn<(change: DecisionChange) => void>()
    button(placeCard(rowOf(TUESDAY, 1), onChange), 'Y aller').onClick()
    const chosen = goTo(TUESDAY, 'fournil')
    button(placeCard(rowOf(chosen, 3), onChange), 'Annuler').onClick()
    expect(onChange.mock.calls).toEqual([
      [{ kind: 'goTo', place: 'meunerie' }],
      [{ kind: 'goTo', place: null }],
    ])
  })
})

describe('TripPanel', () => {
  it('shows the app store in « Ville », a modal dialog in the dock’s frame, on « Aller à… », and sends the owner at once', () => {
    gameStore.getState().openPanel('trip')
    const html = renderToStaticMarkup(<TripPanel />)
    expect(html).toMatch(
      /^<dialog class="panel dock-frame dock-panel trip" aria-labelledby="([^"]+)" style="--city-ratio:0.625"><div class="dock-frame__header"><h2 id="\1" class="dock-frame__title">Ville<\/h2>/,
    )
    expect(html).toMatch(
      /<button id="([^"]+)-tab-trip" type="button" role="tab" class="tab on" aria-selected="true" data-tuto="tab.trip" aria-controls="\1" tabindex="0">Aller à…<\/button><button id="\1-tab-contracts" type="button" role="tab" class="tab" aria-selected="false" data-tuto="tab.contracts" aria-controls="\1" tabindex="-1">Contrats<\/button>/,
    )
    expect(html).toContain('<ul class="trip__places">')
    gameStore.getState().decide({ kind: 'goTo', place: 'meunerie' })
    const { game } = gameStore.getState()
    expect(game.town.trip).toBe('meunerie')
    expect(game.pendingDecisions).toBeNull()
    expect(renderToStaticMarkup(<TripPanel />)).toContain(
      `aria-label="Annuler${S}: La meunerie"`,
    )
  })

  it('opens on « Contrats » when the store asks for that section', () => {
    gameStore.getState().openPanel('trip', 'contracts')
    const html = renderToStaticMarkup(<TripPanel />)
    expect(html).toMatch(/class="tab on" aria-selected="true"[^>]*>Contrats</)
    expect(html).toContain('<section class="contracts">')
    expect(html).not.toContain('<ul class="trip__places">')
  })

  it('moves to « Contrats » on the grocer the city picked', () => {
    gameStore.getState().openPanel('trip')
    gameStore.getState().pickGrocer('chezNormand')
    const html = renderToStaticMarkup(<TripPanel />)
    expect(html).toMatch(/class="tab on" aria-selected="true"[^>]*>Contrats</)
    expect(html).toContain(
      '<article id="contracts-chezNormand" class="contracts__card contracts__card--picked"',
    )
  })
})
