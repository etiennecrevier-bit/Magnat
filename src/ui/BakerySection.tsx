import type { CroissantSource, OvenTerms } from '../content/schema.ts'
import type { DecisionChange } from '../engine/decisions.ts'
import type { BakeryBoard, BakeryStatus } from './bakeryBoard.ts'
import { BAKE_LABELS, bakeChange, restockFields } from './decisionInput.ts'
import { formatDayAndMonth } from './formatGameDate.ts'
import { formatCount, formatMoney } from './formatMoney.ts'
import { NumberField } from './NumberField.tsx'

// French puts a no-break space (U+00A0) before a colon.
const COLON = ' :'

/** The id of « Fournil », which the panel scrolls to when asked. */
export const BAKERY_TITLE_ID = 'manage-bakery'

const OVEN_NAMES: Readonly<Record<OvenTerms, string>> = {
  louer: 'four loué',
  acheter: 'four acheté',
}

const SOURCES: readonly { source: CroissantSource; label: string }[] = [
  { source: 'acheter', label: 'Acheter' },
  { source: 'fabriquer', label: 'Fabriquer' },
]

/** Where the bakery stands today: « Ouvert depuis le 3 juin · four loué ». */
function todayText(status: BakeryStatus): string {
  switch (status.kind) {
    case 'closed':
      return 'Fermé'
    case 'open':
      return `Ouvert depuis le ${formatDayAndMonth(status.since)} · ${OVEN_NAMES[status.oven]}`
    case 'notice':
      return `En préavis${COLON} dernier jour le ${formatDayAndMonth(status.lastDay)}`
  }
}

/** Where it will stand tomorrow, after « Demain : ». */
function tomorrowText(status: BakeryStatus): string {
  switch (status.kind) {
    case 'closed':
      return 'fermé'
    case 'open':
      return `ouvert · ${OVEN_NAMES[status.oven]}`
    case 'notice':
      return `en préavis, dernier jour le ${formatDayAndMonth(status.lastDay)}`
  }
}

/**
 * « Fournil », in « Gérer le camion »: where the bakery stands today and
 * tomorrow, how to open or close it, what it costs, the unit cost of a
 * croissant bought and made side by side with its fixed costs on a line of
 * their own, then where the croissants come from and how many it makes.
 * Never a break-even figure.
 */
export function BakerySection({
  board,
  onChange,
}: {
  board: BakeryBoard
  onChange: (change: DecisionChange) => void
}) {
  const { today, tomorrow, bake } = board
  const perMonth = (amount: BakeryBoard['monthlyRent']) =>
    `${formatMoney(amount)} par mois`
  return (
    <section className="manage__bakery" aria-labelledby={BAKERY_TITLE_ID}>
      <h3 id={BAKERY_TITLE_ID}>Fournil</h3>
      <p className="manage__bakery-status">{todayText(today)}</p>
      {tomorrow !== null && <p>Demain&nbsp;: {tomorrowText(tomorrow)}</p>}
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
      </div>
      {board.closingLastDay !== null && (
        <p>
          Fermer donne un préavis&nbsp;: dernier jour le{' '}
          {formatDayAndMonth(board.closingLastDay)}
        </p>
      )}
      <ul className="manage__bakery-costs">
        <li>Déménagement&nbsp;: {formatMoney(board.movingCost)}</li>
        <li>Loyer&nbsp;: {perMonth(board.monthlyRent)}</li>
        <li>Four loué&nbsp;: {perMonth(board.monthlyLease)}</li>
        <li>
          Four acheté&nbsp;:{' '}
          {board.ownsOven ? 'déjà à vous' : formatMoney(board.ovenPrice)}
        </li>
        <li>
          Capacité&nbsp;: {formatCount(board.capacity)} croissants par jour
        </li>
      </ul>
      <table className="data-table manage__unit-costs">
        <caption>Coût d'un croissant</caption>
        <thead>
          <tr>
            <th scope="col" className="number">
              Acheté
            </th>
            <th scope="col" className="number">
              Fabriqué
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="number">{formatMoney(board.boughtUnitCost)}</td>
            <td className="number">{formatMoney(board.madeUnitCost)}</td>
          </tr>
        </tbody>
      </table>
      <p className="manage__bakery-fixed">
        Frais fixes du fournil&nbsp;: {fixedCostsText(board, perMonth)}
      </p>
      <div
        className="toggle-group"
        role="group"
        aria-label="Provenance des croissants"
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
      {board.boughtAnyway && (
        <p>Sans fournil ouvert, les croissants sont achetés.</p>
      )}
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

/**
 * The bakery's fixed costs a month: the planned one's, or each opening's
 * when none is planned, « 3 000,00 $ par mois avec le four loué ».
 */
function fixedCostsText(
  board: BakeryBoard,
  perMonth: (amount: BakeryBoard['monthlyRent']) => string,
): string {
  if (board.fixedCosts !== null) return perMonth(board.fixedCosts)
  return board.options
    .flatMap(({ oven, fixedCosts }) =>
      fixedCosts === null
        ? []
        : [`${perMonth(fixedCosts)} avec le ${OVEN_NAMES[oven]}`],
    )
    .join(' · ')
}
