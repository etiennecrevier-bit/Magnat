import { useEffect, useMemo, useRef, useState } from 'react'
import type { CandidateId, StaffRoleId, TraitId } from '../content/schema.ts'
import type { DecisionChange } from '../engine/decisions.ts'
import { STAFF } from '../engine/staff.ts'
import type { TruckId } from '../engine/types.ts'
import { stepWage, WAGE_STEP_TEXT, wageChange } from './decisionInput.ts'
import { describedBy, type Lock } from './describedBy.ts'
import { STAFF_TABS, type StaffTab } from './dockFrame.ts'
import { DockPanel } from './DockFrame.tsx'
import { useFieldDialog } from './fieldDialog.ts'
import { formatAmount, formatBriefMoney, formatMoney } from './formatMoney.ts'
import { NumberField } from './NumberField.tsx'
import { portraitUrl } from './portraits.ts'
import { StatusLineView, StepButton } from './ProductCard.tsx'
import { Silhouette } from './Silhouette.tsx'
import {
  candidateTip,
  memberLine,
  memberTip,
  ownerTip,
  roleTip,
  staffBoard,
  TASK_NAMES,
  trainingText,
  type CandidateRow,
  type MemberRow,
  type OwnerRow,
  type RoleOffer,
  type StaffBoard,
  type Task,
  type TruckOption,
} from './staffBoard.ts'
import { useGame } from './store.ts'
import type { TipActions } from './Tooltip.tsx'
import Tooltip from './Tooltip.tsx'
import './panel.css'
import './ManagePanel.css'
import './StaffPanel.css'

const FULL_ID = 'staff-full'

/** The size of a portrait on a card, in CSS pixels. */
const PORTRAIT_SIZE = 48

// A no-break space (U+00A0) goes before a colon.
const COLON = '\u00a0:'

/** Nothing locks the wages: no Défi does. */
const UNLOCKED: Lock = { disabled: false, describedBy: undefined }

type OnChange = (change: DecisionChange) => void

interface StaffPanelViewProps {
  board: StaffBoard
  /** The tab shown: the team, or the candidates to hire. */
  tab: StaffTab
  /** The role the player hires for, which `board` was made for. */
  role: StaffRoleId
  onRoleChange: (role: StaffRoleId) => void
  /** The employee whose firing waits for « Confirmer »; null if none. */
  confirming: CandidateId | null
  onConfirmingChange: (candidate: CandidateId | null) => void
  onChange: OnChange
}

/**
 * « Équipe » (#256): on « L'équipe », a card for the owner and for each
 * employee, with what they do today, their wage, what they ask and what
 * the player knows of their strength and weakness; on « Embaucher », the
 * roles, then a card for each candidate. What a card leaves out, such as
 * what a trait does, the training or the notice, is in its tooltip.
 * « Congédier » asks to confirm.
 */
export function StaffPanelView({
  board,
  tab,
  role,
  onRoleChange,
  confirming,
  onConfirmingChange,
  onChange,
}: StaffPanelViewProps) {
  return (
    <div className="panel__content">
      <p className="manage__note">Les changements s'appliquent demain matin</p>
      {tab === 'team' ? (
        <ul className="staff__team" aria-label="L'équipe">
          <OwnerCard
            owner={board.owner}
            trucks={board.trucks}
            unstaffed={board.unstaffed}
            onChange={onChange}
          />
          {board.members.map((member) => (
            <MemberCard
              key={member.candidate}
              member={member}
              trucks={board.trucks}
              hours={hoursOf(board, member.role)}
              confirming={confirming === member.candidate}
              onConfirmingChange={onConfirmingChange}
              onChange={onChange}
            />
          ))}
        </ul>
      ) : (
        <HireTab
          board={board}
          role={role}
          onRoleChange={onRoleChange}
          onChange={onChange}
        />
      )}
    </div>
  )
}

/** The hours a week of `role`. */
function hoursOf(board: StaffBoard, role: StaffRoleId): number {
  return board.roles.find((offer) => offer.role === role)?.hoursPerWeek ?? 0
}

/**
 * Today's work as chips, one per task, « Congé » when none, or «
 * Ailleurs » for the owner away all day. « Absent » is amber, so it shows
 * among the others.
 */
