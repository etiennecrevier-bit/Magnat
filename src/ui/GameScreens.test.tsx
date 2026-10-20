import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import { applyDecision } from '../engine/decisions.ts'
import { cents } from '../engine/money.ts'
import { defaultProfile } from '../engine/profile.ts'
import type { GameState } from '../engine/types.ts'
import GameScreens from './GameScreens.tsx'
import {
  createSettingsStore,
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  type SettingsStorage,
} from './settings.ts'
import {
  gameStore,
  newChallenge,
  PAUSED,
  type GameStoreState,
} from './store.ts'

// A static render reads a Zustand store's initial state, so the shell reads
// the app store's current state through this stand-in.
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

/** A storage holding `items`, as the browser's after a reload. */
function memory(items: Record<string, string> = {}): SettingsStorage {
  return {
    getItem: (key) => items[key] ?? null,
    setItem: (key, value) => {
      items[key] = value
    },
  }
}

const MESSAGES =
  '<section class="messages" role="log" aria-label="Messages"></section>'

const AUTOSAVE_FAILED =
  '<p class="notice" role="status">La sauvegarde automatique a échoué. Exportez la partie dans les Réglages pour ne pas la perdre.</p>'

function render(settings = createSettingsStore(null), autosaveFailed = false) {
  return renderToStaticMarkup(
    <GameScreens
      onMenu={() => {}}
      settings={settings}
      autosaveFailed={autosaveFailed}
    />,
  )
}

/** The words under the dock's buttons, in order. */
function dock(html: string): string[] {
  return [...html.matchAll(/<span class="dock__label">([^<]*)<\/span>/g)].map(
    ([, label]) => label!,
  )
}

/** The speed the store runs at, which the drawers and panels leave or stop. */
const speed = () => gameStore.getState().speed

