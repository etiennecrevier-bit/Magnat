import { createStore, useStore, type StoreApi } from 'zustand'
import type { EventContent, GrocerId, Ladder } from '../content/schema.ts'
import { defiById } from '../engine/challenge.ts'
import { createInitialState, startChallenge, tick } from '../engine/clock.ts'
import {
  CUSTOMERS,
  DEFIS,
  DIFFICULTIES,
  ENERGY,
  EVENTS,
  FOOD_TRUCK,
  PERSONAL,
} from '../engine/day.ts'
import { applyDecision, type DecisionChange } from '../engine/decisions.ts'
import { resolveEvent } from '../engine/events.ts'
import { defaultProfile } from '../engine/profile.ts'
import type { Day, GameState, Profile, WeekReport } from '../engine/types.ts'
import { isChallengeOver } from './defis.ts'
import {
  keepWeekReport,
  monthReport,
  reportOnMorning,
  type MonthReport,
} from './monthlyReport.ts'
import { settingsStore, type ReportCadence } from './settings.ts'
import type { PeriodKey, StatementTab } from './statementPeriods.ts'
import { newWeekOf, opensFullReport } from './weeklyReport.ts'

export const PAUSED = 0
/** A multiplier of 1 is, by definition, the pace pacing.json calls normal. */
export const NORMAL_SPEED = 1

/**
 * The panels: « Camion », « Équipe », « Ville », « Améliorations » and «
 * Réglages », which the dock opens, the Défi's, which its chip in the top
 * bar opens, the event card, which opens on its own when an event comes up, the « Bilan »
 * of the week or the month, which opens on its own on the morning it comes
 * or from the card that slides in, « Magnat », which opens on its own the
 * morning after the owner's net worth first reaches the last title, and
 * the end of a game, which opens on its own once the game is over and
 * never closes: the end of a Défi, or the « Faillite » of a game that went
 * bankrupt.
 */
export type Panel =
  | 'manage'
  | 'staff'
  | 'dream'
  | 'trip'
  | 'defi'
  | 'settings'
  | 'event'
  | 'report'
  | 'magnat'
  | 'defiEnd'
  | 'bankruptcy'

/** The panels that end a game, which only open on their own. */
type EndPanel = Extract<Panel, 'defiEnd' | 'bankruptcy'>

/**
 * The part of a panel to show as it opens: « Fournil » in « Camion », as a
 * click on the bakery in the city opens it, or « Contrats » in « Ville », as
 * a click on a grocer does.
 */
export type PanelSection = 'bakery' | 'contracts'

/**
 * The drawers the dock opens over the street, which only read the game and
 * so leave it running: « Finances » and « Journal ».
 */
export type Drawer = 'finances' | 'journal'

/**
 * The tabs of « Finances »: « Entreprise », « Personnel », and, in a Défi,
 * where « Ville » is hidden, « Contrats ».
 */
export type FinancesTab = 'company' | 'personal' | 'contracts'

/**
 * The accordions of « Entreprise »: the three statements, and «
 * Financement » once the game took a loan or sold shares.
 */
export type FinanceSection = StatementTab | 'financing'

/**
 * Which accordions of « Entreprise » are open, and the period each
 * statement shows, kept while the drawer or its tab is closed.
 */
export interface FinanceSections {
  readonly open: Readonly<Record<FinanceSection, boolean>>
  readonly periods: Readonly<Record<StatementTab, PeriodKey>>
}

/** Every accordion closed, every statement on this month. */
export const FIRST_FINANCE_SECTIONS: FinanceSections = {
  open: {
    balanceSheet: false,
    incomeStatement: false,
    cashFlow: false,
    financing: false,
  },
  periods: {
    balanceSheet: 'thisMonth',
    incomeStatement: 'thisMonth',
    cashFlow: 'thisMonth',
  },
}

/** The tabs of « Journal »: « Événements » and « Bilans ». */
export type JournalTab = 'events' | 'reports'

/**
 * The tabs of « Le camion »: « Menu », « Stocks », « Horaire », « Salaire et
 * marketing » and « Fournil ».
 */
