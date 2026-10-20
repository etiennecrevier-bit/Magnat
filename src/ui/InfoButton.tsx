import Tooltip from './Tooltip.tsx'
import type { TipContent } from './tooltip.ts'

export interface InfoButtonProps {
  readonly content: TipContent
  /** Its width when the window has room, as for `Tooltip`. */
  readonly width?: number
  /** What a screen reader calls the button. */
  readonly label?: string
}

/**
 * An « (i) » button for a tooltip where nothing on the screen can carry it.
 * Besides hover, focus and a long press, a click, Enter or a tap opens it
 * and keeps it open until Escape, blur or a press elsewhere.
 */
export default function InfoButton({
  content,
  width,
  label = 'En savoir plus',
}: InfoButtonProps) {
  return (
    <Tooltip content={content} width={width}>
      {(anchor, tip) => (
        <button
          type="button"
          className="info-button"
          aria-label={label}
          {...anchor}
          onClick={tip.open}
        >
          {/* docs/design/reference/icon-info.svg */}
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v6M12 7.5v.5" />
          </svg>
        </button>
      )}
    </Tooltip>
  )
}
