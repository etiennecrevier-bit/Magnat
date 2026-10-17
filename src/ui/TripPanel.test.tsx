import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import type { DecisionChange } from '../engine/decisions.ts'
import { goTo } from '../engine/places.ts'
import type { GameState } from '../engine/types.ts'
import { gameStore, type GameStoreState } from './store.ts'
import { tripBoard, type PlaceRow } from './tripBoard.ts'
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
    <TripPanelView
      board={tripBoard(game)}
      onChange={() => {}}
      onClose={() => {}}
    />,
  )
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
  it('opens on Fermer, then the « Aller à… » title', () => {
    expect(render()).toMatch(
      /^<div class="panel__content"><div class="panel__header"><button type="button" class="toggle">Fermer<\/button><h2 id="trip-title">Aller à…<\/h2><\/div><ul class="trip__places">/,
    )
  })

  it('shows each place with its minutes, its times and « Fermé pendant ce temps » when nobody else serves', () => {
    const html = render()
    expect(html).toContain(
      `<li class="trip__place"><h3>La meunerie</h3><p>Négocier le prix des marchandises</p><p class="trip__gives">−5${S}% sur le prochain achat de marchandises</p><p class="trip__time">Trajet${S}: 40${S}min · visite${S}: 30${S}min</p><p class="trip__time">Départ 10${S}h · retour 11${S}h${S}50</p><p class="trip__closed">Fermé pendant ce temps</p><button type="button" class="button button--primary" aria-label="Y aller${S}: La meunerie">Y aller</button></li>`,
    )
    expect(html).toContain(
      '<p class="trip__time">Toute la journée</p><p class="trip__closed">Fermé pendant ce temps</p>',
    )
  })

  it('disables « Y aller » with the reason when the owner cannot go', () => {
    expect(render()).toContain(
      `<button type="button" class="button button--primary" aria-label="Y aller${S}: La Caisse populaire" aria-describedby="trip-caisse-refusal" disabled="">Y aller</button><p id="trip-caisse-refusal" class="trip__refusal">Votre encaisse suffit, sans prêt</p></li>`,
    )
  })

  it("marks the day's trip, which « Annuler » drops", () => {
    const html = render(goTo(TUESDAY, 'fournil'))
    expect(html).toContain(
      `<li class="trip__place trip__place--chosen"><h3>Le fournil</h3><p class="trip__status">Aujourd&#x27;hui</p>`,
    )
    expect(html).toContain(
      `<button type="button" class="button" aria-label="Annuler${S}: Le fournil">Annuler</button></li>`,
    )
  })

  it('reports where the owner goes, or that they stay', () => {
    const onChange = vi.fn<(change: DecisionChange) => void>()
    button(PlaceCard({ row: rowOf(TUESDAY, 1), onChange }), 'Y aller').onClick()
    const chosen = goTo(TUESDAY, 'fournil')
    button(PlaceCard({ row: rowOf(chosen, 3), onChange }), 'Annuler').onClick()
    expect(onChange.mock.calls).toEqual([
      [{ kind: 'goTo', place: 'meunerie' }],
      [{ kind: 'goTo', place: null }],
    ])
    const onClose = vi.fn()
    button(
      TripPanelView({ board: tripBoard(TUESDAY), onChange, onClose }),
      'Fermer',
    ).onClick()
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('TripPanel', () => {
  it('shows the app store in a modal dialog, and sends the owner at once', () => {
    gameStore.getState().openPanel('trip')
    expect(renderToStaticMarkup(<TripPanel />)).toMatch(
      /^<dialog class="panel trip" aria-labelledby="trip-title"><div class="panel__content">/,
    )
    gameStore.getState().decide({ kind: 'goTo', place: 'meunerie' })
    const { game } = gameStore.getState()
    expect(game.town.trip).toBe('meunerie')
    expect(game.pendingDecisions).toBeNull()
    expect(renderToStaticMarkup(<TripPanel />)).toContain(
      `aria-label="Annuler${S}: La meunerie"`,
    )
  })
})
