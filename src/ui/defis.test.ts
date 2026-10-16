import { describe, expect, it, vi } from 'vitest'
import type { Defi, DefiGoal } from '../content/schema.ts'
import { defiById } from '../engine/challenge.ts'
import { createInitialState, startChallenge } from '../engine/clock.ts'
import { DEFIS } from '../engine/day.ts'
import { cents } from '../engine/money.ts'
import type {
  ChallengeProgress,
  ChallengeState,
  GameState,
} from '../engine/types.ts'
import {
  chipLabel,
  conditionLine,
  defiWeek,
  endFigures,
  energyFloorLine,
  energyFloorText,
  failureLine,
  formatMetric,
  goalLine,
  isChallengeOver,
  keepBestMedals,
  lengthText,
  lockedLines,
  lockReason,
  progressLines,
  progressValue,
  thresholdLines,
} from './defis.ts'
import { formatBriefMoney } from './formatMoney.ts'
import { createGameStore } from './store.ts'

// French puts a no-break space (U+00A0) in amounts, before a colon and a
// percent sign, and inside its quotation marks.
const S = ' '

const travaux = defiById(DEFIS, 'travauxSaintDenis')
const milleDollars = defiById(DEFIS, 'semaineDesMilleDollars')
const zeroGaspillage = defiById(DEFIS, 'zeroGaspillage')
const payeDans60Jours = defiById(DEFIS, 'payeDans60Jours')
const moisSansConge = defiById(DEFIS, 'moisSansConge')

/**
 * A Défi made up for the tests, which no tuning moves: the one place here
 * that writes its amounts and shares by hand, to pin how they read. The
 * other tests read the shipped Défis' values from the content.
 */
const FIXED: Defi = {
  ...milleDollars,
  id: 'fixe',
  goal: {
    metric: 'netIncome',
    medals: {
      or: cents(100_000),
      argent: cents(70_000),
      bronze: cents(40_000),
    },
  },
  conditions: [
    { kind: 'minCash', amountCents: cents(0) },
    { kind: 'minEnergy', amount: 25 },
    { kind: 'maxSpoilageRate', rate: 0.03 },
  ],
}

/** `amount` cents as a threshold to reach. */
function atLeast(amount: number): string {
  return `${formatBriefMoney(cents(amount))} ou plus`
}

const PROGRESS: ChallengeProgress = {
  daysPlayed: 12,
  sales: cents(412_350),
  netIncome: cents(-3_200),
  lowestCash: cents(187_000),
  customersServed: 1_150,
  unitsSold: 2_900,
  unitsSpoiled: 100,
  lowestEnergy: 41.6,
}

function progress(changes: Partial<ChallengeProgress>): ChallengeProgress {
  return { ...PROGRESS, ...changes }
}

/** The game of `defi` with the Défi `status` and `medal`. */
function over(
  defi: Defi,
  status: ChallengeState['status'],
  medal: ChallengeState['medal'],
): GameState {
  const game = startChallenge(defi.id, 7)
  return { ...game, challenge: { ...game.challenge!, status, medal } }
}

describe('lengthText', () => {
  it.each([
    [7, '1 semaine'],
    [21, '3 semaines'],
    [28, '4 semaines'],
    [64, '64 jours'],
    [10, '10 jours'],
  ])('reads %d days as %s', (days, text) => {
    expect(lengthText(days)).toBe(text)
  })
})

describe('defiWeek and chipLabel', () => {
  const challenge = { startDay: 14 }

  it('counts the weeks from the first day of the Défi', () => {
    expect(defiWeek(challenge, travaux, 14)).toEqual({ week: 1, weeks: 3 })
    expect(defiWeek(challenge, travaux, 20)).toEqual({ week: 1, weeks: 3 })
    expect(defiWeek(challenge, travaux, 21)).toEqual({ week: 2, weeks: 3 })
    expect(chipLabel(challenge, travaux, 14)).toBe('Défi · semaine 1 de 3')
    expect(chipLabel(challenge, travaux, 25)).toBe('Défi · semaine 2 de 3')
  })

  it('stays in the last week on the last day and the morning after', () => {
    expect(chipLabel(challenge, travaux, 34)).toBe('Défi · semaine 3 de 3')
    expect(chipLabel(challenge, travaux, 35)).toBe('Défi · semaine 3 de 3')
  })

  it('counts a short last week as a week', () => {
    expect(chipLabel({ startDay: 7 }, payeDans60Jours, 7 + 63)).toBe(
      'Défi · semaine 10 de 10',
    )
  })
})

