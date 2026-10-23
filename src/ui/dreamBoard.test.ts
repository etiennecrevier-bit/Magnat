import { describe, expect, it } from 'vitest'
import type { DifficultyId, Rung, RungId } from '../content/schema.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import { applyDecision } from '../engine/decisions.ts'
import { add, cents, sub } from '../engine/money.ts'
import { entriesOf, postEntry } from '../finance/journal.ts'
import { netWorth } from '../engine/netWorth.ts'
import { defaultProfile } from '../engine/profile.ts'
import type { GameState } from '../engine/types.ts'
import {
  booksFacts,
  bonusChip,
  dreamBoard,
  factLine,
  priceLine,
  rungFacts,
  rungTip,
} from './dreamBoard.ts'
import { DREAM } from '../engine/dream.ts'
import { formatBriefMoney } from './formatMoney.ts'

// Every space in an amount is a no-break space (U+00A0), as before a colon
// or a percent sign.
const S = '\u00a0'

function started(difficulty: DifficultyId = 'facile'): GameState {
  return createInitialState(42, undefined, { ...defaultProfile(), difficulty })
}

/** `state` with the owner's own cash at `cash`. */
function withCash(state: GameState, cash: number): GameState {
  return { ...state, personal: { ...state.personal, cash: cents(cash) } }
}

function buying(state: GameState, ...ids: RungId[]): GameState {
  return ids.reduce(
    (game, rung) => applyDecision(game, { kind: 'buy', rung }),
    state,
  )
}

const rung = (id: RungId) => {
  const found = [...DREAM.personal, ...DREAM.company].find(
    (each) => each.id === id,
  )
  if (found === undefined) throw new Error(`no rung ${id}`)
  return found
}

describe('dreamBoard', () => {
  it('shows each ladder in order, the first rung next, the second truck coming soon', () => {
    const board = dreamBoard(started())
    expect(board.personal).toMatchObject({
      ladder: 'personal',
      payer: "Payé par vous · ne touche pas l'entreprise",
      cash: 400_000,
      next: { id: 'velo', buyable: true },
      needed: 150_000,
      progress: 1,
    })
    expect(
      board.personal.rungs.map(({ id, status, price }) => [id, status, price]),
    ).toEqual([
      ['velo', 'next', 150_000],
      ['voitureOccasion', 'locked', 800_000],
      ['condo', 'locked', 4_000_000],
      ['voitureLuxe', 'locked', 4_500_000],
      ['maison', 'locked', 15_000_000],
      ['chalet', 'locked', 9_000_000],
    ])
    expect(board.company).toMatchObject({
      payer: "Payé par l'entreprise",
      cash: 1_500_000,
      next: { id: 'espresso', buyable: true },
    })
    expect(board.company.rungs.map(({ status }) => status)).toEqual([
      'next',
      'locked',
      'comingSoon',
    ])
    expect(
      board.company.rungs.every(
        ({ buyable, status }) => buyable === (status === 'next'),
      ),
    ).toBe(true)
  })

  it('tells how close the next rung is, and keeps it from being bought short', () => {
    const difficile = dreamBoard(started('difficile'))
    expect(difficile.company).toMatchObject({
      cash: 500_000,
      needed: 600_000,
      next: { id: 'espresso', buyable: false },
    })
    expect(difficile.company.progress).toBeCloseTo(5 / 6)
    expect(dreamBoard(withCash(started(), -1)).personal.progress).toBe(0)
  })

  it('counts the condo sold back toward the house', () => {
    const rich = withCash(started(), 100_000_000)
    const ready = buying(
      rich,
      'velo',
      'voitureOccasion',
      'condo',
      'voitureLuxe',
    )
    const before = dreamBoard(withCash(ready, 11_000_000)).personal
    expect(before).toMatchObject({
      next: { id: 'maison', buyable: true },
      needed: 11_000_000,
      progress: 1,
    })
    const house = buying(withCash(ready, 11_000_000), 'maison')
    expect(
      dreamBoard(house).personal.rungs.map(({ status }) => status),
    ).toEqual(['owned', 'owned', 'sold', 'owned', 'owned', 'next'])
  })

  it('has nothing next once a ladder is climbed but its rung coming soon', () => {
    const rich = {
      ...withCash(started(), 100_000_000),
    }
    const all = buying(
      rich,
      'velo',
      'voitureOccasion',
      'condo',
      'voitureLuxe',
      'maison',
      'chalet',
    )
    expect(dreamBoard(all).personal).toMatchObject({
      next: null,
      needed: null,
      progress: null,
    })
  })

  it('shows the title and the next one', () => {
    const game = started()
    const board = dreamBoard(game)
    expect(board.netWorth).toBe(netWorth(game))
    expect(board.titles).toEqual({
      title: 'Commerçant',
      next: {
        name: 'Entrepreneur',
        netWorth: 25_000_000,
        progress: netWorth(game) / 25_000_000,
      },
    })
    const broke = dreamBoard(withCash(started('difficile'), -10_000_000))
    expect(broke.titles).toMatchObject({
      title: null,
      next: { name: 'Débrouillard', progress: 0 },
    })
  })
})

