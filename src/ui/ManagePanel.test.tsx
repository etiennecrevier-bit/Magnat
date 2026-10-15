import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { startingDecisions } from '../engine/decisions.ts'
import { cents } from '../engine/money.ts'
import type { DaySummary, Decisions } from '../engine/types.ts'
import ManagePanel, { ManagePanelView } from './ManagePanel.tsx'
import { NumberFieldView } from './NumberField.tsx'
import { segmentFacts } from './segmentFacts.ts'
import { gameStore, type GameStoreState } from './store.ts'

// A static render reads a Zustand store's initial state, so the connected
// panel reads the app store's current state through this stand-in.
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

// Every space in an amount is a no-break space (U+00A0).
const S = ' '

function render(
  decisions: Decisions = startingDecisions(),
  lastDay: DaySummary | null = null,
) {
  return renderToStaticMarkup(
    <ManagePanelView
      decisions={decisions}
      lastDay={lastDay}
      onChange={() => {}}
      onClose={() => {}}
    />,
  )
}

/** Each `<tag …>` opening tag in `html`. */
function tags(html: string, tag: string): string[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map(
    ([match]) => match,
  )
}

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]
}

/** The text between `<tag …>` and `</tag>`, in order. */
function texts(html: string, tag: string): string[] {
  return [
    ...html.matchAll(new RegExp(`<${tag}\\b[^>]*>(.*?)</${tag}>`, 'g')),
  ].map(([, text]) => text ?? '')
}

function input(html: string, id: string): string {
  const found = tags(html, 'input').find((tag) => attribute(tag, 'id') === id)
  if (found === undefined) throw new Error(`No input ${id}`)
  return found
}

function button(html: string, label: string): string {
  const found = tags(html, 'button').find(
    (tag) => attribute(tag, 'aria-label') === label,
  )
  if (found === undefined) throw new Error(`No button ${label}`)
  return found
}

/** The first played day, a Tuesday: day 0 is a Monday, when the truck is closed. */
function playedDay(): DaySummary {
  const { lastDay } = tick(tick(createInitialState(42)))
  if (lastDay === null) throw new Error('No day played')
  return lastDay
}

