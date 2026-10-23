import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CandidateId, StaffRoleId } from '../content/schema.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import { applyDecision, type DecisionChange } from '../engine/decisions.ts'
import { cents } from '../engine/money.ts'
import { STAFF } from '../engine/staff.ts'
import type { Day, GameState } from '../engine/types.ts'
import type { StaffTab } from './dockFrame.ts'
import {
  candidateTip,
  memberLine,
  memberTip,
  ownerTip,
  roleTip,
  staffBoard,
} from './staffBoard.ts'
import StaffPanel, { StaffPanelView } from './StaffPanel.tsx'
import { portraitUrl } from './portraits.ts'
import { gameStore, type GameStoreState } from './store.ts'
import Tooltip, { type TipActions, type TipAnchorProps } from './Tooltip.tsx'

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

const START = createInitialState(42)

/**
 * `html` without the preloads React hoists ahead of it, one per portrait
 * shown.
 */
function withoutPreloads(html: string): string {
  return html.replace(/^(<link rel="preload" as="image" href="[^"]*"\/>)+/, '')
}

function render(
  game: GameState,
  role: StaffRoleId = 'camion',
  confirming: CandidateId | null = null,
  tab: StaffTab = 'team',
) {
  return withoutPreloads(
    renderToStaticMarkup(
      <StaffPanelView
        board={staffBoard(game, role)}
        tab={tab}
        role={role}
        onRoleChange={() => {}}
        confirming={confirming}
        onConfirmingChange={() => {}}
        onChange={() => {}}
      />,
    ),
  )
}

function decided(state: GameState, ...changes: DecisionChange[]): GameState {
  return changes.reduce((game, change) => applyDecision(game, change), state)
}

function playedTo(state: GameState, day: Day): GameState {
  let game = state
  while (game.day < day) game = tick(game)
  return game
}

/** `html`'s text, tags removed, its parts apart by « | ». */
function textOf(html: string): string {
  return html
    .replace(/<span class="visually-hidden">.*?<\/span>/g, '')
    .replace(/<span aria-hidden="true">(.*?)<\/span>/g, '$1')
    .replace(/<\/(h3|p|li|button|label|span)>/g, '|')
    .replace(/<[^>]*>/g, '')
    .replace(/\|( ?\|)+/g, '|')
    .replace(/^\||\|$/g, '')
}

/**
 * Each card of a list, its tooltip left out: what it shows, screen
 * readers' words left out too, its parts apart by « | ».
 */
function cards(html: string): string[] {
  return [
    ...html.matchAll(
      /<div class="staff__card[^"]*"[^>]*>(.*?)<\/div><div id="[^"]*" role="tooltip"/g,
    ),
  ].map(([, inner]) => textOf(inner ?? ''))
}

/** Amélie at the truck since day 1, on the morning of day 2, a Wednesday. */
function amelieAtWork(): GameState {
  return tick(
    tick(decided(START, { kind: 'hire', role: 'camion', candidate: 'amelie' })),
  )
}

/**
 * The team of the issue's screenshot, on the morning of day 60: Amélie at
 * the truck, paid what she asks since day 1, her weakness known; Kevin,
 * deliverer at the role's start since day 1, below what he asks, who
 * warned on day 57; Sophie, baker since day 58, her weakness not known yet.
 */
function threeEmployees(): GameState {
  const hired = decided(
    START,
    {
      kind: 'hire',
      role: 'camion',
      candidate: 'amelie',
      hourlyWage: cents(1800),
    },
    { kind: 'hire', role: 'livreur', candidate: 'kevin' },
  )
  const day57 = playedTo(hired, 57)
  return playedTo(
    decided(day57, {
      kind: 'hire',
      role: 'boulanger',
      candidate: 'sophie',
      hourlyWage: cents(2350),
    }),
    60,
  )
}

/** A stand-in for what a tooltip hands its anchor. */
const ANCHOR = { 'aria-describedby': 'tip' } as unknown as TipAnchorProps
const TIP = { open: () => {}, close: () => {} } as unknown as TipActions

type Element = ReactElement<Record<string, unknown>>

/**
 * Every element `node` draws, its components drawn too, without a DOM: a
 * tooltip's anchor with a stand-in, and a component with hooks, which only
 * a render may call, by what its props hold.
 */
function elements(node: ReactNode): Element[] {
  const found: Element[] = []
  const visit = (part: unknown) => {
    if (Array.isArray(part)) {
      part.forEach(visit)
      return
    }
    if (!isValidElement(part)) return
    const element = part as Element
    found.push(element)
    const { props, type } = element
    if (type === Tooltip) {
      const draw = props.children as (
        a: TipAnchorProps,
        t: TipActions,
      ) => ReactNode
      visit(draw(ANCHOR, TIP))
      return
    }
    if (typeof type === 'function') {
      try {
        visit((type as (p: unknown) => ReactNode)(props))
        return
      } catch {
        // A component with hooks: what it is given.
      }
    }
    Object.values(props).forEach(visit)
  }
  visit(node)
  return found
}

/** The panel's view of `game` on `tab`, what it hands `onChange` kept. */
function wired(game: GameState, tab: StaffTab, role: StaffRoleId = 'camion') {
  const changes: DecisionChange[] = []
  const view = (
    <StaffPanelView
      board={staffBoard(game, role)}
      tab={tab}
      role={role}
      onRoleChange={() => {}}
      confirming={null}
      onConfirmingChange={() => {}}
      onChange={(change) => changes.push(change)}
    />
  )
  const button = (label: string) => {
    const found = elements(StaffPanelView(view.props)).find(
      ({ type, props }) => type === 'button' && props['aria-label'] === label,
    )
    if (found === undefined) throw new Error(`No button ${label}`)
    return found.props as { 'aria-disabled'?: boolean; onClick: () => void }
  }
  return { changes, button }
}

describe("StaffPanelView: « L'équipe »", () => {
  it('opens on the note, with no title of its own', () => {
    expect(render(START)).toMatch(
      /^<div class="panel__content"><p class="manage__note">Les changements s&#x27;appliquent demain matin<\/p><ul class="staff__team" aria-label="L&#x27;équipe">/,
    )
  })

  it('shows the owner first, with a silhouette, their role, what they do today and their pay', () => {
    const html = render(START)
    expect(cards(html)).toEqual([
      `Vous|Propriétaire|Congé|700,00${S}$ par semaine`,
    ])
    expect(html).toContain(
      '<svg class="staff__portrait staff__silhouette" viewBox="0 0 96 96" width="48" height="48" aria-hidden="true" focusable="false">',
    )
    expect(html).toContain('<li class="chip chip--off">Congé</li>')
    // Day 0, a Monday, was closed.
    expect(cards(render(tick(START)))[0]).toBe(
      `Vous|Propriétaire|Au camion|700,00${S}$ par semaine|Hier${S}: 0 client servi · 0${S}$ de ventes`,
    )
    expect(cards(render({ ...tick(START), ownerAway: true }))[0]).toBe(
      `Vous|Propriétaire|Ailleurs|700,00${S}$ par semaine|Hier${S}: 0 client servi · 0${S}$ de ventes`,
    )
  })

  it('shows each employee: face, name, role, work today, wage stepper and ask, traits, yesterday and « Congédier »', () => {
    const html = render(amelieAtWork())
    expect(cards(html)[1]).toBe(
      `Amélie Gagnon|Au camion|Au camion|Salaire horaire|−|$ de l&#x27;heure|+|⚠︎ demande 18${S}$|▲ Accueil|?|Hier${S}: 30 clients servis · 178${S}$ de ventes|Congédier`,
    )
    expect(html).toContain(
      `<p class="staff__yesterday">Hier${S}: 30 clients servis · 178${S}$ de ventes</p>`,
    )
    expect(html).toContain('<li class="chip">Au camion</li>')
    // Her face from staff.json's portrait id; only the owner keeps the silhouette.
    const portrait = portraitUrl('amelieGagnon')
    expect(portrait).not.toBeNull()
    expect(html).toContain(
      `<img class="staff__portrait" src="${portrait}" alt="" width="48" height="48"/>`,
    )
    expect(html.match(/staff__silhouette/g)).toHaveLength(1)
    // The owner's card takes the focus; hers has controls of its own.
    expect(html.match(/<div class="staff__card" tabindex="0"/g)).toHaveLength(1)
    expect(html).toMatch(
      /<input id="staff-wage-amelie" class="field__input" type="text" inputMode="decimal" autoComplete="off" aria-invalid="false" aria-describedby="staff-wage-amelie-unit staff-amelie-asking [^"]+" value="17,50"\/>/,
    )
    expect(html).toMatch(
      /<button type="button" class="button" aria-label="Congédier Amélie Gagnon" aria-describedby="[^"]+">Congédier<\/button>/,
    )
  })

  it('marks the wage asked under the stepper, in amber with ⚠︎ while the wage is below it', () => {
    const below = render(amelieAtWork())
    expect(below).toContain(
      `<p id="staff-amelie-asking" class="staff__asking staff__asking--under"><span aria-hidden="true">⚠︎ </span>demande 18${S}$</p>`,
    )
    const paid = decided(amelieAtWork(), {
      kind: 'setWage',
      candidate: 'amelie',
      hourlyWage: cents(1800),
    })
    expect(render(paid)).toContain(
      `<p id="staff-amelie-asking" class="staff__asking">demande 18${S}$</p>`,
    )
  })

  it('shows the traits as chips that follow knownTraits: ▲ the strength, « ? », then ▼ the weakness', () => {
    const unknown = render(amelieAtWork())
    expect(unknown).toContain(
      '<ul class="staff__traits" aria-label="Force et faiblesse">' +
        `<li class="chip chip--strong"><span aria-hidden="true">▲</span><span class="visually-hidden">Force${S}:</span> Accueil</li>` +
        `<li class="chip chip--off"><span class="visually-hidden">Faiblesse${S}: inconnue</span><span aria-hidden="true">?</span></li></ul>`,
    )
    const amelie = staffBoard(amelieAtWork()).members[0]!
    expect(memberTip(amelie, 35).rows).toContainEqual({
      label: 'Faiblesse',
      value: `Se révèle après 2${S}semaines de travail`,
    })
    // Two weeks on the job, day 15: her weakness shows.
    const known = playedTo(amelieAtWork(), 15)
    expect(render(known)).toContain(
      `<li class="chip chip--weak"><span aria-hidden="true">▼</span><span class="visually-hidden">Faiblesse${S}:</span> Rapidité</li>`,
    )
    expect(memberTip(staffBoard(known).members[0]!, 35).rows).toContainEqual({
      label: 'Faiblesse · Rapidité',
      value: 'Sert les clients moins vite',
    })
  })

  it('shows the three employees of the issue: a weakness unknown, one known, one underpaid who warned', () => {
    const html = render(threeEmployees())
    const [, amelie, kevin, sophie] = cards(html)
    expect(amelie).toContain(`demande 18${S}$|▲ Accueil|▼ Rapidité|`)
    expect(kevin).toMatch(
      new RegExp(
        `^Kevin Bouchard\\|Livreur\\|Pense à partir\\|.*\\|⚠︎ demande 16,50${S}\\$\\|▲ Rapidité\\|▼ Minutie\\|`,
      ),
    )
    expect(sophie).toContain(`demande 23,50${S}$|▲ Fiabilité|?|`)
    expect(html).toContain(
      '<p id="staff-kevin-status" class="status-line"><span class="status-line__dot status-line__dot--warn" aria-hidden="true"></span>Pense à partir</p>',
    )
    // The minutie he lacks does nothing on the road.
    expect(
      memberTip(staffBoard(threeEmployees()).members[1]!, 10).rows,
    ).toContainEqual({
      label: 'Faiblesse · Minutie',
      value: 'Sans effet en livraison',
    })
  })

  it('steps the wage by 0,50 $ within the role, at a limit aria-disabled', () => {
    const { changes, button } = wired(amelieAtWork(), 'team')
    button(`Amélie Gagnon${S}: augmenter le salaire de 0,50${S}$`).onClick()
    button(`Amélie Gagnon${S}: baisser le salaire de 0,50${S}$`).onClick()
    expect(changes).toEqual([
      { kind: 'setWage', candidate: 'amelie', hourlyWage: 1800 },
      { kind: 'setWage', candidate: 'amelie', hourlyWage: 1700 },
    ])
    const { max } = STAFF.roles.camion.hourlyWageCents
    const top = decided(amelieAtWork(), {
      kind: 'setWage',
      candidate: 'amelie',
      hourlyWage: cents(max),
    })
    const atMax = wired(top, 'team')
    const plus = atMax.button(
      `Amélie Gagnon${S}: augmenter le salaire de 0,50${S}$`,
    )
    expect(plus['aria-disabled']).toBe(true)
    plus.onClick()
    expect(atMax.changes).toEqual([])
  })

  it('asks to confirm « Congédier », the notice in the tooltip', () => {
    const html = render(amelieAtWork(), 'camion', 'amelie')
    expect(html).toMatch(
      /<div class="staff__confirm"><p role="alert">Congédier Amélie Gagnon\?<\/p><button type="button" class="button button--primary" aria-describedby="[^"]+">Confirmer<\/button> <button type="button" class="button">Annuler<\/button><\/div>/,
    )
    expect(cards(html)[1]).not.toContain('Préavis')
    expect(html).not.toContain('aria-label="Congédier Amélie Gagnon"')
  })

  it('puts the hours, the pay, the ask, the traits and the notice in the tooltip of someone at work', () => {
    const board = staffBoard(amelieAtWork())
    expect(memberTip(board.members[0]!, 35)).toEqual({
      title: 'Amélie Gagnon',
      rows: [
        { label: 'Rôle', value: 'Au camion' },
        { label: 'Heures par semaine', value: `35${S}h` },
        { label: 'Salaire par semaine', value: `612,50${S}$` },
        { label: 'Demande', value: `18,00${S}$ de l'heure`, warn: true },
        { label: 'Force · Accueil', value: "Attire plus d'habitués" },
        {
          label: 'Faiblesse',
          value: `Se révèle après 2${S}semaines de travail`,
        },
        { label: 'Préavis si congédié', value: `1${S}225,00${S}$` },
        // Hired on day 1, a Tuesday: the days she worked.
        { label: 'mar. 2', value: `30 clients · 178${S}$`, divider: true },
      ],
    })
    expect(render(amelieAtWork())).toContain(
      `<dt>Préavis si congédié</dt><dd>1${S}225,00${S}$</dd>`,
    )
    expect(ownerTip(board.owner).rows?.slice(0, 3)).toEqual([
      { label: 'Rôle', value: 'Propriétaire' },
      { label: 'Salaire par semaine', value: `700,00${S}$` },
      { label: 'lun. 1er', value: `0 client · 0${S}$`, divider: true },
    ])
    expect(ownerTip(board.owner).rows?.[3]?.label).toBe('mar. 2')
  })

  it('shows a hire who starts tomorrow, with a free cancel, the training in the tooltip', () => {
    const game = decided(START, {
      kind: 'hire',
      role: 'boulanger',
      candidate: 'sophie',
    })
    const html = render(game)
    expect(cards(html)[1]).toBe(
      `Sophie Roy|Boulanger|Commence demain|Salaire horaire|−|$ de l&#x27;heure|+|⚠︎ demande 23,50${S}$|▲ Fiabilité|?|Annuler l&#x27;embauche · sans frais`,
    )
    expect(html).toContain(
      '<p id="staff-sophie-status" class="status-line"><span class="status-line__dot status-line__dot--warn" aria-hidden="true"></span>Commence demain</p>',
    )
    const sophie = staffBoard(game).members[0]!
    expect(memberTip(sophie, 16).rows).toContainEqual({
      label: 'Formation',
      value: `352,00${S}$`,
    })
    expect(memberLine(sophie).fact).toEqual({
      tone: 'warn',
      text: 'Commence demain',
    })
  })

  it('shows someone fired as leaving tomorrow, with what they do today and nothing left to change', () => {
    const game = decided(amelieAtWork(), { kind: 'fire', candidate: 'amelie' })
    const html = render(game)
    expect(cards(html)[1]).toBe(
      `Amélie Gagnon|Au camion|Part demain|Au camion|17,50${S}$ de l&#x27;heure|▲ Accueil|?|Hier${S}: 30 clients servis · 178${S}$ de ventes`,
    )
    expect(html).toContain(
      '<div class="staff__card" tabindex="0" aria-describedby=',
    )
    expect(html.match(/<div class="staff__card" tabindex="0"/g)).toHaveLength(2)
    const amelie = staffBoard(game).members[0]!
    expect(memberLine(amelie).fact).toEqual({
      tone: 'off',
      text: 'Part demain',
    })
    expect(memberTip(amelie, 35).rows).not.toContainEqual(
      expect.objectContaining({ label: 'Préavis si congédié' }),
    )
  })

  it('shows an employee absent today with an amber « Absent »', () => {
    // Seed 42: Nadia misses day 2 at the truck.
    const game = playedTo(
      decided(START, { kind: 'hire', role: 'camion', candidate: 'nadia' }),
      2,
    )
    expect(render(game)).toContain(
      '<ul class="staff__tasks" aria-label="Aujourd&#x27;hui"><li class="chip chip--weak">Absent</li></ul>',
    )
  })
})

