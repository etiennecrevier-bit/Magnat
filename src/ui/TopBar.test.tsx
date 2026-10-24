import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DifficultyId } from '../content/schema.ts'
import { defiById } from '../engine/challenge.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import { DEFIS, FOOD_TRUCK } from '../engine/day.ts'
import { applyDecision } from '../engine/decisions.ts'
import { cents } from '../engine/money.ts'
import { titleOf } from '../engine/dream.ts'
import { netWorth } from '../engine/netWorth.ts'
import { defaultProfile } from '../engine/profile.ts'
import type { GameState } from '../engine/types.ts'
import { closedBakery } from '../engine/bakery.ts'
import { balance, postEntry } from '../finance/journal.ts'
import { LOW_BELOW_MONTHS, monthlyFixedCosts } from './cashLevel.ts'
import type { TopAlert } from './alerts.ts'
import { sparklinePoints } from './cashChip.ts'
import { cashAtCloses } from './cashHistory.ts'
import { createMessageStack } from './messageStack.ts'
import { gameStore, newChallenge, type GameStoreState } from './store.ts'
import TopBar, { TopBarView } from './TopBar.tsx'

// A static render reads a Zustand store's initial state, so the connected
// top bar reads the app store's current state through this stand-in.
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
const S = '\u00a0'

function render(
  day: number,
  speed: number,
  cash = cents(1_000_000),
  businessName = "Le P'tit Camion",
  energy = 100,
  defiLabel: string | null = null,
  defiEnergy: string | null = null,
  title: string | null = null,
  alerts: readonly TopAlert[] = [],
) {
  return renderToStaticMarkup(
    <TopBarView
      businessName={businessName}
      day={day}
      cash={cash}
      fixedCosts={cents(175_000)}
      title={title}
      energy={energy}
      avatar="homme"
      speed={speed}
      onSpeedChange={() => {}}
      alerts={alerts}
      defiLabel={defiLabel}
      defiEnergy={defiEnergy}
      onDefi={() => {}}
      onSettings={() => {}}
    />,
  )
}

/**
 * A game of `difficulty` on `seed`, the owner paid `weeklyPay` cents a week
 * from the first morning, played with no events to the morning of `day`.
 */
function playedTo(
  difficulty: DifficultyId,
  seed: number,
  weeklyPay: number,
  day: number,
): GameState {
  const start = createInitialState(seed, FOOD_TRUCK, {
    ...defaultProfile(),
    difficulty,
  })
  let game = applyDecision(start, {
    kind: 'ownerWeeklyPay',
    pay: cents(weeklyPay),
  })
  while (game.day < day) game = tick(game)
  return game
}

/** Each button's accessible label and pressed state, in order. */
function buttons(html: string) {
  return [...html.matchAll(/<button[^>]*>/g)].map(([tag]) => ({
    label: /aria-label="([^"]*)"/.exec(tag)?.[1],
    pressed: /aria-pressed="([^"]*)"/.exec(tag)?.[1],
  }))
}

/** The speed button pressed: the switch's, which have no label, aside. */
function pressedSpeed(html: string) {
  return buttons(html).find(
    ({ label, pressed }) => label !== undefined && pressed === 'true',
  )
}

