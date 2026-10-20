import type { CroissantSource } from '../content/schema.ts'
import type { DecisionChange } from '../engine/decisions.ts'
import type { BakeryBoard } from './bakeryBoard.ts'
import {
  OVEN_NAMES,
  bakeryCostsTip,
  bakeryLine,
  sourceLine,
  unitCostTip,
} from './bakeryText.ts'
import { BAKE_LABELS, bakeChange, restockFields } from './decisionInput.ts'
import InfoButton from './InfoButton.tsx'
import { NumberField } from './NumberField.tsx'
import { StatusLineView } from './ProductCard.tsx'

/** The id of the title « Fournil », which labels the section. */
export const BAKERY_TITLE_ID = 'manage-bakery'

// Room in the tooltips for « 3 000,00 $ par mois » beside its label.
const TIP_WIDTH = 330

const SOURCES: readonly { source: CroissantSource; label: string }[] = [
  { source: 'acheter', label: 'Acheter' },
  { source: 'fabriquer', label: 'Fabriquer' },
]

/**
 * « Fournil », a tab of « Le camion »: where the bakery stands today and
 * tomorrow, how to open or close it, with what it costs in the tooltip
 * beside, where the croissants come from, with the unit cost of a croissant
 * bought and made and the fixed costs in the tooltip beside, and how many it
 * makes. Never a break-even figure.
 */
export function BakerySection({
  board,
  onChange,
}: {
  board: BakeryBoard
  onChange: (change: DecisionChange) => void
}) {
  const { today, bake } = board
  return (
    <section className="manage__bakery" aria-labelledby={BAKERY_TITLE_ID}>
      <h3 id={BAKERY_TITLE_ID}>Fournil</h3>
      <StatusLineView id="manage-bakery-status" line={bakeryLine(board)} />
      <div className="manage__bakery-actions">
        {board.planned ? (
          <button
            type="button"
            className="button"
            onClick={() => onChange({ kind: 'closeBakery' })}
          >
            {today.kind === 'closed'
              ? "Annuler l'ouverture"
              : 'Fermer le fournil'}
          </button>
        ) : (
          board.options.map(({ oven, allowed }) => (
            <button
              key={oven}
              type="button"
              className="button"
              disabled={!allowed}
              onClick={() => onChange({ kind: 'openBakery', oven })}
            >
              Ouvrir · {OVEN_NAMES[oven]}
            </button>
          ))
        )}
        <InfoButton
          content={bakeryCostsTip(board)}
          width={TIP_WIDTH}
          label="Ce que coûte le fournil"
        />
      </div>
      <div className="manage__bakery-source">
        <div
          className="toggle-group"
          role="group"
          aria-label="Provenance des croissants"
          aria-describedby={
            board.boughtAnyway ? 'manage-bakery-source-status' : undefined
          }
        >
          {SOURCES.map(({ source, label }) => (
            <button
              key={source}
              type="button"
              className="toggle"
              aria-pressed={board.source === source}
              onClick={() => {
                if (board.source !== source) {
                  onChange({ kind: 'croissantSource', source })
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <InfoButton
          content={unitCostTip(board)}
          width={TIP_WIDTH}
          label="Coût d'un croissant"
        />
      </div>
      <StatusLineView
        id="manage-bakery-source-status"
        line={sourceLine(board)}
      />
      <fieldset className="manage__rule">
        <legend>Fournée</legend>
        {restockFields(bake).map(({ field, units }) => (
          <NumberField
            key={field}
            id={`manage-bake-${field}`}
            label={BAKE_LABELS[field]}
            unit="croissants"
            inputMode="numeric"
            value={String(units)}
            read={(text) => bakeChange(field, text, bake)}
            onChange={onChange}
          />
        ))}
      </fieldset>
    </section>
  )
}