describe('StaffPanelView: « Embaucher »', () => {
  it('lists the roles by name, their hours, wage and training in each one’s tooltip', () => {
    const html = render(START, 'livreur', null, 'hire')
    expect(html).not.toContain('staff__team')
    expect(html).toMatch(
      /<li><button type="button" class="toggle" aria-pressed="false" aria-describedby="[^"]+">Au camion<\/button><div id="[^"]+" role="tooltip"/,
    )
    expect(html).toMatch(
      /aria-pressed="true" aria-describedby="[^"]+">Livreur<\/button>/,
    )
    expect(roleTip(staffBoard(START).roles[0]!)).toEqual({
      title: 'Au camion',
      rows: [
        { label: 'Heures par semaine', value: `35${S}h` },
        { label: 'Salaire horaire', value: `17,50${S}$` },
        { label: 'Salaire par semaine', value: `612,50${S}$` },
        { label: 'Formation', value: `612,50${S}$` },
      ],
    })
  })

  it('shows a card per candidate: face, name, strength, « Faiblesse : ? », the ask, the training and « Embaucher »', () => {
    const html = render(START, 'livreur', null, 'hire')
    const shown = cards(html)
    expect(shown).toHaveLength(12)
    expect(shown[0]).toBe(
      `Amélie Gagnon|▲ Accueil|Faiblesse${S}: ?|Demande 16,50${S}$ de l&#x27;heure|Formation${S}: 1${S}semaine payée|Embaucher`,
    )
    expect(html).toContain(
      `<img class="staff__portrait" src="${portraitUrl('amelieGagnon')}" alt="" width="48" height="48"/>`,
    )
    expect(html).toMatch(
      /<button type="button" class="button staff__hire" aria-label="Embaucher Amélie Gagnon, Livreur">Embaucher<\/button>/,
    )
    const faces = [
      ...html.matchAll(/<img class="staff__portrait" src="([^"]+)"/g),
    ]
    expect(faces.map(([, src]) => src)).toEqual(
      staffBoard(START).candidates.map(({ portrait }) => portraitUrl(portrait)),
    )
    expect(html).not.toContain('staff__silhouette')
  })

  it('puts the hours, the pay a week, the training amount and the strength’s effect in the tooltip', () => {
    const board = staffBoard(START, 'livreur')
    expect(candidateTip(board.candidates[0]!, 'livreur')).toEqual({
      title: 'Amélie Gagnon',
      rows: [
        { label: 'Rôle', value: 'Livreur' },
        { label: 'Heures par semaine', value: `10${S}h` },
        { label: 'Demande', value: `16,50${S}$ de l'heure` },
        { label: 'Salaire par semaine', value: `165,00${S}$` },
        { label: 'Formation', value: `165,00${S}$` },
        { label: 'Force · Accueil', value: 'Sans effet en livraison' },
        {
          label: 'Faiblesse',
          value: `Se révèle après 2${S}semaines de travail`,
        },
      ],
    })
  })

  it('hires a candidate at the wage they ask', () => {
    const { changes, button } = wired(START, 'hire', 'boulanger')
    button('Embaucher Kevin Bouchard, Boulanger').onClick()
    expect(changes).toEqual([
      {
        kind: 'hire',
        role: 'boulanger',
        candidate: 'kevin',
        hourlyWage: 2250,
      },
    ])
  })

  it('says the team is full, the hires disabled, each card focusable for its tooltip', () => {
    const html = render(
      decided(
        START,
        { kind: 'hire', role: 'camion', candidate: 'amelie' },
        { kind: 'hire', role: 'livreur', candidate: 'kevin' },
        { kind: 'hire', role: 'boulanger', candidate: 'sophie' },
      ),
      'camion',
      null,
      'hire',
    )
    expect(html).toContain(
      '</ul><p id="staff-full" class="staff__full">L&#x27;équipe est complète.</p>',
    )
    const hires = [...html.matchAll(/<button[^>]*>Embaucher<\/button>/g)]
    expect(hires).toHaveLength(9)
    for (const [hire] of hires) {
      expect(hire).toContain('disabled="" aria-describedby="staff-full"')
    }
    expect(
      html.match(
        /<div class="staff__card staff__card--candidate" tabindex="0"/g,
      ),
    ).toHaveLength(9)
  })
})

