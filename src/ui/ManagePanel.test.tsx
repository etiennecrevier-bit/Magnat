import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DecisionKind } from '../content/schema.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import {
  applyDecision,
  latestDecisions,
  startingDecisions,
} from '../engine/decisions.ts'
import { cents } from '../engine/money.ts'
import type { Decisions, GameState } from '../engine/types.ts'
import { bakeryBoard, type BakeryBoard } from './bakeryBoard.ts'
import ManagePanel, { ManagePanelView } from './ManagePanel.tsx'
import { NumberFieldView } from './NumberField.tsx'
import { productBoards } from './productFacts.ts'
import { StepButton } from './ProductCard.tsx'
import {
  gameStore,
  newChallenge,
  type GameStoreState,
  type TruckTab,
} from './store.ts'

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

interface RenderOptions {
  readonly decisions?: Decisions
  readonly game?: GameState
  readonly locked?: readonly DecisionKind[]
  readonly bakery?: BakeryBoard
}

/**
 * The panel's `tab` for `game`, its first morning by default, with the
 * latest decisions `decisions` (the game's latest by default).
 */
function render(tab: TruckTab, options: RenderOptions = {}) {
  const game = options.game ?? createInitialState(1)
  return renderToStaticMarkup(
    <ManagePanelView
      tab={tab}
      decisions={options.decisions ?? latestDecisions(game)}
      today={game.decisions}
      products={productBoards(game)}
      locked={options.locked ?? []}
      bakery={options.bakery ?? bakeryBoard(game)}
      onChange={() => {}}
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
function playedGame(game: GameState = createInitialState(42)): GameState {
  return tick(tick(game))
}

/** The `<p class="status-line">` of `id`, tags removed; null if none. */
function statusLine(html: string, id: string): string | null {
  const found = new RegExp(`<p id="${id}" class="status-line">(.*?)</p>`).exec(
    html,
  )
  return found === null ? null : (found[1] ?? '').replace(/<[^>]*>/g, '')
}

/** The ids each control of `html` is described by. */
function describers(tag: string): string[] {
  return (attribute(tag, 'aria-describedby') ?? '').split(' ')
}

/** The text of each `<tag>` that has words, not only an icon. */
function words(html: string, tag: string): string[] {
  return texts(html, tag).filter((text) => !text.startsWith('<svg'))
}

/**
 * What the tooltip of the « (i) » `label` says, a line each: its title, its
 * text, then « label : value » for each row, « — » before a thin line.
 */
function tipOf(html: string, label: string): string[] {
  const id = attribute(button(html, label), 'aria-describedby') ?? ''
  const tip = html
    .split(`<div id="${id}" role="tooltip"`)[1]
    ?.split('<span class="tip__arrow"')[0]
  if (tip === undefined) throw new Error(`No tooltip for ${label}`)
  return [
    ...tip.matchAll(
      /<p class="tip__(?:title|text)">(.*?)<\/p>|<div class="tip__row( tip__row--divider)?"><dt>(.*?)<\/dt><dd[^>]*>(.*?)<\/dd>/g,
    ),
  ].map(
    ([, line, divider, label, value]) =>
      line ?? `${divider === undefined ? '' : '— '}${label}${S}: ${value}`,
  )
}

const TABS: readonly TruckTab[] = [
  'menu',
  'stocks',
  'schedule',
  'payMarketing',
  'bakery',
]

describe('ManagePanelView', () => {
  it('ends each tab on the one-sentence note', () => {
    for (const tab of TABS) {
      expect(render(tab)).toMatch(
        /<p class="manage__note"><svg[^>]*>.*<\/svg>Les changements s&#x27;appliquent demain matin\.<\/p><\/div>$/,
      )
    }
  })

  it('holds every decision, each kind on one tab', () => {
    const inputs = (tab: TruckTab) =>
      tags(render(tab), 'input').map((tag) => attribute(tag, 'id'))
    expect(inputs('menu')).toEqual([
      'manage-price-cafe',
      'manage-price-chocolat',
      'manage-price-croissant',
    ])
    expect(inputs('stocks')).toEqual([
      'manage-restock-cafe-whenBelow',
      'manage-restock-cafe-upTo',
      'manage-restock-chocolat-whenBelow',
      'manage-restock-chocolat-upTo',
      'manage-restock-croissant-quantity',
    ])
    expect(inputs('schedule')).toEqual([])
    expect(
      tags(render('schedule'), 'button').filter((tag) =>
        tag.includes('aria-pressed'),
      ),
    ).toHaveLength(7)
    expect(inputs('payMarketing')).toEqual([
      'manage-pay-weekly',
      'manage-marketing-daily',
    ])
    const bakery = render('bakery')
    expect(inputs('bakery')).toEqual(['manage-bake-quantity'])
    expect(words(bakery, 'button')).toEqual([
      'Ouvrir · four loué',
      'Ouvrir · four acheté',
      'Acheter',
      'Fabriquer',
    ])
  })

  it('shows a card per product: its glyph, its name, its price between its steppers', () => {
    const html = render('menu')
    expect(texts(html, 'h3')).toEqual(['Café', 'Chocolat chaud', 'Croissant'])
    expect(html.match(/class="product-glyph"/g)).toHaveLength(3)
    for (const [product, name, value] of [
      ['cafe', 'Café', '3,25'],
      ['chocolat', 'Chocolat chaud', '3,50'],
      ['croissant', 'Croissant', '3,75'],
    ] as const) {
      const id = `manage-price-${product}`
      const field = input(html, id)
      expect(attribute(field, 'value')).toBe(value)
      expect(attribute(field, 'inputMode')).toBe('decimal')
      // Its label is for screen readers: the card's title shows the name.
      expect(html).toContain(
        `<label class="visually-hidden" for="${id}">${name}</label>`,
      )
      const tip = describers(field).at(-1) ?? ''
      expect(html).toContain(`id="${tip}" role="tooltip"`)
      expect(describers(field)).toEqual([`${id}-unit`, tip])
      for (const verb of ['baisser', 'augmenter']) {
        const stepper = button(
          html,
          `${name}${S}: ${verb} le prix de 0,05${S}$`,
        )
        expect(describers(stepper)).toEqual([tip])
        expect(attribute(stepper, 'aria-disabled')).toBe('false')
      }
    }
    // The steppers sit on either side of the price, in the Tab order.
    expect(html).toContain(
      `aria-disabled="false">−</button><input id="manage-price-cafe"`,
    )
    expect(html).toContain(
      `<span id="manage-price-cafe-unit" class="field__unit">$</span><button type="button" class="toggle manage__step" aria-label="Café${S}: augmenter le prix de 0,05${S}$"`,
    )
  })

  it('makes the whole card the anchor of its tooltip', () => {
    const html = render('menu', { game: playedGame() })
    const cards = tags(html, 'div').filter((tag) =>
      tag.includes('class="product-card"'),
    )
    expect(cards).toHaveLength(3)
    for (const card of cards) {
      const tip = attribute(card, 'aria-describedby') ?? ''
      expect(html).toContain(`id="${tip}" role="tooltip"`)
    }
    expect(html).toContain('<p class="tip__title">Croissant · hier</p>')
    expect(html).toContain('<div class="tip__row tip__row--divider">')
  })

  it('marks a stepper at its limit as unavailable, keeping it focusable', () => {
    const start = startingDecisions()
    const html = render('menu', {
      decisions: {
        ...start,
        prices: {
          cafe: cents(50),
          chocolat: cents(2000),
          croissant: cents(55),
        },
      },
    })
    const disabled = (label: string) =>
      attribute(button(html, label), 'aria-disabled')
    expect(disabled(`Café${S}: baisser le prix de 0,05${S}$`)).toBe('true')
    expect(disabled(`Café${S}: augmenter le prix de 0,05${S}$`)).toBe('false')
    expect(disabled(`Chocolat chaud${S}: augmenter le prix de 0,05${S}$`)).toBe(
      'true',
    )
    expect(html).not.toMatch(/\sdisabled(=|\s|>)/)
  })

  it('shows no status line before the first day is over, but the price of tomorrow', () => {
    const game = createInitialState(1)
    expect(
      statusLine(render('menu', { game }), 'manage-price-cafe-status'),
    ).toBe(null)
    const pending = applyDecision(game, {
      kind: 'price',
      product: 'cafe',
      price: cents(300),
    })
    const html = render('menu', { game: pending })
    expect(statusLine(html, 'manage-price-cafe-status')).toBe(
      `Demain${S}: 3,00${S}$`,
    )
    expect(html).not.toContain('status-line__dot')
    expect(describers(input(html, 'manage-price-cafe'))[1]).toBe(
      'manage-price-cafe-status',
    )
    // Back to today's price, nothing changes tomorrow.
    const back = applyDecision(pending, {
      kind: 'price',
      product: 'cafe',
      price: cents(325),
    })
    expect(
      statusLine(render('menu', { game: back }), 'manage-price-cafe-status'),
    ).toBe(null)
  })

  it("shows yesterday's most important fact, then tomorrow's price", () => {
    const game = playedGame(
      applyDecision(createInitialState(42), {
        kind: 'restock',
        product: 'croissant',
        rule: { kind: 'buyDaily', quantity: 20 },
      }),
    )
    const html = render('menu', {
      game: applyDecision(game, {
        kind: 'price',
        product: 'croissant',
        price: cents(400),
      }),
    })
    expect(statusLine(html, 'manage-price-croissant-status')).toBe(
      `Rupture vers 9${S}h · Demain${S}: 4,00${S}$`,
    )
    expect(html).toContain(
      '<p id="manage-price-croissant-status" class="status-line"><span class="status-line__dot status-line__dot--bad" aria-hidden="true"></span>',
    )
    expect(statusLine(html, 'manage-price-cafe-status')).toBe('Bien vendu hier')
  })

  it('lays out each restock rule by its kind, with steppers of one unit and its status line', () => {
    const html = render('stocks', { game: playedGame() })
    const rules = html
      .split(
        /<div class="product-card product-card--stock" data-tuto="stocks\.\w+" role="group"/,
      )
      .slice(1)
    expect(rules).toHaveLength(3)
    const [cafe = '', , croissant = ''] = rules
    expect(cafe).toMatch(
      /^ aria-labelledby="manage-restock-cafe-name">.*<h3 id="manage-restock-cafe-name" class="product-card__name">Café<\/h3>/,
    )
    expect(tags(cafe, 'input').map((tag) => attribute(tag, 'value'))).toEqual([
      '100',
      '300',
    ])
    expect(texts(cafe, 'label')).toEqual([
      'Recommander sous',
      'Remplir jusqu&#x27;à',
    ])
    expect(texts(croissant, 'label')).toEqual(['Commande quotidienne'])
    const stepper = button(html, `Café, Recommander sous${S}: augmenter de 1`)
    expect(attribute(stepper, 'aria-disabled')).toBe('false')
    expect(describers(stepper)).toEqual(['manage-restock-cafe-status'])
    expect(statusLine(html, 'manage-restock-cafe-status')).toMatch(
      /^Il en restait \d+ hier$/,
    )
    expect(statusLine(html, 'manage-restock-croissant-status')).toMatch(
      /^\d+ périmés hier$/,
    )
  })

  it("stops a restock stepper where the rule's other field or the limits stop it", () => {
    const start = startingDecisions()
    const html = render('stocks', {
      decisions: {
        ...start,
        restock: {
          ...start.restock,
          cafe: { kind: 'topUp', whenBelow: 300, upTo: 300 },
          croissant: { kind: 'buyDaily', quantity: 0 },
        },
      },
    })
    const disabled = (label: string) =>
      attribute(button(html, label), 'aria-disabled')
    expect(disabled(`Café, Recommander sous${S}: augmenter de 1`)).toBe('true')
    expect(disabled(`Café, Remplir jusqu&#x27;à${S}: baisser de 1`)).toBe(
      'true',
    )
    expect(disabled(`Croissant, Commande quotidienne${S}: baisser de 1`)).toBe(
      'true',
    )
    expect(
      disabled(`Croissant, Commande quotidienne${S}: augmenter de 1`),
    ).toBe('false')
    expect(statusLine(html, 'manage-restock-croissant-status')).toBe(
      `Demain${S}: 0 par jour`,
    )
  })

  it('has a labelled group of seven day toggles, pressed on the days open', () => {
    const html = render('schedule')
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
  })

  it('shows the pay and the marketing budget in fr-CA amounts', () => {
    const html = render('payMarketing', {
      decisions: { ...startingDecisions(), ownerWeeklyPay: cents(125_050) },
    })
    expect(texts(html, 'h3')).toEqual(['Votre salaire', 'Marketing'])
    expect(attribute(input(html, 'manage-pay-weekly'), 'value')).toBe(
      `1${S}250,50`,
    )
    expect(html).toContain('>Salaire hebdomadaire</label>')
    expect(html).toContain('>$ par semaine</span>')
    expect(attribute(input(html, 'manage-marketing-daily'), 'value')).toBe(
      '0,00',
    )
    expect(html).toContain('>Budget quotidien</label>')
  })

  it('shows no table of yesterday any more', () => {
    for (const tab of ['menu', 'stocks'] as const) {
      const html = render(tab, { game: playedGame() })
      expect(html).not.toContain('<table')
      expect(html).not.toContain('Hier, par segment')
    }
  })

  it('disables what a Défi locks on each tab, saying why at its top, and never the bakery', () => {
    const locked = [
      'price',
      'restock',
      'daysOpen',
      'ownerWeeklyPay',
      'marketingDaily',
    ] as const
    const notes = (tab: TruckTab) =>
      [
        ...render(tab, { locked }).matchAll(
          /<p id="([^"]*)" class="manage__locked">([^<]*)</g,
        ),
      ].map(([, id, text]) => [id, text])
    expect(notes('menu')).toEqual([
      ['manage-locked-price', 'Le Défi fixe les prix.'],
    ])
    expect(notes('stocks')).toEqual([
      ['manage-locked-restock', 'Le Défi fixe les commandes.'],
    ])
    expect(notes('schedule')).toEqual([
      ['manage-locked-daysOpen', 'Le Défi fixe l&#x27;horaire.'],
    ])
    expect(notes('payMarketing')).toEqual([
      ['manage-locked-ownerWeeklyPay', 'Le Défi fixe votre salaire.'],
      ['manage-locked-marketingDaily', 'Le Défi fixe le budget de marketing.'],
    ])
    expect(render('bakery', { locked })).not.toContain('disabled')
    for (const tab of ['menu', 'stocks'] as const) {
      const html = render(tab, { locked })
      const kind = tab === 'menu' ? 'price' : 'restock'
      const controls = [
        ...tags(html, 'input'),
        ...tags(html, 'button').filter((tag) => tag.includes('manage__step')),
      ]
      expect(controls.length).toBeGreaterThan(0)
      for (const control of controls) {
        expect(control).toContain(' disabled=""')
        expect(describers(control)).toContain(`manage-locked-${kind}`)
      }
    }
    for (const day of tags(render('schedule', { locked }), 'button')) {
      expect(day).toContain(' disabled=""')
      expect(attribute(day, 'aria-describedby')).toBe('manage-locked-daysOpen')
    }
    const pay = render('payMarketing', { locked: ['ownerWeeklyPay'] })
    expect(input(pay, 'manage-pay-weekly')).toContain(' disabled=""')
    expect(input(pay, 'manage-marketing-daily')).not.toContain('disabled')
  })

  it('locks nothing outside a Défi', () => {
    for (const tab of TABS) {
      const html = render(tab)
      expect(html).not.toContain('manage__locked')
      expect(html).not.toContain('disabled=""')
    }
  })

  it('makes every button a plain button and keeps the reading order', () => {
    for (const tab of TABS) {
      const html = render(tab, { game: playedGame() })
      expect(html).not.toMatch(/<button(?![^>]*type="button")/)
      expect(html).not.toMatch(/tabindex="[1-9]/)
      expect(html).not.toContain('title=')
    }
  })
})

describe('StepButton', () => {
  const lock = { disabled: false, describedBy: undefined }
  const change = { kind: 'price', product: 'cafe', price: cents(330) } as const

  // A button: Enter and Space click it, as the browser does for any.
  it('makes its change on a click, from the keyboard as well', () => {
    const onChange = vi.fn()
    const element = StepButton({
      label: 'plus',
      text: '+',
      change,
      lock,
      onChange,
    })
    expect(element.type).toBe('button')
    expect(element.props.type).toBe('button')
    element.props.onClick()
    expect(onChange).toHaveBeenCalledWith(change)
  })

  it('does nothing at its limit, where it stays focusable', () => {
    const onChange = vi.fn()
    const element = StepButton({
      label: 'plus',
      text: '+',
      change: null,
      lock,
      onChange,
    })
    expect(element.props.disabled).toBe(false)
    expect(element.props['aria-disabled']).toBe(true)
    element.props.onClick()
    expect(onChange).not.toHaveBeenCalled()
  })
})

/** The « Fournil » section of the panel for `game`. */
function bakeryPart(game: GameState): string {
  const html = render('bakery', { game })
  return (
    `<section class="manage__bakery"${html.split('<section class="manage__bakery"')[1] ?? ''}`.split(
      '<p class="manage__note">',
    )[0] ?? ''
  )
}

/** The section without its tooltips: what shows before any opens. */
function shown(html: string): string {
  return html.replace(/<div id="[^"]*" role="tooltip".*?<\/dl>/g, '')
}

/** The text of each paragraph and list item shown, in order, tags removed. */
function lines(html: string): string[] {
  return [...shown(html).matchAll(/<(p|li)\b[^>]*>(.*?)<\/\1>/g)].map(
    ([, , text]) => (text ?? '').replace(/<[^>]*>/g, ''),
  )
}

/** `game` played to the morning of `day`. */
function playedTo(game: GameState, day: number): GameState {
  let next = game
  while (next.day < day) next = tick(next)
  return next
}

const COSTS = 'Ce que coûte le fournil'
const UNIT_COST = 'Coût d&#x27;un croissant'

describe('« Fournil »', () => {
  const START = createInitialState(42)

  it('shows a closed bakery in one status line, how to open it, its source and its bake, the costs in the tooltips beside', () => {
    const html = bakeryPart(START)
    expect(html).toMatch(
      /^<section class="manage__bakery" aria-labelledby="manage-bakery"><h3 id="manage-bakery">Fournil<\/h3><p id="manage-bakery-status" class="status-line"><span class="status-line__dot status-line__dot--off" aria-hidden="true"><\/span>Fermé<\/p>/,
    )
    expect(words(html, 'button')).toEqual([
      'Ouvrir · four loué',
      'Ouvrir · four acheté',
      'Acheter',
      'Fabriquer',
    ])
    expect(html).not.toContain('disabled')
    // One line shows; the costs, the unit costs and the fixed costs wait in
    // the tooltips.
    expect(lines(html)).toEqual(['Fermé'])
    expect(shown(html)).not.toContain('<table')
    expect(tipOf(html, COSTS)).toEqual([
      'Ce que coûte le fournil',
      `Déménagement${S}: 1${S}500,00${S}$`,
      `Loyer${S}: 2${S}400,00${S}$ par mois`,
      `Four loué${S}: 600,00${S}$ par mois`,
      `Four acheté${S}: 25${S}000,00${S}$`,
      `Capacité${S}: 800 croissants par jour`,
    ])
    expect(tipOf(html, UNIT_COST)).toEqual([
      'Coût d&#x27;un croissant',
      `Acheté${S}: 1,10${S}$`,
      `Fabriqué${S}: 0,55${S}$`,
      `— Frais fixes, four loué${S}: 3${S}000,00${S}$ par mois`,
      `Frais fixes, four acheté${S}: 2${S}400,00${S}$ par mois`,
    ])
    // Each « (i) » ends the row of what it explains.
    expect(shown(html)).toMatch(
      /Ouvrir · four acheté<\/button><button type="button" class="info-button" aria-label="Ce que coûte le fournil"/,
    )
    expect(shown(html)).toMatch(
      /Fabriquer<\/button><\/div><button type="button" class="info-button" aria-label="Coût d&#x27;un croissant"/,
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

  it('shows a bakery open with a leased oven, the notice closing gives in the tooltip', () => {
    const open = playedTo(
      applyDecision(START, { kind: 'openBakery', oven: 'louer' }),
      3,
    )
    const html = bakeryPart(open)
    expect(lines(html)).toEqual(['Ouvert depuis le 2 mai · four loué'])
    expect(html).toContain('status-line__dot--ok')
    expect(words(html, 'button')[0]).toBe('Fermer le fournil')
    expect(tipOf(html, COSTS).slice(0, 2)).toEqual([
      'Ce que coûte le fournil',
      `Fermer donne un préavis${S}: dernier jour le 30 juin.`,
    ])
    expect(tipOf(html, UNIT_COST).slice(-1)).toEqual([
      `— Frais fixes du fournil${S}: 3${S}000,00${S}$ par mois`,
    ])
  })

  it('shows tomorrow on the status line when the plan changes it, and only the oven it has to take the notice back', () => {
    const open = playedTo(
      applyDecision(START, { kind: 'openBakery', oven: 'louer' }),
      3,
    )
    const closing = applyDecision(open, { kind: 'closeBakery' })
    expect(statusLine(bakeryPart(closing), 'manage-bakery-status')).toBe(
      `Ouvert depuis le 2 mai · four loué · Demain${S}: en préavis, dernier jour le 30 juin`,
    )
    expect(tipOf(bakeryPart(closing), COSTS)).not.toContain(
      `Fermer donne un préavis${S}: dernier jour le 30 juin.`,
    )
    const html = bakeryPart(tick(closing))
    expect(lines(html)).toEqual([`En préavis${S}: dernier jour le 30 juin`])
    expect(html).toContain('status-line__dot--warn')
    expect(tags(html, 'button').slice(0, 2)).toEqual([
      '<button type="button" class="button">',
      '<button type="button" class="button" disabled="">',
    ])
  })

  it('cancels an opening planned for tomorrow, and says it opens', () => {
    const html = bakeryPart(
      applyDecision(START, { kind: 'openBakery', oven: 'acheter' }),
    )
    expect(statusLine(html, 'manage-bakery-status')).toBe(
      `Fermé · Demain${S}: ouvert · four acheté`,
    )
    expect(words(html, 'button')[0]).toBe('Annuler l&#x27;ouverture')
  })

  it('leases no oven once the business owns one, which its tooltip says', () => {
    let game = playedTo(
      applyDecision(START, { kind: 'openBakery', oven: 'acheter' }),
      3,
    )
    game = playedTo(applyDecision(game, { kind: 'closeBakery' }), 63)
    const html = bakeryPart(game)
    expect(tipOf(html, COSTS)).toContain(`Four acheté${S}: déjà à vous`)
    expect(html).toContain(
      '<button type="button" class="button" disabled="">Ouvrir · four loué</button><button type="button" class="button">Ouvrir · four acheté</button>',
    )
    expect(tipOf(html, UNIT_COST).slice(3)).toEqual([
      `— Frais fixes, four acheté${S}: 2${S}400,00${S}$ par mois`,
    ])
  })

  it('says on the source’s status line that the croissants are bought while no bakery runs to make them', () => {
    const html = bakeryPart(
      applyDecision(START, { kind: 'croissantSource', source: 'fabriquer' }),
    )
    expect(html).toContain('aria-pressed="true">Fabriquer</button>')
    expect(statusLine(html, 'manage-bakery-source-status')).toBe(
      'Sans fournil ouvert, les croissants sont achetés.',
    )
    expect(html).toContain('status-line__dot--warn')
    expect(html).toContain(
      'aria-label="Provenance des croissants" aria-describedby="manage-bakery-source-status"',
    )
    expect(statusLine(bakeryPart(START), 'manage-bakery-source-status')).toBe(
      null,
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
    gameStore.getState().setTruckTab('schedule')
    expect(renderToStaticMarkup(<ManagePanel />)).toContain(
      'Le Défi fixe l&#x27;horaire.',
    )
  })

  it('is a modal dialog in the dock’s frame, labelled by its title « Le camion », with its five tabs', () => {
    const html = renderToStaticMarkup(<ManagePanel />)
    expect(html).toMatch(
      /^<dialog class="panel dock-frame dock-panel manage" aria-labelledby="([^"]+)"><div class="dock-frame__header"><h2 id="\1" class="dock-frame__title">Le camion<\/h2><div class="dock-frame__tabs" role="tablist" aria-label="Le camion">.*<\/dialog>$/,
    )
    expect(
      tags(html, 'button')
        .filter((tag) => tag.includes('role="tab"'))
        .map((tag) => attribute(tag, 'aria-selected')),
    ).toEqual(['true', 'false', 'false', 'false', 'false'])
    expect(texts(html, 'button').slice(0, 5)).toEqual([
      'Menu',
      'Stocks',
      'Horaire',
      'Salaire et marketing',
      'Fournil',
    ])
    expect(html).not.toContain('>Fermer</button>')
    expect(html).not.toContain('Gérer le camion')
  })

  it('opens on the tab last shown', () => {
    gameStore.getState().setTruckTab('payMarketing')
    const html = renderToStaticMarkup(<ManagePanel />)
    expect(html).toMatch(
      /aria-selected="true" data-tuto="tab\.\w+" aria-controls/,
    )
    expect(html).toMatch(/aria-selected="true"[^>]*>Salaire et marketing</)
    expect(html).toContain('id="manage-pay-weekly"')
  })

  it('opens on « Fournil » from the bakery in the city', () => {
    gameStore.getState().openPanel('manage', 'bakery')
    const html = renderToStaticMarkup(<ManagePanel />)
    expect(html).toMatch(/aria-selected="true"[^>]*>Fournil</)
    expect(html).toContain('<h3 id="manage-bakery">Fournil</h3>')
  })

  it('shows the bakery planned for the next morning', () => {
    gameStore.getState().decide({ kind: 'openBakery', oven: 'louer' })
    gameStore.getState().setTruckTab('bakery')
    const html = renderToStaticMarkup(<ManagePanel />)
    expect(statusLine(html, 'manage-bakery-status')).toBe(
      `Fermé · Demain${S}: ouvert · four loué`,
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
    expect(statusLine(html, 'manage-price-cafe-status')).toBe(
      `Demain${S}: 3,00${S}$`,
    )
    gameStore.getState().setTruckTab('schedule')
    const days = renderToStaticMarkup(<ManagePanel />)
    expect(attribute(button(days, 'lundi'), 'aria-pressed')).toBe('true')
    expect(attribute(button(days, 'mercredi'), 'aria-pressed')).toBe('false')
    expect(gameStore.getState().game.decisions.prices.cafe).toBe(325)
  })
})