describe('the cards', () => {
  it('says which rung a locked one comes after, and nothing for the others', () => {
    const board = dreamBoard(buying(started(), 'velo'))
    expect(board.personal.rungs.map(({ after }) => after)).toEqual([
      null,
      null,
      "Voiture d'occasion",
      'Condo sur le Plateau',
      'Voiture de luxe',
      'Maison à Outremont',
    ])
    expect(board.company.rungs.map(({ after }) => after)).toEqual([
      null,
      'Machine à espresso pro',
      null,
    ])
  })

  it.each<[RungId, string | null]>([
    ['velo', `−30${S}% de trajet`],
    ['voitureOccasion', `−50${S}% de trajet`],
    ['condo', 'Loyer remplacé'],
    ['voitureLuxe', `−60${S}% de trajet`],
    ['maison', 'Hypothèque remplacée'],
    ['chalet', "+15 d'énergie par congé"],
    ['espresso', `−20${S}% de service`],
    ['grandCamion', `+50${S}% de stock`],
    ['deuxiemeCamion', null],
  ])('sums up what %s gives in a chip', (id, chip) => {
    expect(bonusChip(rung(id))).toBe(chip)
    expect(
      [
        ...dreamBoard(started()).personal.rungs,
        ...dreamBoard(started()).company.rungs,
      ].find((row) => row.id === id)?.chip,
    ).toBe(chip)
  })

  it('words the other bonuses in a chip too', () => {
    const only = (bonuses: Rung['bonuses']) => ({ ...rung('velo'), bonuses })
    expect(bonusChip(only([{ kind: 'line', factor: 1.5 }]))).toBe(
      `+50${S}% de file`,
    )
    expect(
      bonusChip(only([{ kind: 'walkIns', segment: 'chic', factor: 1.05 }])),
    ).toBe(`+5${S}% de clientèle chic`)
  })
})