export type TruckTab =
  'menu' | 'stocks' | 'schedule' | 'payMarketing' | 'bakery'

/** The tab « Le camion » opens on in a game that has not picked one yet. */
export const FIRST_TRUCK_TAB: TruckTab = 'menu'

/**
 * The tabs of « Ville »: « Aller à… », where the owner goes, and «
 * Contrats », whom they deliver to.
 */
export type CityTab = 'trip' | 'contracts'

/**
 * The grocer whose card « Contrats » shows, as a click on their shop in the
 * city asks, how many clicks asked so far, and whether the last one still
 * waits to bring the card into view: once, so a return to the tab later
 * leaves the focus where it is.
 */
export interface CityPick {
  readonly grocer: GrocerId
  readonly count: number
  readonly pending: boolean
}

/** The tab each drawer shows. */
export interface DrawerTabs {
  readonly finances: FinancesTab
  readonly journal: JournalTab
}

/** The tab each drawer opens on in a game that has not picked one yet. */
export const FIRST_DRAWER_TABS: DrawerTabs = {
  finances: 'company',
  journal: 'events',
}

/** How the store shows the « Bilan » of the week or the month. */
export interface WeeklyReportOptions {
  /**
   * Whether the player wants the full report each time it comes, every
   * week or every month.
   */
  readonly everyWeek: () => boolean
  /**
   * How often the player wants the report after the first weeks of a
   * game; every week when not given.
   */
  readonly cadence?: () => ReportCadence
}

