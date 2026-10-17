import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { cents } from '../engine/money.ts'
import { netWorthParts, type NetWorthParts } from '../engine/netWorth.ts'
import type { DaySummary } from '../engine/types.ts'
import { gameStore } from './store.ts'
import TodayPanel, { TodayPanelView } from './TodayPanel.tsx'

// Every space in an amount is a no-break space (U+00A0).
const S = '\u00a0'

/** A net worth whose parts are all there: 1 237 530,87 $ in all. */
const WORTH: NetWorthParts = {
  companyShare: cents(98_765_432),
  personalCash: cents(-12_345),
  personalAssets: cents(40_000_000),
  personalDebts: cents(15_000_000),
  total: cents(123_753_087),
}

function render(lastDay: DaySummary | null, netWorth = WORTH) {
  return renderToStaticMarkup(
    <TodayPanelView lastDay={lastDay} netWorth={netWorth} />,
  )
}

/** The « Valeur nette » line's amount, then each part's label and amount. */
function netWorthLines(html: string) {
  const total = /Valeur nette\u00a0: <strong>([^<]*)<\/strong>/.exec(html)?.[1]
  const list = /<ul class="today__net-worth-parts">(.*?)<\/ul>/.exec(html)
  const parts = [...(list?.[1] ?? '').matchAll(/<li>([^<]*)<\/li>/g)].map(
    ([, item = '']) => item.split(`${S}: `),
  )
  return { total, parts }
}

/**
 * Each row of the table's body, the products, or of its foot, the total:
 * its name and the numbers in its cells.
 */