describe('StaffPanelView: never a trait number on screen', () => {
  /** Every number a trait moves, as fr-CA writes it: « 1,15 », « 0,06 ». */
  const TRAIT_NUMBERS = Object.values(STAFF.traits).flatMap(
    ({ strong, normal, weak }) =>
      [strong, normal, weak].map((value) =>
        value.toLocaleString('fr-CA', { maximumFractionDigits: 4 }),
      ),
  )

  /** The trait chips of `html`, and the tooltip rows of the traits. */
  function traitTexts(html: string): string[] {
    const text = (part: string) =>
      part.replace(/<[^>]*>/g, '').replaceAll('&#x27;', "'")
    const chips = [
      ...html.matchAll(/<ul class="staff__traits"[^>]*>(.*?)<\/ul>/g),
    ].map(([, inner]) => text(inner ?? ''))
    // What a trait does; when an unknown weakness shows is a time, apart.
    const rows = [
      ...html.matchAll(
        /<dt>((?:Force|Faiblesse) · [^<]*)<\/dt><dd[^>]*>([^<]*)<\/dd>/g,
      ),
    ].map(([, label, value]) => text(`${label} ${value}`))
    return [...chips, ...rows]
  }

  it('says what a trait does in words only, on the cards and in their tooltips', () => {
    const team = render(threeEmployees())
    const hire = ['camion', 'livreur', 'boulanger'].map((role) =>
      render(START, role as StaffRoleId, null, 'hire'),
    )
    for (const html of [team, ...hire]) {
      const texts = traitTexts(html)
      expect(texts.length).toBeGreaterThan(0)
      for (const text of texts) {
        expect(text).not.toMatch(/[\d%×]/)
        for (const number of TRAIT_NUMBERS) {
          expect(text).not.toMatch(
            new RegExp(`(^|[^\\d,])${number}($|[^\\d,])`),
          )
        }
      }
      expect(html).not.toContain('%')
      expect(html).not.toContain('×')
    }
    // Both kinds were seen: trait rows of the tooltips and the chips.
    expect(
      traitTexts(team).some((text) => text.startsWith('Faiblesse · ')),
    ).toBe(true)
  })
})