describe('ManagePanelView', () => {
  it('opens on its title and Fermer, then the note, then the five sections and the facts', () => {
    const html = render()
    expect(html).toMatch(
      /^<div class="manage__content"><div class="manage__header"><button type="button" class="toggle">Fermer<\/button><h2 id="manage-title">Gérer le camion<\/h2><\/div><p class="manage__note">Les changements s&#x27;appliquent demain matin<\/p>/,
    )
    expect(texts(html, 'h3')).toEqual([
      'Prix',
      'Commandes',
      'Hier, par segment',
      'Horaire',
      'Votre salaire',
      'Marketing',
    ])
  })

  it('shows each price in a labelled field, between its steppers', () => {
    const html = render()
    expect(texts(html, 'label').slice(0, 3)).toEqual([
      'Café',
      'Chocolat chaud',
      'Croissant',
    ])
    for (const [product, value] of [
      ['cafe', '3,25'],
      ['chocolat', '3,50'],
      ['croissant', '3,75'],
    ]) {
      const id = `manage-price-${product}`
      const field = input(html, id)
      expect(attribute(field, 'value')).toBe(value)
      expect(attribute(field, 'inputMode')).toBe('decimal')
      expect(attribute(field, 'aria-invalid')).toBe('false')
      expect(attribute(field, 'aria-describedby')).toBe(`${id}-unit`)
      expect(html).toContain(`<label class="field__label" for="${id}">`)
    }
    expect(html).toContain(
      `<button type="button" class="toggle manage__step" aria-label="Café${S}: baisser le prix de 0,05${S}$" aria-disabled="false">−</button><input`,
    )
    expect(html).toContain(
      `<span id="manage-price-cafe-unit" class="field__unit">$</span><button type="button" class="toggle manage__step" aria-label="Café${S}: augmenter le prix de 0,05${S}$" aria-disabled="false">+</button>`,
    )
  })

  it('marks a stepper at its limit as unavailable, keeping it focusable', () => {
    const start = startingDecisions()
    const html = render({
      ...start,
      prices: { cafe: cents(50), chocolat: cents(2000), croissant: cents(55) },
    })
    const disabled = (label: string) =>
      attribute(button(html, label), 'aria-disabled')
    expect(disabled(`Café${S}: baisser le prix de 0,05${S}$`)).toBe('true')
    expect(disabled(`Café${S}: augmenter le prix de 0,05${S}$`)).toBe('false')
    expect(disabled(`Chocolat chaud${S}: augmenter le prix de 0,05${S}$`)).toBe(
      'true',
    )
    expect(disabled(`Croissant${S}: baisser le prix de 0,05${S}$`)).toBe(
      'false',
    )
    expect(html).not.toMatch(/\sdisabled(=|\s|>)/)
  })

  it('lays out each order by the kind of its rule', () => {
    const html = render()
    const rules = texts(html, 'fieldset')
    expect(rules).toHaveLength(3)
    const [cafe = '', chocolat = '', croissant = ''] = rules
    expect(cafe).toContain('<legend>Café</legend>')
    expect(tags(cafe, 'input').map((tag) => attribute(tag, 'value'))).toEqual([
      '100',
      '300',
    ])
    expect(texts(cafe, 'label')).toEqual([
      'Recommander sous',
      'Remplir jusqu&#x27;à',
    ])
    expect(chocolat).toContain('<legend>Chocolat chaud</legend>')
    expect(
      tags(chocolat, 'input').map((tag) => attribute(tag, 'value')),
    ).toEqual(['50', '150'])
    expect(croissant).toContain('<legend>Croissant</legend>')
    expect(texts(croissant, 'label')).toEqual(['Commande quotidienne'])
    expect(
      attribute(input(croissant, 'manage-restock-croissant-quantity'), 'value'),
    ).toBe('70')
    expect(
      attribute(input(html, 'manage-restock-cafe-upTo'), 'inputMode'),
    ).toBe('numeric')
    expect(html).toContain(
      '<span id="manage-restock-cafe-upTo-unit" class="field__unit">unités</span>',
    )
  })

  it('has a labelled group of seven day toggles, pressed on the days open', () => {
    const html = render()
    expect(html).toContain('role="group" aria-label="Jours d&#x27;ouverture"')
    const days = tags(html, 'button').filter(
      (tag) => attribute(tag, 'aria-pressed') !== undefined,
    )
    expect(days.map((tag) => attribute(tag, 'aria-label'))).toEqual([
      'lundi',
      'mardi',
      'mercredi',
      'jeudi',
      'vendredi',
      'samedi',
      'dimanche',
    ])
    expect(days.map((tag) => attribute(tag, 'aria-pressed'))).toEqual([
      'false',
      'true',
      'true',
      'true',
      'true',
      'true',
      'true',
    ])
    expect(html).toContain('>lun.</button>')
    expect(html).toContain('>dim.</button>')
  })

  it('shows the pay and the marketing budget in fr-CA amounts', () => {
    const html = render({
      ...startingDecisions(),
      ownerWeeklyPay: cents(125_050),
    })
    expect(attribute(input(html, 'manage-pay-weekly'), 'value')).toBe(
      `1${S}250,50`,
    )
    expect(html).toContain('>Salaire hebdomadaire</label>')
    expect(html).toContain('>$ par semaine</span>')
    expect(attribute(input(html, 'manage-marketing-daily'), 'value')).toBe(
      '0,00',
    )
    expect(html).toContain('>Budget quotidien</label>')
    expect(html).toContain('>$ par jour</span>')
  })

  it('says no day is over before the first one', () => {
    const html = render()
    expect(html).toContain(
      '<h3 id="manage-facts">Hier, par segment</h3><p>Aucune journée terminée pour l&#x27;instant.</p>',
    )
    expect(html).not.toContain('<table')
  })

  it('shows yesterday by segment: units sold and visits without a sale', () => {
    const lastDay = playedDay()
    const html = render(startingDecisions(), lastDay)
    expect(html).toContain(
      '<div class="manage__scroll" role="region" aria-labelledby="manage-facts" tabindex="0"><table class="data-table">',
    )
    expect(texts(html, 'th').slice(0, 9)).toEqual([
      'Segment',
      'Unités vendues',
      'Clients sans achat',
      'Café',
      'Chocolat chaud',
      'Croissant',
      'Trop cher',
      'Rupture de stock',
      'Chasseurs d&#x27;aubaines',
    ])
    const rows = texts(html, 'tr').slice(2)
    const { segments, total } = segmentFacts(lastDay)
    const expected = [
      ['Chasseurs d&#x27;aubaines', segments[0]?.facts],
      ['Habitués', segments[1]?.facts],
      ['Clientèle chic', segments[2]?.facts],
      ['Total', total],
    ] as const
    expect(rows).toHaveLength(expected.length)
    expected.forEach(([label, facts], i) => {
      if (facts === undefined) throw new Error(`No facts for ${label}`)
      expect(rows[i]).toBe(
        `<th scope="row">${label}</th>` +
          [
            facts.sold.cafe,
            facts.sold.chocolat,
            facts.sold.croissant,
            facts.tooExpensive,
            facts.soldOut,
          ]
            .map((count) => `<td class="number">${count}</td>`)
            .join(''),
      )
    })
    expect(html).toMatch(/<tfoot><tr><th scope="row">Total<\/th>/)
  })

  it('makes every button a plain button and keeps the reading order', () => {
    const html = render(startingDecisions(), playedDay())
    expect(html).not.toMatch(/<button(?![^>]*type="button")/)
    expect(html).not.toMatch(/tabindex="[1-9]/)
    expect(html).not.toContain('title=')
  })
})

describe('NumberFieldView', () => {
  it('shows what is wrong, tied to the field, and announces it', () => {
    const html = renderToStaticMarkup(
      <NumberFieldView
        id="price"
        label="Café"
        text="3,27"
        unit="$"
        inputMode="decimal"
        error={`Le prix doit être un multiple de 0,05${S}$.`}
        onTextChange={() => {}}
        onCommit={() => {}}
      />,
    )
    expect(html).toBe(
      '<div class="field"><label class="field__label" for="price">Café</label>' +
        '<div class="field__control"><input id="price" class="field__input" type="text" inputMode="decimal" autoComplete="off" aria-invalid="true" aria-describedby="price-unit price-error" value="3,27"/>' +
        '<span id="price-unit" class="field__unit">$</span></div>' +
        `<p id="price-error" class="field__error" role="alert">Le prix doit être un multiple de 0,05${S}$.</p></div>`,
    )
  })
})

describe('ManagePanel', () => {
  it('is a modal dialog labelled by its title', () => {
    expect(renderToStaticMarkup(<ManagePanel />)).toMatch(
      /^<dialog class="manage" aria-labelledby="manage-title"><div class="manage__content">.*<\/dialog>$/,
    )
  })

  it('shows the decisions waiting for the next morning', () => {
    gameStore.getState().decide({
      kind: 'price',
      product: 'cafe',
      price: cents(300),
    })
    gameStore.getState().decide({ kind: 'daysOpen', weekdays: [1, 2] })
    const html = renderToStaticMarkup(<ManagePanel />)
    expect(attribute(input(html, 'manage-price-cafe'), 'value')).toBe('3,00')
    expect(attribute(button(html, 'lundi'), 'aria-pressed')).toBe('true')
    expect(attribute(button(html, 'mercredi'), 'aria-pressed')).toBe('false')
    expect(gameStore.getState().game.decisions.prices.cafe).toBe(325)
  })
})