export interface GameStoreState {
  game: GameState
  /**
   * How many games `startGame` has played, new or loaded. It counts up
   * whenever one replaces the game, as an import does mid-game, so what
   * follows the game, such as the autosave, can tell it from the same game
   * played on.
   */
  gamesStarted: number
  /** Game speed multiplier; `PAUSED` stops time. */
  speed: number
  /** The last speed above `PAUSED`, which `togglePause` resumes at. */
  lastSpeed: number
  /**
   * The speed the game resumes at when the open panel closes; null while no
   * panel is open. A panel pauses the game for as long as it is open.
   */
  resumeSpeed: number | null
  /**
   * The open panel; null while none is. While an event waits for the
   * player's choice, a panel is always open: the event card, or one that
   * was open when the event came up, until it closes.
   */
  panel: Panel | null
  /** The part of the open panel it showed as it opened; null for its top. */
  panelSection: PanelSection | null
  /**
   * The drawer open over the street; null while none is. Unlike a panel, it
   * leaves the game running. A panel the player opens closes it; one that
   * opens on its own, such as the event card, opens over it.
   */
  drawer: Drawer | null
  /** The tab each drawer shows, kept while it is closed. */
  drawerTabs: DrawerTabs
  /** The accordions of « Finances » open, and their periods. */
  financeSections: FinanceSections
  /** The tab « Le camion » shows, kept while it is closed. */
  truckTab: TruckTab
  /** The tab « Ville » shows; « Aller à… » each time it opens. */
  cityTab: CityTab
  /**
   * The ladder « Améliorations » shows, « Vie personnelle » or
   * « Entreprise », kept while it is closed.
   */
  dreamTab: Ladder
  /** The grocer « Contrats » shows, as the city asked; null for none. */
  cityPick: CityPick | null
  /**
   * How many reports came only as the card sliding in since the player
   * last opened one, in the full report or in « Bilans » of « Journal »:
   * the count on the dock's « Journal ».
   */
  unreadReports: number
  /**
   * The game from just before the player's choice, while the event card
   * shows what it did; null otherwise.
   */
  eventBefore: GameState | null
  /**
   * Whether the full « Bilan » waits for the panel open when its morning
   * came to close, before any event card.
   */
  reportWaiting: boolean
  /**
   * Whether « Magnat » waits for the panel open when its morning came to
   * close, before the full « Bilan » and any event card.
   */
  magnatWaiting: boolean
  /**
   * The full reports of the last weeks, oldest first, kept as each week
   * comes for the « Bilan du mois »: as many as a month holds. A game
   * started or loaded keeps only its `lastWeek`, as the save holds no more.
   */
  weekReports: readonly WeekReport[]
  /** The last « Bilan du mois » that came; null until one does. */
  monthReport: MonthReport | null
  /**
   * The report the « Bilan » panel and the card sliding in show, the last
   * that came: the week's, `game.lastWeek`, or the month's, `monthReport`.
   */
  reportShown: ReportCadence
  /**
   * The first day of the report the card sliding in shows (see
   * `reportShown`): the Monday of the week, or the 1st of the month; null
   * when none shows. It hides while a panel is open.
   */
  slideIn: Day | null
  /** Ignored while a panel is open: the game stays paused. */
  setSpeed: (speed: number) => void
  /** Ignored while a panel is open: the game stays paused. */
  togglePause: () => void
  /**
   * Runs the engine's `tick()` `days` times, with the event cards on, then
   * notifies once. It stops on the morning an event comes up, opens the
   * event card and pauses, remembering the speed; with a panel already
   * open, that panel stays and the card opens when it closes. Does nothing
   * while an event waits for the player's choice, nor while the card shows
   * what the choice did, which the next day would blur.
   *
   * It keeps the full report of each week that closes (`weekReports`).
   * With the weekly report on, it also stops on the morning a report comes
   * (see `reportOnMorning`): the Monday a new `lastWeek` comes, or, once
   * the first weeks of a game are over and the player wants it every
   * month, the 1st, with the « Bilan du mois » (`monthReport`). The full
   * report opens in the event card's place, the card following when it
   * closes: for the first weeks of a game, when the player wants it each
   * time, and on a morning that brings an event, which pauses the game
   * anyway. Otherwise the card slides in (`slideIn`) and the game goes on.
   * Does nothing while the full report is open or waits for a panel to
   * close, since the next report would replace the one it shows.
   *
   * It stops on the morning after the close at which the owner first
   * became « Magnat » (`dream.magnatOn`), opens « Magnat » and pauses; with
   * a panel already open, it opens when that panel closes. The full report
   * of that morning, if one comes, then waits for it to close, and a card
   * sliding in hides under it.
   *
   * It stops on the morning after the day that ends the game, the engine
   * playing no day past that, and opens its end in place of that morning's
   * report, the week's or the month's, pausing the game for good: the end
   * of the Défi, or the « Faillite » of a game that went bankrupt (see
   * `endPanel`); with a panel already open, it opens when that panel
   * closes. Once the game is over it does nothing.
   */
  advance: (days: number) => void
  /**
   * Opens `panel`, at its `section` if given: remembers the speed, even
   * `PAUSED`, and pauses. Does nothing if a panel is already open, so that
   * panel and the speed it remembered stay. The event card, « Magnat » and
   * the end of a game only open on their own. The report takes the card
   * sliding in away and counts the reports as read. It closes the drawer
   * open, if any. « Le camion » at « Fournil » shows that tab; « Ville »
   * opens on « Contrats » for that section, else on « Aller à… ».
   */
  openPanel: (
    panel: Exclude<Panel, 'event' | 'magnat' | EndPanel>,
    section?: PanelSection,
  ) => void
  /**
   * Opens `drawer`, on `tab` if given, else on the tab it showed last,
   * without pausing; with the drawer already open, it only moves to `tab`.
   * Does nothing while a panel is open. « Journal » opened with reports
   * unread and no tab given opens on « Bilans », where they are; it leaves
   * them unread until one opens (`readReports`).
   */
  openDrawer: <D extends Drawer>(drawer: D, tab?: DrawerTabs[D]) => void
  /** Counts the reports as read, as one opens in « Bilans ». */
  readReports: () => void
  /** Shows `tab` in `drawer`, open or not. */
  setDrawerTab: <D extends Drawer>(drawer: D, tab: DrawerTabs[D]) => void
  /** Opens the accordion `section` of « Entreprise », or closes it. */
  toggleFinanceSection: (section: FinanceSection) => void
  /** Shows `statement` over `period`, its accordion open or not. */
  setStatementPeriod: (statement: StatementTab, period: PeriodKey) => void
  /**
   * Opens « Finances » on « Entreprise », with the accordion `section`
   * open, as a tile asks; like `openDrawer`, without pausing, and not
   * while a panel is open.
   */
  showFinanceSection: (section: FinanceSection) => void
  /** Shows `tab` in « Le camion », open or not. */
  setTruckTab: (tab: TruckTab) => void
  /** Shows `tab` in « Ville ». */
  setCityTab: (tab: CityTab) => void
  /** Shows the ladder `tab` in « Améliorations ». */
  setDreamTab: (tab: Ladder) => void
  /**
   * Shows `grocer`'s card on « Contrats » of « Ville », open: the tab, and
   * the card brought into view once more.
   */
  pickGrocer: (grocer: GrocerId) => void
  /**
   * Notes that pick `count` brought its card into view: the card stays,
   * and is not brought again until the next pick.
   */
  settleCityPick: (count: number) => void
  /** Closes the drawer open, if any. */
  closeDrawer: () => void
  /**
   * Closes the panel and resumes at the speed it remembered. Once the game
   * is over, its end opens, or stays, in place, and the game stays paused.
   * Otherwise « Magnat » waiting opens first, then the full report
   * waiting, then, while an event waits for the player's choice, the event
   * card, which stays open; the game stays paused.
   */
  closePanel: () => void
  /** Takes the card sliding in away. */
  dismissSlideIn: () => void
  /**
   * Plays the player's choice on the event waiting, through the engine's
   * `resolveEvent()`. The card stays open, and the game paused, to show
   * what the choice did until `closePanel()`. Does nothing when no event
   * waits, so a second press changes nothing.
   */
  chooseEvent: (choiceId: string) => void
  /**
   * Hands the player's change to the engine's `applyDecision()`, which
   * leaves it waiting for the next morning, or buys a rung of « Améliorations »
   * or sends the owner to a place in town that very morning. Throws its
   * RangeError if the engine refuses it.
   */
  decide: (change: DecisionChange) => void
  /**
   * Plays `game` from now on, new or loaded, at normal speed: paused on the
   * event card if an event waits for the player's choice, and on its end if
   * it is over, a Défi or a game that went bankrupt. Closes the panel and
   * the drawer open, if any, puts the drawers back on their first tabs,
   * with every accordion of « Finances » closed, and counts the game in
   * `gamesStarted`.
   */
  startGame: (game: GameState) => void
}

