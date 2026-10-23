import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CandidateId, StaffRoleId } from '../content/schema.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import { applyDecision, type DecisionChange } from '../engine/decisions.ts'
import type { GameState } from '../engine/types.ts'
import {
  memberLine,
  memberTip,
  ownerTip,
  roleTip,
  staffBoard,
} from './staffBoard.ts'
import StaffPanel, { StaffPanelView } from './StaffPanel.tsx'
import { gameStore, type GameStoreState } from './store.ts'

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

function render(
  game: GameState,
  role: StaffRoleId = 'camion',
  confirming: CandidateId | null = null,
) {
  return renderToStaticMarkup(
    <StaffPanelView
      board={staffBoard(game)}
      role={role}
      onRoleChange={() => {}}
      confirming={confirming}
      onConfirmingChange={() => {}}
      onChange={() => {}}
    />,
  )
}

function decided(state: GameState, ...changes: DecisionChange[]): GameState {
  return changes.reduce((game, change) => applyDecision(game, change), state)
}

/**
 * Each row of the team, its tooltip left out: its text, tags removed, its
 * parts apart by « | ».
 */
function rows(html: string): string[] {
  const team =
    html.match(/<ul class="staff__team"[^>]*>(.*?)<section/)?.[1] ?? ''
  return [
    ...team.matchAll(
      /<div class="staff__row"[^>]*>(.*?)<\/div><div id="[^"]*" role="tooltip"/g,
    ),
  ].map(([, inner]) =>
    (inner ?? '')
      .replace(/<\/(h3|p|li|button|label|span)>/g, '|')
      .replace(/<[^>]*>/g, '')
      .replace(/\|+/g, '|')
      .replace(/^\||\|$/g, ''),
  )
}

/** Amélie at the truck since day 1, on the morning of day 2, a Wednesday. */
function amelieAtWork(): GameState {
  return tick(
    tick(decided(START, { kind: 'hire', role: 'camion', candidate: 'amelie' })),
  )
}