describe('energyFloorText and energyFloorLine', () => {
  it('read the energy against the floor, both rounded down', () => {
    expect(energyFloorText(52.7, FIXED)).toBe(`52 (plancher${S}: 25)`)
    expect(
      energyFloorText(24.6, {
        conditions: [{ kind: 'minEnergy', amount: 33.5 }],
      }),
    ).toBe(`24 (plancher${S}: 33)`)
    expect(energyFloorLine(52.7, FIXED)).toBe(
      `Énergie${S}: 52 (plancher${S}: 25)`,
    )
  })

  it('are null in a Défi with no floor', () => {
    expect(energyFloorText(52.7, travaux)).toBeNull()
    expect(energyFloorLine(52.7, travaux)).toBeNull()
  })
})

describe('formatMetric', () => {
  it.each([
    ['lowestCash', 187_000, `1${S}870${S}$`],
    ['lowestCash', -2_550, `-25,50${S}$`],
    ['netIncome', 100_000, `1${S}000${S}$`],
    ['sales', 380_000, `3${S}800${S}$`],
    ['customersServed', 1_150, `1${S}150`],
    ['customersServed', 750, '750'],
    ['lowestEnergy', 25, '25'],
    ['lowestEnergy', 24.6, '24'],
    ['spoilageRate', 0.03, `3${S}%`],
    ['spoilageRate', 0.15, `15${S}%`],
    ['spoilageRate', 0.031, `3,1${S}%`],
    ['spoilageRate', 0, `0${S}%`],
  ] as const)('formats %s %d as %s', (metric, value, text) => {
    expect(formatMetric(metric, value)).toBe(text)
  })
})

describe('progressValue', () => {
  it('rounds the share thrown out up to a tenth, so it never reads under a limit it passes', () => {
    const exactly = progress({ unitsSold: 97, unitsSpoiled: 3 })
    expect(progressValue(exactly, 'spoilageRate')).toBe(`3${S}%`)
    // 3.04 %
    const over = progress({ unitsSold: 2_421, unitsSpoiled: 76 })
    expect(progressValue(over, 'spoilageRate')).toBe(`3,1${S}%`)
    const none = progress({ unitsSold: 0, unitsSpoiled: 0 })
    expect(progressValue(none, 'spoilageRate')).toBe(`0${S}%`)
  })

  it('rounds the energy down, so it never reads as a minimum it is under', () => {
    expect(
      progressValue(progress({ lowestEnergy: 24.6 }), 'lowestEnergy'),
    ).toBe('24')
  })
})