export type GameStore = StoreApi<GameStoreState>

/** Fresh luck for each new game; only the engine has to be deterministic. */
function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
}

/**
 * The `seed` parameter of a page address's query string, such as
 * `?seed=42`, so a game can be replayed with `npm run sim -- --seed 42`.
 * Digits only, as for the sim's `--seed`: `Number()` alone would accept
 * "1e3" or " 7", and round a long string of digits to another number. Null
 * when the parameter is missing or not a safe whole number.
 */
export function seedFromSearch(search: string): number | null {
  const text = new URLSearchParams(search).get('seed')
  if (text === null || !/^\d+$/.test(text)) return null
  const seed = Number(text)
  return Number.isSafeInteger(seed) ? seed : null
}

/**
 * A new game for `profile` on the seed `search` names (see
 * `seedFromSearch`), or on a random one when it names none or one the
 * engine rejects. Throws a RangeError if the engine rejects `profile`.
 */
export function newGame(
  search: string,
  profile: Profile = defaultProfile(),
): GameState {
  const seed = seedFromSearch(search)
  if (seed !== null) {
    try {
      return createInitialState(seed, FOOD_TRUCK, profile)
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
    }
  }
  return createInitialState(randomSeed(), FOOD_TRUCK, profile)
}

/**
 * The Défi `defiId` for `profile`'s business name and avatar, on the seed
 * `search` names, or on a random one, as `newGame` picks it. Throws a
 * RangeError if no Défi has the id, or if the engine rejects `profile`.
 */
