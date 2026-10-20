import type { ReactNode } from 'react'
import './JournalRow.css'

interface JournalRowProps {
  /** Unique on the page: the button's id and its region's derive from it. */
  id: string
  /** The one line the row shows closed. */
  line: ReactNode
  open: boolean
  onToggle: () => void
  /** What the row opens to, drawn only while open. */
  children: ReactNode
}

/**
 * A row of « Journal »: one line, whose button opens or closes what it
 * holds under it, as the accordions of « Finances » do.
 */
export default function JournalRow({
  id,
  line,
  open,
  onToggle,
  children,
}: JournalRowProps) {
  const buttonId = `${id}-button`
  const regionId = `${id}-region`
  return (
    <li className="journal-row">
      <button
        type="button"
        id={buttonId}
        className="journal-row__button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={onToggle}
      >
        <span className="journal-row__marker" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="journal-row__line">{line}</span>
      </button>
      <div
        id={regionId}
        className="journal-row__body"
        role="region"
        aria-labelledby={buttonId}
        hidden={!open}
      >
        {open && children}
      </div>
    </li>
  )
}
