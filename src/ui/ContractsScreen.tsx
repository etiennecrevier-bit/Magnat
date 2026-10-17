import { useMemo } from 'react'
import {
  contractsBoard,
  type ContractLine,
  type ContractsBoard,
  type GrocerLine,
  type WeekDelivery,
} from './contractsBoard.ts'
import { formatDayAndMonth, formatWeekdayName } from './formatGameDate.ts'
import { formatCount, formatMoney } from './formatMoney.ts'
import { useGame } from './store.ts'
import './ContractsScreen.css'

/**
 * « Contrats »: each grocer with a contract that runs or money owed, in
 * plain lines, then what the grocers owe in all.
 */
export function ContractsScreenView({ board }: { board: ContractsBoard }) {
  return (
    <section className="contracts">
      <h1>Contrats</h1>
      {board.grocers.length === 0 ? (
        <p>Aucun contrat pour l'instant.</p>
      ) : (
        <>
          {board.grocers.map((line) => (
            <GrocerArticle key={line.grocer} line={line} />
          ))}
          <p className="contracts__total">
            Total à recevoir des épiceries&nbsp;:{' '}
            <strong>{formatMoney(board.owedTotal)}</strong>
          </p>
        </>
      )}
    </section>
  )
}

function GrocerArticle({ line }: { line: GrocerLine }) {
  const { name, owner, contract, owed, owedTotal } = line
  return (
    <article className="contracts__grocer">
      <h2>{name}</h2>
      <p className="contracts__owner">{owner}</p>
      {contract === null ? (
        <p>Aucun contrat en cours</p>
      ) : (
        <ContractLines contract={contract} />
      )}
      {owed.length > 0 && (
        <>
          <p>
            À recevoir&nbsp;: <strong>{formatMoney(owedTotal)}</strong>
          </p>
          <ul className="contracts__owed">
            {owed.map(({ amount, dueDay }, index) => (
              <li key={index}>
                {formatMoney(amount)} le {formatDayAndMonth(dueDay)}
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  )
}

function ContractLines({ contract }: { contract: ContractLine }) {
  const { unitsPerWeek, unitPrice, premium, weeksLeft, strikes, maxStrikes } =
    contract
  return (
    <>
      <p>
        {formatCount(unitsPerWeek)} croissants par semaine à{' '}
        {formatMoney(unitPrice)}
        {premium > 0 && (
          <> · +{formatMoney(premium)} par croissant du fournil</>
        )}
      </p>
      <p>
        {weeksLeft} {weeksLeft > 1 ? 'semaines restantes' : 'semaine restante'}{' '}
        · Livraisons manquées&nbsp;: {strikes} sur {maxStrikes}
      </p>
      <p>Cette semaine&nbsp;: {weekText(contract.week)}</p>
    </>
  )
}

/** This week's delivery, in words. */
function weekText(week: WeekDelivery): string {
  const weekday = formatWeekdayName(week.day)
  switch (week.kind) {
    case 'delivered':
      return `${formatCount(week.units)} croissants livrés ${weekday}, ${formatMoney(week.amount)}`
    case 'missed':
      return `livraison manquée ${weekday}`
    case 'due':
      return `livraison ${weekday}`
    case 'first':
      return `aucune livraison, la première le ${formatDayAndMonth(week.day)}`
  }
}

/** The « Contrats » screen wired to the app store. */
export default function ContractsScreen() {
  const day = useGame((state) => state.game.day)
  const contracts = useGame((state) => state.game.contracts)
  const receivables = useGame((state) => state.game.receivables)
  const board = useMemo(
    () => contractsBoard({ day, contracts, receivables }),
    [day, contracts, receivables],
  )
  return <ContractsScreenView board={board} />
}
