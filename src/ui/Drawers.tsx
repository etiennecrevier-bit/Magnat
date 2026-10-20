import { useCallback, useState, type ReactNode } from 'react'
import ContractsScreen from './ContractsScreen.tsx'
import { dockButtonId } from './dock.ts'
import { DockDrawer } from './DockFrame.tsx'
import { financesTabs, JOURNAL_TABS } from './dockFrame.ts'
import EventLog from './EventLog.tsx'
import FinancesCompany from './FinancesCompany.tsx'
import FinancesPanel from './FinancesPanel.tsx'
import { gameStore, useGame } from './store.ts'
import WeekReports from './WeekReports.tsx'
import './Drawers.css'

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
 * « Finances », the drawer of the money, which slides in from the left and
 * leaves the game running: « Entreprise » (tiles, the last 30 days, « À
 * surveiller » and the statements in accordions), « Personnel » (« Vos
 * finances » and the net worth's parts), and, in a Défi, « Contrats ».
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
  const shown = tabs.some(({ id }) => id === tab) ? tab : 'company'
  let body: ReactNode = null
  if (opened) {
    if (shown === 'company') body = <FinancesCompany />
    else if (shown === 'personal') body = <FinancesPanel />
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