function TaskChips({
  tasks,
  away = false,
}: {
  tasks: readonly Task[]
  away?: boolean
}) {
  const words: { word: string; className: string }[] = away
    ? [{ word: 'Ailleurs', className: 'chip chip--off' }]
    : tasks.length === 0
      ? [{ word: 'Congé', className: 'chip chip--off' }]
      : tasks.map((task) => ({
          word: TASK_NAMES[task],
          className: task === 'absent' ? 'chip chip--weak' : 'chip',
        }))
  return (
    <ul className="staff__tasks" aria-label="Aujourd'hui">
      {words.map(({ word, className }) => (
        <li key={word} className={className}>
          {word}
        </li>
      ))}
    </ul>
  )
}

/**
 * A strength or a weakness as a chip: ▲ and green for the strength, ▼ and
 * amber for the weakness, « ? » dashed for a weakness not known yet. The
 * arrows are hidden from screen readers, which hear « Force » or
 * « Faiblesse » instead.
 */
function TraitChip({
  trait,
  level,
}: {
  trait: TraitId | null
  level: 'strong' | 'weak'
}) {
  const said = level === 'strong' ? 'Force' : 'Faiblesse'
  if (trait === null) {
    return (
      <li className="chip chip--off">
        <span className="visually-hidden">
          {said}
          {COLON} inconnue
        </span>
        <span aria-hidden="true">?</span>
      </li>
    )
  }
  return (
    <li
      className={level === 'strong' ? 'chip chip--strong' : 'chip chip--weak'}
    >
      <span aria-hidden="true">{level === 'strong' ? '▲' : '▼'}</span>
      <span className="visually-hidden">
        {said}
        {COLON}
      </span>{' '}
      {STAFF.traits[trait].name}
    </li>
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

/**
 * « Je travaille au : Plateau / Vieux-Montréal » (#265): one pill per
 * truck, the one worked at pressed, so nobody is at two trucks at once.
 * A press on another sends its change.
 */
function TruckChoice({
  said,
  label,
  trucks,
  at,
  onPick,
}: {
  /** The words before the pills: « Je travaille au ». */
  said: string
  /** What the group is named, for a screen reader. */
  label: string
  trucks: readonly TruckOption[]
  at: TruckId | null
  onPick: (truck: TruckId) => void
}) {
  return (
    <div className="staff__trucks" role="group" aria-label={label}>
      <span className="staff__trucks-label" aria-hidden="true">
        {said}
        {COLON}
      </span>
      {trucks.map(({ id, name }) => (
        <button
          key={id}
          type="button"
          className="toggle"
          aria-pressed={id === at}
          onClick={() => {
            if (id !== at) onPick(id)
          }}
        >
          {name}
        </button>
      ))}
    </div>
  )
}

/**
 * The owner's card, first: their pay stays a decision of « Le camion ».
 * With two trucks or more, where they work, and each truck that closes
 * tomorrow with nobody there.
 */
function OwnerCard({
  owner,
  trucks,
  unstaffed,
  onChange,
}: {
  owner: OwnerRow
  trucks: readonly TruckOption[]
  unstaffed: readonly TruckOption[]
  onChange: OnChange
}) {
  return (
    <li>
      <Tooltip content={ownerTip(owner)}>
        {(anchor) => (
          <div className="staff__card" tabIndex={0} {...anchor}>
            <div className="staff__head">
              <Portrait url={null} />
              <div className="staff__who">
                <h3 className="staff__name">Vous</h3>
                <p className="staff__role">Propriétaire</p>
              </div>
            </div>
            <TaskChips tasks={owner.tasks} away={owner.away} />
            <p className="staff__pay">
              {formatMoney(owner.weeklyPay)} par semaine
            </p>
            {owner.yesterday !== null && (
              <p className="staff__yesterday">{owner.yesterday}</p>
            )}
            {trucks.length > 1 && (
              <TruckChoice
                said="Je travaille au"
                label="Je travaille au"
                trucks={trucks}
                at={owner.at}
                onPick={(truck) => onChange({ kind: 'ownerAt', truck })}
              />
            )}
            {unstaffed.map(({ id, name }) => (
              <p key={id} className="staff__unstaffed">
                <span aria-hidden="true">⚠︎ </span>
                {name} fermé demain{COLON} personne au camion
              </p>
            ))}
          </div>
        )}
      </Tooltip>
    </li>
  )
}

/**
 * An employee's card, the anchor of their tooltip. Someone leaving
 * tomorrow, or gone this morning, has no control left, so their card
 * takes the focus itself.
 */
function MemberCard({
  member,
  trucks,
  hours,
  confirming,
  onConfirmingChange,
  onChange,
}: {
  member: MemberRow
  /** The trucks to work at, with two or more. */
  trucks: readonly TruckOption[]
  hours: number
  confirming: boolean
  onConfirmingChange: (candidate: CandidateId | null) => void
  onChange: OnChange
}) {
  const { candidate, name, role, roleName, hourlyWage, askingWage, status } =
    member
  const statusId = `staff-${candidate}-status`
  const askingId = `staff-${candidate}-asking`
  const line = memberLine(member)
  const shown = line.fact === null ? undefined : statusId
  const fire = () => {
    onConfirmingChange(null)
    onChange({ kind: 'fire', candidate })
  }
  const settled = status === 'leavesTomorrow' || status === 'quitsToday'
  const under = hourlyWage < askingWage
  const step = (direction: 1 | -1, text: string, verb: string) => {
    const next = stepWage(role, hourlyWage, direction)
    return (
      <StepButton
        label={`${name}${COLON} ${verb} le salaire de ${WAGE_STEP_TEXT}`}
        text={text}
        change={
          next === null
            ? null
            : { kind: 'setWage', candidate, hourlyWage: next }
        }
        lock={UNLOCKED}
        describedBy={describedBy(shown, askingId)}
        onChange={onChange}
      />
    )
  }
  return (
    <li>
      <Tooltip content={memberTip(member, hours)}>
        {(anchor, tip) => {
          const described = describedBy(shown, anchor['aria-describedby'])
          return (
            <div
              className="staff__card"
              tabIndex={settled ? 0 : undefined}
              {...anchor}
            >
              <div className="staff__head">
                <Portrait url={portraitUrl(member.portrait)} />
                <div className="staff__who">
                  <h3 className="staff__name">{name}</h3>
                  <p className="staff__role">{roleName}</p>
                  <StatusLineView id={statusId} line={line} />
                </div>
              </div>
              {status !== 'startsTomorrow' && status !== 'quitsToday' && (
                <TaskChips tasks={member.tasks} />
              )}
              {settled ? (
                <p className="staff__pay">
                  {formatMoney(hourlyWage)} de l'heure
                </p>
              ) : (
                <div className="staff__wage">
                  <NumberField
                    id={`staff-wage-${candidate}`}
                    label="Salaire horaire"
                    unit="$ de l'heure"
                    inputMode="decimal"
                    value={formatAmount(hourlyWage)}
                    read={(text) =>
                      wageChange(candidate, role, text, hourlyWage)
                    }
                    onChange={onChange}
                    describedBy={describedBy(askingId, described)}
                    before={step(-1, '−', 'baisser')}
                    after={step(1, '+', 'augmenter')}
                  />
                  <p
                    id={askingId}
                    className={
                      under
                        ? 'staff__asking staff__asking--under'
                        : 'staff__asking'
                    }
                  >
                    {under && <span aria-hidden="true">⚠︎ </span>}
                    demande {formatBriefMoney(askingWage)}
                  </p>
                </div>
              )}
              <ul className="staff__traits" aria-label="Force et faiblesse">
                <TraitChip trait={member.strength} level="strong" />
                <TraitChip trait={member.weakness} level="weak" />
              </ul>
              {member.yesterday !== null && (
                <p className="staff__yesterday">{member.yesterday}</p>
              )}
              {trucks.length > 1 && member.truck !== null && !settled && (
                <TruckChoice
                  said="Travaille au"
                  label={`${name} travaille au`}
                  trucks={trucks}
                  at={member.truck}
                  onPick={(truck) =>
                    onChange({ kind: 'assign', candidate, truck })
                  }
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
 * « Confirmer » takes the focus and the card's tooltip opens, with the
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

/**
 * « Embaucher »: the roles as pills, then a card for each candidate, for
 * the role picked, three to a row.
 */
function HireTab({
  board,
  role,
  onRoleChange,
  onChange,
}: {
  board: StaffBoard
  role: StaffRoleId
  onRoleChange: (role: StaffRoleId) => void
  onChange: OnChange
}) {
  const offer = board.roles.find((option) => option.role === role)
  return (
    <>
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
      {board.full && (
        <p id={FULL_ID} className="staff__full">
          L'équipe est complète.
        </p>
      )}
      {board.candidates.length === 0 ? (
        <p>Personne d'autre à embaucher.</p>
      ) : (
        <ul className="staff__candidates" aria-label="Candidats">
          {board.candidates.map((row) => (
            <CandidateCard
              key={row.candidate}
              row={row}
              role={role}
              roleName={offer?.name ?? ''}
              full={board.full}
              onChange={onChange}
            />
          ))}
        </ul>
      )}
    </>
  )
}

/**
 * A candidate's card, the anchor of their tooltip: their face, their
 * name, their strength, a weakness not known yet, what they ask, their
 * training and « Embaucher », which hires them at what they ask. With the
 * team full, the card takes the focus itself, its button disabled.
 */
function CandidateCard({
  row,
  role,
  roleName,
  full,
  onChange,
}: {
  row: CandidateRow
  role: StaffRoleId
  roleName: string
  full: boolean
  onChange: OnChange
}) {
  const { candidate, name, askingWage } = row
  return (
    <li>
      <Tooltip content={candidateTip(row, role)}>
        {(anchor) => (
          <div
            className="staff__card staff__card--candidate"
            tabIndex={full ? 0 : undefined}
            {...anchor}
          >
            <div className="staff__head">
              <Portrait url={portraitUrl(row.portrait)} />
              <div className="staff__who">
                <h3 className="staff__name">{name}</h3>
              </div>
            </div>
            <ul className="staff__traits" aria-label="Force et faiblesse">
              <TraitChip trait={row.strength} level="strong" />
              <li className="chip chip--off">Faiblesse{COLON} ?</li>
            </ul>
            <p className="staff__fact">
              Demande {formatBriefMoney(askingWage)} de l'heure
            </p>
            <p className="staff__fact">
              Formation{COLON} {trainingText()}
            </p>
            <button
              type="button"
              className="button staff__hire"
              aria-label={`Embaucher ${name}${roleName === '' ? '' : `, ${roleName}`}`}
              disabled={full}
              aria-describedby={full ? FULL_ID : undefined}
              onClick={() =>
                onChange({
                  kind: 'hire',
                  role,
                  candidate,
                  hourlyWage: askingWage,
                })
              }
            >
              Embaucher
            </button>
          </div>
        )}
      </Tooltip>
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
 * modal dialog (see `useFieldDialog`), with its tabs « L'équipe » and
 * « Embaucher », opening on the team. The tab, the role picked and the
 * firing to confirm are kept while it is open; a field holding invalid
 * text keeps its tab shown.
 */
export default function StaffPanel() {
  const game = useGame((state) => state.game)
  const decide = useGame((state) => state.decide)
  const closePanel = useGame((state) => state.closePanel)
  const [tab, setTab] = useState<StaffTab>('team')
  const [role, setRole] = useState<StaffRoleId>('camion')
  const board = useMemo(() => staffBoard(game, role), [game, role])
  const [confirming, setConfirming] = useState<CandidateId | null>(null)
  const { dialogRef, onChange, settle, close, onCancel } =
    useFieldDialog(decide)

  return (
    <DockPanel
      dialogRef={dialogRef}
      className="staff"
      title="Équipe"
      tabs={STAFF_TABS}
      tab={tab}
      onTab={(next) => {
        if (!settle()) return false
        setConfirming(null)
        setTab(next)
      }}
      onCancel={onCancel}
      onClose={closePanel}
      onDismiss={close}
    >
      <StaffPanelView
        board={board}
        tab={tab}
        role={role}
        onRoleChange={setRole}
        confirming={confirming}
        onConfirmingChange={setConfirming}
        onChange={onChange}
      />
    </DockPanel>
  )
}
