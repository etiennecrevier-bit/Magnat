import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { DISPLAY } from '../content/display.ts'
import pacing from '../content/pacing.json'
import { TUTORIAL } from '../engine/tutorial.ts'
import { DockPanel } from './DockFrame.tsx'
import { useModal } from './dockFrame.ts'
import { downloadSave } from './saves.ts'
import {
  REPORT_CADENCES,
  settingsStore,
  VISUAL_EFFECTS,
  type ReportCadence,
  type SettingsStore,
  type VisualEffects,
} from './settings.ts'
import {
  createSaveImports,
  importAction,
  replayTour,
  takePickedFile,
} from './settingsPanel.ts'
import { gameStore, useGame } from './store.ts'
import './panel.css'
import './SettingsPanel.css'

const TITLE_ID = 'settings-title'
const IMPORT_HINT_ID = 'settings-import-hint'
const REPLAY_HINT_ID = 'settings-replay-hint'

const EFFECTS: Record<VisualEffects, string> = {
  full: 'Complets',
  simple: 'Simples',
}

const CADENCES: Record<ReportCadence, string> = {
  week: 'Chaque semaine',
  month: 'Chaque mois',
}

const EVERY_TIME: Record<ReportCadence, string> = {
  week: 'Ouvrir le bilan chaque semaine',
  month: 'Ouvrir le bilan chaque mois',
}

interface VisualEffectsFieldProps {
  visualEffects: VisualEffects
  onChange: (visualEffects: VisualEffects) => void
}

/**
 * The « Effets visuels » setting: complets, or simples for slower
 * computers. The street behind the panel shows the change at once.
 */
export function VisualEffectsField({
  visualEffects,
  onChange,
}: VisualEffectsFieldProps) {
  return (
    <fieldset className="settings-panel__setting">
      <legend>Effets visuels</legend>
      <div className="settings-panel__options">
        {VISUAL_EFFECTS.map((option) => (
          <label key={option} className="settings-panel__option">
            <input
              type="radio"
              name="visualEffects"
              value={option}
              checked={option === visualEffects}
              onChange={() => onChange(option)}
            />
            {EFFECTS[option]}
          </label>
        ))}
      </div>
      <p className="settings-panel__hint">
        Les effets simples ménagent les ordinateurs lents.
      </p>
    </fieldset>
  )
}

/**
 * The « Fluidité » setting (#281): the most frames a second the world
 * draws, of the content's rates. The street behind the panel follows it at
 * once.
 */