export function newChallenge(
  search: string,
  defiId: string,
  profile: Profile = defaultProfile(),
): GameState {
  // Checked first, so the RangeError of a seed the engine rejects is the
  // only one that falls back to a random seed.
  defiById(DEFIS, defiId)
  const start = (seed: number) =>
    startChallenge(defiId, seed, FOOD_TRUCK, DEFIS, DIFFICULTIES, profile)
  const seed = seedFromSearch(search)
  if (seed !== null) {
    try {
      return start(seed)
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
    }
  }
  return start(randomSeed())
}

/**
 * The panel that ends `game`, once it is over: the end of its Défi, or the
 * « Faillite » of a game that went bankrupt; null while it goes on.
 */
function endPanel(game: GameState): EndPanel | null {
  if (isChallengeOver(game)) return 'defiEnd'
  return game.ended !== null ? 'bankruptcy' : null
}

/**
 * The panel a game opens on: its end if it is over (see `endPanel`), the
 * event card if an event waits for the player's choice; null otherwise.
 */
function openingPanel(game: GameState): EndPanel | 'event' | null {
  const ending = endPanel(game)
  if (ending !== null) return ending
  return game.events.pending !== null ? 'event' : null
}

/**
 * The store's state for playing `game` from its start, at normal speed: on
 * its end or the event card, paused, if it opens on one (see
 * `openingPanel`). The report of a game loaded on its morning does not
 * show again, and only `lastWeek` is kept of its weeks.
 */
function playing(game: GameState) {
  const panel = openingPanel(game)
  const waiting = panel !== null
  return {
    game,
    speed: waiting ? PAUSED : NORMAL_SPEED,
    lastSpeed: NORMAL_SPEED,
    resumeSpeed: waiting ? NORMAL_SPEED : null,
    panel,
    panelSection: null,
    eventBefore: null,
    reportWaiting: false,
    magnatWaiting: false,
    weekReports: game.lastWeek === null ? [] : [game.lastWeek],
    monthReport: null,
    reportShown: 'week' as const,
    slideIn: null,
    drawer: null,
    drawerTabs: FIRST_DRAWER_TABS,
    financeSections: FIRST_FINANCE_SECTIONS,
    truckTab: FIRST_TRUCK_TAB,
    cityTab: 'trip' as const,
    dreamTab: 'personal' as const,
    cityPick: null,
    unreadReports: 0,
  }
}

/**
 * A store playing `game`, whose days draw the event cards from `events`
 * and whose choices play them out. With `weeklyReport`, it shows the
 * « Bilan » of the week on each Monday morning, or of the month on the 1st
 * (see `advance`); without, as for tests of other parts, the days run on.
 */