describe('the goal', () => {
  it('says what each Défi asks for', () => {
    expect(goalLine(milleDollars.goal)).toBe(
      'Faites le plus gros bénéfice net possible.',
    )
    expect(goalLine(zeroGaspillage.goal)).toBe(
      'Servez le plus de clients possible.',
    )
  })

  it('lists the thresholds, the best first', () => {
    expect(thresholdLines(FIXED.goal)).toEqual([
      `Or${S}: 1${S}000${S}$ ou plus`,
      `Argent${S}: 700${S}$ ou plus`,
      `Bronze${S}: 400${S}$ ou plus`,
    ])
  })

  it("lists a shipped Défi's thresholds from the content", () => {
    const { medals } = milleDollars.goal
    expect(thresholdLines(milleDollars.goal)).toEqual([
      `Or${S}: ${atLeast(medals.or)}`,
      `Argent${S}: ${atLeast(medals.argent)}`,
      `Bronze${S}: ${atLeast(medals.bronze)}`,
    ])
  })

  it('reads a bénéfice net of 0 or below as a loss to limit', () => {
    const goal: DefiGoal = {
      metric: 'netIncome',
      medals: {
        or: cents(0),
        argent: cents(-145_000),
        bronze: cents(-300_050),
      },
    }
    expect(thresholdLines(goal)).toEqual([
      `Or${S}: aucune perte`,
      `Argent${S}: perte limitée à 1${S}450${S}$`,
      `Bronze${S}: perte limitée à 3${S}000,50${S}$`,
    ])
  })

  it('asks for « ou moins » where less is better', () => {
    const goal: DefiGoal = {
      metric: 'spoilageRate',
      medals: { or: 0.01, argent: 0.02, bronze: 0.05 },
    }
    expect(thresholdLines(goal)).toEqual([
      `Or${S}: 1${S}% ou moins`,
      `Argent${S}: 2${S}% ou moins`,
      `Bronze${S}: 5${S}% ou moins`,
    ])
  })

  it('leaves the encaisse at 0 as it was: a threshold to reach', () => {
    const goal: DefiGoal = {
      metric: 'lowestCash',
      medals: { or: cents(250_000), argent: cents(100_000), bronze: cents(0) },
    }
    expect(thresholdLines(goal)).toEqual([
      `Or${S}: 2${S}500${S}$ ou plus`,
      `Argent${S}: 1${S}000${S}$ ou plus`,
      `Bronze${S}: 0${S}$ ou plus`,
    ])
  })
})

describe('conditionLine', () => {
  it('states each kind of condition', () => {
    expect(FIXED.conditions.map(conditionLine)).toEqual([
      `L'encaisse ne doit jamais passer sous 0${S}$.`,
      'Votre énergie ne doit jamais tomber sous 25.',
      `Pas plus de 3${S}% de la marchandise ne doit finir aux poubelles.`,
    ])
  })
})

describe('failureLine', () => {
  it('names the condition broken', () => {
    expect(failureLine(progress({ lowestCash: cents(-1) }), FIXED)).toBe(
      `L'encaisse est passée sous 0${S}$.`,
    )
    expect(failureLine(progress({ lowestEnergy: 24.6 }), FIXED)).toBe(
      'Votre énergie est tombée sous 25.',
    )
    expect(
      failureLine(progress({ unitsSold: 96, unitsSpoiled: 4 }), FIXED),
    ).toBe(`Plus de 3${S}% de la marchandise a fini aux poubelles.`)
  })

  it('tells how short of bronze the goal fell, with no condition broken', () => {
    const none = { unitsSold: 1_000, unitsSpoiled: 0 }
    expect(
      failureLine(progress({ ...none, netIncome: cents(31_250) }), FIXED),
    ).toBe(
      `Bénéfice net${S}: 312,50${S}$. Le bronze demandait 400${S}$ ou plus.`,
    )
    // A shipped Défi, 12,50 $ short of its bronze.
    const { bronze } = milleDollars.goal.medals
    const netIncome = cents(bronze - 1_250)
    expect(failureLine(progress({ netIncome }), milleDollars)).toBe(
      `Bénéfice net${S}: ${formatBriefMoney(netIncome)}. Le bronze demandait ${atLeast(bronze)}.`,
    )
  })

  it('tells how short of a loss to limit the goal fell', () => {
    const none = { unitsSold: 1_000, unitsSpoiled: 0 }
    const losing = (bronze: number): Defi => ({
      ...FIXED,
      goal: {
        metric: 'netIncome',
        medals: { or: cents(0), argent: cents(bronze), bronze: cents(bronze) },
      },
    })
    const lost = progress({ ...none, netIncome: cents(-200_000) })
    expect(failureLine(lost, losing(-145_000))).toBe(
      `Bénéfice net${S}: -2${S}000${S}$. Le bronze demandait une perte limitée à 1${S}450${S}$.`,
    )
    expect(failureLine(lost, losing(0))).toBe(
      `Bénéfice net${S}: -2${S}000${S}$. Le bronze demandait de terminer sans perte.`,
    )
  })
})

