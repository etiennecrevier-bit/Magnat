import { useMemo, useState } from 'react'
import type { CandidateId, StaffRoleId } from '../content/schema.ts'
import type { DecisionChange } from '../engine/decisions.ts'
import { cents } from '../engine/money.ts'
import { wageChange } from './decisionInput.ts'
import { DockPanel } from './DockFrame.tsx'
import { useFieldDialog } from './fieldDialog.ts'
import { formatAmount, formatMoney } from './formatMoney.ts'
import { NumberField } from './NumberField.tsx'
import {
  staffBoard,
  TASK_NAMES,
  type MemberRow,
  type OwnerRow,
  type RoleOffer,
  type StaffBoard,
  type Task,
} from './staffBoard.ts'
import { useGame } from './store.ts'
import './panel.css'
import './ManagePanel.css'
import './StaffPanel.css'

const TITLE_ID = 'staff-title'
const FULL_ID = 'staff-full'

type OnChange = (change: DecisionChange) => void

interface StaffPanelViewProps {
  board: StaffBoard
  /** The role the player hires for. */
  role: StaffRoleId
  onRoleChange: (role: StaffRoleId) => void
  /** The employee whose firing waits for « Confirmer »; null if none. */
  confirming: CandidateId | null
  onConfirmingChange: (candidate: CandidateId | null) => void
  onChange: OnChange
  onClose: () => void
}

/** What someone does today, or « Congé » when nothing. */
function tasksText(tasks: readonly Task[]): string {
  return tasks.length === 0
    ? 'Congé'
    : tasks.map((task) => TASK_NAMES[task]).join(', ')
}

/**
 * « Qui fait quoi »: the owner and each employee with their role, their
 * wage and what they do today, then « Embaucher » with the roles and the
 * candidates. « Congédier » asks to confirm, with the notice it costs.
 */
