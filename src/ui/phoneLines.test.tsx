import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { FinancesCompanyView } from './FinancesCompany.tsx'
import { companyBoard } from './financesBoard.ts'
import { SettingsPanelView } from './SettingsPanel.tsx'
import { FIRST_FINANCE_SECTIONS } from './store.ts'
import type { TripRefusal } from '../engine/places.ts'
import { placeLine, refusalLine, tripBoard } from './tripBoard.ts'

// On a phone, a control shows at most one line under or beside it, the
// rest in its tooltip (#202 rule 3, #233). Vitest lays nothing out, so each
// line is held to the room its row leaves at 390 × 844, with a text's width
// taken as its length times the widest average glyph Chromium drew for its
// style there (#233's measurements).

/** Average width of a glyph, in px, per style. */
const GLYPH = {
  /** `.status-line`: 13 px, bold. « Rien à déposer pour l'instant », 229 px. */
  statusLine: 229 / 29,
  /** `.settings-panel__hint`: 14 px. « Les effets simples allègent… », 453 px. */
  settingsHint: 453 / 68,
  /** `.finance-accordion__button`: 16 px, 800. « État des flux de trésorerie », 237 px. */
  accordionTitle: 237 / 27,
  /** `.finance-accordion__hint`: 12 px. « Détail complet », 99 px. */
  accordionHint: 99 / 14,
}

/** Room at 390 px wide, in px. */
const ROOM = {
  /** A place's row on « Aller à… » beside « Y aller », less the dot and its gap. */
  placeLine: 222 - 9 - 7,
  /** A hint under a setting of « Réglages ». */
  settingsHint: 358,
  /** An accordion's button, less its marker and the two gaps. */
  accordion: 350 - 14 - 2 * 8,
}

const width = (text: string, glyph: number) => text.length * glyph

/** The text inside every element of `html` with the class `name`. */
function texts(html: string, name: string): string[] {
  return [
    ...html.matchAll(new RegExp(`class="${name}"[^>]*>([\\s\\S]*?)</`, 'g')),
  ].map(([, inner = '']) =>
    inner
      .replace(/<!-- -->/g, '')
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, ' '),
  )
}

/** Day 1 of a new game, seed 42, as the review played it. */
const GAME = tick(createInitialState(42))

describe('one line on a phone (#233)', () => {
  it('fits each place’s status line beside « Y aller »', () => {
    const lines = tripBoard(GAME)
      .rows.map((row) => placeLine(row).fact?.text)
      .filter((text) => text !== undefined)
    expect(lines).toEqual(
      expect.arrayContaining(['Votre encaisse suffit', 'Rien à déposer']),
    )
    const tooWide = lines.filter(
      (text) => width(text, GLYPH.statusLine) > ROOM.placeLine,
    )
    expect(tooWide).toEqual([])
  })

  it('fits every reason a trip is refused beside « Y aller »', () => {
    const refusals: TripRefusal[] = [
      'defi',
      'ended',
      'played',
      'booked',
      'nothingToFile',
      'came',
      'mayNotLend',
      'noNeed',
    ]
    const tooWide = refusals
      .map((refusal) => refusalLine(GAME, refusal))
      .filter((text) => width(text, GLYPH.statusLine) > ROOM.placeLine)
    expect(tooWide).toEqual([])
  })

  it('fits each hint of « Réglages » on one line', () => {
    const html = renderToStaticMarkup(
      <SettingsPanelView
        visualEffects="full"
        onVisualEffectsChange={vi.fn()}
        cadence="month"
        onCadenceChange={vi.fn()}
        everyWeek={false}
        onEveryWeekChange={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
        importError={null}
        onClose={vi.fn()}
      />,
    )
    const hints = texts(html, 'settings-panel__hint')
    expect(hints.length).toBeGreaterThanOrEqual(3)
    const tooWide = hints.filter(
      (text) => width(text, GLYPH.settingsHint) > ROOM.settingsHint,
    )
    expect(tooWide).toEqual([])
  })

  it('fits each accordion of « Entreprise » on one line', () => {
    const html = renderToStaticMarkup(
      <FinancesCompanyView
        board={companyBoard(GAME, [])}
        sections={FIRST_FINANCE_SECTIONS}
        onTile={vi.fn()}
        onToggle={vi.fn()}
        headingRef={vi.fn()}
      />,
    )
    const buttons = [
      ...html.matchAll(
        /class="finance-accordion__button"[^>]*>([\s\S]*?)<\/button>/g,
      ),
    ].map(([, inner = '']) => {
      const title = /<span id="[^"]*">([^<]*)<\/span>/.exec(inner)?.[1] ?? ''
      const hint = texts(inner, 'finance-accordion__hint')[0] ?? ''
      return { title, hint }
    })
    expect(buttons.map(({ title }) => title)).toContain(
      'État des flux de trésorerie',
    )
    const tooWide = buttons.filter(
      ({ title, hint }) =>
        width(title, GLYPH.accordionTitle) + width(hint, GLYPH.accordionHint) >
        ROOM.accordion,
    )
    expect(tooWide).toEqual([])
  })
})
