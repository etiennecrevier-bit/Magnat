import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PrudhommeAdvice } from './PrudhommeAdvice.tsx'

// French quotation marks hold their text with no-break spaces (U+00A0).
const S = ' '

describe('PrudhommeAdvice', () => {
  it('shows her portrait, her title and her line in quotation marks', () => {
    expect(
      renderToStaticMarkup(
        <PrudhommeAdvice
          advice="Votre propriétaire a appelé. Deux fois."
          portrait="/assets/mmePrudhomme-abc.png"
        />,
      ),
    ).toBe(
      '<section class="prudhomme-advice" aria-label="Le conseil de Mme Prudhomme">' +
        '<img class="prudhomme-advice__portrait" src="/assets/mmePrudhomme-abc.png" alt="" width="64" height="64" loading="lazy"/>' +
        '<div><p class="prudhomme-advice__title">Le conseil de Mme Prudhomme</p>' +
        `<p class="prudhomme-advice__text">«${S}Votre propriétaire a appelé. Deux fois.${S}»</p></div>` +
        '</section>',
    )
  })

  it('shows no portrait when she has none', () => {
    const html = renderToStaticMarkup(
      <PrudhommeAdvice advice="Rien à redire." portrait={null} />,
    )
    expect(html).not.toContain('<img')
    expect(html).toContain(
      `<p class="prudhomme-advice__text">«${S}Rien à redire.${S}»</p>`,
    )
  })

  it('escapes her line', () => {
    expect(
      renderToStaticMarkup(
        <PrudhommeAdvice
          advice="Dommage qu'il ne soit pas dans votre encaisse."
          portrait={null}
        />,
      ),
    ).toContain('Dommage qu&#x27;il ne soit pas dans votre encaisse.')
  })
})
