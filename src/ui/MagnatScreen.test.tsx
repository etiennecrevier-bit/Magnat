import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cents } from '../engine/money.ts'
import { netWorth } from '../engine/netWorth.ts'
import { formatMoney } from './formatMoney.ts'
import MagnatScreen, { MagnatScreenView } from './MagnatScreen.tsx'
import { gameStore, type GameStoreState } from './store.ts'

// A static render reads a Zustand store's initial state, so the connected
// screen reads the app store's current state through this stand-in.
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

describe('MagnatScreenView', () => {
  it('shows « Magnat », the business, the net worth reached and « Continuer »', () => {
    expect(
      renderToStaticMarkup(
        <MagnatScreenView
          businessName="Chez Mimi"
          title="Magnat"
          netWorth={cents(100_012_345)}
          onContinue={() => {}}
        />,
      ),
    ).toBe(
      `<div class="panel__content magnat__content"><p class="magnat__business">Chez Mimi</p><h2 id="magnat-title" tabindex="-1">Magnat</h2><p class="magnat__worth">Valeur nette${S}: <span class="magnat__amount">1${S}000${S}123,45${S}$</span></p><button type="button" class="button button--primary">Continuer</button></div>`,
    )
  })
})

describe('MagnatScreen', () => {
  it('shows the app store’s game in a modal dialog', () => {
    const { game } = gameStore.getState()
    const html = renderToStaticMarkup(<MagnatScreen />)
    expect(html).toMatch(
      /^<dialog class="panel magnat" aria-labelledby="magnat-title">.*<\/dialog>$/,
    )
    expect(html).toContain(
      `<p class="magnat__business">${game.profile.businessName.replaceAll("'", '&#x27;')}</p>`,
    )
    expect(html).toContain(formatMoney(netWorth(game)))
  })
})
