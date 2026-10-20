import { useEffect, useMemo, useRef, useState } from 'react'
import type { CandidateId, StaffRoleId } from '../content/schema.ts'
import type { DecisionChange } from '../engine/decisions.ts'
import { STAFF } from '../engine/staff.ts'
import { wageChange } from './decisionInput.ts'
import { describedBy } from './describedBy.ts'
import { DockPanel } from './DockFrame.tsx'
import { useFieldDialog } from './fieldDialog.ts'
import { formatAmount, formatMoney } from './formatMoney.ts'
import { NumberField } from './NumberField.tsx'
import { portraitUrl } from './portraits.ts'
import { StatusLineView } from './ProductCard.tsx'
import { Silhouette } from './Silhouette.tsx'
import {
  memberLine,
  memberTip,
  ownerTip,
  roleTip,
  staffBoard,
  TASK_NAMES,
  type MemberRow,
  type OwnerRow,
  type RoleOffer,
  type StaffBoard,
  type Task,
} from './staffBoard.ts'
import { useGame } from './store.ts'
import type { TipActions } from './Tooltip.tsx'
import Tooltip from './Tooltip.tsx'
import './panel.css'
import './ManagePanel.css'
import './StaffPanel.css'

const FULL_ID = 'staff-full'

/** The size of a portrait on a row, in CSS pixels. */
const PORTRAIT_SIZE = 48

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
}

/**
 * « Qui fait quoi »: a row for the owner and for each employee, with what
 * they do today, then « Embaucher » with the roles and the candidates.
 * What a row leaves out, such as the training or the notice, is in its
 * tooltip. « Congédier » asks to confirm.
 */
