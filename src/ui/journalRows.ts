import { useCallback, useState } from 'react'
import type { Day } from '../engine/types.ts'
import type { MonthReport } from './monthlyReport.ts'

// The rows of « Journal » (JournalRow.tsx): which are open, and their keys
// in « Bilans ».

/**
 * The keys of the rows open in a list of « Journal », none at first, and
 * the toggle of one, which says whether it opened.
 */
export function useOpenRows(): [ReadonlySet<string>, (key: string) => boolean] {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = useCallback(
    (key: string) => {
      const opens = !open.has(key)
      const next = new Set(open)
      if (opens) next.add(key)
      else next.delete(key)
      setOpen(next)
      return opens
    },
    [open],
  )
  return [open, toggle]
}

/** The key of the row of the « Bilan du mois » of `month`. */
export const monthKey = (month: Pick<MonthReport, 'firstDay'>) =>
  `month-${month.firstDay}`

/** The key of the row of the week that starts on `firstDay`. */
export const weekKey = (firstDay: Day) => `week-${firstDay}`
