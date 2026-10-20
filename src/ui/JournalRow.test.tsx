import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import JournalRow from './JournalRow.tsx'

function row(open: boolean): string {
  return renderToStaticMarkup(
    <JournalRow id="r" line="Ligne" open={open} onToggle={() => {}}>
      <p>Dedans</p>
    </JournalRow>,
  )
}

describe('JournalRow', () => {
  it('shows its line on a button, its region named by it and hidden while closed', () => {
    expect(row(false)).toBe(
      '<li class="journal-row"><button type="button" id="r-button" class="journal-row__button" aria-expanded="false" aria-controls="r-region">' +
        '<span class="journal-row__marker" aria-hidden="true">▸</span><span class="journal-row__line">Ligne</span></button>' +
        '<div id="r-region" class="journal-row__body" role="region" aria-labelledby="r-button" hidden=""></div></li>',
    )
  })

  it('draws what it holds only while open', () => {
    expect(row(true)).toBe(
      '<li class="journal-row"><button type="button" id="r-button" class="journal-row__button" aria-expanded="true" aria-controls="r-region">' +
        '<span class="journal-row__marker" aria-hidden="true">▾</span><span class="journal-row__line">Ligne</span></button>' +
        '<div id="r-region" class="journal-row__body" role="region" aria-labelledby="r-button"><p>Dedans</p></div></li>',
    )
  })
})
