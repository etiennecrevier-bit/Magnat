import {
  isValidElement,
  type ReactElement,
  type ReactNode,
  type useEffect,
  type useState,
} from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import { allowedChoices } from './engine/challenge.ts'
import { createInitialState, tick } from './engine/clock.ts'
import { DEFIS, EVENTS, FOOD_TRUCK } from './engine/day.ts'
import { serialize } from './engine/save.ts'
import type { GameState } from './engine/types.ts'
import GameScreens from './ui/GameScreens.tsx'
import { readStoredSave, SAVE_KEY, type SaveStorage } from './ui/saves.ts'
import StartScreen from './ui/StartScreen.tsx'
import { gameStore, newChallenge, type GameStoreState } from './ui/store.ts'

/** The hooks App calls while `mountApp` plays it; React's otherwise. */
const appHooks = vi.hoisted(() => ({
  current: null as {
    useState: typeof useState
    useEffect: typeof useEffect
  } | null,
}))

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  return {
    ...react,
    useState: ((initial: unknown) => {
      const hooks = appHooks.current ?? react
      return hooks.useState(initial)
    }) as typeof react.useState,
    useEffect: ((effect, deps) => {
      const hooks = appHooks.current ?? react
      hooks.useEffect(effect, deps)
    }) as typeof react.useEffect,
  }
})