export function StaffPanelView({
  board,
  role,
  onRoleChange,
  confirming,
  onConfirmingChange,
  onChange,
  onClose,
}: StaffPanelViewProps) {
  const offer = board.roles.find((option) => option.role === role)
  return (
    <div className="panel__content">
      {/* Fermer comes first so it has the focus when the panel opens. */}
      <div className="panel__header">
        <button type="button" className="toggle" onClick={onClose}>
          Fermer
        </button>
        <h2 id={TITLE_ID}>Qui fait quoi</h2>
      </div>
      <p className="manage__note">Les changements s'appliquent demain matin</p>
      <section aria-labelledby="staff-team">
        <h3 id="staff-team">L'équipe</h3>
        <ul className="staff__team">
          <OwnerCard owner={board.owner} />
          {board.members.map((member) => (
            <MemberCard
              key={member.candidate}
              member={member}
              confirming={confirming === member.candidate}
              onConfirmingChange={onConfirmingChange}
              onChange={onChange}
            />
          ))}
        </ul>
      </section>
      <section aria-labelledby="staff-hire">
        <h3 id="staff-hire">Embaucher</h3>
        {board.full && (
          <p id={FULL_ID} className="staff__full">
            L'équipe est complète.
          </p>
        )}
        <ul className="staff__roles" aria-label="Rôle">
          {board.roles.map((option) => (
            <RoleOption
              key={option.role}
              offer={option}
              pressed={option.role === role}
              onPress={() => onRoleChange(option.role)}
            />
          ))}
        </ul>
        {board.candidates.length === 0 ? (
          <p>Personne d'autre à embaucher.</p>
        ) : (
          <ul className="staff__candidates">
            {board.candidates.map(({ candidate, name }) => (
              <li key={candidate}>
                <span>{name}</span>{' '}
                <button
                  type="button"
                  className="button"
                  aria-label={`Embaucher ${name}${offer === undefined ? '' : `, ${offer.name}`}`}
                  disabled={board.full}
                  aria-describedby={board.full ? FULL_ID : undefined}
                  onClick={() => onChange({ kind: 'hire', role, candidate })}
                >
                  Embaucher
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function OwnerCard({ owner }: { owner: OwnerRow }) {
  return (
    <li className="staff__member">
      <h4>Vous</h4>
      <p>Propriétaire · {formatMoney(owner.weeklyPay)} par semaine</p>
      <p>
        Aujourd'hui&nbsp;:{' '}
        {owner.away ? 'ailleurs toute la journée' : tasksText(owner.tasks)}
      </p>
    </li>
  )
}

function MemberCard({
  member,
  confirming,
  onConfirmingChange,
  onChange,
}: {
  member: MemberRow
  confirming: boolean
  onConfirmingChange: (candidate: CandidateId | null) => void
  onChange: OnChange
}) {
  const { candidate, name, role, roleName, hourlyWage, status } = member
  const fire = () => {
    onConfirmingChange(null)
    onChange({ kind: 'fire', candidate })
  }
  return (
    <li className="staff__member">
      <h4>{name}</h4>
      <p>
        {roleName} · {formatMoney(member.weeklyWage)} par semaine
      </p>
      <p>
        {status === 'atWork' && (
          <>Aujourd'hui&nbsp;: {tasksText(member.tasks)}</>
        )}
        {status === 'startsTomorrow' && (
          <>
            Commence demain · Formation&nbsp;:{' '}
            {formatMoney(member.training ?? cents(0))}
          </>
        )}
        {status === 'leavesTomorrow' && (
          <>Aujourd'hui&nbsp;: {tasksText(member.tasks)} · Part demain</>
        )}
      </p>
      {status !== 'leavesTomorrow' && (
        <NumberField
          id={`staff-wage-${candidate}`}
          label="Salaire horaire"
          unit="$ de l'heure"
          inputMode="decimal"
          value={formatAmount(hourlyWage)}
          read={(text) => wageChange(candidate, role, text, hourlyWage)}
          onChange={onChange}
        />
      )}
      {status === 'startsTomorrow' && (
        <button type="button" className="button" onClick={fire}>
          Annuler l'embauche · sans frais
        </button>
      )}
      {status === 'atWork' &&
        (confirming ? (
          <div className="staff__confirm">
            <p role="alert">
              Congédier {name}? Préavis&nbsp;:{' '}
              {formatMoney(member.fireCost ?? cents(0))}
            </p>
            <button
              type="button"
              className="button button--primary"
              onClick={fire}
            >
              Confirmer
            </button>{' '}
            <button
              type="button"
              className="button"
              onClick={() => onConfirmingChange(null)}
            >
              Annuler
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="button"
            aria-label={`Congédier ${name}`}
            onClick={() => onConfirmingChange(candidate)}
          >
            Congédier
          </button>
        ))}
    </li>
  )
}

function RoleOption({
  offer,
  pressed,
  onPress,
}: {
  offer: RoleOffer
  pressed: boolean
  onPress: () => void
}) {
  const detailsId = `staff-role-${offer.role}`
  return (
    <li>
      <button
        type="button"
        className="toggle"
        aria-pressed={pressed}
        aria-describedby={detailsId}
        onClick={onPress}
      >
        {offer.name}
      </button>{' '}
      <span id={detailsId} className="staff__role-details">
        {offer.hoursPerWeek}&nbsp;h par semaine ·{' '}
        {formatMoney(offer.hourlyWage)} de l'heure ·{' '}
        {formatMoney(offer.weeklyWage)} par semaine · Formation&nbsp;:{' '}
        {formatMoney(offer.training)}
      </span>
    </li>
  )
}

/**
 * « Équipe », the panel wired to the app store, in the dock's frame, a
 * modal dialog (see `useFieldDialog`), the role picked and the firing to
 * confirm kept while it is open.
 */
export default function StaffPanel() {
  const game = useGame((state) => state.game)
  const decide = useGame((state) => state.decide)
  const closePanel = useGame((state) => state.closePanel)
  const board = useMemo(() => staffBoard(game), [game])
  const [role, setRole] = useState<StaffRoleId>(
    () => board.roles[0]?.role ?? 'camion',
  )
  const [confirming, setConfirming] = useState<CandidateId | null>(null)
  const { dialogRef, onChange, close, onCancel } = useFieldDialog(decide)

  return (
    <DockPanel
      dialogRef={dialogRef}
      className="staff"
      title="Équipe"
      onCancel={onCancel}
      onClose={closePanel}
      onDismiss={close}
    >
      <StaffPanelView
        board={board}
        role={role}
        onRoleChange={setRole}
        confirming={confirming}
        onConfirmingChange={setConfirming}
        onChange={onChange}
        onClose={close}
      />
    </DockPanel>
  )
}
