import { describe, expect, it } from 'vitest'
import {
  backdropPoint,
  CITY_TABS,
  DREAM_TABS,
  drawerEscape,
  financesTabs,
  JOURNAL_TABS,
  TRUCK_TABS,
  nextTab,
  tabId,
} from './dockFrame.ts'

const TABS = ['a', 'b', 'c']

describe('nextTab', () => {
  it('moves right and left, going round', () => {
    expect(nextTab(TABS, 'a', 'ArrowRight')).toBe('b')
    expect(nextTab(TABS, 'c', 'ArrowRight')).toBe('a')
    expect(nextTab(TABS, 'a', 'ArrowLeft')).toBe('c')
    expect(nextTab(TABS, 'b', 'ArrowLeft')).toBe('a')
  })

  it('goes to the first with Home and the last with End', () => {
    expect(nextTab(TABS, 'b', 'Home')).toBe('a')
    expect(nextTab(TABS, 'b', 'End')).toBe('c')
  })

  it('ignores any other key, and a tab it does not know', () => {
    expect(nextTab(TABS, 'a', 'Enter')).toBeNull()
    expect(nextTab(TABS, 'z', 'ArrowRight')).toBeNull()
  })
})

describe('drawerEscape', () => {
  const target = (inDialog: boolean) => ({
    closest: (selectors: string) =>
      inDialog && selectors === 'dialog' ? {} : null,
  })
  const escape = {
    key: 'Escape',
    defaultPrevented: false,
    target: target(false),
  }

  it('closes the drawer on Escape', () => {
    expect(drawerEscape(escape, false)).toBe(true)
  })

  it('leaves an Escape a tooltip already took', () => {
    expect(drawerEscape({ ...escape, defaultPrevented: true }, false)).toBe(
      false,
    )
  })

  it('leaves Escape to a panel open over it, and to any dialog', () => {
    expect(drawerEscape(escape, true)).toBe(false)
    expect(drawerEscape({ ...escape, target: target(true) }, false)).toBe(false)
  })

  it('ignores other keys', () => {
    expect(drawerEscape({ ...escape, key: 'Enter' }, false)).toBe(false)
  })
})

describe('the tabs', () => {
  it('of « Le camion »: the menu, the stocks, the days, the pay and marketing, the bakery', () => {
    expect(TRUCK_TABS.map(({ id, label }) => [id, label])).toEqual([
      ['menu', 'Menu'],
      ['stocks', 'Stocks'],
      ['schedule', 'Horaire'],
      ['payMarketing', 'Salaire et marketing'],
      ['bakery', 'Fournil'],
    ])
  })

  it('of « Ville »: « Aller à… » and « Contrats »', () => {
    expect(CITY_TABS.map(({ label }) => label)).toEqual([
      'Aller à…',
      'Contrats',
    ])
  })

  it('of « Finances »: « Entreprise » and « Personnel », « Contrats » too in a Défi only', () => {
    expect(financesTabs(false).map(({ label }) => label)).toEqual([
      'Entreprise',
      'Personnel',
    ])
    expect(financesTabs(true).map(({ id }) => id)).toEqual([
      'company',
      'personal',
      'contracts',
    ])
  })

  it('of « Journal »: « Événements » and « Bilans »', () => {
    expect(JOURNAL_TABS.map(({ label }) => label)).toEqual([
      'Événements',
      'Bilans',
    ])
  })

  it('of « Améliorations »: « Vie personnelle » and « Entreprise »', () => {
    expect(DREAM_TABS).toEqual([
      { id: 'personal', label: 'Vie personnelle' },
      { id: 'company', label: 'Entreprise' },
    ])
  })

  it('each with an id its tab panel names', () => {
    expect(tabId('body', 'trip')).toBe('body-tab-trip')
  })
})

describe('backdropPoint', () => {
  const dialog = { tagName: 'DIALOG' }
  const box = { left: 16, top: 80, right: 576, bottom: 600 }
  const press = (target: unknown, clientX: number, clientY: number) =>
    backdropPoint({ target, clientX, clientY }, dialog, box)

  it('hands on a press on the backdrop: on the dialog itself, outside its box', () => {
    expect(press(dialog, 900, 400)).toEqual({ x: 900, y: 400 })
    expect(press(dialog, 300, 20)).toEqual({ x: 300, y: 20 })
    expect(press(dialog, 300, 700)).toEqual({ x: 300, y: 700 })
  })

  it('keeps a press inside the panel, on its padding or on anything in it', () => {
    expect(press(dialog, 300, 400)).toBeNull()
    expect(press(dialog, 576, 600)).toBeNull()
    expect(press({ tagName: 'BUTTON' }, 900, 400)).toBeNull()
  })
})
