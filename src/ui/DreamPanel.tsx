import { useEffect, useMemo, useRef, useState } from 'react'
import type { Ladder, RungId } from '../content/schema.ts'
import type { DecisionChange } from '../engine/decisions.ts'
import type { Cents } from '../engine/money.ts'
import {
  dreamBoard,
  factLine,
  priceLine,
  rungTip,
  type DreamBoard,
  type LadderRow,
  type RungRow,
  type TitleRow,
} from './dreamBoard.ts'
import { DockPanel } from './DockFrame.tsx'
import { DREAM_TABS } from './dockFrame.ts'
import { useFieldDialog } from './fieldDialog.ts'
import { formatWholeMoney } from './formatMoney.ts'
import { Icon } from './icons.tsx'
import { useGame } from './store.ts'
import Tooltip from './Tooltip.tsx'
import { upgradeArtUrl } from './upgradeArt.ts'
import './panel.css'
import './DreamPanel.css'

// French puts a no-break space (U+00A0) before a colon.
const COLON = ' :'

interface DreamPanelViewProps {
  board: DreamBoard
  /** The ladder the tab shows. */
  ladder: Ladder
  /** The rung whose purchase waits for « Confirmer »; null if none. */
  confirming: RungId | null
  onConfirmingChange: (rung: RungId | null) => void
  onChange: (change: DecisionChange) => void
}

/**
 * « Améliorations »: a dark ribbon with the owner's title and how close the
 * next one is, then the rungs of one ladder as cards, each with its
 * picture, price, bonus and where it stands. « Acheter » asks to confirm,
 * with the price, who pays and what the rung gives; a card's tooltip tells
 * the same, and what is missing. It explains nothing.
 */
export function DreamPanelView({
  board,
  ladder,
  confirming,
  onConfirmingChange,
  onChange,
}: DreamPanelViewProps) {
  const row = ladder === 'personal' ? board.personal : board.company
  return (
    <div className="dream__board">
      <Ribbon titles={board.titles} netWorth={board.netWorth} />
      <ol className="dream__cards">
        {row.rungs.map((rung) => (
          <UpgradeCard
            key={rung.id}
            row={row}
            rung={rung}
            confirming={confirming === rung.id}
            onConfirmingChange={onConfirmingChange}
            onChange={onChange}
          />
        ))}
      </ol>
    </div>
  )
}

/** A bar from 0 to 1 that reads out `text`. */
function Progress({
  className,
  label,
  share,
  text,
}: {
  className: string
  label: string
  share: number
  text: string
}) {
  return (
    <span
      className={className}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
      aria-valuetext={text}
    >
      <span className="dream__fill" style={{ width: `${share * 100}%` }} />
    </span>
  )
}

/**
 * The owner's title, if any, and the next one with a bar and the net worth
 * over what it needs; the last title alone.
 */
function Ribbon({ titles, netWorth }: { titles: TitleRow; netWorth: Cents }) {
  const { title, next } = titles
  const worth =
    next === null
      ? null
      : `${formatWholeMoney(netWorth)} / ${formatWholeMoney(next.netWorth)}`
  return (
    <section className="dream__ribbon" aria-label="Titre">
      <Icon name="ameliorations" size={22} />
      <p className="dream__title">
        {next === null
          ? title
          : `${title === null ? '' : `${title} · `}Prochain titre${COLON} ${next.name}`}
      </p>
      {next !== null && worth !== null && (
        <>
          <Progress
            className="dream__ribbon-bar"
            label={`Vers ${next.name}`}
            share={next.progress}
            text={worth}
          />
          <p className="dream__worth">{worth}</p>
        </>
      )}
    </section>
  )
}

/** The cash a rung needs on hand, and the cash there is. */
function cashText(cash: Cents, needed: Cents): string {
  return `${formatWholeMoney(needed)} requis · ${formatWholeMoney(cash)} disponibles`
}

/**
 * A rung's card, the anchor of its tooltip: its picture, a padlock while it
 * waits for an earlier rung, its name and price, its bonus, then a foot
 * that says where it stands. Only the next rung has a control: « Acheter »
 * when its cash is there, a bar toward it when not.
 */
function UpgradeCard({
  row,
  rung,
  confirming,
  onConfirmingChange,
  onChange,
}: {
  row: LadderRow
  rung: RungRow
  confirming: boolean
  onConfirmingChange: (rung: RungId | null) => void
  onChange: (change: DecisionChange) => void
}) {
  const { id, name, price, status, buyable, chip } = rung
  const art = upgradeArtUrl(id)
  const locked = status === 'locked' || status === 'comingSoon'
  const controls = status === 'next' && (buyable || confirming)
  return (
    <li className={`dream__card dream__card--${status}`}>
      <Tooltip content={rungTip(row, rung)}>
        {(anchor) => (
          // A card with no button takes the focus itself, for its tooltip.
          <div
            className="dream__anchor"
            tabIndex={controls ? undefined : 0}
            {...anchor}
          >
            <div className="dream__art">
              {art !== null && (
                <img src={art} alt="" width={300} height={150} />
              )}
              {locked && (
                <span className="dream__lock">
                  <Icon name="cadenas" size={18} />
                </span>
              )}
            </div>
            <div className="dream__text">
              <div className="dream__head">
                <h3>{name}</h3>
                <p className="dream__price">{formatWholeMoney(price)}</p>
              </div>
              {chip !== null && <p className="dream__chip">{chip}</p>}
              <div className="dream__foot">
                <Foot
                  row={row}
                  rung={rung}
                  confirming={confirming}
                  describedBy={anchor['aria-describedby']}
                  onConfirmingChange={onConfirmingChange}
                  onChange={onChange}
                />
              </div>
            </div>
          </div>
        )}
      </Tooltip>
    </li>
  )
}

