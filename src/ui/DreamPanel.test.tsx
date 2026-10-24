import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Ladder, RungId } from '../content/schema.ts'
import { createInitialState } from '../engine/clock.ts'
import { applyDecision } from '../engine/decisions.ts'
import { cents } from '../engine/money.ts'
import type { GameState } from '../engine/types.ts'
import { dreamBoard } from './dreamBoard.ts'
import DreamPanel, { DreamPanelView } from './DreamPanel.tsx'
import { gameStore, type GameStoreState } from './store.ts'
import { upgradeArtUrl } from './upgradeArt.ts'

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

// The default profile plays Moyen: 2 500 $ of the owner's own, 10 000 $ in
// Encaisse and a net worth of 27 500 $.
const START = createInitialState(42)

/** `game` with the owner's own cash at `cash` cents. */
function withCash(game: GameState, cash: number): GameState {
  return { ...game, personal: { ...game.personal, cash: cents(cash) } }
}

function buying(game: GameState, ...ids: RungId[]): GameState {
  return ids.reduce(
    (state, rung) => applyDecision(state, { kind: 'buy', rung }),
    game,
  )
}

function render(
  game: GameState,
  ladder: Ladder = 'personal',
  confirming: RungId | null = null,
) {
  return renderToStaticMarkup(
    <DreamPanelView
      board={dreamBoard(game)}
      ladder={ladder}
      confirming={confirming}
      onConfirmingChange={() => {}}
      onChange={() => {}}
    />,
  )
}

/** The markup with each picture's URL left out, and the tooltips' ids. */
function bare(html: string): string {
  return html.replace(/ src="[^"]*"/g, '').replace(/_R_\w+_/g, 'tip')
}

/** The cards in `html`, one string each. */
function cards(html: string): string[] {
  return html.split('<li class="dream__card').slice(1)
}

/** The card of the rung `name` in `html`. */
function card(html: string, name: string): string {
  const found = cards(html).find((each) => each.includes(`<h3>${name}</h3>`))
  if (found === undefined) throw new Error(`no card ${name}`)
  return found
}

/** `url` as React writes it in an attribute. */
function attribute(url: string): string {
  return url
    .replaceAll('&', '&amp;')
    .replaceAll("'", '&#x27;')
    .replaceAll('"', '&quot;')
}

