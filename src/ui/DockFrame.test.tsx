import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DockDrawer, FrameHeader } from './DockFrame.tsx'
import { CITY_TABS } from './dockFrame.ts'

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
        '<button id="b-tab-trip" type="button" role="tab" class="tab" aria-selected="false" aria-controls="b" tabindex="-1">Aller à…</button>' +
        '<button id="b-tab-contracts" type="button" role="tab" class="tab on" aria-selected="true" aria-controls="b" tabindex="0">Contrats</button>' +
        '</div>' +
        '<button type="button" class="dock-frame__close" aria-label="Fermer"><span aria-hidden="true">✕</span></button></div>',
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
      '<div class="dock-frame__header"><h2 id="t" class="dock-frame__title">Camion</h2><button type="button" class="dock-frame__close" aria-label="Fermer"><span aria-hidden="true">✕</span></button></div>',
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
          { props: { children: { props: { onClick: () => void } }[] } },
          { props: { onClick: () => void } },
        ]
      }
    ).children
    tabs.props.children[1]!.props.onClick()
    close.props.onClick()
    expect(onTab).toHaveBeenCalledWith('contracts')
    expect(onDismiss).toHaveBeenCalledTimes(1)
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
})
