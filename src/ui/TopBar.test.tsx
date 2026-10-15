import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../engine/clock.ts'
import { cents } from '../engine/money.ts'
import { gameStore, type GameStoreState } from './store.ts'
import TopBar, { TopBarView } from './TopBar.tsx'

// A static render reads a Zustand store's initial state, so the connected
// top bar reads the app store's current state through this stand-in.
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

function render(
  day: number,
  speed: number,
  cash = cents(1_000_000),
  businessName = "Le P'tit Camion",
  energy = 100,
) {
  return renderToStaticMarkup(
    <TopBarView
      businessName={businessName}
      day={day}
      cash={cash}
      energy={energy}
      avatar="homme"
      speed={speed}
      onSpeedChange={() => {}}
      onManage={() => {}}
      onFinances={() => {}}
    />,
  )
}

/** Each button's accessible label and pressed state, in order. */
function buttons(html: string) {
  return [...html.matchAll(/<button[^>]*>/g)].map(([tag]) => ({
    label: /aria-label="([^"]*)"/.exec(tag)?.[1],
    pressed: /aria-pressed="([^"]*)"/.exec(tag)?.[1],
  }))
}

describe('TopBarView', () => {
  it('shows the game date in French', () => {
    expect(render(244, 1)).toContain(
      '<p class="top-bar__date">Dimanche 31 décembre, an 1</p>',
    )
  })

  it('shows the business name above the date', () => {
    expect(render(0, 1, cents(0), 'Chez Mimi')).toMatch(
      /^<header class="top-bar"><div class="top-bar__title"><p class="top-bar__name">Chez Mimi<\/p><p class="top-bar__date">Lundi 1er mai, an 1<\/p><\/div>/,
    )
  })

  it('shows the cash gauge, then the energy gauge, between the date and the buttons', () => {
    const html = render(0, 1, cents(-12_345), "Le P'tit Camion", 30)
    expect(html).toMatch(
      /^<header class="top-bar"><div class="top-bar__title">.*<\/div><div class="top-bar__gauges"><p class="cash-gauge cash-gauge--negative">.*<\/p><p class="energy-gauge energy-gauge--tired">.*<\/p><\/div><div class="top-bar__panels"><button/,
    )
    expect(html).toContain(`-123,45${S}$`)
    expect(html).toContain('Fatigué')
  })

  it('has buttons that open the Gérer le camion and Vos finances dialogs, before the speeds', () => {
    expect(render(0, 1)).toContain(
      '<div class="top-bar__panels"><button type="button" class="top-bar__panel" aria-haspopup="dialog">Gérer le camion</button><button type="button" class="top-bar__panel" aria-haspopup="dialog">Vos finances</button></div><div class="top-bar__speeds"',
    )
  })

  it('has a labelled group of pause and speed buttons', () => {
    const html = render(0, 1)
    expect(html).toContain('role="group" aria-label="Vitesse du jeu"')
    expect(
      buttons(html)
        .filter(({ pressed }) => pressed !== undefined)
        .map(({ label }) => label),
    ).toEqual(['Pause', 'Vitesse normale', 'Vitesse ×3', 'Vitesse ×10'])
    expect(html).not.toMatch(/<button(?![^>]*type="button")/)
  })

  it.each([
    { speed: 0, active: 'Pause' },
    { speed: 1, active: 'Vitesse normale' },
    { speed: 10, active: 'Vitesse ×10' },
  ])('marks only $active as pressed', ({ speed, active }) => {
    const speeds = buttons(render(0, speed)).filter(
      ({ pressed }) => pressed !== undefined,
    )
    expect(speeds).toHaveLength(4)
    for (const { label, pressed } of speeds) {
      expect(pressed).toBe(label === active ? 'true' : 'false')
    }
  })
})

describe('TopBar', () => {
  it("shows the app store: the profile's name, day 0 at normal speed, with the starting cash and a rested owner", () => {
    const html = renderToStaticMarkup(<TopBar />)
    expect(html).toContain('<p class="top-bar__name">Le P&#x27;tit Camion</p>')
    expect(html).toContain('Lundi 1er mai, an 1')
    expect(html).toContain('cash-gauge--healthy')
    expect(html).toContain(`10${S}000,00${S}$`)
    expect(html).toContain('Saine')
    // The default avatar is a woman's, so the word agrees with her.
    expect(html).toContain('energy-gauge--rested')
    expect(html).toContain('aria-valuenow="100" aria-valuetext="Reposée"')
    expect(buttons(html).find(({ pressed }) => pressed === 'true')).toEqual({
      label: 'Vitesse normale',
      pressed: 'true',
    })
  })

  it('shows the Gérer le camion panel only while it is open, paused', () => {
    gameStore.getState().setSpeed(3)
    expect(renderToStaticMarkup(<TopBar />)).not.toContain('<dialog')

    gameStore.getState().openPanel('manage')
    const html = renderToStaticMarkup(<TopBar />)
    expect(html).toMatch(
      /^<header class="top-bar">.*<\/header><dialog class="panel manage" aria-labelledby="manage-title">.*<\/dialog>$/,
    )
    expect(buttons(html).find(({ pressed }) => pressed === 'true')).toEqual({
      label: 'Pause',
      pressed: 'true',
    })

    gameStore.getState().closePanel()
    const closed = renderToStaticMarkup(<TopBar />)
    expect(closed).not.toContain('<dialog')
    expect(closed).toContain('aria-label="Vitesse ×3" aria-pressed="true"')
  })

  it('shows the Vos finances panel only while it is open, paused', () => {
    gameStore.getState().setSpeed(10)
    gameStore.getState().openPanel('finances')
    const html = renderToStaticMarkup(<TopBar />)
    expect(html).toMatch(
      /^<header class="top-bar">.*<\/header><dialog class="panel finances" aria-labelledby="finances-title">.*<\/dialog>$/,
    )
    expect(html).not.toContain('manage-title')
    expect(buttons(html).find(({ pressed }) => pressed === 'true')).toEqual({
      label: 'Pause',
      pressed: 'true',
    })

    gameStore.getState().closePanel()
    const closed = renderToStaticMarkup(<TopBar />)
    expect(closed).not.toContain('<dialog')
    expect(closed).toContain('aria-label="Vitesse ×10" aria-pressed="true"')
  })

  it('shows the event card while an event waits, paused', () => {
    const game = createInitialState(1)
    gameStore.getState().startGame({
      ...game,
      events: { ...game.events, pending: { event: 'essai', followUp: false } },
    })
    const html = renderToStaticMarkup(<TopBar />)
    expect(html).toMatch(
      /^<header class="top-bar">.*<\/header><dialog class="panel event-card" aria-labelledby="event-title">.*<\/dialog>$/,
    )
    expect(buttons(html).find(({ pressed }) => pressed === 'true')).toEqual({
      label: 'Pause',
      pressed: 'true',
    })
  })
})
