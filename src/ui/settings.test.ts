import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  betterMedal,
  createSettingsStore,
  DEFAULT_SETTINGS,
  mergeMedals,
  readSettings,
  SETTINGS_KEY,
  settingsStore,
  writeSettings,
  type SettingsStorage,
  type SettingsStore,
} from './settings.ts'

/** A storage holding `items`, which the test can read back. */
function memory(items: Record<string, string> = {}): SettingsStorage & {
  items: Record<string, string>
} {
  return {
    items,
    getItem: (key) => items[key] ?? null,
    setItem: (key, value) => {
      items[key] = value
    },
  }
}

/** A storage that throws on every access, as a blocked one does. */
const BLOCKED: SettingsStorage = {
  getItem: () => {
    throw new DOMException('The operation is insecure.', 'SecurityError')
  },
  setItem: () => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
  },
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the settings', () => {
  it('start with the full visual effects, the weekly report in full only at first and the screens unfolded', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      visualEffects: 'full',
      openReportEveryWeek: false,
      reportCadence: 'week',
      bestMedals: {},
      screensFolded: false,
      worldView: 'street',
    })
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(readSettings(memory())).toEqual(DEFAULT_SETTINGS)
    expect(createSettingsStore(null).getState().visualEffects).toBe('full')
  })

  it('keep the effects the player picks in this browser, under magnat.reglages', () => {
    const storage = memory()
    createSettingsStore(storage).getState().setVisualEffects('simple')
    expect(SETTINGS_KEY).toBe('magnat.reglages')
    expect(JSON.parse(storage.items[SETTINGS_KEY]!)).toEqual({
      visualEffects: 'simple',
      openReportEveryWeek: false,
      reportCadence: 'week',
      bestMedals: {},
      screensFolded: false,
      worldView: 'street',
    })
    expect(createSettingsStore(storage).getState().visualEffects).toBe('simple')
  })

  it('keep « Ouvrir le bilan chaque semaine » in this browser', () => {
    const storage = memory()
    createSettingsStore(storage).getState().setOpenReportEveryWeek(true)
    expect(JSON.parse(storage.items[SETTINGS_KEY]!)).toEqual({
      visualEffects: 'full',
      openReportEveryWeek: true,
      reportCadence: 'week',
      bestMedals: {},
      screensFolded: false,
      worldView: 'street',
    })
    expect(createSettingsStore(storage).getState().openReportEveryWeek).toBe(
      true,
    )
  })

  it('keep « Bilan : chaque mois » in this browser', () => {
    const storage = memory()
    createSettingsStore(storage).getState().setReportCadence('month')
    expect(JSON.parse(storage.items[SETTINGS_KEY]!)).toEqual({
      visualEffects: 'full',
      openReportEveryWeek: false,
      reportCadence: 'month',
      bestMedals: {},
      screensFolded: false,
      worldView: 'street',
    })
    expect(createSettingsStore(storage).getState().reportCadence).toBe('month')
  })

  it('keep the screens folded in this browser, after a reload', () => {
    const storage = memory()
    createSettingsStore(storage).getState().setVisualEffects('simple')
    createSettingsStore(storage).getState().setScreensFolded(true)
    expect(JSON.parse(storage.items[SETTINGS_KEY]!)).toEqual({
      visualEffects: 'simple',
      openReportEveryWeek: false,
      reportCadence: 'week',
      bestMedals: {},
      screensFolded: true,
      worldView: 'street',
    })
    const reloaded = createSettingsStore(storage)
    expect(reloaded.getState().screensFolded).toBe(true)

    reloaded.getState().setScreensFolded(false)
    expect(readSettings(storage)).toEqual({
      visualEffects: 'simple',
      openReportEveryWeek: false,
      reportCadence: 'week',
      bestMedals: {},
      screensFolded: false,
      worldView: 'street',
    })
    expect(createSettingsStore(storage).getState().screensFolded).toBe(false)
  })

  it('keep the view of the world the player picks, the street or the city, after a reload', () => {
    const storage = memory()
    expect(createSettingsStore(storage).getState().worldView).toBe('street')
    createSettingsStore(storage).getState().setWorldView('city')
    expect(JSON.parse(storage.items[SETTINGS_KEY]!).worldView).toBe('city')
    expect(createSettingsStore(storage).getState().worldView).toBe('city')
  })

  it('show the street for a view this version does not know', () => {
    const storage = memory({
      [SETTINGS_KEY]: JSON.stringify({ worldView: 'map', screensFolded: true }),
    })
    expect(readSettings(storage)).toMatchObject({
      worldView: 'street',
      screensFolded: true,
    })
  })

  it('tell those listening when the screens fold', () => {
    const store = createSettingsStore(memory())
    const heard: boolean[] = []
    store.subscribe((state) => heard.push(state.screensFolded))
    store.getState().setScreensFolded(true)
    store.getState().setScreensFolded(false)
    expect(heard).toEqual([true, false])
  })

  it('keep each setting when the other changes, after a reload', () => {
    const storage = memory()
    createSettingsStore(storage).getState().setVisualEffects('simple')
    createSettingsStore(storage).getState().setOpenReportEveryWeek(true)
    expect(readSettings(storage)).toEqual({
      visualEffects: 'simple',
      openReportEveryWeek: true,
      reportCadence: 'week',
      bestMedals: {},
      screensFolded: false,
      worldView: 'street',
    })

    createSettingsStore(storage).getState().setVisualEffects('full')
    expect(readSettings(storage)).toEqual({
      visualEffects: 'full',
      openReportEveryWeek: true,
      reportCadence: 'week',
      bestMedals: {},
      screensFolded: false,
      worldView: 'street',
    })
    createSettingsStore(storage).getState().setOpenReportEveryWeek(false)
    expect(readSettings(storage)).toEqual({
      visualEffects: 'full',
      openReportEveryWeek: false,
      reportCadence: 'week',
      bestMedals: {},
      screensFolded: false,
      worldView: 'street',
    })
    createSettingsStore(storage).getState().setReportCadence('month')
    createSettingsStore(storage).getState().setVisualEffects('simple')
    expect(readSettings(storage)).toEqual({
      visualEffects: 'simple',
      openReportEveryWeek: false,
      reportCadence: 'month',
      bestMedals: {},
      screensFolded: false,
      worldView: 'street',
    })
  })

  it('read the settings an older version kept, without the report settings', () => {
    const storage = memory({
      [SETTINGS_KEY]: JSON.stringify({ visualEffects: 'simple' }),
    })
    expect(readSettings(storage)).toEqual({
      visualEffects: 'simple',
      openReportEveryWeek: false,
      reportCadence: 'week',
      bestMedals: {},
      screensFolded: false,
      worldView: 'street',
    })
  })

  it.each([
    [
      { visualEffects: 'ultra', openReportEveryWeek: true },
      {
        visualEffects: 'full',
        openReportEveryWeek: true,
        reportCadence: 'week',
        bestMedals: {},
        screensFolded: false,
        worldView: 'street',
      },
    ],
    [
      { visualEffects: 'simple', openReportEveryWeek: 'oui' },
      {
        visualEffects: 'simple',
        openReportEveryWeek: false,
        reportCadence: 'week',
        bestMedals: {},
        screensFolded: false,
        worldView: 'street',
      },
    ],
    [
      { reportCadence: 'year', openReportEveryWeek: true },
      {
        visualEffects: 'full',
        openReportEveryWeek: true,
        reportCadence: 'week',
        bestMedals: {},
        screensFolded: false,
        worldView: 'street',
      },
    ],
    [
      { visualEffects: 'ultra', reportCadence: 'month' },
      {
        visualEffects: 'full',
        openReportEveryWeek: false,
        reportCadence: 'month',
        bestMedals: {},
        screensFolded: false,
        worldView: 'street',
      },
    ],
    [
      { visualEffects: 'simple', screensFolded: 'oui' },
      {
        visualEffects: 'simple',
        openReportEveryWeek: false,
        reportCadence: 'week',
        bestMedals: {},
        screensFolded: false,
        worldView: 'street',
      },
    ],
    [
      { visualEffects: 'ultra', screensFolded: true },
      {
        visualEffects: 'full',
        openReportEveryWeek: false,
        reportCadence: 'week',
        bestMedals: {},
        screensFolded: true,
        worldView: 'street',
      },
    ],
  ])('keep a valid setting beside an invalid one: %j', (stored, settings) => {
    const storage = memory({ [SETTINGS_KEY]: JSON.stringify(stored) })
    expect(readSettings(storage)).toEqual(settings)
  })

  it('tell those listening when the weekly report setting changes', () => {
    const store = createSettingsStore(memory())
    const heard: boolean[] = []
    store.subscribe((state) => heard.push(state.openReportEveryWeek))
    store.getState().setOpenReportEveryWeek(true)
    expect(heard).toEqual([true])
  })

  it('tell those listening when the effects change', () => {
    const store = createSettingsStore(memory())
    const heard: string[] = []
    store.subscribe((state) => heard.push(state.visualEffects))
    store.getState().setVisualEffects('simple')
    expect(heard).toEqual(['simple'])
  })

  it.each([
    ['not JSON', '{'],
    ['an unknown setting', JSON.stringify({ visualEffects: 'ultra' })],
    ['not an object', JSON.stringify('simple')],
    ['null', 'null'],
  ])('fall back to the defaults when the stored ones are %s', (_, text) => {
    expect(readSettings(memory({ [SETTINGS_KEY]: text }))).toEqual(
      DEFAULT_SETTINGS,
    )
  })

  it('still apply when the browser blocks storage, and never throw', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(readSettings(BLOCKED)).toEqual(DEFAULT_SETTINGS)
    expect(
      writeSettings(BLOCKED, {
        visualEffects: 'simple',
        openReportEveryWeek: true,
        reportCadence: 'week',
        bestMedals: {},
        screensFolded: false,
        worldView: 'city',
      }),
    ).toBe(false)
    const store = createSettingsStore(BLOCKED)
    store.getState().setVisualEffects('simple')
    store.getState().setOpenReportEveryWeek(true)
    expect(store.getState().visualEffects).toBe('simple')
    expect(store.getState().openReportEveryWeek).toBe(true)
    expect(warn).toHaveBeenCalled()
  })

  it('keep no medal at first', () => {
    expect(createSettingsStore(memory()).getState().bestMedals).toEqual({})
  })

  it('keep the best medal won in each Défi, with the other settings', () => {
    const storage = memory()
    const store = createSettingsStore(storage)
    store.getState().setVisualEffects('simple')
    store.getState().recordMedal('travauxSaintDenis', 'bronze')
    store.getState().recordMedal('zeroGaspillage', 'argent')
    expect(JSON.parse(storage.items[SETTINGS_KEY]!)).toEqual({
      visualEffects: 'simple',
      openReportEveryWeek: false,
      reportCadence: 'week',
      bestMedals: { travauxSaintDenis: 'bronze', zeroGaspillage: 'argent' },
      screensFolded: false,
      worldView: 'street',
    })
    expect(createSettingsStore(storage).getState().bestMedals).toEqual({
      travauxSaintDenis: 'bronze',
      zeroGaspillage: 'argent',
    })
  })

  it('replace a medal only with a better one', () => {
    const storage = memory()
    const store = createSettingsStore(storage)
    store.getState().recordMedal('travauxSaintDenis', 'argent')
    const heard: unknown[] = []
    store.subscribe((state) => heard.push(state.bestMedals))
    store.getState().recordMedal('travauxSaintDenis', 'bronze')
    store.getState().recordMedal('travauxSaintDenis', 'argent')
    expect(heard).toEqual([])
    store.getState().recordMedal('travauxSaintDenis', 'or')
    expect(store.getState().bestMedals).toEqual({ travauxSaintDenis: 'or' })
    expect(readSettings(storage).bestMedals).toEqual({
      travauxSaintDenis: 'or',
    })
  })

  describe('in two tabs open at once', () => {
    /** Two stores on one storage, both read before either writes. */
    function twoTabs() {
      const storage = memory()
      return {
        storage,
        a: createSettingsStore(storage),
        b: createSettingsStore(storage),
      }
    }

    it.each([
      [
        'the effects',
        (b: SettingsStore) => b.getState().setVisualEffects('simple'),
      ],
      [
        'the weekly report',
        (b: SettingsStore) => b.getState().setOpenReportEveryWeek(true),
      ],
      [
        'the report cadence',
        (b: SettingsStore) => b.getState().setReportCadence('month'),
      ],
      [
        'the fold of the screens',
        (b: SettingsStore) => b.getState().setScreensFolded(true),
      ],
    ])(
      'keep the medals one won when the other changes %s',
      (_, changeSetting) => {
        const { storage, a, b } = twoTabs()
        a.getState().recordMedal('travauxSaintDenis', 'or')
        a.getState().recordMedal('zeroGaspillage', 'bronze')
        changeSetting(b)
        expect(readSettings(storage).bestMedals).toEqual({
          travauxSaintDenis: 'or',
          zeroGaspillage: 'bronze',
        })
        expect(b.getState().bestMedals).toEqual({
          travauxSaintDenis: 'or',
          zeroGaspillage: 'bronze',
        })
      },
    )

    it('keep the better medal when the other wins a worse one', () => {
      const { storage, a, b } = twoTabs()
      a.getState().recordMedal('travauxSaintDenis', 'or')
      b.getState().recordMedal('travauxSaintDenis', 'bronze')
      expect(readSettings(storage).bestMedals).toEqual({
        travauxSaintDenis: 'or',
      })
      expect(b.getState().bestMedals).toEqual({ travauxSaintDenis: 'or' })

      a.getState().recordMedal('travauxSaintDenis', 'argent')
      expect(readSettings(storage).bestMedals).toEqual({
        travauxSaintDenis: 'or',
      })
    })

    it('keep the better medal when the other wins one in the meantime', () => {
      const { storage, a, b } = twoTabs()
      a.getState().recordMedal('travauxSaintDenis', 'bronze')
      b.getState().recordMedal('travauxSaintDenis', 'or')
      a.getState().setVisualEffects('simple')
      expect(readSettings(storage)).toEqual({
        visualEffects: 'simple',
        openReportEveryWeek: false,
        reportCadence: 'week',
        bestMedals: { travauxSaintDenis: 'or' },
        screensFolded: false,
        worldView: 'street',
      })
      expect(a.getState().bestMedals).toEqual({ travauxSaintDenis: 'or' })
    })

    it('keep the medals each won in different Défis', () => {
      const { storage, a, b } = twoTabs()
      a.getState().recordMedal('travauxSaintDenis', 'or')
      b.getState().recordMedal('zeroGaspillage', 'argent')
      a.getState().recordMedal('festivalDuPasPire', 'bronze')
      expect(readSettings(storage).bestMedals).toEqual({
        travauxSaintDenis: 'or',
        zeroGaspillage: 'argent',
        festivalDuPasPire: 'bronze',
      })
    })
  })

  it('merge two sets of medals, keeping the better in each Défi', () => {
    expect(
      mergeMedals(
        { travauxSaintDenis: 'bronze', zeroGaspillage: 'or' },
        {
          travauxSaintDenis: 'argent',
          zeroGaspillage: 'bronze',
          moisSansConge: 'or',
        },
      ),
    ).toEqual({
      travauxSaintDenis: 'argent',
      zeroGaspillage: 'or',
      moisSansConge: 'or',
    })
    expect(mergeMedals({}, {})).toEqual({})
  })

  it('rank the medals: or, then argent, then bronze', () => {
    expect(betterMedal('or', 'argent')).toBe('or')
    expect(betterMedal('bronze', 'argent')).toBe('argent')
    expect(betterMedal('bronze', 'or')).toBe('or')
    expect(betterMedal('bronze', 'bronze')).toBe('bronze')
  })

  it.each([
    ['not an object', 'or', {}],
    ['a list', ['or'], {}],
    [
      'a medal that is not one',
      { travauxSaintDenis: 'platine', zeroGaspillage: 'or', festival: 3 },
      { zeroGaspillage: 'or' },
    ],
  ])(
    'drop the medals stored when they are %s, keeping the other settings',
    (_, bestMedals, kept) => {
      const storage = memory({
        [SETTINGS_KEY]: JSON.stringify({
          visualEffects: 'simple',
          openReportEveryWeek: true,
          bestMedals,
        }),
      })
      expect(readSettings(storage)).toEqual({
        visualEffects: 'simple',
        openReportEveryWeek: true,
        reportCadence: 'week',
        bestMedals: kept,
        screensFolded: false,
        worldView: 'street',
      })
    },
  )

  it('find no storage under Node, so the shared ones are the defaults', () => {
    expect(settingsStore.getState().visualEffects).toBe('full')
    expect(settingsStore.getState().openReportEveryWeek).toBe(false)
    expect(settingsStore.getState().reportCadence).toBe('week')
    expect(settingsStore.getState().screensFolded).toBe(false)
  })
})