export function StaffPanelView({
  board,
  role,
  onRoleChange,
  confirming,
  onConfirmingChange,
  onChange,
}: StaffPanelViewProps) {
  const offer = board.roles.find((option) => option.role === role)
  return (
    <div className="panel__content">
      <p className="manage__note">Les changements s'appliquent demain matin</p>
      <ul className="staff__team" aria-label="L'équipe">
        <OwnerRowView owner={board.owner} />
        {board.members.map((member) => (
          <MemberRowView
            key={member.candidate}
            member={member}
            hours={hoursOf(board, member.role)}
            confirming={confirming === member.candidate}
            onConfirmingChange={onConfirmingChange}
            onChange={onChange}
          />
        ))}
      </ul>
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

/** The hours a week of `role`. */
function hoursOf(board: StaffBoard, role: StaffRoleId): number {
  return board.roles.find((offer) => offer.role === role)?.hoursPerWeek ?? 0
}

/**
 * Today's work as chips, one per task, « Congé » when none, or «
 * Ailleurs » for the owner away all day.
 */
function TaskChips({
  tasks,
  away = false,
}: {
  tasks: readonly Task[]
  away?: boolean
}) {
  const words = away
    ? ['Ailleurs']
    : tasks.length === 0
      ? ['Congé']
      : tasks.map((task) => TASK_NAMES[task])
  const idle = away || tasks.length === 0
  return (
    <ul className="staff__tasks" aria-label="Aujourd'hui">
      {words.map((word) => (
        <li key={word} className={idle ? 'chip chip--off' : 'chip'}>
          {word}
        </li>
      ))}
    </ul>
  )
}

/** A portrait, or a silhouette for someone without one. */
function Portrait({ url }: { url: string | null }) {
  return url === null ? (
    <Silhouette
      className="staff__portrait staff__silhouette"
      size={PORTRAIT_SIZE}
    />
  ) : (
    <img
      className="staff__portrait"
      src={url}
      alt=""
      width={PORTRAIT_SIZE}
      height={PORTRAIT_SIZE}
    />
  )
}

function OwnerRowView({ owner }: { owner: OwnerRow }) {
  return (
    <li>
      <Tooltip content={ownerTip(owner)}>
        {(anchor) => (
          <div className="staff__row" tabIndex={0} {...anchor}>
            <Portrait url={null} />
            <div className="staff__who">
              <h3 className="staff__name">Vous</h3>
              <p className="staff__role">Propriétaire</p>
            </div>
            <TaskChips tasks={owner.tasks} away={owner.away} />
            <p className="staff__pay">
              {formatMoney(owner.weeklyPay)} par semaine
            </p>
          </div>
        )}
      </Tooltip>
    </li>
  )
}

/**
 * An employee's row, the anchor of their tooltip. Someone leaving tomorrow
 * has no control left, so their row takes the focus itself.
 */
function MemberRowView({
  member,
  hours,
  confirming,
  onConfirmingChange,
  onChange,
}: {
  member: MemberRow
  hours: number
  confirming: boolean
  onConfirmingChange: (candidate: CandidateId | null) => void
  onChange: OnChange
}) {
  const { candidate, name, role, roleName, hourlyWage, status } = member
  const statusId = `staff-${candidate}-status`
  const line = memberLine(member)
  const shown = line.fact === null ? undefined : statusId
  const fire = () => {
    onConfirmingChange(null)
    onChange({ kind: 'fire', candidate })
  }
  const portrait = portraitUrl(STAFF.candidates[candidate].portrait)
  return (
    <li>
      <Tooltip content={memberTip(member, hours)}>
        {(anchor, tip) => {
          const described = describedBy(shown, anchor['aria-describedby'])
          return (
            <div
              className="staff__row"
              tabIndex={status === 'leavesTomorrow' ? 0 : undefined}
              {...anchor}
            >
              <Portrait url={portrait} />
              <div className="staff__who">
                <h3 className="staff__name">{name}</h3>
                <p className="staff__role">{roleName}</p>
                <StatusLineView id={statusId} line={line} />
              </div>
              {status !== 'startsTomorrow' && (
                <TaskChips tasks={member.tasks} />
              )}
              {status === 'leavesTomorrow' ? (
                <p className="staff__pay">
                  {formatMoney(hourlyWage)} de l'heure
                </p>
              ) : (
                <NumberField
                  id={`staff-wage-${candidate}`}
                  label="Salaire horaire"
                  unit="$ de l'heure"
                  inputMode="decimal"
                  value={formatAmount(hourlyWage)}
                  read={(text) => wageChange(candidate, role, text, hourlyWage)}
                  onChange={onChange}
                  describedBy={described}
                />
              )}
              <div className="staff__actions">
                {status === 'startsTomorrow' && (
                  <button
                    type="button"
                    className="button"
                    aria-describedby={described}
                    onClick={fire}
                  >
                    Annuler l'embauche · sans frais
                  </button>
                )}
                {status === 'atWork' &&
                  (confirming ? (
                    <ConfirmFire
                      name={name}
                      tip={tip}
                      describedBy={described}
                      onConfirm={fire}
                      onCancel={() => onConfirmingChange(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      className="button"
                      aria-label={`Congédier ${name}`}
                      aria-describedby={described}
                      onClick={() => onConfirmingChange(candidate)}
                    >
                      Congédier
                    </button>
                  ))}
              </div>
            </div>
          )
        }}
      </Tooltip>
    </li>
  )
}

/**
 * « Congédier {name}? » with « Confirmer » and « Annuler ». As it shows,
 * « Confirmer » takes the focus and the row's tooltip opens, with the
 * notice firing costs: through `tip`, since a focus that follows a press
 * does not open it.
 */
function ConfirmFire({
  name,
  tip,
  describedBy: described,
  onConfirm,
  onCancel,
}: {
  name: string
  tip: TipActions
  describedBy: string | undefined
  onConfirm: () => void
  onCancel: () => void
}) {
  const confirm = useRef<HTMLButtonElement>(null)
  const { open } = tip
  useEffect(() => {
    confirm.current?.focus()
    open()
  }, [open])
  return (
    <div className="staff__confirm">
      <p role="alert">Congédier {name}?</p>
      <button
        ref={confirm}
        type="button"
        className="button button--primary"
        aria-describedby={described}
        onClick={onConfirm}
      >
        Confirmer
      </button>{' '}
      <button type="button" className="button" onClick={onCancel}>
        Annuler
      </button>
    </div>
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
  return (
    <li>
      <Tooltip content={roleTip(offer)}>
        {(anchor) => (
          <button
            type="button"
            className="toggle"
            aria-pressed={pressed}
            onClick={onPress}
            {...anchor}
          >
            {offer.name}
          </button>
        )}
      </Tooltip>
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
      />
    </DockPanel>
  )
}
