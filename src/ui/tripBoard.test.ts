import { describe, expect, it } from 'vitest'
import type { PlaceId, RungId } from '../content/schema.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import { EVENTS, FOOD_TRUCK } from '../engine/day.ts'
import {
  applyDecision,
  latestDecisions,
  type DecisionChange,
} from '../engine/decisions.ts'
import { rungOf } from '../engine/dream.ts'
import { applyEffect } from '../engine/effects.ts'
import { resolveEvent } from '../engine/events.ts'
import { FINANCING } from '../engine/financing.ts'
import { cents } from '../engine/money.ts'
import { goTo } from '../engine/places.ts'
import type { GameState } from '../engine/types.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance } from '../finance/journal.ts'
import {
  clockTime,
  enRouteLine,
  tripBoard,
  type PlaceRow,
} from './tripBoard.ts'

// Every space before a colon, a percent sign or a unit is a no-break space
// (U+00A0).
const S = ' '
const CASH: AccountCode = '1000'

/** Day 1, a Tuesday the truck opens, before it is played. */
const TUESDAY = tick(createInitialState(42))

/** `state` with `changes` in effect that very morning. */
function deciding(
  state: GameState,
  ...changes: readonly DecisionChange[]
): GameState {
  const decided = changes.reduce(
    (next, change) => applyDecision(next, change),
    state,
  )
  return {
    ...decided,
    decisions: latestDecisions(decided),
    pendingDecisions: null,
  }
}

/** `state` with Encaisse brought to `target` by a charge that morning. */
function withCash(state: GameState, target: number): GameState {
  const cash = balance(state.journal, CASH, { toDay: state.day })
  return applyEffect(
    state,
    {
      kind: 'charge',
      amountCents: cents(cash - target),
      description: 'Dépense',
    },
    FOOD_TRUCK,
    'essai',
  )
}

function row(game: GameState, id: PlaceId): PlaceRow {
  const found = tripBoard(game).rows.find((place) => place.id === id)
  if (found === undefined) throw new Error(`No place ${id}`)
  return found
}

describe('tripBoard', () => {
  it('lists each place in order, with what the owner does there, what it gives and how long it takes', () => {
    expect(tripBoard(TUESDAY)).toEqual({
      trip: null,
      rows: [
        {
          id: 'caisse',
          name: 'La Caisse populaire',
          does: 'Rendez-vous avec Mme Prudhomme pour un prêt',
          gives: 'Son offre de prêt arrive demain matin',
          time: `Trajet${S}: 25${S}min · visite${S}: 30${S}min`,
          schedule: `Départ 10${S}h · retour 11${S}h${S}20`,
          closesTruck: true,
          chosen: false,
          refusal: 'Votre encaisse suffit, sans prêt',
        },
        {
          id: 'meunerie',
          name: 'La meunerie',
          does: 'Négocier le prix des marchandises',
          gives: `−5${S}% sur le prochain achat de marchandises`,
          time: `Trajet${S}: 40${S}min · visite${S}: 30${S}min`,
          schedule: `Départ 10${S}h · retour 11${S}h${S}50`,
          closesTruck: true,
          chosen: false,
          refusal: null,
        },
        {
          id: 'bureauPermis',
          name: 'Le Bureau des permis et des formulaires',
          does: 'Déposer les formulaires',
          gives: null,
          time: 'Toute la journée',
          schedule: null,
          closesTruck: true,
          chosen: false,
          refusal: null,
        },
        {
          id: 'fournil',
          name: 'Le fournil',
          does: 'Voir le fournil',
          gives: null,
          time: `Trajet${S}: 15${S}min · visite${S}: 15${S}min`,
          schedule: `Départ 10${S}h · retour 10${S}h${S}45`,
          closesTruck: true,
          chosen: false,
          refusal: null,
        },
      ],
    })
  })

  it.each<[RungId[], string, string]>([
    [['velo'], '18', `11${S}h${S}06`],
    [['velo', 'voitureOccasion'], '13', `10${S}h${S}56`],
  ])('shortens the walks with the best vehicle of %j', (rungs, leg, back) => {
    const game: GameState = {
      ...TUESDAY,
      dream: {
        bought: rungs.map((rung) => ({
          rung,
          day: 0,
          cost: rungOf(rung).rung.priceCents,
        })),
        magnatOn: null,
      },
    }
    expect(row(game, 'caisse')).toMatchObject({
      time: `Trajet${S}: ${leg}${S}min · visite${S}: 30${S}min`,
      schedule: `Départ 10${S}h · retour ${back}`,
    })
    expect(row(game, 'bureauPermis').time).toBe('Toute la journée')
  })

  it('keeps the truck open meanwhile with an employee at it, and says nothing on a day it is closed', () => {
    const staffed = tick(
      deciding(createInitialState(42), {
        kind: 'hire',
        role: 'camion',
        candidate: 'amelie',
      }),
    )
    expect(
      tripBoard(staffed).rows.map(({ closesTruck }) => closesTruck),
    ).toEqual([false, false, false, false])
    // A deliverer serves nobody.
    const deliverer = tick(
      deciding(createInitialState(42), {
        kind: 'hire',
        role: 'livreur',
        candidate: 'kevin',
      }),
    )
    expect(row(deliverer, 'fournil').closesTruck).toBe(true)
    let monday = TUESDAY
    while (monday.day < 7) monday = tick(monday)
    expect(row(monday, 'fournil').closesTruck).toBe(false)
  })

  it("marks the day's trip", () => {
    const board = tripBoard(goTo(TUESDAY, 'meunerie'))
    expect(board.trip).toBe('meunerie')
    expect(board.rows.map(({ chosen }) => chosen)).toEqual([
      false,
      true,
      false,
      false,
    ])
  })

  it('says why the owner cannot see Mme Prudhomme', () => {
    const short = withCash(TUESDAY, 50_000)
    expect(row(short, 'caisse').refusal).toBeNull()
    expect(
      row(
        {
          ...short,
          financing: { ...short.financing, lastLoanRequestDay: 1 },
        },
        'caisse',
      ).refusal,
    ).toBe('Mme Prudhomme vous a déjà reçu cette année')
    const lent = resolveEvent(
      {
        ...short,
        events: {
          ...short.events,
          pending: { event: FINANCING.loanEvent, followUp: false },
        },
      },
      'accepter',
      EVENTS,
    )
    expect(
      row(
        {
          ...withCash(lent, 50_000),
          financing: { ...lent.financing, lastLoanRequestDay: null },
        },
        'caisse',
      ).refusal,
    ).toBe("Un prêt d'urgence est déjà en cours")
  })
})

describe('clockTime', () => {
  it.each([
    [600, `10${S}h`],
    [605, `10${S}h${S}05`],
    [680, `11${S}h${S}20`],
    [900, `15${S}h`],
  ])('reads minute %d as « %s »', (minute, text) => {
    expect(clockTime(minute)).toBe(text)
  })
})

describe('enRouteLine', () => {
  it('names the place of the day, with its article, and nothing without a trip', () => {
    expect(enRouteLine(TUESDAY)).toBeNull()
    expect(enRouteLine(goTo(TUESDAY, 'meunerie'))).toBe(
      'En route vers la meunerie',
    )
    expect(enRouteLine(goTo(TUESDAY, 'bureauPermis'))).toBe(
      'En route vers le Bureau des permis',
    )
    expect(enRouteLine({ town: { trip: 'caisse', discount: 0 } })).toBe(
      'En route vers la Caisse',
    )
  })
})
