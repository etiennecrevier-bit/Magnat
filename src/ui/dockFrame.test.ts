import { describe, expect, it } from 'vitest'
import {
  CITY_TABS,
  drawerEscape,
  financesTabs,
  JOURNAL_TABS,
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
  it('of « Ville »: « Aller à… » and « Contrats »', () => {
    expect(CITY_TABS.map(({ label }) => label)).toEqual([
      'Aller à…',
      'Contrats',
    ])
  })

  it('of « Finances »: « Contrats » too in a Défi only', () => {
    expect(financesTabs(false).map(({ label }) => label)).toEqual([
      "Aujourd'hui",
      'Vos finances',
      'États financiers',
    ])
    expect(financesTabs(true).map(({ id }) => id)).toEqual([
      'today',
      'personal',
      'statements',
      'contracts',
    ])
  })

  it('of « Journal »: « Événements » and « Bilans »', () => {
    expect(JOURNAL_TABS.map(({ label }) => label)).toEqual([
      'Événements',
      'Bilans',
    ])
  })

  it('each with an id its tab panel names', () => {
    expect(tabId('body', 'trip')).toBe('body-tab-trip')
  })
})