describe('StaffPanelView', () => {
  it('opens on the note, with no title of its own', () => {
    expect(render(START)).toMatch(
      /^<div class="panel__content"><p class="manage__note">Les changements s&#x27;appliquent demain matin<\/p><ul class="staff__team" aria-label="L&#x27;équipe">/,
    )
  })

  it('shows the owner with a silhouette, their role, what they do today and their pay', () => {
    const html = render(START)
    expect(rows(html)).toEqual([
      `Vous|Propriétaire|Congé|700,00${S}$ par semaine`,
    ])
    expect(html).toContain(
      '<svg class="staff__portrait staff__silhouette" viewBox="0 0 96 96" width="48" height="48" aria-hidden="true" focusable="false">',
    )
    expect(html).toContain('<li class="chip chip--off">Congé</li>')
    // Day 0, a Monday, was closed.
    expect(rows(render(tick(START)))[0]).toBe(
      `Vous|Propriétaire|Au camion|700,00${S}$ par semaine|Hier${S}: 0 client servi · 0${S}$ de ventes`,
    )
    expect(rows(render({ ...tick(START), ownerAway: true }))[0]).toBe(
      `Vous|Propriétaire|Ailleurs|700,00${S}$ par semaine|Hier${S}: 0 client servi · 0${S}$ de ventes`,
    )
  })

  it('shows each employee with their role, work today as chips, wage and « Congédier »', () => {
    const html = render(amelieAtWork())
    expect(rows(html)[1]).toBe(
      `Amélie Gagnon|Au camion|Au camion|Salaire horaire|$ de l&#x27;heure|Hier${S}: 30 clients servis · 178${S}$ de ventes|Congédier`,
    )
    expect(html).toContain(
      `<p class="staff__yesterday">Hier${S}: 30 clients servis · 178${S}$ de ventes</p>`,
    )
    expect(html).toContain('<li class="chip">Au camion</li>')
    expect(html.match(/<div class="staff__row" tabindex="0"/g)).toHaveLength(1)
    expect(html).toMatch(
      /<input id="staff-wage-amelie" class="field__input" type="text" inputMode="decimal" autoComplete="off" aria-invalid="false" aria-describedby="staff-wage-amelie-unit [^"]+" value="17,50"\/>/,
    )
    expect(html).toMatch(
      /<button type="button" class="button" aria-label="Congédier Amélie Gagnon" aria-describedby="[^"]+">Congédier<\/button>/,
    )
  })

  it('puts the hours, the weekly pay and the notice in the tooltip of someone at work', () => {
    const board = staffBoard(amelieAtWork())
    expect(memberTip(board.members[0]!, 35)).toEqual({
      title: 'Amélie Gagnon',
      rows: [
        { label: 'Rôle', value: 'Au camion' },
        { label: 'Heures par semaine', value: `35${S}h` },
        { label: 'Salaire par semaine', value: `612,50${S}$` },
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

  it('asks to confirm « Congédier », the notice in the tooltip', () => {
    const html = render(amelieAtWork(), 'camion', 'amelie')
    expect(html).toMatch(
      /<div class="staff__confirm"><p role="alert">Congédier Amélie Gagnon\?<\/p><button type="button" class="button button--primary" aria-describedby="[^"]+">Confirmer<\/button> <button type="button" class="button">Annuler<\/button><\/div>/,
    )
    expect(rows(html)[1]).not.toContain('Préavis')
    expect(html).not.toContain('aria-label="Congédier Amélie Gagnon"')
  })

  it('shows a hire who starts tomorrow, with a free cancel, the training in the tooltip', () => {
    const game = decided(START, {
      kind: 'hire',
      role: 'boulanger',
      candidate: 'sophie',
    })
    const html = render(game)
    expect(rows(html)[1]).toBe(
      `Sophie Roy|Boulanger|Commence demain|Salaire horaire|$ de l&#x27;heure|Annuler l&#x27;embauche · sans frais`,
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
    expect(rows(html)[1]).toBe(
      `Amélie Gagnon|Au camion|Part demain|Au camion|17,50${S}$ de l&#x27;heure|Hier${S}: 30 clients servis · 178${S}$ de ventes`,
    )
    expect(html).toContain(
      '<div class="staff__row" tabindex="0" aria-describedby=',
    )
    expect(html.match(/<div class="staff__row" tabindex="0"/g)).toHaveLength(2)
    const amelie = staffBoard(game).members[0]!
    expect(memberLine(amelie).fact).toEqual({
      tone: 'off',
      text: 'Part demain',
    })
    expect(memberTip(amelie, 35).rows).not.toContainEqual(
      expect.objectContaining({ label: 'Préavis si congédié' }),
    )
  })

  it('lists the roles by name, their hours, wage and training in each one’s tooltip, then the candidates to hire', () => {
    const html = render(START, 'livreur')
    expect(html).toMatch(
      /<li><button type="button" class="toggle" aria-pressed="false" aria-describedby="[^"]+">Au camion<\/button><div id="[^"]+" role="tooltip"/,
    )
    expect(html).toMatch(
      /aria-pressed="true" aria-describedby="[^"]+">Livreur<\/button>/,
    )
    expect(html).not.toContain('staff__role-details')
    expect(roleTip(staffBoard(START).roles[0]!)).toEqual({
      title: 'Au camion',
      rows: [
        { label: 'Heures par semaine', value: `35${S}h` },
        { label: 'Salaire horaire', value: `17,50${S}$` },
        { label: 'Salaire par semaine', value: `612,50${S}$` },
        { label: 'Formation', value: `612,50${S}$` },
      ],
    })
    expect(html).toContain(
      '<li><span>Amélie Gagnon</span> <button type="button" class="button" aria-label="Embaucher Amélie Gagnon, Livreur">Embaucher</button></li>',
    )
    expect(html.match(/>Embaucher<\/button>/g)).toHaveLength(12)
  })

  it('says the team is full, the hires disabled', () => {
    const html = render(
      decided(
        START,
        { kind: 'hire', role: 'camion', candidate: 'amelie' },
        { kind: 'hire', role: 'livreur', candidate: 'kevin' },
        { kind: 'hire', role: 'boulanger', candidate: 'sophie' },
      ),
    )
    expect(html).toContain(
      '<h3 id="staff-hire">Embaucher</h3><p id="staff-full" class="staff__full">L&#x27;équipe est complète.</p>',
    )
    const hires = [...html.matchAll(/<button[^>]*>Embaucher<\/button>/g)]
    expect(hires).toHaveLength(9)
    for (const [hire] of hires) {
      expect(hire).toContain('disabled="" aria-describedby="staff-full"')
    }
  })
})

describe('StaffPanel', () => {
  it('is a modal dialog in the dock’s frame, labelled by its title « Équipe », for the app store', () => {
    gameStore.getState().startGame(amelieAtWork())
    const html = renderToStaticMarkup(<StaffPanel />)
    expect(html).toMatch(
      /^<dialog class="panel dock-frame dock-panel staff" aria-labelledby="([^"]+)"><div class="dock-frame__header"><h2 id="\1" class="dock-frame__title">Équipe<\/h2>.*<div class="panel__content">.*<\/dialog>$/,
    )
    expect(html).toContain('<h3 class="staff__name">Amélie Gagnon</h3>')
  })
})
