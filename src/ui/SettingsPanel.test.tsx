import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createSettingsStore,
  type ReportCadence,
  type SettingsStorage,
  type VisualEffects,
} from './settings.ts'
import SettingsPanel, {
  ImportButton,
  SettingsPanelView,
  VisualEffectsField,
} from './SettingsPanel.tsx'
import { gameStore, type GameStoreState } from './store.ts'

// A static render reads a Zustand store's initial state, so the connected
// panel reads the app store's current state through this stand-in.
vi.mock('./store.ts', async (importOriginal) => {
  const store = await importOriginal<typeof import('./store.ts')>()
  return {
    ...store,
    useGame: <T,>(selector: (state: GameStoreState) => T): T =>
      selector(store.gameStore.getState()),
  }
})

afterEach(() => {
  gameStore.setState(gameStore.getInitialState(), true)
})

interface ViewOptions {
  visualEffects?: VisualEffects
  cadence?: ReportCadence
  everyWeek?: boolean
  importError?: string | null
}

function props({
  visualEffects = 'full',
  cadence = 'week',
  everyWeek = false,
  importError = null,
}: ViewOptions = {}) {
  return {
    visualEffects,
    onVisualEffectsChange: vi.fn<(visualEffects: VisualEffects) => void>(),
    cadence,
    onCadenceChange: vi.fn<(cadence: ReportCadence) => void>(),
    everyWeek,
    onEveryWeekChange: vi.fn<(everyWeek: boolean) => void>(),
    onExport: vi.fn<() => void>(),
    onImport: vi.fn<(file: File) => void>(),
    importError,
    onClose: vi.fn<() => void>(),
  }
}

function render(options: ViewOptions = {}) {
  return renderToStaticMarkup(<SettingsPanelView {...props(options)} />)
}

/**
 * Each radio button of the visual effects, or of the setting `name`: its
 * value and whether checked.
 */
function radios(html: string, name = 'visualEffects') {
  return [
    ...html.matchAll(
      new RegExp(`<input type="radio" name="${name}"[^>]*>`, 'g'),
    ),
  ].map(([tag]) => ({
    value: /value="([^"]*)"/.exec(tag)?.[1],
    checked: tag.includes('checked=""'),
  }))
}

/** Every element in `node` and its children, in order, `node` included. */
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return (node as ReactNode[]).flatMap(elements)
  if (!isValidElement(node)) return []
  const { children } = node.props as { children?: ReactNode }
  return [node, ...elements(children)]
}

/**
 * The first element of `type` in `node`, such as 'input' or a component,
 * whose props pass `test`, if given.
 */
function find<P>(node: ReactNode, type: unknown, test?: (props: P) => boolean) {
  const found = elements(node).find(
    (element) => element.type === type && (test?.(element.props as P) ?? true),
  )
  if (found === undefined) throw new Error('No such element')
  return found as ReactElement<P>
}

describe('SettingsPanelView', () => {
  it('puts Fermer first, then the « Réglages » title', () => {
    expect(render()).toMatch(
      /^<div class="panel__content"><div class="panel__header"><button type="button" class="toggle">Fermer<\/button><h2 id="settings-title">Réglages<\/h2><\/div>/,
    )
  })

  it.each<VisualEffects>(['full', 'simple'])(
    'offers « Complets » and « Simples », %s checked',
    (visualEffects) => {
      const html = render({ visualEffects })
      expect(html).toContain(
        '<fieldset class="settings-panel__setting"><legend>Effets visuels</legend>',
      )
      expect(radios(html)).toEqual([
        { value: 'full', checked: visualEffects === 'full' },
        { value: 'simple', checked: visualEffects === 'simple' },
      ])
      expect(html).toMatch(/>Complets<\/label>.*>Simples<\/label>/)
    },
  )

  it.each<ReportCadence>(['week', 'month'])(
    'offers the « Bilan » « Chaque semaine » or « Chaque mois », %s checked',
    (cadence) => {
      const html = render({ cadence })
      expect(html).toContain(
        '<fieldset class="settings-panel__setting"><legend>Bilan</legend><div class="settings-panel__options">',
      )
      expect(radios(html, 'reportCadence')).toEqual([
        { value: 'week', checked: cadence === 'week' },
        { value: 'month', checked: cadence === 'month' },
      ])
      expect(html).toMatch(/>Chaque semaine<\/label>.*>Chaque mois<\/label>/)
    },
  )

  it.each([false, true])(
    'has the « Ouvrir le bilan chaque semaine » switch, on: %s',
    (everyWeek) => {
      const checked = everyWeek ? ' checked=""' : ''
      const html = render({ everyWeek })
      expect(html).toContain(
        `>Chaque mois</label></div><label class="settings-panel__switch"><input type="checkbox" role="switch"${checked}/>Ouvrir le bilan chaque semaine</label></fieldset>`,
      )
    },
  )

  it('names the switch « Ouvrir le bilan chaque mois » with the monthly report, and says the first weeks stay weekly', () => {
    const html = render({ cadence: 'month', everyWeek: true })
    expect(html).toContain(
      '<input type="checkbox" role="switch" checked=""/>Ouvrir le bilan chaque mois</label>' +
        '<p class="settings-panel__hint">Le bilan reste hebdomadaire les 4 premières semaines.</p></fieldset>',
    )
    expect(render()).not.toContain('premières semaines')
  })

  it('exports and imports the game last, the import taking a JSON file', () => {
    expect(render()).toMatch(
      /<fieldset class="settings-panel__setting"><legend>Partie<\/legend><div class="settings-panel__actions"><button type="button" class="button">Exporter la partie<\/button><button type="button" class="button" aria-describedby="settings-import-hint">Importer une partie<\/button><input type="file" accept=".json,application\/json" hidden=""\/><\/div><p id="settings-import-hint" class="settings-panel__hint">La partie importée remplacera la partie en cours\.<\/p><\/fieldset><\/div>$/,
    )
  })

  it('shows why an imported file was rejected, as an alert', () => {
    const error = "Ce fichier n'est pas une sauvegarde valide de Magnat."
    expect(render({ importError: error })).toMatch(
      /<\/p><p class="settings-panel__error" role="alert">Ce fichier n&#x27;est pas une sauvegarde valide de Magnat\.<\/p><\/fieldset><\/div>$/,
    )
    expect(render()).not.toContain('role="alert"')
  })

  it('reports what the player does', () => {
    const wired = props()
    const view = SettingsPanelView(wired)
    const button = (text: string) =>
      find<{ children: ReactNode; onClick: () => void }>(
        view,
        'button',
        ({ children }) => children === text,
      ).props

    button('Fermer').onClick()
    expect(wired.onClose).toHaveBeenCalledOnce()
    button('Exporter la partie').onClick()
    expect(wired.onExport).toHaveBeenCalledOnce()
    expect(find<{ onImport: unknown }>(view, ImportButton).props.onImport).toBe(
      wired.onImport,
    )
    expect(
      find<{ onChange: unknown }>(view, VisualEffectsField).props.onChange,
    ).toBe(wired.onVisualEffectsChange)
    const toggle = find<{
      onChange: (event: { target: { checked: boolean } }) => void
    }>(view, 'input', (input) => 'role' in input).props
    toggle.onChange({ target: { checked: true } })
    toggle.onChange({ target: { checked: false } })
    expect(wired.onEveryWeekChange.mock.calls).toEqual([[true], [false]])
    for (const cadence of ['month', 'week'] as const) {
      find<{ name: string; value: string; onChange: () => void }>(
        view,
        'input',
        (input) => input.name === 'reportCadence' && input.value === cadence,
      ).props.onChange()
    }
    expect(wired.onCadenceChange.mock.calls).toEqual([['month'], ['week']])
  })
})

