import type { ProductId } from '../content/schema.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import type { DecisionChange } from '../engine/decisions.ts'
import type { Cents } from '../engine/money.ts'
import { PRICE_STEP_TEXT, priceChange, stepPrice } from './decisionInput.ts'
import { describedBy, type Lock } from './describedBy.ts'
import { formatAmount } from './formatMoney.ts'
import { Icon } from './icons.tsx'
import { NumberField } from './NumberField.tsx'
import { ProductGlyph } from './productGlyphs.tsx'
import type { StatusLine } from './productFacts.ts'
import type { TipContent } from './tooltip.ts'
import Tooltip from './Tooltip.tsx'

type OnChange = (change: DecisionChange) => void

/**
 * A « − » or « + » beside a field: it makes `change`, or, at a limit where
 * there is none, says so with `aria-disabled` rather than `disabled`, so it
 * keeps the focus. A locked one never had it.
 */
export function StepButton({
  label,
  text,
  change,
  lock,
  describedBy: described,
  onChange,
}: {
  readonly label: string
  readonly text: string
  readonly change: DecisionChange | null
  readonly lock: Lock
  readonly describedBy?: string
  readonly onChange: OnChange
}) {
  return (
    <button
      type="button"
      className="toggle manage__step"
      aria-label={label}
      disabled={lock.disabled}
      aria-describedby={describedBy(lock.describedBy, described)}
      aria-disabled={change === null}
      onClick={() => {
        if (change !== null) onChange(change)
      }}
    >
      {text}
    </button>
  )
}

/**
 * A card's one status line: a dot, hidden from screen readers since the
 * words say the same, yesterday's fact, then « Demain : … » under it.
 * Nothing when there is neither.
 */
export function StatusLineView({
  id,
  line,
}: {
  readonly id: string
  readonly line: StatusLine
}) {
  const { fact, tomorrow } = line
  if (fact === null && tomorrow === null) return null
  return (
    <p id={id} className="status-line">
      {fact !== null && (
        <>
          <span
            className={`status-line__dot status-line__dot--${fact.tone}`}
            aria-hidden="true"
          />
          {fact.text}
        </>
      )}
      {tomorrow !== null && (
        <span className="status-line__tomorrow">
          {fact !== null && <span className="visually-hidden"> · </span>}
          {tomorrow}
        </span>
      )}
    </p>
  )
}

export interface ProductCardProps {
  readonly product: ProductId
  /** The price as the player last left it. */
  readonly price: Cents
  readonly line: StatusLine
  readonly tip: TipContent
  readonly lock: Lock
  readonly onChange: OnChange
}

/**
 * A product on « Menu »: its glyph and name, its price between « − » and
 * « + », and its status line. The whole card is the anchor of its
 * tooltip, which hover, a long press or the keyboard's focus on the price
 * or a stepper opens; both describe the price and the steppers.
 */
export function ProductCard({
  product,
  price,
  line,
  tip,
  lock,
  onChange,
}: ProductCardProps) {
  const { name } = FOOD_TRUCK.products[product]
  const id = `manage-price-${product}`
  const statusId = `${id}-status`
  const hasLine = line.fact !== null || line.tomorrow !== null
  return (
    <Tooltip content={tip}>
      {(anchor) => {
        const tipId = anchor['aria-describedby']
        const described = describedBy(hasLine ? statusId : undefined, tipId)
        const stepper = (direction: 1 | -1, text: string, verb: string) => {
          const next = stepPrice(price, direction)
          return (
            <StepButton
              label={`${name}\u00a0: ${verb} le prix de ${PRICE_STEP_TEXT}`}
              text={text}
              change={
                next === null ? null : { kind: 'price', product, price: next }
              }
              lock={lock}
              describedBy={described}
              onChange={onChange}
            />
          )
        }
        return (
          <div className="product-card" {...anchor}>
            <div className="product-card__head">
              <ProductGlyph product={product} />
              <h3 className="product-card__name">{name}</h3>
              <span className="product-card__info" aria-hidden="true">
                <Icon name="info" size={18} />
              </span>
            </div>
            <NumberField
              id={id}
              label={name}
              hideLabel
              unit="$"
              inputMode="decimal"
              value={formatAmount(price)}
              read={(text) => priceChange(product, text, price)}
              onChange={onChange}
              disabled={lock.disabled}
              describedBy={describedBy(lock.describedBy, described)}
              before={stepper(-1, '−', 'baisser')}
              after={stepper(1, '+', 'augmenter')}
            />
            <StatusLineView id={statusId} line={line} />
          </div>
        )
      }}
    </Tooltip>
  )
}
