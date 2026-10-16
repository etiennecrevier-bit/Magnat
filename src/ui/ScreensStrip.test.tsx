import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { cents } from '../engine/money.ts'
import ScreensStrip, { ScreensStripView } from './ScreensStrip.tsx'
import { TodayPanelView } from './TodayPanel.tsx'
import { todayNumbers, type TodayNumbers } from './todayNumbers.ts'

// Every space in an amount, and before a colon, is a no-break space.
const S = ' '

function render(screen: string, numbers: TodayNumbers | null) {
  return renderToStaticMarkup(
    <ScreensStripView screen={screen} numbers={numbers} onUnfold={() => {}} />,
  )
}

/** The strip's labels and their numbers, in order. */
function stripNumbers(html: string) {
  return [
    ...html.matchAll(
      /<span class="screens-strip__number">([^<]*)<strong>([^<]*)<\/strong><\/span>/g,
    ),
  ].map(([, label = '', number]) => [label.trim(), number])
}

describe('ScreensStripView', () => {
  it("is one button with the open screen's badge, the three numbers and « Déplier », its tooltip naming the key", () => {
    expect(
      render("Aujourd'hui", {
        revenue: cents(123_456),
        customersServed: 87,
        lostSales: 9,
      }),
    ).toBe(
      '<button type="button" class="screens-strip" aria-expanded="false" aria-keyshortcuts="R" title="Déplier le panneau (touche R)">' +
        '<span class="screens-strip__screen">Aujourd&#x27;hui</span>' +
        `<span class="screens-strip__number">Chiffre d&#x27;affaires${S}: <strong>1${S}234,56${S}$</strong></span>` +
        `<span class="screens-strip__number">Clients servis${S}: <strong>87</strong></span>` +
        `<span class="screens-strip__number">Ventes perdues${S}: <strong>9</strong></span>` +
        '<span class="screens-strip__unfold">Déplier<span aria-hidden="true"> ▸</span></span>' +
        '</button>',
    )
  })

  it('names whichever screen is open', () => {
    expect(render('États financiers', null)).toContain(
      '<span class="screens-strip__screen">États financiers</span>',
    )
  })

  it('shows a dash for each number before the first day is over', () => {
    expect(stripNumbers(render("Aujourd'hui", null))).toEqual([
      [`Chiffre d&#x27;affaires${S}:`, '—'],
      [`Clients servis${S}:`, '—'],
      [`Ventes perdues${S}:`, '—'],
    ])
  })

  it('unfolds the screens when clicked', () => {
    const onUnfold = vi.fn()
    ScreensStripView({
      screen: 'Bilans',
      numbers: null,
      onUnfold,
    }).props.onClick()
    expect(onUnfold).toHaveBeenCalledOnce()
  })

  it("shows the Aujourd'hui panel's numbers for a played day", () => {
    // Day 0 is a Monday, closed by default, so day 1 is the first that sells.
    const { lastDay } = tick(tick(createInitialState(42)))
    if (lastDay === null) throw new Error('A played day has a summary')
    const [revenue, served, lost] = stripNumbers(
      render("Aujourd'hui", todayNumbers(lastDay)),
    ).map(([, number]) => number)
    const panel = renderToStaticMarkup(<TodayPanelView lastDay={lastDay} />)

    expect(panel).toContain(
      `Chiffre d&#x27;affaires${S}: <strong>${revenue}</strong>`,
    )
    expect(panel).toContain(`Clients servis${S}: <strong>${served}</strong>`)
    const totalRow =
      /<tfoot><tr><th scope="row">Total<\/th><td class="number">\d+<\/td><td class="number">(\d+)<\/td>/.exec(
        panel,
      )
    expect(totalRow?.[1]).toBe(lost)
    // A real day, so the test compares numbers that are there.
    expect(lastDay.revenue).toBeGreaterThan(0)
    expect(Number(served)).toBeGreaterThan(0)
  })
})

describe('ScreensStrip', () => {
  it('reads the app store, where no day has been played yet', () => {
    const html = renderToStaticMarkup(
      <ScreensStrip screen="Aujourd'hui" onUnfold={() => {}} />,
    )
    expect(html).toContain(`Clients servis${S}: <strong>—</strong>`)
  })
})