describe('rungTip', () => {
  it('tells the name, the price and who pays, and the facts', () => {
    const board = dreamBoard(started())
    expect(rungTip(board.personal, board.personal.rungs[0]!)).toEqual({
      title: 'Vélo électrique',
      text: `1${S}500,00${S}$, payé par vous · ne touche pas l'entreprise`,
      rows: [{ label: 'Déplacements en ville', value: `−30${S}% de temps` }],
    })
    const condo = board.personal.rungs[2]!
    expect(rungTip(board.personal, condo).rows).toEqual([
      { label: 'Hypothèque du condo', value: `1${S}100,00${S}$ par mois` },
      { label: 'Remplace', value: `Loyer (1${S}300,00${S}$ par mois)` },
    ])
  })

  it('tells in amber what the next rung still misses', () => {
    const board = dreamBoard(started('difficile'))
    const espresso = board.company.rungs[0]!
    expect(rungTip(board.company, espresso).rows?.at(-1)).toEqual({
      label: 'Il vous manque',
      value: `1${S}000,00${S}$`,
      warn: true,
    })
    const easy = dreamBoard(started())
    expect(
      rungTip(easy.company, easy.company.rungs[0]!).rows?.some(
        ({ warn }) => warn === true,
      ),
    ).toBe(false)
  })

  it('tells nothing missing on a rung after the next one', () => {
    const board = dreamBoard(withCash(started(), 0))
    const later = board.personal.rungs[1]!
    expect(later.status).toBe('locked')
    expect(rungTip(board.personal, later).rows).toEqual([
      { label: 'Déplacements en ville', value: `−50${S}% de temps` },
    ])
    expect(
      rungTip(board.personal, board.personal.rungs[0]!).rows?.at(-1),
    ).toEqual({
      label: 'Il vous manque',
      value: `1${S}500,00${S}$`,
      warn: true,
    })
  })
})

describe('rungFacts', () => {
  const game = started()

  it.each<[RungId, string[]]>([
    ['velo', [`Déplacements en ville${S}: −30${S}% de temps`]],
    ['voitureOccasion', [`Déplacements en ville${S}: −50${S}% de temps`]],
    [
      'condo',
      [
        `Hypothèque du condo${S}: 1${S}100,00${S}$ par mois`,
        `Remplace${S}: Loyer (1${S}300,00${S}$ par mois)`,
      ],
    ],
    [
      'voitureLuxe',
      [
        `Déplacements en ville${S}: −60${S}% de temps`,
        `Clientèle chic${S}: +5${S}% de passants`,
      ],
    ],
    [
      'maison',
      [
        `Hypothèque de la maison${S}: 2${S}200,00${S}$ par mois`,
        `Remplace${S}: Hypothèque du condo (1${S}100,00${S}$ par mois)`,
        `Revend${S}: Condo sur le Plateau (40${S}000,00${S}$)`,
      ],
    ],
    ['chalet', [`Jour de congé${S}: +15 d'énergie`]],
    ['espresso', [`Service au comptoir${S}: −20${S}% de temps`]],
    [
      'grandCamion',
      [
        `Stock par produit${S}: +50${S}%`,
        `File d'attente${S}: +50${S}% de clients`,
        `Clientèle chic${S}: +10${S}% de passants`,
        `L'ancien camion repris à sa valeur comptable${S}: 85${S}000,00${S}$`,
      ],
    ],
  ])('tells what %s gives, in plain facts', (id, lines) => {
    expect(rungFacts(game, rung(id)).map(factLine)).toEqual(lines)
  })

  it('tells the lease the bigger truck ends at difficile', () => {
    expect(rungFacts(started('difficile'), rung('grandCamion')).at(-1)).toEqual(
      {
        label: 'Fin de la location du camion',
        value: `1${S}800,00${S}$ par mois`,
      },
    )
  })

  it('reads the price and who pays for the confirmation', () => {
    const board = dreamBoard(game)
    const velo = board.personal.rungs[0]!
    expect(priceLine(board.personal, velo)).toBe(
      `1${S}500,00${S}$, payé par vous · ne touche pas l'entreprise`,
    )
    const espresso = board.company.rungs[0]!
    expect(priceLine(board.company, espresso)).toBe(
      `6${S}000,00${S}$, payé par l'entreprise`,
    )
  })
})

/** The 1500 and 1000 lines of the entries `buying` posted on `before`. */
function postedLines(before: GameState, after: GameState) {
  const posted = entriesOf(after.journal).slice(
    entriesOf(before.journal).length,
  )
  let added = cents(0)
  let retired = cents(0)
  let paid = cents(0)
  for (const { memo, lines } of posted) {
    for (const { account, debit, credit } of lines) {
      if (account === '1500' && memo.startsWith('Achat')) {
        added = add(added, debit)
      }
      if (account === '1500') retired = add(retired, credit)
      if (account === '1000') paid = add(paid, sub(credit, debit))
    }
  }
  return { added, retired, paid }
}

