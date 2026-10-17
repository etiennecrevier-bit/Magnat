import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CandidateId, StaffRoleId } from '../content/schema.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import { applyDecision, type DecisionChange } from '../engine/decisions.ts'
import type { GameState } from '../engine/types.ts'
import { staffBoard } from './staffBoard.ts'
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
      onClose={() => {}}
    />,
  )
}

function decided(state: GameState, ...changes: DecisionChange[]): GameState {
  return changes.reduce((game, change) => applyDecision(game, change), state)
}

/** Each team card's text, tags removed, its parts apart by « | ». */
function cards(html: string): string[] {
  return [...html.matchAll(/<li class="staff__member">(.*?)<\/li>/g)].map(
    ([, inner]) =>
      (inner ?? '')
        .replace(/<\/(h4|p|button|label|span)>/g, '|')
        .replace(/<[^>]*>/g, '')
        .replace(/\|+$/, ''),
  )
}

/** Amélie at the truck since day 1, on the morning of day 2, a Wednesday. */
function amelieAtWork(): GameState {
  return tick(
    tick(decided(START, { kind: 'hire', role: 'camion', candidate: 'amelie' })),
  )
}

describe('StaffPanelView', () => {
  it('opens on Fermer, then the title and the note', () => {
    expect(render(START)).toMatch(
      /^<div class="panel__content"><div class="panel__header"><button type="button" class="toggle">Fermer<\/button><h2 id="staff-title">Qui fait quoi<\/h2><\/div><p class="manage__note">Les changements s&#x27;appliquent demain matin<\/p>/,
    )
  })

  it('shows the owner with their pay and what they do today', () => {
    expect(cards(render(START))).toEqual([
      `Vous|Propriétaire · 700,00${S}$ par semaine|Aujourd&#x27;hui${S}: Congé`,
    ])
    expect(cards(render(tick(START)))[0]).toContain(
      `Aujourd&#x27;hui${S}: Au camion`,
    )
    expect(cards(render({ ...tick(START), ownerAway: true }))[0]).toContain(
      `Aujourd&#x27;hui${S}: ailleurs toute la journée`,
    )
  })

  it('shows each employee with their role, wage and work today, and « Congédier »', () => {
    const html = render(amelieAtWork())
    expect(cards(html)[1]).toBe(
      `Amélie Gagnon|Au camion · 612,50${S}$ par semaine|Aujourd&#x27;hui${S}: Au camion|Salaire horaire|$ de l&#x27;heure|Congédier`,
    )
    expect(html).toContain(
      '<input id="staff-wage-amelie" class="field__input" type="text" inputMode="decimal" autoComplete="off" aria-invalid="false" aria-describedby="staff-wage-amelie-unit" value="17,50"/>',
    )
    expect(html).toContain(
      '<button type="button" class="button" aria-label="Congédier Amélie Gagnon">Congédier</button>',
    )
  })

  it('asks to confirm « Congédier », with the notice it costs', () => {
    const html = render(amelieAtWork(), 'camion', 'amelie')
    expect(html).toContain(
      `<div class="staff__confirm"><p role="alert">Congédier Amélie Gagnon? Préavis${S}: 1${S}225,00${S}$</p><button type="button" class="button button--primary">Confirmer</button> <button type="button" class="button">Annuler</button></div>`,
    )
    expect(html).not.toContain('aria-label="Congédier Amélie Gagnon"')
  })

  it('shows a hire who starts tomorrow, with the training and a free cancel', () => {
    const html = render(
      decided(START, { kind: 'hire', role: 'boulanger', candidate: 'sophie' }),
    )
    expect(cards(html)[1]).toBe(
      `Sophie Roy|Boulanger · 352,00${S}$ par semaine|Commence demain · Formation${S}: 352,00${S}$|Salaire horaire|$ de l&#x27;heure|Annuler l&#x27;embauche · sans frais`,
    )
  })

  it('shows someone fired as leaving tomorrow, with what they do today and nothing left to change', () => {
    const html = render(
      decided(amelieAtWork(), { kind: 'fire', candidate: 'amelie' }),
    )
    expect(cards(html)[1]).toBe(
      `Amélie Gagnon|Au camion · 612,50${S}$ par semaine|Aujourd&#x27;hui${S}: Au camion · Part demain`,
    )
  })

  it('lists the roles with their hours, wage and training, then the candidates to hire', () => {
    const html = render(START, 'livreur')
    expect(html).toContain(
      `<li><button type="button" class="toggle" aria-pressed="false" aria-describedby="staff-role-camion">Au camion</button> <span id="staff-role-camion" class="staff__role-details">35${S}h par semaine · 17,50${S}$ de l&#x27;heure · 612,50${S}$ par semaine · Formation${S}: 612,50${S}$</span></li>`,
    )
    expect(html).toContain(
      'aria-pressed="true" aria-describedby="staff-role-livreur">Livreur</button>',
    )
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
  it('is a modal dialog labelled by its title, for the app store', () => {
    gameStore.getState().startGame(amelieAtWork())
    const html = renderToStaticMarkup(<StaffPanel />)
    expect(html).toMatch(
      /^<dialog class="panel staff" aria-labelledby="staff-title"><div class="panel__content">.*<\/dialog>$/,
    )
    expect(html).toContain('<h4>Amélie Gagnon</h4>')
  })
})