export function createGameStore(
  game: GameState = createInitialState(randomSeed()),
  events: EventContent = EVENTS,
  weeklyReport: WeeklyReportOptions | null = null,
): GameStore {
  return createStore<GameStoreState>()((set, get) => ({
    ...playing(game),
    gamesStarted: 0,
    setSpeed: (speed) => {
      if (get().resumeSpeed !== null) return
      set(speed > PAUSED ? { speed, lastSpeed: speed } : { speed })
    },
    togglePause: () => {
      const { speed, lastSpeed, resumeSpeed } = get()
      if (resumeSpeed !== null) return
      set({ speed: speed > PAUSED ? PAUSED : lastSpeed })
    },
    advance: (days) => {
      const {
        game: start,
        speed,
        resumeSpeed,
        panel,
        reportWaiting,
        magnatWaiting,
      } = get()
      if (
        days <= 0 ||
        endPanel(start) !== null ||
        start.events.pending !== null ||
        panel === 'event' ||
        panel === 'report' ||
        panel === 'magnat' ||
        reportWaiting ||
        magnatWaiting
      ) {
        return
      }
      let next = start
      let { weekReports } = get()
      let comes: ReportCadence | null = null
      let crowned = false
      for (
        let i = 0;
        i < days &&
        next.events.pending === null &&
        comes === null &&
        !crowned &&
        endPanel(next) === null;
        i += 1
      ) {
        const before = next
        next = tick(
          next,
          FOOD_TRUCK,
          CUSTOMERS,
          DIFFICULTIES,
          PERSONAL,
          ENERGY,
          events,
        )
        crowned = before.dream.magnatOn === null && next.dream.magnatOn !== null
        const closed = newWeekOf(before, next)
        if (closed !== null) weekReports = keepWeekReport(weekReports, closed)
        if (weeklyReport !== null) {
          comes = reportOnMorning(
            next.day,
            closed,
            weeklyReport.cadence?.() ?? 'week',
          )
        }
      }
      // The end of the game has the numbers, so it takes the place of the
      // week's or the month's report, or of its card sliding in, that
      // morning.
      const ending = endPanel(next)
      if (ending !== null) {
        set(
          resumeSpeed === null
            ? {
                game: next,
                weekReports,
                panel: ending,
                resumeSpeed: speed,
                speed: PAUSED,
                slideIn: null,
              }
            : { game: next, weekReports, slideIn: null },
        )
        return
      }
      const month = comes === 'month' ? monthReport(next, weekReports) : null
      // The week the morning brought, when its report comes.
      const week = comes === 'week' ? next.lastWeek : null
      const report = month ?? week
      const shown =
        month !== null
          ? { reportShown: 'month' as const, monthReport: month }
          : { reportShown: 'week' as const }
      const eventComes = next.events.pending !== null
      // The report goes first on a morning that brings both: it opens in
      // the event card's place, and closePanel() opens the card.
      const everyTime = weeklyReport?.everyWeek() ?? false
      const opens =
        report !== null &&
        (eventComes ||
          (week !== null ? opensFullReport(week, everyTime) : everyTime))
      if (crowned) {
        // « Magnat » goes first; the full report, then the event card,
        // follow it as closePanel() opens them.
        const after = opens
          ? { reportWaiting: true, slideIn: null }
          : report !== null
            ? {
                slideIn: report.firstDay,
                unreadReports: get().unreadReports + 1,
              }
            : { slideIn: get().slideIn }
        set(
          resumeSpeed === null
            ? {
                game: next,
                weekReports,
                ...shown,
                ...after,
                panel: 'magnat',
                resumeSpeed: speed,
                speed: PAUSED,
              }
            : {
                game: next,
                weekReports,
                ...shown,
                ...after,
                magnatWaiting: true,
              },
        )
      } else if (opens) {
        set(
          resumeSpeed === null
            ? {
                game: next,
                weekReports,
                ...shown,
                panel: 'report',
                resumeSpeed: speed,
                speed: PAUSED,
                slideIn: null,
                unreadReports: 0,
              }
            : {
                game: next,
                weekReports,
                ...shown,
                reportWaiting: true,
                slideIn: null,
              },
        )
      } else if (report !== null) {
        set({
          game: next,
          weekReports,
          ...shown,
          slideIn: report.firstDay,
          unreadReports: get().unreadReports + 1,
        })
      } else if (!eventComes || resumeSpeed !== null) {
        set({ game: next, weekReports })
      } else {
        set({
          game: next,
          weekReports,
          panel: 'event',
          resumeSpeed: speed,
          speed: PAUSED,
        })
      }
    },
    openPanel: (panel, section) => {
      const { speed, resumeSpeed } = get()
      if (resumeSpeed !== null) return
      set({
        resumeSpeed: speed,
        speed: PAUSED,
        panel,
        panelSection: section ?? null,
        drawer: null,
        ...(panel === 'manage' && section === 'bakery'
          ? { truckTab: 'bakery' as const }
          : {}),
        ...(panel === 'trip'
          ? {
              cityTab: section === 'contracts' ? 'contracts' : 'trip',
              cityPick: null,
            }
          : {}),
        ...(panel === 'report' ? { slideIn: null, unreadReports: 0 } : {}),
      })
    },
    openDrawer: (drawer, tab) => {
      const { resumeSpeed, drawerTabs, unreadReports } = get()
      if (resumeSpeed !== null) return
      const shown =
        tab ??
        (drawer === 'journal' && unreadReports > 0 ? 'reports' : undefined)
      set({
        drawer,
        drawerTabs:
          shown === undefined ? drawerTabs : { ...drawerTabs, [drawer]: shown },
      })
    },
    readReports: () => {
      if (get().unreadReports !== 0) set({ unreadReports: 0 })
    },
    setDrawerTab: (drawer, tab) =>
      set({ drawerTabs: { ...get().drawerTabs, [drawer]: tab } }),
    toggleFinanceSection: (section) => {
      const { financeSections } = get()
      const { open } = financeSections
      set({
        financeSections: {
          ...financeSections,
          open: { ...open, [section]: !open[section] },
        },
      })
    },
    setStatementPeriod: (statement, period) => {
      const { financeSections } = get()
      set({
        financeSections: {
          ...financeSections,
          periods: { ...financeSections.periods, [statement]: period },
        },
      })
    },
    showFinanceSection: (section) => {
      const { resumeSpeed, financeSections } = get()
      if (resumeSpeed !== null) return
      get().openDrawer('finances', 'company')
      set({
        financeSections: {
          ...financeSections,
          open: { ...financeSections.open, [section]: true },
        },
      })
    },
    setTruckTab: (truckTab) => set({ truckTab }),
    setCityTab: (cityTab) => set({ cityTab }),
    setDreamTab: (dreamTab) => set({ dreamTab }),
    pickGrocer: (grocer) =>
      set({
        cityTab: 'contracts',
        cityPick: {
          grocer,
          count: (get().cityPick?.count ?? 0) + 1,
          pending: true,
        },
      }),
    settleCityPick: (count) => {
      const { cityPick } = get()
      if (cityPick?.count === count && cityPick.pending)
        set({ cityPick: { ...cityPick, pending: false } })
    },
    closeDrawer: () => {
      if (get().drawer !== null) set({ drawer: null })
    },
    closePanel: () => {
      const {
        resumeSpeed,
        panel,
        game: current,
        reportWaiting,
        magnatWaiting,
      } = get()
      if (resumeSpeed === null) return
      const ending = endPanel(current)
      if (ending !== null) {
        if (panel !== ending) {
          set({
            panel: ending,
            panelSection: null,
            reportWaiting: false,
            magnatWaiting: false,
            eventBefore: null,
          })
        }
        return
      }
      if (magnatWaiting) {
        set({ panel: 'magnat', panelSection: null, magnatWaiting: false })
        return
      }
      if (reportWaiting) {
        set({
          panel: 'report',
          panelSection: null,
          reportWaiting: false,
          unreadReports: 0,
        })
        return
      }
      if (current.events.pending !== null) {
        if (panel !== 'event') set({ panel: 'event', panelSection: null })
        return
      }
      set({
        speed: resumeSpeed,
        resumeSpeed: null,
        panel: null,
        panelSection: null,
        eventBefore: null,
      })
    },
    chooseEvent: (choiceId) => {
      const { game: current } = get()
      if (current.events.pending === null) return
      set({
        game: resolveEvent(current, choiceId, events),
        eventBefore: current,
      })
    },
    dismissSlideIn: () => {
      if (get().slideIn !== null) set({ slideIn: null })
    },
    decide: (change) => set({ game: applyDecision(get().game, change) }),
    startGame: (next) =>
      set({ ...playing(next), gamesStarted: get().gamesStarted + 1 }),
  }))
}

/**
 * The store the app runs on, with the report of the week or the month as
 * the player's settings say. Until the start screen hands it the game to
 * play, it holds a new game with the default profile, seeded from the page
 * address when it has a `?seed=`, for the world to draw behind the menu.
 * Tests build their own with `createGameStore`.
 */
export const gameStore = createGameStore(
  newGame(typeof window === 'undefined' ? '' : window.location.search),
  EVENTS,
  {
    everyWeek: () => settingsStore.getState().openReportEveryWeek,
    cadence: () => settingsStore.getState().reportCadence,
  },
)

/**
 * Reads the app store. Select one field per call: a selector that builds a
 * new object re-renders on every change.
 */
export function useGame<T>(selector: (state: GameStoreState) => T): T {
  return useStore(gameStore, selector)
}
