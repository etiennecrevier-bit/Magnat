import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  loadEventContent,
  type DifficultyId,
  type EventCard as Card,
} from '../content/schema.ts'
import { createInitialState } from '../engine/clock.ts'
import { EVENTS } from '../engine/day.ts'
import type { GameState } from '../engine/types.ts'
import EventCard, { EventCardView, type EventResult } from './EventCard.tsx'
import { gameStore, newChallenge, type GameStoreState } from './store.ts'

// A static render reads a Zustand store's initial state, so the connected
// card reads the app store's current state through this stand-in.
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

// Every space in an amount is a no-break space (U+00A0); a loss takes the
// minus sign (U+2212).
const S = ' '
const M = '−'

const [ESSAI] = EVENTS.events as [Card]

/** A card with two choices and no quote. */
const [TWO_CHOICES] = loadEventContent({
  pacing: { firstDay: 0, minDaysBetween: 0, dailyChance: 1 },
  events: [
    {
      id: 'chequeDansLaMalle',
      weight: 0,
      character: { id: 'gilles', name: 'Gilles Lacasse', role: 'Traiteur' },
      title: 'Le chèque est dans la malle',
      situation: 'Le chèque est parti, promis.',
      choices: [
        {
          id: 'patienter',
          label: 'Patienter',
          tags: ['Payé plus tard'],
          outcomes: [{ chance: 1, result: 'Vous patientez.', effects: [] }],
        },
        {
          id: 'allerLeVoir',
          label: 'Aller le voir au bureau',
          tags: ['Énergie −5', 'Risqué'],
          outcomes: [
            { chance: 0.7, result: 'Il paie.', effects: [] },
            { chance: 0.3, result: 'Faillite.', effects: [] },
          ],
        },
      ],
    },
  ],
}).events as [Card]

function render(
  card: Card = ESSAI,
  result: EventResult | null = null,
  portrait: string | null = null,
  allowed: readonly string[] | null = null,
  difficulty: DifficultyId = 'facile',
) {
  return renderToStaticMarkup(
    <EventCardView
      card={card}
      difficulty={difficulty}
      portrait={portrait}
      result={result}
      allowed={allowed}
      onChoose={() => {}}
      onContinue={() => {}}
    />,
  )
}

/** Each choice button's key, label and tags, in order. */
function choices(html: string) {
  return [
    ...html.matchAll(
      /<button[^>]*class="event-card__choice"[^>]*>(.*?)<\/button>/g,
    ),
  ].map(([button, inner]) => ({
    shortcut: /aria-keyshortcuts="([^"]*)"/.exec(button)?.[1],
    key: /class="event-card__key" aria-hidden="true">([^<]*)</.exec(
      inner ?? '',
    )?.[1],
    label: /class="event-card__label">([^<]*)</.exec(inner ?? '')?.[1],
    tags: [...(inner ?? '').matchAll(/class="event-card__tag">([^<]*)</g)].map(
      ([, tag]) => tag,
    ),
  }))
}

function waiting(event = 'essai'): GameState {
  const game = createInitialState(1)
  return {
    ...game,
    events: { ...game.events, pending: { event, followUp: false } },
  }
}