describe('TopBarView', () => {
  it('shows the game date in French', () => {
    expect(render(244, 1)).toContain(
      '<p class="top-bar__date">Dimanche 31 décembre, an 1</p>',
    )
  })

  it('shows the business name above the date, on the card at the left', () => {
    expect(render(0, 1, cents(0), 'Chez Mimi')).toMatch(
      /^<header class="top-bar"><div class="top-bar__left"><div class="top-bar__title"><p class="top-bar__name">Chez Mimi<\/p><p class="top-bar__date">Lundi 1er mai, an 1<\/p><\/div>/,
    )
  })

  it("shows the owner's title of « Le rêve » under the date", () => {
    expect(
      render(0, 1, cents(0), 'Chez Mimi', 100, null, null, 'Débrouillard'),
    ).toContain(
      '<p class="top-bar__date">Lundi 1er mai, an 1</p><p class="top-bar__owner">Débrouillard</p></div>',
    )
    expect(render(0, 1)).not.toContain('top-bar__owner')
  })

  it('shows the card, the cash chip, then the energy pill at the left, and no net worth', () => {
    const html = render(0, 1, cents(-12_345), "Le P'tit Camion", 30)
    expect(html).toMatch(
      /^<header class="top-bar"><div class="top-bar__left"><div class="top-bar__title">.*<\/div><button type="button" class="cash-chip cash-chip--negative".*<\/button><div id="[^"]+" role="tooltip".*<\/div><div class="top-bar__energy"><svg class="icon".*<\/svg><p class="energy-gauge energy-gauge--tired">.*<\/p><\/div><\/div><div class="top-bar__right">/,
    )
    expect(html).toContain(`<span class="cash-chip__amount">-123${S}$</span>`)
    expect(html).toContain(`<dd>-123,45${S}$</dd>`)
    expect(html).toContain('Fatigué')
    expect(html).not.toContain('Valeur nette')
  })

  it('has no panel buttons: the dock opens the panels', () => {
    const html = render(0, 1)
    for (const gone of [
      'Gérer le camion',
      'Qui fait quoi',
      'Vos finances',
      'Aller à',
      'Le rêve',
    ]) {
      expect(html).not.toContain(gone)
    }
  })

  it('shows the alerts as chips with an icon and words, between the speeds and the gear', () => {
    const html = render(
      0,
      1,
      cents(0),
      "Le P'tit Camion",
      100,
      null,
      null,
      null,
      [
        { id: 'missed', icon: 'alerte', label: 'Livraison manquée' },
        { id: 'messages', icon: 'cahier', label: '2 messages' },
      ],
    )
    expect(html).toMatch(
      /<\/div><ul class="top-bar__alerts" aria-label="Alertes"><li><button type="button" class="top-bar__alert top-bar__alert--missed"><svg class="icon"[^>]*>.*?<\/svg>Livraison manquée<\/button><\/li><li><button type="button" class="top-bar__alert top-bar__alert--messages"><svg class="icon"[^>]*>.*?<\/svg>2 messages<\/button><\/li><\/ul><button type="button" class="top-bar__settings"/,
    )
    expect(render(0, 1)).not.toContain('top-bar__alerts')
  })

  it('shows the Défi chip under the date, which opens its dialog', () => {
    const html = render(
      21,
      1,
      cents(0),
      "Le P'tit Camion",
      100,
      'Défi · semaine 2 de 3',
    )
    expect(html).toContain(
      '<p class="top-bar__date">Lundi 22 mai, an 1</p><button type="button" class="top-bar__defi" aria-haspopup="dialog">Défi · semaine 2 de 3</button></div>',
    )
  })

  it("puts the owner's energy against the Défi's floor on a line of its own in the chip", () => {
    const energy = `Énergie${S}: 52 (plancher${S}: 33)`
    expect(
      render(
        21,
        1,
        cents(0),
        "Le P'tit Camion",
        52,
        'Défi · semaine 2 de 3',
        energy,
      ),
    ).toContain(
      `<button type="button" class="top-bar__defi top-bar__defi--energy" aria-haspopup="dialog">Défi · semaine 2 de 3 <span class="top-bar__defi-energy">${energy}</span></button>`,
    )
  })

  it('ends with the gear, which opens the « Réglages » dialog', () => {
    expect(render(0, 1)).toMatch(
      /<\/div><button type="button" class="top-bar__settings" aria-label="Réglages" aria-haspopup="dialog" title="Réglages"><svg class="icon"[^>]*>.*<\/svg><\/button><\/div><\/header>$/,
    )
  })

  it('has no chip outside a Défi', () => {
    expect(render(0, 1)).not.toContain('top-bar__defi')
  })

  it('has a labelled group of pause and speed buttons', () => {
    const html = render(0, 1)
    expect(html).toContain('role="group" aria-label="Vitesse du jeu"')
    expect(
      buttons(html)
        .filter(({ pressed }) => pressed !== undefined)
        .map(({ label }) => label),
    ).toEqual(['Pause', 'Vitesse normale', 'Vitesse ×3', 'Vitesse ×10'])
    expect(html).not.toMatch(/<button(?![^>]*type="button")/)
  })

  it.each([
    { speed: 0, active: 'Pause' },
    { speed: 1, active: 'Vitesse normale' },
    { speed: 10, active: 'Vitesse ×10' },
  ])('marks only $active as pressed', ({ speed, active }) => {
    const speeds = buttons(render(0, speed)).filter(
      ({ pressed }) => pressed !== undefined,
    )
    expect(speeds).toHaveLength(4)
    for (const { label, pressed } of speeds) {
      expect(pressed).toBe(label === active ? 'true' : 'false')
    }
  })
})

