import { useMemo, useState } from 'react'
import { decisionKindSchema, type DecisionKind } from '../content/schema.ts'
import { isLocked } from '../engine/challenge.ts'
import { CUSTOMERS, DEFIS, FOOD_TRUCK } from '../engine/day.ts'
import { latestDecisions, type DecisionChange } from '../engine/decisions.ts'
import { dreamBonuses, dreamLimits } from '../engine/dream.ts'
import { PRODUCTS } from '../engine/inventory.ts'
import type { DaySummary, Decisions, GameState } from '../engine/types.ts'
import { bakeryBoard, type BakeryBoard } from './bakeryBoard.ts'
import { BakerySection } from './BakerySection.tsx'
import {
  PRICE_STEP_TEXT,
  RESTOCK_LABELS,
  daysOpenChange,
  marketingChange,
  ownerPayChange,
  priceChange,
  restockChange,
  restockFields,
  stepPrice,
} from './decisionInput.ts'
import { lockReason } from './defis.ts'
import { useFieldDialog } from './fieldDialog.ts'
import { formatAmount } from './formatMoney.ts'
import { NumberField } from './NumberField.tsx'
import { segmentFacts, type SegmentFacts } from './segmentFacts.ts'
import { useGame } from './store.ts'
import './panel.css'
import './ManagePanel.css'

const TITLE_ID = 'manage-title'

// ISO 8601 weekdays, 1 = Monday to 7 = Sunday; calendar facts.
const WEEKDAYS = [
  { weekday: 1, short: 'lun.', name: 'lundi' },
  { weekday: 2, short: 'mar.', name: 'mardi' },
  { weekday: 3, short: 'mer.', name: 'mercredi' },
  { weekday: 4, short: 'jeu.', name: 'jeudi' },
  { weekday: 5, short: 'ven.', name: 'vendredi' },
  { weekday: 6, short: 'sam.', name: 'samedi' },
  { weekday: 7, short: 'dim.', name: 'dimanche' },
] as const

type OnChange = (change: DecisionChange) => void

/** The id of the line saying why the decisions of `kind` are locked. */
function lockId(kind: DecisionKind): string {
  return `manage-locked-${kind}`
}

/**
 * Why the section's decisions cannot change, under its title, when the
 * Défi locks them; nothing otherwise. The section's controls point to it.
 */
function LockNote({ kind, locked }: { kind: DecisionKind; locked: boolean }) {
  if (!locked) return null
  return (
    <p id={lockId(kind)} className="manage__locked">
      {lockReason(kind)}
    </p>
  )
}

/** What a locked section's controls get: disabled, and why. */
function lockProps(kind: DecisionKind, locked: boolean) {
  return locked
    ? { disabled: true, describedBy: lockId(kind) }
    : { disabled: false, describedBy: undefined }
}

interface ManagePanelViewProps {
  /** The decisions as the player last left them. */
  decisions: Decisions
  lastDay: DaySummary | null
  /** The kinds of decision the Défi played locks; none outside a Défi. */
  locked: readonly DecisionKind[]
  /** The « Fournil » section. */
  bakery: BakeryBoard
  /**
   * The units a restock rule may name: the content's, unless the rungs of
   * « Le rêve » owned allow more.
   */
  units?: { readonly min: number; readonly max: number }
  onChange: OnChange
  onClose: () => void
}

/**
 * What the player runs the truck with: prices, orders, days open, their pay
 * and marketing, beside yesterday's facts by segment, then the bakery. The
 * decisions a Défi locks are disabled, with the reason under their
 * section's title.
 */