describe('DreamPanelView', () => {
  it('opens on a ribbon with the owner’s title, the next one and a bar toward it', () => {
    expect(bare(render(START))).toMatch(
      new RegExp(
        `^<div class="dream__board"><section class="dream__ribbon" aria-label="Titre"><svg class="icon" width="22" height="22" .*?</svg><p class="dream__title">Débrouillard · Prochain titre${S}: Commerçant</p><span class="dream__ribbon-bar" role="meter" aria-label="Vers Commerçant" aria-valuemin="0" aria-valuemax="100" aria-valuenow="28" aria-valuetext="27${S}500${S}\\$ / 100${S}000${S}\\$"><span class="dream__fill" style="width:27.5\\d*%"></span></span><p class="dream__worth">27${S}500${S}\\$ / 100${S}000${S}\\$</p></section><ol class="dream__cards">`,
      ),
    )
  })

  it('names the first title as the next one before any, and the last title alone', () => {
    expect(render(withCash(START, -10_000_000))).toContain(
      `<p class="dream__title">Prochain titre${S}: Débrouillard</p>`,
    )
    const magnat = render(withCash(START, 1_000_000_000_00))
    expect(magnat).toContain('<p class="dream__title">Magnat</p></section>')
    expect(magnat).not.toContain('dream__ribbon-bar')
  })

  it('shows the six rungs of « Vie personnelle », each with its picture, name, price and chip', () => {
    const html = render(START)
    expect(cards(html)).toHaveLength(6)
    const shown = cards(html).map((each) => [
      each.match(/<h3>(.*?)<\/h3>/)?.[1],
      each.match(/<p class="dream__price">(.*?)<\/p>/)?.[1],
      each.match(/<p class="dream__chip">(.*?)<\/p>/)?.[1],
    ])
    expect(shown).toEqual([
      ['Vélo électrique', `1${S}500${S}$`, `−30${S}% de trajet`],
      ['Voiture d&#x27;occasion', `8${S}000${S}$`, `−50${S}% de trajet`],
      ['Condo sur le Plateau', `40${S}000${S}$`, 'Loyer remplacé'],
      ['Voiture de luxe', `45${S}000${S}$`, `−60${S}% de trajet`],
      ['Maison à Outremont', `150${S}000${S}$`, 'Hypothèque remplacée'],
      [
        'Chalet dans les Laurentides',
        `90${S}000${S}$`,
        '+15 d&#x27;énergie par congé',
      ],
    ])
    const ids: RungId[] = [
      'velo',
      'voitureOccasion',
      'condo',
      'voitureLuxe',
      'maison',
      'chalet',
    ]
    cards(html).forEach((each, i) => {
      const url = upgradeArtUrl(ids[i]!)
      expect(url).not.toBeNull()
      expect(each).toContain(
        `<img src="${attribute(url!)}" alt="" width="300" height="150"/>`,
      )
    })
  })

  it('shows the three rungs of « Entreprise », the second truck with the district it opens', () => {
    const html = render(START, 'company')
    expect(cards(html)).toHaveLength(3)
    expect(
      cards(html).map((each) => each.match(/<h3>(.*?)<\/h3>/)?.[1]),
    ).toEqual([
      'Machine à espresso pro',
      'Camion plus grand',
      'Deuxième camion',
    ])
    expect(card(html, 'Machine à espresso pro')).toContain(
      `<img src="${attribute(upgradeArtUrl('espresso')!)}"`,
    )
    expect(card(html, 'Deuxième camion')).toContain(
      '<p class="dream__chip">Ouvre le Vieux-Montréal</p>',
    )
    expect(card(html, 'Deuxième camion')).toContain(
      '<dt>Ouvre</dt><dd>Vieux-Montréal</dd>',
    )
  })

  it('offers « Acheter » on the next rung, described by the card’s tooltip', () => {
    expect(bare(card(render(START), 'Vélo électrique'))).toBe(
      ` dream__card--next"><div class="dream__anchor" aria-describedby="tip"><div class="dream__art"><img alt="" width="300" height="150"/></div><div class="dream__text"><div class="dream__head"><h3>Vélo électrique</h3><p class="dream__price">1${S}500${S}$</p></div><p class="dream__chip">−30${S}% de trajet</p><div class="dream__foot"><button type="button" class="button dream__buy" aria-label="Acheter Vélo électrique" aria-describedby="tip">Acheter</button></div></div></div><div id="tip" role="tooltip" popover="manual" class="tip"><div class="tip__body" tabindex="-1"><p class="tip__title">Vélo électrique</p><p class="tip__text">1${S}500,00${S}$, payé par vous · ne touche pas l&#x27;entreprise</p><dl class="tip__rows"><div class="tip__row"><dt>Déplacements en ville</dt><dd>−30${S}% de temps</dd></div></dl></div><span class="tip__arrow" aria-hidden="true"></span></div></li>`,
    )
    const html = card(render(START), 'Vélo électrique')
    const tip = html.match(/<div id="([^"]+)" role="tooltip"/)?.[1]
    expect(tip).toBeDefined()
    expect(html).toContain(
      `aria-label="Acheter Vélo électrique" aria-describedby="${tip}"`,
    )
    expect(render(START).match(/>Acheter</g)).toHaveLength(1)
  })

  it('shows a bar toward the next rung, with no button, when the cash falls short', () => {
    const html = card(render(withCash(START, 0)), 'Vélo électrique')
    expect(html).not.toContain('Acheter')
    expect(html).toContain('<div class="dream__anchor" tabindex="0"')
    expect(html).toContain(
      `<div class="dream__foot"><div class="dream__progress"><span class="dream__bar" role="meter" aria-label="Vers Vélo électrique" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="1${S}500${S}$ requis · 0${S}$ disponibles"><span class="dream__fill" style="width:0%"></span></span><p class="dream__note">1${S}500${S}$ requis · 0${S}$ disponibles</p></div></div>`,
    )
    expect(html).toContain(
      `<div class="tip__row"><dt>Il vous manque</dt><dd class="tip__value--warn">1${S}500,00${S}$</dd></div>`,
    )
  })

  it('locks a rung after the next one, with a padlock and the rung it comes after', () => {
    const html = card(render(START), 'Condo sur le Plateau')
    expect(html).toMatch(
      /^ dream__card--locked"><div class="dream__anchor" tabindex="0"/,
    )
    expect(html).toContain(
      '<span class="dream__lock"><svg class="icon" width="18" height="18"',
    )
    expect(html).toContain(
      `<div class="dream__foot"><p class="dream__note">Après${S}: Voiture d&#x27;occasion</p></div>`,
    )
    expect(html).not.toContain('<button')
  })

  it('locks the second truck until the rung before it, with no « Bientôt »', () => {
    const html = card(render(START, 'company'), 'Deuxième camion')
    expect(html).toMatch(
      /^ dream__card--locked"><div class="dream__anchor" tabindex="0"/,
    )
    expect(html).toContain('<span class="dream__lock">')
    expect(html).toContain(
      `<div class="dream__foot"><p class="dream__note">Après${S}: Camion plus grand</p></div>`,
    )
    expect(html).not.toContain('Bientôt')
  })

  it('shows a rung bought as « Acquis » and one sold back as « Revendu », with no button', () => {
    const rich = withCash(START, 100_000_000)
    const house = buying(
      rich,
      'velo',
      'voitureOccasion',
      'condo',
      'voitureLuxe',
      'maison',
    )
    const html = render(house)
    expect(card(html, 'Vélo électrique')).toContain(
      '<div class="dream__foot"><p class="dream__status dream__status--owned"><span class="dream__dot" aria-hidden="true"></span>Acquis</p></div>',
    )
    expect(card(html, 'Condo sur le Plateau')).toContain(
      '<div class="dream__foot"><p class="dream__status dream__status--sold"><span class="dream__dot" aria-hidden="true"></span>Revendu</p></div>',
    )
    expect(card(html, 'Vélo électrique')).toContain(
      '<div class="dream__anchor" tabindex="0"',
    )
    expect(card(html, 'Chalet dans les Laurentides')).toContain('>Acheter<')
  })

  it('asks to confirm with the price, who pays and what the rung gives, both buttons described by the tooltip', () => {
    expect(
      bare(card(render(START, 'personal', 'velo'), 'Vélo électrique')),
    ).toContain(
      `<div class="dream__foot"><div class="dream__confirm"><p role="alert">Acheter Vélo électrique? 1${S}500,00${S}$, payé par vous · ne touche pas l&#x27;entreprise</p><ul class="dream__facts"><li>Déplacements en ville${S}: −30${S}% de temps</li></ul><button type="button" class="button dream__buy" aria-describedby="tip">Confirmer</button> <button type="button" class="button" aria-describedby="tip">Annuler</button></div></div>`,
    )
  })
  it('adds what the purchase does to the books in the confirmation of a company rung', () => {
    expect(
      bare(
        card(render(START, 'company', 'espresso'), 'Machine à espresso pro'),
      ),
    ).toContain(
      `<ul class="dream__facts"><li>Service au comptoir${S}: −20${S}% de temps</li><li>Équipement au bilan${S}: +6${S}000${S}$</li><li>Amortissement${S}: 100${S}$ par mois pendant 60 mois</li></ul>`,
    )
  })
})