describe('the switch between the street and the city', () => {
  it('is gone: the dock’s « Ville » shows the city', () => {
    expect(render(0, 1)).not.toContain('top-bar__views')
    expect(renderToStaticMarkup(<TopBar />)).not.toContain('La ville')
  })
})

describe('TopBar', () => {
  it("shows the title the owner's net worth earns, from the app store, under the date", () => {
    const title = titleOf(netWorth(gameStore.getState().game))?.name
    expect(title).toBeDefined()
    expect(renderToStaticMarkup(<TopBar />)).toContain(
      `<p class="top-bar__owner">${title}</p>`,
    )
  })

  it('draws the encaisse at the closes of the last 30 days played', () => {
    gameStore.getState().startGame(playedTo('moyen', 42, 0, 40))
    const { game } = gameStore.getState()
    const closes = cashAtCloses(game.journal, 0, game.day - 1, 30)
    expect(closes).toHaveLength(30)
    expect(renderToStaticMarkup(<TopBar />)).toContain(
      `<polyline points="${sparklinePoints(closes)}"`,
    )
  })

  it('shows a chip while a delivery was missed this week, and one for the messages waiting', () => {
    const stack = createMessageStack()
    expect(renderToStaticMarkup(<TopBar stack={stack} />)).not.toContain(
      'top-bar__alerts',
    )
    const { game } = gameStore.getState()
    gameStore.getState().startGame({
      ...game,
      day: 2,
      contracts: {
        ...game.contracts,
        missed: [{ day: 0, grocer: 'marcheBioLogique' }],
      },
    })
    expect(renderToStaticMarkup(<TopBar stack={stack} />)).toContain(
      'Livraison manquée</button>',
    )
  })

  it("shows the app store: the profile's name, day 0 at normal speed, with the starting cash and a rested owner", () => {
    const html = renderToStaticMarkup(<TopBar />)
    expect(html).toContain('<p class="top-bar__name">Le P&#x27;tit Camion</p>')
    expect(html).toContain('Lundi 1er mai, an 1')
    expect(html).toContain('cash-chip--healthy')
    expect(html).toContain(`10${S}000${S}$`)
    expect(html).toContain('Saine')
    // The default avatar is a woman's, so the word agrees with her.
    expect(html).toContain('energy-gauge--rested')
    expect(html).toContain('aria-valuenow="100" aria-valuetext="Reposée"')
    expect(pressedSpeed(html)).toEqual({
      label: 'Vitesse normale',
      pressed: 'true',
    })
  })

  it("shows the Défi's week in the chip, and its panel only while it is open", () => {
    // « Les travaux de la rue Saint-Denis » runs 3 weeks from May 15.
    gameStore.getState().startGame(newChallenge('?seed=7', 'travauxSaintDenis'))
    gameStore.getState().advance(7)
    // The week's report opens on the Monday, the Défi's second.
    expect(gameStore.getState().panel).toBe('report')
    gameStore.getState().closePanel()
    const html = renderToStaticMarkup(<TopBar />)
    expect(html).toContain('Lundi 22 mai, an 1')
    expect(html).toContain(
      '<button type="button" class="top-bar__defi" aria-haspopup="dialog">Défi · semaine 2 de 3</button>',
    )
    expect(html).not.toContain('top-bar__owner')
  })

  it("shows the owner's energy against the floor of « Les deux semaines sans congé » in its chip", () => {
    const [floor] = defiById(DEFIS, 'moisSansConge').conditions
    if (floor?.kind !== 'minEnergy') throw new Error('It sets an energy floor')
    gameStore.getState().startGame(newChallenge('?seed=7', 'moisSansConge'))
    expect(renderToStaticMarkup(<TopBar />)).toContain(
      `aria-haspopup="dialog">Défi · semaine 1 de 2 <span class="top-bar__defi-energy">Énergie${S}: 100 (plancher${S}: ${floor.amount})</span></button>`,
    )
  })

  it("reads the encaisse against the bakery's rent and lease too", () => {
    // The bakery open since day 1 with a leased oven, and Encaisse set, as
    // a fixture, to the low threshold of the truck's fixed costs alone.
    let game = applyDecision(createInitialState(1), {
      kind: 'openBakery',
      oven: 'louer',
    })
    game = tick(tick(game))
    const truckOnly = monthlyFixedCosts(game.day, game.profile.difficulty)
    const withBakery = monthlyFixedCosts(
      game.day,
      game.profile.difficulty,
      0,
      FOOD_TRUCK,
      undefined,
      game.bakery,
    )
    expect(withBakery).toBeGreaterThan(truckOnly)
    const target = truckOnly * LOW_BELOW_MONTHS
    const gap = target - balance(game.journal, '1000', { toDay: game.day })
    game = {
      ...game,
      journal: postEntry(game.journal, {
        day: game.day,
        memo: 'Ajustement',
        lines:
          gap > 0
            ? [
                { account: '1000', debit: cents(gap), credit: cents(0) },
                { account: '3000', debit: cents(0), credit: cents(gap) },
              ]
            : [
                { account: '3000', debit: cents(-gap), credit: cents(0) },
                { account: '1000', debit: cents(0), credit: cents(-gap) },
              ],
      }),
    }
    gameStore.getState().startGame(game)
    expect(renderToStaticMarkup(<TopBar />)).toContain('cash-chip--low')
    gameStore.getState().startGame({ ...game, bakery: closedBakery() })
    expect(renderToStaticMarkup(<TopBar />)).toContain('cash-chip--healthy')
  })

  it('shows « En route vers… » under the date on a day with a trip, and nothing without', () => {
    expect(renderToStaticMarkup(<TopBar />)).not.toContain('top-bar__en-route')
    gameStore.getState().decide({ kind: 'goTo', place: 'meunerie' })
    expect(renderToStaticMarkup(<TopBar />)).toMatch(
      /<p class="top-bar__date">[^<]*<\/p><p class="top-bar__owner">[^<]*<\/p><p class="top-bar__en-route">En route vers la meunerie<\/p><\/div>/,
    )
    gameStore.getState().decide({ kind: 'goTo', place: null })
    expect(renderToStaticMarkup(<TopBar />)).not.toContain('top-bar__en-route')
  })

  // The 1st of the month takes the permit and the insurance, and also the
  // truck's own charge: the lease at Difficile, the loan payment at Moyen.
  // These mornings have less cash than that 1st takes, so the day ends in
  // the red (#116).
  it.each([
    {
      difficulty: 'difficile',
      weeklyPay: 100_000,
      day: 61,
      date: 'Samedi 1er juillet, an 1',
      cash: `2${S}612${S}$`,
    },
    {
      difficulty: 'moyen',
      weeklyPay: 150_000,
      day: 123,
      date: 'Vendredi 1er septembre, an 1',
      cash: `1${S}230${S}$`,
    },
  ] as const)(
    'warns that cash is low at $difficulty on the morning of $date, which ends below zero',
    ({ difficulty, weeklyPay, day, date, cash }) => {
      const game = playedTo(difficulty, 1, weeklyPay, day)
      const evening = balance(tick(game).journal, '1000', { toDay: day })
      expect(evening).toBeLessThan(0)
      gameStore.getState().startGame(game)
      const html = renderToStaticMarkup(<TopBar />)
      expect(html).toContain(date)
      expect(html).toContain(`<span class="cash-chip__amount">${cash}</span>`)
      expect(html).toContain('cash-chip--low')
      expect(html).toContain('Faible')
    },
  )
})