export function ManagePanelView({
  decisions,
  lastDay,
  locked,
  bakery,
  units = FOOD_TRUCK.decisionLimits.units,
  onChange,
  onClose,
}: ManagePanelViewProps) {
  const payLocked = locked.includes('ownerWeeklyPay')
  const marketingLocked = locked.includes('marketingDaily')
  return (
    <div className="panel__content">
      {/* Fermer comes first so it has the focus when the panel opens. */}
      <div className="panel__header">
        <button type="button" className="toggle" onClick={onClose}>
          Fermer
        </button>
        <h2 id={TITLE_ID}>Gérer le camion</h2>
      </div>
      <p className="manage__note">Les changements s'appliquent demain matin</p>
      <div className="manage__sections">
        <PricesSection
          prices={decisions.prices}
          locked={locked.includes('price')}
          onChange={onChange}
        />
        <OrdersSection
          restock={decisions.restock}
          locked={locked.includes('restock')}
          units={units}
          onChange={onChange}
        />
        <FactsSection lastDay={lastDay} />
        <DaysOpenSection
          daysOpen={decisions.daysOpen}
          locked={locked.includes('daysOpen')}
          onChange={onChange}
        />
        <section className="manage__pay" aria-labelledby="manage-pay">
          <h3 id="manage-pay">Votre salaire</h3>
          <LockNote kind="ownerWeeklyPay" locked={payLocked} />
          <NumberField
            {...lockProps('ownerWeeklyPay', payLocked)}
            id="manage-pay-weekly"
            label="Salaire hebdomadaire"
            unit="$ par semaine"
            inputMode="decimal"
            value={formatAmount(decisions.ownerWeeklyPay)}
            read={(text) => ownerPayChange(text, decisions.ownerWeeklyPay)}
            onChange={onChange}
          />
        </section>
        <section
          className="manage__marketing"
          aria-labelledby="manage-marketing"
        >
          <h3 id="manage-marketing">Marketing</h3>
          <LockNote kind="marketingDaily" locked={marketingLocked} />
          <NumberField
            {...lockProps('marketingDaily', marketingLocked)}
            id="manage-marketing-daily"
            label="Budget quotidien"
            unit="$ par jour"
            inputMode="decimal"
            value={formatAmount(decisions.marketingDaily)}
            read={(text) => marketingChange(text, decisions.marketingDaily)}
            onChange={onChange}
          />
        </section>
        <BakerySection board={bakery} onChange={onChange} />
      </div>
    </div>
  )
}

function PricesSection({
  prices,
  locked,
  onChange,
}: {
  prices: Decisions['prices']
  locked: boolean
  onChange: OnChange
}) {
  const lock = lockProps('price', locked)
  return (
    <section className="manage__prices" aria-labelledby="manage-prices">
      <h3 id="manage-prices">Prix</h3>
      <LockNote kind="price" locked={locked} />
      {PRODUCTS.map((product) => {
        const { name } = FOOD_TRUCK.products[product]
        const price = prices[product]
        // aria-disabled rather than disabled, so a stepper that reaches a
        // limit keeps the focus. A locked one never had it.
        const stepper = (direction: 1 | -1, text: string, label: string) => {
          const next = stepPrice(price, direction)
          return (
            <button
              type="button"
              className="toggle manage__step"
              aria-label={`${name}\u00a0: ${label} le prix de ${PRICE_STEP_TEXT}`}
              disabled={lock.disabled}
              aria-describedby={lock.describedBy}
              aria-disabled={next === null}
              onClick={() => {
                if (next !== null)
                  onChange({ kind: 'price', product, price: next })
              }}
            >
              {text}
            </button>
          )
        }
        return (
          <NumberField
            key={product}
            id={`manage-price-${product}`}
            label={name}
            unit="$"
            inputMode="decimal"
            value={formatAmount(price)}
            read={(text) => priceChange(product, text, price)}
            onChange={onChange}
            {...lock}
            before={stepper(-1, '−', 'baisser')}
            after={stepper(1, '+', 'augmenter')}
          />
        )
      })}
    </section>
  )
}

function OrdersSection({
  restock,
  locked,
  units: limits,
  onChange,
}: {
  restock: Decisions['restock']
  locked: boolean
  units: { readonly min: number; readonly max: number }
  onChange: OnChange
}) {
  return (
    <section className="manage__orders" aria-labelledby="manage-orders">
      <h3 id="manage-orders">Commandes</h3>
      <LockNote kind="restock" locked={locked} />
      {PRODUCTS.map((product) => {
        const rule = restock[product]
        return (
          <fieldset key={product} className="manage__rule">
            <legend>{FOOD_TRUCK.products[product].name}</legend>
            {restockFields(rule).map(({ field, units }) => (
              <NumberField
                key={field}
                id={`manage-restock-${product}-${field}`}
                label={RESTOCK_LABELS[field]}
                unit="unités"
                inputMode="numeric"
                value={String(units)}
                read={(text) =>
                  restockChange(product, field, text, rule, limits)
                }
                onChange={onChange}
                {...lockProps('restock', locked)}
              />
            ))}
          </fieldset>
        )
      })}
    </section>
  )
}

function FactsSection({ lastDay }: { lastDay: DaySummary | null }) {
  return (
    <section className="manage__facts" aria-labelledby="manage-facts">
      <h3 id="manage-facts">Hier, par segment</h3>
      {lastDay === null ? (
        <p>Aucune journée terminée pour l'instant.</p>
      ) : (
        <FactsTable lastDay={lastDay} />
      )}
    </section>
  )
}

const NO_SALE_COLUMNS = 2