describe('DreamPanel', () => {
  it('shows the app store’s game in a modal dialog in the dock’s frame, titled « Améliorations », on « Vie personnelle »', () => {
    const html = renderToStaticMarkup(<DreamPanel />)
    expect(html).toMatch(
      /^<dialog class="panel dock-frame dock-panel dream" aria-labelledby="([^"]+)"><div class="dock-frame__header"><h2 id="\1" class="dock-frame__title">Améliorations<\/h2>.*<div class="dream__board">.*<\/dialog>$/,
    )
    expect(html).toMatch(
      /<div class="dock-frame__tabs" role="tablist" aria-label="Améliorations"><button [^>]*role="tab" class="tab on" aria-selected="true"[^>]*>Vie personnelle<\/button><button [^>]*role="tab" class="tab" aria-selected="false"[^>]*>Entreprise<\/button><\/div>/,
    )
    expect(html).not.toContain('Fermer</button>')
    expect(cards(html)).toHaveLength(6)
  })

  it('shows the tab the store keeps, and a purchase made through it at once', () => {
    gameStore.getState().setDreamTab('company')
    gameStore.getState().decide({ kind: 'buy', rung: 'espresso' })
    const html = renderToStaticMarkup(<DreamPanel />)
    expect(cards(html)).toHaveLength(3)
    expect(card(html, 'Machine à espresso pro')).toContain('Acquis</p>')
  })
})