describe('booksFacts', () => {
  it('reads the equipment and its depreciation off the entries the engine posts', () => {
    const game = started()
    const after = buying(game, 'espresso')
    const { added, retired, paid } = postedLines(game, after)
    const facts = booksFacts(game, rung('espresso'))
    expect(facts.map(factLine)).toEqual([
      `Équipement au bilan${S}: +6${S}000${S}$`,
      `Amortissement${S}: 100${S}$ par mois pendant 60 mois`,
    ])
    expect(facts[0]!.value).toBe(`+${formatBriefMoney(added)}`)
    expect(added).toBe(paid)
    expect(retired).toBe(0)
  })

  it.each<DifficultyId>(['facile', 'moyen', 'difficile'])(
    'adds the old truck retired at %s, as the bigger truck’s entries do',
    (difficulty) => {
      const game = started(difficulty)
      // Encaisse holds plenty: more capital paid in on day 0.
      const funded: GameState = {
        ...game,
        journal: postEntry(game.journal, {
          day: 0,
          memo: 'Mise de fonds',
          lines: [
            { account: '1000', debit: cents(10_000_000), credit: cents(0) },
            { account: '3000', debit: cents(0), credit: cents(10_000_000) },
          ],
        }),
      }
      let ready = buying(funded, 'espresso')
      // Some depreciation on the old truck first.
      while (ready.day < 40) ready = tick(ready)
      const after = buying(ready, 'grandCamion')
      const { added, retired, paid } = postedLines(ready, after)
      const facts = booksFacts(ready, rung('grandCamion'))
      const value = (label: string) =>
        facts.find((fact) => fact.label === label)?.value
      expect(value('Équipement au bilan')).toBe(`+${formatBriefMoney(added)}`)
      expect(value('Ancien camion retiré')).toBe(
        retired === 0 ? undefined : `−${formatBriefMoney(retired)}`,
      )
      expect(retired > 0).toBe(difficulty !== 'difficile')
      expect(value('Amortissement')).toBe(
        `${formatBriefMoney(cents(Math.floor(added / 120)))} par mois pendant 120 mois`,
      )
      // What the company pays is the rung's price, whatever the truck.
      expect(paid).toBe(rung('grandCamion').priceCents)
    },
  )

  it('has nothing for a personal rung', () => {
    expect(booksFacts(started(), rung('velo'))).toEqual([])
    const board = dreamBoard(started())
    expect(board.personal.rungs[0]!.books).toEqual([])
    expect(board.company.rungs[0]!.books).toEqual(
      booksFacts(started(), rung('espresso')),
    )
  })
})

describe('a company rung owned', () => {
  it('tells its book value and its depreciation so far, as the books carry them', () => {
    let game = buying(started(), 'espresso')
    // Three 1sts after the purchase: day 31, 61 and 92.
    while (game.day < 95) game = tick(game)
    const board = dreamBoard(game)
    const espresso = board.company.rungs[0]!
    expect(espresso.status).toBe('owned')
    let depreciated = cents(0)
    for (const { memo, lines } of entriesOf(game.journal)) {
      if (memo !== 'Amortissement · Machine à espresso pro') continue
      for (const line of lines) {
        if (line.account === '1510') depreciated = add(depreciated, line.credit)
      }
    }
    expect(depreciated).toBe(30_000)
    expect(espresso.onBooks).toEqual({
      bookValue: 570_000,
      depreciated: 30_000,
    })
    expect(rungTip(board.company, espresso).rows?.slice(-2)).toEqual([
      { label: 'Valeur aux livres', value: `5${S}700,00${S}$`, divider: true },
      { label: 'Amortissement à ce jour', value: `300,00${S}$` },
    ])
  })

  it('has no book value on a personal rung', () => {
    const board = dreamBoard(buying(started(), 'velo'))
    expect(board.personal.rungs[0]!.onBooks).toBeNull()
  })
})
