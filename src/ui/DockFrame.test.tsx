import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DockDrawer, FrameHeader } from './DockFrame.tsx'
import { CITY_TABS } from './dockFrame.ts'

/** Whether `drawerTree` is calling the frame outside React, without hooks. */
const bare = vi.hoisted(() => ({ current: false }))

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  return {
    ...react,
    useId: (() => (bare.current ? 'id' : react.useId())) as typeof react.useId,
    useRef: ((initial: unknown) =>
      bare.current
        ? { current: initial }
        : react.useRef(initial)) as typeof react.useRef,
    useEffect: ((effect, deps) => {
      if (!bare.current) react.useEffect(effect, deps)
    }) as typeof react.useEffect,
    useLayoutEffect: ((effect, deps) => {
      if (!bare.current) react.useLayoutEffect(effect, deps)
    }) as typeof react.useLayoutEffect,
  }
})

describe('FrameHeader', () => {
  it('shows the title, the tabs as pills, the one shown pressed, then « ✕ »', () => {
    expect(
      renderToStaticMarkup(
        <FrameHeader
          titleId="t"
          title="Ville"
          tabs={CITY_TABS}
          tab="contracts"
          onTab={() => {}}
          bodyId="b"
          onDismiss={() => {}}
        />,
      ),
    ).toBe(
      '<div class="dock-frame__header"><h2 id="t" class="dock-frame__title">Ville</h2>' +
        '<div class="dock-frame__tabs" role="tablist" aria-label="Ville">' +
        '<button id="b-tab-trip" type="button" role="tab" class="tab" aria-selected="false" data-tuto="tab.trip" aria-controls="b" tabindex="-1">Aller à…</button>' +
        '<button id="b-tab-contracts" type="button" role="tab" class="tab on" aria-selected="true" data-tuto="tab.contracts" aria-controls="b" tabindex="0">Contrats</button>' +
        '</div>' +
        '<button type="button" class="dock-frame__close" aria-label="Fermer" data-tuto="panel.close"><span aria-hidden="true">✕</span></button></div>',
    )
  })

  it('shows no tabs with fewer than two', () => {
    expect(
      renderToStaticMarkup(
        <FrameHeader
          titleId="t"
          title="Camion"
          bodyId="b"
          onDismiss={() => {}}
        />,
      ),
    ).toBe(
      '<div class="dock-frame__header"><h2 id="t" class="dock-frame__title">Camion</h2><button type="button" class="dock-frame__close" aria-label="Fermer" data-tuto="panel.close"><span aria-hidden="true">✕</span></button></div>',
    )
  })

  it('picks a tab on a click and closes on « ✕ »', () => {
    const onTab = vi.fn()
    const onDismiss = vi.fn()
    const header = FrameHeader({
      titleId: 't',
      title: 'Ville',
      tabs: CITY_TABS,
      tab: 'trip',
      onTab,
      bodyId: 'b',
      onDismiss,
    })
    const [, tabs, close] = (
      header.props as {
        children: [
          unknown,
          {
            props: {
              children: {
                props: {
                  onClick: (event: object) => void
                  onMouseDown: (event: object) => void
                }
              }[]
            }
          },
          {
            props: {
              onClick: () => void
              onMouseDown: (event: object) => void
            }
          },
        ]
      }
    ).children
    const focus = vi.fn()
    tabs.props.children[1]!.props.onClick({ currentTarget: { focus } })
    close.props.onClick()
    expect(onTab).toHaveBeenCalledWith('contracts')
    expect(focus).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
    // A press leaves the focus where it is until the click.
    for (const button of [tabs.props.children[1]!, close]) {
      const preventDefault = vi.fn()
      button.props.onMouseDown({ preventDefault })
      expect(preventDefault).toHaveBeenCalledTimes(1)
    }
  })

  it('leaves the focus where it is when a click on a tab is refused', () => {
    const header = FrameHeader({
      titleId: 't',
      title: 'Ville',
      tabs: CITY_TABS,
      tab: 'trip',
      onTab: () => false,
      bodyId: 'b',
      onDismiss: () => {},
    })
    const [, list] = (
      header.props as {
        children: [
          unknown,
          {
            props: {
              children: { props: { onClick: (event: object) => void } }[]
            }
          },
        ]
      }
    ).children
    const focus = vi.fn()
    list.props.children[1]!.props.onClick({ currentTarget: { focus } })
    expect(focus).not.toHaveBeenCalled()
  })

  it('moves the focus with the arrows only to a tab shown', () => {
    const focus = vi.fn()
    vi.stubGlobal('document', { getElementById: () => ({ focus }) })
    try {
      const keyDown = (onTab: (tab: string) => boolean | void) => {
        const header = FrameHeader({
          titleId: 't',
          title: 'Ville',
          tabs: CITY_TABS,
          tab: 'trip',
          onTab,
          bodyId: 'b',
          onDismiss: () => {},
        })
        const [, list] = (
          header.props as {
            children: [
              unknown,
              { props: { onKeyDown: (event: object) => void } },
            ]
          }
        ).children
        list.props.onKeyDown({ key: 'ArrowRight', preventDefault: () => {} })
      }
      // A tab that holds invalid text keeps it, and the focus goes there.
      const refuse = vi.fn(() => false)
      keyDown(refuse)
      expect(refuse).toHaveBeenCalledWith('contracts')
      expect(focus).not.toHaveBeenCalled()
      keyDown(() => {})
      expect(focus).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('DockDrawer', () => {
  const drawer = (open: boolean) =>
    renderToStaticMarkup(
      <DockDrawer
        open={open}
        className="journal-drawer"
        title="Journal"
        tabs={[
          { id: 'events', label: 'Événements' },
          { id: 'reports', label: 'Bilans' },
        ]}
        tab="events"
        onTab={() => {}}
        onClose={() => {}}
        panelOpen={() => false}
        returnFocus={() => null}
      >
        <p>Dedans</p>
      </DockDrawer>,
    )

  it('is a dialog that is not modal, labelled by its title, its tab’s panel holding what it shows', () => {
    expect(drawer(true)).toMatch(
      /^<section class="dock-frame dock-drawer journal-drawer" role="dialog" aria-modal="false" aria-labelledby="([^"]+)"><div class="dock-frame__header"><h2 id="\1" class="dock-frame__title">Journal<\/h2>.*<\/div><div id="([^"]+)" class="dock-frame__body" role="tabpanel" aria-labelledby="\2-tab-events"><p>Dedans<\/p><\/div><\/section>$/,
    )
  })

  it('stays on the page, hidden, while closed', () => {
    expect(drawer(false)).toMatch(
      /^<section class="dock-frame dock-drawer journal-drawer" role="dialog" aria-modal="false" aria-labelledby="[^"]+" hidden="">/,
    )
  })

  it('gives each tab a body of its own, so a tab opens from its top, not where the last one was scrolled', () => {
    // The body is what scrolls: one shared by the tabs would keep the
    // scroll of « Entreprise » when « Personnel » shows (#228).
    const body = (tab: 'company' | 'personal') => {
      bare.current = true
      try {
        const section = DockDrawer({
          open: true,
          className: 'finances-drawer',
          title: 'Finances',
          tabs: [
            { id: 'company', label: 'Entreprise' },
            { id: 'personal', label: 'Personnel' },
          ],
          tab,
          onTab: () => {},
          onClose: () => {},
          panelOpen: () => false,
          returnFocus: () => null,
          children: null,
        }) as ReactElement<{ children: ReactElement[] }>
        return section.props.children[1]!
      } finally {
        bare.current = false
      }
    }
    const company = body('company')
    const personal = body('personal')
    // React keeps an element, and its scroll, when its type and key stay.
    expect([personal.type, personal.key]).not.toEqual([
      company.type,
      company.key,
    ])
  })
})
