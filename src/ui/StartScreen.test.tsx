import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Avatar, DifficultyId } from '../content/schema.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import { serialize } from '../engine/save.ts'
import { SAVE_KEY, type StoredSave } from './saves.ts'
import StartScreen, { NewGameFormView, StartMenuView } from './StartScreen.tsx'

// Every space in an amount is a no-break space (U+00A0).
const S = ' '

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const SAVED_GAME = tick(
  tick(
    createInitialState(7, FOOD_TRUCK, {
      businessName: 'Chez Mimi',
      avatar: 'homme',
      difficulty: 'facile',
    }),
  ),
)

function menu(stored: StoredSave) {
  return renderToStaticMarkup(
    <StartMenuView
      stored={stored}
      onContinue={() => {}}
      onNewGame={() => {}}
      onDefis={() => {}}
    />,
  )
}

/** Each button's text and class, in order. */
function buttons(html: string) {
  return [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(
    ([, attributes, text]) => ({
      text,
      primary: / class="[^"]*button--primary/.test(attributes ?? ''),
    }),
  )
}

interface FormOptions {
  difficulty?: DifficultyId
  businessName?: string
  avatar?: Avatar
  replacesSave?: boolean
}

function form({
  difficulty = 'moyen',
  businessName = "Le P'tit Camion",
  avatar = 'femme',
  replacesSave = false,
}: FormOptions = {}) {
  return renderToStaticMarkup(
    <NewGameFormView
      difficulty={difficulty}
      businessName={businessName}
      avatar={avatar}
      replacesSave={replacesSave}
      onDifficultyChange={() => {}}
      onBusinessNameChange={() => {}}
      onAvatarChange={() => {}}
      onStart={() => {}}
      onBack={() => {}}
    />,
  )
}

/** Each radio button of the group `name`: its value and whether it is checked. */
function radios(html: string, name: string) {
  return [
    ...html.matchAll(
      new RegExp(`<input type="radio" name="${name}"[^>]*>`, 'g'),
    ),
  ].map(([tag]) => ({
    value: /value="([^"]*)"/.exec(tag)?.[1],
    checked: tag.includes('checked=""'),
  }))
}

describe('StartMenuView', () => {
  it('offers a new game first when the browser has no save, then the Défis', () => {
    const html = menu({ status: 'none' })
    expect(html).toContain('<h1')
    expect(html).toContain('>Magnat</h1>')
    expect(buttons(html)).toEqual([
      { text: 'Nouvelle partie', primary: true },
      { text: 'Défis', primary: false },
    ])
    expect(html).not.toContain('Continuer')
    expect(html).not.toContain('class="notice"')
  })

  it('offers to continue the saved game, named with its date', () => {
    const html = menu({ status: 'found', game: SAVED_GAME })
    expect(buttons(html)).toEqual([
      { text: 'Continuer', primary: true },
      { text: 'Nouvelle partie', primary: false },
      { text: 'Défis', primary: false },
    ])
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1]
    expect(html).toContain(
      `<p id="${describedBy}" class="start-screen__saved">Chez Mimi, mercredi 3 mai, an 1</p>`,
    )
  })

  it('leaves the import and the visual effects to « Réglages »', () => {
    const html = menu({ status: 'found', game: SAVED_GAME })
    expect(html).not.toContain('Importer')
    expect(html).not.toContain('type="file"')
    expect(html).not.toContain('Effets visuels')
    expect(html).not.toContain('<fieldset')
  })

  it('says when the saved game no longer loads', () => {
    const html = menu({ status: 'unreadable' })
    expect(html).toContain(
      '<p class="notice">La partie sauvegardée dans ce navigateur ne peut plus être chargée. Une nouvelle partie la remplacera.</p>',
    )
    expect(html).not.toContain('Continuer')
  })

  it('says when the browser blocks saving', () => {
    const html = menu({ status: 'unavailable' })
    expect(html).toContain(
      '<p class="notice">Ce navigateur bloque la sauvegarde automatique. Exportez votre partie dans les Réglages pour la reprendre plus tard.</p>',
    )
    expect(html).not.toContain('Continuer')
  })
})

