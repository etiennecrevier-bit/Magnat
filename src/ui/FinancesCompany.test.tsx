import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { cents } from '../engine/money.ts'
import { FinancesCompanyView } from './FinancesCompany.tsx'
import { companyBoard, type CompanyBoard } from './financesBoard.ts'
import { hiring, SECOND, withSecondTruck } from './fixtures/twoTrucks.ts'
import { formatWholeStatementAmount } from './formatMoney.ts'
import { gameStore } from './store.ts'

function render(board: CompanyBoard): string {
  return renderToStaticMarkup(
    <FinancesCompanyView
      board={board}
      sections={gameStore.getState().financeSections}
      onTile={() => {}}
      onToggle={() => {}}
      headingRef={() => () => {}}
    />,
  )
}

/** The section « Par camion » of `html`; empty when it has none. */
function trucksPart(html: string): string {
  const [, after] = html.split('Par camion</h3>')
  return after?.split('</section>')[0] ?? ''
}

describe('« Par camion » in « Entreprise » (#265)', () => {
  it('shows a small table of each truck’s month, and nothing else', () => {
    const game = tick(
      tick(
        withSecondTruck(
          createInitialState(42),
          { kind: 'daysOpen', weekdays: [1, 2, 3, 4, 5, 6, 7] },
          { kind: 'daysOpen', weekdays: [1, 2, 3, 4, 5, 6, 7], truck: SECOND },
          hiring('kevin'),
        ),
      ),
    )
    const board = companyBoard(game, [])
    const part = trucksPart(render(board))
    expect(part).toMatch(/^<table class="finances-company__trucks"/)
    expect(part).toContain(
      '<thead><tr><th scope="col">Camion</th><th scope="col">Ventes</th><th scope="col">Marge</th></tr></thead>',
    )
    const rows = [...part.matchAll(/<th scope="row">(.*?)<\/th>/g)].map(
      ([, label]) => label,
    )
    expect(rows).toEqual(['Plateau', 'Vieux-Montréal', 'Total'])
    // No sentence explains it.
    expect(part).not.toContain('<p')
  })

  it('puts a negative margin in parentheses', () => {
    const board: CompanyBoard = {
      ...companyBoard(createInitialState(42), []),
      trucks: [
        {
          id: 'plateau',
          label: 'Plateau',
          sales: cents(0),
          margin: cents(-500),
        },
        { id: 'total', label: 'Total', sales: cents(0), margin: cents(-500) },
      ],
    }
    expect(trucksPart(render(board))).toContain(
      `<td>${formatWholeStatementAmount(cents(-500))}</td>`,
    )
    expect(formatWholeStatementAmount(cents(-500))).toMatch(/^\(.*\)$/)
  })

  it('is not there with one truck', () => {
    const html = render(companyBoard(createInitialState(42), []))
    expect(html).not.toContain('Par camion')
  })
})
