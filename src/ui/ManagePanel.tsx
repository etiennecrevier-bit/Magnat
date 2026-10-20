import { useMemo, useState } from 'react'
import {
  decisionKindSchema,
  type DecisionKind,
  type ProductId,
} from '../content/schema.ts'
import { isLocked } from '../engine/challenge.ts'
import { DEFIS, FOOD_TRUCK } from '../engine/day.ts'
import { latestDecisions, type DecisionChange } from '../engine/decisions.ts'
import { dreamBonuses, dreamLimits } from '../engine/dream.ts'
import { PRODUCTS } from '../engine/inventory.ts'
import type { Decisions, GameState } from '../engine/types.ts'
import { bakeryBoard, type BakeryBoard } from './bakeryBoard.ts'
import { BakerySection } from './BakerySection.tsx'
import {
  RESTOCK_LABELS,
  daysOpenChange,
  marketingChange,
  ownerPayChange,
  restockChange,
  restockFields,
} from './decisionInput.ts'
import { lockReason } from './defis.ts'
import { TRUCK_TABS } from './dockFrame.ts'
import { describedBy } from './describedBy.ts'
import { DockPanel } from './DockFrame.tsx'
import { useFieldDialog } from './fieldDialog.ts'
import { formatAmount } from './formatMoney.ts'
import { Icon } from './icons.tsx'
import { NumberField } from './NumberField.tsx'
import { ProductCard, StatusLineView, StepButton } from './ProductCard.tsx'
import {
  menuFact,
  productBoards,
  productTip,
  stockFact,
  tomorrowPrice,
  tomorrowRule,
  type ProductBoard,
} from './productFacts.ts'
import { ProductGlyph } from './productGlyphs.tsx'
import { useGame, type TruckTab } from './store.ts'
import './panel.css'
import './ManagePanel.css'

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
 * Why the tab's or the section's decisions cannot change, at its top, when the
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
  /** The tab shown. */
  tab: TruckTab
  /** The decisions as the player last left them. */
  decisions: Decisions
  /** The decisions of the day under way, which the latest may change. */
  today: Decisions
  /** What each product's card shows beside its decisions. */
  products: Readonly<Record<ProductId, ProductBoard>>
  /** The kinds of decision the Défi played locks; none outside a Défi. */
  locked: readonly DecisionKind[]
  /** The « Fournil » tab. */
  bakery: BakeryBoard
  /**
   * The units a restock rule may name: the content's, unless the rungs of
   * « Le rêve » owned allow more.
   */
  units?: { readonly min: number; readonly max: number }
  onChange: OnChange
}

/**
 * What the player runs the truck with, a tab at a time: on « Menu », a card
 * per product with its price and yesterday's most important fact; on
 * « Stocks », its restock rule with what was left; the days open; their
 * pay and the marketing; the bakery. Then that the changes apply tomorrow
 * morning. The decisions a Défi locks are disabled, with the reason at the
 * top of their tab.
 */
export function ManagePanelView({
  tab,
  decisions,
  today,
  products,
  locked,
  bakery,
  units = FOOD_TRUCK.decisionLimits.units,
  onChange,
}: ManagePanelViewProps) {
  return (
    <div className="panel__content">
      {tab === 'menu' && (
        <MenuTab
          prices={decisions.prices}
          today={today.prices}
          products={products}
          locked={locked.includes('price')}
          onChange={onChange}
        />
      )}
      {tab === 'stocks' && (
        <StocksTab
          restock={decisions.restock}
          today={today.restock}
          products={products}
          locked={locked.includes('restock')}
          units={units}
          onChange={onChange}
        />
      )}
      {tab === 'schedule' && (
        <DaysOpenSection
          daysOpen={decisions.daysOpen}
          locked={locked.includes('daysOpen')}
          onChange={onChange}
        />
      )}
      {tab === 'payMarketing' && (
        <PayMarketingTab
          decisions={decisions}
          locked={locked}
          onChange={onChange}
        />
      )}
      {tab === 'bakery' && <BakerySection board={bakery} onChange={onChange} />}
      <p className="manage__note">
        <Icon name="info" size={16} />
        Les changements s'appliquent demain matin.
      </p>
    </div>
  )
}

function MenuTab({
  prices,
  today,
  products,
  locked,
  onChange,
}: {
  prices: Decisions['prices']
  today: Decisions['prices']
  products: Readonly<Record<ProductId, ProductBoard>>
  locked: boolean
  onChange: OnChange
}) {
  const lock = lockProps('price', locked)
  return (
    <>
      <LockNote kind="price" locked={locked} />
      <div className="manage__cards">
        {PRODUCTS.map((product) => {
          const { facts, onSale, cost } = products[product]
          const price = prices[product]
          return (
            <ProductCard
              key={product}
              product={product}
              price={price}
              line={{
                fact: menuFact(facts, onSale),
                tomorrow: tomorrowPrice(today[product], price),
              }}
              tip={productTip(product, facts, price, cost)}
              lock={lock}
              onChange={onChange}
            />
          )
        })}
      </div>
    </>
  )
}

