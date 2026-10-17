import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DecisionKind } from '../content/schema.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import { applyDecision, startingDecisions } from '../engine/decisions.ts'
import { cents } from '../engine/money.ts'
import type { DaySummary, Decisions, GameState } from '../engine/types.ts'
import { bakeryBoard, type BakeryBoard } from './bakeryBoard.ts'
import ManagePanel, { ManagePanelView } from './ManagePanel.tsx'
import { NumberFieldView } from './NumberField.tsx'
import { segmentFacts } from './segmentFacts.ts'
import { gameStore, newChallenge, type GameStoreState } from './store.ts'

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
  locked: readonly DecisionKind[] = [],
  bakery: BakeryBoard = bakeryBoard(createInitialState(1)),
) {
  return renderToStaticMarkup(
    <ManagePanelView
      decisions={decisions}
      lastDay={lastDay}
      locked={locked}
      bakery={bakery}
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

/** The panel up to « Fournil », whose own tests are further down. */
function truckPart(html: string): string {
  return html.split('<section class="manage__bakery"')[0] ?? ''
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
      /^<div class="panel__content"><div class="panel__header"><button type="button" class="toggle">Fermer<\/button><h2 id="manage-title">Gérer le camion<\/h2><\/div><p class="manage__note">Les changements s&#x27;appliquent demain matin<\/p>/,
    )
    expect(texts(html, 'h3')).toEqual([
      'Prix',
      'Commandes',
      'Hier, par segment',
      'Horaire',
      'Votre salaire',
      'Marketing',
      'Fournil',
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
    const rules = texts(truckPart(html), 'fieldset')
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
    const html = truckPart(render())
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
    const html = truckPart(render())
    expect(html).toContain(
      '<h3 id="manage-facts">Hier, par segment</h3><p>Aucune journée terminée pour l&#x27;instant.</p>',
    )
    expect(html).not.toContain('<table')
  })

  it('shows yesterday by segment: units sold and visits without a sale', () => {
    const lastDay = playedDay()
    const html = truckPart(render(startingDecisions(), lastDay))
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

  it('disables the days a Défi locks, saying why, and leaves the rest', () => {
    const html = truckPart(render(startingDecisions(), null, ['daysOpen']))
    expect(html).toContain(
      '<h3 id="manage-days">Horaire</h3><p id="manage-locked-daysOpen" class="manage__locked">Le Défi fixe l&#x27;horaire.</p>',
    )
    const days = tags(html, 'button').filter(
      (tag) => attribute(tag, 'aria-pressed') !== undefined,
    )
    expect(days).toHaveLength(7)
    for (const day of days) {
      expect(day).toContain(' disabled=""')
      expect(attribute(day, 'aria-describedby')).toBe('manage-locked-daysOpen')
    }
    expect(html.match(/ disabled=""/g)).toHaveLength(7)
    expect(html.match(/class="manage__locked"/g)).toHaveLength(1)
  })

  it('disables each field and stepper of the other kinds a Défi locks, never the bakery', () => {
    const whole = render(startingDecisions(), null, [
      'price',
      'restock',
      'ownerWeeklyPay',
      'marketingDaily',
    ])
    // A Défi locks none of the bakery's changes.
    expect(whole.split('<section class="manage__bakery"')[1]).not.toContain(
      'disabled',
    )
    const html = truckPart(whole)
    expect(
      [
        ...html.matchAll(/<p id="([^"]*)" class="manage__locked">([^<]*)</g),
      ].map(([, id, text]) => [id, text]),
    ).toEqual([
      ['manage-locked-price', 'Le Défi fixe les prix.'],
      ['manage-locked-restock', 'Le Défi fixe les commandes.'],
      ['manage-locked-ownerWeeklyPay', 'Le Défi fixe votre salaire.'],
      ['manage-locked-marketingDaily', 'Le Défi fixe le budget de marketing.'],
    ])
    const fields = tags(html, 'input')
    expect(fields.length).toBeGreaterThan(0)
    for (const field of fields) {
      expect(field).toContain(' disabled=""')
      const id = attribute(field, 'id') ?? ''
      const kind = id.startsWith('manage-price-')
        ? 'price'
        : id.startsWith('manage-restock-')
          ? 'restock'
          : id === 'manage-pay-weekly'
            ? 'ownerWeeklyPay'
            : 'marketingDaily'
      expect(attribute(field, 'aria-describedby')).toBe(
        `${id}-unit manage-locked-${kind}`,
      )
    }
    const steppers = tags(html, 'button').filter((tag) =>
      tag.includes('manage__step'),
    )
    expect(steppers.length).toBeGreaterThan(0)
    for (const stepper of steppers) {
      expect(stepper).toContain(' disabled=""')
      expect(attribute(stepper, 'aria-describedby')).toBe('manage-locked-price')
    }
    // The days stay free.
    expect(
      tags(html, 'button').filter((tag) => tag.includes('aria-pressed')),
    ).not.toContainEqual(expect.stringContaining('disabled'))
  })

  it('locks nothing outside a Défi', () => {
    const html = render()
    expect(html).not.toContain('manage__locked')
    expect(html).not.toContain('disabled=""')
  })

  it('makes every button a plain button and keeps the reading order', () => {
    const html = render(startingDecisions(), playedDay())
    expect(html).not.toMatch(/<button(?![^>]*type="button")/)
    expect(html).not.toMatch(/tabindex="[1-9]/)
    expect(html).not.toContain('title=')
  })
})

/** The « Fournil » section of the panel for `game`. */
function bakeryPart(game: GameState): string {
  const html = render(startingDecisions(), null, [], bakeryBoard(game))
  return `<section class="manage__bakery"${html.split('<section class="manage__bakery"')[1] ?? ''}`
}

/** The text of each paragraph and list item, in order, tags removed. */
function lines(html: string): string[] {
  return [...html.matchAll(/<(p|li)\b[^>]*>(.*?)<\/\1>/g)].map(([, , text]) =>
    (text ?? '').replace(/<[^>]*>/g, ''),
  )
}

/** `game` played to the morning of `day`. */
function playedTo(game: GameState, day: number): GameState {
  let next = game
  while (next.day < day) next = tick(next)
  return next
}

describe('« Fournil »', () => {
  const START = createInitialState(42)

  it('shows a closed bakery, how to open it, its costs and the unit cost of a croissant bought and made side by side', () => {
    const html = bakeryPart(START)
    expect(html).toMatch(
      /^<section class="manage__bakery" aria-labelledby="manage-bakery"><h3 id="manage-bakery">Fournil<\/h3><p class="manage__bakery-status">Fermé<\/p>/,
    )
    expect(texts(html, 'button')).toEqual([
      'Ouvrir · four loué',
      'Ouvrir · four acheté',
      'Acheter',
      'Fabriquer',
    ])
    expect(html).not.toContain('disabled')
    expect(lines(html)).toEqual([
      'Fermé',
      `Déménagement${S}: 1${S}500,00${S}$`,
      `Loyer${S}: 2${S}400,00${S}$ par mois`,
      `Four loué${S}: 600,00${S}$ par mois`,
      `Four acheté${S}: 25${S}000,00${S}$`,
      `Capacité${S}: 800 croissants par jour`,
      `Frais fixes du fournil${S}: 3${S}000,00${S}$ par mois avec le four loué · 2${S}400,00${S}$ par mois avec le four acheté`,
    ])
    expect(html).toContain(
      `<table class="data-table manage__unit-costs"><caption>Coût d&#x27;un croissant</caption><thead><tr><th scope="col" class="number">Acheté</th><th scope="col" class="number">Fabriqué</th></tr></thead><tbody><tr><td class="number">1,10${S}$</td><td class="number">0,55${S}$</td></tr></tbody></table>`,
    )
    expect(html).toContain(
      'role="group" aria-label="Provenance des croissants"><button type="button" class="toggle" aria-pressed="true">Acheter</button><button type="button" class="toggle" aria-pressed="false">Fabriquer</button>',
    )
    expect(html).toContain('<legend>Fournée</legend>')
    expect(attribute(input(html, 'manage-bake-quantity'), 'value')).toBe('70')
    expect(html).toContain('>Fournée quotidienne</label>')
    expect(html).toContain(
      '<span id="manage-bake-quantity-unit" class="field__unit">croissants</span>',
    )
  })

  it('never shows a break-even figure', () => {
    for (const game of [
      START,
      playedTo(applyDecision(START, { kind: 'openBakery', oven: 'louer' }), 3),
    ]) {
      expect(bakeryPart(game)).not.toMatch(/seuil|rentab|équilibre|point mort/i)
    }
  })

  it('shows a bakery open with a leased oven, which closing gives notice to', () => {
    const open = playedTo(
      applyDecision(START, { kind: 'openBakery', oven: 'louer' }),
      3,
    )
    const html = bakeryPart(open)
    expect(lines(html).slice(0, 2)).toEqual([
      'Ouvert depuis le 2 mai · four loué',
      `Fermer donne un préavis${S}: dernier jour le 30 juin`,
    ])
    expect(texts(html, 'button')[0]).toBe('Fermer le fournil')
    expect(lines(html)).toContain(
      `Frais fixes du fournil${S}: 3${S}000,00${S}$ par mois`,
    )
  })

  it('shows tomorrow when the plan changes it, and only the oven it has to take the notice back', () => {
    const open = playedTo(
      applyDecision(START, { kind: 'openBakery', oven: 'louer' }),
      3,
    )
    const closing = applyDecision(open, { kind: 'closeBakery' })
    expect(lines(bakeryPart(closing)).slice(0, 2)).toEqual([
      'Ouvert depuis le 2 mai · four loué',
      `Demain${S}: en préavis, dernier jour le 30 juin`,
    ])
    const html = bakeryPart(tick(closing))
    expect(lines(html)[0]).toBe(`En préavis${S}: dernier jour le 30 juin`)
    expect(tags(html, 'button').slice(0, 2)).toEqual([
      '<button type="button" class="button">',
      '<button type="button" class="button" disabled="">',
    ])
  })

  it('cancels an opening planned for tomorrow, and says it opens', () => {
    const html = bakeryPart(
      applyDecision(START, { kind: 'openBakery', oven: 'acheter' }),
    )
    expect(lines(html).slice(0, 2)).toEqual([
      'Fermé',
      `Demain${S}: ouvert · four acheté`,
    ])
    expect(texts(html, 'button')[0]).toBe('Annuler l&#x27;ouverture')
  })

  it('leases no oven once the business owns one, which it says', () => {
    let game = playedTo(
      applyDecision(START, { kind: 'openBakery', oven: 'acheter' }),
      3,
    )
    game = playedTo(applyDecision(game, { kind: 'closeBakery' }), 63)
    const html = bakeryPart(game)
    expect(lines(html)).toContain(`Four acheté${S}: déjà à vous`)
    expect(html).toContain(
      '<button type="button" class="button" disabled="">Ouvrir · four loué</button><button type="button" class="button">Ouvrir · four acheté</button>',
    )
  })

  it('says the croissants are bought while no bakery runs to make them', () => {
    const html = bakeryPart(
      applyDecision(START, { kind: 'croissantSource', source: 'fabriquer' }),
    )
    expect(html).toContain('aria-pressed="true">Fabriquer</button>')
    expect(lines(html)).toContain(
      'Sans fournil ouvert, les croissants sont achetés.',
    )
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
  it('disables what the Défi played locks', () => {
    gameStore.getState().startGame(newChallenge('?seed=7', 'moisSansConge'))
    const html = renderToStaticMarkup(<ManagePanel />)
    expect(html).toContain('Le Défi fixe l&#x27;horaire.')
    expect(button(html, 'lundi')).toContain(' disabled=""')
    expect(input(html, 'manage-pay-weekly')).not.toContain('disabled')
  })

  it('is a modal dialog labelled by its title', () => {
    expect(renderToStaticMarkup(<ManagePanel />)).toMatch(
      /^<dialog class="panel manage" aria-labelledby="manage-title"><div class="panel__content">.*<\/dialog>$/,
    )
  })

  it('shows the bakery planned for the next morning', () => {
    gameStore.getState().decide({ kind: 'openBakery', oven: 'louer' })
    const html = renderToStaticMarkup(<ManagePanel />)
    expect(html).toContain(`<p>Demain${S}: ouvert · four loué</p>`)
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