describe('VisualEffectsField', () => {
  it('reports the effects the player picks', () => {
    const picked: VisualEffects[] = []
    const field = VisualEffectsField({
      visualEffects: 'full',
      onChange: (effects) => picked.push(effects),
    })
    for (const input of elements(field).filter(
      ({ type }) => type === 'input',
    )) {
      ;(input.props as { onChange: () => void }).onChange()
    }
    expect(picked).toEqual(['full', 'simple'])
  })
})

/** An in-memory `localStorage`, which one store writes and another reads. */
function memoryStorage(): SettingsStorage {
  const items: Record<string, string> = {}
  return {
    getItem: (key) => items[key] ?? null,
    setItem: (key, value) => {
      items[key] = value
    },
  }
}

describe('SettingsPanel', () => {
  it('opens as a modal dialog in the dock’s frame, titled « Réglages »', () => {
    gameStore.getState().openPanel('settings')
    expect(renderToStaticMarkup(<SettingsPanel />)).toMatch(
      /^<dialog class="panel dock-frame dock-panel settings-panel" aria-labelledby="([^"]+)"><div class="dock-frame__header"><h2 id="\1" class="dock-frame__title">Réglages<\/h2>.*<div class="panel__content">.*<\/div><\/dialog>$/,
    )
  })

  it('shows the settings the browser keeps, the defaults first', () => {
    const html = renderToStaticMarkup(
      <SettingsPanel settings={createSettingsStore(null)} />,
    )
    expect(radios(html)).toEqual([
      { value: 'full', checked: true },
      { value: 'simple', checked: false },
    ])
    expect(html).toContain('<input type="checkbox" role="switch"/>')
    expect(radios(html, 'reportCadence')).toEqual([
      { value: 'week', checked: true },
      { value: 'month', checked: false },
    ])
  })

  it('keeps each setting the player changes for the next visit', () => {
    const storage = memoryStorage()
    const now = createSettingsStore(storage)
    now.getState().setVisualEffects('simple')
    now.getState().setOpenReportEveryWeek(true)
    now.getState().setReportCadence('month')

    const html = renderToStaticMarkup(
      <SettingsPanel settings={createSettingsStore(storage)} />,
    )
    expect(radios(html)).toEqual([
      { value: 'full', checked: false },
      { value: 'simple', checked: true },
    ])
    expect(html).toContain('<input type="checkbox" role="switch" checked=""/>')
    expect(radios(html, 'reportCadence')).toEqual([
      { value: 'week', checked: false },
      { value: 'month', checked: true },
    ])

    now.getState().setVisualEffects('full')
    now.getState().setOpenReportEveryWeek(false)
    const back = renderToStaticMarkup(
      <SettingsPanel settings={createSettingsStore(storage)} />,
    )
    expect(radios(back)).toEqual([
      { value: 'full', checked: true },
      { value: 'simple', checked: false },
    ])
    expect(back).toContain('<input type="checkbox" role="switch"/>')
  })
})