describe('EventCardView', () => {
  it('shows who brings it, the title, the situation and their words', () => {
    const html = render()
    expect(html).toContain(
      '<div class="event-card__who"><svg class="event-card__portrait event-card__silhouette" viewBox="0 0 96 96" width="96" height="96" aria-hidden="true" focusable="false">',
    )
    expect(html).toContain(
      '<p class="event-card__name">Thérèse Essai</p><p class="event-card__role">Vérificatrice des cartes</p>',
    )
    expect(html).toContain(
      '<h2 id="event-title" class="event-card__title" tabindex="-1">La carte d&#x27;essai</h2><p class="event-card__situation">Une carte qui fait un peu de tout',
    )
    expect(html).toContain(
      `<blockquote class="event-card__quote"><p>«${S}Si vous me lisez, quelque chose cloche.${S}»</p></blockquote>`,
    )
  })

  it("shows the character's portrait when there is one", () => {
    const html = render(ESSAI, null, '/assets/essai.png')
    expect(html).toContain(
      '<img class="event-card__portrait" src="/assets/essai.png" alt="" width="96" height="96"/>',
    )
    expect(html).not.toContain('event-card__silhouette')
  })

  it('shows three choices as numbered buttons, with their tags at Facile', () => {
    // Facile keeps the gains and takes 0.7 of the losses.
    const html = render()
    expect(choices(html)).toEqual([
      {
        shortcut: '1',
        key: '1',
        label: 'Tout essayer',
        tags: [`Ventes +950${S}$`, `Énergie ${M}7`, 'Risqué'],
      },
      {
        shortcut: '2',
        key: '2',
        label: 'Relancer le client',
        tags: ['Risqué'],
      },
      {
        shortcut: '3',
        key: '3',
        label: 'Ne rien faire',
        tags: ['Rien ne change'],
      },
    ])
    expect(html).toContain(
      '<ol class="event-card__choices"><li><button type="button"',
    )
  })

  it('shows the amounts that apply at Difficile, to the dollar', () => {
    // Difficile gives 0.7 of the gains and takes 1.2 of the losses.
    const [toutEssayer] = choices(render(ESSAI, null, null, null, 'difficile'))
    expect(toutEssayer?.tags).toEqual([
      `Ventes +665${S}$`,
      `Énergie ${M}12`,
      'Risqué',
    ])
  })

  it('shows a tag only at the difficulties where it holds', () => {
    const card = EVENTS.events.find(({ id }) => id === 'grosseCommande')
    if (card === undefined) throw new Error('No grosseCommande')
    const refuser = (difficulty: DifficultyId) =>
      choices(render(card, null, null, null, difficulty)).at(-1)?.tags
    expect(refuser('moyen')).toEqual(['Rien ne change'])
    expect(refuser('difficile')).toEqual([`Énergie ${M}6`])
  })

  it('disables the choices a Défi leaves out, with the reason and no key', () => {
    const html = render(ESSAI, null, null, ['toutEssayer'])
    expect(
      choices(html).map(({ shortcut, label }) => [shortcut, label]),
    ).toEqual([
      ['1', 'Tout essayer'],
      [undefined, 'Relancer le client'],
      [undefined, 'Ne rien faire'],
    ])
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map(([tag]) => tag)
    expect(buttons[0]).not.toContain('disabled')
    for (const [tag, id] of [
      [buttons[1], 'relancer'],
      [buttons[2], 'rienFaire'],
    ] as const) {
      expect(tag).toContain(' disabled=""')
      expect(tag).toContain(`aria-describedby="event-choice-${id}-reason"`)
      expect(html).toContain(
        `</button><p id="event-choice-${id}-reason" class="event-card__forbidden">Le Défi impose un autre choix.</p></li>`,
      )
    }
  })

  it('leaves every choice open outside a Défi', () => {
    const html = render(ESSAI, null, null, null)
    expect(html).not.toContain('disabled')
    expect(html).not.toContain('event-card__forbidden')
  })

  it('shows two choices, and no quote when there is none', () => {
    const html = render(TWO_CHOICES)
    expect(choices(html)).toEqual([
      { shortcut: '1', key: '1', label: 'Patienter', tags: ['Payé plus tard'] },
      {
        shortcut: '2',
        key: '2',
        label: 'Aller le voir au bureau',
        tags: ['Énergie −5', 'Risqué'],
      },
    ])
    expect(html).not.toContain('<blockquote')
  })

  it('never shows the odds, nor a way to close it', () => {
    for (const html of [render(), render(TWO_CHOICES)]) {
      expect(html).not.toMatch(/%|0[,.]\d|chance/i)
      expect(html).not.toContain('Fermer')
      expect(html).not.toContain('Continuer')
    }
  })

  it('shows what came of the choice in place of the choices, then Continuer', () => {
    const html = render(ESSAI, {
      choice: 'Tout essayer',
      text: 'Tout a été essayé.',
      changes: [`Encaisse ${M}220${S}$ jeudi`, `Énergie ${M}15`],
    })
    expect(choices(html)).toEqual([])
    expect(html).toContain(
      `<section class="event-card__result" aria-label="Résultat" tabindex="-1"><p class="event-card__chosen">Votre choix${S}: Tout essayer</p><p class="event-card__outcome">Tout a été essayé.</p><ul class="event-card__changes"><li>Encaisse ${M}220${S}$ jeudi</li><li>Énergie ${M}15</li></ul><button type="button" class="button button--primary event-card__continue">Continuer</button></section>`,
    )
  })

  it('shows no list when the choice changed nothing', () => {
    const html = render(ESSAI, {
      choice: 'Ne rien faire',
      text: 'Rien ne se passe.',
      changes: [],
    })
    expect(html).not.toContain('event-card__changes')
    expect(html).toContain('Continuer')
  })
})

describe('EventCard', () => {
  it('is a modal dialog labelled by its title, for the event waiting', () => {
    gameStore.getState().startGame(waiting())
    const html = renderToStaticMarkup(<EventCard />)
    expect(html).toMatch(
      /^<dialog class="panel event-card" aria-labelledby="event-title"><div class="panel__content event-card__content">.*<\/dialog>$/,
    )
    expect(html).toContain('La carte d&#x27;essai')
    expect(choices(html)).toHaveLength(3)
  })

  it('shows what the choice did once it is made', () => {
    // At Moyen: −130 $ + 260 $ − 20 croissants at 1,10 $ now, −65 $ later.
    gameStore.getState().startGame(waiting())
    gameStore.getState().chooseEvent('toutEssayer')
    const html = renderToStaticMarkup(<EventCard />)
    expect(choices(html)).toEqual([])
    expect(html).toContain(
      `<p class="event-card__chosen">Votre choix${S}: Tout essayer</p><p class="event-card__outcome">Tout a été essayé. Thérèse coche sa liste.</p>`,
    )
    expect(html).toContain(`<li>Encaisse +108${S}$</li>`)
    expect(html).toContain(`<li>Encaisse ${M}65${S}$ jeudi</li>`)
    expect(html).toContain('Continuer')
  })

  it('leaves only « Accepter » on « La grosse commande » of « Payé dans 60 jours »', () => {
    // The Défi forces the card on its third morning, Wednesday, May 10.
    gameStore.getState().startGame(newChallenge('?seed=7', 'payeDans60Jours'))
    gameStore.getState().advance(5)
    expect(gameStore.getState()).toMatchObject({
      game: { day: 9, events: { pending: { event: 'grosseCommande' } } },
      panel: 'event',
    })
    const html = renderToStaticMarkup(<EventCard />)
    expect(
      choices(html).map(({ shortcut, label }) => [shortcut, label]),
    ).toEqual([
      ['1', 'Accepter'],
      [undefined, 'Accepter, mais payé à la livraison'],
      [undefined, 'Refuser poliment'],
    ])
    expect(html.match(/ disabled=""/g)).toHaveLength(2)
    // A Défi plays the cards as written, and its tags say so.
    expect(choices(html)[0]?.tags[0]).toBe(`Ventes +750${S}$`)
  })

  it('shows nothing for an event the content does not hold', () => {
    gameStore.setState({ game: waiting('inconnu'), panel: 'event' })
    expect(renderToStaticMarkup(<EventCard />)).toBe('')
  })
})
