import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import GameScreens, { GameScreensView, type Screen } from './GameScreens.tsx'

function render(screen: Screen, autosaveFailed = false) {
  return renderToStaticMarkup(
    <GameScreensView
      screen={screen}
      onScreenChange={() => {}}
      onExport={() => {}}
      autosaveFailed={autosaveFailed}
    />,
  )
}

const MESSAGES =
  '<section class="messages" role="log" aria-label="Messages"></section>'

const AUTOSAVE_FAILED =
  '<p class="notice" role="status">La sauvegarde automatique a échoué. Exportez la sauvegarde pour ne pas perdre votre partie.</p>'

/** Each screen button's text and pressed state, in order. */
function screenButtons(html: string) {
  const nav = /<nav[^>]*>.*<\/nav>/.exec(html)?.[0] ?? ''
  return [...nav.matchAll(/aria-pressed="(true|false)">([^<]*)</g)].map(
    ([, pressed, label]) => ({ label, pressed }),
  )
}

describe('GameScreensView', () => {
  it("shows the Aujourd'hui panel under a labelled screen menu", () => {
    const html = render('today')
    expect(html).toMatch(
      new RegExp(
        `^<main>${MESSAGES}<nav class="screen-nav" aria-label="Écrans">`,
      ),
    )
    expect(screenButtons(html)).toEqual([
      { label: 'Aujourd&#x27;hui', pressed: 'true' },
      { label: 'États financiers', pressed: 'false' },
      { label: 'Journal des événements', pressed: 'false' },
      { label: 'Bilans', pressed: 'false' },
    ])
    expect(html).toContain('<h1>Aujourd&#x27;hui</h1>')
    expect(html).not.toContain('<h1>États financiers</h1>')
    expect(html).not.toContain('<h1>Journal des événements</h1>')
  })

  it('shows the États financiers screen', () => {
    const html = render('statements')
    expect(screenButtons(html)).toEqual([
      { label: 'Aujourd&#x27;hui', pressed: 'false' },
      { label: 'États financiers', pressed: 'true' },
      { label: 'Journal des événements', pressed: 'false' },
      { label: 'Bilans', pressed: 'false' },
    ])
    expect(html).toContain('<h1>États financiers</h1>')
    expect(html).not.toContain('<h1>Aujourd&#x27;hui</h1>')
  })

  it('shows the Journal des événements screen', () => {
    const html = render('events')
    expect(screenButtons(html)).toEqual([
      { label: 'Aujourd&#x27;hui', pressed: 'false' },
      { label: 'États financiers', pressed: 'false' },
      { label: 'Journal des événements', pressed: 'true' },
      { label: 'Bilans', pressed: 'false' },
    ])
    expect(html).toContain(
      '<section class="event-log"><h1>Journal des événements</h1><p>Aucun événement depuis un an.</p></section>',
    )
    expect(html).not.toContain('<h1>Aujourd&#x27;hui</h1>')
  })

  it('shows the Bilans screen, empty before the first week closes', () => {
    const html = render('reports')
    expect(screenButtons(html)).toEqual([
      { label: 'Aujourd&#x27;hui', pressed: 'false' },
      { label: 'États financiers', pressed: 'false' },
      { label: 'Journal des événements', pressed: 'false' },
      { label: 'Bilans', pressed: 'true' },
    ])
    expect(html).toContain(
      '<section class="week-reports"><h1>Bilans</h1><p>Aucun bilan pour l&#x27;instant.</p></section>',
    )
    expect(html).not.toContain('<h1>Aujourd&#x27;hui</h1>')
  })

  it('has an export button after the screen menu', () => {
    expect(render('today')).toMatch(
      /<\/div><button type="button" class="button">Exporter la sauvegarde<\/button><\/nav>/,
    )
  })

  it('tells the player to export when the autosave fails', () => {
    expect(render('today', true)).toMatch(
      new RegExp(`^<main>${AUTOSAVE_FAILED}${MESSAGES}<nav`),
    )
    expect(render('today', false)).not.toContain('La sauvegarde automatique')
  })
})

describe('GameScreens', () => {
  it("opens on Aujourd'hui, then the week's card and the ticker", () => {
    const html = renderToStaticMarkup(<GameScreens onMenu={() => {}} />)
    expect(html.startsWith(render('today'))).toBe(true)
    // The card's region is empty until a week slides in, and the ticker
    // shows only once there are headlines (see headlines.ts).
    expect(html.slice(render('today').length)).toMatch(
      /^<div class="week-slide-in" role="status"><\/div>(<aside class="ticker" aria-label="La Presse-Citron">.*<\/aside>)?$/,
    )
  })

  it('passes on a failed autosave', () => {
    expect(
      renderToStaticMarkup(<GameScreens autosaveFailed onMenu={() => {}} />),
    ).toContain(AUTOSAVE_FAILED)
  })
})