describe('NewGameFormView', () => {
  it('shows the three difficulties side by side, each with what it means', () => {
    const html = form()
    expect(html).toContain('<legend>Difficulté</legend>')
    const cards = [
      ...html.matchAll(
        /<label class="difficulty-card">.*?<span class="difficulty-card__name">([^<]*)<\/span><span class="difficulty-card__line">([^<]*)<\/span><\/label>/g,
      ),
    ].map(([, name, line]) => ({ name, line }))
    expect(cards).toEqual([
      {
        name: 'Facile',
        line: `Le camion est à vous, 15${S}000,00${S}$ en banque`,
      },
      {
        name: 'Moyen',
        line: `Prêt de démarrage de 70${S}000,00${S}$ à la Caisse, 10${S}000,00${S}$ en banque`,
      },
      {
        name: 'Difficile',
        line: `Camion loué 1${S}800,00${S}$ par mois, 5${S}000,00${S}$ en banque`,
      },
    ])
  })

  it.each<DifficultyId>(['facile', 'moyen', 'difficile'])(
    'checks %s when it is the one picked',
    (difficulty) => {
      expect(radios(form({ difficulty }), 'difficulty')).toEqual(
        ['facile', 'moyen', 'difficile'].map((value) => ({
          value,
          checked: value === difficulty,
        })),
      )
    },
  )

  it('has a labelled business name field holding what was typed', () => {
    const html = form({ businessName: 'Chez Mimi' })
    const id =
      /<label class="new-game__label" for="([^"]+)">Nom de l&#x27;entreprise<\/label>/.exec(
        html,
      )?.[1]
    expect(id).toBeDefined()
    expect(html).toContain(
      `<input id="${id}" class="new-game__name" type="text" autoComplete="off" aria-invalid="false" value="Chez Mimi"/>`,
    )
    expect(html).not.toContain('new-game__error')
  })

  it.each([
    ['', 'Donnez un nom à votre entreprise.'],
    [
      'x'.repeat(31),
      'Le nom de l&#x27;entreprise compte au plus 30 caractères.',
    ],
  ])('marks the name %j invalid and says why', (businessName, message) => {
    const html = form({ businessName })
    const describedBy = /aria-invalid="true" aria-describedby="([^"]+)"/.exec(
      html,
    )?.[1]
    expect(describedBy).toBeDefined()
    expect(html).toContain(
      `<p id="${describedBy}" class="new-game__error">${message}</p>`,
    )
  })

  it.each<Avatar>(['femme', 'homme'])(
    'offers Femme and Homme, %s checked',
    (avatar) => {
      const html = form({ avatar })
      expect(html).toContain('<legend>Avatar</legend>')
      expect(radios(html, 'avatar')).toEqual([
        { value: 'femme', checked: avatar === 'femme' },
        { value: 'homme', checked: avatar === 'homme' },
      ])
      expect(html).toMatch(/value="femme"[^>]*\/>Femme<\/label>/)
      expect(html).toMatch(/value="homme"[^>]*\/>Homme<\/label>/)
    },
  )

  it('starts with a submit button, or goes back', () => {
    const html = form()
    expect(html).toContain(
      '<button type="submit" class="button button--primary">Commencer</button>',
    )
    expect(html).toContain(
      '<button type="button" class="button">Retour</button>',
    )
  })

  it('warns only when the new game replaces a saved one', () => {
    const warning =
      '<p class="notice">La nouvelle partie remplacera celle sauvegardée dans ce navigateur.</p>'
    expect(form({ replacesSave: true })).toContain(warning)
    expect(form({ replacesSave: false })).not.toContain(warning)
  })
})

describe('StartScreen', () => {
  function withStorage(items: Record<string, string>) {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => items[key] ?? null,
        setItem: () => {},
      },
      location: { search: '' },
    })
  }

  it('opens on the menu, inside the page card', () => {
    withStorage({})
    const html = renderToStaticMarkup(<StartScreen onStart={() => {}} />)
    expect(html).toMatch(/^<main><section class="start-screen"/)
    expect(html).toContain('>Magnat</h1>')
    expect(buttons(html).map(({ text }) => text)).toEqual([
      'Nouvelle partie',
      'Défis',
    ])
  })

  it("offers to continue the browser's saved game", () => {
    withStorage({ [SAVE_KEY]: serialize(SAVED_GAME) })
    const html = renderToStaticMarkup(<StartScreen onStart={() => {}} />)
    expect(buttons(html)[0]).toEqual({ text: 'Continuer', primary: true })
    expect(html).toContain('Chez Mimi, mercredi 3 mai, an 1')
  })

  it('says when the browser blocks storage', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('window', {
      get localStorage() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
    const html = renderToStaticMarkup(<StartScreen onStart={() => {}} />)
    expect(html).toContain('Ce navigateur bloque la sauvegarde automatique.')
  })
})
