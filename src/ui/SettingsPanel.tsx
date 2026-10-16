import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { downloadSave } from './saves.ts'
import {
  settingsStore,
  VISUAL_EFFECTS,
  type SettingsStore,
  type VisualEffects,
} from './settings.ts'
import {
  createSaveImports,
  importAction,
  takePickedFile,
} from './settingsPanel.ts'
import { gameStore, useGame } from './store.ts'
import './panel.css'
import './SettingsPanel.css'

const TITLE_ID = 'settings-title'
const IMPORT_HINT_ID = 'settings-import-hint'

const EFFECTS: Record<VisualEffects, string> = {
  full: 'Complets',
  simple: 'Simples',
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
        Les effets simples allègent la rue pour les ordinateurs plus lents.
      </p>
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
  /** Whether « Ouvrir le bilan chaque semaine » is on. */
  everyWeek: boolean
  onEveryWeekChange: (everyWeek: boolean) => void
  /** Downloads the game played. */
  onExport: () => void
  onImport: (file: File) => void
  /** Why the last imported file was rejected, if it was. */
  importError: string | null
  onClose: () => void
}

/**
 * « Réglages »: the visual effects, the switch that opens the « Bilan de la
 * semaine » every week, and the game's export and import.
 */
export function SettingsPanelView({
  visualEffects,
  onVisualEffectsChange,
  everyWeek,
  onEveryWeekChange,
  onExport,
  onImport,
  importError,
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
      <fieldset className="settings-panel__setting">
        <legend>Bilan de la semaine</legend>
        <label className="settings-panel__switch">
          <input
            type="checkbox"
            role="switch"
            checked={everyWeek}
            onChange={(event) => onEveryWeekChange(event.target.checked)}
          />
          Ouvrir le bilan chaque semaine
        </label>
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
    </div>
  )
}

/**
 * « Réglages » in a modal dialog, wired to `settings` and the app store: it
 * exports the game played, and plays the game a file imported holds in its
 * place, which closes the panel. Fermer or Escape closes it.
 */
export default function SettingsPanel({
  settings = settingsStore,
}: {
  settings?: SettingsStore
}) {
  const closePanel = useGame((state) => state.closePanel)
  const startGame = useGame((state) => state.startGame)
  const visualEffects = useStore(settings, (state) => state.visualEffects)
  const setVisualEffects = useStore(settings, (state) => state.setVisualEffects)
  const everyWeek = useStore(settings, (state) => state.openReportEveryWeek)
  const setEveryWeek = useStore(
    settings,
    (state) => state.setOpenReportEveryWeek,
  )
  const [imports] = useState(() => createSaveImports())
  const [importError, setImportError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    // StrictMode runs this twice; the second time, the dialog is open.
    if (dialog !== null && !dialog.open) dialog.showModal()
  }, [])

  // Once the panel closes, a file still being read must not start its game.
  useEffect(() => () => imports.cancel(), [imports])

  const importFile = importAction({
    imports,
    onStart: startGame,
    onImportError: setImportError,
  })

  return (
    <dialog
      ref={dialogRef}
      className="panel settings-panel"
      aria-labelledby={TITLE_ID}
      onClose={closePanel}
    >
      <SettingsPanelView
        visualEffects={visualEffects}
        onVisualEffectsChange={setVisualEffects}
        everyWeek={everyWeek}
        onEveryWeekChange={setEveryWeek}
        onExport={() => downloadSave(gameStore.getState().game)}
        onImport={(file) => void importFile(file)}
        importError={importError}
        onClose={() => dialogRef.current?.close()}
      />
    </dialog>
  )
}
