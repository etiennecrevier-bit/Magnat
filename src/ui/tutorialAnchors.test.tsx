import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EVENTS } from '../engine/day.ts'
import { latestDecisions } from '../engine/decisions.ts'
import { TUTORIAL } from '../engine/tutorial.ts'
import { cents } from '../engine/money.ts'
import { DockView } from './Dock.tsx'
import { dockItems } from './dock.ts'
import { bakeryBoard } from './bakeryBoard.ts'
import { FrameHeader } from './DockFrame.tsx'
import { TRUCK_TABS } from './dockFrame.ts'
import { EventCardView } from './EventCard.tsx'
import { ManagePanelView } from './ManagePanel.tsx'
import { productBoards } from './productFacts.ts'
import { newTutorialGame, type TruckTab } from './store.ts'
import { TopBarView } from './TopBar.tsx'
import { YesterdayView } from './Yesterday.tsx'

// Each anchor tutorial.json points at (#238) is on the element of the
// interface that holds it, by its `data-tuto`.

const topBar = () =>
  renderToStaticMarkup(
    <TopBarView
      businessName="Chez Réal"
      day={0}
      cash={cents(500_000)}
      fixedCosts={cents(175_000)}
      energy={80}
      avatar="homme"
      speed={0}
      onSpeedChange={() => {}}
      defiLabel={null}
      defiEnergy={null}
      onDefi={() => {}}
      onSettings={() => {}}
    />,
  )

const dock = () =>
  renderToStaticMarkup(
    <DockView
      items={dockItems(false)}
      isOpen={() => false}
      badges={{}}
      onActivate={() => {}}
    />,
  )

const yesterday = (folded: boolean) =>
  renderToStaticMarkup(
    <YesterdayView
      numbers={null}
      folded={folded}
      onFoldChange={() => {}}
      onOpen={() => {}}
    />,
  )

const truck = (tab: TruckTab) => {
  const game = newTutorialGame()
  return renderToStaticMarkup(
    <>
      <FrameHeader
        titleId="t"
        title="Le camion"
        tabs={TRUCK_TABS}
        tab={tab}
        bodyId="b"
        onDismiss={() => {}}
      />
      <ManagePanelView
        tab={tab}
        decisions={latestDecisions(game)}
        today={game.decisions}
        products={productBoards(game)}
        locked={[]}
        bakery={bakeryBoard(game)}
        onChange={() => {}}
      />
    </>,
  )
}

const eventCard = () => {
  const game = newTutorialGame()
  const card = EVENTS.events.find(({ id }) => id === 'tutoStory')!
  return renderToStaticMarkup(
    <EventCardView
      card={card}
      difficulty={game.profile.difficulty}
      scaling={EVENTS}
      portrait={null}
      result={null}
      allowed={null}
      onChoose={() => {}}
      onContinue={() => {}}
    />,
  )
}

/** Where each anchor shows: the markup of the component that holds it. */
const HOLDERS: Record<string, () => string> = {
  'dock.camion': dock,
  'dock.finances': dock,
  'speed.0': topBar,
  'speed.1': topBar,
  'speed.3': topBar,
  'cash.chip': topBar,
  yesterday: () => yesterday(false),
  'yesterday.pill': () => yesterday(true),
  'menu.cafe': () => truck('menu'),
  'menu.cafe.price': () => truck('menu'),
  'menu.croissant': () => truck('menu'),
  'tab.menu': () => truck('stocks'),
  'tab.stocks': () => truck('menu'),
  'stocks.croissant': () => truck('stocks'),
  'panel.close': () => truck('menu'),
  'event.choices': eventCard,
  'event.card': eventCard,
}

const ANCHORS = [
  ...new Set(
    TUTORIAL.steps.flatMap(({ anchors, tipAnchors = [] }) => [
      ...anchors,
      ...tipAnchors,
    ]),
  ),
]

describe('the anchors of tutorial.json', () => {
  it('each has a holder in the interface', () => {
    expect(ANCHORS.filter((anchor) => HOLDERS[anchor] === undefined)).toEqual(
      [],
    )
  })

  it.each(ANCHORS)('%s is on the page', (anchor) => {
    expect(HOLDERS[anchor]!()).toContain(`data-tuto="${anchor}"`)
  })

  it('holds the café’s stepper apart from its card, so the hole fits it', () => {
    const html = truck('menu')
    expect(html).toMatch(
      /data-tuto="menu\.cafe"[^>]*>.*<div class="field" data-tuto="menu\.cafe\.price">/,
    )
  })
})