// A static render reads a Zustand store's initial state, so the connected
// screens read the app store's current state through this stand-in.
vi.mock('./ui/store.ts', async (importOriginal) => {
  const store = await importOriginal<typeof import('./ui/store.ts')>()
  return {
    ...store,
    useGame: <T,>(selector: (state: GameStoreState) => T): T =>
      selector(store.gameStore.getState()),
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  gameStore.setState(gameStore.getInitialState(), true)
})

/**
 * App played outside React, as there is no DOM in these tests: `render()`
 * calls it with hooks that keep its state from one call to the next, then
 * runs each effect whose dependencies changed, after stopping its last run,
 * as React does. `unmount()` stops them all.
 */
function mountApp() {
  const states: unknown[] = []
  const effects: {
    deps: readonly unknown[] | undefined
    stop: void | (() => void)
  }[] = []
  let stateCalls = 0
  let effectCalls = 0
  let toRun: (() => void)[] = []
  const hooks = {
    useState: (initial: unknown) => {
      const index = stateCalls++
      if (!(index in states)) {
        states[index] =
          typeof initial === 'function' ? (initial as () => unknown)() : initial
      }
      const set = (next: unknown) => {
        states[index] =
          typeof next === 'function'
            ? (next as (previous: unknown) => unknown)(states[index])
            : next
      }
      return [states[index], set]
    },
    useEffect: (
      effect: () => void | (() => void),
      deps?: readonly unknown[],
    ) => {
      const index = effectCalls++
      const last = effects[index]
      const same =
        last?.deps !== undefined &&
        deps !== undefined &&
        deps.every((dep, i) => Object.is(dep, last.deps?.[i]))
      if (same) return
      toRun.push(() => {
        last?.stop?.()
        effects[index] = { deps, stop: effect() }
      })
    },
  } as unknown as NonNullable<typeof appHooks.current>
  return {
    render(): ReactNode {
      stateCalls = 0
      effectCalls = 0
      toRun = []
      appHooks.current = hooks
      let tree: ReactNode
      try {
        tree = App()
      } finally {
        appHooks.current = null
      }
      for (const run of toRun) run()
      return tree
    },
    unmount() {
      for (const effect of effects) effect.stop?.()
    },
  }
}

/** The first element of `type` in `node` or its children, if any. */
function find<P>(
  node: ReactNode,
  type: (props: P) => ReactNode,
): ReactElement<P> | undefined {
  if (Array.isArray(node)) {
    for (const child of node as ReactNode[]) {
      const found = find(child, type)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (!isValidElement(node)) return undefined
  if (node.type === type) return node as ReactElement<P>
  return find((node.props as { children?: ReactNode }).children, type)
}

/**
 * Plays the app store's Défi to its end as the player would: reading each
 * report, and on each event card, taking the first choice the Défi allows.
 */
function playDefiToTheEnd() {
  for (let turn = 0; turn < 100; turn++) {
    const { game, panel, advance, closePanel, chooseEvent } =
      gameStore.getState()
    if (panel === 'defiEnd') return
    const { pending } = game.events
    if (pending !== null) {
      const allowed = allowedChoices(game, DEFIS)
      const choice = EVENTS.events
        .find((event) => event.id === pending.event)
        ?.choices.find(({ id }) => allowed?.includes(id) ?? true)
      if (choice === undefined) throw new Error(`No choice on ${pending.event}`)
      chooseEvent(choice.id)
    } else if (panel !== null) {
      closePanel()
    } else {
      advance(7)
    }
  }
}

describe('App', () => {
  it('opens on the start screen over the world, with no top bar yet', () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem: () => {} },
      location: { search: '' },
    })
    const html = renderToStaticMarkup(<App />)
    expect(html).toMatch(
      /^<div class="world" aria-hidden="true"><\/div><main><section class="start-screen"[^>]*><h1[^>]*>Magnat<\/h1>.*<\/section><\/main>$/,
    )
    expect(html).toContain('Nouvelle partie')
    expect(html).not.toContain('class="top-bar"')
    expect(html).not.toContain('class="screen-nav"')
  })

  it('goes back to the start screen after a Défi, where « Continuer » still offers the long game', () => {
    const longGame = createInitialState(7, FOOD_TRUCK, {
      businessName: 'Chez Ginette',
      avatar: 'femme',
      difficulty: 'moyen',
    })
    const saved = serialize(longGame)
    const items: Record<string, string> = { [SAVE_KEY]: saved }
    const storage: SaveStorage = {
      getItem: (key) => items[key] ?? null,
      setItem: (key, value) => {
        items[key] = value
      },
    }
    const page = {
      hidden: false,
      listeners: new Set<() => void>(),
      addEventListener(_: string, listener: () => void) {
        this.listeners.add(listener)
      },
      removeEventListener(_: string, listener: () => void) {
        this.listeners.delete(listener)
      },
    }
    vi.stubGlobal('window', {
      localStorage: storage,
      location: { search: '' },
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {},
    })
    vi.stubGlobal('document', page)
    const hideTab = () => {
      page.hidden = true
      for (const listener of [...page.listeners]) listener()
      page.hidden = false
      for (const listener of [...page.listeners]) listener()
    }
    const app = mountApp()

    const menu = find(app.render(), StartScreen)
    expect(renderToStaticMarkup(menu)).toContain('Continuer')

    // « Commencer » on « Les travaux de la rue Saint-Denis », played to its
    // end past June 1st, with the tab hidden on the way: the autosave runs.
    menu?.props.onStart(newChallenge('?seed=7', 'travauxSaintDenis'))
    let tree = app.render()
    expect(find(tree, StartScreen)).toBeUndefined()
    const screens = find(tree, GameScreens)
    expect(page.listeners.size).toBeGreaterThan(0)
    playDefiToTheEnd()
    hideTab()
    expect(gameStore.getState().panel).toBe('defiEnd')
    expect(renderToStaticMarkup(screens)).toContain('Retour au menu')

    screens?.props.onMenu()
    tree = app.render()
    expect(find(tree, GameScreens)).toBeUndefined()
    const back = find(tree, StartScreen)
    expect(renderToStaticMarkup(back)).toMatch(
      /Continuer<\/button><p [^>]*>Chez Ginette, /,
    )
    expect(items[SAVE_KEY]).toBe(saved)
    // The day loop and the autosave stopped with the Défi.
    expect(page.listeners.size).toBe(0)

    // « Continuer » plays the long game, untouched.
    const stored = readStoredSave(storage)
    expect(stored).toEqual({ status: 'found', game: longGame })
    if (stored.status === 'found') back?.props.onStart(stored.game)
    tree = app.render()
    expect(find(tree, GameScreens)).toBeDefined()
    expect(gameStore.getState().game).toEqual(longGame)
    expect(gameStore.getState().panel).not.toBe('defiEnd')
    app.unmount()
  })

  it.each([
    ['another game', () => createInitialState(8)],
    [
      'an earlier day of the same game, after the last saved one',
      (played: GameState) => tick(tick(played)),
    ],
  ])(
    'saves %s imported from « Réglages » at once, over what another tab saved since',
    (_, importedFrom) => {
      const items: Record<string, string> = {}
      const storage: SaveStorage = {
        getItem: (key) => items[key] ?? null,
        setItem: (key, value) => {
          items[key] = value
        },
      }
      vi.stubGlobal('window', {
        localStorage: storage,
        location: { search: '' },
        requestAnimationFrame: () => 1,
        cancelAnimationFrame: () => {},
      })
      vi.stubGlobal('document', {
        hidden: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      })
      const app = mountApp()
      const played = createInitialState(7, FOOD_TRUCK, {
        businessName: 'Chez Ginette',
        avatar: 'femme',
        difficulty: 'moyen',
      })
      find(app.render(), StartScreen)?.props.onStart(played)
      app.render()
      gameStore.getState().advance(5)
      expect(readStoredSave(storage)).toEqual({ status: 'found', game: played })
      // Another tab plays the same game further and saves it.
      items[SAVE_KEY] = serialize({ ...played, day: 9 })

      // What « Importer une partie » does with a game of the same month.
      const imported = importedFrom(played)
      gameStore.getState().openPanel('settings')
      gameStore.getState().startGame(imported)
      expect(readStoredSave(storage)).toEqual({
        status: 'found',
        game: imported,
      })

      const tree = app.render()
      expect(find(tree, GameScreens)?.props.autosaveFailed).toBe(false)
      expect(gameStore.getState().panel).toBeNull()
      app.unmount()
    },
  )
})