function FactsTable({ lastDay }: { lastDay: DaySummary }) {
  const { segments, total } = segmentFacts(lastDay)
  return (
    // Focusable, so a keyboard can scroll the table on a narrow screen.
    <div
      className="manage__scroll"
      role="region"
      aria-labelledby="manage-facts"
      tabIndex={0}
    >
      <table className="data-table">
        <colgroup>
          <col />
        </colgroup>
        <colgroup span={PRODUCTS.length} />
        <colgroup span={NO_SALE_COLUMNS} />
        <thead>
          <tr>
            <th scope="col" rowSpan={2}>
              Segment
            </th>
            <th scope="colgroup" colSpan={PRODUCTS.length}>
              Unités vendues
            </th>
            <th scope="colgroup" colSpan={NO_SALE_COLUMNS}>
              Clients sans achat
            </th>
          </tr>
          <tr>
            {PRODUCTS.map((product) => (
              <th key={product} scope="col" className="number">
                {FOOD_TRUCK.products[product].name}
              </th>
            ))}
            <th scope="col" className="number">
              Trop cher
            </th>
            <th scope="col" className="number">
              Rupture de stock
            </th>
          </tr>
        </thead>
        <tbody>
          {segments.map(({ segment, facts }) => (
            <FactsRow
              key={segment}
              label={CUSTOMERS.segments[segment].name}
              facts={facts}
            />
          ))}
        </tbody>
        <tfoot>
          <FactsRow label="Total" facts={total} />
        </tfoot>
      </table>
    </div>
  )
}

function FactsRow({ label, facts }: { label: string; facts: SegmentFacts }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      {PRODUCTS.map((product) => (
        <td key={product} className="number">
          {facts.sold[product]}
        </td>
      ))}
      <td className="number">{facts.tooExpensive}</td>
      <td className="number">{facts.soldOut}</td>
    </tr>
  )
}

function DaysOpenSection({
  daysOpen,
  locked,
  onChange,
}: {
  daysOpen: readonly number[]
  locked: boolean
  onChange: OnChange
}) {
  const [error, setError] = useState<string | null>(null)
  const lock = lockProps('daysOpen', locked)
  return (
    <section className="manage__days" aria-labelledby="manage-days">
      <h3 id="manage-days">Horaire</h3>
      <LockNote kind="daysOpen" locked={locked} />
      <div
        className="toggle-group"
        role="group"
        aria-label="Jours d'ouverture"
        aria-describedby={error === null ? undefined : 'manage-days-error'}
      >
        {WEEKDAYS.map(({ weekday, short, name }) => (
          <button
            key={weekday}
            type="button"
            className="toggle"
            aria-label={name}
            aria-pressed={daysOpen.includes(weekday)}
            disabled={lock.disabled}
            aria-describedby={lock.describedBy}
            onClick={() => {
              const result = daysOpenChange(weekday, daysOpen)
              if (result.kind === 'invalid') {
                setError(result.message)
                return
              }
              setError(null)
              if (result.kind === 'change') onChange(result.change)
            }}
          >
            {short}
          </button>
        ))}
      </div>
      {error !== null && (
        <p id="manage-days-error" className="field__error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

/** The kinds of decision the Défi `game` plays locks; none outside one. */
function lockedKinds(game: GameState): DecisionKind[] {
  return decisionKindSchema.options.filter((kind) =>
    isLocked(game, kind, DEFIS),
  )
}

/**
 * The panel wired to the app store, in a modal dialog (see
 * `useFieldDialog`): the page behind it is out of reach and Escape closes
 * it. Fermer keeps what was typed, after any invalid text is fixed; Escape
 * drops what is still being typed. The changes already made stay either
 * way.
 */
export default function ManagePanel() {
  const decisions = useGame((state) => latestDecisions(state.game))
  const game = useGame((state) => state.game)
  const lastDay = useGame((state) => state.game.lastDay)
  const bakery = useMemo(() => bakeryBoard(game), [game])
  const dream = useGame((state) => state.game.dream)
  const units = useMemo(
    () => dreamLimits(FOOD_TRUCK.decisionLimits, dreamBonuses(dream)).units,
    [dream],
  )
  const decide = useGame((state) => state.decide)
  const closePanel = useGame((state) => state.closePanel)
  const { dialogRef, onChange, close, onCancel } = useFieldDialog(decide)

  return (
    <dialog
      ref={dialogRef}
      className="panel manage"
      aria-labelledby={TITLE_ID}
      onCancel={onCancel}
      onClose={closePanel}
    >
      <ManagePanelView
        decisions={decisions}
        lastDay={lastDay}
        locked={lockedKinds(game)}
        bakery={bakery}
        units={units}
        onChange={onChange}
        onClose={close}
      />
    </dialog>
  )
}
