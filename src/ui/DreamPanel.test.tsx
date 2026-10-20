import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RungId } from '../content/schema.ts'
import { createInitialState } from '../engine/clock.ts'
import { cents } from '../engine/money.ts'
import type { GameState } from '../engine/types.ts'
import { dreamBoard } from './dreamBoard.ts'
import DreamPanel, { DreamPanelView } from './DreamPanel.tsx'
import { gameStore, type GameStoreState } from './store.ts'

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

// Every space in an amount is a no-break space (U+00A0).
const S = '\u00a0'

// The default profile plays Moyen: 2 500 $ of the owner's own, 10 000 $ in
// Encaisse and a net worth of 27 500 $.
const START = createInitialState(42)

function render(game: GameState, confirming: RungId | null = null) {
  return renderToStaticMarkup(
    <DreamPanelView
      board={dreamBoard(game)}
      confirming={confirming}
      onConfirmingChange={() => {}}
      onChange={() => {}}
      onClose={() => {}}
    />,
  )
}

describe('DreamPanelView', () => {
  it('opens on Fermer, the title, then the owner’s title and the next one', () => {
    expect(
      render(START).startsWith(
        `<div class="panel__content"><div class="panel__header"><button type="button" class="toggle">Fermer</button><h2 id="dream-title">Le rêve</h2></div><section class="dream__titles" aria-label="Titre"><p class="dream__title">Titre${S}: Débrouillard</p><div class="dream__progress"><p>Prochain titre${S}: Commerçant · 27${S}500,00${S}$ sur 100${S}000,00${S}$</p>`,
      ),
    ).toBe(true)
  })

  it('shows both ladders with who pays and a bar toward the next rung', () => {
    const html = render(START)
    expect(html).toContain(
      `<section class="dream__ladder" aria-labelledby="dream-personal"><h3 id="dream-personal">Personnel</h3><p class="dream__payer">Payé par vous</p><div class="dream__progress"><p>Prochain${S}: Vélo électrique · 1${S}500,00${S}$ requis · 2${S}500,00${S}$ disponibles</p><span class="dream__bar" role="meter" aria-label="Vers Vélo électrique" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100" aria-valuetext="1${S}500,00${S}$ requis · 2${S}500,00${S}$ disponibles">`,
    )
    expect(html).toContain(
      `<h3 id="dream-company">Entreprise</h3><p class="dream__payer">Payé par l&#x27;entreprise</p>`,
    )
  })

  it('shows each rung with its price, where it stands and what it gives, « Acheter » on the next one', () => {
    const html = render(START)
    expect(html).toContain(
      `<li class="dream__rung dream__rung--next"><h4>Vélo électrique</h4><p class="dream__price">1${S}500,00${S}$</p><p class="dream__status">Prochain</p><ul class="dream__lines"><li>Déplacements en ville${S}: −30${S}% de temps</li></ul><button type="button" class="button button--primary" aria-label="Acheter Vélo électrique">Acheter</button></li>`,
    )
    expect(html).toContain(
      `<li class="dream__rung dream__rung--locked"><h4>Voiture d&#x27;occasion</h4><p class="dream__price">8${S}000,00${S}$</p><p class="dream__status">Plus tard</p>`,
    )
    expect(html).toContain(
      `<li class="dream__rung dream__rung--comingSoon"><h4>Deuxième camion</h4><p class="dream__price">85${S}000,00${S}$</p><p class="dream__status">Bientôt</p></li>`,
    )
    expect(html.match(/>Acheter</g)).toHaveLength(2)
  })

  it('disables « Acheter » when the cash falls short', () => {
    const poor = { ...START, personal: { ...START.personal, cash: cents(0) } }
    expect(render(poor)).toContain(
      '<button type="button" class="button button--primary" aria-label="Acheter Vélo électrique" disabled="">Acheter</button>',
    )
  })

  it('asks to confirm with the price, who pays and what the rung gives', () => {
    expect(render(START, 'velo')).toContain(
      `<div class="dream__confirm"><p role="alert">Acheter Vélo électrique? 1${S}500,00${S}$, payé par vous</p><ul class="dream__lines"><li>Déplacements en ville${S}: −30${S}% de temps</li></ul><button type="button" class="button button--primary">Confirmer</button> <button type="button" class="button">Annuler</button></div>`,
    )
  })

  it('shows a rung bought as « Acquis », with no button', () => {
    gameStore.getState().decide({ kind: 'buy', rung: 'velo' })
    const html = render(gameStore.getState().game)
    expect(html).toContain(
      `<li class="dream__rung dream__rung--owned"><h4>Vélo électrique</h4><p class="dream__price">1${S}500,00${S}$</p><p class="dream__status">Acquis</p><ul class="dream__lines"><li>Déplacements en ville${S}: −30${S}% de temps</li></ul></li>`,
    )
  })
})

describe('DreamPanel', () => {
  it('shows the app store’s game in a modal dialog in the dock’s frame, titled « Améliorations »', () => {
    expect(renderToStaticMarkup(<DreamPanel />)).toMatch(
      /^<dialog class="panel dock-frame dock-panel dream" aria-labelledby="([^"]+)"><div class="dock-frame__header"><h2 id="\1" class="dock-frame__title">Améliorations<\/h2>.*<div class="panel__content">.*<\/dialog>$/,
    )
  })

  it('shows a purchase made through the store at once', () => {
    gameStore.getState().decide({ kind: 'buy', rung: 'espresso' })
    expect(renderToStaticMarkup(<DreamPanel />)).toContain(
      '<li class="dream__rung dream__rung--owned"><h4>Machine à espresso pro</h4>',
    )
  })
})
