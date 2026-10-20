import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { netWorth as netWorthOf, netWorthChange } from '../engine/netWorth.ts'
import ContractsScreen from './ContractsScreen.tsx'
import { dockButtonId } from './dock.ts'
import { DockDrawer } from './DockFrame.tsx'
import { financesTabs, JOURNAL_TABS } from './dockFrame.ts'
import EventLog from './EventLog.tsx'
import FinancesPanel from './FinancesPanel.tsx'
import FinancialStatements from './FinancialStatements.tsx'
import { NetWorthGaugeView } from './NetWorthGauge.tsx'
import { gameStore, useGame } from './store.ts'
import TodayPanel from './TodayPanel.tsx'
import WeekReports from './WeekReports.tsx'

/** The owner's « Valeur nette » and how it moved since the last Sunday. */
function NetWorthNow() {
  const day = useGame((state) => state.game.day)
  const journal = useGame((state) => state.game.journal)
  const financing = useGame((state) => state.game.financing)
  const personal = useGame((state) => state.game.personal)
  const dream = useGame((state) => state.game.dream)
  const weekHistory = useGame((state) => state.game.weekHistory)
  const worth = useMemo(() => {
    const game = { day, journal, financing, personal, dream, weekHistory }
    return { total: netWorthOf(game), change: netWorthChange(game) }
  }, [day, journal, financing, personal, dream, weekHistory])
  return <NetWorthGaugeView netWorth={worth.total} change={worth.change} />
}

/** Whether a drawer was ever open, so its tab stays on the page from then. */
function useOpened(open: boolean): boolean {
  const [opened, setOpened] = useState(open)
  if (open && !opened) setOpened(true)
  return opened || open
}

/** What the store needs of a drawer: whether a panel is over it. */
const panelOpen = () => gameStore.getState().panel !== null

/** Closes the drawer open. */
const close = () => gameStore.getState().closeDrawer()

/**
 * « Finances », the drawer of the money, which leaves the game running:
 * « Aujourd'hui » (the net worth, yesterday by product, the net worth's
 * parts and the financing), « Vos finances », the « États financiers »,
 * and, in a Défi, the « Contrats ».
 */
export function FinancesDrawer() {
  const open = useGame((state) => state.drawer === 'finances')
  const tab = useGame((state) => state.drawerTabs.finances)
  const setDrawerTab = useGame((state) => state.setDrawerTab)
  const challenge = useGame((state) => state.game.challenge)
  const opened = useOpened(open)
  const returnFocus = useCallback(
    () => document.getElementById(dockButtonId('finances')),
    [],
  )
  const tabs = financesTabs(challenge !== null)
  const shown = tabs.some(({ id }) => id === tab) ? tab : 'today'
  let body: ReactNode = null
  if (opened) {
    if (shown === 'today') {
      body = (
        <>
          <NetWorthNow />
          <TodayPanel />
        </>
      )
    } else if (shown === 'personal') body = <FinancesPanel />
    else if (shown === 'statements') body = <FinancialStatements />
    else body = <ContractsScreen />
  }
  return (
    <DockDrawer
      open={open}
      className="finances-drawer"
      title="Finances"
      tabs={tabs}
      tab={shown}
      onTab={(next) => setDrawerTab('finances', next)}
      onClose={close}
      panelOpen={panelOpen}
      returnFocus={returnFocus}
    >
      {body}
    </DockDrawer>
  )
}

/**
 * « Journal », the drawer of what happened, which leaves the game running:
 * the « Événements » and the « Bilans ».
 */
export function JournalDrawer() {
  const open = useGame((state) => state.drawer === 'journal')
  const tab = useGame((state) => state.drawerTabs.journal)
  const setDrawerTab = useGame((state) => state.setDrawerTab)
  const opened = useOpened(open)
  const returnFocus = useCallback(
    () => document.getElementById(dockButtonId('journal')),
    [],
  )
  return (
    <DockDrawer
      open={open}
      className="journal-drawer"
      title="Journal"
      tabs={JOURNAL_TABS}
      tab={tab}
      onTab={(next) => setDrawerTab('journal', next)}
      onClose={close}
      panelOpen={panelOpen}
      returnFocus={returnFocus}
    >
      {opened && (tab === 'events' ? <EventLog /> : <WeekReports />)}
    </DockDrawer>
  )
}
