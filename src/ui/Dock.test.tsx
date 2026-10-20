import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dockItems, type DockBadges, type DockItem } from './dock.ts'
import Dock, { DockView } from './Dock.tsx'
import { gameStore, newChallenge, type GameStoreState } from './store.ts'

// A static render reads a Zustand store's initial state, so the dock reads
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

function render(
  open: DockItem['id'] | null = null,
  badges: DockBadges = {},
  items = dockItems(false),
) {
  return renderToStaticMarkup(
    <DockView
      items={items}
      isOpen={(item) => item.id === open}
      badges={badges}
      onActivate={() => {}}
    />,
  )
}

/** Each button's opening tag, in order. */
function buttons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>/g)].map(([tag]) => tag)
}

describe('DockView', () => {
  it('is a labelled list of buttons, each with an icon and a word', () => {
    const html = render()
    expect(html).toMatch(
      /^<nav class="dock" aria-label="Panneaux"><ul class="dock__items"><li class="dock__item"><button type="button" id="dock-camion" class="dock__button" aria-haspopup="dialog" aria-expanded="false" aria-keyshortcuts="C" aria-describedby="[^"]+"><span class="dock__tile"><svg class="icon" width="28" height="28"[^>]*>.*?<\/svg><\/span><span class="dock__label">Camion<\/span><\/button>/,
    )
    expect(html).toMatch(/<\/ul><\/nav>$/)
  })

  it('puts the divider before « Journal »', () => {
    expect(render()).toContain(
      '<li class="dock__item dock__item--divided"><button type="button" id="dock-journal"',
    )
  })

  it('names each key in its tooltip and in aria-keyshortcuts, « Réglages » having none', () => {
    const html = render()
    for (const [label, key] of [
      ['Camion', 'C'],
      ['Équipe', 'E'],
      ['Ville', 'V'],
      ['Finances', 'F'],
      ['Améliorations', 'A'],
      ['Journal', 'J'],
    ]) {
      expect(html).toContain(
        `<p class="tip__title">${label}</p><p class="tip__text">Touche ${key}</p>`,
      )
    }
    expect(html).toContain('<p class="tip__title">Réglages</p></div>')
    const reglages = buttons(html).find((tag) => tag.includes('dock-reglages'))
    expect(reglages).not.toContain('aria-keyshortcuts')
  })

  it('shows the open one in ink, expanded', () => {
    const html = render('finances')
    const open = buttons(html).filter((tag) =>
      tag.includes('aria-expanded="true"'),
    )
    expect(open).toEqual([
      expect.stringContaining(
        'id="dock-finances" class="dock__button dock__button--open"',
      ),
    ])
  })

  it('shows a red count, read as waiting, on a button where something waits', () => {
    const html = render(null, { journal: 2, finances: 1 })
    expect(html).toMatch(
      /id="dock-journal"[^>]*><span class="dock__tile"><svg[^>]*>.*?<\/svg><span class="dock__badge">2<span class="visually-hidden"> en attente<\/span><\/span><\/span>/,
    )
    expect(html).toMatch(
      /id="dock-finances"[^>]*><span class="dock__tile"><svg[^>]*>.*?<\/svg><span class="dock__badge">1<span class="visually-hidden"> en attente<\/span><\/span><\/span>/,
    )
    expect(render()).not.toContain('dock__badge')
  })

  it('calls onActivate with the button pressed', () => {
    const onActivate = vi.fn()
    const items = dockItems(false)
    const view = DockView({
      items,
      isOpen: () => false,
      badges: {},
      onActivate,
    })
    const list = (
      view.props as { children: { props: { children: unknown[] } } }
    ).children.props.children as {
      props: {
        children: {
          props: {
            children: (anchor: object) => { props: { onClick: () => void } }
          }
        }
      }
    }[]
    list[3]!.props.children.props.children({}).props.onClick()
    expect(onActivate).toHaveBeenCalledWith(items[3])
  })
})

describe('Dock', () => {
  it('shows the app store’s game: seven buttons, none open, no count', () => {
    const html = renderToStaticMarkup(<Dock />)
    expect(buttons(html)).toHaveLength(7)
    expect(html).not.toContain('aria-expanded="true"')
    expect(html).not.toContain('dock__badge')
  })

  it('hides « Ville » and « Améliorations » in a Défi', () => {
    gameStore.getState().startGame(newChallenge('?seed=7', 'travauxSaintDenis'))
    const html = renderToStaticMarkup(<Dock />)
    expect(buttons(html)).toHaveLength(5)
    expect(html).not.toContain('dock-ville')
    expect(html).not.toContain('dock-ameliorations')
  })

  it('counts the reports not read on « Journal », and shows the drawer open', () => {
    gameStore.setState({ unreadReports: 3 })
    expect(renderToStaticMarkup(<Dock />)).toContain(
      '<span class="dock__badge">3<span class="visually-hidden"> en attente</span></span>',
    )
    gameStore.getState().openDrawer('journal')
    const html = renderToStaticMarkup(<Dock />)
    expect(html).not.toContain('dock__badge')
    expect(html).toContain(
      'id="dock-journal" class="dock__button dock__button--open" aria-haspopup="dialog" aria-expanded="true"',
    )
  })

  it('shows the panel open as open', () => {
    gameStore.getState().openPanel('staff')
    expect(renderToStaticMarkup(<Dock />)).toContain(
      'id="dock-equipe" class="dock__button dock__button--open"',
    )
  })
})
