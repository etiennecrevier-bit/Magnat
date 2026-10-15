import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { createInitialState } from '../engine/clock.ts'
import type { Headlines } from './headlines.ts'
import { gameStore } from './store.ts'
import Ticker, { TickerView } from './Ticker.tsx'

afterEach(() => {
  gameStore.setState(gameStore.getInitialState(), true)
})

const HEADLINES: Headlines = {
  events: new Map([['essai', 'Une carte d’essai fait la une.']]),
  general: ['La Ville exige un 14e formulaire.', 'Il fait beau.'],
}

describe('TickerView', () => {
  it('is a labelled bar with the paper and the headline', () => {
    expect(renderToStaticMarkup(<TickerView text="Il fait beau." />)).toBe(
      '<aside class="ticker" aria-label="La Presse-Citron"><p class="ticker__paper" aria-hidden="true">La Presse-Citron</p><p class="ticker__text">Il fait beau.</p></aside>',
    )
  })
})

describe('Ticker', () => {
  it('shows nothing without headlines', () => {
    expect(renderToStaticMarkup(<Ticker headlines={null} />)).toBe('')
  })

  it('starts on the general headline picked', () => {
    const html = renderToStaticMarkup(
      <Ticker headlines={HEADLINES} random={() => 0.5} />,
    )
    expect(html).toContain('<p class="ticker__text">Il fait beau.</p>')
  })

  it('starts on a headline queued today', () => {
    const game = createInitialState(1)
    gameStore.getState().startGame({
      ...game,
      day: 4,
      events: { ...game.events, headlines: [{ day: 4, id: 'essai' }] },
    })
    const html = renderToStaticMarkup(
      <Ticker headlines={HEADLINES} random={() => 0} />,
    )
    expect(html).toContain('Une carte d’essai fait la une.')
  })
})