/** Where a rung stands, at the foot of its card. */
function Foot({
  row,
  rung,
  confirming,
  describedBy,
  onConfirmingChange,
  onChange,
}: {
  row: LadderRow
  rung: RungRow
  confirming: boolean
  /** The tooltip of the card, which its buttons are described by. */
  describedBy: string
  onConfirmingChange: (rung: RungId | null) => void
  onChange: (change: DecisionChange) => void
}) {
  const { id, name, status, buyable, facts, books, after } = rung
  switch (status) {
    case 'owned':
      return <Status tone="owned" text="Acquis" />
    case 'sold':
      return <Status tone="sold" text="Revendu" />
    case 'locked':
      return after === null ? null : (
        <p className="dream__note">
          Après{COLON} {after}
        </p>
      )
    case 'comingSoon':
      return <p className="dream__note">Bientôt</p>
    case 'next':
      break
  }
  if (confirming) {
    return (
      <ConfirmBuy
        question={`Acheter ${name}? ${priceLine(row, rung)}`}
        lines={[...facts, ...books].map(factLine)}
        describedBy={describedBy}
        onConfirm={() => {
          onConfirmingChange(null)
          onChange({ kind: 'buy', rung: id })
        }}
        onCancel={() => onConfirmingChange(null)}
      />
    )
  }
  if (buyable) {
    return (
      <button
        type="button"
        className="button dream__buy"
        aria-label={`Acheter ${name}`}
        aria-describedby={describedBy}
        onClick={() => onConfirmingChange(id)}
      >
        Acheter
      </button>
    )
  }
  const { cash, needed, progress } = row
  if (needed === null || progress === null) return null
  return (
    <div className="dream__progress">
      <Progress
        className="dream__bar"
        label={`Vers ${name}`}
        share={progress}
        text={cashText(cash, needed)}
      />
      <p className="dream__note">{cashText(cash, needed)}</p>
    </div>
  )
}

/**
 * The purchase to confirm, in place of « Acheter »: the price, who pays
 * and what the rung gives, then « Confirmer », which takes the focus as
 * « Acheter » goes, and « Annuler ».
 */
function ConfirmBuy({
  question,
  lines,
  describedBy,
  onConfirm,
  onCancel,
}: {
  question: string
  lines: readonly string[]
  describedBy: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const confirm = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    confirm.current?.focus()
  }, [])
  return (
    <div className="dream__confirm">
      <p role="alert">{question}</p>
      {lines.length > 0 && (
        <ul className="dream__facts">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <button
        ref={confirm}
        type="button"
        className="button dream__buy"
        aria-describedby={describedBy}
        onClick={onConfirm}
      >
        Confirmer
      </button>{' '}
      <button
        type="button"
        className="button"
        aria-describedby={describedBy}
        onClick={onCancel}
      >
        Annuler
      </button>
    </div>
  )
}

/** A dot and a word: « Acquis » in green, « Revendu » muted. */
function Status({ tone, text }: { tone: 'owned' | 'sold'; text: string }) {
  return (
    <p className={`dream__status dream__status--${tone}`}>
      <span className="dream__dot" aria-hidden="true" />
      {text}
    </p>
  )
}

/**
 * « Améliorations », the panel wired to the app store, in the dock's frame,
 * a modal dialog (see `useFieldDialog`), with the ladder its tab shows kept
 * in the store and the purchase to confirm kept while it is open. A
 * purchase made shows at once: it does not wait for the next morning.
 */
export default function DreamPanel() {
  const game = useGame((state) => state.game)
  const decide = useGame((state) => state.decide)
  const closePanel = useGame((state) => state.closePanel)
  const ladder = useGame((state) => state.dreamTab)
  const setLadder = useGame((state) => state.setDreamTab)
  const board = useMemo(() => dreamBoard(game), [game])
  const [confirming, setConfirming] = useState<RungId | null>(null)
  const { dialogRef, onChange, close, onCancel } = useFieldDialog(decide)

  return (
    <DockPanel
      dialogRef={dialogRef}
      className="dream"
      title="Améliorations"
      tabs={DREAM_TABS}
      tab={ladder}
      onTab={(tab) => {
        setConfirming(null)
        setLadder(tab)
      }}
      onCancel={onCancel}
      onClose={closePanel}
      onDismiss={close}
    >
      <DreamPanelView
        board={board}
        ladder={ladder}
        confirming={confirming}
        onConfirmingChange={setConfirming}
        onChange={onChange}
      />
    </DockPanel>
  )
}