function StocksTab({
  restock,
  today,
  products,
  locked,
  units: limits,
  onChange,
}: {
  restock: Decisions['restock']
  today: Decisions['restock']
  products: Readonly<Record<ProductId, ProductBoard>>
  locked: boolean
  units: { readonly min: number; readonly max: number }
  onChange: OnChange
}) {
  const lock = lockProps('restock', locked)
  return (
    <>
      <LockNote kind="restock" locked={locked} />
      <div className="manage__cards">
        {PRODUCTS.map((product) => {
          const { name } = FOOD_TRUCK.products[product]
          const rule = restock[product]
          const { facts, left } = products[product]
          const statusId = `manage-restock-${product}-status`
          const line = {
            fact: stockFact(facts, left),
            tomorrow: tomorrowRule(today[product], rule),
          }
          const hasLine = line.fact !== null || line.tomorrow !== null
          const described = hasLine ? statusId : undefined
          return (
            <div
              key={product}
              className="product-card product-card--stock"
              role="group"
              aria-labelledby={`manage-restock-${product}-name`}
            >
              <div className="product-card__head">
                <ProductGlyph product={product} />
                <h3
                  id={`manage-restock-${product}-name`}
                  className="product-card__name"
                >
                  {name}
                </h3>
              </div>
              {restockFields(rule).map(({ field, units }) => {
                const label = RESTOCK_LABELS[field]
                const step = (
                  direction: 1 | -1,
                  text: string,
                  verb: string,
                ) => {
                  const next = restockChange(
                    product,
                    field,
                    String(units + direction),
                    rule,
                    limits,
                  )
                  return (
                    <StepButton
                      label={`${name}, ${label}\u00a0: ${verb} de 1`}
                      text={text}
                      change={next.kind === 'change' ? next.change : null}
                      lock={lock}
                      describedBy={described}
                      onChange={onChange}
                    />
                  )
                }
                return (
                  <NumberField
                    key={field}
                    id={`manage-restock-${product}-${field}`}
                    label={label}
                    unit="unités"
                    inputMode="numeric"
                    value={String(units)}
                    read={(text) =>
                      restockChange(product, field, text, rule, limits)
                    }
                    onChange={onChange}
                    disabled={lock.disabled}
                    describedBy={describedBy(lock.describedBy, described)}
                    before={step(-1, '−', 'baisser')}
                    after={step(1, '+', 'augmenter')}
                  />
                )
              })}
              <StatusLineView id={statusId} line={line} />
            </div>
          )
        })}
      </div>
    </>
  )
}

function PayMarketingTab({
  decisions,
  locked,
  onChange,
}: {
  decisions: Decisions
  locked: readonly DecisionKind[]
  onChange: OnChange
}) {
  const payLocked = locked.includes('ownerWeeklyPay')
  const marketingLocked = locked.includes('marketingDaily')
  return (
    <div className="manage__pay-marketing">
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
      <section className="manage__marketing" aria-labelledby="manage-marketing">
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
    </div>
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
    <section className="manage__days">
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
 * « Le camion », the panel wired to the app store, in the dock's frame, a
 * modal dialog (see `useFieldDialog`): the page behind it is out of reach
 * and Escape closes it. It opens on the tab last shown, or on « Fournil »
 * from the bakery in the city. Another tab, or « ✕ », keeps what was
 * typed, after any invalid text is fixed; Escape drops what is still being
 * typed. The changes already made stay either way.
 */
export default function ManagePanel() {
  const decisions = useGame((state) => latestDecisions(state.game))
  const game = useGame((state) => state.game)
  const bakery = useMemo(() => bakeryBoard(game), [game])
  const products = useMemo(() => productBoards(game), [game])
  const dream = useGame((state) => state.game.dream)
  const units = useMemo(
    () => dreamLimits(FOOD_TRUCK.decisionLimits, dreamBonuses(dream)).units,
    [dream],
  )
  const decide = useGame((state) => state.decide)
  const closePanel = useGame((state) => state.closePanel)
  const tab = useGame((state) => state.truckTab)
  const setTab = useGame((state) => state.setTruckTab)
  const { dialogRef, onChange, settle, close, onCancel } =
    useFieldDialog(decide)

  return (
    <DockPanel
      dialogRef={dialogRef}
      className="manage"
      title="Le camion"
      tabs={TRUCK_TABS}
      tab={tab}
      onTab={(next) => {
        if (!settle()) return false
        setTab(next)
      }}
      onCancel={onCancel}
      onClose={closePanel}
      onDismiss={close}
    >
      <ManagePanelView
        tab={tab}
        decisions={decisions}
        today={game.decisions}
        products={products}
        locked={lockedKinds(game)}
        bakery={bakery}
        units={units}
        onChange={onChange}
      />
    </DockPanel>
  )
}
