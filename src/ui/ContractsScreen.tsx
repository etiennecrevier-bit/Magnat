import { useEffect, useMemo } from 'react'
import type { GrocerId } from '../content/schema.ts'
import {
  contractsBoard,
  grocerLine,
  grocerTip,
  withGrocer,
  type ContractsBoard,
  type GrocerLine,
} from './contractsBoard.ts'
import { formatMoney } from './formatMoney.ts'
import { StatusLineView } from './ProductCard.tsx'
import { useGame, type CityPick } from './store.ts'
import type { TipActions } from './Tooltip.tsx'
import Tooltip from './Tooltip.tsx'
import './panel.css'
import './ContractsScreen.css'

// Every space before a colon is a no-break space (U+00A0).
const COLON = ' :'

/** What the bare view does once a picked card is in view: nothing. */
const IGNORE = () => {}

/**
 * « Contrats »: a card for each grocer with a contract that runs or money
 * owed, and for the grocer `pick` names, then what the grocers owe in all,
 * or « Aucun contrat pour l'instant. ». Each card shows this week's
 * delivery; its tooltip, the rest.
 */
export function ContractsScreenView({
  board,
  pick = null,
  onBrought = IGNORE,
}: {
  board: ContractsBoard
  pick?: CityPick | null
  /** Told the count of the pick once its card is in view. */
  onBrought?: (count: number) => void
}) {
  const grocers = withGrocer(board, pick?.grocer ?? null)
  return (
    <section className="contracts">
      {grocers.length > 0 && (
        <ul className="contracts__cards">
          {grocers.map((line) => (
            <GrocerCard
              key={line.grocer}
              line={line}
              pick={pick?.grocer === line.grocer ? pick : null}
              onBrought={onBrought}
            />
          ))}
        </ul>
      )}
      {board.grocers.length === 0 ? (
        <p className="contracts__empty">Aucun contrat pour l'instant.</p>
      ) : (
        <p className="contracts__total">
          Total à recevoir des épiceries{COLON}{' '}
          <strong>{formatMoney(board.owedTotal)}</strong>
        </p>
      )}
    </section>
  )
}

/** The id of `grocer`'s card. */
function cardId(grocer: GrocerId): string {
  return `contracts-${grocer}`
}

/**
 * A grocer: their name and this week's delivery as its status line, the
 * anchor of its tooltip. Brought into view, with its tooltip open, while
 * `pick` waits for it.
 */
function GrocerCard({
  line,
  pick,
  onBrought,
}: {
  line: GrocerLine
  pick: CityPick | null
  onBrought: (count: number) => void
}) {
  const id = cardId(line.grocer)
  const picked = pick !== null
  return (
    <li>
      <Tooltip content={grocerTip(line)}>
        {(anchor, tip) => (
          <article
            id={id}
            className={
              picked
                ? 'contracts__card contracts__card--picked'
                : 'contracts__card'
            }
            tabIndex={0}
            aria-labelledby={`${id}-name`}
            {...anchor}
          >
            <h3 id={`${id}-name`} className="contracts__name">
              {line.name}
            </h3>
            <StatusLineView id={`${id}-status`} line={grocerLine(line)} />
            {pick?.pending === true && (
              <BringIntoView
                id={id}
                pick={pick.count}
                tip={tip}
                onBrought={onBrought}
              />
            )}
          </article>
        )}
      </Tooltip>
    </li>
  )
}

/**
 * Brings the card `id` into view for pick `pick`: scrolled to, focused and
 * its tooltip opened, as a click on the city asks, then tells `onBrought`,
 * so the tab shown again later does not take the focus back. Its tooltip
 * opens through `tip`, since a focus that follows a press does not open it.
 * It waits for the panel to open, as « Ville » opened by the click is not
 * yet, and to give the focus to its first control.
 */
function BringIntoView({
  id,
  pick,
  tip,
  onBrought,
}: {
  id: string
  pick: number
  tip: TipActions
  onBrought: (count: number) => void
}) {
  const { open } = tip
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const card = document.getElementById(id)
      if (card === null) return
      card.scrollIntoView({ block: 'nearest' })
      card.focus({ preventScroll: true })
      open()
      onBrought(pick)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [id, pick, open, onBrought])
  return null
}

/**
 * The « Contrats » screen wired to the app store. `followsCity`, in «
 * Ville », brings into view, once, the grocer each click on their shop in
 * the city asks for (see `pickGrocer`).
 */
export default function ContractsScreen({
  followsCity = false,
}: {
  followsCity?: boolean
}) {
  const day = useGame((state) => state.game.day)
  const contracts = useGame((state) => state.game.contracts)
  const receivables = useGame((state) => state.game.receivables)
  const pick = useGame((state) => (followsCity ? state.cityPick : null))
  const settle = useGame((state) => state.settleCityPick)
  const board = useMemo(
    () => contractsBoard({ day, contracts, receivables }),
    [day, contracts, receivables],
  )
  return <ContractsScreenView board={board} pick={pick} onBrought={settle} />
}