describe('StaffPanel', () => {
  it('is a modal dialog in the dock’s frame, labelled by its title « Équipe », for the app store', () => {
    gameStore.getState().startGame(amelieAtWork())
    // React hoists a preload of each portrait ahead of the dialog.
    const html = withoutPreloads(renderToStaticMarkup(<StaffPanel />))
    expect(html).toMatch(
      /^<dialog class="panel dock-frame dock-panel staff" aria-labelledby="([^"]+)"><div class="dock-frame__header"><h2 id="\1" class="dock-frame__title">Équipe<\/h2>.*<div class="panel__content">.*<\/dialog>$/,
    )
    expect(html).toContain('<h3 class="staff__name">Amélie Gagnon</h3>')
  })

  it("has the tabs « L'équipe » and « Embaucher », and opens on the team", () => {
    gameStore.getState().startGame(amelieAtWork())
    const html = withoutPreloads(renderToStaticMarkup(<StaffPanel />))
    expect(html).toMatch(
      /<div class="dock-frame__tabs" role="tablist" aria-label="Équipe">.*aria-selected="true"[^>]*>L&#x27;équipe<\/button>.*aria-selected="false"[^>]*>Embaucher<\/button><\/div>/,
    )
    expect(html).toContain('<ul class="staff__team"')
    expect(html).not.toContain('staff__candidates')
  })
})
