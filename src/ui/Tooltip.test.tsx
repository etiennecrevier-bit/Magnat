import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import InfoButton from './InfoButton.tsx'
import Tooltip from './Tooltip.tsx'
import type { TipContent } from './tooltip.ts'

const CROISSANT: TipContent = {
  title: 'Croissant · hier',
  rows: [
    { label: 'Vendus', value: '70' },
    { label: 'Trop cher', value: '12', warn: true },
  ],
}

function render(content: TipContent): string {
  return renderToStaticMarkup(
    <Tooltip content={content}>
      {(anchor) => (
        <button type="button" {...anchor}>
          Croissant
        </button>
      )}
    </Tooltip>,
  )
}

// The tooltip's own element, whatever the order of its attributes.
const TIP_ELEMENT = 'div[^>]*role="tooltip"'

/** The value of `name` on the first element `tag` opens in `html`. */
function attribute(html: string, tag: string, name: string): string | null {
  const element = html.match(new RegExp(`<${tag}[^>]*>`))?.[0] ?? ''
  return element.match(new RegExp(` ${name}="([^"]*)"`))?.[1] ?? null
}

describe('Tooltip', () => {
  it('describes its anchor by the tooltip, which is a closed manual popover', () => {
    const html = render(CROISSANT)
    const id = attribute(html, 'button', 'aria-describedby')
    expect(id).toBeTruthy()
    expect(attribute(html, TIP_ELEMENT, 'id')).toBe(id)
    expect(html).toContain('popover="manual"')
    expect(html).not.toContain('data-open')
    // It never takes the focus.
    expect(html).not.toContain('tabindex')
  })

  it('shows the title and the rows, a value to look at in amber', () => {
    const html = render(CROISSANT)
    expect(html).toContain('<p class="tip__title">Croissant · hier</p>')
    expect(html).toContain(
      '<dl class="tip__rows"><div class="tip__row"><dt>Vendus</dt><dd>70</dd></div>' +
        '<div class="tip__row"><dt>Trop cher</dt><dd class="tip__value--warn">12</dd></div></dl>',
    )
    expect(html).toContain(
      '<span class="tip__arrow" aria-hidden="true"></span>',
    )
  })

  it('shows a text and the hint of what clicking does, its « ▸ » hidden', () => {
    const html = render({
      title: 'Ce mois-ci',
      text: 'Du 1er au 9 mai.',
      link: "Ouvrir l'état des résultats",
    })
    expect(html).toContain('<p class="tip__text">Du 1er au 9 mai.</p>')
    expect(html).toContain(
      '<p class="tip__link">Ouvrir l&#x27;état des résultats <span aria-hidden="true">▸</span></p>',
    )
  })

  it('leaves out the parts it is not given', () => {
    const html = render({ title: 'Seul', rows: [] })
    expect(html).toContain(
      '<div class="tip__body"><p class="tip__title">Seul</p></div>',
    )
    expect(html).not.toContain('tip__text')
    expect(html).not.toContain('tip__rows')
    expect(html).not.toContain('tip__link')
  })

  it('gives each tooltip its own id', () => {
    const html = renderToStaticMarkup(
      <>
        <Tooltip content={CROISSANT}>
          {(anchor) => <span {...anchor}>A</span>}
        </Tooltip>
        <Tooltip content={CROISSANT}>
          {(anchor) => <span {...anchor}>B</span>}
        </Tooltip>
      </>,
    )
    const ids = [...html.matchAll(/aria-describedby="([^"]*)"/g)].map(
      (m) => m[1],
    )
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })
})

describe('InfoButton', () => {
  it('is an « (i) » button described by its tooltip', () => {
    const html = renderToStaticMarkup(<InfoButton content={CROISSANT} />)
    expect(attribute(html, 'button', 'type')).toBe('button')
    expect(attribute(html, 'button', 'class')).toBe('info-button')
    expect(attribute(html, 'button', 'aria-label')).toBe('En savoir plus')
    const id = attribute(html, 'button', 'aria-describedby')
    expect(id).toBeTruthy()
    expect(attribute(html, TIP_ELEMENT, 'id')).toBe(id)
    expect(html).toContain('<circle cx="12" cy="12" r="9"></circle>')
    expect(html).toContain('<path d="M12 11v6M12 7.5v.5"></path>')
    expect(attribute(html, 'svg', 'aria-hidden')).toBe('true')
  })

  it('takes another label', () => {
    const html = renderToStaticMarkup(
      <InfoButton content={CROISSANT} label="À propos des ventes" />,
    )
    expect(attribute(html, 'button', 'aria-label')).toBe('À propos des ventes')
  })
})