function rows(html: string, part: 'tbody' | 'tfoot' = 'tbody') {
  const section = new RegExp(`<${part}>.*</${part}>`).exec(html)?.[0] ?? ''
  return [
    ...section.matchAll(
      /<tr><th scope="row">([^<]*)<\/th>((?:<td[^>]*>[^<]*<\/td>)*)<\/tr>/g,
    ),
  ].map(([, name, cells = '']) => [
    name,
    ...[...cells.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(([, n]) => n),
  ])
}

describe('TodayPanelView', () => {
  it('says so before the first day is over', () => {
    const html = render(null)
    expect(html).toContain('<h1>Aujourd&#x27;hui</h1>')
    expect(html).toContain(
      'La première journée n&#x27;est pas encore terminée.',
    )
    expect(html).not.toContain('<table')
  })

  it("shows yesterday's units per product and in all, the revenue and the customers served", () => {
    const html = render({
      day: 3,
      sold: { cafe: 87, chocolat: 12, croissant: 54 },
      revenue: cents(123_456),
      lostSales: { cafe: 0, chocolat: 3, croissant: 6 },
      spoiled: { cafe: 2, chocolat: 0, croissant: 10 },
      segments: {
        aubaine: { visits: 30, buyers: 12, tooExpensive: 18, soldOut: 0 },
        habitue: { visits: 60, buyers: 59, tooExpensive: 0, soldOut: 1 },
        chic: { visits: 24, buyers: 24, tooExpensive: 0, soldOut: 0 },
      },
      visits: [
        {
          arrivalMinute: 420,
          segment: 'habitue',
          bought: { cafe: 1, chocolat: 0, croissant: 0 },
          outcome: 'bought',
          servedMinute: 425,
          leftMinute: null,
          botched: 0,
        },
        {
          arrivalMinute: 430,
          segment: 'aubaine',
          bought: { cafe: 0, chocolat: 0, croissant: 0 },
          outcome: 'leftLine',
          servedMinute: null,
          leftMinute: 440,
          botched: 0,
        },
      ],
      leftLine: 1,
      averageWaitSeconds: 0,
      longestWaitSeconds: 0,
      energy: 100,
      botched: 0,
      modifiers: [],
      deliveries: [],
      missed: [],
    })
    expect(html).toContain(`Hier${S}: Jeudi 4 mai, an 1`)
    expect(html).toContain(
      '<tr><th scope="col">Produit</th><th scope="col" class="number">Vendus</th><th scope="col" class="number">Ventes perdues</th><th scope="col" class="number">Périmés</th></tr>',
    )
    expect(rows(html)).toEqual([
      ['Café', '87', '0', '2'],
      ['Chocolat chaud', '12', '3', '0'],
      ['Croissant', '54', '6', '10'],
    ])
    expect(rows(html, 'tfoot')).toEqual([['Total', '153', '9', '12']])
    expect(html).toContain(
      `Chiffre d&#x27;affaires${S}: <strong>1${S}234,56${S}$</strong></p>` +
        `<p>Clients servis${S}: <strong>1</strong></p>`,
    )
  })

  it('shows what the engine reports for a played day', () => {
    // Day 0 is a Monday, closed by default, so day 1 is the first that sells.
    const { lastDay } = tick(tick(createInitialState(42)))
    if (lastDay === null) throw new Error('A played day has a summary')
    const html = render(lastDay)
    expect(rows(html)).toEqual([
      [
        'Café',
        String(lastDay.sold.cafe),
        String(lastDay.lostSales.cafe),
        String(lastDay.spoiled.cafe),
      ],
      [
        'Chocolat chaud',
        String(lastDay.sold.chocolat),
        String(lastDay.lostSales.chocolat),
        String(lastDay.spoiled.chocolat),
      ],
      [
        'Croissant',
        String(lastDay.sold.croissant),
        String(lastDay.lostSales.croissant),
        String(lastDay.spoiled.croissant),
      ],
    ])
    const { sold, lostSales, spoiled } = lastDay
    const total = (units: typeof sold) =>
      String(units.cafe + units.chocolat + units.croissant)
    expect(rows(html, 'tfoot')).toEqual([
      ['Total', total(sold), total(lostSales), total(spoiled)],
    ])
    expect(lastDay.revenue).toBeGreaterThan(0)
  })

  it('shows the « Valeur nette » and its four parts before the first day is over, the debts below zero', () => {
    // 987 654,32 $ − 123,45 $ + 400 000 $ − 150 000 $
    expect(WORTH.total).toBe(98_765_432 - 12_345 + 40_000_000 - 15_000_000)
    expect(netWorthLines(render(null))).toEqual({
      total: `1${S}237${S}530,87${S}$`,
      parts: [
        ['Part de l&#x27;entreprise', `987${S}654,32${S}$`],
        ['Argent personnel', `-123,45${S}$`],
        ['Biens personnels', `400${S}000,00${S}$`],
        ['Dettes personnelles', `-150${S}000,00${S}$`],
      ],
    })
  })

  it("shows the « Valeur nette » after yesterday's numbers once a day is played", () => {
    const game = tick(tick(createInitialState(42)))
    const worth = netWorthParts(game)
    const html = render(game.lastDay, worth)
    expect(html).toMatch(
      /Clients servis.*<\/p><p class="today__net-worth">Valeur nette.*<\/ul><\/section>$/,
    )
    expect(netWorthLines(html).parts.map(([label]) => label)).toEqual([
      'Part de l&#x27;entreprise',
      'Argent personnel',
      'Biens personnels',
      'Dettes personnelles',
    ])
    expect(netWorthLines(html).parts.slice(2)).toEqual([
      ['Biens personnels', `0,00${S}$`],
      ['Dettes personnelles', `0,00${S}$`],
    ])
  })

  it('has no tooltips', () => {
    expect(render(tick(createInitialState(42)).lastDay)).not.toContain('title=')
  })
})

describe('TodayPanel', () => {
  it('shows the app store, where no day has been played yet', () => {
    expect(renderToStaticMarkup(<TodayPanel />)).toContain(
      'La première journée n&#x27;est pas encore terminée.',
    )
  })

  it("shows the owner's net worth from the app store", () => {
    const worth = netWorthParts(gameStore.getState().game)
    expect(worth.total).toBeGreaterThan(0)
    expect(renderToStaticMarkup(<TodayPanel />)).toBe(render(null, worth))
  })
})
