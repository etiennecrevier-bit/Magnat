import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { CUSTOMERS, FOOD_TRUCK } from '../engine/day.ts'
import { latestDecisions, type DecisionChange } from '../engine/decisions.ts'
import { PRODUCTS } from '../engine/inventory.ts'
import type { DaySummary, Decisions } from '../engine/types.ts'
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
import { formatAmount } from './formatMoney.ts'
import { NumberField } from './NumberField.tsx'
import { segmentFacts, type SegmentFacts } from './segmentFacts.ts'
import { useGame } from './store.ts'
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

interface ManagePanelViewProps {
  /** The decisions as the player last left them. */
  decisions: Decisions
  lastDay: DaySummary | null
  onChange: OnChange
  onClose: () => void
}

/**
 * What the player runs the truck with: prices, orders, days open, their pay
 * and marketing, beside yesterday's facts by segment.
 */
export function ManagePanelView({
  decisions,
  lastDay,
  onChange,
  onClose,
}: ManagePanelViewProps) {
  return (
    <div className="manage__content">
      {/* Fermer comes first so it has the focus when the panel opens. */}
      <div className="manage__header">
        <button type="button" className="toggle" onClick={onClose}>
          Fermer
        </button>
        <h2 id={TITLE_ID}>Gérer le camion</h2>
      </div>
      <p className="manage__note">Les changements s'appliquent demain matin</p>
      <div className="manage__sections">
        <PricesSection prices={decisions.prices} onChange={onChange} />
        <OrdersSection restock={decisions.restock} onChange={onChange} />
        <FactsSection lastDay={lastDay} />
        <DaysOpenSection daysOpen={decisions.daysOpen} onChange={onChange} />
        <section className="manage__pay" aria-labelledby="manage-pay">
          <h3 id="manage-pay">Votre salaire</h3>
          <NumberField
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
          <NumberField
            id="manage-marketing-daily"
            label="Budget quotidien"
            unit="$ par jour"
            inputMode="decimal"
            value={formatAmount(decisions.marketingDaily)}
            read={(text) => marketingChange(text, decisions.marketingDaily)}
            onChange={onChange}
          />
        </section>
      </div>
    </div>
  )
}

function PricesSection({
  prices,
  onChange,
}: {
  prices: Decisions['prices']
  onChange: OnChange
}) {
  return (
    <section className="manage__prices" aria-labelledby="manage-prices">
      <h3 id="manage-prices">Prix</h3>
      {PRODUCTS.map((product) => {
        const { name } = FOOD_TRUCK.products[product]
        const price = prices[product]
        // aria-disabled rather than disabled, so a stepper that reaches a
        // limit keeps the focus.
        const stepper = (direction: 1 | -1, text: string, label: string) => {
          const next = stepPrice(price, direction)
          return (
            <button
              type="button"
              className="toggle manage__step"
              aria-label={`${name}\u00a0: ${label} le prix de ${PRICE_STEP_TEXT}`}
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
  onChange,
}: {
  restock: Decisions['restock']
  onChange: OnChange
}) {
  return (
    <section className="manage__orders" aria-labelledby="manage-orders">
      <h3 id="manage-orders">Commandes</h3>
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
                read={(text) => restockChange(product, field, text, rule)}
                onChange={onChange}
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
  onChange,
}: {
  daysOpen: readonly number[]
  onChange: OnChange
}) {
  const [error, setError] = useState<string | null>(null)
  return (
    <section className="manage__days" aria-labelledby="manage-days">
      <h3 id="manage-days">Horaire</h3>
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

/**
 * The panel wired to the app store, in a modal dialog: the page behind it
 * is out of reach and Escape closes it. Fermer keeps what was typed, after
 * any invalid text is fixed; Escape drops what is still being typed. The
 * changes already made stay either way.
 */
export default function ManagePanel() {
  const decisions = useGame((state) => latestDecisions(state.game))
  const lastDay = useGame((state) => state.game.lastDay)
  const decide = useGame((state) => state.decide)
  const closePanel = useGame((state) => state.closePanel)
  const dialogRef = useRef<HTMLDialogElement>(null)
  // Set as Escape starts closing the dialog. The browser then moves the
  // focus back to the opener, and the field losing it would commit its
  // draft before React re-renders, so this is a ref, read at once.
  const cancelled = useRef(false)

  useEffect(() => {
    const dialog = dialogRef.current
    // StrictMode runs this twice; the second time, the dialog is open.
    if (dialog !== null && !dialog.open) dialog.showModal()
  }, [])

  const onChange = (change: DecisionChange) => {
    if (!cancelled.current) decide(change)
  }

  const close = () => {
    const dialog = dialogRef.current
    if (dialog === null) return
    // The field being typed in commits as it loses the focus, and shows its
    // message now if its text is invalid. Any such field keeps the panel
    // open and gets the focus back.
    const active = document.activeElement
    if (active instanceof HTMLElement && dialog.contains(active)) {
      flushSync(() => active.blur())
    }
    const invalid = dialog.querySelector<HTMLElement>('[aria-invalid="true"]')
    if (invalid !== null) {
      invalid.focus()
      return
    }
    dialog.close()
  }

  return (
    <dialog
      ref={dialogRef}
      className="manage"
      aria-labelledby={TITLE_ID}
      onCancel={() => {
        cancelled.current = true
      }}
      onClose={closePanel}
    >
      <ManagePanelView
        decisions={decisions}
        lastDay={lastDay}
        onChange={onChange}
        onClose={close}
      />
    </dialog>
  )
}
