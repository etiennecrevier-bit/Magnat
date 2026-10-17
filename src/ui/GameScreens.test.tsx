import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import { applyDecision } from '../engine/decisions.ts'
import { cents } from '../engine/money.ts'
import { defaultProfile } from '../engine/profile.ts'
import type { GameState } from '../engine/types.ts'
import GameScreens, { GameScreensView, type Screen } from './GameScreens.tsx'
import ScreensStrip from './ScreensStrip.tsx'
import {
  createSettingsStore,
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  type SettingsStorage,
} from './settings.ts'
import { gameStore, type GameStoreState } from './store.ts'

// A static render reads a Zustand store's initial state, so the screens
// read the app store's current state through this stand-in.
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

function render(screen: Screen, autosaveFailed = false, folded = false) {
  return renderToStaticMarkup(
    <GameScreensView
      screen={screen}
      onScreenChange={() => {}}
      autosaveFailed={autosaveFailed}
      folded={folded}
      onFoldChange={() => {}}
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

/** A storage holding `items`, as the browser's after a reload. */
function memory(items: Record<string, string> = {}): SettingsStorage {
  return {
    getItem: (key) => items[key] ?? null,
    setItem: (key, value) => {
      items[key] = value
    },
  }
}

/** `text` as a pattern that matches it and nothing else. */
function literal(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const FOLD_BUTTON =
  '<button type="button" class="button screens__fold" aria-expanded="true" aria-keyshortcuts="R" title="Replier le panneau (touche R)">Replier</button>'

const STRIP =
  '<button type="button" class="screens-strip" aria-expanded="false" aria-keyshortcuts="R" title="Déplier le panneau (touche R)">'

const MESSAGES =
  '<section class="messages" role="log" aria-label="Messages"></section>'

const AUTOSAVE_FAILED =
  '<p class="notice" role="status">La sauvegarde automatique a échoué. Exportez la partie dans les Réglages pour ne pas la perdre.</p>'

/** Each screen button's text and pressed state, in order. */
function screenButtons(html: string) {
  const nav = /<nav[^>]*>.*<\/nav>/.exec(html)?.[0] ?? ''
  return [...nav.matchAll(/aria-pressed="(true|false)">([^<]*)</g)].map(
    ([, pressed, label]) => ({ label, pressed }),
  )
}

describe('GameScreensView', () => {
  it("shows the Aujourd'hui panel under a labelled screen menu", () => {
    const html = render('today')
    expect(html).toMatch(
      new RegExp(
        `^<main>${MESSAGES}<nav class="screen-nav" aria-label="Écrans">`,
      ),
    )
    expect(screenButtons(html)).toEqual([
      { label: 'Aujourd&#x27;hui', pressed: 'true' },
      { label: 'États financiers', pressed: 'false' },
      { label: 'Journal des événements', pressed: 'false' },
      { label: 'Bilans', pressed: 'false' },
      { label: 'Contrats', pressed: 'false' },
    ])
    expect(html).toContain('<h1>Aujourd&#x27;hui</h1>')
    expect(html).not.toContain('<h1>États financiers</h1>')
    expect(html).not.toContain('<h1>Journal des événements</h1>')
  })

  it('shows the États financiers screen', () => {
    const html = render('statements')
    expect(screenButtons(html)).toEqual([
      { label: 'Aujourd&#x27;hui', pressed: 'false' },
      { label: 'États financiers', pressed: 'true' },
      { label: 'Journal des événements', pressed: 'false' },
      { label: 'Bilans', pressed: 'false' },
      { label: 'Contrats', pressed: 'false' },
    ])
    expect(html).toContain('<h1>États financiers</h1>')
    expect(html).not.toContain('<h1>Aujourd&#x27;hui</h1>')
  })

  it('shows the Journal des événements screen', () => {
    const html = render('events')
    expect(screenButtons(html)).toEqual([
      { label: 'Aujourd&#x27;hui', pressed: 'false' },
      { label: 'États financiers', pressed: 'false' },
      { label: 'Journal des événements', pressed: 'true' },
      { label: 'Bilans', pressed: 'false' },
      { label: 'Contrats', pressed: 'false' },
    ])
    expect(html).toContain(
      '<section class="event-log"><h1>Journal des événements</h1><p>Aucun événement depuis un an.</p></section>',
    )
    expect(html).not.toContain('<h1>Aujourd&#x27;hui</h1>')
  })

  it('shows the Bilans screen, empty before the first week closes', () => {
    const html = render('reports')
    expect(screenButtons(html)).toEqual([
      { label: 'Aujourd&#x27;hui', pressed: 'false' },
      { label: 'États financiers', pressed: 'false' },
      { label: 'Journal des événements', pressed: 'false' },
      { label: 'Bilans', pressed: 'true' },
      { label: 'Contrats', pressed: 'false' },
    ])
    expect(html).toContain(
      '<section class="week-reports"><h1>Bilans</h1><p>Aucun bilan pour l&#x27;instant.</p></section>',
    )
    expect(html).not.toContain('<h1>Aujourd&#x27;hui</h1>')
  })

  it('shows the Contrats screen, empty before the first contract', () => {
    const html = render('contracts')
    expect(screenButtons(html)).toEqual([
      { label: 'Aujourd&#x27;hui', pressed: 'false' },
      { label: 'États financiers', pressed: 'false' },
      { label: 'Journal des événements', pressed: 'false' },
      { label: 'Bilans', pressed: 'false' },
      { label: 'Contrats', pressed: 'true' },
    ])
    expect(html).toContain(
      '<section class="contracts"><h1>Contrats</h1><p>Aucun contrat pour l&#x27;instant.</p></section>',
    )
    expect(html).not.toContain('<h1>Aujourd&#x27;hui</h1>')
  })

  it('has only the screen buttons in its menu, the export being in « Réglages »', () => {
    expect(render('today')).toMatch(
      /<nav class="screen-nav" aria-label="Écrans"><div class="toggle-group">(<button [^>]*>[^<]*<\/button>){5}<\/div><\/nav>/,
    )
    expect(render('today')).not.toContain('Exporter')
  })

  it.each<[Screen, string]>([
    ['today', 'today'],
    ['statements', 'statements'],
    ['events', 'event-log'],
    ['reports', 'week-reports'],
    ['contracts', 'contracts'],
  ])(
    'puts « Replier » before the %s screen, its tooltip naming the key, in a part that is not hidden',
    (screen, section) => {
      expect(render(screen)).toContain(
        `</nav><div class="screens__screen">${FOLD_BUTTON}<section class="${section}"><h1>`,
      )
    },
  )

  it.each<[Screen, string]>([
    ['today', 'Aujourd&#x27;hui'],
    ['statements', 'États financiers'],
    ['events', 'Journal des événements'],
    ['reports', 'Bilans'],
    ['contracts', 'Contrats'],
  ])(
    'folded on %s, shows the strip with its badge in place of the menu, and hides the screen',
    (screen, badge) => {
      const html = render(screen, false, true)
      expect(html).toMatch(
        new RegExp(
          `^<main class="screens--folded">${MESSAGES}${literal(STRIP)}`,
        ),
      )
      expect(html).toContain(
        `<span class="screens-strip__screen">${badge}</span>`,
      )
      expect(html).not.toContain('<nav')
      expect(html).not.toContain('Replier')
      // Still on the page, so the screen keeps what the player picked in
      // it, such as a statement and its period, for when it unfolds.
      expect(html).toMatch(
        /<\/button><div class="screens__screen" hidden=""><section class="[^"]+"><h1>[^<]+<\/h1>.*<\/div><\/main>$/,
      )
    },
  )

  it('keeps the autosave notice and the messages above the strip', () => {
    expect(render('today', true, true)).toMatch(
      new RegExp(
        `^<main class="screens--folded">${AUTOSAVE_FAILED}${MESSAGES}${literal(STRIP)}`,
      ),
    )
  })

  it('folds when « Replier » is pressed, and unfolds when the strip is', () => {
    const props = {
      screen: 'today' as const,
      onScreenChange: () => {},
      autosaveFailed: false,
      onFoldChange: vi.fn<(folded: boolean) => void>(),
    }
    const unfolded = elements(GameScreensView({ ...props, folded: false }))
    const replier = unfolded.find(
      (element) =>
        element.type === 'button' &&
        (element.props as { children?: unknown }).children === 'Replier',
    )
    ;(replier?.props as { onClick: () => void }).onClick()
    expect(unfolded.some((element) => element.type === ScreensStrip)).toBe(
      false,
    )

    const folded = elements(GameScreensView({ ...props, folded: true }))
    const strip = folded.find((element) => element.type === ScreensStrip)
    ;(strip?.props as { onUnfold: () => void }).onUnfold()
    expect(props.onFoldChange.mock.calls).toEqual([[true], [false]])
  })

  it('tells the player to export when the autosave fails', () => {
    expect(render('today', true)).toMatch(
      new RegExp(`^<main>${AUTOSAVE_FAILED}${MESSAGES}<nav`),
    )
    expect(render('today', false)).not.toContain('La sauvegarde automatique')
  })
})

describe('GameScreens', () => {
  it("opens on Aujourd'hui, then the week's card and the ticker", () => {
    const html = renderToStaticMarkup(<GameScreens onMenu={() => {}} />)
    expect(html.startsWith(render('today'))).toBe(true)
    // The card's region is empty until a week slides in, and the ticker
    // shows only once there are headlines (see headlines.ts).
    expect(html.slice(render('today').length)).toMatch(
      /^<div class="week-slide-in" role="status"><\/div>(<aside class="ticker" aria-label="La Presse-Citron">.*<\/aside>)?$/,
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
    const html = renderToStaticMarkup(<GameScreens onMenu={() => {}} />)
    expect(html).toMatch(
      /<dialog class="panel bankruptcy-end" aria-labelledby="bankruptcy-title">.*<\/dialog>$/,
    )
    expect(html).not.toContain('defi-end')
  })

  it('passes on a failed autosave', () => {
    expect(
      renderToStaticMarkup(<GameScreens autosaveFailed onMenu={() => {}} />),
    ).toContain(AUTOSAVE_FAILED)
  })

  it('opens folded after a reload when the player folded the screens', () => {
    const storage = memory()
    createSettingsStore(storage).getState().setScreensFolded(true)
    const reloaded = createSettingsStore(storage)
    const html = renderToStaticMarkup(
      <GameScreens onMenu={() => {}} settings={reloaded} />,
    )
    expect(html.startsWith(render('today', false, true))).toBe(true)
  })

  it('opens unfolded when the player unfolded them, or never folded them', () => {
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
      expect(
        renderToStaticMarkup(
          <GameScreens onMenu={() => {}} settings={settings} />,
        ).startsWith(render('today')),
      ).toBe(true)
    }
  })
})
