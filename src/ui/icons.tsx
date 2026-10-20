import type { ReactNode } from 'react'

// The interface's icons, from docs/design/reference/icon-*.svg: 24 x 24,
// drawn with a round 2 px stroke in the text's colour.
const PATHS = {
  camion: (
    <>
      <path d="M2 6h12v10H2z" />
      <path d="M14 9h4.5l3.5 3.5V16h-8z" />
      <circle cx="6" cy="17.5" r="2" />
      <circle cx="17.5" cy="17.5" r="2" />
    </>
  ),
  equipe: (
    <>
      <circle cx="8.5" cy="8" r="3" />
      <circle cx="16.5" cy="9" r="2.5" />
      <path d="M2.5 19c.6-3.6 3-5.5 6-5.5s5.4 1.9 6 5.5" />
      <path d="M15 13.6c2.9-.2 5.4 1.5 6 4.9" />
    </>
  ),
  ville: (
    <>
      <path d="M3 6l5-2 8 3 5-2v13l-5 2-8-3-5 2z" />
      <path d="M8 4v13M16 7v13" />
    </>
  ),
  finances: <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />,
  ameliorations: (
    <path d="M12 3l2.6 5.5 6 .7-4.4 4.1 1.2 5.9L12 16.3 6.6 19.2l1.2-5.9L3.4 9.2l6-.7z" />
  ),
  journal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9h10M7 13h10M7 17h6" />
    </>
  ),
  reglages: (
    <>
      <circle cx="12" cy="12" r="3" />
      <circle
        cx="12"
        cy="12"
        r="7.5"
        strokeDasharray="3.2 2.4"
        strokeWidth="3"
      />
    </>
  ),
  cahier: (
    <>
      <path d="M5 3h11a3 3 0 0 1 3 3v15H8a3 3 0 0 1-3-3z" />
      <path d="M5 18a3 3 0 0 1 3-3h11" />
      <path d="M9 7h6M9 10h4" />
    </>
  ),
  alerte: (
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18v.5" />
    </>
  ),
  energie: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </>
  ),
  cadenas: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS

/** The icon `name`, `size` pixels square, hidden from screen readers. */
export function Icon({
  name,
  size = 24,
  strokeWidth = 2,
}: {
  readonly name: IconName
  readonly size?: number
  readonly strokeWidth?: number
}) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}

/**
 * The palm-tree stamp in the corner of Réal's postcards (#239): a cream
 * stamp with a perforated edge, a sun and a palm, hidden from screen
 * readers.
 */
export function PalmStamp({ size = 36 }: { readonly size?: number }) {
  return (
    <svg
      className="stamp"
      width={size}
      height={size}
      viewBox="0 0 44 44"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="2"
        y="2"
        width="40"
        height="40"
        rx="2"
        fill="#fff7e8"
        stroke="#2b2622"
        strokeWidth="2"
        strokeDasharray="3 2"
      />
      <rect x="7" y="7" width="30" height="30" fill="#f6c48a" />
      <circle cx="29" cy="14" r="4" fill="#f08a3e" />
      <path d="M7 31h30v6H7z" fill="#5fa8c9" />
      <path
        d="M20 32c0-7 1-12 3-17"
        fill="none"
        stroke="#6b4a2b"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M23 15c-3-3-8-3-10 0M23 15c3-3 8-2 9 1M23 15c-1-3-4-5-7-4M23 15c2-3 6-4 8-2"
        fill="none"
        stroke="#2f7a3d"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