export function FrameRateField({
  frameRate,
  onChange,
}: {
  frameRate: number
  onChange: (frameRate: number) => void
}) {
  return (
    <fieldset className="settings-panel__setting">
      <legend>Fluidité</legend>
      <div className="settings-panel__options">
        {DISPLAY.frameRates.map((option) => (
          <label key={option} className="settings-panel__option">
            <input
              type="radio"
              name="frameRate"
              value={option}
              checked={option === frameRate}
              onChange={() => onChange(option)}
            />
            {option} images par seconde
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** Where « Refaire la visite » stands: asked, confirming, or the save failed. */
export type ReplayStep = 'idle' | 'confirm' | 'saveFailed'

interface ReplayTourFieldProps {
  step: ReplayStep
  onAsk: () => void
  onConfirm: () => void
  /** « Refaire quand même », once the save failed. */
  onAnyway: () => void
  onCancel: () => void
}

/**
 * « Refaire la visite » (#238): asks to confirm that the game played is
 * saved first, and says so when the save fails, before Réal's tour starts.
 */
export function ReplayTourField({
  step,
  onAsk,
  onConfirm,
  onAnyway,
  onCancel,
}: ReplayTourFieldProps) {
  const { replay } = TUTORIAL.coach
  return (
    <fieldset className="settings-panel__setting">
      <legend>{replay.button}</legend>
      {step === 'idle' ? (
        <>
          <div className="settings-panel__actions">
            <button
              type="button"
              className="button"
              aria-describedby={REPLAY_HINT_ID}
              onClick={onAsk}
            >
              {replay.button}
            </button>
          </div>
          <p id={REPLAY_HINT_ID} className="settings-panel__hint">
            {replay.hint}
          </p>
        </>
      ) : (
        <>
          {step === 'confirm' ? (
            <p className="settings-panel__hint">{replay.confirm}</p>
          ) : (
            <p className="settings-panel__error" role="alert">
              {replay.saveFailed}
            </p>
          )}
          <div className="settings-panel__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={step === 'confirm' ? onConfirm : onAnyway}
            >
              {step === 'confirm' ? replay.yes : replay.anyway}
            </button>
            <button type="button" className="button" onClick={onCancel}>
              {replay.no}
            </button>
          </div>
        </>
      )}
    </fieldset>
  )
}

/** « Importer une partie », which opens the browser's file picker. */
export function ImportButton({ onImport }: { onImport: (file: File) => void }) {
  const fileInput = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        type="button"
        className="button"
        aria-describedby={IMPORT_HINT_ID}
        onClick={() => fileInput.current?.click()}
      >
        Importer une partie
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => takePickedFile(event.target, onImport)}
      />
    </>
  )
}

interface SettingsPanelViewProps {
  /** The visual effects the player picked, kept in this browser. */
  visualEffects: VisualEffects
  onVisualEffectsChange: (visualEffects: VisualEffects) => void
  /** « Fluidité »: the most frames a second the world draws. */
  frameRate?: number
  onFrameRateChange?: (frameRate: number) => void
  /** How often the « Bilan » comes after the first weeks of a game. */
  cadence: ReportCadence
  onCadenceChange: (cadence: ReportCadence) => void
  /** Whether « Ouvrir le bilan chaque semaine », or « chaque mois », is on. */
  everyWeek: boolean
  onEveryWeekChange: (everyWeek: boolean) => void
  /** Downloads the game played. */
  onExport: () => void
  onImport: (file: File) => void
  /** Why the last imported file was rejected, if it was. */
  importError: string | null
  /** « Refaire la visite »; null hides it, as in a Défi. */
  replay?: ReplayTourFieldProps | null
  onClose: () => void
}

/**
 * « Réglages »: the visual effects, the frame rate, the « Bilan » every week or every
 * month, with the switch that opens it in full each time, the game's
 * export and import, and « Refaire la visite » outside a Défi.
 */
export function SettingsPanelView({
  visualEffects,
  onVisualEffectsChange,
  frameRate = DISPLAY.defaultFrameRate,
  onFrameRateChange = () => {},
  cadence,
  onCadenceChange,
  everyWeek,
  onEveryWeekChange,
  onExport,
  onImport,
  importError,
  replay = null,
  onClose,
}: SettingsPanelViewProps) {
  return (
    <div className="panel__content">
      {/* Fermer comes first so it has the focus when the panel opens. */}
      <div className="panel__header">
        <button type="button" className="toggle" onClick={onClose}>
          Fermer
        </button>
        <h2 id={TITLE_ID}>Réglages</h2>
      </div>
      <VisualEffectsField
        visualEffects={visualEffects}
        onChange={onVisualEffectsChange}
      />
      <FrameRateField frameRate={frameRate} onChange={onFrameRateChange} />
      <fieldset className="settings-panel__setting">
        <legend>Bilan</legend>
        <div className="settings-panel__options">
          {REPORT_CADENCES.map((option) => (
            <label key={option} className="settings-panel__option">
              <input
                type="radio"
                name="reportCadence"
                value={option}
                checked={option === cadence}
                onChange={() => onCadenceChange(option)}
              />
              {CADENCES[option]}
            </label>
          ))}
        </div>
        <label className="settings-panel__switch">
          <input
            type="checkbox"
            role="switch"
            checked={everyWeek}
            onChange={(event) => onEveryWeekChange(event.target.checked)}
          />
          {EVERY_TIME[cadence]}
        </label>
        {cadence === 'month' && (
          <p className="settings-panel__hint">
            Bilan hebdomadaire les {pacing.fullReportWeeks} premières semaines.
          </p>
        )}
      </fieldset>
      <fieldset className="settings-panel__setting">
        <legend>Partie</legend>
        <div className="settings-panel__actions">
          <button type="button" className="button" onClick={onExport}>
            Exporter la partie
          </button>
          <ImportButton onImport={onImport} />
        </div>
        <p id={IMPORT_HINT_ID} className="settings-panel__hint">
          La partie importée remplacera la partie en cours.
        </p>
        {importError !== null && (
          <p className="settings-panel__error" role="alert">
            {importError}
          </p>
        )}
      </fieldset>
      {replay !== null && <ReplayTourField {...replay} />}
    </div>
  )
}

/**
 * « Réglages » in the dock's frame, a modal dialog, wired to `settings` and
 * the app store: it exports the game played, and plays the game a file
 * imported holds in its place, which closes the panel. « Refaire la
 * visite » saves the game with `saveGame` and starts Réal's tour in its
 * place (see `replayTour`), never in a Défi. « ✕ » or Escape closes it.
 */
export default function SettingsPanel({
  settings = settingsStore,
  saveGame = () => false,
}: {
  settings?: SettingsStore
  /** Saves the game played now; whether it did. */
  saveGame?: () => boolean
}) {
  const closePanel = useGame((state) => state.closePanel)
  const startGame = useGame((state) => state.startGame)
  const visualEffects = useStore(settings, (state) => state.visualEffects)
  const setVisualEffects = useStore(settings, (state) => state.setVisualEffects)
  const frameRate = useStore(settings, (state) => state.frameRate)
  const setFrameRate = useStore(settings, (state) => state.setFrameRate)
  const cadence = useStore(settings, (state) => state.reportCadence)
  const setCadence = useStore(settings, (state) => state.setReportCadence)
  const everyWeek = useStore(settings, (state) => state.openReportEveryWeek)
  const setEveryWeek = useStore(
    settings,
    (state) => state.setOpenReportEveryWeek,
  )
  const [imports] = useState(() => createSaveImports())
  const [importError, setImportError] = useState<string | null>(null)
  const [replayStep, setReplayStep] = useState<ReplayStep>('idle')
  const inChallenge = useGame((state) => state.game.challenge !== null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  useModal(dialogRef)

  // Once the panel closes, a file still being read must not start its game.
  useEffect(() => () => imports.cancel(), [imports])

  const importFile = importAction({
    imports,
    onStart: startGame,
    onImportError: setImportError,
  })

  return (
    <DockPanel
      dialogRef={dialogRef}
      className="settings-panel"
      title="Réglages"
      onClose={closePanel}
      onDismiss={() => dialogRef.current?.close()}
    >
      <SettingsPanelView
        visualEffects={visualEffects}
        onVisualEffectsChange={setVisualEffects}
        frameRate={frameRate}
        onFrameRateChange={setFrameRate}
        cadence={cadence}
        onCadenceChange={setCadence}
        everyWeek={everyWeek}
        onEveryWeekChange={setEveryWeek}
        onExport={() => downloadSave(gameStore.getState().game)}
        onImport={(file) => void importFile(file)}
        importError={importError}
        replay={
          inChallenge
            ? null
            : {
                step: replayStep,
                onAsk: () => setReplayStep('confirm'),
                onConfirm: () => {
                  if (!replayTour(gameStore, saveGame)) {
                    setReplayStep('saveFailed')
                  }
                },
                onAnyway: () => replayTour(gameStore, saveGame, true),
                onCancel: () => setReplayStep('idle'),
              }
        }
        onClose={() => dialogRef.current?.close()}
      />
    </DockPanel>
  )
}