describe('GameScreens', () => {
  it('has the messages top centre, the week’s card, « Hier », the dock, the drawers closed and the ticker, and no screens', () => {
    const html = render()
    expect(html).toMatch(
      new RegExp(
        `^<div class="shell__notices">${MESSAGES}</div>` +
          '<div class="week-slide-in" role="status"></div>' +
          '<div class="yesterday-spot"><section class="yesterday" aria-label="Hier">.*?</section></div>' +
          '<nav class="dock" aria-label="Panneaux">.*?</nav>' +
          '<section class="dock-frame dock-drawer finances-drawer" role="dialog" aria-modal="false" aria-labelledby="[^"]+" hidden="">.*?</section>' +
          '<section class="dock-frame dock-drawer journal-drawer" role="dialog" aria-modal="false" aria-labelledby="[^"]+" hidden="">.*?</section>' +
          '(<aside class="ticker" aria-label="La Presse-Citron">.*</aside>)?$',
      ),
    )
    for (const gone of ['<main', 'screen-nav', 'Replier', 'screens-strip']) {
      expect(html).not.toContain(gone)
    }
  })

  it('has nothing in a drawer until it was opened once', () => {
    expect(render()).toMatch(
      /<div id="[^"]+" class="dock-frame__body" role="tabpanel" aria-labelledby="[^"]+-tab-today"><\/div><\/section>/,
    )
  })

  it('tells the player to export when the autosave fails', () => {
    expect(render(createSettingsStore(null), true)).toMatch(
      new RegExp(
        `^<div class="shell__notices">${AUTOSAVE_FAILED}${MESSAGES}</div>`,
      ),
    )
  })

  it('shows the dock’s seven buttons, and five in a Défi', () => {
    expect(dock(render())).toEqual([
      'Camion',
      'Équipe',
      'Ville',
      'Finances',
      'Améliorations',
      'Journal',
      'Réglages',
    ])
    gameStore.getState().startGame(newChallenge('?seed=7', 'travauxSaintDenis'))
    expect(dock(render())).toEqual([
      'Camion',
      'Équipe',
      'Finances',
      'Journal',
      'Réglages',
    ])
  })

  it('shows « Hier » hidden down to its pill after a reload when the player hid it', () => {
    const storage = memory()
    createSettingsStore(storage).getState().setScreensFolded(true)
    const html = render(createSettingsStore(storage))
    expect(html).toContain(
      '<div class="yesterday-spot"><button type="button" class="yesterday-pill" aria-expanded="false" aria-keyshortcuts="R"',
    )
    expect(html).not.toContain('<section class="yesterday"')
  })

  it('shows « Hier » when the player showed it again, or never hid it', () => {
    const storage = memory({
      [SETTINGS_KEY]: JSON.stringify({
        ...DEFAULT_SETTINGS,
        screensFolded: true,
      }),
    })
    createSettingsStore(storage).getState().setScreensFolded(false)
    for (const settings of [
      createSettingsStore(storage),
      createSettingsStore(memory()),
    ]) {
      expect(render(settings)).toContain(
        '<div class="yesterday-spot"><section class="yesterday" aria-label="Hier">',
      )
    }
  })

  it('shows « Finances » open, its « Aujourd’hui » on, without pausing the game', () => {
    gameStore.getState().setSpeed(3)
    gameStore.getState().openDrawer('finances')
    const html = render()
    expect(html).toMatch(
      /<section class="dock-frame dock-drawer finances-drawer" role="dialog" aria-modal="false" aria-labelledby="([^"]+)"><div class="dock-frame__header"><h2 id="\1" class="dock-frame__title">Finances<\/h2>/,
    )
    expect(html).toContain(
      '<span class="net-worth-gauge__label">Valeur nette</span>',
    )
    expect(html).toContain('<section class="today"><h1>Aujourd&#x27;hui</h1>')
    expect(html).toContain(
      '<button type="button" id="dock-finances" class="dock__button dock__button--open" aria-haspopup="dialog" aria-expanded="true"',
    )
    expect(speed()).toBe(3)
  })

  it.each([
    ['personal', 'class="finances"'],
    ['statements', '<section class="statements"><h1>États financiers</h1>'],
  ] as const)('shows the « %s » tab of « Finances »', (tab, shows) => {
    gameStore.getState().openDrawer('finances', tab)
    expect(render()).toContain(shows)
  })

  it('shows « Contrats » in « Finances » only in a Défi', () => {
    gameStore.getState().openDrawer('finances', 'contracts')
    const html = render()
    expect(html).not.toContain('<section class="contracts">')
    expect(html).not.toContain('>Contrats</button>')
    gameStore.getState().startGame(newChallenge('?seed=7', 'travauxSaintDenis'))
    gameStore.getState().openDrawer('finances', 'contracts')
    expect(render()).toContain('<section class="contracts"><h1>Contrats</h1>')
  })

  it.each([
    ['events', '<section class="event-log"><h1>Journal des événements</h1>'],
    ['reports', '<section class="week-reports"><h1>Bilans</h1>'],
  ] as const)(
    'shows the « %s » tab of « Journal », without pausing',
    (tab, shows) => {
      gameStore.getState().openDrawer('journal', tab)
      const html = render()
      expect(html).toMatch(
        /<section class="dock-frame dock-drawer journal-drawer" role="dialog" aria-modal="false" aria-labelledby="[^"]+"><div class="dock-frame__header">/,
      )
      expect(html).toContain(shows)
      expect(speed()).toBe(1)
    },
  )

  it.each([
    ['manage', 'manage', 'Le camion'],
    ['staff', 'staff', 'Équipe'],
    ['trip', 'trip', 'Ville'],
    ['dream', 'dream', 'Améliorations'],
    ['settings', 'settings-panel', 'Réglages'],
  ] as const)(
    'shows the %s panel in the dock’s frame while it is open, paused',
    (panel, className, title) => {
      gameStore.getState().setSpeed(3)
      expect(render()).not.toContain('<dialog')
      gameStore.getState().openPanel(panel)
      const html = render()
      expect(html).toMatch(
        new RegExp(
          `<dialog class="panel dock-frame dock-panel ${className}" aria-labelledby="([^"]+)"><div class="dock-frame__header"><h2 id="\\1" class="dock-frame__title">${title}</h2>.*</dialog>$`,
        ),
      )
      expect(speed()).toBe(PAUSED)
      gameStore.getState().closePanel()
      expect(render()).not.toContain('<dialog')
      expect(speed()).toBe(3)
    },
  )

  it('shows the Défi’s panel centred, as before', () => {
    gameStore.getState().startGame(newChallenge('?seed=7', 'travauxSaintDenis'))
    gameStore.getState().openPanel('defi')
    expect(render()).toMatch(
      /<dialog class="panel defi-panel" aria-labelledby="defi-title">.*<\/dialog>$/,
    )
  })

  it('shows the Bilan de la semaine on the first Monday, paused, over a drawer', () => {
    gameStore.getState().startGame(createInitialState(1))
    gameStore.getState().openDrawer('journal')
    gameStore.getState().advance(10)
    const html = render()
    expect(html).toMatch(
      /<dialog class="panel weekly-report-panel" aria-labelledby="weekly-report-title">.*<\/dialog>$/,
    )
    expect(html).toMatch(
      /<section class="dock-frame dock-drawer journal-drawer"[^>]*aria-labelledby="[^"]+">/,
    )
    expect(speed()).toBe(PAUSED)
  })

  it('shows the event card while an event waits, paused', () => {
    const game = createInitialState(1)
    gameStore.getState().startGame({
      ...game,
      events: { ...game.events, pending: { event: 'essai', followUp: false } },
    })
    expect(render()).toMatch(
      /<dialog class="panel event-card" aria-labelledby="event-title">.*<\/dialog>$/,
    )
    expect(speed()).toBe(PAUSED)
  })

  it('shows « Magnat » when the store opens it', () => {
    gameStore.setState({ panel: 'magnat', resumeSpeed: 1, speed: 0 })
    expect(render()).toMatch(
      /<dialog class="panel magnat" aria-labelledby="magnat-title">.*<h2 id="magnat-title" tabindex="-1">Magnat<\/h2>.*<\/dialog>$/,
    )
  })

  it('shows the « Faillite » over them once the game went bankrupt (#160)', () => {
    // Seed 7 at Difficile, its owner paying themself 3 000 $ a week.
    let game: GameState = applyDecision(
      createInitialState(7, FOOD_TRUCK, {
        ...defaultProfile(),
        difficulty: 'difficile',
      }),
      { kind: 'ownerWeeklyPay', pay: cents(300_000) },
    )
    while (game.ended === null) game = tick(game)
    gameStore.getState().startGame(game)
    expect(gameStore.getState().panel).toBe('bankruptcy')
    const html = render()
    expect(html).toMatch(
      /<dialog class="panel bankruptcy-end" aria-labelledby="bankruptcy-title">.*<\/dialog>$/,
    )
    expect(html).not.toContain('defi-end')
  })
})
