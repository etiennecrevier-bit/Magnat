import type { ReactNode } from 'react'
import type { ProductId } from '../content/schema.ts'

// The products' glyphs on their cards in « Le camion », from
// docs/design/reference/glyph-cup.svg, glyph-mug.svg and
// glyph-croissant.svg: 40 x 40, in their own colours.
const GLYPHS: Readonly<Record<ProductId, ReactNode>> = {
  cafe: (
    <>
      <path
        d="M9 14h20l-2.5 19a3 3 0 0 1-3 2.6h-9a3 3 0 0 1-3-2.6z"
        fill="#f3e6c8"
      />
      <path d="M9 14h20l-.6 4.4H9.6z" fill="#8a5a3c" />
      <rect x="7" y="10" width="24" height="5" rx="2" fill="#5a3a2a" />
      <path
        d="M19 14h10l-2.5 19a3 3 0 0 1-3 2.6H19z"
        fill="#34404f"
        opacity="0.15"
      />
    </>
  ),
  chocolat: (
    <>
      <path
        d="M30 17h3a4 4 0 0 1 0 8h-3"
        fill="none"
        stroke="#b4532f"
        strokeWidth="3"
      />
      <rect x="8" y="13" width="23" height="21" rx="4" fill="#b4532f" />
      <ellipse cx="19.5" cy="14" rx="11.5" ry="3" fill="#6b3a24" />
      <path
        d="M12 9c0-2 2-2 2-4M18 9c0-2 2-2 2-4M24 9c0-2 2-2 2-4"
        fill="none"
        stroke="#a7aeb3"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <rect
        x="20"
        y="13"
        width="11"
        height="21"
        rx="4"
        fill="#34404f"
        opacity="0.15"
      />
    </>
  ),
  croissant: (
    <>
      <path
        d="M5 26c3-12 27-12 30 0-4-3-7-3-9-1-2-4-10-4-12 0-2-2-5-2-9 1z"
        fill="#d9903a"
      />
      <path
        d="M12 18c2 3 2 6 1 8M20 15.5v10M28 18c-2 3-2 6-1 8"
        stroke="#a8641f"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M9 21c3-4 9-6 14-5"
        stroke="#f3c27a"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
    </>
  ),
}

/** The glyph of `product`, 40 pixels square, hidden from screen readers. */
export function ProductGlyph({ product }: { readonly product: ProductId }) {
  return (
    <svg
      className="product-glyph"
      width="40"
      height="40"
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[product]}
    </svg>
  )
}
