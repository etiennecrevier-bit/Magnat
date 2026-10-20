import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { cents } from '../engine/money.ts'
import { netWorthParts, type NetWorthParts } from '../engine/netWorth.ts'
import type { DaySummary } from '../engine/types.ts'
import type { FinancingSummary } from './financingSummary.ts'
import { formatMoney } from './formatMoney.ts'
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

function render(
  lastDay: DaySummary | null,
  netWorth = WORTH,
  financing: FinancingSummary | null = null,
) {
  return renderToStaticMarkup(
    <TodayPanelView
      lastDay={lastDay}
      netWorth={netWorth}
      financing={financing}
    />,
  )
}

/** The « Financement » block's lines, tags removed. */
function financingLines(html: string): string[] {
  const block = /<section class="today__financing"[^>]*>(.*?)<\/section>/.exec(
    html,
  )?.[1]
  return [...(block ?? '').matchAll(/<li>(.*?)<\/li>/g)].map(([, item]) =>
    (item ?? '').replace(/<[^>]*>/g, ''),
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

describe('TodayPanelView', () => {
  it('says so before the first day is over', () => {
    const html = render(null)
    expect(html).toContain('<h1>Aujourd&#x27;hui</h1>')
    expect(html).toContain(
      'La première journée n&#x27;est pas encore terminée.',
    )
    expect(html).not.toContain('<table')
  })

  it("shows yesterday's revenue and customers served, and no table of units by product, which moved to « Le camion »", () => {
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
    expect(html).not.toContain('<table')
    expect(html).not.toContain('Ventes perdues')
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
    expect(lastDay.revenue).toBeGreaterThan(0)
    expect(html).toContain(
      `Chiffre d&#x27;affaires${S}: <strong>${formatMoney(lastDay.revenue)}</strong>`,
    )
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

  it('shows no « Financement » before a loan or a share sale', () => {
    expect(render(null)).not.toContain('Financement')
  })

  it('shows « Financement » under the net worth: each loan open, the shares sold and the next dividend so far', () => {
    const html = render(null, WORTH, {
      hadLoans: true,
      loans: [
        {
          lender: 'Caisse populaire Saint-Prudent',
          owed: cents(1_234_567),
          next: { amount: cents(117_042), day: 61 },
        },
      ],
      shares: [{ investor: 'Duvent Capital', tenths: 200 }],
      dividend: { day: 61, amount: cents(45_678), final: false },
    })
    expect(html).toMatch(
      /<\/ul><section class="today__financing" aria-labelledby="today-financing"><h2 id="today-financing">Financement<\/h2>/,
    )
    expect(financingLines(html)).toEqual([
      `Prêt d&#x27;urgence · Caisse populaire Saint-Prudent${S}: 12${S}345,67${S}$ à rembourser, prochain versement de 1${S}170,42${S}$ le 1er juillet`,
      `Duvent Capital${S}: 20${S}% des actions`,
      `Prochain dividende le 1er juillet${S}: 456,78${S}$ à ce jour`,
    ])
  })

  it("says when no loan is open any more, and shows the dividend on the morning it is paid, and a share's tenths", () => {
    const html = render(null, WORTH, {
      hadLoans: true,
      loans: [],
      shares: [{ investor: 'Duvent Capital', tenths: 205 }],
      dividend: { day: 61, amount: cents(45_678), final: true },
    })
    expect(financingLines(html)).toEqual([
      'Aucun prêt d&#x27;urgence en cours',
      `Duvent Capital${S}: 20,5${S}% des actions`,
      `Dividende aujourd&#x27;hui${S}: 456,78${S}$`,
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
