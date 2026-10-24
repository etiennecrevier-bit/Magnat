import { useCallback, useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import BankruptcyEnd from './BankruptcyEnd.tsx'
import DefiEnd from './DefiEnd.tsx'
import DefiPanel from './DefiPanel.tsx'
import { keepBestMedals } from './defis.ts'
import Dock from './Dock.tsx'
import { activateDockItem, dockItems, handleDockKey } from './dock.ts'
import DreamPanel from './DreamPanel.tsx'
import { FinancesDrawer, JournalDrawer } from './Drawers.tsx'
import EventCard from './EventCard.tsx'
import {
  FOLD_BUTTONS,
  handleFoldKey,
  losesFocusOnFold,
} from './foldShortcut.ts'
import MagnatScreen from './MagnatScreen.tsx'
import ManagePanel from './ManagePanel.tsx'
import { startMessageStack } from './messageStack.ts'
import Messages from './Messages.tsx'
import ReportPanel from './ReportPanel.tsx'
import SettingsPanel from './SettingsPanel.tsx'
import { settingsStore, type SettingsStore } from './settings.ts'
import StaffPanel from './StaffPanel.tsx'
import { gameStore, useGame } from './store.ts'
import { watchStreetLegend } from './streetLegend.ts'
import { keepRoomAbove } from './tickerRoom.ts'
import { coachShowing, watchTutorial } from './tutorialFlow.ts'
import { tutorialSignals } from './tutorialSignals.ts'
import CoachBubble from './CoachBubble.tsx'
import Ticker from './Ticker.tsx'
import TripPanel from './TripPanel.tsx'
import WeekSlideIn from './WeekSlideIn.tsx'
import Yesterday from './Yesterday.tsx'
import './GameScreens.css'

/** Keeps the height of « Hier » on the page, so the week's card stays
    above it (see tickerRoom.ts). */
function keepYesterdayRoom(spot: HTMLElement | null) {
  return spot === null ? undefined : keepRoomAbove(spot, document.body)
}

/**
 * The panel open, in the dock's frame for those the dock opens, centred for
 * the Défi's, the event card, the report and « Magnat ».
 */
function OpenPanel({ saveGame }: { saveGame?: () => boolean }) {
  const panel = useGame((state) => state.panel)
  switch (panel) {
    case 'manage':
      return <ManagePanel />
    case 'staff':
      return <StaffPanel />
    case 'trip':
      return <TripPanel />
    case 'dream':
      return <DreamPanel />
    case 'settings':
      return <SettingsPanel saveGame={saveGame} />
    case 'defi':
      return <DefiPanel />
    case 'event':
      return <EventCard />
    case 'report':
      return <ReportPanel />
    case 'magnat':
      return <MagnatScreen />
    default:
      return null
  }
}

/**
 * The shell around the street, under the top bar: the notice when the
 * autosave failed and the messages the game sends, top centre; the dock and
 * its drawers, « Finances » and « Journal »; « Hier » at the bottom right,
 * with the week's card sliding in above it; the La Presse-Citron ticker
 * along the bottom; and the panel open. Once a Défi is over, its end shows
 * over them, and once a game went bankrupt, its « Faillite », each with a
 * « Retour au menu » that calls `onMenu`. Every medal the game wins is kept
 * in `settings`, a Défi won and then loaded included, and so is whether «
 * Hier » is hidden, which R also toggles, and whether the street's legend
 * still shows, in the first game only. The dock's keys open its panels and
 * drawers. A game started in their place, such as one imported, gets
 * new drawers, messages and ticker, so nothing of the last game stays.
 */
export default function GameScreens({
  autosaveFailed = false,
  onMenu,
  saveGame,
  settings = settingsStore,
}: {
  autosaveFailed?: boolean
  onMenu: () => void
  /** Saves the game played now, as « Refaire la visite » asks; whether it did. */
  saveGame?: () => boolean
  settings?: SettingsStore
}) {
  const folded = useStore(settings, (state) => state.screensFolded)
  const panel = useGame((state) => state.panel)
  const gamesStarted = useGame((state) => state.gamesStarted)
  const focusFoldButton = useRef(false)

  useEffect(
    () => keepBestMedals(gameStore, settings.getState().recordMedal),
    [settings],
  )

  useEffect(() => startMessageStack(gameStore), [gamesStarted])

  useEffect(() => watchStreetLegend(gameStore, settings), [settings])

  useEffect(() => watchTutorial(gameStore, tutorialSignals), [])

  // When what had the focus goes away as « Hier » hides or shows, the
  // button that takes its place gets it.
  const fold = useCallback(
    (next: boolean) => {
      focusFoldButton.current = losesFocusOnFold(document.activeElement)
      settings.getState().setScreensFolded(next)
    },
    [settings],
  )

  useEffect(() => {
    if (!focusFoldButton.current) return
    focusFoldButton.current = false
    document.querySelector<HTMLElement>(FOLD_BUTTONS)?.focus()
  }, [folded])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Réal's bubble waits for its own gesture: the shortcuts wait too.
      if (coachShowing(gameStore.getState())) return
      handleFoldKey(event, () => fold(!settings.getState().screensFolded))
      const inChallenge = gameStore.getState().game.challenge !== null
      handleDockKey(event, dockItems(inChallenge), (item) =>
        activateDockItem(gameStore, item),
      )
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fold, settings])

  return (
    <>
      <div className="shell__notices">
        {autosaveFailed && (
          <p className="notice" role="status">
            La sauvegarde automatique a échoué. Exportez la partie dans les
            Réglages pour ne pas la perdre.
          </p>
        )}
        <Messages />
      </div>
      <WeekSlideIn />
      <div ref={keepYesterdayRoom} className="yesterday-spot">
        <Yesterday folded={folded} onFoldChange={fold} />
      </div>
      <Dock />
      {/* After the dock and « Hier », so a drawer covers them where they meet. */}
      <FinancesDrawer key={`finances-${gamesStarted}`} />
      <JournalDrawer key={`journal-${gamesStarted}`} />
      <Ticker key={`ticker-${gamesStarted}`} />
      <OpenPanel saveGame={saveGame} />
      <CoachBubble />
      {panel === 'defiEnd' && <DefiEnd onMenu={onMenu} />}
      {panel === 'bankruptcy' && <BankruptcyEnd onMenu={onMenu} />}
    </>
  )
}