describe('lockedLines', () => {
  it('says why each locked kind of decision cannot change', () => {
    expect(lockedLines(moisSansConge)).toEqual(["Le Défi fixe l'horaire."])
    expect(lockReason('price')).toBe('Le Défi fixe les prix.')
  })

  it('names each forced event card, its date and the choices left', () => {
    expect(lockedLines(payeDans60Jours)).toEqual([
      `Le mercredi 10 mai${S}: «${S}La grosse commande${S}», choix imposé${S}: Accepter.`,
    ])
  })

  it('is empty for a Défi that locks nothing', () => {
    expect(lockedLines(travaux)).toEqual([])
  })
})

describe('progressLines', () => {
  it("shows the goal's measure", () => {
    expect(progressLines(PROGRESS, milleDollars)).toEqual([
      `Bénéfice net${S}: -32${S}$`,
    ])
  })

  it("shows the goal's measure once when a condition watches it too", () => {
    expect(progressLines(PROGRESS, travaux)).toEqual([
      `Encaisse la plus basse${S}: 1${S}870${S}$`,
    ])
  })

  it("adds each condition's measure after the goal's", () => {
    expect(progressLines(PROGRESS, moisSansConge)).toEqual([
      `Bénéfice net${S}: -32${S}$`,
      `Énergie la plus basse${S}: 41`,
    ])
    expect(progressLines(PROGRESS, zeroGaspillage)).toEqual([
      `Clients servis${S}: 1${S}150`,
      `Marchandise jetée${S}: 3,4${S}%`,
    ])
  })
})

describe('endFigures', () => {
  it('lists the measures watched, the key numbers, each once, and the days played', () => {
    expect(endFigures(PROGRESS, moisSansConge)).toEqual([
      `Bénéfice net${S}: -32${S}$`,
      `Énergie la plus basse${S}: 41`,
      `Ventes${S}: 4${S}123,50${S}$`,
      `Encaisse la plus basse${S}: 1${S}870${S}$`,
      `Clients servis${S}: 1${S}150`,
      `Jours joués${S}: 12 sur ${moisSansConge.lengthDays}`,
    ])
  })
})

describe('isChallengeOver', () => {
  it('is true only for a Défi réussi or échoué', () => {
    expect(isChallengeOver(createInitialState(7))).toBe(false)
    expect(isChallengeOver(startChallenge('travauxSaintDenis', 7))).toBe(false)
    expect(isChallengeOver(over(travaux, 'reussi', 'or'))).toBe(true)
    expect(isChallengeOver(over(travaux, 'echoue', null))).toBe(true)
  })
})

describe('keepBestMedals', () => {
  it('records the medal of a Défi already won when it starts', () => {
    const store = createGameStore(over(travaux, 'reussi', 'argent'))
    const record = vi.fn()
    keepBestMedals(store, record)
    expect(record).toHaveBeenCalledExactlyOnceWith(
      'travauxSaintDenis',
      'argent',
    )
  })

  it('records each medal the game wins from then on', () => {
    const store = createGameStore(startChallenge('travauxSaintDenis', 7))
    const record = vi.fn()
    keepBestMedals(store, record)
    expect(record).not.toHaveBeenCalled()
    store.getState().startGame(over(milleDollars, 'reussi', 'bronze'))
    expect(record).toHaveBeenCalledExactlyOnceWith(
      'semaineDesMilleDollars',
      'bronze',
    )
  })

  it('records nothing for a game that is not a Défi, nor a Défi échoué', () => {
    const store = createGameStore(createInitialState(7))
    const record = vi.fn()
    keepBestMedals(store, record)
    store.getState().startGame(over(travaux, 'echoue', null))
    store.getState().setSpeed(3)
    expect(record).not.toHaveBeenCalled()
  })

  it('stops for good', () => {
    const store = createGameStore(createInitialState(7))
    const record = vi.fn()
    keepBestMedals(store, record)()
    store.getState().startGame(over(travaux, 'reussi', 'or'))
    expect(record).not.toHaveBeenCalled()
  })
})
